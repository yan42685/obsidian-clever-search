import type { ResidentBase } from "../layout/types";
import {
	logCoverageLexicalV3Debug,
	shouldLogCoverageLexicalV3Debug,
} from "../debug";
import type { HanRescueAssessment } from "../han-rescue";
import {
	collectHanRescueArtifacts,
	type HanBodyRescueEvaluation,
	type HanMetadataWitnessAssessmentCandidate as SharedHanMetadataWitnessAssessmentCandidate,
} from "../han-rescue-collector";
import {
	attachBlockShortlistSketch,
	buildBlockShortlistPriorityScore,
	compareBlockShortlistItems,
	passesBlockShortlistAdmission,
	type BlockShortlistItem,
	type BlockShortlistRepresentative,
	type BlockShortlistSketch,
} from "../body-locality/shortlist";
import {
	BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD,
	BODY_FAMILY_SUPPORT_STANDALONE,
	type V3QueryAnalysis,
} from "../query";
import {
	getBodyBlockExactFamilyIds,
	getBodyBlockExactTokenPositions,
	getBodyBlockFamilySupportEntries,
	getBodyBlockHanWitnessOccurrences,
	getBodyBlockHanWitnessTexts,
	getDocHeadingHanWitnessStringIds,
	getDocHeadingHanWitnessTexts,
	getDocIdentityHanWitnessSourceMasks,
	getDocIdentityHanWitnessStringIds,
	getDocIdentityHanWitnessTexts,
	getDocRouteHanWitnessSourceMasks,
	getDocRouteHanWitnessStringIds,
	getDocRouteHanWitnessTexts,
	getDocHeadingFamilyIds,
	getDocIdentityFamilyIds,
	getDocIdentitySourceMasks,
	getDocPath,
	getDocRouteFamilyIds,
	getDocRouteSourceMasks,
	getDocStableKey,
	resolveCandidateHanSurfaceGroups,
} from "../recall";
import {
	chooseMetadataPackingSource,
	decodeIdentityMetadataSource,
	decodeRouteMetadataSource,
	type MetadataPackingSource,
} from "../metadata-source";
import type {
	V3CandidateDocRecall,
	V3QueryFamilyMatch,
	V3QueryUnitFamilyMatches,
	V3ResolvedHanSurfaceGroup,
} from "../recall";
import { compareContainerStrength } from "./comparator";
import type {
	BodyWindowContainer,
	BodyPrefixSupportKind,
	CoverageGateProfile,
	EvidenceContainer,
	EvidencePackingProfile,
	FragmentationPenalty,
	HanSurfaceCompletionGroupResult,
	HanSurfaceCompletionTier,
	HeadingCorroboration,
	IdentityContainer,
	MetadataPackingSignature,
	RealizedQueryUnitFamily,
	RouteContainer,
} from "./types";

const CHAIN_BOUNDARY_PENALTY = 0;
const WITNESS_MATCH_FAMILY_ID_OFFSET = 1;
const BLOCK_SHORTLIST_LIMIT = 6;
const BODY_WINDOW_PREFILTER_PER_BUCKET = 4;

type CachedDocEvidence = Readonly<{
	identityFamilyIds: readonly number[];
	routeFamilyIds: readonly number[];
	headingFamilyIds: readonly number[];
	identitySourceMaskByFamilyId: ReadonlyMap<number, number>;
	routeSourceMaskByFamilyId: ReadonlyMap<number, number>;
	identityWitnessStringIds: readonly number[];
	routeWitnessStringIds: readonly number[];
	headingWitnessStringIds: readonly number[];
	identityWitnessTexts: readonly string[];
	identityWitnessSourceMasks: readonly number[];
	routeWitnessTexts: readonly string[];
	routeWitnessSourceMasks: readonly number[];
	headingWitnessTexts: readonly string[];
}>;

type CachedBodyBlockEvidence = Readonly<{
	exactOccurrences: readonly PositionedFamilyOccurrence[];
	witnessOccurrences: readonly PositionedFamilyOccurrence[];
	witnessTexts: readonly string[];
	familySupportMaskByFamilyId: ReadonlyMap<number, number>;
	approxSpan: number;
	ordinalSpan: number;
}>;

const DOC_EVIDENCE_CACHE = new WeakMap<ResidentBase, Map<number, CachedDocEvidence>>();
const BODY_BLOCK_EVIDENCE_CACHE = new WeakMap<
	ResidentBase,
	Map<number, CachedBodyBlockEvidence>
>();

type BodyOccurrence = Readonly<{
	blockId: number;
	unitIndex: number;
	match: V3QueryFamilyMatch;
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
	ordinalVirtualPosition: number;
	virtualPosition: number;
	virtualEndPosition: number;
}>;

type BodyWindowCandidate = Readonly<{
	tier: "bodyWindow";
	blockIds: readonly number[];
	boundaryCrossingCount: number;
	coveredUnitIndices: readonly number[];
	coveredDistinctUnitCount: number;
	containerCompactness: number;
	exactUnitCount: number;
	windowWidth: number;
	gapCount: number;
	density: number;
	maxAdjacentGap: number;
	preservesQueryOrder: boolean;
	windowStart: number;
	approxWindowStart: number;
	approxWindowEnd: number;
	approxHeadTailSpan: number;
	approxMaxAdjacentGap: number;
	approxTotalGapMass: number;
	representatives: readonly BodyOccurrence[];
	headingCorroboration: HeadingCorroboration;
}>;

type BodyWindowSelection = Readonly<{
	bestCandidate: BodyWindowCandidate | null;
	shortlist: BlockShortlistSketch;
}>;

type BodyScopePrefilter = Readonly<{
	blockIds: readonly number[];
	coveredDistinctUnitCount: number;
	preservesQueryOrder: boolean;
	approxWindowStart: number;
	approxWindowEnd: number;
	approxHeadTailSpan: number;
	priorityScore: number;
	virtualOccurrences: readonly BodyOccurrence[];
}>;

type BodyWindowSearchState = {
	representativeByUnit: Map<number, BodyOccurrence>;
	representativesByVirtualOrder: BodyOccurrence[];
	coveredUnitIndicesSorted: number[];
	coveredDistinctUnitCount: number;
	exactUnitCount: number;
	blockCountById: Map<number, number>;
	blockIdsSorted: number[];
	blockStart: number;
	boundaryCrossingCount: number;
	approxWindowStart: number;
	approxWindowEnd: number;
	approxHeadTailSpan: number;
	approxMaxAdjacentGap: number;
	approxTotalGapMass: number;
	orderViolationCount: number;
	preservesQueryOrder: boolean;
};

type BodyWindowShortlistSnapshot = Readonly<{
	blockStart: number;
	boundaryCrossingCount: number;
	coveredUnitIndices: readonly number[];
	coveredDistinctUnitCount: number;
	representatives: readonly BodyOccurrence[];
	approxWindowStart: number;
	approxWindowEnd: number;
	approxHeadTailSpan: number;
	approxMaxAdjacentGap: number;
	approxTotalGapMass: number;
	preservesQueryOrder: boolean;
}>;

type BodyWindowPushResult =
	| Readonly<{ kind: "no_change" }>
	| Readonly<{
			kind: "insert_new_unit";
			previousRepresentative: null;
			nextRepresentative: BodyOccurrence;
	  }>
	| Readonly<{
			kind: "replace_existing_unit";
			previousRepresentative: BodyOccurrence;
			nextRepresentative: BodyOccurrence;
	  }>;

type OrdinalWindowSummary = Readonly<{
	windowStart: number;
	windowWidth: number;
	gapCount: number;
	maxAdjacentGap: number;
}>;

type PositionedFamilyOccurrence = Readonly<{
	familyId: number;
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
}>;

type HanSurfaceCompletionGroup = Readonly<{
	surfaceGroupIndex: number;
	surfaceText: string;
}>;

type HanSurfaceCompletionSummary = Readonly<{
	completedGroupCount: number;
	tierScoreTotal: number;
	strongestTier: HanSurfaceCompletionTier;
	groups: readonly HanSurfaceCompletionGroupResult[];
}>;

type OpaqueMetadataRescueUnit = Readonly<{
	surfaceGroupIndex: number;
	queryUnitIndex: number;
	queryUnitText: string;
	familyId: number;
	familyText: string;
	assessment: HanRescueAssessment;
	inIdentity: boolean;
	inRoute: boolean;
	inHeading: boolean;
	identityMetadataSource: ReturnType<typeof decodeIdentityMetadataSource>;
	routeMetadataSource: ReturnType<typeof decodeRouteMetadataSource>;
	metadataPackingSource: MetadataPackingSource;
}>;

type OpaqueBodyRescue = Readonly<{
	surfaceGroupIndex: number;
	queryUnitIndex: number;
	queryUnitText: string;
	familyId: number;
	familyText: string;
	bodyWindow: BodyWindowCandidate;
	coverageRatio: number;
	matchedBigramCount: number;
	assessment: HanRescueAssessment;
	promotesBodyWindow: boolean;
}>;

