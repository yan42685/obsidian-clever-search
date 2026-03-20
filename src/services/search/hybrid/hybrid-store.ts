import type {
	BM25Index,
	Chunk,
	ChunkVectorShard,
	HnswGraphData,
	StoredVector,
	VectorPrecision,
} from './hybrid-types';

export type ChunkRow = {
	id?: number;
	filePath: string;
	chunkIndex: number;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
};

export type ChunkVectorShardRow = {
	filePath: string;
	precision: string;
	dim: number;
	chunkCount: number;
	chunkIds: Blob;
	vectorData: Blob;
	scaleData?: Blob;
};

export type BlobRecord = {
	id: number;
	data: Blob;
};

export type HybridDocRef = {
	path: string;
	updateTime: number;
};

export type ChunkVectorRecord = {
	id: number;
	vector: StoredVector;
};

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

export function bm25ToBlob(index: BM25Index): Blob {
	const chunks: Uint8Array[] = [];
	const termEntries = Object.entries(index.termDict)
		.sort((a, b) => a[1].termId - b[1].termId);
	const postingEntries = Object.entries(index.postings)
		.sort((a, b) => Number(a[0]) - Number(b[0]));
	const docLengthEntries = Object.entries(index.docLengths)
		.sort((a, b) => Number(a[0]) - Number(b[0]));

	chunks.push(BM25_BINARY_MAGIC);
	chunks.push(writeVarUint(index.docCount));
	chunks.push(writeFloat32(index.avgDocLen));

	chunks.push(writeVarUint(termEntries.length));
	for (const [term, entry] of termEntries) {
		const termBytes = textEncoder.encode(term);
		chunks.push(writeVarUint(entry.termId));
		chunks.push(writeVarUint(entry.df));
		chunks.push(writeVarUint(termBytes.length));
		chunks.push(termBytes);
	}

	chunks.push(writeVarUint(postingEntries.length));
	for (const [termId, list] of postingEntries) {
		chunks.push(writeVarUint(Number(termId)));
		chunks.push(writeVarUint(list.entries.length));
		let prevDocId = 0;
		for (const entry of list.entries) {
			chunks.push(writeVarUint(entry.docId - prevDocId));
			prevDocId = entry.docId;
			chunks.push(writeUint16(quantizeTfNorm(entry.tfNorm)));
			chunks.push(writeVarUint(entry.positions.length));
			for (const delta of entry.positions) {
				chunks.push(writeVarUint(delta));
			}
		}
	}

	chunks.push(writeVarUint(docLengthEntries.length));
	let prevDocId = 0;
	for (const [docId, length] of docLengthEntries) {
		const numericDocId = Number(docId);
		chunks.push(writeVarUint(numericDocId - prevDocId));
		prevDocId = numericDocId;
		chunks.push(writeVarUint(length));
	}

	return new Blob(chunks, { type: 'application/octet-stream' });
}

export async function blobToBm25(blob: Blob): Promise<BM25Index> {
	const buf = await readBlobAsArrayBuffer(blob);
	if (!isBm25Binary(buf)) {
		throw new Error('Unsupported BM25 blob format');
	}

	const reader = new BinaryReader(buf);
	reader.skip(BM25_BINARY_MAGIC.length);

	const docCount = reader.readVarUint();
	const avgDocLen = reader.readFloat32();

	const termCount = reader.readVarUint();
	const termDict: BM25Index['termDict'] = {};
	for (let i = 0; i < termCount; i++) {
		const termId = reader.readVarUint();
		const df = reader.readVarUint();
		const term = reader.readString(reader.readVarUint());
		termDict[term] = { termId, df };
	}

	const postingsCount = reader.readVarUint();
	const postings: BM25Index['postings'] = {};
	for (let i = 0; i < postingsCount; i++) {
		const termId = reader.readVarUint();
		const entryCount = reader.readVarUint();
		const entries = [];
		let docId = 0;
		for (let j = 0; j < entryCount; j++) {
			docId += reader.readVarUint();
			const tfNorm = dequantizeTfNorm(reader.readUint16());
			const positionCount = reader.readVarUint();
			const positions: number[] = [];
			for (let k = 0; k < positionCount; k++) {
				positions.push(reader.readVarUint());
			}
			entries.push({ docId, tfNorm, positions });
		}
		postings[termId] = { entries };
	}

	const docLengthCount = reader.readVarUint();
	const docLengths: BM25Index['docLengths'] = {};
	let docId = 0;
	for (let i = 0; i < docLengthCount; i++) {
		docId += reader.readVarUint();
		docLengths[docId] = reader.readVarUint();
	}

	return {
		termDict,
		postings,
		docCount,
		avgDocLen,
		docLengths,
	};
}

