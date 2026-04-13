import type {
	MatchedFile,
} from "src/globals/search-types";
import type {
	FileSearchRequest,
} from "../file-search-engine";
import {
	searchCoverageLexicalV2Engine,
	type CoverageLexicalV2EngineSearchResult,
} from "../coverage-lexical-v2/coverage-lexical-v2-engine";
import type {
	CoverageLexicalV2CandidateCascadeDocumentRecord,
	CoverageLexicalV2CandidateCascadeHanBackstopStats,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchResult,
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2CandidateCascadeStorageReader,
} from "../coverage-lexical-v2/candidate-cascade";

export type CoverageLexicalV2StorageAdapterBindings = {
	getDocumentRecord(
		docId: number,
	): CoverageLexicalV2CandidateCascadeDocumentRecord | null;
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

export type CoverageLexicalV2StorageAdapterSearchOptions = {
	request: FileSearchRequest;
	fuzzyProportion: number;
	tokenizeQueryText(queryText: string): readonly string[];
	storageBindings: CoverageLexicalV2StorageAdapterBindings;
};

export function buildCoverageLexicalV2StorageReader(
	bindings: CoverageLexicalV2StorageAdapterBindings,
): CoverageLexicalV2CandidateCascadeStorageReader {
	return {
		readerKind: "legacy_adapter",
		getDocumentRecord: (docId: number) => bindings.getDocumentRecord(docId),
		getPostingMatches: (field: CoverageLexicalV2CandidateCascadePostingField, term: string) =>
			bindings.getPostingMatches(field, term),
		getMetadataHanBigramPostingMatches: (
			field: CoverageLexicalV2CandidateCascadePostingField,
			bigram: string,
		) => bindings.getMetadataHanBigramPostingMatches(field, bigram),
		getBodyHanBlockPostingMatches: (bigram: string) =>
			bindings
				.getBodyHanSegmentDocIds()
				.filter((docId) => bindings.getBodyHanBackstopGateStats(docId, [bigram]) != null),
		getBodyHanLogicalBlockDescriptor: (blockId: number) => {
			const record = bindings.getDocumentRecord(blockId);
			if (!record) {
				return null;
			}
			return {
				blockId,
				docId: blockId,
				path: record.path,
				blockOrdinal: 0,
				segmentCount: 1,
				symbolCount: 0,
				encodedByteLength: 0,
			};
		},
		prefetchBodyHanExactBlocks: (
			blockIds: readonly number[],
			budget: CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget,
		) =>
			bindings
				.prefetchBodyHanExact(blockIds, {
					blockBudget: budget.blockBudget,
					byteBudget: budget.byteBudget,
					timeBudgetMs: budget.timeBudgetMs,
				})
				.then((prefetch) => {
					const legacyPrefetch = prefetch as {
						fetchedDocIds?: readonly number[];
						fetchedDocCount?: number;
						docResults?: Array<{
							docId: number;
							path: string | null;
							status: string;
							estimatedBytes: number | null;
							segmentCount: number | null;
						}>;
					};
					const sourceBlockResults = (prefetch.blockResults ??
						legacyPrefetch.docResults ??
						[]) as Array<
						| {
								blockId: number;
								docId: number | null;
								path: string | null;
								blockOrdinal: number | null;
								status: string;
								estimatedBytes: number | null;
								segmentCount: number | null;
								symbolCount: number | null;
						  }
						| {
								docId: number;
								path: string | null;
								status: string;
								estimatedBytes: number | null;
								segmentCount: number | null;
						  }
					>;
					return ({
					fetchedBlockIds:
						prefetch.fetchedBlockIds ?? legacyPrefetch.fetchedDocIds ?? [],
					fetchedBlockCount:
						prefetch.fetchedBlockCount ?? legacyPrefetch.fetchedDocCount ?? 0,
					byteSum: prefetch.byteSum,
					skippedByBudget: prefetch.skippedByBudget,
					skippedReason: prefetch.skippedReason,
					blockResults: sourceBlockResults.map((docResult) => ({
						blockId: "blockId" in docResult ? docResult.blockId : docResult.docId,
						docId: docResult.docId,
						path: docResult.path,
						blockOrdinal:
							"blockOrdinal" in docResult ? (docResult.blockOrdinal ?? 0) : 0,
						status:
							docResult.status === "doc_budget"
								? "block_budget"
								: docResult.status === "zero_segment_count"
									? "zero_symbol_count"
									: docResult.status === "sidecar_doc_row_missing"
										? "sidecar_doc_summary_missing"
										: docResult.status === "sidecar_block_missing"
											? "sidecar_storage_block_missing"
											: (docResult.status as any),
						estimatedBytes: docResult.estimatedBytes,
						segmentCount: docResult.segmentCount,
						symbolCount:
							"symbolCount" in docResult ? docResult.symbolCount : null,
					})),
				});
				}),
		getBodyHanExactBlockBackstopStats: (
			blockId: number,
			normalizedText: string,
			bigrams: readonly string[],
		) => bindings.getBodyHanExactBackstopStats(blockId, normalizedText, bigrams),
		collectLatinPrefixTerms: (queryTerm: string, cap: number) =>
			bindings.collectLatinPrefixTerms(queryTerm, cap),
		collectLatinFuzzyTerms: (
			queryTerm: string,
			cap: number,
			fuzzyProportion: number,
		) => bindings.collectLatinFuzzyTerms(queryTerm, cap, fuzzyProportion),
		getBodyTokenSequence: (docId: number) => bindings.getBodyTokenSequence(docId),
		prefetchBodyTokenSequences: (docIds: readonly number[]) =>
			bindings.prefetchBodyTokenSequences(docIds),
		tokenizeText: (text: string) => bindings.tokenizeText(text),
	};
}

export async function searchCoverageLexicalV2WithStorageAdapter(
	options: CoverageLexicalV2StorageAdapterSearchOptions,
): Promise<CoverageLexicalV2EngineSearchResult> {
	return await searchCoverageLexicalV2Engine({
		queryText: options.request.queryText,
		isPrefixMatch: options.request.isPrefixMatch,
		isFuzzy: options.request.isFuzzy,
		maxItemResults: options.request.maxItemResults,
		fuzzyProportion: options.fuzzyProportion,
		tokenizeQueryText: options.tokenizeQueryText,
		storageReader: buildCoverageLexicalV2StorageReader(
			options.storageBindings,
		),
	});
}