export function buildPackingProfile(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	candidateRecall: V3CandidateDocRecall,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	options?: Readonly<{
		allowBodyOpaqueRescueSurfaceGroupIndices?: ReadonlySet<number> | null;
		excludeSurfaceGroupIndices?: ReadonlySet<number> | null;
	}>,
): EvidencePackingProfile {
	const docEvidence = getCachedDocEvidence(base, candidateRecall.docId);
	const identityFamilyIds = new Set<number>([
		...docEvidence.identityFamilyIds,
		...docEvidence.identityWitnessStringIds.map(encodeWitnessMatchFamilyId),
	]);
	const routeFamilyIds = new Set<number>([
		...docEvidence.routeFamilyIds,
		...docEvidence.routeWitnessStringIds.map(encodeWitnessMatchFamilyId),
	]);
	const headingFamilyIds = new Set<number>([
		...docEvidence.headingFamilyIds,
		...docEvidence.headingWitnessStringIds.map(encodeWitnessMatchFamilyId),
	]);
	const excludedSurfaceGroupIndices = options?.excludeSurfaceGroupIndices ?? null;
	const relevantUnitFamilyMatches = unitFamilyMatches.filter((unitMatches) => {
		if (excludedSurfaceGroupIndices == null || excludedSurfaceGroupIndices.size === 0) {
			return true;
		}
		const surfaceGroupIndex = unitMatches.querySurfaceGroupIndex;
		return surfaceGroupIndex == null || !excludedSurfaceGroupIndices.has(surfaceGroupIndex);
	});
	const bodyOccurrencesByBlockId = new Map<number, BodyOccurrence[]>();
	const bodyApproxSpanByBlockId = new Map<number, number>();
	const bodyOrdinalSpanByBlockId = new Map<number, number>();
	const bodyBlockIdsByUnitFamily = new Map<number, Map<number, Set<number>>>();
	const bodySupportMaskByUnitFamily = new Map<number, Map<number, number>>();
	const bodyWitnessTextsByBlockId = new Map<number, readonly string[]>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		const blockEvidence = getCachedBodyBlockEvidence(base, blockId);
		const exactOccurrences = blockEvidence.exactOccurrences;
		const witnessOccurrences = blockEvidence.witnessOccurrences;
		const allOccurrences = [...exactOccurrences, ...witnessOccurrences];
		bodyWitnessTextsByBlockId.set(blockId, blockEvidence.witnessTexts);
		bodyApproxSpanByBlockId.set(blockId, blockEvidence.approxSpan);
		bodyOrdinalSpanByBlockId.set(blockId, blockEvidence.ordinalSpan);
		const blockOccurrences: BodyOccurrence[] = [];
		const blockSupportMaskByFamilyId = blockEvidence.familySupportMaskByFamilyId;
		for (const unitMatches of relevantUnitFamilyMatches) {
			const occurrences = collectBlockOccurrences(
				blockId,
				unitMatches.queryUnitIndex,
				unitMatches.matches,
				allOccurrences,
			);
			if (occurrences.length === 0) {
				continue;
			}
			blockOccurrences.push(...occurrences);
			for (const occurrence of occurrences) {
				let familyMap = bodyBlockIdsByUnitFamily.get(occurrence.unitIndex);
				if (familyMap == null) {
					familyMap = new Map<number, Set<number>>();
					bodyBlockIdsByUnitFamily.set(occurrence.unitIndex, familyMap);
				}
				let blockIds = familyMap.get(occurrence.match.familyId);
				if (blockIds == null) {
					blockIds = new Set<number>();
					familyMap.set(occurrence.match.familyId, blockIds);
				}
				blockIds.add(blockId);
				let familySupportMaskMap = bodySupportMaskByUnitFamily.get(occurrence.unitIndex);
				if (familySupportMaskMap == null) {
					familySupportMaskMap = new Map<number, number>();
					bodySupportMaskByUnitFamily.set(occurrence.unitIndex, familySupportMaskMap);
				}
				familySupportMaskMap.set(
					occurrence.match.familyId,
					(familySupportMaskMap.get(occurrence.match.familyId) ?? 0) |
						(blockSupportMaskByFamilyId.get(occurrence.match.familyId) ?? 0),
				);
			}
		}
		if (blockOccurrences.length > 0) {
			bodyOccurrencesByBlockId.set(
				blockId,
				blockOccurrences.sort(compareBodyOccurrenceOrder),
			);
		}
	}

	const bodyWindowSelection = chooseBestBodyWindow(
		base,
		bodyOccurrencesByBlockId,
		bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId,
		headingFamilyIds,
	);
	const baseBestBodyWindowContainer = bodyWindowSelection.bestCandidate;
	const baseBestBodyWindowBlockIds = new Set<number>(
		baseBestBodyWindowContainer?.blockIds ?? [],
	);
	const baseRealizedFamilies = relevantUnitFamilyMatches
		.map((unitMatches) =>
			selectRealizedFamilyForUnit({
				unitMatches,
				identityFamilyIds,
				routeFamilyIds,
				headingFamilyIds,
				identitySourceMaskByFamilyId: docEvidence.identitySourceMaskByFamilyId,
				routeSourceMaskByFamilyId: docEvidence.routeSourceMaskByFamilyId,
				bodyBlockIdsByUnitFamily,
				bodySupportMaskByUnitFamily,
				bestBodyWindowBlockIds: baseBestBodyWindowBlockIds,
			}),
		)
		.filter((realized): realized is RealizedQueryUnitFamily => realized != null);
	const resolvedHanSurfaceGroups = resolveCandidateHanSurfaceGroups(
		queryAnalysis,
		baseRealizedFamilies,
	);
	const hanRescueArtifacts = collectHanRescueArtifacts<BodyWindowCandidate>({
		base,
		queryAnalysis,
		candidateRecall,
		resolvedHanSurfaceGroups,
		bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId,
		excludedSurfaceGroupIndices,
		chooseBestBodyWindow: ({
			syntheticOccurrencesByBlockId,
			syntheticApproxSpanByBlockId,
			syntheticOrdinalSpanByBlockId,
		}) =>
			chooseBestBodyWindow(
				base,
				syntheticOccurrencesByBlockId,
				syntheticApproxSpanByBlockId,
				syntheticOrdinalSpanByBlockId,
				new Set<number>(),
				{ minDistinctUnitCount: 1 },
			).bestCandidate,
	});
	const resolvedHanSurfaceGroupByIndex = hanRescueArtifacts.resolvedHanSurfaceGroupByIndex;
	const metadataOpaqueRescueUnits = materializeOpaqueMetadataRescueUnits({
		queryAnalysis,
		metadataWitnessBySurfaceGroupIndex:
			hanRescueArtifacts.metadataWitnessBySurfaceGroupIndex,
	});
	const bodyOpaqueRescues = materializeOpaqueBodyRescues({
		queryAnalysis,
		bodyEvaluationBySurfaceGroupIndex:
			hanRescueArtifacts.bodyEvaluationBySurfaceGroupIndex,
	});
	const hanRescueSummary = hanRescueArtifacts.summary;
	if (shouldLogCoverageLexicalV3Debug(queryAnalysis.queryText)) {
		logCoverageLexicalV3Debug("ranking.buildPackingProfile.hanOpaqueRescue", {
			queryText: queryAnalysis.queryText,
			docId: candidateRecall.docId,
			path: getDocPath(base, candidateRecall.docId),
			allowBodyOpaqueRescueSurfaceGroupIndices:
				options?.allowBodyOpaqueRescueSurfaceGroupIndices == null
					? null
					: [...options.allowBodyOpaqueRescueSurfaceGroupIndices].sort(
							(left, right) => left - right,
						),
			resolvedHanSurfaceGroups: resolvedHanSurfaceGroups.map((group) => ({
				surfaceGroupIndex: group.surfaceGroupIndex,
				surfaceText: group.surfaceText,
				realUnitIndices: group.realUnitIndices,
				matchedRealUnitIndices: group.matchedRealUnitIndices,
				rescueMode: group.rescueMode,
				rescueBigrams: group.rescueBigrams,
			})),
			hanSurfaceGroupRecalls: candidateRecall.hanSurfaceGroupRecalls.map((groupRecall) => ({
				surfaceGroupIndex: groupRecall.surfaceGroupIndex,
				metadataGateStats: groupRecall.metadataGateStats,
				bodySeedBlockIds: groupRecall.bodySeedBlockIds,
				bodySeedBlockGates: groupRecall.bodySeedBlockGates.map((gate) => ({
					blockId: gate.blockId,
					stats: gate.stats,
				})),
			})),
			docWitnesses: {
				identity: docEvidence.identityWitnessTexts,
				route: docEvidence.routeWitnessTexts,
				heading: docEvidence.headingWitnessTexts,
				bodyByBlockId: [...bodyWitnessTextsByBlockId.entries()].map(([blockId, texts]) => ({
					blockId,
					texts,
				})),
			},
			metadataOpaqueRescueUnits: metadataOpaqueRescueUnits.map((unit) => ({
				surfaceGroupIndex: unit.surfaceGroupIndex,
				queryUnitText: unit.queryUnitText,
				familyText: unit.familyText,
				strength: unit.assessment.strength,
				inIdentity: unit.inIdentity,
				inRoute: unit.inRoute,
				inHeading: unit.inHeading,
				metadataPackingSource: unit.metadataPackingSource,
			})),
			bodyOpaqueRescues: bodyOpaqueRescues.map((rescue) => ({
				surfaceGroupIndex: rescue.surfaceGroupIndex,
				queryUnitText: rescue.queryUnitText,
				familyText: rescue.familyText,
				strength: rescue.assessment.strength,
				matchedBigramCount: rescue.matchedBigramCount,
				coverageRatio: rescue.coverageRatio,
				promotesBodyWindow: rescue.promotesBodyWindow,
				bodyWindowBlockIds: rescue.bodyWindow.blockIds,
				bodyWindowCoveredDistinctUnitCount: rescue.bodyWindow.coveredDistinctUnitCount,
			})),
			hanRescueAssessments: hanRescueSummary.assessments,
		});
	}
	const strongestOpaqueBodyWindow = bodyOpaqueRescues.reduce<BodyWindowCandidate | null>(
		(best, rescue) => {
			if (!rescue.promotesBodyWindow) {
				return best;
			}
			return best == null || compareBodyWindowCandidate(rescue.bodyWindow, best) < 0
				? rescue.bodyWindow
				: best;
		},
		null,
	);
	const bestBodyWindowContainer =
		strongestOpaqueBodyWindow == null
			? baseBestBodyWindowContainer
			: baseBestBodyWindowContainer == null
				? strongestOpaqueBodyWindow
				: pickStrongerBodyWindowCandidate(
						baseBestBodyWindowContainer,
						strongestOpaqueBodyWindow,
					);
	const bestBodyWindowBlockIds = new Set<number>(
		bestBodyWindowContainer?.blockIds ?? [],
	);
	const realizedFamilies = [
		...baseRealizedFamilies,
		...metadataOpaqueRescueUnits.map<RealizedQueryUnitFamily>((unit) => ({
			queryUnitIndex: unit.queryUnitIndex,
			queryUnitText: unit.queryUnitText,
			querySurfaceGroupIndex: unit.surfaceGroupIndex,
			familyId: unit.familyId,
			familyText: unit.familyText,
			matchKind: "opaque_exact",
			editDistance: 0,
			identityMetadataSource: unit.identityMetadataSource,
			routeMetadataSource: unit.routeMetadataSource,
			bodyPrefixSupportKind: "none",
			metadataPackingSource: unit.metadataPackingSource,
			inIdentity: unit.inIdentity,
			inRoute: unit.inRoute,
			inHeading: unit.inHeading,
			inBestBodyWindow: false,
			inBodyResidue: false,
		})),
		...bodyOpaqueRescues.map<RealizedQueryUnitFamily>((bodyOpaqueRescue) => ({
			queryUnitIndex: bodyOpaqueRescue.queryUnitIndex,
			queryUnitText: bodyOpaqueRescue.queryUnitText,
			querySurfaceGroupIndex: bodyOpaqueRescue.surfaceGroupIndex,
			familyId: bodyOpaqueRescue.familyId,
			familyText: bodyOpaqueRescue.familyText,
			matchKind: "opaque_exact",
			editDistance: 0,
			identityMetadataSource: "none",
			routeMetadataSource: "none",
			bodyPrefixSupportKind: "none",
			metadataPackingSource: "none",
			inIdentity: false,
			inRoute: false,
			inHeading: false,
			inBestBodyWindow:
				bodyOpaqueRescue.promotesBodyWindow &&
				bodyOpaqueRescue.bodyWindow.blockIds.some((blockId) =>
					bestBodyWindowBlockIds.has(blockId),
				),
			inBodyResidue:
				!bodyOpaqueRescue.promotesBodyWindow ||
				!bodyOpaqueRescue.bodyWindow.blockIds.every((blockId) =>
					bestBodyWindowBlockIds.has(blockId),
				),
		})),
	];

	const identityContainer = buildIdentityContainer(realizedFamilies);
	const routeContainer = buildRouteContainer(realizedFamilies);
	const bodyWindowContainer = bestBodyWindowContainer
		? bindBodyWindowToRealizedFamilies(bestBodyWindowContainer, realizedFamilies)
		: null;
	const routeProvidesNovelCoverage = routeContainerProvidesNovelCoverage(
		routeContainer,
		identityContainer,
		bodyWindowContainer,
	);
	const mainContainers = [
		identityContainer,
		routeProvidesNovelCoverage ? routeContainer : null,
		bodyWindowContainer,
	]
		.filter(
			(container): container is IdentityContainer | RouteContainer | BodyWindowContainer =>
				container != null,
		)
		.sort(compareContainerStrength);
	const strongestContainer = mainContainers[0] ?? null;
	const secondStrongestContainer = mainContainers[1] ?? null;
	const fragmentationPenalty = buildFragmentationPenalty(
		realizedFamilies,
		strongestContainer,
		secondStrongestContainer,
	);
	const hanSurfaceCompletionSummary = summarizeHanSurfaceCompletion(
		queryAnalysis,
		docEvidence.identityWitnessTexts,
		docEvidence.routeWitnessTexts,
		bodyWitnessTextsByBlockId,
		bestBodyWindowBlockIds,
	);
	const coverageGate = buildCoverageGateProfile(queryAnalysis, realizedFamilies, resolvedHanSurfaceGroupByIndex);
	const metadataPackingSignature = buildMetadataPackingSignature(realizedFamilies);
	const profile: EvidencePackingProfile = {
		docId: candidateRecall.docId,
		path: getDocPath(base, candidateRecall.docId),
		stableKey: getDocStableKey(base, candidateRecall.docId),
		surfaceCoverageShapeKey: queryAnalysis.surfaceCoverageShapeKey,
		realizedCoverageCount: realizedFamilies.length,
		coverageGate,
		exactUnitCount: realizedFamilies.filter((family) => family.matchKind === "exact").length,
		completedHanSurfaceGroupCount: hanSurfaceCompletionSummary.completedGroupCount,
		hanSurfaceCompletionTierScoreTotal: hanSurfaceCompletionSummary.tierScoreTotal,
		strongestHanSurfaceCompletionTier: hanSurfaceCompletionSummary.strongestTier,
		hanSurfaceCompletionGroups: hanSurfaceCompletionSummary.groups,
		hanStrongRescueGroupCount: hanRescueSummary.strongGroupCount,
		hanWeakRescueGroupCount: hanRescueSummary.weakGroupCount,
		hanRescueSupportWeightTotal: hanRescueSummary.supportWeightTotal,
		hasOnlyWeakHanRescue: hanRescueSummary.hasOnlyWeakHanRescue,
		hasAnyHanRescueAssessment: hanRescueSummary.hasAnyAssessment,
		hanRescueAssessments: hanRescueSummary.assessments,
		compoundBackedPrefixCount: realizedFamilies.filter((family) =>
			isCompoundBackedPrefixFamily(family),
		).length,
		prefixCompletionGainTotal: realizedFamilies.reduce((total, family) => {
			if (family.matchKind !== "prefix") {
				return total;
			}
			return total + Math.max(0, family.familyText.length - family.queryUnitText.length);
		}, 0),
		compoundPrefixCount: realizedFamilies.filter((family) =>
			isCompoundPrefixFamily(family),
		).length,
		fuzzyUnitCount: realizedFamilies.filter(
			(family) => family.matchKind === "fuzzy",
		).length,
		fuzzyEditDistanceTotal: realizedFamilies.reduce(
			(total, family) =>
				family.matchKind === "fuzzy" ? total + family.editDistance : total,
			0,
		),
		metadataPackingSignature,
		realizedFamilies,
		identityContainer,
		routeContainer,
		bodyWindowContainer,
		strongestContainer,
		secondStrongestContainer,
		fragmentationPenalty,
	};
	attachBlockShortlistSketch(profile, bodyWindowSelection.shortlist);
	return profile;
}

