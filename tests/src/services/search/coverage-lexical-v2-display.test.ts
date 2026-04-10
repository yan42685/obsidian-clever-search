import {
	applyCoverageLexicalV2DisplayPolicy,
} from "src/services/search/coverage-lexical-v2/display";
import type {
	CoverageLexicalV2ComparatorRunCandidate,
} from "src/services/search/coverage-lexical-v2/comparator";

function createCandidate(candidateId: string): CoverageLexicalV2ComparatorRunCandidate {
	return {
		evidence: {
			candidateId,
			stableDeterministicKey: candidateId,
			matchedPrimaryUnits: [],
			bestWindow: null,
		},
		comparatorCandidate: {
			candidateId,
			distinctMatchedPrimaryQueryUnitCount: 0,
			surfaceCoverageShape: {
				matchedGroupCount: 0,
				totalGroupCount: 0,
				preservesVisibleGrouping: true,
				preservesCrossScriptCoverage: true,
			},
			matchedPrimaryUnitFieldProfile: {
				basenameScore: 0,
				aliasesScore: 0,
				headingsScore: 0,
				folderScore: 0,
				tagScore: 0,
				bodyScore: 0,
			},
			primaryUnitMatchQuality: {
				latinExactCount: 0,
				latinPrefixCount: 0,
				latinFuzzyCount: 0,
				hanExactCount: 0,
			},
			primaryUnitProximityScore: null,
			stableDeterministicKey: candidateId,
		},
	};
}

describe("coverage lexical v2 display", () => {
	test("tail trims without reranking upstream order", () => {
		const result = applyCoverageLexicalV2DisplayPolicy([
			createCandidate("a"),
			createCandidate("b"),
			createCandidate("c"),
			createCandidate("d"),
		], {
			maxDisplayCandidates: 2,
		});

		expect(result.visibleCandidates.map((candidate) => candidate.evidence.candidateId)).toEqual([
			"a",
			"b",
		]);
		expect(result.droppedCandidateIds).toEqual(["c", "d"]);
		expect(result.tailTrimmed).toBe(true);
	});
});
