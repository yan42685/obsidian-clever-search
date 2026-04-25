import { buildIntegerArray } from "./integer-arrays";
import type { ResidentBodyBlockArena } from "./types";

type BodyBlockBuildInput = Readonly<{
	docId: number;
	liveDocSlot: number;
	ordinal: number;
	exactTapeStart: number;
	exactTapeCount: number;
	familySupportShardLocalFamilySlots: readonly number[];
	familySupportMasks: readonly number[];
}>;

function buildFamilySupportArrays(
	blocks: readonly Pick<
		BodyBlockBuildInput,
		"familySupportShardLocalFamilySlots" | "familySupportMasks"
	>[],
): Readonly<{
	familySupportStartByBlockId: ReturnType<typeof buildIntegerArray>;
	familySupportShardLocalFamilySlots: ReturnType<typeof buildIntegerArray>;
	familySupportMaskByEntry: Uint8Array;
}> {
	const familySupportStarts: number[] = [0];
	const familySupportShardLocalFamilySlots: number[] = [];
	const familySupportMasks: number[] = [];
	for (const block of blocks) {
		familySupportShardLocalFamilySlots.push(
			...block.familySupportShardLocalFamilySlots,
		);
		familySupportMasks.push(...block.familySupportMasks);
		familySupportStarts.push(familySupportShardLocalFamilySlots.length);
	}
	const familySupportStartByBlockId = buildIntegerArray(familySupportStarts);
	const familySupportShardLocalFamilySlotsArray = buildIntegerArray(
		familySupportShardLocalFamilySlots,
	);
	const familySupportMaskByEntry = Uint8Array.from(familySupportMasks);
	return {
		familySupportStartByBlockId,
		familySupportShardLocalFamilySlots:
			familySupportShardLocalFamilySlotsArray,
		familySupportMaskByEntry,
	};
}

export function buildBodyBlockArena(
	blocks: readonly BodyBlockBuildInput[],
): ResidentBodyBlockArena {
	const familySupport = buildFamilySupportArrays(blocks);
	return {
		blockCount: blocks.length,
		docIdByBlockId: buildIntegerArray(blocks.map((block) => block.docId)),
		liveDocSlotByBlockId: buildIntegerArray(
			blocks.map((block) => block.liveDocSlot),
		),
		blockOrdinalByBlockId: buildIntegerArray(blocks.map((block) => block.ordinal)),
		exactTapeStartByBlockId: buildIntegerArray(
			blocks.map((block) => block.exactTapeStart),
		),
		exactTapeCountByBlockId: buildIntegerArray(
			blocks.map((block) => block.exactTapeCount),
		),
		familySupportStartByBlockId: familySupport.familySupportStartByBlockId,
		familySupportShardLocalFamilySlots:
			familySupport.familySupportShardLocalFamilySlots,
		familySupportMaskByEntry: familySupport.familySupportMaskByEntry,
	};
}

export function estimateBodyBlockBytes(
	arena: ResidentBodyBlockArena,
): number {
	return (
		arena.docIdByBlockId.byteLength +
		arena.liveDocSlotByBlockId.byteLength +
		arena.blockOrdinalByBlockId.byteLength +
		arena.exactTapeStartByBlockId.byteLength +
		arena.exactTapeCountByBlockId.byteLength +
		arena.familySupportStartByBlockId.byteLength +
		arena.familySupportShardLocalFamilySlots.byteLength +
		arena.familySupportMaskByEntry.byteLength
	);
}
