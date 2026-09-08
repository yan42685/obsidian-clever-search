// @ts-nocheck
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
import {
  buildLexicalBlockEvidenceRowId,
  buildLexicalDocEvidenceRowId,
  FileSnapshotStore,
  type LexicalBlockEvidenceLocator,
  type LexicalDocEvidenceLocator,
} from "src/services/search/shared/file-snapshot-store";

const DEFAULT_TEST_SHARD_OWNER = {
  shardId: "base-0",
  shardGeneration: 1,
} as const;

type SnapshotRow = {
  id?: string;
  docRef?: number;
  filePath: string;
  plainText: string;
  generation?: number;
};

type LexicalIndexedMetadataRow = {
  docRef?: number;
  filePath: string;
  generation?: number;
  aliasesText?: string;
  tagsText?: string;
  headingsText?: string;
};

type LexicalFuzzyRescueRow = {
  id: string;
  indexedMetadataFamilyCount: number;
  fuzzyLookupKeyCount: number;
  bytes: number;
  entries: ReadonlyArray<{
    fuzzyLookupKey: string;
    shardLocalFamilySlots: Uint32Array;
  }>;
};

type LexicalBodyFamilySupportRow = {
  id: string;
  entryCount: number;
  bytes: number;
  familySupportStartByBlockId: Uint8Array | Uint16Array | Uint32Array;
  familySupportShardLocalFamilySlots: Uint8Array | Uint16Array | Uint32Array;
  familySupportMaskByEntry: Uint8Array;
};

type LexicalBodyEvidenceRow = {
  id: string;
  docRef: number;
  generation: number;
  blockOrdinal: number;
  bodyEvidencePayload: Uint8Array;
};

type LexicalHanDocEvidenceRow = {
  id: string;
  docRef: number;
  generation: number;
  identityWitnessTextIds: readonly number[];
  identityWitnessSourceMaskByDocEntry: readonly number[];
  routeWitnessTextIds: readonly number[];
  routeWitnessSourceMaskByDocEntry: readonly number[];
  headingWitnessTextIds: readonly number[];
};

type LexicalHanBodyEvidenceRow = {
  id: string;
  docRef: number;
  generation: number;
  blockOrdinal: number;
  bodyWitnessStringIds: readonly number[];
  bodyWitnessStartOffsets: readonly number[];
};

type LexicalExactTapeRow = {
  id: string;
  entryCount: number;
  bytes: number;
  familyIds: Uint8Array | Uint16Array | Uint32Array;
  positionEncodingByBlockId: Uint8Array;
  positionStartByBlockId: Uint8Array | Uint16Array | Uint32Array;
  positionDeltaU8Tape: Uint8Array;
  positionDeltaU16Tape: Uint16Array;
  positionDeltaU32Tape: Uint32Array;
};

type LexicalHanWitnessRow = {
  id: string;
  metadataWitnessEntryCount: number;
  bodyWitnessEntryCount: number;
  bytes: number;
  identityWitnessStartByDocId: Uint8Array | Uint16Array | Uint32Array;
  identityWitnessTextIds: Uint8Array | Uint16Array | Uint32Array;
  identityWitnessSourceMaskByDocEntry: Uint8Array;
  routeWitnessStartByDocId: Uint8Array | Uint16Array | Uint32Array;
  routeWitnessTextIds: Uint8Array | Uint16Array | Uint32Array;
  routeWitnessSourceMaskByDocEntry: Uint8Array;
  headingWitnessStartByDocId: Uint8Array | Uint16Array | Uint32Array;
  headingWitnessTextIds: Uint8Array | Uint16Array | Uint32Array;
  bodyWitnessOccurrenceStartByBlockId: Uint8Array | Uint16Array | Uint32Array;
  bodyWitnessOccurrenceTextIds: Uint8Array | Uint16Array | Uint32Array;
  bodyWitnessPositionEncodingByBlockId: Uint8Array;
  bodyWitnessPositionStartByBlockId: Uint8Array | Uint16Array | Uint32Array;
  bodyWitnessPositionDeltaU8Tape: Uint8Array;
  bodyWitnessPositionDeltaU16Tape: Uint16Array;
  bodyWitnessPositionDeltaU32Tape: Uint32Array;
};

type HybridIndexedFileRefRow = {
  path?: string;
  docRef?: number;
  generation?: number;
  state?: string;
};

type DocRegistryRow = {
  docRef: number;
  path: string;
  deleted: boolean;
  liveGeneration: number;
  contentFingerprint?: string;
  updatedAt: number;
};

