import type { FileSearchRequest } from "../file-search-engine";
import {
	buildCoverageLexicalPassageAdmissionSignal,
	compareCoverageLexicalPassageAdmissionSignals,
} from "./coverage-lexical-admission";
import {
	buildCoverageLexicalBodyEvidenceTrace,
	type CoverageLexicalBodyEvidenceTrace,
} from "./coverage-lexical-body-evidence";
import {
	buildCoverageLexicalCharQuery,
	evaluateCoverageLexicalBodyCharVerification,
	evaluateCoverageLexicalTagFallback,
	type CoverageLexicalBodyCharVerification,
	type CoverageLexicalCharQuery,
} from "./coverage-lexical-cjk";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalMetadataField,
	CoverageLexicalPassageAdmissionSignal,
	CoverageLexicalPrefixWitness,
	CoverageLexicalPhraseSignature,
	CoverageLexicalPlan,
	CoverageLexicalRecallDebug,
	CoverageLexicalRecallLaneDebug,
} from "./coverage-lexical-types";

type CoverageLexicalPostingList =
	| ReadonlySet<string>
	| readonly number[]
	| Uint32Array;
type CoverageLexicalPostingMap = ReadonlyMap<string, CoverageLexicalPostingList>;
type CoverageLexicalCandidateKey = number;
type CoverageLexicalPrefixTarget = "metadata" | "body" | "all";

type CoverageLexicalRecallIndex = {
	bodyPostings: CoverageLexicalPostingMap;
	bodyCharPostings?: CoverageLexicalPostingMap;
	bodyHanSegmentPostings?: CoverageLexicalPostingMap;
	metadataAliasCharPostings: CoverageLexicalPostingMap;
	metadataAliasHanSegmentPostings?: CoverageLexicalPostingMap;
	metadataAliasPhrasePostings: CoverageLexicalPostingMap;
	metadataAliasPostings: CoverageLexicalPostingMap;
	metadataBasenameCharPostings: CoverageLexicalPostingMap;
	metadataBasenameHanSegmentPostings?: CoverageLexicalPostingMap;
	metadataBasenamePhrasePostings: CoverageLexicalPostingMap;
	metadataBasenamePostings: CoverageLexicalPostingMap;
	metadataFolderCharPostings: CoverageLexicalPostingMap;
	metadataFolderHanSegmentPostings?: CoverageLexicalPostingMap;
	metadataFolderPhrasePostings: CoverageLexicalPostingMap;
	metadataFolderPostings: CoverageLexicalPostingMap;
	metadataHeadingCharPostings: CoverageLexicalPostingMap;
	metadataHeadingHanSegmentPostings?: CoverageLexicalPostingMap;
	metadataHeadingPhrasePostings: CoverageLexicalPostingMap;
	metadataHeadingPostings: CoverageLexicalPostingMap;
	metadataPhrasePostings?: CoverageLexicalPostingMap;
	metadataTagCharPostings: CoverageLexicalPostingMap;
	metadataTagFullPostings: CoverageLexicalPostingMap;
	metadataTagPhrasePostings: CoverageLexicalPostingMap;
	metadataTagPostings: CoverageLexicalPostingMap;
	sortedLexicon: readonly string[];
	documentIdByPath: ReadonlyMap<string, number>;
	documentPathById: readonly (string | undefined)[];
	getDocumentBodyTokens: (docId: number) => readonly string[];
	getDocumentMetadataFieldText?: (
		docId: number,
		field: CoverageLexicalMetadataField,
	) => string;
	documentBodyHanSegmentsById: readonly (readonly string[] | undefined)[];
	documentTagValuesById: readonly (readonly string[] | undefined)[];
};

type CoverageLexicalCollectionScope = "all" | "body-only" | "metadata-only";

type CoverageLexicalLaneName =
	| "strict_metadata_lane"
	| "strict_hybrid_lane"
	| "relaxed_hybrid_lane"
	| "local_body_lane"
	| "bridge_lane"
	| "char_fallback_lane";

export type CoverageLexicalRecallBenchmarkSubphaseName =
	| "laneCollect"
	| "laneMerge"
	| "lanePrefilter"
	| "laneEvaluate"
	| "laneRank"
	| "finalUnion";

export type CoverageLexicalLaneEvaluateBenchmarkSubphaseName =
	| "phraseWeight"
	| "tagFallback"
	| "bodyEvidence"
	| "passageSignal";

type CoverageLexicalRecallDebugAccumulator = {
	lanes: Map<CoverageLexicalLaneName, CoverageLexicalRecallLaneDebug>;
};

export type CoverageLexicalRecallBenchmarkHooks = {
	recordSubphaseTiming: (
		subphase: CoverageLexicalRecallBenchmarkSubphaseName,
		elapsedMs: number,
		unitCount?: number,
	) => void;
	bodyEvidenceWindowFuzzyProportion?: number;
	storeBodyEvidenceTrace?: (
		docId: number,
		trace: CoverageLexicalBodyEvidenceTrace,
	) => void;
	recordLaneEvaluateSubphaseTiming?: (
		subphase: CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
		elapsedMs: number,
		unitCount?: number,
	) => void;
};

type CoverageLexicalPrefixExpansionCandidate = {
	prefix: string;
	term: string;
	bodyDocCount: number;
	metadataDocCount: number;
	totalDocCount: number;
	targetDocCount: number;
	completionGain: number;
	shapePenalty: number;
	score: number;
};

type CoverageLexicalPrefixExpansionProfile = {
	cacheKey: string;
	target: CoverageLexicalPrefixTarget;
	minTermLength: number;
	explorationCap: number;
	termBudget: number;
	docBudget: number;
	stagnationLimit: number;
};

type CoverageLexicalQueryCache = {
	tagFallbackByDocId: Map<
		number,
		ReturnType<typeof evaluateCoverageLexicalTagFallback>
	>;
	bodyEvidenceTraceByDocId: Map<number, CoverageLexicalBodyEvidenceTrace>;
	passageSignalByDocAndPhraseKey: Map<
		string,
		ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>
	>;
	prefixExpansionsByTerm: Map<
		string,
		readonly CoverageLexicalPrefixExpansionCandidate[]
	>;
	fuzzyExpansionsByTerm: Map<string, readonly string[]>;
	phraseSignatureBucketsByKey: Map<
		string,
		readonly CoverageLexicalPhraseSignature[]
	>;
	bodyPhraseWitnessCandidateKeysBySignatureKey: Map<
		string,
		readonly CoverageLexicalCandidateKey[]
	>;
};

type CoverageLexicalGroupSignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
	tailWeight: number;
};

type CoverageLexicalDerivedPlan = {
	optionalAnchorFamilies: readonly CoverageLexicalFamily[];
	optionalBodyFamilies: readonly CoverageLexicalFamily[];
	strictMetadataFamilies: readonly CoverageLexicalFamily[];
	strictMetadataPhraseFamilyIndices: ReadonlySet<number>;
	strictHybridBodyFamilies: readonly CoverageLexicalFamily[];
	strictHybridPhraseFamilyIndices: ReadonlySet<number>;
	relaxedBodyFamilies: readonly CoverageLexicalFamily[];
	relaxedHybridPhraseFamilyIndices: ReadonlySet<number>;
	localBodyFamilies: readonly CoverageLexicalFamily[];
	localBodyPhraseFamilyIndices: ReadonlySet<number>;
	bridgeCollectionFamilies: readonly CoverageLexicalFamily[];
	bridgePhraseFamilyIndices: ReadonlySet<number>;
};

type CoverageLexicalCheapLaneSignal = {
	hardAnchorMetadata: CoverageLexicalGroupSignal;
	metadataAssist: CoverageLexicalGroupSignal;
	decisiveBody: CoverageLexicalGroupSignal;
	supportBody: CoverageLexicalGroupSignal;
	optionalBody: CoverageLexicalGroupSignal;
	bridgeSignal: CoverageLexicalGroupSignal;
	phraseMatchCount: number;
	tagExactCount: number;
	tagCharCount: number;
	metadataCharCount: number;
	bodyCharCount: number;
};

const ALL_METADATA_FIELDS: readonly CoverageLexicalMetadataField[] = [
	"basename",
	"aliases",
	"folder",
	"headings",
	"tags",
];

function getMetadataFieldPriority(field: CoverageLexicalMetadataField | null): number {
	switch (field) {
		case "basename":
			return 5;
		case "aliases":
			return 4;
		case "headings":
			return 3;
		case "folder":
			return 2;
		case "tags":
			return 1;
		default:
			return 0;
	}
}

function comparePrefixWitnesses(
	left: CoverageLexicalPrefixWitness,
	right: CoverageLexicalPrefixWitness,
): number {
	const channelDecision =
		(left.channel === "metadata" ? 1 : 0) - (right.channel === "metadata" ? 1 : 0);
	if (channelDecision !== 0) {
		return channelDecision;
	}
	const fieldDecision =
		getMetadataFieldPriority(left.field) - getMetadataFieldPriority(right.field);
	if (fieldDecision !== 0) {
		return fieldDecision;
	}
	const boundaryDecision = left.boundaryQuality - right.boundaryQuality;
	if (boundaryDecision !== 0) {
		return boundaryDecision;
	}
	const compoundDecision = right.compoundPenalty - left.compoundPenalty;
	if (compoundDecision !== 0) {
		return compoundDecision;
	}
	const surfaceGainDecision = right.surfaceCompletionGain - left.surfaceCompletionGain;
	if (surfaceGainDecision !== 0) {
		return surfaceGainDecision;
	}
	const gainDecision = right.completionGain - left.completionGain;
	if (gainDecision !== 0) {
		return gainDecision;
	}
	const shapeDecision = right.shapePenalty - left.shapePenalty;
	if (shapeDecision !== 0) {
		return shapeDecision;
	}
	const docDecision = right.targetDocCount - left.targetDocCount;
	if (docDecision !== 0) {
		return docDecision;
	}
	const totalDocDecision = right.totalDocCount - left.totalDocCount;
	if (totalDocDecision !== 0) {
		return totalDocDecision;
	}
	return right.term.localeCompare(left.term);
}

function buildPrefixWitness(
	channel: CoverageLexicalPrefixWitness["channel"],
	field: CoverageLexicalMetadataField | null,
	candidate: CoverageLexicalPrefixExpansionCandidate,
	surfaceText: string | null = null,
): CoverageLexicalPrefixWitness {
	const normalizedSurfaceText = surfaceText?.trim() || null;
	const surfaceCompletionGain = normalizedSurfaceText
		? Math.max(0, normalizedSurfaceText.length - candidate.prefix.length)
		: candidate.completionGain;
	const boundaryQuality = computePrefixBoundaryQuality(normalizedSurfaceText);
	const compoundPenalty = computePrefixCompoundPenalty(normalizedSurfaceText);
	return {
		channel,
		field,
		term: candidate.term,
		surfaceText: normalizedSurfaceText,
		completionGain: candidate.completionGain,
		surfaceCompletionGain,
		boundaryQuality,
		compoundPenalty,
		shapePenalty: candidate.shapePenalty,
		targetDocCount: candidate.targetDocCount,
		totalDocCount: candidate.totalDocCount,
	};
}

function maybeRecordBetterPrefixWitness(
	current: CoverageLexicalPrefixWitness | null,
	next: CoverageLexicalPrefixWitness,
): CoverageLexicalPrefixWitness {
	if (!current) {
		return next;
	}
	return comparePrefixWitnesses(next, current) > 0 ? next : current;
}

type CoverageLexicalCheapLaneCandidate = {
	key: CoverageLexicalCandidateKey;
	state: CoverageLexicalCandidateState;
	signal: CoverageLexicalCheapLaneSignal;
};

type CoverageLexicalLaneEvaluation = {
	key: CoverageLexicalCandidateKey;
	state: CoverageLexicalCandidateState;
	hardAnchorMetadata: CoverageLexicalGroupSignal;
	metadataAssist: CoverageLexicalGroupSignal;
	decisiveBody: CoverageLexicalGroupSignal;
	supportBody: CoverageLexicalGroupSignal;
	optionalBody: CoverageLexicalGroupSignal;
	bridgeSignal: CoverageLexicalGroupSignal;
	bodyCharMatchCount: number;
	bodyCharMatchRatio: number;
	metadataCharMatchCount: number;
	metadataCharMatchRatio: number;
	tagExactMatchCount: number;
	tagCharMatchCount: number;
	tagCharMatchRatio: number;
	phraseMatchCount: number;
	phraseMatchWeight: number;
	passageSignal: ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>;
};

type CoverageLexicalEvaluatedLaneCandidate = {
	candidate: CoverageLexicalCheapLaneCandidate;
	evaluation: CoverageLexicalLaneEvaluation;
};

