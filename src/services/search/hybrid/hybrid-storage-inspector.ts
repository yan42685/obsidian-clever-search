import type { DocRegistryRow } from "src/services/database/database";
import {
  analyzeHybridStoredFileConsistency,
  type HybridStoredVectorInfo,
} from "./hybrid-consistency";
import type {
  ChunkRow,
  ChunkVectorShardRow,
  HybridDirtyShadowRow,
  HybridFileSnapshotRow,
  HybridIndexedFileRef,
} from "./hybrid-store";
import type { VectorPrecision } from "./hybrid-types";

export type HybridStoredPathSummary = {
  chunkCount: number;
  currentSnapshotGeneration?: number;
  shadowSnapshotGeneration?: number;
  vectorInfo?: HybridStoredVectorInfo;
  indexedFileRef?: HybridIndexedFileRef;
};

export type HybridStoredPathInspection = {
  summary: HybridStoredPathSummary;
  consistency: ReturnType<typeof analyzeHybridStoredFileConsistency>;
};

type HybridStorageInspectorDatabase = {
  listDocRegistryEntries(): Promise<DocRegistryRow[]>;
  getDocRegistryEntries(paths: readonly string[]): Promise<Map<string, DocRegistryRow>>;
  db: {
    hybridChunks: BatchedTable<ChunkRow, number>;
    hybridChunkVectors: BatchedTable<ChunkVectorShardRow, string> & {
      bulkGet(keys: readonly string[]): Promise<Array<ChunkVectorShardRow | undefined>>;
    };
    hybridIndexedFileRefs: BatchedTable<HybridIndexedFileRef, number> & {
      bulkGet(keys: readonly number[]): Promise<Array<HybridIndexedFileRef | undefined>>;
    };
    fileSnapshots: BatchedTable<HybridFileSnapshotRow, string> & {
      bulkGet(keys: readonly string[]): Promise<Array<HybridFileSnapshotRow | undefined>>;
    };
    hybridDirtyShadows: BatchedTable<HybridDirtyShadowRow, string> & {
      bulkGet(keys: readonly string[]): Promise<Array<HybridDirtyShadowRow | undefined>>;
    };
  };
};

type BatchedTable<Row, Key extends string | number> = {
  orderBy(index: string): {
    limit(batchSize: number): {
      toArray(): Promise<Row[]>;
    };
  };
  where(index: string): {
    above(lastKey: Key): {
      limit(batchSize: number): {
        toArray(): Promise<Row[]>;
      };
    };
    anyOf?(keys: readonly Key[]): {
      toArray(): Promise<Row[]>;
    };
  };
};

