import type {
	EvidenceContainer,
	EvidencePackingProfile,
} from "./types";

const CONTAINER_TIER_SCORE: Record<EvidenceContainer["tier"], number> = {
	identity: 3,
	route: 2,
	bodyWindow: 1,
};

const COMPACTNESS_TIE_BAND = 180;

export function comparePackingProfiles(
	left: EvidencePackingProfile,
	right: EvidencePackingProfile,
): number {
	if (left.realizedCoverageCount !== right.realizedCoverageCount) {
		return right.realizedCoverageCount - left.realizedCoverageCount;
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
	if (left.prefixCompletionGainTotal !== right.prefixCompletionGainTotal) {
		return left.prefixCompletionGainTotal - right.prefixCompletionGainTotal;
	}
	if (left.compoundPrefixCount !== right.compoundPrefixCount) {
		return left.compoundPrefixCount - right.compoundPrefixCount;
	}
	return left.path.localeCompare(right.path);
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
		left.fragmentationPenalty.activeContainerCount !==
		right.fragmentationPenalty.activeContainerCount
	) {
		return (
			left.fragmentationPenalty.activeContainerCount -
			right.fragmentationPenalty.activeContainerCount
		);
	}
	return 0;
}
