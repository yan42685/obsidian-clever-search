import type { DocRef } from "src/globals/search-types";

export type VectorPrecision = 'int8' | 'float16';

export type RawChunk = {
	filePath: string;
	text: string;
	startOffset: number;
	endOffset: number;
	startLine: number;
	startCol: number;
	endLine: number;
};

export type HeadingOutlineEntry = {
	line: number;
	level: number;
	title: string;
};

export type Chunk = {
	id: number;
	docRef: DocRef;
	generation: number;
	filePath: string;
	chunkIndex: number;
	text: string;
	startOffset: number;
	endOffset: number;
	startLine: number;
	startCol: number;
	endLine: number;
	embedKey: string;
};

export type Int8Vector = {
	precision: 'int8';
	vector: Int8Array;
	scale: number;
};

export type Float16Vector = {
	precision: 'float16';
	vector: Uint16Array;
};

export type StoredVector = Int8Vector | Float16Vector;

export type ChunkVectorShard = {
	docRef: DocRef;
	precision: VectorPrecision;
	dim: number;
	chunkCount: number;
	generation: number;
	chunkIds: Uint32Array;
	vectorData: Int8Array | Uint16Array;
	scaleData?: Float32Array;
};

export type BM25PostingEntry = {
	docId: number;
	tfNorm: number;
	positions?: number[];
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
	precision: VectorPrecision;
	nodes: Map<number, HnswNode>;
	deletedSet: Set<number>;
};

export type HnswGraphData = {
	entryPoint: number | null;
	maxLevel: number;
	precision: VectorPrecision;
	nodes: [number, HnswNode][];
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
export const HNSW_EF_CONSTRUCTION = 120;
export const HNSW_EF = 64;
