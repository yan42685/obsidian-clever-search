/**
 * A small shared matcher for interactive search surfaces.
 *
 * We use it in two places:
 * 1. search history suggestions
 * 2. in-file line matching
 *
 * The goal is not to perfectly emulate fzf. Instead, it keeps the matching
 * model understandable and cheap while still handling:
 * - prefix / substring matches
 * - queries that ignore spaces
 * - multi-term partial input with order-sensitive boosting
 * - short acronym-like queries such as "hs" -> "hybrid search"
 */

export type LightweightFuzzyIndex = {
	originalText: string;
	normalizedText: string;
	collapsedText: string;
	collapsedToOriginalPositions: number[];
	wordInitials: string;
	wordInitialPositions: number[];
};

export type LightweightFuzzyMatch = {
	score: number;
	positions: number[];
};

export type LightweightFuzzyMode = "default" | "history";

export type PreparedLightweightFuzzyQuery = {
	normalizedQuery: string;
	queryTerms: string[];
	collapsedQuery: string;
	hasCollapsedVariant: boolean;
	allowInitialism: boolean;
	mode: LightweightFuzzyMode;
};

export function normalizeLightweightFuzzyText(text: string): string {
	return text.trim().toLocaleLowerCase();
}

export function createLightweightFuzzyIndex(
	text: string,
): LightweightFuzzyIndex {
	const normalizedText = normalizeLightweightFuzzyText(text);
	const { collapsedText, collapsedToOriginalPositions } =
		createCollapsedText(normalizedText);
	const { initials, positions } = createWordInitials(normalizedText);
	return {
		originalText: text,
		normalizedText,
		collapsedText,
		collapsedToOriginalPositions,
		wordInitials: initials,
		wordInitialPositions: positions,
	};
}

export function prepareLightweightFuzzyQuery(
	queryText: string,
	mode: LightweightFuzzyMode = "default",
): PreparedLightweightFuzzyQuery {
	const normalizedQuery = normalizeLightweightFuzzyText(queryText);
	const queryTerms = splitQueryTerms(normalizedQuery);
	const collapsedQuery = collapseWhitespace(normalizedQuery);
	return {
		normalizedQuery,
		queryTerms,
		collapsedQuery,
		hasCollapsedVariant:
			collapsedQuery.length > 0 && collapsedQuery !== normalizedQuery,
		allowInitialism: queryTerms.length === 1 && collapsedQuery.length <= 6,
		mode,
	};
}

export function matchLightweightFuzzy(
	queryTextOrPrepared: string | PreparedLightweightFuzzyQuery,
	index: LightweightFuzzyIndex,
): LightweightFuzzyMatch | null {
	const preparedQuery =
		typeof queryTextOrPrepared === "string"
			? prepareLightweightFuzzyQuery(queryTextOrPrepared)
			: queryTextOrPrepared;
	const { normalizedQuery, queryTerms, collapsedQuery } = preparedQuery;
	if (normalizedQuery.length === 0 || index.normalizedText.length === 0) {
		return null;
	}

	let bestMatch = pickBetterMatch(
		null,
		matchContiguous(
			normalizedQuery,
			index.normalizedText,
			4200,
			3200,
			320,
			260,
			120,
			18,
		),
	);

	bestMatch = pickBetterMatch(
		bestMatch,
		matchCoverageTerms(queryTerms, index.normalizedText),
	);

	if (
		collapsedQuery.length > 0 &&
		(preparedQuery.hasCollapsedVariant ||
			index.collapsedText !== index.normalizedText)
	) {
		bestMatch = pickBetterMatch(
			bestMatch,
			matchCollapsedContiguous(collapsedQuery, index),
		);
	}

	if (preparedQuery.allowInitialism) {
		bestMatch = pickBetterMatch(
			bestMatch,
			matchInitialism(collapsedQuery, index),
		);
	}

	// History suggestions already have term coverage and contiguous matching.
	// Skipping the broadest subsequence fallback for multi-term history queries
	// trims hot-path cost without materially hurting suggestion quality.
	if (
		preparedQuery.mode !== "history" ||
		preparedQuery.queryTerms.length <= 1
	) {
		bestMatch = pickBetterMatch(
			bestMatch,
			matchSubsequenceAgainstText(normalizedQuery, index.normalizedText),
		);

		if (preparedQuery.hasCollapsedVariant && index.collapsedText.length > 0) {
			bestMatch = pickBetterMatch(
				bestMatch,
				matchCollapsedSubsequence(collapsedQuery, index),
			);
		}
	}

	return bestMatch;
}

