import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical/v2/query-units";

describe("coverage lexical v2 query units", () => {
	test("preserves short Han surface segments as primary and bigrams as fallback", () => {
		const analysis = buildCoverageLexicalV2QueryAnalysis("\u653f\u6cbb\u7406\u8bba", ["\u653f\u6cbb", "\u7406\u8bba"]);

		expect(analysis.primaryUnits.map((unit) => unit.normalizedText)).toEqual(
			expect.arrayContaining(["\u653f\u6cbb\u7406\u8bba", "\u653f\u6cbb", "\u7406\u8bba"]),
		);
		expect(analysis.fallbackUnits.map((unit) => unit.normalizedText)).toEqual(
			expect.arrayContaining(["\u653f\u6cbb", "\u6cbb\u7406", "\u7406\u8bba"]),
		);
		expect(analysis.surfaceGroups).toHaveLength(1);
		expect(analysis.surfaceGroups[0].kind).toBe("han");
		expect(analysis.surfaceShape.kind).toBe("single_group");
		expect(analysis.surfaceShape.requiresMultiGroupCoverage).toBe(false);
		expect(analysis.surfaceShape.requiresCrossScriptCoverage).toBe(false);
	});

	test("keeps mixed script groups visible in query analysis", () => {
		const analysis = buildCoverageLexicalV2QueryAnalysis("AI \u7701\u8003", ["ai", "\u7701\u8003"]);

		expect(analysis.hasMixedScriptGroups).toBe(true);
		expect(analysis.primaryUnits.map((unit) => unit.normalizedText)).toEqual(
			expect.arrayContaining(["ai", "\u7701\u8003"]),
		);
		expect(analysis.surfaceGroups.map((group) => group.kind)).toEqual([
			"latin",
			"han",
		]);
		expect(analysis.surfaceShape.kind).toBe("mixed_script_grouped");
		expect(analysis.surfaceShape.requiresMultiGroupCoverage).toBe(true);
		expect(analysis.surfaceShape.requiresCrossScriptCoverage).toBe(true);
	});

	test("keeps latin-only queries as primary latin segments", () => {
		const analysis = buildCoverageLexicalV2QueryAnalysis("steam password", ["steam", "password"]);

		expect(analysis.primaryUnits.map((unit) => unit.normalizedText)).toEqual([
			"steam",
			"password",
		]);
		expect(analysis.fallbackUnits).toHaveLength(0);
		expect(analysis.surfaceShape.kind).toBe("multi_group");
		expect(analysis.surfaceShape.requiresMultiGroupCoverage).toBe(true);
		expect(analysis.surfaceShape.requiresCrossScriptCoverage).toBe(false);
	});

	test("does not dynamically promote fallback bigrams into primary units", () => {
		const analysis = buildCoverageLexicalV2QueryAnalysis("\u8d62\u5b8b", ["\u8d62\u5b8b"]);

		expect(analysis.primaryUnits.map((unit) => unit.normalizedText)).toContain("\u8d62\u5b8b");
		expect(analysis.primaryUnits.map((unit) => unit.normalizedText)).not.toContain("\u8d62");
		expect(analysis.fallbackUnits.map((unit) => unit.normalizedText)).toEqual(
			expect.arrayContaining(["\u8d62\u5b8b"]),
		);
	});
});
