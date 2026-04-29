jest.mock("src/services/search/hybrid/embedder", () => ({
  Embedder: class Embedder {},
  NoApiKeyError: class NoApiKeyError extends Error {},
  WeeklyTokenLimitExceededError: class WeeklyTokenLimitExceededError extends Error {},
  estimateTextsTokenUsage: jest.fn(() => 0),
  recordEstimatedTokenSavings: jest.fn(),
}));

jest.mock("src/services/search/hybrid/reranker", () => ({
  HybridReranker: class HybridReranker {},
  SEARCH_EMBED_TOKEN_KEY: "search_embed_tokens",
}));

jest.mock("src/services/search/hybrid/hnsw", () => ({
  HnswIndex: class HnswIndex {},
}));

jest.mock("src/services/search/hybrid/hybrid-profiler", () => ({
  profileHybridStage: async (_name: string, fn: () => Promise<unknown>) => await fn(),
  recordHybridProfileMetric: jest.fn(),
}));

jest.mock("src/services/search/hybrid/lexical-lane", () => ({
  buildHybridLexicalLaneFileItems: jest.fn(),
  buildHybridLexicalLaneFileShortlist: jest.fn(),
  HYBRID_LEXICAL_LANE_FILE_SHORTLIST: 30,
  prepareHybridLexicalLaneSearch: jest.fn(),
}));

jest.mock("src/services/search/hybrid/hybrid-consistency", () => ({
  analyzeHybridStoredFileConsistency: jest.fn(),
}));

jest.mock("src/utils/my-lib", () => ({
  getInstance: jest.fn(() => ({})),
  monitorDecorator: jest.fn(
    () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) =>
      descriptor,
  ),
}));

jest.mock("src/utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
  },
}));

import { HybridEngine } from "src/services/search/hybrid/hybrid-engine";

describe("HybridEngine strict indexing", () => {
  function createEngineWithFailingEmbedding() {
    const embeddingError = new Error("embedding unavailable");
    const engine = Object.create(HybridEngine.prototype) as any;

    engine.setting = {
      hybrid: {
        vectorCompression: "int8",
      },
    };
    engine._canSearch = true;
    engine.lastIndexingFallbackNoticeKey = "hybridNotice.indexingFallbackToLexical";
    engine.withFileWriteLock = jest.fn(
      async (_filePath: string, fn: () => Promise<void>) => await fn(),
    );
    engine.shouldIndexPath = jest.fn(() => true);
    engine.fileSnapshotStore = {
      ensureDocRegistryEntry: jest.fn(async () => ({ docRef: 42 })),
      getHybridIndexedFileRef: jest.fn(async () => ({
        docRef: 42,
        generation: 6,
        lastIncrementalEmbedAt: 123,
      })),
    };
    engine.markHybridArtifactsDirty = jest.fn(async () => undefined);
    engine.loadStoredFileIndexState = jest.fn(async () => undefined);
    engine.getReusableStoredFileIndexState = jest.fn(() => undefined);
    engine.putHybridIndexedFileRef = jest.fn(async () => undefined);
    engine.deleteStoredHybridGenerationArtifacts = jest.fn(async () => undefined);
    engine.planIncrementalChunks = jest.fn(async () => [
      {
        chunkIndex: 0,
        text: "alpha beta",
        startOffset: 0,
        endOffset: 10,
        startLine: 0,
        startCol: 0,
        endLine: 0,
        endCol: 10,
      },
    ]);
    engine.resolveBatchVectors = jest.fn(async () => {
      throw embeddingError;
    });
    engine.persistChunks = jest.fn();
    engine.persistSnapshot = jest.fn();
    engine.persistVectorShard = jest.fn();
    engine.hnswSmall = { insert: jest.fn() };
    engine.indexLexicalOnly = jest.fn(async () => undefined);

    return { engine, embeddingError };
  }

  test("indexFileStrict rejects embedding failures instead of committing lexical-only success", async () => {
    const { engine, embeddingError } = createEngineWithFailingEmbedding();

    await expect(
      engine.indexFileStrict("notes/strict.md", "alpha beta", 7, {
        persistIndices: false,
      }),
    ).rejects.toBe(embeddingError);

    expect(engine.indexLexicalOnly).not.toHaveBeenCalled();
    expect(engine.putHybridIndexedFileRef).toHaveBeenLastCalledWith(
      expect.objectContaining({
        docRef: 42,
        state: "failed",
        generation: 7,
        chunkCount: 0,
        vectorPrecision: null,
        lastIncrementalEmbedAt: 123,
      }),
    );
    expect(engine._canSearch).toBe(false);
    expect(engine.lastIndexingFallbackNoticeKey).toBeNull();
  });

  test("indexFile keeps lexical-only fallback for non-strict embedding failures", async () => {
    const { engine } = createEngineWithFailingEmbedding();

    await expect(
      engine.indexFile("notes/fallback.md", "alpha beta", 7),
    ).resolves.toBeUndefined();

    expect(engine.indexLexicalOnly).toHaveBeenCalledWith(
      "notes/fallback.md",
      expect.any(Array),
      7,
      {},
      undefined,
      42,
      "alpha beta",
    );
  });
});
