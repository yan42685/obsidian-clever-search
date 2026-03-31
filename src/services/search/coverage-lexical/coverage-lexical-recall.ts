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
} from "./coverage-lexical-types";

type CoverageLexicalRecallIndex = {
	bodyPostings: ReadonlyMap<string, ReadonlySet<string>>;
	bodyCharPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataAliasCharPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataAliasPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataAliasPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataBasenameCharPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataBasenamePhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataBasenamePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataFolderCharPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataFolderPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataFolderPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataHeadingCharPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataHeadingPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataHeadingPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataPostings: ReadonlyMap<string, ReadonlySet<string>>;
	bodyPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataTagCharPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataTagFullPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataTagPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataTagPostings: ReadonlyMap<string, ReadonlySet<string>>;
	sortedLexicon: readonly string[];
	documentBodyTokensByPath: ReadonlyMap<string, readonly string[]>;
	documentTagValuesByPath: ReadonlyMap<string, readonly string[]>;
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
	lanes: Map<
		CoverageLexicalLaneName,
		{
			laneName: CoverageLexicalLaneName;
			candidateCount: number;
			admittedCount: number;
			admittedPaths: string[];
		}
	>;
};

type CoverageLexicalQueryCache = {
	tagFallbackByPath: Map<
		string,
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

type CoverageLexicalLaneEvaluation = {
	path: string;
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
		tagFallbackByPath: new Map(),
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
	const candidates = collectCoverageLexicalCandidateStatesInternal(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		debug,
	);
	return {
		candidates,
		debug: {
			lanes: Array.from(debug.lanes.values()),
			unionSize: candidates.size,
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
): Map<string, CoverageLexicalCandidateState> {
	const queryCache = createCoverageLexicalQueryCache();
	const aggregateCandidates = new Map<string, CoverageLexicalCandidateState>();
	const admittedPaths = new Set<string>();

	runStrictMetadataLane(
		index,
		plan,
		phraseSignatures,
		request,
		charQuery,
		queryCache,
		aggregateCandidates,
		admittedPaths,
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
		admittedPaths,
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
		admittedPaths,
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
		admittedPaths,
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
		admittedPaths,
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
		admittedPaths,
		debug,
	);

	const admittedCandidates = new Map<string, CoverageLexicalCandidateState>();
	for (const path of admittedPaths) {
		const state = aggregateCandidates.get(path);
		if (state) {
			admittedCandidates.set(path, state);
		}
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
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
): void {
	if (plan.hardAnchorFamilies.length === 0) {
		return;
	}
	const laneCandidates = new Map<string, CoverageLexicalCandidateState>();
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
		admittedPaths,
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
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
): void {
	if (
		plan.hardAnchorFamilies.length === 0 ||
		plan.decisiveBodyFamilies.length === 0
	) {
		return;
	}
	const laneCandidates = new Map<string, CoverageLexicalCandidateState>();
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
		admittedPaths,
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
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
): void {
	if (
		plan.hardAnchorFamilies.length === 0 ||
		plan.relaxedMinimumMatchCount <= 0
	) {
		return;
	}
	const laneCandidates = new Map<string, CoverageLexicalCandidateState>();
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
		admittedPaths,
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
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
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
	const laneCandidates = new Map<string, CoverageLexicalCandidateState>();
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
		admittedPaths,
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
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
): void {
	if (plan.bridgeFamilies.length === 0) {
		return;
	}
	const laneCandidates = new Map<string, CoverageLexicalCandidateState>();
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
		admittedPaths,
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
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
): void {
	if (charQuery.hanSegments.length === 0) {
		return;
	}
	const laneCandidates = new Map<string, CoverageLexicalCandidateState>();
	collectCharCandidates(index.bodyCharPostings, charQuery.terms, laneCandidates, "body");
	for (const postings of [
		index.metadataBasenameCharPostings,
		index.metadataAliasCharPostings,
		index.metadataFolderCharPostings,
		index.metadataHeadingCharPostings,
	]) {
		collectCharCandidates(postings, charQuery.terms, laneCandidates, "metadata");
	}
	collectTagExactCandidates(index.metadataTagFullPostings, charQuery.hanSegments, laneCandidates);
	collectCharCandidates(
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
		admittedPaths,
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
	laneCandidates: Map<string, CoverageLexicalCandidateState>,
	aggregateCandidates: Map<string, CoverageLexicalCandidateState>,
	admittedPaths: Set<string>,
	debug: CoverageLexicalRecallDebugAccumulator | null,
): void {
	if (laneCandidates.size === 0) {
		recordLaneDebug(debug, laneName, 0, [], [], []);
		return;
	}
	for (const [path, state] of laneCandidates) {
		mergeCandidateStateInto(aggregateCandidates, path, state);
	}

	const budget = computeLaneBudget(laneName, plan, request);
	const preselected = preselectLaneCandidates(
		laneName,
		laneCandidates,
		plan,
		request,
	);
	const evaluations = preselected
		.map(([path, state]) =>
			buildLaneEvaluation(
				path,
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
		admittedPaths.add(evaluation.path);
	}
	recordLaneDebug(
		debug,
		laneName,
		laneCandidates.size,
		Array.from(laneCandidates.keys()),
		preselected.map(([path]) => path),
		admitted.map((evaluation) => evaluation.path),
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
	laneCandidates: Map<string, CoverageLexicalCandidateState>,
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
): Array<[string, CoverageLexicalCandidateState]> {
	const entries = Array.from(laneCandidates.entries());
	const budget = computeLaneBudget(laneName, plan, request);
	const prefilterBudget = Math.min(
		entries.length,
		Math.max(budget * 6, request.maxItemResults * 8, 48),
	);
	if (entries.length <= prefilterBudget) {
		return entries;
	}
	return entries
		.sort(([leftPath, leftState], [rightPath, rightState]) =>
			compareCheapLaneCandidates(
				laneName,
				leftPath,
				leftState,
				rightPath,
				rightState,
				plan,
			),
		)
		.slice(0, prefilterBudget);
}

function compareCheapLaneCandidates(
	laneName: CoverageLexicalLaneName,
	leftPath: string,
	leftState: CoverageLexicalCandidateState,
	rightPath: string,
	rightState: CoverageLexicalCandidateState,
	plan: CoverageLexicalPlan,
): number {
	const leftHardAnchor = buildGroupSignal(
		leftState.metadataMatches,
		plan.hardAnchorFamilies,
	);
	const rightHardAnchor = buildGroupSignal(
		rightState.metadataMatches,
		plan.hardAnchorFamilies,
	);
	const leftDecisiveBody = buildGroupSignal(
		leftState.bodyMatches,
		plan.decisiveBodyFamilies,
	);
	const rightDecisiveBody = buildGroupSignal(
		rightState.bodyMatches,
		plan.decisiveBodyFamilies,
	);
	const leftSupportBody = buildGroupSignal(
		leftState.bodyMatches,
		plan.supportBodyFamilies,
	);
	const rightSupportBody = buildGroupSignal(
		rightState.bodyMatches,
		plan.supportBodyFamilies,
	);
	const leftOptionalBody = buildGroupSignal(
		leftState.bodyMatches,
		plan.optionalFamilies.filter((family) => family.role === "body"),
	);
	const rightOptionalBody = buildGroupSignal(
		rightState.bodyMatches,
		plan.optionalFamilies.filter((family) => family.role === "body"),
	);
	const leftBridge = buildGroupSignal(
		mergeMatchMaps(leftState.bodyMatches, leftState.metadataMatches),
		plan.bridgeFamilies,
	);
	const rightBridge = buildGroupSignal(
		mergeMatchMaps(rightState.bodyMatches, rightState.metadataMatches),
		plan.bridgeFamilies,
	);
	switch (laneName) {
		case "strict_metadata_lane":
			return (
				compareGroupSignals(leftHardAnchor, rightHardAnchor) ||
				compareDescendingMetric(
					leftState.phraseMatches.size,
					rightState.phraseMatches.size,
				) ||
				compareGroupSignals(leftBridge, rightBridge) ||
				leftPath.localeCompare(rightPath)
			);
		case "strict_hybrid_lane":
			return (
				compareGroupSignals(leftDecisiveBody, rightDecisiveBody) ||
				compareGroupSignals(leftHardAnchor, rightHardAnchor) ||
				compareGroupSignals(leftSupportBody, rightSupportBody) ||
				compareDescendingMetric(
					leftState.phraseMatches.size,
					rightState.phraseMatches.size,
				) ||
				leftPath.localeCompare(rightPath)
			);
		case "relaxed_hybrid_lane":
			return (
				compareDescendingMetric(
					leftDecisiveBody.coverageCount +
						leftSupportBody.coverageCount +
						leftOptionalBody.coverageCount,
					rightDecisiveBody.coverageCount +
						rightSupportBody.coverageCount +
						rightOptionalBody.coverageCount,
				) ||
				compareGroupSignals(leftDecisiveBody, rightDecisiveBody) ||
				compareGroupSignals(leftSupportBody, rightSupportBody) ||
				compareGroupSignals(leftHardAnchor, rightHardAnchor) ||
				compareDescendingMetric(
					leftState.phraseMatches.size,
					rightState.phraseMatches.size,
				) ||
				leftPath.localeCompare(rightPath)
			);
		case "local_body_lane":
			return (
				compareGroupSignals(leftDecisiveBody, rightDecisiveBody) ||
				compareGroupSignals(leftSupportBody, rightSupportBody) ||
				compareGroupSignals(leftOptionalBody, rightOptionalBody) ||
				compareDescendingMetric(
					leftState.phraseMatches.size,
					rightState.phraseMatches.size,
				) ||
				leftPath.localeCompare(rightPath)
			);
		case "bridge_lane":
			return (
				compareGroupSignals(leftBridge, rightBridge) ||
				compareDescendingMetric(
					leftState.phraseMatches.size,
					rightState.phraseMatches.size,
				) ||
				compareGroupSignals(leftHardAnchor, rightHardAnchor) ||
				compareGroupSignals(leftDecisiveBody, rightDecisiveBody) ||
				leftPath.localeCompare(rightPath)
			);
		case "char_fallback_lane":
			return (
				compareDescendingMetric(
					leftState.tagExactTerms.size,
					rightState.tagExactTerms.size,
				) ||
				compareDescendingMetric(
					leftState.tagCharTerms.size,
					rightState.tagCharTerms.size,
				) ||
				compareDescendingMetric(
					leftState.metadataCharTerms.size,
					rightState.metadataCharTerms.size,
				) ||
				compareDescendingMetric(
					leftState.bodyCharTerms.size,
					rightState.bodyCharTerms.size,
				) ||
				leftPath.localeCompare(rightPath)
			);
		default:
			return leftPath.localeCompare(rightPath);
	}
}

function buildLaneEvaluation(
	path: string,
	state: CoverageLexicalCandidateState,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
): CoverageLexicalLaneEvaluation | null {
	const phraseMatchCount = state.phraseMatches.size;
	const phraseMatchWeight = Array.from(state.phraseMatches).reduce(
		(total, signatureIndex) =>
			total + (phraseSignatures[signatureIndex]?.tailWeight ?? 0),
		0,
	);
	const tokens = index.documentBodyTokensByPath.get(path) ?? [];
	const tagFallback = getOrCreateTagFallback(path, index, charQuery, queryCache);
	return {
		path,
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
		bodyCharMatchCount: state.bodyCharTerms.size,
		bodyCharMatchRatio: computeCharMatchRatio(
			state.bodyCharTerms.size,
			charQuery.terms.length,
		),
		metadataCharMatchCount: state.metadataCharTerms.size,
		metadataCharMatchRatio: computeCharMatchRatio(
			state.metadataCharTerms.size,
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
	path: string,
	index: CoverageLexicalRecallIndex,
	charQuery: CoverageLexicalCharQuery,
	queryCache: CoverageLexicalQueryCache,
): ReturnType<typeof evaluateCoverageLexicalTagFallback> {
	const cached = queryCache.tagFallbackByPath.get(path);
	if (cached) {
		return cached;
	}
	const created = evaluateCoverageLexicalTagFallback(
		index.documentTagValuesByPath?.get(path) ?? [],
		charQuery,
	);
	queryCache.tagFallbackByPath.set(path, created);
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
				left.path.localeCompare(right.path)
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
				left.path.localeCompare(right.path)
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
				left.path.localeCompare(right.path)
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
				left.path.localeCompare(right.path)
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
				left.path.localeCompare(right.path)
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
				left.path.localeCompare(right.path)
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
	matches: ReadonlyMap<number, CoverageFamilyMatchKind>,
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalGroupSignal {
	let coverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let tailWeight = 0;
	for (const family of families) {
		const kind = matches.get(family.index) ?? null;
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
	left: ReadonlyMap<number, CoverageFamilyMatchKind>,
	right: ReadonlyMap<number, CoverageFamilyMatchKind>,
): Map<number, CoverageFamilyMatchKind> {
	const merged = new Map<number, CoverageFamilyMatchKind>();
	for (const [familyIndex, kind] of left) {
		merged.set(familyIndex, kind);
	}
	for (const [familyIndex, kind] of right) {
		if (!kind) {
			continue;
		}
		recordFamilyMatch(merged, familyIndex, kind);
	}
	return merged;
}

function collectFamilySetCandidates(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
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
	postingsByTerm: ReadonlyMap<string, ReadonlySet<string>> | undefined,
	queryTerms: readonly string[],
	candidates: Map<string, CoverageLexicalCandidateState>,
	target: "body" | "metadata" | "tag",
): void {
	if (!postingsByTerm) {
		return;
	}
	for (const term of queryTerms) {
		const matches = postingsByTerm.get(term);
		if (!matches) {
			continue;
		}
		for (const path of matches) {
			const state = getOrCreateCandidateState(candidates, path);
			if (target === "body") {
				state.bodyCharTerms.add(term);
				continue;
			}
			if (target === "metadata") {
				state.metadataCharTerms.add(term);
				continue;
			}
			state.tagCharTerms.add(term);
		}
	}
}

function collectTagExactCandidates(
	postingsByTag: ReadonlyMap<string, ReadonlySet<string>> | undefined,
	querySegments: readonly string[],
	candidates: Map<string, CoverageLexicalCandidateState>,
): void {
	if (!postingsByTag) {
		return;
	}
	for (const term of querySegments) {
		const matches = postingsByTag.get(term);
		if (!matches) {
			continue;
		}
		for (const path of matches) {
			const state = getOrCreateCandidateState(candidates, path);
			state.tagExactTerms.add(term);
		}
	}
}

function collectPhraseCandidates(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
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
	candidates: Map<string, CoverageLexicalCandidateState>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
	scope: CoverageLexicalCollectionScope,
): void {
	if (scope !== "metadata-only") {
		const bodyMatches = index.bodyPostings.get(term);
		if (bodyMatches) {
			for (const path of bodyMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				recordFamilyMatch(state.bodyMatches, familyIndex, kind);
			}
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
	candidates: Map<string, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	scope: CoverageLexicalCollectionScope,
): void {
	for (const variant of signature.variants) {
		if (scope !== "metadata-only" && !signature.preferredFields?.length) {
			const bodyTokenMatches = index.bodyPostings.get(variant);
			if (bodyTokenMatches) {
				for (const path of bodyTokenMatches) {
					const state = getOrCreateCandidateState(candidates, path);
					state.phraseMatches.add(signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					}
				}
			}
			const bodyPhraseMatches = index.bodyPhrasePostings.get(variant);
			if (bodyPhraseMatches) {
				for (const path of bodyPhraseMatches) {
					const state = getOrCreateCandidateState(candidates, path);
					state.phraseMatches.add(signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					}
				}
			}
		}

		if (scope === "body-only") {
			continue;
		}

		if (!signature.preferredFields || signature.preferredFields.length === 0) {
			const metadataTokenMatches = index.metadataPostings.get(variant);
			if (metadataTokenMatches) {
				for (const path of metadataTokenMatches) {
					const state = getOrCreateCandidateState(candidates, path);
					state.phraseMatches.add(signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
					}
				}
			}
			const metadataPhraseMatches = index.metadataPhrasePostings.get(variant);
			if (metadataPhraseMatches) {
				for (const path of metadataPhraseMatches) {
					const state = getOrCreateCandidateState(candidates, path);
					state.phraseMatches.add(signature.index);
					for (const familyIndex of signature.familyIndices) {
						recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
					}
				}
			}
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

function getOrCreateCandidateState(
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

function mergeCandidateStateInto(
	candidates: Map<string, CoverageLexicalCandidateState>,
	path: string,
	nextState: CoverageLexicalCandidateState,
): void {
	const target = getOrCreateCandidateState(candidates, path);
	for (const [familyIndex, kind] of nextState.bodyMatches) {
		if (!kind) {
			continue;
		}
		recordFamilyMatch(target.bodyMatches, familyIndex, kind);
	}
	for (const [familyIndex, kind] of nextState.metadataMatches) {
		if (!kind) {
			continue;
		}
		recordFamilyMatch(target.metadataMatches, familyIndex, kind);
	}
	for (const field of Object.keys(
		nextState.metadataFieldMatches,
	) as CoverageLexicalMetadataField[]) {
		for (const [familyIndex, kind] of nextState.metadataFieldMatches[field]) {
			if (!kind) {
				continue;
			}
			recordFamilyMatch(target.metadataFieldMatches[field], familyIndex, kind);
		}
	}
	for (const phraseMatch of nextState.phraseMatches) {
		target.phraseMatches.add(phraseMatch);
	}
	for (const term of nextState.bodyCharTerms) {
		target.bodyCharTerms.add(term);
	}
	for (const term of nextState.metadataCharTerms) {
		target.metadataCharTerms.add(term);
	}
	for (const term of nextState.tagExactTerms) {
		target.tagExactTerms.add(term);
	}
	for (const term of nextState.tagCharTerms) {
		target.tagCharTerms.add(term);
	}
}

function createEmptyCandidateState(): CoverageLexicalCandidateState {
	return {
		bodyMatches: new Map(),
		bodyCharTerms: new Set(),
		metadataMatches: new Map(),
		metadataCharTerms: new Set(),
		metadataFieldMatches: createEmptyMetadataFieldMatches(),
		phraseMatches: new Set(),
		tagCharTerms: new Set(),
		tagExactTerms: new Set(),
	};
}

function collectMetadataFieldCandidatesForTerm(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const fieldEntries: Array<
		[
			CoverageLexicalMetadataField,
			ReadonlyMap<string, ReadonlySet<string>>,
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
		for (const path of matches) {
			const state = getOrCreateCandidateState(candidates, path);
			recordFamilyMatch(state.metadataMatches, familyIndex, kind);
			recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, kind);
		}
	}
	const metadataMatches = index.metadataPostings.get(term);
	if (!metadataMatches) {
		return;
	}
	for (const path of metadataMatches) {
		const state = getOrCreateCandidateState(candidates, path);
		recordFamilyMatch(state.metadataMatches, familyIndex, kind);
	}
}

function collectPreferredMetadataPhraseMatches(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
	signature: CoverageLexicalPhraseSignature,
	variant: string,
): void {
	const fieldPhraseEntries: Array<
		[
			CoverageLexicalMetadataField,
			ReadonlyMap<string, ReadonlySet<string>>,
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
		for (const path of matches) {
			const state = getOrCreateCandidateState(candidates, path);
			state.phraseMatches.add(signature.index);
			for (const familyIndex of signature.familyIndices) {
				recordFamilyMatch(state.metadataMatches, familyIndex, "exact");
				recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, "exact");
			}
		}
	}
}

function recordFamilyMatch(
	matches: Map<number, CoverageFamilyMatchKind>,
	familyIndex: number,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const previous = matches.get(familyIndex) ?? null;
	if (pickBetterMatchKind(previous, kind) === previous) {
		return;
	}
	matches.set(familyIndex, kind);
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
		basename: new Map(),
		aliases: new Map(),
		folder: new Map(),
		headings: new Map(),
		tags: new Map(),
	};
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
