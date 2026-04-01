import { container } from "tsyringe";
import type { BaseIndexedFileRef } from "src/globals/search-types";

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
    Notice: class Notice {
      constructor(_message?: string, _timeout?: number) {}
    },
    htmlToMarkdown(text: string) {
      return text;
    },
  };
});

jest.mock("src/services/obsidian/transformed-api", () => {
  class MockNotice {
    static messages: string[] = [];

    constructor(text: string) {
      MockNotice.messages.push(text);
    }

    setText(text: string) {
      MockNotice.messages.push(text);
      return this;
    }

    hide() {}

    static clear() {
      MockNotice.messages = [];
    }
  }

  return {
    MyNotice: MockNotice,
  };
});

jest.mock("src/globals/plugin-setting", () => {
  class OuterSetting {}

  return {
    OuterSetting,
    DEFAULT_OUTER_SETTING: {
      customExtensions: { plaintext: ["md"] },
      fileSearchBackend: "coverage-lexical",
      isCaseSensitive: false,
      enableChinesePatch: false,
      enableStopWordsEn: false,
      enableStopWordsZh: false,
      ui: {
        maxItemResults: 10,
      },
      hybrid: {
        enabled: false,
        vectorCompression: "int8",
        maxResultCount: 10,
        excludedPaths: [],
        indexConcurrency: 3,
        highPerformanceMaxMb: 60,
        minIncrementalEmbedIntervalSec: 60,
        failedEmbeddingRetryIntervalMin: 10,
      },
    },
  };
});

jest.mock("src/services/database/database", () => ({
  Database: class Database {},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
  DataProvider: class DataProvider {},
}));

jest.mock("src/services/search/lexical-engine", () => ({
  LexicalEngine: class LexicalEngine {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
  FileSnapshotStore: class FileSnapshotStore {},
}));

jest.mock("src/services/obsidian/search-service", () => ({
  SearchService: class SearchService {},
}));

jest.mock("src/services/obsidian/user-data/file-watcher", () => ({
  FileWatcher: class FileWatcher {},
}));

jest.mock("src/services/obsidian/translations/locale-helper", () => ({
  t(key: string) {
    return key;
  },
}));

jest.mock("src/services/search/hybrid/bm25", () => ({
  BM25Engine: class BM25Engine {
    clear() {}
    addDocument() {}
    serialize() {
      return {};
    }
  },
}));

import { THIS_PLUGIN } from "src/globals/constants";
import type { TFile } from "obsidian";
import type { OuterSetting as OuterSettingType } from "src/globals/plugin-setting";
import { Database } from "src/services/database/database";
import { SearchService } from "src/services/obsidian/search-service";
import { DataManager } from "src/services/obsidian/user-data/data-manager";
import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import {
  DocDeleteOperation,
  DocMoveOperation,
  DocUpsertOperation,
} from "src/services/obsidian/user-data/doc-operation-buffer";
import { FileWatcher } from "src/services/obsidian/user-data/file-watcher";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";
import { LexicalEngine } from "src/services/search/lexical-engine";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";

const { MyNotice } = jest.requireMock(
  "src/services/obsidian/transformed-api",
) as {
  MyNotice: { messages: string[]; clear(): void };
};
const { TFile: MockTFile } = jest.requireMock("obsidian") as {
  TFile: new (path: string, text?: string, mtime?: number) => TFile;
};

type MockFileSnapshotStore = ReturnType<typeof createMockFileSnapshotStore>;
type MockHybridEngine = ReturnType<typeof createMockHybridEngine>;
type MockDatabase = ReturnType<typeof createMockDatabase>;
type MockDataProvider = ReturnType<typeof createMockDataProvider>;
type MockLexicalEngine = ReturnType<typeof createMockLexicalEngine>;

function cloneSetting(): OuterSettingType {
  const { DEFAULT_OUTER_SETTING } =
    require("src/globals/plugin-setting") as typeof import("src/globals/plugin-setting");
  return JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING)) as OuterSettingType;
}

function createFile(path: string, text: string, mtime: number): TFile {
  return new MockTFile(path, text, mtime);
}

function createMockFileSnapshotStore() {
  const current = new Map<string, { text: string; generation?: number }>();
  const persisted = new Map<string, { text: string; generation?: number }>();

  return {
    current,
    persisted,
    clearCurrentFiles: jest.fn(() => {
      current.clear();
    }),
    invalidateCurrentFile: jest.fn((path: string) => {
      current.delete(path);
    }),
    setCurrentFileText: jest.fn(
      (path: string, text: string, generation?: number) => {
        current.set(path, { text, generation });
        return text;
      },
    ),
    peekCurrentFileText: jest.fn((path: string) => current.get(path)?.text),
    peekCurrentFileGeneration: jest.fn(
      (path: string) => current.get(path)?.generation,
    ),
    commitCurrentFileAsIndexed: jest.fn(
      async (path: string, generation?: number) => {
        const currentEntry = current.get(path);
        if (!currentEntry) {
          return;
        }
        persisted.set(path, {
          text: currentEntry.text,
          generation: generation ?? currentEntry.generation,
        });
      },
    ),
    commitCurrentFilesAsIndexed: jest.fn(
      async (files: ReadonlyArray<{ path: string; generation?: number }>) => {
        for (const file of files) {
          const currentEntry = current.get(file.path);
          if (!currentEntry) {
            continue;
          }
          persisted.set(file.path, {
            text: currentEntry.text,
            generation: file.generation ?? currentEntry.generation,
          });
        }
      },
    ),
    deleteIndexedSnapshot: jest.fn(async (path: string) => {
      persisted.delete(path);
    }),
    deleteIndexedSnapshots: jest.fn(async (paths: readonly string[]) => {
      for (const path of paths) {
        persisted.delete(path);
      }
    }),
    deleteIndexedSnapshotsNotIn: jest.fn(
      async (validPaths: ReadonlySet<string>) => {
        for (const path of Array.from(persisted.keys())) {
          if (!validPaths.has(path)) {
            persisted.delete(path);
          }
        }
      },
    ),
    getIndexedSnapshotTexts: jest.fn(
      async (
        paths: string[],
        expectedGenerations?: ReadonlyMap<string, number | undefined>,
      ) => {
        const result = new Map<string, string>();
        for (const path of paths) {
          const entry = persisted.get(path);
          if (
            entry &&
            (expectedGenerations?.get(path) === undefined ||
              entry.generation === expectedGenerations.get(path))
          ) {
            result.set(path, entry.text);
          }
        }
        return result;
      },
    ),
    refreshHighPerformanceState: jest.fn(async () => {}),
    estimateCurrentCacheBytes: jest.fn(() => 0),
  };
}

