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
	});

	test("keeps whole-surface Han term when no better real-term cover exists", () => {
		const analysis = analyzeQuery("上面", ["上面"]);

		expect(
			analysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([{ text: "上面", source: "han_tokenizer_real" }]);
		expect(analysis.hanBackstopGroups).toHaveLength(0);
	});
});
