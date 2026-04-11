import type {
	MatchedFile,
} from "src/globals/search-types";
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
	compareCoverageLexicalV2FieldProfiles,
	compareCoverageLexicalV2OptionalPrimaryUnitProximity,
	compareCoverageLexicalV2PrimaryUnitMatchQuality,
	compareCoverageLexicalV2SurfaceCoverageShapes,
	patchCoverageLexicalV2ComparatorCandidateWithProximity,
	selectCoverageLexicalV2ComparatorTopTieBand,
	type CoverageLexicalV2MatchField,
	type CoverageLexicalV2MatchQualityKind,
	type CoverageLexicalV2MatchedPrimaryUnitEvidence,
	type CoverageLexicalV2ComparatorCandidate,
	type CoverageLexicalV2ComparatorEvidence,
	type CoverageLexicalV2ComparatorRunCandidate,
} from "../comparator";
import type {
	CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	CoverageLexicalV2PrimaryUnitMatchQuality,
	CoverageLexicalV2SurfaceCoverageShape,
} from "../comparator";
import type {
	CoverageLexicalV2CandidateCascadeDocumentRecord,
	CoverageLexicalV2CandidateCascadeMetadataVerificationTexts,
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2CandidateCascadeStorageReader,
} from "./coverage-lexical-candidate-types";
import {
	buildCoverageLexicalV2CandidateCascadeBestWindowForDocument,
	buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits,
	type CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	type CoverageLexicalV2CandidateCascadeFieldTerms,
	type CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
} from "./coverage-lexical-candidate-evidence";
import {
	compareCoverageLexicalV2MatchQuality,
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	isCoverageLexicalV2LatinCandidateCascadeTerm,
	normalizeCoverageLexicalV2CandidateCascadeTerm,
	type CoverageLexicalV2CandidateCascadeMatchOptions,
} from "./coverage-lexical-candidate-match";
import { extractHanSegments } from "../../coverage-lexical/coverage-lexical-cjk";

type CoverageLexicalV2CascadeCandidateFieldTermSets = {
	basenameTerms: Set<string>;
	aliasTerms: Set<string>;
	headingsTerms: Set<string>;
	folderTerms: Set<string>;
	tagTerms: Set<string>;
	bodyTerms: Set<string>;
};

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
};

export type CoverageLexicalV2CandidateCascadeLayerMode =
	| "normal"
	| "fuzzy_salvage"
	| "han_fallback_salvage";

export type CoverageLexicalV2CandidateCascadeVerificationSkippedReason =
	| "none"
	| "overflow"
	| "no_verification_candidates";

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
};

export type CoverageLexicalV2CandidateCascadeRequest = {
	queryText: string;
	queryTerms: readonly string[];
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	maxItemResults: number;
	storageReader: CoverageLexicalV2CandidateCascadeStorageReader;
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions;
};

