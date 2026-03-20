import type { BM25Index, Chunk, HnswGraphData } from './hybrid-types';

export type ChunkRow = {
	id?: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	vector: Blob;
	scale: number;
	precision: string;
	vectorF16?: Blob;
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
	vector: Int8Array;
	scale: number;
	vectorF16?: Uint16Array;
};

export function int8ToBlob(arr: Int8Array): Blob {
	return new Blob([arr.buffer]);
}

export async function blobToInt8(blob: Blob): Promise<Int8Array> {
	const buf = await readBlobAsArrayBuffer(blob);
	return new Int8Array(buf);
}

export function uint16ToBlob(arr: Uint16Array): Blob {
	return new Blob([arr.buffer]);
}

export async function blobToUint16(blob: Blob): Promise<Uint16Array> {
	const buf = await readBlobAsArrayBuffer(blob);
	return new Uint16Array(buf);
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
	chunks.push(writeUint32(index.docCount));
	chunks.push(writeFloat32(index.avgDocLen));

	chunks.push(writeUint32(termEntries.length));
	for (const [term, entry] of termEntries) {
		const termBytes = textEncoder.encode(term);
		chunks.push(writeUint32(entry.termId));
		chunks.push(writeUint32(entry.df));
		chunks.push(writeUint32(termBytes.length));
		chunks.push(termBytes);
	}

	chunks.push(writeUint32(postingEntries.length));
	for (const [termId, list] of postingEntries) {
		chunks.push(writeUint32(Number(termId)));
		chunks.push(writeUint32(list.entries.length));
		for (const entry of list.entries) {
			chunks.push(writeUint32(entry.docId));
			chunks.push(writeFloat32(entry.tfNorm));
			chunks.push(writeUint8(entry.positions.length));
			for (const delta of entry.positions) {
				chunks.push(writeUint16(delta));
			}
		}
	}

	chunks.push(writeUint32(docLengthEntries.length));
	for (const [docId, length] of docLengthEntries) {
		chunks.push(writeUint32(Number(docId)));
		chunks.push(writeUint32(length));
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

	const docCount = reader.readUint32();
	const avgDocLen = reader.readFloat32();

	const termCount = reader.readUint32();
	const termDict: BM25Index['termDict'] = {};
	for (let i = 0; i < termCount; i++) {
		const termId = reader.readUint32();
		const df = reader.readUint32();
		const term = reader.readString(reader.readUint32());
		termDict[term] = { termId, df };
	}

	const postingsCount = reader.readUint32();
	const postings: BM25Index['postings'] = {};
	for (let i = 0; i < postingsCount; i++) {
		const termId = reader.readUint32();
		const entryCount = reader.readUint32();
		const entries = [];
		for (let j = 0; j < entryCount; j++) {
			const docId = reader.readUint32();
			const tfNorm = reader.readFloat32();
			const positionCount = reader.readUint8();
			const positions: number[] = [];
			for (let k = 0; k < positionCount; k++) {
				positions.push(reader.readUint16());
			}
			entries.push({ docId, tfNorm, positions });
		}
		postings[termId] = { entries };
	}

	const docLengthCount = reader.readUint32();
	const docLengths: BM25Index['docLengths'] = {};
	for (let i = 0; i < docLengthCount; i++) {
		docLengths[reader.readUint32()] = reader.readUint32();
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
		text: c.text,
		startLine: c.startLine,
		startCol: c.startCol,
		endLine: c.endLine,
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
		filePath: row.filePath,
		text: row.text,
		startLine: row.startLine,
		startCol: row.startCol ?? 0,
		endLine: row.endLine,
		vector: await blobToInt8(row.vector),
		scale: row.scale,
		vectorF16: row.vectorF16 ? await blobToUint16(row.vectorF16) : undefined,
	};
}

export async function rowToChunkVector(row: ChunkRow): Promise<ChunkVectorRecord> {
	return {
		id: row.id!,
		vector: await blobToInt8(row.vector),
		scale: row.scale,
		vectorF16: row.vectorF16 ? await blobToUint16(row.vectorF16) : undefined,
	};
}

const BM25_BINARY_MAGIC = Uint8Array.from([0x43, 0x53, 0x42, 0x31]);
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

function writeFloat32(value: number): Uint8Array {
	const buf = new ArrayBuffer(4);
	new DataView(buf).setFloat32(0, value, true);
	return new Uint8Array(buf);
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
