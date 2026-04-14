import type { ResidentBodyBlockArena } from "./types";

type BodyBlockBuildInput = Readonly<{
	docId: number;
	ordinal: number;
	tokenCount: number;
	spanLength: number;
	summaryFamilyIds: readonly number[];
	exactTapeStart: number;
	exactTapeCount: number;
}>;

export function buildBodyBlockArena(
	blocks: readonly BodyBlockBuildInput[],
): ResidentBodyBlockArena {
	const summaryFamilyIds: number[] = [];
	const summaryStartByBlockId: number[] = [];
	const summaryCountByBlockId: number[] = [];
	for (const block of blocks) {
		summaryStartByBlockId.push(summaryFamilyIds.length);
		summaryCountByBlockId.push(block.summaryFamilyIds.length);
		for (const familyId of block.summaryFamilyIds) {
			summaryFamilyIds.push(familyId);
		}
	}
	return {
		blockCount: blocks.length,
		docIdByBlockId: Uint32Array.from(blocks.map((block) => block.docId)),
		blockOrdinalByBlockId: Uint32Array.from(blocks.map((block) => block.ordinal)),
		tokenCountByBlockId: Uint32Array.from(blocks.map((block) => block.tokenCount)),
		spanLengthByBlockId: Uint32Array.from(blocks.map((block) => block.spanLength)),
		summaryStartByBlockId: Uint32Array.from(summaryStartByBlockId),
		summaryCountByBlockId: Uint32Array.from(summaryCountByBlockId),
		exactTapeStartByBlockId: Uint32Array.from(
			blocks.map((block) => block.exactTapeStart),
		),
		exactTapeCountByBlockId: Uint32Array.from(
			blocks.map((block) => block.exactTapeCount),
		),
		summaryFamilyIds: Uint32Array.from(summaryFamilyIds),
	};
}

export function estimateBodyBlockBytes(
	arena: ResidentBodyBlockArena,
): number {
	return (
		arena.docIdByBlockId.byteLength +
		arena.blockOrdinalByBlockId.byteLength +
		arena.tokenCountByBlockId.byteLength +
		arena.spanLengthByBlockId.byteLength +
		arena.summaryStartByBlockId.byteLength +
		arena.summaryCountByBlockId.byteLength +
		arena.exactTapeStartByBlockId.byteLength +
		arena.exactTapeCountByBlockId.byteLength +
		arena.summaryFamilyIds.byteLength
	);
}
