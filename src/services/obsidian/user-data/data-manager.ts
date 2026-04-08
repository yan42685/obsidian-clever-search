import { Notice, TFile, type TAbstractFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import type CleverSearch from "src/main";
import { Database } from "src/services/database/database";
import { extractHanSegments } from "src/services/search/coverage-lexical/coverage-lexical-cjk";
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
import {
  retryAsync,
  runWeightedTasks,
} from "src/services/search/hybrid/runtime-control";
import type { VectorPrecision } from "src/services/search/hybrid/hybrid-types";
import { LexicalEngine } from "src/services/search/lexical-engine";
import type { SerializedFileSearchIndex } from "src/services/search/file-search-engine";
import { CoverageLexicalBodyTokenColdStore } from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-store";
import {
  COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
  type CoverageLexicalBodyTokenColdStoreApi,
  type CoverageLexicalBodyTokenColdDocumentWrite,
} from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types";
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
import { container, singleton } from "tsyringe";
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
  shareOfStringPool?: string;
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

type DevRuntimePartitionRow = {
  segment: string;
  bytes: number;
  size: string;
  shareOfPluginRuntime: string;
  shareOfJsHeapUsed: string;
  shareOfVault: string;
};

type DevFileSnapshotRuntimeRow = {
  segment: string;
  bytes: number;
  size: string;
  shareOfCurrentTextRuntime: string;
  shareOfPluginRuntime: string;
  shareOfVault: string;
  notes: string;
};

type DevHeapContextRow = {
  metric: string;
  bytes: number;
  size: string;
  ratio: string;
};

type DevLexicalStringOwnershipRow = {
  segment: string;
  ownerBytes: number;
  ownerSize: string;
  uniqueStringBytes: number;
  uniqueStringSize: string;
  uniqueStrings: number;
  shareOfLexical: string;
  shareOfVault: string;
  notes: string;
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

function ensureCoverageLexicalBodyTokenColdStoreRegistered(): void {
  if (container.isRegistered(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, false)) {
    return;
  }
  container.registerSingleton(
    COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
    CoverageLexicalBodyTokenColdStore,
  );
}

@singleton()
export class DataManager {
  private static readonly HYBRID_INDEX_MAX_RETRIES = 3;
  private static readonly HYBRID_INDEX_RETRY_DELAY_MS = 1500;
  private static readonly HYBRID_TABLE_SCAN_BATCH_SIZE = 512;
  private static readonly LEXICAL_REINDEX_BATCH_SIZE = 64;
  private static readonly LEXICAL_REINDEX_MAX_BYTES = 8 * 1024 * 1024;
  private static readonly LEXICAL_COLD_REPAIR_BATCH_SIZE = 32;
  private static readonly LEXICAL_COLD_REPAIR_MAX_BYTES = 4 * 1024 * 1024;
  private static readonly LEXICAL_COLD_REPAIR_SYNC_MAX_PATHS = 128;
  private static readonly LEXICAL_COLD_REPAIR_SYNC_MAX_BYTES = 8 * 1024 * 1024;
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
  private readonly lexicalBodyTokenColdStoreRegistration =
    ensureCoverageLexicalBodyTokenColdStoreRegistered();
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
  private lexicalColdRepairTask: Promise<void> | null = null;
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
  private isUnloaded = false;
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
    if (this.isUnloaded) {
      return;
    }
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
  };

  private docOperationsBuffer = new DocOperationBuffer(
    this.docOperationsHandler,
    3,
  );

  @monitorDecorator
  async initAsync(options: DataManagerInitOptions = {}) {
    this.isUnloaded = false;
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
    void this.flushLexicalSnapshotIfDirty(true);
    this.clearLexicalSnapshotFlushTimer();
    this.clearHybridRepairScheduler();
    this.hybridFreshnessMaintenanceTask = null;
    this.hybridFreshnessMaintenanceQueued = false;
    this.lastHybridStaleWarnSignature = null;
    this.clearHybridFailedEmbeddingState();
    this.hideLexicalIndexFailureNotice();
    this.lexicalIndexFailuresByPath.clear();
    this.lexicalColdRepairTask = null;
    this.searchBootstrapCommitTask = null;
    this.setLexicalBootstrapState("blocked");
    this.setHybridBootstrapState("blocked");
  }

  receiveDocOperation(operation: DocOperation) {
    this.docOperationsBuffer.add(operation);
  }

  private async runSearchBootstrapPipeline(): Promise<SearchBootstrapCompletionSummary> {
    const databaseUpgradeDetected =
      await this.database.openAndConsumeSchemaUpgradeFlag();
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
      ? this.sampleJsHeapUsage()
      : null;
    this.latestLexicalHeapDelta = null;
    this.markSearchBootstrapPhaseStarted("lexical", "heal");
    await this.healLexicalBootstrapPlan(lexicalPlan);
    this.markSearchBootstrapPhaseCompleted("lexical", "heal");
    this.setLexicalBootstrapState("searchable");
    this.markSearchBootstrapSearchable();

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
      const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>(
        (await this.fileSnapshotStore.listHybridIndexedFileRefs()).map((ref) => [
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
    await this.fileSnapshotStore.publishIndexedTexts([
      {
        path: file.path,
        generation,
      },
    ]);
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
    await this.fileSnapshotStore.publishIndexedTexts(
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
    await this.deleteLexicalFileState([oldPath, newPath]);

    const file = this.dataProvider.getFileByPath(newPath);
    if (!file || !this.dataProvider.isIndexable(file)) {
      await this.clearFailedHybridEmbedding(oldPath);
      await this.clearFailedHybridEmbedding(newPath);
      await this.handleDeleteOperation(newPath);
      if (this.hybridEngine.isEnabled()) {
        await this.hybridEngine.deleteFile(oldPath);
      }
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
    if (this.shouldForceLexicalRebuildAfterSnapshotRestore()) {
      logger.warn(
        "Restored lexical snapshot is inconsistent with persisted lexical indexed refs. Rebuilding lexical index.",
      );
      new MyNotice("Lexical snapshot drift detected. Rebuilding the lexical index...", 5000);
      this.lexicalEngine.clearIndex();
      return {
        needsFullReindex: true,
        needsRefHeal: false,
      };
    }

    return {
      needsFullReindex: false,
      needsRefHeal: !this.isLexicalEngineUpToDate,
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
    if (plan.needsFullReindex) {
      await this.reindexLexicalEngineWithCurrFiles();
      await this.syncLexicalBodyTokenColdStoreMetadata();
      return;
    }
    if (plan.needsRefHeal) {
      await this.updateLexicalIndexedFileRefsByMtime();
    } else {
      await this.ensureLexicalIndexedFileRefsLoaded();
    }
    await this.healLexicalBodyTokenColdRows();
  }

  private async commitLexicalBootstrapPlan(): Promise<void> {
    logger.trace("Lexical engine is ready");
    await this.persistLexicalSearchSnapshotIfAvailable();
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
      this.lexicalEngine.finishBatchReindex();
    } catch (error) {
      this.lexicalEngine.abortBatchReindex();
      throw error;
    } finally {
      progressNotice.hide();
    }
    await this.saveLexicalIndexedFileRefs(successfulFiles);
    await this.fileSnapshotStore.publishIndexedTexts(
      successfulFiles.map((file) => ({
        path: file.path,
        generation: file.stat.mtime,
      })),
    );
    await this.fileSnapshotStore.retainOnlyFiles(indexedPaths);
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
    await this.fileSnapshotStore.removeFiles(docsToDelete);
    const addResult = await this.addDocuments(docsToAdd);
    await this.fileSnapshotStore.publishIndexedTexts(
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
    await this.syncLexicalBodyTokenColdStoreMetadata();
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
    await this.syncLexicalBodyTokenColdStoreMetadata();
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
    await this.syncLexicalBodyTokenColdStoreMetadata();
  }

  private getLexicalBodyTokenColdStore(): CoverageLexicalBodyTokenColdStoreApi | null {
    if (!container.isRegistered(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, false)) {
      return null;
    }
    try {
      return container.resolve<CoverageLexicalBodyTokenColdStoreApi>(
        COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
      );
    } catch {
      return null;
    }
  }

  private async syncLexicalBodyTokenColdStoreMetadata(): Promise<void> {
    const coldStore = this.getLexicalBodyTokenColdStore();
    if (!coldStore) {
      return;
    }
    await this.ensureLexicalIndexedFileRefsLoaded();
    await coldStore.updateIndexedRefsMetadata(
      Array.from(this.lexicalIndexedFileRefsByPath.values()),
    );
  }

  private async healLexicalBodyTokenColdRows(): Promise<void> {
    const coldStore = this.getLexicalBodyTokenColdStore();
    if (!coldStore) {
      return;
    }
    const indexedFileRefs = Array.from(this.lexicalIndexedFileRefsByPath.values());
    const consistency = await coldStore.inspectConsistency(indexedFileRefs);
    if (!consistency.needsRepair) {
      await coldStore.updateIndexedRefsMetadata(indexedFileRefs);
      return;
    }

    logger.trace("repairing lexical body token cold rows", {
      reason: consistency.reason,
      requiresReset: consistency.requiresReset,
      missingOrStaleCount: consistency.missingOrStalePaths.length,
      danglingCount: consistency.danglingPaths.length,
    });
    const missingOrStaleFiles = consistency.missingOrStalePaths
      .map((path) => this.dataProvider.getFileByPath(path))
      .filter((file): file is TFile => file !== null);
    const estimatedRepairBytes = missingOrStaleFiles.reduce(
      (sum, file) => sum + Math.max(0, file.stat.size ?? 0),
      0,
    );
    const shouldRepairSynchronously =
      consistency.missingOrStalePaths.length <=
        DataManager.LEXICAL_COLD_REPAIR_SYNC_MAX_PATHS &&
      estimatedRepairBytes <= DataManager.LEXICAL_COLD_REPAIR_SYNC_MAX_BYTES;

    if (shouldRepairSynchronously) {
      await this.executeLexicalBodyTokenColdRepair(
        coldStore,
        indexedFileRefs,
        consistency,
        missingOrStaleFiles,
      );
      return;
    }

    logger.trace("queueing lexical body token cold repair in background", {
      reason: consistency.reason,
      missingOrStaleCount: consistency.missingOrStalePaths.length,
      danglingCount: consistency.danglingPaths.length,
      estimatedRepairBytes,
    });
    this.queueLexicalBodyTokenColdRepair();
  }

  private async buildLexicalBodyTokenColdDocuments(
    files: readonly TFile[],
  ): Promise<CoverageLexicalBodyTokenColdDocumentWrite[]> {
    const textsByPath = await this.fileSnapshotStore.readCurrentTexts(files);
    return files.map((file) => {
      const plainText = textsByPath.get(file.path) ?? "";
      return {
        path: file.path,
        generation: file.stat.mtime,
        bodyTokens: this.tokenizer
          .tokenizeSequence(plainText, "index")
          .map((token) => token.toLowerCase()),
        hanSegments: extractHanSegments(plainText),
      };
    });
  }

  private buildLexicalBodyTokenColdRepairBatches(
    files: readonly TFile[],
  ): TFile[][] {
    return this.buildFileBatches(
      files,
      DataManager.LEXICAL_COLD_REPAIR_BATCH_SIZE,
      DataManager.LEXICAL_COLD_REPAIR_MAX_BYTES,
    );
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

  private queueLexicalBodyTokenColdRepair(): void {
    if (this.lexicalColdRepairTask) {
      return;
    }
    this.lexicalColdRepairTask = (async () => {
      try {
        if (this.isUnloaded) {
          return;
        }
        const coldStore = this.getLexicalBodyTokenColdStore();
        if (!coldStore) {
          return;
        }
        await this.ensureLexicalIndexedFileRefsLoaded();
        const indexedFileRefs = Array.from(this.lexicalIndexedFileRefsByPath.values());
        const consistency = await coldStore.inspectConsistency(indexedFileRefs);
        if (!consistency.needsRepair) {
          await coldStore.updateIndexedRefsMetadata(indexedFileRefs);
          return;
        }
        const missingOrStaleFiles = consistency.missingOrStalePaths
          .map((path) => this.dataProvider.getFileByPath(path))
          .filter((file): file is TFile => file !== null);
        await this.executeLexicalBodyTokenColdRepair(
          coldStore,
          indexedFileRefs,
          consistency,
          missingOrStaleFiles,
        );
      } catch (error) {
        logger.warn("lexical body token cold repair failed:", error);
      } finally {
        this.lexicalColdRepairTask = null;
      }
    })();
  }

  private async executeLexicalBodyTokenColdRepair(
    coldStore: CoverageLexicalBodyTokenColdStoreApi,
    indexedFileRefs: readonly BaseIndexedFileRef[],
    consistency: CoverageLexicalBodyTokenColdConsistencySummary,
    missingOrStaleFiles: readonly TFile[],
  ): Promise<void> {
    if (consistency.requiresReset) {
      await coldStore.clearAll();
    } else if (consistency.danglingPaths.length > 0) {
      await coldStore.deleteDocuments(consistency.danglingPaths);
    }

    if (missingOrStaleFiles.length > 0) {
      const repairBatches =
        this.buildLexicalBodyTokenColdRepairBatches(missingOrStaleFiles);
      for (let index = 0; index < repairBatches.length; index += 1) {
        if (this.isUnloaded) {
          return;
        }
        const batchFiles = repairBatches[index];
        const batchDocuments =
          await this.buildLexicalBodyTokenColdDocuments(batchFiles);
        await coldStore.upsertDocuments(batchDocuments);
        if (index + 1 < repairBatches.length) {
          await MyLib.sleep(0);
        }
      }
    }

    await coldStore.updateIndexedRefsMetadata(indexedFileRefs);
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
      const [chunkRows, vectorRows, indexedFileRefs, snapshotRows, shadowRows] =
        await Promise.all([
          this.database.db.hybridChunks
            .where("filePath")
            .anyOf(batchPaths)
            .toArray(),
          this.database.db.hybridChunkVectors.bulkGet(batchPaths),
          this.database.db.hybridIndexedFileRefs.bulkGet(batchPaths),
          this.database.db.fileSnapshots.bulkGet(batchPaths),
          this.database.db.hybridDirtyShadows.bulkGet(batchPaths),
        ]);

      for (const row of chunkRows) {
        const summary = this.getOrCreateHybridStoredPathSummary(
          summaries,
          row.filePath,
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
      (row) => row.filePath,
      (rows) => {
        for (const row of rows) {
          const summary = this.getOrCreateHybridStoredPathSummary(
            summaries,
            row.filePath,
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
    const summaries = await this.collectHybridStoredPathSummaries();
    const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>();
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

    const existingHybridRefs =
      previousIndexedFileRefs !== undefined
        ? new Set(previousIndexedFileRefs.keys())
        : new Set(
            (await this.fileSnapshotStore.listHybridIndexedFileRefs()).map(
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
    const fileSnapshotRuntimeEstimate =
      this.fileSnapshotStore.getRuntimeMemoryEstimate();
    const jsHeapUsage = this.sampleJsHeapUsage();
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
        "CurrentTextRuntime",
        fileSnapshotRuntimeEstimate.totalBytes,
        `${fileSnapshotRuntimeEstimate.fileCount} file(s)`,
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
    const runtimePartitionBreakdown = this.buildPluginRuntimeBreakdown(
      runtimeRows,
      runtimeTotalBytes,
      indexableBytes,
      jsHeapUsage,
    );
    const fileSnapshotRuntimeBreakdown =
      this.buildFileSnapshotRuntimeBreakdown(
        fileSnapshotRuntimeEstimate,
        runtimeTotalBytes,
        indexableBytes,
      );
    const heapContextRows = this.buildPluginHeapContextRows(
      runtimeTotalBytes,
      jsHeapUsage,
    );
    const prominentJsHeapNoticeLines = this.buildProminentJsHeapNoticeLines(
      runtimeTotalBytes,
      jsHeapUsage,
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
          ...prominentJsHeapNoticeLines,
          ...runtimePartitionBreakdown.noticeLines,
          ...fileSnapshotRuntimeBreakdown.noticeLines,
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
    prominentJsHeapNoticeLines.forEach((line) => {
      console.log(`[clever-search] ${line}`);
    });
    console.log(
      `Runtime total (estimate): ${this.formatBytes(runtimeTotalBytes)}`,
    );
    runtimePartitionBreakdown.noticeLines.forEach((line) => {
      console.log("[clever-search] " + line);
    });
    fileSnapshotRuntimeBreakdown.noticeLines.forEach((line) => {
      console.log("[clever-search] " + line);
    });
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
    if (runtimePartitionBreakdown.rows.length > 0) {
      console.log("[clever-search] Plugin runtime breakdown");
      console.table(runtimePartitionBreakdown.rows);
    }
    if (fileSnapshotRuntimeBreakdown.rows.length > 0) {
      console.log("[clever-search] Current text runtime breakdown");
      console.table(fileSnapshotRuntimeBreakdown.rows);
    }
    if (fileSnapshotRuntimeBreakdown.largestEntryRows.length > 0) {
      console.log("[clever-search] Current text largest resident entries");
      console.table(fileSnapshotRuntimeBreakdown.largestEntryRows);
    }
    if (heapContextRows.length > 0) {
      console.log("[clever-search] Plugin runtime vs JS heap");
      console.table(heapContextRows);
    }
    if (lexicalRuntimeBreakdown.rows.length > 0) {
      console.log(
        "[clever-search] Lexical runtime breakdown (exclusive segments)",
      );
      console.table(lexicalRuntimeBreakdown.rows);
    }
    if (lexicalRuntimeBreakdown.stringPoolGroupRows.length > 0) {
      console.log("[clever-search] Lexical stringPool breakdown (groups)");
      console.table(lexicalRuntimeBreakdown.stringPoolGroupRows);
    }
    if (lexicalRuntimeBreakdown.stringPoolSourceRows.length > 0) {
      console.log("[clever-search] Lexical stringPool breakdown (sources)");
      console.table(lexicalRuntimeBreakdown.stringPoolSourceRows);
    }
    if (lexicalRuntimeBreakdown.stringOwnershipRows.length > 0) {
      console.log("[clever-search] Lexical string ownership hotspots");
      console.table(lexicalRuntimeBreakdown.stringOwnershipRows);
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

  private buildProminentJsHeapNoticeLines(
    runtimeTotalBytes: number,
    jsHeapUsage: JsHeapUsageSample | null,
  ): string[] {
    if (!jsHeapUsage) {
      return [];
    }
    const unattributedJsHeapUsed = Math.max(
      0,
      jsHeapUsage.usedBytes - runtimeTotalBytes,
    );
    return [
      'JS heap used now: ' + this.formatBytes(jsHeapUsage.usedBytes),
      'JS heap committed now: ' + this.formatBytes(jsHeapUsage.totalBytes),
      'JS heap unattributed beyond plugin estimate: ' +
        this.formatBytes(unattributedJsHeapUsed) +
        ' (' +
        this.formatPercent(unattributedJsHeapUsed, jsHeapUsage.usedBytes) +
        ')',
    ];
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
    stringPoolGroupRows: DevStorageBreakdownRow[];
    stringPoolSourceRows: DevStorageBreakdownRow[];
    stringOwnershipRows: DevLexicalStringOwnershipRow[];
  } {
    if (!breakdown) {
      return {
        noticeLines: [],
        summaryLine: null,
        rows: [],
        stringPoolGroupRows: [],
        stringPoolSourceRows: [],
        stringOwnershipRows: [],
      };
    }

    const estimatedBytes = this.asRecord(breakdown.estimatedBytes);
    if (!estimatedBytes) {
      return {
        noticeLines: [],
        summaryLine: null,
        rows: [],
        stringPoolGroupRows: [],
        stringPoolSourceRows: [],
        stringOwnershipRows: [],
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

    pushSegment('stringPool', this.asRecord(estimatedBytes.stringPool)?.bytes);
    pushSegment('documents.store', documents?.total);
    pushSegment('documentIdentity.core', documentIdentityCoreBytes);
    pushSegment(
      'documentIdentity.bodyTokenLexicon',
      bodyTokenLexicon?.total,
    );
    pushSegment('doc.bodyTokens', bodyTokensById?.total);
    pushSegment('doc.bodyHanSegments', bodyHanSegmentsById?.total);
    pushSegment('doc.tagValues', tagValuesById?.total);
    pushSegment('lexicon', this.asRecord(estimatedBytes.lexicon)?.total);

    const postings = this.asRecord(estimatedBytes.postings);
    let postingsTotalBytes = 0;
    if (postings) {
      for (const [key, value] of Object.entries(postings)) {
        const total = this.readNumber(this.asRecord(value)?.total);
        if (total === null || total <= 0) {
          continue;
        }
        postingsTotalBytes += total;
        pushSegment('postings.' + key, total);
      }
    }

    let accountedBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0);
    const unattributedBytes = Math.max(0, totalBytes - accountedBytes);
    if (unattributedBytes > 0) {
      pushSegment('other', unattributedBytes);
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
    const stringPool = this.asRecord(estimatedBytes.stringPool);
    const buildStringPoolRows = (
      entries: Record<string, unknown> | null | undefined,
    ): DevStorageBreakdownRow[] => {
      const stringPoolBytes = this.readNumber(stringPool?.bytes) ?? 0;
      if (!entries || totalBytes <= 0 || stringPoolBytes <= 0) {
        return [];
      }
      const rows: DevStorageBreakdownRow[] = [];
      for (const [segment, value] of Object.entries(entries)) {
        const record = this.asRecord(value);
        const bytes = this.readNumber(record?.bytes);
        if (bytes === null || bytes <= 0) {
          continue;
        }
        rows.push({
          segment,
          bytes,
          size: this.formatBytes(bytes),
          shareOfStringPool: this.formatPercent(bytes, stringPoolBytes),
          shareOfLexical: this.formatPercent(bytes, totalBytes),
          shareOfVault: this.formatPercent(bytes, indexableBytes),
        });
      }
      rows.sort((left, right) => right.bytes - left.bytes);
      const accountedBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
      const remainderBytes = Math.max(0, stringPoolBytes - accountedBytes);
      if (remainderBytes > 0) {
        rows.push({
          segment: "__unattributed__",
          bytes: remainderBytes,
          size: this.formatBytes(remainderBytes),
          shareOfStringPool: this.formatPercent(remainderBytes, stringPoolBytes),
          shareOfLexical: this.formatPercent(remainderBytes, totalBytes),
          shareOfVault: this.formatPercent(remainderBytes, indexableBytes),
        });
      }
      return rows.sort((left, right) => right.bytes - left.bytes);
    };
    const stringPoolGroupRows = buildStringPoolRows(
      this.asRecord(stringPool?.byGroup),
    );
    const stringPoolSourceRows = buildStringPoolRows(
      this.asRecord(stringPool?.bySource),
    ).slice(0, 12);
    const stringOwnershipRows = this.buildLexicalStringOwnershipRows(
      estimatedBytes,
      totalBytes,
      indexableBytes,
    );

    if (rows.length === 0 || totalBytes <= 0) {
      return {
        noticeLines: [],
        summaryLine: null,
        rows,
        stringPoolGroupRows,
        stringPoolSourceRows,
        stringOwnershipRows,
      };
    }

    const headline =
      'Coverage live index (exclusive): ' +
      this.formatBytes(totalBytes) +
      ' (' +
      this.formatPercent(totalBytes, indexableBytes) +
      ' of vault)';
    const majorGroupsLine =
      'Coverage major groups: ' +
      ([
        [
          'stringPool',
          this.readNumber(this.asRecord(estimatedBytes.stringPool)?.bytes) ?? 0,
        ],
        ['postings(total)', postingsTotalBytes],
        [
          'documentIdentity(total)',
          this.readNumber(documentIdentity?.total) ?? 0,
        ],
        ['documents(total)', this.readNumber(documents?.total) ?? 0],
        [
          'lexicon',
          this.readNumber(this.asRecord(estimatedBytes.lexicon)?.total) ?? 0,
        ],
      ] as Array<[string, number]>)
        .filter(([, bytes]) => bytes > 0)
        .map(([segment, bytes]) => segment + ' ' + this.formatBytes(bytes))
        .join(' | ');
    const topLine =
      'Coverage top segments: ' +
      sortedSegments
        .slice(0, 6)
        .map((segment) => segment.segment + ' ' + this.formatBytes(segment.bytes))
        .join(' | ');
    const accountingLine =
      'Coverage accounted segments: ' +
      this.formatBytes(accountedBytes) +
      ' / ' +
      this.formatBytes(totalBytes);

    return {
      noticeLines: [headline, majorGroupsLine, topLine, accountingLine],
      summaryLine:
        headline +
        '; ' +
        majorGroupsLine +
        '; ' +
        topLine +
        '; ' +
        accountingLine,
      rows,
      stringPoolGroupRows,
      stringPoolSourceRows,
      stringOwnershipRows,
    };
  }

  private buildFileSnapshotRuntimeBreakdown(
    estimate: FileSnapshotRuntimeMemoryEstimate,
    runtimeTotalBytes: number,
    indexableBytes: number,
  ): {
    noticeLines: string[];
    rows: DevFileSnapshotRuntimeRow[];
    largestEntryRows: Array<Record<string, string | number>>;
  } {
    const rows = [
      {
        segment: "texts",
        bytes: estimate.currentTextBytes,
        notes: "resident normalized plain text owned by FileSnapshotStore",
      },
      {
        segment: "paths",
        bytes: estimate.pathBytes,
        notes: "file path keys retained for resident-cache lookups",
      },
      {
        segment: "generations",
        bytes: estimate.generationBytes,
        notes: "generation markers used by aligned reads and publish checks",
      },
    ]
      .filter((row) => row.bytes > 0)
      .sort((left, right) => right.bytes - left.bytes)
      .map((row) => ({
        segment: row.segment,
        bytes: row.bytes,
        size: this.formatBytes(row.bytes),
        shareOfCurrentTextRuntime: this.formatPercent(
          row.bytes,
          estimate.totalBytes,
        ),
        shareOfPluginRuntime: this.formatPercent(row.bytes, runtimeTotalBytes),
        shareOfVault: this.formatPercent(row.bytes, indexableBytes),
        notes: row.notes,
      }));

    const noticeLines: string[] = [];
    if (rows.length > 0) {
      noticeLines.push(
        "Current text runtime split: " +
          rows
            .slice(0, 3)
            .map((row) => row.segment + " " + row.size)
            .join(" | "),
      );
    }
    if (estimate.slotCount > 0 || estimate.fileCount > 0) {
      noticeLines.push(
        "Current text cache slots: live " +
          estimate.fileCount +
          " | total " +
          estimate.slotCount +
          " | free " +
          estimate.freeSlotCount,
      );
    }
    if (estimate.largestEntries.length > 0) {
      noticeLines.push(
        "Current text largest entries: " +
          estimate.largestEntries
            .slice(0, 3)
            .map((entry) => entry.path + " " + this.formatBytes(entry.totalBytes))
            .join(" | "),
      );
    }

    const largestEntryRows = estimate.largestEntries.map((entry) => ({
      path: entry.path,
      totalBytes: entry.totalBytes,
      totalSize: this.formatBytes(entry.totalBytes),
      textBytes: entry.textBytes,
      textSize: this.formatBytes(entry.textBytes),
      pathBytes: entry.pathBytes,
      pathSize: this.formatBytes(entry.pathBytes),
      generationBytes: entry.generationBytes,
      generationSize: this.formatBytes(entry.generationBytes),
      shareOfCurrentTextRuntime: this.formatPercent(
        entry.totalBytes,
        estimate.totalBytes,
      ),
    }));

    return {
      noticeLines,
      rows,
      largestEntryRows,
    };
  }

  private buildPluginRuntimeBreakdown(
    runtimeRows: DevStorageSummaryRow[],
    runtimeTotalBytes: number,
    indexableBytes: number,
    jsHeapUsage: JsHeapUsageSample | null,
  ): {
    noticeLines: string[];
    rows: DevRuntimePartitionRow[];
  } {
    if (runtimeRows.length === 0) {
      return {
        noticeLines: [],
        rows: [],
      };
    }

    const rows = [...runtimeRows]
      .sort((left, right) => right.bytes - left.bytes)
      .map((row) => ({
        segment: row.category,
        bytes: row.bytes,
        size: this.formatBytes(row.bytes),
        shareOfPluginRuntime: this.formatPercent(row.bytes, runtimeTotalBytes),
        shareOfJsHeapUsed: jsHeapUsage
          ? this.formatPercent(row.bytes, jsHeapUsage.usedBytes)
          : 'n/a',
        shareOfVault: this.formatPercent(row.bytes, indexableBytes),
      }));
    const topSegments = rows
      .filter((row) => row.bytes > 0)
      .slice(0, 3)
      .map((row) => row.segment + ' ' + row.size)
      .join(' | ');
    const noticeLines = topSegments.length
      ? ['Plugin runtime split: ' + topSegments]
      : [];
    const hybridRuntimeLine = [
      ['vectors', rows.find((row) => row.segment === 'HybridRuntimeVectors')?.size],
      ['graph', rows.find((row) => row.segment === 'HybridRuntimeGraph')?.size],
    ]
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([segment, size]) => segment + ' ' + size)
      .join(' | ');
    if (hybridRuntimeLine.length > 0) {
      noticeLines.push('Hybrid runtime: ' + hybridRuntimeLine);
    }
    if (jsHeapUsage) {
      noticeLines.push(
        'Plugin runtime vs JS heap used: ' +
          this.formatBytes(runtimeTotalBytes) +
          ' / ' +
          this.formatBytes(jsHeapUsage.usedBytes) +
          ' (' +
          this.formatPercent(runtimeTotalBytes, jsHeapUsage.usedBytes) +
          ')',
      );
    }
    return {
      noticeLines,
      rows,
    };
  }

  private buildPluginHeapContextRows(
    runtimeTotalBytes: number,
    jsHeapUsage: JsHeapUsageSample | null,
  ): DevHeapContextRow[] {
    const rows: DevHeapContextRow[] = [
      {
        metric: "pluginRuntimeEstimate",
        bytes: runtimeTotalBytes,
        size: this.formatBytes(runtimeTotalBytes),
        ratio: jsHeapUsage
          ? this.formatPercent(runtimeTotalBytes, jsHeapUsage.usedBytes)
          : "n/a",
      },
    ];
    if (!jsHeapUsage) {
      return rows;
    }
    const unattributedJsHeapUsed = Math.max(
      0,
      jsHeapUsage.usedBytes - runtimeTotalBytes,
    );
    rows.push(
      {
        metric: "jsHeapUsedNow",
        bytes: jsHeapUsage.usedBytes,
        size: this.formatBytes(jsHeapUsage.usedBytes),
        ratio: "100.0%",
      },
      {
        metric: "unattributedJsHeapUsed",
        bytes: unattributedJsHeapUsed,
        size: this.formatBytes(unattributedJsHeapUsed),
        ratio: this.formatPercent(unattributedJsHeapUsed, jsHeapUsage.usedBytes),
      },
      {
        metric: "jsHeapCommittedNow",
        bytes: jsHeapUsage.totalBytes,
        size: this.formatBytes(jsHeapUsage.totalBytes),
        ratio: this.formatPercent(jsHeapUsage.usedBytes, jsHeapUsage.totalBytes),
      },
      {
        metric: "jsHeapLimit",
        bytes: jsHeapUsage.limitBytes,
        size: this.formatBytes(jsHeapUsage.limitBytes),
        ratio: this.formatPercent(jsHeapUsage.usedBytes, jsHeapUsage.limitBytes),
      },
    );
    return rows;
  }

  private buildLexicalStringOwnershipRows(
    estimatedBytes: Record<string, unknown>,
    lexicalTotalBytes: number,
    indexableBytes: number,
  ): DevLexicalStringOwnershipRow[] {
    const stringPool = this.asRecord(estimatedBytes.stringPool);
    const stringPoolBySource = this.asRecord(stringPool?.bySource);
    const stringPoolByGroup = this.asRecord(stringPool?.byGroup);
    const documents = this.asRecord(estimatedBytes.documents);
    const documentIdentity = this.asRecord(estimatedBytes.documentIdentity);
    const postings = this.asRecord(estimatedBytes.postings);
    const lexicon = this.asRecord(estimatedBytes.lexicon);

    const readStringPoolEntry = (
      entryType: "source" | "group",
      key: string,
    ): { bytes: number; uniqueStrings: number } => {
      const entry = this.asRecord(
        entryType === "source" ? stringPoolBySource?.[key] : stringPoolByGroup?.[key],
      );
      return {
        bytes: this.readNumber(entry?.bytes) ?? 0,
        uniqueStrings: this.readNumber(entry?.uniqueStrings) ?? 0,
      };
    };
    const readOwnerBytes = (
      record: Record<string, unknown> | null | undefined,
      ...fields: string[]
    ): number =>
      fields.reduce((sum, field) => sum + (this.readNumber(record?.[field]) ?? 0), 0);
    const sumPostingOwnerBytes = (keys: string[]): number =>
      keys.reduce((sum, key) => {
        const posting = this.asRecord(postings?.[key]);
        return sum + (this.readNumber(posting?.termReferenceBytes) ?? 0);
      }, 0);
    const rows: DevLexicalStringOwnershipRow[] = [];
    const pushRow = (
      segment: string,
      ownerBytes: number,
      stringPoolEntry: { bytes: number; uniqueStrings: number },
      notes: string,
    ) => {
      if (ownerBytes <= 0 && stringPoolEntry.bytes <= 0) {
        return;
      }
      rows.push({
        segment,
        ownerBytes,
        ownerSize: this.formatBytes(ownerBytes),
        uniqueStringBytes: stringPoolEntry.bytes,
        uniqueStringSize: this.formatBytes(stringPoolEntry.bytes),
        uniqueStrings: stringPoolEntry.uniqueStrings,
        shareOfLexical: this.formatPercent(
          ownerBytes + stringPoolEntry.bytes,
          lexicalTotalBytes,
        ),
        shareOfVault: this.formatPercent(
          ownerBytes + stringPoolEntry.bytes,
          indexableBytes,
        ),
        notes,
      });
    };

    pushRow(
      "documentIdentity.bodyTokenLexicon",
      readOwnerBytes(this.asRecord(documentIdentity?.bodyTokenLexicon), "referenceBytes"),
      readStringPoolEntry("source", "documentIdentity.bodyTokenLexicon"),
      "canonical owner for body exact terms; body postings now keep token-id postings only",
    );
    pushRow(
      "documentIdentity.bodyHanSegments",
      readOwnerBytes(
        this.asRecord(documentIdentity?.bodyHanSegmentsById),
        "slotReferenceBytes",
        "arrayBytes",
      ),
      readStringPoolEntry("source", "documentIdentity.bodyHanSegments"),
      "derived Han-segment cache used by CJK / char fallback",
    );
    pushRow(
      "documents.path",
      readOwnerBytes(this.asRecord(documents?.paths), "referenceBytes") +
        readOwnerBytes(this.asRecord(documentIdentity?.pathToId), "pathReferenceBytes") +
        readOwnerBytes(this.asRecord(documentIdentity?.idToPath), "referenceBytes"),
      readStringPoolEntry("group", "documentPaths"),
      "the same path string is referenced by documents, pathToId, and idToPath",
    );
    pushRow(
      "documents.metadataText",
      readOwnerBytes(this.asRecord(documents?.basenameText), "referenceBytes") +
        readOwnerBytes(this.asRecord(documents?.folderText), "referenceBytes") +
        readOwnerBytes(this.asRecord(documents?.aliasesText), "referenceBytes") +
        readOwnerBytes(this.asRecord(documents?.tagsText), "referenceBytes") +
        readOwnerBytes(this.asRecord(documents?.headingsText), "referenceBytes"),
      readStringPoolEntry("group", "documentText"),
      "raw metadata text retained for basename, folder, aliases, tags, and headings",
    );
    pushRow(
      "postings.metadataPhrase.term",
      sumPostingOwnerBytes([
        "metadataAliasPhrase",
        "metadataBasenamePhrase",
        "metadataFolderPhrase",
        "metadataHeadingPhrase",
        "metadataTagPhrase",
      ]),
      readStringPoolEntry("group", "metadataPhraseTerms"),
      "term keys owned by metadata phrase postings",
    );
    pushRow(
      "postings.metadataChar.term",
      sumPostingOwnerBytes([
        "metadataAliasChar",
        "metadataBasenameChar",
        "metadataFolderChar",
        "metadataHeadingChar",
        "metadataTagChar",
      ]),
      readStringPoolEntry("group", "metadataCharTerms"),
      "term keys owned by metadata char postings",
    );
    pushRow(
      "lexicon",
      readOwnerBytes(lexicon, "referenceBytes"),
      readStringPoolEntry("group", "lexicon"),
      "sorted term lexicon used by prefix and fuzzy queries",
    );

    return rows.sort(
      (left, right) =>
        right.ownerBytes +
        right.uniqueStringBytes -
        (left.ownerBytes + left.uniqueStringBytes),
    );
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
