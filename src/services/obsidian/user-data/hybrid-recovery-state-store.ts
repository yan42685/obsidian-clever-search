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
  type HybridEmbeddingFailureKind,
  type HybridRepairMode,
  type IndexRecoveryStateRow,
} from "./index-recovery-state";
import type { HybridRecoveryEntry } from "./hybrid-embedding-recovery-manager";

type LegacyHybridIndexedFileRef = HybridIndexedFileRef & {
  lastErrorKind?: string | null;
  embeddingDeferred?: boolean;
};

type RestoreHybridRecoveryEntriesParams = {
  currFiles: ReadonlyMap<string, TFile>;
  previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>;
  minIncrementalEmbedIntervalMs: number;
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
    const {
      currFiles,
      previousIndexedFileRefs,
      minIncrementalEmbedIntervalMs,
    } = params;
    let rows: IndexRecoveryStateRow[] = [];
    try {
      rows = await this.database.getIndexRecoveryStates("hybrid");
    } catch (error) {
      logger.warn("failed to load persisted hybrid recovery state:", error);
      return [];
    }

    const activeEntries: HybridRecoveryEntry[] = [];
    const activePaths = new Set<string>();
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
      activePaths.add(row.path);
    }

    const legacyBackfill = this.collectLegacyBackfill({
      currFiles,
      previousIndexedFileRefs,
      activePaths,
      minIncrementalEmbedIntervalMs,
    });
    let canStripLegacyFields = legacyBackfill.rows.length === 0;
    if (legacyBackfill.rows.length > 0) {
      try {
        await this.database.bulkPutIndexRecoveryStates(legacyBackfill.rows);
        canStripLegacyFields = true;
        for (const row of legacyBackfill.rows) {
          const entry = this.fromRow(row);
          if (entry) {
            activeEntries.push(entry);
          }
        }
      } catch (error) {
        logger.warn("failed to backfill legacy hybrid recovery state:", error);
      }
    }

    if (canStripLegacyFields) {
      await this.stripLegacyFields(legacyBackfill.cleanedRefs);
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

  private hasLegacyFields(indexedFileRef: HybridIndexedFileRef): boolean {
    const legacyRef = indexedFileRef as LegacyHybridIndexedFileRef;
    return (
      Object.prototype.hasOwnProperty.call(legacyRef, "lastErrorKind") ||
      Object.prototype.hasOwnProperty.call(legacyRef, "embeddingDeferred")
    );
  }

  private stripLegacyFieldsFromRef(
    indexedFileRef: HybridIndexedFileRef,
  ): HybridIndexedFileRef {
    const {
      lastErrorKind: _lastErrorKind,
      embeddingDeferred: _embeddingDeferred,
      ...cleaned
    } = indexedFileRef as LegacyHybridIndexedFileRef;
    return cleaned;
  }

  private async stripLegacyFields(
    refs: readonly HybridIndexedFileRef[],
  ): Promise<void> {
    if (refs.length === 0) {
      return;
    }
    try {
      await this.database.db.hybridIndexedFileRefs.bulkPut(refs);
    } catch (error) {
      logger.warn("failed to strip legacy hybrid recovery fields:", error);
    }
  }

  private inferLegacyMode(indexedFileRef: HybridIndexedFileRef): HybridRepairMode {
    if (indexedFileRef.state === "failed" || (indexedFileRef.chunkCount ?? 0) <= 0) {
      return "full";
    }
    return "incremental";
  }

  private normalizeLegacyFailureKind(
    kind: string | null | undefined,
  ): HybridEmbeddingFailureKind {
    switch (kind) {
      case "missing_api_key":
      case "weekly_token_limit":
      case "quota_exhausted":
      case "auth_401":
      case "auth_403":
      case "provider_429":
      case "timeout":
      case "provider_5xx":
      case "network":
      case "unknown":
        return kind;
      default:
        return "unknown";
    }
  }

  private buildLegacyStateRow(
    path: string,
    indexedFileRef: HybridIndexedFileRef,
    now: number,
    minIncrementalEmbedIntervalMs: number,
  ): IndexRecoveryStateRow | null {
    const legacyRef = indexedFileRef as LegacyHybridIndexedFileRef;
    if (legacyRef.embeddingDeferred === true) {
      const nextRetryAt =
        (indexedFileRef.lastIncrementalEmbedAt ?? 0) > 0
          ? (indexedFileRef.lastIncrementalEmbedAt ?? 0) +
            minIncrementalEmbedIntervalMs
          : now;
      return {
        id: buildIndexRecoveryStateId("hybrid", path),
        engine: "hybrid",
        path,
        targetGeneration: indexedFileRef.generation,
        mode: this.inferLegacyMode(indexedFileRef),
        recoveryKind: "deferred_embedding",
        state: deriveDeferredIndexRecoveryState(nextRetryAt, now),
        failureKind: null,
        failureMessage: null,
        attemptCount: 0,
        lastFailedAt: null,
        nextRetryAt,
        isBlocking: false,
      };
    }

    if (indexedFileRef.state !== "bm25_only" && indexedFileRef.state !== "failed") {
      return null;
    }

    const failureKind = this.normalizeLegacyFailureKind(legacyRef.lastErrorKind);
    const nextRetryAt = isAutoRetryHybridFailureKind(failureKind) ? now : null;
    return {
      id: buildIndexRecoveryStateId("hybrid", path),
      engine: "hybrid",
      path,
      targetGeneration: indexedFileRef.generation,
      mode: this.inferLegacyMode(indexedFileRef),
      recoveryKind: "failure",
      state: deriveIndexRecoveryState(failureKind, nextRetryAt, now),
      failureKind,
      failureMessage:
        indexedFileRef.state === "failed"
          ? "Recovered legacy hybrid failed state"
          : "Recovered legacy hybrid bm25_only state",
      attemptCount: 1,
      lastFailedAt: indexedFileRef.indexedAt ?? indexedFileRef.generation,
      nextRetryAt,
      isBlocking: !isAutoRetryHybridFailureKind(failureKind),
    };
  }

  private collectLegacyBackfill(params: {
    currFiles: ReadonlyMap<string, TFile>;
    previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>;
    activePaths: Set<string>;
    minIncrementalEmbedIntervalMs: number;
  }): {
    rows: IndexRecoveryStateRow[];
    cleanedRefs: HybridIndexedFileRef[];
  } {
    const {
      currFiles,
      previousIndexedFileRefs,
      activePaths,
      minIncrementalEmbedIntervalMs,
    } = params;
    const now = Date.now();
    const rows: IndexRecoveryStateRow[] = [];
    const cleanedRefs: HybridIndexedFileRef[] = [];

    for (const [path, indexedFileRef] of previousIndexedFileRefs) {
      if (this.hasLegacyFields(indexedFileRef)) {
        cleanedRefs.push(this.stripLegacyFieldsFromRef(indexedFileRef));
      }
      if (activePaths.has(path)) {
        continue;
      }
      const row = this.buildLegacyStateRow(
        path,
        indexedFileRef,
        now,
        minIncrementalEmbedIntervalMs,
      );
      if (!row) {
        continue;
      }
      if (!this.shouldKeepPersistedRow(row, currFiles, previousIndexedFileRefs)) {
        continue;
      }
      rows.push(row);
      activePaths.add(path);
    }

    return { rows, cleanedRefs };
  }
}