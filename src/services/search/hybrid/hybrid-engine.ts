import { OuterSetting } from "src/globals/plugin-setting";
import { EngineType, FileItem, FileSubItem } from "src/globals/search-types";
import type { LocaleKey } from "src/services/obsidian/translations/locale-helper";
import { Database } from "src/services/database/database";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import {
  buildLineOffsets,
  buildRawChunkFromOffsets,
  chunkFile,
  chunkFileRange,
  createChunkContextBuilderFromOutline,
  createChunkEmbeddingInputBuilder,
} from "./chunker";
import { BM25Engine, type BM25RuntimeMemoryBreakdown } from "./bm25";
import {
  Embedder,
  estimateTextsTokenUsage,
  recordEstimatedTokenSavings,
} from "./embedder";
import { HnswIndex } from "./hnsw";
import {
  computeUnchangedOffsetBlocks,
  hashStableText,
} from "./incremental-reuse";
import {
  blobToBm25,
  blobToHnsw,
  ChunkVectorShardBuilder,
  bm25ToBlob,
  chunkVectorShardToRow,
  type HybridFileSnapshotRow,
  type HybridIndexedFileRef,
  type ChunkRow,
  type ChunkVectorShardRow,
  chunkToRow,
  getBm25BlobVersion,
  hnswToBlob,
  rowToChunk,
  rowToChunkVectorRecords,
} from "./hybrid-store";
import type {
  Chunk,
  HeadingOutlineEntry,
  RawChunk,
  StoredVector,
  VectorPrecision,
} from "./hybrid-types";
import {
  buildHybridQueryProfile,
  getHybridBm25ProbeLimit,
  resolveHybridRecallBudget,
  type RankedResult,
} from "./ranking";
import { runHybridLexicalLaneSearch } from "./lexical-lane";
import {
  HybridRerankError,
  HybridReranker,
  SEARCH_EMBED_TOKEN_KEY,
  type RerankCandidate,
} from "./reranker";
import { EMBED_DIM } from "./hybrid-types";
import {
  profileHybridStage,
  recordHybridProfileMetric,
} from "./hybrid-profiler";
import { analyzeHybridStoredFileConsistency } from "./hybrid-consistency";
import { FileSnapshotStore } from "../shared/file-snapshot-store";

const SEARCH_EF = 80;
const HYBRID_BM25_USE_PROXIMITY = false;
const HYBRID_BM25_ENABLE_QUERY_EXPANSION = true;
const DEFAULT_MAX_FILE_RESULTS = 10;
const MIN_FILE_RESULTS = 1;
const MAX_FILE_RESULTS = 50;
const INDEX_CHUNK_BATCH_SIZE = 24;
const HNSW_HYDRATE_SHARD_BATCH_SIZE = 8;
const HYBRID_DIRTY_ARTIFACTS = ["bm25", "hnsw"] as const;

type HybridArtifactName = (typeof HYBRID_DIRTY_ARTIFACTS)[number];

type HybridWriteOption = {
  persistIndices?: boolean;
  deleteIndexedFileRef?: boolean;
  deleteIndexedShadow?: boolean;
};

type HybridIndexMode = "full" | "without-embedding";

type Bm25OnlyIndexedFileRefMeta = {
  lastIncrementalEmbedAt?: number;
};

type SmallChunkCandidate = {
  id: number;
  filePath: string;
  text: string;
  rerankText: string;
  row: number;
  col: number;
  score: number;
};

type StoredFileIndexState = {
  snapshot?: HybridFileSnapshotRow;
  chunkRows: ChunkRow[];
  vectorsByChunkId: Map<number, StoredVector>;
  vectorGeneration?: number;
  vectorChunkCount?: number;
  vectorPrecision?: VectorPrecision | null;
};

type PlannedChunk = {
  rawChunk: RawChunk;
  embedKey: string;
  reusedVector?: StoredVector;
};

export type HybridRuntimeMemoryEstimate = {
  vectorsBytes: number;
  graphBytes: number;
  bm25Bytes: number;
  bm25Breakdown: BM25RuntimeMemoryBreakdown;
  totalBytes: number;
};

export class HybridEngine {
  private readonly db = getInstance(Database);
  private readonly setting = getInstance(OuterSetting);
  private readonly dataProvider = getInstance(DataProvider);
  private readonly embedder = new Embedder();
  private readonly reranker = new HybridReranker();
  private readonly bm25 = new BM25Engine();
  private readonly hnswSmall = new HnswIndex();
  private readonly fileSnapshotStore = getInstance(FileSnapshotStore);

  private _ready = false;
  private _canSearch = false;
  private lastIndexingFallbackNoticeKey: LocaleKey | null = null;
  private lastSearchFallbackNoticeKey: LocaleKey | null = null;
  private readonly fileWriteLocks = new Map<string, Promise<void>>();
  private readonly dirtyArtifacts = new Set<HybridArtifactName>();

  private get precision(): VectorPrecision {
    return this.setting.hybrid.vectorCompression === "float16"
      ? "float16"
      : "int8";
  }

  private get defaultResultCount(): number {
    const configured = this.setting.hybrid.maxResultCount;
    if (!Number.isFinite(configured)) {
      return DEFAULT_MAX_FILE_RESULTS;
    }
    return Math.min(
      MAX_FILE_RESULTS,
      Math.max(MIN_FILE_RESULTS, Math.round(configured)),
    );
  }

  async load(): Promise<void> {
    const dirtyArtifacts = await this.hydrateDirtyArtifacts();
    await Promise.all([
      profileHybridStage(
        "startup.load_bm25",
        async () => await this.loadBm25(dirtyArtifacts.has("bm25")),
      ),
      profileHybridStage(
        "startup.load_hnsw",
        async () => await this.loadHnsw(dirtyArtifacts.has("hnsw")),
      ),
    ]);
    this._ready = true;
  }

