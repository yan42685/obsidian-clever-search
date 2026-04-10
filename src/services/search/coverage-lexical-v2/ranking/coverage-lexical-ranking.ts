import type {
	CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	CoverageLexicalV2PrimaryUnitMatchQuality,
	CoverageLexicalV2PrimaryUnitProximityScore,
	CoverageLexicalV2RankingCandidate,
	CoverageLexicalV2RankingDecision,
	CoverageLexicalV2RankingLayer,
	CoverageLexicalV2SurfaceCoverageShape,
} from "./coverage-lexical-ranking-types";

export function compareCoverageLexicalV2RankingCandidates(
	left: CoverageLexicalV2RankingCandidate,
	right: CoverageLexicalV2RankingCandidate,
): number {
	const decision = explainCoverageLexicalV2RankingDecision(left, right);
	if (decision.winnerCandidateId === left.candidateId) {
		return -1;
	}
	if (decision.winnerCandidateId === right.candidateId) {
		return 1;
	}
	return 0;
}

export function explainCoverageLexicalV2RankingDecision(
	left: CoverageLexicalV2RankingCandidate,
	right: CoverageLexicalV2RankingCandidate,
): CoverageLexicalV2RankingDecision {
	const layeredComparisons: Array<{
		layer: CoverageLexicalV2RankingLayer;
		comparison: number;
		reason: string;
	}> = [
		{
			layer: "distinctMatchedPrimaryQueryUnitCount",
			comparison: compareNumbersDescending(
				left.distinctMatchedPrimaryQueryUnitCount,
				right.distinctMatchedPrimaryQueryUnitCount,
			),
			reason: "more matched primary query units wins",
		},
		{
			layer: "surfaceCoverageShape",
			comparison: compareSurfaceCoverageShapes(left.surfaceCoverageShape, right.surfaceCoverageShape),
			reason: "better visible surface-group coverage wins",
		},
		{
			layer: "matchedPrimaryUnitFieldProfile",
			comparison: compareFieldProfiles(
				left.matchedPrimaryUnitFieldProfile,
				right.matchedPrimaryUnitFieldProfile,
			),
			reason: "stronger matched-primary field placement wins",
		},
		{
			layer: "primaryUnitMatchQuality",
			comparison: compareMatchQuality(left.primaryUnitMatchQuality, right.primaryUnitMatchQuality),
			reason: "stronger primary-unit lexical match quality wins",
		},
		{
			layer: "primaryUnitProximityScore",
			comparison: compareOptionalProximity(
				left.primaryUnitProximityScore ?? null,
				right.primaryUnitProximityScore ?? null,
			),
			reason: "smaller top tie-band proximity decides remaining ties",
		},
		{
			layer: "stableDeterministicFallback",
			comparison: compareStableDeterministicKeys(left.stableDeterministicKey, right.stableDeterministicKey),
			reason: "stable deterministic fallback resolves remaining ties",
		},
	];

	for (const item of layeredComparisons) {
		if (item.comparison < 0) {
			return {
				layer: item.layer,
				winnerCandidateId: left.candidateId,
				reason: item.reason,
			};
		}
		if (item.comparison > 0) {
			return {
				layer: item.layer,
				winnerCandidateId: right.candidateId,
				reason: item.reason,
			};
		}
	}

	return {
		layer: "stableDeterministicFallback",
		winnerCandidateId: null,
		reason: "candidates remained exactly tied after stable fallback",
	};
}

export function selectCoverageLexicalV2TopTieBand(
	candidates: readonly CoverageLexicalV2RankingCandidate[],
	maxSize = 2,
): CoverageLexicalV2RankingCandidate[] {
	const sorted = [...candidates].sort(compareCoverageLexicalV2RankingCandidates);
	if (sorted.length === 0) {
		return [];
	}
	const leader = sorted[0];
	const out: CoverageLexicalV2RankingCandidate[] = [leader];
	for (let index = 1; index < sorted.length && out.length < maxSize; index += 1) {
		const candidate = sorted[index];
		if (compareWithoutProximityOrFallback(leader, candidate) !== 0) {
			break;
		}
		out.push(candidate);
	}
	return out;
}

