import type { CoverageLexicalV2ComparatorRunCandidate } from "../comparator";

export type CoverageLexicalV2DisplayOptions = {
	maxDisplayCandidates?: number;
};

export type CoverageLexicalV2DisplayResult = {
	visibleCandidates: CoverageLexicalV2ComparatorRunCandidate[];
	droppedCandidateIds: string[];
	tailTrimmed: boolean;
};
