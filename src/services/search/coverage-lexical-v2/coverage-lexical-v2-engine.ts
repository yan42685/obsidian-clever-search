import type {
	MatchedFile,
} from "src/globals/search-types";
import type { WeakFilePruneMode } from "src/globals/plugin-setting";
import {
	buildCoverageLexicalV2QueryAnalysis,
} from "./query";
import {
	searchCoverageLexicalV2CandidateCascade,
	type CoverageLexicalV2CandidateCascadeMatchOptions,
	type CoverageLexicalV2CandidateCascadeTrace,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "./candidate-cascade";

const DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE: WeakFilePruneMode = "strict";

export type CoverageLexicalV2EngineSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	weakFilePruneMode?: WeakFilePruneMode;
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
		pruneStages: {
			stageA: {
				applied: false,
				mode: DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE,
				metric: "potential_primary",
				allowedGap: null,
				leaderCount: 0,
				retainedCandidateIds: [],
				droppedCandidateIds: [],
				retainedCandidateCount: 0,
				droppedCandidateCount: 0,
				skippedReason: "none",
			},
			stageB: {
				applied: false,
				mode: DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE,
				metric: "confirmed_primary",
				allowedGap: null,
				leaderCount: 0,
				retainedCandidateIds: [],
				droppedCandidateIds: [],
				retainedCandidateCount: 0,
				droppedCandidateCount: 0,
				skippedReason: "none",
			},
			stageC: {
				applied: false,
				mode: DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE,
				metric: "confirmed_primary",
				allowedGap: null,
				leaderCount: 0,
				retainedCandidateIds: [],
				droppedCandidateIds: [],
				retainedCandidateCount: 0,
				droppedCandidateCount: 0,
				skippedReason: "none",
			},
		},
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
		pendingHanFrontierCount: 0,
		hanPromotionDocCount: 0,
		hanPromotionVerifiedDocCount: 0,
		bodyHanCandidateBlockCount: 0,
		bodyHanCandidateSegmentCount: 0,
		bodyHanIntersectedBlockCount: 0,
		bodyHanColdExactRequestedBlockCount: 0,
		bodyHanColdExactFetchedBlockCount: 0,
		bodyHanColdExactByteSum: 0,
		bodyHanColdExactSkippedByBudget: 0,
		bodyHanColdExactSkippedReason: "not_requested",
		hanPromotionSkippedReason: "no_pending_candidates",
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
		weakFilePruneMode: request.weakFilePruneMode,
		storageReader: request.storageReader,
		matchOptions: cascadeMatchOptions,
	});
	return {
		queryTerms,
		matchedFiles: cascade.matchedFiles.slice(0, request.maxItemResults),
		trace: cascade.trace,
	};
}
