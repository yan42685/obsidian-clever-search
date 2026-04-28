// @ts-nocheck
import { MyNotice } from "../transformed-api";
import type { DataManager } from "./data-manager";

type DevDataManager = DataManager & Record<string, any>;

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

type LexicalRuntimeBreakdown = {
  noticeLines: string[];
  summaryLine: string | null;
  residentGroupRows: DevStorageBreakdownRow[];
  coldOwnedGroupRows: DevStorageBreakdownRow[];
  overlapRows: DevStorageBreakdownRow[];
  residentTopRows: DevStorageBreakdownRow[];
  coldOverlapTopRows: DevStorageBreakdownRow[];
};

type LexicalRuntimeReport = {
  indexableBytes: number;
  persistedLexicalSnapshotBytes: number;
  runtimeLexicalIndexBytes: number;
  lexicalIndexBreakdown: Record<string, unknown> | null;
  lexicalRuntimeBreakdown: LexicalRuntimeBreakdown;
  fileSnapshotRuntimeEstimate: FileSnapshotRuntimeMemoryEstimate;
  coverageLexicalV3PersistedStorageBreakdown: CoverageLexicalV3PersistedStorageBreakdown;
  hybridPersistedRuntimeState: HybridPersistedRuntimeStateBreakdown;
};

type CoverageLexicalV3PersistedStorageBreakdown = {
  totalBytes: number;
  artifactBytes: number;
  registryBytes: number;
  snapshotBytes: number;
  snapshotManifestBytes: number;
  shardArtifactBytes: number;
  overlayJournalBytes: number;
  compactBytes: number;
  invalidationBytes: number;
  metadataBytes: number;
  evidenceBytes: number;
  fuzzyRescueBytes: number;
  coldEvidenceBreakdown?: LexicalColdEvidenceStorageBreakdown;
};

type HybridPersistedRuntimeStateBreakdown = {
  enabled: boolean;
  persistedTotalBytes: number;
  chunkBytes: number;
  fileSnapshotBytes: number;
  dirtyShadowBytes: number;
  vectorBytes: number;
  hnswBytes: number;
  indexedRefBytes: number;
  recoveryArtifactStateBytes: number;
  runtimeTotalBytes: number;
  runtimeVectorBytes: number;
  runtimeGraphBytes: number;
};

const COVERAGE_LEXICAL_V3_PERSISTED_ARTIFACT_TABLES = [
  "lexicalSearchSnapshots",
  "coverageLexicalV3ResidentShardArtifacts",
  "lexicalIndexedMetadata",
  "lexicalFuzzyRescue",
  "lexicalBodyEvidence",
  "lexicalHanDocEvidence",
  "lexicalHanBodyEvidence",
] as const;

const COVERAGE_LEXICAL_V3_PERSISTED_REGISTRY_TABLES = [
  "lexicalIndexedFileRefs",
  "docRegistry",
  "docRegistryMeta",
  "coverageLexicalV3ShardRegistry",
  "coverageLexicalV3Invalidations",
  "coverageLexicalV3ActiveOverlayJournal",
  "coverageLexicalV3CompactJobs",
  "coverageLexicalV3CompactTempArtifacts",
  "coverageLexicalV3SnapshotManifests",
] as const;

const COVERAGE_LEXICAL_V3_PERSISTED_EVIDENCE_TABLES = [
  "lexicalBodyEvidence",
  "lexicalHanDocEvidence",
  "lexicalHanBodyEvidence",
] as const;

const HYBRID_PERSISTED_STATE_TABLES = [
  "hybridChunks",
  "fileSnapshots",
  "hybridDirtyShadows",
  "hybridChunkVectors",
  "hybridHnswSmall",
  "hybridIndexedFileRefs",
  "indexRecoveryState",
  "indexArtifactState",
] as const;

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


export async function showDevStorageAndRuntimeStats(dataManager: DataManager): Promise<void> {
  await new DataManagerDevDiagnostics(dataManager).showDevStorageAndRuntimeStats();
}

export async function logStartupLexicalMemorySummary(dataManager: DataManager): Promise<void> {
  await new DataManagerDevDiagnostics(dataManager).logStartupLexicalMemorySummary();
}

export function sampleJsHeapUsage(dataManager: DataManager): unknown {
  const dataManagerSampler = (dataManager as DataManager & {
    sampleJsHeapUsage?: () => unknown;
  }).sampleJsHeapUsage;
  if (typeof dataManagerSampler === "function") {
    return dataManagerSampler.call(dataManager);
  }
  return new DataManagerDevDiagnostics(dataManager).sampleJsHeapUsage();
}

export function buildStartupLexicalMemorySummaryLines(
  dataManager: DataManager,
  report: LexicalRuntimeReport,
): string[] {
  return new DataManagerDevDiagnostics(dataManager).buildStartupLexicalMemorySummaryLines(
    report,
  );
}

export function summarizeLexicalHeapDelta(
  dataManager: DataManager,
  before: unknown,
  after: unknown,
): unknown {
  return new DataManagerDevDiagnostics(dataManager).summarizeLexicalHeapDelta(before, after);
}
export async function showDevHanDiagnostics(dataManager: DataManager): Promise<void> {
  await new DataManagerDevDiagnostics(dataManager).showDevHanDiagnostics();
}

