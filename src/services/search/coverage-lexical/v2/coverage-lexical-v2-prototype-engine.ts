import {
	runCoverageLexicalV2CoarseRanking,
	type CoverageLexicalV2CoarseOptions,
	type CoverageLexicalV2CoarseRunResult,
	type CoverageLexicalV2SourceCandidate,
} from "./coarse";
import {
	runCoverageLexicalV2Ranking,
	type CoverageLexicalV2RankingRunResult,
} from "./ranking";

export type CoverageLexicalV2PrototypeSearchResult = {
	queryText: string;
	queryTerms: readonly string[];
	coarse: CoverageLexicalV2CoarseRunResult;
	finalRanking: CoverageLexicalV2RankingRunResult;
};

export function runCoverageLexicalV2PrototypeSearch(
	queryText: string,
	queryTerms: readonly string[],
	sourceCandidates: readonly CoverageLexicalV2SourceCandidate[],
	options: CoverageLexicalV2CoarseOptions = {},
): CoverageLexicalV2PrototypeSearchResult {
	const coarse = runCoverageLexicalV2CoarseRanking(queryText, queryTerms, sourceCandidates, options);
	const finalRanking = runCoverageLexicalV2Ranking(
		queryText,
		queryTerms,
		coarse.rankedCandidates.map((candidate) => candidate.mergedCandidate.rankingEvidence),
	);
	return {
		queryText,
		queryTerms,
		coarse,
		finalRanking,
	};
}
