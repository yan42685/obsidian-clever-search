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
		docIdByBlockId: Uint32Array.from(blocks.map((block) => block.docId)),
		blockOrdinalByBlockId: Uint32Array.from(blocks.map((block) => block.ordinal)),
		exactTapeStartByBlockId: Uint32Array.from(
			blocks.map((block) => block.exactTapeStart),
		),
		exactTapeCountByBlockId: Uint32Array.from(
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
