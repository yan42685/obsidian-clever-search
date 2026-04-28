export {};

const mockInstanceMap = new Map<any, any>();

jest.mock("src/services/database/database", () => ({
  Database: class Database {},
}));

jest.mock("src/globals/plugin-setting", () => ({
  OuterSetting: class OuterSetting {},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
  DataProvider: class DataProvider {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
  buildIndexedSnapshotRequestKey: (request: { path: string; generation?: number }) =>
    `${request.path}\0${request.generation ?? ""}`,
  FileSnapshotStore: class FileSnapshotStore {},
}));

jest.mock("src/integrations/languages/chinese-patch", () => ({
  ChinesePatch: class ChinesePatch {
    initAsync() {}
    cut(text: string) {
      return [text];
    }
  },
}));

jest.mock("src/utils/web/assets-provider", () => ({
  AssetsProvider: class AssetsProvider {
    assets = {
      stopWordsZh: null,
      stopWordsEn: null,
      jiebaBinary: Promise.resolve(null),
    };
  },
}));

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

jest.mock("src/utils/my-lib", () => ({
  getInstance: jest.fn((token: any) => {
    if (!mockInstanceMap.has(token)) {
      throw new Error(`Missing test instance for token: ${token?.name ?? String(token)}`);
    }
    return mockInstanceMap.get(token);
  }),
}));

jest.mock("src/utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
  },
}));

jest.mock("src/services/search/hybrid/hnsw", () => ({
  HnswIndex: class HnswIndex {
    clear() {}
    delete() {}
    insert() {}
    deserialize() {}
    serialize() {
      return {
        entryPoint: null,
        maxLevel: 0,
        precision: "int8",
        nodes: [],
        deletedSet: [],
      };
    }
    hydrateVectors() {}
    needsRebuild() {
      return false;
    }
    hasDeletedNodes() {
      return false;
    }
    rebuild() {}
    isNonEmpty() {
      return false;
    }
    hasVectors() {
      return false;
    }
    estimateRuntimeMemoryBytes() {
      return {
        vectorBytes: 0,
        graphBytes: 0,
        totalBytes: 0,
      };
    }
  },
}));

jest.mock("src/services/search/hybrid/hybrid-profiler", () => ({
  profileHybridStage: async (_name: string, fn: () => Promise<unknown>) => await fn(),
  recordHybridProfileMetric: jest.fn(),
}));

import {
  chunkVectorShardToRow,
  type ChunkVectorShardRow,
} from "src/services/search/hybrid/hybrid-store";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";

type HybridChunkRow = {
  id?: number;
  docRef: number;
  generation: number;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startCol: number;
  endLine: number;
  embedKey: string;
};

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function cloneRow<Row extends Record<string, unknown>>(row: Row | undefined): Row | undefined {
  return row ? ({ ...row } as Row) : undefined;
}

function createChunkTable(initialRows: HybridChunkRow[] = []) {
  let rows = initialRows.map((row) => ({ ...row }));

  return {
    rows,
    async bulkGet(ids: number[]) {
      return ids.map((id) => cloneRow(rows.find((row) => row.id === id)));
    },
    where(field: string) {
      if (field !== "docRef") {
        throw new Error(`Unsupported chunk field: ${field}`);
      }
      return {
        equals(docRef: number) {
          const filtered = () =>
            rows
              .filter((row) => row.docRef === docRef)
              .map((row) => ({ ...row }));
          return {
            toArray: async () => filtered(),
            count: async () => filtered().length,
            sortBy: async (sortField: keyof HybridChunkRow) =>
              filtered().sort((left, right) =>
                compareValues(left[sortField], right[sortField]),
              ),
          };
        },
      };
    },
    async bulkDelete(ids: number[]) {
      const idSet = new Set(ids);
      rows = rows.filter((row) => row.id === undefined || !idSet.has(row.id));
      this.rows = rows;
    },
    async bulkPut(nextRows: HybridChunkRow[]) {
      const nextById = new Map(
        nextRows
          .filter(
            (row): row is HybridChunkRow & { id: number } => row.id !== undefined,
          )
          .map((row) => [row.id, { ...row }]),
      );
      rows = rows
        .filter((row) => row.id === undefined || !nextById.has(row.id))
        .concat(nextRows.map((row) => ({ ...row })));
      this.rows = rows;
    },
    async clear() {
      rows = [];
      this.rows = rows;
    },
  };
}