const MAX_FUZZY_EXPANSIONS = 24;
const ASCII_PREFIX_TERM_REGEX = /^[a-z0-9_-]+$/u;
const METADATA_PREFIX_MIN_TERM_LENGTH = 3;
const BODY_PREFIX_MIN_TERM_LENGTH = 4;
const METADATA_PREFIX_EXPLORATION_CAP = 128;
const METADATA_PREFIX_TERM_BUDGET = 48;
const METADATA_PREFIX_DOC_BUDGET = 400;
const METADATA_ASSIST_PREFIX_EXPLORATION_CAP = 48;
const METADATA_ASSIST_PREFIX_TERM_BUDGET = 12;
const METADATA_ASSIST_PREFIX_DOC_BUDGET = 80;
const MIXED_PREFIX_EXPLORATION_CAP = 96;
const MIXED_PREFIX_TERM_BUDGET = 24;
const MIXED_PREFIX_DOC_BUDGET = 220;
const BODY_PREFIX_SHORT_EXPLORATION_CAP = 48;
const BODY_PREFIX_SHORT_TERM_BUDGET = 6;
const BODY_PREFIX_SHORT_DOC_BUDGET = 96;
const BODY_PREFIX_MEDIUM_EXPLORATION_CAP = 96;
const BODY_PREFIX_MEDIUM_TERM_BUDGET = 12;
const BODY_PREFIX_MEDIUM_DOC_BUDGET = 180;
const BODY_PREFIX_LONG_EXPLORATION_CAP = 160;
const BODY_PREFIX_LONG_TERM_BUDGET = 24;
const BODY_PREFIX_LONG_DOC_BUDGET = 320;
const PREFIX_ZERO_GAIN_STAGNATION_LIMIT = 4;
const coverageLexicalDerivedPlanCache = new WeakMap<
	CoverageLexicalPlan,
	CoverageLexicalDerivedPlan
>();

function createRecallDebugAccumulator(): CoverageLexicalRecallDebugAccumulator {
	return {
		lanes: new Map(),
	};
}

function createCoverageLexicalQueryCache(): CoverageLexicalQueryCache {
	return {
		tagFallbackByDocId: new Map(),
		bodyEvidenceTraceByDocId: new Map(),
		passageSignalByDocAndPhraseKey: new Map(),
		prefixExpansionsByTerm: new Map(),
		fuzzyExpansionsByTerm: new Map(),
		phraseSignatureBucketsByKey: new Map(),
		bodyPhraseWitnessCandidateKeysBySignatureKey: new Map(),
	};
}

function getOrCreateDerivedPlan(
	plan: CoverageLexicalPlan,
): CoverageLexicalDerivedPlan {
	const cached = coverageLexicalDerivedPlanCache.get(plan);
	if (cached) {
		return cached;
	}
	const optionalAnchorFamilies = plan.optionalFamilies.filter(
		(family) => family.role === "anchor",
	);
	const optionalBodyFamilies = plan.optionalFamilies.filter(
		(family) => family.role === "body",
	);
	const strictMetadataFamilies = [
		...plan.hardAnchorFamilies,
		...optionalAnchorFamilies,
	];
	const strictHybridBodyFamilies = [
		...plan.decisiveBodyFamilies,
		...plan.supportBodyFamilies,
	];
	const relaxedBodyFamilies = [
		...strictHybridBodyFamilies,
		...optionalBodyFamilies,
	];
	const localBodyFamilies = relaxedBodyFamilies;
	const bridgeCollectionFamilies = [
		...plan.bridgeFamilies,
		...plan.hardAnchorFamilies,
		...plan.decisiveBodyFamilies,
	];
	const created = {
		optionalAnchorFamilies,
		optionalBodyFamilies,
		strictMetadataFamilies,
		strictMetadataPhraseFamilyIndices: createFamilyIndexSet(
			strictMetadataFamilies,
		),
		strictHybridBodyFamilies,
		strictHybridPhraseFamilyIndices: createFamilyIndexSet([
			...plan.hardAnchorFamilies,
			...strictHybridBodyFamilies,
		]),
		relaxedBodyFamilies,
		relaxedHybridPhraseFamilyIndices: createFamilyIndexSet([
			...plan.hardAnchorFamilies,
			...plan.decisiveBodyFamilies,
			...plan.supportBodyFamilies,
			...plan.optionalFamilies,
		]),
		localBodyFamilies,
		localBodyPhraseFamilyIndices: createFamilyIndexSet(localBodyFamilies),
		bridgeCollectionFamilies,
		bridgePhraseFamilyIndices: createFamilyIndexSet(bridgeCollectionFamilies),
	};
	coverageLexicalDerivedPlanCache.set(plan, created);
	return created;
}

function createFamilyIndexSet(
	families: readonly CoverageLexicalFamily[],
): ReadonlySet<number> {
	return new Set(families.map((family) => family.index));
}

function recordLaneDebug(
	debug: CoverageLexicalRecallDebugAccumulator | null,
	laneName: CoverageLexicalLaneName,
	candidateCount: number,
	candidatePaths: string[],
	prefilteredPaths: string[],
	admittedPaths: string[],
): void {
	if (!debug) {
		return;
	}
	debug.lanes.set(laneName, {
		laneName,
		candidateCount,
		candidatePaths,
		prefilterCount: prefilteredPaths.length,
		admittedCount: admittedPaths.length,
		prefilteredPaths,
		admittedPaths,
	});
}

export function collectCoverageLexicalCandidateStates(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery = buildCoverageLexicalCharQuery(
		request.queryText,
	),
): Map<string, CoverageLexicalCandidateState> {
	return projectCandidateStatesToPaths(
		index,
		collectCoverageLexicalCandidateStatesByDocId(
			index,
			plan,
			phraseSignatures,
			request,
			charQuery,
		),
	);
}

export function collectCoverageLexicalCandidateStatesByDocId(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery = buildCoverageLexicalCharQuery(
		request.queryText,
	),
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null = null,
): Map<number, CoverageLexicalCandidateState> {
	return collectCoverageLexicalCandidateStatesInternal(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		null,
		benchmarkHooks,
	);
}

export function collectCoverageLexicalCandidateStatesWithDebug(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery = buildCoverageLexicalCharQuery(
		request.queryText,
	),
): {
	candidates: Map<string, CoverageLexicalCandidateState>;
	debug: CoverageLexicalRecallDebug;
} {
	const debug = createRecallDebugAccumulator();
	const candidatesByDocId = collectCoverageLexicalCandidateStatesInternal(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		debug,
		null,
	);
	return {
		candidates: projectCandidateStatesToPaths(index, candidatesByDocId),
		debug: {
			lanes: Array.from(debug.lanes.values()),
			unionSize: candidatesByDocId.size,
		},
	};
}

function collectCoverageLexicalCandidateStatesInternal(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): Map<number, CoverageLexicalCandidateState> {
	const queryCache = createCoverageLexicalQueryCache();
	const aggregateCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	const admittedKeys = new Set<CoverageLexicalCandidateKey>();

	runStrictMetadataLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
	runCharFallbackLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
	runStrictHybridLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
	runRelaxedHybridLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
	runLocalBodyLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
	runBridgeLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);

	const admittedCandidates = new Map<number, CoverageLexicalCandidateState>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"finalUnion",
		() => {
			for (const key of admittedKeys) {
				const state = aggregateCandidates.get(key);
				if (!state) {
					continue;
				}
				mergeCandidateStateByDocId(admittedCandidates, key, state);
			}
		},
		() => admittedKeys.size,
	);
	return admittedCandidates;
}

function runStrictMetadataLane(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	if (plan.hardAnchorFamilies.length === 0) {
		return;
	}
	const derivedPlan = getOrCreateDerivedPlan(plan);
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneCollect",
		() => {
			collectFamilySetCandidates(
				index,
				queryCache,
				laneCandidates,
				derivedPlan.strictMetadataFamilies,
				{
					scope: "metadata-only",
					includePrefix: request.isPrefixMatch,
					includeFuzzy: false,
				},
			);
			collectPhraseCandidates(
				index,
				queryCache,
				laneCandidates,
				phraseSignatures,
				derivedPlan.strictMetadataPhraseFamilyIndices,
				"metadata-only",
				{
					structuredOnly: false,
					allowPreferredFields: true,
				},
			);
		},
		() => laneCandidates.size,
	);

	admitLaneCandidates(
		"strict_metadata_lane",
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		laneCandidates,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
}

function runStrictHybridLane(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	if (
		plan.hardAnchorFamilies.length === 0 ||
		plan.decisiveBodyFamilies.length === 0
	) {
		return;
	}
	const derivedPlan = getOrCreateDerivedPlan(plan);
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneCollect",
		() => {
			collectFamilySetCandidates(index, queryCache, laneCandidates, plan.hardAnchorFamilies, {
				scope: "metadata-only",
				includePrefix: request.isPrefixMatch,
				includeFuzzy: false,
			});
			collectFamilySetCandidates(
				index,
				queryCache,
				laneCandidates,
				derivedPlan.strictHybridBodyFamilies,
				{
					scope: "body-only",
					includePrefix: request.isPrefixMatch,
					includeFuzzy: request.isFuzzy,
				},
			);
			collectPhraseCandidates(
				index,
				queryCache,
				laneCandidates,
				phraseSignatures,
				derivedPlan.strictHybridPhraseFamilyIndices,
				"all",
				{
					structuredOnly: false,
					allowPreferredFields: true,
				},
			);
		},
		() => laneCandidates.size,
	);

	admitLaneCandidates(
		"strict_hybrid_lane",
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		laneCandidates,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
}

function runRelaxedHybridLane(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	if (
		plan.hardAnchorFamilies.length === 0 ||
		plan.relaxedMinimumMatchCount <= 0
	) {
		return;
	}
	const derivedPlan = getOrCreateDerivedPlan(plan);
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneCollect",
		() => {
			collectFamilySetCandidates(index, queryCache, laneCandidates, plan.hardAnchorFamilies, {
				scope: "metadata-only",
				includePrefix: request.isPrefixMatch,
				includeFuzzy: false,
			});
			collectFamilySetCandidates(
				index,
				queryCache,
				laneCandidates,
				derivedPlan.relaxedBodyFamilies,
				{
					scope: "body-only",
					includePrefix: request.isPrefixMatch,
					includeFuzzy: request.isFuzzy,
				},
			);
			collectPhraseCandidates(
				index,
				queryCache,
				laneCandidates,
				phraseSignatures,
				derivedPlan.relaxedHybridPhraseFamilyIndices,
				"all",
				{
					structuredOnly: false,
					allowPreferredFields: true,
				},
			);
		},
		() => laneCandidates.size,
	);

	admitLaneCandidates(
		"relaxed_hybrid_lane",
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		laneCandidates,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
}

function runLocalBodyLane(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	const derivedPlan = getOrCreateDerivedPlan(plan);
	const localBodyFamilies = derivedPlan.localBodyFamilies;
	if (localBodyFamilies.length === 0) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneCollect",
		() => {
			collectFamilySetCandidates(index, queryCache, laneCandidates, localBodyFamilies, {
				scope: "body-only",
				includePrefix: request.isPrefixMatch,
				includeFuzzy: request.isFuzzy,
			});
			collectPhraseCandidates(
				index,
				queryCache,
				laneCandidates,
				phraseSignatures,
				derivedPlan.localBodyPhraseFamilyIndices,
				"body-only",
				{
					structuredOnly: false,
					allowPreferredFields: false,
				},
			);
		},
		() => laneCandidates.size,
	);

	admitLaneCandidates(
		"local_body_lane",
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		laneCandidates,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
}

function runBridgeLane(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	if (plan.bridgeFamilies.length === 0) {
		return;
	}
	const derivedPlan = getOrCreateDerivedPlan(plan);
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneCollect",
		() => {
			collectFamilySetCandidates(
				index,
				queryCache,
				laneCandidates,
				derivedPlan.bridgeCollectionFamilies,
				{
					scope: "all",
					includePrefix: request.isPrefixMatch,
					includeFuzzy: request.isFuzzy,
				},
			);
			collectPhraseCandidates(
				index,
				queryCache,
				laneCandidates,
				phraseSignatures,
				derivedPlan.bridgePhraseFamilyIndices,
				"all",
				{
					structuredOnly: false,
					allowPreferredFields: true,
				},
			);
		},
		() => laneCandidates.size,
	);

	admitLaneCandidates(
		"bridge_lane",
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		laneCandidates,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
}

function runCharFallbackLane(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	if (charQuery.hanSegments.length === 0) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneCollect",
		() => {
			collectBodyCharGateCandidates(index, charQuery, laneCandidates);
			for (const postings of [
				index.metadataBasenameCharPostings,
				index.metadataAliasCharPostings,
				index.metadataFolderCharPostings,
				index.metadataHeadingCharPostings,
			]) {
				collectCharCandidates(
					index,
					postings,
					charQuery.terms,
					laneCandidates,
					"metadata",
				);
			}
			collectTagExactCandidates(
				index,
				index.metadataTagFullPostings,
				charQuery.uniqueHanSegments,
				laneCandidates,
			);
			collectCharCandidates(
				index,
				index.metadataTagCharPostings,
				charQuery.terms,
				laneCandidates,
				"tag",
			);
		},
		() => laneCandidates.size,
	);
	admitLaneCandidates(
		"char_fallback_lane",
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		laneCandidates,
		aggregateCandidates,
		admittedKeys,
		debug,
		benchmarkHooks,
	);
}

