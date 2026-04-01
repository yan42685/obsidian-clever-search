import { Notice, TFile, type TAbstractFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import type CleverSearch from "src/main";
import { Database } from "src/services/database/database";
import {
  HybridDisabledError,
  NoApiKeyError,
  WeeklyTokenLimitExceededError,
} from "src/services/search/hybrid/embedder";
import {
  beginHybridProfile,
  endHybridProfile,
  getHybridProfileMetric,
  profileHybridStage,
  setHybridProfileMeta,
} from "src/services/search/hybrid/hybrid-profiler";
import type {
  ChunkRow,
  ChunkVectorShardRow,
  HybridIndexedFileRef,
} from "src/services/search/hybrid/hybrid-store";
import {
  analyzeHybridStoredFileConsistency,
  normalizeHybridIndexedFileState,
  type HybridStoredVectorInfo,
} from "src/services/search/hybrid/hybrid-consistency";
import {
  retryAsync,
  runWeightedTasks,
} from "src/services/search/hybrid/runtime-control";
import type { VectorPrecision } from "src/services/search/hybrid/hybrid-types";
import { BM25Engine } from "src/services/search/hybrid/bm25";
import { LexicalEngine } from "src/services/search/lexical-engine";
import type { SerializedFileSearchIndex } from "src/services/search/file-search-engine";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { eventBus } from "src/utils/event-bus";
import { FileUtil } from "src/utils/file-util";
import { logger } from "src/utils/logger";
import {
  getInstance,
  isDevEnvironment,
  monitorDecorator,
  MyLib,
} from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { MyNotice } from "../transformed-api";
import { t, type LocaleKey } from "../translations/locale-helper";
import { SearchService } from "../search-service";
import { DataProvider, type IndexedDocumentFailure } from "./data-provider";
import {
  type DocOperation,
  type ReducedDocOperationBatch,
  DocOperationBuffer,
} from "./doc-operation-buffer";
import { FileWatcher } from "./file-watcher";
import type { HybridRepairMode } from "./index-recovery-state";
import { buildIndexArtifactStateId } from "./index-artifact-state";
import { DirtyArtifactCoordinator } from "./dirty-artifact-coordinator";
import { HybridRecoveryCoordinator } from "./hybrid-recovery-coordinator";
import type { HybridFailedEmbeddingSummary } from "./hybrid-embedding-recovery-manager";

type HybridIndexFailure = {
  path: string;
  reason: string;
  attempts: number;
  bm25FallbackIndexed: boolean;
};

type LexicalIndexFailure = IndexedDocumentFailure;

type LexicalAddDocumentsResult = {
  indexedFiles: TFile[];
  failures: LexicalIndexFailure[];
};

type HybridPreflightReport = {
  totalBytes: number;
  filesToAdd: number;
  filesToDelete: number;
  largeFiles: TFile[];
  largestFile: TFile | null;
  sharedSnapshotBytes: number;
  estimatedHybridBytes: number;
  currentHybridBytes: number;
  projectedUsageRatio: number | null;
};

type HybridStorageRepairReport = {
  repairedPaths: string[];
  reindexedPaths: string[];
  previousIndexedFileRefs: Map<string, HybridIndexedFileRef>;
};

type HybridStoredPathSummary = {
  chunkCount: number;
  snapshotGeneration?: number;
  vectorInfo?: HybridStoredVectorInfo;
  indexedFileRef?: HybridIndexedFileRef;
};

type HybridSearchAvailability = "blocked" | "available";
export type SearchBootstrapState =
  | "blocked"
  | "restoring"
  | "healing"
  | "searchable"
  | "failed";

type SearchBootstrapPhase = "restore" | "heal";
type SearchBootstrapComponent = "lexical" | "hybrid";

type SearchBootstrapComponentMetrics = {
  restoreStartedAt: number | null;
  restoreCompletedAt: number | null;
  healStartedAt: number | null;
  healCompletedAt: number | null;
  restoreMs: number | null;
  healMs: number | null;
};

type DevStorageSummaryRow = {
  category: string;
  rows: number | string;
  bytes: number;
  size: string;
};

type DevStorageBreakdownRow = {
  segment: string;
  bytes: number;
  size: string;
  shareOfLexical: string;
  shareOfVault: string;
};

type JsHeapUsageSample = {
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
};

type LexicalHeapDeltaSummary = {
  beforeUsedBytes: number;
  afterUsedBytes: number;
  deltaBytes: number;
  totalBytes: number;
  limitBytes: number;
};

export type SearchBootstrapMetrics = {
  startedAt: number;
  searchableAt: number | null;
  commitStartedAt: number | null;
  commitCompletedAt: number | null;
  searchableMs: number | null;
  commitMs: number | null;
  commitPending: boolean;
  commitFailed: boolean;
  lexical: SearchBootstrapComponentMetrics;
  hybrid: SearchBootstrapComponentMetrics;
};

type LexicalBootstrapPlan = {
  needsFullReindex: boolean;
  needsRefHeal: boolean;
};

type HybridBootstrapPlan = {
  currFiles: Map<string, TFile>;
  repairReport: HybridStorageRepairReport;
  docsToAdd: TFile[];
  docsToDelete: string[];
};

export type HybridDeferredEmbeddingSummary = {
  deferredCount: number;
  nextEligibleAt: number | null;
  totalFiles: number;
};

type HybridRepairTask = {
  path: string;
  mode: HybridRepairMode;
  reason: string;
  eligibleAt: number;
  enqueuedAt: number;
  sourceGeneration?: number;
};

type HybridRefreshOptions = {
  forceRefresh?: boolean;
  syncFileSetWithoutEmbedding?: boolean;
  rebuildBm25FromStore?: boolean;
};

type HybridIndexProgress = {
  stage: "repair" | "index" | "done";
  totalBytes: number;
  totalFiles: number;
  processedBytes: number;
  processedFiles: number;
  repairedPaths: number;
  failedFiles: number;
  sessionTokens: number;
};

class HybridIndexProgressNotice {
  private readonly notice: MyNotice;
  private lastRenderAt = 0;

  constructor() {
    this.notice = new MyNotice("Hybrid indexing...", 0);
  }

  update(progress: HybridIndexProgress, force = false) {
    const now = Date.now();
    if (!force && now - this.lastRenderAt < 400) {
      return;
    }
    this.lastRenderAt = now;
    this.notice.setText(this.buildMessage(progress));
  }

  hide() {
    this.notice.hide();
  }

  private buildMessage(progress: HybridIndexProgress): string {
    if (progress.stage === "repair") {
      return `Hybrid self-healing: repaired ${progress.repairedPaths} file state(s). Preparing reindex... ${this.buildTokenLabel(progress.sessionTokens)}`;
    }
    if (progress.stage === "done") {
      if (progress.totalFiles === 0) {
        return `Hybrid self-healing finished: repaired ${progress.repairedPaths} file state(s), failed ${progress.failedFiles}. ${this.buildTokenLabel(progress.sessionTokens)}`;
      }
      return `Hybrid indexing finished: ${formatBytesLabel(progress.processedBytes)} / ${formatBytesLabel(progress.totalBytes)} (${progress.processedFiles}/${progress.totalFiles} files), repaired ${progress.repairedPaths}, failed ${progress.failedFiles}. ${this.buildTokenLabel(progress.sessionTokens)}`;
    }
    return `Hybrid indexing: ${formatBytesLabel(progress.processedBytes)} / ${formatBytesLabel(progress.totalBytes)} (${progress.processedFiles}/${progress.totalFiles} files), repaired ${progress.repairedPaths}, failed ${progress.failedFiles}. ${this.buildTokenLabel(progress.sessionTokens)}`;
  }

  private buildTokenLabel(tokens: number): string {
    return `Session tokens ${tokens}`;
  }
}

function formatBytesLabel(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

@singleton()
export class DataManager {
  private static readonly HYBRID_INDEX_MAX_RETRIES = 3;
  private static readonly HYBRID_INDEX_RETRY_DELAY_MS = 1500;
  private static readonly HYBRID_TABLE_SCAN_BATCH_SIZE = 512;
  private static readonly LEXICAL_REINDEX_BATCH_SIZE = 64;
  private static readonly HYBRID_LARGE_FILE_BYTES = 1024 * 1024;
  private static readonly HYBRID_PRECHECK_NOTICE_BYTES = 64 * 1024 * 1024;
  private static readonly HYBRID_QUOTA_WARN_RATIO = 0.7;
  private static readonly HYBRID_STORAGE_RATIO_FALLBACK = 1.6;
  private static readonly HYBRID_STORAGE_RATIO_MIN = 0.8;
  private static readonly HYBRID_STORAGE_RATIO_MAX = 4.0;
  private static readonly HYBRID_IN_FLIGHT_BYTES_BUDGET = 4 * 1024 * 1024;
  private static readonly HYBRID_BM25_REBUILD_BATCH_SIZE = 512;
  private static readonly LEXICAL_SNAPSHOT_FLUSH_DEBOUNCE_MS = 10_000;
  private static readonly LEXICAL_SNAPSHOT_FLUSH_MAX_AGE_MS = 60_000;
  private static readonly LEXICAL_SNAPSHOT_FLUSH_PATH_THRESHOLD = 24;
  private static readonly LEXICAL_SNAPSHOT_FLUSH_BYTES_THRESHOLD = 768 * 1024;
  private plugin: CleverSearch = getInstance(THIS_PLUGIN);
  private database = getInstance(Database);
  private dataProvider = getInstance(DataProvider);
  private setting = getInstance(OuterSetting);
  private lexicalEngine = getInstance(LexicalEngine);
  private fileSnapshotStore = getInstance(FileSnapshotStore);
  private shouldForceRefresh = false;
  private isLexicalEngineUpToDate = false;
  private lexicalIndexedFileRefsLoaded = false;
  private lexicalIndexedFileRefsByPath = new Map<string, BaseIndexedFileRef>();
  private readonly lexicalSnapshotCoordinator = new DirtyArtifactCoordinator({
    engine: "lexical",
    artifact: "snapshot",
    reason: "runtime-lexical-dirty",
    markerId: buildIndexArtifactStateId("lexical", "snapshot"),
    stateTable: this.database.db.indexArtifactState,
    supportsDirtyTracking: () => this.lexicalEngine.supportsSerializedFileIndex(),
    estimatePathBytes: (path) =>
      Math.max(0, this.dataProvider.getFileByPath(path)?.stat.size ?? 0),
    persistArtifact: async () => await this.writeLexicalSearchSnapshotArtifact(),
    debounceMs: DataManager.LEXICAL_SNAPSHOT_FLUSH_DEBOUNCE_MS,
    maxAgeMs: DataManager.LEXICAL_SNAPSHOT_FLUSH_MAX_AGE_MS,
    pathThreshold: DataManager.LEXICAL_SNAPSHOT_FLUSH_PATH_THRESHOLD,
    bytesThreshold: DataManager.LEXICAL_SNAPSHOT_FLUSH_BYTES_THRESHOLD,
  });
  private hybridSearchAvailability: HybridSearchAvailability = "blocked";
  private lexicalBootstrapState: SearchBootstrapState = "blocked";
  private hybridBootstrapState: SearchBootstrapState = "blocked";
  private searchBootstrapMetrics: SearchBootstrapMetrics | null = null;
  private searchBootstrapCommitTask: Promise<void> | null = null;
  private readonly hybridRepairQueue = new Map<string, HybridRepairTask>();
  private hybridRepairFlushTimer: NodeJS.Timeout | null = null;
  private hybridRepairWorker: Promise<void> | null = null;
  private lexicalIndexFailureNotice: Notice | null = null;
  private lexicalFailureRetryInFlight = false;
  private readonly lexicalIndexFailuresByPath = new Map<
    string,
    LexicalIndexFailure
  >();
  private latestLexicalHeapDelta: LexicalHeapDeltaSummary | null = null;
  private readonly hybridRecoveryCoordinator = new HybridRecoveryCoordinator({
    canRetryPath: (path) => this.canRetryHybridEmbeddingPath(path),
    enqueueRepair: (task) => this.enqueueHybridRepair(task),
    onChanged: () => this.notifyHybridRuntimeStatusChanged(),
    getFailedEmbeddingRetryIntervalMs: () =>
      this.getFailedEmbeddingRetryIntervalMs(),
    getMinIncrementalEmbedIntervalMs: () =>
      this.getMinIncrementalEmbedIntervalMs(),
  });

  private get hybridEngine() {
    return getInstance(SearchService).hybridEngine;
  }

  hasHybridFailedEmbeddings(): boolean {
    return this.hybridRecoveryCoordinator.hasFailures();
  }

  getHybridFailedEmbeddingSummary(): HybridFailedEmbeddingSummary {
    return this.hybridRecoveryCoordinator.getFailureSummary(
      this.countHybridTrackedFiles(),
    );
  }

  async getHybridDeferredEmbeddingSummary(): Promise<HybridDeferredEmbeddingSummary> {
    const totalFiles = this.countHybridTrackedFiles();
    if (!this.hybridEngine.isEnabled()) {
      return {
        deferredCount: 0,
        nextEligibleAt: null,
        totalFiles,
      };
    }

    return this.hybridRecoveryCoordinator.getDeferredSummary(totalFiles);
  }

  private countHybridTrackedFiles(): number {
    if (!this.hybridEngine.isEnabled()) {
      return 0;
    }
    return this.plugin.app.vault
      .getFiles()
      .filter(
        (file) =>
          this.dataProvider.isIndexable(file) &&
          this.hybridEngine.shouldIndexPath(file.path),
      ).length;
  }

  private resetLexicalSnapshotTracking(): void {
    this.lexicalSnapshotCoordinator.reset();
  }

  private async hasLexicalSnapshotDirtyMarker(): Promise<boolean> {
    return await this.lexicalSnapshotCoordinator.hasPersistedDirtyMarker();
  }

  private async markLexicalSnapshotDirty(
    paths: readonly string[] = [],
  ): Promise<void> {
    await this.lexicalSnapshotCoordinator.markDirty(paths);
  }

  private clearLexicalSnapshotFlushTimer(): void {
    this.lexicalSnapshotCoordinator.dispose();
  }

  private async flushLexicalSnapshotIfDirty(force = false): Promise<void> {
    await this.lexicalSnapshotCoordinator.flushIfDirty(force);
  }

  private async restorePersistedHybridRecoveryState(
    currFiles: ReadonlyMap<string, TFile>,
    previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>,
  ): Promise<void> {
    await this.hybridRecoveryCoordinator.restorePersistedState({
      currFiles,
      previousIndexedFileRefs,
    });
  }

  async retryFailedEmbeddingsOnConfigChange(
    reason = "config-changed",
  ): Promise<void> {
    await this.hybridRecoveryCoordinator.retryFailuresOnConfigChange(reason);
  }

  refreshFailedEmbeddingRetrySchedule(): void {
    this.hybridRecoveryCoordinator.refreshRetrySchedule();
  }
  private docOperationsHandler = async (
    operations: ReducedDocOperationBatch,
  ) => {
    const consumedStalePaths = new Set<string>();
    // Apply surviving dirty paths first so rename fast-paths can reuse old-path data
    // before the stale cleanup pass removes it.
    for (const op of operations.dirtyPaths) {
      if (op.renameFromPath) {
        await this.handleMoveOperation(
          op.renameFromPath,
          op.path,
          op.requiresReindex,
          op.sourceGeneration,
        );
        consumedStalePaths.add(op.renameFromPath);
        continue;
      }

      await this.handleUpsertOperation(op.path, op.sourceGeneration);
    }

    for (const op of operations.stalePaths) {
      if (consumedStalePaths.has(op.path)) {
        continue;
      }
      await this.handleDeleteOperation(op.path);
    }
  };

  private docOperationsBuffer = new DocOperationBuffer(
    this.docOperationsHandler,
    3,
  );

  @monitorDecorator
  async initAsync() {
    this.clearHybridFailedEmbeddingState();
    this.resetLexicalSnapshotTracking();
    this.fileSnapshotStore.clearCurrentFiles();
    this.lexicalIndexedFileRefsLoaded = false;
    this.lexicalIndexedFileRefsByPath.clear();
    this.setHybridSearchAvailability("blocked");
    this.beginSearchBootstrapRun();
    try {
      await this.runSearchBootstrapPipeline();
      this.kickOffSearchBootstrapCommit();
    } catch (error) {
      this.setLexicalBootstrapState("failed");
      if (this.hybridEngine.isEnabled()) {
        this.setHybridBootstrapState("failed");
      }
      this.failSearchBootstrapRun();
      throw error;
    }
  }

  onunload() {
    getInstance(FileWatcher).stop();
    void this.flushLexicalSnapshotIfDirty(true);
    this.clearLexicalSnapshotFlushTimer();
    this.clearHybridRepairScheduler();
    this.clearHybridFailedEmbeddingState();
    this.hideLexicalIndexFailureNotice();
    this.lexicalIndexFailuresByPath.clear();
    this.searchBootstrapCommitTask = null;
    this.setLexicalBootstrapState("blocked");
    this.setHybridBootstrapState("blocked");
  }

  receiveDocOperation(operation: DocOperation) {
    this.docOperationsBuffer.add(operation);
  }

  private async runSearchBootstrapPipeline(): Promise<void> {
    await this.database.deleteOldDatabases();
    this.setLexicalBootstrapState("restoring");
    this.markSearchBootstrapPhaseStarted("lexical", "restore");
    const lexicalPlan = await this.prepareLexicalBootstrapPlan();
    this.markSearchBootstrapPhaseCompleted("lexical", "restore");

    if (!this.hybridEngine.isEnabled()) {
      this.setHybridBootstrapState("blocked");
      await this.hybridEngine.migrateBm25StorageFormatIfNeeded().catch((e) => {
        logger.warn("hybrid BM25 storage migration failed:", e);
      });
    } else {
      this.setHybridBootstrapState("restoring");
      this.markSearchBootstrapPhaseStarted("hybrid", "restore");
    }
    const hybridPlan = await this.prepareHybridBootstrapPlan();
    if (hybridPlan) {
      this.markSearchBootstrapPhaseCompleted("hybrid", "restore");
    }

    this.setLexicalBootstrapState("healing");
    const heapBeforeLexicalRefresh = isDevEnvironment
      ? this.sampleJsHeapUsage()
      : null;
    this.latestLexicalHeapDelta = null;
    this.markSearchBootstrapPhaseStarted("lexical", "heal");
    await this.healLexicalBootstrapPlan(lexicalPlan);
    this.markSearchBootstrapPhaseCompleted("lexical", "heal");
    this.setLexicalBootstrapState("searchable");
    this.markSearchBootstrapSearchable();

    if (!hybridPlan) {
      return;
    }

    this.setHybridBootstrapState("healing");
    this.markSearchBootstrapPhaseStarted("hybrid", "heal");
    await this.healHybridBootstrapPlan(hybridPlan).catch((e) => {
      logger.warn("hybrid engine init failed:", e);
      this.setHybridBootstrapState("failed");
      new MyNotice(t("hybridNotice.indexFallbackToBm25"), 7000);
    });
    if (this.hybridBootstrapState === "healing") {
      this.markSearchBootstrapPhaseCompleted("hybrid", "heal");
      this.setHybridBootstrapState("searchable");
    }
  }

  async refreshAllAsync() {
    const prevNotice = new MyNotice(t("Reindexing..."));
    this.shouldForceRefresh = true;
    this.clearHybridFailedEmbeddingState();
    this.setHybridSearchAvailability("blocked");
    getInstance(FileWatcher).stop();
    try {
      await this.initAsync();
      new MyNotice(t("Indexing finished"), 5000);
    } finally {
      prevNotice.hide();
      this.shouldForceRefresh = false;
      getInstance(FileWatcher).start();
    }
  }

  async refreshLexicalStateAsync() {
    const prevNotice = new MyNotice(t("Reindexing..."));
    this.setLexicalBootstrapState("healing");
    const heapBeforeLexicalRefresh = isDevEnvironment
      ? this.sampleJsHeapUsage()
      : null;
    this.latestLexicalHeapDelta = null;
    getInstance(FileWatcher).stop();
    try {
      await this.reindexLexicalEngineWithCurrFiles();
      await this.persistLexicalSearchSnapshotIfAvailable();
      if (isDevEnvironment) {
        await MyLib.sleep(0);
        this.latestLexicalHeapDelta = this.summarizeLexicalHeapDelta(
          heapBeforeLexicalRefresh,
          this.sampleJsHeapUsage(),
        );
        await this.noticeDevStorageStats();
      }
      await this.fileSnapshotStore.refreshHighPerformanceState(
        this.dataProvider.allFilesToBeIndexed(),
      );
      new MyNotice(t("Indexing finished"), 5000);
      this.setLexicalBootstrapState("searchable");
    } catch (error) {
      this.setLexicalBootstrapState("failed");
      throw error;
    } finally {
      prevNotice.hide();
      getInstance(FileWatcher).start();
    }
  }

  async refreshHybridStateAsync(options: HybridRefreshOptions = {}) {
    this.clearHybridFailedEmbeddingState();
    this.setHybridSearchAvailability("blocked");
    const previousForceRefresh = this.shouldForceRefresh;
    getInstance(FileWatcher).stop();
    try {
      if (options.forceRefresh) {
        this.shouldForceRefresh = true;
        await this.initHybridEngine().catch((e) => {
          logger.warn("hybrid engine init failed:", e);
          new MyNotice(t("hybridNotice.indexFallbackToBm25"), 7000);
        });
      } else if (
        options.syncFileSetWithoutEmbedding ||
        options.rebuildBm25FromStore
      ) {
        await this.refreshHybridStateLocally({
          syncFileSetWithoutEmbedding:
            options.syncFileSetWithoutEmbedding ?? false,
          rebuildBm25FromStore: options.rebuildBm25FromStore ?? false,
        });
      } else {
        await this.initHybridEngine().catch((e) => {
          logger.warn("hybrid engine init failed:", e);
          new MyNotice(t("hybridNotice.indexFallbackToBm25"), 7000);
        });
      }
    } finally {
      await this.fileSnapshotStore.refreshHighPerformanceState(
        this.dataProvider.allFilesToBeIndexed(),
      );
      this.shouldForceRefresh = previousForceRefresh;
      this.notifyHybridRuntimeStatusChanged();
      getInstance(FileWatcher).start();
    }
  }

  private async refreshHybridStateLocally(options: {
    syncFileSetWithoutEmbedding: boolean;
    rebuildBm25FromStore: boolean;
  }): Promise<void> {
    if (!this.hybridEngine.isEnabled()) {
      this.setHybridSearchAvailability("blocked");
      return;
    }

    await this.hybridEngine.load();
    const failures: HybridIndexFailure[] = [];

    if (options.syncFileSetWithoutEmbedding) {
      const currFiles = new Map<string, TFile>(
        this.dataProvider
          .allFilesToBeIndexed()
          .filter((file) => this.hybridEngine.shouldIndexPath(file.path))
          .map((file) => [file.path, file]),
      );
      const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>(
        (await this.database.db.hybridIndexedFileRefs.toArray()).map((ref) => [
          ref.path,
          ref,
        ]),
      );
      const docsToAdd: TFile[] = [];
      const docsToDelete: string[] = [];

      for (const [path, file] of currFiles) {
        const previousIndexedFileRef = previousIndexedFileRefs.get(path);
        if (!previousIndexedFileRef) {
          docsToAdd.push(file);
        } else if (file.stat.mtime > previousIndexedFileRef.generation) {
          docsToDelete.push(path);
          docsToAdd.push(file);
        }
      }
      for (const prevPath of previousIndexedFileRefs.keys()) {
        if (!currFiles.has(prevPath)) {
          docsToDelete.push(prevPath);
        }
      }

      logger.trace(
        `hybrid local refresh docs to delete: ${docsToDelete.length}`,
      );
      logger.trace(`hybrid local refresh docs to add: ${docsToAdd.length}`);

      for (const path of docsToDelete) {
        this.cancelHybridRepair(path);
        await this.clearFailedHybridEmbedding(path);
        await this.hybridEngine
          .deleteFile(path, {
            persistIndices: false,
          })
          .catch((error) =>
            logger.warn(
              `hybrid local refresh delete failed for ${path}:`,
              error,
            ),
          );
      }

      for (const file of docsToAdd) {
        this.cancelHybridRepair(file.path);
        await this.clearFailedHybridEmbedding(file.path);
        const failure = await this.indexHybridFileStructureOnly(file);
        if (failure) {
          failures.push(failure);
        }
      }

      await this.hybridEngine.persistIndicesForBatch();
    }

    if (options.rebuildBm25FromStore) {
      await this.hybridEngine.rebuildBm25FromStore();
    }

    if (failures.length > 0) {
      this.noticeHybridIndexFailures(failures);
    }
    this.setHybridSearchAvailability(
      this.hybridEngine.canServeQuery() ? "available" : "blocked",
    );
  }

  private async addDocuments(
    files: TAbstractFile[],
  ): Promise<LexicalAddDocumentsResult> {
    if (files.length === 0) {
      return {
        indexedFiles: [],
        failures: [],
      };
    }

    const tFiles: TFile[] = [];
    for (const f of files) {
      if (f instanceof TFile) tFiles.push(f);
    }
    const { documents, indexedFiles, failures } =
      await this.dataProvider.generateAllIndexedDocuments(
        tFiles.filter((f) => this.dataProvider.isIndexable(f)),
      );
    if (documents.length > 0) {
      await this.lexicalEngine.addDocuments(documents);
    }
    return {
      indexedFiles,
      failures,
    };
  }

  private async deleteDocuments(paths: string[]) {
    if (paths.length > 0) {
      const indexablePaths = paths.filter((p) =>
        this.dataProvider.isIndexable(p),
      );
      this.lexicalEngine.deleteDocuments(indexablePaths);
    }
  }

  private async commitLexicalFileState(
    file: TFile,
    generation = file.stat.mtime,
  ): Promise<boolean> {
    const result = await this.addDocuments([file]);
    if (result.failures.length > 0) {
      this.addLexicalIndexFailures(result.failures);
      return false;
    }
    this.clearLexicalIndexFailures([file.path]);
    await this.fileSnapshotStore.commitCurrentFileAsIndexed(
      file.path,
      generation,
    );
    await this.upsertLexicalIndexedFileRef(file, generation);
    await this.markLexicalSnapshotDirty([file.path]);
    return true;
  }

  private async commitIndexedLexicalFiles(
    files: readonly TFile[],
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }
    await this.fileSnapshotStore.commitCurrentFilesAsIndexed(
      files.map((file) => ({
        path: file.path,
        generation: file.stat.mtime,
      })),
    );
    for (const file of files) {
      await this.upsertLexicalIndexedFileRef(file, file.stat.mtime);
    }
    await this.markLexicalSnapshotDirty(files.map((file) => file.path));
  }

  private async persistLexicalSearchSnapshotIfAvailable(): Promise<void> {
    await this.lexicalSnapshotCoordinator.persistCurrentArtifact();
  }

  private async writeLexicalSearchSnapshotArtifact(): Promise<void> {
    const lexicalIndexData = this.lexicalEngine.serializeFileIndex();
    if (lexicalIndexData) {
      await this.database.setLexicalSearchSnapshot(lexicalIndexData);
    } else {
      await this.database.deleteLexicalSearchSnapshot();
    }
  }

  private addLexicalIndexFailures(
    failures: readonly LexicalIndexFailure[],
  ): void {
    if (failures.length === 0) {
      return;
    }
    for (const failure of failures) {
      this.lexicalIndexFailuresByPath.set(failure.file.path, failure);
    }
    this.logLexicalIndexFailures(failures);
    this.renderLexicalIndexFailureNotice();
  }

  private clearLexicalIndexFailures(paths: readonly string[]): void {
    if (paths.length === 0 || this.lexicalIndexFailuresByPath.size === 0) {
      return;
    }
    for (const path of paths) {
      this.lexicalIndexFailuresByPath.delete(path);
    }
    this.renderLexicalIndexFailureNotice();
  }

  private logLexicalIndexFailures(
    failures: readonly LexicalIndexFailure[],
  ): void {
    console.groupCollapsed(
      `[clever-search] Lexical indexing skipped ${failures.length} file(s)`,
    );
    failures.forEach((failure) => {
      console.error(
        `[clever-search] ${failure.file.path}\nReason: ${this.formatLexicalIndexError(failure.error)}`,
        failure.error,
      );
    });
    console.groupEnd();
  }

  private formatLexicalIndexError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private renderLexicalIndexFailureNotice(): void {
    const failureCount = this.lexicalIndexFailuresByPath.size;
    if (failureCount === 0) {
      this.hideLexicalIndexFailureNotice();
      return;
    }
    if (
      !this.lexicalIndexFailureNotice ||
      !this.lexicalIndexFailureNotice.noticeEl.isConnected
    ) {
      this.lexicalIndexFailureNotice = new Notice("", 0);
    }

    const fragment = document.createDocumentFragment();
    const messageEl = document.createElement("div");
    messageEl.textContent = this.buildLexicalFailureNotice(failureCount);
    fragment.appendChild(messageEl);

    const actionRow = document.createElement("div");
    actionRow.style.marginTop = "0.5em";
    const retryButton = document.createElement("button");
    retryButton.textContent = this.lexicalFailureRetryInFlight
      ? `Retrying failures... (${failureCount})`
      : `Retry failures (${failureCount})`;
    retryButton.disabled = this.lexicalFailureRetryInFlight;
    retryButton.onclick = () => {
      void this.retryLexicalIndexFailures();
    };
    actionRow.appendChild(retryButton);
    fragment.appendChild(actionRow);

    const footerEl = document.createElement("div");
    footerEl.textContent = "(clever-search)";
    footerEl.style.marginTop = "0.35em";
    fragment.appendChild(footerEl);

    this.lexicalIndexFailureNotice.setMessage(fragment);
  }

  private hideLexicalIndexFailureNotice(): void {
    if (this.lexicalIndexFailureNotice) {
      this.lexicalIndexFailureNotice.hide();
      this.lexicalIndexFailureNotice = null;
    }
  }

  private buildLexicalFailureNotice(failureCount: number): string {
    return `${failureCount} file(s) were skipped during lexical indexing. Retry the remaining failures or open the console for details.`;
  }

  private async retryLexicalIndexFailures(): Promise<void> {
    if (
      this.lexicalFailureRetryInFlight ||
      this.lexicalIndexFailuresByPath.size === 0
    ) {
      return;
    }
    const failuresToRetry = Array.from(
      this.lexicalIndexFailuresByPath.values(),
    );
    const attemptedPaths = new Set(
      failuresToRetry.map((failure) => failure.file.path),
    );
    this.lexicalFailureRetryInFlight = true;
    this.renderLexicalIndexFailureNotice();
    try {
      const result = await this.addDocuments(
        failuresToRetry.map((failure) => failure.file),
      );
      if (result.indexedFiles.length > 0) {
        await this.commitIndexedLexicalFiles(result.indexedFiles);
        await this.persistLexicalSearchSnapshotIfAvailable();
      }
      for (const path of attemptedPaths) {
        this.lexicalIndexFailuresByPath.delete(path);
      }
      for (const failure of result.failures) {
        this.lexicalIndexFailuresByPath.set(failure.file.path, failure);
      }
      if (result.failures.length > 0) {
        this.logLexicalIndexFailures(result.failures);
      }
    } catch (error) {
      logger.error("lexical failure retry failed:", error);
      new MyNotice(
        "Retrying lexical failures failed. Check the console for details.",
        7000,
      );
    } finally {
      this.lexicalFailureRetryInFlight = false;
      this.renderLexicalIndexFailureNotice();
    }
  }

  private async deleteLexicalFileState(
    paths: readonly string[],
  ): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await this.deleteDocuments(Array.from(paths));
    await this.fileSnapshotStore.deleteIndexedSnapshots(paths);
    await this.deleteLexicalIndexedFileRefs(paths);
    await this.markLexicalSnapshotDirty(paths);
  }

  private async handleDeleteOperation(path: string): Promise<void> {
    this.fileSnapshotStore.invalidateCurrentFile(path);
    this.cancelHybridRepair(path);
    await this.clearFailedHybridEmbedding(path);
    this.clearLexicalIndexFailures([path]);
    await this.deleteLexicalFileState([path]);
    if (this.hybridEngine.isEnabled()) {
      await this.deleteHybridFileAndRefreshRuntimeStatus(path);
    }
    await this.fileSnapshotStore.refreshHighPerformanceState(
      this.dataProvider.allFilesToBeIndexed(),
    );
  }

  private async handleUpsertOperation(
    path: string,
    sourceGeneration?: number,
  ): Promise<void> {
    const file = this.dataProvider.getFileByPath(path);
    if (!file || !this.dataProvider.isIndexable(file)) {
      await this.handleDeleteOperation(path);
      return;
    }

    await this.primeCurrentFileText(file, sourceGeneration);
    await this.commitLexicalFileState(file);
    if (
      this.hybridEngine.isEnabled() &&
      this.hybridEngine.shouldIndexPath(file.path)
    ) {
      this.enqueueHybridRepair({
        path: file.path,
        mode: "incremental",
        reason: "runtime-incremental-edit",
        sourceGeneration: file.stat.mtime,
      });
      return;
    }

    if (this.hybridEngine.isEnabled()) {
      await this.hybridEngine.deleteFile(path);
    }
    await this.fileSnapshotStore.refreshHighPerformanceState(
      this.dataProvider.allFilesToBeIndexed(),
    );
  }

  private async handleMoveOperation(
    oldPath: string,
    newPath: string,
    requiresReindex: boolean,
    sourceGeneration?: number,
  ): Promise<void> {
    this.fileSnapshotStore.invalidateCurrentFile(oldPath);
    this.fileSnapshotStore.invalidateCurrentFile(newPath);
    this.cancelHybridRepair(oldPath);
    this.cancelHybridRepair(newPath);
    this.clearLexicalIndexFailures([oldPath, newPath]);
    await this.deleteLexicalFileState([oldPath, newPath]);

    const file = this.dataProvider.getFileByPath(newPath);
    if (!file || !this.dataProvider.isIndexable(file)) {
      await this.clearFailedHybridEmbedding(oldPath);
      await this.clearFailedHybridEmbedding(newPath);
      await this.handleDeleteOperation(newPath);
      if (this.hybridEngine.isEnabled()) {
        await this.hybridEngine.deleteFile(oldPath);
      }
      await this.fileSnapshotStore.refreshHighPerformanceState(
        this.dataProvider.allFilesToBeIndexed(),
      );
      return;
    }

    await this.primeCurrentFileText(file, sourceGeneration);
    await this.commitLexicalFileState(file);

    if (
      !this.hybridEngine.isEnabled() ||
      !this.hybridEngine.shouldIndexPath(file.path)
    ) {
      await this.clearFailedHybridEmbedding(oldPath);
      await this.clearFailedHybridEmbedding(newPath);
      if (this.hybridEngine.isEnabled()) {
        await this.hybridEngine.deleteFile(oldPath);
        await this.hybridEngine.deleteFile(newPath);
      }
      await this.fileSnapshotStore.refreshHighPerformanceState(
        this.dataProvider.allFilesToBeIndexed(),
      );
      return;
    }

    const basenameChanged =
      FileUtil.getBasename(oldPath) !== FileUtil.getBasename(newPath);
    const moved = await this.hybridEngine.moveFile(
      oldPath,
      newPath,
      file.stat.mtime,
    );

    if (moved && !basenameChanged && !requiresReindex) {
      await this.moveFailedHybridEmbedding(oldPath, newPath);
      await this.fileSnapshotStore.refreshHighPerformanceState(
        this.dataProvider.allFilesToBeIndexed(),
      );
      return;
    }

    await this.clearFailedHybridEmbedding(oldPath);
    await this.clearFailedHybridEmbedding(newPath);

    this.enqueueHybridRepair({
      path: file.path,
      mode: basenameChanged ? "full" : "incremental",
      reason: basenameChanged
        ? "runtime-basename-changed-full-rebuild"
        : "runtime-incremental-edit",
      sourceGeneration: file.stat.mtime,
    });
    await this.fileSnapshotStore.refreshHighPerformanceState(
      this.dataProvider.allFilesToBeIndexed(),
    );
  }

  private async primeCurrentFileText(
    file: TFile,
    sourceGeneration?: number,
  ): Promise<string> {
    const text = await this.dataProvider.readPlainText(file);
    return this.fileSnapshotStore.setCurrentFileText(
      file.path,
      text,
      sourceGeneration ?? file.stat.mtime,
    );
  }

  private enqueueHybridRepair(
    task: Omit<HybridRepairTask, "eligibleAt" | "enqueuedAt"> & {
      eligibleAt?: number;
    },
  ): void {
    const nextTask: HybridRepairTask = {
      ...task,
      eligibleAt: task.eligibleAt ?? Date.now(),
      enqueuedAt: Date.now(),
    };
    const existing = this.hybridRepairQueue.get(task.path);
    if (!existing) {
      this.hybridRepairQueue.set(task.path, nextTask);
      this.scheduleHybridRepairFlush();
      return;
    }

    this.hybridRepairQueue.set(task.path, {
      path: task.path,
      mode:
        existing.mode === "full" || nextTask.mode === "full"
          ? "full"
          : "incremental",
      reason: nextTask.reason,
      eligibleAt:
        nextTask.mode === "full"
          ? Date.now()
          : Math.min(existing.eligibleAt, nextTask.eligibleAt),
      enqueuedAt: Math.min(existing.enqueuedAt, nextTask.enqueuedAt),
      sourceGeneration:
        existing.sourceGeneration === undefined
          ? nextTask.sourceGeneration
          : nextTask.sourceGeneration === undefined
            ? existing.sourceGeneration
            : Math.max(existing.sourceGeneration, nextTask.sourceGeneration),
    });
    this.scheduleHybridRepairFlush();
  }

  private cancelHybridRepair(path: string): void {
    this.hybridRepairQueue.delete(path);
    if (this.hybridRepairQueue.size === 0 && this.hybridRepairFlushTimer) {
      clearTimeout(this.hybridRepairFlushTimer);
      this.hybridRepairFlushTimer = null;
    }
  }

  private clearHybridRepairScheduler(): void {
    if (this.hybridRepairFlushTimer) {
      clearTimeout(this.hybridRepairFlushTimer);
      this.hybridRepairFlushTimer = null;
    }
    this.hybridRepairQueue.clear();
  }

  private clearHybridFailedEmbeddingState(): void {
    this.hybridRecoveryCoordinator.resetRuntimeState();
  }

  private scheduleHybridRepairFlush(): void {
    if (this.hybridRepairWorker) {
      return;
    }
    const delayMs = this.getNextHybridRepairDelayMs();
    if (delayMs === null) {
      return;
    }
    if (this.hybridRepairFlushTimer) {
      clearTimeout(this.hybridRepairFlushTimer);
    }
    this.hybridRepairFlushTimer = setTimeout(() => {
      this.hybridRepairFlushTimer = null;
      void this.flushHybridRepairQueue();
    }, delayMs);
  }

  private getNextHybridRepairDelayMs(): number | null {
    let earliestAt = Number.POSITIVE_INFINITY;
    for (const task of this.hybridRepairQueue.values()) {
      earliestAt = Math.min(earliestAt, task.eligibleAt);
    }
    if (!Number.isFinite(earliestAt)) {
      return null;
    }
    return Math.max(0, earliestAt - Date.now());
  }

  private async flushHybridRepairQueue(): Promise<void> {
    if (this.hybridRepairWorker) {
      return await this.hybridRepairWorker;
    }

    const readyTasks = Array.from(this.hybridRepairQueue.values())
      .filter((task) => task.eligibleAt <= Date.now())
      .sort((left, right) => left.enqueuedAt - right.enqueuedAt);
    if (readyTasks.length === 0) {
      this.scheduleHybridRepairFlush();
      return;
    }

    for (const task of readyTasks) {
      this.hybridRepairQueue.delete(task.path);
    }

    const failures: HybridIndexFailure[] = [];
    const worker = (async () => {
      try {
        await this.runHybridRepairTasks(readyTasks, null, 0, failures);
        await this.hybridEngine.persistIndicesForBatch();
      } finally {
        this.hybridRepairWorker = null;
        this.scheduleHybridRepairFlush();
      }
    })();
    this.hybridRepairWorker = worker;
    await worker;
    if (failures.length > 0) {
      this.noticeHybridIndexFailures(failures);
    }
  }

  private async prepareLexicalBootstrapPlan(): Promise<LexicalBootstrapPlan> {
    logger.trace("Init lexical engine...");
    const supportsSerializedIndex =
      this.lexicalEngine.supportsSerializedFileIndex();
    const lexicalSnapshotDirty = supportsSerializedIndex
      ? await this.hasLexicalSnapshotDirtyMarker()
      : false;
    let prevData: SerializedFileSearchIndex | null;
    if (
      !devOption.loadIndexFromDatabase ||
      this.shouldForceRefresh ||
      !supportsSerializedIndex ||
      lexicalSnapshotDirty
    ) {
      prevData = null;
    } else {
      prevData = await this.database.getLexicalSearchSnapshot();
    }

    if (lexicalSnapshotDirty) {
      await this.database.deleteLexicalSearchSnapshot();
    }

    if (!prevData) {
      return {
        needsFullReindex: true,
        needsRefHeal: false,
      };
    }

    await this.database.deleteLexicalSearchSnapshot();
    logger.trace("Previous lexical search snapshot is found.");
    const isSuccessful = await this.lexicalEngine.reIndexAll(prevData);
    if (!isSuccessful) {
      new MyNotice(
        t("Database has been updated. Automatically rebuilding the lexical index..."),
        7000,
      );
      return {
        needsFullReindex: true,
        needsRefHeal: false,
      };
    }
    await this.reloadLexicalIndexedFileRefs();

    return {
      needsFullReindex: false,
      needsRefHeal: !this.isLexicalEngineUpToDate,
    };
  }

  private async healLexicalBootstrapPlan(
    plan: LexicalBootstrapPlan,
  ): Promise<void> {
    if (plan.needsFullReindex) {
      await this.reindexLexicalEngineWithCurrFiles();
      return;
    }
    if (plan.needsRefHeal) {
      await this.updateLexicalIndexedFileRefsByMtime();
    }
  }

  private async commitLexicalBootstrapPlan(): Promise<void> {
    logger.trace("Lexical engine is ready");
    await this.persistLexicalSearchSnapshotIfAvailable();
  }

  private async initHybridEngine() {
    const plan = await this.prepareHybridBootstrapPlan();
    await this.healHybridBootstrapPlan(plan);
  }

  private async prepareHybridBootstrapPlan(): Promise<HybridBootstrapPlan | null> {
    if (!this.hybridEngine.isEnabled()) {
      this.setHybridSearchAvailability("blocked");
      return null;
    }
    beginHybridProfile("hybrid-init", {
      forceRefresh: this.shouldForceRefresh ? 1 : 0,
    });

    try {
      if (this.shouldForceRefresh) {
        await profileHybridStage("startup.clear_all", async () => {
          await this.hybridEngine.clearAll();
        });
      }
      await profileHybridStage("startup.load_engine", async () => {
        await this.hybridEngine.load();
      });
      const currFiles = await profileHybridStage(
        "startup.scan_indexable_files",
        async () =>
          new Map<string, TFile>(
            this.dataProvider
              .allFilesToBeIndexed()
              .filter((file) => this.hybridEngine.shouldIndexPath(file.path))
              .map((file) => [file.path, file]),
          ),
      );
      const repairReport = await profileHybridStage(
        "startup.repair_stored_state",
        async () => await this.repairHybridStoredState(currFiles),
      );
      const previousIndexedFileRefs = repairReport.previousIndexedFileRefs;
      await this.restorePersistedHybridRecoveryState(
        currFiles,
        previousIndexedFileRefs,
      );
      const docsToAdd: TFile[] = [];
      const docsToDelete: string[] = [];

      for (const [path, file] of currFiles) {
        const previousIndexedFileRef = previousIndexedFileRefs.get(path);
        if (!previousIndexedFileRef) {
          docsToAdd.push(file);
        } else if (file.stat.mtime > previousIndexedFileRef.generation) {
          docsToDelete.push(path);
          docsToAdd.push(file);
        }
      }
      for (const prevPath of previousIndexedFileRefs.keys()) {
        if (!currFiles.has(prevPath)) {
          docsToDelete.push(prevPath);
        }
      }
      for (const reindexPath of repairReport.reindexedPaths) {
        const file = currFiles.get(reindexPath);
        if (file && !docsToAdd.some((item) => item.path === reindexPath)) {
          docsToAdd.push(file);
        }
      }

      logger.trace(`hybrid docs to delete: ${docsToDelete.length}`);
      logger.trace(`hybrid docs to add: ${docsToAdd.length}`);
      return {
        currFiles,
        repairReport,
        docsToAdd,
        docsToDelete,
      };
    } catch (error) {
      this.setHybridSearchAvailability("blocked");
      endHybridProfile({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async healHybridBootstrapPlan(
    plan: HybridBootstrapPlan | null,
  ): Promise<void> {
    if (!plan) {
      return;
    }

    const { currFiles, repairReport, docsToAdd, docsToDelete } = plan;
    const hybridIndexStart = Date.now();
    const concurrency = this.getHybridIndexConcurrency();
    setHybridProfileMeta("concurrency", concurrency);
    setHybridProfileMeta("docsToAdd", docsToAdd.length);
    setHybridProfileMeta("docsToDelete", docsToDelete.length);
    logger.debug(
      `hybrid batch start: delete=${docsToDelete.length}, add=${docsToAdd.length}, concurrency=${concurrency}`,
    );
    await this.runHybridPreflight(
      currFiles,
      docsToAdd,
      docsToDelete,
      repairReport.previousIndexedFileRefs,
    );
    const progressNotice = this.createHybridIndexProgressNotice(
      docsToAdd,
      repairReport.repairedPaths.length,
    );
    const failures: HybridIndexFailure[] = [];
    const repairTasks: HybridRepairTask[] = docsToAdd.map((file) => ({
      path: file.path,
      mode: "incremental",
      reason: "startup-self-heal",
      eligibleAt: Date.now(),
      enqueuedAt: Date.now(),
    }));

    try {
      await profileHybridStage("startup.delete_stale_paths", async () => {
        for (const path of docsToDelete) {
          await this.hybridEngine
            .deleteFile(path, { persistIndices: false })
            .catch((e) =>
              logger.warn(`hybrid deleteFile failed for ${path}:`, e),
            );
        }
      });
      await profileHybridStage("startup.index_files", async () => {
        await this.runHybridRepairTasks(
          repairTasks,
          progressNotice,
          repairReport.repairedPaths.length,
          failures,
        );
      });
      const fallbackNoticeKey =
        this.hybridEngine.consumeIndexingFallbackNoticeKey();
      if (failures.length > 0) {
        this.noticeHybridIndexFailures(failures);
      } else if (fallbackNoticeKey) {
        new MyNotice(t(fallbackNoticeKey), 7000);
      }
      progressNotice?.update(
        {
          stage: "done",
          totalBytes: docsToAdd.reduce((sum, file) => sum + file.stat.size, 0),
          totalFiles: docsToAdd.length,
          processedBytes: docsToAdd.reduce(
            (sum, file) => sum + file.stat.size,
            0,
          ),
          processedFiles: docsToAdd.length,
          repairedPaths: repairReport.repairedPaths.length,
          failedFiles: failures.length,
          sessionTokens: getHybridProfileMetric("provider_tokens"),
        },
        true,
      );
      logger.debug(
        `hybrid batch finished in ${Date.now() - hybridIndexStart} ms, failures=${failures.length}, persisted=true, repaired=${repairReport.repairedPaths.length}`,
      );
      this.setHybridSearchAvailability(
        this.hybridEngine.canServeQuery() ? "available" : "blocked",
      );
      await this.enqueuePersistedHybridRecoveryStates(
        new Set<string>([
          ...docsToAdd.map((file) => file.path),
          ...docsToDelete,
        ]),
      );
      endHybridProfile({
        failures: failures.length,
        repairedPaths: repairReport.repairedPaths.length,
      });
    } catch (error) {
      this.setHybridSearchAvailability("blocked");
      endHybridProfile({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      progressNotice?.hide();
    }
  }

  private async reindexLexicalEngineWithCurrFiles() {
    logger.trace("Indexing the whole vault...");
    const filesToIndex = this.dataProvider.allFilesToBeIndexed();
    const indexedPaths = new Set<string>(filesToIndex.map((file) => file.path));
    let size = 0;
    for (const file of filesToIndex) size += file.stat.size;
    size /= 1024;
    if (size > 2000) {
      const sizeText = (size / 1024).toFixed(2) + " MB";
      new MyNotice(
        `${sizeText} ${t("files need to be indexed. Obsidian may freeze for a while")}`,
        7000,
      );
    }
    const successfulFiles: TFile[] = [];
    const failures: LexicalIndexFailure[] = [];
    this.lexicalEngine.beginBatchReindex();
    try {
      for (
        let start = 0;
        start < filesToIndex.length;
        start += DataManager.LEXICAL_REINDEX_BATCH_SIZE
      ) {
        const batchFiles = filesToIndex.slice(
          start,
          start + DataManager.LEXICAL_REINDEX_BATCH_SIZE,
        );
        const batchResult = await this.addDocuments(batchFiles);
        successfulFiles.push(...batchResult.indexedFiles);
        failures.push(...batchResult.failures);
        if (
          start + DataManager.LEXICAL_REINDEX_BATCH_SIZE <
          filesToIndex.length
        ) {
          await MyLib.sleep(0);
        }
      }
      this.lexicalEngine.finishBatchReindex();
    } catch (error) {
      this.lexicalEngine.abortBatchReindex();
      throw error;
    }
    await this.saveLexicalIndexedFileRefs(successfulFiles);
    await this.fileSnapshotStore.commitCurrentFilesAsIndexed(
      successfulFiles.map((file) => ({
        path: file.path,
        generation: file.stat.mtime,
      })),
    );
    await this.fileSnapshotStore.deleteIndexedSnapshotsNotIn(indexedPaths);
    await this.markLexicalSnapshotDirty();
    this.clearLexicalIndexFailures(Array.from(indexedPaths));
    if (failures.length > 0) {
      this.addLexicalIndexFailures(failures);
    }
    this.isLexicalEngineUpToDate = failures.length === 0;
  }

  private async updateLexicalIndexedFileRefsByMtime() {
    const currFiles = new Map<string, TFile>(
      this.dataProvider.allFilesToBeIndexed().map((file) => [file.path, file]),
    );
    const previousIndexedFileRefsList =
      await this.database.getLexicalIndexedFileRefs();
    const previousIndexedFileRefs = new Map<string, BaseIndexedFileRef>(
      previousIndexedFileRefsList?.map((ref) => [ref.path, ref]),
    );

    const docsToAdd: TAbstractFile[] = [];
    const docsToDelete: string[] = [];

    for (const [path, file] of currFiles) {
      const previousIndexedFileRef = previousIndexedFileRefs.get(path);
      if (!previousIndexedFileRef) {
        docsToAdd.push(file);
      } else if (this.hasIndexedFileRefChanged(file, previousIndexedFileRef)) {
        docsToDelete.push(file.path);
        docsToAdd.push(file);
      }
    }
    for (const prevPath of previousIndexedFileRefs.keys()) {
      if (!currFiles.has(prevPath)) docsToDelete.push(prevPath);
    }

    logger.trace(`docs to delete: ${docsToDelete.length}`);
    logger.trace(`docs to add: ${docsToAdd.length}`);
    await this.deleteDocuments(docsToDelete);
    await this.fileSnapshotStore.deleteIndexedSnapshots(docsToDelete);
    const addResult = await this.addDocuments(docsToAdd);
    await this.fileSnapshotStore.commitCurrentFilesAsIndexed(
      addResult.indexedFiles.map((file) => ({
        path: file.path,
        generation: file.stat.mtime,
      })),
    );
    const failedPaths = new Set(
      addResult.failures.map((failure) => failure.file.path),
    );
    await this.saveLexicalIndexedFileRefs(
      Array.from(currFiles.values()).filter(
        (file) => !failedPaths.has(file.path),
      ),
    );
    if (docsToDelete.length > 0 || addResult.indexedFiles.length > 0) {
      await this.markLexicalSnapshotDirty([
        ...docsToDelete,
        ...addResult.indexedFiles.map((file) => file.path),
      ]);
    }
    this.clearLexicalIndexFailures(docsToDelete);
    this.clearLexicalIndexFailures(
      addResult.indexedFiles.map((file) => file.path),
    );
    if (addResult.failures.length > 0) {
      this.addLexicalIndexFailures(addResult.failures);
    }
  }

  private async saveLexicalIndexedFileRefs(files: TFile[]) {
    const updatedIndexedFileRefs = files.map((file) => ({
      path: file.path,
      generation: file.stat.mtime,
      size: file.stat.size,
    }));
    await this.database.setLexicalIndexedFileRefs(updatedIndexedFileRefs);
    await this.reloadLexicalIndexedFileRefs();
    logger.trace(
      `${updatedIndexedFileRefs.length} lexical indexed file refs updated`,
    );
  }

  private async ensureLexicalIndexedFileRefsLoaded(): Promise<void> {
    if (this.lexicalIndexedFileRefsLoaded) {
      return;
    }
    await this.reloadLexicalIndexedFileRefs();
  }

  private async reloadLexicalIndexedFileRefs(): Promise<void> {
    const refs = (await this.database.getLexicalIndexedFileRefs()) ?? [];
    this.lexicalIndexedFileRefsByPath = new Map(
      refs.map((ref) => [ref.path, ref]),
    );
    this.lexicalIndexedFileRefsLoaded = true;
  }

  private async upsertLexicalIndexedFileRef(
    file: TFile,
    generation = file.stat.mtime,
  ): Promise<void> {
    await this.ensureLexicalIndexedFileRefsLoaded();
    const nextRef: BaseIndexedFileRef = {
      path: file.path,
      generation,
      size: file.stat.size,
    };
    await this.database.putLexicalIndexedFileRef(nextRef);
    this.lexicalIndexedFileRefsByPath.set(file.path, nextRef);
  }

  private async deleteLexicalIndexedFileRefs(
    paths: readonly string[],
  ): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await this.ensureLexicalIndexedFileRefsLoaded();
    await this.database.deleteLexicalIndexedFileRefs(paths);
    for (const path of paths) {
      this.lexicalIndexedFileRefsByPath.delete(path);
    }
  }

  private hasIndexedFileRefChanged(
    file: TFile,
    indexedFileRef: BaseIndexedFileRef,
  ): boolean {
    if (file.stat.mtime > indexedFileRef.generation) {
      return true;
    }
    if (indexedFileRef.size === undefined) {
      return false;
    }
    return file.stat.size !== indexedFileRef.size;
  }

  private async runHybridRepairTasks(
    tasks: HybridRepairTask[],
    progressNotice: HybridIndexProgressNotice | null,
    repairedPaths: number,
    failures: HybridIndexFailure[],
  ) {
    if (tasks.length === 0) {
      progressNotice?.update(
        {
          stage: "done",
          totalBytes: 0,
          totalFiles: 0,
          processedBytes: 0,
          processedFiles: 0,
          repairedPaths,
          failedFiles: 0,
          sessionTokens: getHybridProfileMetric("provider_tokens"),
        },
        true,
      );
      return;
    }

    const concurrency = this.getHybridIndexConcurrency();
    const files = tasks
      .map((task) => {
        const file = this.dataProvider.getFileByPath(task.path);
        return file ? { task, file } : null;
      })
      .filter(
        (item): item is { task: HybridRepairTask; file: TFile } =>
          item !== null,
      );
    const largeFiles: Array<{ task: HybridRepairTask; file: TFile }> = [];
    const normalFiles: Array<{ task: HybridRepairTask; file: TFile }> = [];
    for (const item of files) {
      const file = item.file;
      if (file.stat.size >= DataManager.HYBRID_LARGE_FILE_BYTES) {
        largeFiles.push(item);
      } else {
        normalFiles.push(item);
      }
    }

    largeFiles.sort(
      (left, right) => right.file.stat.size - left.file.stat.size,
    );
    normalFiles.sort(
      (left, right) => right.file.stat.size - left.file.stat.size,
    );
    logger.debug(
      `hybrid batch tiers: large=${largeFiles.length}, normal=${normalFiles.length}, normalConcurrency=${concurrency}`,
    );
    let processedBytes = 0;
    let processedFiles = 0;
    let failedFiles = 0;
    const totalBytes = files.reduce(
      (sum, item) => sum + item.file.stat.size,
      0,
    );
    const totalFiles = files.length;
    progressNotice?.update(
      {
        stage: "index",
        totalBytes,
        totalFiles,
        processedBytes: 0,
        processedFiles: 0,
        repairedPaths,
        failedFiles: 0,
        sessionTokens: getHybridProfileMetric("provider_tokens"),
      },
      true,
    );

    await runWeightedTasks(
      [...largeFiles, ...normalFiles],
      {
        maxConcurrent: concurrency,
        maxWeight: DataManager.HYBRID_IN_FLIGHT_BYTES_BUDGET,
        getWeight: (item) => item.file.stat.size,
        isExclusive: (item) =>
          item.file.stat.size >= DataManager.HYBRID_LARGE_FILE_BYTES,
      },
      async (item) => {
        const failure = await this.runHybridRepairTask(item.task, item.file);
        if (failure) {
          failures.push(failure);
        }
        processedBytes += item.file.stat.size;
        processedFiles += 1;
        if (failure) {
          failedFiles += 1;
        }
        progressNotice?.update({
          stage: "index",
          totalBytes,
          totalFiles,
          processedBytes,
          processedFiles,
          repairedPaths,
          failedFiles,
          sessionTokens: getHybridProfileMetric("provider_tokens"),
        });
      },
    );
  }

  private async runHybridRepairTask(
    task: HybridRepairTask,
    file: TFile,
  ): Promise<HybridIndexFailure | null> {
    logger.debug(
      `hybrid repair task ${task.mode} for ${task.path} (${task.reason})`,
    );
    if (
      !this.dataProvider.isIndexable(file) ||
      !this.hybridEngine.isEnabled() ||
      !this.hybridEngine.shouldIndexPath(task.path)
    ) {
      await this.clearFailedHybridEmbedding(task.path);
      await this.hybridEngine
        .deleteFile(task.path)
        .catch((error) =>
          logger.warn(`hybrid repair delete failed for ${task.path}:`, error),
        );
      return null;
    }

    if (
      task.sourceGeneration !== undefined &&
      file.stat.mtime > task.sourceGeneration
    ) {
      logger.debug(
        `skip stale hybrid repair task for ${task.path}: taskGeneration=${task.sourceGeneration}, currentGeneration=${file.stat.mtime}`,
      );
      this.enqueueHybridRepair({
        path: task.path,
        mode: task.mode,
        reason: "runtime-generation-advanced",
        sourceGeneration: file.stat.mtime,
      });
      return null;
    }

    if (task.mode === "full") {
      const failure = await this.indexHybridFileWithRetry(file, "full");
      if (failure === null) {
        this.notifyHybridRuntimeStatusChanged();
      }
      return failure;
    }

    const eligibleAt = await this.getIncrementalEmbedEligibleAt(task.path);
    if (eligibleAt > Date.now()) {
      logger.debug(
        `hybrid repair deferred embedding for ${task.path} until ${new Date(eligibleAt).toISOString()}`,
      );
      const failure = await this.indexHybridFileStructureOnly(file);
      if (failure) {
        return failure;
      }
      await this.registerDeferredHybridEmbedding(
        task.path,
        task.sourceGeneration ?? file.stat.mtime,
        "incremental",
        eligibleAt,
      );
      this.notifyHybridRuntimeStatusChanged();
      this.enqueueHybridRepair({
        path: task.path,
        mode: "incremental",
        reason: "resume-deferred-embedding",
        eligibleAt,
        sourceGeneration: task.sourceGeneration ?? file.stat.mtime,
      });
      return null;
    }

    const failure = await this.indexHybridFileWithRetry(file, "incremental");
    if (failure === null) {
      this.notifyHybridRuntimeStatusChanged();
    }
    return failure;
  }

  private async indexHybridFileWithRetry(
    file: TFile,
    mode: HybridRepairMode,
  ): Promise<HybridIndexFailure | null> {
    const fileIndexStart = Date.now();
    const text = await this.dataProvider.readPlainText(file.path);
    this.fileSnapshotStore.setCurrentFileText(file.path, text, file.stat.mtime);
    const headingOutline = this.dataProvider.getHeadingOutlineForText(
      file,
      text,
    );
    let attempts = 0;
    let lastError: unknown = null;
    try {
      await retryAsync(
        async (attempt) => {
          attempts = attempt;
          await this.hybridEngine.indexFileStrict(
            file.path,
            text,
            file.stat.mtime,
            { persistIndices: false },
            headingOutline,
          );
        },
        {
          maxAttempts: DataManager.HYBRID_INDEX_MAX_RETRIES,
          shouldRetry: (error, attempt) => {
            lastError = error;
            const reason = this.formatHybridIndexError(error);
            const retryable = this.isRetryableHybridIndexError(error);
            logger.warn(
              `hybrid semantic index attempt ${attempt}/${DataManager.HYBRID_INDEX_MAX_RETRIES} failed for ${file.path}: ${reason}`,
            );
            return retryable;
          },
          getDelayMs: (error, attempt) =>
            this.getHybridRetryDelayMs(error, attempt),
        },
      );
      logger.debug(
        `hybrid indexed ${file.path} in ${Date.now() - fileIndexStart} ms after ${attempts} attempt(s)`,
      );
      await this.clearFailedHybridEmbedding(file.path);
      return null;
    } catch (error) {
      lastError = error;
    }

    let bm25FallbackIndexed = false;
    let fallbackError: unknown = null;
    try {
      await this.hybridEngine.indexFile(
        file.path,
        text,
        file.stat.mtime,
        headingOutline,
      );
      bm25FallbackIndexed = true;
    } catch (caughtFallbackError) {
      logger.error(
        `hybrid BM25 fallback indexing failed for ${file.path}:`,
        caughtFallbackError,
      );
      fallbackError = caughtFallbackError;
    }

    const failureError = fallbackError ?? lastError;
    const failureReason = this.formatHybridFailureReason(
      lastError,
      fallbackError,
    );

    await this.registerFailedHybridEmbedding(
      file.path,
      file.stat.mtime,
      mode,
      failureError,
      failureReason,
    );

    return {
      path: file.path,
      reason: failureReason,
      attempts,
      bm25FallbackIndexed,
    };
  }

  private async indexHybridFileStructureOnly(
    file: TFile,
  ): Promise<HybridIndexFailure | null> {
    try {
      const text = await this.dataProvider.readPlainText(file.path);
      this.fileSnapshotStore.setCurrentFileText(
        file.path,
        text,
        file.stat.mtime,
      );
      const headingOutline = this.dataProvider.getHeadingOutlineForText(
        file,
        text,
      );
      await this.hybridEngine.indexFileWithoutEmbedding(
        file.path,
        text,
        file.stat.mtime,
        { persistIndices: false },
        headingOutline,
      );
      return null;
    } catch (error) {
      return {
        path: file.path,
        reason: this.formatHybridIndexError(error),
        attempts: 1,
        bm25FallbackIndexed: false,
      };
    }
  }

  private async getIncrementalEmbedEligibleAt(
    filePath: string,
  ): Promise<number> {
    const ref = await this.database.db.hybridIndexedFileRefs.get(filePath);
    const lastIncrementalEmbedAt = ref?.lastIncrementalEmbedAt ?? 0;
    if (lastIncrementalEmbedAt <= 0) {
      return 0;
    }
    return lastIncrementalEmbedAt + this.getMinIncrementalEmbedIntervalMs();
  }

  private getMinIncrementalEmbedIntervalMs(): number {
    const configured = this.setting.hybrid.minIncrementalEmbedIntervalSec ?? 60;
    return Math.max(0, configured) * 1000;
  }

  private getFailedEmbeddingRetryIntervalMs(): number {
    const configured =
      this.setting.hybrid.failedEmbeddingRetryIntervalMin ?? 10;
    return Math.max(1, configured) * 60_000;
  }

  private canRetryHybridEmbeddingPath(path: string): boolean {
    const file = this.dataProvider.getFileByPath(path);
    return (
      file !== null &&
      this.dataProvider.isIndexable(file) &&
      this.hybridEngine.isEnabled() &&
      this.hybridEngine.shouldIndexPath(file.path)
    );
  }

  isHybridSearchUnavailable(): boolean {
    return (
      this.hybridSearchAvailability === "blocked" ||
      !this.hybridEngine.canServeQuery()
    );
  }

  isSearchSearchable(): boolean {
    return this.lexicalBootstrapState === "searchable";
  }

  getSearchBootstrapState(): SearchBootstrapState {
    return this.lexicalBootstrapState;
  }

  getLexicalBootstrapState(): SearchBootstrapState {
    return this.lexicalBootstrapState;
  }

  getHybridBootstrapState(): SearchBootstrapState {
    return this.hybridBootstrapState;
  }

  getSearchBootstrapMetrics(): SearchBootstrapMetrics | null {
    if (!this.searchBootstrapMetrics) {
      return null;
    }
    return {
      ...this.searchBootstrapMetrics,
      lexical: { ...this.searchBootstrapMetrics.lexical },
      hybrid: { ...this.searchBootstrapMetrics.hybrid },
    };
  }

  getSearchBootstrapNoticeKey(): LocaleKey | null {
    switch (this.lexicalBootstrapState) {
      case "restoring":
        return "searchBootstrap.restoring";
      case "healing":
        return "searchBootstrap.healing";
      case "failed":
        return "searchBootstrap.failed";
      default:
        return null;
    }
  }

  private setHybridSearchAvailability(
    availability: HybridSearchAvailability,
  ): void {
    this.hybridSearchAvailability = availability;
  }

  private setLexicalBootstrapState(state: SearchBootstrapState): void {
    this.lexicalBootstrapState = state;
  }

  private setHybridBootstrapState(state: SearchBootstrapState): void {
    this.hybridBootstrapState = state;
  }

  private createSearchBootstrapComponentMetrics(): SearchBootstrapComponentMetrics {
    return {
      restoreStartedAt: null,
      restoreCompletedAt: null,
      healStartedAt: null,
      healCompletedAt: null,
      restoreMs: null,
      healMs: null,
    };
  }

  private getSearchBootstrapComponentMetrics(
    component: SearchBootstrapComponent,
  ): SearchBootstrapComponentMetrics | null {
    const metrics = this.searchBootstrapMetrics;
    if (!metrics) {
      return null;
    }
    return component === "lexical" ? metrics.lexical : metrics.hybrid;
  }

  private beginSearchBootstrapRun(): void {
    this.searchBootstrapMetrics = {
      startedAt: Date.now(),
      searchableAt: null,
      commitStartedAt: null,
      commitCompletedAt: null,
      searchableMs: null,
      commitMs: null,
      commitPending: false,
      commitFailed: false,
      lexical: this.createSearchBootstrapComponentMetrics(),
      hybrid: this.createSearchBootstrapComponentMetrics(),
    };
    this.setLexicalBootstrapState("blocked");
    this.setHybridBootstrapState("blocked");
  }

  private markSearchBootstrapPhaseStarted(
    component: SearchBootstrapComponent,
    phase: SearchBootstrapPhase,
  ): void {
    const metrics = this.getSearchBootstrapComponentMetrics(component);
    if (!metrics) {
      return;
    }
    if (phase === "restore") {
      metrics.restoreStartedAt = Date.now();
      return;
    }
    metrics.healStartedAt = Date.now();
  }

  private markSearchBootstrapPhaseCompleted(
    component: SearchBootstrapComponent | "commit",
    phase: SearchBootstrapPhase | "commit",
  ): void {
    const metrics = this.searchBootstrapMetrics;
    if (!metrics) {
      return;
    }
    const now = Date.now();
    if (component === "commit" || phase === "commit") {
      const phaseStart =
        metrics.commitStartedAt ?? metrics.searchableAt ?? metrics.startedAt;
      metrics.commitCompletedAt = now;
      metrics.commitMs = now - phaseStart;
      metrics.commitPending = false;
      return;
    }

    const componentMetrics = this.getSearchBootstrapComponentMetrics(component);
    if (!componentMetrics) {
      return;
    }
    if (phase === "restore") {
      componentMetrics.restoreCompletedAt = now;
      const phaseStart = componentMetrics.restoreStartedAt ?? metrics.startedAt;
      componentMetrics.restoreMs = now - phaseStart;
      return;
    }

    componentMetrics.healCompletedAt = now;
    const phaseStart =
      componentMetrics.healStartedAt ??
      componentMetrics.restoreCompletedAt ??
      componentMetrics.restoreStartedAt ??
      metrics.startedAt;
    componentMetrics.healMs = now - phaseStart;
  }

  private markSearchBootstrapSearchable(): void {
    const metrics = this.searchBootstrapMetrics;
    const searchableAt = Date.now();
    if (metrics) {
      metrics.searchableAt = searchableAt;
      metrics.searchableMs = searchableAt - metrics.startedAt;
    }
    logger.info(
      `[clever-search] search bootstrap searchable in ${metrics?.searchableMs ?? 0} ms` +
        ` (lexical restore ${metrics?.lexical.restoreMs ?? 0} ms, lexical heal ${metrics?.lexical.healMs ?? 0} ms, ` +
        `hybrid restore ${metrics?.hybrid.restoreMs ?? 0} ms, hybrid heal ${metrics?.hybrid.healMs ?? 0} ms)`,
    );
  }

  private failSearchBootstrapRun(): void {
    if (!this.searchBootstrapMetrics) {
      return;
    }
    this.searchBootstrapMetrics.searchableAt = null;
    this.searchBootstrapMetrics.searchableMs = null;
    this.searchBootstrapMetrics.commitPending = false;
  }

  private kickOffSearchBootstrapCommit(): void {
    const metrics = this.searchBootstrapMetrics;
    if (metrics) {
      metrics.commitPending = true;
      metrics.commitFailed = false;
      metrics.commitStartedAt = Date.now();
    }

    if (!this.shouldForceRefresh) {
      eventBus.on(EventEnum.IN_VAULT_SEARCH, () =>
        this.docOperationsBuffer.forceFlush(),
      );
      getInstance(FileWatcher).start();
    }

    this.notifyHybridRuntimeStatusChanged();

    const task = this.commitSearchBootstrapRun()
      .then(() => {
        this.markSearchBootstrapPhaseCompleted("commit", "commit");
        if (isDevEnvironment) {
          const commitMs = this.searchBootstrapMetrics?.commitMs ?? 0;
          logger.info(
            `[clever-search] search bootstrap commit finished in ${commitMs} ms`,
          );
        }
      })
      .catch((error) => {
        logger.warn("[clever-search] search bootstrap commit failed:", error);
        if (this.searchBootstrapMetrics) {
          this.searchBootstrapMetrics.commitPending = false;
          this.searchBootstrapMetrics.commitFailed = true;
        }
      })
      .finally(() => {
        if (this.searchBootstrapCommitTask === task) {
          this.searchBootstrapCommitTask = null;
        }
      });
    this.searchBootstrapCommitTask = task;
  }

  private async commitSearchBootstrapRun(): Promise<void> {
    await this.commitLexicalBootstrapPlan();
    if (this.hybridEngine.isEnabled()) {
      await this.hybridEngine.persistIndicesForBatch();
    }
    await this.fileSnapshotStore.refreshHighPerformanceState(
      this.dataProvider.allFilesToBeIndexed(),
    );
    if (isDevEnvironment) {
      await this.noticeDevStorageStats();
    }
  }

  private getHybridIndexConcurrency(): number {
    const configured = this.setting.hybrid.indexConcurrency ?? 3;
    return Math.max(1, Math.min(configured, 8));
  }

  private getHybridRetryDelayMs(error: unknown, attempt: number): number {
    if (!(error instanceof Error)) {
      return DataManager.HYBRID_INDEX_RETRY_DELAY_MS * attempt;
    }
    const message = `${error.name}: ${error.message}`.toLowerCase();
    if (message.includes("429")) {
      return 4_000 * attempt;
    }
    if (
      message.includes("408") ||
      message.includes("425") ||
      message.includes("timeout")
    ) {
      return 2_500 * attempt;
    }
    if (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504")
    ) {
      return 3_000 * attempt;
    }
    return DataManager.HYBRID_INDEX_RETRY_DELAY_MS * attempt;
  }

  private async clearFailedHybridEmbedding(path: string): Promise<void> {
    await this.hybridRecoveryCoordinator.clearPath(path);
  }

  private async moveFailedHybridEmbedding(
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    await this.hybridRecoveryCoordinator.movePath(oldPath, newPath);
  }

  private async registerFailedHybridEmbedding(
    path: string,
    targetGeneration: number,
    mode: HybridRepairMode,
    error: unknown,
    reason: string,
  ): Promise<void> {
    await this.hybridRecoveryCoordinator.registerFailure(
      path,
      targetGeneration,
      mode,
      error,
      reason,
    );
  }

  private async registerDeferredHybridEmbedding(
    path: string,
    targetGeneration: number,
    mode: HybridRepairMode,
    nextRetryAt: number | null,
  ): Promise<void> {
    await this.hybridRecoveryCoordinator.registerDeferred(
      path,
      targetGeneration,
      mode,
      nextRetryAt,
    );
  }

  private async deleteHybridFileAndRefreshRuntimeStatus(
    path: string,
  ): Promise<void> {
    await this.hybridEngine.deleteFile(path);
    this.notifyHybridRuntimeStatusChanged();
  }

  private notifyHybridRuntimeStatusChanged(): void {
    eventBus.emit(EventEnum.HYBRID_RUNTIME_STATUS_CHANGED);
  }

  private async enqueuePersistedHybridRecoveryStates(
    skipPaths: ReadonlySet<string>,
  ): Promise<void> {
    await this.hybridRecoveryCoordinator.enqueuePersistedStartupRepairs(
      skipPaths,
    );
  }
  private createHybridIndexProgressNotice(
    docsToAdd: TFile[],
    repairedPaths: number,
  ): HybridIndexProgressNotice | null {
    if (docsToAdd.length === 0 && repairedPaths === 0) {
      return null;
    }
    const progressNotice = new HybridIndexProgressNotice();
    if (repairedPaths > 0) {
      progressNotice.update(
        {
          stage: "repair",
          totalBytes: docsToAdd.reduce((sum, file) => sum + file.stat.size, 0),
          totalFiles: docsToAdd.length,
          processedBytes: 0,
          processedFiles: 0,
          repairedPaths,
          failedFiles: 0,
          sessionTokens: getHybridProfileMetric("provider_tokens"),
        },
        true,
      );
    }
    return progressNotice;
  }

  private async scanRowsInBatches<Row, Key extends string | number>(
    loadBatch: (lastKey: Key | null, batchSize: number) => Promise<Row[]>,
    getLastKey: (row: Row) => Key,
    handleBatch: (rows: Row[]) => void | Promise<void>,
  ): Promise<void> {
    let lastKey: Key | null = null;
    while (true) {
      const rows = await loadBatch(
        lastKey,
        DataManager.HYBRID_TABLE_SCAN_BATCH_SIZE,
      );
      if (rows.length === 0) {
        return;
      }
      await handleBatch(rows);
      lastKey = getLastKey(rows[rows.length - 1]);
    }
  }

  private getOrCreateHybridStoredPathSummary(
    summaries: Map<string, HybridStoredPathSummary>,
    path: string,
  ): HybridStoredPathSummary {
    const existing = summaries.get(path);
    if (existing) {
      return existing;
    }
    const created: HybridStoredPathSummary = { chunkCount: 0 };
    summaries.set(path, created);
    return created;
  }

  private async collectHybridStoredPathSummaries(): Promise<
    Map<string, HybridStoredPathSummary>
  > {
    const summaries = new Map<string, HybridStoredPathSummary>();

    await this.scanRowsInBatches<ChunkRow, number>(
      (lastId, batchSize) => {
        if (lastId === null) {
          return this.database.db.hybridChunks
            .orderBy(":id")
            .limit(batchSize)
            .toArray();
        }
        return this.database.db.hybridChunks
          .where(":id")
          .above(lastId)
          .limit(batchSize)
          .toArray();
      },
      (row) => row.id ?? 0,
      (rows) => {
        for (const row of rows) {
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            row.filePath,
          );
          summary.chunkCount += 1;
        }
      },
    );

    await this.scanRowsInBatches<ChunkVectorShardRow, string>(
      (lastPath, batchSize) => {
        if (lastPath === null) {
          return this.database.db.hybridChunkVectors
            .orderBy(":id")
            .limit(batchSize)
            .toArray();
        }
        return this.database.db.hybridChunkVectors
          .where(":id")
          .above(lastPath)
          .limit(batchSize)
          .toArray();
      },
      (row) => row.filePath,
      (rows) => {
        for (const row of rows) {
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            row.filePath,
          );
          summary.vectorInfo = {
            precision: (row.precision === "float16"
              ? "float16"
              : "int8") as VectorPrecision,
            chunkCount: row.chunkCount,
            generation: row.generation,
          };
        }
      },
    );

    await this.scanRowsInBatches<HybridIndexedFileRef, string>(
      (lastPath, batchSize) => {
        if (lastPath === null) {
          return this.database.db.hybridIndexedFileRefs
            .orderBy(":id")
            .limit(batchSize)
            .toArray();
        }
        return this.database.db.hybridIndexedFileRefs
          .where(":id")
          .above(lastPath)
          .limit(batchSize)
          .toArray();
      },
      (row) => row.path,
      (rows) => {
        for (const row of rows) {
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            row.path,
          );
          summary.indexedFileRef = row;
        }
      },
    );

    // Shared snapshots are not hybrid-owned; only inspect them for paths that
    // already have hybrid-private rows or refs.
    const summaryPaths = Array.from(summaries.keys());
    for (
      let start = 0;
      start < summaryPaths.length;
      start += DataManager.HYBRID_TABLE_SCAN_BATCH_SIZE
    ) {
      const batchPaths = summaryPaths.slice(
        start,
        start + DataManager.HYBRID_TABLE_SCAN_BATCH_SIZE,
      );
      const snapshotRows =
        await this.database.db.fileSnapshots.bulkGet(batchPaths);
      for (const row of snapshotRows) {
        if (!row) {
          continue;
        }
        const summary = summaries.get(row.filePath);
        if (summary) {
          summary.snapshotGeneration = row.generation;
        }
      }
    }

    return summaries;
  }

  private async repairHybridStoredState(
    currFiles: Map<string, TFile>,
  ): Promise<HybridStorageRepairReport> {
    const summaries = await this.collectHybridStoredPathSummaries();
    const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>();
    const currentPrecision =
      this.setting.hybrid.vectorCompression === "float16" ? "float16" : "int8";
    const repairedPaths = new Set<string>();
    const reindexedPaths = new Set<string>();

    for (const [path, summary] of summaries) {
      const existsNow = currFiles.has(path);
      const indexedFileRef = summary.indexedFileRef;
      if (indexedFileRef) {
        previousIndexedFileRefs.set(path, indexedFileRef);
      }
      const consistency = analyzeHybridStoredFileConsistency({
        existsInVault: existsNow,
        hasChunks: summary.chunkCount > 0,
        chunkCount: summary.chunkCount,
        snapshot:
          summary.snapshotGeneration !== undefined
            ? { generation: summary.snapshotGeneration }
            : undefined,
        vectorInfo: summary.vectorInfo,
        indexedFileRef,
        currentPrecision,
      });
      if (consistency.repairReasons.length === 0) {
        continue;
      }

      repairedPaths.add(path);
      if (existsNow) {
        reindexedPaths.add(path);
      }
    }

    if (repairedPaths.size === 0) {
      return {
        repairedPaths: [],
        reindexedPaths: Array.from(reindexedPaths),
        previousIndexedFileRefs,
      };
    }

    const repairedPathList = Array.from(repairedPaths);
    console.groupCollapsed(
      `[clever-search] Hybrid startup self-healing (${repairedPathList.length} paths)`,
    );
    console.table(
      repairedPathList.map((path) => ({
        path,
        inVault: currFiles.has(path),
        hasChunks: (summaries.get(path)?.chunkCount ?? 0) > 0,
        hasSnapshot: summaries.get(path)?.snapshotGeneration !== undefined,
        hasVector: summaries.get(path)?.vectorInfo !== undefined,
        hasIndexedFileRef: summaries.get(path)?.indexedFileRef !== undefined,
        indexedFileState:
          normalizeHybridIndexedFileState(
            summaries.get(path)?.indexedFileRef,
            summaries.get(path)?.vectorInfo !== undefined,
          ) ?? "-",
        chunkCount: summaries.get(path)?.chunkCount ?? 0,
        indexedFileRefChunkCount:
          summaries.get(path)?.indexedFileRef?.chunkCount ?? "-",
        vectorChunkCount: summaries.get(path)?.vectorInfo?.chunkCount ?? "-",
        vectorPrecision: summaries.get(path)?.vectorInfo?.precision ?? "-",
      })),
    );
    console.groupEnd();

    for (const path of repairedPathList) {
      await this.hybridEngine
        .deleteFile(path, { persistIndices: false })
        .catch((error) =>
          logger.warn(`hybrid self-healing delete failed for ${path}:`, error),
        );
    }

    return {
      repairedPaths: repairedPathList,
      reindexedPaths: Array.from(reindexedPaths),
      previousIndexedFileRefs,
    };
  }

  private isRetryableHybridIndexError(error: unknown): boolean {
    if (
      error instanceof NoApiKeyError ||
      error instanceof WeeklyTokenLimitExceededError ||
      error instanceof HybridDisabledError
    ) {
      return false;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const message = `${error.name}: ${error.message}`.toLowerCase();
    if (
      message.includes("insufficient_quota") ||
      message.includes("quota") ||
      message.includes("weekly token limit exceeded")
    ) {
      return false;
    }

    const statusMatch = message.match(/embedding api error (\d{3})/);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      if (
        status === 408 ||
        status === 409 ||
        status === 425 ||
        status === 429
      ) {
        return true;
      }
      if (status >= 500) {
        return true;
      }
      return false;
    }

    return (
      error.name === "TypeError" ||
      message.includes("failed to fetch") ||
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econn") ||
      message.includes("socket")
    );
  }

  private formatHybridIndexError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private formatHybridFailureReason(
    embeddingError: unknown,
    fallbackError: unknown,
  ): string {
    if (fallbackError !== null && fallbackError !== undefined) {
      const fallbackReason = this.formatHybridIndexError(fallbackError);
      if (embeddingError !== null && embeddingError !== undefined) {
        return `Embedding failed: ${this.formatHybridIndexError(embeddingError)} | BM25 fallback failed: ${fallbackReason}`;
      }
      return `BM25 fallback failed: ${fallbackReason}`;
    }
    return this.formatHybridIndexError(embeddingError);
  }

  private noticeHybridIndexFailures(failures: HybridIndexFailure[]) {
    if (failures.length === 0) {
      return;
    }

    const failedWithoutBm25 = failures.filter(
      (item) => !item.bm25FallbackIndexed,
    ).length;
    const message = this.buildHybridFailureNotice(
      failures.length,
      failedWithoutBm25,
    );
    new MyNotice(message, 12000);

    console.groupCollapsed(
      `[clever-search] Hybrid semantic indexing incomplete (${failures.length} files)`,
    );
    failures.forEach((failure) => {
      console.error(
        `[clever-search] ${failure.path}\nAttempts: ${failure.attempts}\nBM25 fallback indexed: ${failure.bm25FallbackIndexed}\nReason: ${failure.reason}`,
      );
    });
    console.groupEnd();
  }

  private buildHybridFailureNotice(
    failureCount: number,
    failedWithoutBm25: number,
  ): string {
    const fallbackText =
      failedWithoutBm25 > 0
        ? ` ${failedWithoutBm25} file(s) also failed BM25 fallback indexing.`
        : "";
    return `${failureCount} file(s) did not finish semantic embedding indexing after ${DataManager.HYBRID_INDEX_MAX_RETRIES} attempts due to network or quota/token issues.${fallbackText} Press Ctrl+Shift+I to view details in the console.`;
  }

  private async runHybridPreflight(
    currFiles: Map<string, TFile>,
    docsToAdd: TFile[],
    docsToDelete: string[],
    previousIndexedFileRefs?: ReadonlyMap<string, HybridIndexedFileRef>,
  ): Promise<void> {
    if (
      docsToAdd.length === 0 &&
      docsToDelete.length === 0 &&
      !this.shouldForceRefresh
    ) {
      return;
    }

    const report = await this.buildHybridPreflightReport(
      currFiles,
      docsToAdd,
      docsToDelete,
      previousIndexedFileRefs,
    );
    console.groupCollapsed("[clever-search] Hybrid indexing preflight");
    console.table([
      {
        filesToAdd: report.filesToAdd,
        filesToDelete: report.filesToDelete,
        totalSize: this.formatBytes(report.totalBytes),
        largeFiles: report.largeFiles.length,
        largestFile: report.largestFile
          ? `${report.largestFile.path} (${this.formatBytes(report.largestFile.stat.size)})`
          : "-",
        sharedSnapshotSize: this.formatBytes(report.sharedSnapshotBytes),
        currentHybridIndexSize: this.formatBytes(report.currentHybridBytes),
        estimatedHybridIndexSize: this.formatBytes(report.estimatedHybridBytes),
        projectedQuotaUsage:
          report.projectedUsageRatio === null
            ? "n/a"
            : `${(report.projectedUsageRatio * 100).toFixed(1)}%`,
      },
    ]);
    console.groupEnd();

    const shouldNotice =
      this.shouldForceRefresh ||
      report.totalBytes >= DataManager.HYBRID_PRECHECK_NOTICE_BYTES ||
      report.largeFiles.length > 0 ||
      (report.projectedUsageRatio ?? 0) >= DataManager.HYBRID_QUOTA_WARN_RATIO;
    if (!shouldNotice) {
      return;
    }

    new MyNotice(this.buildHybridPreflightNotice(report), 12000);
  }

  private async buildHybridPreflightReport(
    currFiles: Map<string, TFile>,
    docsToAdd: TFile[],
    docsToDelete: string[],
    previousIndexedFileRefs?: ReadonlyMap<string, HybridIndexedFileRef>,
  ): Promise<HybridPreflightReport> {
    const currFileList = Array.from(currFiles.values());
    const totalBytes = currFileList.reduce(
      (sum, file) => sum + file.stat.size,
      0,
    );
    const largeFiles = currFileList.filter(
      (file) => file.stat.size >= DataManager.HYBRID_LARGE_FILE_BYTES,
    );
    const largestFile =
      largeFiles.length > 0
        ? largeFiles.reduce((max, file) =>
            file.stat.size > max.stat.size ? file : max,
          )
        : null;

    const storageUsage = await this.database.estimatePluginStorageUsage();
    const sharedSnapshotBytes = storageUsage.tables
      .filter((item) => item.name === "fileSnapshots")
      .reduce((sum, item) => sum + item.bytes, 0);
    const currentHybridBytes = storageUsage.tables
      .filter(
        (item) =>
          item.name === "hybridChunks" ||
          item.name === "hybridChunkVectors" ||
          item.name === "hybridBm25Index" ||
          item.name === "hybridHnswSmall" ||
          item.name === "hybridIndexedFileRefs",
      )
      .reduce((sum, item) => sum + item.bytes, 0);

    const existingHybridRefs =
      previousIndexedFileRefs !== undefined
        ? new Set(previousIndexedFileRefs.keys())
        : new Set(
            (await this.database.db.hybridIndexedFileRefs.toArray()).map(
              (ref) => ref.path,
            ),
          );
    const indexedSourceBytes = currFileList
      .filter((file) => existingHybridRefs.has(file.path))
      .reduce((sum, file) => sum + file.stat.size, 0);
    const ratioFromCurrent =
      indexedSourceBytes > 0 && currentHybridBytes > 0
        ? currentHybridBytes / indexedSourceBytes
        : DataManager.HYBRID_STORAGE_RATIO_FALLBACK;
    const estimatedRatio = Math.min(
      DataManager.HYBRID_STORAGE_RATIO_MAX,
      Math.max(DataManager.HYBRID_STORAGE_RATIO_MIN, ratioFromCurrent),
    );
    const estimatedHybridBytes = Math.round(totalBytes * estimatedRatio);

    const storageEstimate = await navigator.storage
      ?.estimate?.()
      .catch(() => null);
    const quotaBytes =
      storageEstimate && typeof storageEstimate.quota === "number"
        ? storageEstimate.quota
        : null;
    const usageBytes =
      storageEstimate && typeof storageEstimate.usage === "number"
        ? storageEstimate.usage
        : null;
    const projectedUsageRatio =
      quotaBytes && usageBytes !== null
        ? Math.min(
            1,
            (usageBytes - currentHybridBytes + estimatedHybridBytes) /
              quotaBytes,
          )
        : null;

    return {
      totalBytes,
      filesToAdd: docsToAdd.length,
      filesToDelete: docsToDelete.length,
      largeFiles,
      largestFile,
      sharedSnapshotBytes,
      estimatedHybridBytes,
      currentHybridBytes,
      projectedUsageRatio,
    };
  }

  private buildHybridPreflightNotice(report: HybridPreflightReport): string {
    const quotaText =
      report.projectedUsageRatio === null
        ? "IndexedDB quota: n/a"
        : `IndexedDB quota usage may reach ${(report.projectedUsageRatio * 100).toFixed(0)}%`;
    const largeFileText =
      report.largeFiles.length > 0
        ? `, ${report.largeFiles.length} large file(s)`
        : "";
    return `Hybrid indexing preflight: ${report.filesToAdd} file(s) to add/update, ${report.filesToDelete} to delete, vault ${this.formatBytes(report.totalBytes)}${largeFileText}, shared snapshots ${this.formatBytes(report.sharedSnapshotBytes)}, current hybrid index ${this.formatBytes(report.currentHybridBytes)}, estimated hybrid index ${this.formatBytes(report.estimatedHybridBytes)}. ${quotaText}. Large files will be indexed serially.`;
  }
  private async noticeDevStorageStats() {
    const indexableFiles = this.dataProvider.allFilesToBeIndexed();
    const indexableBytes = indexableFiles.reduce(
      (sum, file) => sum + file.stat.size,
      0,
    );
    const storageUsage = await this.database.estimatePluginStorageUsage();
    const rowsByName = new Map(
      storageUsage.tables.map((item) => [item.name, item.rows]),
    );
    const bytesByName = new Map(
      storageUsage.tables.map((item) => [item.name, item.bytes]),
    );
    const persistedLexicalSnapshotBytes =
      bytesByName.get("lexicalSearchSnapshots") ?? 0;
    const runtimeLexicalIndexBytes = this.lexicalEngine.estimateFileIndexBytes(
      persistedLexicalSnapshotBytes,
    );
    const lexicalIndexBreakdown = this.lexicalEngine.getFileIndexBreakdown();
    const lexicalRuntimeBreakdown = this.buildLexicalRuntimeBreakdown(
      lexicalIndexBreakdown,
      runtimeLexicalIndexBytes,
      indexableBytes,
    );
    const lexicalHeapDeltaNoticeLines = this.buildLexicalHeapDeltaNoticeLines(
      this.latestLexicalHeapDelta,
      runtimeLexicalIndexBytes,
    );
    const lexicalHeapDeltaRows = this.buildLexicalHeapDeltaRows(
      this.latestLexicalHeapDelta,
      runtimeLexicalIndexBytes,
    );
    const hybridRuntimeEstimate = this.hybridEngine.getRuntimeMemoryEstimate();
    const currentFileCacheBytes =
      this.fileSnapshotStore.estimateCurrentCacheBytes();
    const localOnlyHint =
      "Local-only: no embedding API, no rerank API, no token usage.";

    const persistedRows: DevStorageSummaryRow[] = [
      this.createDevStorageSummaryRow(
        "LexicalSnapshot",
        persistedLexicalSnapshotBytes,
        rowsByName.get("lexicalSearchSnapshots") ?? 0,
      ),
      this.createDevStorageSummaryRow(
        "SharedFileSnapshot",
        bytesByName.get("fileSnapshots") ?? 0,
        rowsByName.get("fileSnapshots") ?? 0,
      ),
      this.createDevStorageSummaryRow(
        "HybridChunk",
        bytesByName.get("hybridChunks") ?? 0,
        rowsByName.get("hybridChunks") ?? 0,
      ),
      this.createDevStorageSummaryRow(
        "VectorShard",
        bytesByName.get("hybridChunkVectors") ?? 0,
        rowsByName.get("hybridChunkVectors") ?? 0,
      ),
      this.createDevStorageSummaryRow(
        "HybridBM25",
        bytesByName.get("hybridBm25Index") ?? 0,
        rowsByName.get("hybridBm25Index") ?? 0,
      ),
      this.createDevStorageSummaryRow(
        "HybridHNSW",
        bytesByName.get("hybridHnswSmall") ?? 0,
        rowsByName.get("hybridHnswSmall") ?? 0,
      ),
    ];
    const runtimeRows: DevStorageSummaryRow[] = [
      this.createDevStorageSummaryRow(
        "LexicalRuntimeIndex",
        runtimeLexicalIndexBytes,
        "estimate",
      ),
      this.createDevStorageSummaryRow(
        "HybridRuntimeVectors",
        hybridRuntimeEstimate.vectorsBytes,
        "estimate",
      ),
      this.createDevStorageSummaryRow(
        "HybridRuntimeGraph",
        hybridRuntimeEstimate.graphBytes,
        "estimate",
      ),
      this.createDevStorageSummaryRow(
        "HybridRuntimeBm25",
        hybridRuntimeEstimate.bm25Bytes,
        "estimate",
      ),
      this.createDevStorageSummaryRow(
        "CurrentFileCache",
        currentFileCacheBytes,
        "estimate",
      ),
    ];
    const persistedListedBytes = persistedRows.reduce(
      (sum, row) => sum + row.bytes,
      0,
    );
    const persistedUnlistedBytes = Math.max(
      0,
      storageUsage.totalBytes - persistedListedBytes,
    );
    const runtimeTotalBytes = runtimeRows.reduce(
      (sum, row) => sum + row.bytes,
      0,
    );

    new MyNotice(
      `${this.buildDevStorageSummaryNotice(
        indexableBytes,
        storageUsage.totalBytes,
        runtimeTotalBytes,
        this.setting.hybrid.vectorCompression,
        persistedRows,
        runtimeRows,
        persistedUnlistedBytes,
        [
          ...lexicalRuntimeBreakdown.noticeLines,
          ...lexicalHeapDeltaNoticeLines,
        ],
      )}\n${localOnlyHint}`,
      15000,
    );

    console.groupCollapsed("[clever-search] dev storage and runtime stats");
    console.log(`Indexable vault size: ${this.formatBytes(indexableBytes)}`);
    console.log(
      `Current vector quantization: ${this.setting.hybrid.vectorCompression}`,
    );
    console.log(
      `Persisted total (all tables): ${this.formatBytes(storageUsage.totalBytes)}`,
    );
    if (persistedUnlistedBytes > 0) {
      console.log(
        `Persisted total includes ${this.formatBytes(persistedUnlistedBytes)} from refs/settings tables not listed below.`,
      );
    }
    console.log(
      `Runtime total (estimate): ${this.formatBytes(runtimeTotalBytes)}`,
    );
    if (lexicalRuntimeBreakdown.summaryLine) {
      console.log(`[clever-search] ${lexicalRuntimeBreakdown.summaryLine}`);
    }
    lexicalHeapDeltaNoticeLines.forEach((line) => {
      console.log(`[clever-search] ${line}`);
    });
    console.log("[clever-search] Persisted storage");
    console.table(persistedRows);
    console.log("[clever-search] Runtime memory estimate");
    console.table(runtimeRows);
    if (lexicalRuntimeBreakdown.rows.length > 0) {
      console.log(
        "[clever-search] Lexical runtime breakdown (exclusive segments)",
      );
      console.table(lexicalRuntimeBreakdown.rows);
    }
    if (lexicalHeapDeltaRows.length > 0) {
      console.log("[clever-search] Lexical heap delta");
      console.table(lexicalHeapDeltaRows);
    }
    console.log(`[clever-search] ${localOnlyHint}`);
    if (storageUsage.hybridChunkBreakdown) {
      console.table([
        {
          segment: "shared-snapshot-text",
          bytes: storageUsage.hybridChunkBreakdown.sharedSnapshotTextBytes,
          size: this.formatBytes(
            storageUsage.hybridChunkBreakdown.sharedSnapshotTextBytes,
          ),
        },
        {
          segment: "shared-snapshot-path",
          bytes: storageUsage.hybridChunkBreakdown.sharedSnapshotPathBytes,
          size: this.formatBytes(
            storageUsage.hybridChunkBreakdown.sharedSnapshotPathBytes,
          ),
        },
        {
          segment: "hybrid-chunk-metadata",
          bytes: storageUsage.hybridChunkBreakdown.chunkMetadataBytes,
          size: this.formatBytes(
            storageUsage.hybridChunkBreakdown.chunkMetadataBytes,
          ),
        },
      ]);
    }
    if (storageUsage.hybridVectorBreakdown) {
      console.table([
        {
          segment: "vector-shard-ids",
          bytes: storageUsage.hybridVectorBreakdown.chunkIdBytes,
          size: this.formatBytes(
            storageUsage.hybridVectorBreakdown.chunkIdBytes,
          ),
        },
        {
          segment: "vector-shard-data",
          bytes: storageUsage.hybridVectorBreakdown.vectorBytes,
          size: this.formatBytes(
            storageUsage.hybridVectorBreakdown.vectorBytes,
          ),
        },
        {
          segment: "vector-shard-scale",
          bytes: storageUsage.hybridVectorBreakdown.scaleBytes,
          size: this.formatBytes(storageUsage.hybridVectorBreakdown.scaleBytes),
        },
        {
          segment: "vector-shard-metadata",
          bytes: storageUsage.hybridVectorBreakdown.metadataBytes,
          size: this.formatBytes(
            storageUsage.hybridVectorBreakdown.metadataBytes,
          ),
        },
      ]);
    }
    if (storageUsage.hybridBm25Breakdown) {
      console.table([
        {
          segment: "bm25-header",
          bytes: storageUsage.hybridBm25Breakdown.headerBytes,
          size: this.formatBytes(storageUsage.hybridBm25Breakdown.headerBytes),
        },
        {
          segment: "bm25-term-text",
          bytes: storageUsage.hybridBm25Breakdown.termTextBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.termTextBytes,
          ),
        },
        {
          segment: "bm25-term-meta",
          bytes: storageUsage.hybridBm25Breakdown.termMetaBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.termMetaBytes,
          ),
        },
        {
          segment: "bm25-posting-header",
          bytes: storageUsage.hybridBm25Breakdown.postingHeaderBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.postingHeaderBytes,
          ),
        },
        {
          segment: "bm25-posting-doc-delta",
          bytes: storageUsage.hybridBm25Breakdown.postingDocDeltaBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.postingDocDeltaBytes,
          ),
        },
        {
          segment: "bm25-posting-tfNorm",
          bytes: storageUsage.hybridBm25Breakdown.postingTfNormBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.postingTfNormBytes,
          ),
        },
        {
          segment: "bm25-posting-pos-count",
          bytes: storageUsage.hybridBm25Breakdown.postingPositionCountBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.postingPositionCountBytes,
          ),
        },
        {
          segment: "bm25-posting-pos-delta",
          bytes: storageUsage.hybridBm25Breakdown.postingPositionDeltaBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.postingPositionDeltaBytes,
          ),
        },
        {
          segment: "bm25-doc-lengths",
          bytes: storageUsage.hybridBm25Breakdown.docLengthsBytes,
          size: this.formatBytes(
            storageUsage.hybridBm25Breakdown.docLengthsBytes,
          ),
        },
      ]);
      console.log(
        `[clever-search] HybridBM25 details: version=${storageUsage.hybridBm25Breakdown.version}, terms=${storageUsage.hybridBm25Breakdown.termCount}, postings=${storageUsage.hybridBm25Breakdown.postingCount}, postingsWithPositions=${storageUsage.hybridBm25Breakdown.postingsWithPositions}, termsWithPositions=${storageUsage.hybridBm25Breakdown.termsWithPositions}, positionValues=${storageUsage.hybridBm25Breakdown.positionValueCount}`,
      );
      console.table(storageUsage.hybridBm25Breakdown.topPositionHeavyTerms);
    }
    console.groupEnd();
  }

  private createDevStorageSummaryRow(
    category: string,
    bytes: number,
    rows: number | string,
  ): DevStorageSummaryRow {
    return {
      category,
      rows,
      bytes,
      size: this.formatBytes(bytes),
    };
  }

  private buildDevStorageSummaryNotice(
    indexableBytes: number,
    persistedTotalBytes: number,
    runtimeTotalBytes: number,
    precision: string,
    persistedRows: DevStorageSummaryRow[],
    runtimeRows: DevStorageSummaryRow[],
    persistedUnlistedBytes: number,
    lexicalNoticeLines: string[],
  ): string {
    return [
      `Dev stats`,
      `Indexable vault size: ${this.formatBytes(indexableBytes)}`,
      `Current vector quantization: ${precision}`,
      `Persisted total (all tables): ${this.formatBytes(persistedTotalBytes)}`,
      persistedUnlistedBytes > 0
        ? `Persisted total includes ${this.formatBytes(persistedUnlistedBytes)} from refs/settings tables not listed below.`
        : null,
      `Persisted storage`,
      this.formatDevStorageSummaryLine(persistedRows.slice(0, 3)),
      this.formatDevStorageSummaryLine(persistedRows.slice(3)),
      `Runtime memory estimate`,
      this.formatDevStorageSummaryLine(runtimeRows.slice(0, 3)),
      this.formatDevStorageSummaryLine(runtimeRows.slice(3)),
      ...lexicalNoticeLines,
      `Runtime total (estimate): ${this.formatBytes(runtimeTotalBytes)}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  private buildLexicalRuntimeBreakdown(
    breakdown: Record<string, unknown> | null,
    runtimeLexicalIndexBytes: number,
    indexableBytes: number,
  ): {
    noticeLines: string[];
    summaryLine: string | null;
    rows: DevStorageBreakdownRow[];
  } {
    if (!breakdown) {
      return {
        noticeLines: [],
        summaryLine: null,
        rows: [],
      };
    }

    const estimatedBytes = this.asRecord(breakdown.estimatedBytes);
    if (!estimatedBytes) {
      return {
        noticeLines: [],
        summaryLine: null,
        rows: [],
      };
    }

    const totalBytes =
      this.readNumber(estimatedBytes.total) ?? runtimeLexicalIndexBytes;
    const segments: Array<{ segment: string; bytes: number }> = [];
    const pushSegment = (segment: string, bytes: unknown) => {
      const numericBytes = this.readNumber(bytes);
      if (numericBytes === null || numericBytes <= 0) {
        return;
      }
      segments.push({ segment, bytes: numericBytes });
    };

    const documents = this.asRecord(estimatedBytes.documents);
    const documentIdentity = this.asRecord(estimatedBytes.documentIdentity);
    const pathToId = this.asRecord(documentIdentity?.pathToId);
    const idToPath = this.asRecord(documentIdentity?.idToPath);
    const docStoreById = this.asRecord(documentIdentity?.docStoreById);
    const bodyTokenLexicon = this.asRecord(documentIdentity?.bodyTokenLexicon);
    const bodyTokensById = this.asRecord(documentIdentity?.bodyTokensById);
    const bodyHanSegmentsById = this.asRecord(
      documentIdentity?.bodyHanSegmentsById,
    );
    const tagValuesById = this.asRecord(documentIdentity?.tagValuesById);
    const counter = this.asRecord(documentIdentity?.counter);
    const documentIdentityCoreBytes =
      (this.readNumber(pathToId?.total) ?? 0) +
      (this.readNumber(idToPath?.total) ?? 0) +
      (this.readNumber(docStoreById?.total) ?? 0) +
      (this.readNumber(counter?.numberBytes) ?? 0);

    pushSegment("stringPool", this.asRecord(estimatedBytes.stringPool)?.bytes);
    pushSegment("documents.store", documents?.total);
    pushSegment("documentIdentity.core", documentIdentityCoreBytes);
    pushSegment(
      "documentIdentity.bodyTokenLexicon",
      bodyTokenLexicon?.total,
    );
    pushSegment("doc.bodyTokens", bodyTokensById?.total);
    pushSegment("doc.bodyHanSegments", bodyHanSegmentsById?.total);
    pushSegment("doc.tagValues", tagValuesById?.total);
    pushSegment("lexicon", this.asRecord(estimatedBytes.lexicon)?.total);

    const postings = this.asRecord(estimatedBytes.postings);
    if (postings) {
      for (const [key, value] of Object.entries(postings)) {
        pushSegment(`postings.${key}`, this.asRecord(value)?.total);
      }
    }

    let accountedBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0);
    const unattributedBytes = Math.max(0, totalBytes - accountedBytes);
    if (unattributedBytes > 0) {
      pushSegment("other", unattributedBytes);
      accountedBytes += unattributedBytes;
    }

    const sortedSegments = segments.sort((left, right) => right.bytes - left.bytes);
    const rows = sortedSegments.slice(0, 10).map((segment) => ({
      segment: segment.segment,
      bytes: segment.bytes,
      size: this.formatBytes(segment.bytes),
      shareOfLexical: this.formatPercent(segment.bytes, totalBytes),
      shareOfVault: this.formatPercent(segment.bytes, indexableBytes),
    }));

    if (rows.length === 0 || totalBytes <= 0) {
      return {
        noticeLines: [],
        summaryLine: null,
        rows,
      };
    }

    const headline = `Coverage live index (exclusive): ${this.formatBytes(totalBytes)} (${this.formatPercent(totalBytes, indexableBytes)} of vault)`;
    const topLine = `Coverage top segments: ${sortedSegments
      .slice(0, 3)
      .map((segment) => `${segment.segment} ${this.formatBytes(segment.bytes)}`)
      .join(" | ")}`;
    const accountingLine = `Coverage accounted segments: ${this.formatBytes(accountedBytes)} / ${this.formatBytes(totalBytes)}`;

    return {
      noticeLines: [headline, topLine, accountingLine],
      summaryLine: `${headline}; ${topLine}; ${accountingLine}`,
      rows,
    };
  }

  private sampleJsHeapUsage(): JsHeapUsageSample | null {
    const memory = (
      performance as typeof performance & {
        memory?: {
          usedJSHeapSize?: number;
          totalJSHeapSize?: number;
          jsHeapSizeLimit?: number;
        };
      }
    ).memory;
    if (!memory) {
      return null;
    }
    const usedBytes = this.readNumber(memory.usedJSHeapSize);
    const totalBytes = this.readNumber(memory.totalJSHeapSize);
    const limitBytes = this.readNumber(memory.jsHeapSizeLimit);
    if (usedBytes === null || totalBytes === null || limitBytes === null) {
      return null;
    }
    return {
      usedBytes,
      totalBytes,
      limitBytes,
    };
  }

  private summarizeLexicalHeapDelta(
    before: JsHeapUsageSample | null,
    after: JsHeapUsageSample | null,
  ): LexicalHeapDeltaSummary | null {
    if (!before || !after) {
      return null;
    }
    return {
      beforeUsedBytes: before.usedBytes,
      afterUsedBytes: after.usedBytes,
      deltaBytes: after.usedBytes - before.usedBytes,
      totalBytes: after.totalBytes,
      limitBytes: after.limitBytes,
    };
  }

  private buildLexicalHeapDeltaNoticeLines(
    summary: LexicalHeapDeltaSummary | null,
    runtimeLexicalIndexBytes: number,
  ): string[] {
    if (!summary) {
      return [];
    }
    const deltaRelation =
      summary.deltaBytes > 0 && runtimeLexicalIndexBytes > 0
        ? ` (${this.formatPercent(summary.deltaBytes, runtimeLexicalIndexBytes)} of lexical runtime estimate)`
        : "";
    return [
      `Lexical heap delta (latest refresh): ${this.formatSignedBytes(summary.deltaBytes)}${deltaRelation}`,
      `JS heap used: ${this.formatBytes(summary.beforeUsedBytes)} -> ${this.formatBytes(summary.afterUsedBytes)} / ${this.formatBytes(summary.totalBytes)} (limit ${this.formatBytes(summary.limitBytes)})`,
    ];
  }

  private buildLexicalHeapDeltaRows(
    summary: LexicalHeapDeltaSummary | null,
    runtimeLexicalIndexBytes: number,
  ): Array<Record<string, string | number>> {
    if (!summary) {
      return [];
    }
    return [
      {
        metric: "heapUsedBeforeRefresh",
        bytes: summary.beforeUsedBytes,
        size: this.formatBytes(summary.beforeUsedBytes),
      },
      {
        metric: "heapUsedAfterRefresh",
        bytes: summary.afterUsedBytes,
        size: this.formatBytes(summary.afterUsedBytes),
      },
      {
        metric: "heapDeltaAfterRefresh",
        bytes: summary.deltaBytes,
        size: this.formatSignedBytes(summary.deltaBytes),
        ratioVsLexicalEstimate:
          summary.deltaBytes > 0 && runtimeLexicalIndexBytes > 0
            ? this.formatPercent(summary.deltaBytes, runtimeLexicalIndexBytes)
            : "n/a",
      },
      {
        metric: "heapCapacityNow",
        bytes: summary.totalBytes,
        size: this.formatBytes(summary.totalBytes),
      },
      {
        metric: "heapLimit",
        bytes: summary.limitBytes,
        size: this.formatBytes(summary.limitBytes),
      },
    ];
  }

  private formatDevStorageSummaryLine(rows: DevStorageSummaryRow[]): string {
    return rows.map((row) => `${row.category} ${row.size}`).join(" | ");
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private formatPercent(part: number, whole: number): string {
    if (!(whole > 0) || !(part >= 0)) {
      return "n/a";
    }
    return `${((part / whole) * 100).toFixed(1)}%`;
  }

  private formatSignedBytes(bytes: number): string {
    if (bytes > 0) {
      return `+${this.formatBytes(bytes)}`;
    }
    if (bytes < 0) {
      return `-${this.formatBytes(Math.abs(bytes))}`;
    }
    return this.formatBytes(0);
  }

  private formatBytes(bytes: number): string {
    return formatBytesLabel(bytes);
  }
}
