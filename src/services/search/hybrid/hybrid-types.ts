// ─── Quantization ────────────────────────────────────────────────────────────

export type VectorPrecision = 'int8' | 'float16';

// ─── Raw types (pre-DB, used during indexing) ────────────────────────────────

/** Output of chunker — not yet persisted */
export type RawBigChunk = {
	filePath: string;
	text: string;       // original text slice from the file
	startLine: number;
	startCol: number;
	endLine: number;
};

/** Output of chunker — not yet persisted */
export type RawChunk = {
	bigChunkIdx: number; // index into RawBigChunk[], replaced by real id after DB insert
	text: string;
	startOffset: number;
	endOffset: number;
};

// ─── Persisted types ─────────────────────────────────────────────────────────

/**
 * Small chunk — sliding window over a BigChunk.
 * Stores int8 vector + scale; no original text (saves space).
 */
export type Chunk = {
	id: number;
	bigChunkId: number;
	filePath: string;
	startOffset: number;
	endOffset: number;
	vector: Int8Array;   // int8 quantized, length = EMBED_DIM
	scale: number;       // max(|float32[i]|), used for dequantization
	// float16 rescoring branch
	vectorF16?: Uint16Array; // IEEE 754 half-precision, same length
};

/**
 * Big chunk — section-level.
 * Stores original text (for context output) + int8 vector (dual-layer).
 */
export type BigChunk = {
	id: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	chunkIds: number[];  // child small-chunk ids
	vector: Int8Array;
	scale: number;
	vectorF16?: Uint16Array;
};

// ─── BM25 ─────────────────────────────────────────────────────────────────────

/**
 * One entry in a BM25 posting list.
 * positions are delta-encoded uint16 (position[i] = Σ delta[0..i]).
 */
export type BM25PostingEntry = {
	docId: number;      // bigChunkId (uint32 range)
	tfNorm: number;     // pre-computed tf*(k1+1)/(tf+k1*(1-b+b*dl/avgdl))
	positions: number[]; // delta-encoded token positions (uint16)
};

export type PostingList = {
	entries: BM25PostingEntry[]; // sorted by docId
};

export type BM25Index = {
	termDict: Record<string, { termId: number; df: number }>;
	postings: Record<number, PostingList>; // termId → PostingList
	docCount: number;
	avgBigChunkLen: number;
	docLengths: Record<number, number>; // bigChunkId → token count
};

// ─── HNSW ─────────────────────────────────────────────────────────────────────

export type HnswNode = {
	id: number;
	level: number;
	neighbors: number[][]; // neighbors[layer] = neighbor ids
};

export type HnswGraph = {
	entryPoint: number | null;
	maxLevel: number;
	nodes: Map<number, HnswNode>;
	vectors: Map<number, Int8Array>;
	scales: Map<number, number>;
	// float16 rescoring branch
	vectorsF16?: Map<number, Uint16Array>;
	deletedSet: Set<number>;
};

// Serializable form for persistence
export type HnswGraphData = {
	entryPoint: number | null;
	maxLevel: number;
	nodes: [number, HnswNode][];
	vectors: [number, number[]][];   // Int8Array → plain array for JSON
	scales: [number, number][];
	vectorsF16?: [number, number[]][]; // Uint16Array → plain array
	deletedSet: number[];
};

// ─── Search results ───────────────────────────────────────────────────────────

export type BigChunkMatch = {
	bigChunkId: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	score: number;
};

export type HybridSearchResult = {
	filePath: string;
	matchedBigChunks: BigChunkMatch[];
	totalScore: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const EMBED_DIM = 512;
export const BIG_CHUNK_TARGET = 1000;
export const BIG_CHUNK_MAX = BIG_CHUNK_TARGET * 1.15;
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
