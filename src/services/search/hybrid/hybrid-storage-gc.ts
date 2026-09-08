import type { DocRegistryRow } from "src/services/database/database";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";
import type {
  ChunkRow,
  ChunkVectorShardRow,
  HybridDirtyShadowRow,
  HybridFileSnapshotRow,
  HybridIndexedFileRef,
} from "./hybrid-store";

export type HybridStorageGcMetrics = {
  gcMs: number;
  chunksRemoved: number;
  vectorsRemoved: number;
  indexedRefsRemoved: number;
  snapshotsRemoved: number;
  shadowsRemoved: number;
  hnswMarkedDirty: boolean;
};

type HybridStorageGcDatabase = {
  listDocRegistryEntries?: () => Promise<DocRegistryRow[]>;
  db: {
    docRegistry: {
      toArray(): Promise<DocRegistryRow[]>;
    };
    hybridChunks: BatchedTable<ChunkRow, number> & {
      bulkDelete(keys: readonly number[]): Promise<unknown>;
    };
    hybridChunkVectors: BatchedTable<ChunkVectorShardRow, string> & {
      bulkDelete(keys: readonly string[]): Promise<unknown>;
    };
    hybridIndexedFileRefs: BatchedTable<HybridIndexedFileRef, number> & {
      bulkDelete(keys: readonly number[]): Promise<unknown>;
    };
    fileSnapshots: BatchedTable<HybridFileSnapshotRow, string> & {
      bulkDelete(keys: readonly string[]): Promise<unknown>;
    };
    hybridDirtyShadows: BatchedTable<HybridDirtyShadowRow, string> & {
      bulkDelete(keys: readonly string[]): Promise<unknown>;
    };
    indexArtifactState: {
      put(row: {
        id: string;
        engine: "hybrid";
        artifact: "hnsw";
        dirtyAt: number;
        reason: string;
      }): Promise<unknown>;
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
  };
};

export type HybridStorageGcOptions = {
  batchSize?: number;
  reason?: string;
  snapshotHistoryLimit?: number;
};

type LiveDocRefState = {
  docRef: number;
};

const DEFAULT_HYBRID_STORAGE_GC_BATCH_SIZE = 512;
const DEFAULT_HYBRID_STORAGE_GC_REASON = "hybrid-storage-gc";
const DEFAULT_HYBRID_SNAPSHOT_HISTORY_LIMIT = 4;

export async function runHybridStorageGc(
  database: HybridStorageGcDatabase,
  options: HybridStorageGcOptions = {},
): Promise<HybridStorageGcMetrics> {
  const gcStartedAt = Date.now();
  const batchSize = options.batchSize ?? DEFAULT_HYBRID_STORAGE_GC_BATCH_SIZE;
  const reason = options.reason ?? DEFAULT_HYBRID_STORAGE_GC_REASON;
  const requestedSnapshotHistoryLimit =
    options.snapshotHistoryLimit ?? DEFAULT_HYBRID_SNAPSHOT_HISTORY_LIMIT;
  const snapshotHistoryLimit = Math.max(
    0,
    Number.isFinite(requestedSnapshotHistoryLimit)
      ? Math.floor(requestedSnapshotHistoryLimit)
      : DEFAULT_HYBRID_SNAPSHOT_HISTORY_LIMIT,
  );
  const metrics: HybridStorageGcMetrics = {
    gcMs: 0,
    chunksRemoved: 0,
    vectorsRemoved: 0,
    indexedRefsRemoved: 0,
    snapshotsRemoved: 0,
    shadowsRemoved: 0,
    hnswMarkedDirty: false,
  };

  const registryRows =
    database.listDocRegistryEntries !== undefined
      ? await database.listDocRegistryEntries()
      : await database.db.docRegistry.toArray();
  const liveDocRefs = new Map<number, LiveDocRefState>();
  for (const row of registryRows) {
    if (row.deleted) {
      continue;
    }
    liveDocRefs.set(row.docRef, { docRef: row.docRef });
  }

  const indexedRefsByDocRef = new Map<number, HybridIndexedFileRef>();
  await scanRowsInBatches<HybridIndexedFileRef, number>(
    (lastDocRef) =>
      loadBatch(database.db.hybridIndexedFileRefs, "docRef", lastDocRef, batchSize),
    (row) => row.docRef,
    async (rows) => {
      const staleDocRefs: number[] = [];
      for (const row of rows) {
        if (!liveDocRefs.has(row.docRef)) {
          staleDocRefs.push(row.docRef);
          continue;
        }
        indexedRefsByDocRef.set(row.docRef, row);
      }
      if (staleDocRefs.length === 0) {
        return;
      }
      await database.db.hybridIndexedFileRefs.bulkDelete(staleDocRefs);
      metrics.indexedRefsRemoved += staleDocRefs.length;
    },
  );

  const requiredSnapshotGenerationsByDocRef = new Map<number, Set<number>>();
  // Keep generations needed by the live lexical view and dense recovery tail;
  // only the unreferenced history is subject to the bounded retention limit.
  const preserveSnapshotGeneration = (docRef: number, generation: number | undefined) => {
    if (generation === undefined) {
      return;
    }
    const generations =
      requiredSnapshotGenerationsByDocRef.get(docRef) ?? new Set<number>();
    generations.add(generation);
    requiredSnapshotGenerationsByDocRef.set(docRef, generations);
  };
  for (const row of registryRows) {
    if (!row.deleted) {
      preserveSnapshotGeneration(row.docRef, row.liveGeneration);
      preserveSnapshotGeneration(row.docRef, row.denseReadyGeneration);
      preserveSnapshotGeneration(row.docRef, row.denseTargetGeneration);
    }
  }
  for (const row of indexedRefsByDocRef.values()) {
    preserveSnapshotGeneration(row.docRef, row.generation);
  }

  const markHnswDirtyBeforeDenseDelete = async () => {
    if (metrics.hnswMarkedDirty) {
      return;
    }
    await database.db.indexArtifactState.put({
      id: buildIndexArtifactStateId("hybrid", "hnsw"),
      engine: "hybrid",
      artifact: "hnsw",
      dirtyAt: Date.now(),
      reason,
    });
    metrics.hnswMarkedDirty = true;
  };

  await scanRowsInBatches<ChunkRow, number>(
    (lastId) => loadBatch(database.db.hybridChunks, ":id", lastId, batchSize),
    (row) => row.id ?? 0,
    async (rows) => {
      const staleIds = rows
        .filter((row) => row.id !== undefined && !shouldKeepChunk(row, indexedRefsByDocRef))
        .map((row) => row.id)
        .filter((id): id is number => id !== undefined);
      if (staleIds.length === 0) {
        return;
      }
      await markHnswDirtyBeforeDenseDelete();
      await database.db.hybridChunks.bulkDelete(staleIds);
      metrics.chunksRemoved += staleIds.length;
    },
  );

  await scanRowsInBatches<ChunkVectorShardRow, string>(
    (lastId) => loadBatch(database.db.hybridChunkVectors, ":id", lastId, batchSize),
    (row) => row.id,
    async (rows) => {
      const staleIds = rows
        .filter((row) => !shouldKeepVector(row, indexedRefsByDocRef))
        .map((row) => row.id);
      if (staleIds.length === 0) {
        return;
      }
      await markHnswDirtyBeforeDenseDelete();
      await database.db.hybridChunkVectors.bulkDelete(staleIds);
      metrics.vectorsRemoved += staleIds.length;
    },
  );

  await scanRowsInBatches<HybridDirtyShadowRow, string>(
    (lastId) => loadBatch(database.db.hybridDirtyShadows, ":id", lastId, batchSize),
    (row) => row.id,
    async (rows) => {
      const staleIds = rows
        .filter((row) => !shouldKeepDirtyShadow(row, liveDocRefs, indexedRefsByDocRef))
        .map((row) => row.id);
      if (staleIds.length === 0) {
        return;
      }
      await database.db.hybridDirtyShadows.bulkDelete(staleIds);
      metrics.shadowsRemoved += staleIds.length;
    },
  );

  const recentSnapshotRowsByDocRef = new Map<number, HybridFileSnapshotRow[]>();
  await scanRowsInBatches<HybridFileSnapshotRow, string>(
    (lastId) => loadBatch(database.db.fileSnapshots, ":id", lastId, batchSize),
    (row) => row.id,
    async (rows) => {
      const staleIds: string[] = [];
      for (const row of rows) {
        if (!liveDocRefs.has(row.docRef)) {
          staleIds.push(row.id);
          continue;
        }
        if (requiredSnapshotGenerationsByDocRef.get(row.docRef)?.has(row.generation)) {
          continue;
        }
        const recentRows = recentSnapshotRowsByDocRef.get(row.docRef) ?? [];
        recentRows.push(row);
        recentRows.sort((left, right) => right.generation - left.generation);
        while (recentRows.length > snapshotHistoryLimit) {
          staleIds.push(recentRows.pop()!.id);
        }
        recentSnapshotRowsByDocRef.set(row.docRef, recentRows);
      }
      if (staleIds.length === 0) {
        return;
      }
      await database.db.fileSnapshots.bulkDelete(staleIds);
      metrics.snapshotsRemoved += staleIds.length;
    },
  );

  metrics.gcMs = Date.now() - gcStartedAt;
  return metrics;
}

function shouldKeepChunk(
  row: ChunkRow,
  indexedRefsByDocRef: ReadonlyMap<number, HybridIndexedFileRef>,
): boolean {
  const ref = indexedRefsByDocRef.get(row.docRef);
  return (
    ref !== undefined &&
    (row.generation === undefined || row.generation === ref.generation) &&
    (ref.state === "ready" || ref.state === "lexical_only")
  );
}

function shouldKeepVector(
  row: ChunkVectorShardRow,
  indexedRefsByDocRef: ReadonlyMap<number, HybridIndexedFileRef>,
): boolean {
  const ref = indexedRefsByDocRef.get(row.docRef);
  return (
    ref !== undefined &&
    (ref.state === "ready" || ref.state === "lexical_only") &&
    row.generation === ref.generation
  );
}

function shouldKeepDirtyShadow(
  row: HybridDirtyShadowRow,
  liveDocRefs: ReadonlyMap<number, LiveDocRefState>,
  indexedRefsByDocRef: ReadonlyMap<number, HybridIndexedFileRef>,
): boolean {
  const live = liveDocRefs.get(row.docRef);
  const ref = indexedRefsByDocRef.get(row.docRef);
  // Dirty shadows are the hybrid equivalent of a durable tail: a stale ready
  // dense generation can still be displayed with shadow text while the live
  // generation is ahead. Do not trim this root merely because it is not the
  // current docRegistry liveGeneration.
  return (
    live !== undefined &&
    ref !== undefined &&
    ref.state === "ready" &&
    row.generation === ref.generation
  );
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
