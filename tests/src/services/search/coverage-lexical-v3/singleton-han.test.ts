import type { V3QueryAnalysis } from "src/services/search/coverage-lexical-v3/query/analysis";
import { collectCandidateSingletonHanTargets } from "src/services/search/coverage-lexical-v3/singleton-han";

function createQueryAnalysis(overrides: Partial<V3QueryAnalysis>): V3QueryAnalysis {
	return {
		queryText: overrides.queryText ?? "",
		normalizedQueryText: overrides.normalizedQueryText ?? overrides.queryText ?? "",
		querySingletonHanChar: overrides.querySingletonHanChar ?? null,
		querySingletonHanCodePoint: overrides.querySingletonHanCodePoint ?? null,
		querySingletonHanRecallEligible: overrides.querySingletonHanRecallEligible ?? false,
		surfaceGroups: overrides.surfaceGroups ?? [],
		primaryUnits: overrides.primaryUnits ?? [],
		hanBackstopGroups: overrides.hanBackstopGroups ?? [],
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "h",
	};
}

describe("singleton Han targets", () => {
	test("residual singleton targets preserve the uncovered char index", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u751f\u547d\u529b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u751f\u547d\u529b",
					kind: "han",
					hanBigramTexts: ["\u751f\u547d", "\u547d\u529b"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["\u547d\u529b"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{
					index: 0,
					text: "\u751f\u547d",
					source: "han_tokenizer_real",
					surfaceGroupIndex: 0,
				},
			],
		});

		const targets = collectCandidateSingletonHanTargets(queryAnalysis, [
			{
				querySurfaceGroupIndex: 0,
				queryUnitText: "\u751f\u547d",
				familyText: "\u751f\u547d",
				matchKind: "exact",
			},
		]);

		expect(targets).toEqual([
			{
				char: "\u529b",
				singletonHanCharIndex: 2,
				surfaceGroupIndex: 0,
				kind: "residual_singleton",
			},
		]);
	});

	test("query singleton targets keep a null char index", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u529b",
			querySingletonHanChar: "\u529b",
			querySingletonHanCodePoint: "\u529b".codePointAt(0) ?? null,
			querySingletonHanRecallEligible: true,
			surfaceGroups: [
				{
					index: 0,
					text: "\u529b",
					kind: "han",
					hanBigramTexts: [],
					coveredCharMask: [false],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [],
		});

		expect(collectCandidateSingletonHanTargets(queryAnalysis, [])).toEqual([
			{
				char: "\u529b",
				singletonHanCharIndex: null,
				surfaceGroupIndex: null,
				kind: "query_singleton",
			},
		]);
	});
});
