import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query";
import {
	buildCoverageLexicalV2CheapComparatorCandidate,
	createPrimaryUnitKey,
	patchCoverageLexicalV2ComparatorCandidateWithProximity,
	type CoverageLexicalV2ComparatorEvidence,
} from "src/services/search/coverage-lexical-v2/comparator";

describe("coverage lexical v2 comparator signals", () => {
	test("builds cheap comparator signals and lets proximity be patched later", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("AI exam", ["ai", "exam"]);
		const evidence: CoverageLexicalV2ComparatorEvidence = {
			candidateId: "doc-ai-exam",
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
					normalizedText: "exam",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
			bestWindow: {
				matchedUnitKeys: [
					createPrimaryUnitKey(0, "ai"),
					createPrimaryUnitKey(1, "exam"),
				],
				contiguousSurfaceGroupCount: 2,
				windowWidth: 9,
				averageDistance: 2,
				preservesSurfaceOrder: true,
			},
			cheapExactWitnessSummary: {
				intactSurfacePrimaryUnitKeys: [
					createPrimaryUnitKey(0, "ai"),
					createPrimaryUnitKey(1, "exam"),
				],
				matchedPrimaryUnitExactWitnesses: [],
				maxAdjacentExactMatchedPrimaryRunLength: 0,
				adjacentExactMatchedPrimaryUnitCount: 0,
				adjacencyField: null,
				adjacentExactMatchedPrimaryUnitKeys: [],
			},
		};
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, evidence);

		expect(candidate.distinctMatchedPrimaryQueryUnitCount).toBe(2);
		expect(candidate.surfaceCoverageShape).toEqual({
			matchedGroupCount: 2,
			totalGroupCount: 2,
			preservesVisibleGrouping: true,
			preservesCrossScriptCoverage: true,
		});
		expect(candidate.cheapExactPrimaryContiguity).toEqual({
			intactExactSurfaceGroupCount: 2,
			intactExactPrimaryUnitCount: 2,
			maxAdjacentExactMatchedPrimaryRunLength: 0,
			adjacentExactMatchedPrimaryUnitCount: 0,
		});
		expect(candidate.cheapSharedFieldCoverage).toEqual({
			coversAllMatchedPrimaryUnitsInOneField: true,
			maxDistinctPrimaryUnitsInSameField: 2,
		});
		expect(candidate.matchedPrimaryUnitFieldProfile).toEqual({
			basenameScore: 1,
			aliasesScore: 0,
			headingsScore: 0,
			folderScore: 0,
			tagScore: 0,
			bodyScore: 1.1,
		});
		expect(candidate.primaryUnitMatchQuality).toEqual({
			latinExactCount: 2,
			latinPrefixCount: 0,
			latinFuzzyCount: 0,
			hanExactCount: 0,
		});
		expect(candidate.primaryUnitProximityScore).toBeUndefined();
		expect(
			patchCoverageLexicalV2ComparatorCandidateWithProximity(candidate, evidence).primaryUnitProximityScore,
		).toEqual({
			matchedUnitCount: 2,
			contiguousSurfaceGroupCount: 2,
			windowWidth: 9,
			averageDistance: 2,
			preservesSurfaceOrder: true,
		});
	});

	test("records sorted metadata prefix witnesses when prefix evidence carries witness detail", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("pas sec", ["pas", "sec"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-prefix",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "pas",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "basename",
					matchQuality: "prefix",
					prefixWitnessLite: {
						field: "basename",
						surfaceText: "password",
						cleanBoundary: true,
						compoundPenalty: false,
						surfaceCompletionGain: 5,
						fieldDocCount: 2,
					},
				},
				{
					normalizedText: "sec",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "folder",
					matchQuality: "prefix",
					prefixWitnessLite: {
						field: "folder",
						surfaceText: "security-archive",
						cleanBoundary: false,
						compoundPenalty: true,
						surfaceCompletionGain: 13,
						fieldDocCount: 8,
					},
				},
			],
		});

		expect(candidate.primaryUnitMatchQuality).toEqual({
			latinExactCount: 0,
			latinPrefixCount: 2,
			latinFuzzyCount: 0,
			hanExactCount: 0,
			metadataPrefixWitnesses: [
				{
					field: "basename",
					surfaceText: "password",
					cleanBoundary: true,
					compoundPenalty: false,
					surfaceCompletionGain: 5,
					fieldDocCount: 2,
				},
				{
					field: "folder",
					surfaceText: "security-archive",
					cleanBoundary: false,
					compoundPenalty: true,
					surfaceCompletionGain: 13,
					fieldDocCount: 8,
				},
			],
		});
		expect(candidate.cheapSharedFieldCoverage).toEqual({
			coversAllMatchedPrimaryUnitsInOneField: false,
			maxDistinctPrimaryUnitsInSameField: 1,
		});
	});

	test("does not let fallback-only evidence count as primary coverage", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("??", ["??"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-yingsong",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "?",
					surfaceGroupIndex: 0,
					surfaceKind: "han",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
		});

		expect(candidate.distinctMatchedPrimaryQueryUnitCount).toBe(0);
		expect(candidate.surfaceCoverageShape.matchedGroupCount).toBe(0);
		expect(candidate.cheapExactPrimaryContiguity).toEqual({
			intactExactSurfaceGroupCount: 0,
			intactExactPrimaryUnitCount: 0,
			maxAdjacentExactMatchedPrimaryRunLength: 0,
			adjacentExactMatchedPrimaryUnitCount: 0,
		});
		expect(candidate.cheapSharedFieldCoverage).toEqual({
			coversAllMatchedPrimaryUnitsInOneField: false,
			maxDistinctPrimaryUnitsInSameField: 0,
		});
		expect(candidate.matchedPrimaryUnitFieldProfile.bodyScore).toBe(0);
		expect(candidate.primaryUnitMatchQuality.hanExactCount).toBe(0);
		expect(candidate.primaryUnitProximityScore).toBeUndefined();
	});

	test("counts Han surface-segment exact evidence in cheap exact contiguity", () => {
		const system = "\u7cfb\u7edf";
		const agent = "\u4ee3\u7406";
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(`${system}${agent}`, [system, agent]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-han-surface",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: system,
					surfaceGroupIndex: 0,
					surfaceKind: "han",
					strongestField: "body",
					matchQuality: "exact",
				},
				{
					normalizedText: agent,
					surfaceGroupIndex: 0,
					surfaceKind: "han",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
			cheapExactWitnessSummary: {
				intactSurfacePrimaryUnitKeys: [createPrimaryUnitKey(0, `${system}${agent}`)],
				matchedPrimaryUnitExactWitnesses: [],
				maxAdjacentExactMatchedPrimaryRunLength: 0,
				adjacentExactMatchedPrimaryUnitCount: 0,
				adjacencyField: null,
				adjacentExactMatchedPrimaryUnitKeys: [],
			},
		});

		expect(candidate.cheapExactPrimaryContiguity).toEqual({
			intactExactSurfaceGroupCount: 1,
			intactExactPrimaryUnitCount: 1,
			maxAdjacentExactMatchedPrimaryRunLength: 0,
			adjacentExactMatchedPrimaryUnitCount: 0,
		});
		expect(candidate.cheapSharedFieldCoverage).toEqual({
			coversAllMatchedPrimaryUnitsInOneField: true,
			maxDistinctPrimaryUnitsInSameField: 2,
		});
	});

	test("uses exact witness summary to count adjacency without needing intact surface exact", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("foo bar", ["foo", "bar"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-adjacent",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "foo",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "headings",
					matchQuality: "exact",
				},
				{
					normalizedText: "bar",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "headings",
					matchQuality: "exact",
				},
			],
			cheapExactWitnessSummary: {
				intactSurfacePrimaryUnitKeys: [],
				matchedPrimaryUnitExactWitnesses: [
					{
						field: "headings",
						unitKey: createPrimaryUnitKey(0, "foo"),
						surfaceGroupIndex: 0,
						start: 4,
						end: 4,
					},
					{
						field: "headings",
						unitKey: createPrimaryUnitKey(1, "bar"),
						surfaceGroupIndex: 1,
						start: 5,
						end: 5,
					},
				],
				maxAdjacentExactMatchedPrimaryRunLength: 2,
				adjacentExactMatchedPrimaryUnitCount: 2,
				adjacencyField: "headings",
				adjacentExactMatchedPrimaryUnitKeys: [
					createPrimaryUnitKey(0, "foo"),
					createPrimaryUnitKey(1, "bar"),
				],
			},
		});

		expect(candidate.cheapExactPrimaryContiguity).toEqual({
			intactExactSurfaceGroupCount: 0,
			intactExactPrimaryUnitCount: 0,
			maxAdjacentExactMatchedPrimaryRunLength: 2,
			adjacentExactMatchedPrimaryUnitCount: 2,
		});
	});

	test("lets exact and prefix share the same-field cheap aggregation while fuzzy stays out", () => {
		const queryAnalysis = buildCoverageLexicalV2QueryAnalysis("pre abs misc", ["pre", "abs", "misc"]);
		const candidate = buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, {
			candidateId: "doc-shared-field",
			stableDeterministicKey: "a",
			matchedPrimaryUnits: [
				{
					normalizedText: "pre",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "prefix",
				},
				{
					normalizedText: "abs",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "exact",
				},
				{
					normalizedText: "misc",
					surfaceGroupIndex: 2,
					surfaceKind: "latin",
					strongestField: "headings",
					matchQuality: "fuzzy",
				},
			],
		});

		expect(candidate.cheapSharedFieldCoverage).toEqual({
			coversAllMatchedPrimaryUnitsInOneField: true,
			maxDistinctPrimaryUnitsInSameField: 2,
		});
	});
});
