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
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";

describe("HybridEngine per-file atomic commit", () => {
  let db: Dexie & {
    fileSnapshots: Dexie.Table<any, string>;
    hybridIndexedFileRefs: Dexie.Table<any, number>;
    hybridDirtyShadows: Dexie.Table<any, string>;
    docRegistry: Dexie.Table<any, number>;
  };

  beforeEach(async () => {
    db = new Dexie(`hybrid-atomic-commit-${Date.now()}-${Math.random()}`) as typeof db;
    db.version(1).stores({
      fileSnapshots: "id, docRef, generation, [docRef+generation]",
      hybridIndexedFileRefs: "docRef, generation, state",
      hybridDirtyShadows: "id, docRef, generation, [docRef+generation]",
      docRegistry: "docRef, path, deleted, liveGeneration, denseReadyGeneration, denseTargetGeneration, denseState, denseServeUntil, updatedAt",
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

    await db.docRegistry.put({
      docRef: 42,
      path: filePath,
      deleted: false,
      liveGeneration: 7,
      updatedAt: 50,
    });
    await db.hybridIndexedFileRefs.put({
      docRef: 42,
      state: "ready",
      generation: 6,
      chunkCount: 1,
      vectorPrecision: null,
      indexedAt: 100,
    });
    await db.hybridDirtyShadows.put({
      id: "42:7",
      docRef: 42,
      generation: 7,
      plainText: "dirty",
    });

    await engine.commitHybridFileIndex({
      snapshot: {
        id: "42:7",
        plainText: "atomic commit body",
        generation: 7,
        docRef: 42,
      },
      ref: {
        docRef: 42,
        state: "ready",
        generation: 7,
        chunkCount: 3,
        vectorPrecision: "fp32",
        indexedAt: 200,
        lastIncrementalEmbedAt: 200,
      },
    });

    await expect(db.fileSnapshots.get("42:7")).resolves.toMatchObject({
      id: "42:7",
      plainText: "atomic commit body",
      generation: 7,
      docRef: 42,
    });
    await expect(db.hybridIndexedFileRefs.get(42)).resolves.toMatchObject({
      docRef: 42,
      state: "ready",
      generation: 7,
      chunkCount: 3,
    });
    await expect(db.hybridDirtyShadows.get("42:7")).resolves.toBeUndefined();
    await expect(db.docRegistry.get(42)).resolves.toMatchObject({
      denseReadyGeneration: 7,
      denseTargetGeneration: 7,
      denseState: "ready",
      lastDenseSuccessAt: 200,
    });
    expect(notifyHybridIndexedRefsChanged).toHaveBeenCalled();
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
      db: {
        db: {
          hybridChunks: { bulkGet: jest.Mock };
          docRegistry: { bulkGet: jest.Mock };
          hybridIndexedFileRefs: { bulkGet: jest.Mock };
          hybridDirtyShadows: { get: jest.Mock };
        };
      };
      fileSnapshotStore: {
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
              docRef: 42,
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
        docRegistry: {
          bulkGet: jest.fn(async () => [
            {
              docRef: 42,
              path: filePath,
              deleted: false,
              liveGeneration: 7,
            },
          ]),
        },
        hybridIndexedFileRefs: {
          bulkGet: jest.fn(async () => [
            {
              docRef: 42,
              state: "pending",
              generation: 7,
            },
          ]),
        },
        hybridDirtyShadows: {
          get: jest.fn(async () => undefined),
        },
      },
    };
    engine.fileSnapshotStore = {
      readIndexedTextSnapshots: jest.fn(async () =>
        new Map([
          [
            buildIndexedSnapshotRequestKey({
              path: filePath,
              generation: 7,
            }),
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

    engine.db.db.hybridIndexedFileRefs.bulkGet.mockResolvedValueOnce([
      {
        docRef: 42,
        state: "ready",
        generation: 7,
      },
    ]);

    await expect(
      engine.recallDenseDisplayCandidates("query", [], 10),
    ).resolves.toEqual([{ filePath }]);
    expect(engine.buildDenseDisplayCandidate).toHaveBeenCalledTimes(1);
  });

  test("serves stale dense candidates only with a matching unexpired shadow", async () => {
    const filePath = "notes/stale-shadow.md";
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
      db: {
        db: {
          hybridChunks: { bulkGet: jest.Mock };
          docRegistry: { bulkGet: jest.Mock };
          hybridIndexedFileRefs: { bulkGet: jest.Mock };
          hybridDirtyShadows: { get: jest.Mock };
        };
      };
      fileSnapshotStore: {
        readIndexedTextSnapshots: jest.Mock;
      };
    };

    engine._canSearch = true;
    engine.setting = { hybrid: { vectorCompression: "int8" } };
    engine.embedder = { embedQuery: jest.fn(async () => new Float32Array([1])) };
    engine.hnswSmall = { search: jest.fn(() => [{ id: 7, score: 0.8 }]) };
    engine.db = {
      db: {
        hybridChunks: {
          bulkGet: jest.fn(async () => [
            {
              id: 7,
              docRef: 42,
              generation: 7,
              chunkIndex: 0,
              startOffset: 0,
              endOffset: 11,
              startLine: 0,
              startCol: 0,
              endLine: 0,
              embedKey: "k",
            },
          ]),
        },
        docRegistry: {
          bulkGet: jest.fn(async () => [
            {
              docRef: 42,
              path: filePath,
              deleted: false,
              liveGeneration: 8,
              denseServeUntil: Date.now() + 60_000,
            },
          ]),
        },
        hybridIndexedFileRefs: {
          bulkGet: jest.fn(async () => [
            {
              docRef: 42,
              state: "ready",
              generation: 7,
            },
          ]),
        },
        hybridDirtyShadows: {
          get: jest.fn(async () => ({
            id: "42:7",
            docRef: 42,
            generation: 7,
            plainText: "shadow body",
          })),
        },
      },
    };
    engine.fileSnapshotStore = {
      readIndexedTextSnapshots: jest.fn(async () => new Map()),
    };
    engine.isDenseCandidateCoveredByLexical = jest.fn(() => false);
    engine.buildDenseDisplayCandidate = jest.fn(() => ({ filePath }));

    await expect(
      engine.recallDenseDisplayCandidates("query", [], 10),
    ).resolves.toEqual([{ filePath }]);
    expect(engine.buildDenseDisplayCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ docRef: 42, generation: 7 }),
      filePath,
      0.8,
      "shadow body",
      expect.any(Array),
      7,
      "shadow",
    );
  });

  test("rejects stale dense candidates when shadow is missing, mismatched, or expired", async () => {
    const filePath = "notes/stale-shadow-missing.md";
    const makeEngine = (options: {
      denseServeUntil?: number;
      shadow?: unknown;
    }) => {
      const engine = Object.create(HybridEngine.prototype) as any;
      engine._canSearch = true;
      engine.setting = { hybrid: { vectorCompression: "int8" } };
      engine.embedder = { embedQuery: jest.fn(async () => new Float32Array([1])) };
      engine.hnswSmall = { search: jest.fn(() => [{ id: 7, score: 0.8 }]) };
      engine.db = {
        db: {
          hybridChunks: {
            bulkGet: jest.fn(async () => [
              {
                id: 7,
                docRef: 42,
                generation: 7,
                chunkIndex: 0,
                startOffset: 0,
                endOffset: 11,
                startLine: 0,
                startCol: 0,
                endLine: 0,
                embedKey: "k",
              },
            ]),
          },
          docRegistry: {
            bulkGet: jest.fn(async () => [
              {
                docRef: 42,
                path: filePath,
                deleted: false,
                liveGeneration: 8,
                denseServeUntil: options.denseServeUntil,
              },
            ]),
          },
          hybridIndexedFileRefs: {
            bulkGet: jest.fn(async () => [
              {
                docRef: 42,
                state: "ready",
                generation: 7,
              },
            ]),
          },
          hybridDirtyShadows: {
            get: jest.fn(async () => options.shadow),
          },
        },
      };
      engine.fileSnapshotStore = {
        readIndexedTextSnapshots: jest.fn(async () => new Map()),
      };
      engine.isDenseCandidateCoveredByLexical = jest.fn(() => false);
      engine.buildDenseDisplayCandidate = jest.fn(() => ({ filePath }));
      return engine;
    };

    for (const engine of [
      makeEngine({ denseServeUntil: Date.now() + 60_000 }),
      makeEngine({
        denseServeUntil: Date.now() + 60_000,
        shadow: {
          id: "42:6",
          docRef: 42,
          generation: 6,
          plainText: "wrong generation",
        },
      }),
      makeEngine({
        denseServeUntil: Date.now() - 1,
        shadow: {
          id: "42:7",
          docRef: 42,
          generation: 7,
          plainText: "expired",
        },
      }),
    ]) {
      await expect(
        engine.recallDenseDisplayCandidates("query", [], 10),
      ).resolves.toEqual([]);
      expect(engine.buildDenseDisplayCandidate).not.toHaveBeenCalled();
    }
  });
});