function getCachedDocEvidence(
	base: ResidentBase,
	docId: number,
): CachedDocEvidence {
	let cache = DOC_EVIDENCE_CACHE.get(base);
	if (cache == null) {
		cache = new Map<number, CachedDocEvidence>();
		DOC_EVIDENCE_CACHE.set(base, cache);
	}
	const existing = cache.get(docId);
	if (existing != null) {
		return existing;
	}
	const created: CachedDocEvidence = {
		identityFamilyIds: getDocIdentityFamilyIds(base, docId),
		routeFamilyIds: getDocRouteFamilyIds(base, docId),
		headingFamilyIds: getDocHeadingFamilyIds(base, docId),
		identitySourceMaskByFamilyId: buildMetadataSourceMaskByFamilyId(
			getDocIdentityFamilyIds(base, docId),
			getDocIdentitySourceMasks(base, docId),
		),
		routeSourceMaskByFamilyId: buildMetadataSourceMaskByFamilyId(
			getDocRouteFamilyIds(base, docId),
			getDocRouteSourceMasks(base, docId),
		),
		identityWitnessStringIds: getDocIdentityHanWitnessStringIds(base, docId),
		routeWitnessStringIds: getDocRouteHanWitnessStringIds(base, docId),
		headingWitnessStringIds: getDocHeadingHanWitnessStringIds(base, docId),
		identityWitnessTexts: getDocIdentityHanWitnessTexts(base, docId),
		identityWitnessSourceMasks: getDocIdentityHanWitnessSourceMasks(base, docId),
		routeWitnessTexts: getDocRouteHanWitnessTexts(base, docId),
		routeWitnessSourceMasks: getDocRouteHanWitnessSourceMasks(base, docId),
		headingWitnessTexts: getDocHeadingHanWitnessTexts(base, docId),
	};
	cache.set(docId, created);
	return created;
}

function buildMetadataSourceMaskByFamilyId(
	familyIds: readonly number[],
	sourceMasks: readonly number[],
): ReadonlyMap<number, number> {
	const sourceMaskByFamilyId = new Map<number, number>();
	for (let index = 0; index < familyIds.length; index += 1) {
		sourceMaskByFamilyId.set(
			familyIds[index],
			(sourceMaskByFamilyId.get(familyIds[index]) ?? 0) | (sourceMasks[index] ?? 0),
		);
	}
	return sourceMaskByFamilyId;
}

function getCachedBodyBlockEvidence(
	base: ResidentBase,
	blockId: number,
): CachedBodyBlockEvidence {
	let cache = BODY_BLOCK_EVIDENCE_CACHE.get(base);
	if (cache == null) {
		cache = new Map<number, CachedBodyBlockEvidence>();
		BODY_BLOCK_EVIDENCE_CACHE.set(base, cache);
	}
	const existing = cache.get(blockId);
	if (existing != null) {
		return existing;
	}
	const exactOccurrences = buildExactPositionedOccurrences(
		base,
		getBodyBlockExactFamilyIds(base, blockId),
		getBodyBlockExactTokenPositions(base, blockId),
	);
	const witnessOccurrences = buildWitnessPositionedOccurrences(
		base,
		getBodyBlockHanWitnessOccurrences(base, blockId),
	);
	const created: CachedBodyBlockEvidence = {
		exactOccurrences,
		witnessOccurrences,
		witnessTexts: getBodyBlockHanWitnessTexts(base, blockId),
		familySupportMaskByFamilyId: new Map(
			getBodyBlockFamilySupportEntries(base, blockId).map((entry) => [entry.familyId, entry.supportMask]),
		),
		approxSpan: Math.max(
			1,
			getPositionedOccurrenceSpan(exactOccurrences),
			getPositionedOccurrenceSpan(witnessOccurrences),
		),
		ordinalSpan: Math.max(1, exactOccurrences.length, witnessOccurrences.length),
	};
	cache.set(blockId, created);
	return created;
}

function buildSyntheticMetadataQueryUnitIndex(
	baseQueryUnitCount: number,
	ordinal: number,
): number {
	return baseQueryUnitCount + 700_000 + ordinal;
}

function buildSyntheticMetadataFamilyId(ordinal: number): number {
	return -(700_000 + ordinal + 1);
}

function buildSyntheticBodyQueryUnitIndex(
	baseQueryUnitCount: number,
	surfaceGroupIndex: number,
): number {
	return baseQueryUnitCount + 500_000 + surfaceGroupIndex;
}

