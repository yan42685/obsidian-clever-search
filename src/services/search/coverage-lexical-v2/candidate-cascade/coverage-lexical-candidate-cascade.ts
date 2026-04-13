import type {
	MatchedFile,
} from "src/globals/search-types";
import type { WeakFilePruneMode } from "src/globals/plugin-setting";
import { devOption } from "src/globals/dev-option";
import {
	applyCoverageLexicalV2DisplayPolicy,
} from "../display";
import type {
	CoverageLexicalV2HanBackstopGroup,
	CoverageLexicalV2QueryAnalysis,
	CoverageLexicalV2QueryUnit,
} from "../query";
import { normalizeCoverageLexicalV2Text } from "../query";
import {
	buildCoverageLexicalV2CheapComparatorCandidate,
	compareCoverageLexicalV2CheapExactPrimaryContiguity,
	compareCoverageLexicalV2CheapSharedFieldCoverage,
	compareCoverageLexicalV2FieldProfiles,
	compareCoverageLexicalV2OptionalPrimaryUnitProximity,
	compareCoverageLexicalV2PrimaryUnitMatchQuality,
	compareCoverageLexicalV2SurfaceCoverageShapes,
	explainCoverageLexicalV2ComparatorDecision,
	patchCoverageLexicalV2ComparatorCandidateWithProximity,
	selectCoverageLexicalV2ComparatorTopTieBand,
	type CoverageLexicalV2MatchField,
	type CoverageLexicalV2MatchQualityKind,
	type CoverageLexicalV2MatchedPrimaryUnitEvidence,
	type CoverageLexicalV2ComparatorCandidate,
	type CoverageLexicalV2ComparatorEvidence,
	type CoverageLexicalV2ComparatorRunCandidate,
	type CoverageLexicalV2CheapExactWitness,
	type CoverageLexicalV2CheapExactWitnessSummary,
} from "../comparator";
import type {
	CoverageLexicalV2CheapExactPrimaryContiguity,
	CoverageLexicalV2CheapSharedFieldCoverage,
	CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	CoverageLexicalV2PrimaryUnitMatchQuality,
	CoverageLexicalV2SurfaceCoverageShape,
} from "../comparator";
import type {
	CoverageLexicalV2CandidateCascadeDocumentRecord,
	CoverageLexicalV2CandidateCascadeHanBackstopStats,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchResult,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason,
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2CandidateCascadeStorageReader,
} from "./coverage-lexical-candidate-types";
import {
	buildCoverageLexicalV2CandidateCascadeBestWindowForDocument,
	buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits,
	type CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	type CoverageLexicalV2CandidateCascadeFieldTerms,
	type CoverageLexicalV2CandidateCascadePrefixHint,
	type CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
} from "./coverage-lexical-candidate-evidence";
import {
	compareCoverageLexicalV2MatchQuality,
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	isCoverageLexicalV2LatinCandidateCascadeTerm,
	normalizeCoverageLexicalV2CandidateCascadeTerm,
	type CoverageLexicalV2CandidateCascadeMatchOptions,
} from "./coverage-lexical-candidate-match";
import { extractHanBigrams, extractHanSegments } from "../../coverage-lexical/coverage-lexical-cjk";
import { logger } from "src/utils/logger";
type CoverageLexicalV2CascadeCandidateFieldTermSets = {
	basenameTerms: Set<string>;
	aliasTerms: Set<string>;
	headingsTerms: Set<string>;
	folderTerms: Set<string>;
	tagTerms: Set<string>;
	bodyTerms: Set<string>;
};

const DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE: WeakFilePruneMode = "strict";

type CoverageLexicalV2CascadeCandidateExactQueryTerms = {
	basenameExactQueryTerms: Set<string>;
	aliasExactQueryTerms: Set<string>;
	headingsExactQueryTerms: Set<string>;
	bodyExactQueryTerms: Set<string>;
};

type CoverageLexicalV2CascadeCandidateSourceFlags = {
	hasExact: boolean;
	hasPrefix: boolean;
	hasFuzzy: boolean;
	hasFallback: boolean;
	hasHanBackstop: boolean;
	hasMetadata: boolean;
	hasBody: boolean;
	hasBodyExact: boolean;
};

type CoverageLexicalV2CascadeFieldMatchPresence = {
	metadataMatched: boolean;
	bodyMatched: boolean;
};

type CoverageLexicalV2CascadeAdaptivePrefixPlan = {
	metadataTermCap: number;
	bodyTermCap: number;
	assistTermCap: number;
	prefixCollectionCap: number;
	assistDocCap: number;
};

type CoverageLexicalV2CascadeHydrationStatus =
	| "not_requested"
	| "prefetched";

export type CoverageLexicalV2CascadeCandidateState = {
	docId: number;
	path: string;
	stableDeterministicKey: string;
	record: CoverageLexicalV2CandidateCascadeDocumentRecord;
	fieldTerms: CoverageLexicalV2CascadeCandidateFieldTermSets;
	exactQueryTerms: CoverageLexicalV2CascadeCandidateExactQueryTerms;
	exactPrimaryMask: Set<number>;
	prefixPrimaryMask: Set<number>;
	fuzzyPrimaryMask: Set<number>;
	matchedGroupMask: Set<number>;
	matchedLatinGroupMask: Set<number>;
	matchedHanGroupMask: Set<number>;
	bestFieldByPrimaryUnit: Map<number, CoverageLexicalV2MatchField>;
	corroboratedFieldMaskByPrimaryUnit: Map<number, Set<CoverageLexicalV2MatchField>>;
	sourceFlags: CoverageLexicalV2CascadeCandidateSourceFlags;
	needsVerification: boolean;
	hydrationStatus: CoverageLexicalV2CascadeHydrationStatus;
	prefetchedBodyTokenSequence?: readonly string[];
	potentialPrimaryCoverageCount: number;
	fuzzySalvageCoverageCount: number;
	hanFallbackSalvageGroupCount: number;
	matchedFieldsByPrimaryUnit: Map<number, Set<CoverageLexicalV2MatchField>>;
	bestQualityByPrimaryUnit: Map<number, CoverageLexicalV2MatchQualityKind>;
	fallbackMatchedSurfaceGroups: Set<number>;
	prefixHintsByPrimaryUnit: Map<number, CoverageLexicalV2CandidateCascadePrefixHint>;
};

export type CoverageLexicalV2CandidateCascadeLayerMode =
	| "normal"
	| "fuzzy_salvage"
	| "han_fallback_salvage";

export type CoverageLexicalV2CandidateCascadeVerificationSkippedReason =
	| "none"
	| "overflow"
	| "no_verification_candidates";

export type CoverageLexicalV2CandidateCascadeHanPromotionSkippedReason =
	| "none"
	| "no_pending_candidates"
	| "doc_cap_reached";

export type CoverageLexicalV2CandidateCascadePolicy = {
	frontierTarget: number;
	returnTarget: number;
	proximityOverflowCap: number;
	prefixTermCapPerUnit: number;
	prefixDocCapPerQuery: number;
	fuzzyTermCapPerUnit: number;
	fuzzyDocCapPerQuery: number;
	hanBackstopDocCapPerGroup: number;
	hanBackstopDocCapPerQuery: number;
	hanBackstopColdExactDocBudget: number;
	hanBackstopColdExactByteBudget: number;
	hanBackstopColdExactTimeBudgetMs: number;
};

export type CoverageLexicalV2CandidateCascadeRequest = {
	queryText: string;
	queryTerms: readonly string[];
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	maxItemResults: number;
	weakFilePruneMode?: WeakFilePruneMode;
	storageReader: CoverageLexicalV2CandidateCascadeStorageReader;
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions;
};

type CoverageLexicalV2WeakFilePruneStageName = "stageA" | "stageB" | "stageC";

type CoverageLexicalV2WeakFilePruneMetric =
	| "potential_primary"
	| "confirmed_primary";

type CoverageLexicalV2WeakFilePruneSkipReason =
	| "none"
	| "mode_off"
	| "no_candidates"
	| "non_normal_layer_mode"
	| "han_fallback_salvage"
	| "no_positive_leader";

export type CoverageLexicalV2WeakFilePruneStageTrace = {
	applied: boolean;
	mode: WeakFilePruneMode;
	metric: CoverageLexicalV2WeakFilePruneMetric;
	allowedGap: number | null;
	leaderCount: number;
	retainedCandidateIds: string[];
	droppedCandidateIds: string[];
	retainedCandidateCount: number;
	droppedCandidateCount: number;
	skippedReason: CoverageLexicalV2WeakFilePruneSkipReason;
};

export type CoverageLexicalV2CandidateCascadeTrace = {
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
	pruneStages: {
		stageA: CoverageLexicalV2WeakFilePruneStageTrace;
		stageB: CoverageLexicalV2WeakFilePruneStageTrace;
		stageC: CoverageLexicalV2WeakFilePruneStageTrace;
	};
	retainedCandidateIdsByLayer: {
		layer1: string[];
		layer2: string[];
		layer3: string[];
		layer4: string[];
	};
	deferredCandidateIdsByLayer: {
		layer1: string[];
		layer2: string[];
		layer3: string[];
		layer4: string[];
	};
	verificationBucketCandidateIds: string[];
	resolvedTopBucketCandidateIds: string[];
	verificationBucketDocCount: number;
	verificationBodyDocCount: number;
	verificationEstimatedBodyTokenSum: number;
	verificationBodyAvailability: {
		resident: number;
		hotCache: number;
		coldOrSnapshot: number;
		missing: number;
	};
	verificationSkippedReason: CoverageLexicalV2CandidateCascadeVerificationSkippedReason;
	pendingHanFrontierCount: number;
	hanPromotionDocCount: number;
	hanPromotionVerifiedDocCount: number;
	bodyHanCandidateBlockCount: number;
	bodyHanCandidateSegmentCount: number;
	bodyHanIntersectedBlockCount: number;
	bodyHanColdExactRequestedBlockCount: number;
	bodyHanColdExactFetchedBlockCount: number;
	bodyHanColdExactByteSum: number;
	bodyHanColdExactSkippedByBudget: number;
	bodyHanColdExactSkippedReason:
		| "not_requested"
		| CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason;
	hanPromotionSkippedReason: CoverageLexicalV2CandidateCascadeHanPromotionSkippedReason;
	usedFuzzySalvage: boolean;
	usedHanFallbackSalvage: boolean;
};

export type CoverageLexicalV2CandidateCascadeResult = {
	matchedFiles: MatchedFile[];
	candidateStates: CoverageLexicalV2CascadeCandidateState[];
	activeFrontierCandidateIds: string[];
	deferredCandidateIds: string[];
	verificationCandidateIds: string[];
	rankedCandidateIds: string[];
	topTieBandCandidateIds: string[];
	usedFuzzySalvage: boolean;
	usedHanFallbackSalvage: boolean;
	policy: CoverageLexicalV2CandidateCascadePolicy;
	trace: CoverageLexicalV2CandidateCascadeTrace;
};

export type CoverageLexicalV2CandidateCascadeFrontierPlan = {
	activeFrontier: CoverageLexicalV2CascadeCandidateState[];
	deferredBuckets: CoverageLexicalV2CascadeCandidateState[][];
	usedFuzzySalvage: boolean;
	usedHanFallbackSalvage: boolean;
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
};

type CoverageLexicalV2CascadeLayerName = "layer2" | "layer3" | "layer4";

type CoverageLexicalV2CascadeRankingEntry = {
	candidateState: CoverageLexicalV2CascadeCandidateState;
	evidence: CoverageLexicalV2ComparatorEvidence;
	comparatorCandidate: CoverageLexicalV2ComparatorCandidate;
	layer1Score: number;
};

type CoverageLexicalV2CascadeLayerOutcome = {
	retained: CoverageLexicalV2CascadeCandidateState[];
	deferredBuckets: CoverageLexicalV2CascadeCandidateState[][];
	orderedBuckets: CoverageLexicalV2CascadeCandidateState[][];
};

type CoverageLexicalV2HanBackstopRankedCandidate = {
	docId: number;
	stableDeterministicKey: string;
	stats: CoverageLexicalV2CandidateCascadeHanBackstopStats;
};

type CoverageLexicalV2PendingHanCandidateVerificationState =
	| "pending"
	| "verified";

export type CoverageLexicalV2PendingHanCandidate = {
	docId: number;
	bodyLogicalBlockId?: number;
	primaryUnitIndex: number;
	surfaceGroupIndex: number;
	normalizedText: string;
	stableDeterministicKey: string;
	stats: CoverageLexicalV2CandidateCascadeHanBackstopStats;
	verificationState: CoverageLexicalV2PendingHanCandidateVerificationState;
	verifiedFields: Set<CoverageLexicalV2MatchField>;
};

export type CoverageLexicalV2PendingHanFrontier = {
	candidatesByKey: Map<string, CoverageLexicalV2PendingHanCandidate>;
};

export type CoverageLexicalV2HanPromotionBatchPolicy = {
	docCap: number;
};

type CoverageLexicalV2HanExactStatsCache = Map<
	string,
	CoverageLexicalV2CandidateCascadeHanBackstopStats | null
>;

export type CoverageLexicalV2HanPromotionResult = {
	promotedCount: number;
	verifiedCount: number;
	skippedReason: CoverageLexicalV2CandidateCascadeHanPromotionSkippedReason;
};

type CoverageLexicalV2HanBackstopSourceMetrics = {
	pendingHanFrontierCount: number;
	hanPromotionDocCount: number;
	hanPromotionVerifiedDocCount: number;
	bodyHanCandidateBlockCount: number;
	bodyHanCandidateSegmentCount: number;
	bodyHanIntersectedBlockCount: number;
	bodyHanColdExactRequestedBlockCount: number;
	bodyHanColdExactFetchedBlockCount: number;
	bodyHanColdExactByteSum: number;
	bodyHanColdExactSkippedByBudget: number;
	bodyHanColdExactSkippedReason:
		| "not_requested"
		| CoverageLexicalV2CandidateCascadeHanExactPrefetchSkippedReason;
	hanPromotionSkippedReason: CoverageLexicalV2CandidateCascadeHanPromotionSkippedReason;
};

type CoverageLexicalV2HanBackstopSourceResult = {
	candidateStates: CoverageLexicalV2CascadeCandidateState[];
	metrics: CoverageLexicalV2HanBackstopSourceMetrics;
};

type CoverageLexicalV2CandidateCascadeLayerModeSummary = {
	maxPotentialPrimaryCoverageCount: number;
	maxFuzzySalvageCoverageCount: number;
	maxHanFallbackSalvageGroupCount: number;
	usedFuzzySalvage: boolean;
	usedHanFallbackSalvage: boolean;
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
};

type CoverageLexicalV2ConfirmedPrimaryCoverageSnapshot = {
	evidenceByCandidateId: Map<string, CoverageLexicalV2ComparatorEvidence>;
	comparatorCandidateById: Map<string, CoverageLexicalV2ComparatorCandidate>;
	confirmedCoverageCountByCandidateId: Map<string, number>;
};

type CoverageLexicalV2TargetedHanDebugTrace = {
	enabled: boolean;
	normalizedQueryText: string;
	queryText: string;
	queryTerms: readonly string[];
	readerKind: CoverageLexicalV2CandidateCascadeStorageReader["readerKind"];
	enteredHanBackstop: boolean;
	groups: Array<{
		surfaceGroupIndex: number;
		normalizedText: string;
		triggerKind: string;
		bigrams: readonly string[];
		activated: boolean;
	}>;
	metadataCandidates: Array<{
		surfaceGroupIndex: number;
		normalizedText: string;
		docId: number;
		path: string;
		stats: CoverageLexicalV2CandidateCascadeHanBackstopStats;
	}>;
	bodyGateEvaluations: Array<{
		surfaceGroupIndex: number;
		normalizedText: string;
		docId: number;
		path: string;
		matched: boolean;
		stats: CoverageLexicalV2CandidateCascadeHanBackstopStats | null;
	}>;
	bodyGateCappedCandidates: Array<{
		docId: number;
		path: string;
		normalizedText: string;
		surfaceGroupIndex: number;
		stats: CoverageLexicalV2CandidateCascadeHanBackstopStats;
	}>;
	prefetch: null | {
		requestedBlockIds: number[];
		fetchedBlockIds: number[];
		fetchedBlockCount: number;
		byteSum: number;
		skippedByBudget: number;
		skippedReason: string;
		blockStatusCounts: Record<string, number>;
		blockResults: CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult[];
	};
	exactEvaluations: Array<{
		docId: number;
		path: string;
		normalizedText: string;
		surfaceGroupIndex: number;
		status:
			| "verified"
			| "exact_miss_after_prefetch"
			| "not_prefetched_or_budget_skipped";
		stats: CoverageLexicalV2CandidateCascadeHanBackstopStats | null;
	}>;
	trackedDocs: Map<number, string>;
	finalSummary?: Record<string, unknown>;
};

type CoverageLexicalV2TargetedComparatorDebugTrace = {
	enabled: boolean;
	normalizedQueryText: string;
	queryText: string;
	queryTerms: readonly string[];
	readerKind: CoverageLexicalV2CandidateCascadeStorageReader["readerKind"];
};

type CoverageLexicalV2TargetedComparatorHanExactDiagnostic = {
	normalizedText: string;
	surfaceGroupIndex: number;
	metadataExact: {
		basename: boolean;
		aliases: boolean;
		headings: boolean;
	};
	bodyWitness: {
		matched: boolean;
		start: number | null;
		end: number | null;
	};
	inCheapExactIntactSurfaceKeys: boolean;
};

type CoverageLexicalV2TargetedComparatorHanExactRawBlockDiagnostic = {
	blockId: number;
	blockOrdinal: number;
	symbolCount: number;
	encodedByteLength: number;
	stats: CoverageLexicalV2CandidateCascadeHanBackstopStats | null;
	witness: {
		matched: boolean;
		start: number | null;
		end: number | null;
	};
};

type CoverageLexicalV2TargetedComparatorHanExactRawDump = {
	normalizedText: string;
	surfaceGroupIndex: number;
	bigrams: readonly string[];
	docWitness: {
		matched: boolean;
		start: number | null;
		end: number | null;
	};
	blockCount: number;
	truncatedBlockCount: number;
	blocks: readonly CoverageLexicalV2TargetedComparatorHanExactRawBlockDiagnostic[];
};

type CoverageLexicalV2CheapExactContinuityField = Extract<
	CoverageLexicalV2MatchField,
	"basename" | "aliases" | "headings" | "body"
>;
type CoverageLexicalV2CheapExactMetadataField = Extract<
	CoverageLexicalV2CheapExactContinuityField,
	"basename" | "aliases" | "headings"
>;

type CoverageLexicalV2CheapExactWitnessWithOrder = CoverageLexicalV2CheapExactWitness & {
	queryOrder: number;
};

const FIELD_PRIORITY: Record<CoverageLexicalV2MatchField, number> = {
	basename: 0,
	aliases: 1,
	headings: 2,
	folder: 3,
	tag: 4,
	body: 5,
};

const SOURCE_FIELDS: readonly CoverageLexicalV2CandidateCascadePostingField[] = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
	"body",
];

const METADATA_FIELDS: readonly CoverageLexicalV2CandidateCascadePostingField[] = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
];

const ASSIST_METADATA_FIELDS: readonly CoverageLexicalV2CandidateCascadePostingField[] = [
	"basename",
	"aliases",
	"folder",
	"tag",
];

const BODY_ONLY_FIELDS: readonly CoverageLexicalV2CandidateCascadePostingField[] = ["body"];

const CHEAP_EXACT_METADATA_FIELDS: readonly CoverageLexicalV2CheapExactMetadataField[] = [
	"basename",
	"aliases",
	"headings",
];

const CHEAP_EXACT_FIELDS: readonly CoverageLexicalV2CheapExactContinuityField[] = [
	...CHEAP_EXACT_METADATA_FIELDS,
	"body",
];

export function resolveCoverageLexicalV2CandidateCascadePolicy(
	maxItemResults: number,
): CoverageLexicalV2CandidateCascadePolicy {
	const safeMaxItemResults = Math.max(0, maxItemResults);
	const frontierTarget = Math.min(96, Math.max(24, safeMaxItemResults * 3));
	const returnTarget = safeMaxItemResults + 4;
	const defaults: CoverageLexicalV2CandidateCascadePolicy = {
		frontierTarget,
		returnTarget,
		proximityOverflowCap: Math.min(20, Math.max(12, returnTarget + 2)),
		prefixTermCapPerUnit: 32,
		prefixDocCapPerQuery: frontierTarget * 8,
		fuzzyTermCapPerUnit: 16,
		fuzzyDocCapPerQuery: frontierTarget * 4,
		hanBackstopDocCapPerGroup: Math.min(frontierTarget, Math.max(returnTarget, 8)),
		hanBackstopDocCapPerQuery: frontierTarget,
		hanBackstopColdExactDocBudget: Math.min(frontierTarget, Math.max(returnTarget, 12)),
		hanBackstopColdExactByteBudget: 128 * 1024,
		hanBackstopColdExactTimeBudgetMs: 12,
	};
	return {
		...defaults,
		hanBackstopDocCapPerGroup: readCoverageLexicalV2CascadeOverride(
			"COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_GROUP",
			defaults.hanBackstopDocCapPerGroup,
		),
		hanBackstopDocCapPerQuery: readCoverageLexicalV2CascadeOverride(
			"COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_QUERY",
			defaults.hanBackstopDocCapPerQuery,
		),
		hanBackstopColdExactDocBudget: readCoverageLexicalV2CascadeOverride(
			"COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_DOC_BUDGET",
			defaults.hanBackstopColdExactDocBudget,
		),
		hanBackstopColdExactByteBudget: readCoverageLexicalV2CascadeOverride(
			"COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_BYTE_BUDGET",
			defaults.hanBackstopColdExactByteBudget,
		),
		hanBackstopColdExactTimeBudgetMs: readCoverageLexicalV2CascadeOverride(
			"COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_TIME_BUDGET_MS",
			defaults.hanBackstopColdExactTimeBudgetMs,
		),
	};
}

