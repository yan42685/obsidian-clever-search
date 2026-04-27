import { OuterSetting } from "src/globals/plugin-setting";
import type { FileItem } from "src/globals/search-types";
import type {
  HybridSearchIssueKind,
} from "src/globals/search-types";
import type { LocaleKey } from "src/services/obsidian/translations/locale-helper";
import { Database } from "src/services/database/database";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";
import { logger } from "src/utils/logger";
import { FileUtil } from "src/utils/file-util";
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
  buildHybridGenerationKey,
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
import {
  buildHybridSearchIssue,
} from "./provider-error";
import { buildHybridSharedSnippetHeader } from "./shared-snippet/context-header";
import { EMBED_DIM } from "./hybrid-types";
import {
  profileHybridStage,
  recordHybridProfileMetric,
} from "./hybrid-profiler";
import { analyzeHybridStoredFileConsistency } from "./hybrid-consistency";
import { FileSnapshotStore } from "../shared/file-snapshot-store";
import { buildLexicalOnlyFreshness } from "./freshness";

const DEFAULT_MAX_FILE_RESULTS = 10;
const MIN_FILE_RESULTS = 1;
const MAX_FILE_RESULTS = 50;
const INDEX_CHUNK_BATCH_SIZE = 24;
const HNSW_HYDRATE_SHARD_BATCH_SIZE = 8;
const HYBRID_DIRTY_ARTIFACTS = ["hnsw"] as const;
const HYBRID_RERANK_LEXICAL_CANDIDATE_LIMIT = 10;
const HYBRID_RERANK_DENSE_CANDIDATE_LIMIT = 30;
const HYBRID_DENSE_FETCH_MULTIPLIER = 3;
const HYBRID_DENSE_DEDUPE_OVERLAP_RATIO = 0.7;

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
  fallbackNoticeMessage: string | null;
  fallbackIssueKind: HybridSearchIssueKind | null;
  fallbackIssueMessage: string | null;
  fallbackToLexicalSearch: boolean;
};

type FinalizedHybridRecall = {
  items: FileItem[];
  fallbackNoticeKey: LocaleKey | null;
  fallbackNoticeMessage: string | null;
  fallbackIssueKind: HybridSearchIssueKind | null;
  fallbackIssueMessage: string | null;
  fallbackToLexicalSearch: boolean;
};

function ensureHybridFallbackMetadata<T extends {
  fallbackNoticeKey: LocaleKey | null;
  fallbackNoticeMessage: string | null;
  fallbackIssueKind: HybridSearchIssueKind | null;
  fallbackIssueMessage: string | null;
  fallbackToLexicalSearch: boolean;
}>(result: T): T {
  if (!result.fallbackToLexicalSearch) {
    return result;
  }
  if (
    result.fallbackNoticeKey ||
    result.fallbackNoticeMessage ||
    result.fallbackIssueKind ||
    result.fallbackIssueMessage
  ) {
    return result;
  }
  return {
    ...result,
    fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
  };
}

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

function markHybridItemsLexicalOnly(items: FileItem[]): FileItem[] {
  for (const item of items) {
    const freshness = buildLexicalOnlyFreshness("dense_unavailable", {
      snapshotGeneration: item.snapshotGeneration,
    });
    item.freshnessState = freshness.state;
    item.freshnessReason = freshness.reason;
    item.snapshotGeneration = freshness.snapshotGeneration;
    item.snapshotSource = freshness.snapshotSource;
    item.nativeSubItemsReady = freshness.nativeSubItemsReady;
    item.bannerKey = freshness.bannerKey;
    item.bannerMessage = freshness.bannerMessage;
  }
  return items;
}

function escapeSnippetHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

    await this.db.db.transaction(
      "rw",
      this.db.db.hybridChunks,
      this.db.db.hybridChunkVectors,
      this.db.db.hybridHnswSmall,
      this.db.db.hybridIndexedFileRefs,
      this.db.db.indexArtifactState,
      async () => {
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
      },
    );
    await this.fileSnapshotStore.notifyHybridIndexedRefsChanged();
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
      await this.fileSnapshotStore.markDocRegistryDeleted(filePath);
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
      const indexedFileRef =
        await this.fileSnapshotStore.getHybridIndexedFileRef(oldPath);
      const oldDocEntry = await this.fileSnapshotStore.getDocRegistryEntry(oldPath);
      if (oldDocEntry == null && indexedFileRef == null) {
        return false;
      }

      if ((await this.fileSnapshotStore.getHybridIndexedFileRef(newPath)) !== undefined) {
        await this.deleteStoredHybridPrivateData(newPath, {
          persistIndices: false,
        });
      }

      await this.fileSnapshotStore.moveDocRegistryPath(oldPath, newPath, {
        generation: indexedFileRef?.generation ?? generation,
      });
      await this.fileSnapshotStore.notifyHybridIndexedRefsChanged([oldPath, newPath]);

      return true;
    });
  }

  private async deleteStoredHybridPrivateData(
    filePath: string,
    option: HybridWriteOption = {},
  ): Promise<void> {
    const docRegistryEntry = await this.fileSnapshotStore.getDocRegistryEntry(filePath);
    const rows = docRegistryEntry == null
      ? []
      : await this.db.db.hybridChunks
          .where("docRef")
          .equals(docRegistryEntry.docRef)
          .toArray();
    const vectorRows =
      docRegistryEntry == null
        ? []
        : await this.db.db.hybridChunkVectors
            .where("docRef")
            .equals(docRegistryEntry.docRef)
            .toArray();
    const ids = rows.map((row) => row.id!).filter((id) => id !== undefined);
    const vectorIds = vectorRows.map((row) => row.id);
    const vectorChunkCount = vectorRows.reduce(
      (sum, row) => sum + row.chunkCount,
      0,
    );
    const mustRebuildHnsw = vectorChunkCount !== ids.length;

    if (ids.length > 0 || vectorIds.length > 0 || mustRebuildHnsw) {
      await this.markHybridArtifactsDirty("runtime-delete-write");
    }

    await this.db.db.transaction(
      "rw",
    this.db.db.hybridChunks,
      this.db.db.hybridChunkVectors,
      this.db.db.hybridIndexedFileRefs,
      async () => {
        await this.db.db.hybridChunks.bulkDelete(ids);
        await this.db.db.hybridChunkVectors.bulkDelete(vectorIds);
        if (option.deleteIndexedFileRef ?? true) {
          if (docRegistryEntry != null) {
            await this.db.db.hybridIndexedFileRefs.delete(docRegistryEntry.docRef);
          }
        }
      },
    );
    if (option.deleteIndexedFileRef ?? true) {
      await this.fileSnapshotStore.notifyHybridIndexedRefsChanged([filePath]);
    }

    if (mustRebuildHnsw) {
      await this.rebuildHnswFromStore(option.persistIndices ?? true);
      this.updateSearchCapabilityFromDenseState();
      return;
    }

    for (const id of ids) {
      this.hnswSmall.delete(id);
    }

    if (this.hnswSmall.needsRebuild()) {
      this.hnswSmall.rebuild();
    }
    this.updateSearchCapabilityFromDenseState();
    if ((option.persistIndices ?? true) && ids.length > 0) {
      await this.persistIndices();
    }
  }

  private async deleteStoredHybridGenerationArtifacts(
    docRef: number,
    generation: number,
    option: Pick<HybridWriteOption, "persistIndices"> = {},
  ): Promise<void> {
    const rows = await this.db.db.hybridChunks
      .where("[docRef+generation]")
      .equals([docRef, generation])
      .toArray();
    const vectorKey = buildHybridGenerationKey(docRef, generation);
    const vectorRow = await this.db.db.hybridChunkVectors.get(vectorKey);
    const ids = rows.map((row) => row.id!).filter((id) => id !== undefined);
    const mustRebuildHnsw =
      vectorRow !== undefined && vectorRow.chunkCount !== ids.length;

    if (ids.length > 0 || vectorRow !== undefined || mustRebuildHnsw) {
      await this.markHybridArtifactsDirty("runtime-delete-write");
    }

    await this.db.db.transaction(
      "rw",
      this.db.db.hybridChunks,
      this.db.db.hybridChunkVectors,
      async () => {
        await this.db.db.hybridChunks.bulkDelete(ids);
        await this.db.db.hybridChunkVectors.delete(vectorKey);
      },
    );

    if (mustRebuildHnsw) {
      await this.rebuildHnswFromStore(option.persistIndices ?? true);
      this.updateSearchCapabilityFromDenseState();
      return;
    }

    for (const id of ids) {
      this.hnswSmall.delete(id);
    }

    if (this.hnswSmall.needsRebuild()) {
      this.hnswSmall.rebuild();
    }
    this.updateSearchCapabilityFromDenseState();
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
        fallbackNoticeMessage: null,
        fallbackIssueKind: null,
        fallbackIssueMessage: null,
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
    const displayCandidates = await prepareHybridLexicalLaneSearch({
      queryText: query,
      files: fileShortlist,
      fileShortlist: fileShortlistLimit,
      displayTopK: Math.max(topK * 2, topK),
      rerankTopK: Math.max(topK * 2, topK),
    });
    throwIfHybridQueryAborted(signal);
    if (fileShortlist.length === 0 || displayCandidates.length === 0) {
      logger.debug(
        "hybrid lexical-lane prepare produced no lexical candidates; continuing with dense recall.",
        {
          query,
          fileShortlistCount: fileShortlist.length,
          displayCandidateCount: displayCandidates.length,
        },
      );
    }
    return ensureHybridFallbackMetadata({
      query,
      topK,
      displayCandidates,
      fallbackNoticeKey: null,
      fallbackNoticeMessage: null,
      fallbackIssueKind: null,
      fallbackIssueMessage: null,
      fallbackToLexicalSearch: false,
    });
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
    if (topK <= 0) {
      return {
        items: [],
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackNoticeMessage: prepared.fallbackNoticeMessage,
        fallbackIssueKind: prepared.fallbackIssueKind,
        fallbackIssueMessage: prepared.fallbackIssueMessage,
        fallbackToLexicalSearch: false,
      };
    }

    const lexicalCandidates = prepared.displayCandidates.slice(
      0,
      HYBRID_RERANK_LEXICAL_CANDIDATE_LIMIT,
    );
    let rerankCandidates = lexicalCandidates;

    try {
      throwIfHybridQueryAborted(signal);
      const denseCandidates = await this.recallDenseDisplayCandidates(
        prepared.query,
        lexicalCandidates,
        HYBRID_RERANK_DENSE_CANDIDATE_LIMIT,
        signal,
      );
      throwIfHybridQueryAborted(signal);
      rerankCandidates = [...lexicalCandidates, ...denseCandidates];
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        throw error;
      }
      logger.error(
        "hybrid dense recall failed; falling back to lexical search.",
        error,
      );
      const issue = buildHybridSearchIssue(error);
      return {
        items: markHybridItemsLexicalOnly(
          buildHybridLexicalLaneFileItems(prepared.query, lexicalCandidates),
        ),
        fallbackNoticeKey:
          prepared.fallbackNoticeKey ?? "hybridNotice.searchFallbackToLexical",
        fallbackNoticeMessage:
          prepared.fallbackNoticeMessage ?? issue.message,
        fallbackIssueKind: prepared.fallbackIssueKind ?? issue.kind,
        fallbackIssueMessage:
          prepared.fallbackIssueMessage ?? issue.message,
        fallbackToLexicalSearch: true,
      };
    }

    const baseItems = buildHybridLexicalLaneFileItems(
      prepared.query,
      rerankCandidates.slice(0, topK),
    );
    if (rerankCandidates.length === 0) {
      return {
        items: [],
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackNoticeMessage: prepared.fallbackNoticeMessage,
        fallbackIssueKind: prepared.fallbackIssueKind,
        fallbackIssueMessage: prepared.fallbackIssueMessage,
        fallbackToLexicalSearch: false,
      };
    }
    if (rerankCandidates.length <= 1) {
      return {
        items: baseItems,
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackNoticeMessage: prepared.fallbackNoticeMessage,
        fallbackIssueKind: prepared.fallbackIssueKind,
        fallbackIssueMessage: prepared.fallbackIssueMessage,
        fallbackToLexicalSearch: false,
      };
    }

    try {
      throwIfHybridQueryAborted(signal);
      const rerankedCandidates = await this.rerankDisplayCandidates(
        prepared.query,
        rerankCandidates,
        rerankCandidates.length,
        signal,
      );
      throwIfHybridQueryAborted(signal);
      return {
        items: buildHybridLexicalLaneFileItems(
          prepared.query,
          rerankedCandidates.slice(0, topK),
        ),
        fallbackNoticeKey: prepared.fallbackNoticeKey,
        fallbackNoticeMessage: prepared.fallbackNoticeMessage,
        fallbackIssueKind: prepared.fallbackIssueKind,
        fallbackIssueMessage: prepared.fallbackIssueMessage,
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
      logger.error(
        "hybrid rerank failed; falling back to lexical search.",
        error,
      );
      const issue = buildHybridSearchIssue(error);
      return {
        items: markHybridItemsLexicalOnly(baseItems),
        fallbackNoticeKey:
          prepared.fallbackNoticeKey ?? "hybridNotice.searchFallbackToLexical",
        fallbackNoticeMessage:
          prepared.fallbackNoticeMessage ?? issue.message,
        fallbackIssueKind: prepared.fallbackIssueKind ?? issue.kind,
        fallbackIssueMessage:
          prepared.fallbackIssueMessage ?? issue.message,
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

  private async recallDenseDisplayCandidates(
    query: string,
    lexicalCandidates: readonly HybridLexicalLaneDisplayCandidate[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<HybridLexicalLaneDisplayCandidate[]> {
    if (limit <= 0 || !this._canSearch) {
      return [];
    }

    const queryVector = await this.embedder.embedQuery(
      query,
      this.precision,
      "<query>",
      signal,
    );
    throwIfHybridQueryAborted(signal);

    const denseHits = this.hnswSmall.search(
      queryVector,
      Math.max(limit, limit * HYBRID_DENSE_FETCH_MULTIPLIER),
    );
    if (denseHits.length === 0) {
      return [];
    }

    const chunkRows = await this.db.db.hybridChunks.bulkGet(
      denseHits.map((hit) => hit.id),
    );
    const denseRows = denseHits
      .map((hit, index) => {
        const row = chunkRows[index];
        if (!row) {
          return null;
        }
        return {
          row,
          score: hit.score,
        };
      })
      .filter(
        (
          value,
        ): value is {
          row: ChunkRow;
          score: number;
        } => value !== null,
      );
    if (denseRows.length === 0) {
      return [];
    }

    const registryRows = await this.db.db.docRegistry.bulkGet(
      denseRows.map(({ row }) => row.docRef),
    );
    const registryByDocRef = new Map(
      registryRows
        .filter((row): row is NonNullable<typeof row> => row != null && !row.deleted)
        .map((row) => [row.docRef, row] as const),
    );
    const refs = await this.db.db.hybridIndexedFileRefs.bulkGet(
      denseRows.map(({ row }) => row.docRef),
    );
    const refByDocRef = new Map(
      refs
        .filter((ref): ref is NonNullable<typeof ref> => ref != null)
        .map((ref) => [ref.docRef, ref] as const),
    );
    const snapshotsByPath = await this.fileSnapshotStore.readIndexedTextSnapshots(
      denseRows
        .map(({ row }) => {
          const registryRow = registryByDocRef.get(row.docRef);
          const ref = refByDocRef.get(row.docRef);
          return registryRow == null
            ? null
            : {
                path: registryRow.path,
                generation: ref?.generation,
              };
        })
        .filter(
          (request): request is { path: string; generation: number | undefined } =>
            request != null,
        ),
    );
    const lineOffsetsByPath = new Map<string, number[]>();
    const denseCandidates: HybridLexicalLaneDisplayCandidate[] = [];

    for (const denseRow of denseRows) {
      if (
        this.isDenseCandidateCoveredByLexical(denseRow.row, lexicalCandidates)
      ) {
        continue;
      }
      const docRegistryEntry = registryByDocRef.get(denseRow.row.docRef);
      if (docRegistryEntry == null) {
        continue;
      }
      const indexedFileRef = refByDocRef.get(denseRow.row.docRef);
      if (
        indexedFileRef?.state !== "ready" ||
        indexedFileRef.generation !== denseRow.row.generation
      ) {
        continue;
      }
      const isStaleDense = docRegistryEntry.liveGeneration !== indexedFileRef.generation;
      const snapshot = snapshotsByPath.get(docRegistryEntry.path);
      const staleShadow =
        isStaleDense && docRegistryEntry.denseServeUntil != null &&
        docRegistryEntry.denseServeUntil >= Date.now()
          ? await this.db.db.hybridDirtyShadows.get(
              buildHybridGenerationKey(denseRow.row.docRef, indexedFileRef.generation),
            )
          : undefined;
      if (
        isStaleDense &&
        (staleShadow == null ||
          staleShadow.docRef !== denseRow.row.docRef ||
          staleShadow.generation !== indexedFileRef.generation)
      ) {
        continue;
      }
      if (!isStaleDense && !snapshot) {
        continue;
      }
      const snapshotText = staleShadow?.plainText ?? snapshot?.text;
      if (snapshotText == null) {
        continue;
      }
      let lineOffsets = lineOffsetsByPath.get(docRegistryEntry.path);
      if (!lineOffsets) {
        lineOffsets = buildLineOffsets(snapshotText);
        lineOffsetsByPath.set(docRegistryEntry.path, lineOffsets);
      }
      const candidate = this.buildDenseDisplayCandidate(
        denseRow.row,
        docRegistryEntry.path,
        denseRow.score,
        snapshotText,
        lineOffsets,
        staleShadow?.generation ?? snapshot?.generation,
        staleShadow != null ? "shadow" : snapshot?.source ?? "indexed",
      );
      if (!candidate) {
        continue;
      }
      denseCandidates.push(candidate);
      if (denseCandidates.length >= limit) {
        break;
      }
    }

    return denseCandidates;
  }

  private isDenseCandidateCoveredByLexical(
    denseRow: Pick<ChunkRow, "docRef" | "startOffset" | "endOffset">,
    lexicalCandidates: readonly Pick<
      HybridLexicalLaneDisplayCandidate,
      "docRef" | "coreStart" | "coreEnd"
    >[],
  ): boolean {
    return lexicalCandidates.some((candidate) => {
      if (candidate.docRef !== denseRow.docRef) {
        return false;
      }
      const overlapStart = Math.max(candidate.coreStart, denseRow.startOffset);
      const overlapEnd = Math.min(candidate.coreEnd, denseRow.endOffset);
      if (overlapEnd <= overlapStart) {
        return false;
      }
      const overlap = overlapEnd - overlapStart;
      const lexicalLength = Math.max(1, candidate.coreEnd - candidate.coreStart);
      return overlap / lexicalLength >= HYBRID_DENSE_DEDUPE_OVERLAP_RATIO;
    });
  }

  private buildDenseDisplayCandidate(
    row: ChunkRow,
    filePath: string,
    score: number,
    snapshotText: string,
    lineOffsets: number[],
    snapshotGeneration: number | undefined,
    snapshotSource: HybridLexicalLaneDisplayCandidate["snapshotSource"],
  ): HybridLexicalLaneDisplayCandidate | null {
    const rawChunk = buildRawChunkFromOffsets(
      filePath,
      snapshotText,
      lineOffsets,
      row.startOffset,
      row.endOffset,
    );
    if (!rawChunk) {
      return null;
    }

    const headerText = buildHybridSharedSnippetHeader({
      filePath,
      snapshotText,
      startLine: rawChunk.startLine,
    });
    const bodyText = rawChunk.text;
    const headerPrefix = headerText ? `${headerText}\n\n` : "";
    const snippetText = headerPrefix ? `${headerPrefix}${bodyText}` : bodyText;
    const sectionLine = headerText
      .split("\n")
      .find((line) => line.startsWith("Section: "));
    const headingChain = sectionLine
      ? sectionLine
          .slice("Section: ".length)
          .split(" > ")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : [];
    const endLineOffset = lineOffsets[rawChunk.endLine] ?? 0;

    return {
      docRef: row.docRef,
      filePath,
      snapshotGeneration,
      snapshotSource,
      basename: FileUtil.getBasename(filePath),
      headingChain,
      segmentText: headingChain.join(" > "),
      startLine: rawChunk.startLine,
      startCol: rawChunk.startCol,
      endLine: rawChunk.endLine,
      endCol: Math.max(0, row.endOffset - endLineOffset),
      score,
      snippetText,
      snippetHtml: `${escapeSnippetHtml(headerPrefix)}${escapeSnippetHtml(bodyText)}`,
      headerText,
      bodyText,
      highlightRanges: [],
      bodyHighlightRanges: [],
      coreStart: row.startOffset,
      coreEnd: row.endOffset,
      displayStart: row.startOffset,
      displayEnd: row.endOffset,
      bodyStart: row.startOffset,
      bodyEnd: row.endOffset,
      anchorOffset: row.startOffset,
    };
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
        await this.fileSnapshotStore.markDocRegistryDeleted(filePath, generation);
        return;
      }

      const pendingIndexedAt = Date.now();
      const contentFingerprint = hashStableText(plainText);
      const docRegistryEntry = await this.fileSnapshotStore.ensureDocRegistryEntry({
        path: filePath,
        generation,
        deleted: false,
        contentFingerprint,
      });
      const previousIndexedFileRef =
        await this.fileSnapshotStore.getHybridIndexedFileRef(filePath);
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
        docRef: docRegistryEntry.docRef,
        state: "pending",
        generation,
        chunkCount: 0,
        vectorPrecision: null,
        indexedAt: pendingIndexedAt,
        lastIncrementalEmbedAt: previousIndexedFileRef?.lastIncrementalEmbedAt,
      });
      await this.deleteStoredHybridGenerationArtifacts(
        docRegistryEntry.docRef,
        generation,
        option,
      );

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
        const indexedAt = Date.now();
        await this.commitHybridFileIndex({
          snapshot: {
            id: buildHybridGenerationKey(docRegistryEntry.docRef, generation),
            plainText,
            generation,
            docRef: docRegistryEntry.docRef,
          },
          ref: {
          docRef: docRegistryEntry.docRef,
          state: "ready",
          generation,
          chunkCount: 0,
          vectorPrecision: null,
          indexedAt,
          lastIncrementalEmbedAt: indexedAt,
          },
        });
        if (option.persistIndices ?? true) {
          await this.persistIndices();
        }
        if (
          previousIndexedFileRef != null &&
          previousIndexedFileRef.generation !== generation
        ) {
          await this.deleteStoredHybridGenerationArtifacts(
            docRegistryEntry.docRef,
            previousIndexedFileRef.generation,
            option,
          );
        }
        return;
      }
      recordHybridProfileMetric("index.chunk_count", plannedChunks.length);

      if (mode === "without-embedding") {
        await this.indexLexicalOnly(filePath, plannedChunks, generation, option, {
          lastIncrementalEmbedAt:
            previousIndexedFileRef?.lastIncrementalEmbedAt,
        }, docRegistryEntry.docRef, plainText);
        if (
          previousIndexedFileRef != null &&
          previousIndexedFileRef.generation !== generation
        ) {
          await this.deleteStoredHybridGenerationArtifacts(
            docRegistryEntry.docRef,
            previousIndexedFileRef.generation,
            option,
          );
        }
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
                docRegistryEntry.docRef,
                generation,
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
            ...shardBuilder.build({
              docRef: docRegistryEntry.docRef,
              generation,
            }),
          });
        });
        await this.persistSnapshot(filePath, plainText, generation);
        this._canSearch = true;
        this.lastIndexingFallbackNoticeKey = null;
      } catch (error) {
        await this.deleteStoredHybridGenerationArtifacts(
          docRegistryEntry.docRef,
          generation,
          {
          persistIndices: false,
          },
        );
        logger.error(
          `hybrid indexing embedding failed; falling back to lexical-only mode for ${filePath}`,
          error,
        );
        this._canSearch = false;
        this.lastIndexingFallbackNoticeKey = null;
        try {
          await this.indexLexicalOnly(
            filePath,
            plannedChunks,
            generation,
            option,
            undefined,
            docRegistryEntry.docRef,
            plainText,
          );
          if (
            previousIndexedFileRef != null &&
            previousIndexedFileRef.generation !== generation
          ) {
            await this.deleteStoredHybridGenerationArtifacts(
              docRegistryEntry.docRef,
              previousIndexedFileRef.generation,
              option,
            );
          }
          return;
        } catch (fallbackError) {
          const failedIndexedAt = Date.now();
          await this.putHybridIndexedFileRef({
            docRef: docRegistryEntry.docRef,
            state: "failed",
            generation,
            chunkCount: 0,
            vectorPrecision: null,
            indexedAt: failedIndexedAt,
            lastIncrementalEmbedAt:
              previousIndexedFileRef?.lastIncrementalEmbedAt,
          });
          throw fallbackError;
        }
      }

      const indexedAt = Date.now();
      if (option.persistIndices ?? true) {
        await this.persistIndices();
      }
      await this.commitHybridFileIndex({
        snapshot: {
          id: buildHybridGenerationKey(docRegistryEntry.docRef, generation),
          plainText,
          generation,
          docRef: docRegistryEntry.docRef,
        },
        ref: {
        docRef: docRegistryEntry.docRef,
        state: "ready",
        generation,
        chunkCount: plannedChunks.length,
        vectorPrecision: this.precision,
        indexedAt,
        lastIncrementalEmbedAt: indexedAt,
        },
      });
      if (
        previousIndexedFileRef != null &&
        previousIndexedFileRef.generation !== generation
      ) {
        await this.deleteStoredHybridGenerationArtifacts(
          docRegistryEntry.docRef,
          previousIndexedFileRef.generation,
          option,
        );
      }
    });
  }

  private async loadStoredFileIndexState(
    filePath: string,
    indexedFileRef?: HybridIndexedFileRef,
  ): Promise<StoredFileIndexState> {
    const docRef = indexedFileRef?.docRef;
    const generation = indexedFileRef?.generation;
    const vectorKey =
      docRef == null || generation == null
        ? undefined
        : buildHybridGenerationKey(docRef, generation);
    const [snapshotText, chunkRows, vectorRow] = await Promise.all([
      this.fileSnapshotStore
        .readIndexedTexts([
          { path: filePath, generation },
        ])
        .then((texts) => texts.get(filePath)),
      docRef == null || generation == null
        ? Promise.resolve([])
        : this.db.db.hybridChunks
            .where("[docRef+generation]")
            .equals([docRef, generation])
            .sortBy("chunkIndex"),
      vectorKey == null
        ? Promise.resolve(undefined)
        : this.db.db.hybridChunkVectors.get(vectorKey),
    ]);
    const snapshot =
      snapshotText === undefined || docRef == null || generation == null
        ? undefined
        : {
            id: buildHybridGenerationKey(docRef, generation),
            docRef,
            filePath,
            plainText: snapshotText,
            generation,
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

  private async commitHybridFileIndex(params: {
    snapshot: HybridFileSnapshotRow;
    ref: HybridIndexedFileRef;
  }): Promise<void> {
    await this.db.db.transaction(
      "rw",
      this.db.db.fileSnapshots,
      this.db.db.hybridIndexedFileRefs,
      this.db.db.hybridDirtyShadows,
      this.db.db.docRegistry,
      async () => {
        await this.db.db.fileSnapshots.put(params.snapshot);
        await this.db.db.hybridIndexedFileRefs.put(params.ref);
        await this.db.db.hybridDirtyShadows.delete(
          buildHybridGenerationKey(params.ref.docRef, params.ref.generation),
        );
        const docRegistryEntry = await this.db.db.docRegistry.get(params.ref.docRef);
        if (docRegistryEntry != null) {
          await this.db.db.docRegistry.put({
            ...docRegistryEntry,
            denseReadyGeneration:
              params.ref.state === "ready"
                ? params.ref.generation
                : docRegistryEntry.denseReadyGeneration,
            denseTargetGeneration: params.ref.generation,
            denseState: params.ref.state,
            lastDenseSuccessAt:
              params.ref.state === "ready"
                ? params.ref.indexedAt ?? Date.now()
                : docRegistryEntry.lastDenseSuccessAt,
            updatedAt: Date.now(),
          });
        }
      },
    );
    if (params.ref.state !== "pending") {
      await this.fileSnapshotStore.notifyHybridIndexedRefsChanged();
    }
    if (isHybridLexicalFallbackState(params.ref.state)) {
      this._hasStoredLexicalFallbackData = true;
      return;
    }
    await this.refreshStoredQueryCapabilityFromIndexedRefs();
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
              filePath,
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
    filePath: string,
    row: ChunkRow,
    plainText: string,
    lineOffsets: number[],
    buildEmbedInput: (chunk: RawChunk) => string,
    vectorsByChunkId: Map<number, StoredVector>,
    startOffset: number,
    endOffset: number,
  ): PlannedChunk | null {
    const rawChunk = buildRawChunkFromOffsets(
      filePath,
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
    docRef: number,
    generation: number,
  ): Promise<number[]> {
    const rows = plannedChunks.map((chunk, index) => {
      return chunkToRow({
        id: undefined,
        docRef,
        generation,
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
    meta: LexicalOnlyIndexedFileRefMeta | undefined,
    docRef: number,
    plainText?: string,
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
          await this.persistChunks(
            filePath,
            batchChunks,
            false,
            chunkStart,
            docRef,
            generation,
          ),
      );
    }

    if (option.persistIndices ?? true) {
      await this.persistIndices();
    }
    const ref: HybridIndexedFileRef = {
      docRef,
      state: "lexical_only",
      generation,
      chunkCount: plannedChunks.length,
      vectorPrecision: null,
      indexedAt: Date.now(),
      lastIncrementalEmbedAt: meta?.lastIncrementalEmbedAt,
    };
    if (plainText !== undefined) {
      await this.commitHybridFileIndex({
        snapshot: {
          id: buildHybridGenerationKey(docRef, generation),
          plainText,
          generation,
          docRef,
        },
        ref,
      });
      return;
    }
    await this.putHybridIndexedFileRef(ref);
  }

  private async putHybridIndexedFileRef(
    ref: HybridIndexedFileRef,
  ): Promise<void> {
    await this.fileSnapshotStore.putHybridIndexedFileRef(ref);
    if (isHybridLexicalFallbackState(ref.state)) {
      this._hasStoredLexicalFallbackData = true;
      return;
    }
    await this.refreshStoredQueryCapabilityFromIndexedRefs();
  }

  private async deleteHybridIndexedFileRef(filePath: string): Promise<void> {
    await this.fileSnapshotStore.deleteHybridIndexedFileRef(filePath);
    await this.refreshStoredQueryCapabilityFromIndexedRefs();
  }

  private async refreshStoredQueryCapabilityFromIndexedRefs(): Promise<void> {
    const refs = await this.fileSnapshotStore.listHybridIndexedFileRefs();
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
    await this.db.db.transaction(
      "rw",
      this.db.db.hybridHnswSmall,
      this.db.db.indexArtifactState,
      async () => {
        await this.db.db.hybridHnswSmall.put({
          id: 0,
          data: hnswToBlob(this.hnswSmall.serialize()),
        });
        await this.clearHybridArtifactDirtyState(["hnsw"]);
      },
    );
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
    let lastShardId: string | null = null;
    let append = false;
    while (true) {
      const rows = await profileHybridStage(
        "startup.load_vector_shards",
        async () => {
          if (lastShardId === null) {
            return await this.db.db.hybridChunkVectors
              .orderBy("id")
              .limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
              .toArray();
          }
          return await this.db.db.hybridChunkVectors
            .where("id")
            .above(lastShardId)
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
      lastShardId = rows[rows.length - 1].id;
    }
  }

  private async rebuildHnswFromStore(persist = true): Promise<void> {
    this.hnswSmall.clear(this.precision);
    let lastShardId: string | null = null;

    while (true) {
      const rows: ChunkVectorShardRow[] =
        lastShardId === null
          ? await this.db.db.hybridChunkVectors
              .orderBy("id")
              .limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
              .toArray()
          : await this.db.db.hybridChunkVectors
              .where("id")
              .above(lastShardId)
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
      lastShardId = rows[rows.length - 1].id;
    }

    if (persist) {
      await this.persistHnsw();
    }
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
