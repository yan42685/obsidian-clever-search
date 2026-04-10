import {
	runCoverageLexicalV2Ranking,
	createPrimaryUnitKey,
} from "src/services/search/coverage-lexical-v2/ranking";

describe("coverage lexical v2 ranking runner", () => {
	test("runs the independent V2 chain end-to-end for AI \u7701\u8003", () => {
		const result = runCoverageLexicalV2Ranking("AI \u7701\u8003", ["ai", "\u7701\u8003"], [
			{
				candidateId: "metadata-plus-body",
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
			},
			{
				candidateId: "body-only-two-unit",
				stableDeterministicKey: "b",
				matchedPrimaryUnits: [
					{
						normalizedText: "ai",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "body",
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
					windowWidth: 10,
					averageDistance: 3,
					preservesSurfaceOrder: true,
				},
			},
			{
				candidateId: "partial-body",
				stableDeterministicKey: "c",
				matchedPrimaryUnits: [
					{
						normalizedText: "\u7701\u8003",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
				bestWindow: null,
			},
		]);

		expect(result.rankedCandidates.map((candidate) => candidate.evidence.candidateId)).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
			"partial-body",
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

	test("keeps near order-neutral behavior for steam password and password steam", () => {
		const forward = runCoverageLexicalV2Ranking("steam password", ["steam", "password"], [
			{
				candidateId: "two-unit-body",
				stableDeterministicKey: "a",
				matchedPrimaryUnits: [
					{
						normalizedText: "steam",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
					{
						normalizedText: "password",
						surfaceGroupIndex: 1,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
				bestWindow: {
					matchedUnitKeys: [
						createPrimaryUnitKey(0, "steam"),
						createPrimaryUnitKey(1, "password"),
					],
					windowWidth: 8,
					averageDistance: 2,
					preservesSurfaceOrder: true,
				},
			},
			{
				candidateId: "partial-steam",
				stableDeterministicKey: "b",
				matchedPrimaryUnits: [
					{
						normalizedText: "steam",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
				bestWindow: null,
			},
		]);
		const reversed = runCoverageLexicalV2Ranking("password steam", ["password", "steam"], [
			{
				candidateId: "two-unit-body",
				stableDeterministicKey: "a",
				matchedPrimaryUnits: [
					{
						normalizedText: "password",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
					{
						normalizedText: "steam",
						surfaceGroupIndex: 1,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
				bestWindow: {
					matchedUnitKeys: [
						createPrimaryUnitKey(0, "password"),
						createPrimaryUnitKey(1, "steam"),
					],
					windowWidth: 8,
					averageDistance: 2,
					preservesSurfaceOrder: true,
				},
			},
			{
				candidateId: "partial-password",
				stableDeterministicKey: "b",
				matchedPrimaryUnits: [
					{
						normalizedText: "password",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
				bestWindow: null,
			},
		]);

		expect(forward.rankedCandidates[0].evidence.candidateId).toBe("two-unit-body");
		expect(reversed.rankedCandidates[0].evidence.candidateId).toBe("two-unit-body");
		expect(forward.explain.pairwiseDecision?.decision.layer).toBe("distinctMatchedPrimaryQueryUnitCount");
		expect(reversed.explain.pairwiseDecision?.decision.layer).toBe("distinctMatchedPrimaryQueryUnitCount");
	});
});