function buildSyntheticBodyFamilyId(surfaceGroupIndex: number): number {
	return -(500_000 + surfaceGroupIndex + 1);
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

function routeContainerProvidesNovelCoverage(
	routeContainer: RouteContainer | null,
	identityContainer: IdentityContainer | null,
	bodyWindowContainer: BodyWindowContainer | null,
): boolean {
	if (routeContainer == null) {
		return false;
	}
	const coveredByIdentityOrBody = new Set<number>([
		...(identityContainer?.coveredUnitIndices ?? []),
		...(bodyWindowContainer?.coveredUnitIndices ?? []),
	]);
	return routeContainer.coveredUnitIndices.some(
		(unitIndex) => !coveredByIdentityOrBody.has(unitIndex),
	);
}

function collectBlockOccurrences(
	blockId: number,
	unitIndex: number,
	matches: readonly V3QueryFamilyMatch[],
	positionedOccurrences: readonly PositionedFamilyOccurrence[],
): BodyOccurrence[] {
	const occurrences: BodyOccurrence[] = [];
	for (const positionedOccurrence of positionedOccurrences) {
		const familyId = positionedOccurrence.familyId;
		const match = matches.find((candidate) => candidate.familyId === familyId);
		if (match == null) {
			continue;
		}
		occurrences.push({
			blockId,
			unitIndex,
			match,
			ordinalPosition: positionedOccurrence.ordinalPosition,
			localPosition: positionedOccurrence.localPosition,
			localEndPosition: positionedOccurrence.localEndPosition,
			ordinalVirtualPosition: positionedOccurrence.ordinalPosition,
			virtualPosition: positionedOccurrence.localPosition,
			virtualEndPosition: positionedOccurrence.localEndPosition,
		});
	}
	return occurrences;
}

function buildExactPositionedOccurrences(
	base: ResidentBase,
	familyIds: readonly number[],
	tokenPositions: readonly number[],
): PositionedFamilyOccurrence[] {
	let fallbackCursor = 0;
	return familyIds.map((familyId, index) => {
		const approxLength = Math.max(1, readFamilyApproxLength(base, familyId));
		const localPosition = tokenPositions[index] ?? fallbackCursor;
		const occurrence = {
			familyId,
			ordinalPosition: index,
			localPosition,
			localEndPosition: localPosition + approxLength,
		};
		fallbackCursor = localPosition + approxLength + 1;
		return occurrence;
	});
}

function buildWitnessPositionedOccurrences(
	base: ResidentBase,
	occurrences: ReadonlyArray<Readonly<{ stringId: number; start: number }>>,
): PositionedFamilyOccurrence[] {
	return occurrences.map((occurrence, index) => {
		const approxLength = Math.max(1, base.stringArena.lengths[occurrence.stringId] ?? 0);
		return {
			familyId: encodeWitnessMatchFamilyId(occurrence.stringId),
			ordinalPosition: index,
			localPosition: occurrence.start,
			localEndPosition: occurrence.start + approxLength,
		};
	});
}

function getPositionedOccurrenceSpan(
	occurrences: readonly PositionedFamilyOccurrence[],
): number {
	return occurrences[occurrences.length - 1]?.localEndPosition ?? 0;
}

function readFamilyApproxLength(base: ResidentBase, familyId: number): number {
	const stringId = base.familyLexicon.familyStringIds[familyId] ?? 0;
	return base.stringArena.lengths[stringId] ?? 0;
}

function compareMatchPreference(
	left: V3QueryFamilyMatch,
	right: V3QueryFamilyMatch,
): number {
	if (left.matchKind !== right.matchKind) {
		return compareMatchKindPreference(left.matchKind, right.matchKind);
	}
	if (left.editDistance !== right.editDistance) {
		return left.editDistance - right.editDistance;
	}
	if (left.familyText.length !== right.familyText.length) {
		return left.familyText.length - right.familyText.length;
	}
	return left.familyText.localeCompare(right.familyText);
}

function compareMatchKindPreference(
	left: V3QueryFamilyMatch["matchKind"],
	right: V3QueryFamilyMatch["matchKind"],
): number {
	return matchKindPreference(left) - matchKindPreference(right);
}

function matchKindPreference(kind: V3QueryFamilyMatch["matchKind"]): number {
	switch (kind) {
		case "exact":
			return 0;
		case "opaque_exact":
			return 1;
		case "prefix":
			return 2;
		case "fuzzy":
			return 3;
	}
}

function compareBodyOccurrenceOrder(left: BodyOccurrence, right: BodyOccurrence): number {
	if (left.localPosition !== right.localPosition) {
		return left.localPosition - right.localPosition;
	}
	if (left.localEndPosition !== right.localEndPosition) {
		return left.localEndPosition - right.localEndPosition;
	}
	const preference = compareMatchPreference(left.match, right.match);
	if (preference !== 0) {
		return preference;
	}
	if (left.unitIndex !== right.unitIndex) {
		return left.unitIndex - right.unitIndex;
	}
	return left.match.familyId - right.match.familyId;
}

function chooseBestBodyWindow(
	base: ResidentBase,
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
	headingFamilyIds: ReadonlySet<number>,
	options?: Readonly<{
		minDistinctUnitCount?: number;
	}>,
): BodyWindowSelection {
	const shortlistedBlockIds = [...bodyOccurrencesByBlockId.keys()].sort((left, right) => {
		const leftOrdinal = base.bodyBlocks.blockOrdinalByBlockId[left] ?? left;
		const rightOrdinal = base.bodyBlocks.blockOrdinalByBlockId[right] ?? right;
		return leftOrdinal - rightOrdinal || left - right;
	});
	let bestCandidate: BodyWindowCandidate | null = null;
	const shortlist: BlockShortlistItem[] = [];
	const prefilteredScopes = buildPrefilteredBodyScopes(
		base,
		shortlistedBlockIds,
		bodyOccurrencesByBlockId,
		bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId,
		options?.minDistinctUnitCount ?? 2,
	);
	for (const scope of prefilteredScopes) {
		const candidate = buildBodyWindowCandidateFromVirtualOccurrences(
			scope.virtualOccurrences,
			headingFamilyIds,
			options?.minDistinctUnitCount ?? 2,
		);
		if (candidate == null) {
			continue;
		}
		bestCandidate = pickStrongerBodyWindowCandidate(bestCandidate, candidate);
		pushShortlistCandidate(shortlist, toBlockShortlistItem(base, candidate));
	}
	return {
		bestCandidate,
		shortlist,
	};
}

function buildBodyWindowCandidateFromVirtualOccurrences(
	virtualOccurrences: readonly BodyOccurrence[],
	headingFamilyIds: ReadonlySet<number>,
	minDistinctUnitCount = 2,
): BodyWindowCandidate | null {
	if (virtualOccurrences.length === 0) {
		return null;
	}
	let bestWindow: BodyWindowCandidate | null = null;
	let bestSnapshot: BodyWindowShortlistSnapshot | null = null;
	for (let start = 0; start < virtualOccurrences.length; start += 1) {
		const state = createBodyWindowSearchState();
		for (let end = start; end < virtualOccurrences.length; end += 1) {
			const pushResult = pushBodyWindowOccurrence(
				state,
				virtualOccurrences[end],
			);
			// If the best representative set is unchanged, this window would
			// summarize to the same shortlist item as the previous `end`.
			if (
				pushResult.kind === "no_change" ||
				state.coveredDistinctUnitCount < minDistinctUnitCount
			) {
				continue;
			}
			if (!passesBodyWindowShortlistAdmission(state, minDistinctUnitCount)) {
				continue;
			}
			if (
				bestSnapshot == null ||
				compareBodyWindowShortlistState(state, bestSnapshot) < 0
			) {
				bestSnapshot = snapshotBodyWindowShortlistState(state);
				bestWindow = materializeBodyWindowCandidateFromShortlistState(
					state,
					headingFamilyIds,
				);
			}
		}
	}
	return bestWindow;
}

function createBodyWindowSearchState(): BodyWindowSearchState {
	return {
		representativeByUnit: new Map<number, BodyOccurrence>(),
		representativesByVirtualOrder: [],
		coveredUnitIndicesSorted: [],
		coveredDistinctUnitCount: 0,
		exactUnitCount: 0,
		blockCountById: new Map<number, number>(),
		blockIdsSorted: [],
		blockStart: 0,
		boundaryCrossingCount: 0,
		approxWindowStart: 0,
		approxWindowEnd: 0,
		approxHeadTailSpan: 1,
		approxMaxAdjacentGap: 0,
		approxTotalGapMass: 0,
		orderViolationCount: 0,
		preservesQueryOrder: true,
	};
}

function pushBodyWindowOccurrence(
	state: BodyWindowSearchState,
	occurrence: BodyOccurrence,
): BodyWindowPushResult {
	const current = state.representativeByUnit.get(occurrence.unitIndex);
	if (current != null && compareOccurrenceRepresentative(current, occurrence) <= 0) {
		return { kind: "no_change" };
	}
	if (current == null) {
		insertBodyWindowRepresentative(state, occurrence);
		return {
			kind: "insert_new_unit",
			previousRepresentative: null,
			nextRepresentative: occurrence,
		};
	}
	replaceBodyWindowRepresentative(state, current, occurrence);
	return {
		kind: "replace_existing_unit",
		previousRepresentative: current,
		nextRepresentative: occurrence,
	};
}

function insertBodyWindowRepresentative(
	state: BodyWindowSearchState,
	occurrence: BodyOccurrence,
): void {
	const unitInsertIndex = findSortedNumberInsertIndex(
		state.coveredUnitIndicesSorted,
		occurrence.unitIndex,
	);
	const previousUnitIndex = state.coveredUnitIndicesSorted[unitInsertIndex - 1];
	const nextUnitIndex = state.coveredUnitIndicesSorted[unitInsertIndex];
	state.orderViolationCount -= readOrderViolationCount(
		state.representativeByUnit,
		previousUnitIndex,
		nextUnitIndex,
	);
	state.representativeByUnit.set(occurrence.unitIndex, occurrence);
	state.coveredUnitIndicesSorted.splice(unitInsertIndex, 0, occurrence.unitIndex);
	state.coveredDistinctUnitCount += 1;
	if (occurrence.match.matchKind === "exact") {
		state.exactUnitCount += 1;
	}
	state.orderViolationCount += readOrderViolationCount(
		state.representativeByUnit,
		previousUnitIndex,
		occurrence.unitIndex,
	);
	state.orderViolationCount += readOrderViolationCount(
		state.representativeByUnit,
		occurrence.unitIndex,
		nextUnitIndex,
	);
	insertRepresentativeByVirtualOrder(state.representativesByVirtualOrder, occurrence);
	incrementBlockIdCount(state, occurrence.blockId);
	refreshBodyWindowShortlistStateDerived(state);
}

function replaceBodyWindowRepresentative(
	state: BodyWindowSearchState,
	previousRepresentative: BodyOccurrence,
	nextRepresentative: BodyOccurrence,
): void {
	const unitIndex = previousRepresentative.unitIndex;
	const unitSortedIndex = state.coveredUnitIndicesSorted.indexOf(unitIndex);
	const previousUnitIndex = state.coveredUnitIndicesSorted[unitSortedIndex - 1];
	const nextUnitIndex = state.coveredUnitIndicesSorted[unitSortedIndex + 1];
	state.orderViolationCount -= readOrderViolationCount(
		state.representativeByUnit,
		previousUnitIndex,
		unitIndex,
	);
	state.orderViolationCount -= readOrderViolationCount(
		state.representativeByUnit,
		unitIndex,
		nextUnitIndex,
	);
	removeRepresentativeByVirtualOrder(
		state.representativesByVirtualOrder,
		previousRepresentative,
	);
	decrementBlockIdCount(state, previousRepresentative.blockId);
	if (previousRepresentative.match.matchKind === "exact") {
		state.exactUnitCount -= 1;
	}
	state.representativeByUnit.set(unitIndex, nextRepresentative);
	if (nextRepresentative.match.matchKind === "exact") {
		state.exactUnitCount += 1;
	}
	insertRepresentativeByVirtualOrder(
		state.representativesByVirtualOrder,
		nextRepresentative,
	);
	incrementBlockIdCount(state, nextRepresentative.blockId);
	state.orderViolationCount += readOrderViolationCount(
		state.representativeByUnit,
		previousUnitIndex,
		unitIndex,
	);
	state.orderViolationCount += readOrderViolationCount(
		state.representativeByUnit,
		unitIndex,
		nextUnitIndex,
	);
	refreshBodyWindowShortlistStateDerived(state);
}

function buildChainVirtualOccurrences(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
): BodyOccurrence[] {
	const out: BodyOccurrence[] = [];
	let baseOffset = 0;
	let ordinalBaseOffset = 0;
	for (let index = 0; index < blockIds.length; index += 1) {
		const blockId = blockIds[index];
		const blockOccurrences = bodyOccurrencesByBlockId.get(blockId) ?? [];
		for (const occurrence of blockOccurrences) {
			out.push({
				...occurrence,
				ordinalVirtualPosition: ordinalBaseOffset + occurrence.ordinalPosition,
				virtualPosition: baseOffset + occurrence.localPosition,
				virtualEndPosition: baseOffset + occurrence.localEndPosition,
			});
		}
		baseOffset +=
			(bodyApproxSpanByBlockId.get(blockId) ??
				base.bodyBlocks.exactTapeCountByBlockId[blockId] ??
				0) + CHAIN_BOUNDARY_PENALTY;
		ordinalBaseOffset +=
			(bodyOrdinalSpanByBlockId.get(blockId) ??
				base.bodyBlocks.exactTapeCountByBlockId[blockId] ??
				0) + CHAIN_BOUNDARY_PENALTY;
	}
	return out.sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return compareBodyOccurrenceOrder(left, right);
	});
}

