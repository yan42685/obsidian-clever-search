import "fake-indexeddb/auto";

import Dexie from "dexie";

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
  monitorDecorator: jest.fn(() => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor),
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

describe("HybridEngine per-file atomic commit", () => {
  let db: Dexie & {
    fileSnapshots: Dexie.Table<any, string>;
    hybridIndexedFileRefs: Dexie.Table<any, string>;
    hybridDirtyShadows: Dexie.Table<any, string>;
  };

  beforeEach(async () => {
    db = new Dexie(`hybrid-atomic-commit-${Date.now()}-${Math.random()}`) as typeof db;
    db.version(1).stores({
      fileSnapshots: "filePath",
      hybridIndexedFileRefs: "path",
      hybridDirtyShadows: "filePath",
    });
    await db.open();
  });

  afterEach(async () => {
    const name = db.name;
    db.close();
    await Dexie.delete(name);
  });

  test("flips the ready ref only with the final snapshot commit", async () => {
    const filePath = "notes/atomic.md";
    const notifyHybridIndexedRefsChanged = jest.fn(async () => undefined);
    const engine = Object.create(HybridEngine.prototype) as {
      db: { db: typeof db };
      fileSnapshotStore: {
        notifyHybridIndexedRefsChanged: jest.Mock;
        listHybridIndexedFileRefs: jest.Mock;
      };
      commitHybridFileIndex(params: unknown): Promise<void>;
      _hasStoredLexicalFallbackData: boolean;
    };

    engine.db = { db };
    engine.fileSnapshotStore = {
      notifyHybridIndexedRefsChanged,
      listHybridIndexedFileRefs: jest.fn(async () => []),
    };
    engine._hasStoredLexicalFallbackData = false;

    await db.hybridIndexedFileRefs.put({
      path: filePath,
      state: "pending",
      generation: 6,
      chunkCount: 0,
      vectorPrecision: null,
      indexedAt: 100,
    });
    await db.hybridDirtyShadows.put({
      filePath,
      updatedAt: 100,
    });

    await engine.commitHybridFileIndex({
      snapshot: {
        filePath,
        plainText: "atomic commit body",
        generation: 7,
        docRef: 42,
      },
      ref: {
        docRef: 42,
        path: filePath,
        state: "ready",
        generation: 7,
        chunkCount: 3,
        vectorPrecision: "fp32",
        indexedAt: 200,
        lastIncrementalEmbedAt: 200,
      },
    });

    await expect(db.fileSnapshots.get(filePath)).resolves.toMatchObject({
      filePath,
      plainText: "atomic commit body",
      generation: 7,
      docRef: 42,
    });
    await expect(db.hybridIndexedFileRefs.get(filePath)).resolves.toMatchObject({
      path: filePath,
      state: "ready",
      generation: 7,
      chunkCount: 3,
    });
    await expect(db.hybridDirtyShadows.get(filePath)).resolves.toBeUndefined();
    expect(notifyHybridIndexedRefsChanged).toHaveBeenCalledWith([filePath]);
    expect(engine._hasStoredLexicalFallbackData).toBe(true);
  });

  test("filters dense candidates until the ready ref generation is flipped", async () => {
    const filePath = "notes/pending.md";
    const engine = Object.create(HybridEngine.prototype) as {
      isDenseCandidateCoveredByLexical: jest.Mock;
      buildDenseDisplayCandidate: jest.Mock;
      recallDenseDisplayCandidates(
        query: string,
        lexicalCandidates: readonly unknown[],
        limit: number,
      ): Promise<unknown[]>;
      _canSearch: boolean;
      setting: { hybrid: { vectorCompression: string } };
      embedder: { embedQuery: jest.Mock };
      hnswSmall: { search: jest.Mock };
      db: { db: { hybridChunks: { bulkGet: jest.Mock } } };
      fileSnapshotStore: {
        getHybridIndexedFileRefs: jest.Mock;
        readIndexedTextSnapshots: jest.Mock;
      };
    };

    engine._canSearch = true;
    engine.setting = { hybrid: { vectorCompression: "int8" } };
    engine.embedder = { embedQuery: jest.fn(async () => new Float32Array([1])) };
    engine.hnswSmall = { search: jest.fn(() => [{ id: 1, score: 0.9 }]) };
    engine.db = {
      db: {
        hybridChunks: {
          bulkGet: jest.fn(async () => [
            {
              id: 1,
              filePath,
              generation: 7,
              chunkIndex: 0,
              startOffset: 0,
              endOffset: 4,
              startLine: 0,
              startCol: 0,
              endLine: 0,
              embedKey: "k",
            },
          ]),
        },
      },
    };
    engine.fileSnapshotStore = {
      getHybridIndexedFileRefs: jest.fn(async () =>
        new Map([
          [
            filePath,
            {
              path: filePath,
              state: "pending",
              generation: 7,
            },
          ],
        ]),
      ),
      readIndexedTextSnapshots: jest.fn(async () =>
        new Map([
          [
            filePath,
            {
              text: "body",
              generation: 7,
              source: "snapshot",
            },
          ],
        ]),
      ),
    };
    engine.isDenseCandidateCoveredByLexical = jest.fn(() => false);
    engine.buildDenseDisplayCandidate = jest.fn(() => ({ filePath }));

    await expect(
      engine.recallDenseDisplayCandidates("query", [], 10),
    ).resolves.toEqual([]);
    expect(engine.buildDenseDisplayCandidate).not.toHaveBeenCalled();

    engine.fileSnapshotStore.getHybridIndexedFileRefs.mockResolvedValueOnce(
      new Map([
        [
          filePath,
          {
            path: filePath,
            state: "ready",
            generation: 7,
          },
        ],
      ]),
    );

    await expect(
      engine.recallDenseDisplayCandidates("query", [], 10),
    ).resolves.toEqual([{ filePath }]);
    expect(engine.buildDenseDisplayCandidate).toHaveBeenCalledTimes(1);
  });
});
