import { TFile } from "obsidian";

import type { BaseIndexedFileRef } from "src/globals/search-types";
import type { DocRegistryRow } from "src/services/database/database";
import {
  DocMoveOperation,
  DocUpsertOperation,
  type LexicalMutationJournalRow,
  type PendingDocOperationRow,
} from "src/services/obsidian/user-data/doc-operation-buffer";
import type { IndexRecoveryStateRow } from "src/services/obsidian/user-data/index-recovery-state";
import { hashStableText } from "src/services/search/hybrid/incremental-reuse";
import { DataManager } from "src/services/obsidian/user-data/data-manager";

const CURRENT_LEXICAL_QUERY_EVIDENCE_READY_VERSION = 1;

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
    Notice: class Notice {
      constructor(_message?: string, _timeout?: number) {}
      hide() {}
      setMessage(_message: unknown) {}
    },
    htmlToMarkdown(text: string) {
      return text;
    },
  };
});

jest.mock("src/services/obsidian/transformed-api", () => ({
  MyNotice: class MyNotice {
    static messages: string[] = [];

    constructor(message?: string, _timeout?: number) {
      if (message) {
        MyNotice.messages.push(message);
      }
    }
    setText(_text: string) {
      return this;
    }
    hide() {}

    static clear() {
      MyNotice.messages = [];
    }
  },
}));

jest.mock("src/globals/plugin-setting", () => ({
  OuterSetting: class OuterSetting {},
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
}));

jest.mock("src/services/database/database", () => ({
  Database: class Database {},
  LEXICAL_QUERY_EVIDENCE_READY_VERSION: 1,
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
  t: (key: string) => key,
}));

const { MyNotice } = jest.requireMock(
  "src/services/obsidian/transformed-api",
) as {
  MyNotice: { messages: string[]; clear(): void };
};

type Harness = ReturnType<typeof createHarness>;

function createFile(path: string, text: string, mtime: number): TFile {
  return new TFile(path, text, mtime);
}

