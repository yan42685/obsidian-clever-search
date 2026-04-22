import type { V3QueryFamilyMatchKind } from "../recall";

export type BlockShortlistRepresentative = Readonly<{
	queryUnitIndex: number;
	familyId: number;
	shardLocalFamilySlot: number;
	familyText: string;
	matchKind: V3QueryFamilyMatchKind;
	blockId: number;
	approxStart: number;
	approxEnd: number;
}>;

export type BlockShortlistItem = Readonly<{
	blockStart: number;
	blockEnd: number;
	blockIds: readonly number[];
	boundaryCrossingCount: number;
	coveredUnitIndices: readonly number[];
	coveredDistinctUnitCount: number;
	representatives: readonly BlockShortlistRepresentative[];
	approxWindowStart: number;
	approxWindowEnd: number;
	approxMaxAdjacentGap: number;
	approxHeadTailSpan: number;
	approxTotalGapMass: number;
	preservesQueryOrder: boolean;
	priorityScore: number;
}>;

export type BlockShortlistSketch = readonly BlockShortlistItem[];

const shortlistSketchByTarget = new WeakMap<object, BlockShortlistSketch>();

export function passesBlockShortlistAdmission(
	item: Pick<
		BlockShortlistItem,
		| "coveredDistinctUnitCount"
		| "boundaryCrossingCount"
		| "approxMaxAdjacentGap"
		| "approxHeadTailSpan"
	>,
): boolean {
	return (
		item.coveredDistinctUnitCount >= 2 &&
		item.boundaryCrossingCount <= 1 &&
		item.approxMaxAdjacentGap <= 15 &&
		item.approxHeadTailSpan <= 160
	);
}

export function compareBlockShortlistItems(
	left: BlockShortlistItem,
	right: BlockShortlistItem,
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
	return compareRepresentativeOrder(left.representatives, right.representatives);
}

export function buildBlockShortlistPriorityScore(
	item: Pick<
		BlockShortlistItem,
		| "coveredDistinctUnitCount"
		| "preservesQueryOrder"
		| "approxHeadTailSpan"
		| "approxMaxAdjacentGap"
		| "approxTotalGapMass"
		| "boundaryCrossingCount"
	>,
): number {
	return (
		item.coveredDistinctUnitCount * 10000 +
		(item.preservesQueryOrder ? 500 : 0) -
		item.approxHeadTailSpan * 20 -
		item.approxMaxAdjacentGap * 12 -
		item.approxTotalGapMass * 4 -
		item.boundaryCrossingCount * 40
	);
}

export function attachBlockShortlistSketch(
	target: object,
	sketch: BlockShortlistSketch,
): void {
	shortlistSketchByTarget.set(target, sketch);
}

export function getAttachedBlockShortlistSketch(
	target: object,
): BlockShortlistSketch | null {
	return shortlistSketchByTarget.get(target) ?? null;
}

function compareRepresentativeOrder(
	left: readonly BlockShortlistRepresentative[],
	right: readonly BlockShortlistRepresentative[],
): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const leftRepresentative = left[index];
		const rightRepresentative = right[index];
		if (leftRepresentative.queryUnitIndex !== rightRepresentative.queryUnitIndex) {
			return leftRepresentative.queryUnitIndex - rightRepresentative.queryUnitIndex;
		}
		if (leftRepresentative.approxStart !== rightRepresentative.approxStart) {
			return leftRepresentative.approxStart - rightRepresentative.approxStart;
		}
		if (leftRepresentative.approxEnd !== rightRepresentative.approxEnd) {
			return leftRepresentative.approxEnd - rightRepresentative.approxEnd;
		}
		if (leftRepresentative.blockId !== rightRepresentative.blockId) {
			return leftRepresentative.blockId - rightRepresentative.blockId;
		}
		const leftShardLocalFamilySlot = leftRepresentative.shardLocalFamilySlot;
		const rightShardLocalFamilySlot = rightRepresentative.shardLocalFamilySlot;
		if (leftShardLocalFamilySlot !== rightShardLocalFamilySlot) {
			return leftShardLocalFamilySlot - rightShardLocalFamilySlot;
		}
	}
	return left.length - right.length;
}
