import { Notice, TFile, type TAbstractFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import type {
  BaseIndexedFileRef,
  DocRef,
  FileItemFreshnessReason,
  FileItemFreshnessState,
  FileItemSnapshotSource,
  IndexedDocument,
} from "src/globals/search-types";
import type CleverSearch from "src/main";
import {
  Database,
  LEXICAL_QUERY_EVIDENCE_READY_VERSION,
  type DatabaseOpenRecoveryReport,
  type DocRegistryRow,
  type LexicalColdEvidenceStorageBreakdown,
} from "src/services/database/database";

import {
  HybridDisabledError,
  NoApiKeyError,
  WeeklyTokenLimitExceededError,
} from "src/services/search/hybrid/embedder";
import {
  getHybridProfileMetric,
  profileHybridStage,
} from "src/services/search/hybrid/hybrid-profiler";
import type {
  ChunkRow,
  ChunkVectorShardRow,
  HybridFileSnapshotRow,
  HybridIndexedFileRef,
} from "src/services/search/hybrid/hybrid-store";
import {
  analyzeHybridStoredFileConsistency,
  normalizeHybridIndexedFileState,
  type HybridStoredVectorInfo,
} from "src/services/search/hybrid/hybrid-consistency";
import { hashStableText } from "src/services/search/hybrid/incremental-reuse";
import {
  retryAsync,
  runWeightedTasks,
} from "src/services/search/hybrid/runtime-control";
import type { FileSearchEngine } from "src/services/search/file-search-engine";
import type { VectorPrecision } from "src/services/search/hybrid/hybrid-types";
import { LexicalEngine } from "src/services/search/lexical-engine";
import type {
  PersistentFileIndexRecoveryPlan,
  SerializedFileSearchIndex,
} from "src/services/search/file-search-engine";
import type { CoverageLexicalV3RuntimeMemoryBreakdown } from "src/services/search/coverage-lexical-v3";
import { type FileSnapshotRuntimeMemoryEstimate, FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { Tokenizer } from "src/services/search/tokenizer";
import { eventBus, type EventCallback } from "src/utils/event-bus";
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
  fromLexicalMutationJournalRow,
  fromPendingDocOperationRow,
  DocDeleteOperation,
  DocMoveOperation,
  type FlushedDocOperationBatch,
  type DocOperation,
  DocUpsertOperation,
  type LexicalMutationJournalRow,
  type PendingDocOperationRow,
  type ReducedDocOperationBatch,
  reduceDocOperations,
  toLexicalMutationJournalRow,
  toPendingDocOperationRow,
  DocOperationBuffer,
} from "./doc-operation-buffer";
import { FileWatcher } from "./file-watcher";
import {
  buildIndexRecoveryStateId,
  type HybridRepairMode,
  type IndexRecoveryStateRow,
} from "./index-recovery-state";
import { buildIndexArtifactStateId } from "./index-artifact-state";
import { DirtyArtifactCoordinator } from "./dirty-artifact-coordinator";
import {
  HybridBootstrapCoordinator,
  type HybridBootstrapPlan,
  type HybridBootstrapRepairTask as HybridRepairTask,
  type HybridIndexFailure,
  type HybridIndexProgress,
  type HybridProgressReporter,
  type HybridBootstrapSummary,
} from "./hybrid-bootstrap-coordinator";
import { HybridRecoveryCoordinator } from "./hybrid-recovery-coordinator";
import type { HybridFailedEmbeddingSummary } from "./hybrid-embedding-recovery-manager";
import {
  buildHybridAvailabilityState,
  buildLexicalAvailabilityState,
  resolveHybridHealthSummaryState,
} from "./search-availability";
import type {
  HybridAvailabilityState,
  HybridHealthSummaryState,
  LexicalAvailabilityState,
  SearchBootstrapState,
} from "./search-availability";

type LexicalIndexFailure = IndexedDocumentFailure;

type LexicalAddDocumentsResult = {
  indexedFiles: TFile[];
  failures: LexicalIndexFailure[];
};

type LexicalStartupMove = {
  oldPath: string;
  file: TFile;
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
  previousDocRegistryEntries: Map<string, DocRegistryRow>;
};

type HybridStoredPathSummary = {
  chunkCount: number;
  currentSnapshotGeneration?: number;
  shadowSnapshotGeneration?: number;
  vectorInfo?: HybridStoredVectorInfo;
  indexedFileRef?: HybridIndexedFileRef;
};

type HybridStoredPathInspection = {
  summary: HybridStoredPathSummary;
  consistency: ReturnType<typeof analyzeHybridStoredFileConsistency>;
};

type HybridRuntimeQueryGateState = "blocked" | "open";
export type {
  HybridAvailabilityState,
  HybridHealthSummaryState,
  LexicalAvailabilityState,
  SearchBootstrapState,
};

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
  persistentRecoveryPlan?: PersistentFileIndexRecoveryPlan | null;
};

export type HybridDeferredEmbeddingSummary = {
  deferredCount: number;
  nextEligibleAt: number | null;
  totalFiles: number;
};

type HybridRefreshOptions = {
  forceRefresh?: boolean;
  syncFileSetWithoutEmbedding?: boolean;
};

type DataManagerInitOptions = {
  suppressCompletionNotice?: boolean;
};

type HybridRefreshResult = {
  hadWork: boolean;
  failedFiles: number;
  fallbackNoticeKey: LocaleKey | null;
};

type SearchBootstrapCompletionSummary = {
  databaseUpgradeDetected: boolean;
  lexicalRebuilt: boolean;
  hybridWorked: boolean;
  hybridFailed: boolean;
};

export type HybridFreshnessSummary = {
  processingFileCount: number;
  staleFileCount: number;
  repairFileCount: number;
  totalTrackedFiles: number;
  processingSamplePaths: string[];
  staleSamplePaths: string[];
  repairSamplePaths: string[];
  updatedAt: number;
};

export type HybridFileFreshness = {
  state: FileItemFreshnessState;
  reason: FileItemFreshnessReason;
  snapshotGeneration?: number;
  snapshotSource: FileItemSnapshotSource;
};

type HybridFreshnessSnapshot = {
  trackedFiles: readonly TFile[];
  processingPathSet: Set<string>;
  stalePathSet: Set<string>;
  repairPaths: Set<string>;
  repairSamplePaths: string[];
};

export type HybridHealthSummary = {
  state: HybridHealthSummaryState;
  trackedFileCount: number;
  storedPathCount: number;
  indexedFileRefCount: number;
  readyFileCount: number;
  lexicalOnlyFileCount: number;
  unstableFileCount: number;
  processingFileCount: number;
  staleFileCount: number;
  repairFileCount: number;
  processingSamplePaths: string[];
  staleSamplePaths: string[];
  repairSamplePaths: string[];
  currentAlignedSnapshotCount: number;
  shadowAlignedSnapshotCount: number;
  shadowMismatchCount: number;
  shadowMismatchSamplePaths: string[];
  failedEmbeddingCount: number;
  deferredEmbeddingCount: number;
  updatedAt: number;
};

const HYBRID_FRESHNESS_SAMPLE_LIMIT = 3;
const HYBRID_HEALTH_SAMPLE_LIMIT = 5;

function appendPathSample(
  samples: string[],
  path: string,
  limit: number,
): void {
  if (samples.length >= limit || samples.includes(path)) {
    return;
  }
  samples.push(path);
}

function hasStoredHybridPathData(summary: HybridStoredPathSummary): boolean {
  return (
    summary.chunkCount > 0 ||
    summary.currentSnapshotGeneration !== undefined ||
    summary.shadowSnapshotGeneration !== undefined ||
    summary.vectorInfo !== undefined ||
    summary.indexedFileRef !== undefined
  );
}

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

type LexicalIndexProgress = {
  processedFiles: number;
  totalFiles: number;
};

class LexicalIndexProgressNotice {
  private readonly notice: MyNotice;

  constructor(progress: LexicalIndexProgress) {
    this.notice = new MyNotice(this.buildMessage(progress), 0);
  }

  update(progress: LexicalIndexProgress): void {
    this.notice.setText(this.buildMessage(progress));
  }

  hide(): void {
    this.notice.hide();
  }

