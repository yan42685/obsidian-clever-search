import {
	compareCoverageLexicalV2ComparatorCandidates,
	explainCoverageLexicalV2ComparatorDecision,
	selectCoverageLexicalV2ComparatorTopTieBand,
	type CoverageLexicalV2ComparatorCandidate,
} from "src/services/search/coverage-lexical-v2/comparator";

function createCandidate(
	overrides: Partial<CoverageLexicalV2ComparatorCandidate>,
): CoverageLexicalV2ComparatorCandidate {
	return {
		candidateId: "candidate",
		distinctMatchedPrimaryQueryUnitCount: 1,
		surfaceCoverageShape: {
			matchedGroupCount: 1,
			totalGroupCount: 1,
			preservesVisibleGrouping: true,
			preservesCrossScriptCoverage: false,
		},
		matchedPrimaryUnitFieldProfile: {
			basenameScore: 0,
			aliasesScore: 0,
			headingsScore: 0,
			folderScore: 0,
			tagScore: 0,
			bodyScore: 1,
		},
		primaryUnitMatchQuality: {
			latinExactCount: 0,
			latinPrefixCount: 0,
			latinFuzzyCount: 0,
			hanExactCount: 1,
		},
		primaryUnitProximityScore: null,
		stableDeterministicKey: "candidate",
		...overrides,
	};
}

