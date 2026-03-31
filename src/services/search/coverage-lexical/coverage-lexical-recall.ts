import type { FileSearchRequest } from "../file-search-engine";
import {
	buildCoverageLexicalPassageAdmissionSignal,
	compareCoverageLexicalPassageAdmissionSignals,
} from "./coverage-lexical-admission";
import {
	buildCoverageLexicalCharQuery,
	evaluateCoverageLexicalTagFallback,
	type CoverageLexicalCharQuery,
} from "./coverage-lexical-cjk";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalMetadataField,
	CoverageLexicalPhraseSignature,
	CoverageLexicalPlan,
	CoverageLexicalRecallDebug,
	CoverageLexicalRecallLaneDebug,
} from "./coverage-lexical-types";

type CoverageLexicalPostingList = ReadonlySet<string> | readonly number[];
type CoverageLexicalPostingMap = ReadonlyMap<string, CoverageLexicalPostingList>;
type CoverageLexicalCandidateKey = number;

type CoverageLexicalRecallIndex = {
	bodyPostings: CoverageLexicalPostingMap;
	bodyCharPostings: CoverageLexicalPostingMap;
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
	metadataPostings: CoverageLexicalPostingMap;
	bodyPhrasePostings: CoverageLexicalPostingMap;
	metadataTagCharPostings: CoverageLexicalPostingMap;
	metadataTagFullPostings: CoverageLexicalPostingMap;
	metadataTagPhrasePostings: CoverageLexicalPostingMap;
	metadataTagPostings: CoverageLexicalPostingMap;
	sortedLexicon: readonly string[];
	documentIdByPath: ReadonlyMap<string, number>;
	documentPathById: readonly (string | undefined)[];
	documentBodyTokensById: readonly (readonly string[] | undefined)[];
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

type CoverageLexicalRecallDebugAccumulator = {
	lanes: Map<CoverageLexicalLaneName, CoverageLexicalRecallLaneDebug>;
};

type CoverageLexicalQueryCache = {
	tagFallbackByDocId: Map<
		number,
		ReturnType<typeof evaluateCoverageLexicalTagFallback>
	>;
};

type CoverageLexicalGroupSignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
	tailWeight: number;
};

