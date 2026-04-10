import {
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
		], { maxExpensiveCandidates: 2 });

		expect(result.coarse.rankedCandidates.map((candidate) => candidate.mergedCandidate.candidateId)).toEqual([
			"7",
			"8",
		]);
		expect(result.finalRanking.rankedCandidates[0].evidence.candidateId).toBe("7");
		expect(result.finalRanking.explain.pairwiseDecision?.decision.layer).toBe("distinctMatchedPrimaryQueryUnitCount");
	});
});
