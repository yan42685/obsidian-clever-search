import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query";
import {
	buildCoverageLexicalV2CheapComparatorCandidate,
	createPrimaryUnitKey,
	patchCoverageLexicalV2ComparatorCandidateWithProximity,
} from "src/services/search/coverage-lexical-v2/comparator";

describe("coverage lexical v2 comparator signals", () => {
	test("builds cheap comparator signals and lets proximity be patched later", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("AI \u7701\u8003", ["ai", "\u7701\u8003"]);
		const evidence = {
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
		};
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, evidence);

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
		expect(candidate.primaryUnitProximityScore).toBeUndefined();
		expect(
			patchCoverageLexicalV2ComparatorCandidateWithProximity(candidate, evidence).primaryUnitProximityScore,
		).toEqual({
			matchedUnitCount: 2,
			windowWidth: 9,
			averageDistance: 2,
			preservesSurfaceOrder: true,
		});
	});

	test("does not let fallback-only evidence count as primary coverage", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("\u8d62\u5b8b", ["\u8d62\u5b8b"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
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
		expect(candidate.primaryUnitProximityScore).toBeUndefined();
	});

	test("preserves partial visible grouping when only one query surface group matches", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("steam password", ["steam", "password"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
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
