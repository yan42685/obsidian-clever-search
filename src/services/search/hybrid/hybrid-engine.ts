import { OuterSetting } from "src/globals/plugin-setting";
import type { FileItem } from "src/globals/search-types";
import type { LocaleKey } from "src/services/obsidian/translations/locale-helper";
import { Database } from "src/services/database/database";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import {
  buildLineOffsets,
  buildRawChunkFromOffsets,
  chunkFile,
  chunkFileRange,
  createChunkEmbeddingInputBuilder,
} from "./chunker";
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
  blobToHnsw,
  ChunkVectorShardBuilder,
  chunkVectorShardToRow,
  type HybridFileSnapshotRow,
  type HybridIndexedFileRef,
  type ChunkRow,
  type ChunkVectorShardRow,
  chunkToRow,
  hnswToBlob,
  rowToChunkVectorRecords,
} from "./hybrid-store";
import type {
  HeadingOutlineEntry,
  RawChunk,
  StoredVector,
  VectorPrecision,
} from "./hybrid-types";
import {
  buildHybridLexicalLaneFileItems,
  buildHybridLexicalLaneFileShortlist,
  HYBRID_LEXICAL_LANE_FILE_SHORTLIST,
  prepareHybridLexicalLaneSearch,
  type HybridLexicalLaneDisplayCandidate,
} from "./lexical-lane";
import {
  HybridReranker,
  type RerankCandidate,
} from "./reranker";
import { EMBED_DIM } from "./hybrid-types";
import {
  profileHybridStage,
  recordHybridProfileMetric,
} from "./hybrid-profiler";
import { analyzeHybridStoredFileConsistency } from "./hybrid-consistency";
import { FileSnapshotStore } from "../shared/file-snapshot-store";

const DEFAULT_MAX_FILE_RESULTS = 10;
const MIN_FILE_RESULTS = 1;
const MAX_FILE_RESULTS = 50;
const INDEX_CHUNK_BATCH_SIZE = 24;
const HNSW_HYDRATE_SHARD_BATCH_SIZE = 8;
const HYBRID_DIRTY_ARTIFACTS = ["hnsw"] as const;

type HybridArtifactName = (typeof HYBRID_DIRTY_ARTIFACTS)[number];

type HybridWriteOption = {
  persistIndices?: boolean;
  deleteIndexedFileRef?: boolean;
};

type HybridIndexMode = "full" | "without-embedding";

type LexicalOnlyIndexedFileRefMeta = {
  lastIncrementalEmbedAt?: number;
};

function isHybridLexicalFallbackState(
  state: HybridIndexedFileRef["state"] | undefined,
): boolean {
  return state === "ready" || state === "lexical_only";
}

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
  totalBytes: number;
};

export type PreparedHybridRecall = {
  query: string;
  topK: number;
  displayCandidates: HybridLexicalLaneDisplayCandidate[];
  fallbackNoticeKey: LocaleKey | null;
  fallbackToLexicalSearch: boolean;
};

type FinalizedHybridRecall = {
  items: FileItem[];
  fallbackNoticeKey: LocaleKey | null;
  fallbackToLexicalSearch: boolean;
};

function createHybridAbortError(): Error {
  const error = new Error("Hybrid query aborted");
  error.name = "AbortError";
  return error;
}

function throwIfHybridQueryAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createHybridAbortError();
  }
}

export class HybridEngine {
  private readonly db = getInstance(Database);
  private readonly setting = getInstance(OuterSetting);
  private readonly embedder = new Embedder();
  private readonly reranker = new HybridReranker();
  private readonly hnswSmall = new HnswIndex();
  private readonly fileSnapshotStore = getInstance(FileSnapshotStore);

  private _ready = false;
  private _canSearch = false;
  private _hasStoredLexicalFallbackData = false;
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

  getEffectiveResultCount(): number {
    return this.defaultResultCount;
  }

  async load(): Promise<void> {
    const dirtyArtifacts = await this.hydrateDirtyArtifacts();
    await profileHybridStage(
      "startup.load_hnsw",
      async () => await this.loadHnsw(dirtyArtifacts.has("hnsw")),
    );
    await this.refreshStoredQueryCapabilityFromIndexedRefs();
    this._ready = true;
  }

