import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis } from "../query";
import {
	getBodyBlockExactFamilyIds,
	getBodyBlockHanWitnessFamilyIds,
	getBodyBlockExactTokenPositions,
	getFamilyText,
	getDocHeadingFamilyIds,
	getDocHeadingHanWitnessFamilyIds,
	getDocIdentityFamilyIds,
	getDocIdentityHanWitnessFamilyIds,
	getDocPath,
	getDocRouteFamilyIds,
	getDocRouteHanWitnessFamilyIds,
	getDocStableKey,
} from "../recall";
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
	RealizedQueryUnitFamily,
	RouteContainer,
} from "./types";

const CHAIN_BOUNDARY_PENALTY = 2;

type BodyOccurrence = Readonly<{
	blockId: number;
	unitIndex: number;
	match: V3QueryFamilyMatch;
	localPosition: number;
	virtualPosition: number;
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
	headingCorroboration: HeadingCorroboration;
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
	const identityWitnessFamilyIds = getDocIdentityHanWitnessFamilyIds(base, candidateRecall.docId);
	const routeWitnessFamilyIds = getDocRouteHanWitnessFamilyIds(base, candidateRecall.docId);
	const headingWitnessFamilyIds = getDocHeadingHanWitnessFamilyIds(base, candidateRecall.docId);
	const identityFamilyIds = new Set<number>([
		...getDocIdentityFamilyIds(base, candidateRecall.docId),
		...identityWitnessFamilyIds,
	]);
	const routeFamilyIds = new Set<number>([
		...getDocRouteFamilyIds(base, candidateRecall.docId),
		...routeWitnessFamilyIds,
	]);
	const headingFamilyIds = new Set<number>([
		...getDocHeadingFamilyIds(base, candidateRecall.docId),
		...headingWitnessFamilyIds,
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
	const bodyBlockIdsByUnitFamily = new Map<number, Map<number, Set<number>>>();
	const bodyWitnessFamilyIdsByBlockId = new Map<number, readonly number[]>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		const exactFamilyIds = getBodyBlockExactFamilyIds(base, blockId);
		const witnessFamilyIds = getBodyBlockHanWitnessFamilyIds(base, blockId);
		bodyWitnessFamilyIdsByBlockId.set(blockId, witnessFamilyIds);
		const tokenPositions = getBodyBlockExactTokenPositions(base, blockId);
		const blockOccurrences: BodyOccurrence[] = [];
		for (const unitMatches of mergedUnitFamilyMatches) {
			const occurrences = collectBlockOccurrences(
				blockId,
				unitMatches.queryUnitIndex,
				unitMatches.matches,
				unitMatches.queryUnitSource === "opaque_han_confirmed"
					? witnessFamilyIds
					: exactFamilyIds,
				unitMatches.queryUnitSource === "opaque_han_confirmed"
					? witnessFamilyIds.map((_, index) => index)
					: tokenPositions,
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

	const bestBodyWindowContainer = chooseBestBodyWindow(
		base,
		bodyOccurrencesByBlockId,
		headingFamilyIds,
	);
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
	const mainContainers = [identityContainer, routeContainer, bodyWindowContainer]
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
		base,
		queryAnalysis,
		identityWitnessFamilyIds,
		routeWitnessFamilyIds,
		bodyWitnessFamilyIdsByBlockId,
		bestBodyWindowBlockIds,
	);
	const coverageGate = buildCoverageGateProfile(queryAnalysis, realizedFamilies);
	return {
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
		realizedFamilies,
		identityContainer,
		routeContainer,
		bodyWindowContainer,
		strongestContainer,
		secondStrongestContainer,
		fragmentationPenalty,
	};
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
	const candidateBodyWitnessFamilyIds = new Set<number>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		for (const familyId of getBodyBlockHanWitnessFamilyIds(base, blockId)) {
			candidateBodyWitnessFamilyIds.add(familyId);
		}
	}
	const candidateMetadataWitnessFamilyIds = new Set<number>([
		...getDocIdentityHanWitnessFamilyIds(base, candidateRecall.docId),
		...getDocRouteHanWitnessFamilyIds(base, candidateRecall.docId),
		...getDocHeadingHanWitnessFamilyIds(base, candidateRecall.docId),
	]);
	return unitFamilyMatches.map<V3QueryUnitFamilyMatches>((unitMatches) => {
		if (unitMatches.queryUnitSource !== "opaque_han_confirmed") {
			return unitMatches;
		}
		const mergedMatches = new Map<string, V3QueryFamilyMatch>();
		for (const match of unitMatches.matches) {
			mergedMatches.set(`${match.familyId}:${match.matchKind}`, match);
		}
		for (const familyId of [
			...candidateMetadataWitnessFamilyIds,
			...candidateBodyWitnessFamilyIds,
		]) {
			const familyText = getFamilyText(base, familyId);
			if (!familyText.includes(unitMatches.queryUnitText)) {
				continue;
			}
			const confirmedMatch: V3QueryFamilyMatch = {
				familyId,
				familyText,
				matchKind: "opaque_exact",
			};
			mergedMatches.set(`${familyId}:opaque_exact`, confirmedMatch);
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
	familyIds: readonly number[],
	positions: readonly number[],
): BodyOccurrence[] {
	const occurrences: BodyOccurrence[] = [];
	for (let index = 0; index < familyIds.length; index += 1) {
		const familyId = familyIds[index];
		const match = matches.find((candidate) => candidate.familyId === familyId);
		if (match == null) {
			continue;
		}
		occurrences.push({
			blockId,
			unitIndex,
			match,
			localPosition: positions[index] ?? index,
			virtualPosition: positions[index] ?? index,
		});
	}
	return occurrences;
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
	headingFamilyIds: ReadonlySet<number>,
): BodyWindowContainer | null {
	const shortlistedBlockIds = [...bodyOccurrencesByBlockId.keys()].sort((left, right) => {
		const leftOrdinal = base.bodyBlocks.blockOrdinalByBlockId[left] ?? left;
		const rightOrdinal = base.bodyBlocks.blockOrdinalByBlockId[right] ?? right;
		return leftOrdinal - rightOrdinal || left - right;
	});
	const candidates: BodyWindowCandidate[] = [];
	for (const blockId of shortlistedBlockIds) {
		const singleCandidate = buildBodyWindowCandidate(
			base,
			[blockId],
			bodyOccurrencesByBlockId,
			headingFamilyIds,
		);
		if (singleCandidate != null) {
			candidates.push(singleCandidate);
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
		const pairCandidate = buildBodyWindowCandidate(
			base,
			[leftBlockId, rightBlockId],
			bodyOccurrencesByBlockId,
			headingFamilyIds,
		);
		if (pairCandidate != null) {
			candidates.push(pairCandidate);
		}
	}
	return candidates.sort(compareBodyWindowCandidate)[0] ?? null;
}

function buildBodyWindowCandidate(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	headingFamilyIds: ReadonlySet<number>,
): BodyWindowCandidate | null {
	const virtualOccurrences = buildChainVirtualOccurrences(base, blockIds, bodyOccurrencesByBlockId);
	if (virtualOccurrences.length === 0) {
		return null;
	}
	let bestWindow: BodyWindowCandidate | null = null;
	for (let start = 0; start < virtualOccurrences.length; start += 1) {
		for (let end = start; end < virtualOccurrences.length; end += 1) {
			const candidate = summarizeWindowCandidate(
				virtualOccurrences.slice(start, end + 1),
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

function buildChainVirtualOccurrences(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
): BodyOccurrence[] {
	const out: BodyOccurrence[] = [];
	let baseOffset = 0;
	for (let index = 0; index < blockIds.length; index += 1) {
		const blockId = blockIds[index];
		const blockOccurrences = bodyOccurrencesByBlockId.get(blockId) ?? [];
		for (const occurrence of blockOccurrences) {
			out.push({
				...occurrence,
				virtualPosition: baseOffset + occurrence.localPosition,
			});
		}
		baseOffset +=
			(base.bodyBlocks.exactTapeCountByBlockId[blockId] ?? 0) + CHAIN_BOUNDARY_PENALTY;
	}
	return out.sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return compareBodyOccurrenceOrder(left, right);
	});
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
	const minPosition = representatives[0]?.virtualPosition ?? 0;
	const maxPosition =
		representatives[representatives.length - 1]?.virtualPosition ?? minPosition;
	const windowWidth = maxPosition - minPosition + 1;
	let totalGap = 0;
	let maxAdjacentGap = 0;
	for (let index = 1; index < representatives.length; index += 1) {
		const gap = Math.max(
			0,
			representatives[index].virtualPosition -
				representatives[index - 1].virtualPosition -
				1,
		);
		totalGap += gap;
		maxAdjacentGap = Math.max(maxAdjacentGap, gap);
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
	const density = coveredUnitIndices.length / Math.max(windowWidth, 1);
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
			windowWidth * 40 -
			totalGap * 20 -
			boundaryCrossingCount * 80,
		exactUnitCount,
		windowWidth,
		gapCount: totalGap,
		density,
		maxAdjacentGap,
		preservesQueryOrder,
		windowStart: minPosition,
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
	if (left.blockId !== right.blockId) {
		return left.blockId - right.blockId;
	}
	return left.match.familyId - right.match.familyId;
}

function passesBodyWindowAdmission(candidate: BodyWindowCandidate): boolean {
	return (
		candidate.coveredDistinctUnitCount >= 2 &&
		candidate.boundaryCrossingCount <= 1 &&
		candidate.windowWidth <=
			candidate.coveredDistinctUnitCount * 4 + candidate.boundaryCrossingCount * 3 &&
		candidate.maxAdjacentGap <= 4 + candidate.boundaryCrossingCount * 2
	);
}

function compareBodyWindowCandidate(
	left: BodyWindowCandidate,
	right: BodyWindowCandidate,
): number {
	if (left.coveredDistinctUnitCount !== right.coveredDistinctUnitCount) {
		return right.coveredDistinctUnitCount - left.coveredDistinctUnitCount;
	}
	if (left.exactUnitCount !== right.exactUnitCount) {
		return right.exactUnitCount - left.exactUnitCount;
	}
	if (left.preservesQueryOrder !== right.preservesQueryOrder) {
		return left.preservesQueryOrder ? -1 : 1;
	}
	if (left.windowWidth !== right.windowWidth) {
		return left.windowWidth - right.windowWidth;
	}
	if (left.maxAdjacentGap !== right.maxAdjacentGap) {
		return left.maxAdjacentGap - right.maxAdjacentGap;
	}
	if (left.gapCount !== right.gapCount) {
		return left.gapCount - right.gapCount;
	}
	if (left.windowStart !== right.windowStart) {
		return left.windowStart - right.windowStart;
	}
	if (left.boundaryCrossingCount !== right.boundaryCrossingCount) {
		return left.boundaryCrossingCount - right.boundaryCrossingCount;
	}
	return compareBlockIdLists(left.blockIds, right.blockIds);
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

function buildFragmentationPenalty(
	realizedFamilies: readonly RealizedQueryUnitFamily[],
	strongestContainer: EvidenceContainer | null,
	secondStrongestContainer: EvidenceContainer | null,
): FragmentationPenalty {
	const coveredByTopTwo = new Set<number>([
		...(strongestContainer?.coveredUnitIndices ?? []),
		...(secondStrongestContainer?.coveredUnitIndices ?? []),
	]);
	return {
		bodyResidueUnitCount: realizedFamilies.filter((family) => family.inBodyResidue).length,
		uncoveredByTopTwoCount: realizedFamilies.filter(
			(family) => !coveredByTopTwo.has(family.queryUnitIndex),
		).length,
		activeContainerCount: [
			realizedFamilies.some((family) => family.inIdentity),
			realizedFamilies.some((family) => family.inRoute),
			realizedFamilies.some((family) => family.inBestBodyWindow),
		].filter(Boolean).length,
	};
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
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	identityWitnessFamilyIds: readonly number[],
	routeWitnessFamilyIds: readonly number[],
	bodyWitnessFamilyIdsByBlockId: ReadonlyMap<number, readonly number[]>,
	bestBodyWindowBlockIds: ReadonlySet<number>,
): HanSurfaceCompletionSummary {
	const groups = collectHanSurfaceCompletionGroups(queryAnalysis);
	const completionGroups = groups.map<HanSurfaceCompletionGroupResult>((group) => ({
		surfaceGroupIndex: group.surfaceGroupIndex,
		surfaceText: group.surfaceText,
		tier: resolveHanSurfaceCompletionTier(
			base,
			group.surfaceText,
			identityWitnessFamilyIds,
			routeWitnessFamilyIds,
			bodyWitnessFamilyIdsByBlockId,
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
	base: ResidentBase,
	surfaceText: string,
	identityWitnessFamilyIds: readonly number[],
	routeWitnessFamilyIds: readonly number[],
	bodyWitnessFamilyIdsByBlockId: ReadonlyMap<number, readonly number[]>,
	bestBodyWindowBlockIds: ReadonlySet<number>,
): HanSurfaceCompletionTier {
	if (witnessFamiliesContainSurface(base, identityWitnessFamilyIds, surfaceText)) {
		return "identity";
	}
	if (witnessFamiliesContainSurface(base, routeWitnessFamilyIds, surfaceText)) {
		return "route";
	}
	for (const blockId of bestBodyWindowBlockIds) {
		if (
			witnessFamiliesContainSurface(
				base,
				bodyWitnessFamilyIdsByBlockId.get(blockId) ?? [],
				surfaceText,
			)
		) {
			return "body_window";
		}
	}
	for (const [blockId, familyIds] of bodyWitnessFamilyIdsByBlockId.entries()) {
		if (bestBodyWindowBlockIds.has(blockId)) {
			continue;
		}
		if (witnessFamiliesContainSurface(base, familyIds, surfaceText)) {
			return "body_residue";
		}
	}
	return "none";
}

function witnessFamiliesContainSurface(
	base: ResidentBase,
	familyIds: readonly number[],
	surfaceText: string,
): boolean {
	return familyIds.some((familyId) => getFamilyText(base, familyId).includes(surfaceText));
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
