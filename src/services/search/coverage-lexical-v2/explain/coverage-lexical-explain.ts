import type { CoverageLexicalV2QueryAnalysis } from "../query-units";
import {
	explainCoverageLexicalV2RankingDecision,
	type CoverageLexicalV2RankingCandidate,
} from "../ranking";
import type {
	CoverageLexicalV2ExplainCandidateInput,
	CoverageLexicalV2ExplainPayload,
} from "./coverage-lexical-explain-types";

export function buildCoverageLexicalV2ExplainPayload(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidates: readonly CoverageLexicalV2ExplainCandidateInput[],
	pairwiseCandidates?: {
		left: CoverageLexicalV2RankingCandidate;
		right: CoverageLexicalV2RankingCandidate;
	} | null,
): CoverageLexicalV2ExplainPayload {
	return {
		normalizedQueryText: queryAnalysis.normalizedQueryText,
		surfaceGroups: [...queryAnalysis.surfaceGroups],
		surfaceShape: queryAnalysis.surfaceShape,
		primaryUnits: [...queryAnalysis.primaryUnits],
		fallbackUnits: [...queryAnalysis.fallbackUnits],
		derivedUnits: [...queryAnalysis.derivedUnits],
		candidates: candidates.map((candidate) => ({
			candidateId: candidate.evidence.candidateId,
			stableDeterministicKey: candidate.evidence.stableDeterministicKey,
			rankingCandidate: candidate.rankingCandidate,
			matchedPrimaryUnits: [...candidate.evidence.matchedPrimaryUnits],
		})),
		pairwiseDecision: pairwiseCandidates
			? {
				leftCandidateId: pairwiseCandidates.left.candidateId,
				rightCandidateId: pairwiseCandidates.right.candidateId,
				decision: explainCoverageLexicalV2RankingDecision(pairwiseCandidates.left, pairwiseCandidates.right),
			}
			: null,
	};
}