describe("coverage lexical v2 ranking comparator", () => {
	test("prefers more matched primary query units", () => {
		const fuller = createCandidate({
			candidateId: "fuller",
			distinctMatchedPrimaryQueryUnitCount: 2,
			stableDeterministicKey: "a",
		});
		const partial = createCandidate({
			candidateId: "partial",
			stableDeterministicKey: "b",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(fuller, partial)).toBeLessThan(0);
		expect(explainCoverageLexicalV2ComparatorDecision(fuller, partial)).toMatchObject({
			layer: "distinctMatchedPrimaryQueryUnitCount",
			winnerCandidateId: "fuller",
		});
	});

	test("prefers preserved surface grouping before weaker shape matches", () => {
		const twoSided = createCandidate({
			candidateId: "two-sided",
			distinctMatchedPrimaryQueryUnitCount: 2,
			surfaceCoverageShape: {
				matchedGroupCount: 2,
				totalGroupCount: 2,
				preservesVisibleGrouping: true,
				preservesCrossScriptCoverage: true,
			},
			stableDeterministicKey: "a",
		});
		const oneSided = createCandidate({
			candidateId: "one-sided",
			distinctMatchedPrimaryQueryUnitCount: 2,
			surfaceCoverageShape: {
				matchedGroupCount: 1,
				totalGroupCount: 2,
				preservesVisibleGrouping: false,
				preservesCrossScriptCoverage: false,
			},
			stableDeterministicKey: "b",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(twoSided, oneSided)).toBeLessThan(0);
		expect(explainCoverageLexicalV2ComparatorDecision(twoSided, oneSided)).toMatchObject({
			layer: "surfaceCoverageShape",
			winnerCandidateId: "two-sided",
		});
	});

	test("AI 省�?prefers metadata identity plus body over body only and partial body", () => {
		const metadataPlusBody = createCandidate({
			candidateId: "ai-metadata-plus-body",
			distinctMatchedPrimaryQueryUnitCount: 2,
			surfaceCoverageShape: {
				matchedGroupCount: 2,
				totalGroupCount: 2,
				preservesVisibleGrouping: true,
				preservesCrossScriptCoverage: true,
			},
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 1,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 1.1,
			},
			primaryUnitMatchQuality: {
				latinExactCount: 1,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 1,
			},
			stableDeterministicKey: "a",
		});
		const bodyOnlyTwoUnit = createCandidate({
			candidateId: "body-only-two-unit",
			distinctMatchedPrimaryQueryUnitCount: 2,
			surfaceCoverageShape: {
				matchedGroupCount: 2,
				totalGroupCount: 2,
				preservesVisibleGrouping: true,
				preservesCrossScriptCoverage: true,
			},
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 0,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 2,
			},
			primaryUnitMatchQuality: {
				latinExactCount: 1,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 1,
			},
			stableDeterministicKey: "b",
		});
		const partialBody = createCandidate({
			candidateId: "partial-body",
			distinctMatchedPrimaryQueryUnitCount: 1,
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 0,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 1,
			},
			primaryUnitMatchQuality: {
				latinExactCount: 0,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 1,
			},
			stableDeterministicKey: "c",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(metadataPlusBody, bodyOnlyTwoUnit)).toBeLessThan(0);
		expect(compareCoverageLexicalV2ComparatorCandidates(bodyOnlyTwoUnit, partialBody)).toBeLessThan(0);
	});

	test("prefers stronger field placement with weak corroboration over body only", () => {
		const metadataPlusBody = createCandidate({
			candidateId: "metadata-plus-body",
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 1,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 1.1,
			},
			stableDeterministicKey: "a",
		});
		const bodyOnly = createCandidate({
			candidateId: "body-only",
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 0,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 2,
			},
			stableDeterministicKey: "b",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(metadataPlusBody, bodyOnly)).toBeLessThan(0);
		expect(explainCoverageLexicalV2ComparatorDecision(metadataPlusBody, bodyOnly)).toMatchObject({
			layer: "matchedPrimaryUnitFieldProfile",
			winnerCandidateId: "metadata-plus-body",
		});
	});

	test("政治理论 prefers fuller two-unit exact coverage over partial coverage", () => {
		const fuller = createCandidate({
			candidateId: "fuller-political-theory",
			distinctMatchedPrimaryQueryUnitCount: 2,
			surfaceCoverageShape: {
				matchedGroupCount: 2,
				totalGroupCount: 2,
				preservesVisibleGrouping: true,
				preservesCrossScriptCoverage: false,
			},
			primaryUnitMatchQuality: {
				latinExactCount: 0,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 2,
			},
			stableDeterministicKey: "a",
		});
		const partial = createCandidate({
			candidateId: "partial-political-theory",
			primaryUnitMatchQuality: {
				latinExactCount: 0,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 1,
			},
			stableDeterministicKey: "b",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(fuller, partial)).toBeLessThan(0);
		expect(explainCoverageLexicalV2ComparatorDecision(fuller, partial)).toMatchObject({
			layer: "distinctMatchedPrimaryQueryUnitCount",
			winnerCandidateId: "fuller-political-theory",
		});
	});

	test("prefers stronger latin exact quality over weaker prefix or fuzzy quality", () => {
		const exact = createCandidate({
			candidateId: "exact",
			primaryUnitMatchQuality: {
				latinExactCount: 2,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			stableDeterministicKey: "a",
		});
		const prefix = createCandidate({
			candidateId: "prefix",
			primaryUnitMatchQuality: {
				latinExactCount: 1,
				latinPrefixCount: 1,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			stableDeterministicKey: "b",
		});
		const fuzzy = createCandidate({
			candidateId: "fuzzy",
			primaryUnitMatchQuality: {
				latinExactCount: 1,
				latinPrefixCount: 0,
				latinFuzzyCount: 1,
				hanExactCount: 0,
			},
			stableDeterministicKey: "c",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(exact, prefix)).toBeLessThan(0);
		expect(compareCoverageLexicalV2ComparatorCandidates(prefix, fuzzy)).toBeLessThan(0);
	});

	test("uses proximity only for the very small top tie-band", () => {
		const leader = createCandidate({
			candidateId: "leader",
			distinctMatchedPrimaryQueryUnitCount: 2,
			primaryUnitMatchQuality: {
				latinExactCount: 2,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			primaryUnitProximityScore: {
				matchedUnitCount: 2,
				windowWidth: 8,
				averageDistance: 2,
				preservesSurfaceOrder: true,
			},
			stableDeterministicKey: "a",
		});
		const rival = createCandidate({
			candidateId: "rival",
			distinctMatchedPrimaryQueryUnitCount: 2,
			primaryUnitMatchQuality: {
				latinExactCount: 2,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			primaryUnitProximityScore: {
				matchedUnitCount: 2,
				windowWidth: 12,
				averageDistance: 3,
				preservesSurfaceOrder: false,
			},
			stableDeterministicKey: "b",
		});
		const outsider = createCandidate({
			candidateId: "outsider",
			distinctMatchedPrimaryQueryUnitCount: 1,
			stableDeterministicKey: "c",
		});

		expect(selectCoverageLexicalV2ComparatorTopTieBand([outsider, rival, leader])).toEqual([
			leader,
			rival,
		]);
		expect(compareCoverageLexicalV2ComparatorCandidates(leader, rival)).toBeLessThan(0);
		expect(explainCoverageLexicalV2ComparatorDecision(leader, rival)).toMatchObject({
			layer: "primaryUnitProximityScore",
			winnerCandidateId: "leader",
		});
	});
});

