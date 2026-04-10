import { buildCoverageLexicalV2ExplainPayload, type CoverageLexicalV2ExplainPayload } from "../explain";
import { buildCoverageLexicalV2QueryAnalysis } from "../query-units";
import { selectCoverageLexicalV2TopTieBand } from "../ranking";
import { planCoverageLexicalV2Coarse } from "./coverage-lexical-coarse";
import type {
	CoverageLexicalV2CoarseCandidate,
	CoverageLexicalV2CoarseOptions,
	CoverageLexicalV2CoarsePlan,
	CoverageLexicalV2SourceCandidate,
} from "./coverage-lexical-coarse-types";

export type CoverageLexicalV2CoarseRunResult = {
	queryText: string;
	queryTerms: readonly string[];
	coarsePlan: CoverageLexicalV2CoarsePlan;
	rankedCandidates: CoverageLexicalV2CoarseCandidate[];
	topTieBandCandidateIds: string[];
	explain: CoverageLexicalV2ExplainPayload;
};

export function runCoverageLexicalV2CoarseRanking(
	queryText: string,
	queryTerms: readonly string[],
	sourceCandidates: readonly CoverageLexicalV2SourceCandidate[],
	options: CoverageLexicalV2CoarseOptions = {},
): CoverageLexicalV2CoarseRunResult {
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms);
	const coarsePlan = planCoverageLexicalV2Coarse(queryText, queryTerms, sourceCandidates, options);
	const rankedCandidates = coarsePlan.candidates;
	const topTieBand = selectCoverageLexicalV2TopTieBand(
		rankedCandidates.map((candidate) => candidate.rankingCandidate),
	);
	const explain = buildCoverageLexicalV2ExplainPayload(
		queryAnalysis,
		rankedCandidates.map((candidate) => ({
			evidence: candidate.mergedCandidate.rankingEvidence,
			rankingCandidate: candidate.rankingCandidate,
		})),
		rankedCandidates.length >= 2
			? {
				left: rankedCandidates[0].rankingCandidate,
				right: rankedCandidates[1].rankingCandidate,
			}
			: null,
	);
	return {
		queryText,
		queryTerms,
		coarsePlan,
		rankedCandidates,
		topTieBandCandidateIds: topTieBand.map((candidate) => candidate.candidateId),
		explain,
	};
}