function readCoverageLexicalV2CascadeOverride(
	name: string,
	fallback: number,
): number {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveCoverageLexicalV2CascadeAdaptivePrefixPlan(
	queryTerm: string,
	policy: CoverageLexicalV2CandidateCascadePolicy,
): CoverageLexicalV2CascadeAdaptivePrefixPlan {
	const length = queryTerm.length;
	const halfPrefixCap = Math.ceil(policy.prefixTermCapPerUnit / 2);
	const assistTermCap = length >= 3 && length <= 4
		? Math.min(8, Math.ceil(policy.prefixTermCapPerUnit / 4))
		: 0;
	if (length >= 5) {
		return {
			metadataTermCap: policy.prefixTermCapPerUnit,
			bodyTermCap: policy.prefixTermCapPerUnit,
			assistTermCap: 0,
			prefixCollectionCap: policy.prefixTermCapPerUnit,
			assistDocCap: policy.returnTarget,
		};
	}
	if (length === 4) {
		return {
			metadataTermCap: policy.prefixTermCapPerUnit,
			bodyTermCap: halfPrefixCap,
			assistTermCap,
			prefixCollectionCap: Math.max(halfPrefixCap, policy.prefixTermCapPerUnit + assistTermCap),
			assistDocCap: policy.returnTarget,
		};
	}
	if (length === 3) {
		return {
			metadataTermCap: halfPrefixCap,
			bodyTermCap: 0,
			assistTermCap,
			prefixCollectionCap: halfPrefixCap + assistTermCap,
			assistDocCap: policy.returnTarget,
		};
	}
	return {
		metadataTermCap: 0,
		bodyTermCap: 0,
		assistTermCap: 0,
		prefixCollectionCap: 0,
		assistDocCap: policy.returnTarget,
	};
}

export async function searchCoverageLexicalV2CandidateCascade(
	request: CoverageLexicalV2CandidateCascadeRequest,
): Promise<CoverageLexicalV2CandidateCascadeResult> {
	const policy = resolveCoverageLexicalV2CandidateCascadePolicy(request.maxItemResults);
	const weakFilePruneMode =
		request.weakFilePruneMode ?? DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE;
	const targetedHanDebug = createCoverageLexicalV2TargetedHanDebugTrace(
		request.queryText,
		request.queryTerms,
		request.storageReader,
	);
	const targetedComparatorDebug = createCoverageLexicalV2TargetedComparatorDebugTrace(
		request.queryText,
		request.queryTerms,
		request.storageReader,
	);
	const comparatorQueryAnalysis = buildCoverageLexicalV2ComparatorQueryAnalysis(
		request.queryAnalysis,
	);
	const lexicalPrimaryUnits = request.queryAnalysis.primaryUnits.map((primaryUnit) =>
		toCoverageLexicalV2CandidateCascadePrimaryUnitDefinition(primaryUnit),
	);
	const candidateCascadePrimaryUnits = buildCoverageLexicalV2CandidateCascadePrimaryUnits(
		request.queryAnalysis,
		lexicalPrimaryUnits,
	);
	const candidateStateByDocId = new Map<number, CoverageLexicalV2CascadeCandidateState>();
	const prefixDocIds = new Set<number>();
	const assistDocIds = new Set<number>();
	const fuzzyDocIds = new Set<number>();
	const hanBackstopDocIds = new Set<number>();
	const prefetchedBodyHanExactBlockIds = new Set<number>();
	const hanBackstopMetrics = createCoverageLexicalV2EmptyHanBackstopSourceMetrics();
	const pruneStageTrace = createCoverageLexicalV2CandidateCascadePruneStageTraceSet(
		weakFilePruneMode,
	);
	const primaryUnitIndexByKey = new Map<string, number>(
		candidateCascadePrimaryUnits.map((primaryUnit, primaryUnitIndex) => [
			createCoverageLexicalV2CascadePrimaryUnitKey(
				primaryUnit.surfaceGroupIndex,
				primaryUnit.normalizedText,
			),
			primaryUnitIndex,
		] as const),
	);
	const metadataExactByPrimaryUnit = lexicalPrimaryUnits.map(() => false);
	const metadataPrefixByPrimaryUnit = lexicalPrimaryUnits.map(() => false);

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		const exactPresence = collectCoverageLexicalV2CascadeExactMatches(
			candidateStateByDocId,
			primaryUnit,
			primaryUnitIndex,
			request.storageReader,
		);
		metadataExactByPrimaryUnit[primaryUnitIndex] = exactPresence.metadataMatched;
	});
	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (
			!request.matchOptions.includePrefix ||
			!isCoverageLexicalV2LatinCandidateCascadeTerm(primaryUnit.normalizedText)
		) {
			return;
		}
		const prefixPlan = resolveCoverageLexicalV2CascadeAdaptivePrefixPlan(primaryUnit.normalizedText, policy);
		if (prefixPlan.prefixCollectionCap <= 0) {
			return;
		}
		const prefixTerms = request.storageReader.collectLatinPrefixTerms(
			primaryUnit.normalizedText,
			prefixPlan.prefixCollectionCap,
		);
		for (const prefixTerm of prefixTerms.slice(0, prefixPlan.metadataTermCap)) {
			const matchPresence = collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				request.storageReader,
				prefixDocIds,
				policy.prefixDocCapPerQuery,
				METADATA_FIELDS,
			);
			if (matchPresence.metadataMatched) {
				metadataPrefixByPrimaryUnit[primaryUnitIndex] = true;
			}
		}
		for (const prefixTerm of prefixTerms.slice(0, prefixPlan.bodyTermCap)) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				request.storageReader,
				prefixDocIds,
				policy.prefixDocCapPerQuery,
				BODY_ONLY_FIELDS,
			);
		}
		if (metadataExactByPrimaryUnit[primaryUnitIndex] || metadataPrefixByPrimaryUnit[primaryUnitIndex]) {
			return;
		}
		for (const prefixTerm of prefixTerms.slice(
			prefixPlan.metadataTermCap,
			prefixPlan.metadataTermCap + prefixPlan.assistTermCap,
		)) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				request.storageReader,
				assistDocIds,
				prefixPlan.assistDocCap,
				ASSIST_METADATA_FIELDS,
			);
		}
	});

	let candidateStates = finalizeCoverageLexicalV2CascadeCandidateStates(
		candidateStateByDocId,
	);
	pruneStageTrace.stageA = applyCoverageLexicalV2WeakFilePruneByPotential({
		mode: weakFilePruneMode,
		candidateStateByDocId,
		candidateStates,
		layerMode: "normal",
		stageName: "stageA",
	});
	candidateStates = finalizeCoverageLexicalV2CascadeCandidateStates(
		candidateStateByDocId,
	);

	await collectCoverageLexicalV2CascadeHanBackstopMatches(
		candidateStateByDocId,
		request.queryAnalysis,
		candidateCascadePrimaryUnits,
		primaryUnitIndexByKey,
		request.storageReader,
		hanBackstopDocIds,
		prefetchedBodyHanExactBlockIds,
		policy,
		hanBackstopMetrics,
		targetedHanDebug,
	);

	candidateStates = finalizeCoverageLexicalV2CascadeCandidateStates(
		candidateStateByDocId,
	);
	const preFuzzyConfirmed = await buildCoverageLexicalV2ConfirmedPrimaryCoverageSnapshot({
		candidateStates,
		queryAnalysis: comparatorQueryAnalysis,
		candidateCascadePrimaryUnits,
		reader: request.storageReader,
		matchOptions: {
			...request.matchOptions,
			includeFuzzy: false,
		},
		prefetchedBodyHanExactBlockIds,
		policy,
	});
	const preFuzzyLayerMode = summarizeCoverageLexicalV2CandidateCascadeLayerMode(
		candidateStates,
		request.queryAnalysis.hasHanGroups,
		false,
	).layerMode;
	pruneStageTrace.stageB = applyCoverageLexicalV2WeakFilePruneByConfirmedCoverage({
		mode: weakFilePruneMode,
		candidateStateByDocId,
		candidateStates,
		layerMode: preFuzzyLayerMode,
		stageName: "stageB",
		confirmedCoverageCountByCandidateId:
			preFuzzyConfirmed.confirmedCoverageCountByCandidateId,
	});
	candidateStates = finalizeCoverageLexicalV2CascadeCandidateStates(
		candidateStateByDocId,
	);

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (
			!request.matchOptions.includeFuzzy ||
			!isCoverageLexicalV2LatinCandidateCascadeTerm(primaryUnit.normalizedText)
		) {
			return;
		}
		const fuzzyTerms = request.storageReader.collectLatinFuzzyTerms(
			primaryUnit.normalizedText,
			policy.fuzzyTermCapPerUnit,
			request.matchOptions.fuzzyProportion ?? 0,
		);
		for (const fuzzyTerm of fuzzyTerms) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				fuzzyTerm,
				primaryUnit,
				primaryUnitIndex,
				"fuzzy",
				request.storageReader,
				fuzzyDocIds,
				policy.fuzzyDocCapPerQuery,
			);
		}
	});

	candidateStates = finalizeCoverageLexicalV2CascadeCandidateStates(
		candidateStateByDocId,
	);
	const preFrontierSummary = summarizeCoverageLexicalV2CandidateCascadeLayerMode(
		candidateStates,
		request.queryAnalysis.hasHanGroups,
		request.matchOptions.includeFuzzy === true,
	);
	const fullConfirmed = await buildCoverageLexicalV2ConfirmedPrimaryCoverageSnapshot({
		candidateStates,
		queryAnalysis: comparatorQueryAnalysis,
		candidateCascadePrimaryUnits,
		reader: request.storageReader,
		matchOptions: request.matchOptions,
		prefetchedBodyHanExactBlockIds,
		policy,
	});
	pruneStageTrace.stageC = applyCoverageLexicalV2WeakFilePruneByConfirmedCoverage({
		mode: weakFilePruneMode,
		candidateStateByDocId,
		candidateStates,
		layerMode: preFrontierSummary.layerMode,
		stageName: "stageC",
		confirmedCoverageCountByCandidateId:
			fullConfirmed.confirmedCoverageCountByCandidateId,
	});
	candidateStates = finalizeCoverageLexicalV2CascadeCandidateStates(
		candidateStateByDocId,
	);
	if (candidateStates.length === 0) {
		const emptyTrace = createCoverageLexicalV2CandidateCascadeTrace("normal");
		emptyTrace.pruneStages = pruneStageTrace;
		applyCoverageLexicalV2HanBackstopMetricsToTrace(emptyTrace, hanBackstopMetrics);
		finalizeCoverageLexicalV2TargetedHanDebugTrace(
			targetedHanDebug,
			candidateStates,
			emptyTrace,
			[],
		);
		finalizeCoverageLexicalV2TargetedComparatorDebugTrace({
			targetedComparatorDebug,
			queryAnalysis: request.queryAnalysis,
			candidateStates,
			trace: emptyTrace,
			orderedCandidates: [],
			resolvedTopBucket: [],
			topTieBand: [],
			visibleCandidateIds: [],
			reader: request.storageReader,
		});
		return {
			matchedFiles: [],
			candidateStates,
			activeFrontierCandidateIds: [],
			deferredCandidateIds: [],
		verificationCandidateIds: [],
		rankedCandidateIds: [],
		topTieBandCandidateIds: [],
		usedFuzzySalvage: false,
		usedHanFallbackSalvage: false,
			policy,
			trace: emptyTrace,
		};
	}

	const frontierPlan = planCoverageLexicalV2CandidateCascadeLayer1Frontier(
		candidateStates,
		request.queryAnalysis.hasHanGroups,
		request.matchOptions.includeFuzzy === true,
		policy,
	);
	const trace = createCoverageLexicalV2CandidateCascadeTrace(frontierPlan.layerMode);
	trace.pruneStages = pruneStageTrace;
	applyCoverageLexicalV2HanBackstopMetricsToTrace(trace, hanBackstopMetrics);
	trace.retainedCandidateIdsByLayer.layer1 = frontierPlan.activeFrontier.map((candidateState) =>
		String(candidateState.docId),
	);
	trace.deferredCandidateIdsByLayer.layer1 = frontierPlan.deferredBuckets
		.flat()
		.map((candidateState) => String(candidateState.docId));
	trace.usedFuzzySalvage = frontierPlan.usedFuzzySalvage;
	trace.usedHanFallbackSalvage = frontierPlan.usedHanFallbackSalvage;
	const candidateStateById = new Map<string, CoverageLexicalV2CascadeCandidateState>(
		candidateStates.map((candidateState) => [String(candidateState.docId), candidateState]),
	);
	if (frontierPlan.activeFrontier.length === 0) {
		finalizeCoverageLexicalV2TargetedHanDebugTrace(
			targetedHanDebug,
			candidateStates,
			trace,
			[],
		);
		finalizeCoverageLexicalV2TargetedComparatorDebugTrace({
			targetedComparatorDebug,
			queryAnalysis: request.queryAnalysis,
			candidateStates,
			trace,
			orderedCandidates: [],
			resolvedTopBucket: [],
			topTieBand: [],
			visibleCandidateIds: [],
			candidateStateById,
			reader: request.storageReader,
		});
		return {
			matchedFiles: [],
			candidateStates,
			activeFrontierCandidateIds: [],
			deferredCandidateIds: trace.deferredCandidateIdsByLayer.layer1,
		verificationCandidateIds: [],
		rankedCandidateIds: [],
		topTieBandCandidateIds: [],
		usedFuzzySalvage: frontierPlan.usedFuzzySalvage,
			usedHanFallbackSalvage: frontierPlan.usedHanFallbackSalvage,
			policy,
			trace,
		};
	}
	if (frontierPlan.layerMode === "han_fallback_salvage") {
		const rankedCandidates = [...frontierPlan.activeFrontier].sort((left, right) => {
			if (left.hanFallbackSalvageGroupCount !== right.hanFallbackSalvageGroupCount) {
				return right.hanFallbackSalvageGroupCount - left.hanFallbackSalvageGroupCount;
			}
			return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
		});
		const visibleCandidates = rankedCandidates.slice(0, request.maxItemResults);
		finalizeCoverageLexicalV2TargetedHanDebugTrace(
			targetedHanDebug,
			candidateStates,
			trace,
			visibleCandidates.map((candidateState) => String(candidateState.docId)),
			candidateStateById,
		);
		finalizeCoverageLexicalV2TargetedComparatorDebugTrace({
			targetedComparatorDebug,
			queryAnalysis: request.queryAnalysis,
			candidateStates,
			trace,
			orderedCandidates: [],
			resolvedTopBucket: [],
			topTieBand: [],
			visibleCandidateIds: visibleCandidates.map((candidateState) =>
				String(candidateState.docId),
			),
			candidateStateById,
			reader: request.storageReader,
		});
		return {
			matchedFiles: visibleCandidates.map((candidateState) => ({
				path: candidateState.path,
				queryTerms: [...request.queryTerms],
				matchedTerms: collectCoverageLexicalV2CascadeFallbackMatchedTerms(candidateState),
			})),
			candidateStates,
			activeFrontierCandidateIds: trace.retainedCandidateIdsByLayer.layer1,
			deferredCandidateIds: trace.deferredCandidateIdsByLayer.layer1,
			verificationCandidateIds: [],
			rankedCandidateIds: rankedCandidates.map((candidateState) => String(candidateState.docId)),
			topTieBandCandidateIds: collectCoverageLexicalV2CascadeHanTopTieBandCandidateIds(
				rankedCandidates,
			),
			usedFuzzySalvage: frontierPlan.usedFuzzySalvage,
			usedHanFallbackSalvage: frontierPlan.usedHanFallbackSalvage,
			policy,
			trace,
		};
	}

	const evidenceByCandidateId = new Map<string, CoverageLexicalV2ComparatorEvidence>(
		fullConfirmed.evidenceByCandidateId,
	);
	const cheapComparatorCandidateById = new Map<
		string,
		CoverageLexicalV2ComparatorCandidate
	>(fullConfirmed.comparatorCandidateById);
	const layer2Outcome = await resolveCoverageLexicalV2CandidateCascadeLayerOutcome({
		layerName: "layer2",
		inputCandidates: frontierPlan.activeFrontier,
		deferredBuckets: frontierPlan.deferredBuckets,
		layerMode: frontierPlan.layerMode,
		queryAnalysis: comparatorQueryAnalysis,
		candidateCascadePrimaryUnits,
		reader: request.storageReader,
		matchOptions: request.matchOptions,
		evidenceByCandidateId,
		cheapComparatorCandidateById,
		prefetchedBodyHanExactBlockIds,
		policy,
	});
	trace.retainedCandidateIdsByLayer.layer2 = layer2Outcome.retained.map((candidateState) =>
		String(candidateState.docId),
	);
	trace.deferredCandidateIdsByLayer.layer2 = layer2Outcome.deferredBuckets
		.flat()
		.map((candidateState) => String(candidateState.docId));

	const layer3Outcome = await resolveCoverageLexicalV2CandidateCascadeLayerOutcome({
		layerName: "layer3",
		inputCandidates: layer2Outcome.retained,
		deferredBuckets: layer2Outcome.deferredBuckets,
		layerMode: frontierPlan.layerMode,
		queryAnalysis: comparatorQueryAnalysis,
		candidateCascadePrimaryUnits,
		reader: request.storageReader,
		matchOptions: request.matchOptions,
		evidenceByCandidateId,
		cheapComparatorCandidateById,
		prefetchedBodyHanExactBlockIds,
		policy,
	});
	trace.retainedCandidateIdsByLayer.layer3 = layer3Outcome.retained.map((candidateState) =>
		String(candidateState.docId),
	);
	trace.deferredCandidateIdsByLayer.layer3 = layer3Outcome.deferredBuckets
		.flat()
		.map((candidateState) => String(candidateState.docId));

	const layer4Outcome = await resolveCoverageLexicalV2CandidateCascadeLayerOutcome({
		layerName: "layer4",
		inputCandidates: layer3Outcome.retained,
		deferredBuckets: layer3Outcome.deferredBuckets,
		layerMode: frontierPlan.layerMode,
		queryAnalysis: comparatorQueryAnalysis,
		candidateCascadePrimaryUnits,
		reader: request.storageReader,
		matchOptions: request.matchOptions,
		evidenceByCandidateId,
		cheapComparatorCandidateById,
		prefetchedBodyHanExactBlockIds,
		policy,
	});
	trace.retainedCandidateIdsByLayer.layer4 = layer4Outcome.retained.map((candidateState) =>
		String(candidateState.docId),
	);
	trace.deferredCandidateIdsByLayer.layer4 = layer4Outcome.deferredBuckets
		.flat()
		.map((candidateState) => String(candidateState.docId));

	const verificationBucket = layer4Outcome.orderedBuckets[0] ?? [];
	trace.verificationBucketCandidateIds = verificationBucket.map((candidateState) =>
		String(candidateState.docId),
	);
	trace.verificationBucketDocCount = verificationBucket.length;
	const verificationStates = verificationBucket.filter((candidateState) => candidateState.needsVerification);
	let verificationSkippedReason: CoverageLexicalV2CandidateCascadeVerificationSkippedReason = "none";
	let verificationEstimatedBodyTokenSum = 0;
	let verificationBodyAvailability = {
		resident: 0,
		hotCache: 0,
		coldOrSnapshot: 0,
		missing: 0,
	};
	if (verificationBucket.length === 0 || verificationStates.length === 0) {
		verificationSkippedReason = "no_verification_candidates";
	} else if (verificationBucket.length > policy.proximityOverflowCap) {
		verificationSkippedReason = "overflow";
	} else {
		await hydrateCoverageLexicalV2CascadeVerificationStates(
			verificationStates,
			request.storageReader,
			prefetchedBodyHanExactBlockIds,
			policy,
		);
		await populateCoverageLexicalV2CandidateCascadeEvidence(
			evidenceByCandidateId,
			verificationStates,
			request.queryAnalysis,
			candidateCascadePrimaryUnits,
			request.storageReader,
			request.matchOptions,
			prefetchedBodyHanExactBlockIds,
			policy,
			true,
		);
		for (const candidateState of verificationStates) {
			const candidateId = String(candidateState.docId);
			const refreshedEvidence = evidenceByCandidateId.get(candidateId);
			if (!refreshedEvidence) {
				continue;
			}
			cheapComparatorCandidateById.set(
				candidateId,
				buildCoverageLexicalV2CheapComparatorCandidate(
					comparatorQueryAnalysis,
					refreshedEvidence,
				),
			);
		}
		for (const candidateState of verificationStates) {
			const bodyTokens = candidateState.prefetchedBodyTokenSequence;
			if (bodyTokens) {
				verificationBodyAvailability.coldOrSnapshot += 1;
				verificationEstimatedBodyTokenSum += bodyTokens.length;
			} else {
				verificationBodyAvailability.missing += 1;
			}
		}
	}
	trace.verificationBodyDocCount = verificationStates.length;
	trace.verificationEstimatedBodyTokenSum = verificationEstimatedBodyTokenSum;
	trace.verificationBodyAvailability = verificationBodyAvailability;
	trace.verificationSkippedReason = verificationSkippedReason;

	const resolvedTopBucket = buildCoverageLexicalV2ResolvedTopBucketCandidates(
		verificationBucket,
		evidenceByCandidateId,
		cheapComparatorCandidateById,
		verificationSkippedReason === "none",
	);
	trace.resolvedTopBucketCandidateIds = resolvedTopBucket.map((candidate) => candidate.evidence.candidateId);
	const orderedCandidates = assembleCoverageLexicalV2CandidateCascadeOrderedCandidates(
		resolvedTopBucket,
		layer4Outcome.orderedBuckets.slice(1),
		evidenceByCandidateId,
		cheapComparatorCandidateById,
	);
	const topTieBand = selectCoverageLexicalV2ComparatorTopTieBand(
		resolvedTopBucket.map((candidate) => candidate.comparatorCandidate),
	);
	const display = applyCoverageLexicalV2DisplayPolicy(orderedCandidates, {
		maxDisplayCandidates: request.maxItemResults,
	});
	finalizeCoverageLexicalV2TargetedHanDebugTrace(
		targetedHanDebug,
		candidateStates,
		trace,
		display.visibleCandidates.map((candidate) => candidate.evidence.candidateId),
		candidateStateById,
	);
	finalizeCoverageLexicalV2TargetedComparatorDebugTrace({
		targetedComparatorDebug,
		queryAnalysis: request.queryAnalysis,
		candidateStates,
		trace,
		orderedCandidates,
		resolvedTopBucket,
		topTieBand,
		visibleCandidateIds: display.visibleCandidates.map(
			(candidate) => candidate.evidence.candidateId,
		),
		candidateStateById,
		reader: request.storageReader,
	});
	return {
		matchedFiles: display.visibleCandidates
			.map((candidate) => {
				const candidateState = candidateStateById.get(candidate.evidence.candidateId);
				if (!candidateState) {
					return null;
				}
				return {
					path: candidateState.path,
					queryTerms: [...request.queryTerms],
					matchedTerms: collectCoverageLexicalV2CascadeMatchedTerms(
						candidate.evidence.matchedPrimaryUnits,
					),
				};
			})
			.filter((candidate): candidate is MatchedFile => candidate != null),
		candidateStates,
		activeFrontierCandidateIds: trace.retainedCandidateIdsByLayer.layer1,
		deferredCandidateIds: trace.deferredCandidateIdsByLayer.layer1,
		verificationCandidateIds: trace.verificationBucketCandidateIds,
		rankedCandidateIds: orderedCandidates.map((candidate) => candidate.evidence.candidateId),
		topTieBandCandidateIds: topTieBand.map((candidate) => candidate.candidateId),
		usedFuzzySalvage: frontierPlan.usedFuzzySalvage,
		usedHanFallbackSalvage: frontierPlan.usedHanFallbackSalvage,
		policy,
		trace,
	};
}

export function planCoverageLexicalV2CandidateCascadeLayer1Frontier(
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	hasHanGroups: boolean,
	includeFuzzy: boolean,
	policy: CoverageLexicalV2CandidateCascadePolicy,
): CoverageLexicalV2CandidateCascadeFrontierPlan {
	const summary = summarizeCoverageLexicalV2CandidateCascadeLayerMode(
		candidateStates,
		hasHanGroups,
		includeFuzzy,
	);
	const layerMode = summary.layerMode;
	const eligibleCandidates = candidateStates
		.filter((candidateState) =>
			getCoverageLexicalV2CascadeLayer1Score(candidateState, layerMode) > 0,
		)
		.sort((left, right) => {
			const leftLayer1Score = getCoverageLexicalV2CascadeLayer1Score(left, layerMode);
			const rightLayer1Score = getCoverageLexicalV2CascadeLayer1Score(right, layerMode);
			if (leftLayer1Score !== rightLayer1Score) {
				return rightLayer1Score - leftLayer1Score;
			}
			return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
		});
	const activeFrontier: CoverageLexicalV2CascadeCandidateState[] = [];
	const deferredBuckets: CoverageLexicalV2CascadeCandidateState[][] = [];
	let index = 0;
	while (index < eligibleCandidates.length) {
		const layer1Score = getCoverageLexicalV2CascadeLayer1Score(
			eligibleCandidates[index],
			layerMode,
		);
		const bucket: CoverageLexicalV2CascadeCandidateState[] = [];
		while (index < eligibleCandidates.length) {
			const candidateState = eligibleCandidates[index];
			const candidateScore = getCoverageLexicalV2CascadeLayer1Score(
				candidateState,
				layerMode,
			);
			if (candidateScore !== layer1Score) {
				break;
			}
			bucket.push(candidateState);
			index += 1;
		}
		if (activeFrontier.length < policy.frontierTarget) {
			activeFrontier.push(...bucket);
			continue;
		}
		deferredBuckets.push(bucket);
	}
	return {
		activeFrontier,
		deferredBuckets,
		usedFuzzySalvage: summary.usedFuzzySalvage,
		usedHanFallbackSalvage: summary.usedHanFallbackSalvage,
		layerMode,
	};
}

