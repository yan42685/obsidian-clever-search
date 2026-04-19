import {
	buildWeightedGapIndex,
	buildWeightedGapIndexFromSegments,
	computeWeightedAdjacentBoundaryGap,
	computeWeightedBoundaryGap,
	computeWeightedGap,
} from "src/services/search/coverage-lexical-v3/weighted-gap";

describe("weighted gap helpers", () => {
	test("same-block boundary gaps treat touching spans as zero", () => {
		const index = buildWeightedGapIndex("\u751f\u547d\u529b");

		expect(computeWeightedBoundaryGap(index, 0, 2, 2, 3)).toBe(0);
		expect(computeWeightedBoundaryGap(index, 2, 3, 0, 2)).toBe(0);
	});

	test("same-block weighted gaps use Han and non-Han weights", () => {
		const index = buildWeightedGapIndex("\u751fa\u547d");

		expect(computeWeightedBoundaryGap(index, 0, 1, 2, 3)).toBeCloseTo(0.25);
	});

	test("adjacent-block weighted gaps have zero boundary penalty", () => {
		const leftIndex = buildWeightedGapIndex("\u751f\u547d");
		const rightIndex = buildWeightedGapIndex("\u529b\u5b66");

		expect(
			computeWeightedAdjacentBoundaryGap(leftIndex, 0, 2, rightIndex, 0, 1),
		).toBe(0);
	});

	test("sparse block indexes keep O(1) gap queries consistent", () => {
		const index = buildWeightedGapIndexFromSegments(4, [{ start: 1, text: "\u529b" }]);

		expect(computeWeightedGap(index, 0, 4)).toBeCloseTo(1.4);
		expect(computeWeightedBoundaryGap(index, 0, 1, 2, 3)).toBeCloseTo(0.65);
	});
});