  async clearAll(): Promise<void> {
    this.hnswSmall.clear(this.precision);
    this._ready = false;
    this._canSearch = false;
    this._hasStoredLexicalFallbackData = false;
    this.lastIndexingFallbackNoticeKey = null;
    this.lastSearchFallbackNoticeKey = null;
    this.dirtyArtifacts.clear();

    await Promise.all([
      this.db.db.hybridChunks.clear(),
      this.db.db.hybridChunkVectors.clear(),
      this.db.db.hybridHnswSmall.clear(),
      this.db.db.hybridIndexedFileRefs.clear(),
      this.db.db.indexArtifactState.bulkDelete(
        HYBRID_DIRTY_ARTIFACTS.map((artifact) =>
          buildIndexArtifactStateId("hybrid", artifact),
        ),
      ),
    ]);
    await this.fileSnapshotStore.reconcileHybridShadows();
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
    return this._ready && (this._canSearch || this._hasStoredLexicalFallbackData);
  }
  isEmpty(): boolean {
    return !this._canSearch && !this._hasStoredLexicalFallbackData;
  }

  getRuntimeMemoryEstimate(): HybridRuntimeMemoryEstimate {
    const hnswEstimate = this.hnswSmall.estimateRuntimeMemoryBytes();
    return {
      vectorsBytes: hnswEstimate.vectorBytes,
      graphBytes: hnswEstimate.graphBytes,
      totalBytes: hnswEstimate.totalBytes,
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
      await this.fileSnapshotStore.reconcileHybridShadows([filePath]);
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
        await this.deleteHybridIndexedFileRef(oldPath);
      }

      await this.fileSnapshotStore.reconcileHybridShadows([oldPath, newPath]);
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
      await this.deleteHybridIndexedFileRef(filePath);
    }

    for (const id of ids) {
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
    if (!this.isEnabled() || !this._ready || !query.trim()) {
      return [];
    }
    const prepared = await this.prepareRecall(query, topK);
    const finalized = await this.finalizePreparedRecall(prepared, topK);
    this.lastSearchFallbackNoticeKey = finalized.fallbackNoticeKey;
    return finalized.items;
  }

  async prepareRecall(
    query: string,
    topK = this.defaultResultCount,
    signal?: AbortSignal,
  ): Promise<PreparedHybridRecall> {
    if (!this.isEnabled() || !this._ready || !query.trim()) {
      return {
        query,
        topK,
        displayCandidates: [],
        fallbackNoticeKey: null,
        fallbackToLexicalSearch: false,
      };
    }
    throwIfHybridQueryAborted(signal);
    const fileShortlistLimit = Math.max(
      HYBRID_LEXICAL_LANE_FILE_SHORTLIST,
      topK,
    );
    const fileShortlist = await buildHybridLexicalLaneFileShortlist({
      queryText: query,
      limit: fileShortlistLimit,
    });
    throwIfHybridQueryAborted(signal);
    if (fileShortlist.length === 0) {
      return {
        query,
        topK,
        displayCandidates: [],
        fallbackNoticeKey: null,
        fallbackToLexicalSearch: true,
      };
    }
    const displayCandidates = await prepareHybridLexicalLaneSearch({
      queryText: query,
      files: fileShortlist,
      fileShortlist: fileShortlistLimit,
      displayTopK: Math.max(topK * 2, topK),
      rerankTopK: Math.max(topK * 2, topK),
    });
    throwIfHybridQueryAborted(signal);
    return {
      query,
      topK,
      displayCandidates,
      fallbackNoticeKey: null,
      fallbackToLexicalSearch: displayCandidates.length === 0,
    };
  }

  buildItemsFromPreparedRecall(
    prepared: PreparedHybridRecall,
    topK = prepared.topK,
  ): FileItem[] {
    if (prepared.displayCandidates.length === 0 || topK <= 0) {
      return [];
    }
    return buildHybridLexicalLaneFileItems(
      prepared.query,
      prepared.displayCandidates.slice(0, topK),
    );
  }

  async finalizePreparedRecall(
    prepared: PreparedHybridRecall,
    topK = prepared.topK,
    signal?: AbortSignal,
  ): Promise<FinalizedHybridRecall> {
    const baseItems = this.buildItemsFromPreparedRecall(prepared, topK);
    if (prepared.displayCandidates.length <= 1 || topK <= 0) {
      return {
        items: baseItems,
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackToLexicalSearch: false,
      };
    }

    try {
      throwIfHybridQueryAborted(signal);
      const rerankedCandidates = await this.rerankDisplayCandidates(
        prepared.query,
        prepared.displayCandidates,
        Math.max(topK * 2, topK),
        signal,
      );
      throwIfHybridQueryAborted(signal);
      return {
        items: buildHybridLexicalLaneFileItems(
          prepared.query,
          rerankedCandidates.slice(0, topK),
        ),
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackToLexicalSearch: false,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        throw error;
      }
      logger.warn(
        "hybrid rerank failed; keeping coverage recall ordering.",
        error,
      );
      return {
        items: baseItems,
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackToLexicalSearch: true,
      };
    }
  }

