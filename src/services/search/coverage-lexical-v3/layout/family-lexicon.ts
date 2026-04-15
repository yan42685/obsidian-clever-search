import type { ResidentFamilyLexicon } from "./types";

type FamilyBuildInput = Readonly<{
	text: string;
	stringId: number;
	sourceMask: number;
}>;

export function buildFamilyLexicon(
	families: readonly FamilyBuildInput[],
): ResidentFamilyLexicon {
	return {
		familyCount: families.length,
		familyStringIds: Uint32Array.from(families.map((family) => family.stringId)),
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
		lexicon.prefixExpandableByFamilyId.byteLength +
		lexicon.sourceMaskByFamilyId.byteLength
	);
}

function canUsePrefixExpansion(text: string): boolean {
	return /^[a-z0-9][a-z0-9._/-]{2,}$/u.test(text);
}