function createCoverageLexicalV2CandidateCascadeTrace(
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode,
): CoverageLexicalV2CandidateCascadeTrace {
	return {
		layerMode,
		pruneStages: createCoverageLexicalV2CandidateCascadePruneStageTraceSet(
			DEFAULT_COVERAGE_LEXICAL_V2_WEAK_FILE_PRUNE_MODE,
		),
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
		verificationSkippedReason: "none",
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

function summarizeCoverageLexicalV2CandidateCascadeLayerMode(
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	hasHanGroups: boolean,
	includeFuzzy: boolean,
): CoverageLexicalV2CandidateCascadeLayerModeSummary {
	const maxPotentialPrimaryCoverageCount = candidateStates.reduce(
		(maxCoverage, candidateState) =>
			Math.max(maxCoverage, candidateState.potentialPrimaryCoverageCount),
		0,
	);
	const maxFuzzySalvageCoverageCount = candidateStates.reduce(
		(maxCoverage, candidateState) =>
			Math.max(maxCoverage, candidateState.fuzzySalvageCoverageCount),
		0,
	);
	const maxHanFallbackSalvageGroupCount = candidateStates.reduce(
		(maxCoverage, candidateState) =>
			Math.max(maxCoverage, candidateState.hanFallbackSalvageGroupCount),
		0,
	);
	const usedFuzzySalvage =
		includeFuzzy &&
		maxPotentialPrimaryCoverageCount === 0 &&
		maxFuzzySalvageCoverageCount > 0;
	const usedHanFallbackSalvage =
		!usedFuzzySalvage &&
		hasHanGroups &&
		maxPotentialPrimaryCoverageCount === 0 &&
		maxFuzzySalvageCoverageCount === 0 &&
		maxHanFallbackSalvageGroupCount > 0;
	return {
		maxPotentialPrimaryCoverageCount,
		maxFuzzySalvageCoverageCount,
		maxHanFallbackSalvageGroupCount,
		usedFuzzySalvage,
		usedHanFallbackSalvage,
		layerMode: usedHanFallbackSalvage
			? "han_fallback_salvage"
			: usedFuzzySalvage
				? "fuzzy_salvage"
				: "normal",
	};
}

function createCoverageLexicalV2CandidateCascadePruneStageTrace(
	mode: WeakFilePruneMode,
	metric: CoverageLexicalV2WeakFilePruneMetric,
): CoverageLexicalV2WeakFilePruneStageTrace {
	return {
		applied: false,
		mode,
		metric,
		allowedGap: null,
		leaderCount: 0,
		retainedCandidateIds: [],
		droppedCandidateIds: [],
		retainedCandidateCount: 0,
		droppedCandidateCount: 0,
		skippedReason: "none",
	};
}

function createCoverageLexicalV2CandidateCascadePruneStageTraceSet(
	mode: WeakFilePruneMode,
): CoverageLexicalV2CandidateCascadeTrace["pruneStages"] {
	return {
		stageA: createCoverageLexicalV2CandidateCascadePruneStageTrace(
			mode,
			"potential_primary",
		),
		stageB: createCoverageLexicalV2CandidateCascadePruneStageTrace(
			mode,
			"confirmed_primary",
		),
		stageC: createCoverageLexicalV2CandidateCascadePruneStageTrace(
			mode,
			"confirmed_primary",
		),
	};
}

function createCoverageLexicalV2EmptyHanBackstopSourceMetrics():
CoverageLexicalV2HanBackstopSourceMetrics {
	return {
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
	};
}

function applyCoverageLexicalV2HanBackstopMetricsToTrace(
	trace: CoverageLexicalV2CandidateCascadeTrace,
	metrics: CoverageLexicalV2HanBackstopSourceMetrics,
): void {
	trace.pendingHanFrontierCount = metrics.pendingHanFrontierCount;
	trace.hanPromotionDocCount = metrics.hanPromotionDocCount;
	trace.hanPromotionVerifiedDocCount = metrics.hanPromotionVerifiedDocCount;
	trace.bodyHanCandidateBlockCount = metrics.bodyHanCandidateBlockCount;
	trace.bodyHanCandidateSegmentCount = metrics.bodyHanCandidateSegmentCount;
	trace.bodyHanIntersectedBlockCount = metrics.bodyHanIntersectedBlockCount;
	trace.bodyHanColdExactRequestedBlockCount =
		metrics.bodyHanColdExactRequestedBlockCount;
	trace.bodyHanColdExactFetchedBlockCount =
		metrics.bodyHanColdExactFetchedBlockCount;
	trace.bodyHanColdExactByteSum = metrics.bodyHanColdExactByteSum;
	trace.bodyHanColdExactSkippedByBudget =
		metrics.bodyHanColdExactSkippedByBudget;
	trace.bodyHanColdExactSkippedReason =
		metrics.bodyHanColdExactSkippedReason;
	trace.hanPromotionSkippedReason = metrics.hanPromotionSkippedReason;
}

function getCoverageLexicalV2CascadeLayer1Score(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode,
): number {
	switch (layerMode) {
		case "fuzzy_salvage":
			return candidateState.fuzzySalvageCoverageCount;
		case "han_fallback_salvage":
			return candidateState.hanFallbackSalvageGroupCount;
		case "normal":
		default:
			return candidateState.potentialPrimaryCoverageCount;
	}
}

async function resolveCoverageLexicalV2CandidateCascadeLayerOutcome(config: {
	layerName: CoverageLexicalV2CascadeLayerName;
	inputCandidates: readonly CoverageLexicalV2CascadeCandidateState[];
	deferredBuckets: readonly CoverageLexicalV2CascadeCandidateState[][];
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[];
	reader: CoverageLexicalV2CandidateCascadeStorageReader;
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions;
	evidenceByCandidateId: Map<string, CoverageLexicalV2ComparatorEvidence>;
	cheapComparatorCandidateById: Map<string, CoverageLexicalV2ComparatorCandidate>;
	prefetchedBodyHanExactBlockIds: Set<number>;
	policy: CoverageLexicalV2CandidateCascadePolicy;
}): Promise<CoverageLexicalV2CascadeLayerOutcome> {
	const layerCandidates = [...config.inputCandidates];
	const remainingDeferredBuckets = [...config.deferredBuckets];
	await populateCoverageLexicalV2CandidateCascadeEvidence(
		config.evidenceByCandidateId,
		layerCandidates,
		config.queryAnalysis,
		config.candidateCascadePrimaryUnits,
		config.reader,
		config.matchOptions,
		config.prefetchedBodyHanExactBlockIds,
		config.policy,
		false,
	);
	let outcome = narrowCoverageLexicalV2CandidateCascadeLayer({
		layerName: config.layerName,
		candidateStates: layerCandidates,
		evidenceByCandidateId: config.evidenceByCandidateId,
		cheapComparatorCandidateById: config.cheapComparatorCandidateById,
		queryAnalysis: config.queryAnalysis,
		layerMode: config.layerMode,
		returnTarget: config.policy.returnTarget,
	});
	while (outcome.retained.length < config.policy.returnTarget && remainingDeferredBuckets.length > 0) {
		const nextBucket = remainingDeferredBuckets.shift();
		if (!nextBucket || nextBucket.length === 0) {
			break;
		}
		layerCandidates.push(...nextBucket);
		await populateCoverageLexicalV2CandidateCascadeEvidence(
			config.evidenceByCandidateId,
			nextBucket,
			config.queryAnalysis,
			config.candidateCascadePrimaryUnits,
			config.reader,
			config.matchOptions,
			config.prefetchedBodyHanExactBlockIds,
			config.policy,
			false,
		);
		outcome = narrowCoverageLexicalV2CandidateCascadeLayer({
			layerName: config.layerName,
			candidateStates: layerCandidates,
			evidenceByCandidateId: config.evidenceByCandidateId,
			cheapComparatorCandidateById: config.cheapComparatorCandidateById,
			queryAnalysis: config.queryAnalysis,
			layerMode: config.layerMode,
			returnTarget: config.policy.returnTarget,
		});
	}
	return {
		...outcome,
		deferredBuckets: [...outcome.deferredBuckets, ...remainingDeferredBuckets],
	};
}

function narrowCoverageLexicalV2CandidateCascadeLayer(config: {
	layerName: CoverageLexicalV2CascadeLayerName;
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[];
	evidenceByCandidateId: ReadonlyMap<string, CoverageLexicalV2ComparatorEvidence>;
	cheapComparatorCandidateById: Map<string, CoverageLexicalV2ComparatorCandidate>;
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
	returnTarget: number;
}): CoverageLexicalV2CascadeLayerOutcome {
	const entries = buildCoverageLexicalV2CascadeRankingEntries(
		config.queryAnalysis,
		config.candidateStates,
		config.evidenceByCandidateId,
		config.cheapComparatorCandidateById,
		config.layerMode,
	);
	if (entries.length === 0) {
		return {
			retained: [],
			deferredBuckets: [],
			orderedBuckets: [],
		};
	}
	const sortedEntries = [...entries].sort((left, right) =>
		compareCoverageLexicalV2CascadeEntriesByLayer(
			left,
			right,
			config.layerMode,
			config.layerName,
		),
	);
	const orderedBuckets: CoverageLexicalV2CascadeCandidateState[][] = [];
	let currentBucketKey: string | null = null;
	for (const entry of sortedEntries) {
		const bucketKey = createCoverageLexicalV2CascadeLayerBucketKey(
			entry,
			config.layerName,
		);
		if (bucketKey !== currentBucketKey) {
			orderedBuckets.push([]);
			currentBucketKey = bucketKey;
		}
		orderedBuckets[orderedBuckets.length - 1].push(entry.candidateState);
	}
	const retained: CoverageLexicalV2CascadeCandidateState[] = [];
	const deferredBuckets: CoverageLexicalV2CascadeCandidateState[][] = [];
	for (const bucket of orderedBuckets) {
		if (retained.length < config.returnTarget) {
			retained.push(...bucket);
			continue;
		}
		deferredBuckets.push(bucket);
	}
	return {
		retained,
		deferredBuckets,
		orderedBuckets,
	};
}

function buildCoverageLexicalV2CascadeRankingEntries(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	evidenceByCandidateId: ReadonlyMap<string, CoverageLexicalV2ComparatorEvidence>,
	cheapComparatorCandidateById: Map<string, CoverageLexicalV2ComparatorCandidate>,
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode,
): CoverageLexicalV2CascadeRankingEntry[] {
	return candidateStates
		.map<CoverageLexicalV2CascadeRankingEntry | null>((candidateState) => {
			const evidence = evidenceByCandidateId.get(String(candidateState.docId));
			if (!evidence) {
				return null;
			}
			let comparatorCandidate = cheapComparatorCandidateById.get(evidence.candidateId);
			if (!comparatorCandidate) {
				comparatorCandidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, evidence);
				cheapComparatorCandidateById.set(evidence.candidateId, comparatorCandidate);
			}
			return {
				candidateState,
				evidence,
				comparatorCandidate,
				layer1Score: getCoverageLexicalV2CascadeLayer1Score(candidateState, layerMode),
			};
		})
		.filter((entry): entry is CoverageLexicalV2CascadeRankingEntry => entry != null);
}

function compareCoverageLexicalV2CascadeEntriesByLayer(
	left: CoverageLexicalV2CascadeRankingEntry,
	right: CoverageLexicalV2CascadeRankingEntry,
	_layerMode: CoverageLexicalV2CandidateCascadeLayerMode,
	layerName: CoverageLexicalV2CascadeLayerName,
): number {
	const layer1Comparison = right.layer1Score - left.layer1Score;
	if (layer1Comparison !== 0) {
		return layer1Comparison;
	}
	const surfaceComparison = compareCoverageLexicalV2SurfaceCoverageShapes(
		left.comparatorCandidate.surfaceCoverageShape,
		right.comparatorCandidate.surfaceCoverageShape,
	);
	const cheapExactComparison = compareCoverageLexicalV2CheapExactPrimaryContiguity(
		left.comparatorCandidate.cheapExactPrimaryContiguity,
		right.comparatorCandidate.cheapExactPrimaryContiguity,
	);
	if (surfaceComparison !== 0 || cheapExactComparison !== 0 || layerName === "layer2") {
		return firstNonZeroCoverageLexicalV2CascadeComparison([
			surfaceComparison,
			cheapExactComparison,
			left.candidateState.stableDeterministicKey.localeCompare(
				right.candidateState.stableDeterministicKey,
			),
		]);
	}
	const cheapSharedFieldComparison = compareCoverageLexicalV2CheapSharedFieldCoverage(
		left.comparatorCandidate.cheapSharedFieldCoverage,
		right.comparatorCandidate.cheapSharedFieldCoverage,
	);
	const fieldComparison = compareCoverageLexicalV2FieldProfiles(
		left.comparatorCandidate.matchedPrimaryUnitFieldProfile,
		right.comparatorCandidate.matchedPrimaryUnitFieldProfile,
	);
	if (
		cheapSharedFieldComparison !== 0 ||
		fieldComparison !== 0 ||
		layerName === "layer3"
	) {
		return firstNonZeroCoverageLexicalV2CascadeComparison([
			cheapSharedFieldComparison,
			fieldComparison,
			left.candidateState.stableDeterministicKey.localeCompare(
				right.candidateState.stableDeterministicKey,
			),
		]);
	}
	const qualityComparison = compareCoverageLexicalV2PrimaryUnitMatchQuality(
		left.comparatorCandidate.primaryUnitMatchQuality,
		right.comparatorCandidate.primaryUnitMatchQuality,
	);
	if (qualityComparison !== 0) {
		return qualityComparison;
	}
	return left.candidateState.stableDeterministicKey.localeCompare(
		right.candidateState.stableDeterministicKey,
	);
}

function createCoverageLexicalV2CascadeLayerBucketKey(
	entry: CoverageLexicalV2CascadeRankingEntry,
	layerName: CoverageLexicalV2CascadeLayerName,
): string {
	const segments = [
		String(entry.layer1Score),
		serializeCoverageLexicalV2SurfaceCoverageShape(entry.comparatorCandidate.surfaceCoverageShape),
		serializeCoverageLexicalV2CheapExactPrimaryContiguity(
			entry.comparatorCandidate.cheapExactPrimaryContiguity,
		),
	];
	if (layerName === "layer2") {
		return segments.join("|");
	}
	segments.push(
		serializeCoverageLexicalV2CheapSharedFieldCoverage(
			entry.comparatorCandidate.cheapSharedFieldCoverage,
		),
		serializeCoverageLexicalV2MatchedPrimaryUnitFieldProfile(
			entry.comparatorCandidate.matchedPrimaryUnitFieldProfile,
		),
	);
	if (layerName === "layer3") {
		return segments.join("|");
	}
	segments.push(
		serializeCoverageLexicalV2PrimaryUnitMatchQuality(
			entry.comparatorCandidate.primaryUnitMatchQuality,
		),
	);
	return segments.join("|");
}

function buildCoverageLexicalV2ResolvedTopBucketCandidates(
	verificationBucket: readonly CoverageLexicalV2CascadeCandidateState[],
	evidenceByCandidateId: ReadonlyMap<string, CoverageLexicalV2ComparatorEvidence>,
	cheapComparatorCandidateById: ReadonlyMap<string, CoverageLexicalV2ComparatorCandidate>,
	includeProximity: boolean,
): CoverageLexicalV2ComparatorRunCandidate[] {
	const topBucketCandidates = verificationBucket
		.map<CoverageLexicalV2ComparatorRunCandidate | null>((candidateState) => {
			const candidateId = String(candidateState.docId);
			const evidence = evidenceByCandidateId.get(candidateId);
			if (!evidence) {
				return null;
			}
			const cheapComparatorCandidate = cheapComparatorCandidateById.get(candidateId);
			if (!cheapComparatorCandidate) {
				return null;
			}
			return {
				evidence,
				comparatorCandidate: includeProximity
					? patchCoverageLexicalV2ComparatorCandidateWithProximity(
						cheapComparatorCandidate,
						evidence,
					)
					: cheapComparatorCandidate,
			};
		})
		.filter((candidate): candidate is CoverageLexicalV2ComparatorRunCandidate => candidate != null);
	if (!includeProximity) {
		return topBucketCandidates;
	}
	return [...topBucketCandidates].sort((left, right) => {
		const proximityComparison = compareCoverageLexicalV2OptionalPrimaryUnitProximity(
			left.comparatorCandidate.primaryUnitProximityScore ?? null,
			right.comparatorCandidate.primaryUnitProximityScore ?? null,
		);
		if (proximityComparison !== 0) {
			return proximityComparison;
		}
		return left.comparatorCandidate.stableDeterministicKey.localeCompare(
			right.comparatorCandidate.stableDeterministicKey,
		);
	});
}

function assembleCoverageLexicalV2CandidateCascadeOrderedCandidates(
	resolvedTopBucket: readonly CoverageLexicalV2ComparatorRunCandidate[],
	remainingOrderedBuckets: readonly (readonly CoverageLexicalV2CascadeCandidateState[])[],
	evidenceByCandidateId: ReadonlyMap<string, CoverageLexicalV2ComparatorEvidence>,
	cheapComparatorCandidateById: ReadonlyMap<string, CoverageLexicalV2ComparatorCandidate>,
): CoverageLexicalV2ComparatorRunCandidate[] {
	const orderedCandidates = [...resolvedTopBucket];
	for (const bucket of remainingOrderedBuckets) {
		for (const candidateState of bucket) {
			const candidateId = String(candidateState.docId);
			const evidence = evidenceByCandidateId.get(candidateId);
			const comparatorCandidate = cheapComparatorCandidateById.get(candidateId);
			if (!evidence || !comparatorCandidate) {
				continue;
			}
			orderedCandidates.push({
				evidence,
				comparatorCandidate,
			});
		}
	}
	return orderedCandidates;
}

function serializeCoverageLexicalV2SurfaceCoverageShape(
	shape: CoverageLexicalV2SurfaceCoverageShape,
): string {
	return [
		shape.matchedGroupCount,
		shape.totalGroupCount,
		Number(shape.preservesVisibleGrouping),
		Number(shape.preservesCrossScriptCoverage),
	].join(":");
}

function serializeCoverageLexicalV2CheapExactPrimaryContiguity(
	contiguity: CoverageLexicalV2CheapExactPrimaryContiguity | null | undefined,
): string {
	const safeContiguity = normalizeCoverageLexicalV2CheapExactPrimaryContiguity(contiguity);
	return [
		safeContiguity.intactExactSurfaceGroupCount,
		safeContiguity.intactExactPrimaryUnitCount,
		safeContiguity.maxAdjacentExactMatchedPrimaryRunLength,
		safeContiguity.adjacentExactMatchedPrimaryUnitCount,
	].join(":");
}

function serializeCoverageLexicalV2CheapSharedFieldCoverage(
	sharedFieldCoverage: CoverageLexicalV2CheapSharedFieldCoverage | null | undefined,
): string {
	const safeSharedFieldCoverage =
		normalizeCoverageLexicalV2CheapSharedFieldCoverage(sharedFieldCoverage);
	return [
		Number(safeSharedFieldCoverage.coversAllMatchedPrimaryUnitsInOneField),
		safeSharedFieldCoverage.maxDistinctPrimaryUnitsInSameField,
	].join(":");
}

function serializeCoverageLexicalV2MatchedPrimaryUnitFieldProfile(
	fieldProfile: CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
): string {
	return [
		fieldProfile.basenameScore,
		fieldProfile.aliasesScore,
		fieldProfile.headingsScore,
		fieldProfile.folderScore,
		fieldProfile.tagScore,
		fieldProfile.bodyScore,
	].join(":");
}

function serializeCoverageLexicalV2PrimaryUnitMatchQuality(
	matchQuality: CoverageLexicalV2PrimaryUnitMatchQuality,
): string {
	return [
		matchQuality.hanExactCount,
		matchQuality.latinExactCount,
		matchQuality.latinPrefixCount,
		matchQuality.latinFuzzyCount,
	].join(":");
}

function firstNonZeroCoverageLexicalV2CascadeComparison(
	comparisons: readonly number[],
): number {
	for (const comparison of comparisons) {
		if (comparison !== 0) {
			return comparison;
		}
	}
	return 0;
}

function normalizeCoverageLexicalV2CheapExactPrimaryContiguity(
	contiguity: CoverageLexicalV2CheapExactPrimaryContiguity | null | undefined,
): CoverageLexicalV2CheapExactPrimaryContiguity {
	return contiguity ?? {
		intactExactSurfaceGroupCount: 0,
		intactExactPrimaryUnitCount: 0,
		maxAdjacentExactMatchedPrimaryRunLength: 0,
		adjacentExactMatchedPrimaryUnitCount: 0,
	};
}

function normalizeCoverageLexicalV2CheapSharedFieldCoverage(
	sharedFieldCoverage: CoverageLexicalV2CheapSharedFieldCoverage | null | undefined,
): CoverageLexicalV2CheapSharedFieldCoverage {
	return sharedFieldCoverage ?? {
		coversAllMatchedPrimaryUnitsInOneField: false,
		maxDistinctPrimaryUnitsInSameField: 0,
	};
}

function collectCoverageLexicalV2CascadeFallbackMatchedTerms(
	candidateState: CoverageLexicalV2CascadeCandidateState,
): string[] {
	const terms = new Set<string>([
		...candidateState.fieldTerms.basenameTerms,
		...candidateState.fieldTerms.aliasTerms,
		...candidateState.fieldTerms.headingsTerms,
		...candidateState.fieldTerms.folderTerms,
		...candidateState.fieldTerms.tagTerms,
		...candidateState.fieldTerms.bodyTerms,
	]);
	return [...terms].sort((left, right) => left.localeCompare(right));
}

function collectCoverageLexicalV2CascadeHanTopTieBandCandidateIds(
	rankedCandidates: readonly CoverageLexicalV2CascadeCandidateState[],
): string[] {
	if (rankedCandidates.length === 0) {
		return [];
	}
	const leaderScore = rankedCandidates[0].hanFallbackSalvageGroupCount;
	return rankedCandidates
		.filter((candidateState) => candidateState.hanFallbackSalvageGroupCount === leaderScore)
		.map((candidateState) => String(candidateState.docId));
}

function createCoverageLexicalV2TargetedHanDebugTrace(
	queryText: string,
	queryTerms: readonly string[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2TargetedHanDebugTrace {
	const normalizedQueryText = normalizeCoverageLexicalV2Text(queryText).trim();
	const normalizedDebugQuery = devOption.targetedHanDebugQuery
		? normalizeCoverageLexicalV2Text(devOption.targetedHanDebugQuery).trim()
		: "";
	return {
		enabled:
			normalizedDebugQuery.length > 0 &&
			normalizedQueryText === normalizedDebugQuery,
		normalizedQueryText,
		queryText,
		queryTerms,
		readerKind: reader.readerKind,
		enteredHanBackstop: false,
		groups: [],
		metadataCandidates: [],
		bodyGateEvaluations: [],
		bodyGateCappedCandidates: [],
		prefetch: null,
		exactEvaluations: [],
		trackedDocs: new Map<number, string>(),
	};
}

function createCoverageLexicalV2TargetedComparatorDebugTrace(
	queryText: string,
	queryTerms: readonly string[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2TargetedComparatorDebugTrace {
	const normalizedQueryText = normalizeCoverageLexicalV2Text(queryText).trim();
	const normalizedDebugQuery = devOption.targetedComparatorDebugQuery
		? normalizeCoverageLexicalV2Text(devOption.targetedComparatorDebugQuery).trim()
		: "";
	return {
		enabled:
			normalizedDebugQuery.length > 0 &&
			normalizedQueryText === normalizedDebugQuery,
		normalizedQueryText,
		queryText,
		queryTerms,
		readerKind: reader.readerKind,
	};
}

function summarizeCoverageLexicalV2TargetedComparatorQueryAnalysis(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
): Record<string, unknown> {
	return {
		normalizedQueryText: queryAnalysis.normalizedQueryText,
		surfaceShape: { ...queryAnalysis.surfaceShape },
		surfaceGroups: queryAnalysis.surfaceGroups.map((surfaceGroup) => ({
			index: surfaceGroup.index,
			text: surfaceGroup.text,
			normalizedText: surfaceGroup.normalizedText,
			kind: surfaceGroup.kind,
		})),
		primaryUnits: queryAnalysis.primaryUnits.map((queryUnit) => ({
			text: queryUnit.text,
			normalizedText: queryUnit.normalizedText,
			source: queryUnit.source,
			surfaceGroupIndex: queryUnit.surfaceGroupIndex,
			surfaceKind: queryUnit.surfaceKind,
		})),
		fallbackUnits: queryAnalysis.fallbackUnits.map((queryUnit) => ({
			text: queryUnit.text,
			normalizedText: queryUnit.normalizedText,
			source: queryUnit.source,
			surfaceGroupIndex: queryUnit.surfaceGroupIndex,
			surfaceKind: queryUnit.surfaceKind,
		})),
		derivedUnits: queryAnalysis.derivedUnits.map((queryUnit) => ({
			text: queryUnit.text,
			normalizedText: queryUnit.normalizedText,
			source: queryUnit.source,
			surfaceGroupIndex: queryUnit.surfaceGroupIndex,
			surfaceKind: queryUnit.surfaceKind,
		})),
		hanBackstopGroups: queryAnalysis.hanBackstopGroups.map((group) => ({
			surfaceGroupIndex: group.surfaceGroupIndex,
			normalizedText: group.normalizedText,
			bigrams: [...group.bigrams],
			charLength: group.charLength,
			triggerKind: group.triggerKind,
			primaryUnitIndices: [...group.primaryUnitIndices],
		})),
	};
}

function summarizeCoverageLexicalV2TargetedComparatorEvidence(
	evidence: CoverageLexicalV2ComparatorEvidence | null,
): Record<string, unknown> | null {
	if (!evidence) {
		return null;
	}
	return {
		candidateId: evidence.candidateId,
		stableDeterministicKey: evidence.stableDeterministicKey,
		cheapExactWitnessSummary: evidence.cheapExactWitnessSummary
			? {
				intactSurfacePrimaryUnitKeys: [
					...evidence.cheapExactWitnessSummary.intactSurfacePrimaryUnitKeys,
				],
				matchedPrimaryUnitExactWitnesses:
					evidence.cheapExactWitnessSummary.matchedPrimaryUnitExactWitnesses.map(
						(witness) => ({ ...witness }),
					),
				maxAdjacentExactMatchedPrimaryRunLength:
					evidence.cheapExactWitnessSummary.maxAdjacentExactMatchedPrimaryRunLength,
				adjacentExactMatchedPrimaryUnitCount:
					evidence.cheapExactWitnessSummary.adjacentExactMatchedPrimaryUnitCount,
				adjacencyField:
					evidence.cheapExactWitnessSummary.adjacencyField ?? null,
				adjacentExactMatchedPrimaryUnitKeys: [
					...(evidence.cheapExactWitnessSummary
						.adjacentExactMatchedPrimaryUnitKeys ?? []),
				],
			}
			: null,
		matchedPrimaryUnits: evidence.matchedPrimaryUnits.map((matchedUnit) => ({
			normalizedText: matchedUnit.normalizedText,
			surfaceGroupIndex: matchedUnit.surfaceGroupIndex,
			surfaceKind: matchedUnit.surfaceKind,
			strongestField: matchedUnit.strongestField,
			corroboratedFields: matchedUnit.corroboratedFields
				? [...matchedUnit.corroboratedFields]
				: undefined,
			matchQuality: matchedUnit.matchQuality,
			prefixWitnessLite: matchedUnit.prefixWitnessLite
				? { ...matchedUnit.prefixWitnessLite }
				: undefined,
		})),
		bestWindow: evidence.bestWindow
			? {
				field: evidence.bestWindow.field,
				matchedUnitKeys: [...evidence.bestWindow.matchedUnitKeys],
				contiguousSurfaceGroupCount:
					evidence.bestWindow.contiguousSurfaceGroupCount ?? 0,
				windowWidth: evidence.bestWindow.windowWidth,
				averageDistance: evidence.bestWindow.averageDistance,
				preservesSurfaceOrder: evidence.bestWindow.preservesSurfaceOrder,
			}
			: null,
	};
}

function summarizeCoverageLexicalV2TargetedComparatorHanExactDiagnostics(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateState: CoverageLexicalV2CascadeCandidateState | undefined,
	evidence: CoverageLexicalV2ComparatorEvidence | null | undefined,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2TargetedComparatorHanExactDiagnostic[] {
	if (!candidateState) {
		return [];
	}
	const cheapExactPrimaryUnitKeySet = new Set(
		evidence?.cheapExactWitnessSummary?.intactSurfacePrimaryUnitKeys ?? [],
	);
	return queryAnalysis.primaryUnits
		.filter((primaryUnit) => primaryUnit.source === "surface_han_segment")
		.map((primaryUnit) => {
			const hanBackstopGroup = queryAnalysis.hanBackstopGroups.find(
				(group) =>
					group.surfaceGroupIndex === primaryUnit.surfaceGroupIndex &&
					group.normalizedText === primaryUnit.normalizedText,
			);
			const bodyWitness = reader.getBodyHanExactDocumentWitness(
				candidateState.docId,
				primaryUnit.normalizedText,
				hanBackstopGroup?.bigrams ?? [],
			);
			return {
				normalizedText: primaryUnit.normalizedText,
				surfaceGroupIndex: primaryUnit.surfaceGroupIndex,
				metadataExact: {
					basename: candidateState.exactQueryTerms.basenameExactQueryTerms.has(
						primaryUnit.normalizedText,
					),
					aliases: candidateState.exactQueryTerms.aliasExactQueryTerms.has(
						primaryUnit.normalizedText,
					),
					headings: candidateState.exactQueryTerms.headingsExactQueryTerms.has(
						primaryUnit.normalizedText,
					),
				},
				bodyWitness: {
					matched: bodyWitness != null,
					start: bodyWitness?.start ?? null,
					end: bodyWitness?.end ?? null,
				},
				inCheapExactIntactSurfaceKeys: cheapExactPrimaryUnitKeySet.has(
					createCoverageLexicalV2CascadePrimaryUnitKey(
						primaryUnit.surfaceGroupIndex,
						primaryUnit.normalizedText,
					),
				),
			};
		});
}

function summarizeCoverageLexicalV2TargetedComparatorHanExactRawDump(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateState: CoverageLexicalV2CascadeCandidateState | undefined,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2TargetedComparatorHanExactRawDump[] {
	if (!candidateState || !candidateState.sourceFlags.hasBody) {
		return [];
	}
	const maxLoggedBlocks = 4;
	return queryAnalysis.primaryUnits
		.filter((primaryUnit) => primaryUnit.source === "surface_han_segment")
		.map((primaryUnit) => {
			const hanBackstopGroup = queryAnalysis.hanBackstopGroups.find(
				(group) =>
					group.surfaceGroupIndex === primaryUnit.surfaceGroupIndex &&
					group.normalizedText === primaryUnit.normalizedText,
			);
			const bigrams = hanBackstopGroup?.bigrams ?? [];
			const docWitness = reader.getBodyHanExactDocumentWitness(
				candidateState.docId,
				primaryUnit.normalizedText,
				bigrams,
			);
			const allBlockIds = reader.getBodyHanLogicalBlockIds(candidateState.docId) ?? [];
			const blocks: CoverageLexicalV2TargetedComparatorHanExactRawBlockDiagnostic[] = [];
			for (const blockId of allBlockIds.slice(0, maxLoggedBlocks)) {
				const descriptor = reader.getBodyHanLogicalBlockDescriptor(blockId);
				if (!descriptor) {
					continue;
				}
				const blockWitness = reader.getBodyHanExactBlockWitness?.(
					blockId,
					primaryUnit.normalizedText,
					bigrams,
				);
				blocks.push({
					blockId,
					blockOrdinal: descriptor.blockOrdinal,
					symbolCount: descriptor.symbolCount,
					encodedByteLength: descriptor.encodedByteLength,
					stats: reader.getBodyHanExactBlockBackstopStats(
						blockId,
						primaryUnit.normalizedText,
						bigrams,
					),
					witness: {
						matched: blockWitness != null,
						start: blockWitness?.start ?? null,
						end: blockWitness?.end ?? null,
					},
				});
			}
			return {
				normalizedText: primaryUnit.normalizedText,
				surfaceGroupIndex: primaryUnit.surfaceGroupIndex,
				bigrams,
				docWitness: {
					matched: docWitness != null,
					start: docWitness?.start ?? null,
					end: docWitness?.end ?? null,
				},
				blockCount: allBlockIds.length,
				truncatedBlockCount: Math.max(0, allBlockIds.length - blocks.length),
				blocks,
			};
		});
}

function summarizeCoverageLexicalV2TargetedComparatorCandidate(
	candidate: CoverageLexicalV2ComparatorCandidate | null,
): Record<string, unknown> | null {
	if (!candidate) {
		return null;
	}
	const cheapExactPrimaryContiguity =
		normalizeCoverageLexicalV2CheapExactPrimaryContiguity(
			candidate.cheapExactPrimaryContiguity,
		);
	const cheapSharedFieldCoverage =
		normalizeCoverageLexicalV2CheapSharedFieldCoverage(
			candidate.cheapSharedFieldCoverage,
		);
	return {
		candidateId: candidate.candidateId,
		distinctMatchedPrimaryQueryUnitCount:
			candidate.distinctMatchedPrimaryQueryUnitCount,
		surfaceCoverageShape: { ...candidate.surfaceCoverageShape },
		cheapExactPrimaryContiguity,
		cheapSharedFieldCoverage,
		matchedPrimaryUnitFieldProfile: {
			...candidate.matchedPrimaryUnitFieldProfile,
		},
		primaryUnitMatchQuality: { ...candidate.primaryUnitMatchQuality },
		primaryUnitProximityScore: candidate.primaryUnitProximityScore
			? { ...candidate.primaryUnitProximityScore }
			: null,
		stableDeterministicKey: candidate.stableDeterministicKey,
	};
}

function formatCoverageLexicalV2TargetedComparatorCandidateSummary(
	candidate: CoverageLexicalV2ComparatorCandidate | null,
): string {
	if (!candidate) {
		return "missing comparator candidate";
	}
	const cheapExactPrimaryContiguity =
		normalizeCoverageLexicalV2CheapExactPrimaryContiguity(
			candidate.cheapExactPrimaryContiguity,
		);
	const cheapSharedFieldCoverage =
		normalizeCoverageLexicalV2CheapSharedFieldCoverage(
			candidate.cheapSharedFieldCoverage,
		);
	const proximity = candidate.primaryUnitProximityScore;
	return [
		`distinct=${candidate.distinctMatchedPrimaryQueryUnitCount}`,
		`surface=${candidate.surfaceCoverageShape.matchedGroupCount}/${candidate.surfaceCoverageShape.totalGroupCount}` +
			` vg=${Number(candidate.surfaceCoverageShape.preservesVisibleGrouping)}` +
			` xs=${Number(candidate.surfaceCoverageShape.preservesCrossScriptCoverage)}`,
		`cheapExact=groups${cheapExactPrimaryContiguity.intactExactSurfaceGroupCount}` +
			` units${cheapExactPrimaryContiguity.intactExactPrimaryUnitCount}` +
			` run${cheapExactPrimaryContiguity.maxAdjacentExactMatchedPrimaryRunLength}` +
			` adj${cheapExactPrimaryContiguity.adjacentExactMatchedPrimaryUnitCount}`,
		`sharedField=all${Number(cheapSharedFieldCoverage.coversAllMatchedPrimaryUnitsInOneField)}` +
			` max${cheapSharedFieldCoverage.maxDistinctPrimaryUnitsInSameField}`,
		`field=b${candidate.matchedPrimaryUnitFieldProfile.basenameScore}` +
			` a${candidate.matchedPrimaryUnitFieldProfile.aliasesScore}` +
			` h${candidate.matchedPrimaryUnitFieldProfile.headingsScore}` +
			` f${candidate.matchedPrimaryUnitFieldProfile.folderScore}` +
			` t${candidate.matchedPrimaryUnitFieldProfile.tagScore}` +
			` body${candidate.matchedPrimaryUnitFieldProfile.bodyScore}`,
		`quality=han${candidate.primaryUnitMatchQuality.hanExactCount}` +
			` lex${candidate.primaryUnitMatchQuality.latinExactCount}` +
			` pref${candidate.primaryUnitMatchQuality.latinPrefixCount}` +
			` fuzzy${candidate.primaryUnitMatchQuality.latinFuzzyCount}`,
		`proximity=${
			proximity
				? `units${proximity.matchedUnitCount}` +
					` order${Number(proximity.preservesSurfaceOrder)}` +
					` contiguous${proximity.contiguousSurfaceGroupCount ?? 0}` +
					` width${proximity.windowWidth}` +
					` avg${proximity.averageDistance}`
				: "null"
		}`,
	].join(" | ");
}

function formatCoverageLexicalV2TargetedComparatorDebugSummary(config: {
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	orderedCandidates: readonly CoverageLexicalV2ComparatorRunCandidate[];
	orderedPairwiseDecisions: ReadonlyArray<{
		leftRank: number;
		leftCandidateId: string;
		leftPath: string;
		rightRank: number;
		rightCandidateId: string;
		rightPath: string;
		decision: ReturnType<typeof explainCoverageLexicalV2ComparatorDecision>;
		leftComparatorCandidate: Record<string, unknown> | null;
		rightComparatorCandidate: Record<string, unknown> | null;
	}>;
	candidateStateById: ReadonlyMap<string, CoverageLexicalV2CascadeCandidateState>;
	reader: CoverageLexicalV2CandidateCascadeStorageReader;
}): string {
	const lines: string[] = [];
	lines.push(
		`query=${config.queryAnalysis.normalizedQueryText} primaryUnits=` +
			config.queryAnalysis.primaryUnits
				.map(
					(queryUnit) =>
						`${queryUnit.normalizedText}@g${queryUnit.surfaceGroupIndex}:${queryUnit.source}`,
				)
				.join(", "),
	);
	for (const [index, candidate] of config.orderedCandidates.slice(0, 4).entries()) {
		const candidateId = candidate.evidence.candidateId;
		const candidateState = config.candidateStateById.get(candidateId);
		lines.push(
			`rank${index + 1} ${candidateState?.path ?? candidateId} :: ` +
				formatCoverageLexicalV2TargetedComparatorCandidateSummary(
					candidate.comparatorCandidate,
				),
		);
		const hanExactDiagnostics =
			summarizeCoverageLexicalV2TargetedComparatorHanExactDiagnostics(
				config.queryAnalysis,
				candidateState,
				candidate.evidence,
				config.reader,
			);
		for (const diagnostic of hanExactDiagnostics) {
			lines.push(
				`  hanExact ${diagnostic.normalizedText}@g${diagnostic.surfaceGroupIndex} :: ` +
					`meta(b=${Number(diagnostic.metadataExact.basename)}` +
					` a=${Number(diagnostic.metadataExact.aliases)}` +
					` h=${Number(diagnostic.metadataExact.headings)}) ` +
					`body(m=${Number(diagnostic.bodyWitness.matched)}` +
					` start=${diagnostic.bodyWitness.start ?? "null"}` +
					` end=${diagnostic.bodyWitness.end ?? "null"}) ` +
					`cheapKey=${Number(diagnostic.inCheapExactIntactSurfaceKeys)}`,
			);
		}
		const exactWitnessSummary = candidate.evidence.cheapExactWitnessSummary;
		if (exactWitnessSummary) {
			const witnessesByField = new Map<
				CoverageLexicalV2CheapExactContinuityField,
				string[]
			>();
			for (const witness of exactWitnessSummary.matchedPrimaryUnitExactWitnesses) {
				const entries = witnessesByField.get(witness.field) ?? [];
				entries.push(`${witness.unitKey}@${witness.start}-${witness.end}`);
				witnessesByField.set(witness.field, entries);
			}
			lines.push(
				`  cheapExactSummary :: intact=${
					exactWitnessSummary.intactSurfacePrimaryUnitKeys.length > 0
						? exactWitnessSummary.intactSurfacePrimaryUnitKeys.join(",")
						: "-"
				} adjacencyField=${exactWitnessSummary.adjacencyField ?? "-"}` +
					` run=${exactWitnessSummary.maxAdjacentExactMatchedPrimaryRunLength}` +
					` adjUnits=${exactWitnessSummary.adjacentExactMatchedPrimaryUnitCount}` +
					` adjKeys=${
						(exactWitnessSummary.adjacentExactMatchedPrimaryUnitKeys ?? []).length > 0
							? exactWitnessSummary.adjacentExactMatchedPrimaryUnitKeys?.join(",")
							: "-"
					}`,
			);
			for (const field of CHEAP_EXACT_FIELDS) {
				const entries = witnessesByField.get(field);
				if (!entries || entries.length === 0) {
					continue;
				}
				lines.push(`    exactWitness ${field} :: ${entries.join(" | ")}`);
			}
		}
		const hanExactRawDump =
			summarizeCoverageLexicalV2TargetedComparatorHanExactRawDump(
				config.queryAnalysis,
				candidateState,
				config.reader,
			);
		for (const rawDump of hanExactRawDump) {
			lines.push(
				`  hanExactRaw ${rawDump.normalizedText}@g${rawDump.surfaceGroupIndex} :: ` +
					`docWitness(m=${Number(rawDump.docWitness.matched)}` +
					` start=${rawDump.docWitness.start ?? "null"}` +
					` end=${rawDump.docWitness.end ?? "null"}) ` +
					`bigrams=${rawDump.bigrams.length > 0 ? rawDump.bigrams.join("/") : "-"}` +
					` blocks=${rawDump.blockCount}` +
					` truncated=${rawDump.truncatedBlockCount}` +
					` gateOnly=${Number(
						!rawDump.docWitness.matched &&
							rawDump.blocks.some((block) => block.stats != null),
					)}`,
			);
			for (const block of rawDump.blocks) {
				lines.push(
					`    block#${block.blockId}@ord${block.blockOrdinal} ` +
						`symbols=${block.symbolCount} bytes=${block.encodedByteLength} ` +
						`stats(chain=${block.stats?.longestContiguousBigramChain ?? "null"}` +
						` matched=${block.stats?.matchedBigramCount ?? "null"}` +
						` ratio=${block.stats?.bigramCoverageRatio?.toFixed(3) ?? "null"}) ` +
						`witness(m=${Number(block.witness.matched)}` +
						` start=${block.witness.start ?? "null"}` +
						` end=${block.witness.end ?? "null"})`,
				);
			}
		}
	}
	for (const item of config.orderedPairwiseDecisions) {
		lines.push(
			`pair ${item.leftRank}>${item.rightRank} winner=${item.decision.winnerCandidateId ?? "tie"} ` +
				`layer=${item.decision.layer} reason=${item.decision.reason} :: ` +
				`${item.leftPath} > ${item.rightPath}`,
		);
	}
	return lines.join("\n");
}

function resolveCoverageLexicalV2TargetedComparatorCandidateOutcome(
	candidateId: string,
	trace: CoverageLexicalV2CandidateCascadeTrace,
	candidateState: CoverageLexicalV2CascadeCandidateState | undefined,
	layer1Ids: ReadonlySet<string>,
	layer2Ids: ReadonlySet<string>,
	layer3Ids: ReadonlySet<string>,
	layer4Ids: ReadonlySet<string>,
	verificationIds: ReadonlySet<string>,
	resolvedIds: ReadonlySet<string>,
	visibleIds: ReadonlySet<string>,
	stageADroppedIds: ReadonlySet<string>,
	stageBDroppedIds: ReadonlySet<string>,
	stageCDroppedIds: ReadonlySet<string>,
): string {
	if (visibleIds.has(candidateId)) {
		return "visible";
	}
	if (candidateState && resolvedIds.has(candidateId)) {
		return "resolved_but_hidden_by_display";
	}
	if (candidateState && verificationIds.has(candidateId)) {
		return "verification_bucket_but_not_resolved";
	}
	if (candidateState && layer4Ids.has(candidateId)) {
		return "not_in_top_verification_bucket";
	}
	if (stageCDroppedIds.has(candidateId)) {
		return "dropped_at_stageC";
	}
	if (candidateState && layer3Ids.has(candidateId)) {
		return "dropped_at_layer4";
	}
	if (stageBDroppedIds.has(candidateId)) {
		return "dropped_at_stageB";
	}
	if (candidateState && layer2Ids.has(candidateId)) {
		return "dropped_at_layer3";
	}
	if (stageADroppedIds.has(candidateId)) {
		return "dropped_at_stageA";
	}
	if (candidateState && layer1Ids.has(candidateId)) {
		return "dropped_at_layer2";
	}
	if (candidateState) {
		return "dropped_before_layer1";
	}
	return "never_materialized_candidate";
}

function finalizeCoverageLexicalV2TargetedComparatorDebugTrace(config: {
	targetedComparatorDebug: CoverageLexicalV2TargetedComparatorDebugTrace;
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[];
	trace: CoverageLexicalV2CandidateCascadeTrace;
	orderedCandidates: readonly CoverageLexicalV2ComparatorRunCandidate[];
	resolvedTopBucket: readonly CoverageLexicalV2ComparatorRunCandidate[];
	topTieBand: readonly CoverageLexicalV2ComparatorCandidate[];
	visibleCandidateIds: readonly string[];
	candidateStateById?: ReadonlyMap<string, CoverageLexicalV2CascadeCandidateState>;
	reader: CoverageLexicalV2CandidateCascadeStorageReader;
}): void {
	if (!config.targetedComparatorDebug.enabled) {
		return;
	}
	const maxLoggedCandidates = 6;
	const stateById =
		config.candidateStateById ??
		new Map(
			config.candidateStates.map((candidateState) => [
				String(candidateState.docId),
				candidateState,
			] as const),
		);
	const orderedCandidateById = new Map(
		config.orderedCandidates.map((candidate) => [candidate.evidence.candidateId, candidate] as const),
	);
	const layer1Ids = new Set(config.trace.retainedCandidateIdsByLayer.layer1);
	const layer2Ids = new Set(config.trace.retainedCandidateIdsByLayer.layer2);
	const layer3Ids = new Set(config.trace.retainedCandidateIdsByLayer.layer3);
	const layer4Ids = new Set(config.trace.retainedCandidateIdsByLayer.layer4);
	const verificationIds = new Set(config.trace.verificationBucketCandidateIds);
	const resolvedIds = new Set(config.trace.resolvedTopBucketCandidateIds);
	const visibleIds = new Set(config.visibleCandidateIds);
	const stageADroppedIds = new Set(config.trace.pruneStages.stageA.droppedCandidateIds);
	const stageBDroppedIds = new Set(config.trace.pruneStages.stageB.droppedCandidateIds);
	const stageCDroppedIds = new Set(config.trace.pruneStages.stageC.droppedCandidateIds);
	const topTieBandIds = config.topTieBand.map((candidate) => candidate.candidateId);

	const summarizeCandidate = (
		candidateId: string,
		rank: number,
		runCandidate: CoverageLexicalV2ComparatorRunCandidate | undefined,
	): Record<string, unknown> => {
		const candidateState = stateById.get(candidateId);
		return {
			rank,
			candidateId,
			path: candidateState?.path ?? candidateId,
			outcome: resolveCoverageLexicalV2TargetedComparatorCandidateOutcome(
				candidateId,
				config.trace,
				candidateState,
				layer1Ids,
				layer2Ids,
				layer3Ids,
				layer4Ids,
				verificationIds,
				resolvedIds,
				visibleIds,
				stageADroppedIds,
				stageBDroppedIds,
				stageCDroppedIds,
			),
			sourceFlags: candidateState?.sourceFlags ?? null,
			potentialPrimaryCoverageCount:
				candidateState?.potentialPrimaryCoverageCount ?? null,
			fuzzySalvageCoverageCount:
				candidateState?.fuzzySalvageCoverageCount ?? null,
			hanFallbackSalvageGroupCount:
				candidateState?.hanFallbackSalvageGroupCount ?? null,
			needsVerification: candidateState?.needsVerification ?? null,
			inVerificationBucket: verificationIds.has(candidateId),
			inResolvedTopBucket: resolvedIds.has(candidateId),
			inTopTieBand: topTieBandIds.includes(candidateId),
			comparatorCandidate: summarizeCoverageLexicalV2TargetedComparatorCandidate(
				runCandidate?.comparatorCandidate ?? null,
			),
			evidence: summarizeCoverageLexicalV2TargetedComparatorEvidence(
				runCandidate?.evidence ?? null,
			),
			hanExactDiagnostics:
				summarizeCoverageLexicalV2TargetedComparatorHanExactDiagnostics(
					config.queryAnalysis,
					candidateState,
					runCandidate?.evidence ?? null,
					config.reader,
				),
			hanExactRawDump:
				summarizeCoverageLexicalV2TargetedComparatorHanExactRawDump(
					config.queryAnalysis,
					candidateState,
					config.reader,
				),
		};
	};

	const orderedCandidatesTop = config.orderedCandidates
		.slice(0, maxLoggedCandidates)
		.map((candidate, index) =>
			summarizeCandidate(candidate.evidence.candidateId, index + 1, candidate),
		);
	const visibleCandidates = config.visibleCandidateIds
		.slice(0, maxLoggedCandidates)
		.map((candidateId, index) =>
			summarizeCandidate(candidateId, index + 1, orderedCandidateById.get(candidateId)),
		);
	const resolvedTopBucket = config.resolvedTopBucket
		.slice(0, maxLoggedCandidates)
		.map((candidate, index) =>
			summarizeCandidate(candidate.evidence.candidateId, index + 1, candidate),
		);
	const resolvedTopBucketPairwiseDecisions = config.resolvedTopBucket
		.slice(0, maxLoggedCandidates)
		.slice(0, -1)
		.map((leftCandidate, index) => {
			const rightCandidate = config.resolvedTopBucket[index + 1];
			const decision = explainCoverageLexicalV2ComparatorDecision(
				leftCandidate.comparatorCandidate,
				rightCandidate.comparatorCandidate,
			);
			const leftId = leftCandidate.evidence.candidateId;
			const rightId = rightCandidate.evidence.candidateId;
			return {
				leftCandidateId: leftId,
				leftPath: stateById.get(leftId)?.path ?? leftId,
				rightCandidateId: rightId,
				rightPath: stateById.get(rightId)?.path ?? rightId,
				decision,
				leftComparatorCandidate:
					summarizeCoverageLexicalV2TargetedComparatorCandidate(
						leftCandidate.comparatorCandidate,
					),
				rightComparatorCandidate:
					summarizeCoverageLexicalV2TargetedComparatorCandidate(
						rightCandidate.comparatorCandidate,
					),
			};
		});
	const orderedPairwiseDecisions = config.orderedCandidates
		.slice(0, maxLoggedCandidates)
		.slice(0, -1)
		.map((leftCandidate, index) => {
			const rightCandidate = config.orderedCandidates[index + 1];
			const decision = explainCoverageLexicalV2ComparatorDecision(
				leftCandidate.comparatorCandidate,
				rightCandidate.comparatorCandidate,
			);
			const leftId = leftCandidate.evidence.candidateId;
			const rightId = rightCandidate.evidence.candidateId;
			return {
				leftRank: index + 1,
				leftCandidateId: leftId,
				leftPath: stateById.get(leftId)?.path ?? leftId,
				rightRank: index + 2,
				rightCandidateId: rightId,
				rightPath: stateById.get(rightId)?.path ?? rightId,
				decision,
				leftComparatorCandidate:
					summarizeCoverageLexicalV2TargetedComparatorCandidate(
						leftCandidate.comparatorCandidate,
					),
				rightComparatorCandidate:
					summarizeCoverageLexicalV2TargetedComparatorCandidate(
						rightCandidate.comparatorCandidate,
					),
			};
		});
	const textSummary = formatCoverageLexicalV2TargetedComparatorDebugSummary({
		queryAnalysis: config.queryAnalysis,
		orderedCandidates: config.orderedCandidates,
		orderedPairwiseDecisions,
		candidateStateById: stateById,
		reader: config.reader,
	});

	logger.debug("[clever-search] targeted comparator debug", {
		queryText: config.targetedComparatorDebug.queryText,
		normalizedQueryText: config.targetedComparatorDebug.normalizedQueryText,
		queryTerms: config.targetedComparatorDebug.queryTerms,
		readerKind: config.targetedComparatorDebug.readerKind,
		queryAnalysis: summarizeCoverageLexicalV2TargetedComparatorQueryAnalysis(
			config.queryAnalysis,
		),
		cascadeSummary: {
			layerMode: config.trace.layerMode,
			verificationSkippedReason: config.trace.verificationSkippedReason,
			verificationBucketCandidateIds: [...config.trace.verificationBucketCandidateIds],
			resolvedTopBucketCandidateIds: [...config.trace.resolvedTopBucketCandidateIds],
			topTieBandCandidateIds: topTieBandIds,
			retainedCandidateIdsByLayer: {
				layer1: [...config.trace.retainedCandidateIdsByLayer.layer1],
				layer2: [...config.trace.retainedCandidateIdsByLayer.layer2],
				layer3: [...config.trace.retainedCandidateIdsByLayer.layer3],
				layer4: [...config.trace.retainedCandidateIdsByLayer.layer4],
			},
			deferredCandidateIdsByLayer: {
				layer1: [...config.trace.deferredCandidateIdsByLayer.layer1],
				layer2: [...config.trace.deferredCandidateIdsByLayer.layer2],
				layer3: [...config.trace.deferredCandidateIdsByLayer.layer3],
				layer4: [...config.trace.deferredCandidateIdsByLayer.layer4],
			},
		},
		orderedCandidatesTop,
		visibleCandidates,
		resolvedTopBucket,
		resolvedTopBucketPairwiseDecisions,
		orderedPairwiseDecisions,
	});
	logger.debug(`[clever-search] targeted comparator debug summary\n${textSummary}`);
}

function recordCoverageLexicalV2TargetedHanDebugGroup(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	activated: boolean,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	targetedHanDebug.groups.push({
		surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
		normalizedText: hanBackstopGroup.normalizedText,
		triggerKind: hanBackstopGroup.triggerKind,
		bigrams: hanBackstopGroup.bigrams,
		activated,
	});
}

function recordCoverageLexicalV2TargetedHanDebugMetadataCandidates(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	rankedCandidates: readonly CoverageLexicalV2HanBackstopRankedCandidate[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	for (const candidate of rankedCandidates) {
		const path = reader.getDocumentRecord(candidate.docId)?.path ?? String(candidate.docId);
		targetedHanDebug.trackedDocs.set(candidate.docId, path);
		targetedHanDebug.metadataCandidates.push({
			surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
			normalizedText: hanBackstopGroup.normalizedText,
			docId: candidate.docId,
			path,
			stats: candidate.stats,
		});
	}
}

function recordCoverageLexicalV2TargetedHanDebugBodyGateEvaluation(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	docId: number,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	stats: CoverageLexicalV2CandidateCascadeHanBackstopStats | null,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	const path = reader.getDocumentRecord(docId)?.path ?? String(docId);
	targetedHanDebug.trackedDocs.set(docId, path);
	targetedHanDebug.bodyGateEvaluations.push({
		surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
		normalizedText: hanBackstopGroup.normalizedText,
		docId,
		path,
		matched: stats != null,
		stats,
	});
}

function recordCoverageLexicalV2TargetedHanDebugBodyGateCappedCandidates(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	candidates: readonly CoverageLexicalV2PendingHanCandidate[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	targetedHanDebug.bodyGateCappedCandidates = candidates.map((candidate) => {
		const path = reader.getDocumentRecord(candidate.docId)?.path ?? String(candidate.docId);
		targetedHanDebug.trackedDocs.set(candidate.docId, path);
		return {
			docId: candidate.docId,
			path,
			normalizedText: candidate.normalizedText,
			surfaceGroupIndex: candidate.surfaceGroupIndex,
			stats: candidate.stats,
		};
	});
}

function recordCoverageLexicalV2TargetedHanDebugPrefetch(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	requestedBlockIds: readonly number[],
	prefetch: CoverageLexicalV2CandidateCascadeHanExactPrefetchResult,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	const blockResults = (prefetch.blockResults ?? prefetch.docResults ?? []).map(
		(blockResult) => ({ ...blockResult }),
	);
	const blockStatusCounts = blockResults.reduce<Record<string, number>>((counts, blockResult) => {
		counts[blockResult.status] = (counts[blockResult.status] ?? 0) + 1;
		return counts;
	}, {});
	targetedHanDebug.prefetch = {
		requestedBlockIds: [...requestedBlockIds],
		fetchedBlockIds: [...(prefetch.fetchedBlockIds ?? prefetch.fetchedDocIds ?? [])],
		fetchedBlockCount:
			prefetch.fetchedBlockCount ?? prefetch.fetchedDocCount ?? 0,
		byteSum: prefetch.byteSum,
		skippedByBudget: prefetch.skippedByBudget,
		skippedReason: prefetch.skippedReason,
		blockStatusCounts,
		blockResults,
	};
}

function recordCoverageLexicalV2TargetedHanDebugExactEvaluation(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	candidate: CoverageLexicalV2PendingHanCandidate,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	wasPrefetched: boolean,
	stats: CoverageLexicalV2CandidateCascadeHanBackstopStats | null,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	const descriptor =
		candidate.bodyLogicalBlockId == null
			? null
			: reader.getBodyHanLogicalBlockDescriptor(candidate.bodyLogicalBlockId);
	const path =
		descriptor?.path ??
		reader.getDocumentRecord(candidate.docId)?.path ??
		String(candidate.docId);
	targetedHanDebug.trackedDocs.set(candidate.docId, path);
	targetedHanDebug.exactEvaluations.push({
		docId: candidate.docId,
		path,
		normalizedText: candidate.normalizedText,
		surfaceGroupIndex: candidate.surfaceGroupIndex,
		status:
			stats != null
				? "verified"
				: wasPrefetched
					? "exact_miss_after_prefetch"
					: "not_prefetched_or_budget_skipped",
		stats,
	});
}

function finalizeCoverageLexicalV2TargetedHanDebugTrace(
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	trace: CoverageLexicalV2CandidateCascadeTrace,
	visibleCandidateIds: readonly string[],
	candidateStateById?: ReadonlyMap<string, CoverageLexicalV2CascadeCandidateState>,
): void {
	if (!targetedHanDebug.enabled) {
		return;
	}
	const stateById =
		candidateStateById ??
		new Map(
			candidateStates.map((candidateState) => [
				String(candidateState.docId),
				candidateState,
			] as const),
		);
	const layer1Ids = new Set(trace.retainedCandidateIdsByLayer.layer1);
	const layer2Ids = new Set(trace.retainedCandidateIdsByLayer.layer2);
	const layer3Ids = new Set(trace.retainedCandidateIdsByLayer.layer3);
	const layer4Ids = new Set(trace.retainedCandidateIdsByLayer.layer4);
	const verificationIds = new Set(trace.verificationBucketCandidateIds);
	const resolvedIds = new Set(trace.resolvedTopBucketCandidateIds);
	const visibleIds = new Set(visibleCandidateIds);
	const stageADroppedIds = new Set(trace.pruneStages.stageA.droppedCandidateIds);
	const stageBDroppedIds = new Set(trace.pruneStages.stageB.droppedCandidateIds);
	const stageCDroppedIds = new Set(trace.pruneStages.stageC.droppedCandidateIds);
	const trackedDocs = [...targetedHanDebug.trackedDocs.entries()].map(([docId, path]) => {
		const candidateId = String(docId);
		const candidateState = stateById.get(candidateId);
		let outcome = "never_materialized_candidate";
		if (visibleIds.has(candidateId)) {
			outcome = "visible";
		} else if (candidateState && resolvedIds.has(candidateId)) {
			outcome = "resolved_but_hidden_by_display";
		} else if (candidateState && verificationIds.has(candidateId)) {
			outcome = "verification_bucket_but_not_resolved";
		} else if (candidateState && layer4Ids.has(candidateId)) {
			outcome = "not_in_top_verification_bucket";
		} else if (stageCDroppedIds.has(candidateId)) {
			outcome = "dropped_at_stageC";
		} else if (candidateState && layer3Ids.has(candidateId)) {
			outcome = "dropped_at_layer4";
		} else if (stageBDroppedIds.has(candidateId)) {
			outcome = "dropped_at_stageB";
		} else if (candidateState && layer2Ids.has(candidateId)) {
			outcome = "dropped_at_layer3";
		} else if (stageADroppedIds.has(candidateId)) {
			outcome = "dropped_at_stageA";
		} else if (candidateState && layer1Ids.has(candidateId)) {
			outcome = "dropped_at_layer2";
		} else if (candidateState) {
			outcome = "dropped_before_layer1";
		}
		return {
			docId,
			path,
			outcome,
			sourceFlags: candidateState?.sourceFlags ?? null,
			potentialPrimaryCoverageCount:
				candidateState?.potentialPrimaryCoverageCount ?? null,
			fuzzySalvageCoverageCount:
				candidateState?.fuzzySalvageCoverageCount ?? null,
			hanFallbackSalvageGroupCount:
				candidateState?.hanFallbackSalvageGroupCount ?? null,
			exactPrimaryUnitIndices: candidateState
				? [...candidateState.exactPrimaryMask].sort((left, right) => left - right)
				: null,
			prefixPrimaryUnitIndices: candidateState
				? [...candidateState.prefixPrimaryMask].sort((left, right) => left - right)
				: null,
			bodyExactQueryTerms: candidateState
				? [...candidateState.exactQueryTerms.bodyExactQueryTerms]
				: null,
			bodyMatchedTerms: candidateState ? [...candidateState.fieldTerms.bodyTerms] : null,
			needsVerification: candidateState?.needsVerification ?? null,
			inLayer1: layer1Ids.has(candidateId),
			inLayer2: layer2Ids.has(candidateId),
			inLayer3: layer3Ids.has(candidateId),
			inLayer4: layer4Ids.has(candidateId),
			inVerificationBucket: verificationIds.has(candidateId),
			inResolvedTopBucket: resolvedIds.has(candidateId),
			inVisibleResults: visibleIds.has(candidateId),
		};
	});
	targetedHanDebug.finalSummary = {
		candidateStateCount: candidateStates.length,
		trace,
		trackedDocs,
	};
	logger.debug("[clever-search] targeted Han debug", {
		queryText: targetedHanDebug.queryText,
		normalizedQueryText: targetedHanDebug.normalizedQueryText,
		queryTerms: targetedHanDebug.queryTerms,
		readerKind: targetedHanDebug.readerKind,
		enteredHanBackstop: targetedHanDebug.enteredHanBackstop,
		groups: targetedHanDebug.groups,
		metadataCandidates: targetedHanDebug.metadataCandidates,
		bodyGateEvaluations: targetedHanDebug.bodyGateEvaluations,
		bodyGateCappedCandidates: targetedHanDebug.bodyGateCappedCandidates,
		prefetch: targetedHanDebug.prefetch,
		exactEvaluations: targetedHanDebug.exactEvaluations,
		finalSummary: targetedHanDebug.finalSummary,
	});
}

function buildCoverageLexicalV2CandidateCascadePrimaryUnits(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	lexicalPrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
): CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[] {
	const candidateCascadePrimaryUnits = [...lexicalPrimaryUnits];
	const seenUnitKeys = new Set(
		candidateCascadePrimaryUnits.map((primaryUnit) =>
			createCoverageLexicalV2CascadePrimaryUnitKey(
				primaryUnit.surfaceGroupIndex,
				primaryUnit.normalizedText,
			),
		),
	);
	for (const hanBackstopGroup of queryAnalysis.hanBackstopGroups) {
		const unitKey = createCoverageLexicalV2CascadePrimaryUnitKey(
			hanBackstopGroup.surfaceGroupIndex,
			hanBackstopGroup.normalizedText,
		);
		if (seenUnitKeys.has(unitKey)) {
			continue;
		}
		candidateCascadePrimaryUnits.push({
			normalizedText: hanBackstopGroup.normalizedText,
			surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
			surfaceKind: "han",
		});
		seenUnitKeys.add(unitKey);
	}
	return candidateCascadePrimaryUnits;
}

function buildCoverageLexicalV2ComparatorQueryAnalysis(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
): CoverageLexicalV2QueryAnalysis {
	if (queryAnalysis.hanBackstopGroups.length === 0) {
		return queryAnalysis;
	}
	const existingUnitKeys = new Set(
		queryAnalysis.primaryUnits.map((primaryUnit) =>
			createCoverageLexicalV2CascadePrimaryUnitKey(
				primaryUnit.surfaceGroupIndex,
				primaryUnit.normalizedText,
			),
		),
	);
	const syntheticPrimaryUnits: CoverageLexicalV2QueryUnit[] = [];
	for (const hanBackstopGroup of queryAnalysis.hanBackstopGroups) {
		const unitKey = createCoverageLexicalV2CascadePrimaryUnitKey(
			hanBackstopGroup.surfaceGroupIndex,
			hanBackstopGroup.normalizedText,
		);
		if (existingUnitKeys.has(unitKey)) {
			continue;
		}
		syntheticPrimaryUnits.push({
			text: hanBackstopGroup.normalizedText,
			normalizedText: hanBackstopGroup.normalizedText,
			tier: "primary",
			source: "derived",
			surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
			surfaceKind: "han",
		});
		existingUnitKeys.add(unitKey);
	}
	if (syntheticPrimaryUnits.length === 0) {
		return queryAnalysis;
	}
	return {
		...queryAnalysis,
		primaryUnits: [...queryAnalysis.primaryUnits, ...syntheticPrimaryUnits],
	};
}

function finalizeCoverageLexicalV2CascadeCandidateStates(
	candidateStateByDocId: ReadonlyMap<number, CoverageLexicalV2CascadeCandidateState>,
): CoverageLexicalV2CascadeCandidateState[] {
	return [...candidateStateByDocId.values()]
		.map((candidateState) => finalizeCoverageLexicalV2CascadeCandidateState(candidateState))
		.sort((left, right) =>
			left.stableDeterministicKey.localeCompare(right.stableDeterministicKey),
		);
}

function resolveCoverageLexicalV2WeakFilePruneGap(
	mode: WeakFilePruneMode,
	stageName: CoverageLexicalV2WeakFilePruneStageName,
): number | null {
	if (mode === "off") {
		return null;
	}
	if (stageName === "stageA") {
		return mode === "strict" ? 1 : 2;
	}
	return mode === "strict" ? 0 : 1;
}

function finalizeCoverageLexicalV2WeakFilePruneStageTrace(
	trace: CoverageLexicalV2WeakFilePruneStageTrace,
	retainedCandidateIds: readonly string[],
	droppedCandidateIds: readonly string[],
): CoverageLexicalV2WeakFilePruneStageTrace {
	trace.retainedCandidateIds = [...retainedCandidateIds];
	trace.droppedCandidateIds = [...droppedCandidateIds];
	trace.retainedCandidateCount = retainedCandidateIds.length;
	trace.droppedCandidateCount = droppedCandidateIds.length;
	return trace;
}

function applyCoverageLexicalV2WeakFilePruneByPotential(config: {
	mode: WeakFilePruneMode;
	candidateStateByDocId: Map<number, CoverageLexicalV2CascadeCandidateState>;
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[];
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
	stageName: CoverageLexicalV2WeakFilePruneStageName;
}): CoverageLexicalV2WeakFilePruneStageTrace {
	const trace = createCoverageLexicalV2CandidateCascadePruneStageTrace(
		config.mode,
		"potential_primary",
	);
	const allCandidateIds = config.candidateStates.map((candidateState) =>
		String(candidateState.docId),
	);
	if (config.mode === "off") {
		trace.skippedReason = "mode_off";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	if (config.candidateStates.length === 0) {
		trace.skippedReason = "no_candidates";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, [], []);
	}
	if (config.layerMode !== "normal") {
		trace.skippedReason = "non_normal_layer_mode";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	const leaderCount = config.candidateStates.reduce(
		(maxCount, candidateState) =>
			Math.max(maxCount, candidateState.potentialPrimaryCoverageCount),
		0,
	);
	trace.leaderCount = leaderCount;
	if (leaderCount <= 0) {
		trace.skippedReason = "no_positive_leader";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	const allowedGap = resolveCoverageLexicalV2WeakFilePruneGap(
		config.mode,
		config.stageName,
	);
	trace.allowedGap = allowedGap;
	if (allowedGap == null) {
		trace.skippedReason = "mode_off";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	trace.applied = true;
	const minAllowedCount = Math.max(0, leaderCount - allowedGap);
	const retainedCandidateIds: string[] = [];
	const droppedCandidateIds: string[] = [];
	for (const candidateState of config.candidateStates) {
		const candidateId = String(candidateState.docId);
		if (candidateState.potentialPrimaryCoverageCount >= minAllowedCount) {
			retainedCandidateIds.push(candidateId);
			continue;
		}
		config.candidateStateByDocId.delete(candidateState.docId);
		droppedCandidateIds.push(candidateId);
	}
	return finalizeCoverageLexicalV2WeakFilePruneStageTrace(
		trace,
		retainedCandidateIds,
		droppedCandidateIds,
	);
}

async function buildCoverageLexicalV2ConfirmedPrimaryCoverageSnapshot(config: {
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[];
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[];
	reader: CoverageLexicalV2CandidateCascadeStorageReader;
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions;
	prefetchedBodyHanExactBlockIds: Set<number>;
	policy: CoverageLexicalV2CandidateCascadePolicy;
}): Promise<CoverageLexicalV2ConfirmedPrimaryCoverageSnapshot> {
	const evidenceByCandidateId = new Map<string, CoverageLexicalV2ComparatorEvidence>();
	const comparatorCandidateById = new Map<string, CoverageLexicalV2ComparatorCandidate>();
	const confirmedCoverageCountByCandidateId = new Map<string, number>();
	if (config.candidateStates.length === 0) {
		return {
			evidenceByCandidateId,
			comparatorCandidateById,
			confirmedCoverageCountByCandidateId,
		};
	}
	await populateCoverageLexicalV2CandidateCascadeEvidence(
		evidenceByCandidateId,
		config.candidateStates,
		config.queryAnalysis,
		config.candidateCascadePrimaryUnits,
		config.reader,
		config.matchOptions,
		config.prefetchedBodyHanExactBlockIds,
		config.policy,
		false,
	);
	for (const candidateState of config.candidateStates) {
		const candidateId = String(candidateState.docId);
		const evidence = evidenceByCandidateId.get(candidateId);
		if (!evidence) {
			confirmedCoverageCountByCandidateId.set(candidateId, 0);
			continue;
		}
		const comparatorCandidate = buildCoverageLexicalV2CheapComparatorCandidate(
			config.queryAnalysis,
			evidence,
		);
		comparatorCandidateById.set(candidateId, comparatorCandidate);
		confirmedCoverageCountByCandidateId.set(
			candidateId,
			comparatorCandidate.distinctMatchedPrimaryQueryUnitCount,
		);
	}
	return {
		evidenceByCandidateId,
		comparatorCandidateById,
		confirmedCoverageCountByCandidateId,
	};
}

function applyCoverageLexicalV2WeakFilePruneByConfirmedCoverage(config: {
	mode: WeakFilePruneMode;
	candidateStateByDocId: Map<number, CoverageLexicalV2CascadeCandidateState>;
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[];
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
	stageName: CoverageLexicalV2WeakFilePruneStageName;
	confirmedCoverageCountByCandidateId: ReadonlyMap<string, number>;
}): CoverageLexicalV2WeakFilePruneStageTrace {
	const trace = createCoverageLexicalV2CandidateCascadePruneStageTrace(
		config.mode,
		"confirmed_primary",
	);
	const allCandidateIds = config.candidateStates.map((candidateState) =>
		String(candidateState.docId),
	);
	if (config.mode === "off") {
		trace.skippedReason = "mode_off";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	if (config.candidateStates.length === 0) {
		trace.skippedReason = "no_candidates";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, [], []);
	}
	if (config.stageName === "stageC" && config.layerMode === "han_fallback_salvage") {
		trace.skippedReason = "han_fallback_salvage";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	if (config.stageName !== "stageC" && config.layerMode !== "normal") {
		trace.skippedReason = "non_normal_layer_mode";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	const leaderCount = config.candidateStates.reduce(
		(maxCount, candidateState) =>
			Math.max(
				maxCount,
				config.confirmedCoverageCountByCandidateId.get(String(candidateState.docId)) ?? 0,
			),
		0,
	);
	trace.leaderCount = leaderCount;
	if (leaderCount <= 0) {
		trace.skippedReason = "no_positive_leader";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	const allowedGap = resolveCoverageLexicalV2WeakFilePruneGap(
		config.mode,
		config.stageName,
	);
	trace.allowedGap = allowedGap;
	if (allowedGap == null) {
		trace.skippedReason = "mode_off";
		return finalizeCoverageLexicalV2WeakFilePruneStageTrace(trace, allCandidateIds, []);
	}
	trace.applied = true;
	const minAllowedCount = Math.max(0, leaderCount - allowedGap);
	const retainedCandidateIds: string[] = [];
	const droppedCandidateIds: string[] = [];
	for (const candidateState of config.candidateStates) {
		const candidateId = String(candidateState.docId);
		const confirmedCoverageCount =
			config.confirmedCoverageCountByCandidateId.get(candidateId) ?? 0;
		if (confirmedCoverageCount >= minAllowedCount) {
			retainedCandidateIds.push(candidateId);
			continue;
		}
		config.candidateStateByDocId.delete(candidateState.docId);
		droppedCandidateIds.push(candidateId);
	}
	return finalizeCoverageLexicalV2WeakFilePruneStageTrace(
		trace,
		retainedCandidateIds,
		droppedCandidateIds,
	);
}

async function sourceCoverageLexicalV2CascadeCandidates(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	lexicalPrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions,
	policy: CoverageLexicalV2CandidateCascadePolicy,
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
): Promise<CoverageLexicalV2HanBackstopSourceResult> {
	const candidateStateByDocId = new Map<number, CoverageLexicalV2CascadeCandidateState>();
	const prefixDocIds = new Set<number>();
	const assistDocIds = new Set<number>();
	const fuzzyDocIds = new Set<number>();
	const hanBackstopDocIds = new Set<number>();
	const prefetchedBodyHanExactBlockIds = new Set<number>();
	const hanBackstopMetrics = createCoverageLexicalV2EmptyHanBackstopSourceMetrics();
	const primaryUnitIndexByKey = new Map<string, number>(
		candidateCascadePrimaryUnits.map((primaryUnit, primaryUnitIndex) => [
			createCoverageLexicalV2CascadePrimaryUnitKey(
				primaryUnit.surfaceGroupIndex,
				primaryUnit.normalizedText,
			),
			primaryUnitIndex,
		] as const),
	);
	const metadataExactByPrimaryUnit = lexicalPrimaryUnits.map(() => false);
	const metadataPrefixByPrimaryUnit = lexicalPrimaryUnits.map(() => false);

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		const exactPresence = collectCoverageLexicalV2CascadeExactMatches(
			candidateStateByDocId,
			primaryUnit,
			primaryUnitIndex,
			reader,
		);
		metadataExactByPrimaryUnit[primaryUnitIndex] = exactPresence.metadataMatched;
	});

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (!matchOptions.includePrefix || !isCoverageLexicalV2LatinCandidateCascadeTerm(primaryUnit.normalizedText)) {
			return;
		}
		const prefixPlan = resolveCoverageLexicalV2CascadeAdaptivePrefixPlan(primaryUnit.normalizedText, policy);
		if (prefixPlan.prefixCollectionCap <= 0) {
			return;
		}
		const prefixTerms = reader.collectLatinPrefixTerms(
			primaryUnit.normalizedText,
			prefixPlan.prefixCollectionCap,
		);
		for (const prefixTerm of prefixTerms.slice(0, prefixPlan.metadataTermCap)) {
			const matchPresence = collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				reader,
				prefixDocIds,
				policy.prefixDocCapPerQuery,
				METADATA_FIELDS,
			);
			if (matchPresence.metadataMatched) {
				metadataPrefixByPrimaryUnit[primaryUnitIndex] = true;
			}
		}
		for (const prefixTerm of prefixTerms.slice(0, prefixPlan.bodyTermCap)) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				reader,
				prefixDocIds,
				policy.prefixDocCapPerQuery,
				BODY_ONLY_FIELDS,
			);
		}
		if (metadataExactByPrimaryUnit[primaryUnitIndex] || metadataPrefixByPrimaryUnit[primaryUnitIndex]) {
			return;
		}
		for (const prefixTerm of prefixTerms.slice(
			prefixPlan.metadataTermCap,
			prefixPlan.metadataTermCap + prefixPlan.assistTermCap,
		)) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				reader,
				assistDocIds,
				prefixPlan.assistDocCap,
				ASSIST_METADATA_FIELDS,
			);
		}
	});

	await collectCoverageLexicalV2CascadeHanBackstopMatches(
		candidateStateByDocId,
		queryAnalysis,
		candidateCascadePrimaryUnits,
		primaryUnitIndexByKey,
		reader,
		hanBackstopDocIds,
		prefetchedBodyHanExactBlockIds,
		policy,
		hanBackstopMetrics,
		targetedHanDebug,
	);

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (!matchOptions.includeFuzzy || !isCoverageLexicalV2LatinCandidateCascadeTerm(primaryUnit.normalizedText)) {
			return;
		}
		const fuzzyTerms = reader.collectLatinFuzzyTerms(
			primaryUnit.normalizedText,
			policy.fuzzyTermCapPerUnit,
			matchOptions.fuzzyProportion ?? 0,
		);
		for (const fuzzyTerm of fuzzyTerms) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				fuzzyTerm,
				primaryUnit,
				primaryUnitIndex,
				"fuzzy",
				reader,
				fuzzyDocIds,
				policy.fuzzyDocCapPerQuery,
			);
		}
	});

	return {
		candidateStates: [...candidateStateByDocId.values()]
			.map((candidateState) => finalizeCoverageLexicalV2CascadeCandidateState(candidateState))
			.sort((left, right) =>
				left.stableDeterministicKey.localeCompare(right.stableDeterministicKey),
			),
		metrics: hanBackstopMetrics,
	};
}

async function populateCoverageLexicalV2CandidateCascadeEvidence(
	target: Map<string, CoverageLexicalV2ComparatorEvidence>,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions,
	prefetchedBodyHanExactBlockIds: Set<number>,
	policy: CoverageLexicalV2CandidateCascadePolicy,
	includeBodyTokenSequences: boolean,
): Promise<void> {
	await prefetchCoverageLexicalV2CheapExactHanBodyWitnesses(
		target,
		candidateStates,
		reader,
		prefetchedBodyHanExactBlockIds,
		policy,
		includeBodyTokenSequences,
	);
	for (const candidateState of candidateStates) {
		const candidateId = String(candidateState.docId);
		if (!includeBodyTokenSequences && target.has(candidateId)) {
			continue;
		}
		const documentState = buildCoverageLexicalV2CandidateCascadeDocumentState(
			candidateState,
			reader,
			includeBodyTokenSequences,
		);
		const matchedPrimaryUnits = buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
			candidateCascadePrimaryUnits,
			documentState,
			matchOptions,
			candidateState.prefixHintsByPrimaryUnit,
		);
		if (matchedPrimaryUnits.length === 0) {
			continue;
		}
		const cheapExactWitnessSummary =
			buildCoverageLexicalV2CheapExactWitnessSummary(
				queryAnalysis,
				matchedPrimaryUnits,
				documentState,
			);
		target.set(candidateId, {
			candidateId,
			stableDeterministicKey: candidateState.stableDeterministicKey,
			matchedPrimaryUnits,
			cheapExactWitnessSummary,
			bestWindow: buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
				matchedPrimaryUnits,
				documentState,
			),
		});
	}
}