function buildPrefilteredBodyScopes(
	base: ResidentBase,
	shortlistedBlockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
	minDistinctUnitCount = 2,
): BodyScopePrefilter[] {
	const scopes: BodyScopePrefilter[] = [];
	for (const blockId of shortlistedBlockIds) {
		const scope = buildBodyScopePrefilter(
			base,
			[blockId],
			bodyOccurrencesByBlockId,
			bodyApproxSpanByBlockId,
			bodyOrdinalSpanByBlockId,
			minDistinctUnitCount,
		);
		if (scope != null) {
			scopes.push(scope);
		}
	}
	for (let index = 0; index < shortlistedBlockIds.length - 1; index += 1) {
		const leftBlockId = shortlistedBlockIds[index];
		const rightBlockId = shortlistedBlockIds[index + 1];
		const leftOrdinal = base.bodyBlocks.blockOrdinalByBlockId[leftBlockId] ?? leftBlockId;
		const rightOrdinal = base.bodyBlocks.blockOrdinalByBlockId[rightBlockId] ?? rightBlockId;
		if (rightOrdinal !== leftOrdinal + 1) {
			continue;
		}
		const scope = buildBodyScopePrefilter(
			base,
			[leftBlockId, rightBlockId],
			bodyOccurrencesByBlockId,
			bodyApproxSpanByBlockId,
			bodyOrdinalSpanByBlockId,
			minDistinctUnitCount,
		);
		if (scope != null) {
			scopes.push(scope);
		}
	}
	const buckets = new Map<number, BodyScopePrefilter[]>();
	for (const scope of scopes) {
		const bucket = buckets.get(scope.coveredDistinctUnitCount) ?? [];
		bucket.push(scope);
		buckets.set(scope.coveredDistinctUnitCount, bucket);
	}
	const selected: BodyScopePrefilter[] = [];
	for (const unitCount of [...buckets.keys()].sort((left, right) => right - left)) {
		const bucket = buckets.get(unitCount) ?? [];
		bucket.sort(compareBodyScopePrefilter);
		selected.push(...bucket.slice(0, BODY_WINDOW_PREFILTER_PER_BUCKET));
	}
	return selected;
}

function findSortedNumberInsertIndex(values: readonly number[], target: number): number {
	let index = 0;
	while (index < values.length && values[index] < target) {
		index += 1;
	}
	return index;
}

function compareRepresentativeVirtualOrder(
	left: BodyOccurrence,
	right: BodyOccurrence,
): number {
	if (left.virtualPosition !== right.virtualPosition) {
		return left.virtualPosition - right.virtualPosition;
	}
	return left.unitIndex - right.unitIndex;
}

function insertRepresentativeByVirtualOrder(
	representativesByVirtualOrder: BodyOccurrence[],
	occurrence: BodyOccurrence,
): void {
	let insertIndex = 0;
	while (
		insertIndex < representativesByVirtualOrder.length &&
		compareRepresentativeVirtualOrder(
			representativesByVirtualOrder[insertIndex],
			occurrence,
		) <= 0
	) {
		insertIndex += 1;
	}
	representativesByVirtualOrder.splice(insertIndex, 0, occurrence);
}

function removeRepresentativeByVirtualOrder(
	representativesByVirtualOrder: BodyOccurrence[],
	occurrence: BodyOccurrence,
): void {
	const index = representativesByVirtualOrder.findIndex(
		(candidate) => candidate === occurrence,
	);
	if (index >= 0) {
		representativesByVirtualOrder.splice(index, 1);
		return;
	}
	const fallbackIndex = representativesByVirtualOrder.findIndex(
		(candidate) =>
			candidate.unitIndex === occurrence.unitIndex &&
			candidate.virtualPosition === occurrence.virtualPosition &&
			candidate.virtualEndPosition === occurrence.virtualEndPosition &&
			candidate.blockId === occurrence.blockId &&
			candidate.match.familyId === occurrence.match.familyId,
	);
	if (fallbackIndex >= 0) {
		representativesByVirtualOrder.splice(fallbackIndex, 1);
	}
}

function incrementBlockIdCount(
	state: BodyWindowSearchState,
	blockId: number,
): void {
	const nextCount = (state.blockCountById.get(blockId) ?? 0) + 1;
	state.blockCountById.set(blockId, nextCount);
	if (nextCount === 1) {
		const insertIndex = findSortedNumberInsertIndex(state.blockIdsSorted, blockId);
		state.blockIdsSorted.splice(insertIndex, 0, blockId);
	}
}

function decrementBlockIdCount(
	state: BodyWindowSearchState,
	blockId: number,
): void {
	const currentCount = state.blockCountById.get(blockId) ?? 0;
	if (currentCount <= 1) {
		state.blockCountById.delete(blockId);
		const blockIndex = state.blockIdsSorted.indexOf(blockId);
		if (blockIndex >= 0) {
			state.blockIdsSorted.splice(blockIndex, 1);
		}
		return;
	}
	state.blockCountById.set(blockId, currentCount - 1);
}

function readOrderViolationCount(
	representativeByUnit: ReadonlyMap<number, BodyOccurrence>,
	leftUnitIndex: number | undefined,
	rightUnitIndex: number | undefined,
): number {
	if (leftUnitIndex == null || rightUnitIndex == null) {
		return 0;
	}
	const leftRepresentative = representativeByUnit.get(leftUnitIndex);
	const rightRepresentative = representativeByUnit.get(rightUnitIndex);
	if (leftRepresentative == null || rightRepresentative == null) {
		return 0;
	}
	return leftRepresentative.virtualPosition <= rightRepresentative.virtualPosition ? 0 : 1;
}

function refreshBodyWindowShortlistStateDerived(
	state: BodyWindowSearchState,
): void {
	state.blockStart = state.blockIdsSorted[0] ?? 0;
	state.boundaryCrossingCount = Math.max(0, state.blockIdsSorted.length - 1);
	const firstRepresentative = state.representativesByVirtualOrder[0];
	const lastRepresentative =
		state.representativesByVirtualOrder[state.representativesByVirtualOrder.length - 1];
	state.approxWindowStart = firstRepresentative?.virtualPosition ?? 0;
	state.approxWindowEnd = lastRepresentative?.virtualEndPosition ?? state.approxWindowStart;
	state.approxHeadTailSpan = Math.max(
		1,
		state.approxWindowEnd - state.approxWindowStart,
	);
	let approxMaxAdjacentGap = 0;
	let approxTotalGapMass = 0;
	for (let index = 1; index < state.representativesByVirtualOrder.length; index += 1) {
		const approxGap = Math.max(
			0,
			state.representativesByVirtualOrder[index].virtualPosition -
				state.representativesByVirtualOrder[index - 1].virtualEndPosition,
		);
		approxMaxAdjacentGap = Math.max(approxMaxAdjacentGap, approxGap);
		approxTotalGapMass += approxGap;
	}
	state.approxMaxAdjacentGap = approxMaxAdjacentGap;
	state.approxTotalGapMass = approxTotalGapMass;
	state.preservesQueryOrder = state.orderViolationCount === 0;
}

function buildBodyScopePrefilter(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
	minDistinctUnitCount = 2,
): BodyScopePrefilter | null {
	const virtualOccurrences = buildChainVirtualOccurrences(
		base,
		blockIds,
		bodyOccurrencesByBlockId,
		bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId,
	);
	if (virtualOccurrences.length === 0) {
		return null;
	}
	const representativeByUnit = new Map<number, BodyOccurrence>();
	for (const occurrence of virtualOccurrences) {
		const existing = representativeByUnit.get(occurrence.unitIndex);
		if (existing == null || compareOccurrenceRepresentative(occurrence, existing) < 0) {
			representativeByUnit.set(occurrence.unitIndex, occurrence);
		}
	}
	if (representativeByUnit.size < minDistinctUnitCount) {
		return null;
	}
	const representatives = [...representativeByUnit.values()].sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return left.unitIndex - right.unitIndex;
	});
	const approxWindowStart = representatives[0]?.virtualPosition ?? 0;
	const approxWindowEnd =
		representatives[representatives.length - 1]?.virtualEndPosition ?? approxWindowStart;
	const coveredUnitIndices = [...representativeByUnit.keys()].sort((left, right) => left - right);
	const preservesQueryOrder = coveredUnitIndices.every((unitIndex, index) => {
		if (index === 0) {
			return true;
		}
		const previous = representativeByUnit.get(coveredUnitIndices[index - 1]);
		const current = representativeByUnit.get(unitIndex);
		return (previous?.virtualPosition ?? 0) <= (current?.virtualPosition ?? 0);
	});
	return {
		blockIds,
		coveredDistinctUnitCount: representativeByUnit.size,
		preservesQueryOrder,
		approxWindowStart,
		approxWindowEnd,
		approxHeadTailSpan: Math.max(1, approxWindowEnd - approxWindowStart),
		priorityScore:
			representativeByUnit.size * 10000 +
			(preservesQueryOrder ? 500 : 0) -
			Math.max(1, approxWindowEnd - approxWindowStart) * 12 -
			(blockIds.length - 1) * 40,
		virtualOccurrences,
	};
}

function compareBodyScopePrefilter(left: BodyScopePrefilter, right: BodyScopePrefilter): number {
	if (left.coveredDistinctUnitCount !== right.coveredDistinctUnitCount) {
		return right.coveredDistinctUnitCount - left.coveredDistinctUnitCount;
	}
	if (left.preservesQueryOrder !== right.preservesQueryOrder) {
		return left.preservesQueryOrder ? -1 : 1;
	}
	if (left.approxHeadTailSpan !== right.approxHeadTailSpan) {
		return left.approxHeadTailSpan - right.approxHeadTailSpan;
	}
	if (left.priorityScore !== right.priorityScore) {
		return right.priorityScore - left.priorityScore;
	}
	return compareBlockIdLists(left.blockIds, right.blockIds);
}

function summarizeWindowCandidate(
	windowOccurrences: readonly BodyOccurrence[],
	headingFamilyIds: ReadonlySet<number>,
): BodyWindowCandidate | null {
	if (windowOccurrences.length === 0) {
		return null;
	}
	const representativeByUnit = new Map<number, BodyOccurrence>();
	for (const occurrence of windowOccurrences) {
		const existing = representativeByUnit.get(occurrence.unitIndex);
		if (existing == null || compareOccurrenceRepresentative(occurrence, existing) < 0) {
			representativeByUnit.set(occurrence.unitIndex, occurrence);
		}
	}
	const state = createBodyWindowSearchState();
	for (const representative of representativeByUnit.values()) {
		insertBodyWindowRepresentative(state, representative);
	}
	return materializeBodyWindowCandidateFromShortlistState(state, headingFamilyIds);
}

