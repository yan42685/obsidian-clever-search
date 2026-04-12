import type { BaseIndexedFileRef } from "src/globals/search-types";

export const COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_META_ID = "active";
export const COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_STORE_TOKEN =
	"coverage-lexical-v2-body-token-cold-store";

export type CoverageLexicalV2BodyTokenColdMetaRow = {
	id: typeof COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_META_ID;
	epoch: number;
	schemaVersion: number;
	blockWriteMode: "multi-doc-v2";
	documentCount: number;
	indexedRefsFingerprint: string;
	updatedAt: number;
};

export type CoverageLexicalV2BodyTokenColdBlockRow = {
	id: string;
	epoch: number;
	documentCount: number;
	tokenCount: number;
	termIdTape: Uint32Array;
	createdAt: number;
	updatedAt: number;
};

export type CoverageLexicalV2BodyTokenColdDocRow = {
	path: string;
	epoch: number;
	generation?: number;
	blockId: string;
	blockDocIndex: number;
	tokenStart: number;
	tokenLength: number;
	tokenCount: number;
	updatedAt: number;
};

export type CoverageLexicalV2BodyTokenColdDocumentWrite = {
	path: string;
	generation?: number;
	bodyTokenIds: readonly number[] | Uint32Array;
};

export interface CoverageLexicalV2BodyTokenColdStoreApi {
	clearAll(): Promise<void>;
	deleteDocuments(paths: readonly string[]): Promise<void>;
	getMeta(): Promise<CoverageLexicalV2BodyTokenColdMetaRow | null>;
	inspectConsistency(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<CoverageLexicalV2BodyTokenColdConsistencySummary>;
	readDocuments(
		paths: readonly string[],
	): Promise<Map<string, CoverageLexicalV2BodyTokenColdDocumentWrite>>;
	updateIndexedRefsMetadata(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<void>;
	upsertDocuments(
		documents: readonly CoverageLexicalV2BodyTokenColdDocumentWrite[],
	): Promise<void>;
}

export type CoverageLexicalV2BodyTokenColdConsistencySummary = {
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