async function prefetchCoverageLexicalV2CheapExactHanBodyWitnesses(
	target: ReadonlyMap<string, CoverageLexicalV2ComparatorEvidence>,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	prefetchedBodyHanExactBlockIds: Set<number>,
	policy: CoverageLexicalV2CandidateCascadePolicy,
	includeBodyTokenSequences: boolean,
): Promise<void> {
	if (includeBodyTokenSequences) {
		return;
	}
	const requestedBodyHanLogicalBlockIds = Array.from(
		new Set(
			candidateStates.flatMap((candidateState) => {
				const candidateId = String(candidateState.docId);
				if (target.has(candidateId)) {
					return [];
				}
				if (
					candidateState.matchedHanGroupMask.size === 0 ||
					candidateState.fieldTerms.bodyTerms.size === 0
				) {
					return [];
				}
				return [...(reader.getBodyHanLogicalBlockIds(candidateState.docId) ?? [])].filter(
					(blockId) => !prefetchedBodyHanExactBlockIds.has(blockId),
				);
			}),
		),
	);
	if (requestedBodyHanLogicalBlockIds.length === 0) {
		return;
	}
	const prefetch = await reader.prefetchBodyHanExactBlocks(requestedBodyHanLogicalBlockIds, {
		blockBudget: requestedBodyHanLogicalBlockIds.length,
		byteBudget: policy.hanBackstopColdExactByteBudget,
		timeBudgetMs: policy.hanBackstopColdExactTimeBudgetMs,
	});
	for (const blockId of prefetch.fetchedBlockIds ?? prefetch.fetchedDocIds ?? []) {
		prefetchedBodyHanExactBlockIds.add(blockId);
	}
}

