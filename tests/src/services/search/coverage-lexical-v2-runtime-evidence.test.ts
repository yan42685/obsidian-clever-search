import {
	buildCoverageLexicalV2RuntimeBestWindowForDocument,
	buildCoverageLexicalV2RuntimeMatchedPrimaryUnits,
	type CoverageLexicalV2RuntimeDocumentLexicalState,
	type CoverageLexicalV2RuntimePrimaryUnitDefinition,
} from "src/services/search/coverage-lexical-v2/runtime";

describe("coverage lexical v2 runtime evidence helpers", () => {
	test("builds matched primary units from query-unit-aware field evidence", () => {
		const primaryUnits: CoverageLexicalV2RuntimePrimaryUnitDefinition[] = [
			{
				normalizedText: "ai",
				surfaceGroupIndex: 0,
				surfaceKind: "latin",
			},
			{
				normalizedText: "省考",
				surfaceGroupIndex: 1,
				surfaceKind: "han",
			},
		];

		const matchedPrimaryUnits = buildCoverageLexicalV2RuntimeMatchedPrimaryUnits(
			primaryUnits,
			{
				basenameTerms: ["ai"],
				bodyTerms: ["ai", "省考"],
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
				normalizedText: "省考",
				surfaceGroupIndex: 1,
				surfaceKind: "han",
				strongestField: "body",
				corroboratedFields: [],
				matchQuality: "exact",
			},
		]);
	});

	test("derives best window only from exact local evidence", () => {
		const document: CoverageLexicalV2RuntimeDocumentLexicalState = {
			docId: "doc-1",
			path: "notes/ai-省考.md",
			fieldTerms: {
				basenameTerms: ["ai", "省考"],
			},
			basenameTokenSequence: ["ai", "省考"],
		};

		const bestWindow = buildCoverageLexicalV2RuntimeBestWindowForDocument(
			[
				{
					normalizedText: "ai",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "basename",
					matchQuality: "exact",
				},
				{
					normalizedText: "省考",
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
			matchedUnitKeys: ["0:ai", "1:省考"],
			windowWidth: 2,
			averageDistance: 1,
			preservesSurfaceOrder: true,
		});
	});
});