function matchCoverageTerms(
	queryTerms: string[],
	text: string,
): LightweightFuzzyMatch | null {
	if (queryTerms.length <= 1) {
		return null;
	}

	const hits = queryTerms
		.map((term) => findBestTermOccurrence(text, term))
		.filter((hit): hit is TermOccurrence => hit !== null);

	const minCoverage =
		queryTerms.length <= 2 ? queryTerms.length : queryTerms.length - 1;
	if (hits.length < minCoverage) {
		return null;
	}

	const sortedHits = [...hits].sort((left, right) => left.start - right.start);
	const coverageCount = hits.length;
	const missingTerms = queryTerms.length - coverageCount;
	const boundaryHits = hits.reduce(
		(count, hit) => count + (hit.isBoundary ? 1 : 0),
		0,
	);
	let orderedPairs = 0;
	let compactGapPenalty = 0;
	for (let index = 1; index < hits.length; index++) {
		if (hits[index].start >= hits[index - 1].end) {
			orderedPairs++;
		}
	}
	for (let index = 1; index < sortedHits.length; index++) {
		compactGapPenalty += Math.max(
			0,
			sortedHits[index].start - sortedHits[index - 1].end,
		);
	}

	const firstStart = sortedHits[0]?.start ?? 0;
	const lastEnd = sortedHits[sortedHits.length - 1]?.end ?? firstStart;
	const span = lastEnd - firstStart;
	const positions = createCoveragePositions(sortedHits);

	return {
		score:
			2600 +
			coverageCount * 260 +
			boundaryHits * 32 +
			orderedPairs * 120 +
			(orderedPairs === hits.length - 1 ? 180 : 0) -
			missingTerms * 180 -
			compactGapPenalty * 8 -
			span * 2 -
			firstStart * 3,
		positions,
	};
}

function findBestTermOccurrence(
	text: string,
	term: string,
): TermOccurrence | null {
	let bestHit: TermOccurrence | null = null;
	let from = 0;
	while (from <= text.length - term.length) {
		const index = text.indexOf(term, from);
		if (index < 0) {
			break;
		}

		const hit: TermOccurrence = {
			start: index,
			end: index + term.length,
			isBoundary: isWordBoundary(text, index),
		};
		if (
			!bestHit ||
			getTermOccurrenceScore(hit) > getTermOccurrenceScore(bestHit)
		) {
			bestHit = hit;
		}

		if (hit.isBoundary) {
			break;
		}
		from = index + 1;
	}

	return bestHit;
}

function getTermOccurrenceScore(hit: TermOccurrence): number {
	return (hit.isBoundary ? 120 : 0) - hit.start * 6;
}

function matchCollapsedContiguous(
	collapsedQuery: string,
	index: LightweightFuzzyIndex,
): LightweightFuzzyMatch | null {
	const collapsedMatch = matchContiguous(
		collapsedQuery,
		index.collapsedText,
		3900,
		3050,
		260,
		220,
		100,
		14,
	);
	if (!collapsedMatch) {
		return null;
	}

	return {
		score: collapsedMatch.score,
		positions: collapsedMatch.positions.map(
			(position) => index.collapsedToOriginalPositions[position],
		),
	};
}

function matchCollapsedSubsequence(
	collapsedQuery: string,
	index: LightweightFuzzyIndex,
): LightweightFuzzyMatch | null {
	const collapsedMatch = matchSubsequenceAgainstText(
		collapsedQuery,
		index.collapsedText,
	);
	if (!collapsedMatch) {
		return null;
	}

	return {
		score: collapsedMatch.score - 60,
		positions: collapsedMatch.positions.map(
			(position) => index.collapsedToOriginalPositions[position],
		),
	};
}

function matchInitialism(
	normalizedQuery: string,
	index: LightweightFuzzyIndex,
): LightweightFuzzyMatch | null {
	const initialismMatch = matchSubsequence(
		normalizedQuery,
		index.wordInitials,
	);
	if (!initialismMatch) {
		return null;
	}

	return {
		score:
			2600 +
			initialismMatch.consecutivePairs * 48 -
			initialismMatch.gaps * 26 -
			initialismMatch.startIndex * 8,
		positions: initialismMatch.positions.map(
			(position) => index.wordInitialPositions[position],
		),
	};
}