function buildCoverageLexicalV2CheapExactWitnessSummary(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): CoverageLexicalV2CheapExactWitnessSummary {
	const intactSurfacePrimaryUnitKeys =
		collectCoverageLexicalV2CheapExactIntactSurfacePrimaryUnitKeys(
			queryAnalysis,
			documentState,
		);
	const matchedPrimaryUnitExactWitnesses =
		collectCoverageLexicalV2CheapExactMatchedPrimaryUnitWitnesses(
			matchedPrimaryUnits,
			documentState,
		);
	const adjacencySummary = buildCoverageLexicalV2CheapExactAdjacencySummary(
		queryAnalysis,
		matchedPrimaryUnitExactWitnesses,
	);
	return {
		intactSurfacePrimaryUnitKeys,
		matchedPrimaryUnitExactWitnesses,
		maxAdjacentExactMatchedPrimaryRunLength:
			adjacencySummary.maxAdjacentExactMatchedPrimaryRunLength,
		adjacentExactMatchedPrimaryUnitCount:
			adjacencySummary.adjacentExactMatchedPrimaryUnitCount,
		adjacencyField: adjacencySummary.adjacencyField,
		adjacentExactMatchedPrimaryUnitKeys:
			adjacencySummary.adjacentExactMatchedPrimaryUnitKeys,
	};
}

