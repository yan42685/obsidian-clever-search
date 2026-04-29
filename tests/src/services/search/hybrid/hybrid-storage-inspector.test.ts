import "fake-indexeddb/auto";

import Dexie from "dexie";
import { inspectHybridStoredPaths } from "src/services/search/hybrid/hybrid-storage-inspector";

describe("hybrid storage inspector", () => {
  let db: Dexie & {
    docRegistry: Dexie.Table<any, number>;
    hybridChunks: Dexie.Table<any, number>;
    hybridChunkVectors: Dexie.Table<any, string>;
    hybridIndexedFileRefs: Dexie.Table<any, number>;
    fileSnapshots: Dexie.Table<any, string>;
    hybridDirtyShadows: Dexie.Table<any, string>;
  };

  beforeEach(async () => {
    db = new Dexie(`hybrid-storage-inspector-${Date.now()}-${Math.random()}`) as typeof db;
    db.version(1).stores({
      docRegistry:
        "docRef, path, deleted, liveGeneration, denseReadyGeneration, denseTargetGeneration, denseState, denseServeUntil, updatedAt",
      hybridChunks:
        "++id, docRef, generation, [docRef+generation], [docRef+generation+chunkIndex]",
      hybridChunkVectors: "id, docRef, generation, [docRef+generation]",
      hybridIndexedFileRefs: "docRef, generation, state",
      fileSnapshots: "id, docRef, generation, [docRef+generation]",
      hybridDirtyShadows: "id, docRef, generation, [docRef+generation]",
    });
    await db.open();
  });

  afterEach(async () => {
    const name = db.name;
    db.close();
    await Dexie.delete(name);
  });

  test("inspects stale ready dense tail by indexed ref generation instead of live generation", async () => {
    const path = "docs/stale-ready-tail.md";
    await db.docRegistry.put({
      docRef: 7,
      path,
      deleted: false,
      liveGeneration: 11,
      denseReadyGeneration: 10,
      denseTargetGeneration: 11,
      denseState: "pending",
      denseServeUntil: Date.now() + 60_000,
      updatedAt: 11,
    });
    await db.hybridIndexedFileRefs.put({
      docRef: 7,
      generation: 10,
      state: "ready",
      chunkCount: 1,
      vectorPrecision: "int8",
    });
    await db.hybridChunks.bulkPut([
      chunk(1, 7, 10),
      chunk(2, 7, 11),
    ]);
    await db.hybridChunkVectors.put(vector("7:10", 7, 10));
    await db.fileSnapshots.put(snapshot("7:11", 7, 11));
    await db.hybridDirtyShadows.put(snapshot("7:10", 7, 10));

    const inspections = await inspectHybridStoredPaths({
      database: {
        getDocRegistryEntries: async (paths: readonly string[]) => {
          const rows = await db.docRegistry.where("path").anyOf([...paths]).toArray();
          return new Map(rows.map((row) => [row.path, row]));
        },
        listDocRegistryEntries: async () => await db.docRegistry.toArray(),
        db,
      },
      paths: [path],
      existingPaths: new Set([path]),
      currentPrecision: "int8",
      batchSize: 16,
    });

    expect(inspections.get(path)?.summary).toMatchObject({
      chunkCount: 1,
      shadowSnapshotGeneration: 10,
      vectorInfo: {
        generation: 10,
        chunkCount: 1,
        precision: "int8",
      },
      indexedFileRef: {
        generation: 10,
        state: "ready",
      },
    });
    expect(inspections.get(path)?.consistency.repairReasons).toEqual([]);
  });
});

function chunk(id: number, docRef: number, generation: number) {
  return {
    id,
    docRef,
    generation,
    chunkIndex: 0,
    startOffset: 0,
    endOffset: 4,
    startLine: 0,
    startCol: 0,
    endLine: 0,
    embedKey: `${docRef}:${generation}`,
  };
}

function vector(id: string, docRef: number, generation: number) {
  return {
    id,
    docRef,
    precision: "int8",
    dim: 1,
    chunkCount: 1,
    generation,
    chunkIds: new Blob([new Uint32Array([1]).buffer]),
    vectorData: new Blob([new Int8Array([1]).buffer]),
    scaleData: new Blob([new Float32Array([1]).buffer]),
  };
}

function snapshot(id: string, docRef: number, generation: number) {
  return {
    id,
    docRef,
    generation,
    plainText: `snapshot ${id}`,
  };
}
