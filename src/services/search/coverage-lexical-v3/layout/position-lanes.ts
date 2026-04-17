import {
	buildIntegerArray,
	type ResidentIntegerArray,
} from "./integer-arrays";

export const POSITION_ENCODING_U8 = 0;
export const POSITION_ENCODING_U16 = 1;
export const POSITION_ENCODING_U32 = 2;

export type ResidentBlockPositionLane = Readonly<{
	positionEncodingByBlockId: Uint8Array;
	positionStartByBlockId: ResidentIntegerArray;
	positionDeltaU8Tape: Uint8Array;
	positionDeltaU16Tape: Uint16Array;
	positionDeltaU32Tape: Uint32Array;
}>;

export function buildBlockPositionLane(
	startOffsetsByBlock: readonly (readonly number[])[],
): ResidentBlockPositionLane {
	const positionEncodings: number[] = [];
	const positionStarts: number[] = [];
	const positionDeltaU8Tape: number[] = [];
	const positionDeltaU16Tape: number[] = [];
	const positionDeltaU32Tape: number[] = [];

	for (const startOffsets of startOffsetsByBlock) {
		const deltas = encodeStartOffsetDeltas(startOffsets);
		const maxDelta = computeMaxValue(deltas);
		if (maxDelta <= 0xff) {
			positionEncodings.push(POSITION_ENCODING_U8);
			positionStarts.push(positionDeltaU8Tape.length);
			positionDeltaU8Tape.push(...deltas);
			continue;
		}
		if (maxDelta <= 0xffff) {
			positionEncodings.push(POSITION_ENCODING_U16);
			positionStarts.push(positionDeltaU16Tape.length);
			positionDeltaU16Tape.push(...deltas);
			continue;
		}
		positionEncodings.push(POSITION_ENCODING_U32);
		positionStarts.push(positionDeltaU32Tape.length);
		positionDeltaU32Tape.push(...deltas);
	}

	return {
		positionEncodingByBlockId: Uint8Array.from(positionEncodings),
		positionStartByBlockId: buildIntegerArray(positionStarts),
		positionDeltaU8Tape: Uint8Array.from(positionDeltaU8Tape),
		positionDeltaU16Tape: Uint16Array.from(positionDeltaU16Tape),
		positionDeltaU32Tape: Uint32Array.from(positionDeltaU32Tape),
	};
}

export function decodeBlockPositionLane(
	lane: ResidentBlockPositionLane,
	blockId: number,
	count: number,
): number[] {
	if (count <= 0) {
		return [];
	}
	const encoding = lane.positionEncodingByBlockId[blockId] ?? POSITION_ENCODING_U8;
	const start = lane.positionStartByBlockId[blockId] ?? 0;
	const tape = selectPositionTape(lane, encoding);
	const deltas = Array.from(tape.slice(start, start + count));
	const out: number[] = [];
	let cursor = 0;
	for (let index = 0; index < deltas.length; index += 1) {
		cursor = index === 0 ? deltas[index] ?? 0 : cursor + (deltas[index] ?? 0);
		out.push(cursor);
	}
	return out;
}

export function estimateBlockPositionLaneBytes(
	lane: ResidentBlockPositionLane,
): number {
	return (
		lane.positionEncodingByBlockId.byteLength +
		lane.positionStartByBlockId.byteLength +
		lane.positionDeltaU8Tape.byteLength +
		lane.positionDeltaU16Tape.byteLength +
		lane.positionDeltaU32Tape.byteLength
	);
}

function encodeStartOffsetDeltas(startOffsets: readonly number[]): number[] {
	const deltas: number[] = [];
	let previous = 0;
	for (let index = 0; index < startOffsets.length; index += 1) {
		const startOffset = startOffsets[index] ?? 0;
		if (startOffset < 0) {
			throw new Error("position lane does not support negative start offsets");
		}
		const delta = index === 0 ? startOffset : startOffset - previous;
		if (delta < 0) {
			throw new Error("position lane requires non-decreasing start offsets per block");
		}
		deltas.push(delta);
		previous = startOffset;
	}
	return deltas;
}

function computeMaxValue(values: readonly number[]): number {
	let maxValue = 0;
	for (const value of values) {
		if (value > maxValue) {
			maxValue = value;
		}
	}
	return maxValue;
}

function selectPositionTape(
	lane: ResidentBlockPositionLane,
	encoding: number,
): Uint8Array | Uint16Array | Uint32Array {
	switch (encoding) {
		case POSITION_ENCODING_U16:
			return lane.positionDeltaU16Tape;
		case POSITION_ENCODING_U32:
			return lane.positionDeltaU32Tape;
		default:
			return lane.positionDeltaU8Tape;
	}
}
