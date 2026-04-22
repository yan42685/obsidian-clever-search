import type { BaseIndexedFileRef, DocRef } from "src/globals/search-types";
import type {
  Chunk,
  ChunkVectorShard,
  HnswGraphData,
  StoredVector,
  VectorPrecision,
} from "./hybrid-types";

export type ChunkRow = {
  id?: number;
  docRef?: DocRef;
  generation?: number;
  filePath: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startCol: number;
  endLine: number;
  embedKey: string;
};

export type HybridFileSnapshotRow = {
  docRef?: DocRef;
  filePath: string;
  plainText: string;
  generation?: number;
};

export type HybridDirtyShadowRow = {
  docRef?: DocRef;
  filePath: string;
  plainText: string;
  generation?: number;
};

export type ChunkVectorShardRow = {
  docRef?: DocRef;
  filePath: string;
  precision: string;
  dim: number;
  chunkCount: number;
  generation?: number;
  chunkIds: Blob;
  vectorData: Blob;
  scaleData?: Blob;
};

export type BlobRecord = {
  id: number;
  data: Blob;
};

export type HybridDocState = "pending" | "ready" | "lexical_only" | "failed";

export type HybridIndexedFileRef = BaseIndexedFileRef & {
  docRef?: DocRef;
  state?: HybridDocState;
  chunkCount?: number;
  vectorPrecision?: VectorPrecision | null;
  indexedAt?: number;
  lastIncrementalEmbedAt?: number;
};

export type ChunkVectorRecord = {
  id: number;
  vector: StoredVector;
};

export class ChunkVectorShardBuilder {
  private readonly chunkIds: number[] = [];
  private readonly int8Blocks: Int8Array[] = [];
  private readonly float16Blocks: Uint16Array[] = [];
  private readonly scaleBlocks: number[] = [];

  constructor(
    private readonly precision: VectorPrecision,
    private readonly dim: number,
  ) {}

  append(chunkIds: number[], vectors: StoredVector[]): void {
    if (chunkIds.length !== vectors.length) {
      throw new Error("Chunk ids and vectors length mismatch");
    }
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector.precision !== this.precision) {
        throw new Error("Mixed vector precisions in shard builder");
      }
      this.chunkIds.push(chunkIds[i]);
      if (this.precision === "int8") {
        this.int8Blocks.push(vector.vector as Int8Array);
        this.scaleBlocks.push(
          (vector as Extract<StoredVector, { precision: "int8" }>).scale,
        );
      } else {
        this.float16Blocks.push(vector.vector as Uint16Array);
      }
    }
  }

  isEmpty(): boolean {
    return this.chunkIds.length === 0;
  }

  build(
    filePath: string,
    options?: {
      docRef?: DocRef;
      generation?: number;
    },
  ): ChunkVectorShard {
    if (this.chunkIds.length === 0) {
      throw new Error("Cannot build an empty chunk vector shard");
    }

    const chunkIdArray = Uint32Array.from(this.chunkIds);
    if (this.precision === "int8") {
      const flat = new Int8Array(this.chunkIds.length * this.dim);
      const scales = new Float32Array(this.chunkIds.length);
      for (let i = 0; i < this.int8Blocks.length; i++) {
        flat.set(this.int8Blocks[i], i * this.dim);
        scales[i] = this.scaleBlocks[i];
      }
      return {
        docRef: options?.docRef,
        filePath,
        precision: this.precision,
        dim: this.dim,
        chunkCount: this.chunkIds.length,
        generation: options?.generation,
        chunkIds: chunkIdArray,
        vectorData: flat,
        scaleData: scales,
      };
    }

    const flat = new Uint16Array(this.chunkIds.length * this.dim);
    for (let i = 0; i < this.float16Blocks.length; i++) {
      flat.set(this.float16Blocks[i], i * this.dim);
    }
    return {
      docRef: options?.docRef,
      filePath,
      precision: this.precision,
      dim: this.dim,
      chunkCount: this.chunkIds.length,
      generation: options?.generation,
      chunkIds: chunkIdArray,
      vectorData: flat,
    };
  }
}

