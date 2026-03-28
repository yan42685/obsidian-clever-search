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

	const corroboratedCoreKinds = new Map<number, Exclude<CoverageFamilyMatchKind, null>>();
	const corroboratedAnchorFamilies = new Set<number>();
	const corroboratedSoftFamilies = new Set<number>();
	for (const window of selected) {
		markCoreFamilies(window.matchedExactCoreFamilyIndices, corroboratedCoreKinds, "exact");
		markCoreFamilies(window.matchedPrefixCoreFamilyIndices, corroboratedCoreKinds, "prefix");
		markCoreFamilies(window.matchedFuzzyCoreFamilyIndices, corroboratedCoreKinds, "fuzzy");
		markMatchedFamilies(window.matchedAnchorFamilyIndices, corroboratedAnchorFamilies);
		markMatchedFamilies(window.matchedSoftFamilyIndices, corroboratedSoftFamilies);
	}

	const corroboratedWeights = summarizeCorroboratedCoreKinds(corroboratedCoreKinds);
	return {
		primary: selected[0],
		support: selected[1] ?? createEmptyCoverageLexicalLocalWindowSignal(),
		supportWindowCount: Math.max(0, selected.length - 1),
		corroboratedCoreCoverageCount: corroboratedCoreKinds.size,
		corroboratedExactCoreWeight: corroboratedWeights.exactWeight,
		corroboratedPrefixCoreWeight: corroboratedWeights.prefixWeight,
		corroboratedFuzzyCoreWeight: corroboratedWeights.fuzzyWeight,
		corroboratedAnchorCoverageCount: corroboratedAnchorFamilies.size,
		corroboratedSoftCoverageCount: corroboratedSoftFamilies.size,
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
	target: Set<number>,
): void {
	for (const familyIndex of familyIndices) {
		target.add(familyIndex);
	}
}

function markCoreFamilies(
	familyIndices: readonly number[],
	target: Map<number, Exclude<CoverageFamilyMatchKind, null>>,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	for (const familyIndex of familyIndices) {
		const previous = target.get(familyIndex) ?? null;
		if (pickBetterMatchKind(previous, kind) === previous) {
			continue;
		}
		target.set(familyIndex, kind);
	}
}

function summarizeCorroboratedCoreKinds(
	corroboratedCoreKinds: ReadonlyMap<number, Exclude<CoverageFamilyMatchKind, null>>,
): {
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
} {
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	for (const [familyIndex, kind] of corroboratedCoreKinds.entries()) {
		const weight = computeFamilyTailWeight(familyIndex);
		if (kind === "exact") {
			exactWeight += weight;
			continue;
		}
		if (kind === "prefix") {
			prefixWeight += weight;
			continue;
		}
		fuzzyWeight += weight;
	}
	return {
		exactWeight,
		prefixWeight,
		fuzzyWeight,
	};
}

function pickBetterMatchKind(
	left: CoverageFamilyMatchKind,
	right: CoverageFamilyMatchKind,
): CoverageFamilyMatchKind {
	const rank = {
		exact: 3,
		prefix: 2,
		fuzzy: 1,
		null: 0,
	} as const;
	return rank[left ?? "null"] >= rank[right ?? "null"] ? left : right;
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}
