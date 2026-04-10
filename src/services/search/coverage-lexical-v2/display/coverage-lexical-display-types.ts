import type { CoverageLexicalV2RankingRunCandidate } from "../ranking";

export type CoverageLexicalV2DisplayOptions = {
	maxDisplayCandidates?: number;
};

export type CoverageLexicalV2DisplayResult = {
	visibleCandidates: CoverageLexicalV2RankingRunCandidate[];
	droppedCandidateIds: string[];
	tailTrimmed: boolean;
};