export function int8ToBlob(arr: Int8Array): Blob {
  return new Blob([arr.buffer]);
}

export async function blobToInt8(blob: Blob): Promise<Int8Array> {
  const buf = await readBlobAsArrayBuffer(blob);
  return new Int8Array(buf);
}

export function uint32ToBlob(arr: Uint32Array): Blob {
  return new Blob([arr.buffer]);
}

export async function blobToUint32(blob: Blob): Promise<Uint32Array> {
  const buf = await readBlobAsArrayBuffer(blob);
  return new Uint32Array(buf);
}

export function uint16ToBlob(arr: Uint16Array): Blob {
  return new Blob([arr.buffer]);
}

export async function blobToUint16(blob: Blob): Promise<Uint16Array> {
  const buf = await readBlobAsArrayBuffer(blob);
  return new Uint16Array(buf);
}

export function float32ToBlob(arr: Float32Array): Blob {
  return new Blob([arr.buffer]);
}

export async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const buf = await readBlobAsArrayBuffer(blob);
  return new Float32Array(buf);
}

export function hnswToBlob(data: HnswGraphData): Blob {
  return new Blob([JSON.stringify(data)], { type: "application/json" });
}

export async function blobToHnsw(blob: Blob): Promise<HnswGraphData> {
  return JSON.parse(await readBlobAsText(blob)) as HnswGraphData;
}

export function chunkToRow(c: Omit<Chunk, "id"> & { id?: number }): ChunkRow {
  const row: ChunkRow = {
    docRef: c.docRef,
    generation: c.generation,
    filePath: c.filePath,
    chunkIndex: c.chunkIndex,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    startLine: c.startLine,
    startCol: c.startCol,
    endLine: c.endLine,
    embedKey: c.embedKey,
  };
  if (c.id !== undefined) row.id = c.id;
  return row;
}

export function rowToChunk(row: ChunkRow, plainText: string): Chunk {
  return {
    id: row.id!,
    docRef: row.docRef,
    generation: row.generation,
    filePath: row.filePath,
    chunkIndex: row.chunkIndex,
    text: plainText.slice(row.startOffset, row.endOffset),
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    startLine: row.startLine,
    startCol: row.startCol ?? 0,
    endLine: row.endLine,
    embedKey: row.embedKey,
  };
}

export function chunkVectorShardToRow(
  shard: ChunkVectorShard,
): ChunkVectorShardRow {
  return {
    docRef: shard.docRef,
    filePath: shard.filePath,
    precision: shard.precision,
    dim: shard.dim,
    chunkCount: shard.chunkCount,
    generation: shard.generation,
    chunkIds: uint32ToBlob(shard.chunkIds),
    vectorData:
      shard.precision === "int8"
        ? int8ToBlob(shard.vectorData as Int8Array)
        : uint16ToBlob(shard.vectorData as Uint16Array),
    scaleData: shard.scaleData ? float32ToBlob(shard.scaleData) : undefined,
  };
}

export async function rowToChunkVectorShard(
  row: ChunkVectorShardRow,
): Promise<ChunkVectorShard> {
  const precision = parseVectorPrecision(row.precision);
  return {
    docRef: row.docRef,
    filePath: row.filePath,
    precision,
    dim: row.dim,
    chunkCount: row.chunkCount,
    generation: row.generation,
    chunkIds: await blobToUint32(row.chunkIds),
    vectorData:
      precision === "int8"
        ? await blobToInt8(row.vectorData)
        : await blobToUint16(row.vectorData),
    scaleData: row.scaleData ? await blobToFloat32(row.scaleData) : undefined,
  };
}

