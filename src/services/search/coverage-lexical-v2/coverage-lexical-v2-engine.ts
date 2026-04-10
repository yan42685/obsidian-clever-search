import type {
	MatchedFile,
} from "src/globals/search-types";
import {
	buildCoverageLexicalV2QueryAnalysis,
} from "./query-units";
import {
	buildCoverageLexicalV2RuntimeDocumentLexicalStates,
	buildCoverageLexicalV2RuntimeSourceEntries,
	projectCoverageLexicalV2RuntimeMatchedFiles,
	type CoverageLexicalV2RuntimeMatchOptions,
	type CoverageLexicalV2RuntimeStorageReader,
} from "./runtime";

export type CoverageLexicalV2EngineSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	maxItemResults: number;
	fuzzyProportion: number;
	tokenizeQueryText(queryText: string): readonly string[];
	storageReader: CoverageLexicalV2RuntimeStorageReader;
};

export type CoverageLexicalV2EngineSearchResult = {
	queryTerms: string[];
	matchedFiles: MatchedFile[];
};

const COVERAGE_LEXICAL_V2_ENGINE_MIN_EXPENSIVE_CANDIDATES = 4;
const COVERAGE_LEXICAL_V2_ENGINE_MAX_EXPENSIVE_CANDIDATES = 12;

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
	const runtimeMatchOptions: CoverageLexicalV2RuntimeMatchOptions = {
		includePrefix: request.isPrefixMatch,
		includeFuzzy: request.isFuzzy,
		fuzzyProportion: request.fuzzyProportion,
	};
	const runtimeDocuments = await buildCoverageLexicalV2RuntimeDocumentLexicalStates(
		primaryQueryTerms,
		request.storageReader,
		runtimeMatchOptions,
	);
	if (runtimeDocuments.length === 0) {
		return {
			queryTerms,
			matchedFiles: [],
		};
	}
	const runtimeEntries = buildCoverageLexicalV2RuntimeSourceEntries(
		queryTerms,
		runtimeDocuments,
		runtimeMatchOptions,
	);
	if (runtimeEntries.length === 0) {
		return {
			queryTerms,
			matchedFiles: [],
		};
	}
	const projection = projectCoverageLexicalV2RuntimeMatchedFiles(
		request.queryText,
		queryTerms,
		runtimeEntries,
		{
			maxExpensiveCandidates: resolveCoverageLexicalV2EngineCoarseBudget(
				request.maxItemResults,
			),
			maxDisplayCandidates: resolveCoverageLexicalV2EngineDisplayBudget(
				request.maxItemResults,
			),
		},
	);
	return {
		queryTerms,
		matchedFiles: projection.matchedFiles.slice(0, request.maxItemResults),
	};
}

function resolveCoverageLexicalV2EngineCoarseBudget(
	maxItemResults: number,
): number {
	return Math.min(
		COVERAGE_LEXICAL_V2_ENGINE_MAX_EXPENSIVE_CANDIDATES,
		Math.max(
			COVERAGE_LEXICAL_V2_ENGINE_MIN_EXPENSIVE_CANDIDATES,
			Math.max(0, maxItemResults),
		),
	);
}

function resolveCoverageLexicalV2EngineDisplayBudget(
	maxItemResults: number,
): number {
	return Math.max(0, maxItemResults);
}
