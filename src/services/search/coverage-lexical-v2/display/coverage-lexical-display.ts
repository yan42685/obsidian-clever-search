import type { CoverageLexicalV2ComparatorRunCandidate } from "../comparator";
import type {
	CoverageLexicalV2DisplayOptions,
	CoverageLexicalV2DisplayResult,
} from "./coverage-lexical-display-types";

export function applyCoverageLexicalV2DisplayPolicy(
	rankedCandidates: readonly CoverageLexicalV2ComparatorRunCandidate[],
	options: CoverageLexicalV2DisplayOptions = {},
): CoverageLexicalV2DisplayResult {
	const displayCandidates = isCoverageLexicalV2DisplayPruneEnabled()
		? pruneCoverageLexicalV2DisplayFront(rankedCandidates)
		: rankedCandidates;
	const keepCount = resolveKeepCount(
		displayCandidates.length,
		options.maxDisplayCandidates,
	);
	return {
		visibleCandidates: displayCandidates.slice(0, keepCount),
		droppedCandidateIds: displayCandidates
			.slice(keepCount)
			.map((candidate) => candidate.evidence.candidateId),
		tailTrimmed: keepCount < displayCandidates.length,
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

function isCoverageLexicalV2DisplayPruneEnabled(): boolean {
	const raw = process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_ENABLED?.trim();
	if (!raw) {
		return false;
	}
	return raw !== "0" && raw.toLowerCase() !== "false";
}

function pruneCoverageLexicalV2DisplayFront(
	rankedCandidates: readonly CoverageLexicalV2ComparatorRunCandidate[],
): CoverageLexicalV2ComparatorRunCandidate[] {
	if (rankedCandidates.length <= 1) {
		return [...rankedCandidates];
	}
	const leader = rankedCandidates[0].comparatorCandidate;
	const pruned: CoverageLexicalV2ComparatorRunCandidate[] = [rankedCandidates[0]];
	for (let index = 1; index < rankedCandidates.length; index += 1) {
		const candidate = rankedCandidates[index];
		const comparatorCandidate = candidate.comparatorCandidate;
		if (
			leader.surfaceCoverageShape.preservesCrossScriptCoverage &&
			!comparatorCandidate.surfaceCoverageShape.preservesCrossScriptCoverage
		) {
			continue;
		}
		if (
			leader.surfaceCoverageShape.matchedGroupCount > comparatorCandidate.surfaceCoverageShape.matchedGroupCount
		) {
			continue;
		}
		if (
			leader.distinctMatchedPrimaryQueryUnitCount >= 2 &&
			comparatorCandidate.distinctMatchedPrimaryQueryUnitCount + 1 <
				leader.distinctMatchedPrimaryQueryUnitCount
		) {
			continue;
		}
		pruned.push(candidate);
	}
	return pruned;
}
