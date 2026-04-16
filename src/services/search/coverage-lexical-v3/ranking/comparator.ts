import type {
	EvidenceContainer,
	EvidencePackingProfile,
	HanSurfaceCompletionTier,
} from "./types";

const CONTAINER_TIER_SCORE: Record<EvidenceContainer["tier"], number> = {
	identity: 3,
	route: 2,
	bodyWindow: 1,
};

const HAN_SURFACE_COMPLETION_TIER_SCORE: Record<HanSurfaceCompletionTier, number> = {
	none: 0,
	body_residue: 1,
	body_window: 2,
	route: 3,
	identity: 4,
};

const COMPACTNESS_TIE_BAND = 180;

export function comparePackingProfiles(
	left: EvidencePackingProfile,
	right: EvidencePackingProfile,
): number {
	const preHanCompletionComparison = comparePackingProfilesBeforeHanSurfaceCompletion(
		left,
		right,
	);
	if (preHanCompletionComparison !== 0) {
		return preHanCompletionComparison;
	}
	const hanSurfaceCompletionComparison = compareHanSurfaceCompletion(left, right);
	if (hanSurfaceCompletionComparison !== 0) {
		return hanSurfaceCompletionComparison;
	}
	if (left.prefixCompletionGainTotal !== right.prefixCompletionGainTotal) {
		return left.prefixCompletionGainTotal - right.prefixCompletionGainTotal;
	}
	if (left.compoundPrefixCount !== right.compoundPrefixCount) {
		return left.compoundPrefixCount - right.compoundPrefixCount;
	}
	return left.path.localeCompare(right.path);
}

export function comparePackingProfilesBeforeHanSurfaceCompletion(
	left: EvidencePackingProfile,
	right: EvidencePackingProfile,
): number {
	const coverageGateComparison = compareCoverageGate(
		left.coverageGate,
		right.coverageGate,
	);
	if (coverageGateComparison !== 0) {
		return coverageGateComparison;
	}
	const strongestComparison = compareContainerStrength(
		left.strongestContainer,
		right.strongestContainer,
	);
	if (strongestComparison !== 0) {
		return strongestComparison;
	}
	const secondComparison = compareContainerStrength(
		left.secondStrongestContainer,
		right.secondStrongestContainer,
	);
	if (secondComparison !== 0) {
		return secondComparison;
	}
	const fragmentationComparison = compareFragmentation(left, right);
	if (fragmentationComparison !== 0) {
		return fragmentationComparison;
	}
	if (left.exactUnitCount !== right.exactUnitCount) {
		return right.exactUnitCount - left.exactUnitCount;
	}
	const metadataPackingComparison = compareMetadataPackingSignature(
		left.metadataPackingSignature,
		right.metadataPackingSignature,
	);
	if (metadataPackingComparison !== 0) {
		return metadataPackingComparison;
	}
	return 0;
}

function compareCoverageGate(
	left: EvidencePackingProfile["coverageGate"],
	right: EvidencePackingProfile["coverageGate"],
): number {
	if (left.realizedCoverageCount !== right.realizedCoverageCount) {
		return right.realizedCoverageCount - left.realizedCoverageCount;
	}
	if (left.fullySatisfiedSurfaceGroupCount !== right.fullySatisfiedSurfaceGroupCount) {
		return right.fullySatisfiedSurfaceGroupCount - left.fullySatisfiedSurfaceGroupCount;
	}
	if (left.startedSurfaceGroupCount !== right.startedSurfaceGroupCount) {
		return right.startedSurfaceGroupCount - left.startedSurfaceGroupCount;
	}
	if (left.crossScriptSatisfiedGroupCount !== right.crossScriptSatisfiedGroupCount) {
		return right.crossScriptSatisfiedGroupCount - left.crossScriptSatisfiedGroupCount;
	}
	return 0;
}

export function compareContainerStrength(
	left: EvidenceContainer | null,
	right: EvidenceContainer | null,
): number {
	if (left == null && right == null) {
		return 0;
	}
	if (left == null) {
		return 1;
	}
	if (right == null) {
		return -1;
	}
	if (left.coveredDistinctUnitCount !== right.coveredDistinctUnitCount) {
		return right.coveredDistinctUnitCount - left.coveredDistinctUnitCount;
	}
	const leftTierScore = CONTAINER_TIER_SCORE[left.tier];
	const rightTierScore = CONTAINER_TIER_SCORE[right.tier];
	if (
		leftTierScore !== rightTierScore &&
		(leftTierScore === CONTAINER_TIER_SCORE.identity ||
			rightTierScore === CONTAINER_TIER_SCORE.identity)
	) {
		return rightTierScore - leftTierScore;
	}
	const compactnessDiff = left.containerCompactness - right.containerCompactness;
	if (Math.abs(compactnessDiff) >= COMPACTNESS_TIE_BAND) {
		return compactnessDiff > 0 ? -1 : 1;
	}
	if (leftTierScore !== rightTierScore) {
		return rightTierScore - leftTierScore;
	}
	if (left.containerCompactness !== right.containerCompactness) {
		return right.containerCompactness - left.containerCompactness;
	}
	return 0;
}