function createMockHybridEngine(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: jest.fn(() => true),
    shouldIndexPath: jest.fn(() => true),
    moveFile: jest.fn(async () => true),
    deleteFile: jest.fn(async () => {}),
    canSearch: jest.fn(() => false),
    canServeQuery: jest.fn(() => false),
    getRuntimeMemoryEstimate: jest.fn(() => ({
      vectorsBytes: 0,
      graphBytes: 0,
      bm25Bytes: 0,
      totalBytes: 0,
    })),
    migrateBm25StorageFormatIfNeeded: jest.fn(async () => false),
    persistIndicesForBatch: jest.fn(async () => {}),
    ...overrides,
  };
}

function createMockDatabase(overrides: Record<string, unknown> = {}) {
  const lexicalIndexedFileRefs: Array<BaseIndexedFileRef> = [];
  const hybridIndexedFileRefs: Array<Record<string, any> & { path: string }> =
    [];
  const indexRecoveryStates: Array<Record<string, any>> = [];
  const indexArtifactStates: Array<Record<string, any>> = [];
  const state = {
    lexicalSearchSnapshot: null as unknown,
  };

  const upsertRow = <T extends { path: string }>(rows: T[], row: T) => {
    const index = rows.findIndex((item) => item.path === row.path);
    if (index >= 0) {
      rows[index] = { ...row };
      return;
    }
    rows.push({ ...row });
  };

  const upsertArtifactRow = (row: Record<string, any>) => {
    const index = indexArtifactStates.findIndex((item) => item.id === row.id);
    if (index >= 0) {
      indexArtifactStates[index] = { ...row };
      return;
    }
    indexArtifactStates.push({ ...row });
  };

  return {
    deleteOldDatabases: jest.fn(async () => {}),
    getLexicalSearchSnapshot: jest.fn(async () => state.lexicalSearchSnapshot),
    deleteLexicalSearchSnapshot: jest.fn(async () => {
      state.lexicalSearchSnapshot = null;
    }),
    setLexicalSearchSnapshot: jest.fn(async (snapshot: unknown) => {
      state.lexicalSearchSnapshot = snapshot;
    }),
    getLexicalIndexedFileRefs: jest.fn(async () => [...lexicalIndexedFileRefs]),
    setLexicalIndexedFileRefs: jest.fn(async (refs: BaseIndexedFileRef[]) => {
      lexicalIndexedFileRefs.splice(
        0,
        lexicalIndexedFileRefs.length,
        ...refs.map((ref) => ({ ...ref })),
      );
    }),
    putLexicalIndexedFileRef: jest.fn(async (ref: BaseIndexedFileRef) => {
      const index = lexicalIndexedFileRefs.findIndex(
        (item) => item.path === ref.path,
      );
      if (index >= 0) {
        lexicalIndexedFileRefs[index] = { ...ref };
        return;
      }
      lexicalIndexedFileRefs.push({ ...ref });
    }),
    deleteLexicalIndexedFileRefs: jest.fn(async (paths: readonly string[]) => {
      const pathSet = new Set(paths);
      for (let index = lexicalIndexedFileRefs.length - 1; index >= 0; index--) {
        if (pathSet.has(lexicalIndexedFileRefs[index].path)) {
          lexicalIndexedFileRefs.splice(index, 1);
        }
      }
    }),
    getIndexRecoveryStates: jest.fn(async (engine?: string) => {
      return indexRecoveryStates
        .filter((row) => (engine ? row.engine === engine : true))
        .map((row) => ({ ...row }));
    }),
    putIndexRecoveryState: jest.fn(async (row: Record<string, any>) => {
      const index = indexRecoveryStates.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        indexRecoveryStates[index] = { ...row };
        return;
      }
      indexRecoveryStates.push({ ...row });
    }),
    bulkPutIndexRecoveryStates: jest.fn(async (rows: Record<string, any>[]) => {
      for (const row of rows) {
        const index = indexRecoveryStates.findIndex((item) => item.id === row.id);
        if (index >= 0) {
          indexRecoveryStates[index] = { ...row };
        } else {
          indexRecoveryStates.push({ ...row });
        }
      }
    }),
    deleteIndexRecoveryState: jest.fn(async (engine: string, path: string) => {
      for (let index = indexRecoveryStates.length - 1; index >= 0; index--) {
        if (
          indexRecoveryStates[index].engine === engine &&
          indexRecoveryStates[index].path === path
        ) {
          indexRecoveryStates.splice(index, 1);
        }
      }
    }),
    moveIndexRecoveryState: jest.fn(
      async (engine: string, oldPath: string, newPath: string) => {
        const row = indexRecoveryStates.find(
          (item) => item.engine === engine && item.path === oldPath,
        );
        if (!row) {
          return;
        }
        row.path = newPath;
        row.id = `${engine}:${newPath}`;
      },
    ),
    estimatePluginStorageUsage: jest.fn(async () => ({
      totalBytes: 0,
      tables: [],
    })),
    __state: state,
    __hybridIndexedFileRefs: hybridIndexedFileRefs,
    __indexRecoveryStates: indexRecoveryStates,
    __indexArtifactStates: indexArtifactStates,
    db: {
      hybridIndexedFileRefs: {
        toArray: jest.fn(async () =>
          hybridIndexedFileRefs.map((ref) => ({ ...ref })),
        ),
        get: jest.fn(async (path: string) => {
          const row = hybridIndexedFileRefs.find((item) => item.path === path);
          return row ? { ...row } : undefined;
        }),
        put: jest.fn(async (row: Record<string, any> & { path: string }) => {
          upsertRow(hybridIndexedFileRefs, row);
        }),
        bulkPut: jest.fn(
          async (rows: Array<Record<string, any> & { path: string }>) => {
          for (const row of rows) {
            upsertRow(hybridIndexedFileRefs, row);
          }
        }),
      },
      indexArtifactState: {
        get: jest.fn(async (id: string) => {
          const row = indexArtifactStates.find((item) => item.id === id);
          return row ? { ...row } : undefined;
        }),
        put: jest.fn(async (row: Record<string, any> & { path: string }) => {
          upsertArtifactRow(row);
        }),
        bulkPut: jest.fn(
          async (rows: Array<Record<string, any> & { path: string }>) => {
          for (const row of rows) {
            upsertArtifactRow(row);
          }
        }),
        bulkGet: jest.fn(async (ids: readonly string[]) =>
          ids.map((id) => {
            const row = indexArtifactStates.find((item) => item.id === id);
            return row ? { ...row } : undefined;
          }),
        ),
        delete: jest.fn(async (id: string) => {
          for (let index = indexArtifactStates.length - 1; index >= 0; index--) {
            if (indexArtifactStates[index].id === id) {
              indexArtifactStates.splice(index, 1);
            }
          }
        }),
        bulkDelete: jest.fn(async (ids: readonly string[]) => {
          const idSet = new Set(ids);
          for (let index = indexArtifactStates.length - 1; index >= 0; index--) {
            if (idSet.has(indexArtifactStates[index].id)) {
              indexArtifactStates.splice(index, 1);
            }
          }
        }),
      },
    },
    ...overrides,
  };
}

