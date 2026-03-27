import { innerSetting } from "src/globals/plugin-setting";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalFamily,
	CoverageLexicalLocalWindowSignal,
} from "./coverage-lexical-types";

const MIN_WINDOW_SIZE = 8;
const MAX_WINDOW_SIZE = 28;

type FamilyTokenMatch = {
	familyIndex: number;
	kind: Exclude<CoverageFamilyMatchKind, null>;
};

export function buildCoverageLexicalLocalWindowSignal(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalLocalWindowSignal {
	if (tokens.length === 0 || families.length === 0) {
		return createEmptyLocalWindowSignal();
	}

	const candidateFamilies = families.filter((family) => family.role !== "noise");
	if (candidateFamilies.length === 0) {
		return createEmptyLocalWindowSignal();
	}

	const matchesByPosition: FamilyTokenMatch[][] = Array.from(
		{ length: tokens.length },
		() => [],
	);
	const candidateCenters: number[] = [];
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
			candidateCenters.push(tokenIndex);
		}
	}

	if (candidateCenters.length === 0) {
		return createEmptyLocalWindowSignal();
	}

	const baseWindowSize = Math.min(
		MAX_WINDOW_SIZE,
		Math.max(MIN_WINDOW_SIZE, candidateFamilies.length * 5),
	);
	const candidateWindowSizes = Array.from(
		new Set([
			baseWindowSize,
			Math.max(MIN_WINDOW_SIZE, Math.floor(baseWindowSize * 0.65)),
		]),
	);

	let bestSignal = createEmptyLocalWindowSignal();
	const seenWindows = new Set<string>();
	for (const center of candidateCenters) {
		for (const windowSize of candidateWindowSizes) {
			const start = Math.max(0, Math.min(center - Math.floor(windowSize / 2), tokens.length - windowSize));
			const end = Math.min(tokens.length - 1, start + windowSize - 1);
			const key = `${start}:${end}`;
			if (seenWindows.has(key)) {
				continue;
			}
			seenWindows.add(key);
			const signal = scoreWindow(start, end, matchesByPosition, families);
			if (compareLocalWindowSignals(signal, bestSignal) < 0) {
				bestSignal = signal;
			}
		}
	}

	return bestSignal;
}

function scoreWindow(
	start: number,
	end: number,
	matchesByPosition: ReadonlyArray<ReadonlyArray<FamilyTokenMatch>>,
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalLocalWindowSignal {
	const bestKindByFamily = new Map<number, Exclude<CoverageFamilyMatchKind, null>>();
	const firstPositionByFamily = new Map<number, number>();

	for (let tokenIndex = start; tokenIndex <= end; tokenIndex++) {
		for (const match of matchesByPosition[tokenIndex]) {
			const previous = bestKindByFamily.get(match.familyIndex) ?? null;
			if (pickBetterMatchKind(previous, match.kind) !== match.kind) {
				continue;
			}
			bestKindByFamily.set(match.familyIndex, match.kind);
			if (!firstPositionByFamily.has(match.familyIndex)) {
				firstPositionByFamily.set(match.familyIndex, tokenIndex);
			}
		}
	}

	let coreCoverageCount = 0;
	let exactCoreWeight = 0;
	let prefixCoreWeight = 0;
	let fuzzyCoreWeight = 0;
	let anchorCoverageCount = 0;
	let softCoverageCount = 0;
	const matchedCorePositions: Array<{ index: number; position: number }> = [];

	for (const family of families) {
		const kind = bestKindByFamily.get(family.index) ?? null;
		if (!kind) {
			continue;
		}

		const weight = computeFamilyTailWeight(family.index);
		if (family.role === "body" && family.strength === "core") {
			coreCoverageCount += 1;
			if (kind === "exact") {
				exactCoreWeight += weight;
			} else if (kind === "prefix") {
				prefixCoreWeight += weight;
			} else {
				fuzzyCoreWeight += weight;
			}
			matchedCorePositions.push({
				index: family.index,
				position: firstPositionByFamily.get(family.index) ?? start,
			});
			continue;
		}
		if (family.role === "anchor") {
			anchorCoverageCount += 1;
			continue;
		}
		if (family.role === "body") {
			softCoverageCount += 1;
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
		orderedPairCount,
		orderRatio,
		compactnessRatio,
		score:
			coreCoverageCount * 100 +
			exactCoreWeight * 4 +
			prefixCoreWeight * 2 +
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
		compareDescendingMetric(left.anchorCoverageCount, right.anchorCoverageCount) ||
		compareDescendingMetric(left.softCoverageCount, right.softCoverageCount) ||
		compareDescendingMetric(left.orderedPairCount, right.orderedPairCount) ||
		compareDescendingMetric(left.orderRatio, right.orderRatio) ||
		compareDescendingMetric(left.compactnessRatio, right.compactnessRatio) ||
		compareDescendingMetric(left.score, right.score)
	);
}

function createEmptyLocalWindowSignal(): CoverageLexicalLocalWindowSignal {
	return {
		start: -1,
		end: -1,
		coreCoverageCount: 0,
		exactCoreWeight: 0,
		prefixCoreWeight: 0,
		fuzzyCoreWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		orderedPairCount: 0,
		orderRatio: 0,
		compactnessRatio: 0,
		score: 0,
	};
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
