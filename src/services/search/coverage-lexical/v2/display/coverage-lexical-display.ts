import type { CoverageLexicalV2RankingRunCandidate } from "../ranking";
import type {
	CoverageLexicalV2DisplayOptions,
	CoverageLexicalV2DisplayResult,
} from "./coverage-lexical-display-types";

const DEFAULT_MIN_DISPLAY_CANDIDATES = 3;

export function applyCoverageLexicalV2DisplayPolicy(
	rankedCandidates: readonly CoverageLexicalV2RankingRunCandidate[],
	options: CoverageLexicalV2DisplayOptions = {},
): CoverageLexicalV2DisplayResult {
	const minDisplayCandidates = Math.max(0, options.minDisplayCandidates ?? DEFAULT_MIN_DISPLAY_CANDIDATES);
	const explicitMaxDisplayCandidates = options.maxDisplayCandidates;
	const keepCount = resolveKeepCount(rankedCandidates.length, minDisplayCandidates, explicitMaxDisplayCandidates);
	return {
		visibleCandidates: rankedCandidates.slice(0, keepCount),
		droppedCandidateIds: rankedCandidates.slice(keepCount).map((candidate) => candidate.evidence.candidateId),
		tailTrimmed: keepCount < rankedCandidates.length,
	};
}

function resolveKeepCount(
	totalCandidates: number,
	minDisplayCandidates: number,
	explicitMaxDisplayCandidates?: number,
): number {
	if (totalCandidates <= 0) {
		return 0;
	}
	if (explicitMaxDisplayCandidates == null) {
		return totalCandidates;
	}
	const boundedMax = Math.max(0, explicitMaxDisplayCandidates);
	const protectedMin = Math.min(totalCandidates, minDisplayCandidates);
	return Math.min(totalCandidates, Math.max(boundedMax, protectedMin));
}
