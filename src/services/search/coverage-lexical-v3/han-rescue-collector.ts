import type { ResidentBase } from "./layout/types";
import type { MetadataPackingSource } from "./metadata-source";
import {
	chooseMetadataPackingSource,
	decodeIdentityMetadataSource,
	decodeRouteMetadataSource,
} from "./metadata-source";
import type { V3QueryAnalysis } from "./query";
import {
	getLiveDocSlotForBlockId,
	getShardLocalFamilySlot,
	type V3CandidateDocRecall,
	type V3ResolvedHanSurfaceGroup,
} from "./recall";
import {
	HAN_BODY_LOCALITY_MAX_BLOCK_DISTANCE,
	HAN_METADATA_DISTANCE_PENALTY_PER_CHAR,
	HAN_METADATA_MAX_DISTANCE_PENALTY,
	HAN_RESCUE_BIGRAM_SUPPORT_WEIGHT,
	HAN_RESCUE_ENDPOINT_BONUS,
	HAN_RESCUE_NON_ENDPOINT_ONLY_PENALTY,
	HAN_RESCUE_ORDER_PENALTY,
	HAN_RESCUE_REAL_ANCHOR_SUPPORT_WEIGHT,
	type HanRescueAssessment,
	type HanRescueStrength,
	type HanRescueWitnessKind,
} from "./han-rescue";
import {
	BODY_LOCALITY_MAX_ADJACENT_GAP,
	BODY_LOCALITY_MAX_HEAD_TAIL_SPAN,
} from "./body-locality/constants";

export type HanRescueDocEvidence = Readonly<{
	identityWitnessTexts: readonly string[];
	identityWitnessSourceMasks: readonly number[];
	routeWitnessTexts: readonly string[];
	routeWitnessSourceMasks: readonly number[];
	headingWitnessTexts: readonly string[];
}>;

type HanRescuePositionedWitnessOccurrence = Readonly<{
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
}>;

export type HanRescueBodyBlockEvidence = Readonly<{
	witnessOccurrences: readonly HanRescuePositionedWitnessOccurrence[];
	witnessTexts: readonly string[];
}>;

export type HanSyntheticBodyOccurrence = Readonly<{
	blockId: number;
	unitIndex: number;
	match: Readonly<{
		familyId: number;
		shardLocalFamilySlot: number;
		familyText: string;
		matchKind: "opaque_exact";
		editDistance: 0;
	}>;
	shardLocalFamilySlot: number;
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
	ordinalVirtualPosition: number;
	virtualPosition: number;
	virtualEndPosition: number;
}>;

export type HanBodyWindowLike = Readonly<{
	blockIds: readonly number[];
	coveredUnitIndices: readonly number[];
	preservesQueryOrder: boolean;
	approxMaxAdjacentGap: number;
	approxHeadTailSpan: number;
}>;

export type HanMetadataWitnessAssessmentCandidate = Readonly<{
	surfaceGroupIndex: number;
	kind: "identity" | "route" | "heading";
	matchedBigrams: readonly string[];
	assessment: HanRescueAssessment;
	identityMetadataSource: ReturnType<typeof decodeIdentityMetadataSource>;
	routeMetadataSource: ReturnType<typeof decodeRouteMetadataSource>;
	metadataPackingSource: MetadataPackingSource;
	sourceScore: number;
	text: string;
}>;

export type HanBodyRescueEvaluation<TBodyWindow extends HanBodyWindowLike> = Readonly<{
	surfaceGroupIndex: number;
	bodyWindow: TBodyWindow;
	assessment: HanRescueAssessment;
	unresolvedBigrams: readonly string[];
	matchedBigrams: readonly string[];
	matchedOccurrencesByBlockId: ReadonlyMap<number, readonly HanSyntheticBodyOccurrence[]>;
}>;

export type HanRescueAssessmentSummary = Readonly<{
	assessments: readonly HanRescueAssessment[];
	strongGroupCount: number;
	weakGroupCount: number;
	supportWeightTotal: number;
	hasOnlyWeakHanRescue: boolean;
	hasAnyAssessment: boolean;
}>;

export type HanRescueArtifacts<TBodyWindow extends HanBodyWindowLike> = Readonly<{
	resolvedHanSurfaceGroupByIndex: ReadonlyMap<number, V3ResolvedHanSurfaceGroup>;
	metadataWitnessBySurfaceGroupIndex: ReadonlyMap<number, HanMetadataWitnessAssessmentCandidate>;
	bodyEvaluationBySurfaceGroupIndex: ReadonlyMap<number, HanBodyRescueEvaluation<TBodyWindow>>;
	summary: HanRescueAssessmentSummary;
}>;

type RelevantHanGroup = Readonly<{
	group: V3QueryAnalysis["surfaceGroups"][number];
	groupRecall: V3CandidateDocRecall["hanSurfaceGroupRecalls"][number];
	resolvedHanSurfaceGroup: V3ResolvedHanSurfaceGroup;
	unresolvedBigrams: readonly string[];
	matchedRealAnchorTexts: readonly string[];
}>;

type CollectedBodyBigramOccurrence = Readonly<{
	blockId: number;
	bigramText: string;
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
	ordinalVirtualPosition: number;
	virtualPosition: number;
	virtualEndPosition: number;
}>;

