import type {
	MatchedFile,
} from "src/globals/search-types";
import type {
	FileSearchRequest,
} from "../file-search-engine";
import {
	searchCoverageLexicalV2Engine,
	type CoverageLexicalV2EngineSearchResult,
	type CoverageLexicalV2CandidateCascadeDocumentRecord,
	type CoverageLexicalV2CandidateCascadeMetadataVerificationTexts,
	type CoverageLexicalV2CandidateCascadePostingField,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "../coverage-lexical-v2";

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
	getBodyHanSegments(docId: number): readonly string[] | undefined;
	getMetadataVerificationTexts(
		docId: number,
	): CoverageLexicalV2CandidateCascadeMetadataVerificationTexts | null;
	getSortedLexicon(): readonly string[];
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
		getDocumentRecord: (docId: number) => bindings.getDocumentRecord(docId),
		getBodyHanSegmentDocIds: () => bindings.getBodyHanSegmentDocIds(),
		getPostingMatches: (field: CoverageLexicalV2CandidateCascadePostingField, term: string) =>
			bindings.getPostingMatches(field, term),
		getMetadataHanBigramPostingMatches: (
			field: CoverageLexicalV2CandidateCascadePostingField,
			bigram: string,
		) => bindings.getMetadataHanBigramPostingMatches(field, bigram),
		getBodyHanSegments: (docId: number) => bindings.getBodyHanSegments(docId),
		getMetadataVerificationTexts: (docId: number) =>
			bindings.getMetadataVerificationTexts(docId),
		getSortedLexicon: () => bindings.getSortedLexicon(),
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
