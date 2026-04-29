import {
	buildAdaptivePostingField,
	decodeAdaptivePosting,
} from "src/services/search/coverage-lexical-v3/layout/adaptive-postings";

describe("adaptive posting field", () => {
	it("normalizes posting values across inline and delta lanes", () => {
		const field = buildAdaptivePostingField(
			new Map([
				[40, [4_000_000_000, 1, 65_536, 65_535, 1, 255, 256]],
				[20, [9, 3, 3]],
				[10, [7]],
				[30, [5, 1, 3, 1]],
			]),
			{
				smallInlineCap: 3,
				enablePairLane: true,
			},
		);

		expect(Array.from(field.singletonTermIds)).toEqual([10]);
		expect(Array.from(field.pairTermIds)).toEqual([20]);
		expect(Array.from(field.smallTermIds)).toEqual([30]);
		expect(Array.from(field.deltaTermIds)).toEqual([40]);

		expect(decodeAdaptivePosting(field, 10)).toEqual([7]);
		expect(decodeAdaptivePosting(field, 20)).toEqual([3, 9]);
		expect(decodeAdaptivePosting(field, 30)).toEqual([1, 3, 5]);
		expect(decodeAdaptivePosting(field, 40)).toEqual([
			1,
			255,
			256,
			65_535,
			65_536,
			4_000_000_000,
		]);
	});

	it("deduplicates already sorted posting values without changing lane choice", () => {
		const field = buildAdaptivePostingField(
			new Map([
				[1, [2, 2, 2]],
				[2, [1, 4, 4]],
			]),
			{
				smallInlineCap: 4,
				enablePairLane: true,
			},
		);

		expect(Array.from(field.singletonTermIds)).toEqual([1]);
		expect(Array.from(field.pairTermIds)).toEqual([2]);
		expect(decodeAdaptivePosting(field, 1)).toEqual([2]);
		expect(decodeAdaptivePosting(field, 2)).toEqual([1, 4]);
		expect(decodeAdaptivePosting(field, 99)).toEqual([]);
	});
});
