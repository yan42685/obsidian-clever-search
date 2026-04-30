import "fake-indexeddb/auto";

import Dexie from "dexie";
import { buildIndexArtifactStateId } from "src/services/obsidian/user-data/index-artifact-state";
import { runHybridStorageGc } from "src/services/search/hybrid/hybrid-storage-gc";

describe("runHybridStorageGc", () => {
  let db: Dexie & {
    docRegistry: Dexie.Table<any, number>;
    hybridChunks: Dexie.Table<any, number>;
    hybridChunkVectors: Dexie.Table<any, string>;
    hybridIndexedFileRefs: Dexie.Table<any, number>;
    fileSnapshots: Dexie.Table<any, string>;
    hybridDirtyShadows: Dexie.Table<any, string>;
    indexArtifactState: Dexie.Table<any, string>;
  };

  beforeEach(async () => {
    db = new Dexie(`hybrid-storage-gc-${Date.now()}-${Math.random()}`) as typeof db;
    db.version(1).stores({
      docRegistry:
        "docRef, path, deleted, liveGeneration, denseReadyGeneration, denseTargetGeneration, denseState, denseServeUntil, updatedAt",
      hybridChunks:
        "++id, docRef, generation, [docRef+generation], [docRef+generation+chunkIndex]",
      hybridChunkVectors: "id, docRef, generation, [docRef+generation]",
      hybridIndexedFileRefs: "docRef, generation, state",
      fileSnapshots: "id, docRef, generation, [docRef+generation]",
      hybridDirtyShadows: "id, docRef, generation, [docRef+generation]",
      indexArtifactState: "id, engine, artifact, dirtyAt, [engine+artifact]",
    });
    await db.open();
  });

  afterEach(async () => {
    const name = db.name;
    db.close();
    await Dexie.delete(name);
  });

  test("removes stale hybrid-private rows while preserving shared live snapshots conservatively", async () => {
    const now = 1_000;
    await db.docRegistry.bulkPut([
      {
        docRef: 1,
        path: "docs/current.md",
        deleted: false,
        liveGeneration: 2,
        updatedAt: 2,
      },
      {
        docRef: 2,
        path: "docs/deleted.md",
        deleted: true,
        liveGeneration: 5,
        updatedAt: 5,
      },
      {
        docRef: 3,
        path: "docs/lexical-only.md",
        deleted: false,
        liveGeneration: 10,
        updatedAt: 10,
      },
      {
        docRef: 4,
        path: "docs/stale-serving.md",
        deleted: false,
        liveGeneration: 21,
        denseServeUntil: now + 100,
        updatedAt: 21,
      },
      {
        docRef: 5,
        path: "docs/stale-expired.md",
        deleted: false,
        liveGeneration: 31,
        denseServeUntil: now - 1,
        updatedAt: 31,
      },
    ]);
    await db.hybridIndexedFileRefs.bulkPut([
      { docRef: 1, generation: 2, state: "ready", chunkCount: 1, vectorPrecision: "int8" },
      { docRef: 2, generation: 5, state: "ready", chunkCount: 1, vectorPrecision: "int8" },
      { docRef: 3, generation: 10, state: "lexical_only", chunkCount: 1, vectorPrecision: null },
      { docRef: 4, generation: 20, state: "ready", chunkCount: 1, vectorPrecision: "int8" },
      { docRef: 5, generation: 30, state: "ready", chunkCount: 1, vectorPrecision: "int8" },
      { docRef: 6, generation: 40, state: "ready", chunkCount: 1, vectorPrecision: "int8" },
    ]);
    await db.hybridChunks.bulkPut([
      chunk(1, 1, 2),
      chunk(2, 1, 1),
      chunk(3, 2, 5),
      chunk(4, 3, 10),
      chunk(5, 4, 20),
      chunk(6, 4, 19),
      chunk(7, 5, 30),
      chunk(8, 6, 40),
    ]);
    await db.hybridChunkVectors.bulkPut([
      vector("1:2", 1, 2),
      vector("1:1", 1, 1),
      vector("2:5", 2, 5),
      vector("3:10", 3, 10),
      vector("4:20", 4, 20),
      vector("4:19", 4, 19),
      vector("5:30", 5, 30),
      vector("6:40", 6, 40),
    ]);
    await db.hybridDirtyShadows.bulkPut([
      snapshot("1:2", 1, 2),
      snapshot("1:1", 1, 1),
      snapshot("2:5", 2, 5),
      snapshot("4:20", 4, 20),
      snapshot("5:30", 5, 30),
      snapshot("6:40", 6, 40),
    ]);
    await db.fileSnapshots.bulkPut([
      snapshot("1:2", 1, 2),
      snapshot("1:1", 1, 1),
      snapshot("2:5", 2, 5),
      snapshot("4:20", 4, 20),
      snapshot("6:40", 6, 40),
    ]);

    const metrics = await runHybridStorageGc({ db }, { reason: "test-gc" });

    expect(metrics).toMatchObject({
      chunksRemoved: 4,
      vectorsRemoved: 4,
      indexedRefsRemoved: 2,
      snapshotsRemoved: 2,
      shadowsRemoved: 3,
      hnswMarkedDirty: true,
    });
    await expect(db.hybridChunks.orderBy(":id").keys()).resolves.toEqual([
      1,
      4,
      5,
      7,
    ]);
    await expect(db.hybridChunkVectors.orderBy(":id").keys()).resolves.toEqual([
      "1:2",
      "3:10",
      "4:20",
      "5:30",
    ]);
    await expect(db.hybridIndexedFileRefs.orderBy("docRef").keys()).resolves.toEqual([
      1,
      3,
      4,
      5,
    ]);
    await expect(db.hybridDirtyShadows.orderBy(":id").keys()).resolves.toEqual([
      "1:2",
      "4:20",
      "5:30",
    ]);
    await expect(db.fileSnapshots.orderBy(":id").keys()).resolves.toEqual([
      "1:1",
      "1:2",
      "4:20",
    ]);
    await expect(
      db.indexArtifactState.get(buildIndexArtifactStateId("hybrid", "hnsw")),
    ).resolves.toMatchObject({
      engine: "hybrid",
      artifact: "hnsw",
      reason: "test-gc",
    });
  });

  test("does not mark HNSW dirty when only shared snapshots or shadows are removed", async () => {
    await db.docRegistry.put({
      docRef: 1,
      path: "docs/current.md",
      deleted: false,
      liveGeneration: 2,
      updatedAt: 2,
    });
    await db.fileSnapshots.put(snapshot("2:1", 2, 1));
    await db.hybridDirtyShadows.put(snapshot("2:1", 2, 1));

    const metrics = await runHybridStorageGc({ db });

    expect(metrics).toMatchObject({
      chunksRemoved: 0,
      vectorsRemoved: 0,
      snapshotsRemoved: 1,
      shadowsRemoved: 1,
      hnswMarkedDirty: false,
    });
    await expect(
      db.indexArtifactState.get(buildIndexArtifactStateId("hybrid", "hnsw")),
    ).resolves.toBeUndefined();
  });

  test("keeps stale ready dense generation tail for live docs", async () => {
    await db.docRegistry.put({
      docRef: 7,
      path: "docs/stale-ready-tail.md",
      deleted: false,
      liveGeneration: 11,
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
      chunk(10, 7, 10),
      chunk(9, 7, 9),
    ]);
    await db.hybridChunkVectors.bulkPut([
      vector("7:10", 7, 10),
      vector("7:9", 7, 9),
    ]);
    await db.hybridDirtyShadows.bulkPut([
      snapshot("7:10", 7, 10),
      snapshot("7:9", 7, 9),
    ]);
    await db.fileSnapshots.bulkPut([
      snapshot("7:10", 7, 10),
      snapshot("7:11", 7, 11),
    ]);

    const metrics = await runHybridStorageGc({ db }, { reason: "tail-gc" });

    expect(metrics).toMatchObject({
      chunksRemoved: 1,
      vectorsRemoved: 1,
      indexedRefsRemoved: 0,
      snapshotsRemoved: 0,
      shadowsRemoved: 1,
      hnswMarkedDirty: true,
    });
    await expect(db.hybridChunks.orderBy(":id").keys()).resolves.toEqual([10]);
    await expect(db.hybridChunkVectors.orderBy(":id").keys()).resolves.toEqual([
      "7:10",
    ]);
    await expect(db.hybridDirtyShadows.orderBy(":id").keys()).resolves.toEqual([
      "7:10",
    ]);
    await expect(db.fileSnapshots.orderBy(":id").keys()).resolves.toEqual([
      "7:10",
      "7:11",
    ]);
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
    startLine: 1,
    startCol: 1,
    endLine: 1,
    embedKey: `${docRef}:${generation}`,
  };
}

function vector(id: string, docRef: number, generation: number) {
  return {
    id,
    docRef,
    generation,
    precision: "int8",
    dim: 2,
    chunkCount: 1,
    chunkIds: new Blob([Uint32Array.from([1]).buffer]),
    vectorData: new Blob([Int8Array.from([1, 2]).buffer]),
  };
}

function snapshot(id: string, docRef: number, generation: number) {
  return {
    id,
    docRef,
    generation,
    plainText: `${docRef}:${generation}`,
  };
}
