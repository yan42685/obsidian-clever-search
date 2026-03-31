import type {
	CoverageFamilyMatchKind,
	CoverageLexicalFamily,
	CoverageLexicalLocalWindowSignal,
	CoverageLexicalPairSignature,
	CoverageLexicalWindowFusionSignal,
} from "./coverage-lexical-types";
import {
	buildCoverageLexicalLocalWindowSignals,
	compareLocalWindowSignals,
	createEmptyCoverageLexicalLocalWindowSignal,
} from "./coverage-lexical-windowing";

const MAX_FUSED_WINDOWS = 3;
const MAX_WINDOW_OVERLAP_RATIO = 0.65;

export function buildCoverageLexicalWindowFusionSignal(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
	maxWindows: number = MAX_FUSED_WINDOWS,
): CoverageLexicalWindowFusionSignal {
	const candidates = buildCoverageLexicalLocalWindowSignals(
		tokens,
		families,
		pairSignatures,
	);
	if (candidates.length === 0) {
		return createEmptyCoverageLexicalWindowFusionSignal();
	}

	const selected: CoverageLexicalLocalWindowSignal[] = [];
	for (const candidate of candidates) {
		if (!isDistinctSupportWindow(candidate, selected)) {
			continue;
		}
		selected.push(candidate);
		if (selected.length >= Math.max(1, maxWindows)) {
			break;
		}
	}

	if (selected.length === 0) {
		return createEmptyCoverageLexicalWindowFusionSignal();
	}

	const corroboratedCoreKindCodes: number[] = [];
	const corroboratedAnchorFlags: number[] = [];
	const corroboratedSoftFlags: number[] = [];
	let corroboratedCoreCoverageCount = 0;
	let corroboratedExactCoreWeight = 0;
	let corroboratedPrefixCoreWeight = 0;
	let corroboratedFuzzyCoreWeight = 0;
	let corroboratedAnchorCoverageCount = 0;
	let corroboratedSoftCoverageCount = 0;
	for (const window of selected) {
		({
			corroboratedCoreCoverageCount,
			corroboratedExactCoreWeight,
			corroboratedPrefixCoreWeight,
			corroboratedFuzzyCoreWeight,
		} = markCoreFamilies(
			window.matchedExactCoreFamilyIndices,
			corroboratedCoreKindCodes,
			3,
			corroboratedCoreCoverageCount,
			corroboratedExactCoreWeight,
			corroboratedPrefixCoreWeight,
			corroboratedFuzzyCoreWeight,
		));
		({
			corroboratedCoreCoverageCount,
			corroboratedExactCoreWeight,
			corroboratedPrefixCoreWeight,
			corroboratedFuzzyCoreWeight,
		} = markCoreFamilies(
			window.matchedPrefixCoreFamilyIndices,
			corroboratedCoreKindCodes,
			2,
			corroboratedCoreCoverageCount,
			corroboratedExactCoreWeight,
			corroboratedPrefixCoreWeight,
			corroboratedFuzzyCoreWeight,
		));
		({
			corroboratedCoreCoverageCount,
			corroboratedExactCoreWeight,
			corroboratedPrefixCoreWeight,
			corroboratedFuzzyCoreWeight,
		} = markCoreFamilies(
			window.matchedFuzzyCoreFamilyIndices,
			corroboratedCoreKindCodes,
			1,
			corroboratedCoreCoverageCount,
			corroboratedExactCoreWeight,
			corroboratedPrefixCoreWeight,
			corroboratedFuzzyCoreWeight,
		));
		corroboratedAnchorCoverageCount = markMatchedFamilies(
			window.matchedAnchorFamilyIndices,
			corroboratedAnchorFlags,
			corroboratedAnchorCoverageCount,
		);
		corroboratedSoftCoverageCount = markMatchedFamilies(
			window.matchedSoftFamilyIndices,
			corroboratedSoftFlags,
			corroboratedSoftCoverageCount,
		);
	}
	return {
		primary: selected[0],
		support: selected[1] ?? createEmptyCoverageLexicalLocalWindowSignal(),
		supportWindowCount: Math.max(0, selected.length - 1),
		corroboratedCoreCoverageCount,
		corroboratedExactCoreWeight,
		corroboratedPrefixCoreWeight,
		corroboratedFuzzyCoreWeight,
		corroboratedAnchorCoverageCount,
		corroboratedSoftCoverageCount,
	};
}

