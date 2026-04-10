import {
	projectCoverageLexicalV2RuntimeMatchedFiles,
	runCoverageLexicalV2RuntimePrototypeSearch,
} from "src/services/search/coverage-lexical/v2/runtime";
import {
	createPrimaryUnitKey,
} from "src/services/search/coverage-lexical/v2/ranking";

describe("coverage lexical v2 runtime adapter", () => {
	test("adapts runtime-shaped source entries into the V2 prototype chain", () => {
		const result = runCoverageLexicalV2RuntimePrototypeSearch("AI 省考", ["ai", "省考"], [
			{
				docId: 7,
				path: "notes/AI提供数值策划设计.md",
				sourceKind: "metadata",
				matchedPrimaryUnits: [
					{
						normalizedText: "ai",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "basename",
						corroboratedFields: ["body"],
						matchQuality: "exact",
					},
				],
			},
			{
				docId: 7,
				path: "notes/AI提供数值策划设计.md",
				sourceKind: "body",
				matchedPrimaryUnits: [
					{
						normalizedText: "省考",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
				bestWindow: {
					matchedUnitKeys: [
						createPrimaryUnitKey(0, "ai"),
						createPrimaryUnitKey(1, "省考"),
					],
					windowWidth: 9,
					averageDistance: 2,
					preservesSurfaceOrder: true,
				},
			},
			{
				docId: 8,
				path: "notes/省考总结.md",
				sourceKind: "body",
				matchedPrimaryUnits: [
					{
						normalizedText: "省考",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
			},
		], { maxExpensiveCandidates: 2, maxDisplayCandidates: 1 });

		expect(result.coarse.rankedCandidates.map((candidate) => candidate.mergedCandidate.candidateId)).toEqual([
			"7",
			"8",
		]);
		expect(result.finalRanking.rankedCandidates[0].evidence.candidateId).toBe("7");
		expect(result.display.visibleCandidates.map((candidate) => candidate.evidence.candidateId)).toEqual([
			"7",
			"8",
		]);
		expect(result.finalRanking.explain.pairwiseDecision?.decision.layer).toBe("distinctMatchedPrimaryQueryUnitCount");
	});

	test("projects visible V2 runtime candidates into MatchedFile output", () => {
		const result = projectCoverageLexicalV2RuntimeMatchedFiles("AI 省考", ["ai", "省考"], [
			{
				docId: 7,
				path: "notes/AI提供数值策划设计.md",
				sourceKind: "metadata",
				matchedPrimaryUnits: [
					{
						normalizedText: "ai",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "basename",
						corroboratedFields: ["body"],
						matchQuality: "exact",
					},
				],
			},
			{
				docId: 7,
				path: "notes/AI提供数值策划设计.md",
				sourceKind: "body",
				matchedPrimaryUnits: [
					{
						normalizedText: "省考",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
			},
		], { maxDisplayCandidates: 1 });

		expect(result.matchedFiles).toEqual([
			{
				path: "notes/AI提供数值策划设计.md",
				queryTerms: ["ai", "省考"],
				matchedTerms: ["ai", "省考"],
			},
		]);
	});
});