export async function rowToChunkVectorRecords(
  row: ChunkVectorShardRow,
): Promise<ChunkVectorRecord[]> {
  const precision = parseVectorPrecision(row.precision);
  const [chunkIds, vectorData, scaleData] = await Promise.all([
    blobToUint32(row.chunkIds),
    precision === "int8"
      ? blobToInt8(row.vectorData)
      : blobToUint16(row.vectorData),
    row.scaleData ? blobToFloat32(row.scaleData) : Promise.resolve(undefined),
  ]);

  const records: ChunkVectorRecord[] = [];
  if (precision === "int8") {
    const int8VectorData = vectorData as Int8Array;
    if (!scaleData || scaleData.length !== row.chunkCount) {
      throw new Error("Invalid int8 chunk vector shard scale data");
    }
    for (let i = 0; i < row.chunkCount; i++) {
      records.push({
        id: chunkIds[i],
        vector: {
          precision: "int8",
          vector: int8VectorData.subarray(i * row.dim, (i + 1) * row.dim),
          scale: scaleData[i],
        },
      });
    }
    return records;
  }

  const float16VectorData = vectorData as Uint16Array;
  for (let i = 0; i < row.chunkCount; i++) {
    records.push({
      id: chunkIds[i],
      vector: {
        precision: "float16",
        vector: float16VectorData.subarray(i * row.dim, (i + 1) * row.dim),
      },
    });
  }
  return records;
}

export function buildChunkVectorShard(
  filePath: string,
  chunkIds: number[],
  vectors: StoredVector[],
  dim: number,
  options?: {
    docRef?: DocRef;
    generation?: number;
  },
): ChunkVectorShard {
  if (chunkIds.length !== vectors.length) {
    throw new Error("Chunk ids and vectors length mismatch");
  }
  if (vectors.length === 0) {
    throw new Error("Cannot build an empty chunk vector shard");
  }

  const precision = vectors[0].precision;
  const chunkIdArray = Uint32Array.from(chunkIds);

  if (precision === "int8") {
    const flat = new Int8Array(chunkIds.length * dim);
    const scales = new Float32Array(chunkIds.length);
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector.precision !== "int8") {
        throw new Error("Mixed vector precisions in shard");
      }
      flat.set(vector.vector, i * dim);
      scales[i] = vector.scale;
    }
    return {
      docRef: options?.docRef,
      filePath,
      precision,
      dim,
      chunkCount: chunkIds.length,
      generation: options?.generation,
      chunkIds: chunkIdArray,
      vectorData: flat,
      scaleData: scales,
    };
  }

  const flat = new Uint16Array(chunkIds.length * dim);
  for (let i = 0; i < vectors.length; i++) {
    const vector = vectors[i];
    if (vector.precision !== "float16") {
      throw new Error("Mixed vector precisions in shard");
    }
    flat.set(vector.vector, i * dim);
  }
  return {
    docRef: options?.docRef,
    filePath,
    precision,
    dim,
    chunkCount: chunkIds.length,
    generation: options?.generation,
    chunkIds: chunkIdArray,
    vectorData: flat,
  };
}

export function shardToChunkVectorRecords(
  shard: ChunkVectorShard,
): ChunkVectorRecord[] {
  const records: ChunkVectorRecord[] = [];
  if (shard.precision === "int8") {
    const vectorData = shard.vectorData as Int8Array;
    const scaleData = shard.scaleData;
    if (!scaleData || scaleData.length !== shard.chunkCount) {
      throw new Error("Invalid int8 chunk vector shard scale data");
    }
    for (let i = 0; i < shard.chunkCount; i++) {
      records.push({
        id: shard.chunkIds[i],
        vector: {
          precision: "int8",
          vector: vectorData.subarray(i * shard.dim, (i + 1) * shard.dim),
          scale: scaleData[i],
        },
      });
    }
    return records;
  }

  const vectorData = shard.vectorData as Uint16Array;
  for (let i = 0; i < shard.chunkCount; i++) {
    records.push({
      id: shard.chunkIds[i],
      vector: {
        precision: "float16",
        vector: vectorData.subarray(i * shard.dim, (i + 1) * shard.dim),
      },
    });
  }
  return records;
}

function parseVectorPrecision(value: string): VectorPrecision {
  return value === "float16" ? "float16" : "int8";
}

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob as ArrayBuffer"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

async function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob as text"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}