type BodyWindowChooser<TBodyWindow extends HanBodyWindowLike> = (
	params: Readonly<{
		syntheticOccurrencesByBlockId: ReadonlyMap<number, readonly HanSyntheticBodyOccurrence[]>;
		syntheticApproxSpanByBlockId: ReadonlyMap<number, number>;
		syntheticOrdinalSpanByBlockId: ReadonlyMap<number, number>;
	}>,
) => TBodyWindow | null;

export function buildResolvedHanSurfaceGroupByIndex(
	resolvedHanSurfaceGroups: readonly V3ResolvedHanSurfaceGroup[],
): ReadonlyMap<number, V3ResolvedHanSurfaceGroup> {
	return new Map<number, V3ResolvedHanSurfaceGroup>(
		resolvedHanSurfaceGroups.map((group) => [group.surfaceGroupIndex, group]),
	);
}

export function compareHanRescueAssessments(
	left: HanRescueAssessment,
	right: HanRescueAssessment,
): number {
	const strengthScore = { none: 0, weak: 1, strong: 2 } as const;
	if (strengthScore[left.strength] !== strengthScore[right.strength]) {
		return strengthScore[right.strength] - strengthScore[left.strength];
	}
	if (left.coversEndpoints !== right.coversEndpoints) {
		return left.coversEndpoints ? -1 : 1;
	}
	if (left.matchedRealAnchorCount !== right.matchedRealAnchorCount) {
		return right.matchedRealAnchorCount - left.matchedRealAnchorCount;
	}
	if (left.matchedBigramCount !== right.matchedBigramCount) {
		return right.matchedBigramCount - left.matchedBigramCount;
	}
	if (left.rankingScore !== right.rankingScore) {
		return right.rankingScore - left.rankingScore;
	}
	if (
		(left.approxHeadTailSpan ?? Number.MAX_SAFE_INTEGER) !==
		(right.approxHeadTailSpan ?? Number.MAX_SAFE_INTEGER)
	) {
		return (
			(left.approxHeadTailSpan ?? Number.MAX_SAFE_INTEGER) -
			(right.approxHeadTailSpan ?? Number.MAX_SAFE_INTEGER)
		);
	}
	if (
		(left.approxMaxAdjacentGap ?? Number.MAX_SAFE_INTEGER) !==
		(right.approxMaxAdjacentGap ?? Number.MAX_SAFE_INTEGER)
	) {
		return (
			(left.approxMaxAdjacentGap ?? Number.MAX_SAFE_INTEGER) -
			(right.approxMaxAdjacentGap ?? Number.MAX_SAFE_INTEGER)
		);
	}
	if (left.blockIds.length !== right.blockIds.length) {
		return left.blockIds.length - right.blockIds.length;
	}
	return left.surfaceGroupIndex - right.surfaceGroupIndex;
}

export function summarizeHanRescueAssessments(
	assessments: readonly HanRescueAssessment[],
): HanRescueAssessmentSummary {
	const strongestByGroup = new Map<number, HanRescueAssessment>();
	for (const assessment of assessments) {
		if (assessment.strength === "none") {
			continue;
		}
		const existing = strongestByGroup.get(assessment.surfaceGroupIndex);
		if (existing == null || compareHanRescueAssessments(assessment, existing) < 0) {
			strongestByGroup.set(assessment.surfaceGroupIndex, assessment);
		}
	}
	const strongestAssessments = [...strongestByGroup.values()].sort(
		(left, right) => left.surfaceGroupIndex - right.surfaceGroupIndex,
	);
	const strongGroupCount = strongestAssessments.filter(
		(assessment) => assessment.strength === "strong",
	).length;
	const weakGroupCount = strongestAssessments.filter(
		(assessment) => assessment.strength === "weak",
	).length;
	return {
		assessments: strongestAssessments,
		strongGroupCount,
		weakGroupCount,
		supportWeightTotal: strongestAssessments.reduce(
			(total, assessment) => total + Math.max(0, assessment.rankingScore),
			0,
		),
		hasOnlyWeakHanRescue: strongGroupCount === 0 && weakGroupCount > 0,
		hasAnyAssessment: strongestAssessments.length > 0,
	};
}

export function collectHanRescueArtifacts<TBodyWindow extends HanBodyWindowLike>(params: Readonly<{
	base: ResidentBase;
	queryAnalysis: V3QueryAnalysis;
	candidateRecall: V3CandidateDocRecall;
	docEvidence: HanRescueDocEvidence;
	bodyBlockEvidenceByBlockId: ReadonlyMap<number, HanRescueBodyBlockEvidence>;
	resolvedHanSurfaceGroups: readonly V3ResolvedHanSurfaceGroup[];
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>;
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>;
	excludedSurfaceGroupIndices: ReadonlySet<number> | null;
	chooseBestBodyWindow: BodyWindowChooser<TBodyWindow>;
}>): HanRescueArtifacts<TBodyWindow> {
	const resolvedHanSurfaceGroupByIndex = buildResolvedHanSurfaceGroupByIndex(
		params.resolvedHanSurfaceGroups,
	);
	const relevantGroups = collectRelevantHanGroups({
		queryAnalysis: params.queryAnalysis,
		candidateRecall: params.candidateRecall,
		resolvedHanSurfaceGroupByIndex,
		excludedSurfaceGroupIndices: params.excludedSurfaceGroupIndices,
	});
	const metadataWitnessBySurfaceGroupIndex = collectMetadataWitnessAssessments({
		docEvidence: params.docEvidence,
		queryAnalysis: params.queryAnalysis,
		relevantGroups,
	});
	const bodyEvaluationBySurfaceGroupIndex = collectBodyRescueEvaluations({
		base: params.base,
		queryAnalysis: params.queryAnalysis,
		candidateRecall: params.candidateRecall,
		bodyBlockEvidenceByBlockId: params.bodyBlockEvidenceByBlockId,
		relevantGroups,
		bodyApproxSpanByBlockId: params.bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId: params.bodyOrdinalSpanByBlockId,
		chooseBestBodyWindow: params.chooseBestBodyWindow,
	});
	const allAssessments = [
		...[...metadataWitnessBySurfaceGroupIndex.values()].map((candidate) => candidate.assessment),
		...[...bodyEvaluationBySurfaceGroupIndex.values()].map((evaluation) => evaluation.assessment),
	];
	return {
		resolvedHanSurfaceGroupByIndex,
		metadataWitnessBySurfaceGroupIndex,
		bodyEvaluationBySurfaceGroupIndex,
		summary: summarizeHanRescueAssessments(allAssessments),
	};
}