function createHarness(params: {
  files: readonly TFile[];
  texts: ReadonlyMap<string, string>;
  previousIndexedFileRefs: readonly BaseIndexedFileRef[];
  previousDocRegistryEntries?: readonly DocRegistryRow[];
  previousLexicalSearchSnapshot?: Record<string, unknown> | null;
  indexedSnapshotTexts?: ReadonlyMap<string, string>;
  previousLexicalRecoveryStates?: readonly IndexRecoveryStateRow[];
  previousPendingDocOperations?: readonly PendingDocOperationRow[];
  previousLexicalMutationJournal?: readonly LexicalMutationJournalRow[];
  previousLexicalQueryEvidenceReady?: boolean;
  previousLexicalQueryEvidenceReadyVersion?: number | null;
}) {
  const manager = Object.create(DataManager.prototype) as DataManager & Record<string, any>;
  const filesByPath = new Map(params.files.map((file) => [file.path, file]));
  const indexedSnapshotTexts = params.indexedSnapshotTexts ?? new Map<string, string>();
  let lexicalSearchSnapshot = params.previousLexicalSearchSnapshot ?? null;
  const docRegistryRows = new Map(
    (params.previousDocRegistryEntries ?? []).map((row) => [row.path, { ...row }]),
  );
  const indexRecoveryRows = new Map(
    (params.previousLexicalRecoveryStates ?? []).map((row) => [row.id, { ...row }]),
  );
  const pendingDocOperationRows = new Map(
    (params.previousPendingDocOperations ?? []).map((row) => [row.id, { ...row }]),
  );
  const lexicalMutationJournalRows = new Map(
    (params.previousLexicalMutationJournal ?? []).map((row) => [row.id, { ...row }]),
  );
  let lexicalQueryEvidenceReadyVersion =
    params.previousLexicalQueryEvidenceReadyVersion ??
    (params.previousLexicalQueryEvidenceReady === false
      ? null
      : CURRENT_LEXICAL_QUERY_EVIDENCE_READY_VERSION);
  let nextDocRef =
    Math.max(
      0,
      ...(params.previousDocRegistryEntries ?? []).map((row) => row.docRef),
    ) + 1;

  manager.dataProvider = {
    allFilesToBeIndexed: jest.fn(() => Array.from(filesByPath.values())),
    readPlainText: jest.fn(async (file: TFile | string) => {
      const path = typeof file === "string" ? file : file.path;
      return params.texts.get(path) ?? "";
    }),
    getIndexedDocumentMetadata: jest.fn(() => ({})),
  };
  manager.database = {
    openAndConsumeSchemaUpgradeReport: jest.fn(async () => ({
      schemaUpgradeDetected: false,
      recovery: null,
    })),
    getLexicalSearchSnapshot: jest.fn(async () => lexicalSearchSnapshot),
    setLexicalSearchSnapshot: jest.fn(async (snapshot: Record<string, unknown>) => {
      lexicalSearchSnapshot = { ...snapshot };
    }),
    deleteLexicalSearchSnapshot: jest.fn(async () => {
      lexicalSearchSnapshot = null;
      lexicalQueryEvidenceReadyVersion = null;
    }),
    openAndConsumeSchemaUpgradeFlag: jest.fn(async () => false),
    getLexicalIndexedFileRefs: jest.fn(
      async () => params.previousIndexedFileRefs.map((ref) => ({ ...ref })),
    ),
    getDocRegistryEntry: jest.fn(async (path: string) => {
      const row = docRegistryRows.get(path);
      return row ? { ...row } : undefined;
    }),
    setLexicalIndexedFileRefs: jest.fn(async (refs: readonly BaseIndexedFileRef[]) => {
      manager.database.getLexicalIndexedFileRefs.mockResolvedValue(
        refs.map((ref) => ({ ...ref })),
      );
    }),
    putLexicalIndexedFileRef: jest.fn(async (ref: BaseIndexedFileRef) => {
      const previousRefs = await manager.database.getLexicalIndexedFileRefs();
      const nextRefs = [
        ...previousRefs.filter((item: BaseIndexedFileRef) => item.path !== ref.path),
        { ...ref },
      ];
      manager.database.getLexicalIndexedFileRefs.mockResolvedValue(nextRefs);
    }),
    listDocRegistryEntries: jest.fn(
      async () => [...(params.previousDocRegistryEntries ?? [])].map((row) => ({
        ...row,
      })),
    ),
    ensureDocRegistryEntry: jest.fn(
      async (entry: {
        path: string;
        generation?: number;
        deleted?: boolean;
        contentFingerprint?: string;
      }) => {
        const existing = docRegistryRows.get(entry.path);
        const row: DocRegistryRow = {
          docRef: existing?.docRef ?? nextDocRef++,
          path: entry.path,
          deleted: entry.deleted ?? existing?.deleted ?? false,
          liveGeneration: entry.generation ?? existing?.liveGeneration ?? 0,
          contentFingerprint: entry.contentFingerprint ?? existing?.contentFingerprint,
          updatedAt: Date.now(),
        };
        docRegistryRows.set(entry.path, row);
        manager.database.listDocRegistryEntries.mockResolvedValue(
          Array.from(docRegistryRows.values()).map((item) => ({ ...item })),
        );
        return { ...row };
      },
    ),
    ensureDocRegistryEntries: jest.fn(
      async (
        entries: ReadonlyArray<{
          path: string;
          generation?: number;
          deleted?: boolean;
          contentFingerprint?: string;
        }>,
      ) => {
        const result = new Map<string, DocRegistryRow>();
        for (const entry of entries) {
          result.set(
            entry.path,
            await manager.database.ensureDocRegistryEntry(entry),
          );
        }
        return result;
      },
    ),
    getIndexRecoveryStates: jest.fn(async (engine?: "lexical" | "hybrid") =>
      Array.from(indexRecoveryRows.values())
        .filter((row) => !engine || row.engine === engine)
        .map((row) => ({ ...row })),
    ),
    bulkPutIndexRecoveryStates: jest.fn(
      async (rows: readonly IndexRecoveryStateRow[]) => {
        for (const row of rows) {
          indexRecoveryRows.set(row.id, { ...row });
        }
      },
    ),
    deleteIndexRecoveryState: jest.fn(
      async (engine: "lexical" | "hybrid", path: string) => {
        indexRecoveryRows.delete(`${engine}:${path}`);
      },
    ),
    moveIndexRecoveryState: jest.fn(
      async (engine: "lexical" | "hybrid", oldPath: string, newPath: string) => {
        const existing = indexRecoveryRows.get(`${engine}:${oldPath}`);
        if (!existing) {
          return;
        }
        indexRecoveryRows.delete(`${engine}:${oldPath}`);
        indexRecoveryRows.set(`${engine}:${newPath}`, {
          ...existing,
          id: `${engine}:${newPath}`,
          path: newPath,
        });
      },
    ),
    putPendingDocOperation: jest.fn(async (row: PendingDocOperationRow) => {
      pendingDocOperationRows.set(row.id, { ...row });
    }),
    getPendingDocOperations: jest.fn(async (engine?: "lexical") =>
      Array.from(pendingDocOperationRows.values())
        .filter((row) => !engine || row.engine === engine)
        .map((row) => ({ ...row })),
    ),
    deletePendingDocOperations: jest.fn(async (ids: readonly string[]) => {
      for (const id of ids) {
        pendingDocOperationRows.delete(id);
      }
    }),
    clearPendingDocOperations: jest.fn(async (engine?: "lexical") => {
      if (!engine) {
        pendingDocOperationRows.clear();
        return;
      }
      for (const [id, row] of Array.from(pendingDocOperationRows.entries())) {
        if (row.engine === engine) {
          pendingDocOperationRows.delete(id);
        }
      }
    }),
    putLexicalMutationJournalEntry: jest.fn(async (row: LexicalMutationJournalRow) => {
      lexicalMutationJournalRows.set(row.id, { ...row });
    }),
    getLexicalMutationJournalEntries: jest.fn(async (engine?: "lexical") =>
      Array.from(lexicalMutationJournalRows.values())
        .filter((row) => !engine || row.engine === engine)
        .map((row) => ({ ...row })),
    ),
    deleteLexicalMutationJournalEntries: jest.fn(async (ids: readonly string[]) => {
      for (const id of ids) {
        lexicalMutationJournalRows.delete(id);
      }
    }),
    clearLexicalMutationJournalEntries: jest.fn(async (engine?: "lexical") => {
      if (!engine) {
        lexicalMutationJournalRows.clear();
        return;
      }
      for (const [id, row] of Array.from(lexicalMutationJournalRows.entries())) {
        if (row.engine === engine) {
          lexicalMutationJournalRows.delete(id);
        }
      }
    }),
    hasLexicalQueryEvidenceReadyMarker: jest.fn(
      async (expectedVersion = CURRENT_LEXICAL_QUERY_EVIDENCE_READY_VERSION) =>
        lexicalQueryEvidenceReadyVersion === expectedVersion,
    ),
    getLexicalQueryEvidenceReadyMarkerVersion: jest.fn(
      async () => lexicalQueryEvidenceReadyVersion,
    ),
    setLexicalQueryEvidenceReadyMarker: jest.fn(async (version?: number) => {
      lexicalQueryEvidenceReadyVersion =
        version ?? CURRENT_LEXICAL_QUERY_EVIDENCE_READY_VERSION;
    }),
    clearLexicalQueryEvidenceReadyMarker: jest.fn(async () => {
      lexicalQueryEvidenceReadyVersion = null;
    }),
  };
  manager.fileSnapshotStore = {
    readIndexedTexts: jest.fn(
      async (requests: ReadonlyArray<{ path: string; generation?: number }>) => {
        const result = new Map<string, string>();
        for (const request of requests) {
          if (indexedSnapshotTexts.has(request.path)) {
            result.set(request.path, indexedSnapshotTexts.get(request.path) ?? "");
          }
        }
        return result;
      },
    ),
    publishIndexedMetadata: jest.fn(
      async (
        _files: ReadonlyArray<{
          path: string;
          generation?: number;
          aliasesText?: string;
          tagsText?: string;
          headingsText?: string;
        }>,
      ) => {},
    ),
    publishIndexedTexts: jest.fn(
      async (
        _files: ReadonlyArray<{
          path: string;
          generation?: number;
          text?: string;
        }>,
      ) => {},
    ),
    removeFiles: jest.fn(async (_paths: readonly string[]) => {}),
  };
  manager.deleteDocuments = jest.fn(async (_paths: readonly string[]) => {});
  manager.addDocuments = jest.fn(async (files: readonly TFile[]) => ({
    indexedFiles: [...files],
    failures: [],
  }));
  manager.commitMovedLexicalFileState = jest.fn(async () => true);
  manager.commitIndexedLexicalFiles = jest.fn(async (_files: readonly TFile[]) => {});
  manager.saveLexicalIndexedFileRefs = jest.fn(async (_files: readonly TFile[]) => {});
  manager.markLexicalSnapshotDirty = jest.fn(async (_paths?: readonly string[]) => {});
  manager.clearLexicalIndexFailures = jest.fn((_paths: readonly string[]) => {});
  manager.addLexicalIndexFailures = jest.fn((_failures: readonly unknown[]) => {});
  manager.docOperationsBuffer = {
    add: jest.fn(),
    forceFlush: jest.fn(async () => {}),
    peekReducedBatch: jest.fn(() => ({ dirtyPaths: [], stalePaths: [] })),
    dispose: jest.fn(),
  };
  manager.lexicalStartupPendingOperations = [];
  manager.lexicalIndexedFileRefsLoaded = true;
  manager.lexicalIndexedFileRefsByPath = new Map(
    params.previousIndexedFileRefs.map((ref) => [ref.path, { ...ref }]),
  );
  manager.lexicalIndexFailuresByPath = new Map();
  manager.renderLexicalIndexFailureNotice = jest.fn();
  manager.logLexicalIndexFailures = jest.fn();

  return {
    manager,
    fileSnapshotStore: manager.fileSnapshotStore,
    database: manager.database,
    indexRecoveryRows,
    pendingDocOperationRows,
    lexicalMutationJournalRows,
  };
}

