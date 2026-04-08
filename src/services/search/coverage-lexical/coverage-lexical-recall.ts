import type { FileSearchRequest } from "../file-search-engine";
import {
	buildCoverageLexicalPassageAdmissionSignal,
	compareCoverageLexicalPassageAdmissionSignals,
} from "./coverage-lexical-admission";
import {
	buildCoverageLexicalBodyEvidenceTrace,
	type CoverageLexicalBodyEvidenceTrace,
} from "./coverage-lexical-body-evidence";
import { buildCoverageLexicalPhraseTerms } from "./coverage-lexical-bridge";
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
	getDocumentBodyTokens: (
		docId: number,
		options?: {
			allowColdLoad?: boolean;
		},
	) => readonly string[] | undefined;
	allowPassageSignalInRecall?: boolean;
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
	| `laneCollect:${CoverageLexicalLaneName}`
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
		readonly CoverageLexicalBodyPhraseWitnessCandidate[]
	>;
	bodyCharVerificationByDocId: Map<
		number,
		CoverageLexicalBodyCharVerification
	>;
	metadataPhraseSurfaceByDocAndField: Map<
		string,
		CoverageLexicalMetadataPhraseSurface | null
	>;
	phraseCandidatesByKey: Map<
		string,
		readonly (readonly [
			CoverageLexicalCandidateKey,
			CoverageLexicalCandidateState,
		])[]
	>;
	familySetCandidatesByKey: Map<
		string,
		readonly (readonly [
			CoverageLexicalCandidateKey,
			CoverageLexicalCandidateState,
		])[]
	>;
};

type CoverageLexicalMetadataPhraseSurface = {
	normalizedText: string;
	tokens: readonly string[];
	phraseTerms: ReadonlySet<string>;
};

