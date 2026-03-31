import { innerSetting } from "src/globals/plugin-setting";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalFamily,
	CoverageLexicalLocalWindowSignal,
	CoverageLexicalPairSignature,
} from "./coverage-lexical-types";

const MIN_WINDOW_SIZE = 8;
const MAX_WINDOW_SIZE = 48;
const MAX_LOCAL_WINDOW_CANDIDATES = 16;
const MAX_ADJACENT_PAIR_GAP = 3;
const MAX_COVER_HIT_SPAN = 8;
const MINIMAL_WINDOW_PADDING = 4;
const EXPANDED_WINDOW_PADDING = 10;

type FamilyTokenMatch = {
	familyIndex: number;
	kind: Exclude<CoverageFamilyMatchKind, null>;
};

export function buildCoverageLexicalLocalWindowSignals(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
): CoverageLexicalLocalWindowSignal[] {
	return buildCoverageLexicalWindowSignalsInternal(
		tokens,
		families,
		pairSignatures,
		MAX_LOCAL_WINDOW_CANDIDATES,
		MAX_COVER_HIT_SPAN,
	);
}

function buildCoverageLexicalWindowSignalsInternal(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
	maxCandidates: number,
	maxCoverHitSpan: number,
): CoverageLexicalLocalWindowSignal[] {
	if (tokens.length === 0 || families.length === 0) {
		return [];
	}

	const candidateFamilies = families.filter((family) => family.role !== "noise");
	if (candidateFamilies.length === 0) {
		return [];
	}

	const matchesByPosition: FamilyTokenMatch[][] = Array.from(
		{ length: tokens.length },
		() => [],
	);
	const hitPositions: number[] = [];
	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
		const token = tokens[tokenIndex];
		for (const family of candidateFamilies) {
			const kind = matchTokenToFamily(token, family);
			if (!kind) {
				continue;
			}
			matchesByPosition[tokenIndex].push({
				familyIndex: family.index,
				kind,
			});
		}
		if (matchesByPosition[tokenIndex].length > 0) {
			hitPositions.push(tokenIndex);
		}
	}

	if (hitPositions.length === 0) {
		return [];
	}

	const candidateSignals: CoverageLexicalLocalWindowSignal[] = [];
	const seenWindows = new Set<string>();
	for (let startHitIndex = 0; startHitIndex < hitPositions.length; startHitIndex++) {
		const coveredFamilyFlags: number[] = [];
		let coveredFamilyCount = 0;
		for (
			let endHitIndex = startHitIndex;
			endHitIndex < hitPositions.length &&
			endHitIndex < startHitIndex + maxCoverHitSpan;
			endHitIndex++
		) {
			const coverEnd = hitPositions[endHitIndex];
			for (const match of matchesByPosition[coverEnd]) {
				if (coveredFamilyFlags[match.familyIndex] === 1) {
					continue;
				}
				coveredFamilyFlags[match.familyIndex] = 1;
				coveredFamilyCount += 1;
			}
			const coverStart = hitPositions[startHitIndex];
			pushWindowCandidate(
				candidateSignals,
				seenWindows,
				expandCoverWindow(
					coverStart,
					coverEnd,
					tokens.length,
					MINIMAL_WINDOW_PADDING,
				),
				tokens,
				matchesByPosition,
				families,
				pairSignatures,
				maxCandidates,
			);
			if (coveredFamilyCount >= 2) {
				pushWindowCandidate(
					candidateSignals,
					seenWindows,
					expandCoverWindow(
						coverStart,
						coverEnd,
						tokens.length,
						EXPANDED_WINDOW_PADDING,
					),
					tokens,
					matchesByPosition,
					families,
					pairSignatures,
					maxCandidates,
				);
			}
		}
	}

	if (candidateSignals.length === 0) {
		for (const center of hitPositions) {
			pushWindowCandidate(
				candidateSignals,
				seenWindows,
				expandCoverWindow(center, center, tokens.length, EXPANDED_WINDOW_PADDING),
				tokens,
				matchesByPosition,
				families,
				pairSignatures,
				maxCandidates,
			);
		}
	}

	return candidateSignals;
}