function admitLaneCandidates(
	laneName: CoverageLexicalLaneName,
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	laneCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	aggregateCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	admittedKeys: Set<CoverageLexicalCandidateKey>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): void {
	if (laneCandidates.size === 0) {
		recordLaneDebug(debug, laneName, 0, [], [], []);
		return;
	}
	measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneMerge",
		() => {
			for (const [key, state] of laneCandidates) {
				mergeCandidateStateByDocId(aggregateCandidates, key, state);
			}
		},
		() => laneCandidates.size,
	);

	const budget = computeLaneBudget(laneName, plan, request);
	const preselected = measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"lanePrefilter",
		() =>
			preselectLaneCandidates(
				laneName,
				laneCandidates,
				index,
				plan,
				request,
			),
		() => laneCandidates.size,
	);
	const evaluations = measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneEvaluate",
		() => {
			return evaluateLaneCandidates(
				laneName,
				preselected,
				plan,
				phraseSignatures,
				index,
				charQuery,
				queryCache,
				benchmarkHooks,
				request,
				budget,
			);
		},
		() => preselected.length,
	);
	const admitted = measureRecallBenchmarkSubphase(
		benchmarkHooks,
		"laneRank",
		() => {
			evaluations.sort((left, right) =>
				compareLaneEvaluations(laneName, left, right, plan),
			);
			const selected = evaluations.slice(0, budget);
			for (const evaluation of selected) {
				admittedKeys.add(evaluation.key);
			}
			return selected;
		},
		() => evaluations.length,
	);
	recordLaneDebug(
		debug,
		laneName,
		laneCandidates.size,
		mapCandidateKeysToPaths(index, laneCandidates.keys()),
		preselected
			.map((candidate) => resolveCandidatePath(index, candidate.key))
			.filter(isNonEmptyString),
		admitted
			.map((evaluation) => resolveCandidatePath(index, evaluation.key))
			.filter(isNonEmptyString),
	);
}

function computeLaneBudget(
	laneName: CoverageLexicalLaneName,
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
): number {
	const base =
		laneName === "strict_metadata_lane"
			? 14
			: laneName === "strict_hybrid_lane"
				? 18
				: laneName === "relaxed_hybrid_lane"
					? 24
					: laneName === "local_body_lane"
						? 28
						: laneName === "char_fallback_lane"
							? 18
							: 16;
	const queryBonus =
		(laneName === "strict_metadata_lane" &&
			plan.queryKind === "metadata_only_anchored") ||
		(laneName === "strict_hybrid_lane" &&
			plan.queryKind === "anchor_body_hybrid") ||
		(laneName === "relaxed_hybrid_lane" &&
			plan.queryKind === "memory_relaxed") ||
		(laneName === "local_body_lane" &&
			plan.queryKind === "body_only_local") ||
		(laneName === "bridge_lane" &&
			plan.queryKind === "bridge_dependent")
			? 8
			: 0;
	return Math.max(request.maxItemResults * 2, base + queryBonus);
}

function preselectLaneCandidates(
	laneName: CoverageLexicalLaneName,
	laneCandidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
): CoverageLexicalCheapLaneCandidate[] {
	const entries = Array.from(laneCandidates.entries()).map(
		([key, state]): CoverageLexicalCheapLaneCandidate => ({
			key,
			state,
			signal: buildCheapLaneSignal(state, plan),
		}),
	);
	const budget = computeLaneBudget(laneName, plan, request);
	const prefilterBudget = Math.min(
		entries.length,
		Math.max(budget * 6, request.maxItemResults * 8, 48),
	);
	if (entries.length <= prefilterBudget) {
		return entries;
	}
	const sorted = entries.sort((left, right) =>
		compareCheapLaneCandidates(laneName, left, right),
	);
	const selected = sorted.slice(0, prefilterBudget);
	const selectedKeys = new Set(selected.map(({ key }) => key));
	const cutoff = selected.length > 0 ? selected[selected.length - 1] : null;
	if (cutoff) {
		for (let index = prefilterBudget; index < sorted.length; index += 1) {
			const candidate = sorted[index];
			if (!hasCheapLaneTie(laneName, cutoff.signal, candidate.signal)) {
				break;
			}
			selected.push(candidate);
			selectedKeys.add(candidate.key);
		}
	}
	const witnessFloorAllowance = computeWitnessFloorAllowance(
		laneName,
		request.maxItemResults,
	);
	if (witnessFloorAllowance > 0) {
		let added = 0;
		for (const candidate of sorted) {
			if (selectedKeys.has(candidate.key)) {
				continue;
			}
			if (!shouldProtectCheapWitnessFloor(laneName, candidate.signal, plan)) {
				continue;
			}
			selected.push(candidate);
			selectedKeys.add(candidate.key);
			added += 1;
			if (added >= witnessFloorAllowance) {
				break;
			}
		}
	}
	return selected;
}

function measureRecallBenchmarkSubphase<T>(
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
	subphase: CoverageLexicalRecallBenchmarkSubphaseName,
	execute: () => T,
	unitCount: number | (() => number) = 1,
): T {
	if (!benchmarkHooks) {
		return execute();
	}
	const startedAt = performance.now();
	try {
		return execute();
	} finally {
		const resolvedUnitCount =
			typeof unitCount === "function" ? unitCount() : unitCount;
		benchmarkHooks.recordSubphaseTiming(
			subphase,
			performance.now() - startedAt,
			resolvedUnitCount,
		);
	}
}

function measureLaneEvaluateBenchmarkSubphase<T>(
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
	subphase: CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
	execute: () => T,
	unitCount: number | (() => number) = 1,
): T {
	if (!benchmarkHooks?.recordLaneEvaluateSubphaseTiming) {
		return execute();
	}
	const startedAt = performance.now();
	try {
		return execute();
	} finally {
		const resolvedUnitCount =
			typeof unitCount === "function" ? unitCount() : unitCount;
		benchmarkHooks.recordLaneEvaluateSubphaseTiming(
			subphase,
			performance.now() - startedAt,
			resolvedUnitCount,
		);
	}
}

function evaluateLaneCandidates(
	laneName: CoverageLexicalLaneName,
	preselected: readonly CoverageLexicalCheapLaneCandidate[],
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
	request: FileSearchRequest,
	budget: number,
): CoverageLexicalLaneEvaluation[] {
	const lightEvaluations = evaluateLaneCandidatesLight(
		laneName,
		preselected,
		plan,
		phraseSignatures,
		index,
		charQuery,
		queryCache,
		benchmarkHooks,
	);
	if (laneName === "strict_metadata_lane") {
		return lightEvaluations.map(({ evaluation }) => evaluation);
	}
	if (!shouldDeferFullLaneEvaluation(laneName)) {
		return lightEvaluations.map(({ evaluation }) => evaluation);
	}
	const shortlisted = selectDeferredFullEvaluationCandidates(
		laneName,
		lightEvaluations,
		plan,
		request,
		budget,
	);
	const accepted: CoverageLexicalLaneEvaluation[] = [];
	for (const candidate of shortlisted) {
		const evaluation = buildLaneEvaluation(
			candidate,
			laneName,
			plan,
			phraseSignatures,
			index,
			charQuery,
			queryCache,
			benchmarkHooks,
			{
				includePassageSignal: true,
				includeTagFallback: laneName === "char_fallback_lane",
			},
		);
		if (!evaluation) {
			continue;
		}
		if (!acceptsLaneCandidate(laneName, evaluation, plan, charQuery)) {
			continue;
		}
		accepted.push(evaluation);
	}
	return accepted;
}

function evaluateLaneCandidatesLight(
	laneName: CoverageLexicalLaneName,
	preselected: readonly CoverageLexicalCheapLaneCandidate[],
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): CoverageLexicalEvaluatedLaneCandidate[] {
	const accepted: CoverageLexicalEvaluatedLaneCandidate[] = [];
	for (const candidate of preselected) {
		const evaluation = buildLaneEvaluation(
			candidate,
			laneName,
			plan,
			phraseSignatures,
			index,
			charQuery,
			queryCache,
			benchmarkHooks,
			{
				includePassageSignal: laneName === "local_body_lane",
				includeTagFallback: laneName === "char_fallback_lane",
			},
		);
		if (!evaluation) {
			continue;
		}
		if (!acceptsLaneCandidate(laneName, evaluation, plan, charQuery)) {
			continue;
		}
		accepted.push({
			candidate,
			evaluation,
		});
	}
	accepted.sort((left, right) =>
		compareLaneEvaluations(laneName, left.evaluation, right.evaluation, plan),
	);
	return accepted;
}

function shouldDeferFullLaneEvaluation(laneName: CoverageLexicalLaneName): boolean {
	return false;
}

function selectDeferredFullEvaluationCandidates(
	laneName: CoverageLexicalLaneName,
	lightEvaluations: readonly CoverageLexicalEvaluatedLaneCandidate[],
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
	budget: number,
): CoverageLexicalCheapLaneCandidate[] {
	if (lightEvaluations.length === 0) {
		return [];
	}
	const fullEvalBudget = Math.min(
		lightEvaluations.length,
		Math.max(budget + 8, request.maxItemResults * 2, 16),
	);
	if (lightEvaluations.length <= fullEvalBudget) {
		return lightEvaluations.map(({ candidate }) => candidate);
	}
	const selected: CoverageLexicalCheapLaneCandidate[] = lightEvaluations
		.slice(0, fullEvalBudget)
		.map(({ candidate }) => candidate);
	const selectedKeys = new Set(selected.map(({ key }) => key));
	const cutoff = lightEvaluations[fullEvalBudget - 1]?.evaluation ?? null;
	if (cutoff) {
		for (let index = fullEvalBudget; index < lightEvaluations.length; index += 1) {
			const candidate = lightEvaluations[index];
			if (
				compareLaneEvaluations(laneName, cutoff, candidate.evaluation, plan) !== 0
			) {
				break;
			}
			selected.push(candidate.candidate);
			selectedKeys.add(candidate.candidate.key);
		}
	}
	if (
		laneName === "strict_hybrid_lane" ||
		laneName === "relaxed_hybrid_lane"
	) {
		for (const { candidate } of lightEvaluations) {
			if (selectedKeys.has(candidate.key)) {
				continue;
			}
			if (!shouldProtectCheapWitnessFloor(laneName, candidate.signal, plan)) {
				continue;
			}
			selected.push(candidate);
			selectedKeys.add(candidate.key);
		}
	}
	return selected;
}

function compareCheapLaneCandidates(
	laneName: CoverageLexicalLaneName,
	left: CoverageLexicalCheapLaneCandidate,
	right: CoverageLexicalCheapLaneCandidate,
): number {
	return (
		compareCheapLaneSignals(laneName, left.signal, right.signal) ||
		left.key - right.key
	);
}

function compareCheapLaneSignals(
	laneName: CoverageLexicalLaneName,
	left: CoverageLexicalCheapLaneSignal,
	right: CoverageLexicalCheapLaneSignal,
): number {
	switch (laneName) {
		case "strict_metadata_lane":
			return (
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
				compareGroupSignals(left.bridgeSignal, right.bridgeSignal)
			);
		case "strict_hybrid_lane":
			return (
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareGroupSignals(left.supportBody, right.supportBody) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount)
			);
		case "relaxed_hybrid_lane":
			return (
				compareDescendingMetric(
					left.decisiveBody.coverageCount +
						left.supportBody.coverageCount +
						left.optionalBody.coverageCount,
					right.decisiveBody.coverageCount +
						right.supportBody.coverageCount +
						right.optionalBody.coverageCount,
				) ||
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareGroupSignals(left.supportBody, right.supportBody) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount)
			);
		case "local_body_lane":
			return (
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareGroupSignals(left.supportBody, right.supportBody) ||
				compareGroupSignals(left.optionalBody, right.optionalBody) ||
				compareGroupSignals(left.metadataAssist, right.metadataAssist) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount)
			);
		case "bridge_lane":
			return (
				compareGroupSignals(left.bridgeSignal, right.bridgeSignal) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareGroupSignals(left.metadataAssist, right.metadataAssist) ||
				compareGroupSignals(left.decisiveBody, right.decisiveBody)
			);
		case "char_fallback_lane":
			return (
				compareDescendingMetric(left.tagExactCount, right.tagExactCount) ||
				compareDescendingMetric(left.tagCharCount, right.tagCharCount) ||
				compareDescendingMetric(left.metadataCharCount, right.metadataCharCount) ||
				compareDescendingMetric(left.bodyCharCount, right.bodyCharCount)
			);
		default:
			return 0;
	}
}

