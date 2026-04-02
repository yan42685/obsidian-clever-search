import type { TFile } from "obsidian";
import { Database } from "src/services/database/database";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import {
  buildIndexRecoveryStateId,
  deriveDeferredIndexRecoveryState,
  deriveIndexRecoveryState,
  isAutoRetryHybridFailureKind,
  type HybridRepairMode,
  type IndexRecoveryStateRow,
} from "./index-recovery-state";
import type { HybridRecoveryEntry } from "./hybrid-embedding-recovery-manager";

type RestoreHybridRecoveryEntriesParams = {
  currFiles: ReadonlyMap<string, TFile>;
  previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>;
};

export class HybridRecoveryStateStore {
  private readonly database = getInstance(Database);

  async persistEntry(entry: HybridRecoveryEntry | null): Promise<void> {
    if (!entry) {
      return;
    }
    try {
      await this.database.putIndexRecoveryState(this.toRow(entry));
    } catch (error) {
      logger.warn(
        `failed to persist hybrid recovery state for ${entry.path}:`,
        error,
      );
    }
  }

  async persistEntries(entries: readonly HybridRecoveryEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      await this.database.bulkPutIndexRecoveryStates(
        entries.map((entry) => this.toRow(entry)),
      );
    } catch (error) {
      logger.warn("failed to bulk persist hybrid recovery state:", error);
    }
  }

  async deleteEntry(path: string): Promise<void> {
    try {
      await this.database.deleteIndexRecoveryState("hybrid", path);
    } catch (error) {
      logger.warn(`failed to delete hybrid recovery state for ${path}:`, error);
    }
  }

  async moveEntry(oldPath: string, newPath: string): Promise<void> {
    try {
      await this.database.moveIndexRecoveryState("hybrid", oldPath, newPath);
    } catch (error) {
      logger.warn(
        `failed to move hybrid recovery state from ${oldPath} to ${newPath}:`,
        error,
      );
    }
  }

  async restoreEntries(
    params: RestoreHybridRecoveryEntriesParams,
  ): Promise<HybridRecoveryEntry[]> {
    const { currFiles, previousIndexedFileRefs } = params;
    let rows: IndexRecoveryStateRow[] = [];
    try {
      rows = await this.database.getIndexRecoveryStates("hybrid");
    } catch (error) {
      logger.warn("failed to load persisted hybrid recovery state:", error);
      return [];
    }

    const activeEntries: HybridRecoveryEntry[] = [];
    for (const row of rows) {
      if (!this.shouldKeepPersistedRow(row, currFiles, previousIndexedFileRefs)) {
        await this.deleteEntry(row.path);
        continue;
      }

      const entry = this.fromRow(row);
      if (!entry) {
        await this.deleteEntry(row.path);
        continue;
      }
      activeEntries.push(entry);
    }

    return activeEntries;
  }

  private toRow(entry: HybridRecoveryEntry): IndexRecoveryStateRow {
    if (entry.recoveryKind === "deferred_embedding") {
      return {
        id: buildIndexRecoveryStateId("hybrid", entry.path),
        engine: "hybrid",
        path: entry.path,
        targetGeneration: entry.targetGeneration,
        mode: entry.mode,
        recoveryKind: "deferred_embedding",
        state: deriveDeferredIndexRecoveryState(entry.nextRetryAt),
        failureKind: null,
        failureMessage: null,
        attemptCount: 0,
        lastFailedAt: null,
        nextRetryAt: entry.nextRetryAt,
        isBlocking: false,
      };
    }

    return {
      id: buildIndexRecoveryStateId("hybrid", entry.path),
      engine: "hybrid",
      path: entry.path,
      targetGeneration: entry.targetGeneration,
      mode: entry.mode,
      recoveryKind: "failure",
      state: deriveIndexRecoveryState(entry.errorKind, entry.nextRetryAt),
      failureKind: entry.errorKind,
      failureMessage: entry.reason,
      attemptCount: entry.attemptCount,
      lastFailedAt: entry.lastFailedAt,
      nextRetryAt: entry.nextRetryAt,
      isBlocking: !isAutoRetryHybridFailureKind(entry.errorKind),
    };
  }

  private fromRow(row: IndexRecoveryStateRow): HybridRecoveryEntry | null {
    if (
      row.recoveryKind !== "failure" &&
      row.recoveryKind !== "deferred_embedding"
    ) {
      return null;
    }

    const mode: HybridRepairMode = row.mode === "full" ? "full" : "incremental";
    const recoveryKind =
      row.recoveryKind === "deferred_embedding"
        ? "deferred_embedding"
        : "failure";

    if (recoveryKind === "deferred_embedding") {
      return {
        path: row.path,
        targetGeneration: row.targetGeneration,
        mode,
        recoveryKind: "deferred_embedding",
        errorKind: null,
        reason: "deferred_embedding",
        lastFailedAt: null,
        nextRetryAt: row.nextRetryAt,
        attemptCount: 0,
      };
    }

    if (!row.failureKind) {
      return null;
    }

    return {
      path: row.path,
      targetGeneration: row.targetGeneration,
      mode,
      recoveryKind: "failure",
      errorKind: row.failureKind,
      reason: row.failureMessage ?? "Recovered persisted hybrid failure state",
      lastFailedAt: row.lastFailedAt ?? row.targetGeneration,
      nextRetryAt: row.nextRetryAt,
      attemptCount: Math.max(1, row.attemptCount),
    };
  }

  private shouldKeepPersistedRow(
    row: IndexRecoveryStateRow,
    currFiles: ReadonlyMap<string, TFile>,
    previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>,
  ): boolean {
    if (!Number.isFinite(row.targetGeneration) || row.targetGeneration <= 0) {
      return false;
    }

    const file = currFiles.get(row.path);
    if (!file) {
      return false;
    }

    const previousIndexedFileRef = previousIndexedFileRefs.get(row.path);
    if (!previousIndexedFileRef) {
      return file.stat.mtime <= row.targetGeneration;
    }

    if (previousIndexedFileRef.generation > row.targetGeneration) {
      return false;
    }

    if (
      previousIndexedFileRef.generation === row.targetGeneration &&
      previousIndexedFileRef.state === "ready"
    ) {
      return false;
    }

    return file.stat.mtime <= row.targetGeneration;
  }
}