  async clearAll(): Promise<void> {
    this.bm25.clear();
    this.hnswSmall.clear(this.precision);
    this._ready = false;
    this._canSearch = false;
    this.lastIndexingFallbackNoticeKey = null;
    this.lastSearchFallbackNoticeKey = null;
    this.dirtyArtifacts.clear();

    await Promise.all([
      this.db.db.hybridChunks.clear(),
      this.db.db.hybridChunkVectors.clear(),
      this.db.db.hybridDirtyShadows.clear(),
      this.db.db.hybridBm25Index.clear(),
      this.db.db.hybridHnswSmall.clear(),
      this.db.db.hybridIndexedFileRefs.clear(),
      this.db.db.indexArtifactState.bulkDelete(
        HYBRID_DIRTY_ARTIFACTS.map((artifact) =>
          buildIndexArtifactStateId("hybrid", artifact),
        ),
      ),
    ]);
  }

  isEnabled(): boolean {
    return this.setting.hybrid.enabled;
  }

  isReady(): boolean {
    return this._ready;
  }
  canSearch(): boolean {
    return this._canSearch;
  }
  canServeQuery(): boolean {
    // Hybrid should still answer through BM25 when dense vectors are unavailable.
    return this._ready && (!this.isEmpty() || this._canSearch);
  }
  isEmpty(): boolean {
    return this.bm25.docCount === 0;
  }

  getRuntimeMemoryEstimate(): HybridRuntimeMemoryEstimate {
    const hnswEstimate = this.hnswSmall.estimateRuntimeMemoryBytes();
    const bm25Breakdown = this.bm25.estimateRuntimeMemoryBreakdown();
    const bm25Bytes = bm25Breakdown.totalBytes;
    return {
      vectorsBytes: hnswEstimate.vectorBytes,
      graphBytes: hnswEstimate.graphBytes,
      bm25Bytes,
      bm25Breakdown,
      totalBytes: hnswEstimate.totalBytes + bm25Bytes,
    };
  }

  consumeIndexingFallbackNoticeKey(): LocaleKey | null {
    const key = this.lastIndexingFallbackNoticeKey;
    this.lastIndexingFallbackNoticeKey = null;
    return key;
  }

  consumeSearchFallbackNoticeKey(): LocaleKey | null {
    const key = this.lastSearchFallbackNoticeKey;
    this.lastSearchFallbackNoticeKey = null;
    return key;
  }

  shouldIndexPath(filePath: string): boolean {
    if (!this.isEnabled()) return false;
    return !this.isExcludedPath(filePath);
  }

  async indexFile(
    filePath: string,
    plainText: string,
    generation = Date.now(),
    headingOutline: HeadingOutlineEntry[] = [],
  ): Promise<void> {
    await this.indexInternal(
      filePath,
      plainText,
      generation,
      {},
      false,
      headingOutline,
    );
  }

  async indexFileStrict(
    filePath: string,
    plainText: string,
    generation = Date.now(),
    option: HybridWriteOption = {},
    headingOutline: HeadingOutlineEntry[] = [],
  ): Promise<void> {
    await this.indexInternal(
      filePath,
      plainText,
      generation,
      option,
      true,
      headingOutline,
      "full",
    );
  }

  async indexFileWithoutEmbedding(
    filePath: string,
    plainText: string,
    generation = Date.now(),
    option: HybridWriteOption = {},
    headingOutline: HeadingOutlineEntry[] = [],
  ): Promise<void> {
    await this.indexInternal(
      filePath,
      plainText,
      generation,
      option,
      false,
      headingOutline,
      "without-embedding",
    );
  }

  async deleteFile(
    filePath: string,
    option: HybridWriteOption = {},
  ): Promise<void> {
    await this.withFileWriteLock(filePath, async () => {
      await this.deleteStoredHybridPrivateData(filePath, option);
    });
  }

  async moveFile(
    oldPath: string,
    newPath: string,
    generation = Date.now(),
  ): Promise<boolean> {
    if (oldPath === newPath) {
      return false;
    }

    return await this.withFileWriteLocks([oldPath, newPath], async () => {
      const chunkRows = await this.db.db.hybridChunks
        .where("filePath")
        .equals(oldPath)
        .toArray();
      const vectorRow = await this.db.db.hybridChunkVectors.get(oldPath);
      const indexedFileRef =
        await this.db.db.hybridIndexedFileRefs.get(oldPath);
      const hasStoredData =
        chunkRows.length > 0 ||
        vectorRow !== undefined ||
        indexedFileRef !== undefined;
      if (!hasStoredData) {
        return false;
      }

      const hasTargetData =
        (await this.db.db.hybridChunks
          .where("filePath")
          .equals(newPath)
          .count()) > 0 ||
        (await this.db.db.hybridChunkVectors.get(newPath)) !== undefined ||
        (await this.db.db.hybridIndexedFileRefs.get(newPath)) !== undefined;
      if (hasTargetData) {
        await this.deleteStoredHybridPrivateData(newPath, {
          persistIndices: false,
        });
      }

      if (chunkRows.length > 0) {
        await this.db.db.hybridChunks.bulkPut(
          chunkRows.map((row) => ({
            ...row,
            filePath: newPath,
          })),
        );
      }

      if (vectorRow) {
        await this.db.db.hybridChunkVectors.put({
          ...vectorRow,
          filePath: newPath,
        });
        await this.db.db.hybridChunkVectors.delete(oldPath);
      }

      if (indexedFileRef) {
        // Path-only move keeps the same semantic payload and generation.
        await this.putHybridIndexedFileRef({
          ...indexedFileRef,
          path: newPath,
          generation,
        });
        await this.db.db.hybridIndexedFileRefs.delete(oldPath);
      }

      await this.fileSnapshotStore.deleteIndexedShadow(oldPath);
      await this.fileSnapshotStore.deleteIndexedShadow(newPath);
      return true;
    });
  }