export type CoverageLexicalV2CandidateCascadeTrace = {
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode;
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

type CoverageLexicalV2HanBackstopGateStats = {
	longestContiguousBigramChain: number;
	matchedBigramCount: number;
	bigramCoverageRatio: number;
};

type CoverageLexicalV2HanBackstopRankedCandidate = {
	docId: number;
	stableDeterministicKey: string;
	stats: CoverageLexicalV2HanBackstopGateStats;
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

export function resolveCoverageLexicalV2CandidateCascadePolicy(
	maxItemResults: number,
): CoverageLexicalV2CandidateCascadePolicy {
	const safeMaxItemResults = Math.max(0, maxItemResults);
	const frontierTarget = Math.min(96, Math.max(24, safeMaxItemResults * 3));
	const returnTarget = safeMaxItemResults + 4;
	return {
		frontierTarget,
		returnTarget,
		proximityOverflowCap: Math.min(20, Math.max(12, returnTarget + 2)),
		prefixTermCapPerUnit: 32,
		prefixDocCapPerQuery: frontierTarget * 8,
		fuzzyTermCapPerUnit: 16,
		fuzzyDocCapPerQuery: frontierTarget * 4,
		hanBackstopDocCapPerGroup: Math.min(frontierTarget, Math.max(returnTarget, 8)),
		hanBackstopDocCapPerQuery: frontierTarget,
	};
}

export async function searchCoverageLexicalV2CandidateCascade(
	request: CoverageLexicalV2CandidateCascadeRequest,
): Promise<CoverageLexicalV2CandidateCascadeResult> {
	const policy = resolveCoverageLexicalV2CandidateCascadePolicy(request.maxItemResults);
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
	const candidateStates = sourceCoverageLexicalV2CascadeCandidates(
		request.queryAnalysis,
		lexicalPrimaryUnits,
		candidateCascadePrimaryUnits,
		request.storageReader,
		request.matchOptions,
		policy,
	);
	if (candidateStates.length === 0) {
		const emptyTrace = createCoverageLexicalV2CandidateCascadeTrace("normal");
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
	trace.retainedCandidateIdsByLayer.layer1 = frontierPlan.activeFrontier.map((candidateState) =>
		String(candidateState.docId),
	);
	trace.deferredCandidateIdsByLayer.layer1 = frontierPlan.deferredBuckets
		.flat()
		.map((candidateState) => String(candidateState.docId));
	trace.usedFuzzySalvage = frontierPlan.usedFuzzySalvage;
	trace.usedHanFallbackSalvage = frontierPlan.usedHanFallbackSalvage;
	if (frontierPlan.activeFrontier.length === 0) {
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
	const candidateStateById = new Map<string, CoverageLexicalV2CascadeCandidateState>(
		candidateStates.map((candidateState) => [String(candidateState.docId), candidateState]),
	);
	if (frontierPlan.layerMode === "han_fallback_salvage") {
		const rankedCandidates = [...frontierPlan.activeFrontier].sort((left, right) => {
			if (left.hanFallbackSalvageGroupCount !== right.hanFallbackSalvageGroupCount) {
				return right.hanFallbackSalvageGroupCount - left.hanFallbackSalvageGroupCount;
			}
			return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
		});
		const visibleCandidates = rankedCandidates.slice(0, request.maxItemResults);
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

	const evidenceByCandidateId = new Map<string, CoverageLexicalV2ComparatorEvidence>();
	const cheapComparatorCandidateById = new Map<string, CoverageLexicalV2ComparatorCandidate>();
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
		);
		await populateCoverageLexicalV2CandidateCascadeEvidence(
			evidenceByCandidateId,
			verificationStates,
			request.queryAnalysis,
			candidateCascadePrimaryUnits,
			request.storageReader,
			request.matchOptions,
			true,
		);
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
	const layerMode: CoverageLexicalV2CandidateCascadeLayerMode = usedHanFallbackSalvage
		? "han_fallback_salvage"
		: usedFuzzySalvage
			? "fuzzy_salvage"
			: "normal";
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
		usedFuzzySalvage,
		usedHanFallbackSalvage,
		layerMode,
	};
}

function createCoverageLexicalV2CandidateCascadeTrace(
	layerMode: CoverageLexicalV2CandidateCascadeLayerMode,
): CoverageLexicalV2CandidateCascadeTrace {
	return {
		layerMode,
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
		usedFuzzySalvage: false,
		usedHanFallbackSalvage: false,
	};
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
	if (surfaceComparison !== 0 || layerName === "layer2") {
		return surfaceComparison !== 0
			? surfaceComparison
			: left.candidateState.stableDeterministicKey.localeCompare(
				right.candidateState.stableDeterministicKey,
			);
	}
	const fieldComparison = compareCoverageLexicalV2FieldProfiles(
		left.comparatorCandidate.matchedPrimaryUnitFieldProfile,
		right.comparatorCandidate.matchedPrimaryUnitFieldProfile,
	);
	if (fieldComparison !== 0 || layerName === "layer3") {
		return fieldComparison !== 0
			? fieldComparison
			: left.candidateState.stableDeterministicKey.localeCompare(
				right.candidateState.stableDeterministicKey,
			);
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
	const segments = [String(entry.layer1Score), serializeCoverageLexicalV2SurfaceCoverageShape(entry.comparatorCandidate.surfaceCoverageShape)];
	if (layerName === "layer2") {
		return segments.join("|");
	}
	segments.push(
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

function sourceCoverageLexicalV2CascadeCandidates(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	lexicalPrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions,
	policy: CoverageLexicalV2CandidateCascadePolicy,
): CoverageLexicalV2CascadeCandidateState[] {
	const candidateStateByDocId = new Map<number, CoverageLexicalV2CascadeCandidateState>();
	const sortedLexicon = reader.getSortedLexicon();
	const prefixDocIds = new Set<number>();
	const fuzzyDocIds = new Set<number>();
	const hanBackstopDocIds = new Set<number>();
	const primaryUnitIndexByKey = new Map<string, number>(
		candidateCascadePrimaryUnits.map((primaryUnit, primaryUnitIndex) => [
			createCoverageLexicalV2CascadePrimaryUnitKey(
				primaryUnit.surfaceGroupIndex,
				primaryUnit.normalizedText,
			),
			primaryUnitIndex,
		] as const),
	);

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		collectCoverageLexicalV2CascadeExactMatches(
			candidateStateByDocId,
			primaryUnit,
			primaryUnitIndex,
			reader,
		);
	});

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (!matchOptions.includePrefix || !isCoverageLexicalV2LatinCandidateCascadeTerm(primaryUnit.normalizedText)) {
			return;
		}
		const prefixTerms = collectCoverageLexicalV2CascadePrefixTerms(
			primaryUnit.normalizedText,
			sortedLexicon,
			matchOptions,
			policy.prefixTermCapPerUnit,
		);
		for (const prefixTerm of prefixTerms) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				reader,
				prefixDocIds,
				policy.prefixDocCapPerQuery,
			);
		}
	});

	collectCoverageLexicalV2CascadeHanBackstopMatches(
		candidateStateByDocId,
		queryAnalysis,
		candidateCascadePrimaryUnits,
		primaryUnitIndexByKey,
		reader,
		hanBackstopDocIds,
		policy,
	);

	lexicalPrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (!matchOptions.includeFuzzy || !isCoverageLexicalV2LatinCandidateCascadeTerm(primaryUnit.normalizedText)) {
			return;
		}
		const fuzzyTerms = collectCoverageLexicalV2CascadeFuzzyTerms(
			primaryUnit.normalizedText,
			sortedLexicon,
			matchOptions,
			policy.fuzzyTermCapPerUnit,
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

	return [...candidateStateByDocId.values()]
		.map((candidateState) => finalizeCoverageLexicalV2CascadeCandidateState(candidateState))
		.sort((left, right) =>
			left.stableDeterministicKey.localeCompare(right.stableDeterministicKey),
		);
}

async function populateCoverageLexicalV2CandidateCascadeEvidence(
	target: Map<string, CoverageLexicalV2ComparatorEvidence>,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions,
	includeBodyTokenSequences: boolean,
): Promise<void> {
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
			documentState.fieldTerms,
			matchOptions,
		);
		if (matchedPrimaryUnits.length === 0) {
			continue;
		}
		target.set(candidateId, {
			candidateId,
			stableDeterministicKey: candidateState.stableDeterministicKey,
			matchedPrimaryUnits,
			bestWindow: buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
				matchedPrimaryUnits,
				documentState,
			),
		});
	}
}

