import { buildIntegerArray } from "./integer-arrays";
import type { ResidentFamilyLexicon } from "./types";

const PREFIX_EXPANDABLE_FLAG = 1 << 0;
const SOURCE_MASK_SHIFT = 1;

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
		familyStringIds: buildIntegerArray(families.map((family) => family.stringId)),
		familyFlagsByFamilyId: Uint8Array.from(
			families.map((family) => packFamilyFlags(family.text, family.sourceMask)),
		),
	};
}

export function estimateFamilyLexiconBytes(
	lexicon: ResidentFamilyLexicon,
): number {
	return (
		lexicon.familyStringIds.byteLength +
		lexicon.familyFlagsByFamilyId.byteLength
	);
}

export function isFamilyPrefixExpandable(flags: number): boolean {
	return (flags & PREFIX_EXPANDABLE_FLAG) !== 0;
}

export function getFamilySourceMask(flags: number): number {
	return (flags >> SOURCE_MASK_SHIFT) & 0x7f;
}

function canUsePrefixExpansion(text: string): boolean {
	return /^[a-z0-9][a-z0-9._/-]{2,}$/u.test(text);
}

function packFamilyFlags(text: string, sourceMask: number): number {
	const prefixExpandable = canUsePrefixExpansion(text) ? PREFIX_EXPANDABLE_FLAG : 0;
	return prefixExpandable | ((sourceMask & 0x7f) << SOURCE_MASK_SHIFT);
}