function collectRelevantHanGroups(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	candidateRecall: V3CandidateDocRecall;
	resolvedHanSurfaceGroupByIndex: ReadonlyMap<number, V3ResolvedHanSurfaceGroup>;
	excludedSurfaceGroupIndices: ReadonlySet<number> | null;
}>): RelevantHanGroup[] {
	const out: RelevantHanGroup[] = [];
	for (const groupRecall of params.candidateRecall.hanSurfaceGroupRecalls) {
		const group = params.queryAnalysis.surfaceGroups[groupRecall.surfaceGroupIndex];
		if (group == null || group.kind !== "han") {
			continue;
		}
		if (params.excludedSurfaceGroupIndices?.has(group.index)) {
			continue;
		}
		const resolvedHanSurfaceGroup = params.resolvedHanSurfaceGroupByIndex.get(group.index);
		if (resolvedHanSurfaceGroup == null || resolvedHanSurfaceGroup.rescueBigrams.length === 0) {
			continue;
		}
		out.push({
			group,
			groupRecall,
			resolvedHanSurfaceGroup,
			unresolvedBigrams: resolvedHanSurfaceGroup.rescueBigrams,
			matchedRealAnchorTexts: getMatchedRealAnchorTextsForGroup(
				params.queryAnalysis,
				resolvedHanSurfaceGroup,
			),
		});
	}
	return out;
}

function collectMetadataWitnessAssessments(params: Readonly<{
	docEvidence: HanRescueDocEvidence;
	queryAnalysis: V3QueryAnalysis;
	relevantGroups: readonly RelevantHanGroup[];
}>): ReadonlyMap<number, HanMetadataWitnessAssessmentCandidate> {
	const bestByGroup = new Map<number, HanMetadataWitnessAssessmentCandidate>();
	if (params.relevantGroups.length === 0) {
		return bestByGroup;
	}
	const uniqueBigrams = [...new Set(params.relevantGroups.flatMap((group) => group.unresolvedBigrams))];
	const uniqueRealAnchors = [
		...new Set(params.relevantGroups.flatMap((group) => group.matchedRealAnchorTexts)),
	];
	for (let index = 0; index < params.docEvidence.identityWitnessTexts.length; index += 1) {
		const text = params.docEvidence.identityWitnessTexts[index] ?? "";
		applyMetadataWitnessEvidence({
			queryAnalysis: params.queryAnalysis,
			relevantGroups: params.relevantGroups,
			bestByGroup,
			witnessKind: "identity",
			text,
			presentBigramSet: collectTextPresenceSet(text, uniqueBigrams),
			presentRealAnchorSet: collectTextPresenceSet(text, uniqueRealAnchors),
			identityMetadataSource: decodeIdentityMetadataSource(
				params.docEvidence.identityWitnessSourceMasks[index] ?? 0,
			),
			routeMetadataSource: "none",
		});
	}
	for (let index = 0; index < params.docEvidence.routeWitnessTexts.length; index += 1) {
		const text = params.docEvidence.routeWitnessTexts[index] ?? "";
		applyMetadataWitnessEvidence({
			queryAnalysis: params.queryAnalysis,
			relevantGroups: params.relevantGroups,
			bestByGroup,
			witnessKind: "route",
			text,
			presentBigramSet: collectTextPresenceSet(text, uniqueBigrams),
			presentRealAnchorSet: collectTextPresenceSet(text, uniqueRealAnchors),
			identityMetadataSource: "none",
			routeMetadataSource: decodeRouteMetadataSource(
				params.docEvidence.routeWitnessSourceMasks[index] ?? 0,
			),
		});
	}
	for (const text of params.docEvidence.headingWitnessTexts) {
		applyMetadataWitnessEvidence({
			queryAnalysis: params.queryAnalysis,
			relevantGroups: params.relevantGroups,
			bestByGroup,
			witnessKind: "heading",
			text,
			presentBigramSet: collectTextPresenceSet(text, uniqueBigrams),
			presentRealAnchorSet: collectTextPresenceSet(text, uniqueRealAnchors),
			identityMetadataSource: "none",
			routeMetadataSource: "none",
		});
	}
	return bestByGroup;
}

