import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";

describe("coverage lexical v3 query analysis", () => {
	test("selects a stable non-overlapping Han cover over overlapping tokenizer terms", () => {
		const analysis = analyzeQuery("赢宋窄体", ["赢宋窄体", "赢宋", "窄体"]);

		expect(
			analysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "赢宋", source: "han_tokenizer_real" },
			{ text: "窄体", source: "han_tokenizer_real" },
		]);
		expect(analysis.hanBackstopGroups).toHaveLength(0);
		expect(analysis.surfaceGroups[0]).toEqual(
			expect.objectContaining({
				queryResidualUniqueBigrams: [],
				hasQueryResidualHanCoverage: false,
			}),
		);
	});

	test("keeps whole-surface Han term when no better real-term cover exists", () => {
		const analysis = analyzeQuery("涓婇潰", ["涓婇潰"]);

		expect(
			analysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([{ text: "涓婇潰", source: "han_tokenizer_real" }]);
		expect(analysis.hanBackstopGroups).toHaveLength(0);
	});

	test("derives uncovered unique bigrams only from Han spans left unresolved by real terms", () => {
		const analysis = analyzeQuery("生命力", ["生命"]);

		expect(
			analysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([{ text: "生命", source: "han_tokenizer_real" }]);
		expect(analysis.surfaceGroups[0]).toEqual(
			expect.objectContaining({
				coveredCharMask: [true, true, false],
				queryResidualUniqueBigrams: ["命力"],
				hasQueryResidualHanCoverage: true,
			}),
		);
		expect(analysis.hanBackstopGroups).toEqual([
			expect.objectContaining({
				surfaceGroupIndex: 0,
				bigrams: ["命力"],
				triggerKind: "bridge_bigram",
			}),
		]);
	});
});
