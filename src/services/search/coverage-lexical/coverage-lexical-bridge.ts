import type {
	CoverageLexicalFamily,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";

const ASCII_BRIDGE_TOKEN_REGEX = /^[a-z0-9]+$/u;
const HAN_TOKEN_REGEX = /\p{Script=Han}/u;
const LOCALE_MARKER_REGEX = /^(?:zh|cn|en|jp|ja|ko)$/u;
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
			});
		}
	}
	return signatures;
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
			for (const variant of buildBridgeVariants(windowTokens)) {
				out.add(variant);
			}
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
	variants.add(normalizedTokens.join(" "));
	if (normalizedTokens.every(isAsciiLikeBridgeToken)) {
		variants.add(normalizedTokens.join("-"));
		variants.add(normalizedTokens.join("_"));
		variants.add(normalizedTokens.join("/"));
		variants.add(normalizedTokens.join(""));
	}
	return Array.from(variants);
}

function isAsciiLikeBridgeToken(token: string): boolean {
	return ASCII_BRIDGE_TOKEN_REGEX.test(token) || LOCALE_MARKER_REGEX.test(token);
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}
