import { container } from "tsyringe";

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

jest.mock("src/services/search/hybrid/hnsw", () => ({
  HnswIndex: class HnswIndex {
    clear() {}
    delete() {}
    needsRebuild() {
      return false;
    }
    rebuild() {}
    estimateRuntimeMemoryBytes() {
      return {
        vectorBytes: 0,
        graphBytes: 0,
        totalBytes: 0,
      };
    }
  },
}));

import { Database } from "src/services/database/database";
import { OuterSetting } from "src/globals/plugin-setting";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { HybridEngine } from "src/services/search/hybrid/hybrid-engine";

type HybridChunkRow = {
  id?: number;
  filePath: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  row: number;
  col: number;
  content: string;
  rerankText?: string;
  embedKey?: string;
};

type HybridVectorRow = {
  filePath: string;
  chunkCount: number;
  precision: "int8" | "float16";
  generation?: number;
  data?: Blob;
};

type HybridIndexedFileRefRow = {
  path: string;
  generation: number;
  state?: string;
};

type HybridSnapshotRow = {
  filePath: string;
  plainText: string;
  generation?: number;
};

function createChunkTable(initialRows: HybridChunkRow[] = []) {
  let rows = [...initialRows];

  return {
    rows,
    where(field: string) {
      if (field !== "filePath") {
        throw new Error(`Unsupported chunk field: ${field}`);
      }
      return {
        equals(filePath: string) {
          return {
            toArray: async () =>
              rows.filter((row) => row.filePath === filePath),
            count: async () =>
              rows.filter((row) => row.filePath === filePath).length,
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
            (row): row is HybridChunkRow & { id: number } =>
              row.id !== undefined,
          )
          .map((row) => [row.id, row]),
      );
      rows = rows
        .filter((row) => row.id === undefined || !nextById.has(row.id))
        .concat(nextRows);
      this.rows = rows;
    },
    async clear() {
      rows = [];
      this.rows = rows;
    },
  };
}

function createKeyedTable<
  Row extends Record<string, unknown>,
  Key extends keyof Row,
>(key: Key, initialRows: Row[] = []) {
  const rows = new Map<Row[Key], Row>(
    initialRows.map((row) => [row[key], { ...row }]),
  );

  return {
    rows,
    async get(value: Row[Key]) {
      return rows.get(value);
    },
    async toArray() {
      return Array.from(rows.values());
    },
    async put(row: Row) {
      rows.set(row[key], { ...row });
    },
    async bulkPut(nextRows: Row[]) {
      for (const row of nextRows) {
        rows.set(row[key], { ...row });
      }
    },
    async delete(value: Row[Key]) {
      rows.delete(value);
    },
    async bulkDelete(values: Row[Key][]) {
      for (const value of values) {
        rows.delete(value);
      }
    },
    async clear() {
      rows.clear();
    },
  };
}

function createEngineHarness() {
  const chunkTable = createChunkTable();
  const snapshotTable = createKeyedTable<HybridSnapshotRow, "filePath">(
    "filePath",
  );
  const shadowTable = createKeyedTable<HybridSnapshotRow, "filePath">(
    "filePath",
  );
  const vectorTable = createKeyedTable<HybridVectorRow, "filePath">("filePath");
  const indexedRefTable = createKeyedTable<HybridIndexedFileRefRow, "path">(
    "path",
  );
  const hnswTable = createKeyedTable<{ id: number; data?: Blob }, "id">("id");
  const artifactStateTable = createKeyedTable<
    { id: string; engine: string; artifact: string; dirtyAt: number; reason?: string | null },
    "id"
  >("id");

  const database = {
    db: {
      hybridChunks: chunkTable,
      fileSnapshots: snapshotTable,
      hybridDirtyShadows: shadowTable,
      hybridChunkVectors: vectorTable,
      hybridIndexedFileRefs: indexedRefTable,
      hybridHnswSmall: hnswTable,
      indexArtifactState: artifactStateTable,
    },
  };
  const setting = {
    hybrid: {
      enabled: true,
      vectorCompression: "int8",
      maxResultCount: 10,
      excludedPaths: [],
    },
  };

  const fileSnapshotStore = {
    readIndexedTexts: jest.fn(async () => new Map<string, string>()),
    publishIndexedTexts: jest.fn(
      async (
        files: ReadonlyArray<{
          path: string;
          generation?: number;
          text?: string;
        }>,
      ) => {
        for (const file of files) {
          if (file.text === undefined) {
            continue;
          }
          await snapshotTable.put({
            filePath: file.path,
            plainText: file.text,
            generation: file.generation,
          });
        }
      },
    ),
    notifyHybridIndexedRefsChanged: jest.fn(async (filePaths?: readonly string[]) => {
      const paths =
        filePaths !== undefined
          ? Array.from(new Set(filePaths))
          : Array.from(shadowTable.rows.keys());
      for (const path of paths) {
        const shadowRow = await shadowTable.get(path);
        if (!shadowRow) {
          continue;
        }
        const indexedRef = await indexedRefTable.get(path);
        const snapshotRow = await snapshotTable.get(path);
        const shouldKeep =
          indexedRef?.generation !== undefined &&
          shadowRow.generation !== undefined &&
          shadowRow.generation === indexedRef.generation &&
          snapshotRow?.generation !== indexedRef.generation;
        if (!shouldKeep) {
          await shadowTable.delete(path);
        }
      }
    }),
  };

  container.registerInstance(Database, database as any);
  container.registerInstance(OuterSetting, setting as any);
  container.registerInstance(DataProvider, {} as any);
  container.registerInstance(FileSnapshotStore, fileSnapshotStore as any);

  const engine = new HybridEngine() as any;
  engine.hnswSmall = {
    clear: jest.fn(),
    delete: jest.fn(),
    needsRebuild: jest.fn(() => false),
    rebuild: jest.fn(),
  };

  return {
    engine: engine as HybridEngine,
    chunkTable,
    snapshotTable,
    shadowTable,
    vectorTable,
    indexedRefTable,
    hnswTable,
    artifactStateTable,
    fileSnapshotStore,
  };
}

describe("HybridEngine shared snapshot ownership", () => {
  beforeEach(() => {
    if (
      "reset" in container &&
      typeof (container as any).reset === "function"
    ) {
      (container as any).reset();
    } else {
      container.clearInstances();
    }
  });

  afterEach(() => {
    if (
      "reset" in container &&
      typeof (container as any).reset === "function"
    ) {
      (container as any).reset();
    } else {
      container.clearInstances();
    }
    jest.restoreAllMocks();
  });

  test("deleteFile removes only hybrid-private state and preserves shared snapshots", async () => {
    const { engine, chunkTable, snapshotTable, shadowTable, vectorTable, indexedRefTable, fileSnapshotStore } =
      createEngineHarness();

    chunkTable.rows.push(
      {
        id: 11,
        filePath: "docs/a.md",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 5,
        row: 0,
        col: 0,
        content: "alpha",
      },
      {
        id: 12,
        filePath: "docs/a.md",
        chunkIndex: 1,
        startOffset: 6,
        endOffset: 10,
        row: 1,
        col: 0,
        content: "beta",
      },
    );
    await snapshotTable.put({
      filePath: "docs/a.md",
      plainText: "alpha beta",
      generation: 100,
    });
    await vectorTable.put({
      filePath: "docs/a.md",
      chunkCount: 2,
      precision: "int8",
      generation: 100,
    });
    await shadowTable.put({
      filePath: "docs/a.md",
      plainText: "stale hybrid shadow",
      generation: 90,
    });
    await indexedRefTable.put({
      path: "docs/a.md",
      generation: 100,
      state: "ready",
    });

    await engine.deleteFile("docs/a.md", { persistIndices: false });

    expect(await snapshotTable.get("docs/a.md")).toEqual({
      filePath: "docs/a.md",
      plainText: "alpha beta",
      generation: 100,
    });
    expect(await shadowTable.get("docs/a.md")).toBeUndefined();
    expect(chunkTable.rows).toEqual([]);
    expect(await vectorTable.get("docs/a.md")).toBeUndefined();
    expect(await indexedRefTable.get("docs/a.md")).toBeUndefined();
    expect((engine as any).hnswSmall.delete).toHaveBeenCalledWith(11);
    expect((engine as any).hnswSmall.delete).toHaveBeenCalledWith(12);
  });

  test("clearAll keeps shared snapshots while clearing hybrid-private tables", async () => {
    const {
      engine,
      chunkTable,
      snapshotTable,
      shadowTable,
      vectorTable,
      indexedRefTable,
      hnswTable,
    } = createEngineHarness();

    chunkTable.rows.push({
      id: 21,
      filePath: "docs/a.md",
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 4,
      row: 0,
      col: 0,
      content: "keep",
    });
    await snapshotTable.put({
      filePath: "docs/a.md",
      plainText: "keep snapshot",
      generation: 200,
    });
    await vectorTable.put({
      filePath: "docs/a.md",
      chunkCount: 1,
      precision: "int8",
      generation: 200,
    });
    await shadowTable.put({
      filePath: "docs/a.md",
      plainText: "shadow snapshot",
      generation: 190,
    });
    await indexedRefTable.put({
      path: "docs/a.md",
      generation: 200,
      state: "ready",
    });
    await hnswTable.put({ id: 0 });

    await engine.clearAll();

    expect(await snapshotTable.get("docs/a.md")).toEqual({
      filePath: "docs/a.md",
      plainText: "keep snapshot",
      generation: 200,
    });
    expect(await shadowTable.get("docs/a.md")).toBeUndefined();
    expect(chunkTable.rows).toEqual([]);
    expect(shadowTable.rows.size).toBe(0);
    expect(vectorTable.rows.size).toBe(0);
    expect(indexedRefTable.rows.size).toBe(0);
    expect(hnswTable.rows.size).toBe(0);
    expect((engine as any).hnswSmall.clear).toHaveBeenCalledWith("int8");
  });

  test("moveFile rewrites only hybrid-private rows and leaves shared snapshots untouched", async () => {
    const { engine, chunkTable, snapshotTable, shadowTable, vectorTable, indexedRefTable, fileSnapshotStore } =
      createEngineHarness();

    chunkTable.rows.push(
      {
        id: 31,
        filePath: "docs/old.md",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 3,
        row: 0,
        col: 0,
        content: "old",
      },
      {
        id: 32,
        filePath: "docs/new.md",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 5,
        row: 0,
        col: 0,
        content: "stale",
      },
    );
    await snapshotTable.put({
      filePath: "docs/old.md",
      plainText: "old lexical snapshot",
      generation: 300,
    });
    await snapshotTable.put({
      filePath: "docs/new.md",
      plainText: "new lexical snapshot",
      generation: 301,
    });
    await shadowTable.put({
      filePath: "docs/old.md",
      plainText: "old hybrid shadow",
      generation: 299,
    });
    await shadowTable.put({
      filePath: "docs/new.md",
      plainText: "new hybrid shadow",
      generation: 298,
    });
    await vectorTable.put({
      filePath: "docs/old.md",
      chunkCount: 1,
      precision: "int8",
      generation: 300,
    });
    await vectorTable.put({
      filePath: "docs/new.md",
      chunkCount: 1,
      precision: "int8",
      generation: 299,
    });
    await indexedRefTable.put({
      path: "docs/old.md",
      generation: 300,
      state: "ready",
    });
    await indexedRefTable.put({
      path: "docs/new.md",
      generation: 299,
      state: "ready",
    });

    const moved = await engine.moveFile("docs/old.md", "docs/new.md", 400);

    expect(moved).toBe(true);
    expect(chunkTable.rows).toEqual([
      expect.objectContaining({
        id: 31,
        filePath: "docs/new.md",
      }),
    ]);
    expect(await vectorTable.get("docs/old.md")).toBeUndefined();
    expect(await vectorTable.get("docs/new.md")).toEqual(
      expect.objectContaining({
        filePath: "docs/new.md",
        generation: 300,
      }),
    );
    expect(await indexedRefTable.get("docs/old.md")).toBeUndefined();
    expect(await indexedRefTable.get("docs/new.md")).toEqual(
      expect.objectContaining({
        path: "docs/new.md",
        generation: 400,
      }),
    );
    expect(await snapshotTable.get("docs/old.md")).toEqual({
      filePath: "docs/old.md",
      plainText: "old lexical snapshot",
      generation: 300,
    });
    expect(await snapshotTable.get("docs/new.md")).toEqual({
      filePath: "docs/new.md",
      plainText: "new lexical snapshot",
      generation: 301,
    });
    expect(await shadowTable.get("docs/old.md")).toBeUndefined();
    expect(await shadowTable.get("docs/new.md")).toBeUndefined();
    expect(fileSnapshotStore.notifyHybridIndexedRefsChanged).toHaveBeenCalledWith([
      "docs/old.md",
      "docs/new.md",
    ]);
  });
});


