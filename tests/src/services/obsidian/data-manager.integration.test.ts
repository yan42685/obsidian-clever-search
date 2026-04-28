// @ts-nocheck
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

jest.mock("src/services/search/tokenizer", () => ({
  Tokenizer: class Tokenizer {},
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
import { Tokenizer } from "src/services/search/tokenizer";

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
  const shadow = new Map<string, { text: string; generation?: number }>();
  const indexedMetadata = new Map<
    string,
    {
      generation?: number;
      aliasesText?: string;
      tagsText?: string;
      headingsText?: string;
    }
  >();
  const hybridIndexedRefs: Array<Record<string, any> & { path: string }> = [];

  const isGenerationMatch = (
    actualGeneration: number | undefined,
    expectedGeneration: number | undefined,
  ) => expectedGeneration === undefined || actualGeneration === expectedGeneration;

  const clearShadowIfAligned = (
    path: string,
    generation: number | undefined,
  ) => {
    const shadowEntry = shadow.get(path);
    if (shadowEntry && shadowEntry.generation === generation) {
      shadow.delete(path);
    }
  };

  const readGenerationAlignedTexts = async (
    paths: string[],
    expectedGenerations?: ReadonlyMap<string, number | undefined>,
  ) => {
    const result = new Map<string, string>();
    for (const path of Array.from(new Set(paths))) {
      const expectedGeneration = expectedGenerations?.get(path);
      const currentEntry = current.get(path);
      if (currentEntry && isGenerationMatch(currentEntry.generation, expectedGeneration)) {
        result.set(path, currentEntry.text);
        continue;
      }
      const persistedEntry = persisted.get(path);
      if (persistedEntry && isGenerationMatch(persistedEntry.generation, expectedGeneration)) {
        result.set(path, persistedEntry.text);
        continue;
      }
      if (!expectedGenerations) {
        continue;
      }
      const shadowEntry = shadow.get(path);
      if (shadowEntry && isGenerationMatch(shadowEntry.generation, expectedGeneration)) {
        result.set(path, shadowEntry.text);
      }
    }
    return result;
  };

  const store = {
    current,
    persisted,
    shadow,
    hybridIndexedRefs,
    resetRuntimeState: jest.fn(() => {
      current.clear();
    }),
    readCurrentTexts: jest.fn(
      async (fileOrPaths: ReadonlyArray<string | { path: string }>) => {
        const result = new Map<string, string>();
        for (const fileOrPath of fileOrPaths) {
          const path =
            typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
          const currentEntry = current.get(path);
          if (currentEntry) {
            result.set(path, currentEntry.text);
            continue;
          }
          const persistedEntry = persisted.get(path);
          if (persistedEntry) {
            current.set(path, persistedEntry);
            result.set(path, persistedEntry.text);
          }
        }
        return result;
      },
    ),
    publishIndexedTexts: jest.fn(
      async (
        files: ReadonlyArray<{
          path: string;
          generation?: number;
          text?: string;
        }>,
      ) => {
        for (const file of files) {
          if (file.text !== undefined) {
            current.set(file.path, {
              text: file.text,
              generation: file.generation,
            });
          }
          const currentEntry = current.get(file.path);
          if (!currentEntry) {
            continue;
          }
          const nextGeneration = file.generation ?? currentEntry.generation;
          persisted.set(file.path, {
            text: currentEntry.text,
            generation: nextGeneration,
          });
          clearShadowIfAligned(file.path, nextGeneration);
        }
      },
    ),
    publishIndexedMetadata: jest.fn(
      async (
        files: ReadonlyArray<{
          path: string;
          generation?: number;
          aliasesText?: string;
          tagsText?: string;
          headingsText?: string;
        }>,
      ) => {
        for (const file of files) {
          indexedMetadata.set(file.path, {
            generation: file.generation,
            aliasesText: file.aliasesText,
            tagsText: file.tagsText,
            headingsText: file.headingsText,
          });
        }
      },
    ),
    deleteIndexedSnapshot: jest.fn(async (path: string) => {
      persisted.delete(path);
      indexedMetadata.delete(path);
      shadow.delete(path);
    }),
    deleteIndexedSnapshots: jest.fn(async (paths: readonly string[]) => {
      for (const path of paths) {
        persisted.delete(path);
        indexedMetadata.delete(path);
        shadow.delete(path);
      }
    }),
    removeFiles: jest.fn(async (paths: readonly string[]) => {
      for (const path of paths) {
        current.delete(path);
        persisted.delete(path);
        indexedMetadata.delete(path);
        shadow.delete(path);
      }
    }),
    notifyHybridIndexedRefsChanged: jest.fn(async (paths?: readonly string[]) => {
      const candidatePaths =
        paths !== undefined ? Array.from(new Set(paths)) : Array.from(shadow.keys());
      for (const path of candidatePaths) {
        const shadowEntry = shadow.get(path);
        if (!shadowEntry) {
          continue;
        }
        const persistedEntry = persisted.get(path);
        const shouldKeep =
          shadowEntry.generation !== undefined &&
          persistedEntry?.generation !== shadowEntry.generation;
        if (!shouldKeep) {
          shadow.delete(path);
        }
      }
    }),
    retainOnlyFiles: jest.fn(
      async (validPaths: ReadonlySet<string>) => {
        for (const path of Array.from(current.keys())) {
          if (!validPaths.has(path)) {
            current.delete(path);
          }
        }
        for (const path of Array.from(persisted.keys())) {
          if (!validPaths.has(path)) {
            persisted.delete(path);
          }
        }
        for (const path of Array.from(indexedMetadata.keys())) {
          if (!validPaths.has(path)) {
            indexedMetadata.delete(path);
          }
        }
        for (const path of Array.from(shadow.keys())) {
          if (!validPaths.has(path)) {
            shadow.delete(path);
          }
        }
        for (let index = hybridIndexedRefs.length - 1; index >= 0; index--) {
          if (!validPaths.has(hybridIndexedRefs[index].path)) {
            hybridIndexedRefs.splice(index, 1);
          }
        }
      },
    ),
    readIndexedTexts: jest.fn(
      async (
        requests: ReadonlyArray<{ path: string; generation?: number }>,
      ) =>
        await readGenerationAlignedTexts(
          requests.map((request) => request.path),
          new Map(
            requests.map((request) => [request.path, request.generation]),
          ),
        ),
    ),
    readIndexedMetadata: jest.fn(
      async (
        requests: ReadonlyArray<{ path: string; generation?: number }>,
      ) => {
        const result = new Map<
          string,
          {
            aliasesText?: string;
            tagsText?: string;
            headingsText?: string;
          }
        >();
        for (const request of requests) {
          const snapshot = indexedMetadata.get(request.path);
          if (!snapshot) {
            continue;
          }
          if (
            request.generation !== undefined &&
            snapshot.generation !== undefined &&
            snapshot.generation !== request.generation
          ) {
            continue;
          }
          result.set(request.path, {
            aliasesText: snapshot.aliasesText,
            tagsText: snapshot.tagsText,
            headingsText: snapshot.headingsText,
          });
        }
        return result;
      },
    ),
    getHybridIndexedFileRef: jest.fn(async (path: string) =>
      store.hybridIndexedRefs.find((ref) => ref.path === path)
        ? { ...store.hybridIndexedRefs.find((ref) => ref.path === path)! }
        : undefined,
    ),
    getHybridIndexedFileRefs: jest.fn(async (paths: readonly string[]) => {
      const result = new Map<string, Record<string, any> & { path: string }>();
      for (const path of Array.from(new Set(paths))) {
        const ref = store.hybridIndexedRefs.find((item) => item.path === path);
        if (ref) {
          result.set(path, { ...ref });
        }
      }
      return result;
    }),
    listHybridIndexedFileRefs: jest.fn(async () =>
      store.hybridIndexedRefs.map((ref) => ({ ...ref })),
    ),
    getRuntimeMemoryEstimate: jest.fn(() => ({
      pathBytes: 0,
      currentTextBytes: 0,
      generationBytes: 0,
      fileCount: 0,
      slotCount: 0,
      freeSlotCount: 0,
      totalBytes: 0,
      largestEntries: [],
    })),
  };
  return store;
}

function createMockTokenizer() {
  return {
    tokenizeSequence(text: string) {
      return (
        text
          .toLowerCase()
          .match(/[\p{Script=Han}]+|[a-z0-9]+(?:[-_][a-z0-9]+)*/gu) ?? []
      );
    },
  };
}
function createMockHybridEngine(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: jest.fn(() => true),
    shouldIndexPath: jest.fn(() => true),
    load: jest.fn(async () => {}),
    clearAll: jest.fn(async () => {}),
    moveFile: jest.fn(async () => true),
    deleteFile: jest.fn(async () => {}),
    indexFileStrict: jest.fn(async () => {}),
    indexFile: jest.fn(async () => {}),
    canSearch: jest.fn(() => false),
    canServeQuery: jest.fn(() => false),
    consumeIndexingFallbackNoticeKey: jest.fn(() => null),
    getRuntimeMemoryEstimate: jest.fn(() => ({
      vectorsBytes: 0,
      graphBytes: 0,
      totalBytes: 0,
    })),
    persistIndicesForBatch: jest.fn(async () => {}),
    ...overrides,
  };
}

function createMockDatabase(overrides: Record<string, unknown> = {}) {
  const lexicalIndexedFileRefs: Array<BaseIndexedFileRef> = [];
  const hybridIndexedFileRefs: Array<Record<string, any> & { path: string }> =
    [];
  const hybridChunks: Array<Record<string, any> & { filePath: string }> = [];
  const hybridChunkVectors: Array<
    Record<string, any> & { filePath: string }
  > = [];
  const fileSnapshots: Array<Record<string, any> & { filePath: string }> = [];
  const hybridDirtyShadows: Array<Record<string, any> & { filePath: string }> = [];
  const docRegistryRows: Array<Record<string, any> & { docRef: number; path: string }> = [];
  const indexRecoveryStates: Array<Record<string, any>> = [];
  const indexArtifactStates: Array<Record<string, any>> = [];
  const state = {
    lexicalSearchSnapshot: null as unknown,
    lexicalQueryEvidenceReadyVersion: null as number | null,
  };

  const compareKeys = (left: string | number, right: string | number) => {
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left).localeCompare(String(right));
  };

  const toPagedRows = <T extends Record<string, any>>(
    rows: readonly T[],
    getKey: (row: T) => string | number,
    lastKey: string | number | null,
    batchSize: number,
  ): T[] =>
    rows
      .slice()
      .sort((left, right) => compareKeys(getKey(left), getKey(right)))
      .filter((row) =>
        lastKey === null ? true : compareKeys(getKey(row), lastKey) > 0,
      )
      .slice(0, batchSize)
      .map((row) => ({ ...row }));

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

  const upsertFilePathRow = <T extends { filePath: string }>(rows: T[], row: T) => {
    const index = rows.findIndex((item) => item.filePath === row.filePath);
    if (index >= 0) {
      rows[index] = { ...row };
      return;
    }
    rows.push({ ...row });
  };

  const rowPath = (row: Record<string, any>) => row.path ?? row.filePath;
  const ensureMockDocRegistryEntry = (path: string, generation?: number) => {
    const existing = docRegistryRows.find((row) => row.path === path);
    if (existing) {
      if (generation !== undefined) {
        existing.liveGeneration = generation;
      }
      return existing;
    }
    const created = {
      docRef: docRegistryRows.length + 1,
      path,
      deleted: false,
      liveGeneration: generation,
      updatedAt: generation ?? 0,
    };
    docRegistryRows.push(created);
    return created;
  };
  const ensureDocRegistryFromStoredRows = () => {
    for (const row of [
      ...hybridIndexedFileRefs,
      ...hybridChunks,
      ...hybridChunkVectors,
      ...fileSnapshots,
      ...hybridDirtyShadows,
    ]) {
      const path = rowPath(row);
      if (path) {
        const entry = ensureMockDocRegistryEntry(path, row.generation);
        row.docRef ??= entry.docRef;
        row.id ??= `${entry.docRef}:${row.generation ?? entry.liveGeneration ?? 0}`;
      }
    }
  };
  const generationKeyForRow = (row: Record<string, any>) => {
    if (typeof row.id === "string") {
      return row.id;
    }
    if (row.docRef !== undefined && row.generation !== undefined) {
      return `${row.docRef}:${row.generation}`;
    }
    return rowPath(row);
  };
  const findByGenerationKey = <T extends Record<string, any>>(
    rows: readonly T[],
    key: string,
  ) => {
    ensureDocRegistryFromStoredRows();
    return rows.find((row) => generationKeyForRow(row) === key);
  };

  return {
    openAndConsumeSchemaUpgradeReport: jest.fn(async () => ({
      schemaUpgradeDetected: false,
      recovery: null,
    })),
    openAndConsumeSchemaUpgradeFlag: jest.fn(async () => false),
    hasLexicalQueryEvidenceReadyMarker: jest.fn(
      async () =>
        state.lexicalQueryEvidenceReadyVersion !== null ||
        state.lexicalSearchSnapshot !== null,
    ),
    setLexicalQueryEvidenceReadyMarker: jest.fn(async (version: number) => {
      state.lexicalQueryEvidenceReadyVersion = version;
    }),
    clearLexicalQueryEvidenceReadyMarker: jest.fn(async () => {
      state.lexicalQueryEvidenceReadyVersion = null;
    }),
    getLexicalSearchSnapshot: jest.fn(async () => state.lexicalSearchSnapshot),
    deleteLexicalSearchSnapshot: jest.fn(async () => {
      state.lexicalSearchSnapshot = null;
    }),
    setLexicalSearchSnapshot: jest.fn(async (snapshot: unknown) => {
      state.lexicalSearchSnapshot = snapshot;
    }),
    getLexicalIndexedFileRefs: jest.fn(async () => [...lexicalIndexedFileRefs]),
    ensureDocRegistryEntry: jest.fn(async (entry: Record<string, any>) => ({
      ...ensureMockDocRegistryEntry(entry.path, entry.generation),
    })),
    ensureDocRegistryEntries: jest.fn(async (entries: ReadonlyArray<Record<string, any>>) => {
      const result = new Map<string, Record<string, any>>();
      for (const entry of entries) {
        result.set(entry.path, {
          ...ensureMockDocRegistryEntry(entry.path, entry.generation),
        });
      }
      return result;
    }),
    getDocRegistryEntry: jest.fn(async (path: string) => {
      ensureDocRegistryFromStoredRows();
      const row = docRegistryRows.find((item) => item.path === path);
      return row ? { ...row } : undefined;
    }),
    getDocRegistryEntries: jest.fn(async (paths: readonly string[]) => {
      ensureDocRegistryFromStoredRows();
      const result = new Map<string, Record<string, any>>();
      for (const path of paths) {
        const row = docRegistryRows.find((item) => item.path === path);
        if (row) {
          result.set(path, { ...row });
        }
      }
      return result;
    }),
    listDocRegistryEntries: jest.fn(async () => {
      ensureDocRegistryFromStoredRows();
      return docRegistryRows.map((row) => ({ ...row }));
    }),
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
    __hybridChunks: hybridChunks,
    __hybridChunkVectors: hybridChunkVectors,
    __fileSnapshots: fileSnapshots,
    __hybridDirtyShadows: hybridDirtyShadows,
    __docRegistryRows: docRegistryRows,
    __indexRecoveryStates: indexRecoveryStates,
    __indexArtifactStates: indexArtifactStates,
    db: {
      hybridChunks: {
        toArray: jest.fn(async () => {
          ensureDocRegistryFromStoredRows();
          return hybridChunks.map((row) => ({ ...row }));
        }),
        orderBy: jest.fn((_field: string) => ({
          limit: (batchSize: number) => ({
            toArray: async () => {
              ensureDocRegistryFromStoredRows();
              return toPagedRows(
                hybridChunks,
                (row) => Number(row.id ?? 0),
                null,
                batchSize,
              );
            },
          }),
        })),
        where: jest.fn((field: string) => {
          if (field === ":id") {
            return {
              above: (lastId: number) => ({
                limit: (batchSize: number) => ({
                  toArray: async () =>
                    toPagedRows(
                      hybridChunks,
                      (row) => Number(row.id ?? 0),
                      lastId,
                      batchSize,
                    ),
                }),
              }),
            };
          }
          if (field === "filePath") {
            return {
              anyOf: (paths: readonly string[]) => ({
                toArray: async () => {
                  const pathSet = new Set(paths);
                  return hybridChunks
                    .filter((row) => pathSet.has(row.filePath))
                    .map((row) => ({ ...row }));
                },
              }),
              };
            }
          if (field === "docRef") {
            return {
              anyOf: (docRefs: readonly number[]) => ({
                toArray: async () => {
                  ensureDocRegistryFromStoredRows();
                  const docRefSet = new Set(docRefs);
                  return hybridChunks
                    .filter((row) => docRefSet.has(row.docRef))
                    .map((row) => ({ ...row }));
                },
              }),
            };
          }
          throw new Error(`Unsupported hybridChunks.where field: ${field}`);
        }),
        bulkDelete: jest.fn(async (ids: readonly number[]) => {
          const idSet = new Set(ids);
          for (let index = hybridChunks.length - 1; index >= 0; index--) {
            if (idSet.has(hybridChunks[index].id)) {
              hybridChunks.splice(index, 1);
            }
          }
        }),
      },
      hybridChunkVectors: {
        toArray: jest.fn(async () => {
          ensureDocRegistryFromStoredRows();
          return hybridChunkVectors.map((row) => ({ ...row }));
        }),
        orderBy: jest.fn((_field: string) => ({
          limit: (batchSize: number) => ({
            toArray: async () => {
              ensureDocRegistryFromStoredRows();
              return toPagedRows(
                hybridChunkVectors,
                (row) => generationKeyForRow(row),
                null,
                batchSize,
              );
            },
          }),
        })),
        where: jest.fn((_field: string) => ({
          above: (lastPath: string) => ({
            limit: (batchSize: number) => ({
              toArray: async () =>
                toPagedRows(
                  hybridChunkVectors,
                  (row) => generationKeyForRow(row),
                  lastPath,
                  batchSize,
                ),
            }),
          }),
        })),
        bulkGet: jest.fn(async (paths: readonly string[]) =>
          paths.map((path) => {
            const row =
              findByGenerationKey(hybridChunkVectors, path) ??
              hybridChunkVectors.find((item) => item.filePath === path);
            return row ? { ...row } : undefined;
          }),
        ),
        get: jest.fn(async (filePath: string) => {
          const row = hybridChunkVectors.find((item) => item.filePath === filePath);
          return row ? { ...row } : undefined;
        }),
        put: jest.fn(async (row: Record<string, any> & { filePath: string }) => {
          upsertFilePathRow(hybridChunkVectors, row);
        }),
        bulkDelete: jest.fn(async (ids: readonly string[]) => {
          const idSet = new Set(ids);
          for (let index = hybridChunkVectors.length - 1; index >= 0; index--) {
            if (idSet.has(generationKeyForRow(hybridChunkVectors[index]))) {
              hybridChunkVectors.splice(index, 1);
            }
          }
        }),
      },
      fileSnapshots: {
        get: jest.fn(async (filePath: string) => {
          const row =
            findByGenerationKey(fileSnapshots, filePath) ??
            fileSnapshots.find((item) => item.filePath === filePath);
          return row ? { ...row } : undefined;
        }),
        orderBy: jest.fn((_field: string) => ({
          limit: (batchSize: number) => ({
            toArray: async () => {
              ensureDocRegistryFromStoredRows();
              return toPagedRows(
                fileSnapshots,
                (row) => generationKeyForRow(row),
                null,
                batchSize,
              );
            },
          }),
        })),
        where: jest.fn((_field: string) => ({
          above: (lastPath: string) => ({
            limit: (batchSize: number) => ({
              toArray: async () =>
                toPagedRows(
                  fileSnapshots,
                  (row) => generationKeyForRow(row),
                  lastPath,
                  batchSize,
                ),
            }),
          }),
        })),
        bulkGet: jest.fn(async (paths: readonly string[]) =>
          paths.map((path) => {
            const row =
              findByGenerationKey(fileSnapshots, path) ??
              fileSnapshots.find((item) => item.filePath === path);
            return row ? { ...row } : undefined;
          }),
        ),
        toArray: jest.fn(async () => {
          ensureDocRegistryFromStoredRows();
          return fileSnapshots.map((row) => ({ ...row }));
        }),
        bulkDelete: jest.fn(async (ids: readonly string[]) => {
          const idSet = new Set(ids);
          for (let index = fileSnapshots.length - 1; index >= 0; index--) {
            if (idSet.has(generationKeyForRow(fileSnapshots[index]))) {
              fileSnapshots.splice(index, 1);
            }
          }
        }),
      },
      hybridDirtyShadows: {
        toArray: jest.fn(async () => {
          ensureDocRegistryFromStoredRows();
          return hybridDirtyShadows.map((row) => ({ ...row }));
        }),
        orderBy: jest.fn((_field: string) => ({
          limit: (batchSize: number) => ({
            toArray: async () => {
              ensureDocRegistryFromStoredRows();
              return toPagedRows(
                hybridDirtyShadows,
                (row) => generationKeyForRow(row),
                null,
                batchSize,
              );
            },
          }),
        })),
        where: jest.fn((_field: string) => ({
          above: (lastPath: string) => ({
            limit: (batchSize: number) => ({
              toArray: async () =>
                toPagedRows(
                  hybridDirtyShadows,
                    (row) => generationKeyForRow(row),
                    lastPath,
                    batchSize,
                  ),
            }),
          }),
        })),
        get: jest.fn(async (filePath: string) => {
          const row =
            findByGenerationKey(hybridDirtyShadows, filePath) ??
            hybridDirtyShadows.find((item) => item.filePath === filePath);
          return row ? { ...row } : undefined;
        }),
        bulkGet: jest.fn(async (paths: readonly string[]) =>
          paths.map((path) => {
            const row =
              findByGenerationKey(hybridDirtyShadows, path) ??
              hybridDirtyShadows.find((item) => item.filePath === path);
            return row ? { ...row } : undefined;
          }),
        ),
        bulkDelete: jest.fn(async (ids: readonly string[]) => {
          const idSet = new Set(ids);
          for (let index = hybridDirtyShadows.length - 1; index >= 0; index--) {
            if (idSet.has(generationKeyForRow(hybridDirtyShadows[index]))) {
              hybridDirtyShadows.splice(index, 1);
            }
          }
        }),
      },
      hybridIndexedFileRefs: {
        toArray: jest.fn(async () => {
          ensureDocRegistryFromStoredRows();
          return hybridIndexedFileRefs.map((ref) => ({ ...ref }));
        }),
        bulkGet: jest.fn(async (paths: readonly string[]) =>
          paths.map((path) => {
            ensureDocRegistryFromStoredRows();
            const row =
              hybridIndexedFileRefs.find((item) => item.docRef === path) ??
              hybridIndexedFileRefs.find((item) => item.path === path);
            return row ? { ...row } : undefined;
          }),
        ),
        orderBy: jest.fn((_field: string) => ({
          limit: (batchSize: number) => ({
            toArray: async () => {
              ensureDocRegistryFromStoredRows();
              return toPagedRows(
                hybridIndexedFileRefs,
                (row) => row.docRef ?? row.path,
                null,
                batchSize,
              );
            },
          }),
        })),
        where: jest.fn((_field: string) => ({
          above: (lastPath: string | number) => ({
            limit: (batchSize: number) => ({
              toArray: async () => {
                ensureDocRegistryFromStoredRows();
                return toPagedRows(
                  hybridIndexedFileRefs,
                  (row) => row.docRef ?? row.path,
                  lastPath,
                  batchSize,
                );
              },
            }),
          }),
        })),
        get: jest.fn(async (path: string) => {
          ensureDocRegistryFromStoredRows();
          const row =
            hybridIndexedFileRefs.find((item) => item.docRef === path) ??
            hybridIndexedFileRefs.find((item) => item.path === path);
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
          },
        ),
        bulkDelete: jest.fn(async (docRefs: readonly number[]) => {
          const docRefSet = new Set(docRefs);
          for (let index = hybridIndexedFileRefs.length - 1; index >= 0; index--) {
            if (docRefSet.has(hybridIndexedFileRefs[index].docRef)) {
              hybridIndexedFileRefs.splice(index, 1);
            }
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
          },
        ),
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
  const mock = {
    addDocuments: jest.fn(async () => {}),
    deleteDocuments: jest.fn(() => {}),
    beginBatchReindex: jest.fn(() => {}),
    finishBatchReindex: jest.fn(() => {}),
    abortBatchReindex: jest.fn(() => {}),
    supportsSerializedFileIndex: jest.fn(() => true),
    supportsPersistentFileIndex: jest.fn(() => false),
    reIndexAll: jest.fn(async () => true),
    serializeFileIndex: jest.fn(() => null),
    restorePersistedFileIndex: jest.fn(async () => false),
    planPersistentRecovery: jest.fn(async () => null),
    persistFileIndexArtifact: jest.fn(async () => {}),
    clearPersistedFileIndexArtifact: jest.fn(async () => {}),
    estimateFileIndexBytes: jest.fn(() => 0),
    getFileIndexBreakdown: jest.fn(() => null),
    buildBodyTokenColdDocument: jest.fn(
      (path: string, generation: number | undefined, bodyText: string) => ({
        path,
        generation,
        bodyTokens: bodyText.length === 0 ? [] : [bodyText],
      }),
    ),
    buildBodyHanExactSidecarDocument: jest.fn(
      (path: string, generation: number | undefined, bodyText: string) =>
        bodyText.length === 0
          ? null
          : {
              path,
              generation,
              logicalBlocks: [
                {
                  blockOrdinal: 0,
                  bodyHanSymbolIds: Uint32Array.from([1, 2]),
                  bigramIds: [1],
                  encodedByteLength: bodyText.length,
                  symbolCount: 2,
                  segmentCount: 1,
                },
              ],
            },
    ),
    clearIndex: jest.fn(() => {}),
  };
  const moveDocument = jest.fn(async (oldPath: string, document: any) => {
    mock.deleteDocuments([oldPath, document.path]);
    await mock.addDocuments([document]);
    return true;
  });
  return {
    ...mock,
    moveDocument,
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
    getIndexedDocumentMetadata: jest.fn((fileOrPath: TFile | string) => {
      const path =
        typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
      const text = texts.get(path) ?? "";
      return {
        aliasesText: "",
        tagsText: "",
        headingsText: "",
        contentFingerprint: text,
      };
    }),
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

const dataManagersToCleanup = new Set<DataManager>();

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
    flushPendingModifications: jest.fn(async () => undefined),
  };
  const { OuterSetting } =
    require("src/globals/plugin-setting") as typeof import("src/globals/plugin-setting");

  const baseReadPlainText = params.dataProvider.readPlainText.getMockImplementation();
  params.dataProvider.readPlainText.mockImplementation(
    async (fileOrPath: TFile | string) => {
      const text = baseReadPlainText ? await baseReadPlainText(fileOrPath) : "";
      const path =
        typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
      const file =
        typeof fileOrPath === "string"
          ? params.dataProvider.getFileByPath(path)
          : fileOrPath;
      if (file instanceof MockTFile) {
        params.fileSnapshotStore.current.set(path, {
          text,
          generation: file.stat.mtime,
        });
      }
      return text;
    },
  );

  params.fileSnapshotStore.hybridIndexedRefs =
    params.database.__hybridIndexedFileRefs;

  container.registerInstance(THIS_PLUGIN, plugin as any);
  container.registerInstance(OuterSetting, params.setting as any);
  container.registerInstance(Database, params.database as any);
  container.registerInstance(DataProvider, params.dataProvider as any);
  container.registerInstance(LexicalEngine, params.lexicalEngine as any);
  container.registerInstance(
    FileSnapshotStore,
    params.fileSnapshotStore as any,
  );
  container.registerInstance(Tokenizer, createMockTokenizer() as any);

  container.registerInstance(SearchService, {
    hybridEngine: params.hybridEngine,
  } as any);
  container.registerInstance(FileWatcher, fileWatcher as any);

  return { plugin, fileWatcher };
}

function resolveDataManager(): DataManager {
  const manager = container.resolve(DataManager);
  dataManagersToCleanup.add(manager);
  return manager;
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
    for (const manager of dataManagersToCleanup) {
      manager.onunload();
    }
    dataManagersToCleanup.clear();
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

  
  test("flushPendingDocOperations drains pending file watcher changes before flushing doc operations", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const file = createFile("docs/live.md", "live body", 320);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "live body"]]);
    const database = createMockDatabase();
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
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

    const manager = resolveDataManager();
    const forceFlushSpy = jest.spyOn((manager as any).docOperationsBuffer, "forceFlush");

    await manager.flushPendingDocOperations();

    expect(fileWatcher.flushPendingModifications).toHaveBeenCalledTimes(1);
    expect(forceFlushSpy).toHaveBeenCalledTimes(1);
    expect(fileWatcher.flushPendingModifications.mock.invocationCallOrder[0]).toBeLessThan(
      forceFlushSpy.mock.invocationCallOrder[0],
    );
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
    database.__hybridIndexedFileRefs.push({
      path: oldPath,
      generation: 180,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: 180,
    });
    database.__fileSnapshots.push({
      filePath: oldPath,
      plainText: "old content",
      generation: 180,
    });
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

    const manager = resolveDataManager();
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
    expect(hybridEngine.moveFile).not.toHaveBeenCalled();
    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(oldPath);
    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(newPath);
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
      hasLexicalQueryEvidenceReadyMarker: jest.fn(async () => true),
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
          residentHot: {
            total: 80258,
            postings: {
              exactIncidence: 32768,
              metadataHanGate: 3072,
            },
            documents: {
              view: 18432,
            },
            verification: {
              bodyHanSegments: 4096,
            },
            lexicon: {
              latinExpansion: 4096,
            },
            caches: {
              bodyTokensHot: 17794,
            },
          },
          coldOwned: {
            total: 18432,
            bodyTokensSidecar: 11264,
            bodyHanSegmentExactSidecar: 7168,
          },
          overlapDiagnostics: {
            total: 13312,
            bodyTokensHotVsSidecar: 8192,
            pathMirrors: 4096,
            manifestMirrors: 1024,
          },
          combinedOwnedTotal: 98690,
        },
      })),
    });
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.getRuntimeMemoryEstimate.mockReturnValue({
      pathBytes: 64,
      currentTextBytes: 5120,
      generationBytes: 8,
      fileCount: 1,
      slotCount: 1,
      freeSlotCount: 0,
      totalBytes: 5192,
      largestEntries: [
        {
          path: "docs/a.md",
          totalBytes: 5192,
          pathBytes: 64,
          textBytes: 5120,
          generationBytes: 8,
        },
      ],
    });
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
      getRuntimeMemoryEstimate: jest.fn(() => ({
        vectorsBytes: 16384,
        graphBytes: 8192,
        totalBytes: 24576,
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

    const manager = resolveDataManager();
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
    jest.spyOn(manager as any, "sampleJsHeapUsage").mockReturnValue({
      usedBytes: 262144,
      totalBytes: 524288,
      limitBytes: 1048576,
    });
    await (manager as any).noticeDevStorageStats();

    const latestNotice = MyNotice.messages[MyNotice.messages.length - 1];
    expect(latestNotice).toContain("Lexical memory report");
    expect(latestNotice).toContain("Coverage resident hot");
    expect(latestNotice).toContain("Coverage cold owned");
    expect(latestNotice).toContain("Coverage combined owned");
    expect(latestNotice).toContain("Coverage resident major groups");
    expect(latestNotice).toContain("Coverage cold owned groups");
    expect(latestNotice).toContain("bodyHanSegmentExact(cold)");
    expect(latestNotice).toContain("Coverage top resident segments (top 10)");
    expect(latestNotice).toContain("Coverage top cold/overlap segments (top 10)");
    expect(latestNotice).toContain("lexicon(total)");
    expect(latestNotice).not.toContain("Persisted storage");
    expect(latestNotice).not.toContain("Runtime memory estimate");
    expect(latestNotice).not.toContain("JS heap used now:");
    expect(latestNotice).not.toContain("Current text runtime split");
    expect(groupSpy).toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    const tableRows = tableSpy.mock.calls.flatMap((call) =>
      Array.isArray(call[0]) ? call[0] : [],
    );
    expect(tableRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segment: "postings.total",
        }),
        expect.objectContaining({
          segment: "documents.view",
          bytes: 18432,
        }),
        expect.objectContaining({
          segment: "doc.bodyTokens(hot)",
          bytes: 17794,
        }),
        expect.objectContaining({
          segment: "doc.bodyTokens(cold)",
          bytes: 11264,
        }),
        expect.objectContaining({
          segment: "doc.bodyHanSegmentExact(cold)",
          bytes: 7168,
        }),
        expect.objectContaining({
          segment: "overlap.bodyTokens(hot+cold)",
        }),
        expect.objectContaining({
          segment: "lexicon.total",
        }),
      ]),
    );
  });

  test("noticeDevStorageStats attributes v2 lexical breakdown without collapsing into other", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;
    const file = createFile("docs/a.md", "alpha body", 320);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "alpha body"]]);
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
      data: new ArrayBuffer(24),
    };
    database.estimatePluginStorageUsage = jest.fn(async () => ({
      tables: [
        { name: "lexicalSearchSnapshots", rows: 1, bytes: 3559 },
        { name: "lexicalV2IndexStoreMeta", rows: 1, bytes: 64 },
        { name: "lexicalV2IndexStoreSnapshotChunks", rows: 1, bytes: 2048 },
        { name: "lexicalV2IndexStoreJournal", rows: 1, bytes: 512 },
        { name: "fileSnapshots", rows: 1, bytes: 71257 },
        { name: "hybridChunks", rows: 0, bytes: 0 },
        { name: "hybridChunkVectors", rows: 0, bytes: 0 },
        { name: "lexicalIndexedFileRefs", rows: 1, bytes: 128 },
      ],
    }));
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine({
      supportsPersistentFileIndex: jest.fn(() => true),
      reIndexAll: jest.fn(async () => false),
      serializeFileIndex: jest.fn(() => rebuiltSnapshot),
      estimateFileIndexBytes: jest.fn(() => 3872),
      getFileIndexBreakdown: jest.fn(() => ({
        estimatedBytes: {
          residentHot: {
            total: 3872,
            postings: {
              exactIncidence: 1536,
              metadataHanGate: 256,
            },
            documents: {
              view: 640,
            },
            verification: {
              bodyHanSegments: 128,
            },
            lexicon: {
              latinExpansion: 320,
            },
            caches: {
              bodyTokensHot: 992,
            },
          },
          coldOwned: {
            total: 1344,
            bodyTokensSidecar: 992,
            bodyHanSegmentExactSidecar: 352,
          },
          overlapDiagnostics: {
            total: 1248,
            bodyTokensHotVsSidecar: 992,
            pathMirrors: 192,
            manifestMirrors: 64,
          },
          combinedOwnedTotal: 5216,
        },
      })),
    });
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.getRuntimeMemoryEstimate.mockReturnValue({
      pathBytes: 64,
      currentTextBytes: 5120,
      generationBytes: 8,
      fileCount: 1,
      slotCount: 1,
      freeSlotCount: 0,
      totalBytes: 5192,
      largestEntries: [],
    });
    const hybridEngine = createMockHybridEngine({
      isEnabled: jest.fn(() => false),
      getRuntimeMemoryEstimate: jest.fn(() => ({
        vectorsBytes: 0,
        graphBytes: 0,
        totalBytes: 0,
      })),
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

    const manager = resolveDataManager();
    (manager as any).isLexicalEngineUpToDate = true;

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    const tableSpy = jest.spyOn(console, "table").mockImplementation(() => {});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const groupSpy = jest
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => {});
    const endSpy = jest.spyOn(console, "groupEnd").mockImplementation(() => {});
    jest.spyOn(manager as any, "sampleJsHeapUsage").mockReturnValue(null);

    await (manager as any).noticeDevStorageStats();

    const latestNotice = MyNotice.messages[MyNotice.messages.length - 1];
    expect(latestNotice).toContain("Lexical memory report");
    expect(latestNotice).toContain("Persisted lexical snapshot: 3.5 KB");
    expect(latestNotice).toContain("Coverage resident hot");
    expect(latestNotice).toContain("Coverage cold owned");
    expect(latestNotice).toContain("Coverage resident major groups");
    expect(latestNotice).toContain("Coverage cold owned groups");
    expect(latestNotice).toContain("documents(view)");
    expect(latestNotice).toContain("bodyTokens(cold)");
    expect(latestNotice).toContain("bodyHanSegmentExact(cold)");
    expect(latestNotice).toContain("lexicon(total)");
    expect(latestNotice).toContain("postings.exactIncidence");
    expect(latestNotice).not.toContain("JS heap used now:");
    expect(groupSpy).toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    const tableRows = tableSpy.mock.calls.flatMap((call) =>
      Array.isArray(call[0]) ? call[0] : [],
    );
    expect(tableRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segment: "postings.total",
        }),
        expect.objectContaining({
          segment: "doc.bodyTokens(hot)",
          bytes: 992,
        }),
        expect.objectContaining({
          segment: "doc.bodyTokens(cold)",
          bytes: 992,
        }),
        expect.objectContaining({
          segment: "doc.bodyHanSegmentExact(cold)",
          bytes: 352,
        }),
        expect.objectContaining({
          segment: "lexicon.latinExpansion",
          bytes: 320,
        }),
        expect.objectContaining({
          segment: "documents.view",
          bytes: 640,
        }),
        expect.objectContaining({
          segment: "overlap.bodyTokens(hot+cold)",
          bytes: 992,
        }),
      ]),
    );
    expect(tableRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segment: "other",
        }),
      ]),
    );
  });

  test("onunload does not persist lexical snapshot artifacts", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;
    const file = createFile("docs/unload.md", "alpha body", 320);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "alpha body"]]);
    const database = createMockDatabase();
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine({
      supportsPersistentFileIndex: jest.fn(() => true),
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

    const manager = resolveDataManager();
    (manager as any).isLexicalEngineUpToDate = true;

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    (lexicalEngine.persistFileIndexArtifact as jest.Mock).mockClear();

    manager.onunload();

    expect(lexicalEngine.persistFileIndexArtifact).not.toHaveBeenCalled();
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

    const manager = resolveDataManager();
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

    const manager = resolveDataManager();
    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
    expect(lexicalEngine.reIndexAll).not.toHaveBeenCalled();
    expect(lexicalEngine.addDocuments).not.toHaveBeenCalled();
    expect(await database.getLexicalIndexedFileRefs()).toEqual([]);
    expect(fileSnapshotStore.persisted.has(deletedPath)).toBe(false);
    expect(fileSnapshotStore.retainOnlyFiles).toHaveBeenCalledWith(
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

    const runtimeManager = resolveDataManager();
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

    const restartManager = resolveDataManager();
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

    const runtimeManager = resolveDataManager();
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

    const restartManager = resolveDataManager();
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
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);

    try {
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
          lastFailedAt: 1_000,
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
          lastFailedAt: 2_000,
          nextRetryAt: 5_000,
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
          lastFailedAt: 3_000,
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
          lastFailedAt: 4_000,
          nextRetryAt: 6_000,
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
          lastFailedAt: 5_000,
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

      const manager = resolveDataManager();
      const scheduleSpy = jest
        .spyOn(manager as any, "scheduleHybridRepairFlush")
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

      manager.onunload();
    } finally {
      nowSpy.mockRestore();
    }
  });
  test("ignores legacy hybrid recovery file-ref fields once indexRecoveryState is empty", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const retryableFile = createFile(
      "docs/retryable.md",
      "retryable body",
      100,
    );
    const deferredFile = createFile("docs/deferred.md", "deferred body", 110);
    const files = new Map<string, TFile>([
      [retryableFile.path, retryableFile],
      [deferredFile.path, deferredFile],
    ]);
    const texts = new Map<string, string>([
      [retryableFile.path, "retryable body"],
      [deferredFile.path, "deferred body"],
    ]);

    const database = createMockDatabase();
    (database as any).__hybridIndexedFileRefs.push(
      {
        path: retryableFile.path,
        generation: retryableFile.stat.mtime,
        state: "lexical_only",
        chunkCount: 2,
        lastErrorKind: "provider_429",
        lastIncrementalEmbedAt: 4_000,
        indexedAt: 7_000,
      },
      {
        path: deferredFile.path,
        generation: deferredFile.stat.mtime,
        state: "lexical_only",
        chunkCount: 3,
        embeddingDeferred: true,
        lastIncrementalEmbedAt: 5_000,
        indexedAt: 8_000,
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

    const manager = resolveDataManager();
    jest
      .spyOn(manager as any, "scheduleHybridRepairFlush")
      .mockImplementation(() => {});

    const previousIndexedFileRefs = new Map(
      (database as any).__hybridIndexedFileRefs.map(
        (row: Record<string, any>) => [row.path, row],
      ),
    );

    await (manager as any).restorePersistedHybridRecoveryState(
      files,
      previousIndexedFileRefs,
    );
    await (manager as any).enqueuePersistedHybridRecoveryStates(new Set());

    expect((database as any).__indexRecoveryStates).toEqual([]);
    expect(database.putIndexRecoveryState).not.toHaveBeenCalled();
    expect((manager as any).hybridRepairQueue.size).toBe(0);
    expect(await manager.getHybridDeferredEmbeddingSummary()).toEqual({
      deferredCount: 0,
      nextEligibleAt: null,
      totalFiles: 2,
    });
    expect((database as any).__hybridIndexedFileRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: retryableFile.path,
          lastErrorKind: "provider_429",
        }),
        expect.objectContaining({
          path: deferredFile.path,
          embeddingDeferred: true,
        }),
      ]),
    );
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

      const manager = resolveDataManager();
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
              state: "lexical_only",
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
  test("blocking hybrid recovery does not spin retry timers after startup restore", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);

    try {
      const setting = cloneSetting();
      setting.hybrid.enabled = true;

      const file = createFile("docs/blocking.md", "blocking body", 100);
      const files = new Map<string, TFile>([[file.path, file]]);
      const texts = new Map<string, string>([[file.path, "blocking body"]]);
      const database = createMockDatabase();
      database.__indexRecoveryStates.push({
        id: `hybrid:${file.path}`,
        engine: "hybrid",
        path: file.path,
        targetGeneration: file.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "blocking",
        failureKind: "auth_403",
        failureMessage: "Embedding API error 403",
        attemptCount: 1,
        lastFailedAt: 90_000,
        nextRetryAt: null,
        isBlocking: true,
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

      const manager = resolveDataManager();
      const scheduleSpy = jest
        .spyOn(manager as any, "scheduleHybridRepairFlush")
        .mockImplementation(() => {});

      await (manager as any).restorePersistedHybridRecoveryState(files, new Map());
      await (manager as any).enqueuePersistedHybridRecoveryStates(new Set());

      expect((manager as any).hybridRepairQueue.get(file.path)).toMatchObject({
        path: file.path,
        mode: "incremental",
        reason: "startup-recover-persisted-state",
        sourceGeneration: file.stat.mtime,
      });
      expect(scheduleSpy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30 * 60_000);

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      expect(database.putIndexRecoveryState).not.toHaveBeenCalled();

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

    const manager = resolveDataManager();
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
            state: "lexical_only",
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

  test("startup self-heal rejects mixed-generation shared snapshot and reindexes the file", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/mixed-generation.md", "fresh body", 100);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "fresh body"]]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      generation: file.stat.mtime,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: file.stat.mtime,
    });
    database.__hybridChunks.push({
      id: 1,
      filePath: file.path,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      embedKey: "chunk-0",
    });
    database.__hybridChunkVectors.push({
      filePath: file.path,
      precision: "int8",
      dim: 2,
      chunkCount: 1,
      generation: file.stat.mtime,
      chunkIds: new Blob([Uint32Array.from([1]).buffer]),
      vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
    });
    database.__fileSnapshots.push({
      filePath: file.path,
      plainText: "stale snapshot",
      generation: file.stat.mtime - 1,
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      canServeQuery: jest.fn(() => true),
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

    const manager = resolveDataManager();

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(file.path, {
      persistIndices: false,
    });
    expect(hybridEngine.indexFileStrict).toHaveBeenCalledWith(
      file.path,
      "fresh body",
      file.stat.mtime,
      { persistIndices: false },
      [],
    );
    expect(hybridEngine.persistIndicesForBatch).toHaveBeenCalled();

    manager.onunload();
  });

  test("hybrid health summary reports shadow-aligned and shadow-mismatch counts", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const currentAlignedFile = createFile("docs/current-aligned.md", "alpha", 100);
    const shadowAlignedFile = createFile("docs/shadow-aligned-health.md", "beta", 121);
    const shadowMismatchFile = createFile("docs/shadow-mismatch-health.md", "gamma", 141);
    const files = new Map<string, TFile>([
      [currentAlignedFile.path, currentAlignedFile],
      [shadowAlignedFile.path, shadowAlignedFile],
      [shadowMismatchFile.path, shadowMismatchFile],
    ]);
    const texts = new Map<string, string>([
      [currentAlignedFile.path, "alpha"],
      [shadowAlignedFile.path, "beta"],
      [shadowMismatchFile.path, "gamma"],
    ]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push(
      {
        path: currentAlignedFile.path,
        generation: 100,
        state: "ready",
        chunkCount: 1,
        vectorPrecision: "int8",
        indexedAt: 100,
      },
      {
        path: shadowAlignedFile.path,
        generation: 120,
        state: "ready",
        chunkCount: 1,
        vectorPrecision: "int8",
        indexedAt: 120,
      },
      {
        path: shadowMismatchFile.path,
        generation: 140,
        state: "ready",
        chunkCount: 1,
        vectorPrecision: "int8",
        indexedAt: 140,
      },
    );
    database.__hybridChunks.push(
      {
        id: 1,
        filePath: currentAlignedFile.path,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 5,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        embedKey: "chunk-0",
      },
      {
        id: 2,
        filePath: shadowAlignedFile.path,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 4,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        embedKey: "chunk-0",
      },
      {
        id: 3,
        filePath: shadowMismatchFile.path,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 5,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        embedKey: "chunk-0",
      },
    );
    database.__hybridChunkVectors.push(
      {
        filePath: currentAlignedFile.path,
        precision: "int8",
        dim: 2,
        chunkCount: 1,
        generation: 100,
        chunkIds: new Blob([Uint32Array.from([1]).buffer]),
        vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
      },
      {
        filePath: shadowAlignedFile.path,
        precision: "int8",
        dim: 2,
        chunkCount: 1,
        generation: 120,
        chunkIds: new Blob([Uint32Array.from([2]).buffer]),
        vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
      },
      {
        filePath: shadowMismatchFile.path,
        precision: "int8",
        dim: 2,
        chunkCount: 1,
        generation: 140,
        chunkIds: new Blob([Uint32Array.from([3]).buffer]),
        vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
      },
    );
    database.__fileSnapshots.push(
      {
        filePath: currentAlignedFile.path,
        plainText: "alpha",
        generation: 100,
      },
      {
        filePath: shadowAlignedFile.path,
        plainText: "beta fresh",
        generation: 121,
      },
      {
        filePath: shadowMismatchFile.path,
        plainText: "gamma fresh",
        generation: 141,
      },
    );
    database.__hybridDirtyShadows.push(
      {
        filePath: shadowAlignedFile.path,
        plainText: "beta indexed",
        generation: 120,
      },
      {
        filePath: shadowMismatchFile.path,
        plainText: "gamma stale",
        generation: 139,
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

    const manager = resolveDataManager();

    const summary = await manager.getHybridHealthSummary();

    expect(summary.state).toBe("partial");
    expect(summary.trackedFileCount).toBe(3);
    expect(summary.indexedFileRefCount).toBe(3);
    expect(summary.currentAlignedSnapshotCount).toBe(1);
    expect(summary.shadowAlignedSnapshotCount).toBe(1);
    expect(summary.shadowMismatchCount).toBe(1);
    expect(summary.shadowMismatchSamplePaths).toEqual([
      shadowMismatchFile.path,
    ]);
    expect(summary.processingFileCount).toBe(0);
    expect(summary.staleFileCount).toBe(2);
    expect(summary.repairFileCount).toBe(0);
    expect(summary.processingSamplePaths).toEqual([]);
    expect(summary.staleSamplePaths).toEqual([
      shadowAlignedFile.path,
      shadowMismatchFile.path,
    ]);

    manager.onunload();
  });

  test("hybrid freshness summary is read-only and maintenance reconciles stale paths", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const processingFile = createFile("docs/processing.md", "processing", 220);
    const staleFile = createFile("docs/stale.md", "stale", 330);
    const files = new Map<string, TFile>([
      [processingFile.path, processingFile],
      [staleFile.path, staleFile],
    ]);
    const texts = new Map<string, string>([
      [processingFile.path, "processing"],
      [staleFile.path, "stale"],
    ]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push(
      {
        path: processingFile.path,
        generation: 200,
        state: "ready",
        chunkCount: 1,
        vectorPrecision: "int8",
        indexedAt: 200,
      },
      {
        path: staleFile.path,
        generation: 300,
        state: "ready",
        chunkCount: 1,
        vectorPrecision: "int8",
        indexedAt: 300,
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

    const manager = resolveDataManager();
    const { logger } =
      require("src/utils/logger") as typeof import("src/utils/logger");
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);

    (manager as any).enqueueHybridRepair({
      path: processingFile.path,
      mode: "full",
      reason: "test-processing",
      sourceGeneration: processingFile.stat.mtime,
    });

    const firstSummary = await manager.getHybridFreshnessSummary();
    expect(firstSummary.processingFileCount).toBe(1);
    expect(firstSummary.staleFileCount).toBe(1);
    expect(firstSummary.processingSamplePaths).toEqual([processingFile.path]);
    expect(firstSummary.staleSamplePaths).toEqual([staleFile.path]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect((manager as any).hybridRepairQueue.has(staleFile.path)).toBe(false);

    await (manager as any).maintainHybridFreshness();

    const secondSummary = await manager.getHybridFreshnessSummary();
    expect(secondSummary).toMatchObject({
      processingFileCount: 2,
      staleFileCount: 0,
    });
    expect(secondSummary.processingSamplePaths).toEqual([
      processingFile.path,
      staleFile.path,
    ]);
    expect(secondSummary.staleSamplePaths).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "hybrid freshness detected stale files outside repair flow:",
      expect.objectContaining({
        staleFileCount: 1,
        staleSamplePaths: [staleFile.path],
      }),
    );

    warnSpy.mockRestore();
    manager.onunload();
  });

  test("hybrid freshness counts pending doc-buffer dirty paths as processing", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/pending-buffer.md", "pending", 220);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "pending"]]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      generation: 180,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: 180,
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

    const manager = resolveDataManager();
    manager.receiveDocOperation(new DocUpsertOperation(file.path, file.stat.mtime));

    const summary = await manager.getHybridFreshnessSummary();

    expect(summary.processingFileCount).toBe(1);
    expect(summary.staleFileCount).toBe(0);
    expect(summary.processingSamplePaths).toEqual([file.path]);

    manager.onunload();
  });

  test("hybrid freshness counts pending-persist repair paths as processing", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/pending-persist.md", "pending", 220);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "pending"]]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      generation: 180,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: 180,
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

    const manager = resolveDataManager();
    (manager as any).hybridRepairPendingPersistPaths.add(file.path);

    const summary = await manager.getHybridFreshnessSummary();

    expect(summary.processingFileCount).toBe(1);
    expect(summary.staleFileCount).toBe(0);
    expect(summary.processingSamplePaths).toEqual([file.path]);

    manager.onunload();
  });

  test("runtime repair batch clears inconsistent local state before reindexing", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const corruptFile = createFile("docs/corrupt-runtime.md", "corrupt", 220);
    const healthyFile = createFile("docs/healthy-runtime.md", "healthy", 221);
    const files = new Map<string, TFile>([
      [corruptFile.path, corruptFile],
      [healthyFile.path, healthyFile],
    ]);
    const texts = new Map<string, string>([
      [corruptFile.path, "corrupt"],
      [healthyFile.path, "healthy"],
    ]);
    const database = createMockDatabase();
    database.__hybridChunks.push(
      {
        id: 1,
        filePath: corruptFile.path,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 7,
        startLine: 0,
        startCol: 0,
        endLine: 0,
        embedKey: "corrupt-0",
      },
      {
        id: 2,
        filePath: healthyFile.path,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 7,
        startLine: 0,
        startCol: 0,
        endLine: 0,
        embedKey: "healthy-0",
      },
    );
    database.__fileSnapshots.push(
      {
        filePath: corruptFile.path,
        plainText: "corrupt",
        generation: corruptFile.stat.mtime,
      },
      {
        filePath: healthyFile.path,
        plainText: "healthy",
        generation: healthyFile.stat.mtime,
      },
    );
    database.__hybridChunkVectors.push({
      filePath: healthyFile.path,
      chunkCount: 1,
      generation: healthyFile.stat.mtime,
      precision: "int8",
    });
    database.__hybridIndexedFileRefs.push({
      path: healthyFile.path,
      generation: healthyFile.stat.mtime,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: healthyFile.stat.mtime,
    });
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

    const manager = resolveDataManager();
    const failures: Array<Record<string, unknown>> = [];

    await (manager as any).runHybridRepairTasks(
      [
        {
          path: corruptFile.path,
          mode: "incremental",
          reason: "freshness-reconcile-stale",
          eligibleAt: Date.now(),
          enqueuedAt: Date.now(),
          sourceGeneration: corruptFile.stat.mtime,
        },
        {
          path: healthyFile.path,
          mode: "incremental",
          reason: "freshness-reconcile-stale",
          eligibleAt: Date.now(),
          enqueuedAt: Date.now(),
          sourceGeneration: healthyFile.stat.mtime,
        },
      ],
      null,
      0,
      failures as any,
    );

    expect(database.db.hybridIndexedFileRefs.bulkGet).toHaveBeenCalledWith([
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(corruptFile.path, {
      persistIndices: false,
    });
    expect(hybridEngine.deleteFile).not.toHaveBeenCalledWith(healthyFile.path, {
      persistIndices: false,
    });
    expect(
      hybridEngine.deleteFile.mock.invocationCallOrder[0],
    ).toBeLessThan(hybridEngine.indexFileStrict.mock.invocationCallOrder[0]);

    manager.onunload();
  });

  test("hybrid health summary does not treat stored data without indexed refs as healthy", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/orphaned-hybrid.md", "orphan body", 150);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "orphan body"]]);
    const database = createMockDatabase();
    database.__hybridChunks.push({
      id: 1,
      filePath: file.path,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 11,
      startLine: 0,
      startCol: 0,
      endLine: 0,
      embedKey: "orphan-chunk",
    });
    database.__hybridChunkVectors.push({
      filePath: file.path,
      chunkCount: 1,
      generation: file.stat.mtime,
      precision: "int8",
    });
    database.__fileSnapshots.push({
      filePath: file.path,
      plainText: "orphan body",
      generation: file.stat.mtime,
    });
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

    const manager = resolveDataManager();

    const summary = await manager.getHybridHealthSummary();

    expect(summary.state).toBe("degraded");
    expect(summary.indexedFileRefCount).toBe(0);
    expect(summary.readyFileCount).toBe(0);
    expect(summary.lexicalOnlyFileCount).toBe(0);
    expect(summary.unstableFileCount).toBe(1);

    manager.onunload();
  });

  test("hybrid health summary treats ready refs with missing hybrid data as unstable", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/broken-ready.md", "body", 160);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "body"]]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      generation: file.stat.mtime,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: file.stat.mtime,
    });
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

    const manager = resolveDataManager();

    const summary = await manager.getHybridHealthSummary();

    expect(summary.state).toBe("degraded");
    expect(summary.indexedFileRefCount).toBe(1);
    expect(summary.readyFileCount).toBe(0);
    expect(summary.lexicalOnlyFileCount).toBe(0);
    expect(summary.unstableFileCount).toBe(1);

    manager.onunload();
  });

  test("startup keeps shadow-aligned hybrid state out of corruption self-heal", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/shadow-aligned.md", "fresh body", 101);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "fresh body"]]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      generation: file.stat.mtime - 1,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: file.stat.mtime - 1,
    });
    database.__hybridChunks.push({
      id: 1,
      filePath: file.path,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      embedKey: "chunk-0",
    });
    database.__hybridChunkVectors.push({
      filePath: file.path,
      precision: "int8",
      dim: 2,
      chunkCount: 1,
      generation: file.stat.mtime - 1,
      chunkIds: new Blob([Uint32Array.from([1]).buffer]),
      vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
    });
    database.__fileSnapshots.push({
      filePath: file.path,
      plainText: "fresh body",
      generation: file.stat.mtime,
    });
    database.__hybridDirtyShadows.push({
      filePath: file.path,
      plainText: "indexed body",
      generation: file.stat.mtime - 1,
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      canServeQuery: jest.fn(() => true),
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

    const manager = resolveDataManager();

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(hybridEngine.deleteFile).toHaveBeenCalledTimes(1);
    expect(hybridEngine.indexFileStrict).toHaveBeenCalledWith(
      file.path,
      "fresh body",
      file.stat.mtime,
      { persistIndices: false },
      [],
    );

    manager.onunload();
  });

  test("startup self-heal reindexes when ref, current snapshot, and shadow disagree after a partial write crash", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/partial-write-crash.md", "fresh body", 141);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "fresh body"]]);
    const database = createMockDatabase();
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      generation: file.stat.mtime - 1,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
      indexedAt: file.stat.mtime - 1,
    });
    database.__hybridChunks.push({
      id: 1,
      filePath: file.path,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      embedKey: "chunk-0",
    });
    database.__hybridChunkVectors.push({
      filePath: file.path,
      precision: "int8",
      dim: 2,
      chunkCount: 1,
      generation: file.stat.mtime - 1,
      chunkIds: new Blob([Uint32Array.from([1]).buffer]),
      vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
    });
    database.__fileSnapshots.push({
      filePath: file.path,
      plainText: "current body",
      generation: file.stat.mtime,
    });
    database.__hybridDirtyShadows.push({
      filePath: file.path,
      plainText: "stale indexed body",
      generation: file.stat.mtime - 2,
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      canServeQuery: jest.fn(() => true),
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

    const manager = resolveDataManager();

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(file.path, {
      persistIndices: false,
    });
    expect(hybridEngine.indexFileStrict).toHaveBeenCalledWith(
      file.path,
      "fresh body",
      file.stat.mtime,
      { persistIndices: false },
      [],
    );

    manager.onunload();
  });

  test("startup self-heal clears orphaned hybrid shadows before reindexing", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/orphan-shadow.md", "orphan body", 130);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "orphan body"]]);
    const database = createMockDatabase();
    database.__hybridDirtyShadows.push({
      filePath: file.path,
      plainText: "orphan body",
      generation: file.stat.mtime - 1,
    });
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine();
    const fileSnapshotStore = createMockFileSnapshotStore();
    const hybridEngine = createMockHybridEngine({
      canServeQuery: jest.fn(() => true),
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

    const manager = resolveDataManager();

    await manager.initAsync();
    await (manager as any).searchBootstrapCommitTask;

    expect(hybridEngine.deleteFile).toHaveBeenCalledWith(file.path, {
      persistIndices: false,
    });
    expect(hybridEngine.indexFileStrict).toHaveBeenCalledWith(
      file.path,
      "orphan body",
      file.stat.mtime,
      { persistIndices: false },
      [],
    );

    manager.onunload();
  });

  test("hybrid runtime move reuse reads snapshots by docRef generation key", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = true;

    const file = createFile("docs/moved.md", "moved body", 170);
    const database = createMockDatabase();
    database.__docRegistryRows.push({
      docRef: 42,
      path: file.path,
      deleted: false,
      liveGeneration: file.stat.mtime,
      updatedAt: file.stat.mtime,
    });
    database.__fileSnapshots.push({
      id: "42:170",
      docRef: 42,
      plainText: "moved body",
      generation: file.stat.mtime,
    } as any);
    database.__hybridIndexedFileRefs.push({
      path: file.path,
      docRef: 42,
      generation: file.stat.mtime,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
    });
    const fileSnapshotStore = createMockFileSnapshotStore();

    registerDataManagerDeps({
      setting,
      pluginFiles: [file],
      database,
      dataProvider: createMockDataProvider({
        files: new Map([[file.path, file]]),
        texts: new Map([[file.path, "moved body"]]),
      }),
      lexicalEngine: createMockLexicalEngine(),
      fileSnapshotStore,
      hybridEngine: createMockHybridEngine(),
    });

    const manager = resolveDataManager();

    await expect(
      (manager as any).canReuseMovedHybridState(file.path),
    ).resolves.toBe(true);

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

    const manager = resolveDataManager();
    (manager as any).scheduleHybridRepairFlush = jest.fn();
    manager.receiveDocOperation(new DocDeleteOperation(file.path));
    await (manager as any).docOperationsBuffer.forceFlush();

    expect(fileSnapshotStore.persisted.has(file.path)).toBe(false);
    expect(fileSnapshotStore.removeFiles).toHaveBeenCalledWith([
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

    const manager = resolveDataManager();
    await (manager as any).reindexLexicalEngineWithCurrFiles();

    expect(fileSnapshotStore.persisted.get(liveFile.path)).toEqual({
      text: "live body",
      generation: liveFile.stat.mtime,
    });
    expect(fileSnapshotStore.persisted.has("docs/stale.md")).toBe(false);
    expect(fileSnapshotStore.retainOnlyFiles).toHaveBeenCalledWith(
      new Set([liveFile.path]),
    );
  });

  test("startup lexical bootstrap no longer builds legacy offload documents", async () => {
    const setting = cloneSetting();
    setting.hybrid.enabled = false;

    const file = createFile("docs/han.md", "委员锟斤拷锟斤拷", 420);
    const files = new Map<string, TFile>([[file.path, file]]);
    const texts = new Map<string, string>([[file.path, "委员锟斤拷锟斤拷"]]);

    const database = createMockDatabase();
    await database.setLexicalIndexedFileRefs([
      {
        path: file.path,
        generation: file.stat.mtime,
        size: file.stat.size,
      },
    ]);
    const dataProvider = createMockDataProvider({ files, texts });
    const lexicalEngine = createMockLexicalEngine({
      supportsPersistentFileIndex: jest.fn(() => true),
      restorePersistedFileIndex: jest.fn(async () => true),
      planPersistentRecovery: jest.fn(async () => ({
        status: "up_to_date",
        reason: "up_to_date",
        docsToDelete: [],
        docsToAdd: [],
        docsToUpdate: [],
        docsToMove: [],
      })),
    });
    const fileSnapshotStore = createMockFileSnapshotStore();
    fileSnapshotStore.persisted.set(file.path, {
      text: "委员锟斤拷锟斤拷",
      generation: file.stat.mtime,
    });
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

    const manager = resolveDataManager();
    await manager.initAsync();

    expect(lexicalEngine.buildBodyTokenColdDocument).not.toHaveBeenCalled();
    expect(lexicalEngine.buildBodyHanExactSidecarDocument).not.toHaveBeenCalled();
  });
});
