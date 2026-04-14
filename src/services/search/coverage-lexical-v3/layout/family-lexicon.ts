import type {
	ResidentFamilyKind,
	ResidentFamilyLexicon,
} from "./types";

type FamilyBuildInput = Readonly<{
	text: string;
	stringId: number;
	sourceMask: number;
}>;

const HAN_REGEX = /\p{Script=Han}/u;
const LATIN_REGEX = /[a-z0-9]/u;

export function buildFamilyLexicon(
	families: readonly FamilyBuildInput[],
): ResidentFamilyLexicon {
	return {
		familyCount: families.length,
		familyStringIds: Uint32Array.from(families.map((family) => family.stringId)),
		firstCodePointByFamilyId: Uint32Array.from(
			families.map((family) => family.text.codePointAt(0) ?? 0),
		),
		kindCodeByFamilyId: Uint8Array.from(
			families.map((family) => encodeFamilyKind(classifyFamilyKind(family.text))),
		),
		prefixExpandableByFamilyId: Uint8Array.from(
			families.map((family) => (canUsePrefixExpansion(family.text) ? 1 : 0)),
		),
		sourceMaskByFamilyId: Uint8Array.from(
			families.map((family) => family.sourceMask & 0xff),
		),
	};
}

export function estimateFamilyLexiconBytes(
	lexicon: ResidentFamilyLexicon,
): number {
	return (
		lexicon.familyStringIds.byteLength +
		lexicon.firstCodePointByFamilyId.byteLength +
		lexicon.kindCodeByFamilyId.byteLength +
		lexicon.prefixExpandableByFamilyId.byteLength +
		lexicon.sourceMaskByFamilyId.byteLength
	);
}

export function classifyFamilyKind(text: string): ResidentFamilyKind {
	const hasHan = HAN_REGEX.test(text);
	const hasLatin = LATIN_REGEX.test(text);
	if (hasHan && hasLatin) {
		return "mixed";
	}
	if (hasHan) {
		return "han";
	}
	if (hasLatin) {
		return "latin";
	}
	return "other";
}

function canUsePrefixExpansion(text: string): boolean {
	return /^[a-z0-9][a-z0-9._/-]{2,}$/u.test(text);
}

function encodeFamilyKind(kind: ResidentFamilyKind): number {
	switch (kind) {
		case "latin":
			return 1;
		case "han":
			return 2;
		case "mixed":
			return 3;
		default:
			return 0;
	}
}