function buildCheapLaneSignal(
	state: CoverageLexicalCandidateState,
	plan: CoverageLexicalPlan,
): CoverageLexicalCheapLaneSignal {
	const derivedPlan = getOrCreateDerivedPlan(plan);
	return {
		hardAnchorMetadata: buildGroupSignal(
			state.metadataMatches,
			plan.hardAnchorFamilies,
		),
		metadataAssist: buildMetadataFieldUnionSignal(
			state.metadataAssistFieldMatches,
			plan.families,
		),
		decisiveBody: buildGroupSignal(
			state.bodyMatches,
			plan.decisiveBodyFamilies,
		),
		supportBody: buildGroupSignal(
			state.bodyMatches,
			plan.supportBodyFamilies,
		),
		optionalBody: buildGroupSignal(
			state.bodyMatches,
			derivedPlan.optionalBodyFamilies,
		),
		bridgeSignal: buildMergedGroupSignal(
			state.bodyMatches,
			state.metadataMatches,
			plan.bridgeFamilies,
		),
		phraseMatchCount: state.phraseMatches.length,
		tagExactCount: state.tagExactMatchIndices.length,
		tagCharCount: state.tagCharMatchIndices.length,
		metadataCharCount: state.metadataCharMatchIndices.length,
		bodyCharCount: state.bodyCharMatchIndices.length,
	};
}

function hasCheapLaneTie(
	laneName: CoverageLexicalLaneName,
	left: CoverageLexicalCheapLaneSignal,
	right: CoverageLexicalCheapLaneSignal,
): boolean {
	return compareCheapLaneSignals(laneName, left, right) === 0;
}

function computeWitnessFloorAllowance(
	laneName: CoverageLexicalLaneName,
	maxItemResults: number,
): number {
	switch (laneName) {
		case "strict_hybrid_lane":
		case "relaxed_hybrid_lane":
		case "local_body_lane":
			return Math.max(maxItemResults, 8);
		default:
			return 0;
	}
}

function shouldProtectCheapWitnessFloor(
	laneName: CoverageLexicalLaneName,
	signal: CoverageLexicalCheapLaneSignal,
	plan: CoverageLexicalPlan,
): boolean {
	const fullHardAnchor =
		plan.hardAnchorFamilies.length > 0 &&
		signal.hardAnchorMetadata.coverageCount >= plan.hardAnchorFamilies.length;
	const fullDecisiveBody =
		plan.decisiveBodyFamilies.length > 0 &&
		signal.decisiveBody.coverageCount >= plan.decisiveBodyFamilies.length;
	const hasSupportingBody = signal.supportBody.coverageCount > 0;
	const hasPhraseWitness = signal.phraseMatchCount > 0;
	switch (laneName) {
		case "strict_hybrid_lane":
			return fullDecisiveBody && (fullHardAnchor || hasPhraseWitness);
		case "relaxed_hybrid_lane":
			return fullDecisiveBody && (fullHardAnchor || hasSupportingBody || hasPhraseWitness);
		case "local_body_lane":
			return fullDecisiveBody && (hasSupportingBody || hasPhraseWitness);
		default:
			return false;
	}
}

function buildLaneEvaluation(
	candidate: CoverageLexicalCheapLaneCandidate,
	laneName: CoverageLexicalLaneName,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
	options: {
		includePassageSignal: boolean;
		includeTagFallback: boolean;
	},
): CoverageLexicalLaneEvaluation | null {
	const { key, state, signal } = candidate;
	const phraseMatchCount = signal.phraseMatchCount;
	const phraseMatchWeight = measureLaneEvaluateBenchmarkSubphase(
		benchmarkHooks,
		"phraseWeight",
		() =>
			state.phraseMatches.reduce(
				(total, signatureIndex) =>
					total + (phraseSignatures[signatureIndex]?.tailWeight ?? 0),
				0,
			),
		() => state.phraseMatches.length,
	);
	const tokens = index.getDocumentBodyTokens(key);
	const tagFallback = options.includeTagFallback
		? measureLaneEvaluateBenchmarkSubphase(
				benchmarkHooks,
				"tagFallback",
				() => getOrCreateTagFallback(key, index, charQuery, queryCache),
			)
		: createEmptyTagFallback();
	const passageSignal = options.includePassageSignal
		? measureLaneEvaluateBenchmarkSubphase(
				benchmarkHooks,
				"passageSignal",
				() => {
					const bodyEvidenceTrace = measureLaneEvaluateBenchmarkSubphase(
						benchmarkHooks,
						"bodyEvidence",
						() =>
							getOrCreateBodyEvidenceTrace(
								key,
								tokens,
								plan.families,
								queryCache,
								benchmarkHooks,
							),
					);
					return getOrCreatePassageSignal(
						key,
						tokens,
						plan.families,
						state,
						phraseSignatures,
						phraseMatchCount,
						phraseMatchWeight,
						bodyEvidenceTrace,
						queryCache,
					);
				},
			)
		: createEmptyPassageAdmissionSignal(phraseMatchCount, phraseMatchWeight);
	return {
		key,
		state,
		hardAnchorMetadata: signal.hardAnchorMetadata,
		metadataAssist: signal.metadataAssist,
		decisiveBody: signal.decisiveBody,
		supportBody: signal.supportBody,
		optionalBody: signal.optionalBody,
		bridgeSignal: signal.bridgeSignal,
		bodyCharMatchCount: state.bodyCharMatchIndices.length,
		bodyCharMatchRatio: computeCharMatchRatio(
			state.bodyCharMatchIndices.length,
			charQuery.terms.length,
		),
		metadataCharMatchCount: state.metadataCharMatchIndices.length,
		metadataCharMatchRatio: computeCharMatchRatio(
			state.metadataCharMatchIndices.length,
			charQuery.terms.length,
		),
		tagExactMatchCount: tagFallback.exactMatchCount,
		tagCharMatchCount: tagFallback.charMatchCount,
		tagCharMatchRatio: tagFallback.charMatchRatio,
		phraseMatchCount,
		phraseMatchWeight,
		passageSignal,
	};
}

function createEmptyPassageAdmissionSignal(
	phraseMatchCount: number,
	phraseMatchWeight: number,
): CoverageLexicalPassageAdmissionSignal {
	return {
		coreCoverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		phraseMatchCount,
		phraseMatchWeight,
		compactnessScore: 0,
	};
}

function createEmptyTagFallback(): ReturnType<typeof evaluateCoverageLexicalTagFallback> {
	return {
		exactMatchCount: 0,
		exactTerms: [],
		charMatchCount: 0,
		charMatchRatio: 0,
		matchedCharTerms: [],
	};
}

function getOrCreateBodyEvidenceTrace(
	docId: number,
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	queryCache: CoverageLexicalQueryCache,
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
): CoverageLexicalBodyEvidenceTrace {
	const cached = queryCache.bodyEvidenceTraceByDocId.get(docId);
	if (cached) {
		return cached;
	}
	const created = buildCoverageLexicalBodyEvidenceTrace(
		tokens,
		families,
		benchmarkHooks?.bodyEvidenceWindowFuzzyProportion,
	);
	queryCache.bodyEvidenceTraceByDocId.set(docId, created);
	benchmarkHooks?.storeBodyEvidenceTrace?.(docId, created);
	return created;
}

function getOrCreatePassageSignal(
	docId: number,
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	state: CoverageLexicalCandidateState,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	phraseMatchCount: number,
	phraseMatchWeight: number,
	bodyEvidenceTrace: CoverageLexicalBodyEvidenceTrace,
	queryCache: CoverageLexicalQueryCache,
): ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal> {
	const cacheKey = `${docId}:${phraseMatchCount}:${phraseMatchWeight}`;
	const cached = queryCache.passageSignalByDocAndPhraseKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const created = buildCoverageLexicalPassageAdmissionSignal(
		tokens,
		families,
		state,
		phraseSignatures,
		bodyEvidenceTrace,
	);
	queryCache.passageSignalByDocAndPhraseKey.set(cacheKey, created);
	return created;
}

function getOrCreateTagFallback(
	docId: number,
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
): ReturnType<typeof evaluateCoverageLexicalTagFallback> {
	const cached = queryCache.tagFallbackByDocId.get(docId);
	if (cached) {
		return cached;
	}
	const created = evaluateCoverageLexicalTagFallback(
		index.documentTagValuesById[docId] ?? [],
		charQuery,
	);
	queryCache.tagFallbackByDocId.set(docId, created);
	return created;
}

function acceptsLaneCandidate(
	laneName: CoverageLexicalLaneName,
	evaluation: CoverageLexicalLaneEvaluation,
	plan: CoverageLexicalPlan,
	charQuery: CoverageLexicalCharQuery,
): boolean {
	switch (laneName) {
		case "strict_metadata_lane":
			return (
				evaluation.hardAnchorMetadata.coverageCount >=
				Math.max(1, plan.hardAnchorFamilies.length)
			);
		case "strict_hybrid_lane":
			return (
				evaluation.hardAnchorMetadata.coverageCount >=
					Math.max(1, plan.hardAnchorFamilies.length) &&
				evaluation.decisiveBody.coverageCount >= 1
			);
		case "relaxed_hybrid_lane":
			return (
				evaluation.hardAnchorMetadata.coverageCount >=
					Math.max(1, plan.hardAnchorFamilies.length) &&
				getBodyCoverageCount(evaluation) >=
					Math.max(1, plan.relaxedMinimumMatchCount)
			);
		case "local_body_lane":
			return (
				evaluation.passageSignal.coreCoverageCount >=
					Math.max(1, Math.min(plan.coreFamilyCount, plan.relaxedMinimumMatchCount || 1)) ||
				getBodyCoverageCount(evaluation) >=
					Math.max(1, plan.relaxedMinimumMatchCount || 1) ||
				evaluation.metadataAssist.coverageCount >= 1
			);
		case "bridge_lane":
			return (
				evaluation.bridgeSignal.coverageCount >= 1 ||
				evaluation.phraseMatchCount >= 1 ||
				evaluation.metadataAssist.coverageCount >= 1
			);
		case "char_fallback_lane":
			return (
				evaluation.tagExactMatchCount >= 1 ||
				acceptsCharFallback(
					evaluation.tagCharMatchCount,
					evaluation.tagCharMatchRatio,
					charQuery.terms.length,
				) ||
				acceptsCharFallback(
					evaluation.metadataCharMatchCount,
					evaluation.metadataCharMatchRatio,
					charQuery.terms.length,
				) ||
				acceptsCharFallback(
					evaluation.bodyCharMatchCount,
					evaluation.bodyCharMatchRatio,
					charQuery.terms.length,
				)
			);
		default:
			return false;
	}
}

function compareLaneEvaluations(
	laneName: CoverageLexicalLaneName,
	left: CoverageLexicalLaneEvaluation,
	right: CoverageLexicalLaneEvaluation,
	plan: CoverageLexicalPlan,
): number {
	switch (laneName) {
		case "strict_metadata_lane":
			return (
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				compareGroupSignals(left.bridgeSignal, right.bridgeSignal) ||
				left.key - right.key
			);
		case "strict_hybrid_lane":
			return (
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareGroupSignals(left.supportBody, right.supportBody) ||
				compareCoverageLexicalPassageAdmissionSignals(
					left.passageSignal,
					right.passageSignal,
				) ||
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				left.key - right.key
			);
		case "relaxed_hybrid_lane":
			return (
				compareDescendingMetric(
					getBodyCoverageCount(left),
					getBodyCoverageCount(right),
				) ||
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareGroupSignals(left.supportBody, right.supportBody) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareCoverageLexicalPassageAdmissionSignals(
					left.passageSignal,
					right.passageSignal,
				) ||
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				left.key - right.key
			);
		case "local_body_lane":
			return (
				compareCoverageLexicalPassageAdmissionSignals(
					left.passageSignal,
					right.passageSignal,
				) ||
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareGroupSignals(left.supportBody, right.supportBody) ||
				compareGroupSignals(left.optionalBody, right.optionalBody) ||
				compareGroupSignals(left.metadataAssist, right.metadataAssist) ||
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				left.key - right.key
			);
		case "bridge_lane":
			return (
				compareGroupSignals(left.bridgeSignal, right.bridgeSignal) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
				compareGroupSignals(left.metadataAssist, right.metadataAssist) ||
				compareGroupSignals(left.decisiveBody, right.decisiveBody) ||
				compareCoverageLexicalPassageAdmissionSignals(
					left.passageSignal,
					right.passageSignal,
				) ||
				left.key - right.key
			);
		case "char_fallback_lane":
			return (
				compareDescendingMetric(left.tagExactMatchCount, right.tagExactMatchCount) ||
				compareDescendingMetric(left.tagCharMatchRatio, right.tagCharMatchRatio) ||
				compareDescendingMetric(left.metadataCharMatchRatio, right.metadataCharMatchRatio) ||
				compareDescendingMetric(left.bodyCharMatchRatio, right.bodyCharMatchRatio) ||
				compareDescendingMetric(left.tagCharMatchCount, right.tagCharMatchCount) ||
				compareDescendingMetric(left.metadataCharMatchCount, right.metadataCharMatchCount) ||
				compareDescendingMetric(left.bodyCharMatchCount, right.bodyCharMatchCount) ||
				compareCoverageLexicalPassageAdmissionSignals(
					left.passageSignal,
					right.passageSignal,
				) ||
				left.key - right.key
			);
		default:
			return 0;
	}
}

