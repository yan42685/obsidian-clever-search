import type {
	MatchedFile,
} from "src/globals/search-types";
import {
	buildCoverageLexicalV2QueryAnalysis,
} from "./query";
import {
	searchCoverageLexicalV2CandidateCascade,
	type CoverageLexicalV2CandidateCascadeMatchOptions,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "./candidate-cascade";

export type CoverageLexicalV2EngineSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	maxItemResults: number;
	fuzzyProportion: number;
	tokenizeQueryText(queryText: string): readonly string[];
	storageReader: CoverageLexicalV2CandidateCascadeStorageReader;
};

export type CoverageLexicalV2EngineSearchResult = {
	queryTerms: string[];
	matchedFiles: MatchedFile[];
};

export async function searchCoverageLexicalV2Engine(
	request: CoverageLexicalV2EngineSearchRequest,
): Promise<CoverageLexicalV2EngineSearchResult> {
	const queryTerms = request.tokenizeQueryText(request.queryText)
		.map((term) => term.trim().toLowerCase())
		.filter((term) => term.length > 0);
	if (queryTerms.length === 0) {
		return {
			queryTerms,
			matchedFiles: [],
		};
	}
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(
		request.queryText,
		queryTerms,
	);
	if (queryAnalysis.primaryUnits.length === 0) {
		return {
			queryTerms,
			matchedFiles: [],
		};
	}
	const primaryQueryTerms = [...new Set(
		queryAnalysis.primaryUnits
			.map((unit) => unit.normalizedText.trim())
			.filter((term) => term.length > 0),
	)];
	if (primaryQueryTerms.length === 0) {
		return {
			queryTerms,
			matchedFiles: [],
		};
	}
	const cascadeMatchOptions: CoverageLexicalV2CandidateCascadeMatchOptions = {
		includePrefix: request.isPrefixMatch,
		includeFuzzy: request.isFuzzy,
		fuzzyProportion: request.fuzzyProportion,
	};
	const cascade = await searchCoverageLexicalV2CandidateCascade({
		queryText: request.queryText,
		queryTerms,
		queryAnalysis,
		maxItemResults: request.maxItemResults,
		storageReader: request.storageReader,
		matchOptions: cascadeMatchOptions,
	});
	return {
		queryTerms,
		matchedFiles: cascade.matchedFiles.slice(0, request.maxItemResults),
	};
}
