import {
	runCoverageLexicalV2CoarseRanking,
	type CoverageLexicalV2CoarseOptions,
	type CoverageLexicalV2CoarseRunResult,
	type CoverageLexicalV2SourceCandidate,
} from "./coarse";
import {
	applyCoverageLexicalV2DisplayPolicy,
	type CoverageLexicalV2DisplayOptions,
	type CoverageLexicalV2DisplayResult,
} from "./display";
import {
	runCoverageLexicalV2Ranking,
	type CoverageLexicalV2RankingRunResult,
} from "./ranking";

export type CoverageLexicalV2PrototypeSearchResult = {
	queryText: string;
	queryTerms: readonly string[];
	coarse: CoverageLexicalV2CoarseRunResult;
	finalRanking: CoverageLexicalV2RankingRunResult;
	display: CoverageLexicalV2DisplayResult;
};

export type CoverageLexicalV2PrototypeSearchOptions = CoverageLexicalV2CoarseOptions &
	CoverageLexicalV2DisplayOptions;

export function runCoverageLexicalV2PrototypeSearch(
	queryText: string,
	queryTerms: readonly string[],
	sourceCandidates: readonly CoverageLexicalV2SourceCandidate[],
	options: CoverageLexicalV2PrototypeSearchOptions = {},
): CoverageLexicalV2PrototypeSearchResult {
	const coarse = runCoverageLexicalV2CoarseRanking(queryText, queryTerms, sourceCandidates, options);
	const finalRanking = runCoverageLexicalV2Ranking(
		queryText,
		queryTerms,
		coarse.rankedCandidates.map((candidate) => candidate.mergedCandidate.rankingEvidence),
	);
	const display = applyCoverageLexicalV2DisplayPolicy(finalRanking.rankedCandidates, options);
	return {
		queryText,
		queryTerms,
		coarse,
		finalRanking,
		display,
	};
}
