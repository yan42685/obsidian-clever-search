import {
	buildSentinelStarts,
	buildIntegerArray,
	estimateSentinelPostingBytes,
	findResidentIntegerIndex,
} from "./integer-arrays";
import type { ResidentBodySummaryArena } from "./types";

type BodySummaryBuildInput = Readonly<{
	summaryFamilyIdsByBlock: readonly (readonly number[])[];
}>;

export function buildBodySummaryArena(
	input: BodySummaryBuildInput,
): ResidentBodySummaryArena {
	const blocksByFamilyId = new Map<number, number[]>();
	for (let blockId = 0; blockId < input.summaryFamilyIdsByBlock.length; blockId += 1) {
		for (const familyId of input.summaryFamilyIdsByBlock[blockId] ?? []) {
			let blockIds = blocksByFamilyId.get(familyId);
			if (blockIds == null) {
				blockIds = [];
				blocksByFamilyId.set(familyId, blockIds);
			}
			blockIds.push(blockId);
		}
	}
	const familyIds = [...blocksByFamilyId.keys()].sort((left, right) => left - right);
	const buckets = familyIds.map((familyId) => blocksByFamilyId.get(familyId) ?? []);
	return {
		familyIds: buildIntegerArray(familyIds),
		postingStarts: buildSentinelStarts(buckets),
		blockIds: buildIntegerArray(buckets.flat()),
	};
}

export function estimateBodySummaryBytes(
	arena: ResidentBodySummaryArena,
): number {
	return (
		arena.familyIds.byteLength +
		estimateSentinelPostingBytes(arena.postingStarts, arena.blockIds)
	);
}

export function findBodySummaryFamilyIndex(
	arena: ResidentBodySummaryArena,
	familyId: number,
): number {
	return findResidentIntegerIndex(arena.familyIds, familyId);
}

export function collectBodySummaryBlockIdsForFamily(
	arena: ResidentBodySummaryArena,
	familyId: number,
): number[] {
	const familyIndex = findBodySummaryFamilyIndex(arena, familyId);
	if (familyIndex === -1) {
		return [];
	}
	const start = arena.postingStarts[familyIndex] ?? 0;
	const end = arena.postingStarts[familyIndex + 1] ?? start;
	return Array.from(
		arena.blockIds.slice(start, end),
	);
}
