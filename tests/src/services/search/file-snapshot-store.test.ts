const mockInstanceMap = new Map<any, any>();

jest.mock("obsidian", () => {
  class TAbstractFile {
    path: string;
    name: string;

    constructor(path: string) {
      this.path = path;
      this.name = path.split("/").pop() ?? path;
    }
  }

  class TFile extends TAbstractFile {
    stat: { mtime: number; size: number };
    basename: string;
    extension: string;

    constructor(path: string, text = "", mtime = Date.now()) {
      super(path);
      this.stat = {
        mtime,
        size: Buffer.byteLength(text, "utf8"),
      };
      const dotIndex = this.name.lastIndexOf(".");
      this.basename = dotIndex >= 0 ? this.name.slice(0, dotIndex) : this.name;
      this.extension = dotIndex >= 0 ? this.name.slice(dotIndex + 1) : "";
    }
  }

  return {
    TAbstractFile,
    TFile,
    Vault: class Vault {},
    htmlToMarkdown(text: string) {
      return text;
    },
  };
});

jest.mock("src/services/database/database", () => ({
  Database: class Database {},
}));

jest.mock("src/utils/my-lib", () => ({
  getInstance: jest.fn((token: unknown) => {
    if (!mockInstanceMap.has(token)) {
      throw new Error(`Missing test instance for token: ${String(token)}`);
    }
    return mockInstanceMap.get(token);
  }),
}));

import { TFile, Vault } from "obsidian";
import { Database } from "src/services/database/database";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";

type SnapshotRow = {
  filePath: string;
  plainText: string;
  generation?: number;
};

type HybridIndexedFileRefRow = {
  path: string;
  generation?: number;
  state?: string;
};

function createFilePathTable(initialRows: SnapshotRow[] = []) {
  const rows = new Map<string, SnapshotRow>(
    initialRows.map((row) => [row.filePath, { ...row }]),
  );
  const sortedRows = () =>
    Array.from(rows.values())
      .map((row) => ({ ...row }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath));

  return {
    rows,
    async get(path: string) {
      const row = rows.get(path);
      return row ? { ...row } : undefined;
    },
    async bulkGet(paths: readonly string[]) {
      return paths.map((path) => {
        const row = rows.get(path);
        return row ? { ...row } : undefined;
      });
    },
    async bulkPut(nextRows: SnapshotRow[]) {
      for (const row of nextRows) {
        rows.set(row.filePath, { ...row });
      }
    },
    async bulkDelete(paths: readonly string[]) {
      for (const path of paths) {
        rows.delete(path);
      }
    },
    orderBy(field: string) {
      if (field !== ":id") {
        throw new Error(`Unsupported orderBy field: ${field}`);
      }
      return {
        limit(limit: number) {
          return {
            toArray: async () => sortedRows().slice(0, limit),
          };
        },
      };
    },
    where(field: string) {
      if (field !== ":id") {
        throw new Error(`Unsupported where field: ${field}`);
      }
      return {
        above(lastPath: string) {
          return {
            limit(limit: number) {
              return {
                toArray: async () =>
                  sortedRows()
                    .filter((row) => row.filePath.localeCompare(lastPath) > 0)
                    .slice(0, limit),
              };
            },
          };
        },
      };
    },
  };
}

function createHybridIndexedRefTable(initialRows: HybridIndexedFileRefRow[] = []) {
  const rows = new Map<string, HybridIndexedFileRefRow>(
    initialRows.map((row) => [row.path, { ...row }]),
  );
  const sortedRows = () =>
    Array.from(rows.values())
      .map((row) => ({ ...row }))
      .sort((left, right) => left.path.localeCompare(right.path));

  return {
    rows,
    async get(path: string) {
      const row = rows.get(path);
      return row ? { ...row } : undefined;
    },
    async bulkGet(paths: readonly string[]) {
      return paths.map((path) => {
        const row = rows.get(path);
        return row ? { ...row } : undefined;
      });
    },
    async bulkPut(nextRows: HybridIndexedFileRefRow[]) {
      for (const row of nextRows) {
        rows.set(row.path, { ...row });
      }
    },
    async bulkDelete(paths: readonly string[]) {
      for (const path of paths) {
        rows.delete(path);
      }
    },
    orderBy(field: string) {
      if (field !== ":id") {
        throw new Error(`Unsupported orderBy field: ${field}`);
      }
      return {
        limit(limit: number) {
          return {
            toArray: async () => sortedRows().slice(0, limit),
          };
        },
      };
    },
    where(field: string) {
      if (field !== ":id") {
        throw new Error(`Unsupported where field: ${field}`);
      }
      return {
        above(lastPath: string) {
          return {
            limit(limit: number) {
              return {
                toArray: async () =>
                  sortedRows()
                    .filter((row) => row.path.localeCompare(lastPath) > 0)
                    .slice(0, limit),
              };
            },
          };
        },
      };
    },
  };
}