export async function collectHybridStoredPathSummariesForPaths(params: {
  database: HybridStorageInspectorDatabase;
  paths: readonly string[];
  batchSize: number;
}): Promise<Map<string, HybridStoredPathSummary>> {
  const uniquePaths = Array.from(new Set(params.paths));
  const summaries = new Map<string, HybridStoredPathSummary>();
  if (uniquePaths.length === 0) {
    return summaries;
  }

  for (const path of uniquePaths) {
    summaries.set(path, { chunkCount: 0 });
  }

  for (let start = 0; start < uniquePaths.length; start += params.batchSize) {
    const batchPaths = uniquePaths.slice(start, start + params.batchSize);
    const registryRows = await params.database.getDocRegistryEntries(batchPaths);
    const docRefs = batchPaths.map((path) => registryRows.get(path)?.docRef ?? -1);
    const indexedFileRefs = await params.database.db.hybridIndexedFileRefs.bulkGet(
      docRefs,
    );
    const inspectedGenerationByDocRef = new Map<number, number | undefined>();
    const generationKeys = batchPaths.map((path, index) => {
      const row = registryRows.get(path);
      const docRef = docRefs[index];
      const generation = indexedFileRefs[index]?.generation ?? row?.liveGeneration;
      if (docRef !== -1) {
        inspectedGenerationByDocRef.set(docRef, generation);
      }
      return row == null || generation == null
        ? "__missing__"
        : `${docRef}:${generation}`;
    });
    const chunkQuery = params.database.db.hybridChunks.where("docRef");
    const [chunkRows, vectorRows, snapshotRows, shadowRows] =
      await Promise.all([
        chunkQuery.anyOf === undefined
          ? Promise.resolve([])
          : chunkQuery.anyOf(docRefs).toArray(),
        params.database.db.hybridChunkVectors.bulkGet(generationKeys),
        params.database.db.fileSnapshots.bulkGet(generationKeys),
        params.database.db.hybridDirtyShadows.bulkGet(generationKeys),
      ]);

    const pathByDocRef = new Map<number, string>();
    for (let index = 0; index < batchPaths.length; index++) {
      pathByDocRef.set(docRefs[index], batchPaths[index]);
    }

    for (const row of chunkRows) {
      const path = pathByDocRef.get(row.docRef);
      if (path == null) {
        continue;
      }
      const inspectedGeneration = inspectedGenerationByDocRef.get(row.docRef);
      if (
        inspectedGeneration !== undefined &&
        row.generation !== undefined &&
        row.generation !== inspectedGeneration
      ) {
        continue;
      }
      const summary = getOrCreateHybridStoredPathSummary(summaries, path);
      summary.chunkCount += 1;
    }

    for (let index = 0; index < batchPaths.length; index++) {
      const path = batchPaths[index];
      const summary = getOrCreateHybridStoredPathSummary(summaries, path);
      const vectorRow = vectorRows[index];
      if (vectorRow) {
        summary.vectorInfo = toHybridStoredVectorInfo(vectorRow);
      }
      const indexedFileRef = indexedFileRefs[index];
      if (indexedFileRef) {
        summary.indexedFileRef = indexedFileRef;
      }
      const snapshotRow = snapshotRows[index];
      if (snapshotRow) {
        summary.currentSnapshotGeneration = snapshotRow.generation;
      }
      const shadowRow = shadowRows[index];
      if (shadowRow) {
        summary.shadowSnapshotGeneration = shadowRow.generation;
      }
    }
  }

  return summaries;
}

export async function inspectHybridStoredPaths(params: {
  database: HybridStorageInspectorDatabase;
  paths: readonly string[];
  existingPaths: ReadonlySet<string>;
  currentPrecision: VectorPrecision;
  batchSize: number;
}): Promise<Map<string, HybridStoredPathInspection>> {
  const summaries = await collectHybridStoredPathSummariesForPaths({
    database: params.database,
    paths: params.paths,
    batchSize: params.batchSize,
  });
  const inspections = new Map<string, HybridStoredPathInspection>();
  for (const path of Array.from(new Set(params.paths))) {
    const summary = summaries.get(path) ?? { chunkCount: 0 };
    inspections.set(
      path,
      buildHybridStoredPathInspection({
        summary,
        existsInVault: params.existingPaths.has(path),
        currentPrecision: params.currentPrecision,
      }),
    );
  }
  return inspections;
}

