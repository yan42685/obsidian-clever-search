import type { BM25Index, BigChunk, Chunk, HnswGraphData } from './hybrid-types';

// ─── Row types for Dexie tables ───────────────────────────────────────────────

export type ChunkRow = {
	id?: number;
	bigChunkId: number;
	filePath: string;
	startOffset?: number;
	endOffset?: number;
	vector: Blob;       // Int8Array serialized
	scale: number;
	precision: string;  // 'int8' | 'float16'
	vectorF16?: Blob;   // Uint16Array serialized, only when precision='float16'
};

export type BigChunkRow = {
	id?: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	chunkIds: string;   // JSON array of chunk ids
	vector?: Blob;
	scale?: number;
	vectorF16?: Blob;
};

export type BlobRecord = {
	id: number;         // always 0 (single-record tables)
	data: Blob;
};

export type HybridDocRef = {
	path: string;
	updateTime: number;
};

// ─── Serialization helpers ────────────────────────────────────────────────────

export function int8ToBlob(arr: Int8Array): Blob {
	return new Blob([arr.buffer]);
}

export async function blobToInt8(blob: Blob): Promise<Int8Array> {
	const buf = await blob.arrayBuffer();
	return new Int8Array(buf);
}

export function uint16ToBlob(arr: Uint16Array): Blob {
	return new Blob([arr.buffer]);
}

export async function blobToUint16(blob: Blob): Promise<Uint16Array> {
	const buf = await blob.arrayBuffer();
	return new Uint16Array(buf);
}

export function bm25ToBlob(index: BM25Index): Blob {
	return new Blob([JSON.stringify(index)], { type: 'application/json' });
}

export async function blobToBm25(blob: Blob): Promise<BM25Index> {
	return JSON.parse(await blob.text()) as BM25Index;
}

export function hnswToBlob(data: HnswGraphData): Blob {
	return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function blobToHnsw(blob: Blob): Promise<HnswGraphData> {
	return JSON.parse(await blob.text()) as HnswGraphData;
}

// ─── BigChunk ↔ Row conversion ────────────────────────────────────────────────

export function bigChunkToRow(bc: Omit<BigChunk, 'id'> & { id?: number }): BigChunkRow {
	const row: BigChunkRow = {
		filePath: bc.filePath,
		text: bc.text,
		startLine: bc.startLine,
		startCol: bc.startCol,
		endLine: bc.endLine,
		chunkIds: JSON.stringify(bc.chunkIds),
		vector: bc.vector ? int8ToBlob(bc.vector) : undefined,
		scale: bc.scale,
		vectorF16: bc.vectorF16 ? uint16ToBlob(bc.vectorF16) : undefined,
	};
	if (bc.id !== undefined) row.id = bc.id;
	return row;
}

export async function rowToBigChunk(row: BigChunkRow): Promise<BigChunk> {
	return {
		id: row.id!,
		filePath: row.filePath,
		text: row.text,
		startLine: row.startLine,
		startCol: row.startCol ?? 0,
		endLine: row.endLine,
		chunkIds: JSON.parse(row.chunkIds) as number[],
		vector: row.vector ? await blobToInt8(row.vector) : new Int8Array(0),
		scale: row.scale ?? 1,
		vectorF16: row.vectorF16 ? await blobToUint16(row.vectorF16) : undefined,
	};
}

export function chunkToRow(c: Omit<Chunk, 'id'> & { id?: number }): ChunkRow {
	const row: ChunkRow = {
		bigChunkId: c.bigChunkId,
		filePath: c.filePath,
		startOffset: c.startOffset,
		endOffset: c.endOffset,
		vector: int8ToBlob(c.vector),
		scale: c.scale,
		precision: c.vectorF16 ? 'float16' : 'int8',
		vectorF16: c.vectorF16 ? uint16ToBlob(c.vectorF16) : undefined,
	};
	if (c.id !== undefined) row.id = c.id;
	return row;
}

export async function rowToChunk(row: ChunkRow): Promise<Chunk> {
	return {
		id: row.id!,
		bigChunkId: row.bigChunkId,
		filePath: row.filePath,
		startOffset: row.startOffset ?? 0,
		endOffset: row.endOffset ?? 0,
		vector: await blobToInt8(row.vector),
		scale: row.scale,
		vectorF16: row.vectorF16 ? await blobToUint16(row.vectorF16) : undefined,
	};
}
