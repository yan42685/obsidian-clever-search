import {
	buildCoverageLexicalV2CandidateCascadeBestWindowForDocument,
	buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits,
	type CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	type CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
} from "src/services/search/coverage-lexical-v2/candidate-cascade";

describe("coverage lexical v2 candidate evidence helpers", () => {
	test("builds matched primary units from query-aware field evidence", () => {
		const primaryUnits: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[] = [
			{
				normalizedText: "ai",
				surfaceGroupIndex: 0,
				surfaceKind: "latin",
			},
			{
				normalizedText: "\u7701\u8003",
				surfaceGroupIndex: 1,
				surfaceKind: "han",
			},
		];

		const matchedPrimaryUnits = buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
			primaryUnits,
			{
				basenameTerms: ["ai"],
				bodyTerms: ["ai", "\u7701\u8003"],
			},
			{
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.2,
			},
		);

		expect(matchedPrimaryUnits).toEqual([
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
				corroboratedFields: [],
				matchQuality: "exact",
			},
		]);
	});

	test("derives best window only from exact local evidence", () => {
		const document: CoverageLexicalV2CandidateCascadeDocumentLexicalState = {
			docId: "doc-1",
			path: "notes/ai-shengkao.md",
			fieldTerms: {
				basenameTerms: ["ai", "\u7701\u8003"],
			},
			basenameTokenSequence: ["ai", "\u7701\u8003"],
		};

		const bestWindow = buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
			[
				{
					normalizedText: "ai",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "basename",
					matchQuality: "exact",
				},
				{
					normalizedText: "\u7701\u8003",
					surfaceGroupIndex: 1,
					surfaceKind: "han",
					strongestField: "basename",
					matchQuality: "exact",
				},
			],
			document,
		);

		expect(bestWindow).toEqual({
			field: "basename",
			matchedUnitKeys: ["0:ai", "1:\u7701\u8003"],
			windowWidth: 2,
			averageDistance: 1,
			preservesSurfaceOrder: true,
		});
	});
});