function collectCoverageLexicalV2CheapExactIntactSurfacePrimaryUnitKeys(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): string[] {
	const intactSurfacePrimaryUnitKeys = new Set<string>();
	for (const primaryUnit of queryAnalysis.primaryUnits) {
		if (
			primaryUnit.source !== "surface_han_segment" &&
			primaryUnit.source !== "latin_segment" &&
			primaryUnit.source !== "mixed_script_segment"
		) {
			continue;
		}
		const unitKey = createCoverageLexicalV2CascadePrimaryUnitKey(
			primaryUnit.surfaceGroupIndex,
			primaryUnit.normalizedText,
		);
		if (
			doesCoverageLexicalV2CheapExactSurfacePrimaryHaveMetadataWitness(
				primaryUnit,
				documentState,
			) ||
			doesCoverageLexicalV2CheapExactSurfacePrimaryHaveBodyWitness(
				queryAnalysis,
				primaryUnit,
				documentState,
			)
		) {
			intactSurfacePrimaryUnitKeys.add(unitKey);
		}
	}
	return [...intactSurfacePrimaryUnitKeys];
}

function collectCoverageLexicalV2CheapExactMatchedPrimaryUnitWitnesses(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): CoverageLexicalV2CheapExactWitness[] {
	const witnesses: CoverageLexicalV2CheapExactWitness[] = [];
	for (const matchedPrimaryUnit of matchedPrimaryUnits) {
		if (matchedPrimaryUnit.matchQuality !== "exact") {
			continue;
		}
		for (const field of CHEAP_EXACT_FIELDS) {
			witnesses.push(
				...collectCoverageLexicalV2CheapExactWitnessesForMatchedPrimaryUnitField(
					matchedPrimaryUnit,
					field,
					documentState,
				),
			);
		}
	}
	return dedupeCoverageLexicalV2CheapExactWitnesses(witnesses);
}

function collectCoverageLexicalV2CheapExactWitnessesForMatchedPrimaryUnitField(
	matchedPrimaryUnit: CoverageLexicalV2MatchedPrimaryUnitEvidence,
	field: CoverageLexicalV2CheapExactContinuityField,
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): CoverageLexicalV2CheapExactWitness[] {
	if (field === "body") {
		if (
			matchedPrimaryUnit.surfaceKind === "latin" ||
			!documentState.getBodyHanExactWitness
		) {
			return [];
		}
		const witness = documentState.getBodyHanExactWitness(
			matchedPrimaryUnit.normalizedText,
			extractHanBigrams(matchedPrimaryUnit.normalizedText),
		);
		if (!witness) {
			return [];
		}
		return [{
			field,
			unitKey: createCoverageLexicalV2CascadePrimaryUnitKey(
				matchedPrimaryUnit.surfaceGroupIndex,
				matchedPrimaryUnit.normalizedText,
			),
			surfaceGroupIndex: matchedPrimaryUnit.surfaceGroupIndex,
			start: witness.start,
			end: witness.end,
		}];
	}
	if (matchedPrimaryUnit.surfaceKind === "han") {
		const normalizedFieldText =
			getCoverageLexicalV2CheapExactMetadataFieldNormalizedText(
				documentState.record,
				field,
			);
		if (!normalizedFieldText) {
			return [];
		}
		return collectCoverageLexicalV2CheapExactTextWitnesses(
			normalizedFieldText,
			matchedPrimaryUnit.normalizedText,
		).map((witness) => ({
			field,
			unitKey: createCoverageLexicalV2CascadePrimaryUnitKey(
				matchedPrimaryUnit.surfaceGroupIndex,
				matchedPrimaryUnit.normalizedText,
			),
			surfaceGroupIndex: matchedPrimaryUnit.surfaceGroupIndex,
			start: witness.start,
			end: witness.end,
		}));
	}
	const tokenSequence =
		getCoverageLexicalV2CheapExactMetadataFieldTokenSequence(documentState, field);
	if (!tokenSequence || tokenSequence.length === 0) {
		return [];
	}
	return collectCoverageLexicalV2CheapExactTokenSpanWitnesses(
		tokenSequence,
		matchedPrimaryUnit.normalizedText,
	).map((witness) => ({
		field,
		unitKey: createCoverageLexicalV2CascadePrimaryUnitKey(
			matchedPrimaryUnit.surfaceGroupIndex,
			matchedPrimaryUnit.normalizedText,
		),
		surfaceGroupIndex: matchedPrimaryUnit.surfaceGroupIndex,
		start: witness.start,
		end: witness.end,
	}));
}

function doesCoverageLexicalV2CheapExactSurfacePrimaryHaveMetadataWitness(
	primaryUnit: CoverageLexicalV2QueryUnit,
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): boolean {
	for (const field of CHEAP_EXACT_METADATA_FIELDS) {
		if (primaryUnit.source === "surface_han_segment") {
			if (
				collectCoverageLexicalV2CheapExactTextWitnesses(
					getCoverageLexicalV2CheapExactMetadataFieldNormalizedText(
						documentState.record,
						field,
					),
					primaryUnit.normalizedText,
				).length > 0
			) {
				return true;
			}
			continue;
		}
		const tokenSequence =
			getCoverageLexicalV2CheapExactMetadataFieldTokenSequence(documentState, field);
		if (!tokenSequence || tokenSequence.length === 0) {
			continue;
		}
		if (
			collectCoverageLexicalV2CheapExactTokenSpanWitnesses(
				tokenSequence,
				primaryUnit.normalizedText,
			).length > 0
		) {
			return true;
		}
	}
	return false;
}

function doesCoverageLexicalV2CheapExactSurfacePrimaryHaveBodyWitness(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	primaryUnit: CoverageLexicalV2QueryUnit,
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
): boolean {
	if (
		primaryUnit.source !== "surface_han_segment" ||
		!documentState.getBodyHanExactWitness
	) {
		return false;
	}
	const hanBackstopGroup = queryAnalysis.hanBackstopGroups.find(
		(group) =>
			group.surfaceGroupIndex === primaryUnit.surfaceGroupIndex &&
			group.normalizedText === primaryUnit.normalizedText,
	);
	return documentState.getBodyHanExactWitness(
		primaryUnit.normalizedText,
		hanBackstopGroup?.bigrams ?? [],
	) != null;
}

function buildCoverageLexicalV2CheapExactAdjacencySummary(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	witnesses: readonly CoverageLexicalV2CheapExactWitness[],
): {
	maxAdjacentExactMatchedPrimaryRunLength: number;
	adjacentExactMatchedPrimaryUnitCount: number;
	adjacencyField: CoverageLexicalV2CheapExactContinuityField | null;
	adjacentExactMatchedPrimaryUnitKeys: string[];
} {
	const queryOrderByUnitKey = buildCoverageLexicalV2CheapExactQueryOrderByUnitKey(
		queryAnalysis,
	);
	let best = {
		maxAdjacentExactMatchedPrimaryRunLength: 0,
		adjacentExactMatchedPrimaryUnitCount: 0,
		adjacencyField: null as CoverageLexicalV2CheapExactContinuityField | null,
		adjacentExactMatchedPrimaryUnitKeys: [] as string[],
	};
	for (const field of CHEAP_EXACT_FIELDS) {
		const fieldWitnesses = witnesses
			.filter((witness) => witness.field === field)
			.map((witness) => ({
				...witness,
				queryOrder: queryOrderByUnitKey.get(witness.unitKey) ?? Number.MAX_SAFE_INTEGER,
			}))
			.sort(compareCoverageLexicalV2CheapExactWitnessesWithOrder);
		if (fieldWitnesses.length < 2) {
			continue;
		}
		const fieldSummary =
			buildCoverageLexicalV2CheapExactFieldAdjacencySummary(fieldWitnesses);
		if (
			fieldSummary.maxAdjacentExactMatchedPrimaryRunLength >
				best.maxAdjacentExactMatchedPrimaryRunLength ||
			(
				fieldSummary.maxAdjacentExactMatchedPrimaryRunLength ===
					best.maxAdjacentExactMatchedPrimaryRunLength &&
				fieldSummary.adjacentExactMatchedPrimaryUnitCount >
					best.adjacentExactMatchedPrimaryUnitCount
			)
		) {
			best = {
				...fieldSummary,
				adjacencyField: field,
			};
		}
	}
	return best;
}

function buildCoverageLexicalV2CheapExactFieldAdjacencySummary(
	fieldWitnesses: readonly CoverageLexicalV2CheapExactWitnessWithOrder[],
): {
	maxAdjacentExactMatchedPrimaryRunLength: number;
	adjacentExactMatchedPrimaryUnitCount: number;
	adjacentExactMatchedPrimaryUnitKeys: string[];
} {
	const adjacentUnitKeys = new Set<string>();
	const longestRunEndingAt = new Array<number>(fieldWitnesses.length).fill(1);
	for (let witnessIndex = 0; witnessIndex < fieldWitnesses.length; witnessIndex += 1) {
		const witness = fieldWitnesses[witnessIndex];
		for (let previousIndex = 0; previousIndex < witnessIndex; previousIndex += 1) {
			const previousWitness = fieldWitnesses[previousIndex];
			if (
				witness.queryOrder <= previousWitness.queryOrder ||
				witness.unitKey === previousWitness.unitKey ||
				witness.start > previousWitness.end + 1
			) {
				continue;
			}
			adjacentUnitKeys.add(previousWitness.unitKey);
			adjacentUnitKeys.add(witness.unitKey);
			longestRunEndingAt[witnessIndex] = Math.max(
				longestRunEndingAt[witnessIndex],
				longestRunEndingAt[previousIndex] + 1,
			);
		}
	}
	if (adjacentUnitKeys.size === 0) {
		return {
			maxAdjacentExactMatchedPrimaryRunLength: 0,
			adjacentExactMatchedPrimaryUnitCount: 0,
			adjacentExactMatchedPrimaryUnitKeys: [],
		};
	}
	return {
		maxAdjacentExactMatchedPrimaryRunLength: Math.max(...longestRunEndingAt),
		adjacentExactMatchedPrimaryUnitCount: adjacentUnitKeys.size,
		adjacentExactMatchedPrimaryUnitKeys: [...adjacentUnitKeys].sort(),
	};
}

function buildCoverageLexicalV2CheapExactQueryOrderByUnitKey(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
): Map<string, number> {
	const queryOrderByUnitKey = new Map<string, number>();
	queryAnalysis.primaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		const unitKey = createCoverageLexicalV2CascadePrimaryUnitKey(
			primaryUnit.surfaceGroupIndex,
			primaryUnit.normalizedText,
		);
		if (queryOrderByUnitKey.has(unitKey)) {
			return;
		}
		const groupText =
			queryAnalysis.surfaceGroups[primaryUnit.surfaceGroupIndex]?.normalizedText ?? "";
		const surfaceOffset = Math.max(0, groupText.indexOf(primaryUnit.normalizedText));
		queryOrderByUnitKey.set(
			unitKey,
			primaryUnit.surfaceGroupIndex * 100000 + surfaceOffset * 100 + primaryUnitIndex,
		);
	});
	return queryOrderByUnitKey;
}

function compareCoverageLexicalV2CheapExactWitnessesWithOrder(
	left: CoverageLexicalV2CheapExactWitnessWithOrder,
	right: CoverageLexicalV2CheapExactWitnessWithOrder,
): number {
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.end !== right.end) {
		return left.end - right.end;
	}
	if (left.queryOrder !== right.queryOrder) {
		return left.queryOrder - right.queryOrder;
	}
	return left.unitKey.localeCompare(right.unitKey);
}

function dedupeCoverageLexicalV2CheapExactWitnesses(
	witnesses: readonly CoverageLexicalV2CheapExactWitness[],
): CoverageLexicalV2CheapExactWitness[] {
	const dedupedByKey = new Map<string, CoverageLexicalV2CheapExactWitness>();
	for (const witness of witnesses) {
		const dedupeKey =
			`${witness.field}|${witness.unitKey}|${witness.start}|${witness.end}`;
		dedupedByKey.set(dedupeKey, witness);
	}
	return [...dedupedByKey.values()];
}

function getCoverageLexicalV2CheapExactMetadataFieldNormalizedText(
	record: CoverageLexicalV2CandidateCascadeDocumentRecord,
	field: CoverageLexicalV2CheapExactMetadataField,
): string {
	switch (field) {
		case "basename":
			return normalizeCoverageLexicalV2Text(record.basenameText);
		case "aliases":
			return normalizeCoverageLexicalV2Text(record.aliasesText);
		case "headings":
			return normalizeCoverageLexicalV2Text(record.headingsText);
	}
}

function getCoverageLexicalV2CheapExactMetadataFieldTokenSequence(
	documentState: CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	field: CoverageLexicalV2CheapExactMetadataField,
): readonly string[] | undefined {
	switch (field) {
		case "basename":
			return documentState.basenameTokenSequence;
		case "aliases":
			return documentState.aliasTokenSequence;
		case "headings":
			return documentState.headingsTokenSequence;
	}
}

function collectCoverageLexicalV2CheapExactTextWitnesses(
	text: string,
	needle: string,
): Array<{ start: number; end: number }> {
	const witnesses: Array<{ start: number; end: number }> = [];
	if (!text || !needle) {
		return witnesses;
	}
	let searchStart = 0;
	while (searchStart < text.length) {
		const foundAt = text.indexOf(needle, searchStart);
		if (foundAt < 0) {
			break;
		}
		witnesses.push({
			start: foundAt,
			end: foundAt + needle.length - 1,
		});
		searchStart = foundAt + 1;
	}
	return witnesses;
}

function collectCoverageLexicalV2CheapExactTokenSpanWitnesses(
	tokenSequence: readonly string[],
	needle: string,
): Array<{ start: number; end: number }> {
	if (!needle || tokenSequence.length === 0) {
		return [];
	}
	const normalizedTokens = tokenSequence.map((token) => normalizeCoverageLexicalV2Text(token));
	const positionsByToken = new Map<string, number[]>();
	for (let index = 0; index < normalizedTokens.length; index += 1) {
		const token = normalizedTokens[index];
		const positions = positionsByToken.get(token);
		if (positions) {
			positions.push(index);
			continue;
		}
		positionsByToken.set(token, [index]);
	}
	const candidateStarts: number[] = [];
	for (const [token, positions] of positionsByToken.entries()) {
		if (needle.startsWith(token)) {
			candidateStarts.push(...positions);
		}
	}
	candidateStarts.sort((left, right) => left - right);
	const cumulativeTokenLengths = new Array<number>(normalizedTokens.length + 1).fill(0);
	for (let index = 0; index < normalizedTokens.length; index += 1) {
		cumulativeTokenLengths[index + 1] =
			cumulativeTokenLengths[index] + normalizedTokens[index].length;
	}
	const spans: Array<{ start: number; end: number }> = [];
	for (const start of candidateStarts) {
		let joined = "";
		const maxEndExclusive = findCoverageLexicalV2CheapExactMaxEndExclusive(
			cumulativeTokenLengths,
			start,
			needle.length,
		);
		for (let end = start; end < maxEndExclusive; end += 1) {
			joined += normalizedTokens[end];
			if (joined === needle) {
				spans.push({ start, end });
				break;
			}
			if (!needle.startsWith(joined) || joined.length >= needle.length) {
				break;
			}
		}
	}
	return spans;
}

function findCoverageLexicalV2CheapExactMaxEndExclusive(
	cumulativeTokenLengths: readonly number[],
	start: number,
	maxSpanLength: number,
): number {
	let low = start + 1;
	let high = cumulativeTokenLengths.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const spanLength = cumulativeTokenLengths[mid] - cumulativeTokenLengths[start];
		if (spanLength <= maxSpanLength) {
			low = mid;
			continue;
		}
		high = mid - 1;
	}
	return low;
}