function compareFragmentation(
	left: EvidencePackingProfile,
	right: EvidencePackingProfile,
): number {
	if (
		left.fragmentationPenalty.uncoveredByTopTwoCount !==
		right.fragmentationPenalty.uncoveredByTopTwoCount
	) {
		return (
			left.fragmentationPenalty.uncoveredByTopTwoCount -
			right.fragmentationPenalty.uncoveredByTopTwoCount
		);
	}
	if (
		left.fragmentationPenalty.bodyResidueUnitCount !==
		right.fragmentationPenalty.bodyResidueUnitCount
	) {
		return (
			left.fragmentationPenalty.bodyResidueUnitCount -
			right.fragmentationPenalty.bodyResidueUnitCount
		);
	}
	if (
		left.fragmentationPenalty.explanatoryContainerCount !==
		right.fragmentationPenalty.explanatoryContainerCount
	) {
		return (
			left.fragmentationPenalty.explanatoryContainerCount -
			right.fragmentationPenalty.explanatoryContainerCount
		);
	}
	return 0;
}

function compareMetadataPackingSignature(
	left: EvidencePackingProfile["metadataPackingSignature"] | undefined,
	right: EvidencePackingProfile["metadataPackingSignature"] | undefined,
): number {
	const normalizedLeft = left ?? EMPTY_METADATA_PACKING_SIGNATURE;
	const normalizedRight = right ?? EMPTY_METADATA_PACKING_SIGNATURE;
	const maxBucketCount = Math.max(
		normalizedLeft.sortedBuckets.length,
		normalizedRight.sortedBuckets.length,
		3,
	);
	for (let index = 0; index < maxBucketCount; index += 1) {
		const leftBucket = normalizedLeft.sortedBuckets[index];
		const rightBucket = normalizedRight.sortedBuckets[index];
		const leftUnitCount = leftBucket?.unitCount ?? 0;
		const rightUnitCount = rightBucket?.unitCount ?? 0;
		if (leftUnitCount !== rightUnitCount) {
			return rightUnitCount - leftUnitCount;
		}
		if (leftUnitCount <= 0) {
			continue;
		}
		const leftSourceScore = getMetadataPackingSourceScore(leftBucket?.source);
		const rightSourceScore = getMetadataPackingSourceScore(rightBucket?.source);
		if (leftSourceScore !== rightSourceScore) {
			return rightSourceScore - leftSourceScore;
		}
	}
	return 0;
}

const EMPTY_METADATA_PACKING_SIGNATURE = {
	basenameUnitCount: 0,
	aliasUnitCount: 0,
	routeUnitCount: 0,
	sortedBuckets: [],
} as const;

function getMetadataPackingSourceScore(source: "basename" | "alias" | "route" | undefined): number {
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

function compareHanSurfaceCompletion(
	left: EvidencePackingProfile,
	right: EvidencePackingProfile,
): number {
	if (
		left.completedHanSurfaceGroupCount !== right.completedHanSurfaceGroupCount
	) {
		return right.completedHanSurfaceGroupCount - left.completedHanSurfaceGroupCount;
	}
	if (
		left.hanSurfaceCompletionTierScoreTotal !==
		right.hanSurfaceCompletionTierScoreTotal
	) {
		return (
			right.hanSurfaceCompletionTierScoreTotal -
			left.hanSurfaceCompletionTierScoreTotal
		);
	}
	const leftStrongestTierScore =
		HAN_SURFACE_COMPLETION_TIER_SCORE[left.strongestHanSurfaceCompletionTier];
	const rightStrongestTierScore =
		HAN_SURFACE_COMPLETION_TIER_SCORE[right.strongestHanSurfaceCompletionTier];
	if (leftStrongestTierScore !== rightStrongestTierScore) {
		return rightStrongestTierScore - leftStrongestTierScore;
	}
	return 0;
}
