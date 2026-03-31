import type {
	CoverageFamilyMatchKind,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalPassageAdmissionSignal,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";

const MIN_ADMISSION_WINDOW = 6;
const MAX_ADMISSION_WINDOW = 18;

export function buildCoverageLexicalPassageAdmissionSignal(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	state: CoverageLexicalCandidateState,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
): CoverageLexicalPassageAdmissionSignal {
	const phraseMatchCount = state.phraseMatches.length;
	const phraseMatchWeight = state.phraseMatches.reduce(
		(total, index) => total + (phraseSignatures[index]?.tailWeight ?? 0),
		0,
	);
	if (tokens.length === 0) {
		return createEmptyCoverageLexicalPassageAdmissionSignal(
			phraseMatchCount,
			phraseMatchWeight,
		);
	}

	const activeFamilies = families.filter((family) => family.role !== "noise");
	if (activeFamilies.length === 0) {
		return createEmptyCoverageLexicalPassageAdmissionSignal(
			phraseMatchCount,
			phraseMatchWeight,
		);
	}

	const matchesByPosition: Array<Array<{
		familyIndex: number;
		kind: Exclude<CoverageFamilyMatchKind, null>;
	}>> = Array.from({ length: tokens.length }, () => []);
	const candidateCenters: number[] = [];
	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
		const token = tokens[tokenIndex];
		for (const family of activeFamilies) {
			const kind = matchTokenToFamily(token, family);
			if (!kind) {
				continue;
			}
			matchesByPosition[tokenIndex].push({ familyIndex: family.index, kind });
		}
		if (matchesByPosition[tokenIndex].length > 0) {
			candidateCenters.push(tokenIndex);
		}
	}

	if (candidateCenters.length === 0) {
		return createEmptyCoverageLexicalPassageAdmissionSignal(
			phraseMatchCount,
			phraseMatchWeight,
		);
	}

	const baseWindow = Math.min(
		MAX_ADMISSION_WINDOW,
		Math.max(MIN_ADMISSION_WINDOW, activeFamilies.length * 3),
	);
	const candidateWindows = Array.from(
		new Set([
			baseWindow,
			Math.max(MIN_ADMISSION_WINDOW, Math.floor(baseWindow * 0.65)),
		]),
	);

	let best = createEmptyCoverageLexicalPassageAdmissionSignal(
		phraseMatchCount,
		phraseMatchWeight,
	);
	const seen = new Set<string>();
	for (const center of candidateCenters) {
		for (const windowSize of candidateWindows) {
			const start = Math.max(
				0,
				Math.min(center - Math.floor(windowSize / 2), tokens.length - windowSize),
			);
			const end = Math.min(tokens.length - 1, start + windowSize - 1);
			const key = `${start}:${end}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			const candidate = scoreWindow(
				start,
				end,
				matchesByPosition,
				families,
				phraseMatchCount,
				phraseMatchWeight,
			);
			if (compareCoverageLexicalPassageAdmissionSignals(candidate, best) < 0) {
				best = candidate;
			}
		}
	}

	return best;
}

export function compareCoverageLexicalPassageAdmissionSignals(
	left: CoverageLexicalPassageAdmissionSignal,
	right: CoverageLexicalPassageAdmissionSignal,
): number {
	return (
		compareDescendingMetric(left.coreCoverageCount, right.coreCoverageCount) ||
		compareDescendingMetric(left.exactWeight, right.exactWeight) ||
		compareDescendingMetric(left.prefixWeight, right.prefixWeight) ||
		compareDescendingMetric(left.fuzzyWeight, right.fuzzyWeight) ||
		compareDescendingMetric(left.phraseMatchCount, right.phraseMatchCount) ||
		compareDescendingMetric(left.phraseMatchWeight, right.phraseMatchWeight) ||
		compareDescendingMetric(left.anchorCoverageCount, right.anchorCoverageCount) ||
		compareDescendingMetric(left.softCoverageCount, right.softCoverageCount) ||
		compareDescendingMetric(left.compactnessScore, right.compactnessScore)
	);
}

function scoreWindow(
	start: number,
	end: number,
	matchesByPosition: ReadonlyArray<
		ReadonlyArray<{
			familyIndex: number;
			kind: Exclude<CoverageFamilyMatchKind, null>;
		}>
	>,
	families: readonly CoverageLexicalFamily[],
	phraseMatchCount: number,
	phraseMatchWeight: number,
): CoverageLexicalPassageAdmissionSignal {
	const bestKindCodeByFamily: number[] = [];
	for (let tokenIndex = start; tokenIndex <= end; tokenIndex++) {
		for (const match of matchesByPosition[tokenIndex]) {
			const previousCode = bestKindCodeByFamily[match.familyIndex] ?? 0;
			const nextCode = encodeMatchKind(match.kind);
			if (previousCode >= nextCode) {
				continue;
			}
			bestKindCodeByFamily[match.familyIndex] = nextCode;
		}
	}

	let coreCoverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let anchorCoverageCount = 0;
	let softCoverageCount = 0;

	for (const family of families) {
		const kind = decodeMatchKind(bestKindCodeByFamily[family.index] ?? 0);
		if (!kind) {
			continue;
		}
		const weight = computeFamilyTailWeight(family.index);
		if (family.role === "body" && family.strength === "core") {
			coreCoverageCount += 1;
			if (kind === "exact") {
				exactWeight += weight;
			} else if (kind === "prefix") {
				prefixWeight += weight;
			} else {
				fuzzyWeight += weight;
			}
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

	const spanLength = Math.max(1, end - start + 1);
	return {
		coreCoverageCount,
		exactWeight,
		prefixWeight,
		fuzzyWeight,
		anchorCoverageCount,
		softCoverageCount,
		phraseMatchCount,
		phraseMatchWeight,
		compactnessScore:
			coreCoverageCount * 100 +
			exactWeight * 4 +
			prefixWeight * 2 +
			anchorCoverageCount * 12 +
			softCoverageCount * 4 +
			(coreCoverageCount + anchorCoverageCount + softCoverageCount * 0.6) /
				spanLength,
	};
}

function createEmptyCoverageLexicalPassageAdmissionSignal(
	phraseMatchCount = 0,
	phraseMatchWeight = 0,
): CoverageLexicalPassageAdmissionSignal {
	return {
		coreCoverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		phraseMatchCount,
		phraseMatchWeight,
		compactnessScore: 0,
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

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function computeMaxFuzzyDistance(term: string): number {
	if (term.length >= 9) {
		return 2;
	}
	if (term.length >= 5) {
		return 1;
	}
	return 0;
}

function boundedLevenshtein(
	left: string,
	right: string,
	maxDistance: number,
): number {
	const leftLength = left.length;
	const rightLength = right.length;
	if (Math.abs(leftLength - rightLength) > maxDistance) {
		return maxDistance + 1;
	}

	const previous = new Array(rightLength + 1);
	const current = new Array(rightLength + 1);
	for (let column = 0; column <= rightLength; column++) {
		previous[column] = column;
	}

	for (let row = 1; row <= leftLength; row++) {
		current[0] = row;
		let rowMin = current[0];
		for (let column = 1; column <= rightLength; column++) {
			const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
			const value = Math.min(
				previous[column] + 1,
				current[column - 1] + 1,
				previous[column - 1] + substitutionCost,
			);
			current[column] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let column = 0; column <= rightLength; column++) {
			previous[column] = current[column];
		}
	}

	return previous[rightLength];
}
