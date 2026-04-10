import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query";
import {
	buildCoverageLexicalV2CheapComparatorCandidate,
	createPrimaryUnitKey,
} from "src/services/search/coverage-lexical-v2/comparator";
import {
	buildCoverageLexicalV2ExplainPayload,
} from "src/services/search/coverage-lexical-v2/explain";

describe("coverage lexical v2 explain payload", () => {
	test("builds structured explain output from query analysis and ranking candidates", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("AI \u7701\u8003", ["ai", "\u7701\u8003"]);
		const leftEvidence = {
			candidateId: "left-doc",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "ai",
					surfaceGroupIndex: 0,
					surfaceKind: "latin" as const,
					strongestField: "basename" as const,
					corroboratedFields: ["body" as const],
					matchQuality: "exact" as const,
				},
				{
					normalizedText: "\u7701\u8003",
					surfaceGroupIndex: 1,
					surfaceKind: "han" as const,
					strongestField: "body" as const,
					matchQuality: "exact" as const,
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
		const rightEvidence = {
			candidateId: "right-doc",
			stableDeterministicKey: "b",
			matchedPrimaryUnits: [
				{
					normalizedText: "\u7701\u8003",
					surfaceGroupIndex: 1,
					surfaceKind: "han" as const,
					strongestField: "body" as const,
					matchQuality: "exact" as const,
				},
			],
			bestWindow: null,
		};
		const leftCandidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, leftEvidence);
		const rightCandidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, rightEvidence);
		const explain = buildCoverageLexicalV2ExplainPayload(
			queryAnalysis,
			[
				{ evidence: leftEvidence, comparatorCandidate: leftCandidate },
				{ evidence: rightEvidence, comparatorCandidate: rightCandidate },
			],
			{ left: leftCandidate, right: rightCandidate },
		);

		expect(explain.normalizedQueryText).toBe("ai \u7701\u8003");
		expect(explain.surfaceShape.kind).toBe("mixed_script_grouped");
		expect(explain.primaryUnits.map((unit) => unit.normalizedText)).toEqual(
			expect.arrayContaining(["ai", "\u7701\u8003"]),
		);
		expect(explain.candidates).toHaveLength(2);
		expect(explain.candidates[0]).toMatchObject({
			candidateId: "left-doc",
			stableDeterministicKey: "a",
		});
		expect(explain.pairwiseDecision).toMatchObject({
			leftCandidateId: "left-doc",
			rightCandidateId: "right-doc",
			decision: {
				layer: "distinctMatchedPrimaryQueryUnitCount",
				winnerCandidateId: "left-doc",
			},
		});
	});
});
