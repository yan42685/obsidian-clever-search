import type {
	CoverageLexicalFamily,
	CoverageLexicalPairSignature,
} from "./coverage-lexical-types";

const ASCII_TERM_REGEX = /^[a-z0-9]+$/u;
const LOCALE_MARKER_REGEX = /^(?:zh|cn|en|jp|ja|ko)$/u;

export function buildCoverageLexicalPairSignatures(
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalPairSignature[] {
	const signatures: CoverageLexicalPairSignature[] = [];
	const hasNonAsciiFamily = families.some(
		(family) => !ASCII_TERM_REGEX.test(family.normalizedTerm),
	);
	for (let index = 1; index < families.length; index++) {
		const left = families[index - 1];
		const right = families[index];
		if (!isEligiblePairSignature(left, right)) {
			continue;
		}
		const variants = buildPairVariants(
			left.normalizedTerm,
			right.normalizedTerm,
		);
		if (variants.length === 0) {
			continue;
		}
		signatures.push({
			leftFamilyIndex: left.index,
			rightFamilyIndex: right.index,
			variants,
			tailWeight: computePairTailWeight(left.index, right.index),
			allowCandidateRecall:
				hasNonAsciiFamily ||
				left.isMetadataCapable ||
				right.isMetadataCapable ||
				LOCALE_MARKER_REGEX.test(left.normalizedTerm) ||
				LOCALE_MARKER_REGEX.test(right.normalizedTerm),
		});
	}
	return signatures;
}

function isEligiblePairSignature(
	left: CoverageLexicalFamily,
	right: CoverageLexicalFamily,
): boolean {
	if (
		left.role === "noise" ||
		right.role === "noise" ||
		(left.strength === "soft" && right.strength === "soft")
	) {
		return false;
	}
	return (
		isAsciiPairTerm(left.normalizedTerm) && isAsciiPairTerm(right.normalizedTerm)
	);
}

function isAsciiPairTerm(term: string): boolean {
	if (LOCALE_MARKER_REGEX.test(term)) {
		return true;
	}
	return ASCII_TERM_REGEX.test(term) && term.length >= 3;
}

function buildPairVariants(left: string, right: string): string[] {
	const variants = new Set<string>();
	variants.add(`${left}-${right}`);
	variants.add(`${left}_${right}`);
	variants.add(`${left}/${right}`);
	variants.add(`${left}${right}`);
	return Array.from(variants);
}

function computePairTailWeight(leftIndex: number, rightIndex: number): number {
	const leftPosition = leftIndex + 1;
	const rightPosition = rightIndex + 1;
	return leftPosition * leftPosition + rightPosition * rightPosition;
}
