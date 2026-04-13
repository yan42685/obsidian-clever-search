import type {
	CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	CoverageLexicalV2PrefixWitnessLite,
	CoverageLexicalV2PrimaryUnitMatchQuality,
	CoverageLexicalV2PrimaryUnitProximityScore,
	CoverageLexicalV2ComparatorCandidate,
	CoverageLexicalV2ComparatorDecision,
	CoverageLexicalV2ComparatorLayer,
	CoverageLexicalV2SurfaceCoverageShape,
} from "./coverage-lexical-comparator-types";

export function compareCoverageLexicalV2ComparatorCandidates(
	left: CoverageLexicalV2ComparatorCandidate,
	right: CoverageLexicalV2ComparatorCandidate,
): number {
	const decision = explainCoverageLexicalV2ComparatorDecision(left, right);
	if (decision.winnerCandidateId === left.candidateId) {
		return -1;
	}
	if (decision.winnerCandidateId === right.candidateId) {
		return 1;
	}
	return 0;
}

export function explainCoverageLexicalV2ComparatorDecision(
	left: CoverageLexicalV2ComparatorCandidate,
	right: CoverageLexicalV2ComparatorCandidate,
): CoverageLexicalV2ComparatorDecision {
	const layeredComparisons: Array<{
		layer: CoverageLexicalV2ComparatorLayer;
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
			comparison: compareCoverageLexicalV2SurfaceCoverageShapes(
				left.surfaceCoverageShape,
				right.surfaceCoverageShape,
			),
			reason: "better visible surface-group coverage wins",
		},
		{
			layer: "matchedPrimaryUnitFieldProfile",
			comparison: compareCoverageLexicalV2FieldProfiles(
				left.matchedPrimaryUnitFieldProfile,
				right.matchedPrimaryUnitFieldProfile,
			),
			reason: "stronger matched-primary field placement wins",
		},
		{
			layer: "primaryUnitMatchQuality",
			comparison: compareCoverageLexicalV2PrimaryUnitMatchQuality(
				left.primaryUnitMatchQuality,
				right.primaryUnitMatchQuality,
			),
			reason: "stronger primary-unit lexical match quality wins",
		},
		{
			layer: "primaryUnitProximityScore",
			comparison: compareCoverageLexicalV2OptionalPrimaryUnitProximity(
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

export function selectCoverageLexicalV2ComparatorTopTieBand(
	candidates: readonly CoverageLexicalV2ComparatorCandidate[],
	maxSize = 2,
): CoverageLexicalV2ComparatorCandidate[] {
	const sorted = [...candidates].sort(compareCoverageLexicalV2ComparatorCandidates);
	if (sorted.length === 0) {
		return [];
	}
	const leader = sorted[0];
	const out: CoverageLexicalV2ComparatorCandidate[] = [leader];
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
	left: CoverageLexicalV2ComparatorCandidate,
	right: CoverageLexicalV2ComparatorCandidate,
): number {
	return firstNonZero([
		compareNumbersDescending(left.distinctMatchedPrimaryQueryUnitCount, right.distinctMatchedPrimaryQueryUnitCount),
		compareCoverageLexicalV2SurfaceCoverageShapes(
			left.surfaceCoverageShape,
			right.surfaceCoverageShape,
		),
		compareCoverageLexicalV2FieldProfiles(
			left.matchedPrimaryUnitFieldProfile,
			right.matchedPrimaryUnitFieldProfile,
		),
		compareCoverageLexicalV2PrimaryUnitMatchQuality(
			left.primaryUnitMatchQuality,
			right.primaryUnitMatchQuality,
		),
	]);
}

export function compareCoverageLexicalV2SurfaceCoverageShapes(
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

export function compareCoverageLexicalV2FieldProfiles(
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

export function compareCoverageLexicalV2PrimaryUnitMatchQuality(
	left: CoverageLexicalV2PrimaryUnitMatchQuality,
	right: CoverageLexicalV2PrimaryUnitMatchQuality,
): number {
	const countComparison = firstNonZero([
		compareNumbersDescending(left.hanExactCount, right.hanExactCount),
		compareNumbersDescending(left.latinExactCount, right.latinExactCount),
		compareNumbersDescending(left.latinPrefixCount, right.latinPrefixCount),
		compareNumbersAscending(left.latinFuzzyCount, right.latinFuzzyCount),
	]);
	if (countComparison !== 0) {
		return countComparison;
	}
	return comparePrefixWitnessLists(
		left.metadataPrefixWitnesses ?? [],
		right.metadataPrefixWitnesses ?? [],
	);
}

export function compareCoverageLexicalV2OptionalPrimaryUnitProximity(
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
	return compareCoverageLexicalV2PrimaryUnitProximity(left!, right!);
}

export function compareCoverageLexicalV2PrimaryUnitProximity(
	left: CoverageLexicalV2PrimaryUnitProximityScore,
	right: CoverageLexicalV2PrimaryUnitProximityScore,
): number {
	return firstNonZero([
		compareNumbersDescending(left.matchedUnitCount, right.matchedUnitCount),
		compareBooleansDescending(left.preservesSurfaceOrder, right.preservesSurfaceOrder),
		compareNumbersDescending(
			left.contiguousSurfaceGroupCount ?? 0,
			right.contiguousSurfaceGroupCount ?? 0,
		),
		compareNumbersAscending(left.windowWidth, right.windowWidth),
		compareNumbersAscending(left.averageDistance, right.averageDistance),
	]);
}

function comparePrefixWitnessLists(
	left: readonly CoverageLexicalV2PrefixWitnessLite[],
	right: readonly CoverageLexicalV2PrefixWitnessLite[],
): number {
	if (left.length === 0 && right.length === 0) {
		return 0;
	}
	if (left.length > 0 && right.length === 0) {
		return -1;
	}
	if (left.length === 0 && right.length > 0) {
		return 1;
	}
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		const comparison = comparePrefixWitness(left[index], right[index]);
		if (comparison !== 0) {
			return comparison;
		}
	}
	return compareNumbersDescending(left.length, right.length);
}

function comparePrefixWitness(
	left: CoverageLexicalV2PrefixWitnessLite,
	right: CoverageLexicalV2PrefixWitnessLite,
): number {
	return firstNonZero([
		compareNumbersAscending(getPrefixWitnessFieldPriority(left.field), getPrefixWitnessFieldPriority(right.field)),
		compareBooleansDescending(left.cleanBoundary, right.cleanBoundary),
		compareBooleansAscending(left.compoundPenalty, right.compoundPenalty),
		compareNumbersAscending(left.surfaceCompletionGain, right.surfaceCompletionGain),
		compareNumbersAscending(left.fieldDocCount, right.fieldDocCount),
		left.surfaceText.localeCompare(right.surfaceText),
	]);
}

function getPrefixWitnessFieldPriority(field: CoverageLexicalV2PrefixWitnessLite["field"]): number {
	switch (field) {
		case "basename":
			return 0;
		case "aliases":
			return 1;
		case "headings":
			return 2;
		case "folder":
			return 3;
		case "tag":
			return 4;
		case "body":
		default:
			return 5;
	}
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

function compareBooleansAscending(left: boolean, right: boolean): number {
	return compareNumbersAscending(Number(left), Number(right));
}
