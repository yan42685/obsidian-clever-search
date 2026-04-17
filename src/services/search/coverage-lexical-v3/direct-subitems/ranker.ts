import type { V3DirectSubitemCandidate } from "./contracts";

const DIRECT_SUBITEM_ANCHOR_TIER_SCORE = {
	none: 0,
	real_lexical: 1,
	opaque_bigram: 2,
	confirmed_surface: 3,
} as const;

export function compareV3DirectSubitemCandidates(
	left: V3DirectSubitemCandidate,
	right: V3DirectSubitemCandidate,
): number {
	if (left.hasAnchor !== right.hasAnchor) {
		return left.hasAnchor ? -1 : 1;
	}
	if (left.coveredRealPrimaryCount != right.coveredRealPrimaryCount) {
		return right.coveredRealPrimaryCount - left.coveredRealPrimaryCount;
	}
	if (left.confirmedSurfaceGroupCount != right.confirmedSurfaceGroupCount) {
		return right.confirmedSurfaceGroupCount - left.confirmedSurfaceGroupCount;
	}
	if (left.opaqueCoverageRatio !== right.opaqueCoverageRatio) {
		return right.opaqueCoverageRatio - left.opaqueCoverageRatio;
	}
	if (left.matchedOpaqueBigramCount !== right.matchedOpaqueBigramCount) {
		return right.matchedOpaqueBigramCount - left.matchedOpaqueBigramCount;
	}
	const leftAnchorTierScore =
		DIRECT_SUBITEM_ANCHOR_TIER_SCORE[left.anchorTier];
	const rightAnchorTierScore =
		DIRECT_SUBITEM_ANCHOR_TIER_SCORE[right.anchorTier];
	if (leftAnchorTierScore !== rightAnchorTierScore) {
		return rightAnchorTierScore - leftAnchorTierScore;
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
	if (left.totalGap !== right.totalGap) {
		return left.totalGap - right.totalGap;
	}
	if (left.anchorOffset !== right.anchorOffset) {
		return left.anchorOffset - right.anchorOffset;
	}
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	return left.end - right.end;
}
