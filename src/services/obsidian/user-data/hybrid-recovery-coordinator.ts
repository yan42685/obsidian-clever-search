import type { TFile } from "obsidian";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";
import {
  isAutoRetryHybridFailureKind,
  type HybridRepairMode,
} from "./index-recovery-state";
import {
  HybridEmbeddingRecoveryManager,
  type HybridFailedEmbeddingSummary,
  type HybridRecoveryEntry,
} from "./hybrid-embedding-recovery-manager";
import { HybridRecoveryStateStore } from "./hybrid-recovery-state-store";

export type HybridRecoveryCoordinatorRepairTask = {
  path: string;
  mode: HybridRepairMode;
  reason: string;
  eligibleAt: number;
  sourceGeneration?: number;
};

type HybridRecoveryCoordinatorOptions = {
  canRetryPath: (path: string) => boolean;
  enqueueRepair: (task: HybridRecoveryCoordinatorRepairTask) => void;
  onChanged: () => void;
  getFailedEmbeddingRetryIntervalMs: () => number;
};

type RestorePersistedHybridRecoveryStateParams = {
  currFiles: ReadonlyMap<string, TFile>;
  previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>;
};

export class HybridRecoveryCoordinator {
  private readonly recoveryManager = new HybridEmbeddingRecoveryManager(
    () => this.options.onChanged(),
  );
  private readonly recoveryStateStore = new HybridRecoveryStateStore();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: HybridRecoveryCoordinatorOptions) {}

  hasFailures(): boolean {
    return this.recoveryManager.hasFailures();
  }

  getFailureSummary(totalFiles: number): HybridFailedEmbeddingSummary {
    return this.recoveryManager.getSummary(totalFiles);
  }

  getDeferredSummary(totalFiles: number): {
    deferredCount: number;
    nextEligibleAt: number | null;
    totalFiles: number;
  } {
    const now = Date.now();
    let deferredCount = 0;
    let nextEligibleAt: number | null = null;

    for (const entry of this.recoveryManager.listDeferredEntries()) {
      if (!this.options.canRetryPath(entry.path)) {
        continue;
      }
      deferredCount += 1;
      const eligibleAt = entry.nextRetryAt ?? now;
      if (nextEligibleAt === null || eligibleAt < nextEligibleAt) {
        nextEligibleAt = eligibleAt;
      }
    }

    return {
      deferredCount,
      nextEligibleAt,
      totalFiles,
    };
  }

  listFailurePaths(): string[] {
    return this.recoveryManager
      .listFailureEntries()
      .filter((entry) => this.options.canRetryPath(entry.path))
      .map((entry) => entry.path);
  }

  listDeferredPaths(): string[] {
    return this.recoveryManager
      .listDeferredEntries()
      .filter((entry) => this.options.canRetryPath(entry.path))
      .map((entry) => entry.path);
  }

  getEntry(path: string): HybridRecoveryEntry | null {
    const entry = this.recoveryManager.getEntry(path);
    if (!entry || !this.options.canRetryPath(path)) {
      return null;
    }
    return entry;
  }

  resetRuntimeState(): void {
    this.clearRetryTimer();
    this.recoveryManager.clearAll();
  }

  async restorePersistedState(
    params: RestorePersistedHybridRecoveryStateParams,
  ): Promise<void> {
    const activeEntries = await this.recoveryStateStore.restoreEntries({
      currFiles: params.currFiles,
      previousIndexedFileRefs: params.previousIndexedFileRefs,
    });
    this.recoveryManager.replaceAll(activeEntries);
    this.scheduleRetry();
  }

  async retryFailuresOnConfigChange(
    reason = "config-changed",
  ): Promise<void> {
    for (const path of this.recoveryManager.listTrackedPaths()) {
      if (!this.options.canRetryPath(path)) {
        await this.clearPath(path);
      }
    }

    for (const entry of this.recoveryManager.listFailureEntries()) {
      this.options.enqueueRepair({
        path: entry.path,
        mode: entry.mode,
        reason,
        eligibleAt: Date.now(),
        sourceGeneration: entry.targetGeneration,
      });
      if (isAutoRetryHybridFailureKind(entry.errorKind)) {
        await this.markRetryQueued(entry.path);
      }
    }

    this.scheduleRetry();
  }

  refreshRetrySchedule(): void {
    this.recoveryManager.refreshRetrySchedule(
      this.options.getFailedEmbeddingRetryIntervalMs(),
    );
    void this.persistAllEntries();
    this.scheduleRetry();
  }

  async clearPath(path: string): Promise<void> {
    this.recoveryManager.clearPath(path);
    this.scheduleRetry();
    await this.recoveryStateStore.deleteEntry(path);
  }

  async movePath(oldPath: string, newPath: string): Promise<void> {
    this.recoveryManager.movePath(oldPath, newPath);
    this.scheduleRetry();
    await this.recoveryStateStore.moveEntry(oldPath, newPath);
  }

  async registerFailure(
    path: string,
    targetGeneration: number,
    mode: HybridRepairMode,
    error: unknown,
    reason: string,
  ): Promise<void> {
    const entry = this.recoveryManager.recordFailure(
      path,
      targetGeneration,
      mode,
      error,
      reason,
      this.options.getFailedEmbeddingRetryIntervalMs(),
    );
    this.scheduleRetry();
    await this.recoveryStateStore.persistEntry(entry);
  }

  async registerDeferred(
    path: string,
    targetGeneration: number,
    mode: HybridRepairMode,
    nextRetryAt: number | null,
  ): Promise<void> {
    const entry = this.recoveryManager.recordDeferredEmbedding(
      path,
      targetGeneration,
      mode,
      nextRetryAt,
    );
    await this.recoveryStateStore.persistEntry(entry);
  }

  async enqueuePersistedStartupRepairs(
    skipPaths: ReadonlySet<string>,
  ): Promise<void> {
    const now = Date.now();

    for (const entry of this.recoveryManager.listEntries()) {
      if (skipPaths.has(entry.path)) {
        continue;
      }
      if (!this.options.canRetryPath(entry.path)) {
        await this.clearPath(entry.path);
        continue;
      }

      if (entry.recoveryKind === "deferred_embedding") {
        this.options.enqueueRepair({
          path: entry.path,
          mode: entry.mode,
          reason: "startup-resume-deferred-embedding",
          eligibleAt: entry.nextRetryAt ?? now,
          sourceGeneration: entry.targetGeneration,
        });
        continue;
      }

      if (isAutoRetryHybridFailureKind(entry.errorKind)) {
        continue;
      }

      this.options.enqueueRepair({
        path: entry.path,
        mode: entry.mode,
        reason: "startup-recover-persisted-state",
        eligibleAt: now,
        sourceGeneration: entry.targetGeneration,
      });
    }
  }

  private async persistAllEntries(): Promise<void> {
    await this.recoveryStateStore.persistEntries(
      this.recoveryManager.listEntries(),
    );
  }

  private async markRetryQueued(path: string): Promise<void> {
    const entry = this.recoveryManager.markRetryQueued(
      path,
      this.options.getFailedEmbeddingRetryIntervalMs(),
    );
    await this.recoveryStateStore.persistEntry(entry);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    const nextRetryAt = this.recoveryManager.getNextRetryAt();
    if (nextRetryAt === null) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushRetryQueue();
    }, Math.max(0, nextRetryAt - Date.now()));
  }

  private async flushRetryQueue(): Promise<void> {
    if (!this.recoveryManager.hasFailures()) {
      return;
    }

    for (const path of this.recoveryManager.listPathsReadyForRetry()) {
      if (!this.options.canRetryPath(path)) {
        await this.clearPath(path);
        continue;
      }
      const entry = this.recoveryManager.getEntry(path);
      if (!entry) {
        continue;
      }
      this.options.enqueueRepair({
        path: entry.path,
        mode: entry.mode,
        reason: "failed-embedding-auto-retry",
        eligibleAt: Date.now(),
        sourceGeneration: entry.targetGeneration,
      });
      await this.markRetryQueued(entry.path);
    }

    this.scheduleRetry();
  }
}