type CoverageLexicalCheapLaneSignal = {
	hardAnchorMetadata: CoverageLexicalGroupSignal;
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

type CoverageLexicalCheapLaneCandidate = {
	key: CoverageLexicalCandidateKey;
	state: CoverageLexicalCandidateState;
	signal: CoverageLexicalCheapLaneSignal;
};

type CoverageLexicalLaneEvaluation = {
	key: CoverageLexicalCandidateKey;
	state: CoverageLexicalCandidateState;
	hardAnchorMetadata: CoverageLexicalGroupSignal;
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

const MAX_PREFIX_EXPANSIONS = 48;
const MAX_FUZZY_EXPANSIONS = 24;

function createRecallDebugAccumulator(): CoverageLexicalRecallDebugAccumulator {
	return {
		lanes: new Map(),
	};
}

function createCoverageLexicalQueryCache(): CoverageLexicalQueryCache {
	return {
		tagFallbackByDocId: new Map(),
	};
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
): Map<number, CoverageLexicalCandidateState> {
	return collectCoverageLexicalCandidateStatesInternal(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		null,
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
	);

	const admittedCandidates = new Map<number, CoverageLexicalCandidateState>();
	for (const key of admittedKeys) {
		const state = aggregateCandidates.get(key);
		if (!state) {
			continue;
		}
		mergeCandidateStateInto(admittedCandidates, key, state);
	}
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
): void {
	if (plan.hardAnchorFamilies.length === 0) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	const anchorFamilies = [
		...plan.hardAnchorFamilies,
		...plan.optionalFamilies.filter((family) => family.role === "anchor"),
	];
	collectFamilySetCandidates(index, laneCandidates, anchorFamilies, {
		scope: "metadata-only",
		includePrefix: request.isPrefixMatch,
		includeFuzzy: false,
	});
	collectPhraseCandidates(
		index,
		laneCandidates,
		phraseSignatures,
		new Set(anchorFamilies.map((family) => family.index)),
		"metadata-only",
		{
			structuredOnly: false,
			allowPreferredFields: true,
		},
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
): void {
	if (
		plan.hardAnchorFamilies.length === 0 ||
		plan.decisiveBodyFamilies.length === 0
	) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectFamilySetCandidates(index, laneCandidates, plan.hardAnchorFamilies, {
		scope: "metadata-only",
		includePrefix: request.isPrefixMatch,
		includeFuzzy: false,
	});
	collectFamilySetCandidates(
		index,
		laneCandidates,
		[
			...plan.decisiveBodyFamilies,
			...plan.supportBodyFamilies,
		],
		{
			scope: "body-only",
			includePrefix: request.isPrefixMatch,
			includeFuzzy: request.isFuzzy,
		},
	);
	collectPhraseCandidates(
		index,
		laneCandidates,
		phraseSignatures,
		new Set(
			[...plan.hardAnchorFamilies, ...plan.decisiveBodyFamilies, ...plan.supportBodyFamilies].map(
				(family) => family.index,
			),
		),
		"all",
		{
			structuredOnly: false,
			allowPreferredFields: true,
		},
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
): void {
	if (
		plan.hardAnchorFamilies.length === 0 ||
		plan.relaxedMinimumMatchCount <= 0
	) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectFamilySetCandidates(index, laneCandidates, plan.hardAnchorFamilies, {
		scope: "metadata-only",
		includePrefix: request.isPrefixMatch,
		includeFuzzy: false,
	});
	collectFamilySetCandidates(
		index,
		laneCandidates,
		[
			...plan.decisiveBodyFamilies,
			...plan.supportBodyFamilies,
			...plan.optionalFamilies.filter((family) => family.role === "body"),
		],
		{
			scope: "body-only",
			includePrefix: request.isPrefixMatch,
			includeFuzzy: request.isFuzzy,
		},
	);
	collectPhraseCandidates(
		index,
		laneCandidates,
		phraseSignatures,
		new Set(
			[
				...plan.hardAnchorFamilies,
				...plan.decisiveBodyFamilies,
				...plan.supportBodyFamilies,
				...plan.optionalFamilies,
			].map((family) => family.index),
		),
		"all",
		{
			structuredOnly: false,
			allowPreferredFields: true,
		},
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
): void {
	const localBodyFamilies = [
		...plan.decisiveBodyFamilies,
		...plan.supportBodyFamilies,
		...plan.optionalFamilies.filter((family) => family.role === "body"),
	];
	if (localBodyFamilies.length === 0) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectFamilySetCandidates(index, laneCandidates, localBodyFamilies, {
		scope: "body-only",
		includePrefix: request.isPrefixMatch,
		includeFuzzy: request.isFuzzy,
	});
	collectPhraseCandidates(
		index,
		laneCandidates,
		phraseSignatures,
		new Set(localBodyFamilies.map((family) => family.index)),
		"body-only",
		{
			structuredOnly: false,
			allowPreferredFields: false,
		},
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
): void {
	if (plan.bridgeFamilies.length === 0) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectFamilySetCandidates(
		index,
		laneCandidates,
		[
			...plan.bridgeFamilies,
			...plan.hardAnchorFamilies,
			...plan.decisiveBodyFamilies,
		],
		{
			scope: "all",
			includePrefix: request.isPrefixMatch,
			includeFuzzy: request.isFuzzy,
		},
	);
	collectPhraseCandidates(
		index,
		laneCandidates,
		phraseSignatures,
		new Set(
			[
				...plan.bridgeFamilies,
				...plan.hardAnchorFamilies,
				...plan.decisiveBodyFamilies,
			].map((family) => family.index),
		),
		"all",
		{
			structuredOnly: false,
			allowPreferredFields: true,
		},
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
): void {
	if (charQuery.hanSegments.length === 0) {
		return;
	}
	const laneCandidates = new Map<
		CoverageLexicalCandidateKey,
		CoverageLexicalCandidateState
	>();
	collectCharCandidates(
		index,
		index.bodyCharPostings,
		charQuery.terms,
		laneCandidates,
		"body",
	);
	for (const postings of [
		index.metadataBasenameCharPostings,
		index.metadataAliasCharPostings,
		index.metadataFolderCharPostings,
		index.metadataHeadingCharPostings,
	]) {
		collectCharCandidates(index, postings, charQuery.terms, laneCandidates, "metadata");
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
): void {
	if (laneCandidates.size === 0) {
		recordLaneDebug(debug, laneName, 0, [], [], []);
		return;
	}
	for (const [key, state] of laneCandidates) {
		mergeCandidateStateInto(aggregateCandidates, key, state);
	}

	const budget = computeLaneBudget(laneName, plan, request);
	const preselected = preselectLaneCandidates(
		laneName,
		laneCandidates,
		index,
		plan,
		request,
	);
	const evaluations = preselected
		.map(([key, state]) =>
			buildLaneEvaluation(
				key,
				state,
				plan,
				phraseSignatures,
				index,
				charQuery,
				queryCache,
			),
		)
		.filter((evaluation): evaluation is CoverageLexicalLaneEvaluation => evaluation !== null)
		.filter((evaluation) => acceptsLaneCandidate(laneName, evaluation, plan, charQuery))
		.sort((left, right) => compareLaneEvaluations(laneName, left, right, plan));
	const admitted = evaluations.slice(0, budget);
	for (const evaluation of admitted) {
		admittedKeys.add(evaluation.key);
	}
	recordLaneDebug(
		debug,
		laneName,
		laneCandidates.size,
		mapCandidateKeysToPaths(index, laneCandidates.keys()),
		preselected
			.map(([key]) => resolveCandidatePath(index, key))
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
): Array<[CoverageLexicalCandidateKey, CoverageLexicalCandidateState]> {
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
		return entries.map(({ key, state }) => [key, state]);
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
	return selected.map(({ key, state }) => [key, state]);
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
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount)
			);
		case "bridge_lane":
			return (
				compareGroupSignals(left.bridgeSignal, right.bridgeSignal) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
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
	return {
		hardAnchorMetadata: buildGroupSignal(
			state.metadataMatches,
			plan.hardAnchorFamilies,
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
			plan.optionalFamilies.filter((family) => family.role === "body"),
		),
		bridgeSignal: buildGroupSignal(
			mergeMatchMaps(state.bodyMatches, state.metadataMatches),
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
	key: CoverageLexicalCandidateKey,
	state: CoverageLexicalCandidateState,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
): CoverageLexicalLaneEvaluation | null {
	const phraseMatchCount = state.phraseMatches.length;
	const phraseMatchWeight = state.phraseMatches.reduce(
		(total, signatureIndex) =>
			total + (phraseSignatures[signatureIndex]?.tailWeight ?? 0),
		0,
	);
	const tokens = index.documentBodyTokensById[key] ?? [];
	const tagFallback = getOrCreateTagFallback(key, index, charQuery, queryCache);
	return {
		key,
		state,
		hardAnchorMetadata: buildGroupSignal(
			state.metadataMatches,
			plan.hardAnchorFamilies,
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
			plan.optionalFamilies.filter((family) => family.role === "body"),
		),
		bridgeSignal: buildGroupSignal(
			mergeMatchMaps(state.bodyMatches, state.metadataMatches),
			plan.bridgeFamilies,
		),
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
		passageSignal: buildCoverageLexicalPassageAdmissionSignal(
			tokens,
			plan.families,
			state,
			phraseSignatures,
		),
	};
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
					Math.max(1, plan.relaxedMinimumMatchCount || 1)
			);
		case "bridge_lane":
			return (
				evaluation.bridgeSignal.coverageCount >= 1 ||
				evaluation.phraseMatchCount >= 1
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
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				left.key - right.key
			);
		case "bridge_lane":
			return (
				compareGroupSignals(left.bridgeSignal, right.bridgeSignal) ||
				compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
				compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
				compareGroupSignals(left.hardAnchorMetadata, right.hardAnchorMetadata) ||
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
		const kind = getRecordedMatchKind(matches, family.index);
		if (!kind) {
			continue;
		}
		const weight = computeTailWeight(family.index);
		coverageCount += 1;
		tailWeight += weight;
		if (kind === "exact") {
			exactWeight += weight;
			continue;
		}
		if (kind === "prefix") {
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

function mergeMatchMaps(
	left: readonly number[],
	right: readonly number[],
): number[] {
	const merged = left.slice();
	const limit = Math.max(left.length, right.length);
	for (let familyIndex = 0; familyIndex < limit; familyIndex += 1) {
		const kind = getRecordedMatchKind(right, familyIndex);
		if (!kind) {
			continue;
		}
		recordFamilyMatch(merged, familyIndex, kind);
	}
	return merged;
}

function collectFamilySetCandidates(
	index: CoverageLexicalRecallIndex,
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
		if (options.includePrefix && family.allowPrefix) {
			for (const term of expandPrefixTerms(index.sortedLexicon, family.normalizedTerm)) {
				if (term === family.normalizedTerm) {
					continue;
				}
				collectCandidatesForTerm(
					index,
					candidates,
					family.index,
					term,
					"prefix",
					options.scope,
				);
			}
		}
		if (options.includeFuzzy && family.allowFuzzy) {
			for (const term of expandFuzzyTerms(index.sortedLexicon, family.normalizedTerm)) {
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
			const state = getOrCreateCandidateState(candidates, key);
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
			const state = getOrCreateCandidateState(candidates, key);
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
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signatures: readonly CoverageLexicalPhraseSignature[],
	targetFamilyIndices: ReadonlySet<number>,
	scope: CoverageLexicalCollectionScope,
	options: {
		structuredOnly: boolean;
		allowPreferredFields: boolean;
	},
): void {
	for (const signature of signatures) {
		if (!overlapsTargetFamilies(signature, targetFamilyIndices)) {
			continue;
		}
		if (options.structuredOnly && !signature.preferredFields?.length) {
			continue;
		}
		if (!options.allowPreferredFields && signature.preferredFields?.length) {
			continue;
		}
		collectCandidatesForPhraseSignature(
			index,
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
): void {
	if (scope !== "metadata-only") {
		const bodyMatches = index.bodyPostings.get(term);
		if (bodyMatches) {
			forEachPostingCandidateKey(index, bodyMatches, (key) => {
				const state = getOrCreateCandidateState(candidates, key);
				recordFamilyMatch(state.bodyMatches, familyIndex, kind);
			});
		}
	}
	if (scope !== "body-only") {
		collectMetadataFieldCandidatesForTerm(
			index,
			candidates,
			familyIndex,
			term,
			kind,
		);
	}
}

function collectCandidatesForPhraseSignature(
	index: CoverageLexicalRecallIndex,
	candidates: Map<CoverageLexicalCandidateKey, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	scope: CoverageLexicalCollectionScope,
): void {
	for (const variant of signature.variants) {
		if (scope !== "metadata-only" && !signature.preferredFields?.length) {
			const bodyTokenMatches = index.bodyPostings.get(variant);
			if (bodyTokenMatches) {
				forEachPostingCandidateKey(index, bodyTokenMatches, (key) => {
					const state = getOrCreateCandidateState(candidates, key);
					recordPhraseMatch(state, signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					}
				});
			}
			const bodyPhraseMatches = index.bodyPhrasePostings.get(variant);
			if (bodyPhraseMatches) {
				forEachPostingCandidateKey(index, bodyPhraseMatches, (key) => {
					const state = getOrCreateCandidateState(candidates, key);
					recordPhraseMatch(state, signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					}
				});
			}
		}

		if (scope === "body-only") {
			continue;
		}

		if (!signature.preferredFields || signature.preferredFields.length === 0) {
			const metadataTokenMatches = index.metadataPostings.get(variant);
			if (metadataTokenMatches) {
				forEachPostingCandidateKey(index, metadataTokenMatches, (key) => {
					const state = getOrCreateCandidateState(candidates, key);
					recordPhraseMatch(state, signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
					}
				});
			}
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

function getOrCreateCandidateState<TKey extends CoverageLexicalCandidateKey>(
	candidates: Map<TKey, CoverageLexicalCandidateState>,
	key: TKey,
): CoverageLexicalCandidateState {
	let state = candidates.get(key);
	if (!state) {
		state = createEmptyCandidateState();
		candidates.set(key, state);
	}
	return state;
}

function mergeCandidateStateInto<TKey extends CoverageLexicalCandidateKey>(
	candidates: Map<TKey, CoverageLexicalCandidateState>,
	key: TKey,
	nextState: CoverageLexicalCandidateState,
): void {
	const target = getOrCreateCandidateState(candidates, key);
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
			const state = getOrCreateCandidateState(candidates, key);
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
		metadataMatches: [],
		metadataCharMatchIndices: [],
		metadataCharMatchFlags: [],
		metadataFieldMatches: createEmptyMetadataFieldMatches(),
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
): void {
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
			const state = getOrCreateCandidateState(candidates, key);
			recordFamilyMatch(state.metadataMatches, familyIndex, kind);
			recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, kind);
		});
	}
	const metadataMatches = index.metadataPostings.get(term);
	if (!metadataMatches) {
		return;
	}
	forEachPostingCandidateKey(index, metadataMatches, (key) => {
		const state = getOrCreateCandidateState(candidates, key);
		recordFamilyMatch(state.metadataMatches, familyIndex, kind);
	});
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
			const state = getOrCreateCandidateState(candidates, key);
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
	if (Array.isArray(postings)) {
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
		mergeCandidateStateInto(projected, path, state);
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
	sortedLexicon: readonly string[],
	prefix: string,
): string[] {
	const out: string[] = [];
	let index = lowerBoundString(sortedLexicon, prefix);
	while (index < sortedLexicon.length) {
		const term = sortedLexicon[index];
		if (!term.startsWith(prefix)) {
			break;
		}
		out.push(term);
		if (out.length >= MAX_PREFIX_EXPANSIONS) {
			break;
		}
		index += 1;
	}
	return out;
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
		if (values[mid].localeCompare(target) < 0) {
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