  private async deleteStoredHybridPrivateData(
    filePath: string,
    option: HybridWriteOption = {},
  ): Promise<void> {
    // Shared fileSnapshots are owned by the lexical/file-snapshot layer.
    const rows = await this.db.db.hybridChunks
      .where("filePath")
      .equals(filePath)
      .toArray();
    const ids = rows.map((row) => row.id!).filter((id) => id !== undefined);

    if (ids.length > 0) {
      await this.markHybridArtifactsDirty("runtime-delete-write");
    }

    await this.db.db.hybridChunks.bulkDelete(ids);
    await this.db.db.hybridChunkVectors.delete(filePath);
    if (option.deleteIndexedFileRef ?? true) {
      await this.db.db.hybridIndexedFileRefs.delete(filePath);
    }
    if (option.deleteIndexedShadow ?? true) {
      await this.fileSnapshotStore.deleteIndexedShadow(filePath);
    }

    for (const id of ids) {
      this.bm25.removeDocument(id);
      this.hnswSmall.delete(id);
    }

    if (this.hnswSmall.needsRebuild()) {
      this.hnswSmall.rebuild();
    }
    if ((option.persistIndices ?? true) && ids.length > 0) {
      await this.persistIndices();
    }
  }

  async search(
    query: string,
    topK = this.defaultResultCount,
  ): Promise<FileItem[]> {
    if (!this.isEnabled() || !this._ready || !query.trim()) return [];
    let fallbackNoticeKey: LocaleKey | null = this._canSearch
      ? null
      : "hybridNotice.searchFallbackToBm25";

    const bm25Probe = this.bm25
      .search(query, getHybridBm25ProbeLimit(), {
        useProximity: HYBRID_BM25_USE_PROXIMITY,
        enableQueryExpansion: HYBRID_BM25_ENABLE_QUERY_EXPANSION,
      })
      .map((result) => ({
        id: result.docId,
        score: result.score,
      }));
    const queryProfile = buildHybridQueryProfile();
    const recallBudget = resolveHybridRecallBudget();
    const bm25Small = bm25Probe.slice(0, recallBudget.bm25RecallLimit);
    const denseSearchEf = Math.max(SEARCH_EF, queryProfile.searchEf);

    let denseSmall: RankedResult[] = [];
    try {
      if (this._canSearch) {
        const embedded = await this.embedder.embedQuery(
          query,
          this.precision,
          SEARCH_EMBED_TOKEN_KEY,
        );
        denseSmall = this.hnswSmall
          .search(embedded, recallBudget.denseRecallLimit, denseSearchEf)
          .map((result) => ({ id: result.id, score: result.score }));
      }
    } catch (error) {
      logger.warn(
        "hybrid query embedding failed; rerank will use BM25-only chunks.",
        error,
      );
      fallbackNoticeKey = "hybridNotice.searchFallbackToBm25";
    }

    const smallCandidates = await this.loadDedupedSmallChunkCandidates([
      bm25Small,
      denseSmall,
    ]);
    const bm25CandidateIds = new Set(bm25Small.map((item) => item.id));
    const bm25FallbackCandidates = smallCandidates.filter((candidate) =>
      bm25CandidateIds.has(candidate.id),
    );
    if (smallCandidates.length === 0) {
      this.lastSearchFallbackNoticeKey = fallbackNoticeKey;
      return [];
    }

    try {
      const items = await this.rerankAndBuildFileItems(
        query,
        smallCandidates,
        topK,
      );
      this.lastSearchFallbackNoticeKey = fallbackNoticeKey;
      return items;
    } catch (error) {
      const fallbackCandidates = bm25FallbackCandidates;
      if (error instanceof HybridRerankError) {
        logger.warn(
          "hybrid rerank failed; falling back to BM25 ordering.",
          error,
        );
        this.lastSearchFallbackNoticeKey =
          "hybridNotice.searchRerankFallbackToBm25";
        return this.buildFileItemsFromSmallChunks(
          query,
          fallbackCandidates,
          topK,
        );
      }
      logger.warn(
        "hybrid search candidate ordering failed; falling back to BM25 ordering.",
        error,
      );
      this.lastSearchFallbackNoticeKey =
        fallbackNoticeKey ?? "hybridNotice.searchFallbackToBm25";
      return this.buildFileItemsFromSmallChunks(
        query,
        fallbackCandidates,
        topK,
      );
    }
  }

  async searchWithLexicalLane(
    query: string,
    topK = this.defaultResultCount,
  ): Promise<FileItem[]> {
    if (!this.isEnabled() || !this._ready || !query.trim()) {
      return [];
    }
    return await runHybridLexicalLaneSearch({
      queryText: query,
      displayTopK: topK,
      rerankTopK: Math.max(topK * 2, topK),
    });
  }

  async persistIndicesForBatch(): Promise<void> {
    await this.persistIndices();
  }

  async rebuildBm25FromStore(): Promise<void> {
    await this.rebuildBm25ArtifactFromStore();
  }

  async migrateBm25StorageFormatIfNeeded(): Promise<boolean> {
    const record = await this.db.db.hybridBm25Index.get(0);
    if (!record) {
      return false;
    }
    const blobVersion = await getBm25BlobVersion(record.data);
    if (blobVersion === 5) {
      return false;
    }

    const migrated = new BM25Engine();
    migrated.deserialize(await blobToBm25(record.data));
    await this.db.db.hybridBm25Index.put({
      id: 0,
      data: bm25ToBlob(migrated.serialize()),
    });
    return true;
  }

