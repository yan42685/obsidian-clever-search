import type {
	MatchedFile,
} from "src/globals/search-types";
import type {
	FileSearchRequest,
} from "../file-search-engine";
import {
	searchCoverageLexicalV2Engine,
	type CoverageLexicalV2CandidateCascadeDocumentRecord,
	type CoverageLexicalV2CandidateCascadePostingField,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "../coverage-lexical-v2";

export type CoverageLexicalV2StorageAdapterBindings = {
	getDocumentRecord(
		docId: number,
	): CoverageLexicalV2CandidateCascadeDocumentRecord | null;
	getPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		term: string,
	): readonly number[] | Uint32Array | undefined;
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
		getPostingMatches: (field: CoverageLexicalV2CandidateCascadePostingField, term: string) =>
			bindings.getPostingMatches(field, term),
		getSortedLexicon: () => bindings.getSortedLexicon(),
		getBodyTokenSequence: (docId: number) => bindings.getBodyTokenSequence(docId),
		prefetchBodyTokenSequences: (docIds: readonly number[]) =>
			bindings.prefetchBodyTokenSequences(docIds),
		tokenizeText: (text: string) => bindings.tokenizeText(text),
	};
}

export async function searchCoverageLexicalV2WithStorageAdapter(
	options: CoverageLexicalV2StorageAdapterSearchOptions,
): Promise<MatchedFile[]> {
	const result = await searchCoverageLexicalV2Engine({
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
	return result.matchedFiles.slice(0, options.request.maxItemResults);
}