function applyMetadataWitnessEvidence(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	relevantGroups: readonly RelevantHanGroup[];
	bestByGroup: Map<number, HanMetadataWitnessAssessmentCandidate>;
	witnessKind: Exclude<HanRescueWitnessKind, "body" | null>;
	text: string;
	presentBigramSet: ReadonlySet<string>;
	presentRealAnchorSet: ReadonlySet<string>;
	identityMetadataSource: ReturnType<typeof decodeIdentityMetadataSource>;
	routeMetadataSource: ReturnType<typeof decodeRouteMetadataSource>;
}>): void {
	for (const group of params.relevantGroups) {
		const matchedBigrams = group.unresolvedBigrams.filter((bigram) =>
			params.presentBigramSet.has(bigram),
		);
		const matchedRealAnchorTexts = group.matchedRealAnchorTexts.filter((text) =>
			params.presentRealAnchorSet.has(text),
		);
		if (matchedBigrams.length === 0 && matchedRealAnchorTexts.length === 0) {
			continue;
		}
		const anchorOrder = buildMetadataAnchorOrder({
			group: group.group,
			text: params.text,
			matchedBigrams,
			matchedRealAnchorTexts,
		});
		const endpointCoverage = getHanGroupEndpointCoverage(
			group.group.text,
			matchedRealAnchorTexts,
			matchedBigrams,
		);
		const rescueMode = normalizeHanRescueMode(group.resolvedHanSurfaceGroup.rescueMode);
		const assessment: HanRescueAssessment = {
			surfaceGroupIndex: group.group.index,
			context: "metadata",
			rescueMode,
			strength: classifyHanRescueStrength({
				rescueMode,
				localityQualified: true,
				matchedBigramCount: matchedBigrams.length,
				matchedRealAnchorCount: matchedRealAnchorTexts.length,
				coversEndpoints: endpointCoverage.coversEndpoints,
			}),
			matchedBigramCount: matchedBigrams.length,
			matchedRealAnchorCount: matchedRealAnchorTexts.length,
			coversStartAnchor: endpointCoverage.coversStartAnchor,
			coversEndAnchor: endpointCoverage.coversEndAnchor,
			coversEndpoints: endpointCoverage.coversEndpoints,
			preservesSurfaceOrder: anchorOrder.preservesSurfaceOrder,
			rankingScore: computeHanRescueRankingScore({
				matchedBigramCount: matchedBigrams.length,
				matchedRealAnchorCount: matchedRealAnchorTexts.length,
				coversEndpoints: endpointCoverage.coversEndpoints,
				preservesSurfaceOrder: anchorOrder.preservesSurfaceOrder,
				metadataCharDistance: anchorOrder.charDistance,
			}),
			approxMaxAdjacentGap: null,
			approxHeadTailSpan: null,
			blockIds: [],
			witnessKind: params.witnessKind,
		};
		const metadataPackingSource = chooseMetadataPackingSource(
			params.identityMetadataSource,
			params.routeMetadataSource,
		);
		const candidate: HanMetadataWitnessAssessmentCandidate = {
			surfaceGroupIndex: group.group.index,
			kind: params.witnessKind,
			matchedBigrams,
			assessment,
			identityMetadataSource: params.identityMetadataSource,
			routeMetadataSource: params.routeMetadataSource,
			metadataPackingSource,
			sourceScore: getMetadataPackingSourceScore(metadataPackingSource),
			text: params.text,
		};
		const existing = params.bestByGroup.get(group.group.index);
		if (existing == null || compareMetadataWitnessCandidates(candidate, existing) < 0) {
			params.bestByGroup.set(group.group.index, candidate);
		}
	}
}