  private async indexInternal(
    filePath: string,
    plainText: string,
    generation: number,
    option: HybridWriteOption,
    strict: boolean,
    headingOutline: HeadingOutlineEntry[],
    mode: HybridIndexMode = "full",
  ): Promise<void> {
    await this.withFileWriteLock(filePath, async () => {
      if (!this.shouldIndexPath(filePath)) {
        await this.deleteStoredHybridPrivateData(filePath, option);
        return;
      }

      const pendingIndexedAt = Date.now();
      const previousIndexedFileRef =
        await this.db.db.hybridIndexedFileRefs.get(filePath);
      const previousState = await this.loadStoredFileIndexState(
        filePath,
        previousIndexedFileRef,
      );
      await this.markHybridArtifactsDirty("runtime-index-write");
      const reusableState = this.getReusableStoredFileIndexState(
        filePath,
        previousState,
        previousIndexedFileRef,
      );
      await this.putHybridIndexedFileRef({
        path: filePath,
        state: "pending",
        generation,
        chunkCount: 0,
        vectorPrecision: null,
        indexedAt: pendingIndexedAt,
        lastIncrementalEmbedAt: previousIndexedFileRef?.lastIncrementalEmbedAt,
      });
      await this.deleteStoredHybridPrivateData(filePath, {
        ...option,
        deleteIndexedFileRef: false,
        deleteIndexedShadow: false,
      });

      const { chunks: rawChunks } = await profileHybridStage(
        "index.chunk_file",
        async () => chunkFile(filePath, plainText),
      );
      const buildEmbedInput = await profileHybridStage(
        "index.build_embed_context",
        async () =>
          createChunkEmbeddingInputBuilder(filePath, plainText, headingOutline),
      );
      const lineOffsets = buildLineOffsets(plainText);
      const plannedChunks = await profileHybridStage(
        "index.plan_incremental_reuse",
        async () =>
          await this.planIncrementalChunks(
            filePath,
            plainText,
            lineOffsets,
            buildEmbedInput,
            rawChunks,
            reusableState,
          ),
      );
      if (plannedChunks.length === 0) {
        await this.db.db.hybridIndexedFileRefs.delete(filePath);
        await this.fileSnapshotStore.deleteIndexedShadow(filePath);
        if (option.persistIndices ?? true) {
          await this.persistIndices();
        }
        return;
      }
      recordHybridProfileMetric("index.chunk_count", plannedChunks.length);

      if (mode === "without-embedding") {
        await this.indexBm25Only(filePath, plannedChunks, generation, option, {
          lastIncrementalEmbedAt:
            previousIndexedFileRef?.lastIncrementalEmbedAt,
        });
        await this.persistSnapshot(filePath, plainText, generation);
        return;
      }

      try {
        const shardBuilder = new ChunkVectorShardBuilder(
          this.precision,
          EMBED_DIM,
        );
        for (
          let chunkStart = 0;
          chunkStart < plannedChunks.length;
          chunkStart += INDEX_CHUNK_BATCH_SIZE
        ) {
          const batchChunks = plannedChunks.slice(
            chunkStart,
            chunkStart + INDEX_CHUNK_BATCH_SIZE,
          );
          const batchVectors = await this.resolveBatchVectors(
            filePath,
            batchChunks,
            buildEmbedInput,
          );
          const batchChunkIds = await profileHybridStage(
            "index.persist_chunks",
            async () =>
              await this.persistChunks(
                filePath,
                batchChunks,
                strict,
                chunkStart,
              ),
          );
          shardBuilder.append(batchChunkIds, batchVectors);
          await profileHybridStage("index.update_memory_indices", async () => {
            for (let i = 0; i < batchChunkIds.length; i++) {
              const chunkId = batchChunkIds[i];
              this.bm25.addDocument(chunkId, batchChunks[i].rawChunk.text);
              this.hnswSmall.insert(chunkId, batchVectors[i]);
            }
          });
        }
        await profileHybridStage("index.persist_vector_shard", async () => {
          await this.persistVectorShard({
            ...shardBuilder.build(filePath),
            generation,
          });
        });
        await this.persistSnapshot(filePath, plainText, generation);
        this._canSearch = true;
        this.lastIndexingFallbackNoticeKey = null;
      } catch (error) {
        await this.deleteStoredHybridPrivateData(filePath, {
          persistIndices: false,
          deleteIndexedFileRef: false,
          deleteIndexedShadow: false,
        });
        logger.warn(`hybrid indexing fell back to BM25 for ${filePath}`, error);
        this._canSearch = false;
        this.lastIndexingFallbackNoticeKey = "hybridNotice.indexFallbackToBm25";
        try {
          await this.indexBm25Only(filePath, plannedChunks, generation, option);
          await this.persistSnapshot(filePath, plainText, generation);
          const fallbackIndexedAt = Date.now();
          await this.putHybridIndexedFileRef({
            path: filePath,
            state: "bm25_only",
            generation,
            chunkCount: plannedChunks.length,
            vectorPrecision: null,
            indexedAt: fallbackIndexedAt,
            lastIncrementalEmbedAt:
              previousIndexedFileRef?.lastIncrementalEmbedAt,
          });
          return;
        } catch (fallbackError) {
          const failedIndexedAt = Date.now();
          await this.putHybridIndexedFileRef({
            path: filePath,
            state: "failed",
            generation,
            chunkCount: 0,
            vectorPrecision: null,
            indexedAt: failedIndexedAt,
            lastIncrementalEmbedAt:
              previousIndexedFileRef?.lastIncrementalEmbedAt,
          });
          await this.fileSnapshotStore.deleteIndexedShadow(filePath);
          throw fallbackError;
        }
      }

      const indexedAt = Date.now();
      if (option.persistIndices ?? true) {
        await this.persistIndices();
      }
      await this.putHybridIndexedFileRef({
        path: filePath,
        state: "ready",
        generation,
        chunkCount: plannedChunks.length,
        vectorPrecision: this.precision,
        indexedAt,
        lastIncrementalEmbedAt: indexedAt,
      });
    });
  }

  private async loadStoredFileIndexState(
    filePath: string,
    indexedFileRef?: HybridIndexedFileRef,
  ): Promise<StoredFileIndexState> {
    const [snapshotText, chunkRows, vectorRow] = await Promise.all([
      this.fileSnapshotStore.readGenerationAlignedText(
        filePath,
        indexedFileRef?.generation,
      ),
      this.db.db.hybridChunks
        .where("filePath")
        .equals(filePath)
        .sortBy("chunkIndex"),
      this.db.db.hybridChunkVectors.get(filePath),
    ]);
    const snapshot =
      snapshotText === undefined
        ? undefined
        : {
            filePath,
            plainText: snapshotText,
            generation: indexedFileRef?.generation,
          };
    const vectorsByChunkId = new Map<number, StoredVector>();
    if (vectorRow && vectorRow.precision === this.precision) {
      for (const record of await rowToChunkVectorRecords(vectorRow)) {
        vectorsByChunkId.set(record.id, record.vector);
      }
    }
    return {
      snapshot,
      chunkRows,
      vectorsByChunkId,
      vectorGeneration: vectorRow?.generation,
      vectorChunkCount: vectorRow?.chunkCount,
      vectorPrecision:
        vectorRow?.precision === this.precision ? this.precision : null,
    };
  }