async function hydrateCoverageLexicalV2CascadeVerificationStates(
	verificationStates: readonly CoverageLexicalV2CascadeCandidateState[],
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): Promise<void> {
	const docIds = verificationStates
		.filter((candidateState) => candidateState.hydrationStatus !== "prefetched")
		.map((candidateState) => candidateState.docId);
	if (docIds.length === 0) {
		return;
	}
	await reader.prefetchBodyTokenSequences(docIds);
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
		fieldTerms: toCoverageLexicalV2CandidateCascadeFieldTerms(candidateState.fieldTerms),
		basenameTokenSequence: candidateState.exactQueryTerms.basenameExactQueryTerms.size > 0
			? tokenizeCoverageLexicalV2CandidateCascadeText(reader, candidateState.record.basenameText)
			: undefined,
		aliasTokenSequence: candidateState.exactQueryTerms.aliasExactQueryTerms.size > 0
			? tokenizeCoverageLexicalV2CandidateCascadeText(reader, candidateState.record.aliasesText)
			: undefined,
		headingsTokenSequence: candidateState.exactQueryTerms.headingsExactQueryTerms.size > 0
			? tokenizeCoverageLexicalV2CandidateCascadeText(reader, candidateState.record.headingsText)
			: undefined,
		bodyTokenSequence:
			includeBodyTokenSequences &&
			candidateState.exactQueryTerms.bodyExactQueryTerms.size > 0
				? [...(candidateState.prefetchedBodyTokenSequence ??
						reader.getBodyTokenSequence(candidateState.docId) ??
						[])]
				: undefined,
	};
}