function createKeyedTable<Row extends Record<string, unknown>, Key extends keyof Row>(
  key: Key,
  initialRows: Row[] = [],
) {
  const rows = new Map<Row[Key], Row>(
    initialRows.map((row) => [row[key], { ...row }]),
  );

  const sortedRows = () =>
    Array.from(rows.values())
      .map((row) => ({ ...row }))
      .sort((left, right) => compareValues(left[key], right[key]));

  return {
    rows,
    async toArray() {
      return sortedRows();
    },
    async get(value: Row[Key]) {
      return cloneRow(rows.get(value));
    },
    async put(row: Row) {
      rows.set(row[key], { ...row });
    },
    async bulkGet(values: Row[Key][]) {
      return values.map((value) => cloneRow(rows.get(value)));
    },
    async bulkPut(nextRows: Row[]) {
      for (const row of nextRows) {
        rows.set(row[key], { ...row });
      }
    },
    async bulkDelete(values: Row[Key][]) {
      for (const value of values) {
        rows.delete(value);
      }
    },
    async delete(value: Row[Key]) {
      rows.delete(value);
    },
    async clear() {
      rows.clear();
    },
    orderBy(field: string) {
      if (field !== String(key)) {
        throw new Error(`Unsupported orderBy field: ${field}`);
      }
      return {
        offset(count: number) {
          return {
            limit(limit: number) {
              return {
                toArray: async () => sortedRows().slice(count, count + limit),
              };
            },
          };
        },
        limit(limit: number) {
          return {
            toArray: async () => sortedRows().slice(0, limit),
          };
        },
      };
    },
    where(field: string) {
      if (field !== String(key)) {
        throw new Error(`Unsupported where field: ${field}`);
      }
      return {
        above(value: Row[Key]) {
          return {
            limit(limit: number) {
              return {
                toArray: async () =>
                  sortedRows()
                    .filter((row) => compareValues(row[key], value) > 0)
                    .slice(0, limit),
              };
            },
          };
        },
      };
    },
  };
}