function createBootstrapMetrics() {
  return {
    startedAt: 1,
    searchableAt: null,
    commitStartedAt: null,
    commitCompletedAt: null,
    searchableMs: null,
    commitMs: null,
    commitPending: false,
    commitFailed: false,
    lexical: {
      restoreStartedAt: null,
      restoreCompletedAt: null,
      healStartedAt: null,
      healCompletedAt: null,
      restoreMs: null,
      healMs: null,
    },
    hybrid: {
      restoreStartedAt: null,
      restoreCompletedAt: null,
      healStartedAt: null,
      healCompletedAt: null,
      restoreMs: null,
      healMs: null,
    },
  };
}

describe("DataManager lexical startup reconcile", () => {
  beforeEach(() => {
    MyNotice.clear();
  });

  test("forces full rebuild when a persisted lexical snapshot exists but the fine-grained evidence marker is not ready", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalSearchSnapshot: {
        documentCount: 1,
      },
      previousLexicalQueryEvidenceReady: false,
    });

    harness.manager.shouldForceRefresh = false;
    harness.manager.hasLexicalSnapshotDirtyMarker = jest.fn(async () => false);
    harness.manager.lexicalEngine = {
      supportsSerializedFileIndex: jest.fn(() => true),
      supportsPersistentFileIndex: jest.fn(() => false),
    };

    const plan = await harness.manager.prepareLexicalBootstrapPlan();

    expect(plan).toEqual({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    });
    expect(harness.database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
  });

  test("forces full rebuild when a persisted lexical snapshot exists but the ready marker version is stale", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalSearchSnapshot: {
        documentCount: 1,
      },
      previousLexicalQueryEvidenceReadyVersion: 0,
    });

    harness.manager.shouldForceRefresh = false;
    harness.manager.hasLexicalSnapshotDirtyMarker = jest.fn(async () => false);
    harness.manager.lexicalEngine = {
      supportsSerializedFileIndex: jest.fn(() => true),
      supportsPersistentFileIndex: jest.fn(() => false),
    };

    const plan = await harness.manager.prepareLexicalBootstrapPlan();

    expect(plan).toEqual({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    });
    expect(harness.database.getLexicalSearchSnapshot).not.toHaveBeenCalled();
    await expect(
      harness.database.getLexicalQueryEvidenceReadyMarkerVersion(),
    ).resolves.toBe(0);
  });

  test("invalidates the lexical ready marker when persisted lexical restore fails", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalQueryEvidenceReady: true,
    });

    harness.manager.shouldForceRefresh = false;
    harness.manager.lexicalEngine = {
      supportsSerializedFileIndex: jest.fn(() => false),
      supportsPersistentFileIndex: jest.fn(() => true),
      restorePersistedFileIndex: jest.fn(async () => false),
    };

    const plan = await harness.manager.prepareLexicalBootstrapPlan();

    expect(plan).toEqual({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    });
    expect(
      harness.database.clearLexicalQueryEvidenceReadyMarker,
    ).toHaveBeenCalledTimes(1);
    await expect(
      harness.database.hasLexicalQueryEvidenceReadyMarker(),
    ).resolves.toBe(false);
  });

  test("invalidates the lexical ready marker when persisted lexical recovery requires a full rebuild", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalQueryEvidenceReady: true,
    });

    harness.manager.shouldForceRefresh = false;
    harness.manager.lexicalEngine = {
      supportsSerializedFileIndex: jest.fn(() => false),
      supportsPersistentFileIndex: jest.fn(() => true),
      restorePersistedFileIndex: jest.fn(async () => true),
      planPersistentRecovery: jest.fn(async () => ({
        status: "needs_full_rebuild",
        reason: "stale_evidence",
      })),
      clearIndex: jest.fn(),
    };
    harness.manager.buildCurrentLexicalIndexedFileRefs = jest.fn(() => []);
    harness.manager.reloadLexicalIndexedFileRefs = jest.fn(async () => {});

    const plan = await harness.manager.prepareLexicalBootstrapPlan();

    expect(plan).toEqual({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: {
        status: "needs_full_rebuild",
        reason: "stale_evidence",
      },
    });
    expect(harness.manager.lexicalEngine.clearIndex).toHaveBeenCalledTimes(1);
    expect(
      harness.database.clearLexicalQueryEvidenceReadyMarker,
    ).toHaveBeenCalledTimes(1);
    await expect(
      harness.database.hasLexicalQueryEvidenceReadyMarker(),
    ).resolves.toBe(false);
  });

  test("marks fine-grained lexical evidence ready after writing a serialized lexical snapshot artifact", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalQueryEvidenceReady: false,
    });

    harness.manager.lexicalEngine = {
      supportsPersistentFileIndex: jest.fn(() => false),
      serializeFileIndex: jest.fn(() => ({
        documentCount: 1,
      })),
    };

    await harness.manager.writeLexicalSearchSnapshotArtifact();

    expect(harness.database.setLexicalSearchSnapshot).toHaveBeenCalledWith({
      documentCount: 1,
    });
    expect(
      harness.database.setLexicalQueryEvidenceReadyMarker,
    ).toHaveBeenCalledWith(CURRENT_LEXICAL_QUERY_EVIDENCE_READY_VERSION);
    expect(
      harness.database.clearLexicalMutationJournalEntries,
    ).toHaveBeenCalledWith("lexical");
    await expect(
      harness.database.hasLexicalQueryEvidenceReadyMarker(),
    ).resolves.toBe(true);
  });

  test("clears the lexical ready marker before preparing bootstrap after a schema upgrade", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalQueryEvidenceReady: true,
    });

    harness.database.openAndConsumeSchemaUpgradeReport = jest.fn(async () => ({
      schemaUpgradeDetected: true,
      recovery: null,
    }));
    harness.manager.prepareLexicalBootstrapPlan = jest.fn(async () => ({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    }));
    harness.manager.healLexicalBootstrapPlan = jest.fn(async () => {});
    harness.manager.prepareHybridBootstrapPlan = jest.fn(async () => null);
    Object.defineProperty(harness.manager, "hybridEngine", {
      configurable: true,
      value: {
        isEnabled: jest.fn(() => false),
      },
    });

    await harness.manager.runSearchBootstrapPipeline();

    expect(
      harness.database.clearLexicalQueryEvidenceReadyMarker,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.manager.prepareLexicalBootstrapPlan,
    ).toHaveBeenCalledTimes(1);
    await expect(
      harness.database.hasLexicalQueryEvidenceReadyMarker(),
    ).resolves.toBe(false);
  });

  test("shows a preserving-stats notice after targeted Dexie recovery", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalQueryEvidenceReady: true,
    });

    harness.database.openAndConsumeSchemaUpgradeReport = jest.fn(async () => ({
      schemaUpgradeDetected: true,
      recovery: {
        mode: "targeted-reset",
        dbName: "clever-search/test",
        targetVersion: 28.4,
        initialErrorName: "UpgradeError",
        initialErrorMessage: "Not yet support for changing primary key",
        preservedTokenStats: true,
      },
    }));
    harness.manager.prepareLexicalBootstrapPlan = jest.fn(async () => ({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    }));
    harness.manager.healLexicalBootstrapPlan = jest.fn(async () => {});
    harness.manager.prepareHybridBootstrapPlan = jest.fn(async () => null);
    Object.defineProperty(harness.manager, "hybridEngine", {
      configurable: true,
      value: {
        isEnabled: jest.fn(() => false),
      },
    });

    await harness.manager.runSearchBootstrapPipeline();

    expect(MyNotice.messages).toContain(
      "Local Clever Search indexes were rebuilt after a Dexie schema repair. Settings and token stats were preserved.",
    );
  });

  test("shows a token-reset warning notice after full Dexie recovery fallback", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
      previousLexicalQueryEvidenceReady: true,
    });

    harness.database.openAndConsumeSchemaUpgradeReport = jest.fn(async () => ({
      schemaUpgradeDetected: true,
      recovery: {
        mode: "full-reset",
        dbName: "clever-search/test",
        targetVersion: 28.4,
        initialErrorName: "UpgradeError",
        initialErrorMessage: "Not yet support for changing primary key",
        preservedTokenStats: false,
      },
    }));
    harness.manager.prepareLexicalBootstrapPlan = jest.fn(async () => ({
      needsFullReindex: true,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    }));
    harness.manager.healLexicalBootstrapPlan = jest.fn(async () => {});
    harness.manager.prepareHybridBootstrapPlan = jest.fn(async () => null);
    Object.defineProperty(harness.manager, "hybridEngine", {
      configurable: true,
      value: {
        isEnabled: jest.fn(() => false),
      },
    });

    await harness.manager.runSearchBootstrapPipeline();

    expect(MyNotice.messages).toContain(
      "Local Clever Search database was rebuilt after a Dexie schema repair. Settings were preserved; token stats may have been reset.",
    );
  });

  test("startup V3 memory summary includes cold storage slices", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
    });

    const lines = harness.manager.buildStartupLexicalMemorySummaryLines({
      indexableBytes: 1000,
      persistedLexicalSnapshotBytes: 120,
      runtimeLexicalIndexBytes: 400,
      lexicalIndexBreakdown: {
        __backend: "coverage-lexical-v3",
        metrics: {
          residentBytes: 400,
          auxiliaryBytes: 40,
          exactTapePositionBytes: 30,
          hanRouteMetadataWitnessBytes: 20,
          hanRouteBodyWitnessBytes: 10,
          hanRouteBodyWitnessPositionBytes: 5,
        },
      },
      lexicalRuntimeBreakdown: {
        noticeLines: [],
        summaryLine: null,
        residentGroupRows: [],
        coldOwnedGroupRows: [],
        overlapRows: [],
        residentTopRows: [
          {
            segment: "docArena",
            bytes: 200,
            size: "200 B",
            shareOfLexical: "50.0%",
            shareOfVault: "20.0%",
          },
        ],
        coldOverlapTopRows: [],
      },
      fileSnapshotRuntimeEstimate: {
        pathBytes: 0,
        currentTextBytes: 0,
        generationBytes: 0,
        fileCount: 0,
        slotCount: 0,
        freeSlotCount: 0,
        totalBytes: 0,
        largestEntries: [],
      },
      coverageLexicalV3PersistedStorageBreakdown: {
        totalBytes: 260,
        artifactBytes: 240,
        registryBytes: 20,
        snapshotBytes: 120,
        metadataBytes: 30,
        evidenceBytes: 70,
        fuzzyRescueBytes: 20,
        coldEvidenceBreakdown: {
          tables: {
            lexicalBodyEvidence: 30,
            lexicalHanDocEvidence: 25,
            lexicalHanBodyEvidence: 15,
          },
          bodyEvidence: {
            rowMetadataBytes: 5,
            exactFamilySlotBytes: 8,
            exactPositionBytes: 6,
            supportFamilySlotBytes: 7,
            supportMaskBytes: 4,
          },
          hanDocEvidence: {
            rowMetadataBytes: 4,
            witnessMatchKeyBytes: 9,
            witnessTextBytes: 10,
            sourceMaskBytes: 2,
          },
          hanBodyEvidence: {
            rowMetadataBytes: 3,
            witnessMatchKeyBytes: 5,
            witnessTextBytes: 4,
            startOffsetBytes: 3,
          },
          witnessTextDedup: {
            totalBytes: 14,
            rowLocalUniqueBytes: 10,
            docLocalUniqueBytes: 8,
          },
        },
      },
    } as any);

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Coverage V3 cold storage: artifacts"),
        expect.stringContaining("Coverage V3 cold slices: snapshot"),
        expect.stringContaining("Coverage V3 cold evidence tables:"),
        expect.stringContaining("Coverage V3 cold evidence payloads:"),
        expect.stringContaining("Coverage V3 cold evidence fields:"),
        expect.stringContaining("Coverage V3 witness text dedup potential:"),
        expect.stringContaining("Coverage V3 cold-at-query evidence:"),
      ]),
    );
  });

  test("keeps lexical blocked until lexical bootstrap commit finishes", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
    });

    harness.manager.lexicalBootstrapState = "healing";
    harness.manager.searchBootstrapMetrics = null;
    harness.manager.commitLexicalBootstrapPlan = jest.fn(async () => {
      expect(harness.manager.getLexicalAvailabilityState()).toMatchObject({
        bootstrap: "healing",
        searchable: false,
      });
    });
    Object.defineProperty(harness.manager, "hybridEngine", {
      configurable: true,
      value: {
        isEnabled: jest.fn(() => true),
        persistIndicesForBatch: jest.fn(async () => {
          expect(harness.manager.getLexicalAvailabilityState()).toMatchObject({
            bootstrap: "searchable",
            searchable: true,
          });
        }),
      },
    });
    harness.manager.noticeDevStorageStats = jest.fn(async () => {});

    await harness.manager.commitSearchBootstrapRun();

    expect(harness.manager.commitLexicalBootstrapPlan).toHaveBeenCalledTimes(1);
    expect(
      harness.manager.hybridEngine.persistIndicesForBatch,
    ).toHaveBeenCalledTimes(1);
    expect(harness.manager.getLexicalAvailabilityState()).toMatchObject({
      bootstrap: "searchable",
      searchable: true,
    });
  });

  test("marks lexical failed when bootstrap commit fails before lexical becomes searchable", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
    });

    harness.manager.lexicalBootstrapState = "healing";
    harness.manager.searchBootstrapMetrics = createBootstrapMetrics();
    harness.manager.shouldForceRefresh = true;
    harness.manager.notifyHybridRuntimeStatusChanged = jest.fn();
    harness.manager.commitSearchBootstrapRun = jest.fn(async () => {
      throw new Error("commit failed");
    });

    harness.manager.kickOffSearchBootstrapCommit();
    await harness.manager.searchBootstrapCommitTask;

    expect(harness.manager.getLexicalAvailabilityState()).toMatchObject({
      bootstrap: "failed",
      searchable: false,
      blockingNoticeKey: "searchBootstrap.failed",
    });
    expect(harness.manager.searchBootstrapMetrics.commitFailed).toBe(true);
  });

  test("keeps lexical searchable when hybrid commit work fails after lexical commit", async () => {
    const harness = createHarness({
      files: [],
      texts: new Map(),
      previousIndexedFileRefs: [],
    });

    harness.manager.lexicalBootstrapState = "healing";
    harness.manager.searchBootstrapMetrics = createBootstrapMetrics();
    harness.manager.shouldForceRefresh = true;
    harness.manager.notifyHybridRuntimeStatusChanged = jest.fn();
    harness.manager.commitLexicalBootstrapPlan = jest.fn(async () => {});
    Object.defineProperty(harness.manager, "hybridEngine", {
      configurable: true,
      value: {
        isEnabled: jest.fn(() => true),
        persistIndicesForBatch: jest.fn(async () => {
          throw new Error("hybrid persist failed");
        }),
      },
    });
    harness.manager.noticeDevStorageStats = jest.fn(async () => {});

    harness.manager.kickOffSearchBootstrapCommit();
    await harness.manager.searchBootstrapCommitTask;

    expect(harness.manager.getLexicalAvailabilityState()).toMatchObject({
      bootstrap: "searchable",
      searchable: true,
      blockingNoticeKey: null,
    });
    expect(harness.manager.searchBootstrapMetrics.commitFailed).toBe(true);
  });

  test("reuses lexical move state on startup when doc registry fingerprint matches a unique renamed file", async () => {
    const oldPath = "docs/old.md";
    const newFile = createFile("archive/new.md", "same body", 220);
    const harness = createHarness({
      files: [newFile],
      texts: new Map([[newFile.path, "same body"]]),
      previousIndexedFileRefs: [
        {
          path: oldPath,
          generation: 120,
          size: Buffer.byteLength("same body", "utf8"),
        },
      ],
      previousDocRegistryEntries: [
        {
          docRef: 7,
          path: oldPath,
          deleted: false,
          liveGeneration: 120,
          contentFingerprint: hashStableText("same body"),
          updatedAt: 1,
        },
      ],
    });

    await harness.manager["updateLexicalIndexedFileRefsByMtime"]();

    expect(harness.manager.commitMovedLexicalFileState).toHaveBeenCalledWith(
      oldPath,
      newFile,
      newFile.stat.mtime,
    );
    expect(harness.manager.addDocuments).toHaveBeenCalledWith([]);
    expect(harness.manager.deleteDocuments).toHaveBeenCalledWith([]);
    expect(harness.manager.commitIndexedLexicalFiles).toHaveBeenCalledWith([]);
    expect(harness.manager.saveLexicalIndexedFileRefs).toHaveBeenCalledWith([
      newFile,
    ]);
    expect(harness.fileSnapshotStore.readIndexedTexts).not.toHaveBeenCalled();
  });

  test("falls back to indexed snapshot text when doc registry fingerprint is missing for a startup rename", async () => {
    const oldPath = "docs/missing-fingerprint.md";
    const newFile = createFile("docs/renamed.md", "same body", 260);
    const harness = createHarness({
      files: [newFile],
      texts: new Map([[newFile.path, "same body"]]),
      previousIndexedFileRefs: [
        {
          path: oldPath,
          generation: 180,
          size: Buffer.byteLength("same body", "utf8"),
        },
      ],
      previousDocRegistryEntries: [
        {
          docRef: 11,
          path: oldPath,
          deleted: false,
          liveGeneration: 180,
          updatedAt: 1,
        },
      ],
      indexedSnapshotTexts: new Map([[oldPath, "same body"]]),
    });

    await harness.manager["updateLexicalIndexedFileRefsByMtime"]();

    expect(harness.fileSnapshotStore.readIndexedTexts).toHaveBeenCalledWith([
      {
        path: oldPath,
        generation: 180,
      },
    ]);
    expect(harness.manager.commitMovedLexicalFileState).toHaveBeenCalledWith(
      oldPath,
      newFile,
      newFile.stat.mtime,
    );
    expect(harness.manager.addDocuments).toHaveBeenCalledWith([]);
  });

  test("treats a same-path newer mtime as update instead of misclassifying it as a move", async () => {
    const path = "docs/updated.md";
    const updatedFile = createFile(path, "new body", 320);
    const harness = createHarness({
      files: [updatedFile],
      texts: new Map([[path, "new body"]]),
      previousIndexedFileRefs: [
        {
          path,
          generation: 200,
          size: Buffer.byteLength("old body", "utf8"),
        },
      ],
      previousDocRegistryEntries: [
        {
          docRef: 3,
          path,
          deleted: false,
          liveGeneration: 200,
          contentFingerprint: hashStableText("old body"),
          updatedAt: 1,
        },
      ],
    });

    await harness.manager["updateLexicalIndexedFileRefsByMtime"]();

    expect(harness.manager.commitMovedLexicalFileState).not.toHaveBeenCalled();
    expect(harness.manager.deleteDocuments).toHaveBeenCalledWith([path]);
    expect(harness.manager.addDocuments).toHaveBeenCalledWith([updatedFile]);
    expect(harness.manager.commitIndexedLexicalFiles).toHaveBeenCalledWith([
      updatedFile,
    ]);
    expect(harness.fileSnapshotStore.readIndexedTexts).not.toHaveBeenCalled();
  });

  test("persistent lexical recovery routes upserts through commitIndexedLexicalFiles", async () => {
    const updatedFile = createFile("docs/recover.md", "recover body", 410);
    const harness = createHarness({
      files: [updatedFile],
      texts: new Map([[updatedFile.path, "recover body"]]),
      previousIndexedFileRefs: [],
    });

    await harness.manager["applyLexicalPersistentRecoveryPlan"]({
      status: "needs_heal",
      reason: "vault_drift",
      docsToDelete: [],
      docsToAdd: [],
      docsToUpdate: [updatedFile.path],
      docsToMove: [],
    });

    expect(harness.manager.addDocuments).toHaveBeenCalledWith([updatedFile]);
    expect(harness.manager.commitIndexedLexicalFiles).toHaveBeenCalledWith([
      updatedFile,
    ]);
    expect(harness.manager.saveLexicalIndexedFileRefs).toHaveBeenCalledWith([
      updatedFile,
    ]);
  });

  test("full lexical reindex routes successful files through commitIndexedLexicalFiles before retainOnly", async () => {
    const liveFile = createFile("docs/live.md", "live body", 520);
    const harness = createHarness({
      files: [liveFile],
      texts: new Map([[liveFile.path, "live body"]]),
      previousIndexedFileRefs: [],
    });
    harness.manager.lexicalEngine = {
      beginBatchReindex: jest.fn(),
      finishBatchReindex: jest.fn(),
      abortBatchReindex: jest.fn(),
    };
    harness.manager.addDocuments = jest.fn(async (files: readonly TFile[]) => ({
      indexedFiles: [...files],
      failures: [],
    }));
    harness.manager.saveLexicalIndexedFileRefs = jest.fn(async () => {});
    harness.manager.commitIndexedLexicalFiles = jest.fn(async () => {});
    harness.manager.buildLexicalReindexBatches = jest.fn(() => [[liveFile]]);
    harness.manager.fileSnapshotStore.retainOnlyFiles = jest.fn(async (_paths: ReadonlySet<string>) => {});
    harness.manager.markLexicalSnapshotDirty = jest.fn(async () => {});
    harness.manager.clearLexicalIndexFailures = jest.fn(() => {});
    harness.manager.addLexicalIndexFailures = jest.fn(() => {});

    await harness.manager["reindexLexicalEngineWithCurrFiles"]();

    expect(harness.manager.commitIndexedLexicalFiles).toHaveBeenCalledWith([
      liveFile,
    ]);
    expect(harness.manager.fileSnapshotStore.retainOnlyFiles).toHaveBeenCalledWith(
      new Set([liveFile.path]),
    );
  });

  test("upsertLexicalIndexedFileRef stores docRef from doc registry", async () => {
    const file = createFile("docs/ref-upsert.md", "body", 610);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
    });
    harness.manager.lexicalIndexedFileRefsLoaded = true;
    harness.manager.lexicalIndexedFileRefsByPath = new Map();

    await harness.manager["upsertLexicalIndexedFileRef"](file, file.stat.mtime);

    expect(harness.manager.lexicalIndexedFileRefsByPath.get(file.path)).toEqual(
      expect.objectContaining({
        path: file.path,
        generation: file.stat.mtime,
        docRef: 1,
      }),
    );
    expect(harness.manager.database.putLexicalIndexedFileRef).toHaveBeenCalledWith(
      expect.objectContaining({
        path: file.path,
        generation: file.stat.mtime,
        docRef: 1,
      }),
    );
  });

  test("commitIndexedLexicalFiles notifies lexical engine after publishing indexed texts", async () => {
    const file = createFile("docs/commit-hook.md", "commit hook body", 620);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "commit hook body"]]),
      previousIndexedFileRefs: [],
    });
    harness.manager.commitIndexedLexicalFiles =
      DataManager.prototype["commitIndexedLexicalFiles"];
    harness.manager.primeCurrentFileText = jest.fn(async () => "commit hook body");
    harness.manager.ensureLexicalDocRegistryEntries = jest.fn(async () =>
      new Map([
        [
          file.path,
          {
            docRef: 7,
            path: file.path,
            deleted: false,
            liveGeneration: file.stat.mtime,
            contentFingerprint: hashStableText("commit hook body"),
            updatedAt: 1,
          },
        ],
      ]),
    );
    harness.manager.upsertLexicalIndexedFileRef = jest.fn(async () => {});
    harness.manager.markLexicalSnapshotDirty = jest.fn(async () => {});
    harness.manager.lexicalEngine = {
      notifyIndexedTextsCommitted: jest.fn(),
    };
    harness.manager.dataProvider.getIndexedDocumentMetadata = jest.fn(() => ({
      aliases: "commit alias",
      tags: "commit-tag",
      headings: "Commit heading",
    }));

    await harness.manager["commitIndexedLexicalFiles"]([file]);

    expect(harness.manager.fileSnapshotStore.publishIndexedMetadata).toHaveBeenCalledWith([
      {
        path: file.path,
        generation: file.stat.mtime,
        aliasesText: "commit alias",
        tagsText: "commit-tag",
        headingsText: "Commit heading",
      },
    ]);
    expect(harness.manager.fileSnapshotStore.publishIndexedTexts).toHaveBeenCalledWith([
      {
        path: file.path,
        generation: file.stat.mtime,
        text: "commit hook body",
      },
    ]);
    expect(
      harness.manager.lexicalEngine.notifyIndexedTextsCommitted,
    ).toHaveBeenCalledWith([
      {
        path: file.path,
        generation: file.stat.mtime,
      },
    ]);
  });

  test("persists lexical indexing failures into the shared recovery-state table", async () => {
    const file = createFile("docs/failure.md", "body", 710);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
    });

    await DataManager.prototype["addLexicalIndexFailures"].call(harness.manager, [
      {
        file,
        error: new Error("boom"),
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.database.bulkPutIndexRecoveryStates).toHaveBeenCalledWith([
      expect.objectContaining({
        id: `lexical:${file.path}`,
        engine: "lexical",
        path: file.path,
        targetGeneration: file.stat.mtime,
        mode: "incremental",
        recoveryKind: "failure",
        state: "retryable_ready",
        failureKind: "unknown",
      }),
    ]);
  });

  test("restores persisted lexical failures for unchanged files and prunes stale rows", async () => {
    const staleFile = createFile("docs/stale.md", "new stale body", 900);
    const keepFile = createFile("docs/keep.md", "keep body", 820);
    const harness = createHarness({
      files: [staleFile, keepFile],
      texts: new Map([
        [staleFile.path, "new stale body"],
        [keepFile.path, "keep body"],
      ]),
      previousIndexedFileRefs: [
        {
          path: staleFile.path,
          generation: 900,
          size: Buffer.byteLength("new stale body", "utf8"),
        },
      ],
      previousLexicalRecoveryStates: [
        {
          id: `lexical:${staleFile.path}`,
          engine: "lexical",
          path: staleFile.path,
          targetGeneration: 800,
          mode: "incremental",
          recoveryKind: "failure",
          state: "retryable_ready",
          failureKind: "unknown",
          failureMessage: "stale",
          attemptCount: 1,
          lastFailedAt: 1,
          nextRetryAt: null,
          isBlocking: false,
        },
        {
          id: `lexical:${keepFile.path}`,
          engine: "lexical",
          path: keepFile.path,
          targetGeneration: 820,
          mode: "incremental",
          recoveryKind: "failure",
          state: "retryable_ready",
          failureKind: "unknown",
          failureMessage: "keep",
          attemptCount: 1,
          lastFailedAt: 1,
          nextRetryAt: null,
          isBlocking: false,
        },
      ],
    });

    const restoredCount =
      await DataManager.prototype["restorePersistedLexicalRecoveryState"].call(
        harness.manager,
      );

    expect(restoredCount).toBe(1);
    expect(harness.manager.lexicalIndexFailuresByPath.has(keepFile.path)).toBe(
      true,
    );
    expect(harness.manager.lexicalIndexFailuresByPath.has(staleFile.path)).toBe(
      false,
    );
    expect(harness.database.deleteIndexRecoveryState).toHaveBeenCalledWith(
      "lexical",
      staleFile.path,
    );
  });

  test("restores a moved lexical failure row via docRef when the file was renamed while closed", async () => {
    const oldPath = "docs/old-failure.md";
    const movedFile = createFile("archive/new-failure.md", "body", 845);
    const harness = createHarness({
      files: [movedFile],
      texts: new Map([[movedFile.path, "body"]]),
      previousIndexedFileRefs: [],
      previousDocRegistryEntries: [
        {
          docRef: 42,
          path: movedFile.path,
          deleted: false,
          liveGeneration: movedFile.stat.mtime,
          contentFingerprint: hashStableText("body"),
          updatedAt: 1,
        },
      ],
      previousLexicalRecoveryStates: [
        {
          id: `lexical:${oldPath}`,
          engine: "lexical",
          docRef: 42,
          path: oldPath,
          targetGeneration: movedFile.stat.mtime,
          mode: "incremental",
          recoveryKind: "failure",
          state: "retryable_ready",
          failureKind: "unknown",
          failureMessage: "move me",
          attemptCount: 1,
          lastFailedAt: 1,
          nextRetryAt: null,
          isBlocking: false,
        },
      ],
    });

    const restoredCount =
      await DataManager.prototype["restorePersistedLexicalRecoveryState"].call(
        harness.manager,
      );

    expect(restoredCount).toBe(1);
    expect(
      harness.manager.lexicalIndexFailuresByPath.has(movedFile.path),
    ).toBe(true);
    expect(
      harness.database.moveIndexRecoveryState,
    ).toHaveBeenCalledWith("lexical", oldPath, movedFile.path);
    expect(harness.indexRecoveryRows.has(`lexical:${movedFile.path}`)).toBe(
      true,
    );
  });

  test("prunes both old and moved lexical recovery keys when a renamed persisted row is stale", async () => {
    const oldPath = "docs/stale-old.md";
    const movedFile = createFile("archive/stale-new.md", "body", 980);
    const harness = createHarness({
      files: [movedFile],
      texts: new Map([[movedFile.path, "body"]]),
      previousIndexedFileRefs: [
        {
          path: movedFile.path,
          generation: movedFile.stat.mtime,
          size: Buffer.byteLength("body", "utf8"),
        },
      ],
      previousDocRegistryEntries: [
        {
          docRef: 77,
          path: movedFile.path,
          deleted: false,
          liveGeneration: movedFile.stat.mtime,
          contentFingerprint: hashStableText("body"),
          updatedAt: 1,
        },
      ],
      previousLexicalRecoveryStates: [
        {
          id: `lexical:${oldPath}`,
          engine: "lexical",
          docRef: 77,
          path: oldPath,
          targetGeneration: 970,
          mode: "incremental",
          recoveryKind: "failure",
          state: "retryable_ready",
          failureKind: "unknown",
          failureMessage: "too old",
          attemptCount: 1,
          lastFailedAt: 1,
          nextRetryAt: null,
          isBlocking: false,
        },
      ],
    });

    const restoredCount =
      await DataManager.prototype["restorePersistedLexicalRecoveryState"].call(
        harness.manager,
      );

    expect(restoredCount).toBe(0);
    expect(
      harness.database.deleteIndexRecoveryState,
    ).toHaveBeenCalledWith("lexical", oldPath);
    expect(
      harness.database.deleteIndexRecoveryState,
    ).toHaveBeenCalledWith("lexical", movedFile.path);
    expect(harness.indexRecoveryRows.size).toBe(0);
  });

  test("receiveDocOperation queues a pending lexical upsert and persistence writes the expected rows", async () => {
    const file = createFile("docs/pending-upsert.md", "body", 990);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
    });
    const operation = new DocUpsertOperation(file.path, file.stat.mtime, "op:1");

    DataManager.prototype.receiveDocOperation.call(harness.manager, operation);

    expect(harness.manager.docOperationsBuffer.add).toHaveBeenCalledWith(
      operation,
    );
    await DataManager.prototype["persistPendingLexicalDocOperation"].call(
      harness.manager,
      operation,
    );
    await DataManager.prototype["persistLexicalMutationJournalEntry"].call(
      harness.manager,
      operation,
    );
    expect(harness.database.putPendingDocOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "op:1",
        engine: "lexical",
        docRef: 1,
        type: "upsert",
        path: file.path,
        sourceGeneration: file.stat.mtime,
      }),
    );
    expect(harness.database.putLexicalMutationJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "op:1",
        engine: "lexical",
        docRef: 1,
        kind: "replace",
        path: file.path,
        sourceGeneration: file.stat.mtime,
      }),
    );
  });

  test("attachLexicalDocRefs enriches lexical IndexedDocument values before engine ingest", async () => {
    const file = createFile("docs/attach-docref.md", "body", 992);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
    });

    const documents =
      await DataManager.prototype["attachLexicalDocRefs"].call(harness.manager, [
        {
          path: file.path,
          generation: file.stat.mtime,
          size: file.stat.size,
          basename: file.basename,
          folder: "docs",
          content: "body",
        },
      ]);

    expect(documents).toEqual([
      expect.objectContaining({
        path: file.path,
        docRef: 1,
        generation: file.stat.mtime,
      }),
    ]);
  });

  test("receiveDocOperation queues lexical move persistence with the old-path docRef", async () => {
    const file = createFile("docs/new-home.md", "body", 995);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousDocRegistryEntries: [
        {
          docRef: 9,
          path: "docs/old-home.md",
          deleted: false,
          liveGeneration: 880,
          contentFingerprint: hashStableText("body"),
          updatedAt: 1,
        },
      ],
    });
    const operation = new DocMoveOperation(
      "docs/old-home.md",
      file.path,
      file.stat.mtime,
      "op:move:1",
    );

    DataManager.prototype.receiveDocOperation.call(harness.manager, operation);

    expect(harness.manager.docOperationsBuffer.add).toHaveBeenCalledWith(operation);
    await DataManager.prototype["persistPendingLexicalDocOperation"].call(
      harness.manager,
      operation,
    );
    await DataManager.prototype["persistLexicalMutationJournalEntry"].call(
      harness.manager,
      operation,
    );

    expect(harness.database.putPendingDocOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "op:move:1",
        engine: "lexical",
        docRef: 9,
        type: "move",
        oldPath: "docs/old-home.md",
        path: file.path,
      }),
    );
    expect(harness.database.putLexicalMutationJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "op:move:1",
        engine: "lexical",
        docRef: 9,
        kind: "move",
        oldPath: "docs/old-home.md",
        path: file.path,
      }),
    );
  });

  test("restorePersistedLexicalMutationJournalEntries remaps journal rows through docRef", async () => {
    const file = createFile("docs/journal-restore.md", "body", 1011);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousPendingDocOperations: [
        {
          id: "pending:shadow:1",
          engine: "lexical",
          type: "delete",
          path: "docs/should-not-win.md",
          createdAt: 1,
        },
      ],
      previousLexicalMutationJournal: [
        {
          id: "journal:1",
          engine: "lexical",
          kind: "replace",
          path: file.path,
          sourceGeneration: file.stat.mtime,
          createdAt: 1,
        },
      ],
    });

    const restored =
      await DataManager.prototype["restorePersistedLexicalMutationJournalEntries"].call(
        harness.manager,
      );

    expect(restored.hadRows).toBe(true);
    expect(restored.operations).toHaveLength(1);
    expect(restored.operations[0]).toEqual(
      expect.objectContaining({
        path: file.path,
        sourceGeneration: file.stat.mtime,
      }),
    );
  });
  test("healLexicalBootstrapPlan restores persisted pending lexical operations when no other heal work is needed", async () => {
    const file = createFile("docs/pending-move.md", "body", 1010);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousPendingDocOperations: [
        {
          id: "pending:1",
          engine: "lexical",
          type: "move",
          path: file.path,
          oldPath: "docs/old-pending-move.md",
          sourceGeneration: file.stat.mtime,
          createdAt: 1,
        },
      ],
    });

    await DataManager.prototype["healLexicalBootstrapPlan"].call(harness.manager, {
      needsFullReindex: false,
      needsRefHeal: false,
      persistentRecoveryPlan: null,
    });

    expect(harness.manager.lexicalStartupPendingOperations).toHaveLength(1);
    expect(harness.manager.lexicalStartupPendingOperations[0]).toBeInstanceOf(
      DocMoveOperation,
    );
  });

  test("restorePersistedPendingLexicalDocOperations remaps path-based pending upserts through docRef", async () => {
    const file = createFile("docs/remapped.md", "body", 1015);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousDocRegistryEntries: [
        {
          docRef: 17,
          path: file.path,
          deleted: false,
          liveGeneration: file.stat.mtime,
          contentFingerprint: hashStableText("body"),
          updatedAt: 1,
        },
      ],
      previousPendingDocOperations: [
        {
          id: "pending:remap:1",
          engine: "lexical",
          docRef: 17,
          type: "upsert",
          path: "docs/old-remapped.md",
          sourceGeneration: file.stat.mtime,
          createdAt: 1,
        },
      ],
    });

    const operations =
      await DataManager.prototype["restorePersistedPendingLexicalDocOperations"].call(
        harness.manager,
      );

    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual(
      expect.objectContaining({
        path: file.path,
        sourceGeneration: file.stat.mtime,
      }),
    );
  });

  test("restorePersistedPendingLexicalDocOperations remaps pending moves to the latest docRef path", async () => {
    const file = createFile("docs/remapped-move.md", "body", 1016);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousDocRegistryEntries: [
        {
          docRef: 18,
          path: file.path,
          deleted: false,
          liveGeneration: file.stat.mtime,
          contentFingerprint: hashStableText("body"),
          updatedAt: 1,
        },
      ],
      previousPendingDocOperations: [
        {
          id: "pending:remap:move:1",
          engine: "lexical",
          docRef: 18,
          type: "move",
          oldPath: "docs/very-old.md",
          path: "docs/old-remapped-move.md",
          sourceGeneration: file.stat.mtime,
          createdAt: 1,
        },
      ],
    });

    const operations =
      await DataManager.prototype["restorePersistedPendingLexicalDocOperations"].call(
        harness.manager,
      );

    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual(
      expect.objectContaining({
        oldPath: "docs/very-old.md",
        path: file.path,
        sourceGeneration: file.stat.mtime,
      }),
    );
  });

  test("restorePersistedPendingLexicalDocOperations prunes stale pending deletes when the file already exists again", async () => {
    const file = createFile("docs/recreated.md", "body", 1017);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousPendingDocOperations: [
        {
          id: "pending:delete:stale:1",
          engine: "lexical",
          type: "delete",
          path: file.path,
          createdAt: 1,
        },
      ],
    });

    const operations =
      await DataManager.prototype["restorePersistedPendingLexicalDocOperations"].call(
        harness.manager,
      );

    expect(operations).toHaveLength(0);
    expect(harness.database.deletePendingDocOperations).toHaveBeenCalledWith([
      "pending:delete:stale:1",
    ]);
  });

  test("healLexicalBootstrapPlan clears persisted pending lexical operations when startup already needs heal work", async () => {
    const file = createFile("docs/pending-clear.md", "body", 1020);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
      previousPendingDocOperations: [
        {
          id: "pending:2",
          engine: "lexical",
          type: "upsert",
          path: file.path,
          sourceGeneration: file.stat.mtime,
          createdAt: 1,
        },
      ],
    });
    harness.manager.updateLexicalIndexedFileRefsByMtime = jest.fn(async () => {});

    await DataManager.prototype["healLexicalBootstrapPlan"].call(harness.manager, {
      needsFullReindex: false,
      needsRefHeal: true,
      persistentRecoveryPlan: null,
    });

    expect(harness.database.clearPendingDocOperations).toHaveBeenCalledWith(
      "lexical",
    );
    expect(harness.manager.lexicalStartupPendingOperations).toHaveLength(0);
  });

  test("commitLexicalBootstrapPlan triggers the pending lexical startup retry in background", async () => {
    const file = createFile("docs/pending-retry.md", "body", 930);
    const harness = createHarness({
      files: [file],
      texts: new Map([[file.path, "body"]]),
      previousIndexedFileRefs: [],
    });
    harness.manager.persistLexicalSearchSnapshotIfAvailable = jest.fn(
      async () => {},
    );
    harness.manager.retryLexicalIndexFailures = jest.fn(async () => {});
    harness.manager.lexicalStartupFailureRetryPending = true;

    await DataManager.prototype["commitLexicalBootstrapPlan"].call(
      harness.manager,
    );

    expect(
      harness.manager.persistLexicalSearchSnapshotIfAvailable,
    ).toHaveBeenCalled();
    expect(harness.manager.retryLexicalIndexFailures).toHaveBeenCalled();
    expect(harness.manager.lexicalStartupFailureRetryPending).toBe(false);
  });

});
