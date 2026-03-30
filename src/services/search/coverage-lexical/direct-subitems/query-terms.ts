import type { DirectSubitemsQueryTerm } from "./contracts";

const QUERY_TERM_REGEX = /\p{Script=Han}|[^\s\p{Script=Han}]+/gu;

export function splitDirectSubitemsQueryTerms(
	queryText: string,
): DirectSubitemsQueryTerm[] {
	const terms: DirectSubitemsQueryTerm[] = [];
	let nextIndex = 0;
	for (const match of queryText.matchAll(QUERY_TERM_REGEX)) {
		const rawText = match[0];
		const queryStart = match.index ?? 0;
		const queryEnd = queryStart + rawText.length;
		if (!rawText.trim()) {
			continue;
		}
		const isHanChar = /^\p{Script=Han}$/u.test(rawText);
		const normalizedText = isHanChar ? rawText : rawText.toLowerCase();
		terms.push({
			termId: buildTermId(nextIndex, isHanChar ? "han_char" : "non_han_run", normalizedText),
			kind: isHanChar ? "han_char" : "non_han_run",
			rawText,
			normalizedText,
			queryStart,
			queryEnd,
		});
		nextIndex += 1;
	}
	return terms;
}

function buildTermId(
	index: number,
	kind: DirectSubitemsQueryTerm["kind"],
	normalizedText: string,
): string {
	return `${index}:${kind}:${normalizedText}`;
}
