import type { ResidentBase } from "../layout/types";
import {
	attachBlockShortlistSketch,
	buildBlockShortlistPriorityScore,
	compareBlockShortlistItems,
	passesBlockShortlistAdmission,
	type BlockShortlistItem,
	type BlockShortlistRepresentative,
	type BlockShortlistSketch,
} from "../body-locality/shortlist";
import type { V3QueryAnalysis } from "../query";
import {
	getBodyBlockExactFamilyIds,
	getBodyBlockHanWitnessStringIds,
	getBodyBlockHanWitnessTexts,
	getDocHeadingFamilyIds,
	getDocHeadingHanWitnessStringIds,
	getDocHeadingHanWitnessTexts,
	getDocIdentityFamilyIds,
	getDocIdentityHanWitnessStringIds,
	getDocIdentityHanWitnessTexts,
	getDocIdentitySourceMasks,
	getDocPath,
	getDocRouteFamilyIds,
	getDocRouteHanWitnessStringIds,
	getDocRouteHanWitnessTexts,
	getDocRouteSourceMasks,
	getDocStableKey,
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
} from "../recall";
import { compareContainerStrength } from "./comparator";
import type {
	BodyWindowContainer,
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
	routeWitnessTexts: readonly string[];
}>;

type CachedBodyBlockEvidence = Readonly<{
	exactOccurrences: readonly PositionedFamilyOccurrence[];
	witnessOccurrences: readonly PositionedFamilyOccurrence[];
	witnessTexts: readonly string[];
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

type BodyWindowSearchState = Readonly<{
	representativeByUnit: Map<number, BodyOccurrence>;
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

export function buildPackingProfile(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	candidateRecall: V3CandidateDocRecall,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
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
	const mergedUnitFamilyMatches = mergeCandidateSpecificHanConfirmedMatches(
		base,
		queryAnalysis,
		candidateRecall,
		unitFamilyMatches,
		identityFamilyIds,
		routeFamilyIds,
		headingFamilyIds,
	);
	const bodyOccurrencesByBlockId = new Map<number, BodyOccurrence[]>();
	const bodyApproxSpanByBlockId = new Map<number, number>();
	const bodyOrdinalSpanByBlockId = new Map<number, number>();
	const bodyBlockIdsByUnitFamily = new Map<number, Map<number, Set<number>>>();
	const bodyWitnessTextsByBlockId = new Map<number, readonly string[]>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		const blockEvidence = getCachedBodyBlockEvidence(base, blockId);
		const exactOccurrences = blockEvidence.exactOccurrences;
		const witnessOccurrences = blockEvidence.witnessOccurrences;
		bodyWitnessTextsByBlockId.set(blockId, blockEvidence.witnessTexts);
		bodyApproxSpanByBlockId.set(blockId, blockEvidence.approxSpan);
		bodyOrdinalSpanByBlockId.set(blockId, blockEvidence.ordinalSpan);
		const blockOccurrences: BodyOccurrence[] = [];
		for (const unitMatches of mergedUnitFamilyMatches) {
			const occurrences = collectBlockOccurrences(
				blockId,
				unitMatches.queryUnitIndex,
				unitMatches.matches,
				unitMatches.queryUnitSource === "opaque_han_confirmed"
					? witnessOccurrences
					: exactOccurrences,
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
	const bestBodyWindowContainer = bodyWindowSelection.bestCandidate;
	const bestBodyWindowBlockIds = new Set<number>(
		bestBodyWindowContainer?.blockIds ?? [],
	);
	const realizedFamilies = mergedUnitFamilyMatches
		.map((unitMatches) =>
			selectRealizedFamilyForUnit({
				unitMatches,
				identityFamilyIds,
				routeFamilyIds,
				headingFamilyIds,
				identitySourceMaskByFamilyId: docEvidence.identitySourceMaskByFamilyId,
				routeSourceMaskByFamilyId: docEvidence.routeSourceMaskByFamilyId,
				bodyBlockIdsByUnitFamily,
				bestBodyWindowBlockIds,
			}),
		)
		.filter((realized): realized is RealizedQueryUnitFamily => realized != null);

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
	const coverageGate = buildCoverageGateProfile(queryAnalysis, realizedFamilies);
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
		prefixCompletionGainTotal: realizedFamilies.reduce((total, family) => {
			if (family.matchKind !== "prefix") {
				return total;
			}
			return total + Math.max(0, family.familyText.length - family.queryUnitText.length);
		}, 0),
		compoundPrefixCount: realizedFamilies.filter(
			(family) =>
				family.matchKind === "prefix" && /[_./-]/u.test(family.familyText),
		).length,
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
		routeWitnessTexts: getDocRouteHanWitnessTexts(base, docId),
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
	);
	const witnessOccurrences = buildWitnessPositionedOccurrences(
		base,
		getBodyBlockHanWitnessStringIds(base, blockId),
	);
	const created: CachedBodyBlockEvidence = {
		exactOccurrences,
		witnessOccurrences,
		witnessTexts: getBodyBlockHanWitnessTexts(base, blockId),
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

function mergeCandidateSpecificHanConfirmedMatches(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	candidateRecall: V3CandidateDocRecall,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	identityFamilyIds: ReadonlySet<number>,
	routeFamilyIds: ReadonlySet<number>,
	headingFamilyIds: ReadonlySet<number>,
): V3QueryUnitFamilyMatches[] {
	const candidateBodyWitnessStringIds = new Set<number>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		for (const stringId of getBodyBlockHanWitnessStringIds(base, blockId)) {
			candidateBodyWitnessStringIds.add(stringId);
		}
	}
	const candidateMetadataWitnessStringIds = new Set<number>([
		...getDocIdentityHanWitnessStringIds(base, candidateRecall.docId),
		...getDocRouteHanWitnessStringIds(base, candidateRecall.docId),
		...getDocHeadingHanWitnessStringIds(base, candidateRecall.docId),
	]);
	return unitFamilyMatches.map<V3QueryUnitFamilyMatches>((unitMatches) => {
		if (unitMatches.queryUnitSource !== "opaque_han_confirmed") {
			return unitMatches;
		}
		const mergedMatches = new Map<string, V3QueryFamilyMatch>();
		for (const match of unitMatches.matches) {
			mergedMatches.set(`${match.familyId}:${match.matchKind}`, match);
		}
		for (const stringId of [
			...candidateMetadataWitnessStringIds,
			...candidateBodyWitnessStringIds,
		]) {
			const familyText = readWitnessText(base, stringId);
			if (!familyText.includes(unitMatches.queryUnitText)) {
				continue;
			}
			const confirmedMatch: V3QueryFamilyMatch = {
				familyId: encodeWitnessMatchFamilyId(stringId),
				familyText,
				matchKind: "opaque_exact",
			};
			mergedMatches.set(`${confirmedMatch.familyId}:opaque_exact`, confirmedMatch);
		}
		return {
			...unitMatches,
			matches: [...mergedMatches.values()].sort((left, right) =>
				compareMatchPreference(left, right),
			),
		};
	});
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
): PositionedFamilyOccurrence[] {
	let cursor = 0;
	return familyIds.map((familyId, index) => {
		const approxLength = Math.max(1, readFamilyApproxLength(base, familyId));
		const occurrence = {
			familyId,
			ordinalPosition: index,
			localPosition: cursor,
			localEndPosition: cursor + approxLength,
		};
		cursor += approxLength + 1;
		return occurrence;
	});
}

function buildWitnessPositionedOccurrences(
	base: ResidentBase,
	stringIds: readonly number[],
): PositionedFamilyOccurrence[] {
	let cursor = 0;
	return stringIds.map((stringId, index) => {
		const approxLength = Math.max(1, base.stringArena.lengths[stringId] ?? 0);
		const occurrence = {
			familyId: encodeWitnessMatchFamilyId(stringId),
			ordinalPosition: index,
			localPosition: cursor,
			localEndPosition: cursor + approxLength,
		};
		cursor += approxLength + 1;
		return occurrence;
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
	);
	for (const scope of prefilteredScopes) {
		const candidate = buildBodyWindowCandidateFromVirtualOccurrences(
			scope.virtualOccurrences,
			headingFamilyIds,
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
): BodyWindowCandidate | null {
	if (virtualOccurrences.length === 0) {
		return null;
	}
	let bestWindow: BodyWindowCandidate | null = null;
	for (let start = 0; start < virtualOccurrences.length; start += 1) {
		const state = createBodyWindowSearchState();
		for (let end = start; end < virtualOccurrences.length; end += 1) {
			const representativeChanged = pushBodyWindowOccurrence(
				state,
				virtualOccurrences[end],
			);
			// If the best representative set is unchanged, this window would
			// summarize to the same shortlist item as the previous `end`.
			if (!representativeChanged || state.representativeByUnit.size < 2) {
				continue;
			}
			const candidate = summarizeWindowCandidateFromRepresentatives(
				state.representativeByUnit,
				headingFamilyIds,
			);
			if (candidate == null || !passesBodyWindowAdmission(candidate)) {
				continue;
			}
			if (bestWindow == null || compareBodyWindowCandidate(candidate, bestWindow) < 0) {
				bestWindow = candidate;
			}
		}
	}
	return bestWindow;
}

function createBodyWindowSearchState(): BodyWindowSearchState {
	return {
		representativeByUnit: new Map<number, BodyOccurrence>(),
	};
}

function pushBodyWindowOccurrence(
	state: BodyWindowSearchState,
	occurrence: BodyOccurrence,
): boolean {
	const current = state.representativeByUnit.get(occurrence.unitIndex);
	if (current != null && compareOccurrenceRepresentative(current, occurrence) <= 0) {
		return false;
	}
	state.representativeByUnit.set(occurrence.unitIndex, occurrence);
	return true;
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
): BodyScopePrefilter[] {
	const scopes: BodyScopePrefilter[] = [];
	for (const blockId of shortlistedBlockIds) {
		const scope = buildBodyScopePrefilter(
			base,
			[blockId],
			bodyOccurrencesByBlockId,
			bodyApproxSpanByBlockId,
			bodyOrdinalSpanByBlockId,
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

function buildBodyScopePrefilter(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
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
	if (representativeByUnit.size < 2) {
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
	const representatives = [...representativeByUnit.values()].sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return left.unitIndex - right.unitIndex;
	});
	const coveredUnitIndices = [...representativeByUnit.keys()].sort((left, right) => left - right);
	if (coveredUnitIndices.length === 0) {
		return null;
	}
	const minPosition = representatives[0]?.ordinalVirtualPosition ?? 0;
	const maxPosition =
		representatives[representatives.length - 1]?.ordinalVirtualPosition ?? minPosition;
	const windowWidth = maxPosition - minPosition + 1;
	let totalGap = 0;
	let maxAdjacentGap = 0;
	const approxWindowStart = representatives[0]?.virtualPosition ?? 0;
	const approxWindowEnd =
		representatives[representatives.length - 1]?.virtualEndPosition ??
		approxWindowStart;
	let approxMaxAdjacentGap = 0;
	let approxTotalGapMass = 0;
	for (let index = 1; index < representatives.length; index += 1) {
		const gap = Math.max(
			0,
			representatives[index].ordinalVirtualPosition -
				representatives[index - 1].ordinalVirtualPosition -
				1,
		);
		totalGap += gap;
		maxAdjacentGap = Math.max(maxAdjacentGap, gap);
		const approxGap = Math.max(
			0,
			representatives[index].virtualPosition -
				representatives[index - 1].virtualEndPosition,
		);
		approxMaxAdjacentGap = Math.max(approxMaxAdjacentGap, approxGap);
		approxTotalGapMass += approxGap;
	}
	const blockIds = [...new Set(representatives.map((occurrence) => occurrence.blockId))].sort(
		(left, right) => left - right,
	);
	const exactUnitCount = coveredUnitIndices.filter((unitIndex) => {
		const representative = representativeByUnit.get(unitIndex);
		return representative?.match.matchKind === "exact";
	}).length;
	const preservesQueryOrder = coveredUnitIndices.every((unitIndex, index) => {
		if (index === 0) {
			return true;
		}
		const previous = representativeByUnit.get(coveredUnitIndices[index - 1]);
		const current = representativeByUnit.get(unitIndex);
		return (previous?.virtualPosition ?? 0) <= (current?.virtualPosition ?? 0);
	});
	const boundaryCrossingCount = Math.max(0, blockIds.length - 1);
	const headingCorroborationUnitIndices = coveredUnitIndices.filter((unitIndex) => {
		const representative = representativeByUnit.get(unitIndex);
		return (
			representative != null &&
			headingFamilyIds.has(representative.match.familyId)
		);
	});
	return {
		tier: "bodyWindow",
		blockIds,
		boundaryCrossingCount,
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness:
			coveredUnitIndices.length * 1000 -
			Math.max(1, approxWindowEnd - approxWindowStart) * 16 -
			approxTotalGapMass * 10 -
			approxMaxAdjacentGap * 12 -
			boundaryCrossingCount * 80,
		exactUnitCount,
		windowWidth,
		gapCount: totalGap,
		density: coveredUnitIndices.length / Math.max(approxWindowEnd - approxWindowStart, 1),
		maxAdjacentGap,
		preservesQueryOrder,
		windowStart: minPosition,
		approxWindowStart,
		approxWindowEnd,
		approxHeadTailSpan: Math.max(1, approxWindowEnd - approxWindowStart),
		approxMaxAdjacentGap,
		approxTotalGapMass,
		representatives,
		headingCorroboration: {
			coveredUnitIndices: headingCorroborationUnitIndices,
			unitCount: headingCorroborationUnitIndices.length,
		},
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

function passesBodyWindowAdmission(candidate: BodyWindowCandidate): boolean {
	return passesBlockShortlistAdmission(candidate);
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

function selectRealizedFamilyForUnit(params: Readonly<{
	unitMatches: V3QueryUnitFamilyMatches;
	identityFamilyIds: ReadonlySet<number>;
	routeFamilyIds: ReadonlySet<number>;
	headingFamilyIds: ReadonlySet<number>;
	identitySourceMaskByFamilyId: ReadonlyMap<number, number>;
	routeSourceMaskByFamilyId: ReadonlyMap<number, number>;
	bodyBlockIdsByUnitFamily: ReadonlyMap<number, ReadonlyMap<number, ReadonlySet<number>>>;
	bestBodyWindowBlockIds: ReadonlySet<number>;
}>): RealizedQueryUnitFamily | null {
	const unitBodySupport = params.bodyBlockIdsByUnitFamily.get(params.unitMatches.queryUnitIndex);
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
		familyId: best.match.familyId,
		familyText: best.match.familyText,
		matchKind: best.match.matchKind,
		identityMetadataSource: best.identityMetadataSource,
		routeMetadataSource: best.routeMetadataSource,
		metadataPackingSource: best.metadataPackingSource,
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

function getMetadataPackingSourceScore(source: Exclude<MetadataPackingSource, "none">): number {
	switch (source) {
		case "basename":
			return 3;
		case "alias":
			return 2;
		case "route":
			return 1;
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

function buildContainerCoverageKey(coveredUnitIndices: readonly number[]): string {
	return coveredUnitIndices.join(",");
}

function buildCoverageGateProfile(
	queryAnalysis: V3QueryAnalysis,
	realizedFamilies: readonly RealizedQueryUnitFamily[],
): CoverageGateProfile {
	const realizedFamiliesByUnitIndex = new Map<number, RealizedQueryUnitFamily>(
		realizedFamilies.map((family) => [family.queryUnitIndex, family]),
	);
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
			const realPrimaryUnits = groupPrimaryUnits.filter(
				(unit) => unit.source === "han_tokenizer_real",
			);
			if (realPrimaryUnits.length > 0) {
				started = realPrimaryUnits.some((unit) => realizedFamiliesByUnitIndex.has(unit.index));
				fullySatisfied = realPrimaryUnits.every((unit) => realizedFamiliesByUnitIndex.has(unit.index));
			} else {
				const opaqueConfirmedUnits = groupPrimaryUnits.filter(
					(unit) =>
						unit.source === "opaque_han_confirmed" &&
						realizedFamiliesByUnitIndex.get(unit.index)?.matchKind === "opaque_exact",
				);
				started = opaqueConfirmedUnits.length > 0;
				fullySatisfied = started;
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
	return {
		realizedCoverageCount: realizedFamilies.length,
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

function readWitnessText(base: ResidentBase, stringId: number): string {
	const offset = base.stringArena.offsets[stringId] ?? 0;
	const length = base.stringArena.lengths[stringId] ?? 0;
	return base.stringArena.text.slice(offset, offset + length);
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
