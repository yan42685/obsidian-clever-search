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
import {
	compareContainerStrength,
} from "./comparator";
import type {
	BodyWindowContainer,
	EvidenceContainer,
	EvidencePackingProfile,
	FragmentationPenalty,
	HeadingCorroboration,
	IdentityContainer,
	RealizedQueryUnitFamily,
	RouteContainer,
} from "./types";

export function buildPackingProfile(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	candidateRecall: V3CandidateDocRecall,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
): EvidencePackingProfile {
	const identityFamilyIds = new Set<number>([
		...getDocIdentityFamilyIds(base, candidateRecall.docId),
		...getDocIdentityHanWitnessFamilyIds(base, candidateRecall.docId),
	]);
	const routeFamilyIds = new Set<number>([
		...getDocRouteFamilyIds(base, candidateRecall.docId),
		...getDocRouteHanWitnessFamilyIds(base, candidateRecall.docId),
	]);
	const headingFamilyIds = new Set<number>([
		...getDocHeadingFamilyIds(base, candidateRecall.docId),
		...getDocHeadingHanWitnessFamilyIds(base, candidateRecall.docId),
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
	const bodyMatchesByBlockId = new Map<number, Map<number, V3QueryFamilyMatch>>();
	const bodyPositionsByBlockId = new Map<number, Map<number, number>>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		const exactFamilyIds = getBodyBlockExactFamilyIds(base, blockId);
		const witnessFamilyIds = getBodyBlockHanWitnessFamilyIds(base, blockId);
		const tokenPositions = getBodyBlockExactTokenPositions(base, blockId);
		const blockMatches = new Map<number, V3QueryFamilyMatch>();
		const blockPositions = new Map<number, number>();
		for (const unitMatches of mergedUnitFamilyMatches) {
			const blockMatch = findBestBlockMatch(
				unitMatches.matches,
				unitMatches.queryUnitSource === "opaque_han_confirmed"
					? witnessFamilyIds
					: exactFamilyIds,
				unitMatches.queryUnitSource === "opaque_han_confirmed"
					? witnessFamilyIds.map((_, index) => index)
					: tokenPositions,
			);
			if (blockMatch == null) {
				continue;
			}
			blockMatches.set(unitMatches.queryUnitIndex, blockMatch.match);
			blockPositions.set(unitMatches.queryUnitIndex, blockMatch.position);
		}
		if (blockMatches.size > 0) {
			bodyMatchesByBlockId.set(blockId, blockMatches);
			bodyPositionsByBlockId.set(blockId, blockPositions);
		}
	}

	const bestBodyWindowContainer = chooseBestBodyWindow(
		bodyMatchesByBlockId,
		bodyPositionsByBlockId,
		headingFamilyIds,
	);
	const bestBodyBlockId = bestBodyWindowContainer?.blockId ?? null;
	const realizedFamilies = mergedUnitFamilyMatches
		.map((unitMatches) =>
			selectRealizedFamilyForUnit({
				unitMatches,
				identityFamilyIds,
				routeFamilyIds,
				headingFamilyIds,
				bodyMatchesByBlockId,
				bestBodyBlockId,
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
	return {
		docId: candidateRecall.docId,
		path: getDocPath(base, candidateRecall.docId),
		stableKey: getDocStableKey(base, candidateRecall.docId),
		surfaceCoverageShapeKey: queryAnalysis.surfaceCoverageShapeKey,
		realizedCoverageCount: realizedFamilies.length,
		exactUnitCount: realizedFamilies.filter((family) => family.matchKind === "exact").length,
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

function findBestBlockMatch(
	matches: readonly V3QueryFamilyMatch[],
	exactFamilyIds: readonly number[],
	positions: readonly number[],
): Readonly<{
	match: V3QueryFamilyMatch;
	position: number;
}> | null {
	let best:
		| Readonly<{
				match: V3QueryFamilyMatch;
				position: number;
		  }>
		| null = null;
	for (let index = 0; index < exactFamilyIds.length; index += 1) {
		const familyId = exactFamilyIds[index];
		const match = matches.find((candidate) => candidate.familyId === familyId);
		if (match == null) {
			continue;
		}
		if (
			best == null ||
			compareMatchPreference(match, best.match) < 0 ||
			(compareMatchPreference(match, best.match) === 0 && index < best.position)
		) {
			best = {
				match,
				position: positions[index] ?? index,
			};
		}
	}
	return best;
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

function chooseBestBodyWindow(
	bodyMatchesByBlockId: ReadonlyMap<number, Map<number, V3QueryFamilyMatch>>,
	bodyPositionsByBlockId: ReadonlyMap<number, Map<number, number>>,
	headingFamilyIds: ReadonlySet<number>,
): BodyWindowContainer | null {
	const candidates = [...bodyMatchesByBlockId.entries()].map<BodyWindowContainer | null>(
		([blockId, blockMatches]) => {
			const coveredUnitIndices = [...blockMatches.keys()].sort((left, right) => left - right);
			if (coveredUnitIndices.length === 0) {
				return null;
			}
			const positions = coveredUnitIndices
				.map((unitIndex) => bodyPositionsByBlockId.get(blockId)?.get(unitIndex))
				.filter((position): position is number => typeof position === "number")
				.sort((left, right) => left - right);
			const minPosition = positions[0] ?? 0;
			const maxPosition = positions[positions.length - 1] ?? minPosition;
			const windowWidth = maxPosition - minPosition + 1;
			const gapCount = positions.reduce((gapTotal, position, index) => {
				if (index === 0) {
					return gapTotal;
				}
				return gapTotal + Math.max(0, position - positions[index - 1] - 1);
			}, 0);
			const density = coveredUnitIndices.length / Math.max(windowWidth, 1);
			const headingCorroborationUnitIndices = coveredUnitIndices.filter((unitIndex) => {
				const familyId = blockMatches.get(unitIndex)?.familyId;
				return familyId !== undefined && headingFamilyIds.has(familyId);
			});
			return {
				tier: "bodyWindow",
				blockId,
				coveredUnitIndices,
				coveredDistinctUnitCount: coveredUnitIndices.length,
				containerCompactness:
					Math.round(density * 1000) - gapCount * 40 - Math.max(windowWidth - coveredUnitIndices.length, 0) * 20,
				exactUnitCount: coveredUnitIndices.filter(
					(unitIndex) => blockMatches.get(unitIndex)?.matchKind === "exact",
				).length,
				windowWidth,
				gapCount,
				density,
				headingCorroboration: {
					coveredUnitIndices: headingCorroborationUnitIndices,
					unitCount: headingCorroborationUnitIndices.length,
				},
			};
		},
	);
	return candidates
		.filter((candidate): candidate is BodyWindowContainer => candidate != null)
		.sort((left, right) => {
			if (left.coveredDistinctUnitCount !== right.coveredDistinctUnitCount) {
				return right.coveredDistinctUnitCount - left.coveredDistinctUnitCount;
			}
			if (left.containerCompactness !== right.containerCompactness) {
				return right.containerCompactness - left.containerCompactness;
			}
			if (left.exactUnitCount !== right.exactUnitCount) {
				return right.exactUnitCount - left.exactUnitCount;
			}
			return left.blockId - right.blockId;
		})[0] ?? null;
}

function selectRealizedFamilyForUnit(params: Readonly<{
	unitMatches: V3QueryUnitFamilyMatches;
	identityFamilyIds: ReadonlySet<number>;
	routeFamilyIds: ReadonlySet<number>;
	headingFamilyIds: ReadonlySet<number>;
	bodyMatchesByBlockId: ReadonlyMap<number, Map<number, V3QueryFamilyMatch>>;
	bestBodyBlockId: number | null;
}>): RealizedQueryUnitFamily | null {
	const candidates = params.unitMatches.matches
		.map((match) => {
			const bodyBlockIds = [...params.bodyMatchesByBlockId.entries()]
				.filter(([, blockMatches]) => blockMatches.get(params.unitMatches.queryUnitIndex)?.familyId === match.familyId)
				.map(([blockId]) => blockId);
			const inBestBodyWindow =
				params.bestBodyBlockId != null && bodyBlockIds.includes(params.bestBodyBlockId);
			const inBodyResidue = bodyBlockIds.some((blockId) => blockId !== params.bestBodyBlockId);
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
	const coveredUnitIndices = realizedFamilies
		.filter((family) => family.inBestBodyWindow)
		.map((family) => family.queryUnitIndex)
		.sort((left, right) => left - right);
	const headingCorroboratedUnitIndices = realizedFamilies
		.filter((family) => family.inBestBodyWindow && family.inHeading)
		.map((family) => family.queryUnitIndex)
		.sort((left, right) => left - right);
	return {
		...bodyWindow,
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