export function compareCoverageLexicalWindowFusionSignals(
	left: CoverageLexicalWindowFusionSignal,
	right: CoverageLexicalWindowFusionSignal,
): number {
	return (
		compareLocalWindowSignals(left.primary, right.primary) ||
		compareDescendingMetric(
			left.corroboratedCoreCoverageCount,
			right.corroboratedCoreCoverageCount,
		) ||
		compareDescendingMetric(
			left.corroboratedExactCoreWeight,
			right.corroboratedExactCoreWeight,
		) ||
		compareDescendingMetric(
			left.corroboratedPrefixCoreWeight,
			right.corroboratedPrefixCoreWeight,
		) ||
		compareDescendingMetric(
			left.corroboratedFuzzyCoreWeight,
			right.corroboratedFuzzyCoreWeight,
		) ||
		compareDescendingMetric(
			left.corroboratedAnchorCoverageCount,
			right.corroboratedAnchorCoverageCount,
		) ||
		compareDescendingMetric(
			left.corroboratedSoftCoverageCount,
			right.corroboratedSoftCoverageCount,
		) ||
		compareLocalWindowSignals(left.support, right.support) ||
		compareDescendingMetric(left.supportWindowCount, right.supportWindowCount)
	);
}

export function createEmptyCoverageLexicalWindowFusionSignal(): CoverageLexicalWindowFusionSignal {
	return {
		primary: createEmptyCoverageLexicalLocalWindowSignal(),
		support: createEmptyCoverageLexicalLocalWindowSignal(),
		supportWindowCount: 0,
		corroboratedCoreCoverageCount: 0,
		corroboratedExactCoreWeight: 0,
		corroboratedPrefixCoreWeight: 0,
		corroboratedFuzzyCoreWeight: 0,
		corroboratedAnchorCoverageCount: 0,
		corroboratedSoftCoverageCount: 0,
	};
}

function isDistinctSupportWindow(
	candidate: CoverageLexicalLocalWindowSignal,
	selected: readonly CoverageLexicalLocalWindowSignal[],
): boolean {
	if (selected.length === 0) {
		return true;
	}
	return selected.every((window) => computeOverlapRatio(candidate, window) < MAX_WINDOW_OVERLAP_RATIO);
}

function computeOverlapRatio(
	left: CoverageLexicalLocalWindowSignal,
	right: CoverageLexicalLocalWindowSignal,
): number {
	if (left.start < 0 || right.start < 0) {
		return 0;
	}
	const overlapStart = Math.max(left.start, right.start);
	const overlapEnd = Math.min(left.end, right.end);
	if (overlapEnd < overlapStart) {
		return 0;
	}
	const overlapLength = overlapEnd - overlapStart + 1;
	const leftLength = Math.max(1, left.end - left.start + 1);
	const rightLength = Math.max(1, right.end - right.start + 1);
	return overlapLength / Math.min(leftLength, rightLength);
}

function markMatchedFamilies(
	familyIndices: readonly number[],
	target: number[],
	count: number,
): number {
	for (const familyIndex of familyIndices) {
		if (target[familyIndex] === 1) {
			continue;
		}
		target[familyIndex] = 1;
		count += 1;
	}
	return count;
}

function markCoreFamilies(
	familyIndices: readonly number[],
	target: number[],
	kindCode: number,
	corroboratedCoreCoverageCount: number,
	corroboratedExactCoreWeight: number,
	corroboratedPrefixCoreWeight: number,
	corroboratedFuzzyCoreWeight: number,
): {
	corroboratedCoreCoverageCount: number;
	corroboratedExactCoreWeight: number;
	corroboratedPrefixCoreWeight: number;
	corroboratedFuzzyCoreWeight: number;
} {
	for (const familyIndex of familyIndices) {
		const previousCode = target[familyIndex] ?? 0;
		if (previousCode >= kindCode) {
			continue;
		}
		const weight = computeFamilyTailWeight(familyIndex);
		if (previousCode === 0) {
			corroboratedCoreCoverageCount += 1;
		} else if (previousCode === 3) {
			corroboratedExactCoreWeight -= weight;
		} else if (previousCode === 2) {
			corroboratedPrefixCoreWeight -= weight;
		} else {
			corroboratedFuzzyCoreWeight -= weight;
		}
		target[familyIndex] = kindCode;
		if (kindCode === 3) {
			corroboratedExactCoreWeight += weight;
		} else if (kindCode === 2) {
			corroboratedPrefixCoreWeight += weight;
		} else {
			corroboratedFuzzyCoreWeight += weight;
		}
	}
	return {
		corroboratedCoreCoverageCount,
		corroboratedExactCoreWeight,
		corroboratedPrefixCoreWeight,
		corroboratedFuzzyCoreWeight,
	};
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}
