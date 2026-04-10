import {
	planCoverageLexicalV2Coarse,
} from "src/services/search/coverage-lexical-v2/coarse";

describe("coverage lexical v2 coarse", () => {
	test("prioritizes fuller coverage candidates for expensive verification", () => {
		const plan = planCoverageLexicalV2Coarse("AI \u7701\u8003", ["ai", "\u7701\u8003"], [
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
					{
						normalizedText: "\u7701\u8003",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
			},
			{
				candidateId: "partial-body",
				stableDeterministicKey: "b",
				sourceKind: "body",
				matchedPrimaryUnits: [
					{
						normalizedText: "\u7701\u8003",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
			},
			{
				candidateId: "body-only-two-unit",
				stableDeterministicKey: "c",
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
						normalizedText: "\u7701\u8003",
						surfaceGroupIndex: 1,
						surfaceKind: "han",
						strongestField: "body",
						matchQuality: "exact",
					},
				],
			},
		], { maxExpensiveCandidates: 2 });

		expect(plan.candidates.map((candidate) => candidate.mergedCandidate.candidateId)).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
			"partial-body",
		]);
		expect(plan.candidates.map((candidate) => candidate.bucket)).toEqual([
			"expensive_priority",
			"expensive_priority",
			"downranked_incomplete",
		]);
		expect(plan.expensiveVerificationCandidateIds).toEqual([
			"metadata-plus-body",
			"body-only-two-unit",
		]);
		expect(plan.candidates[2].shouldEnterExpensiveVerification).toBe(false);
	});
});
