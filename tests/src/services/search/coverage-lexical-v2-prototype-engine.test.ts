import {
	runCoverageLexicalV2PrototypeSearch,
} from "src/services/search/coverage-lexical-v2";
import {
	createPrimaryUnitKey,
} from "src/services/search/coverage-lexical-v2/ranking";

describe("coverage lexical v2 prototype engine", () => {
	test("runs source candidates through coarse, final ranking, and display without V1 coupling", () => {
		const result = runCoverageLexicalV2PrototypeSearch("AI 省考", ["ai", "省考"], [
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
		], { maxExpensiveCandidates: 2, maxDisplayCandidates: 2 });

		expect(result.coarse.rankedCandidates.map((candidate) => candidate.mergedCandidate.candidateId)).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
			"partial-body",
		]);
		expect(result.finalRanking.rankedCandidates.map((candidate) => candidate.evidence.candidateId)).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
			"partial-body",
		]);
		expect(result.display.visibleCandidates.map((candidate) => candidate.evidence.candidateId)).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
		]);
		expect(result.finalRanking.explain.pairwiseDecision).toMatchObject({
			leftCandidateId: "metadata-plus-body",
			rightCandidateId: "body-only-two-unit",
			decision: {
				layer: "matchedPrimaryUnitFieldProfile",
				winnerCandidateId: "metadata-plus-body",
			},
		});
	});
});
