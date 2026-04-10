import type { CoverageLexicalV2QueryAnalysis } from "../query";
import {
	explainCoverageLexicalV2ComparatorDecision,
	type CoverageLexicalV2ComparatorCandidate,
} from "../comparator";
import type {
	CoverageLexicalV2ExplainCandidateInput,
	CoverageLexicalV2ExplainPayload,
} from "./coverage-lexical-explain-types";

export function buildCoverageLexicalV2ExplainPayload(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidates: readonly CoverageLexicalV2ExplainCandidateInput[],
	pairwiseCandidates?: {
		left: CoverageLexicalV2ComparatorCandidate;
		right: CoverageLexicalV2ComparatorCandidate;
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
			comparatorCandidate: candidate.comparatorCandidate,
			matchedPrimaryUnits: [...candidate.evidence.matchedPrimaryUnits],
		})),
		pairwiseDecision: pairwiseCandidates
			? {
				leftCandidateId: pairwiseCandidates.left.candidateId,
				rightCandidateId: pairwiseCandidates.right.candidateId,
				decision: explainCoverageLexicalV2ComparatorDecision(pairwiseCandidates.left, pairwiseCandidates.right),
			}
			: null,
	};
}