function getBodyCoverageCount(evaluation: CoverageLexicalLaneEvaluation): number {
	return (
		evaluation.decisiveBody.coverageCount +
		evaluation.supportBody.coverageCount +
		evaluation.optionalBody.coverageCount
	);
}

function buildGroupSignal(
	matches: readonly number[],
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalGroupSignal {
	let coverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let tailWeight = 0;
	for (const family of families) {
		const code = matches[family.index] ?? 0;
		if (code === 0) {
			continue;
		}
		const weight = computeTailWeight(family.index);
		coverageCount += 1;
		tailWeight += weight;
		if (code === 3) {
			exactWeight += weight;
			continue;
		}
		if (code === 2) {
			prefixWeight += weight;
			continue;
		}
		fuzzyWeight += weight;
	}
	return {
		coverageCount,
		exactWeight,
		prefixWeight,
		fuzzyWeight,
		tailWeight,
	};
}

function buildMergedGroupSignal(
	left: readonly number[],
	right: readonly number[],
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalGroupSignal {
	let coverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let tailWeight = 0;
	for (const family of families) {
		const code = Math.max(
			left[family.index] ?? 0,
			right[family.index] ?? 0,
		);
		if (code === 0) {
			continue;
		}
		const weight = computeTailWeight(family.index);
		coverageCount += 1;
		tailWeight += weight;
		if (code === 3) {
			exactWeight += weight;
			continue;
		}
		if (code === 2) {
			prefixWeight += weight;
			continue;
		}
		fuzzyWeight += weight;
	}
	return {
		coverageCount,
		exactWeight,
		prefixWeight,
		fuzzyWeight,
		tailWeight,
	};
}

function buildMetadataFieldUnionSignal(
	fieldMatches: CoverageLexicalCandidateState["metadataAssistFieldMatches"],
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalGroupSignal {
	let coverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let tailWeight = 0;
	for (const family of families) {
		let code = 0;
		for (const field of ALL_METADATA_FIELDS) {
			code = Math.max(code, fieldMatches[field][family.index] ?? 0);
		}
		if (code === 0) {
			continue;
		}
		const weight = computeTailWeight(family.index);
		coverageCount += 1;
		tailWeight += weight;
		if (code === 3) {
			exactWeight += weight;
			continue;
		}
		if (code === 2) {
			prefixWeight += weight;
			continue;
		}
		fuzzyWeight += weight;
	}
	return {
		coverageCount,
		exactWeight,
		prefixWeight,
		fuzzyWeight,
		tailWeight,
	};
}

function compareGroupSignals(
	left: CoverageLexicalGroupSignal,
	right: CoverageLexicalGroupSignal,
): number {
	return (
		compareDescendingMetric(left.coverageCount, right.coverageCount) ||
		compareDescendingMetric(left.exactWeight, right.exactWeight) ||
		compareDescendingMetric(left.prefixWeight, right.prefixWeight) ||
		compareDescendingMetric(left.fuzzyWeight, right.fuzzyWeight) ||
		compareDescendingMetric(left.tailWeight, right.tailWeight)
	);
}

function collectFamilySetCandidates(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	families: readonly CoverageLexicalFamily[],
	options: {
		scope: CoverageLexicalCollectionScope;
		includePrefix: boolean;
		includeFuzzy: boolean;
	},
): void {
	const uniqueFamilies = dedupeFamilies(families);
	for (const family of uniqueFamilies) {
		if (family.role === "noise") {
			continue;
		}
		collectCandidatesForTerm(
			index,
			candidates,
			family.index,
			family.normalizedTerm,
			"exact",
			options.scope,
		);
		if (options.includePrefix) {
			collectPrefixCandidatesForFamily(
				index,
				queryCache,
				candidates,
				family,
				options.scope,
			);
			if (options.scope !== "metadata-only") {
				collectMetadataAssistPrefixCandidatesForFamily(
					index,
					queryCache,
					candidates,
					family,
				);
			}
		}
		if (options.includeFuzzy && family.allowFuzzy) {
			for (const term of getOrCreateFuzzyExpansionTerms(
				index.sortedLexicon,
				family.normalizedTerm,
				queryCache,
			)) {
				collectCandidatesForTerm(
					index,
					candidates,
					family.index,
					term,
					"fuzzy",
					options.scope,
				);
			}
		}
	}
}

function collectCharCandidates(
	index: CoverageLexicalRecallIndex,
	postingsByTerm: CoverageLexicalPostingMap | undefined,
	queryTerms: readonly string[],
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	target: "body" | "metadata" | "tag",
): void {
	if (!postingsByTerm) {
		return;
	}
	for (let termIndex = 0; termIndex < queryTerms.length; termIndex += 1) {
		const term = queryTerms[termIndex];
		const matches = postingsByTerm.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			const state = getOrCreateDocIdCandidateState(candidates, key);
			if (target === "body") {
				recordQueryTermMatch(
					state.bodyCharMatchIndices,
					state.bodyCharMatchFlags,
					termIndex,
				);
				return;
			}
			if (target === "metadata") {
				recordQueryTermMatch(
					state.metadataCharMatchIndices,
					state.metadataCharMatchFlags,
					termIndex,
				);
				return;
			}
			recordQueryTermMatch(
				state.tagCharMatchIndices,
				state.tagCharMatchFlags,
				termIndex,
			);
		});
	}
}

function collectBodyCharGateCandidates(
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
): void {
	if (charQuery.terms.length === 0) {
		return;
	}
	for (
		let docId = 0;
		docId < index.documentBodyHanSegmentsById.length;
		docId += 1
	) {
		if (index.documentPathById[docId] === undefined) {
			continue;
		}
		const bodyHanSegments = index.documentBodyHanSegmentsById[docId];
		if (!bodyHanSegments || bodyHanSegments.length === 0) {
			continue;
		}
		const verification = evaluateCoverageLexicalBodyCharVerification(
			bodyHanSegments,
			charQuery,
		);
		if (
			!acceptsCharFallback(
				verification.matchCount,
				verification.matchRatio,
				charQuery.terms.length,
			)
		) {
			continue;
		}
		const state = getOrCreateDocIdCandidateState(candidates, docId);
		applyBodyCharVerification(state, verification);
	}
}

function collectTagExactCandidates(
	index: CoverageLexicalRecallIndex,
	postingsByTag: CoverageLexicalPostingMap | undefined,
	querySegments: readonly string[],
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
): void {
	if (!postingsByTag) {
		return;
	}
	for (let segmentIndex = 0; segmentIndex < querySegments.length; segmentIndex += 1) {
		const term = querySegments[segmentIndex];
		const matches = postingsByTag.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			const state = getOrCreateDocIdCandidateState(candidates, key);
			recordQueryTermMatch(
				state.tagExactMatchIndices,
				state.tagExactMatchFlags,
				segmentIndex,
			);
		});
	}
}

function collectPhraseCandidates(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signatures: readonly CoverageLexicalPhraseSignature[],
	targetFamilyIndices: ReadonlySet<number>,
	scope: CoverageLexicalCollectionScope,
	options: {
		structuredOnly: boolean;
		allowPreferredFields: boolean;
	},
): void {
	for (const signature of getOrCreatePhraseSignatureBucket(
		signatures,
		targetFamilyIndices,
		scope,
		options,
		queryCache,
	)) {
		collectCandidatesForPhraseSignature(
			index,
			queryCache,
			candidates,
			signature,
			scope,
		);
	}
}

function overlapsTargetFamilies(
	signature: CoverageLexicalPhraseSignature,
	targetFamilyIndices: ReadonlySet<number>,
): boolean {
	return signature.familyIndices.some((familyIndex) => targetFamilyIndices.has(familyIndex));
}