  private buildMessage(progress: LexicalIndexProgress): string {
    return `${t("searchNotice.lexicalIndexingProgressPrefix")}${progress.processedFiles} / ${progress.totalFiles}${t("searchNotice.lexicalIndexingProgressSuffix")}`;
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
  private static readonly LEXICAL_REINDEX_MAX_BYTES = 8 * 1024 * 1024;
  private static readonly HYBRID_LARGE_FILE_BYTES = 1024 * 1024;
  private static readonly HYBRID_PRECHECK_NOTICE_BYTES = 64 * 1024 * 1024;
  private static readonly HYBRID_QUOTA_WARN_RATIO = 0.7;
  private static readonly HYBRID_STORAGE_RATIO_FALLBACK = 1.6;
  private static readonly HYBRID_STORAGE_RATIO_MIN = 0.8;
  private static readonly HYBRID_STORAGE_RATIO_MAX = 4.0;
  private static readonly HYBRID_IN_FLIGHT_BYTES_BUDGET = 4 * 1024 * 1024;
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
  private tokenizer = getInstance(Tokenizer);
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
  private hybridRuntimeQueryGate: HybridRuntimeQueryGateState = "blocked";
  private lexicalBootstrapState: SearchBootstrapState = "blocked";
  private hybridBootstrapState: SearchBootstrapState = "blocked";
  private searchBootstrapMetrics: SearchBootstrapMetrics | null = null;
  private searchBootstrapCommitTask: Promise<void> | null = null;
  private readonly hybridRepairQueue = new Map<string, HybridRepairTask>();
  private readonly hybridRepairInFlightPaths = new Set<string>();
  private readonly hybridRepairPendingPersistPaths = new Set<string>();
  private hybridRepairFlushTimer: NodeJS.Timeout | null = null;
  private hybridRepairWorker: Promise<void> | null = null;
  private lastHybridStaleWarnSignature: string | null = null;
  private readonly recentlyVerifiedHybridIndexedRefs = new Map<
    string,
    { generation: number; verifiedAt: number }
  >();
  private hybridFreshnessMaintenanceTask: Promise<void> | null = null;
  private hybridFreshnessMaintenanceQueued = false;
  private inVaultSearchFlushCallback: EventCallback | null = null;
  private lexicalIndexFailureNotice: Notice | null = null;
  private lexicalFailureRetryInFlight = false;
  private lexicalStartupFailureRetryPending = false;
  private lexicalStartupPendingOperations: DocOperation[] = [];
  private isUnloaded = false;
  private readonly lexicalIndexFailuresByPath = new Map<
    string,
    LexicalIndexFailure
  >();
  private latestLexicalHeapDelta: unknown | null = null;
  private readonly hybridRecoveryCoordinator = new HybridRecoveryCoordinator({
    canRetryPath: (path) => this.canRetryHybridEmbeddingPath(path),
    enqueueRepair: (task) => this.enqueueHybridRepair(task),
    onChanged: () => this.notifyHybridRuntimeStatusChanged(),
    getFailedEmbeddingRetryIntervalMs: () =>
      this.getFailedEmbeddingRetryIntervalMs(),
  });
  private readonly hybridBootstrapCoordinator = new HybridBootstrapCoordinator({
    dataProvider: this.dataProvider,
    hybridEngine: this.hybridEngine,
    shouldForceRefresh: () => this.shouldForceRefresh,
    blockRuntimeQueryGate: () => this.blockHybridRuntimeQueryGate(),
    syncRuntimeQueryGate: () => this.syncHybridRuntimeQueryGateFromEngine(),
    repairStoredState: (currFiles) => this.repairHybridStoredState(currFiles),
    restorePersistedRecoveryState: (currFiles, previousIndexedFileRefs) =>
      this.restorePersistedHybridRecoveryState(
        currFiles,
        previousIndexedFileRefs,
      ),
    runPreflight: (
      currFiles,
      docsToAdd,
      docsToDelete,
      previousIndexedFileRefs,
    ) =>
      this.runHybridPreflight(
        currFiles,
        docsToAdd,
        docsToDelete,
        previousIndexedFileRefs,
      ),
    createProgressNotice: (docsToAdd, repairedPaths) =>
      this.createHybridIndexProgressNotice(docsToAdd, repairedPaths),
    runRepairTasks: (tasks, progressNotice, repairedPaths, failures) =>
      this.runHybridRepairTasks(tasks, progressNotice, repairedPaths, failures),
    enqueuePersistedRecoveryStates: (skipPaths) =>
      this.enqueuePersistedHybridRecoveryStates(skipPaths),
    noticeHybridIndexFailures: (failures) =>
      this.noticeHybridIndexFailures(failures),
    getHybridIndexConcurrency: () => this.getHybridIndexConcurrency(),
  });
  private get hybridEngine() {
    return getInstance(SearchService).hybridEngine;
  }

  private hasIncompleteHybridEmbeddings(): boolean {
    if (!this.hybridEngine.isEnabled()) {
      return false;
    }
    if (this.hybridRecoveryCoordinator.hasFailures()) {
      return true;
    }
    return (
      this.hybridRecoveryCoordinator.getDeferredSummary(
        this.countHybridTrackedFiles(),
      ).deferredCount > 0
    );
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

  async getHybridFreshnessSummary(): Promise<HybridFreshnessSummary> {
    return this.buildHybridFreshnessSummary(
      await this.collectHybridFreshnessSnapshot(),
    );
  }

  async getHybridFileFreshness(
    path: string,
  ): Promise<HybridFileFreshness> {
    return (
      await this.getHybridFileFreshnessMap([path])
    ).get(path) ?? {
      state: "lexical_only",
      reason: "shadow_missing",
      snapshotGeneration: undefined,
      snapshotSource: "live",
    };
  }

  async getHybridFileFreshnessMap(
    paths: readonly string[],
  ): Promise<Map<string, HybridFileFreshness>> {
    const uniquePaths = Array.from(
      new Set(paths.filter((path) => path.trim().length > 0)),
    );
    const freshnessByPath = new Map<string, HybridFileFreshness>();
    if (uniquePaths.length === 0) {
      return freshnessByPath;
    }

    const indexedRefs = await this.fileSnapshotStore.getHybridIndexedFileRefs(
      uniquePaths,
    );
    const pendingDocOperations = this.docOperationsBuffer.peekReducedBatch();
    const pendingDirtyPaths = new Set(
      pendingDocOperations.dirtyPaths.map((operation) => operation.path),
    );

    for (const path of uniquePaths) {
      freshnessByPath.set(
        path,
        await this.resolveHybridFileFreshness(
          path,
          indexedRefs.get(path),
          pendingDirtyPaths,
        ),
      );
    }

    return freshnessByPath;
  }

  private async collectHybridFreshnessSnapshot(): Promise<HybridFreshnessSnapshot> {
    const trackedFiles = this.getHybridTrackedFiles();
    if (!this.hybridEngine.isEnabled() || trackedFiles.length === 0) {
      return {
        trackedFiles,
        processingPathSet: new Set<string>(),
        stalePathSet: new Set<string>(),
        repairPaths: new Set<string>(),
        repairSamplePaths: [],
      };
    }

    const repairPaths = new Set(this.hybridRecoveryCoordinator.listFailurePaths());
    const deferredPaths = new Set(this.hybridRecoveryCoordinator.listDeferredPaths());
    const pendingDocOperations = this.docOperationsBuffer.peekReducedBatch();
    const processingPaths = new Set<string>([
      ...this.hybridRepairQueue.keys(),
      ...this.hybridRepairInFlightPaths,
      ...this.hybridRepairPendingPersistPaths,
      ...deferredPaths,
      ...repairPaths,
      ...pendingDocOperations.dirtyPaths.map((operation) => operation.path),
    ]);
    const indexedRefs = await this.fileSnapshotStore.getHybridIndexedFileRefs(
      trackedFiles.map((file) => file.path),
    );

    const processingPathSet = new Set<string>();
    const stalePathSet = new Set<string>();
    const repairSamplePaths: string[] = [];
    for (let index = 0; index < trackedFiles.length; index++) {
      const file = trackedFiles[index];
      const path = file.path;
      if (repairPaths.has(path)) {
        appendPathSample(
          repairSamplePaths,
          path,
          HYBRID_FRESHNESS_SAMPLE_LIMIT,
        );
      }
      const indexedRef = indexedRefs.get(path);
      const needsSync =
        !indexedRef ||
        indexedRef.generation === undefined ||
        file.stat.mtime > indexedRef.generation;
      const recentlyVerified = this.recentlyVerifiedHybridIndexedRefs.get(path);
      if (
        !indexedRef &&
        recentlyVerified &&
        recentlyVerified.generation === file.stat.mtime &&
        Date.now() - recentlyVerified.verifiedAt <= 5 * 60_000
      ) {
        logger.warn(
          `hybrid indexed file ref disappeared after successful verification for ${path}: generation=${recentlyVerified.generation}, verifiedAt=${new Date(recentlyVerified.verifiedAt).toISOString()}`,
        );
      }
      if (!needsSync) {
        if (
          recentlyVerified &&
          indexedRef?.generation === recentlyVerified.generation
        ) {
          this.recentlyVerifiedHybridIndexedRefs.delete(path);
        }
        continue;
      }
      if (processingPaths.has(path)) {
        processingPathSet.add(path);
        continue;
      }
      stalePathSet.add(path);
    }

    return {
      trackedFiles,
      processingPathSet,
      stalePathSet,
      repairPaths,
      repairSamplePaths,
    };
  }

  private buildHybridFreshnessSummary(
    snapshot: HybridFreshnessSnapshot,
  ): HybridFreshnessSummary {
    const processingPaths = Array.from(snapshot.processingPathSet);
    const stalePaths = Array.from(snapshot.stalePathSet);
    return {
      processingFileCount: snapshot.processingPathSet.size,
      staleFileCount: snapshot.stalePathSet.size,
      repairFileCount: snapshot.repairPaths.size,
      totalTrackedFiles: snapshot.trackedFiles.length,
      processingSamplePaths: processingPaths.slice(
        0,
        HYBRID_FRESHNESS_SAMPLE_LIMIT,
      ),
      staleSamplePaths: stalePaths.slice(0, HYBRID_FRESHNESS_SAMPLE_LIMIT),
      repairSamplePaths: snapshot.repairSamplePaths,
      updatedAt: Date.now(),
    };
  }

  private async resolveHybridFileFreshness(
    path: string,
    indexedRef: HybridIndexedFileRef | undefined,
    pendingDirtyPaths: ReadonlySet<string>,
  ): Promise<HybridFileFreshness> {
    if (
      !this.hybridEngine.isEnabled() ||
      !this.hybridEngine.shouldIndexPath(path)
    ) {
      return {
        state: "lexical_only",
        reason: "none",
        snapshotGeneration: undefined,
        snapshotSource: "live",
      };
    }

    const file = this.dataProvider.getFileByPath(path);
    const indexedGeneration = indexedRef?.generation;
    const needsSync =
      !file ||
      indexedGeneration === undefined ||
      file.stat.mtime > indexedGeneration;

    if (!needsSync) {
      return {
        state: "fresh",
        reason: "none",
        snapshotGeneration: indexedGeneration,
        snapshotSource: "live",
      };
    }

    const availability = await this.fileSnapshotStore.inspectIndexedTextAvailability(
      path,
      indexedGeneration,
    );
    const recoveryEntry = this.hybridRecoveryCoordinator.getEntry(path);
    const isDeferred = recoveryEntry?.recoveryKind === "deferred_embedding";
    const isFailure = recoveryEntry?.recoveryKind === "failure";
    const hasShadowSnapshot =
      availability.shadowGeneration !== undefined &&
      availability.shadowGenerationMatch;
    const isProcessing = this.isHybridPathProcessing(path, pendingDirtyPaths);

    if (
      file &&
      indexedGeneration !== undefined &&
      file.stat.mtime > indexedGeneration &&
      hasShadowSnapshot &&
      !isFailure &&
      (isProcessing || isDeferred)
    ) {
      return {
        state: "stale_grace",
        reason:
          isDeferred &&
          recoveryEntry?.nextRetryAt !== null &&
          recoveryEntry?.nextRetryAt !== undefined &&
          recoveryEntry.nextRetryAt > Date.now()
            ? "embedding_wait_interval"
            : "embedding_updating",
        snapshotGeneration: indexedGeneration,
        snapshotSource: "shadow",
      };
    }

    return {
      state: "lexical_only",
      reason: isFailure ? "embedding_failed" : "shadow_missing",
      snapshotGeneration: indexedGeneration,
      snapshotSource: "live",
    };
  }

  private isHybridPathProcessing(
    path: string,
    pendingDirtyPaths: ReadonlySet<string>,
  ): boolean {
    return (
      this.hybridRepairQueue.has(path) ||
      this.hybridRepairInFlightPaths.has(path) ||
      this.hybridRepairPendingPersistPaths.has(path) ||
      pendingDirtyPaths.has(path)
    );
  }

  private warnOnHybridStaleFiles(
    staleFileCount: number,
    staleSamplePaths: readonly string[],
  ): void {
    if (staleFileCount === 0) {
      this.lastHybridStaleWarnSignature = null;
      return;
    }

    const signature = `${staleFileCount}:${staleSamplePaths.join("|")}`;
    if (signature === this.lastHybridStaleWarnSignature) {
      return;
    }
    this.lastHybridStaleWarnSignature = signature;
    logger.warn("hybrid freshness detected stale files outside repair flow:", {
      staleFileCount,
      staleSamplePaths: [...staleSamplePaths],
    });
  }

  async flushPendingDocOperations(): Promise<void> {
    if (this.isUnloaded) {
      return;
    }
    await getInstance(FileWatcher).flushPendingModifications();
    await this.docOperationsBuffer.forceFlush();
  }

  private async maintainHybridFreshness(): Promise<void> {
    if (this.isUnloaded) {
      return;
    }
    if (this.hybridFreshnessMaintenanceTask) {
      this.hybridFreshnessMaintenanceQueued = true;
      await this.hybridFreshnessMaintenanceTask;
      return;
    }

    do {
      this.hybridFreshnessMaintenanceQueued = false;
      const task = this.runHybridFreshnessMaintenance();
      this.hybridFreshnessMaintenanceTask = task;
      try {
        await task;
      } finally {
        this.hybridFreshnessMaintenanceTask = null;
      }
    } while (this.hybridFreshnessMaintenanceQueued && !this.isUnloaded);
  }

  private async runHybridFreshnessMaintenance(): Promise<void> {
    const snapshot = await this.collectHybridFreshnessSnapshot();
    const stalePaths = Array.from(snapshot.stalePathSet);
    const staleSamplePaths = stalePaths.slice(0, HYBRID_FRESHNESS_SAMPLE_LIMIT);
    this.warnOnHybridStaleFiles(stalePaths.length, staleSamplePaths);
    if (stalePaths.length === 0) {
      return;
    }
    this.reconcileHybridStalePaths(stalePaths, snapshot.trackedFiles);
  }

  private reconcileHybridStalePaths(
    stalePaths: readonly string[],
    trackedFiles: readonly TFile[],
  ): string[] {
    if (stalePaths.length === 0) {
      return [];
    }
    const trackedFilesByPath = new Map(
      trackedFiles.map((file) => [file.path, file] as const),
    );
    const enqueuedPaths: string[] = [];
    for (const path of stalePaths) {
      const file = trackedFilesByPath.get(path);
      if (!file) {
        continue;
      }
      this.enqueueHybridRepair({
        path,
        mode: "incremental",
        reason: "freshness-reconcile-stale",
        sourceGeneration: file.stat.mtime,
        notifyRuntimeStatusChanged: false,
      });
      enqueuedPaths.push(path);
    }
    if (enqueuedPaths.length > 0) {
      this.notifyHybridRuntimeStatusChanged();
    }
    return enqueuedPaths;
  }

  async getHybridHealthSummary(): Promise<HybridHealthSummary> {
    const summaries = await this.collectHybridStoredPathSummaries();
    const freshnessSummary = await this.getHybridFreshnessSummary();
    const failedEmbeddingSummary = this.getHybridFailedEmbeddingSummary();
    const deferredEmbeddingSummary = await this.getHybridDeferredEmbeddingSummary();
    const trackedPaths = new Set(
      this.getHybridTrackedFiles().map((file) => file.path),
    );
    const currentPrecision =
      this.setting.hybrid.vectorCompression === "float16" ? "float16" : "int8";

    let indexedFileRefCount = 0;
    let readyFileCount = 0;
    let lexicalOnlyFileCount = 0;
    let unstableFileCount = 0;
    let currentAlignedSnapshotCount = 0;
    let shadowAlignedSnapshotCount = 0;
    let shadowMismatchCount = 0;
    const shadowMismatchSamplePaths: string[] = [];

    for (const [path, summary] of summaries) {
      const consistency = analyzeHybridStoredFileConsistency({
        existsInVault: trackedPaths.has(path),
        hasChunks: summary.chunkCount > 0,
        chunkCount: summary.chunkCount,
        snapshot:
          summary.currentSnapshotGeneration !== undefined
            ? { generation: summary.currentSnapshotGeneration }
            : undefined,
        shadowSnapshot:
          summary.shadowSnapshotGeneration !== undefined
            ? { generation: summary.shadowSnapshotGeneration }
            : undefined,
        vectorInfo: summary.vectorInfo,
        indexedFileRef: summary.indexedFileRef,
        currentPrecision,
      });
      const healthBlockingReasons = consistency.reuseBlockedReasons.filter(
        (reason) =>
          reason !== "snapshot_generation_mismatch" &&
          reason !== "vector_generation_mismatch",
      );

      if (summary.indexedFileRef) {
        indexedFileRefCount += 1;
      }

      if (healthBlockingReasons.length === 0) {
        if (consistency.indexedFileState === "ready") {
          readyFileCount += 1;
        } else if (consistency.indexedFileState === "lexical_only") {
          lexicalOnlyFileCount += 1;
        } else if (
          consistency.indexedFileState === "pending" ||
          consistency.indexedFileState === "failed"
        ) {
          unstableFileCount += 1;
        }
      } else if (hasStoredHybridPathData(summary)) {
        unstableFileCount += 1;
      }

      const indexedGeneration = summary.indexedFileRef?.generation;
      if (indexedGeneration !== undefined) {
        if (summary.currentSnapshotGeneration === indexedGeneration) {
          currentAlignedSnapshotCount += 1;
        } else if (summary.shadowSnapshotGeneration === indexedGeneration) {
          shadowAlignedSnapshotCount += 1;
        }
      }

      if (
        summary.shadowSnapshotGeneration !== undefined &&
        indexedGeneration !== undefined &&
        summary.shadowSnapshotGeneration !== indexedGeneration
      ) {
        shadowMismatchCount += 1;
        appendPathSample(
          shadowMismatchSamplePaths,
          path,
          HYBRID_HEALTH_SAMPLE_LIMIT,
        );
      }
    }

    const state = resolveHybridHealthSummaryState({
      enabled: this.hybridEngine.isEnabled(),
      trackedFileCount: freshnessSummary.totalTrackedFiles,
      storedPathCount: summaries.size,
      indexedFileRefCount,
      readyFileCount,
      lexicalOnlyFileCount,
      unstableFileCount,
      processingFileCount: freshnessSummary.processingFileCount,
      staleFileCount: freshnessSummary.staleFileCount,
      repairFileCount: freshnessSummary.repairFileCount,
      shadowAlignedSnapshotCount,
      shadowMismatchCount,
    });

    return {
      state,
      trackedFileCount: freshnessSummary.totalTrackedFiles,
      storedPathCount: summaries.size,
      indexedFileRefCount,
      readyFileCount,
      lexicalOnlyFileCount,
      unstableFileCount,
      processingFileCount: freshnessSummary.processingFileCount,
      staleFileCount: freshnessSummary.staleFileCount,
      repairFileCount: freshnessSummary.repairFileCount,
      processingSamplePaths: freshnessSummary.processingSamplePaths,
      staleSamplePaths: freshnessSummary.staleSamplePaths,
      repairSamplePaths: freshnessSummary.repairSamplePaths,
      currentAlignedSnapshotCount,
      shadowAlignedSnapshotCount,
      shadowMismatchCount,
      shadowMismatchSamplePaths,
      failedEmbeddingCount: failedEmbeddingSummary.failedCount,
      deferredEmbeddingCount: deferredEmbeddingSummary.deferredCount,
      updatedAt: Date.now(),
    };
  }

  private countHybridTrackedFiles(): number {
    return this.getHybridTrackedFiles().length;
  }

  private getHybridTrackedFiles(): TFile[] {
    if (!this.hybridEngine.isEnabled()) {
      return [];
    }
    return this.plugin.app.vault
      .getFiles()
      .filter(
        (file) =>
          this.dataProvider.isIndexable(file) &&
          this.hybridEngine.shouldIndexPath(file.path),
      );
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
    await this.database.clearLexicalQueryEvidenceReadyMarker();
    await this.lexicalSnapshotCoordinator.markDirty(paths);
  }

  private async invalidateLexicalQueryEvidenceReadyMarker(): Promise<void> {
    await this.database.clearLexicalQueryEvidenceReadyMarker();
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
    batch: FlushedDocOperationBatch,
  ) => {
    if (this.isUnloaded) {
      return;
    }
    const { rawOperations, reducedBatch: operations } = batch;
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

    await this.maintainHybridFreshness();
    const persistedOperationIds = rawOperations.map((operation) => operation.id);
    await this.deletePersistedPendingLexicalDocOperations(persistedOperationIds);
    await this.deletePersistedLexicalMutationJournalEntries(persistedOperationIds);
  };

  private docOperationsBuffer = new DocOperationBuffer(
    this.docOperationsHandler,
    3,
  );

  @monitorDecorator
  async initAsync(options: DataManagerInitOptions = {}) {
    this.isUnloaded = false;
    this.lexicalStartupFailureRetryPending = false;
    this.lexicalStartupPendingOperations = [];
    this.clearHybridFailedEmbeddingState();
    this.resetLexicalSnapshotTracking();
    this.fileSnapshotStore.resetRuntimeState();
    this.lexicalIndexedFileRefsLoaded = false;
    this.lexicalIndexedFileRefsByPath.clear();
    this.setHybridRuntimeQueryGate("blocked");
    this.beginSearchBootstrapRun();
    try {
      const bootstrapSummary = await this.runSearchBootstrapPipeline();
      this.kickOffSearchBootstrapCommit();
      if (!options.suppressCompletionNotice) {
        this.noticeSearchBootstrapCompletion(bootstrapSummary);
      }
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
    this.isUnloaded = true;
    getInstance(FileWatcher).stop();
    this.removeInVaultSearchFlushListener();
    this.docOperationsBuffer.dispose();
    this.clearLexicalSnapshotFlushTimer();
    this.clearHybridRepairScheduler();
    this.hybridFreshnessMaintenanceTask = null;
    this.hybridFreshnessMaintenanceQueued = false;
    this.lastHybridStaleWarnSignature = null;
    this.clearHybridFailedEmbeddingState();
    this.hideLexicalIndexFailureNotice();
    this.lexicalIndexFailuresByPath.clear();
    this.lexicalStartupFailureRetryPending = false;
    this.lexicalStartupPendingOperations = [];
    this.searchBootstrapCommitTask = null;
    this.setLexicalBootstrapState("blocked");
    this.setHybridBootstrapState("blocked");
  }

  receiveDocOperation(operation: DocOperation) {
    if (this.isUnloaded) {
      return;
    }
    this.docOperationsBuffer.add(operation);
    void this.persistPendingLexicalDocOperation(operation);
    void this.persistLexicalMutationJournalEntry(operation);
  }

  private async runSearchBootstrapPipeline(): Promise<SearchBootstrapCompletionSummary> {
    const openReport = await this.database.openAndConsumeSchemaUpgradeReport();
    if (openReport.recovery) {
      this.notifyDatabaseOpenRecovery(openReport.recovery);
    }
    const databaseUpgradeDetected = openReport.schemaUpgradeDetected;
    if (databaseUpgradeDetected) {
      await this.database.clearLexicalQueryEvidenceReadyMarker();
    }
    this.setLexicalBootstrapState("restoring");
    this.markSearchBootstrapPhaseStarted("lexical", "restore");
    const lexicalPlan = await this.prepareLexicalBootstrapPlan();
    this.markSearchBootstrapPhaseCompleted("lexical", "restore");

    if (!this.hybridEngine.isEnabled()) {
      this.setHybridBootstrapState("blocked");
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
      ? await this.sampleDevJsHeapUsage()
      : null;
    this.latestLexicalHeapDelta = null;
    this.markSearchBootstrapPhaseStarted("lexical", "heal");
    await this.healLexicalBootstrapPlan(lexicalPlan);
    this.markSearchBootstrapPhaseCompleted("lexical", "heal");

    if (!hybridPlan) {
      return {
        databaseUpgradeDetected,
        lexicalRebuilt: lexicalPlan.needsFullReindex,
        hybridWorked: false,
        hybridFailed: false,
      };
    }

    let hybridSummary: HybridBootstrapSummary | null = null;
    let hybridFailed = false;
    this.setHybridBootstrapState("healing");
    this.markSearchBootstrapPhaseStarted("hybrid", "heal");
    try {
      hybridSummary = await this.healHybridBootstrapPlan(hybridPlan);
      await this.maintainHybridFreshness();
    } catch (e) {
      logger.warn("hybrid engine init failed:", e);
      hybridFailed = true;
      this.setHybridBootstrapState("failed");
      new MyNotice(t("hybridNotice.indexFallbackToLexical"), 7000);
    }
    if (this.hybridBootstrapState === "healing") {
      this.markSearchBootstrapPhaseCompleted("hybrid", "heal");
      this.setHybridBootstrapState("searchable");
    }

    return {
      databaseUpgradeDetected,
      lexicalRebuilt: lexicalPlan.needsFullReindex,
      hybridWorked: this.didHybridBootstrapDoWork(hybridPlan),
      hybridFailed:
        hybridFailed ||
        (hybridSummary?.failedFiles ?? 0) > 0 ||
        (hybridSummary?.fallbackNoticeKey ?? null) !== null,
    };
  }

  async refreshAllAsync() {
    this.shouldForceRefresh = true;
    this.clearHybridFailedEmbeddingState();
    this.setHybridRuntimeQueryGate("blocked");
    getInstance(FileWatcher).stop();
    try {
      await this.initAsync({ suppressCompletionNotice: true });
      new MyNotice(t("Indexing finished"), 5000);
    } finally {
      this.shouldForceRefresh = false;
      getInstance(FileWatcher).start();
    }
  }

  async refreshLexicalStateAsync() {
    this.setLexicalBootstrapState("healing");
    const heapBeforeLexicalRefresh = isDevEnvironment
      ? await this.sampleDevJsHeapUsage()
      : null;
    this.latestLexicalHeapDelta = null;
    getInstance(FileWatcher).stop();
    try {
      await this.reindexLexicalEngineWithCurrFiles();
      await this.persistLexicalSearchSnapshotIfAvailable();
      if (isDevEnvironment) {
        await MyLib.sleep(0);
        this.latestLexicalHeapDelta = await this.summarizeDevLexicalHeapDelta(
          heapBeforeLexicalRefresh,
          await this.sampleDevJsHeapUsage(),
        );
        await this.noticeDevStorageStats();
      }
      new MyNotice(t("Indexing finished"), 5000);
      this.setLexicalBootstrapState("searchable");
    } catch (error) {
      this.setLexicalBootstrapState("failed");
      throw error;
    } finally {
      getInstance(FileWatcher).start();
    }
  }

  async refreshHybridStateAsync(options: HybridRefreshOptions = {}) {
    this.clearHybridFailedEmbeddingState();
    this.setHybridRuntimeQueryGate("blocked");
    const previousForceRefresh = this.shouldForceRefresh;
    let refreshResult: HybridRefreshResult | null = null;
    getInstance(FileWatcher).stop();
    try {
      if (options.forceRefresh) {
        this.shouldForceRefresh = true;
        refreshResult = await this.initHybridEngine().catch((e) => {
          logger.warn("hybrid engine init failed:", e);
          new MyNotice(t("hybridNotice.indexFallbackToLexical"), 7000);
          return null;
        });
      } else if (options.syncFileSetWithoutEmbedding) {
        refreshResult = await this.refreshHybridStateLocally({
          syncFileSetWithoutEmbedding:
            options.syncFileSetWithoutEmbedding ?? false,
        });
      } else {
        refreshResult = await this.initHybridEngine().catch((e) => {
          logger.warn("hybrid engine init failed:", e);
          new MyNotice(t("hybridNotice.indexFallbackToLexical"), 7000);
          return null;
        });
      }

      if (
        refreshResult?.hadWork &&
        refreshResult.failedFiles === 0 &&
        !refreshResult.fallbackNoticeKey
      ) {
        new MyNotice(t("searchNotice.hybridIndexFinished"), 5000);
      }
      if (refreshResult !== null) {
        await this.maintainHybridFreshness();
      }
    } finally {
      this.shouldForceRefresh = previousForceRefresh;
      this.notifyHybridRuntimeStatusChanged();
      getInstance(FileWatcher).start();
    }
  }

  private async refreshHybridStateLocally(options: {
    syncFileSetWithoutEmbedding: boolean;
  }): Promise<HybridRefreshResult> {
    if (!this.hybridEngine.isEnabled()) {
      this.blockHybridRuntimeQueryGate();
      return { hadWork: false, failedFiles: 0, fallbackNoticeKey: null };
    }

    await this.hybridEngine.load();
    const failures: HybridIndexFailure[] = [];
    let hadWork = false;

    if (options.syncFileSetWithoutEmbedding) {
      const currFiles = new Map<string, TFile>(
        this.dataProvider
          .allFilesToBeIndexed()
          .filter((file) => this.hybridEngine.shouldIndexPath(file.path))
          .map((file) => [file.path, file]),
      );
      const registryPathByDocRef = new Map(
        (await this.database.listDocRegistryEntries()).map((row) => [row.docRef, row.path] as const),
      );
      const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>(
        (await this.fileSnapshotStore.listHybridIndexedFileRefs())
          .map((ref) => {
            const path = registryPathByDocRef.get(ref.docRef);
            return path == null ? null : [path, ref] as const;
          })
          .filter((entry): entry is readonly [string, HybridIndexedFileRef] => entry != null),
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

      hadWork = docsToAdd.length > 0 || docsToDelete.length > 0;
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

    if (failures.length > 0) {
      this.noticeHybridIndexFailures(failures);
    }
    this.syncHybridRuntimeQueryGateFromEngine();
    return { hadWork, failedFiles: failures.length, fallbackNoticeKey: null };
  }

  private didHybridBootstrapDoWork(plan: HybridBootstrapPlan | null): boolean {
    if (!plan) {
      return false;
    }
    return (
      plan.docsToAdd.length > 0 ||
      plan.docsToDelete.length > 0 ||
      plan.repairReport.repairedPaths.length > 0
    );
  }

  private noticeSearchBootstrapCompletion(
    summary: SearchBootstrapCompletionSummary,
  ): void {
    const noticeKey = this.buildSearchBootstrapCompletionNoticeKey(summary);
    if (!noticeKey) {
      return;
    }
    new MyNotice(t(noticeKey), 5000);
  }

  private buildSearchBootstrapCompletionNoticeKey(
    summary: SearchBootstrapCompletionSummary,
  ): LocaleKey | null {
    if (!summary.lexicalRebuilt && !summary.hybridWorked) {
      return null;
    }
    if (summary.hybridFailed) {
      return null;
    }
    if (summary.databaseUpgradeDetected) {
      return summary.hybridWorked
        ? "searchNotice.databaseUpgradeFinishedHybridReady"
        : "searchNotice.databaseUpgradeFinished";
    }
    if (summary.lexicalRebuilt && summary.hybridWorked) {
      return "searchNotice.bootstrapFinishedHybridReady";
    }
    if (summary.hybridWorked) {
      return "searchNotice.hybridIndexFinished";
    }
    return "Indexing finished";
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
      await this.lexicalEngine.addDocuments(
        await this.attachLexicalDocRefs(documents),
      );
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
    const plainText = await this.primeCurrentFileText(file, generation);
    this.clearLexicalIndexFailures([file.path]);
    await this.ensureLexicalDocRegistryEntry({
      path: file.path,
      generation,
      deleted: false,
      contentFingerprint: hashStableText(plainText),
    });
    const metadata = this.dataProvider.getIndexedDocumentMetadata(file);
    await this.fileSnapshotStore.publishIndexedMetadata([
      {
        path: file.path,
        generation,
        aliasesText: metadata.aliases ?? "",
        tagsText: metadata.tags ?? "",
        headingsText: metadata.headings ?? "",
      },
    ]);
    await this.fileSnapshotStore.publishIndexedTexts([
      {
        path: file.path,
        generation,
        text: plainText,
      },
    ]);
    this.notifyLexicalIndexedTextsCommitted([
      {
        path: file.path,
        generation,
      },
    ]);
    await this.upsertLexicalIndexedFileRef(file, generation);
    await this.markLexicalSnapshotDirty([file.path]);
    return true;
  }

  private async commitMovedLexicalFileState(
    oldPath: string,
    file: TFile,
    generation = file.stat.mtime,
  ): Promise<boolean> {
    const { documents, indexedFiles, failures } =
      await this.dataProvider.generateAllIndexedDocuments([file]);
    if (
      failures.length > 0 ||
      documents.length === 0 ||
      indexedFiles.length === 0
    ) {
      if (failures.length > 0) {
        this.addLexicalIndexFailures(failures);
      }
      return false;
    }

    const previousDocRef = (await this.getLexicalDocRegistryEntry(oldPath))?.docRef;
    const nextDocument =
      previousDocRef === undefined
        ? documents[0]
        : {
            ...documents[0],
            docRef: previousDocRef,
          };
    const moved = await this.lexicalEngine.moveDocument(oldPath, nextDocument);
    if (!moved) {
      return false;
    }

    const plainText = documents[0].content ?? "";
    const contentFingerprint = hashStableText(plainText);
    const movedRegistryEntry = await this.moveLexicalDocRegistryPath(
      oldPath,
      file.path,
      {
        generation,
        contentFingerprint,
      },
    );
    if (!movedRegistryEntry) {
      await this.ensureLexicalDocRegistryEntry({
        path: file.path,
        generation,
        deleted: false,
        contentFingerprint,
      });
    }
    this.clearLexicalIndexFailures([oldPath, file.path]);
    await this.fileSnapshotStore.removeFiles([oldPath]);
    await this.fileSnapshotStore.publishIndexedMetadata([
      {
        path: file.path,
        generation,
        aliasesText: documents[0].aliases ?? "",
        tagsText: documents[0].tags ?? "",
        headingsText: documents[0].headings ?? "",
      },
    ]);
    await this.fileSnapshotStore.publishIndexedTexts([
      {
        path: file.path,
        generation,
        text: plainText,
      },
    ]);
    this.notifyLexicalIndexedTextsCommitted([
      {
        path: file.path,
        generation,
      },
    ]);
    await this.deleteLexicalIndexedFileRefs([oldPath]);
    await this.upsertLexicalIndexedFileRef(file, generation);
    await this.markLexicalSnapshotDirty([oldPath, file.path]);
    return true;
  }

  private async commitIndexedLexicalFiles(
    files: readonly TFile[],
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const publishRequests = await Promise.all(
      files.map(async (file) => {
        const text = await this.primeCurrentFileText(file, file.stat.mtime);
        return {
          path: file.path,
          generation: file.stat.mtime,
          text,
          contentFingerprint: hashStableText(text),
        };
      }),
    );
    await this.ensureLexicalDocRegistryEntries(
      publishRequests.map((request) => ({
        path: request.path,
        generation: request.generation,
        deleted: false,
        contentFingerprint: request.contentFingerprint,
      })),
    );
    await this.fileSnapshotStore.publishIndexedMetadata(
      files.map((file) => {
        const metadata = this.dataProvider.getIndexedDocumentMetadata(file);
        return {
          path: file.path,
          generation: file.stat.mtime,
          aliasesText: metadata.aliases ?? "",
          tagsText: metadata.tags ?? "",
          headingsText: metadata.headings ?? "",
        };
      }),
    );
    await this.fileSnapshotStore.publishIndexedTexts(
      publishRequests.map((request) => ({
        path: request.path,
        generation: request.generation,
        text: request.text,
      })),
    );
    this.notifyLexicalIndexedTextsCommitted(
      publishRequests.map((request) => ({
        path: request.path,
        generation: request.generation,
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
    if (this.lexicalEngine.supportsPersistentFileIndex()) {
      await this.lexicalEngine.persistFileIndexArtifact();
      await this.database.setLexicalQueryEvidenceReadyMarker(
        LEXICAL_QUERY_EVIDENCE_READY_VERSION,
      );
      await this.clearPersistedLexicalMutationJournalEntries();
      return;
    }
    const lexicalIndexData = this.lexicalEngine.serializeFileIndex();
    if (lexicalIndexData) {
      await this.database.setLexicalSearchSnapshot(lexicalIndexData);
      await this.database.setLexicalQueryEvidenceReadyMarker(
        LEXICAL_QUERY_EVIDENCE_READY_VERSION,
      );
      await this.clearPersistedLexicalMutationJournalEntries();
      return;
    }
    await this.database.deleteLexicalSearchSnapshot();
    await this.database.clearLexicalQueryEvidenceReadyMarker();
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
    void this.persistLexicalRecoveryFailures(failures);
  }

  private clearLexicalIndexFailures(paths: readonly string[]): void {
    if (paths.length === 0 || this.lexicalIndexFailuresByPath.size === 0) {
      return;
    }
    for (const path of paths) {
      this.lexicalIndexFailuresByPath.delete(path);
    }
    this.renderLexicalIndexFailureNotice();
    void this.deletePersistedLexicalRecoveryStates(paths);
  }

  private async persistLexicalRecoveryFailures(
    failures: readonly LexicalIndexFailure[],
  ): Promise<void> {
    if (failures.length === 0) {
      return;
    }
    if (typeof this.database.bulkPutIndexRecoveryStates !== "function") {
      return;
    }

    const now = Date.now();
    const rows: IndexRecoveryStateRow[] = [];
    for (const failure of failures) {
      const docRegistryEntry = await this.ensureLexicalDocRegistryEntry({
        path: failure.file.path,
        generation: failure.file.stat.mtime,
        deleted: false,
      });
      rows.push({
        id: buildIndexRecoveryStateId("lexical", failure.file.path),
        engine: "lexical",
        docRef: docRegistryEntry?.docRef,
        path: failure.file.path,
        targetGeneration: failure.file.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "retryable_ready",
        failureKind: "unknown",
        failureMessage: this.formatLexicalIndexError(failure.error),
        attemptCount: 1,
        lastFailedAt: now,
        nextRetryAt: null,
        isBlocking: false,
      });
    }

    try {
      await this.database.bulkPutIndexRecoveryStates(rows);
    } catch (error) {
      logger.warn("failed to persist lexical recovery state:", error);
    }
  }

  private async deletePersistedLexicalRecoveryStates(
    paths: readonly string[],
  ): Promise<void> {
    if (
      paths.length === 0 ||
      typeof this.database.deleteIndexRecoveryState !== "function"
    ) {
      return;
    }
    for (const path of paths) {
      try {
        await this.database.deleteIndexRecoveryState("lexical", path);
      } catch (error) {
        logger.warn(
          `failed to delete lexical recovery state for ${path}:`,
          error,
        );
      }
    }
  }

  private async resolveLexicalDocOperationDocRef(
    operation: DocOperation,
  ): Promise<DocRef | undefined> {
    if (operation instanceof DocMoveOperation) {
      return (await this.getLexicalDocRegistryEntry(operation.oldPath))?.docRef;
    }
    if (operation instanceof DocUpsertOperation) {
      return (
        await this.ensureLexicalDocRegistryEntry({
          path: operation.path,
          generation: operation.sourceGeneration,
          deleted: false,
        })
      )?.docRef;
    }
    return (await this.getLexicalDocRegistryEntry(operation.path))?.docRef;
  }

  private async persistPendingLexicalDocOperation(
    operation: DocOperation,
  ): Promise<void> {
    const database = this.database as Database & {
      putPendingDocOperation?: (row: PendingDocOperationRow) => Promise<void>;
    };
    if (!database.putPendingDocOperation) {
      return;
    }
    try {
      const docRef = await this.resolveLexicalDocOperationDocRef(operation);
      await database.putPendingDocOperation(
        toPendingDocOperationRow(operation, docRef),
      );
    } catch (error) {
      logger.warn("failed to persist pending lexical doc operation:", error);
    }
  }

  private async persistLexicalMutationJournalEntry(
    operation: DocOperation,
  ): Promise<void> {
    const database = this.database as Database & {
      putLexicalMutationJournalEntry?: (
        row: LexicalMutationJournalRow,
      ) => Promise<void>;
    };
    if (!database.putLexicalMutationJournalEntry) {
      return;
    }
    try {
      const docRef = await this.resolveLexicalDocOperationDocRef(operation);
      await database.putLexicalMutationJournalEntry(
        toLexicalMutationJournalRow(operation, docRef),
      );
    } catch (error) {
      logger.warn("failed to persist lexical mutation journal entry:", error);
    }
  }

  private async deletePersistedPendingLexicalDocOperations(
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const database = this.database as Database & {
      deletePendingDocOperations?: (ids: readonly string[]) => Promise<void>;
    };
    if (!database.deletePendingDocOperations) {
      return;
    }
    try {
      await database.deletePendingDocOperations(ids);
    } catch (error) {
      logger.warn("failed to delete pending lexical doc operations:", error);
    }
  }

  private async deletePersistedLexicalMutationJournalEntries(
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const database = this.database as Database & {
      deleteLexicalMutationJournalEntries?: (
        ids: readonly string[],
      ) => Promise<void>;
    };
    if (!database.deleteLexicalMutationJournalEntries) {
      return;
    }
    try {
      await database.deleteLexicalMutationJournalEntries(ids);
    } catch (error) {
      logger.warn("failed to delete lexical mutation journal entries:", error);
    }
  }

  private async clearPersistedPendingLexicalDocOperations(): Promise<void> {
    const database = this.database as Database & {
      clearPendingDocOperations?: (
        engine?: PendingDocOperationRow["engine"],
      ) => Promise<void>;
    };
    if (!database.clearPendingDocOperations) {
      return;
    }
    try {
      await database.clearPendingDocOperations("lexical");
    } catch (error) {
      logger.warn("failed to clear pending lexical doc operations:", error);
    }
  }

  private async clearPersistedLexicalMutationJournalEntries(): Promise<void> {
    const database = this.database as Database & {
      clearLexicalMutationJournalEntries?: (
        engine?: LexicalMutationJournalRow["engine"],
      ) => Promise<void>;
    };
    if (!database.clearLexicalMutationJournalEntries) {
      return;
    }
    try {
      await database.clearLexicalMutationJournalEntries("lexical");
    } catch (error) {
      logger.warn("failed to clear lexical mutation journal entries:", error);
    }
  }

  private async listPersistedPendingLexicalDocOperations(): Promise<
    PendingDocOperationRow[]
  > {
    const database = this.database as Database & {
      getPendingDocOperations?: (
        engine?: PendingDocOperationRow["engine"],
      ) => Promise<PendingDocOperationRow[]>;
    };
    if (!database.getPendingDocOperations) {
      return [];
    }
    try {
      return await database.getPendingDocOperations("lexical");
    } catch (error) {
      logger.warn("failed to load pending lexical doc operations:", error);
      return [];
    }
  }

  private async listPersistedLexicalMutationJournalEntries(): Promise<
    LexicalMutationJournalRow[]
  > {
    const database = this.database as Database & {
      getLexicalMutationJournalEntries?: (
        engine?: LexicalMutationJournalRow["engine"],
      ) => Promise<LexicalMutationJournalRow[]>;
    };
    if (!database.getLexicalMutationJournalEntries) {
      return [];
    }
    try {
      return await database.getLexicalMutationJournalEntries("lexical");
    } catch (error) {
      logger.warn("failed to load lexical mutation journal entries:", error);
      return [];
    }
  }

  private async restorePersistedLexicalDocOperationsFromRows<
    TRow extends {
      id: string;
      docRef?: DocRef;
      path: string;
      createdAt: number;
    },
  >(
    rows: readonly TRow[],
    createOperation: (row: TRow) => DocOperation | null,
    deleteRows: (ids: readonly string[]) => Promise<void>,
  ): Promise<DocOperation[]> {
    if (rows.length === 0) {
      return [];
    }
    const currFiles = new Map(
      this.dataProvider
        .allFilesToBeIndexed()
        .map((file) => [file.path, file] as const),
    );
    const docRegistryByRef = new Map(
      (await this.listLexicalDocRegistryEntries()).map((row) => [row.docRef, row]),
    );
    const operations: DocOperation[] = [];
    const invalidIds: string[] = [];
    for (const row of [...rows].sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.id.localeCompare(right.id);
    })) {
      const registryEntry =
        row.docRef !== undefined ? docRegistryByRef.get(row.docRef) : undefined;
      const normalizedRow =
        !registryEntry
          ? row
          : {
              ...row,
              path: registryEntry.path,
            };
      const operation = createOperation(normalizedRow);
      if (!operation) {
        invalidIds.push(row.id);
        continue;
      }
      if (
        (operation instanceof DocUpsertOperation ||
          operation instanceof DocMoveOperation) &&
        !currFiles.has(operation.path)
      ) {
        invalidIds.push(row.id);
        continue;
      }
      if (
        operation instanceof DocDeleteOperation &&
        currFiles.has(operation.path)
      ) {
        invalidIds.push(row.id);
        continue;
      }
      operations.push(operation);
    }
    if (invalidIds.length > 0) {
      await deleteRows(invalidIds);
    }
    return operations;
  }

  private async restorePersistedPendingLexicalDocOperations(): Promise<
    DocOperation[]
  > {
    return await this.restorePersistedLexicalDocOperationsFromRows(
      await this.listPersistedPendingLexicalDocOperations(),
      fromPendingDocOperationRow,
      async (ids) => await this.deletePersistedPendingLexicalDocOperations(ids),
    );
  }

  private async restorePersistedLexicalMutationJournalEntries(): Promise<{
    hadRows: boolean;
    operations: DocOperation[];
  }> {
    const rows = await this.listPersistedLexicalMutationJournalEntries();
    return {
      hadRows: rows.length > 0,
      operations: await this.restorePersistedLexicalDocOperationsFromRows(
        rows,
        fromLexicalMutationJournalRow,
        async (ids) => await this.deletePersistedLexicalMutationJournalEntries(ids),
      ),
    };
  }

  private notifyDatabaseOpenRecovery(
    report: DatabaseOpenRecoveryReport,
  ): void {
    if (report.mode === "targeted-reset") {
      new MyNotice(
        "Local Clever Search indexes were rebuilt after a Dexie schema repair. Settings and token stats were preserved.",
        12000,
      );
      return;
    }

    new MyNotice(
      "Local Clever Search database was rebuilt after a Dexie schema repair. Settings were preserved; token stats may have been reset.",
      12000,
    );
  }

  private async listLexicalRecoveryStates(): Promise<IndexRecoveryStateRow[]> {
    if (typeof this.database.getIndexRecoveryStates !== "function") {
      return [];
    }
    try {
      return await this.database.getIndexRecoveryStates("lexical");
    } catch (error) {
      logger.warn("failed to load persisted lexical recovery state:", error);
      return [];
    }
  }

  private shouldKeepPersistedLexicalRecoveryState(
    row: IndexRecoveryStateRow,
    currFiles: ReadonlyMap<string, TFile>,
    previousIndexedFileRefs: ReadonlyMap<string, BaseIndexedFileRef>,
  ): boolean {
    if (!Number.isFinite(row.targetGeneration) || row.targetGeneration <= 0) {
      return false;
    }

    const file = currFiles.get(row.path);
    if (!file) {
      return false;
    }

    if (file.stat.mtime > row.targetGeneration) {
      return false;
    }

    const previousIndexedFileRef = previousIndexedFileRefs.get(row.path);
    if (!previousIndexedFileRef) {
      return true;
    }

    return previousIndexedFileRef.generation < row.targetGeneration;
  }

  private async restorePersistedLexicalRecoveryState(): Promise<number> {
    await this.ensureLexicalIndexedFileRefsLoaded();
    const rows = await this.listLexicalRecoveryStates();
    if (rows.length === 0) {
      return 0;
    }

    const currFiles = new Map(
      this.dataProvider
        .allFilesToBeIndexed()
        .map((file) => [file.path, file] as const),
    );
    const docRegistryByRef = new Map(
      (await this.listLexicalDocRegistryEntries()).map((row) => [row.docRef, row]),
    );
    let restoredCount = 0;

    for (const row of rows) {
      let effectivePath = row.path;
      let file = currFiles.get(effectivePath);
      if (!file && row.docRef !== undefined) {
        const movedRegistryEntry = docRegistryByRef.get(row.docRef);
        const movedFile = movedRegistryEntry
          ? currFiles.get(movedRegistryEntry.path)
          : undefined;
        if (movedRegistryEntry && movedFile) {
          effectivePath = movedRegistryEntry.path;
          file = movedFile;
          if (
            effectivePath !== row.path &&
            typeof this.database.moveIndexRecoveryState === "function"
          ) {
            try {
              await this.database.moveIndexRecoveryState(
                "lexical",
                row.path,
                effectivePath,
              );
            } catch (error) {
              logger.warn(
                `failed to move lexical recovery state from ${row.path} to ${effectivePath}:`,
                error,
              );
            }
          }
        }
      }

      if (
        !this.shouldKeepPersistedLexicalRecoveryState(
          { ...row, path: effectivePath },
          currFiles,
          this.lexicalIndexedFileRefsByPath,
        )
      ) {
        await this.deletePersistedLexicalRecoveryStates(
          effectivePath === row.path ? [row.path] : [row.path, effectivePath],
        );
        continue;
      }

      if (this.lexicalIndexFailuresByPath.has(effectivePath)) {
        continue;
      }

      if (!file) {
        await this.deletePersistedLexicalRecoveryStates(
          effectivePath === row.path ? [row.path] : [row.path, effectivePath],
        );
        continue;
      }

      this.lexicalIndexFailuresByPath.set(effectivePath, {
        file,
        error: new Error(
          row.failureMessage ?? "Recovered persisted lexical failure state",
        ),
      });
      restoredCount += 1;
    }

    if (restoredCount > 0) {
      this.renderLexicalIndexFailureNotice();
    }
    return restoredCount;
  }

  private shouldAutoRetryRestoredLexicalFailures(
    plan: LexicalBootstrapPlan,
  ): boolean {
    return (
      !plan.needsFullReindex &&
      !plan.needsRefHeal &&
      (!plan.persistentRecoveryPlan ||
        plan.persistentRecoveryPlan.status === "up_to_date")
    );
  }

  private shouldReplayPersistedPendingLexicalDocOperations(
    plan: LexicalBootstrapPlan,
  ): boolean {
    return (
      !plan.needsFullReindex &&
      !plan.needsRefHeal &&
      (!plan.persistentRecoveryPlan ||
        plan.persistentRecoveryPlan.status === "up_to_date")
    );
  }

  private async replayPersistedPendingLexicalDocOperations(): Promise<void> {
    if (this.lexicalStartupPendingOperations.length === 0) {
      return;
    }
    const operations = [...this.lexicalStartupPendingOperations];
    await this.docOperationsHandler({
      rawOperations: operations,
      reducedBatch: reduceDocOperations(operations),
    });
    this.lexicalStartupPendingOperations = [];
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
        await this.persistLexicalRecoveryFailures(result.failures);
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
    await this.fileSnapshotStore.removeFiles(paths);
    await this.deleteLexicalIndexedFileRefs(paths);
    await this.markLexicalSnapshotDirty(paths);
  }

  private async handleDeleteOperation(path: string): Promise<void> {
    this.cancelHybridRepair(path);
    await this.clearFailedHybridEmbedding(path);
    this.clearLexicalIndexFailures([path]);
    await this.deleteLexicalFileState([path]);
    if (this.hybridEngine.isEnabled()) {
      await this.deleteHybridFileAndRefreshRuntimeStatus(path);
    }
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
  }

  private async handleMoveOperation(
    oldPath: string,
    newPath: string,
    requiresReindex: boolean,
    sourceGeneration?: number,
  ): Promise<void> {
    const canAttemptHybridMoveReuse =
      !requiresReindex &&
      this.hybridEngine.isEnabled() &&
      (await this.canReuseMovedHybridState(oldPath));

    this.cancelHybridRepair(oldPath);
    this.cancelHybridRepair(newPath);
    this.clearLexicalIndexFailures([oldPath, newPath]);

    const file = this.dataProvider.getFileByPath(newPath);
    if (!file || !this.dataProvider.isIndexable(file)) {
      await this.deleteLexicalFileState([oldPath, newPath]);
      await this.clearFailedHybridEmbedding(oldPath);
      await this.clearFailedHybridEmbedding(newPath);
      await this.handleDeleteOperation(newPath);
      if (this.hybridEngine.isEnabled()) {
        await this.hybridEngine.deleteFile(oldPath);
      }
      return;
    }

    await this.primeCurrentFileText(file, sourceGeneration);
    const movedLexical = await this.commitMovedLexicalFileState(
      oldPath,
      file,
      sourceGeneration ?? file.stat.mtime,
    );
    if (!movedLexical) {
      await this.deleteLexicalFileState([oldPath, newPath]);
      await this.commitLexicalFileState(file);
    }

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
      return;
    }

    const basenameChanged =
      FileUtil.getBasename(oldPath) !== FileUtil.getBasename(newPath);
    const moved =
      canAttemptHybridMoveReuse && !basenameChanged
        ? await this.hybridEngine.moveFile(oldPath, newPath, file.stat.mtime)
        : false;

    if (moved) {
      await this.moveFailedHybridEmbedding(oldPath, newPath);
      return;
    }

    await this.clearFailedHybridEmbedding(oldPath);
    await this.clearFailedHybridEmbedding(newPath);
    await this.hybridEngine.deleteFile(oldPath);
    await this.hybridEngine.deleteFile(newPath);

    this.enqueueHybridRepair({
      path: file.path,
      mode: basenameChanged ? "full" : "incremental",
      reason: basenameChanged
        ? "runtime-basename-changed-full-rebuild"
        : "runtime-incremental-edit",
      sourceGeneration: file.stat.mtime,
    });
  }

  private async canReuseMovedHybridState(path: string): Promise<boolean> {
    const [indexedFileRef, snapshotRow, shadowRow] = await Promise.all([
      this.fileSnapshotStore.getHybridIndexedFileRef(path),
      this.database.db.fileSnapshots.get(path),
      this.database.db.hybridDirtyShadows.get(path),
    ]);

    if (
      !indexedFileRef ||
      indexedFileRef.generation === undefined ||
      snapshotRow?.generation === undefined ||
      shadowRow !== undefined
    ) {
      return false;
    }

    return snapshotRow.generation === indexedFileRef.generation;
  }

  private async primeCurrentFileText(
    file: TFile,
    _sourceGeneration?: number,
  ): Promise<string> {
    return await this.dataProvider.readPlainText(file);
  }

  private enqueueHybridRepair(
    task: Omit<HybridRepairTask, "eligibleAt" | "enqueuedAt"> & {
      eligibleAt?: number;
      notifyRuntimeStatusChanged?: boolean;
    },
  ): void {
    const shouldNotify = task.notifyRuntimeStatusChanged !== false;
    const nextTask: HybridRepairTask = {
      ...task,
      eligibleAt: task.eligibleAt ?? Date.now(),
      enqueuedAt: Date.now(),
    };
    const existing = this.hybridRepairQueue.get(task.path);
    if (!existing) {
      this.hybridRepairQueue.set(task.path, nextTask);
      this.scheduleHybridRepairFlush();
      if (shouldNotify) {
        this.notifyHybridRuntimeStatusChanged();
      }
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
    if (shouldNotify) {
      this.notifyHybridRuntimeStatusChanged();
    }
  }

  private cancelHybridRepair(path: string): void {
    const didDelete = this.hybridRepairQueue.delete(path);
    if (this.hybridRepairQueue.size === 0 && this.hybridRepairFlushTimer) {
      clearTimeout(this.hybridRepairFlushTimer);
      this.hybridRepairFlushTimer = null;
    }
    if (didDelete) {
      this.notifyHybridRuntimeStatusChanged();
    }
  }

  private clearHybridRepairScheduler(): void {
    if (this.hybridRepairFlushTimer) {
      clearTimeout(this.hybridRepairFlushTimer);
      this.hybridRepairFlushTimer = null;
    }
    this.hybridRepairQueue.clear();
    this.hybridRepairInFlightPaths.clear();
    this.hybridRepairPendingPersistPaths.clear();
    this.notifyHybridRuntimeStatusChanged();
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
      this.hybridRepairPendingPersistPaths.add(task.path);
    }
    if (readyTasks.length > 0) {
      this.notifyHybridRuntimeStatusChanged();
    }

    const failures: HybridIndexFailure[] = [];
    const worker = (async () => {
      try {
        await this.runHybridRepairTasks(readyTasks, null, 0, failures);
        await this.hybridEngine.persistIndicesForBatch();
      } finally {
        for (const task of readyTasks) {
          this.hybridRepairPendingPersistPaths.delete(task.path);
        }
        this.hybridRepairWorker = null;
        await this.maintainHybridFreshness();
        this.scheduleHybridRepairFlush();
        this.notifyHybridRuntimeStatusChanged();
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
    const supportsPersistentIndex =
      this.lexicalEngine.supportsPersistentFileIndex();
    const lexicalQueryEvidenceReady =
      supportsSerializedIndex || supportsPersistentIndex
        ? await this.database.hasLexicalQueryEvidenceReadyMarker()
        : false;
    const lexicalSnapshotDirty = supportsSerializedIndex && !supportsPersistentIndex
      ? await this.hasLexicalSnapshotDirtyMarker()
      : false;
    const canRestorePersistedIndex =
      devOption.loadIndexFromDatabase &&
      !this.shouldForceRefresh &&
      (supportsPersistentIndex || supportsSerializedIndex);
    if (supportsPersistentIndex && canRestorePersistedIndex) {
      if (!lexicalQueryEvidenceReady) {
        return {
          needsFullReindex: true,
          needsRefHeal: false,
          persistentRecoveryPlan: null,
        };
      }
      const restored = await this.lexicalEngine.restorePersistedFileIndex();
      if (!restored) {
        await this.invalidateLexicalQueryEvidenceReadyMarker();
        return {
          needsFullReindex: true,
          needsRefHeal: false,
          persistentRecoveryPlan: null,
        };
      }
      const persistentRecoveryPlan = await this.lexicalEngine.planPersistentRecovery(
        this.buildCurrentLexicalIndexedFileRefs(),
      );
      await this.reloadLexicalIndexedFileRefs();
      if (persistentRecoveryPlan?.status === "needs_full_rebuild") {
        logger.warn(
          `Persisted lexical recovery requires full rebuild: ${persistentRecoveryPlan.reason}`,
        );
        this.lexicalEngine.clearIndex();
        await this.invalidateLexicalQueryEvidenceReadyMarker();
        return {
          needsFullReindex: true,
          needsRefHeal: false,
          persistentRecoveryPlan,
        };
      }
      return {
        needsFullReindex: false,
        needsRefHeal:
          persistentRecoveryPlan === null
            ? !this.isLexicalEngineUpToDate
            : persistentRecoveryPlan.status === "needs_heal",
        persistentRecoveryPlan,
      };
    }
    let prevData: SerializedFileSearchIndex | null;
    if (
      !devOption.loadIndexFromDatabase ||
      this.shouldForceRefresh ||
      !supportsSerializedIndex ||
      lexicalSnapshotDirty ||
      !lexicalQueryEvidenceReady
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
        persistentRecoveryPlan: null,
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
        persistentRecoveryPlan: null,
      };
    }
    await this.reloadLexicalIndexedFileRefs();
    if (this.shouldForceLexicalRebuildAfterSnapshotRestore()) {
      logger.warn(
        "Restored lexical snapshot is inconsistent with persisted lexical indexed refs. Rebuilding lexical index.",
      );
      new MyNotice("Lexical snapshot drift detected. Rebuilding the lexical index...", 5000);
      this.lexicalEngine.clearIndex();
      return {
        needsFullReindex: true,
        needsRefHeal: false,
        persistentRecoveryPlan: null,
      };
    }

    return {
      needsFullReindex: false,
      needsRefHeal: !this.isLexicalEngineUpToDate,
      persistentRecoveryPlan: null,
    };
  }

  private shouldForceLexicalRebuildAfterSnapshotRestore(): boolean {
    const restoredDocCount = this.lexicalEngine.getIndexedDocumentCount();
    if (restoredDocCount === null) {
      return false;
    }
    const persistedRefCount = this.lexicalIndexedFileRefsByPath.size;
    if (persistedRefCount > 0 && restoredDocCount !== persistedRefCount) {
      return true;
    }
    if (restoredDocCount === 0) {
      return this.dataProvider.allFilesToBeIndexed().length > 0;
    }
    return false;
  }

  private async healLexicalBootstrapPlan(
    plan: LexicalBootstrapPlan,
  ): Promise<void> {
    this.lexicalStartupFailureRetryPending = false;
    this.lexicalStartupPendingOperations = [];
    if (plan.needsFullReindex) {
      await this.reindexLexicalEngineWithCurrFiles();
    } else if (
      plan.persistentRecoveryPlan &&
      plan.persistentRecoveryPlan.status === "needs_heal"
    ) {
      await this.applyLexicalPersistentRecoveryPlan(plan.persistentRecoveryPlan);
    } else if (plan.needsRefHeal) {
      await this.updateLexicalIndexedFileRefsByMtime();
    } else {
      await this.ensureLexicalIndexedFileRefsLoaded();
    }

    const restoredFailureCount =
      await this.restorePersistedLexicalRecoveryState();
    this.lexicalStartupFailureRetryPending =
      restoredFailureCount > 0 &&
      this.shouldAutoRetryRestoredLexicalFailures(plan);
    if (this.shouldReplayPersistedPendingLexicalDocOperations(plan)) {
      const journalRestore =
        await this.restorePersistedLexicalMutationJournalEntries();
      if (journalRestore.hadRows) {
        await this.clearPersistedPendingLexicalDocOperations();
        this.lexicalStartupPendingOperations = journalRestore.operations;
      } else {
        this.lexicalStartupPendingOperations =
          await this.restorePersistedPendingLexicalDocOperations();
      }
    } else {
      await this.clearPersistedPendingLexicalDocOperations();
      await this.clearPersistedLexicalMutationJournalEntries();
    }
  }

  private async commitLexicalBootstrapPlan(): Promise<void> {
    logger.trace("Lexical engine is ready");
    await this.persistLexicalSearchSnapshotIfAvailable();
    if (this.lexicalStartupPendingOperations.length > 0) {
      await this.replayPersistedPendingLexicalDocOperations();
      await this.persistLexicalSearchSnapshotIfAvailable();
    }
    if (this.lexicalStartupFailureRetryPending) {
      this.lexicalStartupFailureRetryPending = false;
      void this.retryLexicalIndexFailures();
    }
  }

  private async initHybridEngine(): Promise<HybridRefreshResult | null> {
    const plan = await this.hybridBootstrapCoordinator.preparePlan();
    const summary = await this.hybridBootstrapCoordinator.healPlan(plan);
    return {
      hadWork: this.didHybridBootstrapDoWork(plan),
      failedFiles: summary?.failedFiles ?? 0,
      fallbackNoticeKey: summary?.fallbackNoticeKey ?? null,
    };
  }

  private async prepareHybridBootstrapPlan(): Promise<HybridBootstrapPlan | null> {
    return await this.hybridBootstrapCoordinator.preparePlan();
  }

  private async healHybridBootstrapPlan(
    plan: HybridBootstrapPlan | null,
  ): Promise<HybridBootstrapSummary | null> {
    return await this.hybridBootstrapCoordinator.healPlan(plan);
  }

  private async reindexLexicalEngineWithCurrFiles() {
    logger.trace("Indexing the whole vault...");
    const filesToIndex = this.dataProvider.allFilesToBeIndexed();
    const indexedPaths = new Set<string>(filesToIndex.map((file) => file.path));
    const progressNotice = new LexicalIndexProgressNotice({
      processedFiles: 0,
      totalFiles: filesToIndex.length,
    });
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
    let processedFiles = 0;
    const reindexBatches = this.buildLexicalReindexBatches(filesToIndex);
    this.lexicalEngine.beginBatchReindex();
    try {
      for (let index = 0; index < reindexBatches.length; index += 1) {
        const batchFiles = reindexBatches[index];
        const batchResult = await this.addDocuments(batchFiles);
        successfulFiles.push(...batchResult.indexedFiles);
        failures.push(...batchResult.failures);
        processedFiles += batchFiles.length;
        progressNotice.update({
          processedFiles,
          totalFiles: filesToIndex.length,
        });
        if (index + 1 < reindexBatches.length) {
          await MyLib.sleep(0);
        }
      }
      await this.lexicalEngine.finishBatchReindex();
    } catch (error) {
      this.lexicalEngine.abortBatchReindex();
      throw error;
    } finally {
      progressNotice.hide();
    }
    await this.saveLexicalIndexedFileRefs(successfulFiles);
    await this.commitIndexedLexicalFiles(successfulFiles);
    await this.fileSnapshotStore.retainOnlyFiles(indexedPaths);
    await this.markLexicalSnapshotDirty();
    this.clearLexicalIndexFailures(Array.from(indexedPaths));
    if (failures.length > 0) {
      this.addLexicalIndexFailures(failures);
    }
    this.isLexicalEngineUpToDate = failures.length === 0;
  }


  private buildLexicalReindexBatches(files: readonly TFile[]): TFile[][] {
    return this.buildFileBatches(
      files,
      DataManager.LEXICAL_REINDEX_BATCH_SIZE,
      DataManager.LEXICAL_REINDEX_MAX_BYTES,
    );
  }

  private buildFileBatches(
    files: readonly TFile[],
    maxFilesPerBatch: number,
    maxBytesPerBatch: number,
  ): TFile[][] {
    const batches: TFile[][] = [];
    let currentBatch: TFile[] = [];
    let currentBatchBytes = 0;

    for (const file of files) {
      const fileBytes = Math.max(0, file.stat.size ?? 0);
      const wouldExceedFileLimit = currentBatch.length >= maxFilesPerBatch;
      const wouldExceedByteLimit =
        currentBatch.length > 0 &&
        currentBatchBytes + fileBytes > maxBytesPerBatch;

      if (wouldExceedFileLimit || wouldExceedByteLimit) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchBytes = 0;
      }

      currentBatch.push(file);
      currentBatchBytes += fileBytes;

      if (
        currentBatch.length >= maxFilesPerBatch ||
        (fileBytes > maxBytesPerBatch && currentBatch.length === 1)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchBytes = 0;
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }
  private buildCurrentLexicalIndexedFileRefs(): BaseIndexedFileRef[] {
    return this.dataProvider.allFilesToBeIndexed().map((file) => ({
      path: file.path,
      generation: file.stat.mtime,
      size: file.stat.size,
    }));
  }

  private async applyLexicalPersistentRecoveryPlan(
    plan: PersistentFileIndexRecoveryPlan,
  ): Promise<void> {
    const currentFiles = new Map<string, TFile>(
      this.dataProvider.allFilesToBeIndexed().map((file) => [file.path, file]),
    );
    const dirtyPaths = new Set<string>();
    const deletePaths = new Set<string>(plan.docsToDelete);
    const upsertPaths = new Set<string>([
      ...plan.docsToAdd,
      ...plan.docsToUpdate,
    ]);

    for (const move of plan.docsToMove) {
      const file = currentFiles.get(move.newPath);
      dirtyPaths.add(move.oldPath);
      dirtyPaths.add(move.newPath);
      if (!file) {
        deletePaths.add(move.oldPath);
        continue;
      }
      const moved = await this.commitMovedLexicalFileState(
        move.oldPath,
        file,
        file.stat.mtime,
      );
      if (!moved) {
        deletePaths.add(move.oldPath);
        upsertPaths.add(move.newPath);
      }
    }

    const deleteList = [...deletePaths];
    if (deleteList.length > 0) {
      logger.trace(`lexical recovery docs to delete: ${deleteList.length}`);
      await this.deleteDocuments(deleteList);
      await this.fileSnapshotStore.removeFiles(deleteList);
      await this.deleteLexicalIndexedFileRefs(deleteList);
      this.clearLexicalIndexFailures(deleteList);
      for (const path of deleteList) {
        dirtyPaths.add(path);
      }
    }

    const upsertFiles = [...upsertPaths].flatMap((path) => {
      const file = currentFiles.get(path);
      return file ? [file] : [];
    });
    logger.trace(`lexical recovery docs to upsert: ${upsertFiles.length}`);
    const addResult = await this.addDocuments(upsertFiles);
    await this.commitIndexedLexicalFiles(addResult.indexedFiles);
    const failedPaths = new Set(
      addResult.failures.map((failure) => failure.file.path),
    );
    await this.saveLexicalIndexedFileRefs(
      Array.from(currentFiles.values()).filter(
        (file) => !failedPaths.has(file.path),
      ),
    );
    this.clearLexicalIndexFailures(
      addResult.indexedFiles.map((file) => file.path),
    );
    if (addResult.failures.length > 0) {
      this.addLexicalIndexFailures(addResult.failures);
    }
    if (deleteList.length > 0 || addResult.indexedFiles.length > 0 || dirtyPaths.size > 0) {
      await this.markLexicalSnapshotDirty([
        ...dirtyPaths,
        ...addResult.indexedFiles.map((file) => file.path),
      ]);
    }
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
    const previousDocRegistryEntries = new Map<string, DocRegistryRow>(
      (await this.listLexicalDocRegistryEntries()).map((row) => [row.path, row]),
    );
    const docsToAdd: TFile[] = [];
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

    const lexicalStartupMovePlan = await this.planLexicalStartupMoves(
      currFiles,
      docsToAdd,
      docsToDelete,
      previousIndexedFileRefs,
      previousDocRegistryEntries,
    );
    const pendingAddFiles = new Map<string, TFile>(
      lexicalStartupMovePlan.docsToAdd.map((file) => [file.path, file]),
    );
    const pendingDeletePaths = new Set<string>(lexicalStartupMovePlan.docsToDelete);

    for (const move of lexicalStartupMovePlan.docsToMove) {
      const moved = await this.commitMovedLexicalFileState(
        move.oldPath,
        move.file,
        move.file.stat.mtime,
      );
      if (!moved) {
        pendingDeletePaths.add(move.oldPath);
        pendingAddFiles.set(move.file.path, move.file);
      }
    }

    const deleteList = [...pendingDeletePaths];
    logger.trace(`docs to move: ${lexicalStartupMovePlan.docsToMove.length}`);
    logger.trace(`docs to delete: ${deleteList.length}`);
    logger.trace(`docs to add: ${pendingAddFiles.size}`);
    await this.deleteDocuments(deleteList);
    await this.fileSnapshotStore.removeFiles(deleteList);
    const addResult = await this.addDocuments([...pendingAddFiles.values()]);
    await this.commitIndexedLexicalFiles(addResult.indexedFiles);
    const failedPaths = new Set(
      addResult.failures.map((failure) => failure.file.path),
    );
    await this.saveLexicalIndexedFileRefs(
      Array.from(currFiles.values()).filter(
        (file) => !failedPaths.has(file.path),
      ),
    );
    if (deleteList.length > 0 || addResult.indexedFiles.length > 0) {
      await this.markLexicalSnapshotDirty([
        ...deleteList,
        ...addResult.indexedFiles.map((file) => file.path),
      ]);
    }
    this.clearLexicalIndexFailures(deleteList);
    this.clearLexicalIndexFailures(
      addResult.indexedFiles.map((file) => file.path),
    );
    if (addResult.failures.length > 0) {
      this.addLexicalIndexFailures(addResult.failures);
    }
  }

  private async planLexicalStartupMoves(
    currentFiles: ReadonlyMap<string, TFile>,
    docsToAdd: readonly TFile[],
    docsToDelete: readonly string[],
    previousIndexedFileRefs: ReadonlyMap<string, BaseIndexedFileRef>,
    previousDocRegistryEntries: ReadonlyMap<string, DocRegistryRow>,
  ): Promise<{
    docsToMove: LexicalStartupMove[];
    docsToAdd: TFile[];
    docsToDelete: string[];
  }> {
    if (docsToAdd.length === 0 || docsToDelete.length === 0) {
      return {
        docsToMove: [],
        docsToAdd: [...docsToAdd],
        docsToDelete: [...docsToDelete],
      };
    }

    const deleteCandidatesByFingerprint = new Map<string, Array<{ path: string }>>();
    const indexedTextRequests: Array<{ path: string; generation?: number }> = [];

    for (const path of docsToDelete) {
      if (currentFiles.has(path)) {
        continue;
      }
      const registryEntry = previousDocRegistryEntries.get(path);
      if (registryEntry?.contentFingerprint) {
        const existing = deleteCandidatesByFingerprint.get(
          registryEntry.contentFingerprint,
        );
        if (existing) {
          existing.push({ path });
        } else {
          deleteCandidatesByFingerprint.set(registryEntry.contentFingerprint, [
            { path },
          ]);
        }
        continue;
      }
      const previousIndexedFileRef = previousIndexedFileRefs.get(path);
      if (!previousIndexedFileRef) {
        continue;
      }
      indexedTextRequests.push({
        path,
        generation: previousIndexedFileRef.generation,
      });
    }

    if (indexedTextRequests.length > 0) {
      const indexedTexts =
        await this.fileSnapshotStore.readIndexedTexts(indexedTextRequests);
      for (const request of indexedTextRequests) {
        if (!indexedTexts.has(request.path)) {
          continue;
        }
        const fingerprint = hashStableText(indexedTexts.get(request.path) ?? "");
        const existing = deleteCandidatesByFingerprint.get(fingerprint);
        if (existing) {
          existing.push({ path: request.path });
        } else {
          deleteCandidatesByFingerprint.set(fingerprint, [{ path: request.path }]);
        }
      }
    }

    const matchedDeletePaths = new Set<string>();
    const docsToMove: LexicalStartupMove[] = [];
    const remainingAdds: TFile[] = [];

    for (const file of docsToAdd) {
      const plainText = await this.safeReadPlainText(file);
      if (plainText === null) {
        remainingAdds.push(file);
        continue;
      }
      const fingerprint = hashStableText(plainText);
      const candidates =
        deleteCandidatesByFingerprint.get(fingerprint)?.filter(
          (candidate) => !matchedDeletePaths.has(candidate.path),
        ) ?? [];
      if (candidates.length !== 1) {
        remainingAdds.push(file);
        continue;
      }
      matchedDeletePaths.add(candidates[0].path);
      docsToMove.push({
        oldPath: candidates[0].path,
        file,
      });
    }

    return {
      docsToMove,
      docsToAdd: remainingAdds,
      docsToDelete: docsToDelete.filter((path) => !matchedDeletePaths.has(path)),
    };
  }

  private async safeReadPlainText(file: TFile): Promise<string | null> {
    try {
      return await this.dataProvider.readPlainText(file);
    } catch (error) {
      logger.debug(
        `lexical startup move detection failed to read ${file.path}:`,
        error,
      );
      return null;
    }
  }

  private async ensureLexicalDocRegistryEntry(entry: {
    path: string;
    generation?: number;
    deleted?: boolean;
    contentFingerprint?: string;
  }): Promise<DocRegistryRow | undefined> {
    const database = this.database as Database & {
      ensureDocRegistryEntry?: (
        entry: {
          path: string;
          generation?: number;
          deleted?: boolean;
          contentFingerprint?: string;
        },
      ) => Promise<DocRegistryRow>;
    };
    if (!database.ensureDocRegistryEntry) {
      return undefined;
    }
    return await database.ensureDocRegistryEntry(entry);
  }

  private async getLexicalDocRegistryEntry(
    path: string,
  ): Promise<DocRegistryRow | undefined> {
    const database = this.database as Database & {
      getDocRegistryEntry?: (path: string) => Promise<DocRegistryRow | undefined>;
    };
    if (!database.getDocRegistryEntry) {
      return undefined;
    }
    return await database.getDocRegistryEntry(path);
  }

  private async ensureLexicalDocRegistryEntries(
    entries: ReadonlyArray<{
      path: string;
      generation?: number;
      deleted?: boolean;
      contentFingerprint?: string;
    }>,
  ): Promise<Map<string, DocRegistryRow>> {
    const database = this.database as Database & {
      ensureDocRegistryEntries?: (
        entries: ReadonlyArray<{
          path: string;
          generation?: number;
          deleted?: boolean;
          contentFingerprint?: string;
        }>,
      ) => Promise<Map<string, DocRegistryRow>>;
    };
    if (!database.ensureDocRegistryEntries) {
      return new Map<string, DocRegistryRow>();
    }
    return await database.ensureDocRegistryEntries(entries);
  }

  private async attachLexicalDocRefs(
    documents: readonly IndexedDocument[],
  ): Promise<IndexedDocument[]> {
    if (documents.length === 0) {
      return [];
    }
    const docRegistryEntries = await this.ensureLexicalDocRegistryEntries(
      documents.map((document) => ({
        path: document.path,
        generation: document.generation,
        deleted: false,
        contentFingerprint:
          typeof document.content === "string"
            ? hashStableText(document.content)
            : undefined,
      })),
    );
    return documents.map((document) => ({
      ...document,
      docRef: docRegistryEntries.get(document.path)?.docRef ?? document.docRef,
    }));
  }

  private async listLexicalDocRegistryEntries(): Promise<DocRegistryRow[]> {
    const database = this.database as Database & {
      listDocRegistryEntries?: () => Promise<DocRegistryRow[]>;
    };
    if (!database.listDocRegistryEntries) {
      return [];
    }
    return await database.listDocRegistryEntries();
  }

  private async moveLexicalDocRegistryPath(
    oldPath: string,
    newPath: string,
    options?: {
      generation?: number;
      contentFingerprint?: string;
    },
  ): Promise<DocRegistryRow | undefined> {
    const fileSnapshotStore = this.fileSnapshotStore as FileSnapshotStore & {
      moveDocRegistryPath?: (
        oldPath: string,
        newPath: string,
        options?: {
          generation?: number;
          contentFingerprint?: string;
        },
      ) => Promise<DocRegistryRow | undefined>;
    };
    if (!fileSnapshotStore.moveDocRegistryPath) {
      return undefined;
    }
    return await fileSnapshotStore.moveDocRegistryPath(oldPath, newPath, options);
  }

  private async saveLexicalIndexedFileRefs(files: TFile[]) {
    const docRegistryEntries = await this.ensureLexicalDocRegistryEntries(
      files.map((file) => ({
        path: file.path,
        generation: file.stat.mtime,
        deleted: false,
      })),
    );
    const updatedIndexedFileRefs = files.map((file) => ({
      docRef: docRegistryEntries.get(file.path)?.docRef,
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

  private notifyLexicalIndexedTextsCommitted(
    files: ReadonlyArray<{
      path: string;
      generation?: number;
    }>,
  ): void {
    const lexicalEngine = this.lexicalEngine as unknown as FileSearchEngine & {
      notifyIndexedTextsCommitted?: (
        files: ReadonlyArray<{
          path: string;
          generation?: number;
        }>,
      ) => void;
    };
    lexicalEngine.notifyIndexedTextsCommitted?.(files);
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
    const docRegistryEntry = await this.ensureLexicalDocRegistryEntry({
      path: file.path,
      generation,
      deleted: false,
    });
    const nextRef: BaseIndexedFileRef = {
      docRef: docRegistryEntry?.docRef,
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
    progressNotice: HybridProgressReporter | null,
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
    const taskInspections = await this.inspectHybridStoredPaths(
      files.map((item) => item.task.path),
      new Set(files.map((item) => item.task.path)),
    );
    for (const item of files) {
      const inspection = taskInspections.get(item.task.path);
      if (!inspection || inspection.consistency.repairReasons.length === 0) {
        continue;
      }
      logger.debug(
        `hybrid repair clearing inconsistent local state for ${item.task.path}: ${inspection.consistency.repairReasons.join(", ")}`,
      );
      await this.hybridEngine
        .deleteFile(item.task.path, { persistIndices: false })
        .catch((error) =>
          logger.warn(
            `hybrid repair pre-clean failed for ${item.task.path}:`,
            error,
          ),
        );
    }
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
    this.hybridRepairInFlightPaths.add(task.path);
    this.notifyHybridRuntimeStatusChanged();
    logger.debug(
      `hybrid repair task ${task.mode} for ${task.path} (${task.reason})`,
    );
    try {
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
    } finally {
      this.hybridRepairInFlightPaths.delete(task.path);
      this.notifyHybridRuntimeStatusChanged();
    }
  }

  private async indexHybridFileWithRetry(
    file: TFile,
    mode: HybridRepairMode,
  ): Promise<HybridIndexFailure | null> {
    const fileIndexStart = Date.now();
    const text = await this.dataProvider.readPlainText(file.path);
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
      const indexedRef = await this.fileSnapshotStore.getHybridIndexedFileRef(
        file.path,
      );
      if (
        !indexedRef ||
        indexedRef.generation === undefined ||
        indexedRef.generation !== file.stat.mtime
      ) {
        logger.warn(
          `hybrid indexed file ref verification failed immediately after index for ${file.path}: expectedGeneration=${file.stat.mtime}, actualGeneration=${indexedRef?.generation ?? "missing"}, state=${indexedRef?.state ?? "missing"}`,
        );
      } else {
        this.recentlyVerifiedHybridIndexedRefs.set(file.path, {
          generation: indexedRef.generation,
          verifiedAt: Date.now(),
        });
      }
      await this.clearFailedHybridEmbedding(file.path);
      return null;
    } catch (error) {
      lastError = error;
    }

    let fallbackIndexed = false;
    let fallbackError: unknown = null;
    try {
      await this.hybridEngine.indexFile(
        file.path,
        text,
        file.stat.mtime,
        headingOutline,
      );
      fallbackIndexed = true;
    } catch (caughtFallbackError) {
      logger.error(
        `hybrid lexical fallback indexing failed for ${file.path}:`,
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
      fallbackIndexed,
    };
  }

  private async indexHybridFileStructureOnly(
    file: TFile,
  ): Promise<HybridIndexFailure | null> {
    try {
      const text = await this.dataProvider.readPlainText(file.path);
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
      const indexedRef = await this.fileSnapshotStore.getHybridIndexedFileRef(
        file.path,
      );
      if (
        !indexedRef ||
        indexedRef.generation === undefined ||
        indexedRef.generation !== file.stat.mtime
      ) {
        logger.warn(
          `hybrid structure-only ref verification failed for ${file.path}: expectedGeneration=${file.stat.mtime}, actualGeneration=${indexedRef?.generation ?? "missing"}, state=${indexedRef?.state ?? "missing"}`,
        );
      } else {
        this.recentlyVerifiedHybridIndexedRefs.set(file.path, {
          generation: indexedRef.generation,
          verifiedAt: Date.now(),
        });
      }
      return null;
    } catch (error) {
      return {
        path: file.path,
        reason: this.formatHybridIndexError(error),
        attempts: 1,
        fallbackIndexed: false,
      };
    }
  }

  private async getIncrementalEmbedEligibleAt(
    filePath: string,
  ): Promise<number> {
    const ref = await this.fileSnapshotStore.getHybridIndexedFileRef(filePath);
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

  async showDevStorageAndRuntimeStats(): Promise<void> {
    if (!isDevEnvironment) {
      return;
    }
    await this.noticeDevStorageStats();
  }

  async showDevHanDiagnostics(): Promise<void> {
    if (!isDevEnvironment) {
      return;
    }
    await this.noticeDevStorageStats();
  }

  getLexicalAvailabilityState(): LexicalAvailabilityState {
    return buildLexicalAvailabilityState(this.lexicalBootstrapState);
  }

  getHybridAvailabilityState(): HybridAvailabilityState {
    return buildHybridAvailabilityState({
      enabled: this.hybridEngine.isEnabled(),
      bootstrap: this.hybridBootstrapState,
      runtimeGateOpen: this.hybridRuntimeQueryGate === "open",
      canServeQuery: this.hybridEngine.canServeQuery(),
      canSearch: this.hybridEngine.canSearch(),
      hasFailures: this.hybridRecoveryCoordinator.hasFailures(),
      hasIncompleteEmbeddings: this.hasIncompleteHybridEmbeddings(),
    });
  }

  private setHybridRuntimeQueryGate(
    state: HybridRuntimeQueryGateState,
  ): void {
    this.hybridRuntimeQueryGate = state;
  }

  private blockHybridRuntimeQueryGate(): void {
    this.setHybridRuntimeQueryGate("blocked");
  }

  private syncHybridRuntimeQueryGateFromEngine(): void {
    this.setHybridRuntimeQueryGate(
      this.hybridEngine.canServeQuery() ? "open" : "blocked",
    );
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
      this.ensureInVaultSearchFlushListener();
      getInstance(FileWatcher).start();
    }

    this.notifyHybridRuntimeStatusChanged();

    const task = this.commitSearchBootstrapRun()
      .then(async () => {
        this.markSearchBootstrapPhaseCompleted("commit", "commit");
        try {
          await this.logStartupLexicalMemorySummary();
        } catch (error) {
          logger.warn(
            "[clever-search] failed to log startup lexical memory summary:",
            error,
          );
        }
        if (isDevEnvironment) {
          const commitMs = this.searchBootstrapMetrics?.commitMs ?? 0;
          logger.info(
            `[clever-search] search bootstrap commit finished in ${commitMs} ms`,
          );
        }
      })
      .catch((error) => {
        logger.warn("[clever-search] search bootstrap commit failed:", error);
        if (this.lexicalBootstrapState !== "searchable") {
          this.setLexicalBootstrapState("failed");
        }
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
    this.setLexicalBootstrapState("searchable");
    this.markSearchBootstrapSearchable();
    if (this.hybridEngine.isEnabled()) {
      await this.hybridEngine.persistIndicesForBatch();
    }
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
    await this.updateHybridDenseRecoveryState(path, {
      denseTargetGeneration: targetGeneration,
      denseState: "failed",
      nextDenseAttemptAt: Date.now() + this.getFailedEmbeddingRetryIntervalMs(),
      denseServeUntil: Date.now() + this.getFailedEmbeddingRetryIntervalMs(),
      denseFailureKind: reason,
    });
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
    await this.updateHybridDenseRecoveryState(path, {
      denseTargetGeneration: targetGeneration,
      denseState: "pending",
      nextDenseAttemptAt: nextRetryAt ?? undefined,
      denseServeUntil: nextRetryAt ?? undefined,
      denseFailureKind: undefined,
    });
  }

  private async updateHybridDenseRecoveryState(
    path: string,
    patch: Pick<
      DocRegistryRow,
      | "denseTargetGeneration"
      | "denseState"
      | "nextDenseAttemptAt"
      | "denseServeUntil"
      | "denseFailureKind"
    >,
  ): Promise<void> {
    const row = await this.database.getDocRegistryEntry(path);
    if (row == null) {
      return;
    }
    await this.database.db.docRegistry.put({
      ...row,
      ...patch,
      updatedAt: Date.now(),
    });
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

  private ensureInVaultSearchFlushListener(): void {
    if (this.inVaultSearchFlushCallback) {
      return;
    }
    this.inVaultSearchFlushCallback = () => this.flushPendingDocOperations();
    eventBus.on(EventEnum.IN_VAULT_SEARCH, this.inVaultSearchFlushCallback);
  }

  private removeInVaultSearchFlushListener(): void {
    if (!this.inVaultSearchFlushCallback) {
      return;
    }
    eventBus.off(EventEnum.IN_VAULT_SEARCH, this.inVaultSearchFlushCallback);
    this.inVaultSearchFlushCallback = null;
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

  private buildHybridStoredPathInspection(
    summary: HybridStoredPathSummary,
    existsInVault: boolean,
  ): HybridStoredPathInspection {
    return {
      summary,
      consistency: analyzeHybridStoredFileConsistency({
        existsInVault,
        hasChunks: summary.chunkCount > 0,
        chunkCount: summary.chunkCount,
        snapshot:
          summary.currentSnapshotGeneration !== undefined
            ? { generation: summary.currentSnapshotGeneration }
            : undefined,
        shadowSnapshot:
          summary.shadowSnapshotGeneration !== undefined
            ? { generation: summary.shadowSnapshotGeneration }
            : undefined,
        vectorInfo: summary.vectorInfo,
        indexedFileRef: summary.indexedFileRef,
        currentPrecision:
          this.setting.hybrid.vectorCompression === "float16"
            ? "float16"
            : "int8",
      }),
    };
  }

  private async collectHybridStoredPathSummariesForPaths(
    paths: readonly string[],
  ): Promise<Map<string, HybridStoredPathSummary>> {
    const uniquePaths = Array.from(new Set(paths));
    const summaries = new Map<string, HybridStoredPathSummary>();
    if (uniquePaths.length === 0) {
      return summaries;
    }

    for (const path of uniquePaths) {
      summaries.set(path, { chunkCount: 0 });
    }

    for (
      let start = 0;
      start < uniquePaths.length;
      start += DataManager.HYBRID_TABLE_SCAN_BATCH_SIZE
    ) {
      const batchPaths = uniquePaths.slice(
        start,
        start + DataManager.HYBRID_TABLE_SCAN_BATCH_SIZE,
      );
      const registryRows = await this.database.getDocRegistryEntries(batchPaths);
      const docRefs = batchPaths.map((path) => registryRows.get(path)?.docRef ?? -1);
      const generationKeys = batchPaths.map((path, index) => {
        const row = registryRows.get(path);
        return row == null
          ? "__missing__"
          : `${docRefs[index]}:${row.liveGeneration}`;
      });
      const [chunkRows, vectorRows, indexedFileRefs, snapshotRows, shadowRows] =
        await Promise.all([
          this.database.db.hybridChunks
            .where("docRef")
            .anyOf(docRefs)
            .toArray(),
          this.database.db.hybridChunkVectors.bulkGet(generationKeys),
          this.database.db.hybridIndexedFileRefs.bulkGet(docRefs),
          this.database.db.fileSnapshots.bulkGet(generationKeys),
          this.database.db.hybridDirtyShadows.bulkGet(generationKeys),
        ]);

      for (const row of chunkRows) {
        const path = batchPaths[docRefs.indexOf(row.docRef)];
        if (path == null) {
          continue;
        }
        const summary = this.getOrCreateHybridStoredPathSummary(
          summaries,
          path,
        );
        summary.chunkCount += 1;
      }

      for (let index = 0; index < batchPaths.length; index++) {
        const path = batchPaths[index];
        const summary = this.getOrCreateHybridStoredPathSummary(summaries, path);
        const vectorRow = vectorRows[index];
        if (vectorRow) {
          summary.vectorInfo = {
            precision: (vectorRow.precision === "float16"
              ? "float16"
              : "int8") as VectorPrecision,
            chunkCount: vectorRow.chunkCount,
            generation: vectorRow.generation,
          };
        }
        const indexedFileRef = indexedFileRefs[index];
        if (indexedFileRef) {
          summary.indexedFileRef = indexedFileRef;
        }
        const snapshotRow = snapshotRows[index];
        if (snapshotRow) {
          summary.currentSnapshotGeneration = snapshotRow.generation;
        }
        const shadowRow = shadowRows[index];
        if (shadowRow) {
          summary.shadowSnapshotGeneration = shadowRow.generation;
        }
      }
    }

    return summaries;
  }

  private async inspectHybridStoredPaths(
    paths: readonly string[],
    existingPaths: ReadonlySet<string>,
  ): Promise<Map<string, HybridStoredPathInspection>> {
    const summaries = await this.collectHybridStoredPathSummariesForPaths(paths);
    const inspections = new Map<string, HybridStoredPathInspection>();
    for (const path of Array.from(new Set(paths))) {
      const summary = summaries.get(path) ?? { chunkCount: 0 };
      inspections.set(
        path,
        this.buildHybridStoredPathInspection(summary, existingPaths.has(path)),
      );
    }
    return inspections;
  }

  private async collectHybridStoredPathSummaries(): Promise<
    Map<string, HybridStoredPathSummary>
  > {
    const summaries = new Map<string, HybridStoredPathSummary>();
    const registryRows = await this.database.listDocRegistryEntries();
    const pathByDocRef = new Map(registryRows.map((row) => [row.docRef, row.path] as const));
    const keyForRow = (row: { docRef: number }) => pathByDocRef.get(row.docRef);

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
          const path = keyForRow(row);
          if (path == null) {
            continue;
          }
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            path,
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
      (row) => row.id,
      (rows) => {
        for (const row of rows) {
          const path = keyForRow(row);
          if (path == null) {
            continue;
          }
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            path,
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

    await this.scanRowsInBatches<HybridIndexedFileRef, number>(
      (lastDocRef, batchSize) => {
        if (lastDocRef === null) {
          return this.database.db.hybridIndexedFileRefs
            .orderBy("docRef")
            .limit(batchSize)
            .toArray();
        }
        return this.database.db.hybridIndexedFileRefs
          .where("docRef")
          .above(lastDocRef)
          .limit(batchSize)
          .toArray();
      },
      (row) => row.docRef,
      (rows) => {
        for (const row of rows) {
          const path = keyForRow(row);
          if (path == null) {
            continue;
          }
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            path,
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
        await this.database.db.fileSnapshots.bulkGet(
          batchPaths.map((path) => {
            const registryRow = registryRows.find((row) => row.path === path);
            return registryRow == null
              ? "__missing__"
              : `${registryRow.docRef}:${registryRow.liveGeneration}`;
          }),
        );
      for (const row of snapshotRows) {
        if (!row) {
          continue;
        }
        const path = keyForRow(row);
        const summary = path == null ? undefined : summaries.get(path);
        if (summary) {
          summary.currentSnapshotGeneration = row.generation;
        }
      }
    }
    await this.scanRowsInBatches<HybridFileSnapshotRow, string>(
      (lastPath, batchSize) => {
        if (lastPath === null) {
          return this.database.db.hybridDirtyShadows
            .orderBy(":id")
            .limit(batchSize)
            .toArray();
        }
        return this.database.db.hybridDirtyShadows
          .where(":id")
          .above(lastPath)
          .limit(batchSize)
          .toArray();
      },
      (row) => row.id,
      (rows) => {
        for (const row of rows) {
          const path = keyForRow(row);
          if (path == null) {
            continue;
          }
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            path,
          );
          summary.shadowSnapshotGeneration = row.generation;
        }
      },
    );


    return summaries;
  }

  private async repairHybridStoredState(
    currFiles: Map<string, TFile>,
  ): Promise<HybridStorageRepairReport> {
    await this.purgeHybridArtifactsWithoutDocRegistry();
    const summaries = await this.collectHybridStoredPathSummaries();
    const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>();
    const previousDocRegistryEntries = new Map<string, DocRegistryRow>(
      (await this.database.listDocRegistryEntries()).map((row) => [row.path, row]),
    );
    const repairedPaths = new Set<string>();
    const reindexedPaths = new Set<string>();

    for (const [path, summary] of summaries) {
      const existsNow = currFiles.has(path);
      const indexedFileRef = summary.indexedFileRef;
      if (indexedFileRef) {
        previousIndexedFileRefs.set(path, indexedFileRef);
      }
      const { consistency } = this.buildHybridStoredPathInspection(
        summary,
        existsNow,
      );
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
          previousDocRegistryEntries,
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
        hasCurrentSnapshot:
          summaries.get(path)?.currentSnapshotGeneration !== undefined,
        hasShadowSnapshot:
          summaries.get(path)?.shadowSnapshotGeneration !== undefined,
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
        previousDocRegistryEntries,
      };
    }

  private async purgeHybridArtifactsWithoutDocRegistry(): Promise<void> {
    const registryRows = await this.database.listDocRegistryEntries();
    const liveDocRefs = new Set(
      registryRows.filter((row) => !row.deleted).map((row) => row.docRef),
    );
    const [
      chunkRows,
      vectorRows,
      indexedRefs,
      snapshotRows,
      shadowRows,
    ] = await Promise.all([
      this.database.db.hybridChunks.toArray(),
      this.database.db.hybridChunkVectors.toArray(),
      this.database.db.hybridIndexedFileRefs.toArray(),
      this.database.db.fileSnapshots.toArray(),
      this.database.db.hybridDirtyShadows.toArray(),
    ]);
    const chunkIds = chunkRows
      .filter((row) => !liveDocRefs.has(row.docRef))
      .map((row) => row.id)
      .filter((id): id is number => id !== undefined);
    const vectorIds = vectorRows
      .filter((row) => !liveDocRefs.has(row.docRef))
      .map((row) => row.id);
    const refDocRefs = indexedRefs
      .filter((row) => !liveDocRefs.has(row.docRef))
      .map((row) => row.docRef);
    const snapshotIds = snapshotRows
      .filter((row) => !liveDocRefs.has(row.docRef))
      .map((row) => row.id);
    const shadowIds = shadowRows
      .filter((row) => !liveDocRefs.has(row.docRef))
      .map((row) => row.id);
    const removedDenseArtifacts = chunkIds.length > 0 || vectorIds.length > 0;
    if (
      chunkIds.length === 0 &&
      vectorIds.length === 0 &&
      refDocRefs.length === 0 &&
      snapshotIds.length === 0 &&
      shadowIds.length === 0
    ) {
      return;
    }
    await this.database.db.transaction(
      "rw",
      [
        this.database.db.hybridChunks,
        this.database.db.hybridChunkVectors,
        this.database.db.hybridIndexedFileRefs,
        this.database.db.fileSnapshots,
        this.database.db.hybridDirtyShadows,
        this.database.db.indexArtifactState,
      ],
      async () => {
        await Promise.all([
          this.database.db.hybridChunks.bulkDelete(chunkIds),
          this.database.db.hybridChunkVectors.bulkDelete(vectorIds),
          this.database.db.hybridIndexedFileRefs.bulkDelete(refDocRefs),
          this.database.db.fileSnapshots.bulkDelete(snapshotIds),
          this.database.db.hybridDirtyShadows.bulkDelete(shadowIds),
          removedDenseArtifacts
            ? this.database.db.indexArtifactState.put({
                id: buildIndexArtifactStateId("hybrid", "hnsw"),
                engine: "hybrid",
                artifact: "hnsw",
                dirtyAt: Date.now(),
                reason: "startup-orphan-hybrid-artifact-purge",
              })
            : Promise.resolve(),
        ]);
      },
    );
    logger.debug(
      `purged orphan Hybrid artifacts: chunks=${chunkIds.length}, vectors=${vectorIds.length}, refs=${refDocRefs.length}, snapshots=${snapshotIds.length}, shadows=${shadowIds.length}`,
    );
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
        return `Embedding failed: ${this.formatHybridIndexError(embeddingError)} | lexical fallback failed: ${fallbackReason}`;
      }
      return `lexical fallback failed: ${fallbackReason}`;
    }
    return this.formatHybridIndexError(embeddingError);
  }

  private noticeHybridIndexFailures(failures: HybridIndexFailure[]) {
    if (failures.length === 0) {
      return;
    }

    const failedWithoutFallback = failures.filter(
      (item) => !item.fallbackIndexed,
    ).length;
    const message = this.buildHybridFailureNotice(
      failures.length,
      failedWithoutFallback,
    );
    new MyNotice(message, 12000);

    console.groupCollapsed(
      `[clever-search] Hybrid semantic indexing incomplete (${failures.length} files)`,
    );
    failures.forEach((failure) => {
      console.error(
        `[clever-search] ${failure.path}\nAttempts: ${failure.attempts}\nFallback indexed: ${failure.fallbackIndexed}\nReason: ${failure.reason}`,
      );
    });
    console.groupEnd();
  }

  private buildHybridFailureNotice(
    failureCount: number,
    failedWithoutFallback: number,
  ): string {
    const fallbackText =
      failedWithoutFallback > 0
        ? ` ${failedWithoutFallback} file(s) also failed lexical fallback indexing.`
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
          item.name === "hybridHnswSmall" ||
          item.name === "hybridIndexedFileRefs" ||
          item.name === "hybridDirtyShadows",
      )
      .reduce((sum, item) => sum + item.bytes, 0);

    const preflightPathByDocRef = new Map(
      (await this.database.listDocRegistryEntries()).map((row) => [row.docRef, row.path] as const),
    );
    const existingHybridRefs =
      previousIndexedFileRefs !== undefined
        ? new Set(previousIndexedFileRefs.keys())
        : new Set(
            (await this.fileSnapshotStore.listHybridIndexedFileRefs())
              .map((ref) => preflightPathByDocRef.get(ref.docRef))
              .filter((path): path is string => path != null),
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
    const { showDevStorageAndRuntimeStats } = await import("./data-manager.dev");
    await showDevStorageAndRuntimeStats(this);
  }

  private sampleJsHeapUsage(): unknown {
    const memory = (
      performance as typeof performance & {
        memory?: {
          usedJSHeapSize?: number;
          totalJSHeapSize?: number;
          jsHeapSizeLimit?: number;
        };
      }
    ).memory;
    if (
      !memory ||
      typeof memory.usedJSHeapSize !== "number" ||
      typeof memory.totalJSHeapSize !== "number" ||
      typeof memory.jsHeapSizeLimit !== "number"
    ) {
      return null;
    }
    return {
      usedBytes: memory.usedJSHeapSize,
      totalBytes: memory.totalJSHeapSize,
      limitBytes: memory.jsHeapSizeLimit,
    };
  }

  private buildStartupLexicalMemorySummaryLines(report: unknown): string[] {
    const {
      buildStartupLexicalMemorySummaryLines,
    } = require("./data-manager.dev") as typeof import("./data-manager.dev");
    return buildStartupLexicalMemorySummaryLines(this, report as never);
  }

  private async logStartupLexicalMemorySummary(): Promise<void> {
    const { logStartupLexicalMemorySummary } = await import("./data-manager.dev");
    await logStartupLexicalMemorySummary(this);
  }

  private async sampleDevJsHeapUsage(): Promise<unknown> {
    const { sampleJsHeapUsage } = await import("./data-manager.dev");
    return sampleJsHeapUsage(this);
  }

  private async summarizeDevLexicalHeapDelta(
    before: unknown,
    after: unknown,
  ): Promise<unknown> {
    const { summarizeLexicalHeapDelta } = await import("./data-manager.dev");
    return summarizeLexicalHeapDelta(this, before, after);
  }

  private formatBytes(bytes: number): string {
    return formatBytesLabel(bytes);
  }
}