function createFilePathTable(initialRows: SnapshotRow[] = []) {
  const keyForRow = (row: SnapshotRow) => row.id ?? row.filePath;
  const rows = new Map<string, SnapshotRow>(
    initialRows.map((row) => [keyForRow(row), { ...row }]),
  );
  const sortedRows = () =>
    Array.from(rows.entries())
      .map(([key, row]) => ({ ...row, id: row.id ?? key }))
      .sort((left, right) => (left.id ?? left.filePath).localeCompare(right.id ?? right.filePath));
  const sortedDocRefRows = () =>
    Array.from(rows.values())
      .filter((row) => row.docRef !== undefined)
      .map((row) => ({ ...row }))
      .sort((left, right) => (left.docRef ?? 0) - (right.docRef ?? 0));
  const getRow = (key: string) => {
    const direct = rows.get(key);
    if (direct) {
      return direct;
    }
    return Array.from(rows.values()).find((row) => row.filePath === key);
  };

  return {
    rows,
    async get(path: string) {
      const row = getRow(path);
      return row ? { ...row } : undefined;
    },
    async bulkGet(paths: readonly string[]) {
      return paths.map((path) => {
        const row = getRow(path);
        return row ? { ...row } : undefined;
      });
    },
    async bulkPut(nextRows: SnapshotRow[]) {
      for (const row of nextRows) {
        rows.set(keyForRow(row), { ...row });
      }
    },
    async bulkDelete(paths: readonly string[]) {
      for (const path of paths) {
        const directDeleted = rows.delete(path);
        if (!directDeleted) {
          for (const [key, row] of rows.entries()) {
            if (row.filePath === path) {
              rows.delete(key);
            }
          }
        }
      }
    },
    orderBy(field: string) {
      if (field !== ":id" && field !== "docRef") {
        throw new Error(`Unsupported orderBy field: ${field}`);
      }
      return {
        toArray: async () =>
          field === "docRef" ? sortedDocRefRows() : sortedRows(),
        limit(limit: number) {
          return {
            toArray: async () =>
              (field === "docRef" ? sortedDocRefRows() : sortedRows()).slice(0, limit),
          };
        },
      };
    },
    where(field: string) {
      if (field !== ":id" && field !== "docRef") {
        throw new Error(`Unsupported where field: ${field}`);
      }
      return {
        above(lastValue: string | number) {
          return {
            limit(limit: number) {
              return {
                toArray: async () =>
                  field === "docRef"
                    ? sortedDocRefRows()
                        .filter((row) => (row.docRef ?? 0) > Number(lastValue))
                        .slice(0, limit)
                    : sortedRows()
                        .filter((row) => (row.id ?? row.filePath).localeCompare(String(lastValue)) > 0)
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
  const keyForRow = (row: HybridIndexedFileRefRow) =>
    row.docRef ?? row.path ?? "__missing__";
  const rows = new Map<string | number, HybridIndexedFileRefRow>(
    initialRows.map((row) => [keyForRow(row), { ...row }]),
  );
  const sortedRows = () =>
    Array.from(rows.values())
      .map((row) => ({ ...row }))
      .sort((left, right) => (left.docRef ?? 0) - (right.docRef ?? 0));
  const getRow = (key: string | number) => {
    const direct = rows.get(key);
    if (direct) {
      return direct;
    }
    return Array.from(rows.values()).find((row) => row.path === key);
  };

  return {
    rows,
    async get(path: string | number) {
      const row = getRow(path);
      return row ? { ...row } : undefined;
    },
    async bulkGet(keys: readonly (string | number)[]) {
      return keys.map((key) => {
        const row = getRow(key);
        return row ? { ...row } : undefined;
      });
    },
    async bulkPut(nextRows: HybridIndexedFileRefRow[]) {
      for (const row of nextRows) {
        rows.set(keyForRow(row), { ...row });
      }
    },
    async put(row: HybridIndexedFileRefRow) {
      rows.set(keyForRow(row), { ...row });
    },
    async delete(key: string | number) {
      rows.delete(key);
    },
    async bulkDelete(keys: readonly (string | number)[]) {
      for (const key of keys) {
        rows.delete(key);
      }
    },
    async clear() {
      rows.clear();
    },
    orderBy(field: string) {
      if (field !== ":id" && field !== "docRef") {
        throw new Error(`Unsupported orderBy field: ${field}`);
      }
      return {
        toArray: async () => sortedRows(),
        limit(limit: number) {
          return {
            toArray: async () => sortedRows().slice(0, limit),
          };
        },
      };
    },
    where(field: string) {
      if (field !== ":id" && field !== "docRef") {
        throw new Error(`Unsupported where field: ${field}`);
      }
      return {
        above(lastValue: string | number) {
          return {
            limit(limit: number) {
              return {
                toArray: async () =>
                  sortedRows()
                    .filter((row) =>
                      field === "docRef"
                        ? (row.docRef ?? 0) > Number(lastValue)
                        : (row.docRef ?? 0) > Number(lastValue),
                    )
                    .slice(0, limit),
              };
            },
          };
        },
      };
    },
  };
}

function createDocRegistryStore(initialRows: DocRegistryRow[] = []) {
  const rows = new Map<string, DocRegistryRow>(
    initialRows.map((row) => [row.path, { ...row }]),
  );
  let nextDocRef =
    initialRows.reduce((max, row) => Math.max(max, row.docRef), 0) + 1;

  return {
    rows,
    async get(path: string) {
      const row = rows.get(path);
      return row ? { ...row } : undefined;
    },
    async ensureEntry(params: {
      docRef?: number;
      path: string;
      generation?: number;
      deleted?: boolean;
      contentFingerprint?: string;
    }) {
      const existing = rows.get(params.path);
      const nextRow: DocRegistryRow = existing
        ? {
            ...existing,
            deleted: params.deleted ?? existing.deleted,
            liveGeneration: params.generation ?? existing.liveGeneration,
            contentFingerprint:
              params.contentFingerprint ?? existing.contentFingerprint,
            updatedAt: Date.now(),
          }
        : {
            docRef: params.docRef ?? nextDocRef++,
            path: params.path,
            deleted: params.deleted ?? false,
            liveGeneration: params.generation ?? 0,
            contentFingerprint: params.contentFingerprint,
            updatedAt: Date.now(),
          };
      if (params.docRef !== undefined && params.docRef >= nextDocRef) {
        nextDocRef = params.docRef + 1;
      }
      rows.set(nextRow.path, nextRow);
      return { ...nextRow };
    },
    async ensureEntries(
      params: Array<{
        docRef?: number;
        path: string;
        generation?: number;
        deleted?: boolean;
        contentFingerprint?: string;
      }>,
    ) {
      const nextRows = new Map<string, DocRegistryRow>();
      for (const param of params) {
        const row = await this.ensureEntry(param);
        nextRows.set(row.path, row);
      }
      return nextRows;
    },
    async movePath(
      oldPath: string,
      newPath: string,
      options?: {
        generation?: number;
        contentFingerprint?: string;
      },
    ) {
      const existing = rows.get(oldPath);
      if (!existing) {
        return undefined;
      }
      rows.delete(oldPath);
      const nextRow: DocRegistryRow = {
        ...existing,
        path: newPath,
        deleted: false,
        liveGeneration: options?.generation ?? existing.liveGeneration,
        contentFingerprint:
          options?.contentFingerprint ?? existing.contentFingerprint,
        updatedAt: Date.now(),
      };
      rows.set(newPath, nextRow);
      return { ...nextRow };
    },
    async markDeleted(path: string, generation?: number) {
      const existing = rows.get(path);
      if (!existing) {
        return;
      }
      rows.set(path, {
        ...existing,
        deleted: true,
        liveGeneration: generation ?? existing.liveGeneration,
        updatedAt: Date.now(),
      });
    },
    table: {
      async get(docRef: number) {
        const row = Array.from(rows.values()).find((entry) => entry.docRef === docRef);
        return row ? { ...row } : undefined;
      },
      async put(row: DocRegistryRow) {
        rows.set(row.path, { ...row });
      },
    },
  };
}

function createSingletonKeyTable<T extends { id: string }>(initialRows: T[] = []) {
  const rows = new Map<string, T>(initialRows.map((row) => [row.id, { ...row }]));
  return {
    rows,
    async get(id: string) {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    async put(row: T) {
      rows.set(row.id, { ...row });
    },
    async toArray() {
      return Array.from(rows.values()).map((row) => ({ ...row }));
    },
  };
}

function createRowIdTable<T extends { id: string }>(initialRows: T[] = []) {
  const rows = new Map<string, T>(
    initialRows.map((row) => [row.id, { ...row }]),
  );
  return {
    rows,
    async bulkGet(ids: readonly string[]) {
      return ids.map((id) => {
        const row = rows.get(id);
        return row ? { ...row } : undefined;
      });
    },
    async bulkPut(nextRows: T[]) {
      for (const row of nextRows) {
        rows.set(row.id, { ...row });
      }
    },
    async toArray() {
      return Array.from(rows.values()).map((row) => ({ ...row }));
    },
  };
}

function createStoreHarness(options?: {
  files?: TFile[];
  fileSnapshots?: SnapshotRow[];
  lexicalIndexedMetadata?: LexicalIndexedMetadataRow[];
  lexicalFuzzyRescue?: LexicalFuzzyRescueRow[];
  lexicalBodyFamilySupport?: LexicalBodyFamilySupportRow[];
  lexicalBodyEvidence?: LexicalBodyEvidenceRow[];
  lexicalHanDocEvidence?: LexicalHanDocEvidenceRow[];
  lexicalHanBodyEvidence?: LexicalHanBodyEvidenceRow[];
  lexicalExactTapes?: LexicalExactTapeRow[];
  lexicalHanWitness?: LexicalHanWitnessRow[];
  hybridDirtyShadows?: SnapshotRow[];
  hybridIndexedFileRefs?: HybridIndexedFileRefRow[];
  docRegistry?: DocRegistryRow[];
  reads?: Record<string, string>;
}) {
  const files = new Map<string, TFile>(
    (options?.files ?? []).map((file) => [file.path, file]),
  );
  const inferredDocRegistry = new Map<string, DocRegistryRow>(
    (options?.docRegistry ?? []).map((row) => [row.path, { ...row }]),
  );
  let nextInferredDocRef =
    (options?.docRegistry ?? []).reduce((max, row) => Math.max(max, row.docRef), 0) + 1;
  const ensureInferredDocRegistry = (
    path: string | undefined,
    generation?: number,
    docRef?: number,
    contentFingerprint?: string,
  ): DocRegistryRow | undefined => {
    if (!path) {
      return undefined;
    }
    const existing = inferredDocRegistry.get(path);
    if (existing) {
      if (generation !== undefined && generation > existing.liveGeneration) {
        existing.liveGeneration = generation;
      }
      if (contentFingerprint !== undefined) {
        existing.contentFingerprint = contentFingerprint;
      }
      return existing;
    }
    const fileGeneration = files.get(path)?.stat?.mtime;
    const nextRow: DocRegistryRow = {
      docRef: docRef ?? nextInferredDocRef++,
      path,
      deleted: false,
      liveGeneration: generation ?? fileGeneration ?? 0,
      contentFingerprint,
      updatedAt: Date.now(),
    };
    if (nextRow.docRef >= nextInferredDocRef) {
      nextInferredDocRef = nextRow.docRef + 1;
    }
    inferredDocRegistry.set(path, nextRow);
    return nextRow;
  };
  for (const file of files.values()) {
    ensureInferredDocRegistry(file.path, file.stat?.mtime);
  }
  for (const row of options?.fileSnapshots ?? []) {
    ensureInferredDocRegistry(row.filePath, row.generation, row.docRef);
  }
  for (const row of options?.hybridDirtyShadows ?? []) {
    ensureInferredDocRegistry(row.filePath, row.generation, row.docRef);
  }
  for (const row of options?.hybridIndexedFileRefs ?? []) {
    ensureInferredDocRegistry(row.path, row.generation, row.docRef);
  }
  const withGenerationKey = <T extends SnapshotRow>(row: T): T => {
    const registryRow = ensureInferredDocRegistry(row.filePath, row.generation, row.docRef);
    return registryRow == null || row.generation == null
      ? { ...row }
      : {
          ...row,
          docRef: registryRow.docRef,
          id: row.id ?? `${registryRow.docRef}:${row.generation}`,
        };
  };
  const withDocRef = (row: HybridIndexedFileRefRow): HybridIndexedFileRefRow => {
    const registryRow = ensureInferredDocRegistry(row.path, row.generation, row.docRef);
    return registryRow == null
      ? { ...row }
      : {
          ...row,
          docRef: row.docRef ?? registryRow.docRef,
        };
  };
  const fileSnapshots = createFilePathTable(
    options?.fileSnapshots?.map(withGenerationKey),
  );
  const lexicalIndexedMetadata = createFilePathTable(
    options?.lexicalIndexedMetadata,
  );
  const lexicalFuzzyRescue = createSingletonKeyTable(
    options?.lexicalFuzzyRescue,
  );
  const lexicalBodyFamilySupport = createSingletonKeyTable(
    options?.lexicalBodyFamilySupport,
  );
  const lexicalBodyEvidence = createRowIdTable(options?.lexicalBodyEvidence);
  const lexicalHanDocEvidence = createRowIdTable(options?.lexicalHanDocEvidence);
  const lexicalHanBodyEvidence = createRowIdTable(options?.lexicalHanBodyEvidence);
  const lexicalExactTapes = createSingletonKeyTable(options?.lexicalExactTapes);
  const lexicalHanWitness = createSingletonKeyTable(options?.lexicalHanWitness);
  const hybridDirtyShadows = createFilePathTable(
    options?.hybridDirtyShadows?.map(withGenerationKey),
  );
  const hybridIndexedFileRefs = createHybridIndexedRefTable(
    options?.hybridIndexedFileRefs?.map(withDocRef),
  );
  const docRegistry = createDocRegistryStore(Array.from(inferredDocRegistry.values()));
  const reads = options?.reads ?? {};
  const cachedRead = jest.fn(async (file: TFile) => reads[file.path] ?? "");
  const vault = {
    getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
    cachedRead,
  };
  const database = {
    db: {
      fileSnapshots,
      lexicalIndexedMetadata,
      lexicalFuzzyRescue,
      lexicalBodyFamilySupport,
      lexicalBodyEvidence,
      lexicalHanDocEvidence,
      lexicalHanBodyEvidence,
      lexicalExactTapes,
      lexicalHanWitness,
      hybridDirtyShadows,
      hybridIndexedFileRefs,
      docRegistry: docRegistry.table,
    },
    ensureDocRegistryEntry: jest.fn(async (params) => await docRegistry.ensureEntry(params)),
    ensureDocRegistryEntries: jest.fn(async (params) => await docRegistry.ensureEntries(params)),
    getDocRegistryEntry: jest.fn(async (path: string) => await docRegistry.get(path)),
    getDocRegistryEntries: jest.fn(async (paths: readonly string[]) => {
      const entries = new Map<string, DocRegistryRow>();
      for (const path of paths) {
        const row = await docRegistry.get(path);
        if (row) {
          entries.set(path, row);
        }
      }
      return entries;
    }),
    listDocRegistryEntries: jest.fn(async () => Array.from(docRegistry.rows.values()).map((row) => ({ ...row }))),
    moveDocRegistryPath: jest.fn(async (oldPath: string, newPath: string, options?: { generation?: number; contentFingerprint?: string }) => await docRegistry.movePath(oldPath, newPath, options)),
    markDocRegistryDeleted: jest.fn(async (path: string, generation?: number) => await docRegistry.markDeleted(path, generation)),
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
    docRegistry,
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

  test("readCurrentTexts retries when mtime changes while the vault read is in flight", async () => {
    const file = new TFile("docs/rapid-edit.md", "old body", 100);
    const { store, vault } = createStoreHarness({ files: [file] });
    vault.cachedRead
      .mockImplementationOnce(async () => {
        file.stat.mtime = 200;
        file.stat.size = Buffer.byteLength("latest body", "utf8");
        return "old body";
      })
      .mockResolvedValueOnce("latest body");

    const first = await store.readCurrentTexts([file]);
    const second = await store.readCurrentTexts([file]);

    expect(first.get(file.path)).toBe("latest body");
    expect(second.get(file.path)).toBe("latest body");
    expect(vault.cachedRead).toHaveBeenCalledTimes(2);
  });

  test("readFreshCurrentTexts bypasses an aligned persisted snapshot", async () => {
    const file = new TFile("docs/external-rewrite.md", "latest body", 200);
    const { store, vault } = createStoreHarness({
      files: [file],
      fileSnapshots: [
        {
          filePath: file.path,
          plainText: "stale body",
          generation: 200,
        },
      ],
      reads: {
        [file.path]: "latest body",
      },
    });

    const cached = await store.readCurrentTexts([file]);
    const fresh = await store.readFreshCurrentTexts([file]);
    const current = await store.readCurrentTexts([file]);

    expect(cached.get(file.path)).toBe("stale body");
    expect(fresh.get(file.path)).toBe("latest body");
    expect(current.get(file.path)).toBe("latest body");
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

    await expect(database.db.hybridIndexedFileRefs.get(keepPath)).resolves.toEqual(
      expect.objectContaining({
        docRef: expect.any(Number),
        path: keepPath,
        generation: 100,
        state: "ready",
      }),
    );
    await expect(database.db.hybridIndexedFileRefs.get(stalePath)).resolves.toBeUndefined();
  });

  test("retainOnlyFiles scans every generation for stale docRefs across batches", async () => {
    const originalBatchSize = (FileSnapshotStore as any).INDEXED_SNAPSHOT_SCAN_BATCH_SIZE;
    (FileSnapshotStore as any).INDEXED_SNAPSHOT_SCAN_BATCH_SIZE = 2;
    try {
      const keepPath = "docs/keep.md";
      const stalePath = "docs/stale.md";
      const { store, database } = createStoreHarness({
        fileSnapshots: [
          {
            filePath: stalePath,
            plainText: "stale one",
            generation: 1,
          },
          {
            filePath: stalePath,
            plainText: "stale two",
            generation: 2,
          },
          {
            filePath: stalePath,
            plainText: "stale three",
            generation: 3,
          },
          {
            filePath: keepPath,
            plainText: "keep",
            generation: 4,
          },
        ],
        hybridDirtyShadows: [
          {
            filePath: stalePath,
            plainText: "stale shadow one",
            generation: 1,
          },
          {
            filePath: stalePath,
            plainText: "stale shadow two",
            generation: 2,
          },
          {
            filePath: stalePath,
            plainText: "stale shadow three",
            generation: 3,
          },
          {
            filePath: keepPath,
            plainText: "keep shadow",
            generation: 4,
          },
        ],
      });

      await store.retainOnlyFiles(new Set([keepPath]));

      const snapshotRows = Array.from(database.db.fileSnapshots.rows.values());
      const shadowRows = Array.from(database.db.hybridDirtyShadows.rows.values());
      expect(snapshotRows).toEqual([
        expect.objectContaining({
          filePath: keepPath,
          generation: 4,
        }),
      ]);
      expect(shadowRows).toEqual([
        expect.objectContaining({
          filePath: keepPath,
          generation: 4,
        }),
      ]);
    } finally {
      (FileSnapshotStore as any).INDEXED_SNAPSHOT_SCAN_BATCH_SIZE = originalBatchSize;
    }
  });

  test("assigns and reuses a stable docRef across hybrid refs and indexed snapshots", async () => {
    const file = new TFile("docs/stable.md", "stable body", 220);
    const { store, database, docRegistry } = createStoreHarness({
      files: [file],
      reads: {
        [file.path]: "stable body",
      },
    });

    const registryRow = await store.ensureDocRegistryEntry({
      path: file.path,
      generation: 220,
    });

    await store.putHybridIndexedFileRef({
      docRef: registryRow.docRef,
      generation: 220,
      state: "ready",
      chunkCount: 0,
    });
    await store.publishIndexedTexts([
      {
        path: file.path,
        generation: 220,
        text: "stable body",
      },
    ]);

    const indexedRef = await database.db.hybridIndexedFileRefs.get(registryRow.docRef);
    const snapshot = await database.db.fileSnapshots.get(`${registryRow.docRef}:220`);

    expect(indexedRef?.docRef).toBeDefined();
    expect(snapshot?.docRef).toBe(indexedRef?.docRef);
    expect(docRegistry.rows.get(file.path)).toEqual(
      expect.objectContaining({
        docRef: indexedRef?.docRef,
        path: file.path,
        liveGeneration: 220,
        deleted: false,
      }),
    );

    await store.putHybridIndexedFileRef({
      docRef: registryRow.docRef,
      generation: 221,
      state: "ready",
      chunkCount: 0,
    });

    const nextIndexedRef = await database.db.hybridIndexedFileRefs.get(registryRow.docRef);
    expect(nextIndexedRef?.docRef).toBe(indexedRef?.docRef);
  });

  test("does not rewrite an unchanged indexed snapshot generation", async () => {
    const file = new TFile("docs/unchanged.md", "same body", 220);
    const { store, database } = createStoreHarness({
      files: [file],
      reads: { [file.path]: "same body" },
    });
    const registryRow = await store.ensureDocRegistryEntry({
      path: file.path,
      generation: 220,
    });
    const bulkPut = jest.spyOn(database.db.fileSnapshots, "bulkPut");

    await store.publishIndexedTexts([
      { path: file.path, generation: 220, text: "same body" },
    ]);
    await store.publishIndexedTexts([
      { path: file.path, generation: 220, text: "same body" },
    ]);

    expect(bulkPut).toHaveBeenCalledTimes(1);
    await expect(database.db.fileSnapshots.get(`${registryRow.docRef}:220`)).resolves.toEqual(
      expect.objectContaining({ plainText: "same body" }),
    );
  });

test("publishes and reloads lexical fuzzy rescue payloads", async () => {
    const { store, database } = createStoreHarness();

    await store.publishLexicalFuzzyRescue({
      candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: new Map([
        ["obsidan", Uint32Array.from([3, 7])],
        ["runtim", Uint32Array.from([9])],
      ]),
      indexedMetadataFamilyCount: 3,
      fuzzyLookupKeyCount: 2,
      bytes: 42,
    });

    const storedRow = await database.db.lexicalFuzzyRescue.get("active");
    expect(storedRow).toEqual(
      expect.objectContaining({
        id: "active",
        indexedMetadataFamilyCount: 3,
        fuzzyLookupKeyCount: 2,
        bytes: 42,
      }),
    );

  const payload = await store.readLexicalFuzzyRescueForLookupKeys(["obsidan"]);
  expect(payload.indexedMetadataFamilyCount).toBe(3);
  expect(payload.fuzzyLookupKeyCount).toBe(1);
    expect(
    payload.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.get("obsidan"),
    ).toEqual(
      Uint32Array.from([3, 7]),
    );
  expect(
    payload.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.has("runtim"),
  ).toBe(false);
  });

  test("publishes and reloads lexical body evidence for shortlisted blocks", async () => {
    const { store, database } = createStoreHarness();
    const firstLocator: LexicalBlockEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 41,
      generation: 7,
      blockOrdinal: 0,
    };
    const secondLocator: LexicalBlockEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 41,
      generation: 7,
      blockOrdinal: 1,
    };
    const missingLocator: LexicalBlockEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 99,
      generation: 7,
      blockOrdinal: 0,
    };

	    await store.publishLexicalBodyEvidence([
	      {
	        id: buildLexicalBlockEvidenceRowId(firstLocator),
	        shardId: firstLocator.shardId,
	        shardGeneration: firstLocator.shardGeneration,
	        docRef: firstLocator.docRef,
	        generation: firstLocator.generation,
	        blockOrdinal: firstLocator.blockOrdinal,
	        exactShardLocalFamilySlots: [260, 513],
	        exactTokenPositions: [1, 513],
	        supportShardLocalFamilySlots: [260, 513],
	        familySupportMaskByEntry: [1, 3],
	      },
      {
        id: buildLexicalBlockEvidenceRowId(secondLocator),
        shardId: secondLocator.shardId,
        shardGeneration: secondLocator.shardGeneration,
        docRef: secondLocator.docRef,
        generation: secondLocator.generation,
        blockOrdinal: secondLocator.blockOrdinal,
        exactShardLocalFamilySlots: [11],
        exactTokenPositions: [2],
        supportShardLocalFamilySlots: [11],
        familySupportMaskByEntry: [2],
      },
    ]);

    expect(database.db.lexicalBodyEvidence.rows.size).toBe(2);
		const storedBodyRow = database.db.lexicalBodyEvidence.rows.get(
			buildLexicalBlockEvidenceRowId(firstLocator),
		);
		expect(storedBodyRow?.bodyEvidencePayload).toBeInstanceOf(Uint8Array);
		expect(storedBodyRow?.shardId).toBe("base-0");
		expect(storedBodyRow?.shardGeneration).toBe(1);
		expect(
			"exactFamilyIds" in (storedBodyRow as Record<string, unknown>),
		).toBe(false);

    const evidenceByRowId = await store.readLexicalBodyEvidenceForBlocks([
      secondLocator,
      firstLocator,
      missingLocator,
    ]);

	    expect(evidenceByRowId.get(buildLexicalBlockEvidenceRowId(firstLocator))).toEqual({
	      exactShardLocalFamilySlots: [260, 513],
	      exactTokenPositions: [1, 513],
	      supportEntriesByShardLocalFamilySlot: [
	        { shardLocalFamilySlot: 260, supportMask: 1 },
	        { shardLocalFamilySlot: 513, supportMask: 3 },
	      ],
	    });
    expect(evidenceByRowId.get(buildLexicalBlockEvidenceRowId(secondLocator))).toEqual({
      exactShardLocalFamilySlots: [11],
      exactTokenPositions: [2],
      supportEntriesByShardLocalFamilySlot: [
        { shardLocalFamilySlot: 11, supportMask: 2 },
      ],
    });
    expect(evidenceByRowId.has(buildLexicalBlockEvidenceRowId(missingLocator))).toBe(false);
  });

  test("publishes and reloads lexical Han doc evidence", async () => {
    const { store, database } = createStoreHarness();
    const firstLocator: LexicalDocEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 17,
      generation: 5,
    };
    const missingLocator: LexicalDocEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 18,
      generation: 5,
    };

    await store.publishLexicalHanDocEvidence([
      {
        id: buildLexicalDocEvidenceRowId(firstLocator),
        shardId: firstLocator.shardId,
        shardGeneration: firstLocator.shardGeneration,
        docRef: firstLocator.docRef,
        generation: firstLocator.generation,
        identityWitnessMatchKeys: new Int32Array([-1500000003, -1500000005]),
        identityWitnessTexts: ["identity-a", "identity-b"],
        identityWitnessSourceMaskByDocEntry: new Uint8Array([1, 2]),
        routeWitnessMatchKeys: new Int32Array([-1500000007]),
        routeWitnessTexts: ["route-a"],
        routeWitnessSourceMaskByDocEntry: new Uint8Array([4]),
        headingWitnessMatchKeys: new Int32Array([-1500000009]),
        headingWitnessTexts: ["heading-a"],
      },
    ]);

    expect(database.db.lexicalHanDocEvidence.rows.size).toBe(1);

    const evidenceByRowId = await store.readLexicalHanDocEvidenceForDocs([
      firstLocator,
      missingLocator,
    ]);

    expect(evidenceByRowId.get(buildLexicalDocEvidenceRowId(firstLocator))).toEqual({
      identityWitnessMatchKeys: [-1500000003, -1500000005],
      identityWitnessTexts: ["identity-a", "identity-b"],
      identityWitnessSourceMasks: [1, 2],
      routeWitnessMatchKeys: [-1500000007],
      routeWitnessTexts: ["route-a"],
      routeWitnessSourceMasks: [4],
      headingWitnessMatchKeys: [-1500000009],
      headingWitnessTexts: ["heading-a"],
    });
    expect(evidenceByRowId.has(buildLexicalDocEvidenceRowId(missingLocator))).toBe(false);
  });

  test("publishes and reloads lexical Han body evidence for shortlisted blocks", async () => {
    const { store, database } = createStoreHarness();
    const firstLocator: LexicalBlockEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 23,
      generation: 9,
      blockOrdinal: 2,
    };
    const missingLocator: LexicalBlockEvidenceLocator = {
      ...DEFAULT_TEST_SHARD_OWNER,
      docRef: 24,
      generation: 9,
      blockOrdinal: 0,
    };

    await store.publishLexicalHanBodyEvidence([
      {
        id: buildLexicalBlockEvidenceRowId(firstLocator),
        shardId: firstLocator.shardId,
        shardGeneration: firstLocator.shardGeneration,
        docRef: firstLocator.docRef,
        generation: firstLocator.generation,
        blockOrdinal: firstLocator.blockOrdinal,
        bodyWitnessMatchKeys: new Int32Array([-1500000011, -1500000013]),
        bodyWitnessTexts: ["body-a", "body-b"],
        bodyWitnessStartOffsets: new Uint32Array([0, 6]),
      },
    ]);

    expect(database.db.lexicalHanBodyEvidence.rows.size).toBe(1);

    const evidenceByRowId = await store.readLexicalHanBodyEvidenceForBlocks([
      firstLocator,
      missingLocator,
    ]);

    expect(evidenceByRowId.get(buildLexicalBlockEvidenceRowId(firstLocator))).toEqual({
      bodyWitnessMatchKeys: [-1500000011, -1500000013],
      bodyWitnessTexts: ["body-a", "body-b"],
      bodyWitnessStartOffsets: [0, 6],
    });
    expect(evidenceByRowId.has(buildLexicalBlockEvidenceRowId(missingLocator))).toBe(false);
  });

  test("getRuntimeMemoryEstimate reports resident breakdown and cache-slot reuse", async () => {
    const first = new TFile("docs/one.md", "alpha", 100);
    const second = new TFile("docs/two.md", "beta beta", 200);
    const third = new TFile("docs/three.md", "gamma", 300);
    const { store } = createStoreHarness({
      files: [first, second, third],
      reads: {
        [first.path]: "alpha",
        [second.path]: "beta beta",
        [third.path]: "gamma",
      },
    });

    await store.readCurrentTexts([first, second]);
    await store.removeFiles([first.path]);

    const estimateAfterDelete = store.getRuntimeMemoryEstimate();
    expect(estimateAfterDelete.fileCount).toBe(1);
    expect(estimateAfterDelete.cacheSlotCount).toBe(2);
    expect(estimateAfterDelete.freeCacheSlotCount).toBe(1);
    expect(estimateAfterDelete.largestEntries[0]).toEqual(
      expect.objectContaining({
        path: second.path,
        textBytes: "beta beta".length * 2,
      }),
    );

    await store.readCurrentTexts([third]);

    const estimate = store.getRuntimeMemoryEstimate();
    const expectedPathBytes =
      second.path.length * 2 +
      third.path.length * 2;
    const expectedTextBytes =
      "beta beta".length * 2 +
      "gamma".length * 2;
    expect(estimate.pathBytes).toBe(expectedPathBytes);
    expect(estimate.currentTextBytes).toBe(expectedTextBytes);
    expect(estimate.generationBytes).toBe(16);
    expect(estimate.fileCount).toBe(2);
    expect(estimate.cacheSlotCount).toBe(2);
    expect(estimate.freeCacheSlotCount).toBe(0);
    expect(estimate.totalBytes).toBe(expectedPathBytes + expectedTextBytes + 16);
    expect(estimate.largestEntries.map((entry) => entry.path)).toEqual([
      second.path,
      third.path,
    ]);
  });
});