function collectBodyRescueEvaluations<TBodyWindow extends HanBodyWindowLike>(params: Readonly<{
	base: ResidentBase;
	queryAnalysis: V3QueryAnalysis;
	candidateRecall: V3CandidateDocRecall;
	bodyBlockEvidenceByBlockId: ReadonlyMap<number, HanRescueBodyBlockEvidence>;
	relevantGroups: readonly RelevantHanGroup[];
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>;
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>;
	chooseBestBodyWindow: BodyWindowChooser<TBodyWindow>;
}>): ReadonlyMap<number, HanBodyRescueEvaluation<TBodyWindow>> {
	const bestByGroup = new Map<number, HanBodyRescueEvaluation<TBodyWindow>>();
	if (params.relevantGroups.length === 0) {
		return bestByGroup;
	}
	const neighborhoodBlockIdsByGroup = new Map<number, readonly number[]>();
	const unionNeighborhoodBlockIds = new Set<number>();
	for (const group of params.relevantGroups) {
		const blockIds = [
			...new Set(
				group.groupRecall.bodySeedBlockIds.flatMap((seedBlockId) =>
					collectSameDocSeedNeighborhoodBlockIds(
						params.base,
						params.candidateRecall.liveDocSlot,
						seedBlockId,
					),
				),
			),
		].sort((left, right) => left - right);
		neighborhoodBlockIdsByGroup.set(group.group.index, blockIds);
		for (const blockId of blockIds) {
			unionNeighborhoodBlockIds.add(blockId);
		}
	}
	const bodyBigramOccurrencesByBlockId = collectUnionBodyBigramOccurrences({
		bodyBlockEvidenceByBlockId: params.bodyBlockEvidenceByBlockId,
		neighborhoodBlockIds: [...unionNeighborhoodBlockIds].sort((left, right) => left - right),
		uniqueBigrams: [...new Set(params.relevantGroups.flatMap((group) => group.unresolvedBigrams))],
	});
	for (const group of params.relevantGroups) {
		const syntheticOccurrencesByBlockId = new Map<number, readonly HanSyntheticBodyOccurrence[]>();
		const syntheticApproxSpanByBlockId = new Map<number, number>();
		const syntheticOrdinalSpanByBlockId = new Map<number, number>();
		for (const blockId of neighborhoodBlockIdsByGroup.get(group.group.index) ?? []) {
			const projectedOccurrences = projectGroupBodyBigramOccurrences({
				base: params.base,
				surfaceGroupIndex: group.group.index,
				baseQueryUnitCount: params.queryAnalysis.primaryUnits.length,
				unresolvedBigrams: group.unresolvedBigrams,
				collectedByBigram: bodyBigramOccurrencesByBlockId.get(blockId) ?? new Map(),
			});
			if (projectedOccurrences.length === 0) {
				continue;
			}
			syntheticOccurrencesByBlockId.set(
				blockId,
				projectedOccurrences.sort(compareSyntheticBodyOccurrenceOrder),
			);
			syntheticApproxSpanByBlockId.set(
				blockId,
				params.bodyApproxSpanByBlockId.get(blockId) ?? 1,
			);
			syntheticOrdinalSpanByBlockId.set(
				blockId,
				params.bodyOrdinalSpanByBlockId.get(blockId) ?? 1,
			);
		}
		if (syntheticOccurrencesByBlockId.size === 0) {
			continue;
		}
		const bodyWindow = params.chooseBestBodyWindow({
			syntheticOccurrencesByBlockId,
			syntheticApproxSpanByBlockId,
			syntheticOrdinalSpanByBlockId,
		});
		if (bodyWindow == null) {
			continue;
		}
		const matchedBigrams = collectMatchedOpaqueBodyBigramTexts({
			bodyWindow,
			baseQueryUnitCount: params.queryAnalysis.primaryUnits.length,
			surfaceGroupIndex: group.group.index,
			unresolvedBigrams: group.unresolvedBigrams,
		});
		if (matchedBigrams.length === 0) {
			continue;
		}
		const endpointCoverage = getHanGroupEndpointCoverage(
			group.group.text,
			group.matchedRealAnchorTexts,
			matchedBigrams,
		);
		const blockDistance =
			bodyWindow.blockIds.length <= 1
				? 0
				: (bodyWindow.blockIds[bodyWindow.blockIds.length - 1] ?? 0) -
					(bodyWindow.blockIds[0] ?? 0);
		const localityQualified =
		bodyWindow.approxMaxAdjacentGap <= BODY_LOCALITY_MAX_ADJACENT_GAP &&
		bodyWindow.approxHeadTailSpan <= BODY_LOCALITY_MAX_HEAD_TAIL_SPAN &&
			blockDistance <= HAN_BODY_LOCALITY_MAX_BLOCK_DISTANCE;
		const rescueMode = normalizeHanRescueMode(group.resolvedHanSurfaceGroup.rescueMode);
		const matchedRealAnchorCount =
			rescueMode === "residual_only" ? group.matchedRealAnchorTexts.length : 0;
		bestByGroup.set(group.group.index, {
			surfaceGroupIndex: group.group.index,
			bodyWindow,
			assessment: {
				surfaceGroupIndex: group.group.index,
				context: "body",
				rescueMode,
				strength: classifyHanRescueStrength({
					rescueMode,
					localityQualified,
					matchedBigramCount: matchedBigrams.length,
					matchedRealAnchorCount,
					coversEndpoints: endpointCoverage.coversEndpoints,
				}),
				matchedBigramCount: matchedBigrams.length,
				matchedRealAnchorCount,
				coversStartAnchor: endpointCoverage.coversStartAnchor,
				coversEndAnchor: endpointCoverage.coversEndAnchor,
				coversEndpoints: endpointCoverage.coversEndpoints,
				preservesSurfaceOrder: bodyWindow.preservesQueryOrder,
				rankingScore: computeHanRescueRankingScore({
					matchedBigramCount: matchedBigrams.length,
					matchedRealAnchorCount,
					coversEndpoints: endpointCoverage.coversEndpoints,
					preservesSurfaceOrder: bodyWindow.preservesQueryOrder,
				}),
				approxMaxAdjacentGap: bodyWindow.approxMaxAdjacentGap,
				approxHeadTailSpan: bodyWindow.approxHeadTailSpan,
				blockIds: bodyWindow.blockIds,
				witnessKind: "body",
			},
			unresolvedBigrams: group.unresolvedBigrams,
			matchedBigrams,
			matchedOccurrencesByBlockId: collectMatchedSyntheticBodyOccurrencesByBlock({
				matchedBigrams,
				syntheticOccurrencesByBlockId,
			}),
		});
	}
	return bestByGroup;
}

function collectMatchedSyntheticBodyOccurrencesByBlock(params: Readonly<{
	matchedBigrams: readonly string[];
	syntheticOccurrencesByBlockId: ReadonlyMap<number, readonly HanSyntheticBodyOccurrence[]>;
}>): ReadonlyMap<number, readonly HanSyntheticBodyOccurrence[]> {
	const matchedBigramSet = new Set(params.matchedBigrams);
	const out = new Map<number, readonly HanSyntheticBodyOccurrence[]>();
	for (const [blockId, occurrences] of params.syntheticOccurrencesByBlockId) {
		const matchedOccurrences = occurrences.filter((occurrence) =>
			matchedBigramSet.has(occurrence.match.familyText),
		);
		if (matchedOccurrences.length === 0) {
			continue;
		}
		out.set(blockId, matchedOccurrences);
	}
	return out;
}

