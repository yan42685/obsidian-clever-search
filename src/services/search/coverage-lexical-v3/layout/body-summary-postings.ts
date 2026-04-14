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
	const postingStarts: number[] = [];
	const postingCounts: number[] = [];
	const blockIds: number[] = [];
	for (const bucket of buckets) {
		postingStarts.push(blockIds.length);
		postingCounts.push(bucket.length);
		for (const blockId of bucket) {
			blockIds.push(blockId);
		}
	}
	return {
		postingStarts: Uint32Array.from(postingStarts),
		postingCounts: Uint32Array.from(postingCounts),
		blockIds: Uint32Array.from(blockIds),
	};
}

function estimateBlockPostingListBytes(postings: ResidentBlockPostingList): number {
	return (
		postings.postingStarts.byteLength +
		postings.postingCounts.byteLength +
		postings.blockIds.byteLength
	);
}
