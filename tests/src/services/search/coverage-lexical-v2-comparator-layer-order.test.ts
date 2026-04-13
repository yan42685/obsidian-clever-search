import {
	compareCoverageLexicalV2ComparatorCandidates,
	explainCoverageLexicalV2ComparatorDecision,
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
			preservesCrossScriptCoverage: true,
		},
		cheapExactPrimaryContiguity: {
			intactExactSurfaceGroupCount: 0,
			intactExactPrimaryUnitCount: 0,
			maxAdjacentExactMatchedPrimaryRunLength: 0,
			adjacentExactMatchedPrimaryUnitCount: 0,
		},
		cheapSharedFieldCoverage: {
			coversAllMatchedPrimaryUnitsInOneField: false,
			maxDistinctPrimaryUnitsInSameField: 0,
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

describe("coverage lexical v2 comparator layer order", () => {
	test("prefers cheap exact primary contiguity before field profile", () => {
		const contiguous = createCandidate({
			candidateId: "contiguous",
			distinctMatchedPrimaryQueryUnitCount: 2,
			cheapExactPrimaryContiguity: {
				intactExactSurfaceGroupCount: 1,
				intactExactPrimaryUnitCount: 1,
				maxAdjacentExactMatchedPrimaryRunLength: 0,
				adjacentExactMatchedPrimaryUnitCount: 0,
			},
			stableDeterministicKey: "a",
		});
		const split = createCandidate({
			candidateId: "split",
			distinctMatchedPrimaryQueryUnitCount: 2,
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 1,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 1,
			},
			stableDeterministicKey: "b",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(contiguous, split)).toBeLessThan(0);
		expect(explainCoverageLexicalV2ComparatorDecision(contiguous, split)).toMatchObject({
			layer: "cheapExactPrimaryContiguity",
			winnerCandidateId: "contiguous",
		});
	});

	test("prefers cheap shared field coverage before field profile", () => {
		const groupedInBody = createCandidate({
			candidateId: "grouped-in-body",
			distinctMatchedPrimaryQueryUnitCount: 2,
			cheapSharedFieldCoverage: {
				coversAllMatchedPrimaryUnitsInOneField: true,
				maxDistinctPrimaryUnitsInSameField: 2,
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
				latinExactCount: 0,
				latinPrefixCount: 2,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			stableDeterministicKey: "a",
		});
		const splitAcrossHeadingAndBody = createCandidate({
			candidateId: "split-across-heading-and-body",
			distinctMatchedPrimaryQueryUnitCount: 2,
			cheapSharedFieldCoverage: {
				coversAllMatchedPrimaryUnitsInOneField: false,
				maxDistinctPrimaryUnitsInSameField: 1,
			},
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 0,
				aliasesScore: 0,
				headingsScore: 1,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 1,
			},
			primaryUnitMatchQuality: {
				latinExactCount: 0,
				latinPrefixCount: 2,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			stableDeterministicKey: "b",
		});

		expect(compareCoverageLexicalV2ComparatorCandidates(groupedInBody, splitAcrossHeadingAndBody)).toBeLessThan(0);
		expect(
			explainCoverageLexicalV2ComparatorDecision(
				groupedInBody,
				splitAcrossHeadingAndBody,
			),
		).toMatchObject({
			layer: "cheapSharedFieldCoverage",
			winnerCandidateId: "grouped-in-body",
		});
	});
});