function dedupeFamilies(
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalFamily[] {
	const out: CoverageLexicalFamily[] = [];
	const seen = new Set<number>();
	for (const family of families) {
		if (seen.has(family.index)) {
			continue;
		}
		seen.add(family.index);
		out.push(family);
	}
	return out;
}

function collectCandidatesForTerm(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
	scope: CoverageLexicalCollectionScope,
	prefixWitnessCandidate?: CoverageLexicalPrefixExpansionCandidate,
): number {
	let addedCount = 0;
	if (scope !== "metadata-only") {
		const bodyMatches = index.bodyPostings.get(term);
		if (bodyMatches) {
			forEachPostingCandidateKey(index, bodyMatches, (key) => {
				if (!candidates.has(key)) {
					addedCount += 1;
				}
				const state = getOrCreateDocIdCandidateState(candidates, key);
				recordFamilyMatch(state.bodyMatches, familyIndex, kind);
				if (kind === "prefix" && prefixWitnessCandidate) {
					const surfaceText = findBestBodyPrefixSurfaceText(
						index.getDocumentBodyTokens(key),
						prefixWitnessCandidate.prefix,
						prefixWitnessCandidate.term,
					);
					state.bodyPrefixWitness = maybeRecordBetterPrefixWitness(
						state.bodyPrefixWitness,
						buildPrefixWitness(
							"body",
							null,
							prefixWitnessCandidate,
							surfaceText,
						),
					);
				}
			});
		}
	}
	if (scope !== "body-only") {
		addedCount += collectMetadataFieldCandidatesForTerm(
			index,
			candidates,
			familyIndex,
			term,
			kind,
			prefixWitnessCandidate,
		);
	}
	return addedCount;
}

function collectCandidatesForPhraseSignature(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	scope: CoverageLexicalCollectionScope,
): void {
	for (const variant of signature.variants) {
		if (scope !== "metadata-only" && !signature.preferredFields?.length) {
			const bodyTokenMatches = index.bodyPostings.get(variant);
			if (bodyTokenMatches) {
				forEachPostingCandidateKey(index, bodyTokenMatches, (key) => {
					const state = getOrCreateDocIdCandidateState(candidates, key);
					recordPhraseMatch(state, signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					}
				});
			}
			collectBodyPhraseWitnessMatches(index, queryCache, candidates, signature);
		}

		if (scope === "body-only") {
			continue;
		}

		if (!signature.preferredFields || signature.preferredFields.length === 0) {
			forEachAnyMetadataExactPostingCandidateKey(index, variant, (key) => {
				const state = getOrCreateDocIdCandidateState(candidates, key);
				recordPhraseMatch(state, signature.index);
				for (const familyIndex of signature.familyIndices) {
					recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
				}
			});
			collectAnyMetadataPhraseMatches(index, candidates, signature, variant);
			continue;
		}

		collectPreferredMetadataPhraseMatches(
			index,
			candidates,
			signature,
			variant,
		);
	}
}

function collectBodyPhraseWitnessMatches(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
): void {
	for (const key of getOrCreateBodyPhraseWitnessCandidateKeys(
		index,
		signature,
		queryCache,
	)) {
		const state = getOrCreateDocIdCandidateState(candidates, key);
		recordPhraseMatch(state, signature.index);
		for (const familyIndex of signature.familyIndices) {
			recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
		}
	}
}

function getOrCreateBodyPhraseWitnessCandidateKeys(
	index: CoverageLexicalRecallIndex,
	signature: CoverageLexicalPhraseSignature,
	queryCache: CoverageLexicalQueryCache,
): readonly CoverageLexicalCandidateKey[] {
	const cacheKey = buildPhraseWitnessSignatureCacheKey(signature);
	const cached =
		queryCache.bodyPhraseWitnessCandidateKeysBySignatureKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const canonicalTokens = getPhraseWitnessCanonicalTokens(signature);
	if (canonicalTokens.length < 2) {
		queryCache.bodyPhraseWitnessCandidateKeysBySignatureKey.set(cacheKey, []);
		return [];
	}
	let anchorMatches: CoverageLexicalPostingList | undefined;
	let anchorMatchCount = Number.POSITIVE_INFINITY;
	for (const token of new Set(canonicalTokens)) {
		const matches = index.bodyPostings.get(token);
		if (!matches) {
			queryCache.bodyPhraseWitnessCandidateKeysBySignatureKey.set(cacheKey, []);
			return [];
		}
		const matchCount = getPostingCandidateCount(matches);
		if (matchCount < anchorMatchCount) {
			anchorMatches = matches;
			anchorMatchCount = matchCount;
		}
	}
	if (!anchorMatches) {
		queryCache.bodyPhraseWitnessCandidateKeysBySignatureKey.set(cacheKey, []);
		return [];
	}
	const matchedKeys: CoverageLexicalCandidateKey[] = [];
	const seen = new Set<CoverageLexicalCandidateKey>();
	forEachPostingCandidateKey(index, anchorMatches, (key) => {
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		if (
			hasContiguousPhraseWitness(
				index.getDocumentBodyTokens(key),
				canonicalTokens,
			)
		) {
			matchedKeys.push(key);
		}
	});
	queryCache.bodyPhraseWitnessCandidateKeysBySignatureKey.set(
		cacheKey,
		matchedKeys,
	);
	return matchedKeys;
}

function buildPhraseWitnessSignatureCacheKey(
	signature: CoverageLexicalPhraseSignature,
): string {
	return `${signature.familyIndices.join(",")}::${signature.variants.join("|")}`;
}

function getPhraseWitnessCanonicalTokens(
	signature: CoverageLexicalPhraseSignature,
): readonly string[] {
	const canonicalVariant =
		signature.variants.find((variant) => variant.includes(" ")) ??
		signature.variants[0] ??
		"";
	return canonicalVariant
		.split(" ")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

function hasContiguousPhraseWitness(
	tokens: readonly string[],
	phraseTokens: readonly string[],
): boolean {
	if (phraseTokens.length === 0 || tokens.length < phraseTokens.length) {
		return false;
	}
	const lastStart = tokens.length - phraseTokens.length;
	for (let start = 0; start <= lastStart; start += 1) {
		let matched = true;
		for (let offset = 0; offset < phraseTokens.length; offset += 1) {
			if (tokens[start + offset] !== phraseTokens[offset]) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return true;
		}
	}
	return false;
}

function getPostingCandidateCount(postings: CoverageLexicalPostingList): number {
	return Array.isArray(postings) || postings instanceof Uint32Array
		? postings.length
		: (postings as ReadonlySet<string>).size;
}

function collectPrefixCandidatesForFamily(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	family: CoverageLexicalFamily,
	scope: CoverageLexicalCollectionScope,
): void {
	const profile = resolvePrefixExpansionProfile(family, scope);
	if (!profile) {
		return;
	}
	let termCount = 0;
	let addedDocCount = 0;
	let stagnantTermCount = 0;
	for (const candidate of getOrCreatePrefixExpansionTerms(
		index,
		family.normalizedTerm,
		profile,
		queryCache,
	)) {
		const added = collectCandidatesForTerm(
			index,
			candidates,
			family.index,
			candidate.term,
			"prefix",
			scope,
			candidate,
		);
		termCount += 1;
		if (added > 0) {
			addedDocCount += added;
			stagnantTermCount = 0;
		} else {
			stagnantTermCount += 1;
		}
		if (
			termCount >= profile.termBudget ||
			addedDocCount >= profile.docBudget ||
			stagnantTermCount >= profile.stagnationLimit
		) {
			break;
		}
	}
}

function collectMetadataAssistPrefixCandidatesForFamily(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	family: CoverageLexicalFamily,
): void {
	const profile = resolveMetadataAssistPrefixExpansionProfile(family);
	if (!profile) {
		return;
	}
	let termCount = 0;
	let addedDocCount = 0;
	let stagnantTermCount = 0;
	for (const candidate of getOrCreateMetadataAssistExpansionTerms(
		index,
		family.normalizedTerm,
		profile,
		queryCache,
	)) {
		const added = collectMetadataAssistFieldCandidatesForTerm(
			index,
			candidates,
			family.index,
			candidate.term,
			"prefix",
			candidate,
		);
		termCount += 1;
		if (added > 0) {
			addedDocCount += added;
			stagnantTermCount = 0;
		} else {
			stagnantTermCount += 1;
		}
		if (
			termCount >= profile.termBudget ||
			addedDocCount >= profile.docBudget ||
			stagnantTermCount >= profile.stagnationLimit
		) {
			break;
		}
	}
}

function resolveMetadataAssistPrefixExpansionProfile(
	family: CoverageLexicalFamily,
): CoverageLexicalPrefixExpansionProfile | null {
	const term = family.normalizedTerm;
	if (!ASCII_PREFIX_TERM_REGEX.test(term)) {
		return null;
	}
	if (term.length < METADATA_PREFIX_MIN_TERM_LENGTH) {
		return null;
	}
	return {
		cacheKey: "metadata-assist",
		target: "metadata",
		minTermLength: METADATA_PREFIX_MIN_TERM_LENGTH,
		explorationCap: METADATA_ASSIST_PREFIX_EXPLORATION_CAP,
		termBudget: METADATA_ASSIST_PREFIX_TERM_BUDGET,
		docBudget: METADATA_ASSIST_PREFIX_DOC_BUDGET,
		stagnationLimit: 2,
	};
}

function resolvePrefixExpansionProfile(
	family: CoverageLexicalFamily,
	scope: CoverageLexicalCollectionScope,
): CoverageLexicalPrefixExpansionProfile | null {
	const term = family.normalizedTerm;
	if (!ASCII_PREFIX_TERM_REGEX.test(term)) {
		return null;
	}
	if (scope === "metadata-only") {
		if (term.length < METADATA_PREFIX_MIN_TERM_LENGTH) {
			return null;
		}
		return {
			cacheKey: "metadata",
			target: "metadata",
			minTermLength: METADATA_PREFIX_MIN_TERM_LENGTH,
			explorationCap: METADATA_PREFIX_EXPLORATION_CAP,
			termBudget: METADATA_PREFIX_TERM_BUDGET,
			docBudget: METADATA_PREFIX_DOC_BUDGET,
			stagnationLimit: PREFIX_ZERO_GAIN_STAGNATION_LIMIT,
		};
	}
	if (scope === "body-only") {
		return buildBodyPrefixExpansionProfile(term.length);
	}
	if (family.role === "anchor" || family.isMetadataCapable) {
		if (term.length < METADATA_PREFIX_MIN_TERM_LENGTH) {
			return null;
		}
		return {
			cacheKey: "mixed-anchor",
			target: "all",
			minTermLength: METADATA_PREFIX_MIN_TERM_LENGTH,
			explorationCap: MIXED_PREFIX_EXPLORATION_CAP,
			termBudget: MIXED_PREFIX_TERM_BUDGET,
			docBudget: MIXED_PREFIX_DOC_BUDGET,
			stagnationLimit: PREFIX_ZERO_GAIN_STAGNATION_LIMIT,
		};
	}
	return buildBodyPrefixExpansionProfile(term.length);
}

function buildBodyPrefixExpansionProfile(
	termLength: number,
): CoverageLexicalPrefixExpansionProfile | null {
	if (termLength < BODY_PREFIX_MIN_TERM_LENGTH) {
		return null;
	}
	if (termLength >= 7) {
		return {
			cacheKey: "body-long",
			target: "body",
			minTermLength: BODY_PREFIX_MIN_TERM_LENGTH,
			explorationCap: BODY_PREFIX_LONG_EXPLORATION_CAP,
			termBudget: BODY_PREFIX_LONG_TERM_BUDGET,
			docBudget: BODY_PREFIX_LONG_DOC_BUDGET,
			stagnationLimit: PREFIX_ZERO_GAIN_STAGNATION_LIMIT,
		};
	}
	if (termLength >= 5) {
		return {
			cacheKey: "body-medium",
			target: "body",
			minTermLength: BODY_PREFIX_MIN_TERM_LENGTH,
			explorationCap: BODY_PREFIX_MEDIUM_EXPLORATION_CAP,
			termBudget: BODY_PREFIX_MEDIUM_TERM_BUDGET,
			docBudget: BODY_PREFIX_MEDIUM_DOC_BUDGET,
			stagnationLimit: PREFIX_ZERO_GAIN_STAGNATION_LIMIT,
		};
	}
	return {
		cacheKey: "body-short",
		target: "body",
		minTermLength: BODY_PREFIX_MIN_TERM_LENGTH,
		explorationCap: BODY_PREFIX_SHORT_EXPLORATION_CAP,
		termBudget: BODY_PREFIX_SHORT_TERM_BUDGET,
		docBudget: BODY_PREFIX_SHORT_DOC_BUDGET,
		stagnationLimit: PREFIX_ZERO_GAIN_STAGNATION_LIMIT,
	};
}

function getOrCreatePrefixExpansionTerms(
	index: CoverageLexicalRecallIndex,
	prefix: string,
	profile: CoverageLexicalPrefixExpansionProfile,
	queryCache: CoverageLexicalQueryCache,
): readonly CoverageLexicalPrefixExpansionCandidate[] {
	const cacheKey = `${profile.cacheKey}:${prefix}`;
	const cached = queryCache.prefixExpansionsByTerm.get(cacheKey);
	if (cached) {
		return cached;
	}
	const created = expandPrefixTerms(index, prefix, profile);
	queryCache.prefixExpansionsByTerm.set(cacheKey, created);
	return created;
}

function getOrCreateMetadataAssistExpansionTerms(
	index: CoverageLexicalRecallIndex,
	prefix: string,
	profile: CoverageLexicalPrefixExpansionProfile,
	queryCache: CoverageLexicalQueryCache,
): readonly CoverageLexicalPrefixExpansionCandidate[] {
	const cacheKey = `${profile.cacheKey}:${prefix}`;
	const cached = queryCache.prefixExpansionsByTerm.get(cacheKey);
	if (cached) {
		return cached;
	}
	const created = expandMetadataAssistTerms(index, prefix, profile);
	queryCache.prefixExpansionsByTerm.set(cacheKey, created);
	return created;
}

function getOrCreateFuzzyExpansionTerms(
	sortedLexicon: readonly string[],
	queryTerm: string,
	queryCache: CoverageLexicalQueryCache,
): readonly string[] {
	const cached = queryCache.fuzzyExpansionsByTerm.get(queryTerm);
	if (cached) {
		return cached;
	}
	const created = expandFuzzyTerms(sortedLexicon, queryTerm);
	queryCache.fuzzyExpansionsByTerm.set(queryTerm, created);
	return created;
}

function getOrCreatePhraseSignatureBucket(
	signatures: readonly CoverageLexicalPhraseSignature[],
	targetFamilyIndices: ReadonlySet<number>,
	scope: CoverageLexicalCollectionScope,
	options: {
		structuredOnly: boolean;
		allowPreferredFields: boolean;
	},
	queryCache: CoverageLexicalQueryCache,
): readonly CoverageLexicalPhraseSignature[] {
	const bucketKey = [
		scope,
		options.structuredOnly ? "structured" : "all-forms",
		options.allowPreferredFields ? "preferred" : "plain",
		Array.from(targetFamilyIndices).join(","),
	].join("|");
	const cached = queryCache.phraseSignatureBucketsByKey.get(bucketKey);
	if (cached) {
		return cached;
	}
	const created = signatures.filter((signature) => {
		if (!overlapsTargetFamilies(signature, targetFamilyIndices)) {
			return false;
		}
		if (options.structuredOnly && !signature.preferredFields?.length) {
			return false;
		}
		if (!options.allowPreferredFields && signature.preferredFields?.length) {
			return false;
		}
		return true;
	});
	queryCache.phraseSignatureBucketsByKey.set(bucketKey, created);
	return created;
}

function getOrCreateDocIdCandidateState(
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	key: CoverageLexicalCandidateKey,
): CoverageLexicalCandidateState {
	let state = candidates.get(key);
	if (!state) {
		state = createEmptyCandidateState();
		candidates.set(key, state);
	}
	return state;
}

function getOrCreateProjectedCandidateState(
	candidates: Map<string, CoverageLexicalCandidateState>,
	path: string,
): CoverageLexicalCandidateState {
	let state = candidates.get(path);
	if (!state) {
		state = createEmptyCandidateState();
		candidates.set(path, state);
	}
	return state;
}

function mergeCandidateStateByDocId(
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	key: CoverageLexicalCandidateKey,
	nextState: CoverageLexicalCandidateState,
): void {
	const target = getOrCreateDocIdCandidateState(candidates, key);
	mergeCandidateState(target, nextState);
}

function mergeProjectedCandidateStateByPath(
	candidates: Map<string, CoverageLexicalCandidateState>,
	path: string,
	nextState: CoverageLexicalCandidateState,
): void {
	const target = getOrCreateProjectedCandidateState(candidates, path);
	mergeCandidateState(target, nextState);
}

function mergeCandidateState(
	target: CoverageLexicalCandidateState,
	nextState: CoverageLexicalCandidateState,
): void {
	if (nextState.bodyPrefixWitness) {
		target.bodyPrefixWitness = maybeRecordBetterPrefixWitness(
			target.bodyPrefixWitness,
			nextState.bodyPrefixWitness,
		);
	}
	if (nextState.metadataPrefixWitness) {
		target.metadataPrefixWitness = maybeRecordBetterPrefixWitness(
			target.metadataPrefixWitness,
			nextState.metadataPrefixWitness,
		);
	}
	for (let familyIndex = 0; familyIndex < nextState.bodyMatches.length; familyIndex += 1) {
		const kind = getRecordedMatchKind(nextState.bodyMatches, familyIndex);
		if (kind) {
			recordFamilyMatch(target.bodyMatches, familyIndex, kind);
		}
	}
	for (
		let familyIndex = 0;
		familyIndex < nextState.metadataMatches.length;
		familyIndex += 1
	) {
		const kind = getRecordedMatchKind(nextState.metadataMatches, familyIndex);
		if (kind) {
			recordFamilyMatch(target.metadataMatches, familyIndex, kind);
		}
	}
	for (const field of Object.keys(
		nextState.metadataFieldMatches,
	) as CoverageLexicalMetadataField[]) {
		const sourceMatches = nextState.metadataFieldMatches[field];
		for (let familyIndex = 0; familyIndex < sourceMatches.length; familyIndex += 1) {
			const kind = getRecordedMatchKind(sourceMatches, familyIndex);
			if (kind) {
				recordFamilyMatch(target.metadataFieldMatches[field], familyIndex, kind);
			}
		}
	}
	for (const field of Object.keys(
		nextState.metadataAssistFieldMatches,
	) as CoverageLexicalMetadataField[]) {
		const sourceMatches = nextState.metadataAssistFieldMatches[field];
		for (let familyIndex = 0; familyIndex < sourceMatches.length; familyIndex += 1) {
			const kind = getRecordedMatchKind(sourceMatches, familyIndex);
			if (kind) {
				recordFamilyMatch(
					target.metadataAssistFieldMatches[field],
					familyIndex,
					kind,
				);
			}
		}
	}
	for (const phraseMatch of nextState.phraseMatches) {
		recordPhraseMatch(target, phraseMatch);
	}
	for (const termIndex of nextState.bodyCharMatchIndices) {
		recordQueryTermMatch(
			target.bodyCharMatchIndices,
			target.bodyCharMatchFlags,
			termIndex,
		);
	}
	for (const termIndex of nextState.metadataCharMatchIndices) {
		recordQueryTermMatch(
			target.metadataCharMatchIndices,
			target.metadataCharMatchFlags,
			termIndex,
		);
	}
	for (const termIndex of nextState.tagExactMatchIndices) {
		recordQueryTermMatch(
			target.tagExactMatchIndices,
			target.tagExactMatchFlags,
			termIndex,
		);
	}
	for (const termIndex of nextState.tagCharMatchIndices) {
		recordQueryTermMatch(
			target.tagCharMatchIndices,
			target.tagCharMatchFlags,
			termIndex,
		);
	}
}

function collectAnyMetadataPhraseMatches(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	variant: string,
): void {
	const fieldPhraseEntries: readonly CoverageLexicalPostingMap[] = [
		index.metadataBasenamePhrasePostings,
		index.metadataAliasPhrasePostings,
		index.metadataFolderPhrasePostings,
		index.metadataHeadingPhrasePostings,
		index.metadataTagPhrasePostings,
	];
	for (const postings of fieldPhraseEntries) {
		const matches = postings.get(variant);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			const state = getOrCreateDocIdCandidateState(candidates, key);
			recordPhraseMatch(state, signature.index);
			for (const familyIndex of signature.familyIndices) {
				recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
			}
		});
	}
}

