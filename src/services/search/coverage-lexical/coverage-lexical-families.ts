import type {
	CoverageLexicalFamily,
	CoverageLexicalFamilyProbe,
} from "./coverage-lexical-types";

const STRUCTURAL_TOKEN_REGEX = /^[._/\-]+$/u;
const NUMBERISH_TOKEN_REGEX = /^(?:\d+|v?\d+(?:[.\-]\d+)+)$/u;
const ASCII_ALPHA_NUMERIC_REGEX = /^[a-z0-9_-]+$/u;
const HAN_ONLY_REGEX = /^\p{Script=Han}+$/u;
const EXPLICIT_METADATA_TERM_REGEX =
	/^(?:title|path|folder|tag|tags|alias|aliases|heading|headings|basename|name|file)$/u;

export function buildCoverageLexicalFamilies(
	queryTerms: readonly string[],
	probes: ReadonlyArray<CoverageLexicalFamilyProbe> = [],
): CoverageLexicalFamily[] {
	const shortQueryOverlay = queryTerms.filter((term) => !isStructuralToken(term.trim())).length <= 2;
	return queryTerms.map((rawTerm, index) => {
		const normalizedTerm = rawTerm.trim().toLowerCase();
		const isMetadataCapable = isMetadataCapableFamily(normalizedTerm);
		const probe = probes[index];
		const strength = classifyFamilyStrength(
			normalizedTerm,
			index,
			queryTerms.length,
			shortQueryOverlay,
			probe,
		);
		const role = classifyFamilyRole(
			normalizedTerm,
			strength,
			shortQueryOverlay,
			isMetadataCapable,
			probe,
		);
		return {
			index,
			rawTerm,
			normalizedTerm,
			strength,
			role,
			isMetadataCapable,
			allowPrefix: canUsePrefixExpansion(normalizedTerm),
			allowFuzzy: canUseFuzzyExpansion(normalizedTerm),
		};
	});
}

function classifyFamilyStrength(
	term: string,
	index: number,
	totalTerms: number,
	shortQueryOverlay: boolean,
	probe: CoverageLexicalFamilyProbe | undefined,
): CoverageLexicalFamily["strength"] {
	if (isStructuralToken(term)) {
		return "soft";
	}
	if (probe?.familyTier === "weak" && isWeakToken(term)) {
		return "soft";
	}
	if (shortQueryOverlay) {
		return "core";
	}
	if (isWeakToken(term)) {
		return shouldPromoteTailFamily(term, index, totalTerms) ? "core" : "soft";
	}
	return "core";
}

function shouldPromoteTailFamily(
	term: string,
	index: number,
	totalTerms: number,
): boolean {
	if (index !== totalTerms - 1) {
		return false;
	}
	return !NUMBERISH_TOKEN_REGEX.test(term) && term.length >= 3;
}

function classifyFamilyRole(
	term: string,
	strength: CoverageLexicalFamily["strength"],
	shortQueryOverlay: boolean,
	isMetadataCapable: boolean,
	probe: CoverageLexicalFamilyProbe | undefined,
): CoverageLexicalFamily["role"] {
	if (isStructuralToken(term)) {
		return "noise";
	}
	const metadataDominant =
		(probe?.metadataExactDocCount ?? 0) > 0 &&
		(probe?.metadataExactDocCount ?? 0) >=
			Math.max(2, (probe?.bodyExactDocCount ?? 0) * 2);
	if (metadataDominant) {
		return "anchor";
	}
	const shortMetadataAnchor =
		shortQueryOverlay &&
		strength === "core" &&
		(probe?.metadataExactDocCount ?? 0) > 0 &&
		(probe?.metadataExactDocCount ?? 0) >=
			Math.max(1, Math.floor((probe?.bodyExactDocCount ?? 0) / 2));
	if (shortMetadataAnchor) {
		return "anchor";
	}
	if (
		isMetadataCapable &&
		(isExplicitMetadataTerm(term) ||
			hasStrongPathShape(term))
	) {
		return "anchor";
	}
	if (strength === "soft" && isWeakToken(term)) {
		return "noise";
	}
	return "body";
}

function isMetadataCapableFamily(term: string): boolean {
	return (
		term.includes("/") ||
		term.includes("\\") ||
		term.includes(".") ||
		term.includes("-") ||
		term === "title" ||
		term === "alias" ||
		term === "aliases" ||
		term === "basename" ||
		term === "heading" ||
		term === "headings" ||
		term === "file" ||
		term === "path" ||
		term === "folder" ||
		term === "tag" ||
		term === "tags"
	);
}

function isWeakToken(term: string): boolean {
	if (HAN_ONLY_REGEX.test(term)) {
		return term.length === 1;
	}
	return (
		NUMBERISH_TOKEN_REGEX.test(term) ||
		term.length <= 2 ||
		/^[a-z]$/u.test(term) ||
		term === "to" ||
		term === "and" ||
		term === "the" ||
		term === "of"
	);
}

function isStructuralToken(term: string): boolean {
	return term.length === 0 || STRUCTURAL_TOKEN_REGEX.test(term);
}

function isExplicitMetadataTerm(term: string): boolean {
	return EXPLICIT_METADATA_TERM_REGEX.test(term);
}

function hasStrongPathShape(term: string): boolean {
	return term.includes("/") || term.includes("\\") || term.includes(".");
}

function canUsePrefixExpansion(term: string): boolean {
	return ASCII_ALPHA_NUMERIC_REGEX.test(term) && term.length >= 3;
}

function canUseFuzzyExpansion(term: string): boolean {
	return ASCII_ALPHA_NUMERIC_REGEX.test(term) && term.length >= 5;
}
