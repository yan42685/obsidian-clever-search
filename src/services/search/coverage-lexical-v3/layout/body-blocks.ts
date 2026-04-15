import { buildIntegerArray } from "./integer-arrays";
import type { ResidentBodyBlockArena } from "./types";

type BodyBlockBuildInput = Readonly<{
	docId: number;
	ordinal: number;
	exactTapeStart: number;
	exactTapeCount: number;
}>;

export function buildBodyBlockArena(
	blocks: readonly BodyBlockBuildInput[],
): ResidentBodyBlockArena {
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
	};
}

export function estimateBodyBlockBytes(
	arena: ResidentBodyBlockArena,
): number {
	return (
		arena.docIdByBlockId.byteLength +
		arena.blockOrdinalByBlockId.byteLength +
		arena.exactTapeStartByBlockId.byteLength +
		arena.exactTapeCountByBlockId.byteLength
	);
}
