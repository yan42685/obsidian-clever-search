export type VectorPrecision = 'int8' | 'float16';

export type RawChunk = {
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
};

export type Chunk = {
	id: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	vector: Int8Array;
	scale: number;
	vectorF16?: Uint16Array;
};

export type BM25PostingEntry = {
	docId: number;
	tfNorm: number;
	positions: number[];
};

export type PostingList = {
	entries: BM25PostingEntry[];
};

export type BM25Index = {
	termDict: Record<string, { termId: number; df: number }>;
	postings: Record<number, PostingList>;
	docCount: number;
	avgDocLen: number;
	docLengths: Record<number, number>;
};

export type HnswNode = {
	id: number;
	level: number;
	neighbors: number[][];
};

export type HnswGraph = {
	entryPoint: number | null;
	maxLevel: number;
	nodes: Map<number, HnswNode>;
	vectors: Map<number, Int8Array>;
	scales: Map<number, number>;
	vectorsF16?: Map<number, Uint16Array>;
	deletedSet: Set<number>;
};

export type HnswGraphData = {
	entryPoint: number | null;
	maxLevel: number;
	nodes: [number, HnswNode][];
	vectors?: [number, number[]][];
	scales?: [number, number][];
	vectorsF16?: [number, number[]][];
	deletedSet: number[];
};

export const EMBED_DIM = 512;
export const SMALL_CHUNK_TARGET = 300;
export const CHUNK_MAX_OVERFLOW_RATIO = 0.15;
export const CHUNK_OVERLAP_MIN_RATIO = 0.14;
export const CHUNK_OVERLAP_TARGET_RATIO = 0.16;
export const CHUNK_OVERLAP_MAX_RATIO = 0.18;
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;
export const HNSW_M = 16;
export const HNSW_EF_CONSTRUCTION = 100;
export const HNSW_EF = 40;
