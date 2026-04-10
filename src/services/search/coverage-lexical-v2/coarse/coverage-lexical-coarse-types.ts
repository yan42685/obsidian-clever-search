import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
	CoverageLexicalV2RankingCandidate,
	CoverageLexicalV2RankingEvidence,
} from "../ranking";

export type CoverageLexicalV2SourceKind = "metadata" | "body" | "fallback" | "derived";

export type CoverageLexicalV2SourceCandidate = {
	candidateId: string;
	stableDeterministicKey: string;
	sourceKind: CoverageLexicalV2SourceKind;
	matchedPrimaryUnits?: CoverageLexicalV2MatchedPrimaryUnitEvidence[];
	bestWindow?: CoverageLexicalV2BestWindowEvidence | null;
};

export type CoverageLexicalV2MergedSourceCandidate = {
	candidateId: string;
	stableDeterministicKey: string;
	sourceKinds: CoverageLexicalV2SourceKind[];
	rankingEvidence: CoverageLexicalV2RankingEvidence;
};

export type CoverageLexicalV2CoarseBucket =
	| "expensive_priority"
	| "downranked_incomplete";

export type CoverageLexicalV2CoarseCandidate = {
	mergedCandidate: CoverageLexicalV2MergedSourceCandidate;
	rankingCandidate: CoverageLexicalV2RankingCandidate;
	bucket: CoverageLexicalV2CoarseBucket;
	shouldEnterExpensiveVerification: boolean;
};

export type CoverageLexicalV2CoarsePlan = {
	candidates: CoverageLexicalV2CoarseCandidate[];
	expensiveVerificationCandidateIds: string[];
};

export type CoverageLexicalV2CoarseOptions = {
	maxExpensiveCandidates?: number;
};