  private async rerankDisplayCandidates(
    query: string,
    candidates: readonly HybridLexicalLaneDisplayCandidate[],
    topK: number,
    signal?: AbortSignal,
  ): Promise<HybridLexicalLaneDisplayCandidate[]> {
    if (candidates.length <= 1 || topK <= 0) {
      return [...candidates];
    }
    const rerankLimit = Math.min(candidates.length, topK);
    const rerankCandidates: RerankCandidate[] = candidates
      .slice(0, rerankLimit)
      .map((candidate, index) => ({
        id: index,
        filePath: candidate.filePath,
        text: candidate.snippetText,
        startLine: candidate.startLine,
        startCol: candidate.startCol,
        endLine: candidate.endLine,
        recallScore: candidate.score,
      }));
    const reranked = await this.reranker.rerank(
      query,
      rerankCandidates,
      rerankLimit,
    );
    const rerankedHead = reranked
      .map((result) => candidates[result.id])
      .filter(
        (candidate): candidate is HybridLexicalLaneDisplayCandidate =>
          candidate !== undefined,
      );
    const usedIds = new Set(reranked.map((result) => result.id));
    const remaining = candidates
      .slice(0, rerankLimit)
      .filter((_, index) => !usedIds.has(index));
    return [
      ...rerankedHead,
      ...remaining,
      ...candidates.slice(rerankLimit),
    ];
  }

  async persistIndicesForBatch(): Promise<void> {
    await this.persistIndices();
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
        await this.fileSnapshotStore.reconcileHybridShadows([filePath]);
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
        await this.deleteHybridIndexedFileRef(filePath);
        await this.fileSnapshotStore.reconcileHybridShadows([filePath]);
        if (option.persistIndices ?? true) {
          await this.persistIndices();
        }
        return;
      }
      recordHybridProfileMetric("index.chunk_count", plannedChunks.length);

      if (mode === "without-embedding") {
        await this.indexLexicalOnly(filePath, plannedChunks, generation, option, {
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
        });
        logger.warn(`hybrid indexing fell back to lexical-only mode for ${filePath}`, error);
        this._canSearch = false;
        this.lastIndexingFallbackNoticeKey = "hybridNotice.indexFallbackToLexical";
        try {
          await this.indexLexicalOnly(filePath, plannedChunks, generation, option);
          await this.persistSnapshot(filePath, plainText, generation);
          const fallbackIndexedAt = Date.now();
          await this.putHybridIndexedFileRef({
            path: filePath,
            state: "lexical_only",
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
          await this.fileSnapshotStore.reconcileHybridShadows([filePath]);
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
      this.fileSnapshotStore
        .readIndexedTexts([
          { path: filePath, generation: indexedFileRef?.generation },
        ])
        .then((texts) => texts.get(filePath)),
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
    await this.fileSnapshotStore.publishIndexedTexts([
      {
        path: filePath,
        generation,
        text: plainText,
      },
    ]);
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

  private async indexLexicalOnly(
    filePath: string,
    plannedChunks: PlannedChunk[],
    generation: number,
    option: HybridWriteOption,
    meta?: LexicalOnlyIndexedFileRefMeta,
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
      await profileHybridStage(
        "index.persist_chunks_lexical_only",
        async () =>
          await this.persistChunks(filePath, batchChunks, false, chunkStart),
      );
    }

    if (option.persistIndices ?? true) {
      await this.persistIndices();
    }
    await this.putHybridIndexedFileRef({
      path: filePath,
      state: "lexical_only",
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
    if (ref.state !== "pending") {
      await this.fileSnapshotStore.reconcileHybridShadows([ref.path]);
    }
    if (isHybridLexicalFallbackState(ref.state)) {
      this._hasStoredLexicalFallbackData = true;
      return;
    }
    await this.refreshStoredQueryCapabilityFromIndexedRefs();
  }

  private async deleteHybridIndexedFileRef(filePath: string): Promise<void> {
    await this.db.db.hybridIndexedFileRefs.delete(filePath);
    await this.refreshStoredQueryCapabilityFromIndexedRefs();
  }

  private async refreshStoredQueryCapabilityFromIndexedRefs(): Promise<void> {
    const refs = await this.db.db.hybridIndexedFileRefs.toArray();
    this._hasStoredLexicalFallbackData = refs.some(
      (ref) => isHybridLexicalFallbackState(ref.state),
    );
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

  private async persistIndices(): Promise<void> {
    await this.persistHnsw();
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
      if (row && row.artifact === "hnsw") {
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
      this.lastSearchFallbackNoticeKey = "hybridNotice.searchFallbackToLexical";
    }
  }

  private isExcludedPath(filePath: string): boolean {
    const excludedPaths = this.setting.hybrid.excludedPaths ?? [];
    return excludedPaths.some(
      (excludedPath) =>
        filePath === excludedPath || filePath.startsWith(`${excludedPath}/`),
    );
  }
}

