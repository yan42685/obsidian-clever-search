import type { CoverageLexicalV2QueryAnalysis, CoverageLexicalV2QueryUnit } from "../query-units";
import type {
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
	CoverageLexicalV2RankingCandidate,
	CoverageLexicalV2RankingDecision,
	CoverageLexicalV2RankingEvidence,
} from "../ranking";

export type CoverageLexicalV2ExplainPrimaryUnit = Pick<
	CoverageLexicalV2QueryUnit,
	"text" | "normalizedText" | "source" | "surfaceGroupIndex" | "surfaceKind"
>;

export type CoverageLexicalV2ExplainMatchedPrimaryUnit = CoverageLexicalV2MatchedPrimaryUnitEvidence;

export type CoverageLexicalV2CandidateExplain = {
	candidateId: string;
	stableDeterministicKey: string;
	rankingCandidate: CoverageLexicalV2RankingCandidate;
	matchedPrimaryUnits: CoverageLexicalV2ExplainMatchedPrimaryUnit[];
};

export type CoverageLexicalV2PairwiseExplain = {
	leftCandidateId: string;
	rightCandidateId: string;
	decision: CoverageLexicalV2RankingDecision;
};

export type CoverageLexicalV2ExplainPayload = {
	normalizedQueryText: string;
	surfaceGroups: CoverageLexicalV2QueryAnalysis["surfaceGroups"];
	surfaceShape: CoverageLexicalV2QueryAnalysis["surfaceShape"];
	primaryUnits: CoverageLexicalV2ExplainPrimaryUnit[];
	fallbackUnits: CoverageLexicalV2ExplainPrimaryUnit[];
	derivedUnits: CoverageLexicalV2ExplainPrimaryUnit[];
	candidates: CoverageLexicalV2CandidateExplain[];
	pairwiseDecision?: CoverageLexicalV2PairwiseExplain | null;
};

export type CoverageLexicalV2ExplainCandidateInput = {
	evidence: CoverageLexicalV2RankingEvidence;
	rankingCandidate: CoverageLexicalV2RankingCandidate;
};