async function hydrateCoverageLexicalV2CascadeVerificationStates(
	verificationStates: readonly CoverageLexicalV2CascadeCandidateState[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	prefetchedBodyHanExactBlockIds: Set<number>,
	policy: CoverageLexicalV2CandidateCascadePolicy,
): Promise<void> {
	const docIds = verificationStates
		.filter((candidateState) => candidateState.hydrationStatus !== "prefetched")
		.map((candidateState) => candidateState.docId);
	if (docIds.length === 0) {
		return;
	}
	await reader.prefetchBodyTokenSequences(docIds);
	const requestedBodyHanLogicalBlockIds = Array.from(
		new Set(
			verificationStates.flatMap((candidateState) =>
				candidateState.matchedHanGroupMask.size > 0
					? [...(reader.getBodyHanLogicalBlockIds(candidateState.docId) ?? [])].filter(
							(blockId) => !prefetchedBodyHanExactBlockIds.has(blockId),
						)
					: [],
			),
		),
	);
	if (requestedBodyHanLogicalBlockIds.length > 0) {
		const prefetch = await reader.prefetchBodyHanExactBlocks(requestedBodyHanLogicalBlockIds, {
			blockBudget: Math.min(
				requestedBodyHanLogicalBlockIds.length,
				Math.max(policy.returnTarget, policy.hanBackstopColdExactDocBudget),
			),
			byteBudget: policy.hanBackstopColdExactByteBudget,
			timeBudgetMs: policy.hanBackstopColdExactTimeBudgetMs,
		});
		for (const blockId of prefetch.fetchedBlockIds ?? prefetch.fetchedDocIds ?? []) {
			prefetchedBodyHanExactBlockIds.add(blockId);
		}
	}
	for (const candidateState of verificationStates) {
		candidateState.prefetchedBodyTokenSequence =
			reader.getBodyTokenSequence(candidateState.docId);
		candidateState.hydrationStatus = "prefetched";
	}
}

function finalizeCoverageLexicalV2CascadeCandidateState(
	candidateState: CoverageLexicalV2CascadeCandidateState,
): CoverageLexicalV2CascadeCandidateState {
	for (const [primaryUnitIndex, matchedFields] of candidateState.matchedFieldsByPrimaryUnit.entries()) {
		const sortedFields = [...matchedFields].sort(
			(left, right) => FIELD_PRIORITY[left] - FIELD_PRIORITY[right],
		);
		if (sortedFields.length === 0) {
			continue;
		}
		candidateState.bestFieldByPrimaryUnit.set(primaryUnitIndex, sortedFields[0]);
		candidateState.corroboratedFieldMaskByPrimaryUnit.set(
			primaryUnitIndex,
			new Set(sortedFields.slice(1)),
		);
	}
	candidateState.potentialPrimaryCoverageCount = countCoverageLexicalV2CascadeMaskUnion(
		candidateState.exactPrimaryMask,
		candidateState.prefixPrimaryMask,
	);
	candidateState.fuzzySalvageCoverageCount = [...candidateState.fuzzyPrimaryMask]
		.filter((primaryUnitIndex) =>
			!candidateState.exactPrimaryMask.has(primaryUnitIndex) &&
			!candidateState.prefixPrimaryMask.has(primaryUnitIndex),
		)
		.length;
	candidateState.hanFallbackSalvageGroupCount =
		candidateState.potentialPrimaryCoverageCount > 0 ||
		candidateState.fuzzySalvageCoverageCount > 0
			? 0
			: candidateState.fallbackMatchedSurfaceGroups.size;
	return candidateState;
}

function buildCoverageLexicalV2CandidateCascadeDocumentState(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	includeBodyTokenSequences: boolean,
): CoverageLexicalV2CandidateCascadeDocumentLexicalState {
	return {
		docId: candidateState.docId,
		path: candidateState.path,
		stableDeterministicKey: candidateState.stableDeterministicKey,
		record: candidateState.record,
		fieldTerms: toCoverageLexicalV2CandidateCascadeFieldTerms(candidateState.fieldTerms),
		basenameTokenSequence: candidateState.fieldTerms.basenameTerms.size > 0
			? tokenizeCoverageLexicalV2CandidateCascadeText(reader, candidateState.record.basenameText)
			: undefined,
		aliasTokenSequence: candidateState.fieldTerms.aliasTerms.size > 0
			? tokenizeCoverageLexicalV2CandidateCascadeText(reader, candidateState.record.aliasesText)
			: undefined,
		headingsTokenSequence: candidateState.fieldTerms.headingsTerms.size > 0
			? tokenizeCoverageLexicalV2CandidateCascadeText(reader, candidateState.record.headingsText)
			: undefined,
		bodyTokenSequence:
			includeBodyTokenSequences && candidateState.fieldTerms.bodyTerms.size > 0
				? [...(candidateState.prefetchedBodyTokenSequence ??
						reader.getBodyTokenSequence(candidateState.docId) ??
						[])]
				: undefined,
		getBodyHanExactWitness: (normalizedText, bigrams) =>
			reader.getBodyHanExactDocumentWitness(
				candidateState.docId,
				normalizedText,
				bigrams,
			),
	};
}

function collectCoverageLexicalV2CascadeExactMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2CascadeFieldMatchPresence {
	const matchPresence: CoverageLexicalV2CascadeFieldMatchPresence = {
		metadataMatched: false,
		bodyMatched: false,
	};
	for (const field of SOURCE_FIELDS) {
		const postings = reader.getPostingMatches(field, primaryUnit.normalizedText);
		const matchCount = collectCoverageLexicalV2CascadePostingMatches(
			target,
			postings,
			reader,
			field,
			primaryUnit.normalizedText,
			primaryUnit,
			primaryUnitIndex,
			"exact",
			true,
		);
		if (matchCount <= 0) {
			continue;
		}
		if (field === "body") {
			matchPresence.bodyMatched = true;
		} else {
			matchPresence.metadataMatched = true;
		}
	}
	return matchPresence;
}

function collectCoverageLexicalV2CascadeExpandedMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	candidateTerm: string,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: "prefix" | "fuzzy",
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	sourceDocIds: Set<number>,
	docCap: number,
	fields: readonly CoverageLexicalV2CandidateCascadePostingField[] = SOURCE_FIELDS,
): CoverageLexicalV2CascadeFieldMatchPresence {
	const matchPresence: CoverageLexicalV2CascadeFieldMatchPresence = {
		metadataMatched: false,
		bodyMatched: false,
	};
	for (const field of fields) {
		const postings = reader.getPostingMatches(field, candidateTerm);
		const matchCount = collectCoverageLexicalV2CascadePostingMatches(
			target,
			postings,
			reader,
			field,
			candidateTerm,
			primaryUnit,
			primaryUnitIndex,
			quality,
			false,
			sourceDocIds,
			docCap,
		);
		if (matchCount <= 0) {
			continue;
		}
		if (field === "body") {
			matchPresence.bodyMatched = true;
		} else {
			matchPresence.metadataMatched = true;
		}
	}
	return matchPresence;
}

function collectCoverageLexicalV2CascadeFallbackMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	fallbackDocIds: Set<number>,
	fallbackUnitCapPerHanGroup: number,
	fallbackDocCapPerQuery: number,
): void {
	const fallbackUnitsByGroup = new Map<number, string[]>();
	for (const fallbackUnit of queryAnalysis.fallbackUnits) {
		if (fallbackUnit.surfaceKind !== "han" && fallbackUnit.surfaceKind !== "mixed") {
			continue;
		}
		const groupTerms = fallbackUnitsByGroup.get(fallbackUnit.surfaceGroupIndex) ?? [];
		if (groupTerms.includes(fallbackUnit.normalizedText)) {
			continue;
		}
		if (groupTerms.length >= fallbackUnitCapPerHanGroup) {
			continue;
		}
		groupTerms.push(fallbackUnit.normalizedText);
		fallbackUnitsByGroup.set(fallbackUnit.surfaceGroupIndex, groupTerms);
	}
	for (const [surfaceGroupIndex, groupTerms] of fallbackUnitsByGroup.entries()) {
		for (const fallbackTerm of groupTerms) {
			for (const field of SOURCE_FIELDS) {
				const postings = reader.getPostingMatches(field, fallbackTerm);
				if (!postings) {
					continue;
				}
				for (const docId of postings) {
					const candidateState = getOrCreateCoverageLexicalV2CascadeCandidateState(
						target,
						Number(docId),
						reader,
						fallbackDocIds,
						fallbackDocCapPerQuery,
					);
					if (!candidateState) {
						continue;
					}
					updateCoverageLexicalV2CascadeFallbackEvidence(
						candidateState,
						field,
						fallbackTerm,
						surfaceGroupIndex,
					);
				}
			}
		}
	}
}

async function collectCoverageLexicalV2CascadeHanBackstopMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	primaryUnitIndexByKey: ReadonlyMap<string, number>,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	hanBackstopDocIds: Set<number>,
	prefetchedBodyHanExactBlockIds: Set<number>,
	policy: CoverageLexicalV2CandidateCascadePolicy,
	metrics: CoverageLexicalV2HanBackstopSourceMetrics,
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
): Promise<void> {
	targetedHanDebug.enteredHanBackstop = queryAnalysis.hanBackstopGroups.length > 0;
	const metadataFrontier = createCoverageLexicalV2PendingHanFrontier();
	const bodyHanExactStatsCache: CoverageLexicalV2HanExactStatsCache = new Map();
	for (const hanBackstopGroup of queryAnalysis.hanBackstopGroups) {
		const activated = shouldActivateCoverageLexicalV2HanBackstopGroup(
			hanBackstopGroup,
			target,
		);
		recordCoverageLexicalV2TargetedHanDebugGroup(
			targetedHanDebug,
			hanBackstopGroup,
			activated,
		);
		if (!activated) {
			continue;
		}
		const primaryUnitIndex = primaryUnitIndexByKey.get(
			createCoverageLexicalV2CascadePrimaryUnitKey(
				hanBackstopGroup.surfaceGroupIndex,
				hanBackstopGroup.normalizedText,
			),
		);
		if (primaryUnitIndex == null) {
			continue;
		}
		if (!candidateCascadePrimaryUnits[primaryUnitIndex]) {
			continue;
		}
		const rankedCandidates = rankCoverageLexicalV2MetadataHanBackstopCandidates(
			hanBackstopGroup,
			reader,
		).slice(0, policy.hanBackstopDocCapPerGroup);
		recordCoverageLexicalV2TargetedHanDebugMetadataCandidates(
			targetedHanDebug,
			hanBackstopGroup,
			rankedCandidates,
			reader,
		);
		for (const rankedCandidate of rankedCandidates) {
			if (
				hasCoverageLexicalV2CascadeResolvedPrimaryUnitMatch(
					target,
					rankedCandidate.docId,
					primaryUnitIndex,
				)
			) {
				continue;
			}
			const record = reader.getDocumentRecord(rankedCandidate.docId);
			if (!record) {
				continue;
			}
			const verifiedFields = verifyCoverageLexicalV2HanBackstopMetadataRecord(
				record,
				hanBackstopGroup.normalizedText,
			);
			if (verifiedFields.length === 0) {
				continue;
			}
			metrics.hanPromotionVerifiedDocCount += 1;
			enqueueCoverageLexicalV2PendingHanCandidate(
				metadataFrontier,
				{
					docId: rankedCandidate.docId,
					primaryUnitIndex,
					surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
					normalizedText: hanBackstopGroup.normalizedText,
					stableDeterministicKey: rankedCandidate.stableDeterministicKey,
					stats: rankedCandidate.stats,
					verificationState: "verified",
					verifiedFields: new Set<CoverageLexicalV2MatchField>(verifiedFields),
				},
				metrics,
			);
		}
	}
	mergeCoverageLexicalV2HanPromotionMetrics(
		metrics,
		promoteCoverageLexicalV2PendingHanFrontier(
			target,
			metadataFrontier,
			reader,
			hanBackstopDocIds,
			{
				docCap: policy.hanBackstopDocCapPerQuery,
			},
			candidateCascadePrimaryUnits,
		),
	);
	const rankedBodyCandidates: CoverageLexicalV2PendingHanCandidate[] = [];
	for (const hanBackstopGroup of queryAnalysis.hanBackstopGroups) {
		if (!shouldActivateCoverageLexicalV2HanBackstopGroup(hanBackstopGroup, target)) {
			continue;
		}
		const primaryUnitIndex = primaryUnitIndexByKey.get(
			createCoverageLexicalV2CascadePrimaryUnitKey(
				hanBackstopGroup.surfaceGroupIndex,
				hanBackstopGroup.normalizedText,
			),
		);
		if (primaryUnitIndex == null) {
			continue;
		}
		rankedBodyCandidates.push(
			...collectCoverageLexicalV2BodyHanBackstopBlockMatches(
				hanBackstopGroup,
				primaryUnitIndex,
				reader,
				policy.hanBackstopDocCapPerGroup,
				metrics,
				targetedHanDebug,
			).filter(
				(candidate) =>
					!hasCoverageLexicalV2CascadeResolvedPrimaryUnitMatch(
						target,
						candidate.docId,
						candidate.primaryUnitIndex,
					),
			),
		);
	}
	const bodyFrontier = createCoverageLexicalV2PendingHanFrontier();
	const cappedBodyCandidates = rankedBodyCandidates
		.sort(compareCoverageLexicalV2PendingHanCandidates)
		.slice(0, policy.hanBackstopDocCapPerQuery);
	const requestedBodyLogicalBlockIds = Array.from(
		new Set(
			cappedBodyCandidates.flatMap((candidate) =>
				candidate.bodyLogicalBlockId == null ||
				prefetchedBodyHanExactBlockIds.has(candidate.bodyLogicalBlockId)
					? []
					: [candidate.bodyLogicalBlockId],
			),
		),
	);
	recordCoverageLexicalV2TargetedHanDebugBodyGateCappedCandidates(
		targetedHanDebug,
		cappedBodyCandidates,
		reader,
	);
	metrics.bodyHanColdExactRequestedBlockCount = requestedBodyLogicalBlockIds.length;
	if (requestedBodyLogicalBlockIds.length > 0) {
		const prefetch = await reader.prefetchBodyHanExactBlocks(
			requestedBodyLogicalBlockIds,
			{
				blockBudget: policy.hanBackstopColdExactDocBudget,
				byteBudget: policy.hanBackstopColdExactByteBudget,
				timeBudgetMs: policy.hanBackstopColdExactTimeBudgetMs,
			},
		);
		applyCoverageLexicalV2BodyHanExactPrefetchMetrics(metrics, prefetch);
		recordCoverageLexicalV2TargetedHanDebugPrefetch(
			targetedHanDebug,
			requestedBodyLogicalBlockIds,
			prefetch,
		);
		for (const blockId of prefetch.fetchedBlockIds ?? prefetch.fetchedDocIds ?? []) {
			prefetchedBodyHanExactBlockIds.add(blockId);
		}
		const prefetchedBlockIds = new Set(
			prefetch.fetchedBlockIds ?? prefetch.fetchedDocIds ?? [],
		);
		for (const candidate of cappedBodyCandidates) {
			if (candidate.bodyLogicalBlockId == null) {
				continue;
			}
			const exactStats = getOrComputeCoverageLexicalV2BodyHanExactStats(
				bodyHanExactStatsCache,
				reader,
				queryAnalysis,
				candidate,
			);
			recordCoverageLexicalV2TargetedHanDebugExactEvaluation(
				targetedHanDebug,
				candidate,
				reader,
				prefetchedBlockIds.has(candidate.bodyLogicalBlockId),
				exactStats,
			);
			if (!exactStats) {
				continue;
			}
			enqueueCoverageLexicalV2PendingHanCandidate(
				bodyFrontier,
				{
					...candidate,
					stats: exactStats,
					verificationState: "verified",
					verifiedFields: new Set<CoverageLexicalV2MatchField>(["body"]),
				},
				metrics,
			);
		}
	}
	mergeCoverageLexicalV2HanPromotionMetrics(
		metrics,
		promoteCoverageLexicalV2PendingHanFrontier(
			target,
			bodyFrontier,
			reader,
			hanBackstopDocIds,
			{
				docCap: policy.hanBackstopDocCapPerQuery,
			},
			candidateCascadePrimaryUnits,
		),
	);
}

function shouldActivateCoverageLexicalV2HanBackstopGroup(
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	target: ReadonlyMap<number, CoverageLexicalV2CascadeCandidateState>,
): boolean {
	if (hanBackstopGroup.triggerKind === "residual") {
		return true;
	}
	if (hanBackstopGroup.primaryUnitIndices.length === 0) {
		return true;
	}
	for (const candidateState of target.values()) {
		for (const primaryUnitIndex of hanBackstopGroup.primaryUnitIndices) {
			if (
				candidateState.exactPrimaryMask.has(primaryUnitIndex) ||
				candidateState.prefixPrimaryMask.has(primaryUnitIndex)
			) {
				return false;
			}
		}
	}
	return true;
}

function hasCoverageLexicalV2CascadeResolvedPrimaryUnitMatch(
	target: ReadonlyMap<number, CoverageLexicalV2CascadeCandidateState>,
	docId: number,
	primaryUnitIndex: number,
): boolean {
	const candidateState = target.get(docId);
	if (!candidateState) {
		return false;
	}
	return (
		candidateState.exactPrimaryMask.has(primaryUnitIndex) ||
		candidateState.prefixPrimaryMask.has(primaryUnitIndex)
	);
}

function createCoverageLexicalV2PendingHanFrontier():
CoverageLexicalV2PendingHanFrontier {
	return {
		candidatesByKey: new Map<string, CoverageLexicalV2PendingHanCandidate>(),
	};
}

function enqueueCoverageLexicalV2PendingHanCandidate(
	frontier: CoverageLexicalV2PendingHanFrontier,
	candidate: CoverageLexicalV2PendingHanCandidate,
	metrics: CoverageLexicalV2HanBackstopSourceMetrics,
): void {
	const key = createCoverageLexicalV2PendingHanCandidateKey(
		candidate.docId,
		candidate.primaryUnitIndex,
	);
	const existing = frontier.candidatesByKey.get(key);
	if (!existing) {
		frontier.candidatesByKey.set(key, candidate);
		metrics.pendingHanFrontierCount += 1;
		return;
	}
	existing.stats = selectCoverageLexicalV2BetterHanBackstopStats(
		existing.stats,
		candidate.stats,
	);
	if (candidate.verificationState === "verified") {
		existing.verificationState = "verified";
	}
	for (const field of candidate.verifiedFields) {
		existing.verifiedFields.add(field);
	}
}

function promoteCoverageLexicalV2PendingHanFrontier(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	frontier: CoverageLexicalV2PendingHanFrontier,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	hanBackstopDocIds: Set<number>,
	policy: CoverageLexicalV2HanPromotionBatchPolicy,
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
): CoverageLexicalV2HanPromotionResult {
	if (frontier.candidatesByKey.size === 0) {
		return {
			promotedCount: 0,
			verifiedCount: 0,
			skippedReason: "no_pending_candidates",
		};
	}
	let promotedCount = 0;
	let verifiedCount = 0;
	let skippedReason: CoverageLexicalV2CandidateCascadeHanPromotionSkippedReason = "none";
	const orderedCandidates = [...frontier.candidatesByKey.values()].sort(
		compareCoverageLexicalV2PendingHanCandidates,
	);
	for (const pendingCandidate of orderedCandidates) {
		if (pendingCandidate.verificationState === "pending") {
			const verifiedFields = verifyCoverageLexicalV2HanBackstopMetadataCandidate(
				pendingCandidate.docId,
				pendingCandidate.normalizedText,
				reader,
			);
			if (verifiedFields.length === 0) {
				continue;
			}
			pendingCandidate.verificationState = "verified";
			for (const field of verifiedFields) {
				pendingCandidate.verifiedFields.add(field);
			}
			verifiedCount += 1;
		}
		if (pendingCandidate.verifiedFields.size === 0) {
			continue;
		}
		const primaryUnit = candidateCascadePrimaryUnits[pendingCandidate.primaryUnitIndex];
		if (!primaryUnit) {
			continue;
		}
		const candidateState = getOrCreateCoverageLexicalV2CascadeCandidateState(
			target,
			pendingCandidate.docId,
			reader,
			hanBackstopDocIds,
			policy.docCap,
		);
		if (!candidateState) {
			skippedReason = "doc_cap_reached";
			continue;
		}
		for (const field of pendingCandidate.verifiedFields) {
			updateCoverageLexicalV2CascadeVerifiedHanBackstopEvidence(
				candidateState,
				field,
				pendingCandidate.normalizedText,
				primaryUnit,
				pendingCandidate.primaryUnitIndex,
			);
		}
		promotedCount += 1;
	}
	return {
		promotedCount,
		verifiedCount,
		skippedReason,
	};
}

function mergeCoverageLexicalV2HanPromotionMetrics(
	metrics: CoverageLexicalV2HanBackstopSourceMetrics,
	result: CoverageLexicalV2HanPromotionResult,
): void {
	metrics.hanPromotionDocCount += result.promotedCount;
	metrics.hanPromotionVerifiedDocCount += result.verifiedCount;
	if (
		result.skippedReason === "none" ||
		result.promotedCount > 0 ||
		result.verifiedCount > 0
	) {
		metrics.hanPromotionSkippedReason = "none";
		return;
	}
	if (result.skippedReason === "doc_cap_reached") {
		metrics.hanPromotionSkippedReason = "doc_cap_reached";
	}
}

function collectCoverageLexicalV2BodyHanBackstopBlockMatches(
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	primaryUnitIndex: number,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	docCapPerGroup: number,
	metrics: CoverageLexicalV2HanBackstopSourceMetrics,
	targetedHanDebug: CoverageLexicalV2TargetedHanDebugTrace,
): CoverageLexicalV2PendingHanCandidate[] {
	if (hanBackstopGroup.bigrams.length === 0) {
		return [];
	}
	const postingEntries = hanBackstopGroup.bigrams
		.map((bigram, bigramIndex) => ({
			bigram,
			bigramIndex,
			blockIds: reader.getBodyHanBlockPostingMatches(bigram),
		}))
		.filter(
			(entry): entry is {
				bigram: string;
				bigramIndex: number;
				blockIds: readonly number[] | Uint32Array;
			} => !!entry.blockIds && entry.blockIds.length > 0,
		)
		.sort((left, right) => left.blockIds.length - right.blockIds.length);
	if (postingEntries.length === 0) {
		return [];
	}
	let candidateBlockIds = new Set<number>(Array.from(postingEntries[0].blockIds, Number));
	for (let index = 1; index < postingEntries.length; index += 1) {
		const postingSet = new Set<number>(Array.from(postingEntries[index].blockIds, Number));
		candidateBlockIds = new Set(
			[...candidateBlockIds].filter((blockId) => postingSet.has(blockId)),
		);
		if (candidateBlockIds.size === 0) {
			break;
		}
	}
	const matchedCandidates: CoverageLexicalV2PendingHanCandidate[] = [];
	for (const blockId of candidateBlockIds) {
		const descriptor = reader.getBodyHanLogicalBlockDescriptor(blockId);
		if (!descriptor) {
			continue;
		}
		metrics.bodyHanCandidateBlockCount += 1;
		metrics.bodyHanCandidateSegmentCount += descriptor.segmentCount;
		const record = reader.getDocumentRecord(descriptor.docId);
		if (!record) {
			continue;
		}
		const stats = {
			longestContiguousBigramChain: hanBackstopGroup.bigrams.length,
			matchedBigramCount: hanBackstopGroup.bigrams.length,
			bigramCoverageRatio: hanBackstopGroup.bigrams.length > 0 ? 1 : 0,
		};
		recordCoverageLexicalV2TargetedHanDebugBodyGateEvaluation(
			targetedHanDebug,
			hanBackstopGroup,
			descriptor.docId,
			reader,
			stats,
		);
		metrics.bodyHanIntersectedBlockCount += 1;
		matchedCandidates.push({
			docId: descriptor.docId,
			bodyLogicalBlockId: blockId,
			primaryUnitIndex,
			surfaceGroupIndex: hanBackstopGroup.surfaceGroupIndex,
			normalizedText: hanBackstopGroup.normalizedText,
			stableDeterministicKey:
				(record.stableDeterministicKey ?? record.path) + `#${descriptor.blockOrdinal}`,
			stats,
			verificationState: "pending",
			verifiedFields: new Set<CoverageLexicalV2MatchField>(),
		});
	}
	return matchedCandidates
		.sort(compareCoverageLexicalV2PendingHanCandidates)
		.slice(0, docCapPerGroup);
}

function extractCoverageLexicalV2PendingHanCandidateBigrams(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	surfaceGroupIndex: number,
	normalizedText: string,
): readonly string[] {
	for (const group of queryAnalysis.hanBackstopGroups) {
		if (
			group.surfaceGroupIndex === surfaceGroupIndex &&
			group.normalizedText === normalizedText
		) {
			return group.bigrams;
		}
	}
	return [];
}

function getOrComputeCoverageLexicalV2BodyHanExactStats(
	cache: CoverageLexicalV2HanExactStatsCache,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidate: CoverageLexicalV2PendingHanCandidate,
): CoverageLexicalV2CandidateCascadeHanBackstopStats | null {
	if (candidate.bodyLogicalBlockId == null) {
		return null;
	}
	const cacheKey = `${candidate.bodyLogicalBlockId}:${candidate.normalizedText}`;
	if (cache.has(cacheKey)) {
		return cache.get(cacheKey) ?? null;
	}
	const exactStats = reader.getBodyHanExactBlockBackstopStats(
		candidate.bodyLogicalBlockId,
		candidate.normalizedText,
		extractCoverageLexicalV2PendingHanCandidateBigrams(
			queryAnalysis,
			candidate.surfaceGroupIndex,
			candidate.normalizedText,
		),
	);
	cache.set(cacheKey, exactStats);
	return exactStats;
}

function applyCoverageLexicalV2BodyHanExactPrefetchMetrics(
	metrics: CoverageLexicalV2HanBackstopSourceMetrics,
	prefetch: CoverageLexicalV2CandidateCascadeHanExactPrefetchResult,
): void {
	const fetchedBlockCount = prefetch.fetchedBlockCount ?? prefetch.fetchedDocCount ?? 0;
	metrics.bodyHanColdExactFetchedBlockCount += fetchedBlockCount;
	metrics.bodyHanColdExactByteSum += prefetch.byteSum;
	metrics.bodyHanColdExactSkippedByBudget += prefetch.skippedByBudget;
	if (
		prefetch.skippedReason !== "none" &&
		metrics.bodyHanColdExactSkippedReason === "not_requested"
	) {
		metrics.bodyHanColdExactSkippedReason = prefetch.skippedReason;
		return;
	}
	if (
		fetchedBlockCount > 0 ||
		prefetch.byteSum > 0 ||
		prefetch.skippedReason === "none"
	) {
		metrics.bodyHanColdExactSkippedReason = prefetch.skippedReason;
	}
}

