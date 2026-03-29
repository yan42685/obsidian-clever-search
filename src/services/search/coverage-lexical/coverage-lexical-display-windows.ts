import { buildCoverageLexicalDisplayWindowSignals } from "./coverage-lexical-windowing";
import type {
	CoverageLexicalDisplayWindow,
	CoverageLexicalFamily,
	CoverageLexicalPairSignature,
} from "./coverage-lexical-types";

const NEAR_DUPLICATE_OVERLAP_RATIO = 0.72;

export function selectCoverageLexicalDisplayWindows(
	bodyTokenSequence: readonly string[],
	families: readonly CoverageLexicalFamily[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
	maxSubItemCount: number,
): CoverageLexicalDisplayWindow[] {
	const rawSignals = buildCoverageLexicalDisplayWindowSignals(
		bodyTokenSequence,
		families,
		pairSignatures,
	);
	const remaining = rawSignals.map((signal, index) => toDisplayWindow(signal, index));
	const selected: CoverageLexicalDisplayWindow[] = [];
	while (remaining.length > 0 && selected.length < maxSubItemCount) {
		let bestIndex = -1;
		let bestScore = -Infinity;
		for (let index = 0; index < remaining.length; index++) {
			const candidate = remaining[index];
			const adjusted = computeSelectionPriority(candidate, selected);
			if (
				adjusted > bestScore ||
				(adjusted === bestScore &&
					candidate.signal.score >
						(remaining[bestIndex]?.signal.score ?? -Infinity))
			) {
				bestScore = adjusted;
				bestIndex = index;
			}
		}
		if (bestIndex < 0 || bestScore === -Infinity) {
			break;
		}
		const [best] = remaining.splice(bestIndex, 1);
		if (selected.some((existing) => isNearDuplicateWindow(best, existing))) {
			continue;
		}
		selected.push(best);
	}
	return selected;
}

function toDisplayWindow(
	signal: CoverageLexicalDisplayWindow["signal"],
	rank: number,
): CoverageLexicalDisplayWindow {
	return {
		startTokenIndex: signal.start,
		endTokenIndex: signal.end,
		signal,
		matchedFamilyIndices: uniqueSortedNumbers([
			...signal.matchedExactCoreFamilyIndices,
			...signal.matchedPrefixCoreFamilyIndices,
			...signal.matchedFuzzyCoreFamilyIndices,
			...signal.matchedAnchorFamilyIndices,
			...signal.matchedSoftFamilyIndices,
		]),
		kind: rank === 0 ? "primary" : rank === 1 ? "support" : "supplemental",
		rank,
	};
}

function isNearDuplicateWindow(
	left: CoverageLexicalDisplayWindow,
	right: CoverageLexicalDisplayWindow,
): boolean {
	const overlap = computeWindowOverlapRatio(left, right);
	if (overlap < NEAR_DUPLICATE_OVERLAP_RATIO) {
		return false;
	}
	const leftSpan = Math.max(1, left.endTokenIndex - left.startTokenIndex + 1);
	const rightSpan = Math.max(1, right.endTokenIndex - right.startTokenIndex + 1);
	return (
		Math.abs(leftSpan - rightSpan) <= 3 &&
		intersectCount(left.matchedFamilyIndices, right.matchedFamilyIndices) >=
			Math.min(left.matchedFamilyIndices.length, right.matchedFamilyIndices.length)
	);
}

function computeSelectionPriority(
	candidate: CoverageLexicalDisplayWindow,
	selected: readonly CoverageLexicalDisplayWindow[],
): number {
	let score = candidate.signal.score;
	for (const existing of selected) {
		const overlap = computeWindowOverlapRatio(candidate, existing);
		if (overlap >= NEAR_DUPLICATE_OVERLAP_RATIO) {
			return -Infinity;
		}
		if (isBroadShadowedWindow(candidate, existing)) {
			return -Infinity;
		}
		const familyOverlap = computeFamilyOverlapRatio(
			candidate.matchedFamilyIndices,
			existing.matchedFamilyIndices,
		);
		const tokenGap = computeTokenGap(candidate, existing);
		if (familyOverlap >= 1 && tokenGap <= 48) {
			score -= 18;
			continue;
		}
		if (familyOverlap >= 0.75 && tokenGap <= 24) {
			score -= 10;
			continue;
		}
		if (familyOverlap >= 0.5 && tokenGap <= 12) {
			score -= 4;
		}
	}
	return score;
}

function isBroadShadowedWindow(
	candidate: CoverageLexicalDisplayWindow,
	existing: CoverageLexicalDisplayWindow,
): boolean {
	const overlap = computeWindowOverlapRatio(candidate, existing);
	if (overlap < 0.6) {
		return false;
	}
	const candidateSpan = Math.max(1, candidate.endTokenIndex - candidate.startTokenIndex + 1);
	const existingSpan = Math.max(1, existing.endTokenIndex - existing.startTokenIndex + 1);
	if (candidateSpan < existingSpan * 2) {
		return false;
	}
	const candidateCoverage =
		candidate.signal.coreCoverageCount +
		candidate.signal.anchorCoverageCount +
		candidate.signal.softCoverageCount;
	const existingCoverage =
		existing.signal.coreCoverageCount +
		existing.signal.anchorCoverageCount +
		existing.signal.softCoverageCount;
	if (candidateCoverage > existingCoverage) {
		return false;
	}
	return candidate.signal.score <= existing.signal.score * 1.08;
}

function computeWindowOverlapRatio(
	left: CoverageLexicalDisplayWindow,
	right: CoverageLexicalDisplayWindow,
): number {
	const overlapStart = Math.max(left.startTokenIndex, right.startTokenIndex);
	const overlapEnd = Math.min(left.endTokenIndex, right.endTokenIndex);
	if (overlapEnd < overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart + 1;
	const base = Math.max(
		1,
		Math.min(
			left.endTokenIndex - left.startTokenIndex + 1,
			right.endTokenIndex - right.startTokenIndex + 1,
		),
	);
	return overlap / base;
}

function computeTokenGap(
	left: CoverageLexicalDisplayWindow,
	right: CoverageLexicalDisplayWindow,
): number {
	if (left.endTokenIndex < right.startTokenIndex) {
		return right.startTokenIndex - left.endTokenIndex;
	}
	if (right.endTokenIndex < left.startTokenIndex) {
		return left.startTokenIndex - right.endTokenIndex;
	}
	return 0;
}

function intersectCount(left: readonly number[], right: readonly number[]): number {
	const rightSet = new Set(right);
	let count = 0;
	for (const value of left) {
		if (rightSet.has(value)) {
			count += 1;
		}
	}
	return count;
}

function computeFamilyOverlapRatio(
	left: readonly number[],
	right: readonly number[],
): number {
	if (left.length === 0 || right.length === 0) {
		return 0;
	}
	return intersectCount(left, right) / Math.max(1, Math.min(left.length, right.length));
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
	return Array.from(new Set(values)).sort((left, right) => left - right);
}