function projectGroupBodyBigramOccurrences(params: Readonly<{
	base: ResidentBase;
	surfaceGroupIndex: number;
	baseQueryUnitCount: number;
	unresolvedBigrams: readonly string[];
	collectedByBigram: ReadonlyMap<string, readonly CollectedBodyBigramOccurrence[]>;
}>): HanSyntheticBodyOccurrence[] {
	const out: HanSyntheticBodyOccurrence[] = [];
	for (let bigramIndex = 0; bigramIndex < params.unresolvedBigrams.length; bigramIndex += 1) {
		const bigram = params.unresolvedBigrams[bigramIndex] ?? "";
		for (const occurrence of params.collectedByBigram.get(bigram) ?? []) {
			const familyId = buildSyntheticBodyBigramFamilyId(
				params.surfaceGroupIndex,
				bigramIndex,
				occurrence.ordinalPosition,
			);
			out.push({
				blockId: occurrence.blockId,
				unitIndex: buildSyntheticBodyBigramUnitIndex(
					params.baseQueryUnitCount,
					params.surfaceGroupIndex,
					bigramIndex,
				),
				match: {
					familyId,
					shardLocalFamilySlot: getShardLocalFamilySlot(params.base, familyId),
					familyText: bigram,
					matchKind: "opaque_exact",
					editDistance: 0,
				},
				shardLocalFamilySlot: getShardLocalFamilySlot(params.base, familyId),
				ordinalPosition: occurrence.ordinalPosition,
				localPosition: occurrence.localPosition,
				localEndPosition: occurrence.localEndPosition,
				ordinalVirtualPosition: occurrence.ordinalVirtualPosition,
				virtualPosition: occurrence.virtualPosition,
				virtualEndPosition: occurrence.virtualEndPosition,
			});
		}
	}
	return out;
}

function collectUnionBodyBigramOccurrences(params: Readonly<{
	bodyBlockEvidenceByBlockId: ReadonlyMap<number, HanRescueBodyBlockEvidence>;
	neighborhoodBlockIds: readonly number[];
	uniqueBigrams: readonly string[];
}>): ReadonlyMap<number, ReadonlyMap<string, readonly CollectedBodyBigramOccurrence[]>> {
	const byBlock = new Map<number, Map<string, CollectedBodyBigramOccurrence[]>>();
	for (const blockId of params.neighborhoodBlockIds) {
		const blockEvidence = params.bodyBlockEvidenceByBlockId.get(blockId);
		if (blockEvidence == null) {
			continue;
		}
		for (let witnessIndex = 0; witnessIndex < blockEvidence.witnessTexts.length; witnessIndex += 1) {
			const witnessText = blockEvidence.witnessTexts[witnessIndex] ?? "";
			const witnessOccurrence = blockEvidence.witnessOccurrences[witnessIndex];
			if (witnessOccurrence == null) {
				continue;
			}
			for (const bigram of params.uniqueBigrams) {
				let searchStart = 0;
				while (searchStart < witnessText.length) {
					const matchIndex = witnessText.indexOf(bigram, searchStart);
					if (matchIndex < 0) {
						break;
					}
					const localPosition = witnessOccurrence.localPosition + matchIndex;
					const localEndPosition = localPosition + bigram.length;
					ensureBodyBigramOccurrenceList(byBlock, blockId, bigram).push({
						blockId,
						bigramText: bigram,
						ordinalPosition: witnessOccurrence.ordinalPosition,
						localPosition,
						localEndPosition,
						ordinalVirtualPosition: witnessOccurrence.ordinalPosition,
						virtualPosition: localPosition,
						virtualEndPosition: localEndPosition,
					});
					searchStart = matchIndex + 1;
				}
			}
		}
	}
	for (let index = 0; index < params.neighborhoodBlockIds.length - 1; index += 1) {
		const leftBlockId = params.neighborhoodBlockIds[index] ?? -1;
		const rightBlockId = params.neighborhoodBlockIds[index + 1] ?? -1;
		if (rightBlockId !== leftBlockId + 1) {
			continue;
		}
		const leftWitnessTexts = params.bodyBlockEvidenceByBlockId.get(leftBlockId)?.witnessTexts ?? [];
		const rightWitnessTexts =
			params.bodyBlockEvidenceByBlockId.get(rightBlockId)?.witnessTexts ?? [];
		for (const bigram of params.uniqueBigrams) {
			const chars = Array.from(bigram);
			const leftChar = chars[0] ?? "";
			const rightChar = chars[1] ?? "";
			if (
				leftChar.length === 0 ||
				rightChar.length === 0 ||
				!leftWitnessTexts.some((text) => text.endsWith(leftChar)) ||
				!rightWitnessTexts.some((text) => text.startsWith(rightChar))
			) {
				continue;
			}
			ensureBodyBigramOccurrenceList(byBlock, rightBlockId, bigram).push({
				blockId: rightBlockId,
				bigramText: bigram,
				ordinalPosition: 9000 + leftBlockId,
				localPosition: 0,
				localEndPosition: bigram.length,
				ordinalVirtualPosition: 0,
				virtualPosition: 0,
				virtualEndPosition: bigram.length,
			});
		}
	}
	const out = new Map<number, ReadonlyMap<string, readonly CollectedBodyBigramOccurrence[]>>();
	for (const [blockId, occurrencesByBigram] of byBlock) {
		for (const occurrences of occurrencesByBigram.values()) {
			occurrences.sort(compareCollectedBodyBigramOccurrences);
		}
		out.set(blockId, occurrencesByBigram);
	}
	return out;
}