function rankCoverageLexicalV2MetadataHanBackstopCandidates(
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2HanBackstopRankedCandidate[] {
	const matchedBigramIndicesByDoc = new Map<
		number,
		Map<CoverageLexicalV2CandidateCascadePostingField, Set<number>>
	>();
	for (let bigramIndex = 0; bigramIndex < hanBackstopGroup.bigrams.length; bigramIndex += 1) {
		const bigram = hanBackstopGroup.bigrams[bigramIndex];
		for (const field of METADATA_FIELDS) {
			collectCoverageLexicalV2HanBackstopPostingMatches(
				matchedBigramIndicesByDoc,
				reader.getMetadataHanBigramPostingMatches(field, bigram),
				field,
				bigramIndex,
			);
		}
	}
	const rankedCandidates: CoverageLexicalV2HanBackstopRankedCandidate[] = [];
	for (const [docId, matchedBigramIndicesByField] of matchedBigramIndicesByDoc.entries()) {
		const record = reader.getDocumentRecord(docId);
		if (!record) {
			continue;
		}
		const stats = buildCoverageLexicalV2HanBackstopGateStats(
			hanBackstopGroup.bigrams.length,
			matchedBigramIndicesByField,
		);
		if (!passesCoverageLexicalV2HanBackstopGate(hanBackstopGroup.bigrams.length, stats)) {
			continue;
		}
		rankedCandidates.push({
			docId,
			stableDeterministicKey: record.stableDeterministicKey ?? record.path,
			stats,
		});
	}
	return rankedCandidates.sort(compareCoverageLexicalV2HanBackstopRankedCandidates);
}

function collectCoverageLexicalV2HanBackstopPostingMatches(
	target: Map<number, Map<CoverageLexicalV2CandidateCascadePostingField, Set<number>>>,
	postings: readonly number[] | Uint32Array | undefined,
	field: CoverageLexicalV2CandidateCascadePostingField,
	bigramIndex: number,
): void {
	if (!postings) {
		return;
	}
	for (const docIdValue of postings) {
		const docId = Number(docIdValue);
		const matchedBigramIndicesByField = target.get(docId) ?? new Map();
		const matchedBigramIndices = matchedBigramIndicesByField.get(field) ?? new Set<number>();
		matchedBigramIndices.add(bigramIndex);
		matchedBigramIndicesByField.set(field, matchedBigramIndices);
		target.set(docId, matchedBigramIndicesByField);
	}
}

function buildCoverageLexicalV2HanBackstopGateStats(
	totalBigramCount: number,
	matchedBigramIndicesByField: ReadonlyMap<
		CoverageLexicalV2CandidateCascadePostingField,
		ReadonlySet<number>
	>,
): CoverageLexicalV2CandidateCascadeHanBackstopStats {
	let bestStats: CoverageLexicalV2CandidateCascadeHanBackstopStats = {
		longestContiguousBigramChain: 0,
		matchedBigramCount: 0,
		bigramCoverageRatio: 0,
	};
	for (const matchedBigramIndices of matchedBigramIndicesByField.values()) {
		const stats = {
			longestContiguousBigramChain: computeCoverageLexicalV2HanBackstopLongestChain(
				matchedBigramIndices,
			),
			matchedBigramCount: matchedBigramIndices.size,
			bigramCoverageRatio:
				totalBigramCount > 0 ? matchedBigramIndices.size / totalBigramCount : 0,
		};
		if (
			stats.longestContiguousBigramChain > bestStats.longestContiguousBigramChain ||
			(
				stats.longestContiguousBigramChain === bestStats.longestContiguousBigramChain &&
				stats.matchedBigramCount > bestStats.matchedBigramCount
			) ||
			(
				stats.longestContiguousBigramChain === bestStats.longestContiguousBigramChain &&
				stats.matchedBigramCount === bestStats.matchedBigramCount &&
				stats.bigramCoverageRatio > bestStats.bigramCoverageRatio
			)
		) {
			bestStats = stats;
		}
	}
	return bestStats;
}

function computeCoverageLexicalV2HanBackstopLongestChain(
	matchedBigramIndices: ReadonlySet<number>,
): number {
	const sorted = [...matchedBigramIndices].sort((left, right) => left - right);
	let longest = 0;
	let current = 0;
	let previous = Number.NaN;
	for (const bigramIndex of sorted) {
		if (!Number.isFinite(previous) || bigramIndex === previous + 1) {
			current += 1;
		} else {
			current = 1;
		}
		if (current > longest) {
			longest = current;
		}
		previous = bigramIndex;
	}
	return longest;
}

function passesCoverageLexicalV2HanBackstopGate(
	totalBigramCount: number,
	stats: CoverageLexicalV2CandidateCascadeHanBackstopStats,
): boolean {
	if (totalBigramCount <= 1) {
		return stats.matchedBigramCount === totalBigramCount;
	}
	if (totalBigramCount === 2) {
		return stats.matchedBigramCount === totalBigramCount;
	}
	return stats.matchedBigramCount >= 2 && stats.longestContiguousBigramChain >= 2;
}

function verifyCoverageLexicalV2HanBackstopMetadataCandidate(
	docId: number,
	normalizedText: string,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2MatchField[] {
	const metadataTexts = reader.getDocumentRecord(docId);
	return metadataTexts
		? verifyCoverageLexicalV2HanBackstopMetadataRecord(
			metadataTexts,
			normalizedText,
		)
		: [];
}

function verifyCoverageLexicalV2HanBackstopMetadataRecord(
	metadataTexts: CoverageLexicalV2CandidateCascadeDocumentRecord,
	normalizedText: string,
): CoverageLexicalV2MatchField[] {
	const verifiedFields: CoverageLexicalV2MatchField[] = [];
	appendCoverageLexicalV2VerifiedMetadataFields(
		verifiedFields,
		metadataTexts,
		normalizedText,
	);
	return dedupeCoverageLexicalV2VerifiedFields(verifiedFields);
}

function compareCoverageLexicalV2PendingHanCandidates(
	left: CoverageLexicalV2PendingHanCandidate,
	right: CoverageLexicalV2PendingHanCandidate,
): number {
	if (left.verificationState !== right.verificationState) {
		return left.verificationState === "verified" ? -1 : 1;
	}
	const statsComparison = compareCoverageLexicalV2HanBackstopStats(
		left.stats,
		right.stats,
	);
	if (statsComparison !== 0) {
		return statsComparison;
	}
	if (left.primaryUnitIndex !== right.primaryUnitIndex) {
		return left.primaryUnitIndex - right.primaryUnitIndex;
	}
	return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
}

function compareCoverageLexicalV2HanBackstopRankedCandidates(
	left: CoverageLexicalV2HanBackstopRankedCandidate,
	right: CoverageLexicalV2HanBackstopRankedCandidate,
): number {
	const statsComparison = compareCoverageLexicalV2HanBackstopStats(
		left.stats,
		right.stats,
	);
	if (statsComparison !== 0) {
		return statsComparison;
	}
	return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
}

function compareCoverageLexicalV2HanBackstopStats(
	left: CoverageLexicalV2CandidateCascadeHanBackstopStats,
	right: CoverageLexicalV2CandidateCascadeHanBackstopStats,
): number {
	if (left.longestContiguousBigramChain !== right.longestContiguousBigramChain) {
		return right.longestContiguousBigramChain - left.longestContiguousBigramChain;
	}
	if (left.matchedBigramCount !== right.matchedBigramCount) {
		return right.matchedBigramCount - left.matchedBigramCount;
	}
	if (left.bigramCoverageRatio !== right.bigramCoverageRatio) {
		return right.bigramCoverageRatio - left.bigramCoverageRatio;
	}
	return 0;
}

function selectCoverageLexicalV2BetterHanBackstopStats(
	left: CoverageLexicalV2CandidateCascadeHanBackstopStats | null,
	right: CoverageLexicalV2CandidateCascadeHanBackstopStats,
): CoverageLexicalV2CandidateCascadeHanBackstopStats {
	if (!left) {
		return right;
	}
	return compareCoverageLexicalV2HanBackstopStats(left, right) <= 0 ? left : right;
}

function createCoverageLexicalV2PendingHanCandidateKey(
	docId: number,
	primaryUnitIndex: number,
): string {
	return String(docId) + ":" + String(primaryUnitIndex);
}

function appendCoverageLexicalV2VerifiedMetadataFields(
	target: CoverageLexicalV2MatchField[],
	metadataTexts: CoverageLexicalV2CandidateCascadeDocumentRecord,
	normalizedText: string,
): void {
	if (doesCoverageLexicalV2NormalizedTextContainHanSegment(metadataTexts.basenameText, normalizedText)) {
		target.push("basename");
	}
	if (doesCoverageLexicalV2NormalizedTextContainHanSegment(metadataTexts.aliasesText, normalizedText)) {
		target.push("aliases");
	}
	if (doesCoverageLexicalV2NormalizedTextContainHanSegment(metadataTexts.headingsText, normalizedText)) {
		target.push("headings");
	}
	if (doesCoverageLexicalV2NormalizedTextContainHanSegment(metadataTexts.folderText, normalizedText)) {
		target.push("folder");
	}
	if (doesCoverageLexicalV2NormalizedTextContainHanSegment(metadataTexts.tagsText, normalizedText)) {
		target.push("tag");
	}
}

function doesCoverageLexicalV2NormalizedTextContainHanSegment(
	text: string,
	normalizedText: string,
): boolean {
	const normalizedFieldText = normalizeCoverageLexicalV2Text(text);
	if (normalizedFieldText.length === 0) {
		return false;
	}
	for (const hanSegment of extractHanSegments(normalizedFieldText)) {
		if (hanSegment.includes(normalizedText)) {
			return true;
		}
	}
	return false;
}

function dedupeCoverageLexicalV2VerifiedFields(
	fields: readonly CoverageLexicalV2MatchField[],
): CoverageLexicalV2MatchField[] {
	return [...new Set(fields)];
}

function collectCoverageLexicalV2CascadePostingMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	postings: readonly number[] | Uint32Array | undefined,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	field: CoverageLexicalV2CandidateCascadePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: CoverageLexicalV2MatchQualityKind,
	isExactQueryMatch: boolean,
	sourceDocIds?: Set<number>,
	docCap?: number,
): number {
	if (!postings) {
		return 0;
	}
	let matchCount = 0;
	const fieldDocCount = postings.length;
	for (const docIdValue of postings) {
		const docId = Number(docIdValue);
		const candidateState = getOrCreateCoverageLexicalV2CascadeCandidateState(
			target,
			docId,
			reader,
			sourceDocIds,
			docCap,
		);
		if (!candidateState) {
			continue;
		}
		updateCoverageLexicalV2CascadePrimaryEvidence(
			candidateState,
			field,
			matchedTerm,
			primaryUnit,
			primaryUnitIndex,
			quality,
			isExactQueryMatch,
			fieldDocCount,
		);
		matchCount += 1;
	}
	return matchCount;
}

function updateCoverageLexicalV2CascadePrimaryEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2CandidateCascadePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: CoverageLexicalV2MatchQualityKind,
	isExactQueryMatch: boolean,
	fieldDocCount: number,
): void {
	addCoverageLexicalV2CascadeFieldTerm(candidateState.fieldTerms, field, matchedTerm);
	if (isExactQueryMatch) {
		addCoverageLexicalV2CascadeExactQueryTerm(
			candidateState.exactQueryTerms,
			field,
			primaryUnit.normalizedText,
		);
	}
	switch (quality) {
		case "exact":
			candidateState.exactPrimaryMask.add(primaryUnitIndex);
			candidateState.sourceFlags.hasExact = true;
			break;
		case "prefix":
			candidateState.prefixPrimaryMask.add(primaryUnitIndex);
			candidateState.sourceFlags.hasPrefix = true;
			break;
		case "fuzzy":
			candidateState.fuzzyPrimaryMask.add(primaryUnitIndex);
			candidateState.sourceFlags.hasFuzzy = true;
			break;
	}
	candidateState.matchedGroupMask.add(primaryUnit.surfaceGroupIndex);
	if (primaryUnit.surfaceKind === "latin" || primaryUnit.surfaceKind === "mixed") {
		candidateState.matchedLatinGroupMask.add(primaryUnit.surfaceGroupIndex);
	}
	if (primaryUnit.surfaceKind === "han" || primaryUnit.surfaceKind === "mixed") {
		candidateState.matchedHanGroupMask.add(primaryUnit.surfaceGroupIndex);
	}
	const matchedFields = candidateState.matchedFieldsByPrimaryUnit.get(primaryUnitIndex) ?? new Set<CoverageLexicalV2MatchField>();
	matchedFields.add(field);
	candidateState.matchedFieldsByPrimaryUnit.set(primaryUnitIndex, matchedFields);
	const currentBestQuality = candidateState.bestQualityByPrimaryUnit.get(primaryUnitIndex);
	if (
		currentBestQuality == null ||
		compareCoverageLexicalV2MatchQuality(quality, currentBestQuality) < 0
	) {
		candidateState.bestQualityByPrimaryUnit.set(primaryUnitIndex, quality);
	}
	if (field === "body") {
		candidateState.sourceFlags.hasBody = true;
		if (isExactQueryMatch) {
			candidateState.sourceFlags.hasBodyExact = true;
			candidateState.needsVerification = true;
		}
	} else {
		candidateState.sourceFlags.hasMetadata = true;
		if (quality === "prefix") {
			const currentPrefixHint = candidateState.prefixHintsByPrimaryUnit.get(primaryUnitIndex);
			const nextPrefixHint: CoverageLexicalV2CandidateCascadePrefixHint = {
				field,
				matchedTerm,
				fieldDocCount,
			};
			if (
				currentPrefixHint == null ||
				shouldReplaceCoverageLexicalV2CascadePrefixHint(
					currentPrefixHint,
					nextPrefixHint,
					primaryUnit.normalizedText,
				)
			) {
				candidateState.prefixHintsByPrimaryUnit.set(primaryUnitIndex, nextPrefixHint);
			}
		}
	}
}

function shouldReplaceCoverageLexicalV2CascadePrefixHint(
	current: CoverageLexicalV2CandidateCascadePrefixHint,
	next: CoverageLexicalV2CandidateCascadePrefixHint,
	queryTerm: string,
): boolean {
	if (FIELD_PRIORITY[next.field] !== FIELD_PRIORITY[current.field]) {
		return FIELD_PRIORITY[next.field] < FIELD_PRIORITY[current.field];
	}
	const currentCompletionGain = Math.max(0, current.matchedTerm.length - queryTerm.length);
	const nextCompletionGain = Math.max(0, next.matchedTerm.length - queryTerm.length);
	if (nextCompletionGain !== currentCompletionGain) {
		return nextCompletionGain < currentCompletionGain;
	}
	if (next.fieldDocCount !== current.fieldDocCount) {
		return next.fieldDocCount < current.fieldDocCount;
	}
	return next.matchedTerm.localeCompare(current.matchedTerm) < 0;
}

function updateCoverageLexicalV2CascadeVerifiedHanBackstopEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2CandidateCascadePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
): void {
	addCoverageLexicalV2CascadeFieldTerm(candidateState.fieldTerms, field, matchedTerm);
	addCoverageLexicalV2CascadeExactQueryTerm(
		candidateState.exactQueryTerms,
		field,
		primaryUnit.normalizedText,
	);
	candidateState.exactPrimaryMask.add(primaryUnitIndex);
	candidateState.sourceFlags.hasExact = true;
	candidateState.sourceFlags.hasHanBackstop = true;
	candidateState.matchedGroupMask.add(primaryUnit.surfaceGroupIndex);
	candidateState.matchedHanGroupMask.add(primaryUnit.surfaceGroupIndex);
	const matchedFields =
		candidateState.matchedFieldsByPrimaryUnit.get(primaryUnitIndex) ??
		new Set<CoverageLexicalV2MatchField>();
	matchedFields.add(field);
	candidateState.matchedFieldsByPrimaryUnit.set(primaryUnitIndex, matchedFields);
	const currentBestQuality = candidateState.bestQualityByPrimaryUnit.get(primaryUnitIndex);
	if (
		currentBestQuality == null ||
		compareCoverageLexicalV2MatchQuality("exact", currentBestQuality) < 0
	) {
		candidateState.bestQualityByPrimaryUnit.set(primaryUnitIndex, "exact");
	}
	if (field === "body") {
		candidateState.sourceFlags.hasBody = true;
		candidateState.sourceFlags.hasBodyExact = true;
		return;
	}
	candidateState.sourceFlags.hasMetadata = true;
}

function updateCoverageLexicalV2CascadeFallbackEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2CandidateCascadePostingField,
	matchedTerm: string,
	surfaceGroupIndex: number,
): void {
	addCoverageLexicalV2CascadeFieldTerm(candidateState.fieldTerms, field, matchedTerm);
	candidateState.sourceFlags.hasFallback = true;
	candidateState.fallbackMatchedSurfaceGroups.add(surfaceGroupIndex);
	if (field === "body") {
		candidateState.sourceFlags.hasBody = true;
		return;
	}
	candidateState.sourceFlags.hasMetadata = true;
}

function getOrCreateCoverageLexicalV2CascadeCandidateState(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	docId: number,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	sourceDocIds?: Set<number>,
	docCap?: number,
): CoverageLexicalV2CascadeCandidateState | null {
	const existing = target.get(docId);
	if (existing) {
		return existing;
	}
	if (sourceDocIds && docCap != null && sourceDocIds.size >= docCap) {
		return null;
	}
	const record = reader.getDocumentRecord(docId);
	if (!record) {
		return null;
	}
	if (sourceDocIds) {
		sourceDocIds.add(docId);
	}
	const created: CoverageLexicalV2CascadeCandidateState = {
		docId,
		path: record.path,
		stableDeterministicKey: record.stableDeterministicKey ?? record.path,
		record,
		fieldTerms: createCoverageLexicalV2CascadeCandidateFieldTermSets(),
		exactQueryTerms: createCoverageLexicalV2CascadeCandidateExactQueryTerms(),
		exactPrimaryMask: new Set<number>(),
		prefixPrimaryMask: new Set<number>(),
		fuzzyPrimaryMask: new Set<number>(),
		matchedGroupMask: new Set<number>(),
		matchedLatinGroupMask: new Set<number>(),
		matchedHanGroupMask: new Set<number>(),
		bestFieldByPrimaryUnit: new Map<number, CoverageLexicalV2MatchField>(),
		corroboratedFieldMaskByPrimaryUnit: new Map<number, Set<CoverageLexicalV2MatchField>>(),
		sourceFlags: {
			hasExact: false,
			hasPrefix: false,
			hasFuzzy: false,
			hasFallback: false,
			hasHanBackstop: false,
			hasMetadata: false,
			hasBody: false,
			hasBodyExact: false,
		},
		needsVerification: false,
		hydrationStatus: "not_requested",
		prefetchedBodyTokenSequence: undefined,
		potentialPrimaryCoverageCount: 0,
		fuzzySalvageCoverageCount: 0,
		hanFallbackSalvageGroupCount: 0,
		matchedFieldsByPrimaryUnit: new Map<number, Set<CoverageLexicalV2MatchField>>(),
		bestQualityByPrimaryUnit: new Map<number, CoverageLexicalV2MatchQualityKind>(),
		fallbackMatchedSurfaceGroups: new Set<number>(),
		prefixHintsByPrimaryUnit: new Map<number, CoverageLexicalV2CandidateCascadePrefixHint>(),
	};
	target.set(docId, created);
	return created;
}

function countCoverageLexicalV2CascadePotentialCandidates(
	candidateStateByDocId: ReadonlyMap<number, CoverageLexicalV2CascadeCandidateState>,
): number {
	let count = 0;
	for (const candidateState of candidateStateByDocId.values()) {
		if (
			candidateState.exactPrimaryMask.size > 0 ||
			candidateState.prefixPrimaryMask.size > 0
		) {
			count += 1;
		}
	}
	return count;
}

function addCoverageLexicalV2CascadeFieldTerm(
	fieldTerms: CoverageLexicalV2CascadeCandidateFieldTermSets,
	field: CoverageLexicalV2CandidateCascadePostingField,
	term: string,
): void {
	switch (field) {
		case "basename":
			fieldTerms.basenameTerms.add(term);
			return;
		case "aliases":
			fieldTerms.aliasTerms.add(term);
			return;
		case "headings":
			fieldTerms.headingsTerms.add(term);
			return;
		case "folder":
			fieldTerms.folderTerms.add(term);
			return;
		case "tag":
			fieldTerms.tagTerms.add(term);
			return;
		case "body":
			fieldTerms.bodyTerms.add(term);
			return;
	}
}

function addCoverageLexicalV2CascadeExactQueryTerm(
	exactQueryTerms: CoverageLexicalV2CascadeCandidateExactQueryTerms,
	field: CoverageLexicalV2CandidateCascadePostingField,
	term: string,
): void {
	switch (field) {
		case "basename":
			exactQueryTerms.basenameExactQueryTerms.add(term);
			return;
		case "aliases":
			exactQueryTerms.aliasExactQueryTerms.add(term);
			return;
		case "headings":
			exactQueryTerms.headingsExactQueryTerms.add(term);
			return;
		case "body":
			exactQueryTerms.bodyExactQueryTerms.add(term);
			return;
		case "folder":
		case "tag":
			return;
	}
}

function createCoverageLexicalV2CascadeCandidateFieldTermSets():
CoverageLexicalV2CascadeCandidateFieldTermSets {
	return {
		basenameTerms: new Set<string>(),
		aliasTerms: new Set<string>(),
		headingsTerms: new Set<string>(),
		folderTerms: new Set<string>(),
		tagTerms: new Set<string>(),
		bodyTerms: new Set<string>(),
	};
}

function createCoverageLexicalV2CascadeCandidateExactQueryTerms():
CoverageLexicalV2CascadeCandidateExactQueryTerms {
	return {
		basenameExactQueryTerms: new Set<string>(),
		aliasExactQueryTerms: new Set<string>(),
		headingsExactQueryTerms: new Set<string>(),
		bodyExactQueryTerms: new Set<string>(),
	};
}

function toCoverageLexicalV2CandidateCascadeFieldTerms(
	fieldTerms: CoverageLexicalV2CascadeCandidateFieldTermSets,
): CoverageLexicalV2CandidateCascadeFieldTerms {
	return {
		basenameTerms: fieldTerms.basenameTerms.size > 0 ? [...fieldTerms.basenameTerms] : undefined,
		aliasTerms: fieldTerms.aliasTerms.size > 0 ? [...fieldTerms.aliasTerms] : undefined,
		headingsTerms: fieldTerms.headingsTerms.size > 0 ? [...fieldTerms.headingsTerms] : undefined,
		folderTerms: fieldTerms.folderTerms.size > 0 ? [...fieldTerms.folderTerms] : undefined,
		tagTerms: fieldTerms.tagTerms.size > 0 ? [...fieldTerms.tagTerms] : undefined,
		bodyTerms: fieldTerms.bodyTerms.size > 0 ? [...fieldTerms.bodyTerms] : undefined,
	};
}

function tokenizeCoverageLexicalV2CandidateCascadeText(
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	text: string,
): readonly string[] | undefined {
	const tokenSequence = reader.tokenizeText(text);
	return tokenSequence.length > 0 ? [...tokenSequence] : undefined;
}

function toCoverageLexicalV2CandidateCascadePrimaryUnitDefinition(
	primaryUnit: CoverageLexicalV2QueryUnit,
): CoverageLexicalV2CandidateCascadePrimaryUnitDefinition {
	return {
		normalizedText: normalizeCoverageLexicalV2CandidateCascadeTerm(primaryUnit.normalizedText),
		surfaceGroupIndex: primaryUnit.surfaceGroupIndex,
		surfaceKind: toCoverageLexicalV2CandidateCascadeSurfaceKind(primaryUnit),
	};
}

function toCoverageLexicalV2CandidateCascadeSurfaceKind(
	primaryUnit: CoverageLexicalV2QueryUnit,
): CoverageLexicalV2CandidateCascadePrimaryUnitDefinition["surfaceKind"] {
	switch (primaryUnit.surfaceKind) {
		case "han":
			return "han";
		case "mixed":
			return "mixed";
		case "latin":
		case "other":
			return "latin";
	}
}

function collectCoverageLexicalV2CascadeMatchedTerms(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): string[] {
	return [...new Set(matchedPrimaryUnits.map((matchedPrimaryUnit) => matchedPrimaryUnit.normalizedText))];
}

function countCoverageLexicalV2CascadeMaskUnion(
	left: ReadonlySet<number>,
	right: ReadonlySet<number>,
): number {
	const values = new Set<number>(left);
	for (const value of right) {
		values.add(value);
	}
	return values.size;
}

function createCoverageLexicalV2CascadePrimaryUnitKey(
	surfaceGroupIndex: number,
	normalizedText: string,
): string {
	return String(surfaceGroupIndex) + ":" + normalizedText;
}
