import type { BaseIndexedFileRef } from "src/globals/search-types";

export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID = "active";
export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN =
	"coverage-lexical-v2-han-segment-exact-sidecar-store";

export type CoverageLexicalV2HanSegmentExactSidecarMetaRow = {
	id: typeof COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID;
	epoch: number;
	schemaVersion: number;
	blockWriteMode: "logical-block-v3";
	documentCount: number;
	logicalBlockCount: number;
	indexedRefsFingerprint: string;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow = {
	id: string;
	epoch: number;
	logicalBlockCount: number;
	symbolCount: number;
	segmentCount: number;
	symbolIdTape: Uint8Array;
	createdAt: number;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow = {
	id: string;
	path: string;
	epoch: number;
	generation?: number;
	storageBlockId: string;
	blockOrdinal: number;
	symbolStart: number;
	symbolLength: number;
	symbolCount: number;
	segmentCount: number;
	encodedByteLength: number;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarDocSummaryRow = {
	path: string;
	epoch: number;
	generation?: number;
	blockCount: number;
	symbolCount: number;
	segmentCount: number;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarLogicalBlockWrite = {
	blockOrdinal: number;
	bodyHanSymbolIds: readonly number[] | Uint32Array;
	bigramIds: readonly number[];
	encodedByteLength: number;
	symbolCount: number;
	segmentCount: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarDocumentWrite = {
	path: string;
	generation?: number;
	logicalBlocks: readonly CoverageLexicalV2HanSegmentExactSidecarLogicalBlockWrite[];
};

export type CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead = {
	path: string;
	generation?: number;
	blockOrdinal: number;
	bodyHanSymbolIds: Uint32Array;
	symbolCount: number;
	segmentCount: number;
	encodedByteLength: number;
};

export interface CoverageLexicalV2HanSegmentExactSidecarStoreApi {
	clearAll(): Promise<void>;
	deleteDocuments(paths: readonly string[]): Promise<void>;
	getMeta(): Promise<CoverageLexicalV2HanSegmentExactSidecarMetaRow | null>;
	summarizeConsistency(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<CoverageLexicalV2HanSegmentExactSidecarConsistencySummary>;
	moveDocument(
		oldPath: string,
		nextDocument: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
	): Promise<boolean>;
	readLogicalBlocks(
		requests: readonly {
			path: string;
			blockOrdinal: number;
		}[],
	): Promise<Map<string, CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead>>;
	updateIndexedRefsMetadata(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<void>;
	upsertDocuments(
		documents: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
	): Promise<void>;
}

export type CoverageLexicalV2HanSegmentExactSidecarConsistencySummary = {
	needsRepair: boolean;
	requiresReset: boolean;
	reason:
		| "up-to-date"
		| "missing-meta"
		| "schema-mismatch"
		| "count-mismatch"
		| "fingerprint-mismatch";
	missingOrStalePaths: string[];
	danglingPaths: string[];
};