function ensureBodyBigramOccurrenceList(
	byBlock: Map<number, Map<string, CollectedBodyBigramOccurrence[]>>,
	blockId: number,
	bigram: string,
): CollectedBodyBigramOccurrence[] {
	let byBigram = byBlock.get(blockId);
	if (byBigram == null) {
		byBigram = new Map<string, CollectedBodyBigramOccurrence[]>();
		byBlock.set(blockId, byBigram);
	}
	let occurrences = byBigram.get(bigram);
	if (occurrences == null) {
		occurrences = [];
		byBigram.set(bigram, occurrences);
	}
	return occurrences;
}

function getMatchedRealAnchorTextsForGroup(
	queryAnalysis: V3QueryAnalysis,
	resolvedHanSurfaceGroup: V3ResolvedHanSurfaceGroup,
): string[] {
	return resolvedHanSurfaceGroup.matchedRealUnitIndices
		.map((unitIndex) => queryAnalysis.primaryUnits[unitIndex]?.text ?? "")
		.filter((text) => text.length > 0);
}

function getHanGroupEndpointCoverage(
	surfaceText: string,
	matchedRealAnchorTexts: readonly string[],
	matchedBigramTexts: readonly string[],
): Readonly<{
	coversStartAnchor: boolean;
	coversEndAnchor: boolean;
	coversEndpoints: boolean;
}> {
	const coversStartAnchor =
		matchedRealAnchorTexts.some((text) => surfaceText.startsWith(text)) ||
		matchedBigramTexts.includes(Array.from(surfaceText).length >= 2 ? surfaceText.slice(0, 2) : "");
	const coversEndAnchor =
		matchedRealAnchorTexts.some((text) => surfaceText.endsWith(text)) ||
		matchedBigramTexts.includes(
			Array.from(surfaceText).length >= 2 ? surfaceText.slice(-2) : "",
		);
	return {
		coversStartAnchor,
		coversEndAnchor,
		coversEndpoints: coversStartAnchor && coversEndAnchor,
	};
}

function classifyHanRescueStrength(params: Readonly<{
	rescueMode: "residual_only" | "whole_group_when_real_miss";
	localityQualified: boolean;
	matchedBigramCount: number;
	matchedRealAnchorCount: number;
	coversEndpoints: boolean;
}>): HanRescueStrength {
	if (params.rescueMode === "whole_group_when_real_miss") {
		if (
			params.localityQualified &&
			(params.matchedBigramCount >= 2 || params.coversEndpoints)
		) {
			return "strong";
		}
		return params.matchedBigramCount >= 1 ? "weak" : "none";
	}
	if (
		params.localityQualified &&
		(
			(params.matchedRealAnchorCount >= 1 && params.matchedBigramCount >= 1) ||
			params.coversEndpoints ||
			params.matchedBigramCount >= 2
		)
	) {
		return "strong";
	}
	if (params.matchedBigramCount >= 1 || params.matchedRealAnchorCount >= 1) {
		return "weak";
	}
	return "none";
}

function normalizeHanRescueMode(
	rescueMode: V3ResolvedHanSurfaceGroup["rescueMode"],
): "residual_only" | "whole_group_when_real_miss" {
	return rescueMode === "residual_only"
		? "residual_only"
		: "whole_group_when_real_miss";
}

function computeHanRescueRankingScore(params: Readonly<{
	matchedBigramCount: number;
	matchedRealAnchorCount: number;
	coversEndpoints: boolean;
	preservesSurfaceOrder: boolean;
	metadataCharDistance?: number;
}>): number {
	const distancePenalty =
		params.metadataCharDistance == null
			? 0
			: Math.min(
					HAN_METADATA_MAX_DISTANCE_PENALTY,
					params.metadataCharDistance * HAN_METADATA_DISTANCE_PENALTY_PER_CHAR,
				);
	return (
		params.matchedBigramCount * HAN_RESCUE_BIGRAM_SUPPORT_WEIGHT +
		params.matchedRealAnchorCount * HAN_RESCUE_REAL_ANCHOR_SUPPORT_WEIGHT +
		(params.coversEndpoints ? HAN_RESCUE_ENDPOINT_BONUS : 0) -
		(params.preservesSurfaceOrder ? 0 : HAN_RESCUE_ORDER_PENALTY) -
		(!params.coversEndpoints && params.matchedBigramCount > 0
			? HAN_RESCUE_NON_ENDPOINT_ONLY_PENALTY
			: 0) -
		distancePenalty
	);
}