function collectCoverageLexicalV2CascadeExactMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): void {
	for (const field of SOURCE_FIELDS) {
		const postings = reader.getPostingMatches(field, primaryUnit.normalizedText);
		collectCoverageLexicalV2CascadePostingMatches(
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
	}
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
): void {
	for (const field of SOURCE_FIELDS) {
		const postings = reader.getPostingMatches(field, candidateTerm);
		collectCoverageLexicalV2CascadePostingMatches(
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
	}
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

function collectCoverageLexicalV2CascadeHanBackstopMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateCascadePrimaryUnits: readonly CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[],
	primaryUnitIndexByKey: ReadonlyMap<string, number>,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
	hanBackstopDocIds: Set<number>,
	policy: CoverageLexicalV2CandidateCascadePolicy,
): void {
	for (const hanBackstopGroup of queryAnalysis.hanBackstopGroups) {
		if (
			!shouldActivateCoverageLexicalV2HanBackstopGroup(
				hanBackstopGroup,
				target,
			)
		) {
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
		const primaryUnit = candidateCascadePrimaryUnits[primaryUnitIndex];
		if (!primaryUnit) {
			continue;
		}
		const rankedCandidates = rankCoverageLexicalV2HanBackstopCandidates(
			hanBackstopGroup,
			reader,
		).slice(0, policy.hanBackstopDocCapPerGroup);
		for (const rankedCandidate of rankedCandidates) {
			const verifiedFields = verifyCoverageLexicalV2HanBackstopCandidate(
				rankedCandidate.docId,
				hanBackstopGroup,
				reader,
			);
			if (verifiedFields.length === 0) {
				continue;
			}
			const candidateState = getOrCreateCoverageLexicalV2CascadeCandidateState(
				target,
				rankedCandidate.docId,
				reader,
				hanBackstopDocIds,
				policy.hanBackstopDocCapPerQuery,
			);
			if (!candidateState) {
				continue;
			}
			for (const field of verifiedFields) {
				updateCoverageLexicalV2CascadeVerifiedHanBackstopEvidence(
					candidateState,
					field,
					hanBackstopGroup.normalizedText,
					primaryUnit,
					primaryUnitIndex,
				);
			}
		}
	}
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

function rankCoverageLexicalV2HanBackstopCandidates(
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
				reader.getHanBigramPostingMatches("metadata", field, bigram),
				field,
				bigramIndex,
			);
		}
		collectCoverageLexicalV2HanBackstopPostingMatches(
			matchedBigramIndicesByDoc,
			reader.getHanBigramPostingMatches("body", "body", bigram),
			"body",
			bigramIndex,
		);
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
	return rankedCandidates.sort((left, right) => {
		if (left.stats.longestContiguousBigramChain !== right.stats.longestContiguousBigramChain) {
			return right.stats.longestContiguousBigramChain - left.stats.longestContiguousBigramChain;
		}
		if (left.stats.matchedBigramCount !== right.stats.matchedBigramCount) {
			return right.stats.matchedBigramCount - left.stats.matchedBigramCount;
		}
		if (left.stats.bigramCoverageRatio !== right.stats.bigramCoverageRatio) {
			return right.stats.bigramCoverageRatio - left.stats.bigramCoverageRatio;
		}
		return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
	});
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
): CoverageLexicalV2HanBackstopGateStats {
	let bestStats: CoverageLexicalV2HanBackstopGateStats = {
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
	stats: CoverageLexicalV2HanBackstopGateStats,
): boolean {
	if (totalBigramCount <= 1) {
		return stats.matchedBigramCount === totalBigramCount;
	}
	if (totalBigramCount === 2) {
		return stats.matchedBigramCount === totalBigramCount;
	}
	return stats.matchedBigramCount >= 2 && stats.longestContiguousBigramChain >= 2;
}

function verifyCoverageLexicalV2HanBackstopCandidate(
	docId: number,
	hanBackstopGroup: CoverageLexicalV2HanBackstopGroup,
	reader: CoverageLexicalV2CandidateCascadeStorageReader,
): CoverageLexicalV2MatchField[] {
	const verifiedFields: CoverageLexicalV2MatchField[] = [];
	const metadataTexts = reader.getMetadataVerificationTexts(docId);
	if (metadataTexts) {
		appendCoverageLexicalV2VerifiedMetadataFields(
			verifiedFields,
			metadataTexts,
			hanBackstopGroup.normalizedText,
		);
	}
	if (
		doesCoverageLexicalV2BodyHanSegmentsContain(
			reader.getBodyHanSegments(docId),
			hanBackstopGroup.normalizedText,
		)
	) {
		verifiedFields.push("body");
	}
	return dedupeCoverageLexicalV2VerifiedFields(verifiedFields);
}

function appendCoverageLexicalV2VerifiedMetadataFields(
	target: CoverageLexicalV2MatchField[],
	metadataTexts: CoverageLexicalV2CandidateCascadeMetadataVerificationTexts,
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

function doesCoverageLexicalV2BodyHanSegmentsContain(
	bodyHanSegments: readonly string[] | undefined,
	normalizedText: string,
): boolean {
	if (!bodyHanSegments || bodyHanSegments.length === 0) {
		return false;
	}
	for (const bodyHanSegment of bodyHanSegments) {
		const normalizedSegment = normalizeCoverageLexicalV2Text(bodyHanSegment);
		if (normalizedSegment.includes(normalizedText)) {
			return true;
		}
	}
	return false;
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
): void {
	if (!postings) {
		return;
	}
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
		);
	}
}

function updateCoverageLexicalV2CascadePrimaryEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2CandidateCascadePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: CoverageLexicalV2MatchQualityKind,
	isExactQueryMatch: boolean,
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
	}
}

