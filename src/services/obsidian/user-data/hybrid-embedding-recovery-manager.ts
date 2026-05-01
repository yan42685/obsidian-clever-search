import {
  isAutoRetryHybridFailureKind,
  type HybridEmbeddingFailureKind,
  type HybridRepairMode,
} from "./index-recovery-state";
import {
  classifyHybridProviderFailure,
} from "src/services/search/hybrid/provider-error";

export { isAutoRetryHybridFailureKind } from "./index-recovery-state";

export type HybridFailedEmbeddingEntry = {
  path: string;
  targetGeneration: number;
  mode: HybridRepairMode;
  recoveryKind: "failure";
  errorKind: HybridEmbeddingFailureKind;
  reason: string;
  lastFailedAt: number;
  nextRetryAt: number | null;
  attemptCount: number;
};

export type HybridDeferredEmbeddingEntry = {
  path: string;
  targetGeneration: number;
  mode: HybridRepairMode;
  recoveryKind: "deferred_embedding";
  errorKind: null;
  reason: "deferred_embedding";
  lastFailedAt: null;
  nextRetryAt: number | null;
  attemptCount: 0;
};

export type HybridRecoveryEntry =
  | HybridFailedEmbeddingEntry
  | HybridDeferredEmbeddingEntry;

export type HybridFailedEmbeddingSummary = {
  failedCount: number;
  totalFiles: number;
  retryableCount: number;
  nextRetryAt: number | null;
  retryableKinds: Array<{
    kind: HybridEmbeddingFailureKind;
    count: number;
  }>;
  blockingKinds: Array<{
    kind: HybridEmbeddingFailureKind;
    count: number;
  }>;
};

export class HybridEmbeddingRecoveryManager {
  private readonly recoveryEntries = new Map<string, HybridRecoveryEntry>();
  private readonly onChanged: () => void;

  constructor(onChanged: () => void) {
    this.onChanged = onChanged;
  }

  hasFailures(): boolean {
    return this.listFailureEntries().length > 0;
  }

  replaceAll(entries: HybridRecoveryEntry[]): void {
    this.recoveryEntries.clear();
    for (const entry of entries) {
      this.recoveryEntries.set(entry.path, { ...entry });
    }
    this.onChanged();
  }

  clearAll(): void {
    if (this.recoveryEntries.size === 0) {
      return;
    }
    this.recoveryEntries.clear();
    this.onChanged();
  }

  clearPath(path: string): void {
    if (!this.recoveryEntries.delete(path)) {
      return;
    }
    this.onChanged();
  }

  movePath(oldPath: string, newPath: string): void {
    const entry = this.recoveryEntries.get(oldPath);
    if (!entry) {
      return;
    }
    this.recoveryEntries.delete(oldPath);
    this.recoveryEntries.set(newPath, {
      ...entry,
      path: newPath,
    });
    this.onChanged();
  }
  recordFailure(
    path: string,
    targetGeneration: number,
    mode: HybridRepairMode,
    error: unknown,
    reason: string,
    retryIntervalMs: number,
  ): HybridFailedEmbeddingEntry {
    const errorKind = this.classifyErrorKind(error);
    const previous = this.recoveryEntries.get(path);
    const now = Date.now();
    const nextEntry: HybridFailedEmbeddingEntry = {
      path,
      targetGeneration,
      mode:
        previous?.mode === "full" || mode === "full"
          ? "full"
          : "incremental",
      recoveryKind: "failure",
      errorKind,
      reason,
      lastFailedAt: now,
      nextRetryAt: isAutoRetryHybridFailureKind(errorKind)
        ? now + retryIntervalMs
        : null,
      attemptCount:
        previous?.recoveryKind === "failure" ? previous.attemptCount + 1 : 1,
    };
    this.recoveryEntries.set(path, nextEntry);
    this.onChanged();
    return { ...nextEntry };
  }

  recordDeferredEmbedding(
    path: string,
    targetGeneration: number,
    mode: HybridRepairMode,
    nextRetryAt: number | null,
  ): HybridDeferredEmbeddingEntry {
    const previous = this.recoveryEntries.get(path);
    const nextEntry: HybridDeferredEmbeddingEntry = {
      path,
      targetGeneration,
      mode:
        previous?.mode === "full" || mode === "full"
          ? "full"
          : "incremental",
      recoveryKind: "deferred_embedding",
      errorKind: null,
      reason: "deferred_embedding",
      lastFailedAt: null,
      nextRetryAt,
      attemptCount: 0,
    };
    this.recoveryEntries.set(path, nextEntry);
    this.onChanged();
    return { ...nextEntry };
  }

