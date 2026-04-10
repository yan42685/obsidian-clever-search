import { buildCoverageLexicalV2QueryAnalysis } from "../query-units";
import {
	buildCoverageLexicalV2RankingCandidate,
	compareCoverageLexicalV2RankingCandidates,
} from "../ranking";
import { mergeCoverageLexicalV2SourceCandidates } from "./coverage-lexical-source-adapter";
import type {
	CoverageLexicalV2CoarseCandidate,
	CoverageLexicalV2CoarseOptions,
	CoverageLexicalV2CoarsePlan,
	CoverageLexicalV2MergedSourceCandidate,
	CoverageLexicalV2SourceCandidate,
} from "./coverage-lexical-coarse-types";

const DEFAULT_MAX_EXPENSIVE_CANDIDATES = 2;

export function planCoverageLexicalV2Coarse(
	queryText: string,
	queryTerms: readonly string[],
	sourceCandidates: readonly CoverageLexicalV2SourceCandidate[],
	options: CoverageLexicalV2CoarseOptions = {},
): CoverageLexicalV2CoarsePlan {
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms);
	const mergedCandidates = mergeCoverageLexicalV2SourceCandidates(sourceCandidates);
	const coarseCandidates = mergedCandidates
		.map<CoverageLexicalV2CoarseCandidate>((mergedCandidate) => {
			const rankingCandidate = buildCoverageLexicalV2RankingCandidate(queryAnalysis, mergedCandidate.rankingEvidence);
			const satisfiesVisibleCoverage =
				rankingCandidate.surfaceCoverageShape.preservesVisibleGrouping &&
				rankingCandidate.surfaceCoverageShape.preservesCrossScriptCoverage;
			return {
				mergedCandidate,
				rankingCandidate,
				bucket: satisfiesVisibleCoverage ? "expensive_priority" : "downranked_incomplete",
				shouldEnterExpensiveVerification: false,
			};
		})
		.sort((left, right) =>
			compareCoverageLexicalV2RankingCandidates(left.rankingCandidate, right.rankingCandidate),
		);

	const maxExpensiveCandidates = options.maxExpensiveCandidates ?? DEFAULT_MAX_EXPENSIVE_CANDIDATES;
	let remainingExpensiveSlots = maxExpensiveCandidates;
	for (const candidate of coarseCandidates) {
		if (candidate.bucket !== "expensive_priority") {
			candidate.shouldEnterExpensiveVerification = false;
			continue;
		}
		if (remainingExpensiveSlots > 0) {
			candidate.shouldEnterExpensiveVerification = true;
			remainingExpensiveSlots -= 1;
		}
	}

	return {
		candidates: coarseCandidates,
		expensiveVerificationCandidateIds: coarseCandidates
			.filter((candidate) => candidate.shouldEnterExpensiveVerification)
			.map((candidate) => candidate.mergedCandidate.candidateId),
	};
}

export function isCoverageLexicalV2FullerCoverageCandidate(candidate: CoverageLexicalV2MergedSourceCandidate, queryText: string, queryTerms: readonly string[]): boolean {
	const queryAnalysis = buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms);
	const rankingCandidate = buildCoverageLexicalV2RankingCandidate(queryAnalysis, candidate.rankingEvidence);
	return (
		rankingCandidate.surfaceCoverageShape.preservesVisibleGrouping &&
		rankingCandidate.surfaceCoverageShape.preservesCrossScriptCoverage
	);
}
