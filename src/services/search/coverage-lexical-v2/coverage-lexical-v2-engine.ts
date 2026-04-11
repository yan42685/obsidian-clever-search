import type {
	MatchedFile,
} from "src/globals/search-types";
import {
	buildCoverageLexicalV2QueryAnalysis,
} from "./query";
import {
	searchCoverageLexicalV2CandidateCascade,
	type CoverageLexicalV2CandidateCascadeMatchOptions,
	type CoverageLexicalV2CandidateCascadeTrace,
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
	trace: CoverageLexicalV2CandidateCascadeTrace;
};

function createCoverageLexicalV2EmptyTrace(): CoverageLexicalV2CandidateCascadeTrace {
	return {
		layerMode: "normal",
		retainedCandidateIdsByLayer: {
			layer1: [],
			layer2: [],
			layer3: [],
			layer4: [],
		},
		deferredCandidateIdsByLayer: {
			layer1: [],
			layer2: [],
			layer3: [],
			layer4: [],
		},
		verificationBucketCandidateIds: [],
		resolvedTopBucketCandidateIds: [],
		verificationBucketDocCount: 0,
		verificationBodyDocCount: 0,
		verificationEstimatedBodyTokenSum: 0,
		verificationBodyAvailability: {
			resident: 0,
			hotCache: 0,
			coldOrSnapshot: 0,
			missing: 0,
		},
		verificationSkippedReason: "no_verification_candidates",
		usedFuzzySalvage: false,
		usedHanFallbackSalvage: false,
	};
}

export async function searchCoverageLexicalV2Engine(
	request: CoverageLexicalV2EngineSearchRequest,
): Promise<CoverageLexicalV2EngineSearchResult> {
	const queryTerms = request.tokenizeQueryText(request.queryText)
		.map((term) => term.trim().toLowerCase())
		.filter((term) => term.length > 0);
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(
		request.queryText,
		queryTerms,
	);
	if (queryAnalysis.primaryUnits.length === 0) {
		return {
			queryTerms,
			matchedFiles: [],
			trace: createCoverageLexicalV2EmptyTrace(),
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
			trace: createCoverageLexicalV2EmptyTrace(),
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
		trace: cascade.trace,
	};
}