function matchSubsequenceAgainstText(
	normalizedQuery: string,
	text: string,
): LightweightFuzzyMatch | null {
	const subsequenceMatch = matchSubsequence(normalizedQuery, text);
	if (!subsequenceMatch) {
		return null;
	}

	const boundaryHits = subsequenceMatch.positions.reduce(
		(count, position) => count + (isWordBoundary(text, position) ? 1 : 0),
		0,
	);
	return {
		score:
			1800 +
			subsequenceMatch.consecutivePairs * 42 +
			boundaryHits * 22 -
			subsequenceMatch.gaps * 18 -
			subsequenceMatch.span * 4 -
			subsequenceMatch.startIndex * 5,
		positions: subsequenceMatch.positions,
	};
}

function matchContiguous(
	query: string,
	text: string,
	prefixBaseScore: number,
	substringBaseScore: number,
	prefixLengthPenaltyCap: number,
	substringLengthPenaltyCap: number,
	boundaryBonus: number,
	indexPenalty: number,
): LightweightFuzzyMatch | null {
	const matchIndex = text.indexOf(query);
	if (matchIndex < 0) {
		return null;
	}

	if (matchIndex === 0) {
		return {
			score:
				prefixBaseScore -
				Math.min(prefixLengthPenaltyCap, text.length - query.length),
			positions: createContiguousPositions(0, query.length),
		};
	}

	return {
		score:
			substringBaseScore +
			(isWordBoundary(text, matchIndex) ? boundaryBonus : 0) -
			matchIndex * indexPenalty -
			Math.min(substringLengthPenaltyCap, text.length - query.length),
		positions: createContiguousPositions(matchIndex, query.length),
	};
}

function matchSubsequence(
	needle: string,
	haystack: string,
):
	| {
			positions: number[];
			startIndex: number;
			span: number;
			gaps: number;
			consecutivePairs: number;
	  }
	| null {
	if (needle.length === 0 || haystack.length === 0) {
		return null;
	}

	const positions: number[] = [];
	let haystackIndex = 0;
	for (const char of needle) {
		const nextIndex = haystack.indexOf(char, haystackIndex);
		if (nextIndex < 0) {
			return null;
		}
		positions.push(nextIndex);
		haystackIndex = nextIndex + 1;
	}

	const startIndex = positions[0] ?? 0;
	const endIndex = positions[positions.length - 1] ?? startIndex;
	let consecutivePairs = 0;
	for (let index = 1; index < positions.length; index++) {
		if (positions[index] === positions[index - 1] + 1) {
			consecutivePairs++;
		}
	}

	return {
		positions,
		startIndex,
		span: endIndex - startIndex + 1,
		gaps: endIndex - startIndex + 1 - positions.length,
		consecutivePairs,
	};
}

function createCollapsedText(text: string): {
	collapsedText: string;
	collapsedToOriginalPositions: number[];
} {
	let collapsedText = "";
	const collapsedToOriginalPositions: number[] = [];
	for (let index = 0; index < text.length; index++) {
		if (/\s/u.test(text[index])) {
			continue;
		}
		collapsedText += text[index];
		collapsedToOriginalPositions.push(index);
	}
	return { collapsedText, collapsedToOriginalPositions };
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/gu, "");
}

function createWordInitials(text: string): {
	initials: string;
	positions: number[];
} {
	let initials = "";
	const positions: number[] = [];
	for (let index = 0; index < text.length; index++) {
		if (isWordBoundary(text, index)) {
			initials += text[index];
			positions.push(index);
		}
	}
	return { initials, positions };
}

function splitQueryTerms(query: string): string[] {
	return query
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

function isWordBoundary(text: string, index: number): boolean {
	if (index <= 0) {
		return true;
	}
	return !isWordChar(text[index - 1]);
}

function isWordChar(char: string | undefined): boolean {
	return char ? /[\p{L}\p{N}]/u.test(char) : false;
}

function createContiguousPositions(start: number, length: number): number[] {
	return Array.from({ length }, (_, index) => start + index);
}

function createCoveragePositions(sortedHits: TermOccurrence[]): number[] {
	const positions: number[] = [];
	let lastPosition = -1;

	for (const hit of sortedHits) {
		for (let position = hit.start; position < hit.end; position++) {
			if (position <= lastPosition) {
				continue;
			}
			positions.push(position);
			lastPosition = position;
		}
	}

	return positions;
}

function pickBetterMatch(
	left: LightweightFuzzyMatch | null,
	right: LightweightFuzzyMatch | null,
): LightweightFuzzyMatch | null {
	if (!left) {
		return right;
	}
	if (!right) {
		return left;
	}
	return right.score > left.score ? right : left;
}

type TermOccurrence = {
	start: number;
	end: number;
	isBoundary: boolean;
};