function materializeBodyWindowCandidateFromShortlistState(
	state: BodyWindowSearchState,
	headingFamilyIds: ReadonlySet<number>,
): BodyWindowCandidate | null {
	const representatives = [...state.representativesByVirtualOrder];
	const coveredUnitIndices = [...state.coveredUnitIndicesSorted];
	if (coveredUnitIndices.length === 0) {
		return null;
	}
	const ordinalSummary = buildOrdinalWindowSummary(representatives);
	const headingCorroborationUnitIndices = coveredUnitIndices.filter((unitIndex) => {
		const representative = state.representativeByUnit.get(unitIndex);
		return (
			representative != null &&
			headingFamilyIds.has(representative.match.familyId)
		);
	});
	return {
		tier: "bodyWindow",
		blockIds: [...state.blockIdsSorted],
		boundaryCrossingCount: state.boundaryCrossingCount,
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness:
			coveredUnitIndices.length * 1000 -
			state.approxHeadTailSpan * 16 -
			state.approxTotalGapMass * 10 -
			state.approxMaxAdjacentGap * 12 -
			state.boundaryCrossingCount * 80,
		exactUnitCount: state.exactUnitCount,
		windowWidth: ordinalSummary.windowWidth,
		gapCount: ordinalSummary.gapCount,
		density: coveredUnitIndices.length / Math.max(state.approxHeadTailSpan, 1),
		maxAdjacentGap: ordinalSummary.maxAdjacentGap,
		preservesQueryOrder: state.preservesQueryOrder,
		windowStart: ordinalSummary.windowStart,
		approxWindowStart: state.approxWindowStart,
		approxWindowEnd: state.approxWindowEnd,
		approxHeadTailSpan: state.approxHeadTailSpan,
		approxMaxAdjacentGap: state.approxMaxAdjacentGap,
		approxTotalGapMass: state.approxTotalGapMass,
		representatives,
		headingCorroboration: {
			coveredUnitIndices: headingCorroborationUnitIndices,
			unitCount: headingCorroborationUnitIndices.length,
		},
	};
}

function buildOrdinalWindowSummary(
	representatives: readonly BodyOccurrence[],
): OrdinalWindowSummary {
	const minPosition = representatives[0]?.ordinalVirtualPosition ?? 0;
	const maxPosition =
		representatives[representatives.length - 1]?.ordinalVirtualPosition ?? minPosition;
	let gapCount = 0;
	let maxAdjacentGap = 0;
	for (let index = 1; index < representatives.length; index += 1) {
		const gap = Math.max(
			0,
			representatives[index].ordinalVirtualPosition -
				representatives[index - 1].ordinalVirtualPosition -
				1,
		);
		gapCount += gap;
		maxAdjacentGap = Math.max(maxAdjacentGap, gap);
	}
	return {
		windowStart: minPosition,
		windowWidth: maxPosition - minPosition + 1,
		gapCount,
		maxAdjacentGap,
	};
}

function compareOccurrenceRepresentative(left: BodyOccurrence, right: BodyOccurrence): number {
	const preference = compareMatchPreference(left.match, right.match);
	if (preference !== 0) {
		return preference;
	}
	if (left.virtualPosition !== right.virtualPosition) {
		return left.virtualPosition - right.virtualPosition;
	}
	if (left.virtualEndPosition !== right.virtualEndPosition) {
		return left.virtualEndPosition - right.virtualEndPosition;
	}
	if (left.blockId !== right.blockId) {
		return left.blockId - right.blockId;
	}
	return left.match.familyId - right.match.familyId;
}

function passesBodyWindowShortlistAdmission(
	state: BodyWindowSearchState,
	minDistinctUnitCount = 2,
): boolean {
	if (minDistinctUnitCount <= 1) {
		return (
			state.coveredDistinctUnitCount >= 1 &&
			state.boundaryCrossingCount <= 1 &&
			state.approxMaxAdjacentGap <= 15 &&
			state.approxHeadTailSpan <= 160
		);
	}
	return passesBlockShortlistAdmission({
		coveredDistinctUnitCount: state.coveredDistinctUnitCount,
		boundaryCrossingCount: state.boundaryCrossingCount,
		approxMaxAdjacentGap: state.approxMaxAdjacentGap,
		approxHeadTailSpan: state.approxHeadTailSpan,
	});
}

function snapshotBodyWindowShortlistState(
	state: BodyWindowSearchState,
): BodyWindowShortlistSnapshot {
	return {
		blockStart: state.blockStart,
		boundaryCrossingCount: state.boundaryCrossingCount,
		coveredUnitIndices: [...state.coveredUnitIndicesSorted],
		coveredDistinctUnitCount: state.coveredDistinctUnitCount,
		representatives: [...state.representativesByVirtualOrder],
		approxWindowStart: state.approxWindowStart,
		approxWindowEnd: state.approxWindowEnd,
		approxHeadTailSpan: state.approxHeadTailSpan,
		approxMaxAdjacentGap: state.approxMaxAdjacentGap,
		approxTotalGapMass: state.approxTotalGapMass,
		preservesQueryOrder: state.preservesQueryOrder,
	};
}

function compareBodyWindowShortlistState(
	left: BodyWindowSearchState,
	right: BodyWindowShortlistSnapshot,
): number {
	if (left.coveredDistinctUnitCount !== right.coveredDistinctUnitCount) {
		return right.coveredDistinctUnitCount - left.coveredDistinctUnitCount;
	}
	if (left.preservesQueryOrder !== right.preservesQueryOrder) {
		return left.preservesQueryOrder ? -1 : 1;
	}
	if (left.approxHeadTailSpan !== right.approxHeadTailSpan) {
		return left.approxHeadTailSpan - right.approxHeadTailSpan;
	}
	if (left.approxMaxAdjacentGap !== right.approxMaxAdjacentGap) {
		return left.approxMaxAdjacentGap - right.approxMaxAdjacentGap;
	}
	if (left.approxTotalGapMass !== right.approxTotalGapMass) {
		return left.approxTotalGapMass - right.approxTotalGapMass;
	}
	if (left.boundaryCrossingCount !== right.boundaryCrossingCount) {
		return left.boundaryCrossingCount - right.boundaryCrossingCount;
	}
	if (left.blockStart !== right.blockStart) {
		return left.blockStart - right.blockStart;
	}
	if (left.approxWindowStart !== right.approxWindowStart) {
		return left.approxWindowStart - right.approxWindowStart;
	}
	return compareBodyWindowRepresentativeOrder(
		left.representativesByVirtualOrder,
		right.representatives,
	);
}

function compareBodyWindowRepresentativeOrder(
	left: readonly BodyOccurrence[],
	right: readonly BodyOccurrence[],
): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		if (left[index].unitIndex !== right[index].unitIndex) {
			return left[index].unitIndex - right[index].unitIndex;
		}
		if (left[index].virtualPosition !== right[index].virtualPosition) {
			return left[index].virtualPosition - right[index].virtualPosition;
		}
		if (left[index].virtualEndPosition !== right[index].virtualEndPosition) {
			return left[index].virtualEndPosition - right[index].virtualEndPosition;
		}
		if (left[index].blockId !== right[index].blockId) {
			return left[index].blockId - right[index].blockId;
		}
		if (left[index].match.familyId !== right[index].match.familyId) {
			return left[index].match.familyId - right[index].match.familyId;
		}
	}
	return left.length - right.length;
}

function compareBodyWindowCandidate(
	left: BodyWindowCandidate,
	right: BodyWindowCandidate,
): number {
	return compareBlockShortlistItems(
		toBlockShortlistItem(null, left),
		toBlockShortlistItem(null, right),
	);
}

function pickStrongerBodyWindowCandidate(
	current: BodyWindowCandidate | null,
	next: BodyWindowCandidate,
): BodyWindowCandidate {
	if (current == null || compareBodyWindowCandidate(next, current) < 0) {
		return next;
	}
	return current;
}

function pushShortlistCandidate(
	shortlist: BlockShortlistItem[],
	item: BlockShortlistItem,
): void {
	shortlist.push(item);
	shortlist.sort(compareBlockShortlistItems);
	if (shortlist.length > BLOCK_SHORTLIST_LIMIT) {
		shortlist.length = BLOCK_SHORTLIST_LIMIT;
	}
}

function toBlockShortlistItem(
	base: ResidentBase | null,
	candidate: BodyWindowCandidate,
): BlockShortlistItem {
	const representatives: BlockShortlistRepresentative[] = candidate.representatives.map(
		(representative) => ({
			queryUnitIndex: representative.unitIndex,
			familyId: representative.match.familyId,
			familyText: representative.match.familyText,
			matchKind: representative.match.matchKind,
			blockId: representative.blockId,
			approxStart: representative.virtualPosition,
			approxEnd: representative.virtualEndPosition,
		}),
	);
	const blockStartId = candidate.blockIds[0] ?? 0;
	const blockEndId = candidate.blockIds[candidate.blockIds.length - 1] ?? 0;
	return {
		blockStart:
			base?.bodyBlocks.blockOrdinalByBlockId[blockStartId] ?? blockStartId,
		blockEnd:
			base?.bodyBlocks.blockOrdinalByBlockId[blockEndId] ?? blockEndId,
		blockIds: candidate.blockIds,
		boundaryCrossingCount: candidate.boundaryCrossingCount,
		coveredUnitIndices: candidate.coveredUnitIndices,
		coveredDistinctUnitCount: candidate.coveredDistinctUnitCount,
		representatives,
		approxWindowStart: candidate.approxWindowStart,
		approxWindowEnd: candidate.approxWindowEnd,
		approxMaxAdjacentGap: candidate.approxMaxAdjacentGap,
		approxHeadTailSpan: candidate.approxHeadTailSpan,
		approxTotalGapMass: candidate.approxTotalGapMass,
		preservesQueryOrder: candidate.preservesQueryOrder,
		priorityScore: buildBlockShortlistPriorityScore(candidate),
	};
}

function compareBlockIdLists(left: readonly number[], right: readonly number[]): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		if (left[index] !== right[index]) {
			return left[index] - right[index];
		}
	}
	return left.length - right.length;
}

function resolveBodyPrefixSupportKind(mask: number): BodyPrefixSupportKind {
	const hasStandalone = (mask & BODY_FAMILY_SUPPORT_STANDALONE) !== 0;
	const hasCompound = (mask & BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD) !== 0;
	if (hasStandalone && hasCompound) {
		return "mixed";
	}
	if (hasCompound) {
		return "compound_only";
	}
	if (hasStandalone) {
		return "standalone";
	}
	return "none";
}

function isCompoundBackedPrefixFamily(family: RealizedQueryUnitFamily): boolean {
	return family.matchKind === "prefix" && family.bodyPrefixSupportKind === "compound_only";
}