function createMockLexicalEngine(overrides: Record<string, unknown> = {}) {
  return {
    addDocuments: jest.fn(async () => {}),
    deleteDocuments: jest.fn(() => {}),
    beginBatchReindex: jest.fn(() => {}),
    finishBatchReindex: jest.fn(() => {}),
    abortBatchReindex: jest.fn(() => {}),
    supportsSerializedFileIndex: jest.fn(() => true),
    reIndexAll: jest.fn(async () => true),
    serializeFileIndex: jest.fn(() => null),
    estimateFileIndexBytes: jest.fn(() => 0),
    getFileIndexBreakdown: jest.fn(() => null),
    ...overrides,
  };
}

function createMockDataProvider(params: {
  files: Map<string, TFile>;
  texts: Map<string, string>;
}) {
  const { files, texts } = params;
  return {
    files,
    texts,
    isIndexable: jest.fn((fileOrPath: TFile | string) => {
      const path =
        typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
      return path.endsWith(".md");
    }),
    getFileByPath: jest.fn((path: string) => files.get(path) ?? null),
    readPlainText: jest.fn(async (fileOrPath: TFile | string) => {
      const path =
        typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
      return texts.get(path) ?? "";
    }),
    generateAllIndexedDocuments: jest.fn(async (inputFiles: TFile[]) => {
      const documents = inputFiles.map((file) => ({
        path: file.path,
        basename: file.basename,
        folder: file.path.includes("/")
          ? file.path.slice(0, file.path.lastIndexOf("/"))
          : "",
        content: texts.get(file.path) ?? "",
        aliases: "",
        tags: "",
        headings: "",
      }));
      return {
        documents,
        indexedFiles: [...inputFiles],
        failures: [],
      };
    }),
    allFilesToBeIndexed: jest.fn(() => Array.from(files.values())),
    getHeadingOutlineForText: jest.fn(() => []),
  };
}

function registerDataManagerDeps(params: {
  setting: OuterSettingType;
  pluginFiles: TFile[];
  database: MockDatabase;
  dataProvider: MockDataProvider;
  lexicalEngine: MockLexicalEngine;
  fileSnapshotStore: MockFileSnapshotStore;
  hybridEngine: MockHybridEngine;
}) {
  const plugin = {
    app: {
      vault: {
        getFiles: () => params.pluginFiles,
      },
    },
  };
  const fileWatcher = {
    start: jest.fn(),
    stop: jest.fn(),
  };
  const { OuterSetting } =
    require("src/globals/plugin-setting") as typeof import("src/globals/plugin-setting");

  container.registerInstance(THIS_PLUGIN, plugin as any);
  container.registerInstance(OuterSetting, params.setting as any);
  container.registerInstance(Database, params.database as any);
  container.registerInstance(DataProvider, params.dataProvider as any);
  container.registerInstance(LexicalEngine, params.lexicalEngine as any);
  container.registerInstance(
    FileSnapshotStore,
    params.fileSnapshotStore as any,
  );
  container.registerInstance(SearchService, {
    hybridEngine: params.hybridEngine,
  } as any);
  container.registerInstance(FileWatcher, fileWatcher as any);

  return { plugin, fileWatcher };
}

