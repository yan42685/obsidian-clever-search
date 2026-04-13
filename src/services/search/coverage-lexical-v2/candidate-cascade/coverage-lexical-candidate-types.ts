export type CoverageLexicalV2CandidateCascadePostingField =
	| "basename"
	| "aliases"
	| "headings"
	| "folder"
	| "tag"
	| "body";

export type CoverageLexicalV2CandidateCascadeDocumentRecord = {
	path: string;
	stableDeterministicKey?: string;
	basenameText: string;
	aliasesText: string;
	headingsText: string;
	folderText: string;
	tagsText: string;
};

export type CoverageLexicalV2CandidateCascadeHanBackstopStats = {
	longestContiguousBigramChain: number;
	matchedBigramCount: number;
	bigramCoverageRatio: number;
};

export type CoverageLexicalV2CandidateCascadeHanExactWitness = {
	start: number;
	end: number;
};

export type CoverageLexicalV2CandidateCascadeHanLogicalBlockDescriptor = {
	blockId: number;
	docId: number;
	path: string;
	generation?: number;
	blockOrdinal: number;
	segmentCount: number;
	symbolCount: number;
	encodedByteLength: number;
};

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason =
	| "none"
	| "block_budget"
	| "byte_budget"
	| "time_budget";

export type CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchBudget = {
	blockBudget: number;
	byteBudget: number;
	timeBudgetMs: number;
};
export type CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget =
	CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchBudget;

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockStatus =
	| "cold_store_unavailable"
	| "cache_hit"
	| "fetched"
	| "missing_metadata"
	| "missing_path"
	| "missing_block_descriptor"
	| "zero_symbol_count"
	| "block_budget"
	| "byte_budget"
	| "time_budget"
	| "sidecar_meta_missing"
	| "sidecar_schema_mismatch"
	| "sidecar_logical_block_missing"
	| "sidecar_doc_summary_missing"
	| "sidecar_epoch_mismatch"
	| "sidecar_generation_mismatch"
	| "sidecar_storage_block_missing"
	| "read_miss";

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockResult = {
	blockId: number;
	docId: number | null;
	path: string | null;
	blockOrdinal: number | null;
	status: CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockStatus;
	estimatedBytes: number | null;
	segmentCount: number | null;
	symbolCount: number | null;
};
export type CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult =
	CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockResult;

export type CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchResult = {
	fetchedBlockIds?: readonly number[];
	fetchedBlockCount?: number;
	fetchedDocIds?: readonly number[];
	fetchedDocCount?: number;
	byteSum: number;
	skippedByBudget: number;
	skippedReason: CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason;
	blockResults?: readonly CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockResult[];
	docResults?: readonly CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockResult[];
};
export type CoverageLexicalV2CandidateCascadeHanExactPrefetchResult =
	CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchResult;
export type CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus =
	CoverageLexicalV2CandidateCascadeHanExactPrefetchBlockStatus;

export type CoverageLexicalV2CandidateCascadeStorageReader = {
	readerKind: "legacy_adapter" | "v2_runtime";
	getDocumentRecord(docId: number): CoverageLexicalV2CandidateCascadeDocumentRecord | null;
	getPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		term: string,
	): readonly number[] | Uint32Array | undefined;
	getMetadataHanBigramPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		bigram: string,
	): readonly number[] | Uint32Array | undefined;
	getBodyHanBlockPostingMatches(
		bigram: string,
	): readonly number[] | Uint32Array | undefined;
	getBodyHanLogicalBlockDescriptor(
		blockId: number,
	): CoverageLexicalV2CandidateCascadeHanLogicalBlockDescriptor | null;
	getBodyHanLogicalBlockIds(docId: number): readonly number[] | undefined;
	prefetchBodyHanExactBlocks(
		blockIds: readonly number[],
		budget: CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchBudget,
	): Promise<CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchResult>;
	getBodyHanExactBlockBackstopStats(
		blockId: number,
		normalizedText: string,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanBackstopStats | null;
	getBodyHanExactBlockWitness?(
		blockId: number,
		normalizedText: string,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanExactWitness | null;
	getBodyHanExactDocumentWitness(
		docId: number,
		normalizedText: string,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanExactWitness | null;
	collectLatinPrefixTerms(queryTerm: string, cap: number): readonly string[];
	collectLatinFuzzyTerms(
		queryTerm: string,
		cap: number,
		fuzzyProportion: number,
	): readonly string[];
	getBodyTokenSequence(docId: number): readonly string[] | undefined;
	prefetchBodyTokenSequences(docIds: readonly number[]): Promise<void>;
	tokenizeText(text: string): readonly string[];
};
