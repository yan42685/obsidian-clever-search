import {
	BM25_K1,
	type BM25Index,
	type Chunk,
	type ChunkVectorShard,
	type HnswGraphData,
	type StoredVector,
	type VectorPrecision,
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
	generation?: number;
	chunkIds: Blob;
	vectorData: Blob;
	scaleData?: Blob;
};

export type BlobRecord = {
	id: number;
	data: Blob;
};

export type Bm25BlobBreakdown = {
	version: 2 | 3 | 4;
	totalBytes: number;
	headerBytes: number;
	termTextBytes: number;
	termMetaBytes: number;
	postingHeaderBytes: number;
	postingDocDeltaBytes: number;
	postingTfNormBytes: number;
	postingPositionCountBytes: number;
	postingPositionDeltaBytes: number;
	docLengthsBytes: number;
	termCount: number;
	postingCount: number;
	postingsWithPositions: number;
	termsWithPositions: number;
	positionValueCount: number;
	topPositionHeavyTerms: Array<{
		term: string;
		df: number;
		positionBytes: number;
		positionCount: number;
	}>;
};

export type HybridDocState = "pending" | "ready" | "bm25_only" | "failed";

export type HybridDocRef = {
	path: string;
	updateTime: number;
	state?: HybridDocState;
	generation?: number;
	chunkCount?: number;
	vectorPrecision?: VectorPrecision | null;
	indexedAt?: number;
	lastErrorKind?: string | null;
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
				this.scaleBlocks.push((vector as Extract<StoredVector, { precision: "int8" }>).scale);
			} else {
				this.float16Blocks.push(vector.vector as Uint16Array);
			}
		}
	}

	isEmpty(): boolean {
		return this.chunkIds.length === 0;
	}

	build(filePath: string): ChunkVectorShard {
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
				filePath,
				precision: this.precision,
				dim: this.dim,
				chunkCount: this.chunkIds.length,
				generation: undefined,
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
			filePath,
			precision: this.precision,
			dim: this.dim,
			chunkCount: this.chunkIds.length,
			generation: undefined,
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

export function bm25ToBlob(index: BM25Index): Blob {
	const chunks: Uint8Array[] = [];
	const termEntries = Object.entries(index.termDict)
		.sort((a, b) => compareTerms(a[0], b[0]));
	const docLengthEntries = Object.entries(index.docLengths)
		.sort((a, b) => Number(a[0]) - Number(b[0]));

	chunks.push(BM25_BINARY_MAGIC_V4);
	chunks.push(writeVarUint(index.docCount));
	chunks.push(writeFloat32(index.avgDocLen));

	chunks.push(writeVarUint(termEntries.length));
	let prevTerm = '';
	for (const [term, entry] of termEntries) {
		chunks.push(writeVarUint(entry.df));
		const { prefixLength, suffixBytes } = encodeFrontCodedTerm(prevTerm, term);
		chunks.push(writeVarUint(prefixLength));
		chunks.push(writeVarUint(suffixBytes.length));
		chunks.push(suffixBytes);

		const list = index.postings[entry.termId];
		const entries = list?.entries ?? [];
		let prevDocId = 0;
		for (const posting of entries) {
			chunks.push(writeVarUint(posting.docId - prevDocId));
			prevDocId = posting.docId;
			chunks.push(writeUint8(quantizeTfNormByte(posting.tfNorm)));
			chunks.push(writeVarUint(posting.positions.length));
			for (const delta of posting.positions) {
				chunks.push(writeVarUint(delta));
			}
		}
		prevTerm = term;
	}

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
	const version = getBm25BinaryVersion(buf);
	if (version === null) {
		throw new Error('Unsupported BM25 blob format');
	}

	const reader = new BinaryReader(buf);
	if (version === 4) {
		return readBm25V4(reader);
	}
	if (version === 3) {
		return readBm25V3(reader);
	}
	return readBm25V2(reader);
}

export async function analyzeBm25Blob(blob: Blob): Promise<Bm25BlobBreakdown> {
	const buf = await readBlobAsArrayBuffer(blob);
	const version = getBm25BinaryVersion(buf);
	if (version === null) {
		throw new Error('Unsupported BM25 blob format');
	}

	return version === 4
		? analyzeBm25BlobV4(new BinaryReader(buf), blob.size)
		: version === 3
		? analyzeBm25BlobV3(new BinaryReader(buf), blob.size)
		: analyzeBm25BlobV2(new BinaryReader(buf), blob.size);
}

export async function getBm25BlobVersion(blob: Blob): Promise<2 | 3 | 4 | null> {
	return getBm25BinaryVersion(await readBlobAsArrayBuffer(blob));
}

function readBm25V4(reader: BinaryReader): BM25Index {
	reader.skip(BM25_BINARY_MAGIC_V4.length);

	const docCount = reader.readVarUint();
	const avgDocLen = reader.readFloat32();

	const termCount = reader.readVarUint();
	const termDict: BM25Index['termDict'] = {};
	const postings: BM25Index['postings'] = {};
	let prevTerm = '';
	for (let termId = 0; termId < termCount; termId++) {
		const df = reader.readVarUint();
		const prefixLength = reader.readVarUint();
		const suffix = reader.readString(reader.readVarUint());
		const term = decodeFrontCodedTerm(prevTerm, prefixLength, suffix);
		prevTerm = term;
		termDict[term] = { termId, df };

		const entries = [];
		let docId = 0;
		for (let j = 0; j < df; j++) {
			docId += reader.readVarUint();
			const tfNorm = dequantizeTfNormByte(reader.readUint8());
			const positionCount = reader.readVarUint();
			const positions: number[] = [];
			for (let k = 0; k < positionCount; k++) {
				positions.push(reader.readVarUint());
			}
			entries.push({ docId, tfNorm, positions });
		}
		postings[termId] = { entries };
	}

	const docLengths: BM25Index['docLengths'] = {};
	let docId = 0;
	for (let i = 0; i < docCount; i++) {
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

function readBm25V3(reader: BinaryReader): BM25Index {
	reader.skip(BM25_BINARY_MAGIC_V3.length);

	const docCount = reader.readVarUint();
	const avgDocLen = reader.readFloat32();

	const termCount = reader.readVarUint();
	const termDict: BM25Index['termDict'] = {};
	const postings: BM25Index['postings'] = {};
	let prevTerm = '';
	for (let termId = 0; termId < termCount; termId++) {
		const df = reader.readVarUint();
		const prefixLength = reader.readVarUint();
		const suffix = reader.readString(reader.readVarUint());
		const term = decodeFrontCodedTerm(prevTerm, prefixLength, suffix);
		prevTerm = term;
		termDict[term] = { termId, df };

		const entries = [];
		let docId = 0;
		for (let j = 0; j < df; j++) {
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

	const docLengths: BM25Index['docLengths'] = {};
	let docId = 0;
	for (let i = 0; i < docCount; i++) {
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

function readBm25V2(reader: BinaryReader): BM25Index {
	reader.skip(BM25_BINARY_MAGIC_V2.length);

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

function analyzeBm25BlobV3(reader: BinaryReader, totalBytes: number): Bm25BlobBreakdown {
	const termById = new Map<number, string>();
	const positionHeavyTerms: Bm25BlobBreakdown['topPositionHeavyTerms'] = [];

	reader.skip(BM25_BINARY_MAGIC_V3.length);
	const docCountStart = reader.position;
	const docCount = reader.readVarUint();
	reader.readFloat32();

	let headerBytes = reader.position - docCountStart + BM25_BINARY_MAGIC_V3.length;
	let termTextBytes = 0;
	let termMetaBytes = 0;
	let postingHeaderBytes = 0;
	let postingDocDeltaBytes = 0;
	let postingTfNormBytes = 0;
	let postingPositionCountBytes = 0;
	let postingPositionDeltaBytes = 0;
	let docLengthsBytes = 0;
	let postingCount = 0;
	let postingsWithPositions = 0;
	let termsWithPositions = 0;
	let positionValueCount = 0;

	const termCountStart = reader.position;
	const termCount = reader.readVarUint();
	headerBytes += reader.position - termCountStart;
	let prevTerm = '';
	for (let termId = 0; termId < termCount; termId++) {
		const metaStart = reader.position;
		const entryCount = reader.readVarUint();
		const prefixLength = reader.readVarUint();
		const termByteLength = reader.readVarUint();
		termMetaBytes += reader.position - metaStart;
		termTextBytes += termByteLength;
		const suffix = reader.readString(termByteLength);
		const term = decodeFrontCodedTerm(prevTerm, prefixLength, suffix);
		prevTerm = term;
		termById.set(termId, term);

		let listHasPositions = false;
		let listPositionBytes = 0;
		let listPositionCount = 0;
		for (let j = 0; j < entryCount; j++) {
			postingCount++;

			const docDeltaStart = reader.position;
			reader.readVarUint();
			postingDocDeltaBytes += reader.position - docDeltaStart;

			reader.readUint16();
			postingTfNormBytes += 2;

			const positionCountStart = reader.position;
			const positionCount = reader.readVarUint();
			postingPositionCountBytes += reader.position - positionCountStart;

			if (positionCount > 0) {
				postingsWithPositions++;
				listHasPositions = true;
			}
			listPositionCount += positionCount;
			positionValueCount += positionCount;
			for (let k = 0; k < positionCount; k++) {
				const deltaStart = reader.position;
				reader.readVarUint();
				const deltaBytes = reader.position - deltaStart;
				postingPositionDeltaBytes += deltaBytes;
				listPositionBytes += deltaBytes;
			}
		}

		if (listHasPositions) {
			termsWithPositions++;
		}

		positionHeavyTerms.push({
			term: termById.get(termId) ?? String(termId),
			df: entryCount,
			positionBytes: listPositionBytes,
			positionCount: listPositionCount,
		});
	}

	for (let i = 0; i < docCount; i++) {
		const entryStart = reader.position;
		reader.readVarUint();
		reader.readVarUint();
		docLengthsBytes += reader.position - entryStart;
	}

	return {
		version: 3,
		totalBytes,
		headerBytes,
		termTextBytes,
		termMetaBytes,
		postingHeaderBytes,
		postingDocDeltaBytes,
		postingTfNormBytes,
		postingPositionCountBytes,
		postingPositionDeltaBytes,
		docLengthsBytes,
		termCount,
		postingCount,
		postingsWithPositions,
		termsWithPositions,
		positionValueCount,
		topPositionHeavyTerms: positionHeavyTerms
			.sort((a, b) => b.positionBytes - a.positionBytes)
			.slice(0, 10),
	};
}

function analyzeBm25BlobV4(reader: BinaryReader, totalBytes: number): Bm25BlobBreakdown {
	const termById = new Map<number, string>();
	const positionHeavyTerms: Bm25BlobBreakdown['topPositionHeavyTerms'] = [];

	reader.skip(BM25_BINARY_MAGIC_V4.length);
	const docCountStart = reader.position;
	const docCount = reader.readVarUint();
	reader.readFloat32();

	let headerBytes = reader.position - docCountStart + BM25_BINARY_MAGIC_V4.length;
	let termTextBytes = 0;
	let termMetaBytes = 0;
	let postingHeaderBytes = 0;
	let postingDocDeltaBytes = 0;
	let postingTfNormBytes = 0;
	let postingPositionCountBytes = 0;
	let postingPositionDeltaBytes = 0;
	let docLengthsBytes = 0;
	let postingCount = 0;
	let postingsWithPositions = 0;
	let termsWithPositions = 0;
	let positionValueCount = 0;

	const termCountStart = reader.position;
	const termCount = reader.readVarUint();
	headerBytes += reader.position - termCountStart;
	let prevTerm = '';
	for (let termId = 0; termId < termCount; termId++) {
		const metaStart = reader.position;
		const entryCount = reader.readVarUint();
		const prefixLength = reader.readVarUint();
		const termByteLength = reader.readVarUint();
		termMetaBytes += reader.position - metaStart;
		termTextBytes += termByteLength;
		const suffix = reader.readString(termByteLength);
		const term = decodeFrontCodedTerm(prevTerm, prefixLength, suffix);
		prevTerm = term;
		termById.set(termId, term);

		let listHasPositions = false;
		let listPositionBytes = 0;
		let listPositionCount = 0;
		for (let j = 0; j < entryCount; j++) {
			postingCount++;

			const docDeltaStart = reader.position;
			reader.readVarUint();
			postingDocDeltaBytes += reader.position - docDeltaStart;

			reader.readUint8();
			postingTfNormBytes += 1;

			const positionCountStart = reader.position;
			const positionCount = reader.readVarUint();
			postingPositionCountBytes += reader.position - positionCountStart;

			if (positionCount > 0) {
				postingsWithPositions++;
				listHasPositions = true;
			}
			listPositionCount += positionCount;
			positionValueCount += positionCount;
			for (let k = 0; k < positionCount; k++) {
				const deltaStart = reader.position;
				reader.readVarUint();
				const deltaBytes = reader.position - deltaStart;
				postingPositionDeltaBytes += deltaBytes;
				listPositionBytes += deltaBytes;
			}
		}

		if (listHasPositions) {
			termsWithPositions++;
		}

		positionHeavyTerms.push({
			term: termById.get(termId) ?? String(termId),
			df: entryCount,
			positionBytes: listPositionBytes,
			positionCount: listPositionCount,
		});
	}

	for (let i = 0; i < docCount; i++) {
		const entryStart = reader.position;
		reader.readVarUint();
		reader.readVarUint();
		docLengthsBytes += reader.position - entryStart;
	}

	return {
		version: 4,
		totalBytes,
		headerBytes,
		termTextBytes,
		termMetaBytes,
		postingHeaderBytes,
		postingDocDeltaBytes,
		postingTfNormBytes,
		postingPositionCountBytes,
		postingPositionDeltaBytes,
		docLengthsBytes,
		termCount,
		postingCount,
		postingsWithPositions,
		termsWithPositions,
		positionValueCount,
		topPositionHeavyTerms: positionHeavyTerms
			.sort((a, b) => b.positionBytes - a.positionBytes)
			.slice(0, 10),
	};
}

function analyzeBm25BlobV2(reader: BinaryReader, totalBytes: number): Bm25BlobBreakdown {
	reader.skip(BM25_BINARY_MAGIC_V2.length);
	const docCountStart = reader.position;
	reader.readVarUint();
	reader.readFloat32();

	let headerBytes = reader.position - docCountStart + BM25_BINARY_MAGIC_V2.length;
	let termTextBytes = 0;
	let termMetaBytes = 0;
	let postingHeaderBytes = 0;
	let postingDocDeltaBytes = 0;
	let postingTfNormBytes = 0;
	let postingPositionCountBytes = 0;
	let postingPositionDeltaBytes = 0;
	let docLengthsBytes = 0;
	let postingCount = 0;
	let postingsWithPositions = 0;
	let termsWithPositions = 0;
	let positionValueCount = 0;
	const termById = new Map<number, string>();
	const positionHeavyTerms: Bm25BlobBreakdown['topPositionHeavyTerms'] = [];

	const termCountStart = reader.position;
	const termCount = reader.readVarUint();
	headerBytes += reader.position - termCountStart;
	for (let i = 0; i < termCount; i++) {
		const metaStart = reader.position;
		const termId = reader.readVarUint();
		reader.readVarUint();
		const termByteLength = reader.readVarUint();
		termMetaBytes += reader.position - metaStart;
		termTextBytes += termByteLength;
		termById.set(termId, reader.readString(termByteLength));
	}

	const postingListCountStart = reader.position;
	const postingListCount = reader.readVarUint();
	headerBytes += reader.position - postingListCountStart;
	for (let i = 0; i < postingListCount; i++) {
		const listHeaderStart = reader.position;
		const termId = reader.readVarUint();
		const entryCount = reader.readVarUint();
		postingHeaderBytes += reader.position - listHeaderStart;

		let listHasPositions = false;
		let listPositionBytes = 0;
		let listPositionCount = 0;
		for (let j = 0; j < entryCount; j++) {
			postingCount++;

			const docDeltaStart = reader.position;
			reader.readVarUint();
			postingDocDeltaBytes += reader.position - docDeltaStart;

			reader.readUint16();
			postingTfNormBytes += 2;

			const positionCountStart = reader.position;
			const positionCount = reader.readVarUint();
			postingPositionCountBytes += reader.position - positionCountStart;

			if (positionCount > 0) {
				postingsWithPositions++;
				listHasPositions = true;
			}
			listPositionCount += positionCount;
			positionValueCount += positionCount;
			for (let k = 0; k < positionCount; k++) {
				const deltaStart = reader.position;
				reader.readVarUint();
				const deltaBytes = reader.position - deltaStart;
				postingPositionDeltaBytes += deltaBytes;
				listPositionBytes += deltaBytes;
			}
		}

		if (listHasPositions) {
			termsWithPositions++;
		}

		positionHeavyTerms.push({
			term: termById.get(termId) ?? String(termId),
			df: entryCount,
			positionBytes: listPositionBytes,
			positionCount: listPositionCount,
		});
	}

	const docLengthCountStart = reader.position;
	const docLengthCount = reader.readVarUint();
	headerBytes += reader.position - docLengthCountStart;
	for (let i = 0; i < docLengthCount; i++) {
		const entryStart = reader.position;
		reader.readVarUint();
		reader.readVarUint();
		docLengthsBytes += reader.position - entryStart;
	}

	return {
		version: 2,
		totalBytes,
		headerBytes,
		termTextBytes,
		termMetaBytes,
		postingHeaderBytes,
		postingDocDeltaBytes,
		postingTfNormBytes,
		postingPositionCountBytes,
		postingPositionDeltaBytes,
		docLengthsBytes,
		termCount,
		postingCount,
		postingsWithPositions,
		termsWithPositions,
		positionValueCount,
		topPositionHeavyTerms: positionHeavyTerms
			.sort((a, b) => b.positionBytes - a.positionBytes)
			.slice(0, 10),
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
		generation: shard.generation,
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
		generation: row.generation,
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
			generation: undefined,
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
		generation: undefined,
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

const BM25_BINARY_MAGIC_V2 = Uint8Array.from([0x43, 0x53, 0x42, 0x32]);
const BM25_BINARY_MAGIC_V3 = Uint8Array.from([0x43, 0x53, 0x42, 0x33]);
const BM25_BINARY_MAGIC_V4 = Uint8Array.from([0x43, 0x53, 0x42, 0x34]);
const BM25_TF_NORM_SCALE = 4096;
const BM25_TF_NORM_MAX = BM25_K1 + 1;
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

function quantizeTfNormByte(value: number): number {
	const clamped = Math.max(0, Math.min(BM25_TF_NORM_MAX, value));
	return Math.round((clamped / BM25_TF_NORM_MAX) * 255);
}

function dequantizeTfNormByte(value: number): number {
	return (value / 255) * BM25_TF_NORM_MAX;
}

function getBm25BinaryVersion(buf: ArrayBuffer): 2 | 3 | 4 | null {
	if (hasMagic(buf, BM25_BINARY_MAGIC_V4)) {
		return 4;
	}
	if (hasMagic(buf, BM25_BINARY_MAGIC_V3)) {
		return 3;
	}
	if (hasMagic(buf, BM25_BINARY_MAGIC_V2)) {
		return 2;
	}
	return null;
}

function hasMagic(buf: ArrayBuffer, magic: Uint8Array): boolean {
	if (buf.byteLength < magic.length) {
		return false;
	}
	const bytes = new Uint8Array(buf, 0, magic.length);
	for (let i = 0; i < magic.length; i++) {
		if (bytes[i] !== magic[i]) {
			return false;
		}
	}
	return true;
}

function compareTerms(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function encodeFrontCodedTerm(prevTerm: string, term: string): {
	prefixLength: number;
	suffixBytes: Uint8Array;
} {
	const prefixLength = sharedPrefixLength(prevTerm, term);
	return {
		prefixLength,
		suffixBytes: textEncoder.encode(term.slice(prefixLength)),
	};
}

function decodeFrontCodedTerm(prevTerm: string, prefixLength: number, suffix: string): string {
	return prevTerm.slice(0, prefixLength) + suffix;
}

function sharedPrefixLength(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	let index = 0;
	while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) {
		index++;
	}
	return index;
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

	get position(): number {
		return this.offset;
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
