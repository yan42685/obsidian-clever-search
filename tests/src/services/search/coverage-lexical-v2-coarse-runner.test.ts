import {
	runCoverageLexicalV2CoarseRanking,
} from "src/services/search/coverage-lexical/v2/coarse";
import {
	createPrimaryUnitKey,
} from "src/services/search/coverage-lexical/v2/ranking";

describe("coverage lexical v2 coarse runner", () => {
	test("runs the independent V2 coarse chain end-to-end for AI 省考", () => {
		const result = runCoverageLexicalV2CoarseRanking("AI 省考", ["ai", "省考"], [
			{
				candidateId: "metadata-plus-body",
				stableDeterministicKey: "a",
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
				bestWindow: {
					matchedUnitKeys: [createPrimaryUnitKey(0, "ai")],
					windowWidth: 4,
					averageDistance: 0,
					preservesSurfaceOrder: true,
				},
			},
			{
				candidateId: "metadata-plus-body",
				stableDeterministicKey: "a",
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
				candidateId: "body-only-two-unit",
				stableDeterministicKey: "b",
				sourceKind: "body",
				matchedPrimaryUnits: [
					{
						normalizedText: "ai",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
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
					windowWidth: 10,
					averageDistance: 3,
					preservesSurfaceOrder: true,
				},
			},
			{
				candidateId: "partial-body",
				stableDeterministicKey: "c",
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

		expect(result.rankedCandidates.map((candidate) => candidate.mergedCandidate.candidateId)).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
			"partial-body",
		]);
		expect(result.coarsePlan.expensiveVerificationCandidateIds).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
		]);
		expect(result.topTieBandCandidateIds).toEqual(["metadata-plus-body"]);
		expect(result.explain.pairwiseDecision).toMatchObject({
			leftCandidateId: "metadata-plus-body",
			rightCandidateId: "body-only-two-unit",
			decision: {
				layer: "matchedPrimaryUnitFieldProfile",
				winnerCandidateId: "metadata-plus-body",
			},
		});
	});
});
