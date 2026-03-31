import type {
	CoverageFamilyMatchKind,
	CoverageLexicalFamily,
} from "./coverage-lexical-types";

const DEFAULT_WINDOW_FUZZY_PROPORTION = 0.2;

export type CoverageLexicalFamilyTokenMatch = {
	familyIndex: number;
	kind: Exclude<CoverageFamilyMatchKind, null>;
};

export type CoverageLexicalBodyEvidenceTrace = {
	tokenCount: number;
	activeFamilies: readonly CoverageLexicalFamily[];
	admissionMatchesByPosition: CoverageLexicalFamilyTokenMatch[][];
	admissionHitPositions: number[];
	windowMatchesByPosition: CoverageLexicalFamilyTokenMatch[][];
	windowHitPositions: number[];
};

type CoverageLexicalFamilyMatcher = {
	familyIndex: number;
	normalizedTerm: string;
	normalizedTermLength: number;
	firstChar: string;
	allowPrefix: boolean;
	admissionMaxDistance: number;
	windowMaxDistance: number;
	maxDistance: number;
};

type CoverageLexicalBodyEvidenceContext = {
	activeFamilies: readonly CoverageLexicalFamily[];
	matchers: readonly CoverageLexicalFamilyMatcher[];
};

const EMPTY_TOKEN_MATCHES: CoverageLexicalFamilyTokenMatch[] = [];

export function buildCoverageLexicalBodyEvidenceTrace(
	tokens: readonly string[],
	families: readonly CoverageLexicalFamily[],
	windowFuzzyProportion: number = DEFAULT_WINDOW_FUZZY_PROPORTION,
): CoverageLexicalBodyEvidenceTrace {
	const context = createCoverageLexicalBodyEvidenceContext(
		families,
		windowFuzzyProportion,
	);
	const admissionMatchesByPosition: CoverageLexicalFamilyTokenMatch[][] =
		new Array(tokens.length);
	const windowMatchesByPosition: CoverageLexicalFamilyTokenMatch[][] =
		new Array(tokens.length);
	const admissionHitPositions: number[] = [];
	const windowHitPositions: number[] = [];

	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
		const token = tokens[tokenIndex];
		const tokenLength = token.length;
		const tokenFirstChar = token[0] ?? "";
		let admissionMatches: CoverageLexicalFamilyTokenMatch[] | null = null;
		let windowMatches: CoverageLexicalFamilyTokenMatch[] | null = null;

		for (const matcher of context.matchers) {
			if (token === matcher.normalizedTerm) {
				(admissionMatches ??= []).push({
					familyIndex: matcher.familyIndex,
					kind: "exact",
				});
				(windowMatches ??= []).push({
					familyIndex: matcher.familyIndex,
					kind: "exact",
				});
				continue;
			}
			if (matcher.allowPrefix && token.startsWith(matcher.normalizedTerm)) {
				(admissionMatches ??= []).push({
					familyIndex: matcher.familyIndex,
					kind: "prefix",
				});
				(windowMatches ??= []).push({
					familyIndex: matcher.familyIndex,
					kind: "prefix",
				});
				continue;
			}
			if (
				matcher.maxDistance <= 0 ||
				tokenFirstChar !== matcher.firstChar ||
				Math.abs(tokenLength - matcher.normalizedTermLength) > matcher.maxDistance
			) {
				continue;
			}

			const distance = boundedLevenshtein(
				token,
				matcher.normalizedTerm,
				matcher.maxDistance,
			);
			if (
				matcher.admissionMaxDistance > 0 &&
				distance <= matcher.admissionMaxDistance
			) {
				(admissionMatches ??= []).push({
					familyIndex: matcher.familyIndex,
					kind: "fuzzy",
				});
			}
			if (matcher.windowMaxDistance > 0 && distance <= matcher.windowMaxDistance) {
				(windowMatches ??= []).push({
					familyIndex: matcher.familyIndex,
					kind: "fuzzy",
				});
			}
		}

		admissionMatchesByPosition[tokenIndex] = admissionMatches ?? EMPTY_TOKEN_MATCHES;
		windowMatchesByPosition[tokenIndex] = windowMatches ?? EMPTY_TOKEN_MATCHES;
		if (admissionMatches !== null) {
			admissionHitPositions.push(tokenIndex);
		}
		if (windowMatches !== null) {
			windowHitPositions.push(tokenIndex);
		}
	}

	return {
		tokenCount: tokens.length,
		activeFamilies: context.activeFamilies,
		admissionMatchesByPosition,
		admissionHitPositions,
		windowMatchesByPosition,
		windowHitPositions,
	};
}

function createCoverageLexicalBodyEvidenceContext(
	families: readonly CoverageLexicalFamily[],
	windowFuzzyProportion: number,
): CoverageLexicalBodyEvidenceContext {
	const activeFamilies = families.filter((family) => family.role !== "noise");
	const matchers: CoverageLexicalFamilyMatcher[] = activeFamilies.map((family) => {
		const admissionMaxDistance = family.allowFuzzy
			? computeAdmissionMaxFuzzyDistance(family.normalizedTerm)
			: 0;
		const windowMaxDistance = family.allowFuzzy
			? computeWindowMaxFuzzyDistance(
					family.normalizedTerm,
					windowFuzzyProportion,
				)
			: 0;
		return {
			familyIndex: family.index,
			normalizedTerm: family.normalizedTerm,
			normalizedTermLength: family.normalizedTerm.length,
			firstChar: family.normalizedTerm[0] ?? "",
			allowPrefix: family.allowPrefix,
			admissionMaxDistance,
			windowMaxDistance,
			maxDistance: Math.max(admissionMaxDistance, windowMaxDistance),
		};
	});
	return {
		activeFamilies,
		matchers,
	};
}

function computeAdmissionMaxFuzzyDistance(term: string): number {
	if (term.length >= 9) {
		return 2;
	}
	if (term.length >= 5) {
		return 1;
	}
	return 0;
}

function computeWindowMaxFuzzyDistance(
	queryTerm: string,
	windowFuzzyProportion: number,
): number {
	if (queryTerm.length <= 4) {
		return 0;
	}
	return Math.min(
		2,
		Math.max(1, Math.round(queryTerm.length * windowFuzzyProportion)),
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
