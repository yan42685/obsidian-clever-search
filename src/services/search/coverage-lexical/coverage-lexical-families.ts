import type { CoverageLexicalFamily } from "./coverage-lexical-types";

const STRUCTURAL_TOKEN_REGEX = /^[._/\-]+$/u;
const NUMBERISH_TOKEN_REGEX = /^(?:\d+|v?\d+(?:[.\-]\d+)+)$/u;

export function buildCoverageLexicalFamilies(
	queryTerms: readonly string[],
): CoverageLexicalFamily[] {
	return queryTerms.map((rawTerm, index) => {
		const normalizedTerm = rawTerm.trim().toLowerCase();
		const isMetadataCapable = isMetadataCapableFamily(normalizedTerm);
		return {
			index,
			rawTerm,
			normalizedTerm,
			isCore: isCoreFamily(normalizedTerm, index, queryTerms.length),
			isMetadataCapable,
		};
	});
}

function isCoreFamily(
	term: string,
	index: number,
	totalTerms: number,
): boolean {
	if (isStructuralToken(term) || isWeakToken(term)) {
		return totalTerms <= 2 && !isStructuralToken(term);
	}
	if (index === totalTerms - 1 && term.length >= 3) {
		return true;
	}
	return true;
}

function isMetadataCapableFamily(term: string): boolean {
	return (
		term.includes("/") ||
		term.includes("\\") ||
		term.includes(".") ||
		term.includes("-") ||
		term === "title" ||
		term === "path" ||
		term === "folder" ||
		term === "tag"
	);
}

function isWeakToken(term: string): boolean {
	return (
		NUMBERISH_TOKEN_REGEX.test(term) ||
		term.length <= 2 ||
		/^[a-z]$/u.test(term) ||
		/^\p{Script=Han}$/u.test(term) ||
		term === "to" ||
		term === "and" ||
		term === "the" ||
		term === "of"
	);
}

function isStructuralToken(term: string): boolean {
	return term.length === 0 || STRUCTURAL_TOKEN_REGEX.test(term);
}
