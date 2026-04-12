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

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason =
	| "none"
	| "doc_budget"
	| "byte_budget"
	| "time_budget";

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget = {
	docBudget: number;
	byteBudget: number;
	timeBudgetMs: number;
};

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus =
	| "cold_store_unavailable"
	| "cache_hit"
	| "fetched"
	| "missing_metadata"
	| "missing_path"
	| "zero_segment_count"
	| "doc_budget"
	| "byte_budget"
	| "time_budget"
	| "sidecar_meta_missing"
	| "sidecar_schema_mismatch"
	| "sidecar_doc_row_missing"
	| "sidecar_indexed_ref_missing"
	| "sidecar_epoch_mismatch"
	| "sidecar_generation_mismatch"
	| "sidecar_block_missing"
	| "read_miss";

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult = {
	docId: number;
	path: string | null;
	status: CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus;
	estimatedBytes: number | null;
	segmentCount: number | null;
};

export type CoverageLexicalV2CandidateCascadeHanExactPrefetchResult = {
	fetchedDocIds: readonly number[];
	fetchedDocCount: number;
	byteSum: number;
	skippedByBudget: number;
	skippedReason: CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason;
	docResults?: readonly CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult[];
};

export type CoverageLexicalV2CandidateCascadeStorageReader = {
	readerKind: "legacy_adapter" | "v2_runtime";
	getDocumentRecord(docId: number): CoverageLexicalV2CandidateCascadeDocumentRecord | null;
	getBodyHanSegmentDocIds(): readonly number[];
	getPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		term: string,
	): readonly number[] | Uint32Array | undefined;
	getMetadataHanBigramPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		bigram: string,
	): readonly number[] | Uint32Array | undefined;
	getBodyHanBackstopGateStats(
		docId: number,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanBackstopStats | null;
	prefetchBodyHanExact(
		docIds: readonly number[],
		budget: CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget,
	): Promise<CoverageLexicalV2CandidateCascadeHanExactPrefetchResult>;
	getBodyHanExactBackstopStats(
		docId: number,
		normalizedText: string,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanBackstopStats | null;
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