function updateCoverageLexicalV2CascadeVerifiedHanBackstopEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2CandidateCascadePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
	primaryUnitIndex: number,
): void {
	addCoverageLexicalV2CascadeFieldTerm(candidateState.fieldTerms, field, matchedTerm);
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
	};
	target.set(docId, created);
	return created;
}

function collectCoverageLexicalV2CascadePrefixTerms(
	queryTerm: string,
	sortedLexicon: readonly string[],
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions,
	termCap: number,
): string[] {
	if (termCap <= 0) {
		return [];
	}
	const expansions: string[] = [];
	let termIndex = lowerBoundCoverageLexicalV2CascadeString(sortedLexicon, queryTerm);
	while (termIndex < sortedLexicon.length && expansions.length < termCap) {
		const candidateTerm = sortedLexicon[termIndex];
		if (!candidateTerm.startsWith(queryTerm)) {
			break;
		}
		if (
			candidateTerm !== queryTerm &&
			getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, matchOptions) === "prefix"
		) {
			expansions.push(candidateTerm);
		}
		termIndex += 1;
	}
	return expansions;
}

function collectCoverageLexicalV2CascadeFuzzyTerms(
	queryTerm: string,
	sortedLexicon: readonly string[],
	matchOptions: CoverageLexicalV2CandidateCascadeMatchOptions,
	termCap: number,
): string[] {
	if (termCap <= 0) {
		return [];
	}
	const expansions: string[] = [];
	for (const candidateTerm of sortedLexicon) {
		if (expansions.length >= termCap) {
			break;
		}
		if (candidateTerm === queryTerm) {
			continue;
		}
		if (
			getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, matchOptions) === "fuzzy"
		) {
			expansions.push(candidateTerm);
		}
	}
	return expansions;
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

function lowerBoundCoverageLexicalV2CascadeString(
	values: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (compareCoverageLexicalV2CascadeStrings(values[middle], target) < 0) {
			low = middle + 1;
			continue;
		}
		high = middle;
	}
	return low;
}

function compareCoverageLexicalV2CascadeStrings(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
