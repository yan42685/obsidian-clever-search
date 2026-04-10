import {
	mergeCoverageLexicalV2SourceCandidates,
} from "src/services/search/coverage-lexical-v2/coarse";

describe("coverage lexical v2 source adapter", () => {
	test("merges source-based evidence into one doc-level candidate state", () => {
		const merged = mergeCoverageLexicalV2SourceCandidates([
			{
				candidateId: "doc-1",
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
				],
			},
			{
				candidateId: "doc-1",
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
				bestWindow: {
					matchedUnitKeys: ["0:ai", "1:\u7701\u8003"],
					windowWidth: 9,
					averageDistance: 2,
					preservesSurfaceOrder: true,
				},
			},
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			candidateId: "doc-1",
			stableDeterministicKey: "a",
			sourceKinds: ["body", "metadata"],
		});
		expect(merged[0].rankingEvidence.matchedPrimaryUnits).toHaveLength(3);
		expect(merged[0].rankingEvidence.bestWindow).toMatchObject({
			windowWidth: 9,
			averageDistance: 2,
			preservesSurfaceOrder: true,
		});
	});
});
