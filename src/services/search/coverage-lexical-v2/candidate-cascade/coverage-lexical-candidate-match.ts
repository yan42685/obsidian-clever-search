import type {
	CoverageLexicalV2MatchQualityKind,
} from "../comparator";

export type CoverageLexicalV2CandidateCascadeMatchOptions = {
	includePrefix?: boolean;
	includeFuzzy?: boolean;
	fuzzyProportion?: number;
};

const COVERAGE_LEXICAL_V2_LATIN_QUERY_TERM_REGEX = /^[a-z0-9_-]+$/i;
const COVERAGE_LEXICAL_V2_MIN_LATIN_PREFIX_LENGTH = 3;
const COVERAGE_LEXICAL_V2_MIN_LATIN_FUZZY_LENGTH = 5;

export function normalizeCoverageLexicalV2CandidateCascadeTerm(term: string): string {
	return term.trim().toLowerCase();
}

export function isCoverageLexicalV2LatinCandidateCascadeTerm(term: string): boolean {
	return COVERAGE_LEXICAL_V2_LATIN_QUERY_TERM_REGEX.test(term);
}

export function getCoverageLexicalV2CandidateCascadeMatchQuality(
	queryTerm: string,
	candidateTerm: string,
	options: CoverageLexicalV2CandidateCascadeMatchOptions = {},
): CoverageLexicalV2MatchQualityKind | null {
	const normalizedQueryTerm = normalizeCoverageLexicalV2CandidateCascadeTerm(queryTerm);
	const normalizedCandidateTerm = normalizeCoverageLexicalV2CandidateCascadeTerm(candidateTerm);
	if (normalizedQueryTerm.length === 0 || normalizedCandidateTerm.length === 0) {
		return null;
	}
	if (normalizedQueryTerm === normalizedCandidateTerm) {
		return "exact";
	}
	if (
		!isCoverageLexicalV2LatinCandidateCascadeTerm(normalizedQueryTerm) ||
		!isCoverageLexicalV2LatinCandidateCascadeTerm(normalizedCandidateTerm)
	) {
		return null;
	}
	if (
		options.includePrefix &&
		canUseCoverageLexicalV2LatinPrefix(normalizedQueryTerm) &&
		normalizedCandidateTerm.startsWith(normalizedQueryTerm)
	) {
		return "prefix";
	}
	if (
		options.includeFuzzy &&
		canUseCoverageLexicalV2LatinFuzzy(normalizedQueryTerm) &&
		!normalizedCandidateTerm.startsWith(normalizedQueryTerm)
	) {
		const maxDistance = computeCoverageLexicalV2LatinFuzzyMaxDistance(
			normalizedQueryTerm,
			options.fuzzyProportion,
		);
		if (
			computeCoverageLexicalV2LevenshteinDistance(
				normalizedQueryTerm,
				normalizedCandidateTerm,
				maxDistance,
			) <= maxDistance
		) {
			return "fuzzy";
		}
	}
	return null;
}

export function compareCoverageLexicalV2MatchQuality(
	left: CoverageLexicalV2MatchQualityKind,
	right: CoverageLexicalV2MatchQualityKind,
): number {
	return coverageLexicalV2CandidateCascadeMatchQualityRank(left) - coverageLexicalV2CandidateCascadeMatchQualityRank(right);
}

function canUseCoverageLexicalV2LatinPrefix(term: string): boolean {
	return term.length >= COVERAGE_LEXICAL_V2_MIN_LATIN_PREFIX_LENGTH;
}

function canUseCoverageLexicalV2LatinFuzzy(term: string): boolean {
	return term.length >= COVERAGE_LEXICAL_V2_MIN_LATIN_FUZZY_LENGTH;
}

function computeCoverageLexicalV2LatinFuzzyMaxDistance(
	term: string,
	fuzzyProportion = 0.2,
): number {
	return Math.max(1, Math.ceil(term.length * Math.max(0, fuzzyProportion)));
}

function coverageLexicalV2CandidateCascadeMatchQualityRank(
	kind: CoverageLexicalV2MatchQualityKind,
): number {
	switch (kind) {
		case "exact":
			return 0;
		case "prefix":
			return 1;
		case "fuzzy":
			return 2;
	}
}

function computeCoverageLexicalV2LevenshteinDistance(
	left: string,
	right: string,
	maxDistance: number,
): number {
	const leftLength = left.length;
	const rightLength = right.length;
	if (Math.abs(leftLength - rightLength) > maxDistance) {
		return maxDistance + 1;
	}
	let previousRow = new Array<number>(rightLength + 1);
	let nextRow = new Array<number>(rightLength + 1);
	for (let column = 0; column <= rightLength; column += 1) {
		previousRow[column] = column;
	}
	for (let row = 1; row <= leftLength; row += 1) {
		nextRow[0] = row;
		let rowMinimum = nextRow[0];
		for (let column = 1; column <= rightLength; column += 1) {
			const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
			nextRow[column] = Math.min(
				previousRow[column] + 1,
				nextRow[column - 1] + 1,
				previousRow[column - 1] + substitutionCost,
			);
			if (nextRow[column] < rowMinimum) {
				rowMinimum = nextRow[column];
			}
		}
		if (rowMinimum > maxDistance) {
			return maxDistance + 1;
		}
		[previousRow, nextRow] = [nextRow, previousRow];
	}
	return previousRow[rightLength];
}