export async function collectHybridStoredPathSummaries(params: {
  database: HybridStorageInspectorDatabase;
  batchSize: number;
}): Promise<Map<string, HybridStoredPathSummary>> {
  const summaries = new Map<string, HybridStoredPathSummary>();
  const registryRows = await params.database.listDocRegistryEntries();
  const pathByDocRef = new Map(registryRows.map((row) => [row.docRef, row.path] as const));
  const rowPath = (row: { docRef: number }) => pathByDocRef.get(row.docRef);

  await scanRowsInBatches<ChunkRow, number>(
    (lastId) => loadBatch(params.database.db.hybridChunks, ":id", lastId, params.batchSize),
    (row) => row.id ?? 0,
    async (rows) => {
      for (const row of rows) {
        const path = rowPath(row);
        if (path == null) {
          continue;
        }
        const summary = getOrCreateHybridStoredPathSummary(summaries, path);
        summary.chunkCount += 1;
      }
    },
  );

  await scanRowsInBatches<ChunkVectorShardRow, string>(
    (lastId) => loadBatch(params.database.db.hybridChunkVectors, ":id", lastId, params.batchSize),
    (row) => row.id,
    async (rows) => {
      for (const row of rows) {
        const path = rowPath(row);
        if (path == null) {
          continue;
        }
        const summary = getOrCreateHybridStoredPathSummary(summaries, path);
        summary.vectorInfo = toHybridStoredVectorInfo(row);
      }
    },
  );

  await scanRowsInBatches<HybridIndexedFileRef, number>(
    (lastDocRef) =>
      loadBatch(
        params.database.db.hybridIndexedFileRefs,
        "docRef",
        lastDocRef,
        params.batchSize,
      ),
    (row) => row.docRef,
    async (rows) => {
      for (const row of rows) {
        const path = rowPath(row);
        if (path == null) {
          continue;
        }
        const summary = getOrCreateHybridStoredPathSummary(summaries, path);
        summary.indexedFileRef = row;
      }
    },
  );

  const registryRowByPath = new Map(registryRows.map((row) => [row.path, row] as const));
  const summaryPaths = Array.from(summaries.keys());
  for (let start = 0; start < summaryPaths.length; start += params.batchSize) {
    const batchPaths = summaryPaths.slice(start, start + params.batchSize);
    const snapshotRows = await params.database.db.fileSnapshots.bulkGet(
      batchPaths.map((path) => {
        const registryRow = registryRowByPath.get(path);
        return registryRow == null
          ? "__missing__"
          : `${registryRow.docRef}:${registryRow.liveGeneration}`;
      }),
    );
    for (const row of snapshotRows) {
      if (!row) {
        continue;
      }
      const path = rowPath(row);
      const summary = path == null ? undefined : summaries.get(path);
      if (summary) {
        summary.currentSnapshotGeneration = row.generation;
      }
    }
  }

  await scanRowsInBatches<HybridDirtyShadowRow, string>(
    (lastId) => loadBatch(params.database.db.hybridDirtyShadows, ":id", lastId, params.batchSize),
    (row) => row.id,
    async (rows) => {
      for (const row of rows) {
        const path = rowPath(row);
        if (path == null) {
          continue;
        }
        const summary = getOrCreateHybridStoredPathSummary(summaries, path);
        summary.shadowSnapshotGeneration = row.generation;
      }
    },
  );

  return summaries;
}

export function buildHybridStoredPathInspection(params: {
  summary: HybridStoredPathSummary;
  existsInVault: boolean;
  currentPrecision: VectorPrecision;
}): HybridStoredPathInspection {
  return {
    summary: params.summary,
    consistency: analyzeHybridStoredFileConsistency({
      existsInVault: params.existsInVault,
      hasChunks: params.summary.chunkCount > 0,
      chunkCount: params.summary.chunkCount,
      snapshot:
        params.summary.currentSnapshotGeneration !== undefined
          ? { generation: params.summary.currentSnapshotGeneration }
          : undefined,
      shadowSnapshot:
        params.summary.shadowSnapshotGeneration !== undefined
          ? { generation: params.summary.shadowSnapshotGeneration }
          : undefined,
      vectorInfo: params.summary.vectorInfo,
      indexedFileRef: params.summary.indexedFileRef,
      currentPrecision: params.currentPrecision,
    }),
  };
}

function getOrCreateHybridStoredPathSummary(
  summaries: Map<string, HybridStoredPathSummary>,
  path: string,
): HybridStoredPathSummary {
  const existing = summaries.get(path);
  if (existing) {
    return existing;
  }
  const created: HybridStoredPathSummary = { chunkCount: 0 };
  summaries.set(path, created);
  return created;
}

function toHybridStoredVectorInfo(row: ChunkVectorShardRow): HybridStoredVectorInfo {
  return {
    precision: (row.precision === "float16" ? "float16" : "int8") as VectorPrecision,
    chunkCount: row.chunkCount,
    generation: row.generation,
  };
}

async function loadBatch<Row, Key extends string | number>(
  table: BatchedTable<Row, Key>,
  index: string,
  lastKey: Key | null,
  batchSize: number,
): Promise<Row[]> {
  if (lastKey === null) {
    return await table.orderBy(index).limit(batchSize).toArray();
  }
  return await table.where(index).above(lastKey).limit(batchSize).toArray();
}

async function scanRowsInBatches<Row, Key extends string | number>(
  loadBatch: (lastKey: Key | null) => Promise<Row[]>,
  getLastKey: (row: Row) => Key,
  handleBatch: (rows: Row[]) => Promise<void>,
): Promise<void> {
  let lastKey: Key | null = null;
  while (true) {
    const rows = await loadBatch(lastKey);
    if (rows.length === 0) {
      return;
    }
    await handleBatch(rows);
    lastKey = getLastKey(rows[rows.length - 1]);
  }
}
