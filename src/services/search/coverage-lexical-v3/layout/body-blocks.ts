import { buildIntegerArray } from "./integer-arrays";
import type {
	ResidentBodyBlockArena,
	ResidentBodyFamilySupportSidecar,
} from "./types";

type BodyBlockBuildInput = Readonly<{
	docId: number;
	liveDocSlot: number;
	ordinal: number;
	exactTapeStart: number;
	exactTapeCount: number;
	familySupportFamilyIds: readonly number[];
	familySupportMasks: readonly number[];
}>;

export const EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR: ResidentBodyFamilySupportSidecar =
	{
		familySupportStartByBlockId: buildIntegerArray([0]),
		familySupportFamilyIds: buildIntegerArray([]),
		familySupportMaskByEntry: new Uint8Array(),
		entryCount: 0,
		bytes: 0,
	};

export function buildResidentBodyFamilySupportSidecar(
	blocks: readonly Pick<
		BodyBlockBuildInput,
		"familySupportFamilyIds" | "familySupportMasks"
	>[],
): ResidentBodyFamilySupportSidecar {
	const familySupportStarts: number[] = [0];
	const familySupportFamilyIds: number[] = [];
	const familySupportMasks: number[] = [];
	for (const block of blocks) {
		familySupportFamilyIds.push(...block.familySupportFamilyIds);
		familySupportMasks.push(...block.familySupportMasks);
		familySupportStarts.push(familySupportFamilyIds.length);
	}
	const familySupportStartByBlockId = buildIntegerArray(familySupportStarts);
	const familySupportFamilyIdsArray = buildIntegerArray(familySupportFamilyIds);
	const familySupportMaskByEntry = Uint8Array.from(familySupportMasks);
	return {
		familySupportStartByBlockId,
		familySupportFamilyIds: familySupportFamilyIdsArray,
		familySupportMaskByEntry,
		entryCount: familySupportFamilyIdsArray.length,
		bytes:
			familySupportStartByBlockId.byteLength +
			familySupportFamilyIdsArray.byteLength +
			familySupportMaskByEntry.byteLength,
	};
}

export function buildBodyBlockArena(
	blocks: readonly BodyBlockBuildInput[],
	familySupportSidecar: ResidentBodyFamilySupportSidecar = buildResidentBodyFamilySupportSidecar(
		blocks,
	),
): ResidentBodyBlockArena {
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
		familySupportStartByBlockId:
			familySupportSidecar.familySupportStartByBlockId,
		familySupportFamilyIds: familySupportSidecar.familySupportFamilyIds,
		familySupportMaskByEntry: familySupportSidecar.familySupportMaskByEntry,
	};
}

export function setResidentBodyFamilySupportSidecar(
	arena: ResidentBodyBlockArena,
	sidecar: ResidentBodyFamilySupportSidecar,
): void {
	const mutableArena = arena as {
		familySupportStartByBlockId: ResidentBodyFamilySupportSidecar["familySupportStartByBlockId"];
		familySupportFamilyIds: ResidentBodyFamilySupportSidecar["familySupportFamilyIds"];
		familySupportMaskByEntry: ResidentBodyFamilySupportSidecar["familySupportMaskByEntry"];
	};
	mutableArena.familySupportStartByBlockId =
		sidecar.familySupportStartByBlockId;
	mutableArena.familySupportFamilyIds = sidecar.familySupportFamilyIds;
	mutableArena.familySupportMaskByEntry = sidecar.familySupportMaskByEntry;
}

export function readResidentBodyFamilySupportSidecar(
	arena: ResidentBodyBlockArena,
): ResidentBodyFamilySupportSidecar {
	return {
		familySupportStartByBlockId: arena.familySupportStartByBlockId,
		familySupportFamilyIds: arena.familySupportFamilyIds,
		familySupportMaskByEntry: arena.familySupportMaskByEntry,
		entryCount: arena.familySupportFamilyIds.length,
		bytes:
			arena.familySupportStartByBlockId.byteLength +
			arena.familySupportFamilyIds.byteLength +
			arena.familySupportMaskByEntry.byteLength,
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
		arena.familySupportFamilyIds.byteLength +
		arena.familySupportMaskByEntry.byteLength
	);
}
