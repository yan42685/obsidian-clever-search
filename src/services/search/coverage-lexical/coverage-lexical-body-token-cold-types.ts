export const COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID = "active";
export const COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN =
	"coverage-lexical-body-token-cold-store";

export type CoverageLexicalBodyTokenColdMetaRow = {
	id: typeof COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID;
	epoch: number;
	schemaVersion: number;
	blockWriteMode: "single-doc";
	updatedAt: number;
};

export type CoverageLexicalBodyTokenColdBlockRow = {
	id: string;
	epoch: number;
	documentCount: number;
	tokenCount: number;
	dictionaryTerms: string[];
	tokenIds: Uint32Array;
	createdAt: number;
	updatedAt: number;
};

export type CoverageLexicalBodyTokenColdDocRow = {
	path: string;
	epoch: number;
	generation?: number;
	blockId: string;
	blockDocIndex: number;
	tokenStart: number;
	tokenLength: number;
	tokenCount: number;
	hanSegments: string[];
	updatedAt: number;
};

export type CoverageLexicalBodyTokenColdDocumentWrite = {
	path: string;
	generation?: number;
	bodyTokens: readonly string[];
	hanSegments: readonly string[];
};

export interface CoverageLexicalBodyTokenColdStoreApi {
	clearAll(): Promise<void>;
	deleteDocuments(paths: readonly string[]): Promise<void>;
	upsertDocuments(
		documents: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
	): Promise<void>;
}