function buildMetadataAnchorOrder(params: Readonly<{
	group: V3QueryAnalysis["surfaceGroups"][number];
	text: string;
	matchedBigrams: readonly string[];
	matchedRealAnchorTexts: readonly string[];
}>): Readonly<{
	preservesSurfaceOrder: boolean;
	charDistance: number;
}> {
	const matches: Array<{ queryCharStart: number; start: number; end: number }> = [];
	for (const realText of params.matchedRealAnchorTexts) {
		const queryCharStart = params.group.text.indexOf(realText);
		const start = params.text.indexOf(realText);
		if (queryCharStart < 0 || start < 0) {
			continue;
		}
		matches.push({
			queryCharStart,
			start,
			end: start + realText.length,
		});
	}
	for (const bigram of params.matchedBigrams) {
		const queryCharStart = params.group.text.indexOf(bigram);
		const start = params.text.indexOf(bigram);
		if (queryCharStart < 0 || start < 0) {
			continue;
		}
		matches.push({
			queryCharStart,
			start,
			end: start + bigram.length,
		});
	}
	matches.sort(
		(left, right) => left.start - right.start || left.queryCharStart - right.queryCharStart,
	);
	let preservesSurfaceOrder = true;
	for (let index = 1; index < matches.length; index += 1) {
		if ((matches[index - 1]?.queryCharStart ?? 0) > (matches[index]?.queryCharStart ?? 0)) {
			preservesSurfaceOrder = false;
			break;
		}
	}
	const first = matches[0];
	const last = matches[matches.length - 1];
	const totalMatchedWidth = matches.reduce((sum, match) => sum + (match.end - match.start), 0);
	const span = first == null || last == null ? 0 : Math.max(0, last.end - first.start);
	return {
		preservesSurfaceOrder,
		charDistance: Math.max(0, span - totalMatchedWidth),
	};
}

function compareMetadataWitnessCandidates(
	left: HanMetadataWitnessAssessmentCandidate,
	right: HanMetadataWitnessAssessmentCandidate,
): number {
	const assessmentComparison = compareHanRescueAssessments(
		left.assessment,
		right.assessment,
	);
	if (assessmentComparison !== 0) {
		return assessmentComparison;
	}
	if (left.sourceScore !== right.sourceScore) {
		return right.sourceScore - left.sourceScore;
	}
	if (left.text.length !== right.text.length) {
		return left.text.length - right.text.length;
	}
	return left.text.localeCompare(right.text);
}

function collectTextPresenceSet(
	text: string,
	candidates: readonly string[],
): ReadonlySet<string> {
	const out = new Set<string>();
	for (const candidate of candidates) {
		if (candidate.length > 0 && text.includes(candidate)) {
			out.add(candidate);
		}
	}
	return out;
}

function compareCollectedBodyBigramOccurrences(
	left: CollectedBodyBigramOccurrence,
	right: CollectedBodyBigramOccurrence,
): number {
	if (left.localPosition !== right.localPosition) {
		return left.localPosition - right.localPosition;
	}
	if (left.localEndPosition !== right.localEndPosition) {
		return left.localEndPosition - right.localEndPosition;
	}
	if (left.ordinalPosition !== right.ordinalPosition) {
		return left.ordinalPosition - right.ordinalPosition;
	}
	return left.bigramText.localeCompare(right.bigramText);
}

function compareSyntheticBodyOccurrenceOrder(
	left: HanSyntheticBodyOccurrence,
	right: HanSyntheticBodyOccurrence,
): number {
	if (left.localPosition !== right.localPosition) {
		return left.localPosition - right.localPosition;
	}
	if (left.localEndPosition !== right.localEndPosition) {
		return left.localEndPosition - right.localEndPosition;
	}
	if (left.unitIndex !== right.unitIndex) {
		return left.unitIndex - right.unitIndex;
	}
	return left.match.shardLocalFamilySlot - right.match.shardLocalFamilySlot;
}

function collectMatchedOpaqueBodyBigramTexts(params: Readonly<{
	bodyWindow: HanBodyWindowLike;
	baseQueryUnitCount: number;
	surfaceGroupIndex: number;
	unresolvedBigrams: readonly string[];
}>): string[] {
	const out = new Set<string>();
	for (const unitIndex of params.bodyWindow.coveredUnitIndices) {
		const bigramIndex =
			unitIndex - params.baseQueryUnitCount - 100_000 - params.surfaceGroupIndex * 100;
		if (bigramIndex < 0 || bigramIndex >= params.unresolvedBigrams.length) {
			continue;
		}
		const bigram = params.unresolvedBigrams[bigramIndex];
		if (bigram != null) {
			out.add(bigram);
		}
	}
	return [...out];
}

function collectSameDocSeedNeighborhoodBlockIds(
	base: ResidentBase,
	liveDocSlot: number,
	seedBlockId: number,
): number[] {
	const out: number[] = [];
	for (const candidateBlockId of [seedBlockId - 1, seedBlockId, seedBlockId + 1]) {
		if (candidateBlockId < 0) {
			continue;
		}
		if (getLiveDocSlotForBlockId(base, candidateBlockId) !== liveDocSlot) {
			continue;
		}
		out.push(candidateBlockId);
	}
	return out;
}

function getMetadataPackingSourceScore(source: MetadataPackingSource | undefined): number {
	switch (source) {
		case "basename":
			return 3;
		case "alias":
			return 2;
		case "route":
			return 1;
		default:
			return 0;
	}
}

function buildSyntheticBodyBigramUnitIndex(
	baseQueryUnitCount: number,
	surfaceGroupIndex: number,
	bigramIndex: number,
): number {
	return baseQueryUnitCount + 100_000 + surfaceGroupIndex * 100 + bigramIndex;
}

function buildSyntheticBodyBigramFamilyId(
	surfaceGroupIndex: number,
	bigramIndex: number,
	localMatchOrdinal: number,
): number {
	return -(1_000_000 + surfaceGroupIndex * 1000 + bigramIndex * 10 + localMatchOrdinal);
}