function createEmptyCandidateState(): CoverageLexicalCandidateState {
	return {
		bodyMatches: [],
		bodyCharMatchIndices: [],
		bodyCharMatchFlags: [],
		bodyPrefixWitness: null,
		metadataMatches: [],
		metadataAssistFieldMatches: createEmptyMetadataFieldMatches(),
		metadataCharMatchIndices: [],
		metadataCharMatchFlags: [],
		metadataFieldMatches: createEmptyMetadataFieldMatches(),
		metadataPrefixWitness: null,
		phraseMatches: [],
		phraseMatchFlags: [],
		tagCharMatchIndices: [],
		tagCharMatchFlags: [],
		tagExactMatchIndices: [],
		tagExactMatchFlags: [],
	};
}

function collectMetadataFieldCandidatesForTerm(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
	prefixWitnessCandidate?: CoverageLexicalPrefixExpansionCandidate,
): number {
	let addedCount = 0;
	const fieldEntries: Array<
		[
			CoverageLexicalMetadataField,
			CoverageLexicalPostingMap,
		]
	> = [
		["basename", index.metadataBasenamePostings],
		["aliases", index.metadataAliasPostings],
		["folder", index.metadataFolderPostings],
		["headings", index.metadataHeadingPostings],
		["tags", index.metadataTagPostings],
	];
	for (const [field, postings] of fieldEntries) {
		const matches = postings.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			if (!candidates.has(key)) {
				addedCount += 1;
			}
			const state = getOrCreateDocIdCandidateState(candidates, key);
			recordFamilyMatch(state.metadataMatches, familyIndex, kind);
			recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, kind);
			if (kind === "prefix" && prefixWitnessCandidate) {
				const surfaceText = findBestMetadataPrefixSurfaceText(
					index.getDocumentMetadataFieldText?.(key, field) ?? term,
					prefixWitnessCandidate.prefix,
					prefixWitnessCandidate.term,
				);
				state.metadataPrefixWitness = maybeRecordBetterPrefixWitness(
					state.metadataPrefixWitness,
					buildPrefixWitness(
						"metadata",
						field,
						prefixWitnessCandidate,
						surfaceText,
					),
				);
			}
		});
	}
	return addedCount;
}

function collectMetadataAssistFieldCandidatesForTerm(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
	prefixWitnessCandidate?: CoverageLexicalPrefixExpansionCandidate,
): number {
	let addedCount = 0;
	const fieldEntries: Array<
		[
			CoverageLexicalMetadataField,
			CoverageLexicalPostingMap,
		]
	> = [
		["basename", index.metadataBasenamePostings],
		["aliases", index.metadataAliasPostings],
		["folder", index.metadataFolderPostings],
		["headings", index.metadataHeadingPostings],
		["tags", index.metadataTagPostings],
	];
	for (const [field, postings] of fieldEntries) {
		const matches = postings.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			if (!candidates.has(key)) {
				addedCount += 1;
			}
			const state = getOrCreateDocIdCandidateState(candidates, key);
			recordFamilyMatch(state.metadataAssistFieldMatches[field], familyIndex, kind);
			if (kind === "prefix" && prefixWitnessCandidate) {
				const surfaceText = findBestMetadataPrefixSurfaceText(
					index.getDocumentMetadataFieldText?.(key, field) ?? term,
					prefixWitnessCandidate.prefix,
					prefixWitnessCandidate.term,
				);
				state.metadataPrefixWitness = maybeRecordBetterPrefixWitness(
					state.metadataPrefixWitness,
					buildPrefixWitness(
						"metadata",
						field,
						prefixWitnessCandidate,
						surfaceText,
					),
				);
			}
		});
	}
	return addedCount;
}

function collectPreferredMetadataPhraseMatches(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	variant: string,
): void {
	const fieldPhraseEntries: Array<
		[
			CoverageLexicalMetadataField,
			CoverageLexicalPostingMap,
		]
	> = [
		["basename", index.metadataBasenamePhrasePostings],
		["aliases", index.metadataAliasPhrasePostings],
		["folder", index.metadataFolderPhrasePostings],
		["headings", index.metadataHeadingPhrasePostings],
		["tags", index.metadataTagPhrasePostings],
	];
	for (const [field, postings] of fieldPhraseEntries) {
		if (!signature.preferredFields?.includes(field)) {
			continue;
		}
		const matches = postings.get(variant);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			const state = getOrCreateDocIdCandidateState(candidates, key);
			recordPhraseMatch(state, signature.index);
			for (const familyIndex of signature.familyIndices) {
				recordFamilyMatch(state.metadataMatches, familyIndex, "exact");
				recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, "exact");
			}
		});
	}
}

function canonicalizeCandidateKey(
	index: CoverageLexicalRecallIndex,
	path: string,
): CoverageLexicalCandidateKey | null {
	return index.documentIdByPath.get(path) ?? null;
}

function resolveCandidatePath(
	index: CoverageLexicalRecallIndex,
	key: CoverageLexicalCandidateKey,
): string | null {
	return index.documentPathById[key] ?? null;
}

function mapCandidateKeysToPaths(
	index: CoverageLexicalRecallIndex,
	keys: Iterable<CoverageLexicalCandidateKey>,
): string[] {
	const out: string[] = [];
	for (const key of keys) {
		const path = resolveCandidatePath(index, key);
		if (path) {
			out.push(path);
		}
	}
	return out;
}

function isNonEmptyString(value: string | null | undefined): value is string {
	return typeof value === "string" && value.length > 0;
}

function forEachPostingCandidateKey(
	index: CoverageLexicalRecallIndex,
	postings: CoverageLexicalPostingList,
	visitor: (key: CoverageLexicalCandidateKey) => void,
): void {
	if (Array.isArray(postings) || postings instanceof Uint32Array) {
		for (const docId of postings) {
			if (index.documentPathById[docId]) {
				visitor(docId);
			}
		}
		return;
	}
	for (const path of postings as ReadonlySet<string>) {
		const docId = canonicalizeCandidateKey(index, path);
		if (docId !== null) {
			visitor(docId);
		}
	}
}

function forEachAnyMetadataExactPostingCandidateKey(
	index: CoverageLexicalRecallIndex,
	term: string,
	visitor: (key: CoverageLexicalCandidateKey) => void,
): void {
	const seen = new Set<CoverageLexicalCandidateKey>();
	for (const postings of getMetadataExactPostingMaps(index)) {
		const matches = postings.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			visitor(key);
		});
	}
}

function getMetadataExactPostingMaps(
	index: CoverageLexicalRecallIndex,
): readonly CoverageLexicalPostingMap[] {
	return [
		index.metadataBasenamePostings,
		index.metadataAliasPostings,
		index.metadataFolderPostings,
		index.metadataHeadingPostings,
		index.metadataTagPostings,
	];
}

function projectCandidateStatesToPaths(
	index: CoverageLexicalRecallIndex,
	candidates: ReadonlyMap<number, CoverageLexicalCandidateState>,
): Map<string, CoverageLexicalCandidateState> {
	const projected = new Map<string, CoverageLexicalCandidateState>();
	for (const [docId, state] of candidates) {
		const path = resolveCandidatePath(index, docId);
		if (!path) {
			continue;
		}
		mergeProjectedCandidateStateByPath(projected, path, state);
	}
	return projected;
}

function recordFamilyMatch(
	matches: number[],
	familyIndex: number,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const nextCode = encodeMatchKind(kind);
	const previousCode = matches[familyIndex] ?? 0;
	if (previousCode >= nextCode) {
		return;
	}
	matches[familyIndex] = nextCode;
}

function pickBetterMatchKind(
	left: CoverageFamilyMatchKind,
	right: CoverageFamilyMatchKind,
): CoverageFamilyMatchKind {
	const rank = {
		exact: 3,
		prefix: 2,
		fuzzy: 1,
		null: 0,
	} as const;
	return rank[left ?? "null"] >= rank[right ?? "null"] ? left : right;
}

function createEmptyMetadataFieldMatches(): CoverageLexicalCandidateState["metadataFieldMatches"] {
	return {
		basename: [],
		aliases: [],
		folder: [],
		headings: [],
		tags: [],
	};
}

function recordPhraseMatch(
	state: CoverageLexicalCandidateState,
	phraseIndex: number,
): void {
	if (state.phraseMatchFlags[phraseIndex] === 1) {
		return;
	}
	state.phraseMatchFlags[phraseIndex] = 1;
	state.phraseMatches.push(phraseIndex);
}

function applyBodyCharVerification(
	state: CoverageLexicalCandidateState,
	verification: CoverageLexicalBodyCharVerification,
): void {
	for (const termIndex of verification.matchedTermIndices) {
		recordQueryTermMatch(
			state.bodyCharMatchIndices,
			state.bodyCharMatchFlags,
			termIndex,
		);
	}
}

function recordQueryTermMatch(
	matches: number[],
	flags: number[],
	termIndex: number,
): void {
	if (flags[termIndex] === 1) {
		return;
	}
	flags[termIndex] = 1;
	matches.push(termIndex);
}

function getRecordedMatchKind(
	matches: readonly number[],
	familyIndex: number,
): Exclude<CoverageFamilyMatchKind, null> | null {
	const code = matches[familyIndex] ?? 0;
	if (code === 3) {
		return "exact";
	}
	if (code === 2) {
		return "prefix";
	}
	if (code === 1) {
		return "fuzzy";
	}
	return null;
}

function encodeMatchKind(
	kind: Exclude<CoverageFamilyMatchKind, null>,
): number {
	if (kind === "exact") {
		return 3;
	}
	if (kind === "prefix") {
		return 2;
	}
	return 1;
}

function expandPrefixTerms(
	index: CoverageLexicalRecallIndex,
	prefix: string,
	profile: CoverageLexicalPrefixExpansionProfile,
): CoverageLexicalPrefixExpansionCandidate[] {
	const candidates: CoverageLexicalPrefixExpansionCandidate[] = [];
	let explored = 0;
	let termIndex = lowerBoundString(index.sortedLexicon, prefix);
	while (termIndex < index.sortedLexicon.length) {
		const term = index.sortedLexicon[termIndex];
		if (!term.startsWith(prefix)) {
			break;
		}
		if (term !== prefix) {
			const candidate = buildPrefixExpansionCandidate(index, term, prefix, profile);
			if (candidate) {
				candidates.push(candidate);
			}
		}
		explored += 1;
		if (explored >= profile.explorationCap) {
			break;
		}
		termIndex += 1;
	}
	candidates.sort(comparePrefixExpansionCandidates);
	return candidates;
}