function scoreWindow(
	start: number,
	end: number,
	tokens: readonly string[],
	matchesByPosition: ReadonlyArray<ReadonlyArray<FamilyTokenMatch>>,
	families: readonly CoverageLexicalFamily[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
): CoverageLexicalLocalWindowSignal {
	const bestKindCodeByFamily: number[] = [];
	const firstPositionByFamily: number[] = [];
	const tokenSet = new Set<string>();

	for (let tokenIndex = start; tokenIndex <= end; tokenIndex++) {
		tokenSet.add(tokens[tokenIndex]);
		for (const match of matchesByPosition[tokenIndex]) {
			const previousCode = bestKindCodeByFamily[match.familyIndex] ?? 0;
			const nextCode = encodeMatchKind(match.kind);
			if (previousCode >= nextCode) {
				continue;
			}
			bestKindCodeByFamily[match.familyIndex] = nextCode;
			if (firstPositionByFamily[match.familyIndex] === undefined) {
				firstPositionByFamily[match.familyIndex] = tokenIndex;
			}
		}
	}

	let coreCoverageCount = 0;
	let exactCoreWeight = 0;
	let prefixCoreWeight = 0;
	let fuzzyCoreWeight = 0;
	let anchorCoverageCount = 0;
	let softCoverageCount = 0;
	let adjacentCorePairCount = 0;
	let adjacentCorePairWeight = 0;
	const matchedCorePositions: Array<{ index: number; position: number }> = [];
	const matchedExactCoreFamilyIndices: number[] = [];
	const matchedPrefixCoreFamilyIndices: number[] = [];
	const matchedFuzzyCoreFamilyIndices: number[] = [];
	const matchedAnchorFamilyIndices: number[] = [];
	const matchedSoftFamilyIndices: number[] = [];

	for (const family of families) {
		const kind = decodeMatchKind(bestKindCodeByFamily[family.index] ?? 0);
		if (!kind) {
			continue;
		}

		const weight = computeFamilyTailWeight(family.index);
		if (family.role === "body" && family.strength === "core") {
			coreCoverageCount += 1;
			if (kind === "exact") {
				exactCoreWeight += weight;
				matchedExactCoreFamilyIndices.push(family.index);
			} else if (kind === "prefix") {
				prefixCoreWeight += weight;
				matchedPrefixCoreFamilyIndices.push(family.index);
			} else {
				fuzzyCoreWeight += weight;
				matchedFuzzyCoreFamilyIndices.push(family.index);
			}
			matchedCorePositions.push({
				index: family.index,
				position: firstPositionByFamily[family.index] ?? start,
			});
			continue;
		}
		if (family.role === "anchor") {
			anchorCoverageCount += 1;
			matchedAnchorFamilyIndices.push(family.index);
			continue;
		}
		if (family.role === "body") {
			softCoverageCount += 1;
			matchedSoftFamilyIndices.push(family.index);
		}
	}

	for (const pairSignature of pairSignatures) {
		if (matchesPairSignature(pairSignature, firstPositionByFamily, tokenSet)) {
			adjacentCorePairCount += 1;
			adjacentCorePairWeight += pairSignature.tailWeight;
		}
	}

	matchedCorePositions.sort((left, right) => left.index - right.index);
	let orderedPairCount = 0;
	for (let index = 1; index < matchedCorePositions.length; index++) {
		if (matchedCorePositions[index - 1].position <= matchedCorePositions[index].position) {
			orderedPairCount += 1;
		}
	}

	const spanLength = Math.max(1, end - start + 1);
	const matchedWindowMass =
		coreCoverageCount + anchorCoverageCount + softCoverageCount * 0.6;
	const orderRatio =
		matchedCorePositions.length <= 1
			? matchedCorePositions.length === 0
				? 0
				: 1
			: orderedPairCount / (matchedCorePositions.length - 1);
	const compactnessRatio = matchedWindowMass / spanLength;

	return {
		start,
		end,
		coreCoverageCount,
		exactCoreWeight,
		prefixCoreWeight,
		fuzzyCoreWeight,
		anchorCoverageCount,
		softCoverageCount,
		adjacentCorePairCount,
		adjacentCorePairWeight,
		orderedPairCount,
		orderRatio,
		compactnessRatio,
		matchedExactCoreFamilyIndices,
		matchedPrefixCoreFamilyIndices,
		matchedFuzzyCoreFamilyIndices,
		matchedAnchorFamilyIndices,
		matchedSoftFamilyIndices,
		score:
			coreCoverageCount * 100 +
			exactCoreWeight * 4 +
			prefixCoreWeight * 2 +
			adjacentCorePairCount * 25 +
			adjacentCorePairWeight * 0.5 +
			anchorCoverageCount * 15 +
			softCoverageCount * 5 +
			orderRatio * 20 +
			compactnessRatio * 10,
	};
}

export function compareLocalWindowSignals(
	left: CoverageLexicalLocalWindowSignal,
	right: CoverageLexicalLocalWindowSignal,
): number {
	return (
		compareDescendingMetric(left.coreCoverageCount, right.coreCoverageCount) ||
		compareDescendingMetric(left.exactCoreWeight, right.exactCoreWeight) ||
		compareDescendingMetric(left.prefixCoreWeight, right.prefixCoreWeight) ||
		compareDescendingMetric(left.fuzzyCoreWeight, right.fuzzyCoreWeight) ||
		compareDescendingMetric(left.adjacentCorePairCount, right.adjacentCorePairCount) ||
		compareDescendingMetric(left.adjacentCorePairWeight, right.adjacentCorePairWeight) ||
		compareDescendingMetric(left.anchorCoverageCount, right.anchorCoverageCount) ||
		compareDescendingMetric(left.softCoverageCount, right.softCoverageCount) ||
		compareDescendingMetric(left.orderedPairCount, right.orderedPairCount) ||
		compareDescendingMetric(left.orderRatio, right.orderRatio) ||
		compareDescendingMetric(left.compactnessRatio, right.compactnessRatio) ||
		compareDescendingMetric(left.score, right.score)
	);
}

export function createEmptyCoverageLexicalLocalWindowSignal(): CoverageLexicalLocalWindowSignal {
	return {
		start: -1,
		end: -1,
		coreCoverageCount: 0,
		exactCoreWeight: 0,
		prefixCoreWeight: 0,
		fuzzyCoreWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		adjacentCorePairCount: 0,
		adjacentCorePairWeight: 0,
		orderedPairCount: 0,
		orderRatio: 0,
		compactnessRatio: 0,
		score: 0,
		matchedExactCoreFamilyIndices: [],
		matchedPrefixCoreFamilyIndices: [],
		matchedFuzzyCoreFamilyIndices: [],
		matchedAnchorFamilyIndices: [],
		matchedSoftFamilyIndices: [],
	};
}

function insertCandidateSignal(
	candidates: CoverageLexicalLocalWindowSignal[],
	signal: CoverageLexicalLocalWindowSignal,
	maxCandidates: number,
): void {
	let insertAt = 0;
	while (
		insertAt < candidates.length &&
		compareLocalWindowSignals(candidates[insertAt], signal) <= 0
	) {
		insertAt += 1;
	}
	if (insertAt >= maxCandidates) {
		return;
	}
	candidates.splice(insertAt, 0, signal);
	if (candidates.length > maxCandidates) {
		candidates.pop();
	}
}

function pushWindowCandidate(
	candidates: CoverageLexicalLocalWindowSignal[],
	seenWindows: Set<string>,
	window: { start: number; end: number },
	tokens: readonly string[],
	matchesByPosition: ReadonlyArray<ReadonlyArray<FamilyTokenMatch>>,
	families: readonly CoverageLexicalFamily[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
	maxCandidates: number,
): void {
	const key = `${window.start}:${window.end}`;
	if (seenWindows.has(key)) {
		return;
	}
	seenWindows.add(key);
	insertCandidateSignal(
		candidates,
		scoreWindow(
			window.start,
			window.end,
			tokens,
			matchesByPosition,
			families,
			pairSignatures,
		),
		maxCandidates,
	);
}

function expandCoverWindow(
	coverStart: number,
	coverEnd: number,
	tokenCount: number,
	padding: number,
): { start: number; end: number } {
	let start = Math.max(0, coverStart - padding);
	let end = Math.min(tokenCount - 1, coverEnd + padding);
	if (end - start + 1 < MIN_WINDOW_SIZE) {
		const deficit = MIN_WINDOW_SIZE - (end - start + 1);
		const extendLeft = Math.floor(deficit / 2);
		const extendRight = deficit - extendLeft;
		start = Math.max(0, start - extendLeft);
		end = Math.min(tokenCount - 1, end + extendRight);
	}
	if (end - start + 1 <= MAX_WINDOW_SIZE) {
		return { start, end };
	}
	start = Math.max(0, Math.min(start, coverStart));
	end = Math.min(tokenCount - 1, Math.max(end, coverEnd));
	while (end - start + 1 > MAX_WINDOW_SIZE) {
		if (start < coverStart) {
			start += 1;
			continue;
		}
		if (end > coverEnd) {
			end -= 1;
			continue;
		}
		break;
	}
	return { start, end };
}

function matchesPairSignature(
	pairSignature: CoverageLexicalPairSignature,
	firstPositionByFamily: readonly number[],
	tokenSet: ReadonlySet<string>,
): boolean {
	for (const variant of pairSignature.variants) {
		if (tokenSet.has(variant)) {
			return true;
		}
	}
	const leftPosition = firstPositionByFamily[pairSignature.leftFamilyIndex];
	const rightPosition = firstPositionByFamily[pairSignature.rightFamilyIndex];
	if (leftPosition === undefined || rightPosition === undefined) {
		return false;
	}
	return (
		leftPosition <= rightPosition &&
		rightPosition - leftPosition <= MAX_ADJACENT_PAIR_GAP
	);
}

function matchTokenToFamily(
	token: string,
	family: CoverageLexicalFamily,
): Exclude<CoverageFamilyMatchKind, null> | null {
	if (token === family.normalizedTerm) {
		return "exact";
	}
	if (family.allowPrefix && token.startsWith(family.normalizedTerm)) {
		return "prefix";
	}
	if (family.allowFuzzy) {
		const maxDistance = computeMaxFuzzyDistance(family.normalizedTerm);
		if (
			maxDistance > 0 &&
			token[0] === family.normalizedTerm[0] &&
			boundedLevenshtein(token, family.normalizedTerm, maxDistance) <= maxDistance
		) {
			return "fuzzy";
		}
	}
	return null;
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

function encodeMatchKind(kind: Exclude<CoverageFamilyMatchKind, null>): number {
	if (kind === "exact") {
		return 3;
	}
	if (kind === "prefix") {
		return 2;
	}
	return 1;
}

function decodeMatchKind(
	code: number,
): Exclude<CoverageFamilyMatchKind, null> | null {
	if (code === 3) {
		return "exact";
	}
	if (code === 2) {
		return "prefix";
	}
	if (code === 1) {
		return "fuzzy";
	}
	return null;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function computeMaxFuzzyDistance(queryTerm: string): number {
	if (queryTerm.length <= 4) {
		return 0;
	}
	return Math.min(
		2,
		Math.max(1, Math.round(queryTerm.length * innerSetting.search.fuzzyProportion)),
	);
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		prev[index] = index;
	}

	for (let row = 1; row <= a.length; row++) {
		curr[0] = row;
		let rowMin = curr[0];
		for (let column = 1; column <= b.length; column++) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			curr[column] = Math.min(
				prev[column] + 1,
				curr[column - 1] + 1,
				prev[column - 1] + cost,
			);
			rowMin = Math.min(rowMin, curr[column]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= b.length; index++) {
			prev[index] = curr[index];
		}
	}

	return prev[b.length];
}
