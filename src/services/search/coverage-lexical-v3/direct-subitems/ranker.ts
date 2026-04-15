import type { V3DirectSubitemCandidate } from "./contracts";

export function compareV3DirectSubitemCandidates(
	left: V3DirectSubitemCandidate,
	right: V3DirectSubitemCandidate,
): number {
	if (left.coveredRealPrimaryCount != right.coveredRealPrimaryCount) {
		return right.coveredRealPrimaryCount - left.coveredRealPrimaryCount;
	}
	if (
		left.completedHanSurfaceGroupCount !=
		right.completedHanSurfaceGroupCount
	) {
		return (
			right.completedHanSurfaceGroupCount -
			left.completedHanSurfaceGroupCount
		);
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
