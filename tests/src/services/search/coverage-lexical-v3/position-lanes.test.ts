import {
	buildBlockPositionLane,
	decodeBlockPositionLane,
	POSITION_ENCODING_U8,
	POSITION_ENCODING_U16,
	POSITION_ENCODING_U32,
} from "src/services/search/coverage-lexical-v3/layout/position-lanes";

describe("coverage lexical v3 position lanes", () => {
	test("encodes and decodes u8 block deltas", () => {
		const lane = buildBlockPositionLane([[3, 7, 20]]);

		expect(lane.positionEncodingByBlockId[0]).toBe(POSITION_ENCODING_U8);
		expect(decodeBlockPositionLane(lane, 0, 3)).toEqual([3, 7, 20]);
	});

	test("encodes and decodes u16 block deltas", () => {
		const lane = buildBlockPositionLane([[10, 400, 900]]);

		expect(lane.positionEncodingByBlockId[0]).toBe(POSITION_ENCODING_U16);
		expect(decodeBlockPositionLane(lane, 0, 3)).toEqual([10, 400, 900]);
	});

	test("encodes and decodes u32 block deltas", () => {
		const lane = buildBlockPositionLane([[5, 70000]]);

		expect(lane.positionEncodingByBlockId[0]).toBe(POSITION_ENCODING_U32);
		expect(decodeBlockPositionLane(lane, 0, 2)).toEqual([5, 70000]);
	});

	test("supports mixed-width blocks in one lane", () => {
		const lane = buildBlockPositionLane([
			[2, 9, 14],
			[10, 400, 900],
			[5, 70000],
		]);

		expect(Array.from(lane.positionEncodingByBlockId)).toEqual([
			POSITION_ENCODING_U8,
			POSITION_ENCODING_U16,
			POSITION_ENCODING_U32,
		]);
		expect(decodeBlockPositionLane(lane, 0, 3)).toEqual([2, 9, 14]);
		expect(decodeBlockPositionLane(lane, 1, 3)).toEqual([10, 400, 900]);
		expect(decodeBlockPositionLane(lane, 2, 2)).toEqual([5, 70000]);
	});
});