type CoverageLexicalBodyPhraseWitnessCandidate = {
	key: CoverageLexicalCandidateKey;
	verified: boolean;
	unresolvedFamilyCount: number;
	unresolvedWeightUpperBound: number;
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

type CoverageLexicalCheapLaneEvidenceProfile = {
	anchorPressure: number;
	metadataAssistPressure: number;
	bodyPressure: number;
	bodyUpperBound: number;
	bridgePressure: number;
	hybridPressure: number;
	passagePressure: number;
	charPressure: number;
};

type CoverageLexicalLaneUnionPressure = {
	admittedTopUpperBound: number;
	remainingTopUpperBound: number;
	remainingPotentialCount: number;
	remainingActivationPressure: number;
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

function createEmptyUnresolvedBodyEvidence(): CoverageLexicalCandidateState["unresolvedBodyEvidence"] {
	return {
		needsPassageSignal: false,
		hasUnverifiedPhraseWitness: false,
		hasUnresolvedPrefixSurface: false,
		hasUnresolvedBodyCharVerification: false,
		unresolvedFamilyCount: 0,
		unresolvedWeightUpperBound: 0,
	};
}

function recordUnresolvedBodyEvidence(
	state: CoverageLexicalCandidateState,
	options: {
		needsPassageSignal?: boolean;
		hasUnverifiedPhraseWitness?: boolean;
		hasUnresolvedPrefixSurface?: boolean;
		hasUnresolvedBodyCharVerification?: boolean;
		unresolvedFamilyCount?: number;
		unresolvedWeightUpperBound?: number;
	},
): void {
	if (options.needsPassageSignal) {
		state.unresolvedBodyEvidence.needsPassageSignal = true;
	}
	if (options.hasUnverifiedPhraseWitness) {
		state.unresolvedBodyEvidence.hasUnverifiedPhraseWitness = true;
	}
	if (options.hasUnresolvedPrefixSurface) {
		state.unresolvedBodyEvidence.hasUnresolvedPrefixSurface = true;
	}
	if (options.hasUnresolvedBodyCharVerification) {
		state.unresolvedBodyEvidence.hasUnresolvedBodyCharVerification = true;
	}
	state.unresolvedBodyEvidence.unresolvedFamilyCount +=
		options.unresolvedFamilyCount ?? 0;
	state.unresolvedBodyEvidence.unresolvedWeightUpperBound = Math.max(
		state.unresolvedBodyEvidence.unresolvedWeightUpperBound,
		options.unresolvedWeightUpperBound ?? 0,
	);
}

function mergeUnresolvedBodyEvidence(
	target: CoverageLexicalCandidateState["unresolvedBodyEvidence"],
	next: CoverageLexicalCandidateState["unresolvedBodyEvidence"],
): void {
	target.needsPassageSignal =
		target.needsPassageSignal || next.needsPassageSignal;
	target.hasUnverifiedPhraseWitness =
		target.hasUnverifiedPhraseWitness || next.hasUnverifiedPhraseWitness;
	target.hasUnresolvedPrefixSurface =
		target.hasUnresolvedPrefixSurface || next.hasUnresolvedPrefixSurface;
	target.hasUnresolvedBodyCharVerification =
		target.hasUnresolvedBodyCharVerification ||
		next.hasUnresolvedBodyCharVerification;
	target.unresolvedFamilyCount = Math.max(
		target.unresolvedFamilyCount,
		next.unresolvedFamilyCount,
	);
	target.unresolvedWeightUpperBound = Math.max(
		target.unresolvedWeightUpperBound,
		next.unresolvedWeightUpperBound,
	);
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

const EMPTY_BODY_TOKENS: readonly string[] = [];

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
const METADATA_PHRASE_TOKEN_REGEX = /[\p{Script=Han}]+|[a-z0-9]+/gu;
const METADATA_CAMEL_BOUNDARY_REGEX = /([a-z0-9])(?=[A-Z])/g;
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
		metadataPhraseSurfaceByDocAndField: new Map(),
		phraseCandidatesByKey: new Map(),
		familySetCandidatesByKey: new Map(),
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
	if (shouldRunRelaxedHybridLane(plan, admittedKeys, aggregateCandidates)) {
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
	}
	if (shouldRunLocalBodyLane(plan, admittedKeys, aggregateCandidates)) {
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
	}
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

function shouldRunRelaxedHybridLane(
	plan: CoverageLexicalPlan,
	admittedKeys: ReadonlySet<CoverageLexicalCandidateKey>,
	aggregateCandidates: ReadonlyMap<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>,
): boolean {
	const unionPressure = computeLaneUnionPressure(
		"relaxed_hybrid_lane",
		aggregateCandidates,
		admittedKeys,
		plan,
	);
	const activationPressure = Math.max(
		computeRelaxedHybridActivationPressure(plan),
		unionPressure.remainingActivationPressure,
	);
	if (
		admittedKeys.size >= 10 &&
		unionPressure.remainingTopUpperBound + 0.12 <
			unionPressure.admittedTopUpperBound
	) {
		return false;
	}
	if (activationPressure >= 0.95) {
		if (admittedKeys.size >= 20) {
			return false;
		}
		return aggregateCandidates.size < 40;
	}
	if (activationPressure >= 0.55) {
		if (admittedKeys.size >= 16) {
			return false;
		}
		return aggregateCandidates.size < 32;
	}
	if (admittedKeys.size >= 12) {
		return false;
	}
	return aggregateCandidates.size < 24;
}

function shouldRunLocalBodyLane(
	plan: CoverageLexicalPlan,
	admittedKeys: ReadonlySet<CoverageLexicalCandidateKey>,
	aggregateCandidates: ReadonlyMap<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>,
): boolean {
	const unionPressure = computeLaneUnionPressure(
		"local_body_lane",
		aggregateCandidates,
		admittedKeys,
		plan,
	);
	const activationPressure = Math.max(
		computeLocalBodyActivationPressure(plan),
		unionPressure.remainingActivationPressure,
	);
	if (
		admittedKeys.size >= 12 &&
		unionPressure.remainingTopUpperBound + 0.14 <
			unionPressure.admittedTopUpperBound
	) {
		return false;
	}
	if (activationPressure >= 0.95) {
		if (admittedKeys.size >= 22) {
			return false;
		}
		return aggregateCandidates.size < 44;
	}
	if (activationPressure >= 0.55) {
		if (admittedKeys.size >= 18) {
			return false;
		}
		return aggregateCandidates.size < 36;
	}
	if (admittedKeys.size >= 16) {
		return false;
	}
	return aggregateCandidates.size < 28;
}

function measureLaneCollectBenchmarkSubphase<T>(
	benchmarkHooks: CoverageLexicalRecallBenchmarkHooks | null,
	laneName: CoverageLexicalLaneName,
	run: () => T,
	getUnitCount?: () => number,
): T {
	if (!benchmarkHooks) {
		return run();
	}
	const start = performance.now();
	try {
		return run();
	} finally {
		const elapsedMs = performance.now() - start;
		const unitCount = getUnitCount?.() ?? 1;
		benchmarkHooks.recordSubphaseTiming("laneCollect", elapsedMs, unitCount);
		benchmarkHooks.recordSubphaseTiming(
			`laneCollect:${laneName}`,
			elapsedMs,
			unitCount,
		);
	}
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
	measureLaneCollectBenchmarkSubphase(
		benchmarkHooks,
		"strict_metadata_lane",
		() => {
			appendFamilySetCandidates(
				index,
				queryCache,
				laneCandidates,
				plan.hardAnchorFamilies,
				{
					scope: "metadata-only",
					includePrefix: request.isPrefixMatch,
					includeFuzzy: false,
				},
			);
			if (derivedPlan.optionalAnchorFamilies.length > 0) {
				appendFamilySetCandidates(
					index,
					queryCache,
					laneCandidates,
					derivedPlan.optionalAnchorFamilies,
					{
						scope: "metadata-only",
						includePrefix: request.isPrefixMatch,
						includeFuzzy: false,
					},
				);
			}
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
	measureLaneCollectBenchmarkSubphase(
		benchmarkHooks,
		"strict_hybrid_lane",
		() => {
			appendFamilySetCandidates(index, queryCache, laneCandidates, plan.hardAnchorFamilies, {
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
	measureLaneCollectBenchmarkSubphase(
		benchmarkHooks,
		"relaxed_hybrid_lane",
		() => {
			appendFamilySetCandidates(index, queryCache, laneCandidates, plan.hardAnchorFamilies, {
				scope: "metadata-only",
				includePrefix: request.isPrefixMatch,
				includeFuzzy: false,
			});
			appendFamilySetCandidates(
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
	measureLaneCollectBenchmarkSubphase(
		benchmarkHooks,
		"local_body_lane",
		() => {
			appendFamilySetCandidates(index, queryCache, laneCandidates, localBodyFamilies, {
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
	measureLaneCollectBenchmarkSubphase(
		benchmarkHooks,
		"bridge_lane",
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
	measureLaneCollectBenchmarkSubphase(
		benchmarkHooks,
		"char_fallback_lane",
		() => {
			collectBodyCharGateCandidates(index, charQuery, laneCandidates);
			for (const postings of [
				index.metadataBasenameCharPostings,
				index.metadataAliasCharPostings,
				index.metadataFolderCharPostings,
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
	const queryBonus = computeLaneSoftBias(laneName, plan);
	return Math.max(request.maxItemResults * 2, base + queryBonus);
}

function computeLaneSoftBias(
	laneName: CoverageLexicalLaneName,
	plan: CoverageLexicalPlan,
): number {
	const anchorMass = getWeightedPlanMass(plan.weightedAnchorMass, plan.anchorFamilyCount);
	const bodyMass = getWeightedPlanMass(plan.weightedBodyMass, plan.bodyFamilyCount);
	const decisiveAnchorMass = getWeightedPlanMass(
		plan.decisiveAnchorMass,
		plan.hardAnchorFamilies.length,
	);
	const decisiveBodyMass = getWeightedPlanMass(
		plan.decisiveBodyMass,
		plan.decisiveBodyFamilies.length,
	);
	const supportBodyMass = getWeightedPlanMass(
		plan.supportBodyMass,
		plan.supportBodyFamilies.length,
	);
	const hybridMass = Math.min(anchorMass, bodyMass);
	switch (laneName) {
		case "strict_metadata_lane":
			return clampLaneBias(
				Math.round(
					Math.min(3, decisiveAnchorMass * 3) +
						Math.min(2, anchorMass) +
						(plan.hardAnchorFamilies.length > 0 ? 1 : 0) +
						(plan.queryKind === "metadata_only_anchored" ? 1 : 0) +
						(plan.route === "metadata-first" ? 1 : 0),
				),
			);
		case "strict_hybrid_lane":
			return clampLaneBias(
				Math.round(
					Math.min(3, hybridMass * 3) +
						Math.min(2, decisiveBodyMass * 3) +
						(plan.queryKind === "anchor_body_hybrid" ? 1 : 0) +
						(plan.route === "body-with-anchor" ? 1 : 0),
				),
			);
		case "relaxed_hybrid_lane":
			return clampLaneBias(
				Math.round(
					Math.min(2, hybridMass * 2.5) +
						Math.min(3, bodyMass * 2) +
						Math.min(1, supportBodyMass * 2) +
						(plan.queryKind === "memory_relaxed" ? 1 : 0) +
						(plan.queryKind === "anchor_body_hybrid" ? 1 : 0),
				),
			);
		case "local_body_lane":
			return clampLaneBias(
				Math.round(
					Math.min(4, (decisiveBodyMass + supportBodyMass * 0.75) * 2) +
						(plan.queryKind === "body_only_local" ? 1 : 0) +
						(plan.queryKind === "memory_relaxed" ? 1 : 0) +
						(plan.route === "body-first" ? 1 : 0),
				),
			);
		case "bridge_lane":
			return clampLaneBias(
				Math.round(
					Math.min(3, plan.bridgeFamilies.length) +
						(plan.queryKind === "bridge_dependent" ? 1 : 0) +
						(plan.hasMixedScriptHint ? 1 : 0),
				),
			);
		case "char_fallback_lane":
			return clampLaneBias(
				(plan.hasMixedScriptHint ? 1 : 0) +
					(plan.shortQueryOverlay && plan.bodyFamilyCount === 0 ? 1 : 0),
			);
		default:
			return 0;
	}
}

function hasMeaningfulHybridPotential(plan: CoverageLexicalPlan): boolean {
	if (plan.hardAnchorFamilies.length === 0 || plan.bodyFamilyCount === 0) {
		return false;
	}
	const anchorMass = getWeightedPlanMass(plan.weightedAnchorMass, plan.anchorFamilyCount);
	const bodyMass = getWeightedPlanMass(plan.weightedBodyMass, plan.bodyFamilyCount);
	const decisiveBodyMass = getWeightedPlanMass(
		plan.decisiveBodyMass,
		plan.decisiveBodyFamilies.length,
	);
	return Math.min(anchorMass, bodyMass) >= 0.35 || decisiveBodyMass >= 0.45;
}

function hasMeaningfulBodyPotential(plan: CoverageLexicalPlan): boolean {
	if (plan.bodyFamilyCount === 0) {
		return false;
	}
	const bodyMass = getWeightedPlanMass(plan.weightedBodyMass, plan.bodyFamilyCount);
	const decisiveBodyMass = getWeightedPlanMass(
		plan.decisiveBodyMass,
		plan.decisiveBodyFamilies.length,
	);
	const supportBodyMass = getWeightedPlanMass(
		plan.supportBodyMass,
		plan.supportBodyFamilies.length,
	);
	return (
		bodyMass >= 0.45 ||
		decisiveBodyMass >= 0.35 ||
		supportBodyMass >= 0.45
	);
}

function computeRelaxedHybridActivationPressure(plan: CoverageLexicalPlan): number {
	const anchorMass = getWeightedPlanMass(plan.weightedAnchorMass, plan.anchorFamilyCount);
	const bodyMass = getWeightedPlanMass(plan.weightedBodyMass, plan.bodyFamilyCount);
	const supportBodyMass = getWeightedPlanMass(
		plan.supportBodyMass,
		plan.supportBodyFamilies.length,
	);
	const optionalBodyFamilyCount = plan.optionalFamilies.filter(
		(family) => family.role === "body",
	).length;
	return (
		Math.min(anchorMass, bodyMass) * 1.15 +
		supportBodyMass * 0.7 +
		Math.min(0.45, optionalBodyFamilyCount * 0.18) +
		(plan.queryKind === "memory_relaxed" ? 0.14 : 0) +
		(plan.queryKind === "anchor_body_hybrid" ? 0.06 : 0)
	);
}

function computeLocalBodyActivationPressure(plan: CoverageLexicalPlan): number {
	const bodyMass = getWeightedPlanMass(plan.weightedBodyMass, plan.bodyFamilyCount);
	const decisiveBodyMass = getWeightedPlanMass(
		plan.decisiveBodyMass,
		plan.decisiveBodyFamilies.length,
	);
	const supportBodyMass = getWeightedPlanMass(
		plan.supportBodyMass,
		plan.supportBodyFamilies.length,
	);
	const bridgePressure = Math.min(0.35, plan.bridgeFamilies.length * 0.12);
	return (
		bodyMass * 0.9 +
		decisiveBodyMass * 0.9 +
		supportBodyMass * 0.55 +
		bridgePressure +
		(plan.queryKind === "body_only_local" ? 0.1 : 0) +
		(plan.queryKind === "memory_relaxed" ? 0.08 : 0) +
		(plan.queryKind === "bridge_dependent" ? 0.08 : 0) +
		(plan.route === "body-first" ? 0.05 : 0)
	);
}

function getWeightedPlanMass(
	value: number | undefined,
	fallback: number,
): number {
	return Number.isFinite(value) ? (value as number) : fallback;
}

function clampLaneBias(value: number): number {
	return Math.max(0, Math.min(8, value));
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
	const deferredFullEvaluation = shouldDeferFullLaneEvaluation(laneName);
	const lightEvaluations = evaluateLaneCandidatesLight(
		laneName,
		preselected,
		plan,
		phraseSignatures,
		index,
		charQuery,
		queryCache,
		benchmarkHooks,
		deferredFullEvaluation,
	);
	if (laneName === "strict_metadata_lane") {
		return lightEvaluations.map(({ evaluation }) => evaluation);
	}
	if (!deferredFullEvaluation) {
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
					includePassageSignal:
						(index.allowPassageSignalInRecall ?? true) &&
						laneName === "local_body_lane",
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
	deferredFullEvaluation: boolean,
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
				includePassageSignal:
					(index.allowPassageSignalInRecall ?? true) &&
					laneName === "local_body_lane" &&
					!deferredFullEvaluation,
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
	return laneName === "local_body_lane";
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
	const cutoffUpperBound =
		cutoff === null
			? 0
			: computeLaneEvidenceUpperBound(
					laneName,
					buildLaneEvidenceProfile(cutoff),
				);
	if (cutoff) {
		for (let index = fullEvalBudget; index < lightEvaluations.length; index += 1) {
			const candidate = lightEvaluations[index];
			if (
				compareLaneEvaluations(laneName, cutoff, candidate.evaluation, plan) !==
					0 &&
				computeLaneEvidenceUpperBound(
					laneName,
					buildLaneEvidenceProfile(candidate.evaluation),
				) +
					0.06 <
					cutoffUpperBound
			) {
				break;
			}
			selected.push(candidate.candidate);
			selectedKeys.add(candidate.candidate.key);
		}
	}
	if (
		laneName === "strict_hybrid_lane" ||
		laneName === "relaxed_hybrid_lane" ||
		laneName === "local_body_lane"
	) {
		for (const { candidate } of lightEvaluations) {
			if (selectedKeys.has(candidate.key)) {
				continue;
			}
			if (
				!shouldProtectCheapWitnessFloor(
					laneName,
					candidate.signal,
					plan,
					cutoffUpperBound,
				)
			) {
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
	cutoffUpperBound = 0,
): boolean {
	const profile = buildCheapLaneEvidenceProfile(signal);
	const upperBound = computeCheapLaneUpperBound(laneName, profile);
	const protectionFloor = computeLaneProtectionFloor(laneName, plan);
	const hasWitness =
		signal.phraseMatchCount > 0 ||
		signal.supportBody.coverageCount > 0 ||
		signal.metadataAssist.coverageCount > 0;
	if (!hasWitness || upperBound < protectionFloor) {
		return false;
	}
	return cutoffUpperBound <= 0 || upperBound + 0.08 >= cutoffUpperBound;
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
	const tokens = options.includePassageSignal
		? (index.getDocumentBodyTokens(key) ?? EMPTY_BODY_TOKENS)
		: EMPTY_BODY_TOKENS;
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
	if (
		!options.includePassageSignal &&
		(signal.decisiveBody.coverageCount > 0 ||
			signal.supportBody.coverageCount > 0 ||
			signal.optionalBody.coverageCount > 0 ||
			phraseMatchCount > 0)
	) {
		recordUnresolvedBodyEvidence(state, {
			needsPassageSignal: true,
			unresolvedFamilyCount:
				signal.decisiveBody.coverageCount +
				signal.supportBody.coverageCount +
				signal.optionalBody.coverageCount +
				phraseMatchCount,
			unresolvedWeightUpperBound:
				signal.decisiveBody.tailWeight +
				signal.supportBody.tailWeight +
				signal.optionalBody.tailWeight +
				phraseMatchWeight,
		});
	}
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
	const evidenceProfile = buildLaneEvidenceProfile(evaluation);
	switch (laneName) {
		case "strict_metadata_lane":
			return (
				evidenceProfile.anchorPressure >=
					Math.max(1.05, plan.hardAnchorFamilies.length * 0.95) ||
				(evaluation.hardAnchorMetadata.coverageCount >= 1 &&
					evidenceProfile.hybridPressure >= 0.9) ||
				evidenceProfile.bridgePressure >= 1.15
			);
		case "strict_hybrid_lane":
			return (
				evidenceProfile.hybridPressure >=
					Math.max(0.95, plan.relaxedMinimumMatchCount * 0.7) &&
				evidenceProfile.bodyUpperBound >= 1
			);
		case "relaxed_hybrid_lane":
			return (
				evidenceProfile.hybridPressure >=
					Math.max(0.7, plan.relaxedMinimumMatchCount * 0.55) ||
				(evidenceProfile.bodyUpperBound >=
					Math.max(1.1, plan.relaxedMinimumMatchCount * 0.9) &&
					(evidenceProfile.anchorPressure >= 0.5 ||
						evidenceProfile.bridgePressure >= 0.8))
			);
		case "local_body_lane":
			return (
				evidenceProfile.bodyUpperBound >=
					Math.max(
						0.95,
						Math.min(plan.coreFamilyCount, plan.relaxedMinimumMatchCount || 1) * 0.85,
					) ||
				evidenceProfile.passagePressure >= 0.75 ||
				evidenceProfile.metadataAssistPressure >= 0.7
			);
		case "bridge_lane":
			return (
				evidenceProfile.bridgePressure >= 0.9 ||
				evidenceProfile.hybridPressure >= 0.7 ||
				evidenceProfile.metadataAssistPressure >= 0.8
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
				) ||
				evidenceProfile.charPressure >= 1.05
			);
		default:
			return false;
	}
}

type CoverageLexicalLaneEvidenceProfile = {
	anchorPressure: number;
	metadataAssistPressure: number;
	bodyPressure: number;
	bodyUpperBound: number;
	bridgePressure: number;
	hybridPressure: number;
	passagePressure: number;
	charPressure: number;
};

function buildLaneEvidenceProfile(
	evaluation: CoverageLexicalLaneEvaluation,
): CoverageLexicalLaneEvidenceProfile {
	const anchorPressure =
		computeGroupPressure(evaluation.hardAnchorMetadata, 1.15) +
		computeGroupPressure(evaluation.metadataAssist, 0.35);
	const metadataAssistPressure = computeGroupPressure(
		evaluation.metadataAssist,
		0.9,
	);
	const passagePressure = computePassagePressure(evaluation.passageSignal);
	const bodyPressure =
		computeGroupPressure(evaluation.decisiveBody, 1.1) +
		computeGroupPressure(evaluation.supportBody, 0.75) +
		computeGroupPressure(evaluation.optionalBody, 0.45) +
		passagePressure * 0.45;
	const unresolvedPressure =
		evaluation.state.unresolvedBodyEvidence.unresolvedWeightUpperBound * 0.3 +
		evaluation.state.unresolvedBodyEvidence.unresolvedFamilyCount * 0.18;
	const bodyUpperBound = bodyPressure + unresolvedPressure;
	const bridgePressure =
		computeGroupPressure(evaluation.bridgeSignal, 1) +
		evaluation.phraseMatchCount * 0.35 +
		evaluation.phraseMatchWeight * 0.08 +
		metadataAssistPressure * 0.2;
	const hybridPressure =
		Math.min(anchorPressure, bodyUpperBound) +
		Math.min(bridgePressure, 0.8) * 0.25 +
		Math.min(passagePressure, 0.9) * 0.2;
	const charPressure =
		evaluation.tagExactMatchCount * 1.1 +
		evaluation.tagCharMatchRatio * 0.9 +
		evaluation.metadataCharMatchRatio * 0.85 +
		evaluation.bodyCharMatchRatio * 0.6 +
		evaluation.tagCharMatchCount * 0.08 +
		evaluation.metadataCharMatchCount * 0.06 +
		evaluation.bodyCharMatchCount * 0.04;
	return {
		anchorPressure,
		metadataAssistPressure,
		bodyPressure,
		bodyUpperBound,
		bridgePressure,
		hybridPressure,
		passagePressure,
		charPressure,
	};
}

function buildCheapLaneEvidenceProfile(
	signal: CoverageLexicalCheapLaneSignal,
): CoverageLexicalCheapLaneEvidenceProfile {
	const anchorPressure =
		computeGroupPressure(signal.hardAnchorMetadata, 1.1) +
		computeGroupPressure(signal.metadataAssist, 0.3);
	const metadataAssistPressure = computeGroupPressure(signal.metadataAssist, 0.85);
	const passagePressure =
		signal.phraseMatchCount * 0.34 +
		signal.decisiveBody.coverageCount * 0.18 +
		signal.supportBody.coverageCount * 0.1;
	const bodyPressure =
		computeGroupPressure(signal.decisiveBody, 1.05) +
		computeGroupPressure(signal.supportBody, 0.72) +
		computeGroupPressure(signal.optionalBody, 0.45) +
		passagePressure * 0.35;
	const bodyUpperBound =
		bodyPressure +
		signal.phraseMatchCount * 0.18 +
		(signal.decisiveBody.tailWeight +
			signal.supportBody.tailWeight +
			signal.optionalBody.tailWeight) *
			0.06;
	const bridgePressure =
		computeGroupPressure(signal.bridgeSignal, 1) +
		signal.phraseMatchCount * 0.3 +
		metadataAssistPressure * 0.2;
	const hybridPressure =
		Math.min(anchorPressure, bodyUpperBound) +
		Math.min(bridgePressure, 0.8) * 0.22 +
		Math.min(passagePressure, 0.8) * 0.16;
	const charPressure =
		signal.tagExactCount * 1.1 +
		signal.tagCharCount * 0.28 +
		signal.metadataCharCount * 0.16 +
		signal.bodyCharCount * 0.08;
	return {
		anchorPressure,
		metadataAssistPressure,
		bodyPressure,
		bodyUpperBound,
		bridgePressure,
		hybridPressure,
		passagePressure,
		charPressure,
	};
}

function computeLaneEvidenceUpperBound(
	laneName: CoverageLexicalLaneName,
	profile: CoverageLexicalLaneEvidenceProfile,
): number {
	switch (laneName) {
		case "strict_metadata_lane":
			return profile.anchorPressure + profile.bridgePressure * 0.2;
		case "strict_hybrid_lane":
			return profile.hybridPressure + profile.bodyUpperBound * 0.15;
		case "relaxed_hybrid_lane":
			return (
				profile.hybridPressure +
				profile.bodyUpperBound * 0.32 +
				profile.bridgePressure * 0.16
			);
		case "local_body_lane":
			return (
				profile.bodyUpperBound +
				profile.passagePressure * 0.3 +
				profile.metadataAssistPressure * 0.12
			);
		case "bridge_lane":
			return profile.bridgePressure + profile.hybridPressure * 0.18;
		case "char_fallback_lane":
			return profile.charPressure + profile.bridgePressure * 0.1;
		default:
			return 0;
	}
}

function computeCheapLaneUpperBound(
	laneName: CoverageLexicalLaneName,
	profile: CoverageLexicalCheapLaneEvidenceProfile,
): number {
	switch (laneName) {
		case "strict_metadata_lane":
			return profile.anchorPressure + profile.bridgePressure * 0.2;
		case "strict_hybrid_lane":
			return profile.hybridPressure + profile.bodyUpperBound * 0.15;
		case "relaxed_hybrid_lane":
			return (
				profile.hybridPressure +
				profile.bodyUpperBound * 0.32 +
				profile.bridgePressure * 0.16
			);
		case "local_body_lane":
			return (
				profile.bodyUpperBound +
				profile.passagePressure * 0.3 +
				profile.metadataAssistPressure * 0.12
			);
		case "bridge_lane":
			return profile.bridgePressure + profile.hybridPressure * 0.18;
		case "char_fallback_lane":
			return profile.charPressure + profile.bridgePressure * 0.1;
		default:
			return 0;
	}
}

function computeLaneProtectionFloor(
	laneName: CoverageLexicalLaneName,
	plan: CoverageLexicalPlan,
): number {
	switch (laneName) {
		case "strict_hybrid_lane":
			return Math.max(0.95, plan.relaxedMinimumMatchCount * 0.7);
		case "relaxed_hybrid_lane":
			return Math.max(0.7, plan.relaxedMinimumMatchCount * 0.55);
		case "local_body_lane":
			return Math.max(
				0.82,
				Math.min(plan.coreFamilyCount, plan.relaxedMinimumMatchCount || 1) * 0.72,
			);
		default:
			return Number.POSITIVE_INFINITY;
	}
}

function computeLaneUnionPressure(
	laneName: CoverageLexicalLaneName,
	aggregateCandidates: ReadonlyMap<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>,
	admittedKeys: ReadonlySet<CoverageLexicalCandidateKey>,
	plan: CoverageLexicalPlan,
): CoverageLexicalLaneUnionPressure {
	let admittedTopUpperBound = 0;
	let remainingTopUpperBound = 0;
	let remainingPotentialCount = 0;
	const protectionFloor = computeLaneProtectionFloor(laneName, plan);
	for (const [key, state] of aggregateCandidates) {
		const signal = buildCheapLaneSignal(state, plan);
		const profile = buildCheapLaneEvidenceProfile(signal);
		const upperBound = computeCheapLaneUpperBound(laneName, profile);
		if (admittedKeys.has(key)) {
			admittedTopUpperBound = Math.max(admittedTopUpperBound, upperBound);
			continue;
		}
		remainingTopUpperBound = Math.max(remainingTopUpperBound, upperBound);
		if (upperBound >= protectionFloor) {
			remainingPotentialCount += 1;
		}
	}
	return {
		admittedTopUpperBound,
		remainingTopUpperBound,
		remainingPotentialCount,
		remainingActivationPressure:
			remainingTopUpperBound +
			Math.min(0.35, remainingPotentialCount * 0.08),
	};
}

function computeGroupPressure(
	signal: CoverageLexicalGroupSignal,
	weightMultiplier = 1,
): number {
	return (
		(signal.exactWeight +
			signal.prefixWeight * 0.72 +
			signal.fuzzyWeight * 0.4 +
			signal.coverageCount * 0.28 +
			signal.tailWeight * 0.04) *
		weightMultiplier
	);
}

function computePassagePressure(
	signal: CoverageLexicalPassageAdmissionSignal,
): number {
	return (
		signal.exactWeight +
		signal.prefixWeight * 0.72 +
		signal.fuzzyWeight * 0.42 +
		signal.coreCoverageCount * 0.38 +
		signal.anchorCoverageCount * 0.2 +
		signal.softCoverageCount * 0.1 +
		signal.phraseMatchWeight * 0.08 +
		signal.compactnessScore * 0.2
	);
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

function appendFamilySetCandidates(
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
	for (const [key, state] of getOrCreateFamilySetCandidateEntries(
		index,
		queryCache,
		families,
		options,
	)) {
		mergeCandidateStateByDocId(candidates, key, state);
	}
}

function getOrCreateFamilySetCandidateEntries(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	families: readonly CoverageLexicalFamily[],
	options: {
		scope: CoverageLexicalCollectionScope;
		includePrefix: boolean;
		includeFuzzy: boolean;
	},
): readonly (readonly [
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState,
	])[] {
	const uniqueFamilies = dedupeFamilies(families);
	if (options.scope === "all") {
		return getOrCreateMergedFamilySetCandidateEntries(
			index,
			queryCache,
			uniqueFamilies,
			options,
		);
	}
	const cacheKey = [
		options.scope,
		options.includePrefix ? "prefix" : "no-prefix",
		options.includeFuzzy ? "fuzzy" : "no-fuzzy",
		uniqueFamilies.map((family) => family.index).join(","),
	].join("|");
	const cached = queryCache.familySetCandidatesByKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const collected = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectFamilySetCandidates(index, queryCache, collected, uniqueFamilies, options);
	const created = Array.from(
		collected.entries(),
		([key, state]) => [key, cloneCandidateState(state)] as const,
	);
	queryCache.familySetCandidatesByKey.set(cacheKey, created);
	return created;
}

function getOrCreateMergedFamilySetCandidateEntries(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	families: readonly CoverageLexicalFamily[],
	options: {
		scope: CoverageLexicalCollectionScope;
		includePrefix: boolean;
		includeFuzzy: boolean;
	},
): readonly (readonly [
	CoverageLexicalCandidateKey,
	CoverageLexicalCandidateState,
])[] {
	const cacheKey = [
		"all",
		options.includePrefix ? "prefix" : "no-prefix",
		options.includeFuzzy ? "fuzzy" : "no-fuzzy",
		families.map((family) => family.index).join(","),
	].join("|");
	const cached = queryCache.familySetCandidatesByKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const merged = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	for (const [key, state] of getOrCreateFamilySetCandidateEntries(
		index,
		queryCache,
		families,
		{
			scope: "metadata-only",
			includePrefix: options.includePrefix,
			includeFuzzy: options.includeFuzzy,
		},
	)) {
		mergeCandidateStateByDocId(merged, key, state);
	}
	for (const [key, state] of getOrCreateFamilySetCandidateEntries(
		index,
		queryCache,
		families,
		{
			scope: "body-only",
			includePrefix: options.includePrefix,
			includeFuzzy: options.includeFuzzy,
		},
	)) {
		mergeCandidateStateByDocId(merged, key, state);
	}
	const created = Array.from(
		merged.entries(),
		([key, state]) => [key, cloneCandidateState(state)] as const,
	);
	queryCache.familySetCandidatesByKey.set(cacheKey, created);
	return created;
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
		for (const [key, state] of getOrCreatePhraseCandidateEntries(
			index,
			queryCache,
			signature,
			scope,
		)) {
			mergeCandidateStateByDocId(candidates, key, state);
		}
	}
}

function getOrCreatePhraseCandidateEntries(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	signature: CoverageLexicalPhraseSignature,
	scope: CoverageLexicalCollectionScope,
): readonly (readonly [
	CoverageLexicalCandidateKey,
	CoverageLexicalCandidateState,
])[] {
	const cacheScope = getPhraseCandidateCacheScope(signature, scope);
	if (
		cacheScope === "all" &&
		(!signature.preferredFields || signature.preferredFields.length === 0)
	) {
		return getOrCreateMergedPhraseCandidateEntries(
			index,
			queryCache,
			signature,
		);
	}
	const cacheKey = `${cacheScope}|${signature.index}`;
	const cached = queryCache.phraseCandidatesByKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const collected = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectCandidatesForPhraseSignature(
		index,
		queryCache,
		collected,
		signature,
		cacheScope,
	);
	const created = Array.from(
		collected.entries(),
		([key, state]) => [key, cloneCandidateState(state)] as const,
	);
	queryCache.phraseCandidatesByKey.set(cacheKey, created);
	return created;
}

function getOrCreateMergedPhraseCandidateEntries(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	signature: CoverageLexicalPhraseSignature,
): readonly (readonly [
	CoverageLexicalCandidateKey,
	CoverageLexicalCandidateState,
])[] {
	const cacheKey = `all|${signature.index}`;
	const cached = queryCache.phraseCandidatesByKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const merged = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	for (const [key, state] of getOrCreatePhraseCandidateEntries(
		index,
		queryCache,
		signature,
		"metadata-only",
	)) {
		mergeCandidateStateByDocId(merged, key, state);
	}
	for (const [key, state] of getOrCreatePhraseCandidateEntries(
		index,
		queryCache,
		signature,
		"body-only",
	)) {
		mergeCandidateStateByDocId(merged, key, state);
	}
	const created = Array.from(
		merged.entries(),
		([key, state]) => [key, cloneCandidateState(state)] as const,
	);
	queryCache.phraseCandidatesByKey.set(cacheKey, created);
	return created;
}

function getPhraseCandidateCacheScope(
	signature: CoverageLexicalPhraseSignature,
	scope: CoverageLexicalCollectionScope,
): CoverageLexicalCollectionScope {
	if (
		scope !== "body-only" &&
		signature.preferredFields &&
		signature.preferredFields.length > 0
	) {
		return "metadata-only";
	}
	return scope;
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
					const bodyTokens = index.getDocumentBodyTokens(key);
					const surfaceText = findBestBodyPrefixSurfaceText(
						bodyTokens ?? EMPTY_BODY_TOKENS,
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
					if (!bodyTokens) {
						recordUnresolvedBodyEvidence(state, {
							hasUnresolvedPrefixSurface: true,
							unresolvedFamilyCount: 1,
							unresolvedWeightUpperBound: Math.max(
								prefixWitnessCandidate.score,
								prefixWitnessCandidate.completionGain,
							),
						});
					}
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
			collectAnyMetadataPhraseMatches(index, queryCache, candidates, signature);
			continue;
		}

		collectPreferredMetadataPhraseMatches(
			index,
			queryCache,
			candidates,
			signature,
		);
	}
}

function collectBodyPhraseWitnessMatches(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
): void {
	for (const match of getOrCreateBodyPhraseWitnessCandidateKeys(
		index,
		signature,
		queryCache,
	)) {
		const state = getOrCreateDocIdCandidateState(candidates, match.key);
		if (!match.verified) {
			if (!state.unresolvedBodyPhraseMatchIndices.includes(signature.index)) {
				state.unresolvedBodyPhraseMatchIndices.push(signature.index);
			}
			recordUnresolvedBodyEvidence(state, {
				hasUnverifiedPhraseWitness: true,
				unresolvedFamilyCount: match.unresolvedFamilyCount,
				unresolvedWeightUpperBound: match.unresolvedWeightUpperBound,
			});
			continue;
		}
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
): readonly CoverageLexicalBodyPhraseWitnessCandidate[] {
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
	const canonicalTokenPostings = Array.from(
		new Set(canonicalTokens),
		(token) => [token, index.bodyPostings.get(token)] as const,
	);
	const matchedKeys: CoverageLexicalBodyPhraseWitnessCandidate[] = [];
	const seen = new Set<CoverageLexicalCandidateKey>();
	forEachPostingCandidateKey(index, anchorMatches, (key) => {
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		const bodyTokens = index.getDocumentBodyTokens(key);
		if (bodyTokens) {
			if (hasContiguousPhraseWitness(bodyTokens, canonicalTokens)) {
				matchedKeys.push({
					key,
					verified: true,
					unresolvedFamilyCount: 0,
					unresolvedWeightUpperBound: 0,
				});
			}
			return;
		}
		if (bodyPhraseWitnessHasAllCanonicalTokens(index, key, canonicalTokenPostings)) {
			matchedKeys.push({
				key,
				verified: false,
				unresolvedFamilyCount: signature.familyIndices.length,
				unresolvedWeightUpperBound: signature.tailWeight,
			});
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

function bodyPhraseWitnessHasAllCanonicalTokens(
	index: CoverageLexicalRecallIndex,
	key: CoverageLexicalCandidateKey,
	tokenPostings: ReadonlyArray<
		readonly [string, CoverageLexicalPostingList | undefined]
	>,
): boolean {
	for (const [, postings] of tokenPostings) {
		if (!postings || !postingHasCandidateKey(index, postings, key)) {
			return false;
		}
	}
	return true;
}

export function getPhraseWitnessCanonicalTokens(
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

export function hasContiguousPhraseWitness(
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

function getMetadataPhraseSurfaceCacheKey(
	docId: number,
	field: CoverageLexicalMetadataField,
): string {
	return `${docId}:${field}`;
}

function tokenizeMetadataPhraseSurfaceText(text: string): string[] {
	const normalized = text
		.normalize("NFKC")
		.replace(METADATA_CAMEL_BOUNDARY_REGEX, "$1 ")
		.toLowerCase();
	return normalized.match(METADATA_PHRASE_TOKEN_REGEX) ?? [];
}

function getOrCreateMetadataPhraseSurface(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	docId: number,
	field: CoverageLexicalMetadataField,
): CoverageLexicalMetadataPhraseSurface | null {
	const cacheKey = getMetadataPhraseSurfaceCacheKey(docId, field);
	const cached = queryCache.metadataPhraseSurfaceByDocAndField.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}
	const rawText = index.getDocumentMetadataFieldText?.(docId, field) ?? "";
	if (rawText.length === 0) {
		queryCache.metadataPhraseSurfaceByDocAndField.set(cacheKey, null);
		return null;
	}
	const normalizedText = rawText.toLowerCase().normalize("NFKC");
	const tokens = tokenizeMetadataPhraseSurfaceText(rawText);
	const created: CoverageLexicalMetadataPhraseSurface = {
		normalizedText,
		tokens,
		phraseTerms: new Set(buildCoverageLexicalPhraseTerms(tokens)),
	};
	queryCache.metadataPhraseSurfaceByDocAndField.set(cacheKey, created);
	return created;
}

function matchesMetadataPhraseSignature(
	surface: CoverageLexicalMetadataPhraseSurface,
	signature: CoverageLexicalPhraseSignature,
): boolean {
	for (const variant of signature.variants) {
		if (variant.length === 0) {
			continue;
		}
		if (
			surface.phraseTerms.has(variant) ||
			surface.normalizedText.includes(variant)
		) {
			return true;
		}
	}
	const canonicalTokens = getPhraseWitnessCanonicalTokens(signature);
	return (
		canonicalTokens.length >= 2 &&
		hasContiguousPhraseWitness(surface.tokens, canonicalTokens)
	);
}

function getPostingCandidateCount(postings: CoverageLexicalPostingList): number {
	return Array.isArray(postings) || postings instanceof Uint32Array
		? postings.length
		: (postings as ReadonlySet<string>).size;
}

function postingHasCandidateKey(
	index: CoverageLexicalRecallIndex,
	postings: CoverageLexicalPostingList,
	key: CoverageLexicalCandidateKey,
): boolean {
	if (Array.isArray(postings) || postings instanceof Uint32Array) {
		return postings.indexOf(key) !== -1;
	}
	const path = index.documentPathById[key];
	return path !== undefined && (postings as ReadonlySet<string>).has(path);
}

function getMetadataExactPostingMapsForField(
	index: CoverageLexicalRecallIndex,
	field: CoverageLexicalMetadataField,
): readonly CoverageLexicalPostingMap[] {
	switch (field) {
		case "basename":
			return [index.metadataBasenamePostings];
		case "aliases":
			return [index.metadataAliasPostings];
		case "folder":
			return [index.metadataFolderPostings];
		case "headings":
			return [index.metadataHeadingPostings];
		case "tags":
			return [index.metadataTagPostings, index.metadataTagFullPostings];
	}
}

function collectMetadataPhraseVerificationCandidateKeys(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	fields: readonly CoverageLexicalMetadataField[],
): Set<CoverageLexicalCandidateKey> {
	const keys = new Set<CoverageLexicalCandidateKey>(candidates.keys());
	const seedTokens = new Set<string>();
	for (const variant of signature.variants) {
		for (const token of variant.split(" ")) {
			const normalized = token.trim();
			if (normalized.length > 0) {
				seedTokens.add(normalized);
			}
		}
	}
	for (const token of getPhraseWitnessCanonicalTokens(signature)) {
		if (token.length > 0) {
			seedTokens.add(token);
		}
	}
	for (const field of fields) {
		for (const postings of getMetadataExactPostingMapsForField(index, field)) {
			for (const token of seedTokens) {
				const matches = postings.get(token);
				if (!matches) {
					continue;
				}
				forEachPostingCandidateKey(index, matches, (key) => {
					keys.add(key);
				});
			}
		}
	}
	return keys;
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
	for (const phraseIndex of nextState.unresolvedBodyPhraseMatchIndices) {
		if (!target.unresolvedBodyPhraseMatchIndices.includes(phraseIndex)) {
			target.unresolvedBodyPhraseMatchIndices.push(phraseIndex);
		}
	}
	mergeUnresolvedBodyEvidence(
		target.unresolvedBodyEvidence,
		nextState.unresolvedBodyEvidence,
	);
}

function collectAnyMetadataPhraseMatches(
	index: CoverageLexicalRecallIndex,
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
): void {
	const candidateKeys = collectMetadataPhraseVerificationCandidateKeys(
		index,
		candidates,
		signature,
		ALL_METADATA_FIELDS,
	);
	for (const key of candidateKeys) {
		let matched = false;
		for (const field of ALL_METADATA_FIELDS) {
			const surface = getOrCreateMetadataPhraseSurface(
				index,
				queryCache,
				key,
				field,
			);
			if (!surface || !matchesMetadataPhraseSignature(surface, signature)) {
				continue;
			}
			matched = true;
			break;
		}
		if (!matched) {
			continue;
		}
		const state = getOrCreateDocIdCandidateState(candidates, key);
		recordPhraseMatch(state, signature.index);
		for (const familyIndex of signature.familyIndices) {
			recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
		}
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
		unresolvedBodyPhraseMatchIndices: [],
		tagCharMatchIndices: [],
		tagCharMatchFlags: [],
		tagExactMatchIndices: [],
		tagExactMatchFlags: [],
		unresolvedBodyEvidence: createEmptyUnresolvedBodyEvidence(),
	};
}

function cloneCandidateState(
	state: CoverageLexicalCandidateState,
): CoverageLexicalCandidateState {
	return {
		bodyMatches: [...state.bodyMatches],
		bodyCharMatchIndices: [...state.bodyCharMatchIndices],
		bodyCharMatchFlags: [...state.bodyCharMatchFlags],
		bodyPrefixWitness: state.bodyPrefixWitness
			? { ...state.bodyPrefixWitness }
			: null,
		metadataMatches: [...state.metadataMatches],
		metadataAssistFieldMatches: cloneMetadataFieldMatches(
			state.metadataAssistFieldMatches,
		),
		metadataCharMatchIndices: [...state.metadataCharMatchIndices],
		metadataCharMatchFlags: [...state.metadataCharMatchFlags],
		metadataFieldMatches: cloneMetadataFieldMatches(state.metadataFieldMatches),
		metadataPrefixWitness: state.metadataPrefixWitness
			? { ...state.metadataPrefixWitness }
			: null,
		phraseMatches: [...state.phraseMatches],
		phraseMatchFlags: [...state.phraseMatchFlags],
		unresolvedBodyPhraseMatchIndices: [
			...state.unresolvedBodyPhraseMatchIndices,
		],
		tagCharMatchIndices: [...state.tagCharMatchIndices],
		tagCharMatchFlags: [...state.tagCharMatchFlags],
		tagExactMatchIndices: [...state.tagExactMatchIndices],
		tagExactMatchFlags: [...state.tagExactMatchFlags],
		unresolvedBodyEvidence: {
			...state.unresolvedBodyEvidence,
		},
	};
}

function cloneMetadataFieldMatches(
	source: CoverageLexicalCandidateState["metadataFieldMatches"],
): CoverageLexicalCandidateState["metadataFieldMatches"] {
	return {
		basename: [...source.basename],
		aliases: [...source.aliases],
		folder: [...source.folder],
		headings: [...source.headings],
		tags: [...source.tags],
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
	queryCache: CoverageLexicalQueryCache,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
): void {
	const preferredFields = signature.preferredFields ?? [];
	if (preferredFields.length === 0) {
		return;
	}
	const candidateKeys = collectMetadataPhraseVerificationCandidateKeys(
		index,
		candidates,
		signature,
		preferredFields,
	);
	for (const key of candidateKeys) {
		const state = getOrCreateDocIdCandidateState(candidates, key);
		let matchedAnyField = false;
		for (const field of preferredFields) {
			const surface = getOrCreateMetadataPhraseSurface(
				index,
				queryCache,
				key,
				field,
			);
			if (!surface || !matchesMetadataPhraseSignature(surface, signature)) {
				continue;
			}
			matchedAnyField = true;
			for (const familyIndex of signature.familyIndices) {
				recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, "exact");
			}
		}
		if (!matchedAnyField) {
			continue;
		}
		recordPhraseMatch(state, signature.index);
		for (const familyIndex of signature.familyIndices) {
			recordFamilyMatch(state.metadataMatches, familyIndex, "exact");
		}
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

export function findBestBodyPrefixSurfaceText(
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

export function resolveHydratedCoverageLexicalCandidateState(
	state: CoverageLexicalCandidateState,
	bodyTokens: readonly string[],
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
): CoverageLexicalCandidateState {
	const resolved = cloneCandidateState(state);
	if (
		resolved.unresolvedBodyEvidence.hasUnresolvedPrefixSurface &&
		resolved.bodyPrefixWitness
	) {
		const resolvedSurfaceText = findBestBodyPrefixSurfaceText(
			bodyTokens,
			resolved.bodyPrefixWitness.term,
			resolved.bodyPrefixWitness.term,
		);
		if (resolvedSurfaceText) {
			resolved.bodyPrefixWitness = {
				...resolved.bodyPrefixWitness,
				surfaceText: resolvedSurfaceText,
			};
			resolved.unresolvedBodyEvidence.hasUnresolvedPrefixSurface = false;
		}
	}
	if (resolved.unresolvedBodyPhraseMatchIndices.length > 0) {
		const remainingPhraseIndices: number[] = [];
		for (const phraseIndex of resolved.unresolvedBodyPhraseMatchIndices) {
			if (resolved.phraseMatches.includes(phraseIndex)) {
				continue;
			}
			const signature = phraseSignatures[phraseIndex];
			if (!signature) {
				remainingPhraseIndices.push(phraseIndex);
				continue;
			}
			const canonicalTokens = getPhraseWitnessCanonicalTokens(signature);
			if (!hasContiguousPhraseWitness(bodyTokens, canonicalTokens)) {
				remainingPhraseIndices.push(phraseIndex);
				continue;
			}
			recordPhraseMatch(resolved, phraseIndex);
			for (const familyIndex of signature.familyIndices) {
				recordFamilyMatch(resolved.bodyMatches, familyIndex, "prefix");
			}
		}
		resolved.unresolvedBodyPhraseMatchIndices = remainingPhraseIndices;
		resolved.unresolvedBodyEvidence.hasUnverifiedPhraseWitness =
			remainingPhraseIndices.length > 0;
	}
	return resolved;
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
