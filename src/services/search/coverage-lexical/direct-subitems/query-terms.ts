import type { DirectSubitemsQueryTerm } from "./contracts";

const QUERY_TERM_REGEX = /\p{Script=Han}+|[^\s\p{Script=Han}]+/gu;

export function splitDirectSubitemsQueryTerms(
	queryText: string,
): DirectSubitemsQueryTerm[] {
	const terms: DirectSubitemsQueryTerm[] = [];
	let nextIndex = 0;
	for (const match of queryText.matchAll(QUERY_TERM_REGEX)) {
		const rawText = match[0];
		const matchStart = match.index ?? 0;
		if (!rawText.trim()) {
			continue;
		}
		if (/^\p{Script=Han}+$/u.test(rawText)) {
			const hanTerms = buildHanTerms(rawText, matchStart, nextIndex);
			terms.push(...hanTerms.terms);
			nextIndex = hanTerms.nextIndex;
			continue;
		}
		const normalizedText = rawText.toLowerCase();
		terms.push({
			termId: buildTermId(nextIndex, "non_han_run", normalizedText),
			kind: "non_han_run",
			rawText,
			normalizedText,
			queryStart: matchStart,
			queryEnd: matchStart + rawText.length,
		});
		nextIndex += 1;
	}
	return terms;
}

function buildHanTerms(
	rawText: string,
	queryStart: number,
	nextIndex: number,
): {
	terms: DirectSubitemsQueryTerm[];
	nextIndex: number;
} {
	if (rawText.length <= 1) {
		return {
			terms: [
				{
					termId: buildTermId(nextIndex, "han_char", rawText),
					kind: "han_char",
					rawText,
					normalizedText: rawText,
					queryStart,
					queryEnd: queryStart + rawText.length,
				},
			],
			nextIndex: nextIndex + 1,
		};
	}
	const terms: DirectSubitemsQueryTerm[] = [];
	let currentIndex = nextIndex;
	for (let index = 0; index < rawText.length - 1; index += 1) {
		const bigram = rawText.slice(index, index + 2);
		terms.push({
			termId: buildTermId(currentIndex, "han_bigram", bigram),
			kind: "han_bigram",
			rawText: bigram,
			normalizedText: bigram,
			queryStart: queryStart + index,
			queryEnd: queryStart + index + 2,
		});
		currentIndex += 1;
	}
	return {
		terms,
		nextIndex: currentIndex,
	};
}

function buildTermId(
	index: number,
	kind: DirectSubitemsQueryTerm["kind"],
	normalizedText: string,
): string {
	return `${index}:${kind}:${normalizedText}`;
}
