import type { CoverageLexicalV2QueryAnalysis, CoverageLexicalV2QueryUnit } from "../query";
import type {
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
	CoverageLexicalV2ComparatorCandidate,
	CoverageLexicalV2ComparatorDecision,
	CoverageLexicalV2ComparatorEvidence,
} from "../comparator";

export type CoverageLexicalV2ExplainPrimaryUnit = Pick<
	CoverageLexicalV2QueryUnit,
	"text" | "normalizedText" | "source" | "surfaceGroupIndex" | "surfaceKind"
>;

export type CoverageLexicalV2ExplainMatchedPrimaryUnit = CoverageLexicalV2MatchedPrimaryUnitEvidence;

export type CoverageLexicalV2CandidateExplain = {
	candidateId: string;
	stableDeterministicKey: string;
	comparatorCandidate: CoverageLexicalV2ComparatorCandidate;
	matchedPrimaryUnits: CoverageLexicalV2ExplainMatchedPrimaryUnit[];
};

export type CoverageLexicalV2PairwiseExplain = {
	leftCandidateId: string;
	rightCandidateId: string;
	decision: CoverageLexicalV2ComparatorDecision;
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
	evidence: CoverageLexicalV2ComparatorEvidence;
	comparatorCandidate: CoverageLexicalV2ComparatorCandidate;
};
