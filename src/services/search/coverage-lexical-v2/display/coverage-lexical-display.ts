import type { CoverageLexicalV2ComparatorRunCandidate } from "../comparator";
import type {
	CoverageLexicalV2DisplayOptions,
	CoverageLexicalV2DisplayResult,
} from "./coverage-lexical-display-types";

export function applyCoverageLexicalV2DisplayPolicy(
	rankedCandidates: readonly CoverageLexicalV2ComparatorRunCandidate[],
	options: CoverageLexicalV2DisplayOptions = {},
): CoverageLexicalV2DisplayResult {
	const keepCount = resolveKeepCount(
		rankedCandidates.length,
		options.maxDisplayCandidates,
	);
	return {
		visibleCandidates: rankedCandidates.slice(0, keepCount),
		droppedCandidateIds: rankedCandidates
			.slice(keepCount)
			.map((candidate) => candidate.evidence.candidateId),
		tailTrimmed: keepCount < rankedCandidates.length,
	};
}

function resolveKeepCount(
	totalCandidates: number,
	explicitMaxDisplayCandidates?: number,
): number {
	if (totalCandidates <= 0) {
		return 0;
	}
	if (explicitMaxDisplayCandidates == null) {
		return totalCandidates;
	}
	return Math.min(totalCandidates, Math.max(0, explicitMaxDisplayCandidates));
}