  private getReusableStoredFileIndexState(
    filePath: string,
    previousState: StoredFileIndexState,
    previousIndexedFileRef: HybridIndexedFileRef | undefined,
  ): StoredFileIndexState {
    const consistency = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: previousState.chunkRows.length > 0,
      chunkCount: previousState.chunkRows.length,
      snapshot: previousState.snapshot
        ? { generation: previousState.snapshot.generation }
        : undefined,
      vectorInfo:
        previousState.vectorChunkCount !== undefined &&
        previousState.vectorPrecision !== null &&
        previousState.vectorPrecision !== undefined
          ? {
              precision: previousState.vectorPrecision,
              chunkCount: previousState.vectorChunkCount,
              generation: previousState.vectorGeneration,
            }
          : undefined,
      indexedFileRef: previousIndexedFileRef,
      currentPrecision: this.precision,
    });
    const inconsistencyReasons = consistency.reuseBlockedReasons;

    if (inconsistencyReasons.length === 0) {
      return previousState;
    }

    logger.debug(
      `hybrid incremental reuse ignored inconsistent local state for ${filePath}: ${inconsistencyReasons.join(", ")}`,
    );
    return {
      snapshot: undefined,
      chunkRows: [],
      vectorsByChunkId: new Map<number, StoredVector>(),
      vectorGeneration: undefined,
      vectorChunkCount: undefined,
      vectorPrecision: null,
    };
  }

  private async persistSnapshot(
    filePath: string,
    plainText: string,
    generation: number,
  ): Promise<void> {
    await this.fileSnapshotStore.persistIndexedSnapshot(
      filePath,
      plainText,
      generation,
      { clearShadowIfAligned: true },
    );
  }

  private async planIncrementalChunks(
    filePath: string,
    plainText: string,
    lineOffsets: number[],
    buildEmbedInput: (chunk: RawChunk) => string,
    fullChunks: RawChunk[],
    previousState: StoredFileIndexState,
  ): Promise<PlannedChunk[]> {
    const basePlan = (chunks: RawChunk[]): PlannedChunk[] =>
      chunks.map((rawChunk) => {
        const embedKey = hashStableText(buildEmbedInput(rawChunk));
        return {
          rawChunk,
          embedKey,
        };
      });

    if (!previousState.snapshot || previousState.chunkRows.length === 0) {
      return basePlan(fullChunks);
    }

    const oldText = previousState.snapshot.plainText;
    const unchangedBlocks = computeUnchangedOffsetBlocks(oldText, plainText);
    if (unchangedBlocks.length === 0) {
      return basePlan(fullChunks);
    }

    const reusedPlans = unchangedBlocks
      .flatMap((block) =>
        previousState.chunkRows
          .filter(
            (row) =>
              row.startOffset >= block.oldStartOffset &&
              row.endOffset <= block.oldEndOffset,
          )
          .map((row) =>
            this.reuseStoredChunk(
              row,
              plainText,
              lineOffsets,
              buildEmbedInput,
              previousState.vectorsByChunkId,
              block.newStartOffset + (row.startOffset - block.oldStartOffset),
              block.newStartOffset + (row.endOffset - block.oldStartOffset),
            ),
          )
          .filter((chunk): chunk is PlannedChunk => chunk !== null),
      )
      .sort(
        (left, right) => left.rawChunk.startOffset - right.rawChunk.startOffset,
      );

    if (reusedPlans.length === 0) {
      return basePlan(fullChunks);
    }

    const plannedChunks: PlannedChunk[] = [];
    let cursor = 0;
    for (const chunk of reusedPlans) {
      if (cursor < chunk.rawChunk.startOffset) {
        plannedChunks.push(
          ...basePlan(
            chunkFileRange(
              filePath,
              plainText,
              cursor,
              chunk.rawChunk.startOffset,
              lineOffsets,
            ),
          ),
        );
      }
      plannedChunks.push(chunk);
      cursor = Math.max(cursor, chunk.rawChunk.endOffset);
    }
    if (cursor < plainText.length) {
      plannedChunks.push(
        ...basePlan(
          chunkFileRange(
            filePath,
            plainText,
            cursor,
            plainText.length,
            lineOffsets,
          ),
        ),
      );
    }

    return plannedChunks
      .filter((chunk) => chunk.rawChunk.text.trim().length > 0)
      .sort(
        (left, right) => left.rawChunk.startOffset - right.rawChunk.startOffset,
      );
  }

  private reuseStoredChunk(
    row: ChunkRow,
    plainText: string,
    lineOffsets: number[],
    buildEmbedInput: (chunk: RawChunk) => string,
    vectorsByChunkId: Map<number, StoredVector>,
    startOffset: number,
    endOffset: number,
  ): PlannedChunk | null {
    const rawChunk = buildRawChunkFromOffsets(
      row.filePath,
      plainText,
      lineOffsets,
      startOffset,
      endOffset,
    );
    if (!rawChunk) {
      return null;
    }

    const embedKey = hashStableText(buildEmbedInput(rawChunk));
    return {
      rawChunk,
      embedKey,
      reusedVector:
        row.embedKey === embedKey && row.id !== undefined
          ? vectorsByChunkId.get(row.id)
          : undefined,
    };
  }

  private async resolveBatchVectors(
    filePath: string,
    batchChunks: PlannedChunk[],
    buildEmbedInput: (chunk: RawChunk) => string,
  ): Promise<StoredVector[]> {
    const vectors: Array<StoredVector | undefined> = new Array(
      batchChunks.length,
    );
    const pendingIndexes: number[] = [];
    const pendingInputs: string[] = [];
    const fullInputs = new Array<string>(batchChunks.length);

    for (let i = 0; i < batchChunks.length; i++) {
      const input = buildEmbedInput(batchChunks[i].rawChunk);
      fullInputs[i] = input;
      const reusedVector = batchChunks[i].reusedVector;
      if (reusedVector) {
        vectors[i] = reusedVector;
        continue;
      }
      pendingIndexes.push(i);
      pendingInputs.push(input);
    }

    if (pendingInputs.length > 0) {
      const embedded = await profileHybridStage(
        "index.embed_batch",
        async () =>
          await this.embedder.embedBatch(
            pendingInputs,
            this.precision,
            filePath,
          ),
      );
      if (embedded.length !== pendingInputs.length) {
        throw new Error(
          `Hybrid embed batch size mismatch for ${filePath}: expected ${pendingInputs.length}, received ${embedded.length}`,
        );
      }
      for (let i = 0; i < pendingIndexes.length; i++) {
        const vector = embedded[i];
        if (vector === undefined) {
          throw new Error(
            `Hybrid embed batch returned an empty vector slot for ${filePath} at batch index ${i}`,
          );
        }
        vectors[pendingIndexes[i]] = vector;
      }
    }

    const savedEstimatedTokens = Math.max(
      0,
      estimateTextsTokenUsage(fullInputs) -
        estimateTextsTokenUsage(pendingInputs),
    );
    if (savedEstimatedTokens > 0) {
      await recordEstimatedTokenSavings(savedEstimatedTokens);
    }

    for (let i = 0; i < vectors.length; i++) {
      if (vectors[i] === undefined) {
        throw new Error(
          `Hybrid vector resolution left a gap for ${filePath} at chunk index ${i}`,
        );
      }
    }

    return vectors as StoredVector[];
  }

  private async persistChunks(
    filePath: string,
    plannedChunks: PlannedChunk[],
    strict: boolean,
    chunkIndexOffset = 0,
  ): Promise<number[]> {
    const rows = plannedChunks.map((chunk, index) => {
      return chunkToRow({
        id: undefined,
        filePath,
        chunkIndex: chunkIndexOffset + index,
        text: chunk.rawChunk.text,
        startOffset: chunk.rawChunk.startOffset,
        endOffset: chunk.rawChunk.endOffset,
        startLine: chunk.rawChunk.startLine,
        startCol: chunk.rawChunk.startCol,
        endLine: chunk.rawChunk.endLine,
        embedKey: chunk.embedKey,
      });
    });

    if (!strict) {
      const ids: number[] = [];
      for (const row of rows) {
        const id = await this.db.db.hybridChunks.add(row);
        ids.push(id as number);
      }
      return ids;
    }

    return await (
      this.db.db.hybridChunks as unknown as {
        bulkAdd(rows: ChunkRow[], option: { allKeys: true }): Promise<number[]>;
      }
    ).bulkAdd(rows, { allKeys: true });
  }

  private async persistVectorShard(
    shard: ReturnType<ChunkVectorShardBuilder["build"]>,
  ): Promise<void> {
    await this.db.db.hybridChunkVectors.put(chunkVectorShardToRow(shard));
  }

  private async indexBm25Only(
    filePath: string,
    plannedChunks: PlannedChunk[],
    generation: number,
    option: HybridWriteOption,
    meta?: Bm25OnlyIndexedFileRefMeta,
  ): Promise<void> {
    for (
      let chunkStart = 0;
      chunkStart < plannedChunks.length;
      chunkStart += INDEX_CHUNK_BATCH_SIZE
    ) {
      const batchChunks = plannedChunks.slice(
        chunkStart,
        chunkStart + INDEX_CHUNK_BATCH_SIZE,
      );
      const ids = await profileHybridStage(
        "index.persist_chunks_bm25_only",
        async () =>
          await this.persistChunks(filePath, batchChunks, false, chunkStart),
      );
      await profileHybridStage(
        "index.update_memory_indices_bm25_only",
        async () => {
          for (let i = 0; i < ids.length; i++) {
            this.bm25.addDocument(ids[i], batchChunks[i].rawChunk.text);
          }
        },
      );
    }

    if (option.persistIndices ?? true) {
      await this.persistIndices();
    }
    await this.putHybridIndexedFileRef({
      path: filePath,
      state: "bm25_only",
      generation,
      chunkCount: plannedChunks.length,
      vectorPrecision: null,
      indexedAt: Date.now(),
      lastIncrementalEmbedAt: meta?.lastIncrementalEmbedAt,
    });
  }

  private async putHybridIndexedFileRef(
    ref: HybridIndexedFileRef,
  ): Promise<void> {
    await this.db.db.hybridIndexedFileRefs.put(ref);
  }


  private async withFileWriteLock<T>(
    filePath: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.fileWriteLocks.get(filePath);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.fileWriteLocks.set(filePath, current);
    await previous?.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.fileWriteLocks.get(filePath) === current) {
        this.fileWriteLocks.delete(filePath);
      }
    }
  }

  private async withFileWriteLocks<T>(
    filePaths: string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const orderedPaths = Array.from(new Set(filePaths)).sort((left, right) =>
      left.localeCompare(right),
    );

    const run = async (index: number): Promise<T> => {
      if (index >= orderedPaths.length) {
        return await work();
      }
      return await this.withFileWriteLock(
        orderedPaths[index],
        async () => await run(index + 1),
      );
    };

    return await run(0);
  }

  private async loadDedupedSmallChunkCandidates(
    rankings: RankedResult[][],
  ): Promise<SmallChunkCandidate[]> {
    const merged: RankedResult[] = [];
    const seenIds = new Set<number>();

    for (const ranking of rankings) {
      for (const item of ranking) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        merged.push(item);
      }
    }

    return this.loadSmallChunkCandidates(merged);
  }

  private async loadSmallChunkCandidates(
    ranking: RankedResult[],
  ): Promise<SmallChunkCandidate[]> {
    const rows = await this.db.db.hybridChunks.bulkGet(
      ranking.map((item) => item.id),
    );
    const snapshotByPath = await this.loadSnapshotTextByPaths(
      rows
        .filter((row): row is ChunkRow => row !== undefined)
        .map((row) => row.filePath),
    );
    const contextBuilderByPath =
      this.buildRerankContextBuilderByPath(snapshotByPath);
    const chunksById = new Map<number, Chunk>();
    for (const row of rows) {
      if (!row?.id) continue;
      const plainText = snapshotByPath.get(row.filePath);
      if (!plainText) continue;
      chunksById.set(row.id, rowToChunk(row, plainText));
    }

    return ranking
      .map((item) => {
        const chunk = chunksById.get(item.id);
        if (!chunk) return null;
        const buildContext = contextBuilderByPath.get(chunk.filePath);
        const context = buildContext?.(chunk.startLine) ?? "";
        return {
          id: chunk.id,
          filePath: chunk.filePath,
          text: chunk.text,
          rerankText: context ? `${context}\n\n${chunk.text}` : chunk.text,
          row: chunk.startLine,
          col: chunk.startCol,
          score: item.score,
        } as SmallChunkCandidate;
      })
      .filter((item): item is SmallChunkCandidate => item !== null);
  }

  private async loadSnapshotTextByPaths(
    filePaths: string[],
  ): Promise<Map<string, string>> {
    const uniquePaths = Array.from(new Set(filePaths));
    if (uniquePaths.length === 0) {
      return new Map<string, string>();
    }

    const indexedRefs = await this.db.db.hybridIndexedFileRefs.bulkGet(uniquePaths);
    const expectedGenerations = new Map<string, number | undefined>();
    const safePaths: string[] = [];

    for (let index = 0; index < uniquePaths.length; index++) {
      const indexedRef = indexedRefs[index];
      if (!indexedRef) {
        continue;
      }
      safePaths.push(uniquePaths[index]);
      expectedGenerations.set(uniquePaths[index], indexedRef.generation);
    }

    return await this.fileSnapshotStore.readGenerationAlignedTexts(
      safePaths,
      expectedGenerations,
    );
  }

  private async rerankAndBuildFileItems(
    query: string,
    smallCandidates: SmallChunkCandidate[],
    topK: number,
  ): Promise<FileItem[]> {
    const rerankResults = await this.reranker.rerank(
      query,
      smallCandidates.map(
        (candidate) =>
          ({
            id: candidate.id,
            filePath: candidate.filePath,
            text: candidate.rerankText,
            startLine: candidate.row,
            startCol: candidate.col,
            endLine: candidate.row,
            recallScore: candidate.score,
          }) as RerankCandidate,
      ),
      topK,
    );

    const rerankScoreById = new Map(
      rerankResults.map((item) => [item.id, item.score]),
    );
    const orderedSmallCandidates = smallCandidates
      .filter((candidate) => rerankScoreById.has(candidate.id))
      .map((candidate) => ({
        ...candidate,
        score: rerankScoreById.get(candidate.id) ?? candidate.score,
      }))
      .sort((a, b) => b.score - a.score);

    return this.buildFileItemsFromSmallChunks(
      query,
      orderedSmallCandidates,
      topK,
    );
  }

  private buildFileItemsFromSmallChunks(
    query: string,
    orderedSmallCandidates: SmallChunkCandidate[],
    topK: number,
  ): FileItem[] {
    const limitedCandidates = orderedSmallCandidates.slice(0, topK);
    const byFile = new Map<
      string,
      { filePath: string; subItems: FileSubItem[]; bestScore: number }
    >();

    for (const candidate of limitedCandidates) {
      const entry = byFile.get(candidate.filePath) ?? {
        filePath: candidate.filePath,
        subItems: [],
        bestScore: candidate.score,
      };
      entry.bestScore = Math.max(entry.bestScore, candidate.score);
      entry.subItems.push(
        new FileSubItem(
          candidate.text,
          candidate.row,
          candidate.col,
          candidate.score,
          candidate.text,
        ),
      );
      if (!byFile.has(candidate.filePath)) {
        byFile.set(candidate.filePath, entry);
      }
    }

    return Array.from(byFile.values())
      .sort((a, b) => b.bestScore - a.bestScore)
      .map(
        (entry) =>
          new FileItem(
            EngineType.SEMANTIC,
            entry.filePath,
            [query],
            [],
            entry.subItems,
            null,
          ),
      );
  }

  private async persistIndices(): Promise<void> {
    await Promise.all([this.persistBm25(), this.persistHnsw()]);
  }

  private async persistBm25(): Promise<void> {
    this.bm25.optimizeStorage();
    await this.db.db.hybridBm25Index.put({
      id: 0,
      data: bm25ToBlob(this.bm25.serialize()),
    });
    await this.clearHybridArtifactDirtyState(["bm25"]);
  }

  private async persistHnsw(): Promise<void> {
    if (this.hnswSmall.hasDeletedNodes()) {
      this.hnswSmall.rebuild();
    }
    await this.db.db.hybridHnswSmall.put({
      id: 0,
      data: hnswToBlob(this.hnswSmall.serialize()),
    });
    await this.clearHybridArtifactDirtyState(["hnsw"]);
  }

  private async loadBm25(forceRebuild = false): Promise<void> {
    this.bm25.clear();
    if (forceRebuild) {
      await this.rebuildBm25ArtifactFromStore();
      return;
    }

    const record = await this.db.db.hybridBm25Index.get(0);
    if (!record) {
      return;
    }

    const blobVersion = await getBm25BlobVersion(record.data);
    this.bm25.deserialize(await blobToBm25(record.data));
    if (blobVersion !== 5 || this.bm25.optimizeStorage()) {
      await this.persistBm25();
    }
  }

  private async loadHnsw(forceRebuild = false): Promise<void> {
    this.hnswSmall.clear(this.precision);
    if (forceRebuild) {
      await this.rebuildHnswFromStore();
      this.updateSearchCapabilityFromDenseState();
      return;
    }

    const small = await this.db.db.hybridHnswSmall.get(0);
    if (small) {
      this.hnswSmall.deserialize(await blobToHnsw(small.data));
      await this.hydrateHnswVectors();
    }
    this.updateSearchCapabilityFromDenseState();
  }

  private async hydrateHnswVectors(): Promise<void> {
    let lastFilePath: string | null = null;
    let append = false;
    while (true) {
      const rows = await profileHybridStage(
        "startup.load_vector_shards",
        async () => {
          if (lastFilePath === null) {
            return await this.db.db.hybridChunkVectors
              .orderBy("filePath")
              .limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
              .toArray();
          }
          return await this.db.db.hybridChunkVectors
            .where("filePath")
            .above(lastFilePath)
            .limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
            .toArray();
        },
      );
      if (rows.length === 0) {
        if (!append) {
          this.hnswSmall.hydrateVectors([]);
        }
        return;
      }

      for (const row of rows) {
        const records = await profileHybridStage(
          "startup.decode_vector_shards",
          async () => await rowToChunkVectorRecords(row as ChunkVectorShardRow),
        );
        recordHybridProfileMetric(
          "startup.hydrated_vector_count",
          records.length,
        );
        await profileHybridStage("startup.hydrate_hnsw_vectors", async () => {
          this.hnswSmall.hydrateVectors(records, { append });
        });
        append = true;
      }
      lastFilePath = rows[rows.length - 1].filePath;
    }
  }

  private async rebuildBm25ArtifactFromStore(): Promise<void> {
    this.bm25.clear();
    let lastFilePath: string | null = null;

    while (true) {
      const indexedRefs: HybridIndexedFileRef[] =
        lastFilePath === null
          ? await this.db.db.hybridIndexedFileRefs
              .orderBy("path")
              .limit(INDEX_CHUNK_BATCH_SIZE)
              .toArray()
          : await this.db.db.hybridIndexedFileRefs
              .where("path")
              .above(lastFilePath)
              .limit(INDEX_CHUNK_BATCH_SIZE)
              .toArray();
      if (indexedRefs.length === 0) {
        break;
      }

      const expectedGenerations = new Map<string, number | undefined>(
        indexedRefs.map((ref) => [ref.path, ref.generation]),
      );
      const snapshotByPath = await this.fileSnapshotStore.readGenerationAlignedTexts(
        indexedRefs.map((ref) => ref.path),
        expectedGenerations,
      );

      for (const indexedRef of indexedRefs) {
        const plainText = snapshotByPath.get(indexedRef.path);
        if (plainText === undefined) {
          continue;
        }
        const rows = await this.db.db.hybridChunks
          .where("filePath")
          .equals(indexedRef.path)
          .sortBy("chunkIndex");
        for (const row of rows) {
          if (row.id === undefined) {
            continue;
          }
          this.bm25.addDocument(
            row.id,
            plainText.slice(row.startOffset, row.endOffset),
          );
        }
      }

      lastFilePath = indexedRefs[indexedRefs.length - 1].path;
    }

    await this.persistBm25();
  }

  private async rebuildHnswFromStore(): Promise<void> {
    this.hnswSmall.clear(this.precision);
    let lastFilePath: string | null = null;

    while (true) {
      const rows: ChunkVectorShardRow[] =
        lastFilePath === null
          ? await this.db.db.hybridChunkVectors
              .orderBy("filePath")
              .limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
              .toArray()
          : await this.db.db.hybridChunkVectors
              .where("filePath")
              .above(lastFilePath)
              .limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
              .toArray();
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        if (row.precision !== this.precision) {
          continue;
        }
        const records = await rowToChunkVectorRecords(row as ChunkVectorShardRow);
        for (const record of records) {
          this.hnswSmall.insert(record.id, record.vector);
        }
      }
      lastFilePath = rows[rows.length - 1].filePath;
    }

    await this.persistHnsw();
  }

  private async hydrateDirtyArtifacts(): Promise<Set<HybridArtifactName>> {
    const rows = await this.db.db.indexArtifactState.bulkGet(
      HYBRID_DIRTY_ARTIFACTS.map((artifact) =>
        buildIndexArtifactStateId("hybrid", artifact),
      ),
    );
    this.dirtyArtifacts.clear();
    for (const row of rows) {
      if (row && (row.artifact === "bm25" || row.artifact === "hnsw")) {
        this.dirtyArtifacts.add(row.artifact);
      }
    }
    return new Set(this.dirtyArtifacts);
  }

  private async markHybridArtifactsDirty(reason: string): Promise<void> {
    const missingArtifacts = HYBRID_DIRTY_ARTIFACTS.filter(
      (artifact) => !this.dirtyArtifacts.has(artifact),
    );
    if (missingArtifacts.length === 0) {
      return;
    }

    const dirtyAt = Date.now();
    await this.db.db.indexArtifactState.bulkPut(
      missingArtifacts.map((artifact) => ({
        id: buildIndexArtifactStateId("hybrid", artifact),
        engine: "hybrid",
        artifact,
        dirtyAt,
        reason,
      })),
    );
    for (const artifact of missingArtifacts) {
      this.dirtyArtifacts.add(artifact);
    }
  }

  private async clearHybridArtifactDirtyState(
    artifacts: readonly HybridArtifactName[],
  ): Promise<void> {
    if (artifacts.length === 0) {
      return;
    }
    await this.db.db.indexArtifactState.bulkDelete(
      artifacts.map((artifact) => buildIndexArtifactStateId("hybrid", artifact)),
    );
    for (const artifact of artifacts) {
      this.dirtyArtifacts.delete(artifact);
    }
  }

  private updateSearchCapabilityFromDenseState(): void {
    this._canSearch =
      this.hnswSmall.isNonEmpty() && this.hnswSmall.hasVectors();
    if (!this._canSearch) {
      this.lastSearchFallbackNoticeKey = "hybridNotice.searchFallbackToBm25";
    }
  }

  private buildRerankContextBuilderByPath(
    snapshotByPath: Map<string, string>,
  ): Map<string, (startLine: number) => string> {
    const builders = new Map<string, (startLine: number) => string>();
    for (const [filePath, plainText] of snapshotByPath) {
      const headingOutline = this.dataProvider.getHeadingOutlineForText(
        filePath,
        plainText,
      );
      builders.set(
        filePath,
        createChunkContextBuilderFromOutline(
          filePath,
          countLines(plainText),
          headingOutline,
        ),
      );
    }
    return builders;
  }

  private isExcludedPath(filePath: string): boolean {
    const excludedPaths = this.setting.hybrid.excludedPaths ?? [];
    return excludedPaths.some(
      (excludedPath) =>
        filePath === excludedPath || filePath.startsWith(`${excludedPath}/`),
    );
  }
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let count = 1;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      count++;
    }
  }
  return count;
}
