import type {
	CoverageLexicalFamily,
	CoverageLexicalMetadataField,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";

const ASCII_BRIDGE_TOKEN_REGEX = /^[a-z0-9]+$/u;
const HAN_TOKEN_REGEX = /\p{Script=Han}/u;
const LOCALE_MARKER_REGEX = /^(?:zh|cn|en|jp|ja|ko)$/u;
const TITLE_HINT_TERM_REGEX =
	/^(?:guide|playbook|runbook|checklist|roadmap|faq|matrix|index|note|notes|template|review|postmortem|retrospective|rollout)$/u;
const PATH_HINT_TERM_REGEX =
	/^(?:tech-(?:en|zh)|pkm-(?:en|zh)|docs|content|concepts|tasks|plugins|releases|archive|projects|guides|ops|daily)$/u;
const QUERY_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const STOP_QUERY_TERM_REGEX = /^(?:for|and|the|of|to|in|on|with|after|before|what|which|where)$/u;
const MIN_BRIDGE_SPAN = 2;
const MAX_BRIDGE_SPAN = 3;

export function buildCoverageLexicalPhraseSignatures(
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalPhraseSignature[] {
	const signatures: CoverageLexicalPhraseSignature[] = [];
	const activeFamilies = families.filter((family) => family.role !== "noise");
	for (let start = 0; start < activeFamilies.length; start++) {
		for (
			let span = MIN_BRIDGE_SPAN;
			span <= MAX_BRIDGE_SPAN && start + span <= activeFamilies.length;
			span++
		) {
			const windowFamilies = activeFamilies.slice(start, start + span);
			if (!isEligiblePhraseSignature(windowFamilies)) {
				continue;
			}
			signatures.push({
				index: signatures.length,
				familyIndices: windowFamilies.map((family) => family.index),
				variants: buildBridgeVariants(
					windowFamilies.map((family) => family.normalizedTerm),
				),
				tailWeight: windowFamilies.reduce(
					(total, family) => total + computeFamilyTailWeight(family.index),
					0,
				),
				preferredFields: null,
			});
		}
	}
	return signatures;
}

export function buildCoverageLexicalStructuredMetadataSignatures(
	queryText: string,
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalPhraseSignature[] {
	const rawTerms = extractRawQueryTerms(queryText);
	if (rawTerms.length < 2) {
		return [];
	}

	const signatures: CoverageLexicalPhraseSignature[] = [];
	const familyByTerm = new Map(
		families.map((family) => [family.normalizedTerm, family] as const),
	);
	const significantTerms = rawTerms.filter((term) => !STOP_QUERY_TERM_REGEX.test(term));

	const appendSignature = (
		terms: readonly string[],
		preferredFields: CoverageLexicalMetadataField[],
	): void => {
		const familyIndices = terms
			.map((term) => familyByTerm.get(term)?.index ?? null)
			.filter((index): index is number => index !== null);
		if (familyIndices.length < 2) {
			return;
		}
		signatures.push({
			index: signatures.length,
			familyIndices,
			variants: buildBridgeVariants(terms),
			tailWeight: familyIndices.reduce(
				(total, index) => total + computeFamilyTailWeight(index),
				0,
			),
			preferredFields,
		});
	};

	for (let index = 0; index < significantTerms.length; index++) {
		const term = significantTerms[index];
		if (TITLE_HINT_TERM_REGEX.test(term)) {
			appendSignature(
				significantTerms.slice(index, Math.min(significantTerms.length, index + 4)),
				["basename", "headings", "aliases"],
			);
		}
		if (PATH_HINT_TERM_REGEX.test(term) || term.includes("/") || term.includes(".") || term.includes("-")) {
			appendSignature(
				significantTerms.slice(index, Math.min(significantTerms.length, index + 3)),
				["folder", "basename", "aliases"],
			);
		}
	}

	if (significantTerms.some((term) => HAN_TOKEN_REGEX.test(term)) &&
		significantTerms.some((term) => ASCII_BRIDGE_TOKEN_REGEX.test(term) || term.includes("-"))) {
		for (let index = 0; index < significantTerms.length - 1; index++) {
			const window = significantTerms.slice(index, Math.min(significantTerms.length, index + 3));
			if (
				window.some((term) => HAN_TOKEN_REGEX.test(term)) &&
				window.some((term) => ASCII_BRIDGE_TOKEN_REGEX.test(term) || LOCALE_MARKER_REGEX.test(term) || term.includes("-"))
			) {
				appendSignature(window, ["folder", "aliases", "basename", "headings"]);
			}
		}
	}

	return dedupeStructuredSignatures(signatures);
}

export function buildCoverageLexicalPhraseTerms(
	tokens: readonly string[],
): string[] {
	const out = new Set<string>();
	for (let start = 0; start < tokens.length; start++) {
		for (
			let span = MIN_BRIDGE_SPAN;
			span <= MAX_BRIDGE_SPAN && start + span <= tokens.length;
			span++
		) {
			const windowTokens = tokens.slice(start, start + span).map((token) => token.trim());
			if (!isEligibleBridgeWindow(windowTokens)) {
				continue;
			}
			out.add(buildCanonicalBridgePhrase(windowTokens));
		}
	}
	return Array.from(out);
}

function isEligiblePhraseSignature(
	families: readonly CoverageLexicalFamily[],
): boolean {
	if (families.length < MIN_BRIDGE_SPAN) {
		return false;
	}
	if (families.every((family) => family.strength === "soft")) {
		return false;
	}
	return isEligibleBridgeWindow(
		families.map((family) => family.normalizedTerm),
	);
}

function isEligibleBridgeWindow(tokens: readonly string[]): boolean {
	if (tokens.length < MIN_BRIDGE_SPAN) {
		return false;
	}
	return tokens.every(isBridgeableToken);
}

function isBridgeableToken(token: string): boolean {
	if (!token) {
		return false;
	}
	if (HAN_TOKEN_REGEX.test(token)) {
		return true;
	}
	if (LOCALE_MARKER_REGEX.test(token)) {
		return true;
	}
	return ASCII_BRIDGE_TOKEN_REGEX.test(token) && token.length >= 2;
}

function buildBridgeVariants(tokens: readonly string[]): string[] {
	const normalizedTokens = tokens.map((token) => token.toLowerCase());
	const variants = new Set<string>();
	variants.add(buildCanonicalBridgePhrase(normalizedTokens));
	if (normalizedTokens.every(isAsciiLikeBridgeToken)) {
		variants.add(normalizedTokens.join("-"));
		variants.add(normalizedTokens.join("_"));
		variants.add(normalizedTokens.join("/"));
		variants.add(normalizedTokens.join(""));
	}
	return Array.from(variants);
}

function buildCanonicalBridgePhrase(tokens: readonly string[]): string {
	return tokens.map((token) => token.toLowerCase()).join(" ");
}

function isAsciiLikeBridgeToken(token: string): boolean {
	return ASCII_BRIDGE_TOKEN_REGEX.test(token) || LOCALE_MARKER_REGEX.test(token);
}

function extractRawQueryTerms(queryText: string): string[] {
	const matches = queryText.toLowerCase().normalize("NFKC").match(QUERY_SEGMENT_REGEX) ?? [];
	return matches.filter((term) => term.trim().length > 0);
}

function dedupeStructuredSignatures(
	signatures: readonly CoverageLexicalPhraseSignature[],
): CoverageLexicalPhraseSignature[] {
	const out: CoverageLexicalPhraseSignature[] = [];
	const seen = new Set<string>();
	for (const signature of signatures) {
		const key = `${signature.preferredFields?.join(",") ?? "*"}:${signature.variants.join("|")}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			...signature,
			index: out.length,
		});
	}
	return out;
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}