describe("HybridEngine artifact state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstanceMap.clear();
  });

  test("rebuilds dirty HNSW artifact from stored rows on load", async () => {
    const chunkTable = createChunkTable([
      {
        id: 11,
        docRef: 1,
        generation: 100,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 5,
        startLine: 0,
        startCol: 0,
        endLine: 0,
        embedKey: "embed-a",
      },
    ]);
    const vectorTable = createKeyedTable<
      ChunkVectorShardRow,
      "id"
    >("id", [
      chunkVectorShardToRow({
        docRef: 1,
        precision: "int8",
        dim: 3,
        chunkCount: 1,
        generation: 100,
        chunkIds: Uint32Array.from([11]),
        vectorData: Int8Array.from([1, 2, 3]),
        scaleData: Float32Array.from([1]),
      }),
    ]);
    const indexedRefTable = createKeyedTable<
      { docRef: number; generation: number; state?: string; chunkCount: number },
      "docRef"
    >("docRef", [
      {
        docRef: 1,
        generation: 100,
        state: "ready",
        chunkCount: 1,
      },
    ]);
    const artifactStateTable = createKeyedTable<
      { id: string; engine: string; artifact: string; dirtyAt: number; reason?: string | null },
      "id"
    >("id", [
      {
        id: buildIndexArtifactStateId("hybrid", "hnsw"),
        engine: "hybrid",
        artifact: "hnsw",
        dirtyAt: 1,
      },
    ]);
    const hnswTable = createKeyedTable<{ id: number; data: Blob }, "id">("id");

    mockInstanceMap.set(require("src/services/database/database").Database, {
      db: {
        transaction: async (_mode: string, ...args: any[]) => {
          const work = args[args.length - 1];
          return await work();
        },
        hybridChunks: chunkTable,
        hybridChunkVectors: vectorTable,
        hybridIndexedFileRefs: indexedRefTable,
        hybridHnswSmall: hnswTable,
        indexArtifactState: artifactStateTable,
      },
    });
    mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
      hybrid: {
        enabled: true,
        vectorCompression: "int8",
        maxResultCount: 10,
        excludedPaths: [],
      },
    });
    mockInstanceMap.set(require("src/services/obsidian/user-data/data-provider").DataProvider, {
      getHeadingOutlineForText: jest.fn(() => []),
    });
    mockInstanceMap.set(
      require("src/services/search/shared/file-snapshot-store").FileSnapshotStore,
      {
        listHybridIndexedFileRefs: jest.fn(async () => await indexedRefTable.toArray()),
      },
    );

    const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
    const engine = new HybridEngine() as any;

    const denseIds = new Set<number>();
    let hasVectors = false;
    engine.hnswSmall = {
      clear: jest.fn(() => {
        denseIds.clear();
        hasVectors = false;
      }),
      delete: jest.fn((id: number) => {
        denseIds.delete(id);
      }),
      insert: jest.fn((id: number) => {
        denseIds.add(id);
        hasVectors = true;
      }),
      deserialize: jest.fn(),
      serialize: jest.fn(() => ({
        entryPoint: denseIds.size > 0 ? Array.from(denseIds)[0] : null,
        maxLevel: 0,
        precision: "int8",
        nodes: Array.from(denseIds).map((id) => [id, { id, level: 0, neighbors: [[]] }]),
        deletedSet: [],
      })),
      hydrateVectors: jest.fn(),
      needsRebuild: jest.fn(() => false),
      hasDeletedNodes: jest.fn(() => false),
      rebuild: jest.fn(),
      isNonEmpty: jest.fn(() => denseIds.size > 0),
      hasVectors: jest.fn(() => hasVectors),
      estimateRuntimeMemoryBytes: jest.fn(() => ({
        vectorBytes: 0,
        graphBytes: 0,
        totalBytes: 0,
      })),
    };

    await engine.load();

    expect(engine.hnswSmall.insert).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ precision: "int8" }),
    );
    expect(await hnswTable.get(0)).toBeDefined();
    expect(await artifactStateTable.get(buildIndexArtifactStateId("hybrid", "hnsw"))).toBeUndefined();
    expect(engine.canSearch()).toBe(true);
  });

  test("canServeQuery stays available after load when stored lexical fallback refs exist", async () => {
    const indexedRefTable = createKeyedTable<
      { path: string; generation: number; state: string },
      "path"
    >("path", [
      {
        path: "notes/a.md",
        generation: 100,
        state: "lexical_only",
      },
    ]);
    const artifactStateTable = createKeyedTable<
      { id: string; engine: string; artifact: string; dirtyAt: number; reason?: string | null },
      "id"
    >("id");
    const hnswTable = createKeyedTable<{ id: number; data: Blob }, "id">("id");

    mockInstanceMap.set(require("src/services/database/database").Database, {
      db: {
        hybridIndexedFileRefs: indexedRefTable,
        hybridHnswSmall: hnswTable,
        indexArtifactState: artifactStateTable,
      },
    });
    mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
      hybrid: {
        enabled: true,
        vectorCompression: "int8",
        maxResultCount: 10,
        excludedPaths: [],
      },
    });
    mockInstanceMap.set(require("src/services/obsidian/user-data/data-provider").DataProvider, {});
    mockInstanceMap.set(
      require("src/services/search/shared/file-snapshot-store").FileSnapshotStore,
      {
        listHybridIndexedFileRefs: jest.fn(async () => await indexedRefTable.toArray()),
      },
    );

    const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
    const engine = new HybridEngine() as any;

    await engine.load();

    expect(engine.isReady()).toBe(true);
    expect(engine.canSearch()).toBe(false);
    expect(engine.isEmpty()).toBe(false);
    expect(engine.canServeQuery()).toBe(true);
  });
});