export function hnswToBlob(data: HnswGraphData): Blob {
	return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function blobToHnsw(blob: Blob): Promise<HnswGraphData> {
	return JSON.parse(await readBlobAsText(blob)) as HnswGraphData;
}

export function chunkToRow(c: Omit<Chunk, 'id'> & { id?: number }): ChunkRow {
	const row: ChunkRow = {
		filePath: c.filePath,
		chunkIndex: c.chunkIndex,
		text: c.text,
		startLine: c.startLine,
		startCol: c.startCol,
		endLine: c.endLine,
	};
	if (c.id !== undefined) row.id = c.id;
	return row;
}

export async function rowToChunk(row: ChunkRow): Promise<Chunk> {
	return {
		id: row.id!,
		filePath: row.filePath,
		chunkIndex: row.chunkIndex,
		text: row.text,
		startLine: row.startLine,
		startCol: row.startCol ?? 0,
		endLine: row.endLine,
	};
}

export function chunkVectorShardToRow(shard: ChunkVectorShard): ChunkVectorShardRow {
	return {
		filePath: shard.filePath,
		precision: shard.precision,
		dim: shard.dim,
		chunkCount: shard.chunkCount,
		chunkIds: uint32ToBlob(shard.chunkIds),
		vectorData:
			shard.precision === 'int8'
				? int8ToBlob(shard.vectorData as Int8Array)
				: uint16ToBlob(shard.vectorData as Uint16Array),
		scaleData: shard.scaleData ? float32ToBlob(shard.scaleData) : undefined,
	};
}

export async function rowToChunkVectorShard(row: ChunkVectorShardRow): Promise<ChunkVectorShard> {
	const precision = parseVectorPrecision(row.precision);
	return {
		filePath: row.filePath,
		precision,
		dim: row.dim,
		chunkCount: row.chunkCount,
		chunkIds: await blobToUint32(row.chunkIds),
		vectorData:
			precision === 'int8'
				? await blobToInt8(row.vectorData)
				: await blobToUint16(row.vectorData),
		scaleData: row.scaleData ? await blobToFloat32(row.scaleData) : undefined,
	};
}

export function buildChunkVectorShard(
	filePath: string,
	chunkIds: number[],
	vectors: StoredVector[],
	dim: number,
): ChunkVectorShard {
	if (chunkIds.length !== vectors.length) {
		throw new Error('Chunk ids and vectors length mismatch');
	}
	if (vectors.length === 0) {
		throw new Error('Cannot build an empty chunk vector shard');
	}

	const precision = vectors[0].precision;
	const chunkIdArray = Uint32Array.from(chunkIds);

	if (precision === 'int8') {
		const flat = new Int8Array(chunkIds.length * dim);
		const scales = new Float32Array(chunkIds.length);
		for (let i = 0; i < vectors.length; i++) {
			const vector = vectors[i];
			if (vector.precision !== 'int8') {
				throw new Error('Mixed vector precisions in shard');
			}
			flat.set(vector.vector, i * dim);
			scales[i] = vector.scale;
		}
		return {
			filePath,
			precision,
			dim,
			chunkCount: chunkIds.length,
			chunkIds: chunkIdArray,
			vectorData: flat,
			scaleData: scales,
		};
	}

	const flat = new Uint16Array(chunkIds.length * dim);
	for (let i = 0; i < vectors.length; i++) {
		const vector = vectors[i];
		if (vector.precision !== 'float16') {
			throw new Error('Mixed vector precisions in shard');
		}
		flat.set(vector.vector, i * dim);
	}
	return {
		filePath,
		precision,
		dim,
		chunkCount: chunkIds.length,
		chunkIds: chunkIdArray,
		vectorData: flat,
	};
}

export function shardToChunkVectorRecords(shard: ChunkVectorShard): ChunkVectorRecord[] {
	const records: ChunkVectorRecord[] = [];
	if (shard.precision === 'int8') {
		const vectorData = shard.vectorData as Int8Array;
		const scaleData = shard.scaleData;
		if (!scaleData || scaleData.length !== shard.chunkCount) {
			throw new Error('Invalid int8 chunk vector shard scale data');
		}
		for (let i = 0; i < shard.chunkCount; i++) {
			records.push({
				id: shard.chunkIds[i],
				vector: {
					precision: 'int8',
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
				precision: 'float16',
				vector: vectorData.subarray(i * shard.dim, (i + 1) * shard.dim),
			},
		});
	}
	return records;
}

function parseVectorPrecision(value: string): VectorPrecision {
	return value === 'float16' ? 'float16' : 'int8';
}

const BM25_BINARY_MAGIC = Uint8Array.from([0x43, 0x53, 0x42, 0x32]);
const BM25_TF_NORM_SCALE = 4096;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function writeUint8(value: number): Uint8Array {
	return Uint8Array.of(value);
}

function writeUint16(value: number): Uint8Array {
	const buf = new ArrayBuffer(2);
	new DataView(buf).setUint16(0, value, true);
	return new Uint8Array(buf);
}

function writeUint32(value: number): Uint8Array {
	const buf = new ArrayBuffer(4);
	new DataView(buf).setUint32(0, value, true);
	return new Uint8Array(buf);
}

function writeVarUint(value: number): Uint8Array {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`VarUint only supports non-negative integers, got ${value}`);
	}
	const bytes: number[] = [];
	let current = value;
	do {
		let byte = current & 0x7f;
		current = Math.floor(current / 128);
		if (current > 0) {
			byte |= 0x80;
		}
		bytes.push(byte);
	} while (current > 0);
	return Uint8Array.from(bytes);
}

