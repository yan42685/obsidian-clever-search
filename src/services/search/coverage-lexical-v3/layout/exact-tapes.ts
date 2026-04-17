import {
	buildBlockPositionLane,
	estimateBlockPositionLaneBytes,
} from "./position-lanes";
import { buildIntegerArray } from "./integer-arrays";
import type { ResidentExactTapeArena } from "./types";

export type ExactTapeDraft = Readonly<{
	familyIds: readonly number[];
	startOffsets: readonly number[];
}>;

export type ExactTapeBuildOutput = Readonly<{
	arena: ResidentExactTapeArena;
	startsByDraftIndex: ReturnType<typeof buildIntegerArray>;
	countsByDraftIndex: ReturnType<typeof buildIntegerArray>;
}>;

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
