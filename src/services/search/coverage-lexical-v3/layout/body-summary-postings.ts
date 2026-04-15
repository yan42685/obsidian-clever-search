import {
	buildSentinelStarts,
	estimateSentinelPostingBytes,
	flattenBuckets,
} from "./integer-arrays";
import type {
	ResidentBlockPostingList,
	ResidentBodySummaryArena,
} from "./types";

type BodySummaryBuildInput = Readonly<{
	familyCount: number;
	summaryFamilyIdsByBlock: readonly (readonly number[])[];
}>;

export function buildBodySummaryArena(
	input: BodySummaryBuildInput,
): ResidentBodySummaryArena {
	return {
		postings: buildBlockPostingList(
			input.familyCount,
			input.summaryFamilyIdsByBlock,
		),
	};
}

export function estimateBodySummaryBytes(
	arena: ResidentBodySummaryArena,
): number {
	return estimateBlockPostingListBytes(arena.postings);
}

function buildBlockPostingList(
	familyCount: number,
	summaryFamilyIdsByBlock: readonly (readonly number[])[],
): ResidentBlockPostingList {
	const buckets = Array.from({ length: familyCount }, () => [] as number[]);
	for (let blockId = 0; blockId < summaryFamilyIdsByBlock.length; blockId += 1) {
		for (const familyId of summaryFamilyIdsByBlock[blockId] ?? []) {
			buckets[familyId]?.push(blockId);
		}
	}
	return {
		postingStarts: buildSentinelStarts(buckets),
		blockIds: flattenBuckets(buckets),
	};
}

function estimateBlockPostingListBytes(postings: ResidentBlockPostingList): number {
	return estimateSentinelPostingBytes(postings.postingStarts, postings.blockIds);
}