function writeFloat32(value: number): Uint8Array {
	const buf = new ArrayBuffer(4);
	new DataView(buf).setFloat32(0, value, true);
	return new Uint8Array(buf);
}

function quantizeTfNorm(value: number): number {
	const scaled = Math.round(value * BM25_TF_NORM_SCALE);
	return Math.max(0, Math.min(0xffff, scaled));
}

function dequantizeTfNorm(value: number): number {
	return value / BM25_TF_NORM_SCALE;
}

function isBm25Binary(buf: ArrayBuffer): boolean {
	if (buf.byteLength < BM25_BINARY_MAGIC.length) {
		return false;
	}
	const bytes = new Uint8Array(buf, 0, BM25_BINARY_MAGIC.length);
	for (let i = 0; i < BM25_BINARY_MAGIC.length; i++) {
		if (bytes[i] !== BM25_BINARY_MAGIC[i]) {
			return false;
		}
	}
	return true;
}

class BinaryReader {
	private readonly view: DataView;
	private offset = 0;

	constructor(buffer: ArrayBuffer) {
		this.view = new DataView(buffer);
	}

	skip(length: number): void {
		this.offset += length;
	}

	readUint8(): number {
		const value = this.view.getUint8(this.offset);
		this.offset += 1;
		return value;
	}

	readUint16(): number {
		const value = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return value;
	}

	readUint32(): number {
		const value = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return value;
	}

	readVarUint(): number {
		let value = 0;
		let shift = 0;
		while (true) {
			const byte = this.readUint8();
			value += (byte & 0x7f) * 2 ** shift;
			if ((byte & 0x80) === 0) {
				return value;
			}
			shift += 7;
			if (shift > 35) {
				throw new Error('Invalid varuint encoding');
			}
		}
	}

	readFloat32(): number {
		const value = this.view.getFloat32(this.offset, true);
		this.offset += 4;
		return value;
	}

	readString(byteLength: number): string {
		const start = this.offset;
		const end = start + byteLength;
		this.offset = end;
		return textDecoder.decode(new Uint8Array(this.view.buffer, start, byteLength));
	}
}

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
	if (typeof blob.arrayBuffer === 'function') {
		return blob.arrayBuffer();
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as ArrayBuffer'));
		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.readAsArrayBuffer(blob);
	});
}

async function readBlobAsText(blob: Blob): Promise<string> {
	if (typeof blob.text === 'function') {
		return blob.text();
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as text'));
		reader.onload = () => resolve(reader.result as string);
		reader.readAsText(blob);
	});
}