function isCompoundPrefixFamily(family: RealizedQueryUnitFamily): boolean {
	return (
		family.matchKind === "prefix" &&
		(/[-_./]/u.test(family.familyText) || isCompoundBackedPrefixFamily(family))
	);
}

function selectRealizedFamilyForUnit(params: Readonly<{
	unitMatches: V3QueryUnitFamilyMatches;
	identityFamilyIds: ReadonlySet<number>;
	routeFamilyIds: ReadonlySet<number>;
	headingFamilyIds: ReadonlySet<number>;
	identitySourceMaskByFamilyId: ReadonlyMap<number, number>;
	routeSourceMaskByFamilyId: ReadonlyMap<number, number>;
	bodyBlockIdsByUnitFamily: ReadonlyMap<number, ReadonlyMap<number, ReadonlySet<number>>>;
	bodySupportMaskByUnitFamily: ReadonlyMap<number, ReadonlyMap<number, number>>;
	bestBodyWindowBlockIds: ReadonlySet<number>;
}>): RealizedQueryUnitFamily | null {
	const unitBodySupport = params.bodyBlockIdsByUnitFamily.get(params.unitMatches.queryUnitIndex);
	const unitBodySupportMasks = params.bodySupportMaskByUnitFamily.get(
		params.unitMatches.queryUnitIndex,
	);
	const candidates = params.unitMatches.matches
		.map((match) => {
			const bodyBlockIds = [...(unitBodySupport?.get(match.familyId) ?? [])];
			const inBestBodyWindow = bodyBlockIds.some((blockId) =>
				params.bestBodyWindowBlockIds.has(blockId),
			);
			const inBodyResidue = bodyBlockIds.some(
				(blockId) => !params.bestBodyWindowBlockIds.has(blockId),
			);
			const inIdentity = params.identityFamilyIds.has(match.familyId);
			const inRoute = params.routeFamilyIds.has(match.familyId);
			const inHeading = params.headingFamilyIds.has(match.familyId);
			const identityMetadataSource = decodeIdentityMetadataSource(
				params.identitySourceMaskByFamilyId.get(match.familyId) ?? 0,
			);
			const routeMetadataSource = decodeRouteMetadataSource(
				params.routeSourceMaskByFamilyId.get(match.familyId) ?? 0,
			);
			const bodyPrefixSupportKind = resolveBodyPrefixSupportKind(
				unitBodySupportMasks?.get(match.familyId) ?? 0,
			);
			const baseSupportScore =
				(inIdentity ? 8 : 0) +
				(inRoute ? 5 : 0) +
				(inBestBodyWindow ? 4 : 0) +
				(inBodyResidue ? 1 : 0);
			if (baseSupportScore <= 0) {
				return null;
			}
			const supportScore =
				baseSupportScore +
				(inHeading ? 1 : 0) +
				(match.matchKind === "exact" ? 1 : 0);
			return {
				match,
				inIdentity,
				inRoute,
				inHeading,
				identityMetadataSource,
				routeMetadataSource,
				metadataPackingSource: chooseMetadataPackingSource(
					identityMetadataSource,
					routeMetadataSource,
				),
				bodyPrefixSupportKind,
				inBestBodyWindow,
				inBodyResidue,
				supportScore,
			};
		})
		.filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
		.sort((left, right) => {
			if (left.supportScore !== right.supportScore) {
				return right.supportScore - left.supportScore;
			}
			const preference = compareMatchPreference(left.match, right.match);
			if (preference !== 0) {
				return preference;
			}
			return left.match.familyText.localeCompare(right.match.familyText);
		});
	const best = candidates[0];
	if (best == null) {
		return null;
	}
	return {
		queryUnitIndex: params.unitMatches.queryUnitIndex,
		queryUnitText: params.unitMatches.queryUnitText,
		querySurfaceGroupIndex: params.unitMatches.querySurfaceGroupIndex,
		familyId: best.match.familyId,
		familyText: best.match.familyText,
		matchKind: best.match.matchKind,
		editDistance: best.match.editDistance,
		identityMetadataSource: best.identityMetadataSource,
		routeMetadataSource: best.routeMetadataSource,
		metadataPackingSource: best.metadataPackingSource,
		bodyPrefixSupportKind: best.bodyPrefixSupportKind,
		inIdentity: best.inIdentity,
		inRoute: best.inRoute,
		inHeading: best.inHeading,
		inBestBodyWindow: best.inBestBodyWindow,
		inBodyResidue: best.inBodyResidue,
	};
}
function buildIdentityContainer(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
): IdentityContainer | null {
	const coveredUnitIndices = realizedFamilies
		.filter((family) => family.inIdentity)
		.map((family) => family.queryUnitIndex)
		.sort((left, right) => left - right);
	if (coveredUnitIndices.length === 0) {
		return null;
	}
	return {
		tier: "identity",
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness: coveredUnitIndices.length * 100 + 320,
		exactUnitCount: realizedFamilies.filter(
			(family) => family.inIdentity && family.matchKind === "exact",
		).length,
	};
}

function buildRouteContainer(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
): RouteContainer | null {
	const coveredUnitIndices = realizedFamilies
		.filter((family) => family.inRoute)
		.map((family) => family.queryUnitIndex)
		.sort((left, right) => left - right);
	if (coveredUnitIndices.length === 0) {
		return null;
	}
	return {
		tier: "route",
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness: coveredUnitIndices.length * 100 + 240,
		exactUnitCount: realizedFamilies.filter(
			(family) => family.inRoute && family.matchKind === "exact",
		).length,
	};
}

function bindBodyWindowToRealizedFamilies(
	bodyWindow: BodyWindowContainer,
	realizedFamilies: readonly RealizedQueryUnitFamily[],
): BodyWindowContainer {
	const bodyWindowBlockIds = new Set<number>(bodyWindow.blockIds);
	const coveredUnitIndices = realizedFamilies
		.filter((family) => family.inBestBodyWindow)
		.map((family) => family.queryUnitIndex)
		.sort((left, right) => left - right);
	const headingCorroboratedUnitIndices = realizedFamilies
		.filter((family) => family.inBestBodyWindow && family.inHeading)
		.map((family) => family.queryUnitIndex)
		.sort((left, right) => left - right);
	const blockIds = bodyWindow.blockIds.filter((blockId) => bodyWindowBlockIds.has(blockId));
	return {
		...bodyWindow,
		blockIds,
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		exactUnitCount: realizedFamilies.filter(
			(family) => family.inBestBodyWindow && family.matchKind === "exact",
		).length,
		headingCorroboration: buildHeadingCorroboration(headingCorroboratedUnitIndices),
	};
}

function buildHeadingCorroboration(
	coveredUnitIndices: readonly number[],
): HeadingCorroboration {
	return {
		coveredUnitIndices,
		unitCount: coveredUnitIndices.length,
	};
}

function buildMetadataPackingSignature(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
): MetadataPackingSignature {
	const basenameUnitCount = countMetadataPackingSource(realizedFamilies, "basename");
	const aliasUnitCount = countMetadataPackingSource(realizedFamilies, "alias");
	const routeUnitCount = countMetadataPackingSource(realizedFamilies, "route");
	const sortedBuckets = ([
		{ source: "basename", unitCount: basenameUnitCount },
		{ source: "alias", unitCount: aliasUnitCount },
		{ source: "route", unitCount: routeUnitCount },
	] as const)
		.filter((bucket) => bucket.unitCount > 0)
		.sort(compareMetadataPackingBucketOrder);
	return {
		basenameUnitCount,
		aliasUnitCount,
		routeUnitCount,
		sortedBuckets,
	};
}

function countMetadataPackingSource(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
	source: MetadataPackingSource,
): number {
	return realizedFamilies.filter(
		(family) => family.metadataPackingSource === source,
	).length;
}

function compareMetadataPackingBucketOrder(
	left: Readonly<{
		source: Exclude<MetadataPackingSource, "none">;
		unitCount: number;
	}>,
	right: Readonly<{
		source: Exclude<MetadataPackingSource, "none">;
		unitCount: number;
	}>,
): number {
	if (left.unitCount !== right.unitCount) {
		return right.unitCount - left.unitCount;
	}
	return getMetadataPackingSourceScore(right.source) - getMetadataPackingSourceScore(left.source);
}

function getMetadataPackingSourceScore(source: MetadataPackingSource): number {
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

function buildFragmentationPenalty(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
	strongestContainer: EvidenceContainer | null,
	secondStrongestContainer: EvidenceContainer | null,
): FragmentationPenalty {
	const explanatoryContainers = [strongestContainer, secondStrongestContainer].filter(
		(container): container is EvidenceContainer => container != null,
	);
	const coveredByTopTwo = new Set<number>([
		...(strongestContainer?.coveredUnitIndices ?? []),
		...(secondStrongestContainer?.coveredUnitIndices ?? []),
	]);
	return {
		bodyResidueUnitCount: realizedFamilies.filter((family) => family.inBodyResidue).length,
		uncoveredByTopTwoCount: realizedFamilies.filter(
			(family) => !coveredByTopTwo.has(family.queryUnitIndex),
		).length,
		explanatoryContainerCount: countExplanatoryContainers(
			realizedFamilies,
			explanatoryContainers,
			coveredByTopTwo,
		),
	};
}

function countExplanatoryContainers(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
	topContainers: readonly EvidenceContainer[],
	coveredByTopTwo: ReadonlySet<number>,
): number {
	let explanatoryContainerCount = topContainers.length;
	const corroborationContainers = [
		realizedFamilies
			.filter((family) => family.inIdentity)
			.map((family) => family.queryUnitIndex),
		realizedFamilies
			.filter((family) => family.inRoute)
			.map((family) => family.queryUnitIndex),
		realizedFamilies
			.filter((family) => family.inBestBodyWindow)
			.map((family) => family.queryUnitIndex),
	];
	const topContainerKeys = new Set(
		topContainers.map((container) => buildContainerCoverageKey(container.coveredUnitIndices)),
	);
	for (const coveredUnitIndices of corroborationContainers) {
		const dedupedIndices = Array.from(new Set(coveredUnitIndices)).sort(
			(left, right) => left - right,
		);
		if (dedupedIndices.length === 0) {
			continue;
		}
		if (topContainerKeys.has(buildContainerCoverageKey(dedupedIndices))) {
			continue;
		}
		if (dedupedIndices.some((unitIndex) => !coveredByTopTwo.has(unitIndex))) {
			explanatoryContainerCount += 1;
		}
	}
	return explanatoryContainerCount;
}

function materializeOpaqueMetadataRescueUnits(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	metadataWitnessBySurfaceGroupIndex: ReadonlyMap<
		number,
		SharedHanMetadataWitnessAssessmentCandidate
	>;
}>): OpaqueMetadataRescueUnit[] {
	const out: OpaqueMetadataRescueUnit[] = [];
	let syntheticOrdinal = 0;
	for (const [surfaceGroupIndex, witness] of params.metadataWitnessBySurfaceGroupIndex) {
		if (witness.assessment.strength !== "strong" || witness.matchedBigrams.length === 0) {
			continue;
		}
		for (const bigram of witness.matchedBigrams) {
			out.push({
				surfaceGroupIndex,
				queryUnitIndex: buildSyntheticMetadataQueryUnitIndex(
					params.queryAnalysis.primaryUnits.length,
					syntheticOrdinal,
				),
				queryUnitText: bigram,
				familyId: buildSyntheticMetadataFamilyId(syntheticOrdinal),
				familyText: bigram,
				assessment: witness.assessment,
				inIdentity: witness.kind === "identity",
				inRoute: witness.kind === "route",
				inHeading: witness.kind === "heading",
				identityMetadataSource: witness.identityMetadataSource,
				routeMetadataSource: witness.routeMetadataSource,
				metadataPackingSource: witness.metadataPackingSource,
			});
			syntheticOrdinal += 1;
		}
	}
	return out;
}