describe("DataManager integration", () => {
  beforeEach(() => {
    if (
      "reset" in container &&
      typeof (container as any).reset === "function"
    ) {
      (container as any).reset();
    } else {
      container.clearInstances();
    }
    MyNotice.clear();
    (global as any).window = {
      localStorage: {
        getItem: jest.fn(() => "zh"),
      },
    };
  });

  afterEach(() => {
    delete (global as any).window;
    jest.restoreAllMocks();
    if (
      "reset" in container &&
      typeof (container as any).reset === "function"
    ) {
      (container as any).reset();
    } else {
      container.clearInstances();
    }
    MyNotice.clear();
  });

  test("coalesces rename plus modify burst into the final new-path lexical and snapshot state", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const oldPath = "docs/old.md";
    const newPath = "archive/old.md";
    const newText = "latest moved content";
    const newFile = createFile(newPath, newText, 220);
    const files = new Map([[newPath, newFile]]);
    const texts = new Map([[newPath, newText]]);

    const database = createMockDatabase();
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.persisted.set(oldPath, {
      text: "old content",
      generation: 180,
    });
    const hybridEngine = createMockHybridEngine();

    registerDataManagerDeps({
      setting,
      pluginFiles: [newFile],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    (manager as any).scheduleHybridRepairFlush = jest.fn();
    manager.receiveDocOperation(new DocMoveOperation(oldPath, newPath, 180));
    manager.receiveDocOperation(new DocUpsertOperation(newPath, 220));
    await (manager as any).docOperationsBuffer.forceFlush();

    expect(lexicalEngine.deleteDocuments).toHaveBeenCalledWith([
      oldPath,
      newPath,
    ]);
    expect(lexicalEngine.addDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        path: newPath,
        content: newText,
      }),
    ]);
    expect(fileSnapshotStore.persisted.has(oldPath)).toBe(false);
    expect(fileSnapshotStore.persisted.get(newPath)).toEqual({
      text: newText,
      generation: 220,
    });
    expect(await database.getLexicalIndexedFileRefs()).toEqual([
      expect.objectContaining({
        path: newPath,
        generation: 220,
        size: newFile.stat.size,
      }),
    ]);
    expect(hybridEngine.moveFile).toHaveBeenCalledWith(oldPath, newPath, 220);
    expect(hybridEngine.deleteFile).not.toHaveBeenCalledWith(oldPath);
    const queuedRepair = (manager as any).hybridRepairQueue.get(newPath);
    expect(queuedRepair).toMatchObject({
      path: newPath,
      mode: "incremental",
      reason: "runtime-incremental-edit",
      sourceGeneration: 220,
    });
  });

  test("rebuilds lexical startup state when a legacy snapshot is incompatible and reports persisted versus runtime storage clearly", async () => {
    const setting = cloneSetting();
    setting.fileSearchBackend = "coverage-lexical";
    setting.hybrid.enabled = false;
    setting.hybrid.vectorCompression = "int8";

    const file = createFile("docs/a.md", "alpha body", 100);
    const files = new Map([[file.path, file]]);
    const texts = new Map([[file.path, "alpha body"]]);
    const lexicalSnapshot = {
      __backend: "legacy-unsupported" as const,
      __version: 2 as const,
      __format: "structural-snapshot" as const,
      documents: [],
    };
    const rebuiltSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(16),
    };
    const database = createMockDatabase({
      getLexicalSearchSnapshot: jest.fn(async () => lexicalSnapshot),
      estimatePluginStorageUsage: jest.fn(async () => ({
        totalBytes: 126370,
        tables: [
          { name: "lexicalSearchSnapshots", rows: 1, bytes: 3559 },
          { name: "fileSnapshots", rows: 14, bytes: 71257 },
          { name: "hybridChunkVectors", rows: 9, bytes: 36507 },
          { name: "hybridChunks", rows: 68, bytes: 12211 },
          { name: "hybridIndexedFileRefs", rows: 9, bytes: 1804 },
          { name: "lexicalIndexedFileRefs", rows: 14, bytes: 1032 },
          { name: "pluginSetting", rows: 0, bytes: 0 },
          { name: "hybridBm25Index", rows: 0, bytes: 0 },
          { name: "hybridHnswSmall", rows: 0, bytes: 0 },
          { name: "hybridTokenSavings", rows: 0, bytes: 0 },
        ],
      })),
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine({
      reIndexAll: jest.fn(async () => false),
      serializeFileIndex: jest.fn(() => rebuiltSnapshot),
      estimateFileIndexBytes: jest.fn(() => 80258),
      getFileIndexBreakdown: jest.fn(() => ({
        estimatedBytes: {
          total: 80258,
          stringPool: { bytes: 14336 },
          documents: { total: 9216 },
          documentIdentity: {
            total: 20480,
            bodyTokensById: { total: 11264 },
            bodyHanSegmentsById: { total: 1024 },
            tagValuesById: { total: 512 },
          },
          postings: {
            bodyPhrase: { total: 24576 },
            body: { total: 16384 },
            bodyChar: { total: 2048 },
            metadataAlias: { total: 3072 },
          },
          lexicon: { total: 4096 },
        },
      })),
    });
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.estimateCurrentCacheBytes.mockReturnValue(5120);
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
      getRuntimeMemoryEstimate: jest.fn(() => ({
        vectorsBytes: 16384,
        graphBytes: 8192,
        bm25Bytes: 4096,
        totalBytes: 28672,
      })),
    });

    const { fileWatcher } = registerDataManagerDeps({
      setting,
      pluginFiles: [file],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    (manager as any).isLexicalEngineUpToDate = true;

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(database.getLexicalSearchSnapshot).toHaveBeenCalled();
    expect(database.deleteLexicalSearchSnapshot).toHaveBeenCalled();
    expect(lexicalEngine.reIndexAll).toHaveBeenCalledWith(lexicalSnapshot);
    expect(lexicalEngine.addDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        path: "docs/a.md",
        content: "alpha body",
      }),
    ]);
    expect(database.setLexicalSearchSnapshot).toHaveBeenCalledWith(
      rebuiltSnapshot,
    );
    expect(MyNotice.messages).toContain(
      "Database has been updated. Automatically rebuilding the lexical index...",
    );
    expect(fileWatcher.start).toHaveBeenCalled();

    const tableSpy = jest.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const groupSpy = jest
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => {});
    const endSpy = jest.spyOn(console, "groupEnd").mockImplementation(() => {});
    await (manager as any).noticeDevStorageStats();

    const latestNotice = MyNotice.messages[MyNotice.messages.length - 1];
    expect(latestNotice).toContain("Persisted storage");
    expect(latestNotice).toContain("Runtime memory estimate");
    expect(latestNotice).toContain("LexicalSnapshot");
    expect(latestNotice).toContain("CurrentFileCache");
    expect(latestNotice).toContain("Coverage live index");
    expect(latestNotice).toContain("Coverage top segments");
    expect(groupSpy).toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    const tableRows = tableSpy.mock.calls.flatMap((call) =>
      Array.isArray(call[0]) ? call[0] : [],
    );
    expect(tableRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "LexicalSnapshot",
          rows: 1,
          bytes: 3559,
        }),
        expect.objectContaining({
          category: "SharedFileSnapshot",
          bytes: 71257,
        }),
        expect.objectContaining({
          category: "LexicalRuntimeIndex",
          bytes: 80258,
        }),
        expect.objectContaining({
          category: "HybridRuntimeVectors",
          bytes: 16384,
        }),
        expect.objectContaining({
          category: "HybridRuntimeGraph",
          bytes: 8192,
        }),
        expect.objectContaining({
          category: "HybridRuntimeBm25",
          bytes: 4096,
        }),
        expect.objectContaining({
          category: "CurrentFileCache",
          bytes: 5120,
        }),
        expect.objectContaining({
          segment: "postings.bodyPhrase",
          bytes: 24576,
        }),
        expect.objectContaining({
          segment: "documentIdentity",
          bytes: 20480,
        }),
      ]),
    );
  });

  test("dirty lexical artifact marker forces startup rebuild after runtime edits", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const file = createFile("docs/live.md", "latest body", 320);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "latest body"]]);
    const rebuiltSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(24),
    };
    const database = createMockDatabase();
    database.__state.lexicalSearchSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(8),
    };
    database.__indexArtifactStates.push({
      id: buildIndexArtifactStateId("lexical", "snapshot"),
      engine: "lexical",
      artifact: "snapshot",
      dirtyAt: 1_000,
      reason: "runtime-lexical-dirty",
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine({
      serializeFileIndex: jest.fn(() => rebuiltSnapshot),
    });
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [file],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
    expect(database.deleteLexicalSearchSnapshot).toHaveBeenCalled();
    expect(lexicalEngine.reIndexAll).not.toHaveBeenCalled();
    expect(lexicalEngine.addDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        path: file.path,
        content: "latest body",
      }),
    ]);
    expect(database.setLexicalSearchSnapshot).toHaveBeenCalledWith(
      rebuiltSnapshot,
    );
    expect(
      await database.db.indexArtifactState.get(
        buildIndexArtifactStateId("lexical", "snapshot"),
      ),
    ).toBeUndefined();

    manager.onunload();
  });

  test("dirty lexical artifact marker prunes deleted files on startup rebuild", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const deletedPath = "docs/deleted.md";
    const database = createMockDatabase();
    database.__state.lexicalSearchSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(12),
    };
    database.__indexArtifactStates.push({
      id: buildIndexArtifactStateId("lexical", "snapshot"),
      engine: "lexical",
      artifact: "snapshot",
      dirtyAt: 2_000,
      reason: "runtime-lexical-dirty",
    });
    await database.setLexicalIndexedFileRefs([
      {
        path: deletedPath,
        generation: 200,
        size: 9,
      },
    ]);
    const dataProvider = createMockDataProvider({
      files: new Map<string, TFile>(),
      texts: new Map<string, string>(),
    });
    const lexicalEngine = createMockLexicalEngine({
      serializeFileIndex: jest.fn(() => null),
    });
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.persisted.set(deletedPath, {
      text: "deleted body",
      generation: 200,
    });
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
    expect(lexicalEngine.reIndexAll).not.toHaveBeenCalled();
    expect(lexicalEngine.addDocuments).not.toHaveBeenCalled();
    expect(await database.getLexicalIndexedFileRefs()).toEqual([]);
    expect(fileSnapshotStore.persisted.has(deletedPath)).toBe(false);
    expect(fileSnapshotStore.deleteIndexedSnapshotsNotIn).toHaveBeenCalledWith(
      new Set<string>(),
    );
    expect(
      await database.db.indexArtifactState.get(
        buildIndexArtifactStateId("lexical", "snapshot"),
      ),
    ).toBeUndefined();

    manager.onunload();
  });

  test("runtime lexical edit survives restart by forcing dirty-artifact rebuild", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const file = createFile("docs/restart-live.md", "restart body", 410);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "restart body"]]);
    const database = createMockDatabase();
    database.__state.lexicalSearchSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(6),
    };

    const runtimeDataProvider = createMockDataProvider({ files, texts });
    const runtimeLexicalEngine = createMockLexicalEngine();
    const runtimeFileSnapshotStore = createMockFileSnapshotStore();
    const runtimeHybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [file],
      database,
      dataProvider: runtimeDataProvider,
      lexicalEngine: runtimeLexicalEngine,
      fileSnapshotStore: runtimeFileSnapshotStore,
      hybridEngine: runtimeHybridEngine,
    });

    const runtimeManager = container.resolve(DataManager);
    runtimeManager.receiveDocOperation(new DocUpsertOperation(file.path, file.stat.mtime));
    await (runtimeManager as any).docOperationsBuffer.forceFlush();
    (runtimeManager as any).clearLexicalSnapshotFlushTimer();

    expect(
      await database.db.indexArtifactState.get(
        buildIndexArtifactStateId("lexical", "snapshot"),
      ),
    ).toEqual(
      expect.objectContaining({
        artifact: "snapshot",
        engine: "lexical",
      }),
    );

    if ("reset" in container && typeof container.reset === "function") {
      container.reset();
    } else {
      container.clearInstances();
    }

    const restartLexicalSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(18),
    };
    const restartDataProvider = createMockDataProvider({ files, texts });
    const restartLexicalEngine = createMockLexicalEngine({
      serializeFileIndex: jest.fn(() => restartLexicalSnapshot),
    });
    const restartFileSnapshotStore = createMockFileSnapshotStore();
    const restartHybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [file],
      database,
      dataProvider: restartDataProvider,
      lexicalEngine: restartLexicalEngine,
      fileSnapshotStore: restartFileSnapshotStore,
      hybridEngine: restartHybridEngine,
    });

    const restartManager = container.resolve(DataManager);
    await restartManager.initAsync();
    await (restartManager as any).searchBootstrapCommitTask;

    expect(database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
    expect(restartLexicalEngine.reIndexAll).not.toHaveBeenCalled();
    expect(restartLexicalEngine.addDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        path: file.path,
        content: "restart body",
      }),
    ]);
    expect(database.setLexicalSearchSnapshot).toHaveBeenCalledWith(
      restartLexicalSnapshot,
    );
    expect(
      await database.db.indexArtifactState.get(
        buildIndexArtifactStateId("lexical", "snapshot"),
      ),
    ).toBeUndefined();

    restartManager.onunload();
  });

  test("runtime lexical delete survives restart by pruning stale snapshot state", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const deletedPath = "docs/restart-deleted.md";
    const database = createMockDatabase();
    database.__state.lexicalSearchSnapshot = {
      __backend: "coverage-lexical" as const,
      __version: 2 as const,
      __encoding: "binary-snapshot-v2" as const,
      data: new ArrayBuffer(10),
    };
    await database.setLexicalIndexedFileRefs([
      {
        path: deletedPath,
        generation: 220,
        size: 12,
      },
    ]);

    const runtimeDataProvider = createMockDataProvider({
      files: new Map<string, TFile>(),
      texts: new Map<string, string>(),
    });
    const runtimeLexicalEngine = createMockLexicalEngine();
    const runtimeFileSnapshotStore = createMockFileSnapshotStore();
    runtimeFileSnapshotStore.persisted.set(deletedPath, {
      text: "deleted body",
      generation: 220,
    });
    const runtimeHybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [],
      database,
      dataProvider: runtimeDataProvider,
      lexicalEngine: runtimeLexicalEngine,
      fileSnapshotStore: runtimeFileSnapshotStore,
      hybridEngine: runtimeHybridEngine,
    });

    const runtimeManager = container.resolve(DataManager);
    runtimeManager.receiveDocOperation(new DocDeleteOperation(deletedPath));
    await (runtimeManager as any).docOperationsBuffer.forceFlush();
    (runtimeManager as any).clearLexicalSnapshotFlushTimer();

    expect(await database.getLexicalIndexedFileRefs()).toEqual([]);
    expect(runtimeFileSnapshotStore.persisted.has(deletedPath)).toBe(false);

    if ("reset" in container && typeof container.reset === "function") {
      container.reset();
    } else {
      container.clearInstances();
    }

    const restartDataProvider = createMockDataProvider({
      files: new Map<string, TFile>(),
      texts: new Map<string, string>(),
    });
    const restartLexicalEngine = createMockLexicalEngine({
      serializeFileIndex: jest.fn(() => null),
    });
    const restartFileSnapshotStore = createMockFileSnapshotStore();
    const restartHybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [],
      database,
      dataProvider: restartDataProvider,
      lexicalEngine: restartLexicalEngine,
      fileSnapshotStore: restartFileSnapshotStore,
      hybridEngine: restartHybridEngine,
    });

    const restartManager = container.resolve(DataManager);
    await restartManager.initAsync();
    await (restartManager as any).searchBootstrapCommitTask;

    expect(database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
    expect(restartLexicalEngine.addDocuments).not.toHaveBeenCalled();
    expect(database.__state.lexicalSearchSnapshot).toBeNull();
    expect(
      await database.db.indexArtifactState.get(
        buildIndexArtifactStateId("lexical", "snapshot"),
      ),
    ).toBeUndefined();

    restartManager.onunload();
  });

  test("hydrates persisted hybrid recovery rows and requeues durable startup repairs", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const bm25File = createFile("docs/bm25.md", "bm25 body", 100);
    const failedFile = createFile("docs/failed.md", "failed body", 110);
    const readyFile = createFile("docs/ready.md", "ready body", 120);
    const skippedFile = createFile("docs/skipped.md", "skipped body", 130);
    const files = new Map<string, TFile>([
      [bm25File.path, bm25File],
      [failedFile.path, failedFile],
      [readyFile.path, readyFile],
      [skippedFile.path, skippedFile],
    ]);
    const texts = new Map<string, string>([
      [bm25File.path, "bm25 body"],
      [failedFile.path, "failed body"],
      [readyFile.path, "ready body"],
      [skippedFile.path, "skipped body"],
    ]);

    const database = createMockDatabase();
    (database as any).__indexRecoveryStates.push(
      {
        id: `hybrid:${bm25File.path}`,
        engine: "hybrid",
        path: bm25File.path,
        targetGeneration: bm25File.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "blocking",
        failureKind: "auth_403",
        failureMessage: "Embedding API error 403",
        attemptCount: 1,
        lastFailedAt: 1000,
        nextRetryAt: null,
        isBlocking: true,
      },
      {
        id: `hybrid:${failedFile.path}`,
        engine: "hybrid",
        path: failedFile.path,
        targetGeneration: failedFile.stat.mtime,
        mode: "full",
        recoveryKind: "failure",
        state: "retryable_waiting",
        failureKind: "provider_429",
        failureMessage: "Embedding API error 429",
        attemptCount: 2,
        lastFailedAt: 2000,
        nextRetryAt: 5000,
        isBlocking: false,
      },
      {
        id: `hybrid:${readyFile.path}`,
        engine: "hybrid",
        path: readyFile.path,
        targetGeneration: readyFile.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "blocking",
        failureKind: "auth_401",
        failureMessage: "Embedding API error 401",
        attemptCount: 1,
        lastFailedAt: 3000,
        nextRetryAt: null,
        isBlocking: true,
      },
      {
        id: `hybrid:${skippedFile.path}`,
        engine: "hybrid",
        path: skippedFile.path,
        targetGeneration: skippedFile.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "retryable_waiting",
        failureKind: "provider_5xx",
        failureMessage: "Embedding API error 500",
        attemptCount: 1,
        lastFailedAt: 4000,
        nextRetryAt: 6000,
        isBlocking: false,
      },
      {
        id: "hybrid:docs/missing.md",
        engine: "hybrid",
        path: "docs/missing.md",
        targetGeneration: 90,
        mode: "incremental",
        recoveryKind: "failure",
        state: "blocking",
        failureKind: "auth_403",
        failureMessage: "Embedding API error 403",
        attemptCount: 1,
        lastFailedAt: 5000,
        nextRetryAt: null,
        isBlocking: true,
      },
    );
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine();

    registerDataManagerDeps({
      setting,
      pluginFiles: Array.from(files.values()),
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    const scheduleSpy = jest
      .spyOn(manager as any, "scheduleHybridRepairFlush")
      .mockImplementation(() => {});
    const retryScheduleSpy = jest
      .spyOn(manager as any, "scheduleFailedEmbeddingRetry")
      .mockImplementation(() => {});

    await (manager as any).restorePersistedHybridRecoveryState(
      files,
      new Map([
        [
          readyFile.path,
          {
            path: readyFile.path,
            generation: readyFile.stat.mtime,
            state: "ready",
          },
        ],
      ]),
    );
    await (manager as any).enqueuePersistedHybridRecoveryStates(
      new Set<string>([skippedFile.path]),
    );

    expect(database.deleteIndexRecoveryState).toHaveBeenCalledWith(
      "hybrid",
      readyFile.path,
    );
    expect(database.deleteIndexRecoveryState).toHaveBeenCalledWith(
      "hybrid",
      "docs/missing.md",
    );
    expect((manager as any).hybridRepairQueue.get(bm25File.path)).toMatchObject({
      path: bm25File.path,
      mode: "incremental",
      reason: "startup-recover-persisted-state",
      sourceGeneration: bm25File.stat.mtime,
    });
    expect((manager as any).hybridRepairQueue.has(failedFile.path)).toBe(false);
    expect((manager as any).hybridRepairQueue.has(skippedFile.path)).toBe(
      false,
    );
    expect(database.putIndexRecoveryState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: failedFile.path,
      }),
    );
    expect(database.putIndexRecoveryState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: bm25File.path,
      }),
    );
    expect(scheduleSpy).toHaveBeenCalled();
    expect(retryScheduleSpy).toHaveBeenCalled();
    manager.onunload();
  });


  test("backfills legacy hybrid recovery rows and strips legacy file-ref fields", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const retryableFile = createFile("docs/retryable.md", "retryable body", 100);
    const deferredFile = createFile("docs/deferred.md", "deferred body", 110);
    const readyFile = createFile("docs/ready.md", "ready body", 120);
    const files = new Map<string, TFile>([
      [retryableFile.path, retryableFile],
      [deferredFile.path, deferredFile],
      [readyFile.path, readyFile],
    ]);
    const texts = new Map<string, string>([
      [retryableFile.path, "retryable body"],
      [deferredFile.path, "deferred body"],
      [readyFile.path, "ready body"],
    ]);

    const database = createMockDatabase();
    (database as any).__hybridIndexedFileRefs.push(
      {
        path: retryableFile.path,
        generation: retryableFile.stat.mtime,
        state: "bm25_only",
        chunkCount: 2,
        lastErrorKind: "provider_429",
        lastIncrementalEmbedAt: 4_000,
        indexedAt: 7_000,
      },
      {
        path: deferredFile.path,
        generation: deferredFile.stat.mtime,
        state: "bm25_only",
        chunkCount: 3,
        embeddingDeferred: true,
        lastIncrementalEmbedAt: 5_000,
        indexedAt: 8_000,
      },
      {
        path: readyFile.path,
        generation: readyFile.stat.mtime,
        state: "ready",
        chunkCount: 1,
        lastErrorKind: null,
        embeddingDeferred: false,
        lastIncrementalEmbedAt: 9_000,
        indexedAt: 9_000,
      },
    );
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine();

    registerDataManagerDeps({
      setting,
      pluginFiles: Array.from(files.values()),
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    jest
      .spyOn(manager as any, "scheduleHybridRepairFlush")
      .mockImplementation(() => {});
    const retryScheduleSpy = jest
      .spyOn(manager as any, "scheduleFailedEmbeddingRetry")
      .mockImplementation(() => {});

    const previousIndexedFileRefs = new Map(
      (database as any).__hybridIndexedFileRefs.map((row: Record<string, any>) => [
        row.path,
        row,
      ]),
    );

    await (manager as any).restorePersistedHybridRecoveryState(
      files,
      previousIndexedFileRefs,
    );

    expect((database as any).__indexRecoveryStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: retryableFile.path,
          recoveryKind: "failure",
          failureKind: "provider_429",
        }),
        expect.objectContaining({
          path: deferredFile.path,
          recoveryKind: "deferred_embedding",
          failureKind: null,
          nextRetryAt: 65_000,
        }),
      ]),
    );

    const deferredSummary = await manager.getHybridDeferredEmbeddingSummary();
    expect(deferredSummary).toEqual({
      deferredCount: 1,
      nextEligibleAt: 65_000,
      totalFiles: 3,
    });

    await (manager as any).enqueuePersistedHybridRecoveryStates(new Set());

    expect((manager as any).hybridRepairQueue.has(retryableFile.path)).toBe(
      false,
    );
    expect(
      (manager as any).hybridRepairQueue.get(deferredFile.path),
    ).toMatchObject({
      path: deferredFile.path,
      mode: "incremental",
      reason: "startup-resume-deferred-embedding",
      eligibleAt: 65_000,
      sourceGeneration: deferredFile.stat.mtime,
    });

    const strippedRetryable = (database as any).__hybridIndexedFileRefs.find(
      (row: Record<string, any>) => row.path === retryableFile.path,
    );
    const strippedDeferred = (database as any).__hybridIndexedFileRefs.find(
      (row: Record<string, any>) => row.path === deferredFile.path,
    );
    const strippedReady = (database as any).__hybridIndexedFileRefs.find(
      (row: Record<string, any>) => row.path === readyFile.path,
    );
    expect(strippedRetryable.lastErrorKind).toBeUndefined();
    expect(strippedRetryable.embeddingDeferred).toBeUndefined();
    expect(strippedDeferred.embeddingDeferred).toBeUndefined();
    expect(strippedReady.lastErrorKind).toBeUndefined();
    expect(strippedReady.embeddingDeferred).toBeUndefined();
    expect(retryScheduleSpy).toHaveBeenCalled();

    manager.onunload();
    nowSpy.mockRestore();
  });

  test("retryable hybrid recovery preserves backoff across restart", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);

    try {
      const setting = cloneSetting();
      setting.hybrid.enabled = true;

      const file = createFile("docs/retry-later.md", "retry later body", 100);
      const files = new Map<string, TFile>([[file.path, file]]);
      const texts = new Map<string, string>([[file.path, "retry later body"]]);
      const database = createMockDatabase();
      database.__indexRecoveryStates.push({
        id: `hybrid:${file.path}`,
        engine: "hybrid",
        path: file.path,
        targetGeneration: file.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "retryable_waiting",
        failureKind: "provider_429",
        failureMessage: "Embedding API error 429",
        attemptCount: 2,
        lastFailedAt: 90_000,
        nextRetryAt: 160_000,
        isBlocking: false,
      });
      const dataProvider = createMockDataProvider({ files, texts });
      const lexicalEngine = createMockLexicalEngine();
      const fileSnapshotStore = createMockFileSnapshotStore();
      const hybridEngine = createMockHybridEngine();

      registerDataManagerDeps({
        setting,
        pluginFiles: [file],
        database,
        dataProvider,
        lexicalEngine,
        fileSnapshotStore,
        hybridEngine,
      });

      const manager = container.resolve(DataManager);
      jest
        .spyOn(manager as any, "scheduleHybridRepairFlush")
        .mockImplementation(() => {});

      await (manager as any).restorePersistedHybridRecoveryState(
        files,
        new Map([
          [
            file.path,
            {
              path: file.path,
              generation: file.stat.mtime,
              state: "bm25_only",
            },
          ],
        ]),
      );
      await (manager as any).enqueuePersistedHybridRecoveryStates(new Set());

      expect((manager as any).hybridRepairQueue.has(file.path)).toBe(false);

      await jest.advanceTimersByTimeAsync(59_999);
      expect((manager as any).hybridRepairQueue.has(file.path)).toBe(false);

      await jest.advanceTimersByTimeAsync(1);

      expect((manager as any).hybridRepairQueue.get(file.path)).toMatchObject({
        path: file.path,
        mode: "incremental",
        reason: "failed-embedding-auto-retry",
        eligibleAt: 160_000,
        sourceGeneration: file.stat.mtime,
      });
      expect(database.putIndexRecoveryState).toHaveBeenCalledWith(
        expect.objectContaining({
          path: file.path,
          failureKind: "provider_429",
          nextRetryAt: 760_000,
        }),
      );

      manager.onunload();
    } finally {
      jest.useRealTimers();
    }
  });
  test("hybrid exclusion changes clear stale persisted recovery metadata on startup", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/excluded.md", "excluded body", 160);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "excluded body"]]);
    const database = createMockDatabase();
    database.__indexRecoveryStates.push({
      id: `hybrid:${file.path}`,
      engine: "hybrid",
      path: file.path,
      targetGeneration: file.stat.mtime,
      mode: "incremental",
      recoveryKind: "failure",
      state: "retryable_waiting",
      failureKind: "provider_429",
      failureMessage: "Embedding API error 429",
      attemptCount: 1,
      lastFailedAt: 8_000,
      nextRetryAt: 9_000,
      isBlocking: false,
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      shouldIndexPath: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [file],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    jest
      .spyOn(manager as any, "scheduleHybridRepairFlush")
      .mockImplementation(() => {});

    await (manager as any).restorePersistedHybridRecoveryState(
      files,
      new Map([
        [
          file.path,
          {
            path: file.path,
            generation: file.stat.mtime,
            state: "bm25_only",
          },
        ],
      ]),
    );
    await (manager as any).enqueuePersistedHybridRecoveryStates(new Set());

    expect(database.deleteIndexRecoveryState).toHaveBeenCalledWith(
      "hybrid",
      file.path,
    );
    expect((manager as any).hybridRepairQueue.has(file.path)).toBe(false);

    manager.onunload();
  });

  test("real delete path still removes shared snapshots before dropping hybrid state", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/delete-me.md", "delete me", 200);
    const files = new Map<string, TFile>();
    const texts = new Map<string, string>();

    const database = createMockDatabase();
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.persisted.set(file.path, {
      text: "delete me",
      generation: file.stat.mtime,
    });
    const hybridEngine = createMockHybridEngine();

    registerDataManagerDeps({
      setting,
      pluginFiles: [],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    (manager as any).scheduleHybridRepairFlush = jest.fn();
    manager.receiveDocOperation(new DocDeleteOperation(file.path));
    await (manager as any).docOperationsBuffer.forceFlush();

    expect(fileSnapshotStore.persisted.has(file.path)).toBe(false);
    expect(fileSnapshotStore.deleteIndexedSnapshots).toHaveBeenCalledWith([
      file.path,
    ]);
    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(file.path);
  });

  test("full lexical reindex prunes stale shared snapshots after rewriting current ones", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const liveFile = createFile("docs/live.md", "live body", 320);
    const files = new Map<string, TFile>([[liveFile.path, liveFile]]);
    const texts = new Map<string, string>([[liveFile.path, "live body"]]);

    const database = createMockDatabase();
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.current.set(liveFile.path, {
      text: "live body",
      generation: liveFile.stat.mtime,
    });
    fileSnapshotStore.persisted.set("docs/stale.md", {
      text: "stale body",
      generation: 100,
    });
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
    });

    registerDataManagerDeps({
      setting,
      pluginFiles: [liveFile],
      database,
      dataProvider,
      lexicalEngine,
      fileSnapshotStore,
      hybridEngine,
    });

    const manager = container.resolve(DataManager);
    await (manager as any).reindexLexicalEngineWithCurrFiles();

    expect(fileSnapshotStore.persisted.get(liveFile.path)).toEqual({
      text: "live body",
      generation: liveFile.stat.mtime,
    });
    expect(fileSnapshotStore.persisted.has("docs/stale.md")).toBe(false);
    expect(fileSnapshotStore.deleteIndexedSnapshotsNotIn).toHaveBeenCalledWith(
      new Set([liveFile.path]),
    );
  });
});