  getSummary(totalFiles: number): HybridFailedEmbeddingSummary {
    const blockingCounts = new Map<HybridEmbeddingFailureKind, number>();
    const retryableCounts = new Map<HybridEmbeddingFailureKind, number>();
    let failedCount = 0;
    let retryableCount = 0;
    let nextRetryAt: number | null = null;

    for (const entry of this.recoveryEntries.values()) {
      if (entry.recoveryKind !== "failure") {
        continue;
      }
      failedCount += 1;
      if (isAutoRetryHybridFailureKind(entry.errorKind)) {
        retryableCount += 1;
        retryableCounts.set(
          entry.errorKind,
          (retryableCounts.get(entry.errorKind) ?? 0) + 1,
        );
        if (
          entry.nextRetryAt !== null &&
          (nextRetryAt === null || entry.nextRetryAt < nextRetryAt)
        ) {
          nextRetryAt = entry.nextRetryAt;
        }
        continue;
      }

      blockingCounts.set(
        entry.errorKind,
        (blockingCounts.get(entry.errorKind) ?? 0) + 1,
      );
    }

    return {
      failedCount,
      totalFiles,
      retryableCount,
      nextRetryAt,
      retryableKinds: Array.from(retryableCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([kind, count]) => ({ kind, count })),
      blockingKinds: Array.from(blockingCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([kind, count]) => ({ kind, count })),
    };
  }
  refreshRetrySchedule(retryIntervalMs: number): void {
    let changed = false;
    for (const entry of this.recoveryEntries.values()) {
      if (
        entry.recoveryKind !== "failure" ||
        !isAutoRetryHybridFailureKind(entry.errorKind)
      ) {
        continue;
      }
      entry.nextRetryAt = entry.lastFailedAt + retryIntervalMs;
      changed = true;
    }
    if (changed) {
      this.onChanged();
    }
  }

  markAllReadyForImmediateRetry(): HybridRecoveryEntry[] {
    const changedEntries: HybridRecoveryEntry[] = [];
    for (const entry of this.recoveryEntries.values()) {
      if (entry.nextRetryAt !== null) {
        entry.nextRetryAt = null;
      }
      changedEntries.push({ ...entry });
    }
    if (changedEntries.length > 0) {
      this.onChanged();
    }
    return changedEntries;
  }

  getNextRetryAt(): number | null {
    let nextRetryAt = Number.POSITIVE_INFINITY;
    for (const entry of this.recoveryEntries.values()) {
      if (
        entry.recoveryKind === "failure" &&
        isAutoRetryHybridFailureKind(entry.errorKind) &&
        entry.nextRetryAt !== null
      ) {
        nextRetryAt = Math.min(nextRetryAt, entry.nextRetryAt);
      }
    }
    return Number.isFinite(nextRetryAt) ? nextRetryAt : null;
  }

  listPathsReadyForRetry(now = Date.now()): string[] {
    return this.listFailureEntries()
      .filter(
        (entry) =>
          isAutoRetryHybridFailureKind(entry.errorKind) &&
          entry.nextRetryAt !== null &&
          entry.nextRetryAt <= now,
      )
      .map((entry) => entry.path);
  }

  listTrackedPaths(): string[] {
    return Array.from(this.recoveryEntries.keys());
  }

  listEntries(): HybridRecoveryEntry[] {
    return Array.from(this.recoveryEntries.values()).map((entry) => ({
      ...entry,
    }));
  }

  listFailureEntries(): HybridFailedEmbeddingEntry[] {
    return this.listEntries().filter(
      (entry): entry is HybridFailedEmbeddingEntry =>
        entry.recoveryKind === "failure",
    );
  }

  listDeferredEntries(): HybridDeferredEmbeddingEntry[] {
    return this.listEntries().filter(
      (entry): entry is HybridDeferredEmbeddingEntry =>
        entry.recoveryKind === "deferred_embedding",
    );
  }

  getEntry(path: string): HybridRecoveryEntry | null {
    const entry = this.recoveryEntries.get(path);
    if (!entry) {
      return null;
    }
    return { ...entry };
  }

  markRetryQueued(
    path: string,
    retryIntervalMs: number,
  ): HybridFailedEmbeddingEntry | null {
    const entry = this.recoveryEntries.get(path);
    if (
      !entry ||
      entry.recoveryKind !== "failure" ||
      !isAutoRetryHybridFailureKind(entry.errorKind)
    ) {
      return null;
    }
    entry.nextRetryAt = Date.now() + retryIntervalMs;
    this.onChanged();
    return { ...entry };
  }
  private classifyErrorKind(error: unknown): HybridEmbeddingFailureKind {
    return classifyHybridProviderFailure(error);
  }
}
