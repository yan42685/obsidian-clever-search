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

function createKeyedTable(initialRows: SnapshotRow[] = []) {
  const rows = new Map<string, SnapshotRow>(
    initialRows.map((row) => [row.filePath, { ...row }]),
  );

  return {
    rows,
    async get(path: string) {
      return rows.get(path);
    },
    async bulkGet(paths: readonly string[]) {
      return paths.map((path) => rows.get(path));
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
  };
}

function createStoreHarness(options?: {
  files?: TFile[];
  fileSnapshots?: SnapshotRow[];
  hybridDirtyShadows?: SnapshotRow[];
  reads?: Record<string, string>;
}) {
  const files = new Map<string, TFile>(
    (options?.files ?? []).map((file) => [file.path, file]),
  );
  const fileSnapshots = createKeyedTable(options?.fileSnapshots);
  const hybridDirtyShadows = createKeyedTable(options?.hybridDirtyShadows);
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
    },
  };

  mockInstanceMap.clear();
  mockInstanceMap.set(Vault, vault);
  mockInstanceMap.set(Database, database);

  return {
    store: new FileSnapshotStore(),
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
});