function compareWithoutProximityOrFallback(
	left: CoverageLexicalV2RankingCandidate,
	right: CoverageLexicalV2RankingCandidate,
): number {
	return firstNonZero([
		compareNumbersDescending(left.distinctMatchedPrimaryQueryUnitCount, right.distinctMatchedPrimaryQueryUnitCount),
		compareSurfaceCoverageShapes(left.surfaceCoverageShape, right.surfaceCoverageShape),
		compareFieldProfiles(left.matchedPrimaryUnitFieldProfile, right.matchedPrimaryUnitFieldProfile),
		compareMatchQuality(left.primaryUnitMatchQuality, right.primaryUnitMatchQuality),
	]);
}

function compareSurfaceCoverageShapes(
	left: CoverageLexicalV2SurfaceCoverageShape,
	right: CoverageLexicalV2SurfaceCoverageShape,
): number {
	return firstNonZero([
		compareBooleansDescending(left.preservesVisibleGrouping, right.preservesVisibleGrouping),
		compareBooleansDescending(left.preservesCrossScriptCoverage, right.preservesCrossScriptCoverage),
		compareNumbersDescending(left.matchedGroupCount, right.matchedGroupCount),
		compareNumbersAscending(left.totalGroupCount, right.totalGroupCount),
	]);
}

function compareFieldProfiles(
	left: CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	right: CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
): number {
	return firstNonZero([
		compareNumbersDescending(left.basenameScore, right.basenameScore),
		compareNumbersDescending(left.aliasesScore, right.aliasesScore),
		compareNumbersDescending(left.headingsScore, right.headingsScore),
		compareNumbersDescending(left.folderScore, right.folderScore),
		compareNumbersDescending(left.tagScore, right.tagScore),
		compareNumbersDescending(left.bodyScore, right.bodyScore),
	]);
}

function compareMatchQuality(
	left: CoverageLexicalV2PrimaryUnitMatchQuality,
	right: CoverageLexicalV2PrimaryUnitMatchQuality,
): number {
	return firstNonZero([
		compareNumbersDescending(left.hanExactCount, right.hanExactCount),
		compareNumbersDescending(left.latinExactCount, right.latinExactCount),
		compareNumbersDescending(left.latinPrefixCount, right.latinPrefixCount),
		compareNumbersAscending(left.latinFuzzyCount, right.latinFuzzyCount),
	]);
}

function compareOptionalProximity(
	left: CoverageLexicalV2PrimaryUnitProximityScore | null,
	right: CoverageLexicalV2PrimaryUnitProximityScore | null,
): number {
	if (left == null && right == null) {
		return 0;
	}
	if (left != null && right == null) {
		return -1;
	}
	if (left == null && right != null) {
		return 1;
	}
	return compareProximity(left!, right!);
}

function compareProximity(
	left: CoverageLexicalV2PrimaryUnitProximityScore,
	right: CoverageLexicalV2PrimaryUnitProximityScore,
): number {
	return firstNonZero([
		compareNumbersDescending(left.matchedUnitCount, right.matchedUnitCount),
		compareBooleansDescending(left.preservesSurfaceOrder, right.preservesSurfaceOrder),
		compareNumbersAscending(left.windowWidth, right.windowWidth),
		compareNumbersAscending(left.averageDistance, right.averageDistance),
	]);
}

function compareStableDeterministicKeys(left: string, right: string): number {
	return left.localeCompare(right);
}

function firstNonZero(comparisons: readonly number[]): number {
	for (const comparison of comparisons) {
		if (comparison !== 0) {
			return comparison;
		}
	}
	return 0;
}

function compareNumbersDescending(left: number, right: number): number {
	return right - left;
}

function compareNumbersAscending(left: number, right: number): number {
	return left - right;
}

function compareBooleansDescending(left: boolean, right: boolean): number {
	return compareNumbersDescending(Number(left), Number(right));
}