function expandMetadataAssistTerms(
	index: CoverageLexicalRecallIndex,
	prefix: string,
	profile: CoverageLexicalPrefixExpansionProfile,
): CoverageLexicalPrefixExpansionCandidate[] {
	const candidates: CoverageLexicalPrefixExpansionCandidate[] = [];
	let explored = 0;
	let termIndex = lowerBoundString(index.sortedLexicon, prefix);
	while (termIndex < index.sortedLexicon.length) {
		const term = index.sortedLexicon[termIndex];
		if (!term.startsWith(prefix)) {
			break;
		}
		if (term !== prefix) {
			const candidate = buildMetadataAssistPrefixExpansionCandidate(
				index,
				term,
				prefix,
				profile,
			);
			if (candidate) {
				candidates.push(candidate);
			}
		}
		explored += 1;
		if (explored >= profile.explorationCap) {
			break;
		}
		termIndex += 1;
	}
	candidates.sort(comparePrefixExpansionCandidates);
	return candidates;
}

function buildPrefixExpansionCandidate(
	index: CoverageLexicalRecallIndex,
	term: string,
	prefix: string,
	profile: CoverageLexicalPrefixExpansionProfile,
): CoverageLexicalPrefixExpansionCandidate | null {
	const bodyDocCount = getPostingCandidateCountOrZero(index.bodyPostings.get(term));
	const metadataDocCount = getMetadataUnionPostingCandidateCount(index, term);
	const totalDocCount = bodyDocCount + metadataDocCount;
	const targetDocCount =
		profile.target === "metadata"
			? metadataDocCount
			: profile.target === "body"
				? bodyDocCount
				: totalDocCount;
	if (targetDocCount <= 0) {
		return null;
	}
	return {
		prefix,
		term,
		bodyDocCount,
		metadataDocCount,
		totalDocCount,
		targetDocCount,
		completionGain: Math.max(0, term.length - prefix.length),
		shapePenalty: computePrefixShapePenalty(term),
		score: computePrefixExpansionScore(
			term,
			prefix,
			bodyDocCount,
			metadataDocCount,
			totalDocCount,
			targetDocCount,
			profile,
		),
	};
}

function buildMetadataAssistPrefixExpansionCandidate(
	index: CoverageLexicalRecallIndex,
	term: string,
	prefix: string,
	profile: CoverageLexicalPrefixExpansionProfile,
): CoverageLexicalPrefixExpansionCandidate | null {
	const metadataDocCount = getMetadataAssistUnionPostingCandidateCount(index, term);
	if (metadataDocCount <= 0) {
		return null;
	}
	return {
		prefix,
		term,
		bodyDocCount: 0,
		metadataDocCount,
		totalDocCount: metadataDocCount,
		targetDocCount: metadataDocCount,
		completionGain: Math.max(0, term.length - prefix.length),
		shapePenalty: computePrefixShapePenalty(term),
		score: computePrefixExpansionScore(
			term,
			prefix,
			0,
			metadataDocCount,
			metadataDocCount,
			metadataDocCount,
			profile,
		),
	};
}

function computePrefixExpansionScore(
	term: string,
	prefix: string,
	bodyDocCount: number,
	metadataDocCount: number,
	totalDocCount: number,
	targetDocCount: number,
	profile: CoverageLexicalPrefixExpansionProfile,
): number {
	const completionGain = Math.max(0, term.length - prefix.length);
	const lengthScore = term.length * 24 + completionGain * 80;
	const rarityScore = computePrefixRarityScore(targetDocCount);
	const totalDocPenalty = Math.min(240, totalDocCount * 2);
	const metadataPresenceBonus =
		profile.target !== "body" && metadataDocCount > 0
			? 80 + Math.min(80, metadataDocCount * 4)
			: 0;
	const mixedBoost =
		profile.target === "all"
			? Math.min(60, bodyDocCount * 2) + Math.min(40, metadataDocCount * 2)
			: 0;
	return (
		lengthScore +
		rarityScore +
		metadataPresenceBonus +
		mixedBoost -
		totalDocPenalty
	);
}

function computePrefixShapePenalty(term: string): number {
	let penalty = 0;
	if (/\d/.test(term)) {
		penalty += 1;
	}
	if (/[._/\-]/.test(term)) {
		penalty += 2;
	}
	return penalty;
}

function computePrefixBoundaryQuality(surfaceText: string | null): number {
	if (!surfaceText) {
		return 0;
	}
	return /^[a-z0-9]+$/iu.test(surfaceText) ? 2 : 1;
}

function computePrefixCompoundPenalty(surfaceText: string | null): number {
	if (!surfaceText) {
		return 0;
	}
	let penalty = 0;
	const separatorMatches = surfaceText.match(/[._/\-]/g);
	if (separatorMatches) {
		penalty += separatorMatches.length;
	}
	if (/\d/.test(surfaceText)) {
		penalty += 1;
	}
	return penalty;
}

function findBestMetadataPrefixSurfaceText(
	fieldText: string,
	prefix: string,
	term: string,
): string | null {
	const loweredPrefix = prefix.toLowerCase();
	const loweredTerm = term.toLowerCase();
	const surfaceTokens = fieldText.match(/[A-Za-z0-9._/\-]+/g);
	if (!surfaceTokens?.length) {
		return null;
	}
	let bestToken: string | null = null;
	let bestBoundaryQuality = -1;
	let bestCompoundPenalty = Number.POSITIVE_INFINITY;
	let bestCompletionGain = Number.POSITIVE_INFINITY;
	for (const surfaceToken of surfaceTokens) {
		const loweredToken = surfaceToken.toLowerCase();
		if (
			!loweredToken.startsWith(loweredPrefix) &&
			!loweredToken.startsWith(loweredTerm)
		) {
			continue;
		}
		const boundaryQuality = computePrefixBoundaryQuality(surfaceToken);
		const compoundPenalty = computePrefixCompoundPenalty(surfaceToken);
		const completionGain = Math.max(0, surfaceToken.length - prefix.length);
		if (
			boundaryQuality > bestBoundaryQuality ||
			(boundaryQuality === bestBoundaryQuality &&
				(compoundPenalty < bestCompoundPenalty ||
					(compoundPenalty === bestCompoundPenalty &&
						completionGain < bestCompletionGain)))
		) {
			bestToken = surfaceToken;
			bestBoundaryQuality = boundaryQuality;
			bestCompoundPenalty = compoundPenalty;
			bestCompletionGain = completionGain;
		}
	}
	return bestToken;
}

function findBestBodyPrefixSurfaceText(
	bodyTokens: readonly string[],
	prefix: string,
	term: string,
): string | null {
	const loweredPrefix = prefix.toLowerCase();
	const loweredTerm = term.toLowerCase();
	let bestToken: string | null = null;
	let bestBoundaryQuality = -1;
	let bestCompoundPenalty = Number.POSITIVE_INFINITY;
	let bestCompletionGain = Number.POSITIVE_INFINITY;
	for (const bodyToken of bodyTokens) {
		if (
			!bodyToken.startsWith(loweredPrefix) &&
			!bodyToken.startsWith(loweredTerm)
		) {
			continue;
		}
		const boundaryQuality = computePrefixBoundaryQuality(bodyToken);
		const compoundPenalty = computePrefixCompoundPenalty(bodyToken);
		const completionGain = Math.max(0, bodyToken.length - prefix.length);
		if (
			boundaryQuality > bestBoundaryQuality ||
			(boundaryQuality === bestBoundaryQuality &&
				(compoundPenalty < bestCompoundPenalty ||
					(compoundPenalty === bestCompoundPenalty &&
						completionGain < bestCompletionGain)))
		) {
			bestToken = bodyToken;
			bestBoundaryQuality = boundaryQuality;
			bestCompoundPenalty = compoundPenalty;
			bestCompletionGain = completionGain;
		}
	}
	return bestToken;
}

function computePrefixRarityScore(targetDocCount: number): number {
	if (targetDocCount <= 1) {
		return 520;
	}
	if (targetDocCount <= 2) {
		return 460;
	}
	if (targetDocCount <= 4) {
		return 380;
	}
	if (targetDocCount <= 8) {
		return 280;
	}
	if (targetDocCount <= 16) {
		return 180;
	}
	if (targetDocCount <= 32) {
		return 90;
	}
	if (targetDocCount <= 64) {
		return 20;
	}
	return -Math.min(220, targetDocCount);
}

function comparePrefixExpansionCandidates(
	left: CoverageLexicalPrefixExpansionCandidate,
	right: CoverageLexicalPrefixExpansionCandidate,
): number {
	return (
		right.score - left.score ||
		left.targetDocCount - right.targetDocCount ||
		right.term.length - left.term.length ||
		left.term.localeCompare(right.term)
	);
}

function getPostingCandidateCountOrZero(
	postings: CoverageLexicalPostingList | undefined,
): number {
	return postings ? getPostingCandidateCount(postings) : 0;
}

function getMetadataUnionPostingCandidateCount(
	index: CoverageLexicalRecallIndex,
	term: string,
): number {
	const seen = new Set<CoverageLexicalCandidateKey>();
	for (const postings of [
		index.metadataBasenamePostings,
		index.metadataAliasPostings,
		index.metadataFolderPostings,
		index.metadataHeadingPostings,
		index.metadataTagPostings,
	] as const) {
		const matches = postings.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			seen.add(key);
		});
	}
	return seen.size;
}

function getMetadataAssistUnionPostingCandidateCount(
	index: CoverageLexicalRecallIndex,
	term: string,
): number {
	const seen = new Set<CoverageLexicalCandidateKey>();
	for (const postings of [
		index.metadataBasenamePostings,
		index.metadataAliasPostings,
		index.metadataFolderPostings,
		index.metadataHeadingPostings,
		index.metadataTagPostings,
	] as const) {
		const matches = postings.get(term);
		if (!matches) {
			continue;
		}
		forEachPostingCandidateKey(index, matches, (key) => {
			seen.add(key);
		});
	}
	return seen.size;
}

function expandFuzzyTerms(
	sortedLexicon: readonly string[],
	queryTerm: string,
): string[] {
	const maxDistance = computeMaxFuzzyDistance(queryTerm);
	if (maxDistance <= 0) {
		return [];
	}

	const candidates: Array<{ term: string; distance: number }> = [];
	for (const term of sortedLexicon) {
		if (Math.abs(term.length - queryTerm.length) > maxDistance) {
			continue;
		}
		if (term[0] !== queryTerm[0]) {
			continue;
		}
		const distance = boundedLevenshtein(term, queryTerm, maxDistance);
		if (distance <= maxDistance) {
			candidates.push({ term, distance });
		}
	}

	candidates.sort((left, right) => {
		if (left.distance !== right.distance) {
			return left.distance - right.distance;
		}
		return left.term.localeCompare(right.term);
	});
	return candidates
		.slice(0, MAX_FUZZY_EXPANSIONS)
		.map((candidate) => candidate.term);
}

function lowerBoundString(values: readonly string[], target: string): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		// Keep binary-search order consistent with the lexicon's raw string sort.
		if (values[mid] < target) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function computeMaxFuzzyDistance(term: string): number {
	if (term.length >= 9) {
		return 2;
	}
	if (term.length >= 5) {
		return 1;
	}
	return 0;
}

function boundedLevenshtein(
	left: string,
	right: string,
	maxDistance: number,
): number {
	const leftLength = left.length;
	const rightLength = right.length;
	if (Math.abs(leftLength - rightLength) > maxDistance) {
		return maxDistance + 1;
	}

	const previous = new Array(rightLength + 1);
	const current = new Array(rightLength + 1);
	for (let column = 0; column <= rightLength; column++) {
		previous[column] = column;
	}

	for (let row = 1; row <= leftLength; row++) {
		current[0] = row;
		let rowMin = current[0];
		for (let column = 1; column <= rightLength; column++) {
			const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
			const value = Math.min(
				previous[column] + 1,
				current[column - 1] + 1,
				previous[column - 1] + substitutionCost,
			);
			current[column] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let column = 0; column <= rightLength; column++) {
			previous[column] = current[column];
		}
	}

	return previous[rightLength];
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function computeCharMatchRatio(matchCount: number, totalTerms: number): number {
	if (matchCount <= 0 || totalTerms <= 0) {
		return 0;
	}
	return matchCount / totalTerms;
}

function acceptsCharFallback(
	matchCount: number,
	matchRatio: number,
	totalTerms: number,
): boolean {
	if (matchCount <= 0 || totalTerms <= 0) {
		return false;
	}
	if (totalTerms <= 2) {
		return matchCount === totalTerms;
	}
	if (totalTerms <= 4) {
		return matchCount >= 2 && matchRatio >= 0.75;
	}
	return matchCount >= 2 && matchRatio >= 0.6;
}

function computeTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}