function createStoreHarness(options?: {
  files?: TFile[];
  fileSnapshots?: SnapshotRow[];
  hybridDirtyShadows?: SnapshotRow[];
  hybridIndexedFileRefs?: HybridIndexedFileRefRow[];
  reads?: Record<string, string>;
}) {
  const files = new Map<string, TFile>(
    (options?.files ?? []).map((file) => [file.path, file]),
  );
  const fileSnapshots = createFilePathTable(options?.fileSnapshots);
  const hybridDirtyShadows = createFilePathTable(options?.hybridDirtyShadows);
  const hybridIndexedFileRefs = createHybridIndexedRefTable(
    options?.hybridIndexedFileRefs,
  );
  const reads = options?.reads ?? {};
  const cachedRead = jest.fn(async (file: TFile) => reads[file.path] ?? "");
  const vault = {
    getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
    cachedRead,
  };
  const database = {
    db: {
      fileSnapshots,
      hybridDirtyShadows,
      hybridIndexedFileRefs,
    },
  };

  mockInstanceMap.clear();
  mockInstanceMap.set(Vault, vault);
  mockInstanceMap.set(Database, database);
  const store = new FileSnapshotStore() as FileSnapshotStore & {
    currentFileCache?: Map<string, { text: string; generation?: number }>;
  };
  store.currentFileCache ??= new Map();

  return {
    store,
    vault,
    database,
  };
}

describe("FileSnapshotStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstanceMap.clear();
  });

  test("readCurrentTexts falls back to latest vault text for current reads", async () => {
    const file = new TFile("docs/live.md", "latest body", 200);
    const { store, vault } = createStoreHarness({
      files: [file],
      fileSnapshots: [
        {
          filePath: file.path,
          plainText: "stale indexed body",
          generation: 100,
        },
      ],
      reads: {
        [file.path]: "latest body",
      },
    });

    const texts = await store.readCurrentTexts([file]);

    expect(texts.get(file.path)).toBe("latest body");
    expect(vault.cachedRead).toHaveBeenCalledTimes(1);
  });

  test("readIndexedTexts does not fall back to newer vault text when no aligned indexed generation exists", async () => {
    const file = new TFile("docs/generation-mismatch.md", "latest body", 200);
    const { store, vault } = createStoreHarness({
      files: [file],
      fileSnapshots: [
        {
          filePath: file.path,
          plainText: "old indexed body",
          generation: 100,
        },
      ],
      reads: {
        [file.path]: "latest body",
      },
    });

    const texts = await store.readIndexedTexts([
      { path: file.path, generation: 150 },
    ]);

    expect(texts.has(file.path)).toBe(false);
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });

  test("readIndexedTexts serves matching hybrid shadow text before newer snapshot generation", async () => {
    const file = new TFile("docs/shadow.md", "latest body", 300);
    const { store, vault } = createStoreHarness({
      files: [file],
      fileSnapshots: [
        {
          filePath: file.path,
          plainText: "new indexed body",
          generation: 300,
        },
      ],
      hybridDirtyShadows: [
        {
          filePath: file.path,
          plainText: "shadow body",
          generation: 200,
        },
      ],
      reads: {
        [file.path]: "latest body",
      },
    });

    const texts = await store.readIndexedTexts([
      { path: file.path, generation: 200 },
    ]);

    expect(texts.get(file.path)).toBe("shadow body");
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });

  test("retainOnlyFiles also removes stale hybrid indexed refs", async () => {
    const keepPath = "docs/keep.md";
    const stalePath = "docs/stale.md";
    const { store, database } = createStoreHarness({
      fileSnapshots: [
        {
          filePath: keepPath,
          plainText: "keep",
          generation: 100,
        },
        {
          filePath: stalePath,
          plainText: "stale",
          generation: 90,
        },
      ],
      hybridDirtyShadows: [
        {
          filePath: keepPath,
          plainText: "keep shadow",
          generation: 100,
        },
        {
          filePath: stalePath,
          plainText: "stale shadow",
          generation: 90,
        },
      ],
      hybridIndexedFileRefs: [
        {
          path: keepPath,
          generation: 100,
          state: "ready",
        },
        {
          path: stalePath,
          generation: 90,
          state: "ready",
        },
      ],
    });

    await store.retainOnlyFiles(new Set([keepPath]));

    await expect(database.db.hybridIndexedFileRefs.get(keepPath)).resolves.toEqual({
      path: keepPath,
      generation: 100,
      state: "ready",
    });
    await expect(database.db.hybridIndexedFileRefs.get(stalePath)).resolves.toBeUndefined();
  });
});