class DataManagerDevDiagnostics {
  constructor(private readonly dataManager: DevDataManager) {}

  async showDevStorageAndRuntimeStats(): Promise<void> {
    await this.noticeDevStorageStats();
  }

  async showDevHanDiagnostics(): Promise<void> {
    await this.noticeDevStorageStats();
  }

  private async noticeDevStorageStats() {
    const {
      indexableBytes,
      persistedLexicalSnapshotBytes,
      runtimeLexicalIndexBytes,
      lexicalRuntimeBreakdown,
      coverageLexicalV3PersistedStorageBreakdown,
      hybridPersistedRuntimeState,
    } = await this.collectLexicalRuntimeReport();
    const localOnlyHint =
      "Local-only: no embedding API, no rerank API, no token usage.";
    const persistedRuntimeStateLines =
      this.buildPersistedRuntimeStateNoticeLines(
        coverageLexicalV3PersistedStorageBreakdown,
        hybridPersistedRuntimeState,
        indexableBytes,
      );

    new MyNotice(
      `${[
        "Lexical memory report",
        `Lexical resident runtime: ${this.formatBytes(runtimeLexicalIndexBytes)}`,
        `Persisted lexical snapshot: ${this.formatBytes(persistedLexicalSnapshotBytes)}`,
        ...lexicalRuntimeBreakdown.noticeLines,
        ...persistedRuntimeStateLines,
        localOnlyHint,
      ].join("\n")}`,
      15000,
    );

    console.groupCollapsed("[clever-search] lexical memory report");
    console.log(`Indexable vault size: ${this.formatBytes(indexableBytes)}`);
    console.log(
      `Lexical resident runtime: ${this.formatBytes(runtimeLexicalIndexBytes)}`,
    );
    console.log(
      `Persisted lexical snapshot: ${this.formatBytes(persistedLexicalSnapshotBytes)}`,
    );
    for (const line of persistedRuntimeStateLines) {
      console.log(`[clever-search] ${line}`);
    }
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
    console.log(`[clever-search] ${localOnlyHint}`);
    console.groupEnd();
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

  private buildPersistedRuntimeStateNoticeLines(
    lexicalPersistedV3: CoverageLexicalV3PersistedStorageBreakdown,
    hybridState: HybridPersistedRuntimeStateBreakdown,
    indexableBytes: number,
  ): string[] {
    const lines: string[] = [];
    lines.push(
      "Lexical persisted V3 artifact/cold evidence: total " +
        this.formatBytes(lexicalPersistedV3.totalBytes) +
        " (" +
        this.formatPercent(lexicalPersistedV3.totalBytes, indexableBytes) +
        " of vault) | resident artifacts " +
        this.formatBytes(lexicalPersistedV3.shardArtifactBytes) +
        " | cold evidence " +
        this.formatBytes(lexicalPersistedV3.evidenceBytes) +
        " | fuzzy rescue " +
        this.formatBytes(lexicalPersistedV3.fuzzyRescueBytes) +
        " | registry/meta " +
        this.formatBytes(lexicalPersistedV3.registryBytes),
    );

    const hybridParts = [
      hybridState.chunkBytes > 0
        ? "chunks " + this.formatBytes(hybridState.chunkBytes)
        : null,
      hybridState.fileSnapshotBytes > 0
        ? "fileSnapshots " + this.formatBytes(hybridState.fileSnapshotBytes)
        : null,
      hybridState.vectorBytes > 0
        ? "vectors " + this.formatBytes(hybridState.vectorBytes)
        : null,
      hybridState.hnswBytes > 0
        ? "hnsw " + this.formatBytes(hybridState.hnswBytes)
        : null,
      hybridState.dirtyShadowBytes > 0
        ? "dirtyShadows " + this.formatBytes(hybridState.dirtyShadowBytes)
        : null,
      hybridState.indexedRefBytes > 0
        ? "indexedRefs " + this.formatBytes(hybridState.indexedRefBytes)
        : null,
      hybridState.recoveryArtifactStateBytes > 0
        ? "recovery/artifact-state " +
          this.formatBytes(hybridState.recoveryArtifactStateBytes)
        : null,
    ].filter((part): part is string => part !== null);
    lines.push(
      "Hybrid persisted/runtime state: " +
        (hybridState.enabled ? "enabled" : "disabled") +
        " | persisted " +
        this.formatBytes(hybridState.persistedTotalBytes) +
        " (" +
        this.formatPercent(hybridState.persistedTotalBytes, indexableBytes) +
        " of vault)" +
        " | runtime " +
        this.formatBytes(hybridState.runtimeTotalBytes) +
        " | runtime vectors " +
        this.formatBytes(hybridState.runtimeVectorBytes) +
        " | runtime graph " +
        this.formatBytes(hybridState.runtimeGraphBytes),
    );
    if (hybridParts.length > 0) {
      lines.push("Hybrid persisted slices: " + hybridParts.join(" | "));
    }
    return lines;
  }

  private async collectLexicalRuntimeReport(): Promise<LexicalRuntimeReport> {
    const indexableFiles = this.dataManager.dataProvider.allFilesToBeIndexed();
    const indexableBytes = indexableFiles.reduce(
      (sum, file) => sum + file.stat.size,
      0,
    );
    const storageUsage = await this.dataManager.database.estimatePluginStorageUsage();
    const bytesByName = new Map(
      storageUsage.tables.map((item) => [item.name, item.bytes]),
    );
    const persistedLexicalSnapshotBytes =
      this.dataManager.lexicalEngine.supportsSerializedFileIndex()
        ? (bytesByName.get("lexicalSearchSnapshots") ?? 0)
        : 0;
    const runtimeLexicalIndexBytes = this.dataManager.lexicalEngine.estimateFileIndexBytes(
      persistedLexicalSnapshotBytes,
    );
    const lexicalIndexBreakdown = this.dataManager.lexicalEngine.getFileIndexBreakdown();
    const lexicalRuntimeBreakdown = this.buildLexicalRuntimeBreakdown(
      lexicalIndexBreakdown,
      runtimeLexicalIndexBytes,
      indexableBytes,
    );
    const coverageLexicalV3PersistedStorageBreakdown =
      this.buildCoverageLexicalV3PersistedStorageBreakdown(
        bytesByName,
        storageUsage.lexicalColdEvidenceBreakdown,
      );
    const hybridPersistedRuntimeState =
      this.buildHybridPersistedRuntimeStateBreakdown(bytesByName);
    const fileSnapshotRuntimeEstimate =
      this.dataManager.fileSnapshotStore.getRuntimeMemoryEstimate();
    return {
      indexableBytes,
      persistedLexicalSnapshotBytes,
      runtimeLexicalIndexBytes,
      lexicalIndexBreakdown,
      lexicalRuntimeBreakdown,
      fileSnapshotRuntimeEstimate,
      coverageLexicalV3PersistedStorageBreakdown,
      hybridPersistedRuntimeState,
    };
  }

  private buildHybridPersistedRuntimeStateBreakdown(
    bytesByName: ReadonlyMap<string, number>,
  ): HybridPersistedRuntimeStateBreakdown {
    const runtimeEstimate = this.readHybridRuntimeMemoryEstimate();
    return {
      enabled: Boolean(this.dataManager.hybridEngine?.isEnabled?.()),
      persistedTotalBytes: HYBRID_PERSISTED_STATE_TABLES.reduce(
        (sum, tableName) => sum + (bytesByName.get(tableName) ?? 0),
        0,
      ),
      chunkBytes: bytesByName.get("hybridChunks") ?? 0,
      fileSnapshotBytes: bytesByName.get("fileSnapshots") ?? 0,
      dirtyShadowBytes: bytesByName.get("hybridDirtyShadows") ?? 0,
      vectorBytes: bytesByName.get("hybridChunkVectors") ?? 0,
      hnswBytes: bytesByName.get("hybridHnswSmall") ?? 0,
      indexedRefBytes: bytesByName.get("hybridIndexedFileRefs") ?? 0,
      recoveryArtifactStateBytes:
        (bytesByName.get("indexRecoveryState") ?? 0) +
        (bytesByName.get("indexArtifactState") ?? 0),
      runtimeTotalBytes: runtimeEstimate.totalBytes,
      runtimeVectorBytes: runtimeEstimate.vectorsBytes,
      runtimeGraphBytes: runtimeEstimate.graphBytes,
    };
  }

  private readHybridRuntimeMemoryEstimate(): {
    vectorsBytes: number;
    graphBytes: number;
    totalBytes: number;
  } {
    const fallback = { vectorsBytes: 0, graphBytes: 0, totalBytes: 0 };
    try {
      const estimate = this.dataManager.hybridEngine?.getRuntimeMemoryEstimate?.();
      if (estimate == null) {
        return fallback;
      }
      return {
        vectorsBytes: this.readNumber(estimate.vectorsBytes) ?? 0,
        graphBytes: this.readNumber(estimate.graphBytes) ?? 0,
        totalBytes: this.readNumber(estimate.totalBytes) ?? 0,
      };
    } catch (_error) {
      return fallback;
    }
  }

  private buildCoverageLexicalV3PersistedStorageBreakdown(
    bytesByName: ReadonlyMap<string, number>,
    coldEvidenceBreakdown?: LexicalColdEvidenceStorageBreakdown,
  ): CoverageLexicalV3PersistedStorageBreakdown {
    const sumBytes = (tableNames: readonly string[]) =>
      tableNames.reduce((sum, tableName) => sum + (bytesByName.get(tableName) ?? 0), 0);
    const snapshotBytes = bytesByName.get("lexicalSearchSnapshots") ?? 0;
    const snapshotManifestBytes =
      bytesByName.get("coverageLexicalV3SnapshotManifests") ?? 0;
    const shardArtifactBytes = bytesByName.get("coverageLexicalV3ResidentShardArtifacts") ?? 0;
    const overlayJournalBytes = bytesByName.get("coverageLexicalV3ActiveOverlayJournal") ?? 0;
    const compactBytes =
      (bytesByName.get("coverageLexicalV3CompactJobs") ?? 0) +
      (bytesByName.get("coverageLexicalV3CompactTempArtifacts") ?? 0);
    const invalidationBytes = bytesByName.get("coverageLexicalV3Invalidations") ?? 0;
    const metadataBytes = bytesByName.get("lexicalIndexedMetadata") ?? 0;
    const fuzzyRescueBytes = bytesByName.get("lexicalFuzzyRescue") ?? 0;
    const evidenceBytes = sumBytes(COVERAGE_LEXICAL_V3_PERSISTED_EVIDENCE_TABLES);
    const artifactBytes = sumBytes(COVERAGE_LEXICAL_V3_PERSISTED_ARTIFACT_TABLES);
    const registryBytes = sumBytes(COVERAGE_LEXICAL_V3_PERSISTED_REGISTRY_TABLES);
    return {
      totalBytes: artifactBytes + registryBytes,
      artifactBytes,
      registryBytes,
      snapshotBytes,
      snapshotManifestBytes,
      shardArtifactBytes,
      overlayJournalBytes,
      compactBytes,
      invalidationBytes,
      metadataBytes,
      evidenceBytes,
      fuzzyRescueBytes,
      coldEvidenceBreakdown,
    };
  }

  private buildStartupLexicalMemorySummaryLines(
    report: LexicalRuntimeReport,
  ): string[] {
    const lines = [
      "Search bootstrap: searchable " +
        (this.dataManager.searchBootstrapMetrics?.searchableMs ?? 0) +
        " ms | commit " +
        (this.dataManager.searchBootstrapMetrics?.commitMs ?? 0) +
        " ms",
      "Persisted lexical snapshot: " +
        this.formatBytes(report.persistedLexicalSnapshotBytes),
    ];
    const currentTextRuntimeBytes = report.fileSnapshotRuntimeEstimate.totalBytes;
    if (currentTextRuntimeBytes > 0) {
      lines.push(
        "Current text cache: " +
          this.formatBytes(currentTextRuntimeBytes) +
          " (" +
          report.fileSnapshotRuntimeEstimate.fileCount +
          " live file(s))",
      );
    }
    lines.push(
      ...this.buildPersistedRuntimeStateNoticeLines(
        report.coverageLexicalV3PersistedStorageBreakdown,
        report.hybridPersistedRuntimeState,
        report.indexableBytes,
      ),
    );

    if (report.lexicalIndexBreakdown?.__backend === "coverage-lexical-v3") {
      const breakdown =
        report.lexicalIndexBreakdown as CoverageLexicalV3RuntimeMemoryBreakdown;
      const residentTotal =
        breakdown.metrics.residentBytes || report.runtimeLexicalIndexBytes;
      const auxiliaryBytes = breakdown.metrics.auxiliaryBytes;
      const residentHotBytes = Math.max(0, residentTotal - auxiliaryBytes);
      const coldEvidenceBytes = Math.max(
        0,
        breakdown.metrics.exactTapePositionBytes +
          breakdown.metrics.hanRouteMetadataWitnessBytes +
          breakdown.metrics.hanRouteBodyWitnessBytes +
          breakdown.metrics.hanRouteBodyWitnessPositionBytes,
      );
      const persistedColdStorage =
        report.coverageLexicalV3PersistedStorageBreakdown;
      lines.push(
        "Coverage V3 startup memory: resident-hot " +
          this.formatBytes(residentHotBytes) +
          " | auxiliary " +
          this.formatBytes(auxiliaryBytes) +
          " | resident-total " +
          this.formatBytes(residentTotal) +
          " (" +
          this.formatPercent(residentTotal, report.indexableBytes) +
          " of vault)",
      );
      if (persistedColdStorage.totalBytes > 0) {
        lines.push(
          "Coverage V3 cold storage: artifacts " +
            this.formatBytes(persistedColdStorage.artifactBytes) +
            " | registry/meta " +
            this.formatBytes(persistedColdStorage.registryBytes) +
            " | total " +
            this.formatBytes(persistedColdStorage.totalBytes) +
            " (" +
            this.formatPercent(
              persistedColdStorage.totalBytes,
              report.indexableBytes,
            ) +
            " of vault)",
        );
        const coldSliceParts = [
          persistedColdStorage.snapshotBytes > 0
            ? "legacy-serialized-snapshot " +
              this.formatBytes(persistedColdStorage.snapshotBytes)
            : null,
          persistedColdStorage.snapshotManifestBytes > 0
            ? "snapshot-manifests " +
              this.formatBytes(persistedColdStorage.snapshotManifestBytes)
            : null,
          persistedColdStorage.shardArtifactBytes > 0
            ? "resident-shard-artifacts " +
              this.formatBytes(persistedColdStorage.shardArtifactBytes)
            : null,
          persistedColdStorage.overlayJournalBytes > 0
            ? "overlay-journal " +
              this.formatBytes(persistedColdStorage.overlayJournalBytes)
            : null,
          persistedColdStorage.compactBytes > 0
            ? "compact-jobs-temp " +
              this.formatBytes(persistedColdStorage.compactBytes)
            : null,
          persistedColdStorage.invalidationBytes > 0
            ? "invalidations " +
              this.formatBytes(persistedColdStorage.invalidationBytes)
            : null,
          persistedColdStorage.evidenceBytes > 0
            ? "evidence " + this.formatBytes(persistedColdStorage.evidenceBytes)
            : null,
          persistedColdStorage.metadataBytes > 0
            ? "metadata " + this.formatBytes(persistedColdStorage.metadataBytes)
            : null,
          persistedColdStorage.fuzzyRescueBytes > 0
            ? "fuzzy-rescue " +
              this.formatBytes(persistedColdStorage.fuzzyRescueBytes)
            : null,
        ].filter((part): part is string => part !== null);
        if (coldSliceParts.length > 0) {
          lines.push("Coverage V3 cold slices: " + coldSliceParts.join(" | "));
        }
        const coldEvidenceBreakdown = persistedColdStorage.coldEvidenceBreakdown;
        if (coldEvidenceBreakdown !== undefined) {
          lines.push(
            "Coverage V3 cold evidence tables: body " +
              this.formatBytes(coldEvidenceBreakdown.tables.lexicalBodyEvidence) +
              " | han-doc " +
              this.formatBytes(coldEvidenceBreakdown.tables.lexicalHanDocEvidence) +
              " | han-body " +
              this.formatBytes(coldEvidenceBreakdown.tables.lexicalHanBodyEvidence),
          );
          const bodyPayloadBytes =
            coldEvidenceBreakdown.bodyEvidence.exactFamilySlotBytes +
            coldEvidenceBreakdown.bodyEvidence.exactPositionBytes +
            coldEvidenceBreakdown.bodyEvidence.supportFamilySlotBytes +
            coldEvidenceBreakdown.bodyEvidence.supportMaskBytes;
          const hanDocPayloadBytes =
            coldEvidenceBreakdown.hanDocEvidence.witnessMatchKeyBytes +
            coldEvidenceBreakdown.hanDocEvidence.witnessTextBytes +
            coldEvidenceBreakdown.hanDocEvidence.sourceMaskBytes;
          const hanBodyPayloadBytes =
            coldEvidenceBreakdown.hanBodyEvidence.witnessMatchKeyBytes +
            coldEvidenceBreakdown.hanBodyEvidence.witnessTextBytes +
            coldEvidenceBreakdown.hanBodyEvidence.startOffsetBytes;
          lines.push(
            "Coverage V3 cold evidence payloads: body " +
              this.formatBytes(bodyPayloadBytes) +
              " | han-doc " +
              this.formatBytes(hanDocPayloadBytes) +
              " | han-body " +
              this.formatBytes(hanBodyPayloadBytes),
          );
          lines.push(
            "Coverage V3 cold evidence fields: exactSlots " +
              this.formatBytes(coldEvidenceBreakdown.bodyEvidence.exactFamilySlotBytes) +
              " | exactPos " +
              this.formatBytes(coldEvidenceBreakdown.bodyEvidence.exactPositionBytes) +
              " | supportSlots " +
              this.formatBytes(coldEvidenceBreakdown.bodyEvidence.supportFamilySlotBytes) +
              " | witnessKeys " +
              this.formatBytes(
                coldEvidenceBreakdown.hanDocEvidence.witnessMatchKeyBytes +
                  coldEvidenceBreakdown.hanBodyEvidence.witnessMatchKeyBytes,
              ) +
              " | witnessText " +
              this.formatBytes(
                coldEvidenceBreakdown.hanDocEvidence.witnessTextBytes +
                  coldEvidenceBreakdown.hanBodyEvidence.witnessTextBytes,
              ) +
              " | masks/offsets " +
              this.formatBytes(
                coldEvidenceBreakdown.bodyEvidence.supportMaskBytes +
                  coldEvidenceBreakdown.hanDocEvidence.sourceMaskBytes +
                  coldEvidenceBreakdown.hanBodyEvidence.startOffsetBytes,
              ),
          );
          const witnessTextTotal = coldEvidenceBreakdown.witnessTextDedup.totalBytes;
          if (witnessTextTotal > 0) {
            lines.push(
              "Coverage V3 witness text dedup potential: row-local " +
                this.formatBytes(
                  Math.max(
                    0,
                    witnessTextTotal -
                      coldEvidenceBreakdown.witnessTextDedup.rowLocalUniqueBytes,
                  ),
                ) +
                " | doc-local " +
                this.formatBytes(
                  Math.max(
                    0,
                    witnessTextTotal -
                      coldEvidenceBreakdown.witnessTextDedup.docLocalUniqueBytes,
                  ),
                ) +
                " of " +
                this.formatBytes(witnessTextTotal),
            );
          }
        }
      }
      const hotTopRows = report.lexicalRuntimeBreakdown.residentTopRows.filter(
        (row) => row.segment !== "auxiliary",
      );
      if (hotTopRows.length > 0) {
        lines.push(
          "Coverage V3 hot groups: " +
            hotTopRows
              .slice(0, 4)
              .map((row) => row.segment + " " + row.size)
              .join(" | "),
        );
      }
      if (auxiliaryBytes > 0) {
        lines.push(
          "Coverage V3 auxiliary indexes: " +
            this.formatBytes(auxiliaryBytes) +
            " (" +
            this.formatPercent(auxiliaryBytes, residentTotal) +
            " of resident)",
        );
      }
      if (coldEvidenceBytes > 0) {
        lines.push(
          "Coverage V3 cold-at-query evidence: " +
            this.formatBytes(coldEvidenceBytes) +
            " (" +
            this.formatPercent(coldEvidenceBytes, residentTotal) +
            " of resident)",
        );
      }
      return lines;
    }

    return [...lines, ...report.lexicalRuntimeBreakdown.noticeLines.slice(0, 4)];
  }

  async logStartupLexicalMemorySummary(): Promise<void> {
    const report = await this.collectLexicalRuntimeReport();
    const summaryLines = this.buildStartupLexicalMemorySummaryLines(report);
    if (summaryLines.length === 0) {
      return;
    }
    console.groupCollapsed("[clever-search] startup lexical memory");
    for (const line of summaryLines) {
      console.log(`[clever-search] ${line}`);
    }
    console.groupEnd();
  }

  private buildLexicalRuntimeBreakdown(
    breakdown: Record<string, unknown> | null,
    runtimeLexicalIndexBytes: number,
    indexableBytes: number,
  ): LexicalRuntimeBreakdown {
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

    if (breakdown.__backend === "coverage-lexical-v3") {
      return this.buildCoverageLexicalV3RuntimeBreakdown(
        breakdown as CoverageLexicalV3RuntimeMemoryBreakdown,
        runtimeLexicalIndexBytes,
        indexableBytes,
      );
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
    pushColdOwnedSegment('doc.bodyTokens(cold)', bodyTokensSidecarBytes);
    pushColdOwnedSegment(
      'doc.bodyHanSegmentExact(cold)',
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
          ['bodyTokens(cold)', bodyTokensSidecarBytes],
          ['bodyHanSegmentExact(cold)', bodyHanSegmentExactSidecarBytes],
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

  private buildCoverageLexicalV3RuntimeBreakdown(
    breakdown: CoverageLexicalV3RuntimeMemoryBreakdown,
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
    const metrics = breakdown.metrics;
    const summary = breakdown.summary;
    const residentTotal = metrics.residentBytes || runtimeLexicalIndexBytes;
    const segments: Array<{ segment: string; bytes: number }> = [
      { segment: "docArena", bytes: metrics.docArenaBytes },
      { segment: "stringArena", bytes: metrics.stringArenaBytes },
      { segment: "familyLexicon", bytes: metrics.familyLexiconBytes },
      { segment: "metadataContainers", bytes: metrics.metadataContainerBytes },
      { segment: "heading", bytes: metrics.headingBytes },
      { segment: "familyPosting", bytes: metrics.familyPostingBytes },
      { segment: "bodyBlocks", bytes: metrics.bodyBlockBytes },
      { segment: "exactTapes", bytes: metrics.exactTapeBytes },
      { segment: "hanRoute", bytes: metrics.hanRouteBytes },
      { segment: "auxiliary", bytes: metrics.auxiliaryBytes },
    ].filter((segment) => segment.bytes > 0);
    const hanRouteSegments: Array<{ segment: string; bytes: number }> = [
      {
        segment: "sharedBigramIds",
        bytes: metrics.hanRouteSharedBigramIdsBytes,
      },
      {
        segment: "metadataHanPostings",
        bytes: metrics.hanRouteMetadataHanPostingsBytes,
      },
      {
        segment: "hanBigramPosting",
        bytes: metrics.hanRouteHanBigramPostingBytes,
      },
      {
        segment: "metadataWitness",
        bytes: metrics.hanRouteMetadataWitnessBytes,
      },
      {
        segment: "bodyWitness",
        bytes: metrics.hanRouteBodyWitnessBytes,
      },
    ].filter((segment) => segment.bytes > 0);
    const hanRouteMetadataDetailSegments: Array<{ segment: string; bytes: number }> = [
      {
        segment: "postingStarts",
        bytes: metrics.hanRouteMetadataHanPostingStartsBytes,
      },
      {
        segment: "docIds",
        bytes: metrics.hanRouteMetadataHanDocIdsBytes,
      },
    ].filter((segment) => segment.bytes > 0);
    const hanRouteBodyDetailSegments: Array<{ segment: string; bytes: number }> = [
      {
        segment: "singletonTermIds",
        bytes: metrics.hanRouteHanBigramSingletonTermIdsBytes,
      },
      {
        segment: "singletonBodyBlockIds",
        bytes: metrics.hanRouteHanBigramSingletonBlockIdsBytes,
      },
      {
        segment: "pairTermIds",
        bytes: metrics.hanRouteHanBigramPairTermIdsBytes,
      },
      {
        segment: "pairFirstBodyBlockIds",
        bytes: metrics.hanRouteHanBigramPairFirstBlockIdsBytes,
      },
      {
        segment: "pairSecondBodyBlockIds",
        bytes: metrics.hanRouteHanBigramPairSecondBlockIdsBytes,
      },
      {
        segment: "smallTermIds",
        bytes: metrics.hanRouteHanBigramSmallTermIdsBytes,
      },
      {
        segment: "smallPostingStarts",
        bytes: metrics.hanRouteHanBigramSmallPostingStartsBytes,
      },
      {
        segment: "smallBodyBlockIds",
        bytes: metrics.hanRouteHanBigramSmallBlockIdsBytes,
      },
      {
        segment: "deltaTermIds",
        bytes: metrics.hanRouteHanBigramDeltaTermIdsBytes,
      },
      {
        segment: "deltaTapeStarts",
        bytes: metrics.hanRouteHanBigramDeltaTapeStartsBytes,
      },
      {
        segment: "deltaPostingTape",
        bytes: metrics.hanRouteHanBigramDeltaPostingTapeBytes,
      },
    ].filter((segment) => segment.bytes > 0);
    const familyPostingDetailSegments: Array<{ segment: string; bytes: number }> = [
      {
        segment: "singletonTermIds",
        bytes: metrics.familyPostingSingletonTermIdsBytes,
      },
      {
        segment: "singletonBlockIds",
        bytes: metrics.familyPostingSingletonBlockIdsBytes,
      },
      {
        segment: "pairTermIds",
        bytes: metrics.familyPostingPairTermIdsBytes,
      },
      {
        segment: "pairFirstBlockIds",
        bytes: metrics.familyPostingPairFirstBlockIdsBytes,
      },
      {
        segment: "pairSecondBlockIds",
        bytes: metrics.familyPostingPairSecondBlockIdsBytes,
      },
      {
        segment: "smallTermIds",
        bytes: metrics.familyPostingSmallTermIdsBytes,
      },
      {
        segment: "smallPostingStarts",
        bytes: metrics.familyPostingSmallPostingStartsBytes,
      },
      {
        segment: "smallBlockIds",
        bytes: metrics.familyPostingSmallBlockIdsBytes,
      },
      {
        segment: "deltaTermIds",
        bytes: metrics.familyPostingDeltaTermIdsBytes,
      },
      {
        segment: "deltaTapeStarts",
        bytes: metrics.familyPostingDeltaTapeStartsBytes,
      },
      {
        segment: "deltaPostingTape",
        bytes: metrics.familyPostingDeltaPostingTapeBytes,
      },
    ].filter((segment) => segment.bytes > 0);
    const stringArenaDetailSegments: Array<{ segment: string; bytes: number }> = [
      {
        segment: "paths",
        bytes: metrics.stringArenaPathBytes,
      },
      {
        segment: "family",
        bytes: metrics.stringArenaFamilyBytes,
      },
      {
        segment: "identityWitness",
        bytes: metrics.stringArenaIdentityWitnessBytes,
      },
      {
        segment: "routeWitness",
        bytes: metrics.stringArenaRouteWitnessBytes,
      },
      {
        segment: "headingWitness",
        bytes: metrics.stringArenaHeadingWitnessBytes,
      },
      {
        segment: "bodyWitness",
        bytes: metrics.stringArenaBodyWitnessBytes,
      },
      {
        segment: "multiSource",
        bytes: metrics.stringArenaMultiSourceBytes,
      },
      {
        segment: "unattributed",
        bytes: metrics.stringArenaUnattributedBytes,
      },
    ].filter((segment) => segment.bytes > 0);
    const toBreakdownRows = (
      entries: Array<{ segment: string; bytes: number }>,
      denominator: number,
    ): DevStorageBreakdownRow[] =>
      entries.map((entry) => ({
        segment: entry.segment,
        bytes: entry.bytes,
        size: this.formatBytes(entry.bytes),
        shareOfLexical: this.formatPercent(entry.bytes, denominator),
        shareOfVault: this.formatPercent(entry.bytes, indexableBytes),
      }));
    const residentGroupRows = toBreakdownRows(segments, residentTotal);
    const residentTopRows = toBreakdownRows(
      [...segments].sort((left, right) => right.bytes - left.bytes).slice(0, 10),
      residentTotal,
    );
    const shardReadiness = summary.shardReadiness;
    const indexSummary = breakdown.indexSummary;
    const noticeLines = [
      "Coverage V3 resident base: " +
        this.formatBytes(residentTotal) +
        " (" +
        this.formatPercent(residentTotal, indexableBytes) +
        " of vault)",
      "Coverage V3 resident ratios: indexedSurface " +
        summary["residentBytes / indexedSurfaceUtf8Bytes"].toFixed(3) +
        "x | rawMarkdown " +
        summary["residentBytes / rawMarkdownUtf8Bytes"].toFixed(3) +
        "x",
            "Coverage V3 structure: docs " +
        summary.documentCount +
        " | families " +
        summary.familyCount +
        " | bodyBlocks " +
        summary.blockCount +
        " | exactTapeValues " +
        summary.exactTapeValueCount,
      "Coverage V3 resident shards: count " +
        indexSummary.shardCount +
        " | resident " +
        this.formatBytes(indexSummary.residentBytes) +
        " | largest " +
        this.formatBytes(indexSummary.largestShardBytes) +
        " | average " +
        this.formatBytes(indexSummary.averageShardBytes),
      "Coverage V3 resident groups: " +
        residentTopRows
          .map((row) => row.segment + " " + row.size)
          .join(" | "),
      "Coverage V3 hanRoute groups: " +
          hanRouteSegments
            .map((row) => row.segment + " " + this.formatBytes(row.bytes))
            .join(" | "),
      "Coverage V3 familyPosting detail: " +
          familyPostingDetailSegments
            .map((row) => row.segment + " " + this.formatBytes(row.bytes))
            .join(" | "),
      "Coverage V3 metadataHan detail: " +
          hanRouteMetadataDetailSegments
            .map((row) => row.segment + " " + this.formatBytes(row.bytes))
            .join(" | "),
      "Coverage V3 hanBigramPosting detail: " +
        hanRouteBodyDetailSegments
          .map((row) => row.segment + " " + this.formatBytes(row.bytes))
          .join(" | "),
		"Coverage V3 shard readiness: familyLexiconUsesShardLocalFamilySlots " +
		String(shardReadiness.familyLexiconIdentitySlots) +
		" | familyPostingTerms shardLocalFamilySlot" +
		" | duplicatedLiveDocLanes " +
		this.formatBytes(shardReadiness.docTableDuplicatedLiveSlotBytes),
      "Coverage V3 hanBigram readiness: terms " +
        shardReadiness.hanBigramPosting.termCount +
        " | values " +
        shardReadiness.hanBigramPosting.valueCount +
        " | buckets singleton/pair/small/delta " +
        shardReadiness.hanBigramPosting.singletonCount +
        "/" +
        shardReadiness.hanBigramPosting.pairCount +
        "/" +
        shardReadiness.hanBigramPosting.smallCount +
        "/" +
        shardReadiness.hanBigramPosting.deltaCount +
        " | maxTerm " +
        shardReadiness.hanBigramPosting.maxTermId +
        " | maxValue " +
        shardReadiness.hanBigramPosting.maxValueId +
        " | laneWidth term " +
        shardReadiness.hanBigramPosting.termLaneWidth +
        " value " +
        shardReadiness.hanBigramPosting.valueLaneWidth,
      "Coverage V3 hanBigram term gaps: raw " +
        this.formatBytes(shardReadiness.hanBigramPosting.termGapCompression.rawBytes) +
        " | estimated " +
        this.formatBytes(shardReadiness.hanBigramPosting.termGapCompression.estimatedBytes) +
        " | savings " +
        this.formatBytes(
          shardReadiness.hanBigramPosting.termGapCompression.estimatedSavingsBytes,
        ) +
        " | p95Gap " +
        shardReadiness.hanBigramPosting.termGapCompression.p95Gap +
        " | maxGap " +
        shardReadiness.hanBigramPosting.termGapCompression.maxGap +
        " | gapWidth u8/u16/u32 " +
        shardReadiness.hanBigramPosting.termGapCompression.u8Count +
        "/" +
        shardReadiness.hanBigramPosting.termGapCompression.u16Count +
        "/" +
        shardReadiness.hanBigramPosting.termGapCompression.u32Count,
      "Coverage V3 familyPosting readiness: terms " +
        shardReadiness.familyPosting.termCount +
        " | values " +
        shardReadiness.familyPosting.valueCount +
        " | buckets singleton/pair/small/delta " +
        shardReadiness.familyPosting.singletonCount +
        "/" +
        shardReadiness.familyPosting.pairCount +
        "/" +
        shardReadiness.familyPosting.smallCount +
        "/" +
        shardReadiness.familyPosting.deltaCount +
        " | maxTerm " +
        shardReadiness.familyPosting.maxTermId +
        " | maxValue " +
        shardReadiness.familyPosting.maxValueId +
        " | laneWidth term " +
        shardReadiness.familyPosting.termLaneWidth +
        " value " +
        shardReadiness.familyPosting.valueLaneWidth,
      "Coverage V3 stringArena text detail: " +
        stringArenaDetailSegments
          .map((row) => row.segment + " " + this.formatBytes(row.bytes))
          .join(" | "),
      "Coverage V3 resident payload split: scaffold " +
        this.formatBytes(metrics.scaffoldBytes) +
        " | counts " +
        this.formatBytes(metrics.countBytes) +
        " | ids " +
        this.formatBytes(metrics.idPayloadBytes) +
        " | strings " +
        this.formatBytes(metrics.stringPayloadBytes),
    ].filter((line) => !line.endsWith(": "));

    return {
      noticeLines,
      summaryLine: noticeLines.join("; "),
      residentGroupRows,
      coldOwnedGroupRows: [],
      overlapRows: [],
      residentTopRows,
      coldOverlapTopRows: [],
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
    if (estimate.cacheSlotCount > 0 || estimate.fileCount > 0) {
      noticeLines.push(
        "Current text cache slots: live " +
          estimate.fileCount +
          " | total " +
          estimate.cacheSlotCount +
          " | free " +
          estimate.freeCacheSlotCount,
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
  sampleJsHeapUsage(): JsHeapUsageSample | null {
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

  summarizeLexicalHeapDelta(
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

function formatBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return "n/a";
  }
  if (Math.abs(bytes) < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (Math.abs(bytes) < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
