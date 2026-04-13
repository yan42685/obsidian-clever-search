import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query";
import {
	buildCoverageLexicalV2CheapComparatorCandidate,
	createPrimaryUnitKey,
	patchCoverageLexicalV2ComparatorCandidateWithProximity,
	type CoverageLexicalV2ComparatorEvidence,
} from "src/services/search/coverage-lexical-v2/comparator";

describe("coverage lexical v2 comparator signals", () => {
	test("builds cheap comparator signals and lets proximity be patched later", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("AI exam", ["ai", "exam"]);
		const evidence: CoverageLexicalV2ComparatorEvidence = {
			candidateId: "doc-ai-exam",
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
					normalizedText: "exam",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
			bestWindow: {
				matchedUnitKeys: [
					createPrimaryUnitKey(0, "ai"),
					createPrimaryUnitKey(1, "exam"),
				],
				contiguousSurfaceGroupCount: 2,
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
			latinExactCount: 2,
			latinPrefixCount: 0,
			latinFuzzyCount: 0,
			hanExactCount: 0,
		});
		expect(candidate.primaryUnitProximityScore).toBeUndefined();
		expect(
			patchCoverageLexicalV2ComparatorCandidateWithProximity(candidate, evidence).primaryUnitProximityScore,
		).toEqual({
			matchedUnitCount: 2,
			contiguousSurfaceGroupCount: 2,
			windowWidth: 9,
			averageDistance: 2,
			preservesSurfaceOrder: true,
		});
	});

	test("records sorted metadata prefix witnesses when prefix evidence carries witness detail", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("pas sec", ["pas", "sec"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-prefix",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "pas",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "basename",
					matchQuality: "prefix",
					prefixWitnessLite: {
						field: "basename",
						surfaceText: "password",
						cleanBoundary: true,
						compoundPenalty: false,
						surfaceCompletionGain: 5,
						fieldDocCount: 2,
					},
				},
				{
					normalizedText: "sec",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "folder",
					matchQuality: "prefix",
					prefixWitnessLite: {
						field: "folder",
						surfaceText: "security-archive",
						cleanBoundary: false,
						compoundPenalty: true,
						surfaceCompletionGain: 13,
						fieldDocCount: 8,
					},
				},
			],
		});

		expect(candidate.primaryUnitMatchQuality).toEqual({
			latinExactCount: 0,
			latinPrefixCount: 2,
			latinFuzzyCount: 0,
			hanExactCount: 0,
			metadataPrefixWitnesses: [
				{
					field: "basename",
					surfaceText: "password",
					cleanBoundary: true,
					compoundPenalty: false,
					surfaceCompletionGain: 5,
					fieldDocCount: 2,
				},
				{
					field: "folder",
					surfaceText: "security-archive",
					cleanBoundary: false,
					compoundPenalty: true,
					surfaceCompletionGain: 13,
					fieldDocCount: 8,
				},
			],
		});
	});

	test("does not let fallback-only evidence count as primary coverage", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("??", ["??"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-yingsong",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "?",
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
});


