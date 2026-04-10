import { buildCoverageLexicalV2ExplainPayload, type CoverageLexicalV2ExplainPayload } from "../explain";
import { buildCoverageLexicalV2QueryAnalysis } from "../query-units";
import { compareCoverageLexicalV2RankingCandidates, selectCoverageLexicalV2TopTieBand } from "./coverage-lexical-ranking";
import { buildCoverageLexicalV2RankingCandidate } from "./coverage-lexical-ranking-signal-builder";
import type {
	CoverageLexicalV2RankingCandidate,
	CoverageLexicalV2RankingEvidence,
} from "./coverage-lexical-ranking-types";

export type CoverageLexicalV2RankingRunCandidate = {
	evidence: CoverageLexicalV2RankingEvidence;
	rankingCandidate: CoverageLexicalV2RankingCandidate;
};

export type CoverageLexicalV2RankingRunResult = {
	queryText: string;
	queryTerms: readonly string[];
	rankedCandidates: CoverageLexicalV2RankingRunCandidate[];
	topTieBandCandidateIds: string[];
	explain: CoverageLexicalV2ExplainPayload;
};

export function runCoverageLexicalV2Ranking(
	queryText: string,
	queryTerms: readonly string[],
	evidenceCandidates: readonly CoverageLexicalV2RankingEvidence[],
): CoverageLexicalV2RankingRunResult {
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms);
	const rankedCandidates = evidenceCandidates
		.map<CoverageLexicalV2RankingRunCandidate>((evidence) => ({
			evidence,
			rankingCandidate: buildCoverageLexicalV2RankingCandidate(queryAnalysis, evidence),
		}))
		.sort((left, right) =>
			compareCoverageLexicalV2RankingCandidates(left.rankingCandidate, right.rankingCandidate),
		);
	const topTieBand = selectCoverageLexicalV2TopTieBand(
		rankedCandidates.map((candidate) => candidate.rankingCandidate),
	);
	const explain = buildCoverageLexicalV2ExplainPayload(
		queryAnalysis,
		rankedCandidates,
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
		rankedCandidates,
		topTieBandCandidateIds: topTieBand.map((candidate) => candidate.candidateId),
		explain,
	};
}
