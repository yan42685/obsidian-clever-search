import {
	buildBlockPositionLane,
	estimateBlockPositionLaneBytes,
} from "./position-lanes";
import { buildIntegerArray } from "./integer-arrays";
import type {
	ResidentExactTapeArena,
	ResidentExactTapeSidecar,
} from "./types";

export type ExactTapeDraft = Readonly<{
	familyIds: readonly number[];
	startOffsets: readonly number[];
}>;

export type ExactTapeBuildOutput = Readonly<{
	arena: ResidentExactTapeArena;
	startsByDraftIndex: ReturnType<typeof buildIntegerArray>;
	countsByDraftIndex: ReturnType<typeof buildIntegerArray>;
}>;

export function createEmptyResidentExactTapeSidecar(): ResidentExactTapeSidecar {
	return {
		familyIds: buildIntegerArray([]),
		positionEncodingByBlockId: new Uint8Array(),
		positionStartByBlockId: buildIntegerArray([]),
		positionDeltaU8Tape: new Uint8Array(),
		positionDeltaU16Tape: new Uint16Array(),
		positionDeltaU32Tape: new Uint32Array(),
		entryCount: 0,
		bytes: 0,
	};
}

export const EMPTY_RESIDENT_EXACT_TAPE_SIDECAR =
	createEmptyResidentExactTapeSidecar();

export function buildExactTapeArena(
	drafts: readonly ExactTapeDraft[],
): ExactTapeBuildOutput {
	const familyIds: number[] = [];
	const starts: number[] = [];
	const counts: number[] = [];
	const startOffsetsByDraftIndex: number[][] = [];
	for (const draft of drafts) {
		starts.push(familyIds.length);
		counts.push(draft.familyIds.length);
		familyIds.push(...draft.familyIds);
		startOffsetsByDraftIndex.push([...draft.startOffsets]);
	}
	const positionLane = buildBlockPositionLane(startOffsetsByDraftIndex);
	return {
		arena: {
			familyIds: buildIntegerArray(familyIds),
			positionEncodingByBlockId: positionLane.positionEncodingByBlockId,
			positionStartByBlockId: positionLane.positionStartByBlockId,
			positionDeltaU8Tape: positionLane.positionDeltaU8Tape,
			positionDeltaU16Tape: positionLane.positionDeltaU16Tape,
			positionDeltaU32Tape: positionLane.positionDeltaU32Tape,
		},
		startsByDraftIndex: buildIntegerArray(starts),
		countsByDraftIndex: buildIntegerArray(counts),
	};
}

export function estimateExactTapeBytes(
	arena: ResidentExactTapeArena,
): number {
	return arena.familyIds.byteLength + estimateBlockPositionLaneBytes(arena);
}

export function buildResidentExactTapeSidecar(
	arena: ResidentExactTapeArena,
): ResidentExactTapeSidecar {
	return {
		...arena,
		entryCount: arena.familyIds.length,
		bytes: estimateExactTapeBytes(arena),
	};
}

export function setResidentExactTapeSidecar(
	arena: ResidentExactTapeArena,
	sidecar: ResidentExactTapeArena,
): void {
	const mutableArena = arena as {
		familyIds: ResidentExactTapeArena["familyIds"];
		positionEncodingByBlockId: ResidentExactTapeArena["positionEncodingByBlockId"];
		positionStartByBlockId: ResidentExactTapeArena["positionStartByBlockId"];
		positionDeltaU8Tape: ResidentExactTapeArena["positionDeltaU8Tape"];
		positionDeltaU16Tape: ResidentExactTapeArena["positionDeltaU16Tape"];
		positionDeltaU32Tape: ResidentExactTapeArena["positionDeltaU32Tape"];
	};
	mutableArena.familyIds = sidecar.familyIds;
	mutableArena.positionEncodingByBlockId = sidecar.positionEncodingByBlockId;
	mutableArena.positionStartByBlockId = sidecar.positionStartByBlockId;
	mutableArena.positionDeltaU8Tape = sidecar.positionDeltaU8Tape;
	mutableArena.positionDeltaU16Tape = sidecar.positionDeltaU16Tape;
	mutableArena.positionDeltaU32Tape = sidecar.positionDeltaU32Tape;
}
