import type { BaseIndexedFileRef } from "src/globals/search-types";

export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID = "active";
export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN =
	"coverage-lexical-v2-han-segment-exact-sidecar-store";

export type CoverageLexicalV2HanSegmentExactSidecarMetaRow = {
	id: typeof COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID;
	epoch: number;
	schemaVersion: number;
	blockWriteMode: "multi-doc-v2";
	documentCount: number;
	indexedRefsFingerprint: string;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarBlockRow = {
	id: string;
	epoch: number;
	documentCount: number;
	symbolCount: number;
	segmentCount: number;
	symbolIdTape: Uint8Array;
	createdAt: number;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarDocRow = {
	path: string;
	epoch: number;
	generation?: number;
	blockId: string;
	blockDocIndex: number;
	symbolStart: number;
	symbolLength: number;
	symbolCount: number;
	segmentCount: number;
	updatedAt: number;
};

export type CoverageLexicalV2HanSegmentExactSidecarDocumentWrite = {
	path: string;
	generation?: number;
	bodyHanSymbolIds: readonly number[] | Uint32Array;
	segmentCount: number;
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
	readDocuments(
		paths: readonly string[],
	): Promise<Map<string, CoverageLexicalV2HanSegmentExactSidecarDocumentWrite>>;
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
