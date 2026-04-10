import { buildCoverageLexicalV2ExplainPayload, type CoverageLexicalV2ExplainPayload } from "../explain";
import { buildCoverageLexicalV2QueryAnalysis } from "../query";
import { compareCoverageLexicalV2ComparatorCandidates, selectCoverageLexicalV2ComparatorTopTieBand } from "./coverage-lexical-comparator";
import {
	buildCoverageLexicalV2CheapComparatorCandidate,
	patchCoverageLexicalV2ComparatorCandidateWithProximity,
} from "./coverage-lexical-comparator-signals";
import type {
	CoverageLexicalV2ComparatorCandidate,
	CoverageLexicalV2ComparatorEvidence,
} from "./coverage-lexical-comparator-types";

export type CoverageLexicalV2ComparatorRunCandidate = {
	evidence: CoverageLexicalV2ComparatorEvidence;
	comparatorCandidate: CoverageLexicalV2ComparatorCandidate;
};

export type CoverageLexicalV2ComparatorRunResult = {
	queryText: string;
	queryTerms: readonly string[];
	rankedCandidates: CoverageLexicalV2ComparatorRunCandidate[];
	topTieBandCandidateIds: string[];
	explain: CoverageLexicalV2ExplainPayload;
};

export function runCoverageLexicalV2Comparator(
	queryText: string,
	queryTerms: readonly string[],
	evidenceCandidates: readonly CoverageLexicalV2ComparatorEvidence[],
): CoverageLexicalV2ComparatorRunResult {
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms);
	const rankedCandidates = evidenceCandidates
		.map<CoverageLexicalV2ComparatorRunCandidate>((evidence) => ({
			evidence,
			comparatorCandidate: patchCoverageLexicalV2ComparatorCandidateWithProximity(
				buildCoverageLexicalV2CheapComparatorCandidate(queryAnalysis, evidence),
				evidence,
			),
		}))
		.sort((left, right) =>
			compareCoverageLexicalV2ComparatorCandidates(left.comparatorCandidate, right.comparatorCandidate),
		);
	const topTieBand = selectCoverageLexicalV2ComparatorTopTieBand(
		rankedCandidates.map((candidate) => candidate.comparatorCandidate),
	);
	const explain = buildCoverageLexicalV2ExplainPayload(
		queryAnalysis,
		rankedCandidates,
		rankedCandidates.length >= 2
			? {
				left: rankedCandidates[0].comparatorCandidate,
				right: rankedCandidates[1].comparatorCandidate,
			}
			: null,
	);
	return {
		queryText,
		queryTerms,
		rankedCandidates,
		topTieBandCandidateIds: topTieBand.map((candidate) => candidate.candidateId),
		explain,
	};
}