function materializeOpaqueBodyRescues(params: Readonly<{
	queryAnalysis: V3QueryAnalysis;
	bodyEvaluationBySurfaceGroupIndex: ReadonlyMap<
		number,
		HanBodyRescueEvaluation<BodyWindowCandidate>
	>;
}>): OpaqueBodyRescue[] {
	const out: OpaqueBodyRescue[] = [];
	for (const [surfaceGroupIndex, evaluation] of params.bodyEvaluationBySurfaceGroupIndex) {
		if (evaluation.assessment.strength !== "strong") {
			continue;
		}
		const group = params.queryAnalysis.surfaceGroups[surfaceGroupIndex];
		if (group == null || group.kind !== "han") {
			continue;
		}
		out.push({
			surfaceGroupIndex,
			queryUnitIndex: buildSyntheticBodyQueryUnitIndex(
				params.queryAnalysis.primaryUnits.length,
				surfaceGroupIndex,
			),
			queryUnitText: group.text,
			familyId: buildSyntheticBodyFamilyId(surfaceGroupIndex),
			familyText: group.text,
			bodyWindow: evaluation.bodyWindow,
			coverageRatio:
				evaluation.unresolvedBigrams.length > 0
					? evaluation.matchedBigrams.length / evaluation.unresolvedBigrams.length
					: 0,
			matchedBigramCount: evaluation.matchedBigrams.length,
			assessment: evaluation.assessment,
			promotesBodyWindow: true,
		});
	}
	return out;
}
function buildContainerCoverageKey(coveredUnitIndices: readonly number[]): string {
	return coveredUnitIndices.join(",");
}

function buildCoverageGateProfile(
	queryAnalysis: V3QueryAnalysis,
	realizedFamilies: readonly RealizedQueryUnitFamily[],
	resolvedHanSurfaceGroupByIndex: ReadonlyMap<number, V3ResolvedHanSurfaceGroup>,
): CoverageGateProfile {
	const realizedFamiliesByUnitIndex = new Map<number, RealizedQueryUnitFamily>(
		realizedFamilies.map((family) => [family.queryUnitIndex, family]),
	);
	const realizedFamiliesBySurfaceGroupIndex = new Map<number, RealizedQueryUnitFamily[]>();
	for (const family of realizedFamilies) {
		if (family.querySurfaceGroupIndex == null) {
			continue;
		}
		const existing = realizedFamiliesBySurfaceGroupIndex.get(family.querySurfaceGroupIndex);
		if (existing != null) {
			existing.push(family);
			continue;
		}
		realizedFamiliesBySurfaceGroupIndex.set(family.querySurfaceGroupIndex, [family]);
	}
	let fullySatisfiedSurfaceGroupCount = 0;
	let startedSurfaceGroupCount = 0;
	const fullySatisfiedScripts = new Set<V3QueryAnalysis["surfaceGroups"][number]["kind"]>();
	for (const group of queryAnalysis.surfaceGroups) {
		const groupPrimaryUnits = queryAnalysis.primaryUnits.filter(
			(unit) => unit.surfaceGroupIndex === group.index,
		);
		if (groupPrimaryUnits.length === 0) {
			continue;
		}
		let started = false;
		let fullySatisfied = false;
		if (group.kind !== "han") {
			started = groupPrimaryUnits.some((unit) => realizedFamiliesByUnitIndex.has(unit.index));
			fullySatisfied = started;
		} else {
			const groupRealizedFamilies =
				realizedFamiliesBySurfaceGroupIndex.get(group.index) ?? [];
			const realPrimaryUnits = groupPrimaryUnits.filter(
				(unit) => unit.source === "han_tokenizer_real",
			);
			if (realPrimaryUnits.length > 0) {
				const resolvedHanSurfaceGroup =
					resolvedHanSurfaceGroupByIndex.get(group.index) ?? null;
				const rescueBigrams = resolvedHanSurfaceGroup?.rescueBigrams ?? [];
				const anyRealUnitsSatisfied = realPrimaryUnits.some((unit) =>
					realizedFamiliesByUnitIndex.has(unit.index),
				);
				const allRealUnitsSatisfied = realPrimaryUnits.every((unit) =>
					realizedFamiliesByUnitIndex.has(unit.index),
				);
				const opaqueRescueSatisfied = rescueBigrams.every((bigram) =>
					groupRealizedFamilies.some(
						(family) =>
							family.matchKind === "opaque_exact" &&
							(family.familyText === bigram || family.queryUnitText === group.text),
					),
				);
				started =
					anyRealUnitsSatisfied ||
					groupRealizedFamilies.some((family) => family.matchKind === "opaque_exact");
				switch (resolvedHanSurfaceGroup?.rescueMode ?? "none") {
					case "whole_group_when_real_miss":
						fullySatisfied = opaqueRescueSatisfied;
						break;
					case "residual_only":
						fullySatisfied = allRealUnitsSatisfied && opaqueRescueSatisfied;
						break;
					default:
						fullySatisfied = allRealUnitsSatisfied;
						break;
				}
			} else {
				const rescueBigrams =
					resolvedHanSurfaceGroupByIndex.get(group.index)?.rescueBigrams ?? [];
				started = groupRealizedFamilies.some((family) => family.matchKind === "opaque_exact");
				fullySatisfied =
					started &&
					rescueBigrams.every((bigram) =>
						groupRealizedFamilies.some(
							(family) =>
								family.matchKind === "opaque_exact" &&
								(family.familyText === bigram || family.queryUnitText === group.text),
						),
					);
			}
		}
		if (started) {
			startedSurfaceGroupCount += 1;
		}
		if (!fullySatisfied) {
			continue;
		}
		fullySatisfiedSurfaceGroupCount += 1;
		fullySatisfiedScripts.add(group.kind);
	}
	const realizedCoverageCount = realizedFamilies.filter(
		(family) => family.matchKind !== "opaque_exact",
	).length;
	return {
		realizedCoverageCount,
		fullySatisfiedSurfaceGroupCount,
		startedSurfaceGroupCount,
		crossScriptSatisfiedGroupCount: fullySatisfiedScripts.size,
	};
}

function summarizeHanSurfaceCompletion(
	queryAnalysis: V3QueryAnalysis,
	identityWitnessTexts: readonly string[],
	routeWitnessTexts: readonly string[],
	bodyWitnessTextsByBlockId: ReadonlyMap<number, readonly string[]>,
	bestBodyWindowBlockIds: ReadonlySet<number>,
): HanSurfaceCompletionSummary {
	const groups = collectHanSurfaceCompletionGroups(queryAnalysis);
	const completionGroups = groups.map<HanSurfaceCompletionGroupResult>((group) => ({
		surfaceGroupIndex: group.surfaceGroupIndex,
		surfaceText: group.surfaceText,
		tier: resolveHanSurfaceCompletionTier(
			group.surfaceText,
			identityWitnessTexts,
			routeWitnessTexts,
			bodyWitnessTextsByBlockId,
			bestBodyWindowBlockIds,
		),
	}));
	let completedGroupCount = 0;
	let tierScoreTotal = 0;
	let strongestTier: HanSurfaceCompletionTier = "none";
	for (const group of completionGroups) {
		if (group.tier === "none") {
			continue;
		}
		completedGroupCount += 1;
		tierScoreTotal += getHanSurfaceCompletionTierScore(group.tier);
		if (
			getHanSurfaceCompletionTierScore(group.tier) >
			getHanSurfaceCompletionTierScore(strongestTier)
		) {
			strongestTier = group.tier;
		}
	}
	return {
		completedGroupCount,
		tierScoreTotal,
		strongestTier,
		groups: completionGroups,
	};
}

function collectHanSurfaceCompletionGroups(
	queryAnalysis: V3QueryAnalysis,
): HanSurfaceCompletionGroup[] {
	return queryAnalysis.surfaceGroups
		.filter(
			(group) =>
				group.kind === "han" &&
				Array.from(group.text).length >= 2 &&
				queryAnalysis.primaryUnits.some(
					(unit) =>
						unit.surfaceGroupIndex === group.index &&
						unit.source === "han_tokenizer_real",
				),
		)
		.map((group) => ({
			surfaceGroupIndex: group.index,
			surfaceText: group.text,
		}));
}

function resolveHanSurfaceCompletionTier(
	surfaceText: string,
	identityWitnessTexts: readonly string[],
	routeWitnessTexts: readonly string[],
	bodyWitnessTextsByBlockId: ReadonlyMap<number, readonly string[]>,
	bestBodyWindowBlockIds: ReadonlySet<number>,
): HanSurfaceCompletionTier {
	if (witnessTextsContainSurface(identityWitnessTexts, surfaceText)) {
		return "identity";
	}
	if (witnessTextsContainSurface(routeWitnessTexts, surfaceText)) {
		return "route";
	}
	for (const blockId of bestBodyWindowBlockIds) {
		if (witnessTextsContainSurface(bodyWitnessTextsByBlockId.get(blockId) ?? [], surfaceText)) {
			return "body_window";
		}
	}
	for (const [blockId, texts] of bodyWitnessTextsByBlockId.entries()) {
		if (bestBodyWindowBlockIds.has(blockId)) {
			continue;
		}
		if (witnessTextsContainSurface(texts, surfaceText)) {
			return "body_residue";
		}
	}
	return "none";
}

function witnessTextsContainSurface(
	witnessTexts: readonly string[],
	surfaceText: string,
): boolean {
	return witnessTexts.some((text) => text.includes(surfaceText));
}

function encodeWitnessMatchFamilyId(stringId: number): number {
	return -1 * (stringId + WITNESS_MATCH_FAMILY_ID_OFFSET);
}

function getHanSurfaceCompletionTierScore(tier: HanSurfaceCompletionTier): number {
	switch (tier) {
		case "identity":
			return 4;
		case "route":
			return 3;
		case "body_window":
			return 2;
		case "body_residue":
			return 1;
		default:
			return 0;
	}
}










