import { Notice, TFile, type TAbstractFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import type { BaseIndexedFileRef, IndexedDocument } from "src/globals/search-types";
import type CleverSearch from "src/main";
import { Database } from "src/services/database/database";

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
import type {
  PersistentFileIndexRecoveryPlan,
  SerializedFileSearchIndex,
} from "src/services/search/file-search-engine";
import { CoverageLexicalBodyTokenColdStore } from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-store";
import {
  COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
  type CoverageLexicalBodyTokenColdConsistencySummary,
  type CoverageLexicalBodyTokenColdStoreApi,
  type CoverageLexicalBodyTokenColdDocumentWrite,
} from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types";
import { CoverageLexicalV2HanSegmentExactSidecarStore } from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-han-segment-exact-sidecar-store";
import {
  estimateCoverageLexicalV2AdaptiveHanBigramDocPostingBytes,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-han-bigram-doc-posting-estimate";
import {
  CoverageLexicalV2IndexStore,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store";
import {
  buildCoverageLexicalV2PreparedDocument,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-file-search-engine";
import {
  searchCoverageLexicalV2Engine,
} from "src/services/search/coverage-lexical-v2/coverage-lexical-v2-engine";
import { extractHanSegments } from "src/services/search/coverage-lexical/coverage-lexical-cjk";
import {
  COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
  type CoverageLexicalV2HanSegmentExactSidecarConsistencySummary,
  type CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
  type CoverageLexicalV2HanSegmentExactSidecarStoreApi,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-han-segment-exact-sidecar-types";
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

type LexicalOffloadDocumentBundle = {
  bodyTokenDocuments: CoverageLexicalBodyTokenColdDocumentWrite[];
  bodyHanExactDocuments: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[];
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

const HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET = 256;

function summarizeHanRuntimeTimingDistribution(
  values: readonly number[],
): HanRuntimeTimingDistribution {
  if (values.length === 0) {
    return {
      avg: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p100: 0,
    };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    avg: Number((sum / sorted.length).toFixed(3)),
    p50: quantileFromSortedTimingValues(sorted, 0.5),
    p90: quantileFromSortedTimingValues(sorted, 0.9),
    p95: quantileFromSortedTimingValues(sorted, 0.95),
    p100: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
}

function quantileFromSortedTimingValues(
  values: readonly number[],
  percentile: number,
): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * percentile) - 1),
  );
  return Number((values[index] ?? 0).toFixed(3));
}

type HanRuntimeTimingBucketKey = "oneBigram" | "twoBigram" | "threePlusBigram";

type HanRuntimeTimingDistribution = {
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p100: number;
};

type HanRuntimeTimingBucket = {
  queryCount: number;
  durationMs: HanRuntimeTimingDistribution;
  warmDurationMs: HanRuntimeTimingDistribution;
  matchedFileCount: HanRuntimeTimingDistribution;
};

type HanRuntimeTimingQuerySample = {
  queryText: string;
  bucket: HanRuntimeTimingBucketKey;
};

type HanRuntimeTimingReport = {
  queryCount: number;
  sampleLimitPerBucket: number;
  oneBigramQueryCount: number;
  twoBigramQueryCount: number;
  threePlusBigramQueryCount: number;
  durationMs: HanRuntimeTimingDistribution;
  warmDurationMs: HanRuntimeTimingDistribution;
  matchedFileCount: HanRuntimeTimingDistribution;
  byBucket: Record<HanRuntimeTimingBucketKey, HanRuntimeTimingBucket>;
};

type HanBlockVariantRuntimeComparisonRow = {
  label: string;
  targetSymbols: number;
  targetEncodedBytes: number;
  durationMs: HanRuntimeTimingDistribution;
  warmDurationMs: HanRuntimeTimingDistribution;
  matchedFileCount: HanRuntimeTimingDistribution;
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

function ensureCoverageLexicalV2HanSegmentExactSidecarStoreRegistered(): void {
  if (
    container.isRegistered(COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN, false)
  ) {
    return;
  }
  container.registerSingleton(
    COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
    CoverageLexicalV2HanSegmentExactSidecarStore,
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
  private readonly lexicalV2HanSegmentExactSidecarStoreRegistration =
    ensureCoverageLexicalV2HanSegmentExactSidecarStoreRegistered();
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
  private lexicalOffloadRepairTask: Promise<void> | null = null;
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
    this.clearLexicalSnapshotFlushTimer();
    this.clearHybridRepairScheduler();
    this.hybridFreshnessMaintenanceTask = null;
    this.hybridFreshnessMaintenanceQueued = false;
    this.lastHybridStaleWarnSignature = null;
    this.clearHybridFailedEmbeddingState();
    this.hideLexicalIndexFailureNotice();
    this.lexicalIndexFailuresByPath.clear();
    this.lexicalOffloadRepairTask = null;
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

    const moved = await this.lexicalEngine.moveDocument(oldPath, documents[0]);
    if (!moved) {
      return false;
    }

    this.clearLexicalIndexFailures([oldPath, file.path]);
    await this.fileSnapshotStore.removeFiles([oldPath]);
    await this.fileSnapshotStore.publishIndexedTexts([
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
    if (this.lexicalEngine.supportsPersistentFileIndex()) {
      await this.lexicalEngine.persistFileIndexArtifact();
      return;
    }
    const lexicalIndexData = this.lexicalEngine.serializeFileIndex();
    if (lexicalIndexData) {
      await this.database.setLexicalSearchSnapshot(lexicalIndexData);
      return;
    }
    await this.database.deleteLexicalSearchSnapshot();
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
    const lexicalSnapshotDirty = supportsSerializedIndex && !supportsPersistentIndex
      ? await this.hasLexicalSnapshotDirtyMarker()
      : false;
    const canRestorePersistedIndex =
      devOption.loadIndexFromDatabase &&
      !this.shouldForceRefresh &&
      (supportsPersistentIndex || supportsSerializedIndex);
    if (supportsPersistentIndex && canRestorePersistedIndex) {
      const restored = await this.lexicalEngine.restorePersistedFileIndex();
      if (!restored) {
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
    if (plan.needsFullReindex) {
      await this.reindexLexicalEngineWithCurrFiles();
      await this.syncLexicalOffloadStoreMetadata();
      return;
    }
    if (
      plan.persistentRecoveryPlan &&
      plan.persistentRecoveryPlan.status === "needs_heal"
    ) {
      await this.applyLexicalPersistentRecoveryPlan(plan.persistentRecoveryPlan);
    } else if (plan.needsRefHeal) {
      await this.updateLexicalIndexedFileRefsByMtime();
    } else {
      await this.ensureLexicalIndexedFileRefsLoaded();
    }
    await this.healLexicalOffloadRows();
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
    await this.syncLexicalOffloadStoreMetadata();
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
    await this.syncLexicalOffloadStoreMetadata();
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
    await this.syncLexicalOffloadStoreMetadata();
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

  private getLexicalHanExactSidecarStore():
    | CoverageLexicalV2HanSegmentExactSidecarStoreApi
    | null {
    if (
      !container.isRegistered(
        COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
        false,
      )
    ) {
      return null;
    }
    try {
      return container.resolve<CoverageLexicalV2HanSegmentExactSidecarStoreApi>(
        COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
      );
    } catch {
      return null;
    }
  }

  private async syncLexicalOffloadStoreMetadata(): Promise<void> {
    await this.ensureLexicalIndexedFileRefsLoaded();
    const indexedFileRefs = Array.from(this.lexicalIndexedFileRefsByPath.values());
    await this.getLexicalBodyTokenColdStore()?.updateIndexedRefsMetadata(
      indexedFileRefs,
    );
    await this.getLexicalHanExactSidecarStore()?.updateIndexedRefsMetadata(
      indexedFileRefs,
    );
  }

  private async healLexicalOffloadRows(): Promise<void> {
    await this.ensureLexicalIndexedFileRefsLoaded();
    const indexedFileRefs = Array.from(this.lexicalIndexedFileRefsByPath.values());
    const coldStore = this.getLexicalBodyTokenColdStore();
    const hanStore = this.getLexicalHanExactSidecarStore();
    if (!coldStore && !hanStore) {
      return;
    }
    const coldConsistency = coldStore
      ? await coldStore.inspectConsistency(indexedFileRefs)
      : null;
    const hanConsistency = hanStore
      ? await hanStore.summarizeConsistency(indexedFileRefs)
      : null;
    if (!coldConsistency?.needsRepair && !hanConsistency?.needsRepair) {
      await this.syncLexicalOffloadStoreMetadata();
      return;
    }

    const missingOrStalePaths = Array.from(
      new Set([
        ...(coldConsistency?.missingOrStalePaths ?? []),
        ...(hanConsistency?.missingOrStalePaths ?? []),
      ]),
    );
    const missingOrStaleFiles = missingOrStalePaths
      .map((path) => this.dataProvider.getFileByPath(path))
      .filter((file): file is TFile => file !== null);
    const estimatedRepairBytes = missingOrStaleFiles.reduce(
      (sum, file) => sum + Math.max(0, file.stat.size ?? 0),
      0,
    );
    const shouldRepairSynchronously =
      missingOrStalePaths.length <= DataManager.LEXICAL_COLD_REPAIR_SYNC_MAX_PATHS &&
      estimatedRepairBytes <= DataManager.LEXICAL_COLD_REPAIR_SYNC_MAX_BYTES;

    logger.trace("repairing lexical offload rows", {
      bodyTokenReason: coldConsistency?.reason ?? "not-registered",
      bodyTokenRequiresReset: coldConsistency?.requiresReset ?? false,
      bodyTokenMissingOrStaleCount: coldConsistency?.missingOrStalePaths.length ?? 0,
      bodyTokenDanglingCount: coldConsistency?.danglingPaths.length ?? 0,
      hanExactReason: hanConsistency?.reason ?? "not-registered",
      hanExactRequiresReset: hanConsistency?.requiresReset ?? false,
      hanExactMissingOrStaleCount: hanConsistency?.missingOrStalePaths.length ?? 0,
      hanExactDanglingCount: hanConsistency?.danglingPaths.length ?? 0,
      estimatedRepairBytes,
      shouldRepairSynchronously,
    });

    if (shouldRepairSynchronously) {
      await this.executeLexicalOffloadRepair(
        indexedFileRefs,
        coldStore,
        coldConsistency,
        hanStore,
        hanConsistency,
        missingOrStaleFiles,
      );
      return;
    }

    this.queueLexicalOffloadRepair();
  }

  private async buildLexicalOffloadDocuments(
    files: readonly TFile[],
    indexedFileRefsByPath: ReadonlyMap<string, BaseIndexedFileRef>,
  ): Promise<LexicalOffloadDocumentBundle> {
    const requests = files.flatMap((file) => {
      const indexedRef = indexedFileRefsByPath.get(file.path);
      return indexedRef
        ? [{ path: file.path, generation: indexedRef.generation }]
        : [];
    });
    const textsByPath = await this.fileSnapshotStore.readIndexedTexts(requests);
    const bodyTokenDocuments: CoverageLexicalBodyTokenColdDocumentWrite[] = [];
    const bodyHanExactDocuments: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[] = [];
    for (const file of files) {
      const indexedRef = indexedFileRefsByPath.get(file.path);
      const plainText = textsByPath.get(file.path);
      if (!indexedRef || plainText === undefined) {
        continue;
      }
      const bodyTokenDocument = this.lexicalEngine.buildBodyTokenColdDocument(
        file.path,
        indexedRef.generation,
        plainText,
      );
      if (bodyTokenDocument) {
        bodyTokenDocuments.push(bodyTokenDocument);
      }
      const bodyHanExactDocument =
        this.lexicalEngine.buildBodyHanExactSidecarDocument(
          file.path,
          indexedRef.generation,
          plainText,
        );
      if (bodyHanExactDocument) {
        bodyHanExactDocuments.push(bodyHanExactDocument);
      }
    }
    return {
      bodyTokenDocuments,
      bodyHanExactDocuments,
    };
  }

  private buildLexicalOffloadRepairBatches(
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

  private queueLexicalOffloadRepair(): void {
    if (this.lexicalOffloadRepairTask) {
      return;
    }
    this.lexicalOffloadRepairTask = (async () => {
      try {
        if (this.isUnloaded) {
          return;
        }
        await this.ensureLexicalIndexedFileRefsLoaded();
        const indexedFileRefs = Array.from(this.lexicalIndexedFileRefsByPath.values());
        const coldStore = this.getLexicalBodyTokenColdStore();
        const hanStore = this.getLexicalHanExactSidecarStore();
        if (!coldStore && !hanStore) {
          return;
        }
        const coldConsistency = coldStore
          ? await coldStore.inspectConsistency(indexedFileRefs)
          : null;
        const hanConsistency = hanStore
          ? await hanStore.summarizeConsistency(indexedFileRefs)
          : null;
        if (!coldConsistency?.needsRepair && !hanConsistency?.needsRepair) {
          await this.syncLexicalOffloadStoreMetadata();
          return;
        }
        const missingOrStaleFiles = Array.from(
          new Set([
            ...(coldConsistency?.missingOrStalePaths ?? []),
            ...(hanConsistency?.missingOrStalePaths ?? []),
          ]),
        )
          .map((path) => this.dataProvider.getFileByPath(path))
          .filter((file): file is TFile => file !== null);
        await this.executeLexicalOffloadRepair(
          indexedFileRefs,
          coldStore,
          coldConsistency,
          hanStore,
          hanConsistency,
          missingOrStaleFiles,
        );
      } catch (error) {
        logger.warn("lexical offload repair failed:", error);
      } finally {
        this.lexicalOffloadRepairTask = null;
      }
    })();
  }

  private async executeLexicalOffloadRepair(
    indexedFileRefs: readonly BaseIndexedFileRef[],
    coldStore: CoverageLexicalBodyTokenColdStoreApi | null,
    coldConsistency: CoverageLexicalBodyTokenColdConsistencySummary | null,
    hanStore: CoverageLexicalV2HanSegmentExactSidecarStoreApi | null,
    hanConsistency: CoverageLexicalV2HanSegmentExactSidecarConsistencySummary | null,
    missingOrStaleFiles: readonly TFile[],
  ): Promise<void> {
    const indexedFileRefsByPath = new Map(
      indexedFileRefs.map((ref) => [ref.path, ref] as const),
    );
    if (coldStore && coldConsistency) {
      if (coldConsistency.requiresReset) {
        await coldStore.clearAll();
      } else if (coldConsistency.danglingPaths.length > 0) {
        await coldStore.deleteDocuments(coldConsistency.danglingPaths);
      }
    }
    if (hanStore && hanConsistency) {
      if (hanConsistency.requiresReset) {
        await hanStore.clearAll();
      } else if (hanConsistency.danglingPaths.length > 0) {
        await hanStore.deleteDocuments(hanConsistency.danglingPaths);
      }
    }

    if (missingOrStaleFiles.length > 0) {
      const repairBatches = this.buildLexicalOffloadRepairBatches(missingOrStaleFiles);
      const coldRepairPathSet = new Set(coldConsistency?.missingOrStalePaths ?? []);
      const hanRepairPathSet = new Set(hanConsistency?.missingOrStalePaths ?? []);
      for (let index = 0; index < repairBatches.length; index += 1) {
        if (this.isUnloaded) {
          return;
        }
        const batchFiles = repairBatches[index];
        const batchDocuments = await this.buildLexicalOffloadDocuments(
          batchFiles,
          indexedFileRefsByPath,
        );
        if (coldStore) {
          await coldStore.upsertDocuments(
            batchDocuments.bodyTokenDocuments.filter((document) =>
              coldRepairPathSet.has(document.path),
            ),
          );
        }
        if (hanStore) {
          await hanStore.upsertDocuments(
            batchDocuments.bodyHanExactDocuments.filter((document) =>
              hanRepairPathSet.has(document.path),
            ),
          );
        }
        if (index + 1 < repairBatches.length) {
          await MyLib.sleep(0);
        }
      }
    }

    await coldStore?.updateIndexedRefsMetadata(indexedFileRefs);
    await hanStore?.updateIndexedRefsMetadata(indexedFileRefs);
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
    await this.noticeDevStorageStats(true);
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
  private async noticeDevStorageStats(includeHanExperiments = false) {
    const indexableFiles = this.dataProvider.allFilesToBeIndexed();
    const indexableBytes = indexableFiles.reduce(
      (sum, file) => sum + file.stat.size,
      0,
    );
    const storageUsage = await this.database.estimatePluginStorageUsage();
    const bytesByName = new Map(
      storageUsage.tables.map((item) => [item.name, item.bytes]),
    );
    const persistedLexicalSnapshotBytes = this.lexicalEngine.supportsPersistentFileIndex()
      ? (bytesByName.get("lexicalV2IndexStoreMeta") ?? 0) +
        (bytesByName.get("lexicalV2IndexStoreSnapshotChunks") ?? 0) +
        (bytesByName.get("lexicalV2IndexStoreJournal") ?? 0)
      : (bytesByName.get("lexicalSearchSnapshots") ?? 0);
    const runtimeLexicalIndexBytes = this.lexicalEngine.estimateFileIndexBytes(
      persistedLexicalSnapshotBytes,
    );
    const lexicalIndexBreakdown = this.lexicalEngine.getFileIndexBreakdown();
    const lexicalRuntimeBreakdown = this.buildLexicalRuntimeBreakdown(
      lexicalIndexBreakdown,
      runtimeLexicalIndexBytes,
      indexableBytes,
    );
    const adaptiveHanBigramExperiment = includeHanExperiments
      ? await this.buildAdaptiveHanBigramExperiment(indexableFiles)
      : null;
    const adaptiveHanBigramPostingEstimate =
      adaptiveHanBigramExperiment?.estimate ?? null;
    const hanRuntimeTiming = adaptiveHanBigramExperiment?.runtimeTiming ?? null;
    const hanVariantComparison =
      adaptiveHanBigramExperiment?.variantComparison ?? null;
    const localOnlyHint =
      "Local-only: no embedding API, no rerank API, no token usage.";

    new MyNotice(
      `${[
        "Lexical memory report",
        `Persisted lexical snapshot: ${this.formatBytes(persistedLexicalSnapshotBytes)}`,
        ...lexicalRuntimeBreakdown.noticeLines,
        localOnlyHint,
      ].join("\n")}`,
      15000,
    );

    console.groupCollapsed("[clever-search] lexical memory report");
    console.log(`Indexable vault size: ${this.formatBytes(indexableBytes)}`);
    console.log(
      `Resident lexical estimate: ${this.formatBytes(runtimeLexicalIndexBytes)}`,
    );
    console.log(
      `Persisted lexical snapshot: ${this.formatBytes(persistedLexicalSnapshotBytes)}`,
    );
    if (lexicalRuntimeBreakdown.summaryLine) {
      console.log(`[clever-search] ${lexicalRuntimeBreakdown.summaryLine}`);
    }
    if (lexicalRuntimeBreakdown.residentGroupRows.length > 0) {
      console.log("[clever-search] Lexical resident groups");
      console.table(lexicalRuntimeBreakdown.residentGroupRows);
    }
    if (lexicalRuntimeBreakdown.coldOwnedGroupRows.length > 0) {
      console.log("[clever-search] Lexical cold-owned groups");
      console.table(lexicalRuntimeBreakdown.coldOwnedGroupRows);
    }
    if (lexicalRuntimeBreakdown.overlapRows.length > 0) {
      console.log("[clever-search] Lexical overlap diagnostics");
      console.table(lexicalRuntimeBreakdown.overlapRows);
    }
    if (lexicalRuntimeBreakdown.residentTopRows.length > 0) {
      console.log("[clever-search] Lexical top resident contributors");
      console.table(lexicalRuntimeBreakdown.residentTopRows);
    }
    if (lexicalRuntimeBreakdown.coldOverlapTopRows.length > 0) {
      console.log("[clever-search] Lexical top cold/overlap contributors");
      console.table(lexicalRuntimeBreakdown.coldOverlapTopRows);
    }
    if (adaptiveHanBigramPostingEstimate) {
      console.log(
        "[clever-search] Han diagnostics: adaptive bigram posting estimate",
      );
      console.table([
        {
          metric: "indexedDocumentCount",
          count: adaptiveHanBigramPostingEstimate.indexedDocumentCount,
        },
        {
          metric: "failedDocumentCount",
          count: adaptiveHanBigramPostingEstimate.failedDocumentCount,
        },
        {
          metric: "hanDocumentCount",
          count: adaptiveHanBigramPostingEstimate.hanDocumentCount,
        },
        {
          metric: "hanLogicalBlockCount",
          count: adaptiveHanBigramPostingEstimate.hanLogicalBlockCount,
        },
        {
          metric: "hanOnlyUtf8Bytes",
          bytes: adaptiveHanBigramPostingEstimate.hanOnlyUtf8Bytes,
          size: this.formatBytes(adaptiveHanBigramPostingEstimate.hanOnlyUtf8Bytes),
        },
        {
          metric: "optimisticPackedBytes",
          bytes: adaptiveHanBigramPostingEstimate.optimisticPackedBytes,
          size: this.formatBytes(adaptiveHanBigramPostingEstimate.optimisticPackedBytes),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.optimisticPackedVsHanRaw ?? "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.optimisticPackedVsRawMarkdown ?? "n/a",
        },
        {
          metric: "ultraOptimisticPackedBytes",
          bytes: adaptiveHanBigramPostingEstimate.ultraOptimisticPackedBytes,
          size: this.formatBytes(adaptiveHanBigramPostingEstimate.ultraOptimisticPackedBytes),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.ultraOptimisticPackedVsHanRaw ?? "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.ultraOptimisticPackedVsRawMarkdown ?? "n/a",
        },
        {
          metric: "denseBigramOptimisticPackedBytes",
          bytes: adaptiveHanBigramPostingEstimate.denseBigramOptimisticPackedBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.denseBigramOptimisticPackedBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.denseBigramOptimisticPackedVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.denseBigramOptimisticPackedVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "denseBigramHanDocOrdinalPackedBytes",
          bytes: adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalPackedBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalPackedBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalPackedVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalPackedVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "denseBigramDictionaryLowerBoundBytes",
          bytes: adaptiveHanBigramPostingEstimate.denseBigramDictionaryLowerBoundBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.denseBigramDictionaryLowerBoundBytes,
          ),
        },
        {
          metric: "denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes",
          bytes:
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalWithDictionaryLowerBoundVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.denseBigramHanDocOrdinalWithDictionaryLowerBoundVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "docAdaptiveCodec.totalBytes",
          bytes: adaptiveHanBigramPostingEstimate.docAdaptiveCodec.totalBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.docAdaptiveCodec.totalBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.hanOnlyUtf8Bytes > 0
              ? (
                  adaptiveHanBigramPostingEstimate.docAdaptiveCodec.totalBytes /
                  adaptiveHanBigramPostingEstimate.hanOnlyUtf8Bytes
                ).toFixed(3)
              : "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.rawMarkdownBytes > 0
              ? (
                  adaptiveHanBigramPostingEstimate.docAdaptiveCodec.totalBytes /
                  adaptiveHanBigramPostingEstimate.rawMarkdownBytes
                ).toFixed(3)
              : "n/a",
        },
        {
          metric: "docAdaptiveCodec.withDictionaryLowerBoundBytes",
          bytes:
            adaptiveHanBigramPostingEstimate.docAdaptiveCodecWithDictionaryLowerBoundBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.docAdaptiveCodecWithDictionaryLowerBoundBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.docAdaptiveCodecWithDictionaryLowerBoundVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.docAdaptiveCodecWithDictionaryLowerBoundVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "uniqueBigramCount",
          count: adaptiveHanBigramPostingEstimate.uniqueBigramCount,
        },
        {
          metric: "docBigramIncidenceCount",
          count: adaptiveHanBigramPostingEstimate.docBigramIncidenceCount,
        },
        {
          metric: "blockBigramIncidenceCount",
          count: adaptiveHanBigramPostingEstimate.blockBigramIncidenceCount,
        },
        {
          metric: "denseBigramIdBytes",
          count: adaptiveHanBigramPostingEstimate.denseBigramIdBytes,
        },
        {
          metric: "hanDocOrdinalBytes",
          count: adaptiveHanBigramPostingEstimate.hanDocOrdinalBytes,
        },
        {
          metric: "blockIdBytes",
          count: adaptiveHanBigramPostingEstimate.blockIdBytes,
        },
        {
          metric: "blockOrdinalBytes",
          count: adaptiveHanBigramPostingEstimate.blockOrdinalBytes,
        },
        {
          metric: "maxBlocksPerHanDocument",
          count: adaptiveHanBigramPostingEstimate.maxBlocksPerHanDocument,
        },
        {
          metric: "denseBigramBlockPostingBytes",
          bytes: adaptiveHanBigramPostingEstimate.denseBigramBlockPostingBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "denseBigramBlockPostingWithDictionaryLowerBoundBytes",
          bytes:
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingWithDictionaryLowerBoundBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingWithDictionaryLowerBoundBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingWithDictionaryLowerBoundVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.denseBigramBlockPostingWithDictionaryLowerBoundVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "blockDescriptorSearchCoreBytes",
          bytes: adaptiveHanBigramPostingEstimate.blockDescriptorSearchCoreBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.blockDescriptorSearchCoreBytes,
          ),
        },
        {
          metric: "blockDescriptorOperationalBytes",
          bytes:
            adaptiveHanBigramPostingEstimate.blockDescriptorOperationalBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.blockDescriptorOperationalBytes,
          ),
        },
        {
          metric: "blockQueryViewWithSearchCoreBytes",
          bytes: adaptiveHanBigramPostingEstimate.blockQueryViewWithSearchCoreBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.blockQueryViewWithSearchCoreBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.blockQueryViewWithSearchCoreVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.blockQueryViewWithSearchCoreVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "blockQueryViewWithOperationalDescriptorBytes",
          bytes:
            adaptiveHanBigramPostingEstimate.blockQueryViewWithOperationalDescriptorBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.blockQueryViewWithOperationalDescriptorBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.blockQueryViewWithOperationalDescriptorVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.blockQueryViewWithOperationalDescriptorVsRawMarkdown ??
            "n/a",
        },
        {
          metric: "blockAdaptiveCodec.totalBytes",
          bytes: adaptiveHanBigramPostingEstimate.blockAdaptiveCodec.totalBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.blockAdaptiveCodec.totalBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.hanOnlyUtf8Bytes > 0
              ? (
                  adaptiveHanBigramPostingEstimate.blockAdaptiveCodec.totalBytes /
                  adaptiveHanBigramPostingEstimate.hanOnlyUtf8Bytes
                ).toFixed(3)
              : "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.rawMarkdownBytes > 0
              ? (
                  adaptiveHanBigramPostingEstimate.blockAdaptiveCodec.totalBytes /
                  adaptiveHanBigramPostingEstimate.rawMarkdownBytes
                ).toFixed(3)
              : "n/a",
        },
        {
          metric: "blockAdaptiveCodec.withDictionaryLowerBoundBytes",
          bytes:
            adaptiveHanBigramPostingEstimate.blockAdaptiveCodecWithDictionaryLowerBoundBytes,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.blockAdaptiveCodecWithDictionaryLowerBoundBytes,
          ),
          ratioVsHanRaw:
            adaptiveHanBigramPostingEstimate.blockAdaptiveCodecWithDictionaryLowerBoundVsHanRaw ??
            "n/a",
          ratioVsRawMarkdown:
            adaptiveHanBigramPostingEstimate.blockAdaptiveCodecWithDictionaryLowerBoundVsRawMarkdown ??
            "n/a",
        },
      ]);
      console.log(
        "[clever-search] Han diagnostics: bigram doc-frequency histogram",
        adaptiveHanBigramPostingEstimate.docFrequencyHistogram,
      );
      console.log(
        "[clever-search] Han diagnostics: adaptive posting codec lanes",
        {
          docAdaptiveCodec: adaptiveHanBigramPostingEstimate.docAdaptiveCodec,
          blockAdaptiveCodec: adaptiveHanBigramPostingEstimate.blockAdaptiveCodec,
        },
      );
      console.log("[clever-search] Han diagnostics: logical block size sweep");
      console.table(
        adaptiveHanBigramPostingEstimate.blockSizeSweep.map((row) => ({
          label: row.label,
          targetSymbols: row.targetSymbols,
          targetEncodedBytes: row.targetEncodedBytes,
          hanLogicalBlockCount: row.hanLogicalBlockCount,
          maxBlocksPerHanDocument: row.maxBlocksPerHanDocument,
          blockAdaptiveCodecTotalBytes: row.blockAdaptiveCodecTotalBytes,
          blockAdaptiveCodecWithDictionaryLowerBoundBytes:
            row.blockAdaptiveCodecWithDictionaryLowerBoundBytes,
          blockQueryViewWithSearchCoreBytes: row.blockQueryViewWithSearchCoreBytes,
          directBlockCandidateCountAvg: row.directBlockCandidateCountAvg,
          directBlockCandidateCountP90: row.directBlockCandidateCountP90,
          directBlockByteCountAvg: row.directBlockByteCountAvg,
          directBlockByteCountP90: row.directBlockByteCountP90,
          docRouteVsBlockRouteByteRatioAvg: row.docRouteVsBlockRouteByteRatioAvg,
          docRouteVsBlockRouteByteRatioP90: row.docRouteVsBlockRouteByteRatioP90,
          queryViewBytesVsCurrent: row.queryViewBytesVsCurrent ?? "n/a",
          directExactBytesVsCurrent: row.directExactBytesVsCurrent ?? "n/a",
          heuristicBalanceScoreVsCurrent:
            row.heuristicBalanceScoreVsCurrent ?? "n/a",
        })),
      );
      console.log(
        "[clever-search] Han diagnostics: exact fanout summary (doc postings -> exact blocks)",
      );
      console.table([
        {
          metric: "queryCount",
          count: adaptiveHanBigramPostingEstimate.exactFanout.queryCount,
        },
        {
          metric: "oneBigramQueryCount",
          count: adaptiveHanBigramPostingEstimate.exactFanout.oneBigramQueryCount,
        },
        {
          metric: "twoBigramQueryCount",
          count: adaptiveHanBigramPostingEstimate.exactFanout.twoBigramQueryCount,
        },
        {
          metric: "threePlusBigramQueryCount",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.threePlusBigramQueryCount,
        },
        {
          metric: "docCandidateCount.avg",
          count: adaptiveHanBigramPostingEstimate.exactFanout.docCandidateCount.avg,
        },
        {
          metric: "docCandidateCount.p90",
          count: adaptiveHanBigramPostingEstimate.exactFanout.docCandidateCount.p90,
        },
        {
          metric: "docRouteFanoutBlockCount.avg",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteFanoutBlockCount.avg,
        },
        {
          metric: "docRouteFanoutBlockCount.p90",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteFanoutBlockCount.p90,
        },
        {
          metric: "directBlockCandidateCount.avg",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.directBlockCandidateCount.avg,
        },
        {
          metric: "directBlockCandidateCount.p90",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.directBlockCandidateCount.p90,
        },
        {
          metric: "docRouteVsBlockRouteBlockRatio.avg",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteVsBlockRouteBlockRatio.avg,
        },
        {
          metric: "docRouteVsBlockRouteBlockRatio.p90",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteVsBlockRouteBlockRatio.p90,
        },
        {
          metric: "docRouteFanoutByteCount.avg",
          bytes:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteFanoutByteCount.avg,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteFanoutByteCount.avg,
          ),
        },
        {
          metric: "docRouteFanoutByteCount.p90",
          bytes:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteFanoutByteCount.p90,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteFanoutByteCount.p90,
          ),
        },
        {
          metric: "directBlockByteCount.avg",
          bytes: adaptiveHanBigramPostingEstimate.exactFanout.directBlockByteCount.avg,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.exactFanout.directBlockByteCount.avg,
          ),
        },
        {
          metric: "directBlockByteCount.p90",
          bytes: adaptiveHanBigramPostingEstimate.exactFanout.directBlockByteCount.p90,
          size: this.formatBytes(
            adaptiveHanBigramPostingEstimate.exactFanout.directBlockByteCount.p90,
          ),
        },
        {
          metric: "docRouteVsBlockRouteByteRatio.avg",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteVsBlockRouteByteRatio.avg,
        },
        {
          metric: "docRouteVsBlockRouteByteRatio.p90",
          count:
            adaptiveHanBigramPostingEstimate.exactFanout.docRouteVsBlockRouteByteRatio.p90,
        },
      ]);
      console.log(
        "[clever-search] Han diagnostics: exact fanout buckets",
        adaptiveHanBigramPostingEstimate.exactFanout.byBucket,
      );
      if (hanRuntimeTiming) {
        console.log(
          "[clever-search] Han diagnostics: runtime query latency (wall-clock)",
        );
        console.table([
          {
            metric: "queryCount",
            count: hanRuntimeTiming.queryCount,
          },
          {
            metric: "sampleLimitPerBucket",
            count: hanRuntimeTiming.sampleLimitPerBucket,
          },
          {
            metric: "oneBigramQueryCount",
            count: hanRuntimeTiming.oneBigramQueryCount,
          },
          {
            metric: "twoBigramQueryCount",
            count: hanRuntimeTiming.twoBigramQueryCount,
          },
          {
            metric: "threePlusBigramQueryCount",
            count: hanRuntimeTiming.threePlusBigramQueryCount,
          },
          {
            metric: "durationMs.avg",
            count: hanRuntimeTiming.durationMs.avg,
          },
          {
            metric: "durationMs.p90",
            count: hanRuntimeTiming.durationMs.p90,
          },
          {
            metric: "durationMs.p95",
            count: hanRuntimeTiming.durationMs.p95,
          },
          {
            metric: "durationMs.p100",
            count: hanRuntimeTiming.durationMs.p100,
          },
          {
            metric: "warmDurationMs.avg",
            count: hanRuntimeTiming.warmDurationMs.avg,
          },
          {
            metric: "warmDurationMs.p95",
            count: hanRuntimeTiming.warmDurationMs.p95,
          },
          {
            metric: "warmDurationMs.p100",
            count: hanRuntimeTiming.warmDurationMs.p100,
          },
          {
            metric: "matchedFileCount.avg",
            count: hanRuntimeTiming.matchedFileCount.avg,
          },
          {
            metric: "matchedFileCount.p95",
            count: hanRuntimeTiming.matchedFileCount.p95,
          },
          {
            metric: "matchedFileCount.p100",
            count: hanRuntimeTiming.matchedFileCount.p100,
          },
        ]);
        console.log(
          "[clever-search] Han diagnostics: runtime query latency buckets",
          hanRuntimeTiming.byBucket,
        );
      }
      if (hanVariantComparison && hanVariantComparison.length > 0) {
        console.log(
          "[clever-search] Han diagnostics: block variant runtime comparison",
        );
        console.table(
          hanVariantComparison.map((row) => ({
            label: row.label,
            targetSymbols: row.targetSymbols,
            targetEncodedBytes: row.targetEncodedBytes,
            durationMsAvg: row.durationMs.avg,
            durationMsP95: row.durationMs.p95,
            durationMsP100: row.durationMs.p100,
            warmDurationMsAvg: row.warmDurationMs.avg,
            warmDurationMsP95: row.warmDurationMs.p95,
            warmDurationMsP100: row.warmDurationMs.p100,
            matchedFileCountAvg: row.matchedFileCount.avg,
            matchedFileCountP95: row.matchedFileCount.p95,
          })),
        );
      }
      console.log(
        "[clever-search] Han diagnostics payload",
        adaptiveHanBigramPostingEstimate,
      );
    }
    console.log(`[clever-search] ${localOnlyHint}`);
    console.groupEnd();
  }

  private async buildAdaptiveHanBigramExperiment(
    indexableFiles: readonly TFile[],
  ): Promise<
    | {
        estimate: ReturnType<typeof estimateCoverageLexicalV2AdaptiveHanBigramDocPostingBytes> & {
          indexedDocumentCount: number;
          failedDocumentCount: number;
        };
        runtimeTiming: HanRuntimeTimingReport | null;
        variantComparison:
          | readonly HanBlockVariantRuntimeComparisonRow[]
          | null;
      }
    | null
  > {
    const generated = await this.dataProvider.generateAllIndexedDocuments([
      ...indexableFiles,
    ]);
    if (generated.documents.length === 0) {
      return null;
    }
    const estimate = estimateCoverageLexicalV2AdaptiveHanBigramDocPostingBytes(
      generated.documents,
    );
    if (generated.failures.length > 0) {
      console.warn(
        "[clever-search] Han diagnostics skipped some files",
        generated.failures.map((failure) => failure.file.path),
      );
    }
    return {
      estimate: {
        ...estimate,
        indexedDocumentCount: generated.documents.length,
        failedDocumentCount: generated.failures.length,
      },
      runtimeTiming: await this.measureHanRuntimeQueryTiming(generated.documents),
      variantComparison:
        await this.measureHanBlockVariantRuntimeComparison(generated.documents),
    };
  }

  private async measureHanRuntimeQueryTiming(
    documents: readonly IndexedDocument[],
  ): Promise<HanRuntimeTimingReport | null> {
    const querySamples = this.buildHanRuntimeTimingQuerySamples(documents);
    if (querySamples.length === 0) {
      return null;
    }
    const allDurations: number[] = [];
    const allWarmDurations: number[] = [];
    const allMatchedFileCounts: number[] = [];
    const buckets: Record<
      HanRuntimeTimingBucketKey,
      { durations: number[]; warmDurations: number[]; matchedFileCounts: number[] }
    > = {
      oneBigram: { durations: [], warmDurations: [], matchedFileCounts: [] },
      twoBigram: { durations: [], warmDurations: [], matchedFileCounts: [] },
      threePlusBigram: { durations: [], warmDurations: [], matchedFileCounts: [] },
    };

    for (const querySample of querySamples) {
      const startedAt = performance.now();
      const matches = await this.lexicalEngine.searchFiles(
        querySample.queryText,
        20,
        20,
        20,
      );
      const durationMs = performance.now() - startedAt;
      allDurations.push(durationMs);
      allMatchedFileCounts.push(matches.length);
      buckets[querySample.bucket].durations.push(durationMs);
      buckets[querySample.bucket].matchedFileCounts.push(matches.length);
    }

    for (const querySample of querySamples) {
      const startedAt = performance.now();
      await this.lexicalEngine.searchFiles(querySample.queryText, 20, 20, 20);
      const durationMs = performance.now() - startedAt;
      allWarmDurations.push(durationMs);
      buckets[querySample.bucket].warmDurations.push(durationMs);
    }

    return {
      queryCount: querySamples.length,
      sampleLimitPerBucket: HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET,
      oneBigramQueryCount: buckets.oneBigram.durations.length,
      twoBigramQueryCount: buckets.twoBigram.durations.length,
      threePlusBigramQueryCount: buckets.threePlusBigram.durations.length,
      durationMs: summarizeHanRuntimeTimingDistribution(allDurations),
      warmDurationMs: summarizeHanRuntimeTimingDistribution(allWarmDurations),
      matchedFileCount: summarizeHanRuntimeTimingDistribution(allMatchedFileCounts),
      byBucket: {
        oneBigram: {
          queryCount: buckets.oneBigram.durations.length,
          durationMs: summarizeHanRuntimeTimingDistribution(
            buckets.oneBigram.durations,
          ),
          warmDurationMs: summarizeHanRuntimeTimingDistribution(
            buckets.oneBigram.warmDurations,
          ),
          matchedFileCount: summarizeHanRuntimeTimingDistribution(
            buckets.oneBigram.matchedFileCounts,
          ),
        },
        twoBigram: {
          queryCount: buckets.twoBigram.durations.length,
          durationMs: summarizeHanRuntimeTimingDistribution(
            buckets.twoBigram.durations,
          ),
          warmDurationMs: summarizeHanRuntimeTimingDistribution(
            buckets.twoBigram.warmDurations,
          ),
          matchedFileCount: summarizeHanRuntimeTimingDistribution(
            buckets.twoBigram.matchedFileCounts,
          ),
        },
        threePlusBigram: {
          queryCount: buckets.threePlusBigram.durations.length,
          durationMs: summarizeHanRuntimeTimingDistribution(
            buckets.threePlusBigram.durations,
          ),
          warmDurationMs: summarizeHanRuntimeTimingDistribution(
            buckets.threePlusBigram.warmDurations,
          ),
          matchedFileCount: summarizeHanRuntimeTimingDistribution(
            buckets.threePlusBigram.matchedFileCounts,
          ),
        },
      },
    };
  }

  private async measureHanBlockVariantRuntimeComparison(
    documents: readonly IndexedDocument[],
  ): Promise<readonly HanBlockVariantRuntimeComparisonRow[] | null> {
    const querySamples = this.buildHanRuntimeTimingQuerySamples(documents);
    if (querySamples.length === 0) {
      return null;
    }
    const variants = [
      { label: "1x", targetSymbols: 384, targetEncodedBytes: 1536 },
      { label: "3x", targetSymbols: 1152, targetEncodedBytes: 4608 },
    ] as const;
    const rows: HanBlockVariantRuntimeComparisonRow[] = [];
    for (const variant of variants) {
      const timing = await this.measureHanRuntimeQueryTimingAgainstVariant(
        documents,
        querySamples,
        variant.targetSymbols,
        variant.targetEncodedBytes,
      );
      rows.push({
        label: variant.label,
        targetSymbols: variant.targetSymbols,
        targetEncodedBytes: variant.targetEncodedBytes,
        durationMs: timing.durationMs,
        warmDurationMs: timing.warmDurationMs,
        matchedFileCount: timing.matchedFileCount,
      });
    }
    return rows;
  }

  private async measureHanRuntimeQueryTimingAgainstVariant(
    documents: readonly IndexedDocument[],
    querySamples: readonly HanRuntimeTimingQuerySample[],
    targetSymbols: number,
    targetEncodedBytes: number,
  ): Promise<HanRuntimeTimingReport> {
    const store = new CoverageLexicalV2IndexStore({
      hanLogicalBlockSymbols: targetSymbols,
      hanLogicalBlockEncodedBytes: targetEncodedBytes,
    });
    const bodyTokenSequenceByDocId = new Map<number, readonly string[]>();
    const exactBlocksByLookupKey = new Map<string, Uint32Array>();
    for (const document of documents) {
      const prepared = buildCoverageLexicalV2PreparedDocument(this.tokenizer, document);
      const logicalBlockWrites = store.getOrCreateBodyHanLogicalBlockWrites(
        prepared.bodyHanSegments,
      );
      const docId = store.replaceDocument(prepared);
      bodyTokenSequenceByDocId.set(docId, prepared.bodyTokens);
      for (const logicalBlock of logicalBlockWrites) {
        exactBlocksByLookupKey.set(
          `${prepared.path}:${logicalBlock.blockOrdinal}`,
          logicalBlock.bodyHanSymbolIds,
        );
      }
    }
    store.compactOverlayIntoSegment(true);

    const globalExactCache = new Map<string, Uint32Array>();
    let globalExactCacheBytes = 0;
    const allDurations: number[] = [];
    const allWarmDurations: number[] = [];
    const allMatchedFileCounts: number[] = [];
    const buckets: Record<
      HanRuntimeTimingBucketKey,
      { durations: number[]; warmDurations: number[]; matchedFileCounts: number[] }
    > = {
      oneBigram: { durations: [], warmDurations: [], matchedFileCounts: [] },
      twoBigram: { durations: [], warmDurations: [], matchedFileCounts: [] },
      threePlusBigram: { durations: [], warmDurations: [], matchedFileCounts: [] },
    };

    const searchOnce = async (
      queryText: string,
      queryLocalBodyHanExactCache: Map<number, Uint32Array>,
    ) =>
      await searchCoverageLexicalV2Engine({
        queryText,
        isPrefixMatch: false,
        isFuzzy: false,
        maxItemResults: 20,
        fuzzyProportion: 0.2,
        tokenizeQueryText: (text) =>
          this.tokenizer
            .tokenizeSequence(text, "search")
            .map((term) => term.toLowerCase()),
        storageReader: store.createStorageReader({
          getBodyTokenSequence: (docId) => bodyTokenSequenceByDocId.get(docId),
          prefetchBodyTokenSequences: async () => {},
          prefetchBodyHanExactBlocks: async (blockIds, budget) =>
            this.prefetchHanVariantExactBlocks({
              store,
              exactBlocksByLookupKey,
              globalExactCache,
              queryLocalBodyHanExactCache,
              blockIds,
              budget,
              getGlobalExactCacheBytes: () => globalExactCacheBytes,
              setGlobalExactCacheBytes: (nextValue) => {
                globalExactCacheBytes = nextValue;
              },
            }),
          getBodyHanExactBlockBackstopStats: (blockId, normalizedText, bigrams) => {
            const symbolIds =
              queryLocalBodyHanExactCache.get(blockId) ??
              this.getVariantCachedBodyHanExact(store, globalExactCache, blockId);
            return symbolIds
              ? store.buildBodyHanExactBackstopStatsFromSymbolIds(
                  symbolIds,
                  normalizedText,
                  bigrams,
                )
              : null;
          },
          tokenizeText: (text) =>
            this.tokenizer
              .tokenizeSequence(text, "index")
              .map((term) => term.toLowerCase()),
        }),
      });

    for (const querySample of querySamples) {
      const queryLocalBodyHanExactCache = new Map<number, Uint32Array>();
      const startedAt = performance.now();
      const result = await searchOnce(
        querySample.queryText,
        queryLocalBodyHanExactCache,
      );
      const durationMs = performance.now() - startedAt;
      allDurations.push(durationMs);
      allMatchedFileCounts.push(result.matchedFiles.length);
      buckets[querySample.bucket].durations.push(durationMs);
      buckets[querySample.bucket].matchedFileCounts.push(result.matchedFiles.length);
    }

    for (const querySample of querySamples) {
      const queryLocalBodyHanExactCache = new Map<number, Uint32Array>();
      const startedAt = performance.now();
      await searchOnce(querySample.queryText, queryLocalBodyHanExactCache);
      const durationMs = performance.now() - startedAt;
      allWarmDurations.push(durationMs);
      buckets[querySample.bucket].warmDurations.push(durationMs);
    }

    return {
      queryCount: querySamples.length,
      sampleLimitPerBucket: HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET,
      oneBigramQueryCount: buckets.oneBigram.durations.length,
      twoBigramQueryCount: buckets.twoBigram.durations.length,
      threePlusBigramQueryCount: buckets.threePlusBigram.durations.length,
      durationMs: summarizeHanRuntimeTimingDistribution(allDurations),
      warmDurationMs: summarizeHanRuntimeTimingDistribution(allWarmDurations),
      matchedFileCount: summarizeHanRuntimeTimingDistribution(allMatchedFileCounts),
      byBucket: {
        oneBigram: {
          queryCount: buckets.oneBigram.durations.length,
          durationMs: summarizeHanRuntimeTimingDistribution(
            buckets.oneBigram.durations,
          ),
          warmDurationMs: summarizeHanRuntimeTimingDistribution(
            buckets.oneBigram.warmDurations,
          ),
          matchedFileCount: summarizeHanRuntimeTimingDistribution(
            buckets.oneBigram.matchedFileCounts,
          ),
        },
        twoBigram: {
          queryCount: buckets.twoBigram.durations.length,
          durationMs: summarizeHanRuntimeTimingDistribution(
            buckets.twoBigram.durations,
          ),
          warmDurationMs: summarizeHanRuntimeTimingDistribution(
            buckets.twoBigram.warmDurations,
          ),
          matchedFileCount: summarizeHanRuntimeTimingDistribution(
            buckets.twoBigram.matchedFileCounts,
          ),
        },
        threePlusBigram: {
          queryCount: buckets.threePlusBigram.durations.length,
          durationMs: summarizeHanRuntimeTimingDistribution(
            buckets.threePlusBigram.durations,
          ),
          warmDurationMs: summarizeHanRuntimeTimingDistribution(
            buckets.threePlusBigram.warmDurations,
          ),
          matchedFileCount: summarizeHanRuntimeTimingDistribution(
            buckets.threePlusBigram.matchedFileCounts,
          ),
        },
      },
    };
  }

  private buildHanRuntimeTimingQuerySamples(
    documents: readonly IndexedDocument[],
  ): readonly HanRuntimeTimingQuerySample[] {
    const bucketSets: Record<HanRuntimeTimingBucketKey, Set<string>> = {
      oneBigram: new Set<string>(),
      twoBigram: new Set<string>(),
      threePlusBigram: new Set<string>(),
    };

    for (const document of documents) {
      const content = document.content ?? "";
      for (const segment of extractHanSegments(content)) {
        const symbols = Array.from(segment);
        this.collectHanRuntimeTimingWindows(bucketSets.oneBigram, symbols, 2);
        this.collectHanRuntimeTimingWindows(bucketSets.twoBigram, symbols, 3);
        this.collectHanRuntimeTimingWindows(bucketSets.threePlusBigram, symbols, 4);
        if (
          bucketSets.oneBigram.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET &&
          bucketSets.twoBigram.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET &&
          bucketSets.threePlusBigram.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET
        ) {
          break;
        }
      }
      if (
        bucketSets.oneBigram.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET &&
        bucketSets.twoBigram.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET &&
        bucketSets.threePlusBigram.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET
      ) {
        break;
      }
    }

    return [
      ...Array.from(bucketSets.oneBigram, (queryText) => ({
        queryText,
        bucket: "oneBigram" as const,
      })),
      ...Array.from(bucketSets.twoBigram, (queryText) => ({
        queryText,
        bucket: "twoBigram" as const,
      })),
      ...Array.from(bucketSets.threePlusBigram, (queryText) => ({
        queryText,
        bucket: "threePlusBigram" as const,
      })),
    ];
  }

  private async prefetchHanVariantExactBlocks(options: {
    store: CoverageLexicalV2IndexStore;
    exactBlocksByLookupKey: ReadonlyMap<string, Uint32Array>;
    globalExactCache: Map<string, Uint32Array>;
    queryLocalBodyHanExactCache: Map<number, Uint32Array>;
    blockIds: readonly number[];
    budget: {
      blockBudget: number;
      byteBudget: number;
      timeBudgetMs: number;
    };
    getGlobalExactCacheBytes: () => number;
    setGlobalExactCacheBytes: (nextValue: number) => void;
  }): Promise<{
    fetchedBlockIds: readonly number[];
    fetchedBlockCount: number;
    byteSum: number;
    skippedByBudget: number;
    skippedReason: "none" | "block_budget" | "byte_budget" | "time_budget";
    blockResults: readonly {
      blockId: number;
      docId: number | null;
      path: string | null;
      blockOrdinal: number | null;
      status:
        | "cache_hit"
        | "fetched"
        | "block_budget"
        | "byte_budget"
        | "time_budget"
        | "read_miss";
      estimatedBytes: number | null;
      segmentCount: number | null;
      symbolCount: number | null;
    }[];
  }> {
    const deadline = Date.now() + Math.max(0, options.budget.timeBudgetMs);
    const fetchedBlockIds: number[] = [];
    const blockResults = new Map<
      number,
      {
        blockId: number;
        docId: number | null;
        path: string | null;
        blockOrdinal: number | null;
        status:
          | "cache_hit"
          | "fetched"
          | "block_budget"
          | "byte_budget"
          | "time_budget"
          | "read_miss";
        estimatedBytes: number | null;
        segmentCount: number | null;
        symbolCount: number | null;
      }
    >();
    let fetchedByteSum = 0;
    let budgetedByteSum = 0;
    let skippedByBudget = 0;
    let skippedReason: "none" | "block_budget" | "byte_budget" | "time_budget" =
      "none";
    let fetchedRequestCount = 0;

    for (const blockId of options.blockIds) {
      const descriptor = options.store.getBodyHanLogicalBlockDescriptor(blockId);
      const cacheKey = this.getVariantBodyHanExactCacheKey(options.store, blockId);
      if (!descriptor || !cacheKey) {
        blockResults.set(blockId, {
          blockId,
          docId: descriptor?.docId ?? null,
          path: descriptor?.path ?? null,
          blockOrdinal: descriptor?.blockOrdinal ?? null,
          status: "read_miss",
          estimatedBytes: descriptor?.encodedByteLength ?? null,
          segmentCount: descriptor?.segmentCount ?? null,
          symbolCount: descriptor?.symbolCount ?? null,
        });
        continue;
      }
      const cached = this.getVariantCachedBodyHanExact(
        options.store,
        options.globalExactCache,
        blockId,
      );
      if (cached) {
        options.queryLocalBodyHanExactCache.set(blockId, cached);
        fetchedBlockIds.push(blockId);
        fetchedByteSum += cached.byteLength;
        blockResults.set(blockId, {
          blockId,
          docId: descriptor.docId,
          path: descriptor.path,
          blockOrdinal: descriptor.blockOrdinal,
          status: "cache_hit",
          estimatedBytes: cached.byteLength,
          segmentCount: descriptor.segmentCount,
          symbolCount: descriptor.symbolCount,
        });
        continue;
      }
      if (fetchedRequestCount >= Math.max(0, options.budget.blockBudget)) {
        skippedReason = "block_budget";
        skippedByBudget += 1;
        blockResults.set(blockId, {
          blockId,
          docId: descriptor.docId,
          path: descriptor.path,
          blockOrdinal: descriptor.blockOrdinal,
          status: "block_budget",
          estimatedBytes: descriptor.encodedByteLength,
          segmentCount: descriptor.segmentCount,
          symbolCount: descriptor.symbolCount,
        });
        continue;
      }
      if (
        budgetedByteSum + descriptor.encodedByteLength >
        Math.max(0, options.budget.byteBudget)
      ) {
        skippedReason = "byte_budget";
        skippedByBudget += 1;
        blockResults.set(blockId, {
          blockId,
          docId: descriptor.docId,
          path: descriptor.path,
          blockOrdinal: descriptor.blockOrdinal,
          status: "byte_budget",
          estimatedBytes: descriptor.encodedByteLength,
          segmentCount: descriptor.segmentCount,
          symbolCount: descriptor.symbolCount,
        });
        continue;
      }
      if (Date.now() > deadline) {
        skippedReason = "time_budget";
        skippedByBudget += 1;
        blockResults.set(blockId, {
          blockId,
          docId: descriptor.docId,
          path: descriptor.path,
          blockOrdinal: descriptor.blockOrdinal,
          status: "time_budget",
          estimatedBytes: descriptor.encodedByteLength,
          segmentCount: descriptor.segmentCount,
          symbolCount: descriptor.symbolCount,
        });
        continue;
      }
      const symbolIds = options.exactBlocksByLookupKey.get(cacheKey);
      if (!symbolIds) {
        blockResults.set(blockId, {
          blockId,
          docId: descriptor.docId,
          path: descriptor.path,
          blockOrdinal: descriptor.blockOrdinal,
          status: "read_miss",
          estimatedBytes: descriptor.encodedByteLength,
          segmentCount: descriptor.segmentCount,
          symbolCount: descriptor.symbolCount,
        });
        continue;
      }
      fetchedRequestCount += 1;
      budgetedByteSum += descriptor.encodedByteLength;
      options.queryLocalBodyHanExactCache.set(blockId, symbolIds);
      this.setVariantCachedBodyHanExact(
        options.globalExactCache,
        cacheKey,
        symbolIds,
        options.getGlobalExactCacheBytes,
        options.setGlobalExactCacheBytes,
      );
      fetchedBlockIds.push(blockId);
      fetchedByteSum += symbolIds.byteLength;
      blockResults.set(blockId, {
        blockId,
        docId: descriptor.docId,
        path: descriptor.path,
        blockOrdinal: descriptor.blockOrdinal,
        status: "fetched",
        estimatedBytes: symbolIds.byteLength,
        segmentCount: descriptor.segmentCount,
        symbolCount: descriptor.symbolCount,
      });
    }

    return {
      fetchedBlockIds,
      fetchedBlockCount: fetchedBlockIds.length,
      byteSum: fetchedByteSum,
      skippedByBudget,
      skippedReason,
      blockResults: options.blockIds.map((blockId) => {
        const descriptor = options.store.getBodyHanLogicalBlockDescriptor(blockId);
        return (
          blockResults.get(blockId) ?? {
            blockId,
            docId: descriptor?.docId ?? null,
            path: descriptor?.path ?? null,
            blockOrdinal: descriptor?.blockOrdinal ?? null,
            status: "read_miss" as const,
            estimatedBytes: descriptor?.encodedByteLength ?? null,
            segmentCount: descriptor?.segmentCount ?? null,
            symbolCount: descriptor?.symbolCount ?? null,
          }
        );
      }),
    };
  }

  private getVariantCachedBodyHanExact(
    store: CoverageLexicalV2IndexStore,
    globalExactCache: Map<string, Uint32Array>,
    blockId: number,
  ): Uint32Array | undefined {
    const cacheKey = this.getVariantBodyHanExactCacheKey(store, blockId);
    if (!cacheKey) {
      return undefined;
    }
    const cached = globalExactCache.get(cacheKey);
    if (!cached) {
      return undefined;
    }
    globalExactCache.delete(cacheKey);
    globalExactCache.set(cacheKey, cached);
    return cached;
  }

  private setVariantCachedBodyHanExact(
    globalExactCache: Map<string, Uint32Array>,
    cacheKey: string,
    symbolIds: Uint32Array,
    getGlobalExactCacheBytes: () => number,
    setGlobalExactCacheBytes: (nextValue: number) => void,
  ): void {
    const existing = globalExactCache.get(cacheKey);
    let cacheBytes = getGlobalExactCacheBytes();
    if (existing) {
      globalExactCache.delete(cacheKey);
      cacheBytes = Math.max(0, cacheBytes - existing.byteLength);
    }
    if (symbolIds.byteLength > 12 * 1024 * 1024) {
      setGlobalExactCacheBytes(cacheBytes);
      return;
    }
    globalExactCache.set(cacheKey, symbolIds);
    cacheBytes += symbolIds.byteLength;
    while (globalExactCache.size > 2048 || cacheBytes > 12 * 1024 * 1024) {
      const oldestKey = globalExactCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      const oldest = globalExactCache.get(oldestKey);
      globalExactCache.delete(oldestKey);
      cacheBytes = Math.max(0, cacheBytes - (oldest?.byteLength ?? 0));
    }
    setGlobalExactCacheBytes(cacheBytes);
  }

  private getVariantBodyHanExactCacheKey(
    store: CoverageLexicalV2IndexStore,
    blockId: number,
  ): string | null {
    const descriptor = store.getBodyHanLogicalBlockDescriptor(blockId);
    if (!descriptor?.path) {
      return null;
    }
    return `${descriptor.path}:${descriptor.blockOrdinal}`;
  }

  private collectHanRuntimeTimingWindows(
    bucket: Set<string>,
    symbols: readonly string[],
    windowSize: number,
  ): void {
    if (
      symbols.length < windowSize ||
      bucket.size >= HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET
    ) {
      return;
    }
    for (
      let startIndex = 0;
      startIndex <= symbols.length - windowSize &&
      bucket.size < HAN_RUNTIME_TIMING_SAMPLE_LIMIT_PER_BUCKET;
      startIndex += 1
    ) {
      const queryText = symbols.slice(startIndex, startIndex + windowSize).join("");
      if (queryText.length > 0) {
        bucket.add(queryText);
      }
    }
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
    lexicalResidentHotBytes: number,
    jsHeapUsage: JsHeapUsageSample | null,
  ): string[] {
    if (!jsHeapUsage) {
      return [];
    }
    const unattributedJsHeapUsed = Math.max(
      0,
      jsHeapUsage.usedBytes - lexicalResidentHotBytes,
    );
    return [
      'JS heap used now: ' + this.formatBytes(jsHeapUsage.usedBytes),
      'JS heap committed now: ' + this.formatBytes(jsHeapUsage.totalBytes),
      'JS heap unattributed beyond lexical resident-hot estimate: ' +
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
    residentGroupRows: DevStorageBreakdownRow[];
    coldOwnedGroupRows: DevStorageBreakdownRow[];
    overlapRows: DevStorageBreakdownRow[];
    residentTopRows: DevStorageBreakdownRow[];
    coldOverlapTopRows: DevStorageBreakdownRow[];
  } {
    const emptyResult = {
      noticeLines: [],
      summaryLine: null,
      residentGroupRows: [],
      coldOwnedGroupRows: [],
      overlapRows: [],
      residentTopRows: [],
      coldOverlapTopRows: [],
    };
    if (!breakdown) {
      return emptyResult;
    }

    const estimatedBytes = this.asRecord(breakdown.estimatedBytes);
    const residentHot = this.asRecord(estimatedBytes?.residentHot);
    const coldOwned = this.asRecord(estimatedBytes?.coldOwned);
    const overlapDiagnostics = this.asRecord(estimatedBytes?.overlapDiagnostics);
    if (!estimatedBytes || !residentHot || !coldOwned || !overlapDiagnostics) {
      return emptyResult;
    }

    const residentHotPostings = this.asRecord(residentHot.postings);
    const residentHotDocuments = this.asRecord(residentHot.documents);
    const residentHotVerification = this.asRecord(residentHot.verification);
    const residentHotLexicon = this.asRecord(residentHot.lexicon);
    const residentHotCaches = this.asRecord(residentHot.caches);

    const residentHotTotal =
      this.readNumber(residentHot.total) ?? runtimeLexicalIndexBytes;
    const coldOwnedTotal = this.readNumber(coldOwned.total) ?? 0;
    const overlapDiagnosticsTotal =
      this.readNumber(overlapDiagnostics.total) ?? 0;
    const combinedOwnedTotal =
      this.readNumber(estimatedBytes.combinedOwnedTotal) ??
      residentHotTotal + coldOwnedTotal;

    const exactIncidenceBytes =
      this.readNumber(residentHotPostings?.exactIncidence) ?? 0;
    const metadataHanGateBytes =
      this.readNumber(residentHotPostings?.metadataHanGate) ?? 0;
    const bodyHanShardPostingBytes =
      this.readNumber(residentHotPostings?.bodyHanShards) ?? 0;
    const documentViewBytes =
      this.readNumber(residentHotDocuments?.view) ?? 0;
    const bodyHanBlockOwnerBytes =
      this.readNumber(residentHotVerification?.bodyHanSegments) ?? 0;
    const bodyHanShardDescriptorBytes =
      this.readNumber(residentHotVerification?.bodyHanShardDescriptors) ?? 0;
    const canonicalTermLexiconBytes =
      this.readNumber(residentHotLexicon?.canonicalTerms) ?? 0;
    const latinExpansionLexiconBytes =
      this.readNumber(residentHotLexicon?.latinExpansion) ?? 0;
    const bodyTokensHotBytes =
      this.readNumber(residentHotCaches?.bodyTokensHot) ?? 0;
    const bodyTokensSidecarBytes =
      this.readNumber(coldOwned.bodyTokensSidecar) ?? 0;
    const bodyHanSegmentExactSidecarBytes =
      this.readNumber(coldOwned.bodyHanSegmentExactSidecar) ?? 0;
    const bodyTokensHotVsSidecarBytes =
      this.readNumber(overlapDiagnostics.bodyTokensHotVsSidecar) ?? 0;
    const pathMirrorBytes = this.readNumber(overlapDiagnostics.pathMirrors) ?? 0;
    const manifestMirrorBytes =
      this.readNumber(overlapDiagnostics.manifestMirrors) ?? 0;
    const postingsTotalBytes =
      exactIncidenceBytes + metadataHanGateBytes + bodyHanShardPostingBytes;
    const lexiconTotalBytes =
      canonicalTermLexiconBytes + latinExpansionLexiconBytes;

    const residentSegments: Array<{ segment: string; bytes: number }> = [];
    const coldOwnedSegments: Array<{ segment: string; bytes: number }> = [];
    const overlapSegments: Array<{ segment: string; bytes: number }> = [];
    const allSegments: Array<{ segment: string; bytes: number }> = [];
    const pushResidentSegment = (segment: string, bytes: number) => {
      if (bytes <= 0) {
        return;
      }
      residentSegments.push({ segment, bytes });
      allSegments.push({ segment, bytes });
    };
    const pushColdOwnedSegment = (segment: string, bytes: number) => {
      if (bytes <= 0) {
        return;
      }
      coldOwnedSegments.push({ segment, bytes });
      allSegments.push({ segment, bytes });
    };
    const pushOverlapSegment = (segment: string, bytes: number) => {
      if (bytes <= 0) {
        return;
      }
      overlapSegments.push({ segment, bytes });
      allSegments.push({ segment, bytes });
    };

    pushResidentSegment('postings.exactIncidence', exactIncidenceBytes);
    pushResidentSegment('postings.metadataHanGate', metadataHanGateBytes);
    pushResidentSegment('postings.bodyHanShards', bodyHanShardPostingBytes);
    pushResidentSegment('documents.view', documentViewBytes);
    pushResidentSegment('doc.bodyHanBlockOwner', bodyHanBlockOwnerBytes);
    pushResidentSegment(
      'doc.bodyHanShardDescriptors',
      bodyHanShardDescriptorBytes,
    );
    pushResidentSegment('lexicon.canonicalTerms', canonicalTermLexiconBytes);
    pushResidentSegment('lexicon.latinExpansion', latinExpansionLexiconBytes);
    pushResidentSegment('doc.bodyTokens(hot)', bodyTokensHotBytes);
    pushColdOwnedSegment('doc.bodyTokens(sidecar)', bodyTokensSidecarBytes);
    pushColdOwnedSegment(
      'doc.bodyHanSegmentExact(sidecar)',
      bodyHanSegmentExactSidecarBytes,
    );
    pushOverlapSegment(
      'overlap.bodyTokens(hot+cold)',
      bodyTokensHotVsSidecarBytes,
    );
    pushOverlapSegment('overlap.pathMirrors', pathMirrorBytes);
    pushOverlapSegment('overlap.manifestMirrors', manifestMirrorBytes);

    const residentAccountedBytes = residentSegments.reduce(
      (sum, segment) => sum + segment.bytes,
      0,
    );
    const sortedResidentSegments = [...residentSegments].sort(
      (left, right) => right.bytes - left.bytes,
    );
    const sortedColdOwnedSegments = [...coldOwnedSegments].sort(
      (left, right) => right.bytes - left.bytes,
    );
    const sortedOverlapSegments = [...overlapSegments].sort(
      (left, right) => right.bytes - left.bytes,
    );
    const toBreakdownRows = (
      segments: Array<{ segment: string; bytes: number }>,
      denominator: number,
    ): DevStorageBreakdownRow[] =>
      segments.map((segment) => ({
        segment: segment.segment,
        bytes: segment.bytes,
        size: this.formatBytes(segment.bytes),
        shareOfLexical: this.formatPercent(segment.bytes, denominator),
        shareOfVault: this.formatPercent(segment.bytes, indexableBytes),
      }));

    const residentGroupRows = toBreakdownRows(
      ([
        ['postings.total', postingsTotalBytes],
        ['documents.view', documentViewBytes],
        ['doc.bodyHanBlockOwner', bodyHanBlockOwnerBytes],
        ['lexicon.total', lexiconTotalBytes],
        ['lexicon.canonicalTerms', canonicalTermLexiconBytes],
        ['lexicon.latinExpansion', latinExpansionLexiconBytes],
        ['doc.bodyTokens(hot)', bodyTokensHotBytes],
      ] as Array<[string, number]>)
        .filter(([, bytes]) => bytes > 0)
        .map(([segment, bytes]) => ({ segment, bytes })),
      residentHotTotal,
    );
    const coldOwnedGroupRows = toBreakdownRows(
      coldOwnedSegments,
      coldOwnedTotal,
    );
    const overlapRows = toBreakdownRows(overlapSegments, overlapDiagnosticsTotal);
    const residentTopRows = toBreakdownRows(
      sortedResidentSegments.slice(0, 10),
      residentHotTotal,
    );
    const coldOverlapTopRows = toBreakdownRows(
      [...sortedColdOwnedSegments, ...sortedOverlapSegments]
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, 10),
      coldOwnedTotal + overlapDiagnosticsTotal,
    );

    if (
      residentTopRows.length === 0 &&
      residentHotTotal <= 0 &&
      coldOwnedTotal <= 0 &&
      overlapDiagnosticsTotal <= 0
    ) {
      return emptyResult;
    }

    const noticeLines = [
      'Coverage resident hot: ' +
        this.formatBytes(residentHotTotal) +
        ' (' +
        this.formatPercent(residentHotTotal, indexableBytes) +
        ' of vault)',
      'Coverage cold owned: ' +
        this.formatBytes(coldOwnedTotal) +
        ' (' +
        this.formatPercent(coldOwnedTotal, indexableBytes) +
        ' of vault)',
      'Coverage combined owned: ' +
        this.formatBytes(combinedOwnedTotal) +
        ' (' +
        this.formatPercent(combinedOwnedTotal, indexableBytes) +
        ' of vault)',
      'Coverage overlap diagnostics: ' + this.formatBytes(overlapDiagnosticsTotal),
      'Coverage resident major groups: ' +
        ([
          ['postings(total)', postingsTotalBytes],
          ['documents(view)', documentViewBytes],
          ['bodyHanBlockOwner', bodyHanBlockOwnerBytes],
          ['lexicon(total)', lexiconTotalBytes],
          ['lexicon(canonicalTerms)', canonicalTermLexiconBytes],
          ['lexicon(latinExpansion)', latinExpansionLexiconBytes],
          ['bodyTokens(hotCache)', bodyTokensHotBytes],
        ] as Array<[string, number]>)
          .filter(([, bytes]) => bytes > 0)
          .map(([segment, bytes]) => segment + ' ' + this.formatBytes(bytes))
          .join(' | '),
      'Coverage cold owned groups: ' +
        ([
          ['bodyTokens(sidecar)', bodyTokensSidecarBytes],
          ['bodyHanSegmentExact(sidecar)', bodyHanSegmentExactSidecarBytes],
        ] as Array<[string, number]>)
          .filter(([, bytes]) => bytes > 0)
          .map(([segment, bytes]) => segment + ' ' + this.formatBytes(bytes))
          .join(' | '),
      'Coverage top resident segments (top 10): ' +
        sortedResidentSegments
          .slice(0, 10)
          .map((segment) => segment.segment + ' ' + this.formatBytes(segment.bytes))
          .join(' | '),
      'Coverage top cold/overlap segments (top 10): ' +
        [...sortedColdOwnedSegments, ...sortedOverlapSegments]
          .sort((left, right) => right.bytes - left.bytes)
          .slice(0, 10)
          .map((segment) => segment.segment + ' ' + this.formatBytes(segment.bytes))
          .join(' | '),
      'Coverage accounted resident segments: ' +
        this.formatBytes(residentAccountedBytes) +
        ' / ' +
        this.formatBytes(residentHotTotal),
    ].filter((line) => !line.endsWith(': '));

    return {
      noticeLines,
      summaryLine: noticeLines.join('; '),
      residentGroupRows,
      coldOwnedGroupRows,
      overlapRows,
      residentTopRows,
      coldOverlapTopRows,
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
