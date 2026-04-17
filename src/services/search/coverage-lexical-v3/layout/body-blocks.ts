import { buildIntegerArray } from "./integer-arrays";
import type { ResidentBodyBlockArena } from "./types";

type BodyBlockBuildInput = Readonly<{
	docId: number;
	ordinal: number;
	exactTapeStart: number;
	exactTapeCount: number;
	familySupportFamilyIds: readonly number[];
	familySupportMasks: readonly number[];
}>;

export function buildBodyBlockArena(
	blocks: readonly BodyBlockBuildInput[],
): ResidentBodyBlockArena {
	const familySupportStarts: number[] = [0];
	const familySupportFamilyIds: number[] = [];
	const familySupportMasks: number[] = [];
	for (const block of blocks) {
		familySupportFamilyIds.push(...block.familySupportFamilyIds);
		familySupportMasks.push(...block.familySupportMasks);
		familySupportStarts.push(familySupportFamilyIds.length);
	}
	return {
		blockCount: blocks.length,
		docIdByBlockId: buildIntegerArray(blocks.map((block) => block.docId)),
		blockOrdinalByBlockId: buildIntegerArray(blocks.map((block) => block.ordinal)),
		exactTapeStartByBlockId: buildIntegerArray(
			blocks.map((block) => block.exactTapeStart),
		),
		exactTapeCountByBlockId: buildIntegerArray(
			blocks.map((block) => block.exactTapeCount),
		),
		familySupportStartByBlockId: buildIntegerArray(familySupportStarts),
		familySupportFamilyIds: buildIntegerArray(familySupportFamilyIds),
		familySupportMaskByEntry: Uint8Array.from(familySupportMasks),
	};
}

export function estimateBodyBlockBytes(
	arena: ResidentBodyBlockArena,
): number {
	return (
		arena.docIdByBlockId.byteLength +
		arena.blockOrdinalByBlockId.byteLength +
		arena.exactTapeStartByBlockId.byteLength +
		arena.exactTapeCountByBlockId.byteLength +
		arena.familySupportStartByBlockId.byteLength +
		arena.familySupportFamilyIds.byteLength +
		arena.familySupportMaskByEntry.byteLength
	);
}
