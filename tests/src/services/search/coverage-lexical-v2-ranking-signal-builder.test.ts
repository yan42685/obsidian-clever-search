import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query-units";
import {
	buildCoverageLexicalV2RankingCandidate,
	createPrimaryUnitKey,
} from "src/services/search/coverage-lexical-v2/ranking";

describe("coverage lexical v2 ranking signal builder", () => {
	test("builds field profile and surface shape from matched primary units", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("AI \u7701\u8003", ["ai", "\u7701\u8003"]);
		const candidate = buildCoverageLexicalV2RankingCandidate(queryAnalysis, {
			candidateId: "doc-ai-shengkao",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "ai",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "basename",
					corroboratedFields: ["body"],
					matchQuality: "exact",
				},
				{
					normalizedText: "\u7701\u8003",
					surfaceGroupIndex: 1,
					surfaceKind: "han",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
			bestWindow: {
				matchedUnitKeys: [
					createPrimaryUnitKey(0, "ai"),
					createPrimaryUnitKey(1, "\u7701\u8003"),
				],
				windowWidth: 9,
				averageDistance: 2,
				preservesSurfaceOrder: true,
			},
		});

		expect(candidate.distinctMatchedPrimaryQueryUnitCount).toBe(2);
		expect(candidate.surfaceCoverageShape).toEqual({
			matchedGroupCount: 2,
			totalGroupCount: 2,
			preservesVisibleGrouping: true,
			preservesCrossScriptCoverage: true,
		});
		expect(candidate.matchedPrimaryUnitFieldProfile).toEqual({
			basenameScore: 1,
			aliasesScore: 0,
			headingsScore: 0,
			folderScore: 0,
			tagScore: 0,
			bodyScore: 1.1,
		});
		expect(candidate.primaryUnitMatchQuality).toEqual({
			latinExactCount: 1,
			latinPrefixCount: 0,
			latinFuzzyCount: 0,
			hanExactCount: 1,
		});
		expect(candidate.primaryUnitProximityScore).toEqual({
			matchedUnitCount: 2,
			windowWidth: 9,
			averageDistance: 2,
			preservesSurfaceOrder: true,
		});
	});

	test("does not let fallback-only evidence count as primary coverage", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("\u8d62\u5b8b", ["\u8d62\u5b8b"]);
		const candidate = buildCoverageLexicalV2RankingCandidate(queryAnalysis, {
			candidateId: "doc-yingsong",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "\u8d62",
					surfaceGroupIndex: 0,
					surfaceKind: "han",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
		});

		expect(candidate.distinctMatchedPrimaryQueryUnitCount).toBe(0);
		expect(candidate.surfaceCoverageShape.matchedGroupCount).toBe(0);
		expect(candidate.matchedPrimaryUnitFieldProfile.bodyScore).toBe(0);
		expect(candidate.primaryUnitMatchQuality.hanExactCount).toBe(0);
		expect(candidate.primaryUnitProximityScore).toBeNull();
	});

	test("preserves partial visible grouping when only one query surface group matches", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("steam password", ["steam", "password"]);
		const candidate = buildCoverageLexicalV2RankingCandidate(queryAnalysis, {
			candidateId: "doc-steam-only",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "steam",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
		});

		expect(candidate.distinctMatchedPrimaryQueryUnitCount).toBe(1);
		expect(candidate.surfaceCoverageShape).toEqual({
			matchedGroupCount: 1,
			totalGroupCount: 2,
			preservesVisibleGrouping: false,
			preservesCrossScriptCoverage: true,
		});
	});
});
