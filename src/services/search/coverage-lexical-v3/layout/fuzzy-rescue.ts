import {
	FAMILY_SOURCE_MASK_FUZZY_RESCUE_METADATA,
	getFamilySourceMask,
	isFamilyPrefixExpandable,
} from "./family-lexicon";
import type { ResidentFuzzyRescueSidecar } from "./types";

const textEncoder = new TextEncoder();

export const FUZZY_RESCUE_MIN_QUERY_LENGTH = 6;

export const EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR: ResidentFuzzyRescueSidecar = {
	candidateMetadataFamilyIdsByFuzzyLookupKey: new Map(),
	indexedMetadataFamilyCount: 0,
	fuzzyLookupKeyCount: 0,
	bytes: 0,
};

export function buildResidentFuzzyRescueSidecar(params: Readonly<{
	familyTexts: readonly string[];
	familyFlagsByFamilyId: Uint8Array;
}>): ResidentFuzzyRescueSidecar {
	const candidateMetadataFamilyIdsByFuzzyLookupKey = new Map<string, number[]>();
	let indexedMetadataFamilyCount = 0;
	for (let familyId = 0; familyId < params.familyTexts.length; familyId += 1) {
		const familyText = params.familyTexts[familyId] ?? "";
		const flags = params.familyFlagsByFamilyId[familyId] ?? 0;
		if (!isEligibleFuzzyRescueFamily(familyText, flags)) {
			continue;
		}
		indexedMetadataFamilyCount += 1;
		for (const fuzzyLookupKey of buildFuzzyLookupKeys(familyText)) {
			let familyIds =
				candidateMetadataFamilyIdsByFuzzyLookupKey.get(fuzzyLookupKey);
			if (familyIds == null) {
				familyIds = [];
				candidateMetadataFamilyIdsByFuzzyLookupKey.set(
					fuzzyLookupKey,
					familyIds,
				);
			}
			familyIds.push(familyId);
		}
	}
	const normalizedPostings = new Map<string, Uint32Array>();
	let bytes = 0;
	for (const [fuzzyLookupKey, familyIds] of candidateMetadataFamilyIdsByFuzzyLookupKey.entries()) {
		const posting = Uint32Array.from(familyIds);
		normalizedPostings.set(fuzzyLookupKey, posting);
		bytes += estimateUtf8Bytes(fuzzyLookupKey) + posting.byteLength;
	}
	return {
		candidateMetadataFamilyIdsByFuzzyLookupKey: normalizedPostings,
		indexedMetadataFamilyCount,
		fuzzyLookupKeyCount: normalizedPostings.size,
		bytes,
	};
}

export function buildFuzzyLookupKeys(text: string): string[] {
	if (text.length === 0) {
		return [];
	}
	const keys = new Set<string>([text]);
	for (let index = 0; index < text.length; index += 1) {
		keys.add(text.slice(0, index) + text.slice(index + 1));
	}
	return [...keys];
}

function isEligibleFuzzyRescueFamily(text: string, flags: number): boolean {
	const sourceMask = getFamilySourceMask(flags);
	return (
		text.length >= FUZZY_RESCUE_MIN_QUERY_LENGTH &&
		(sourceMask & FAMILY_SOURCE_MASK_FUZZY_RESCUE_METADATA) !== 0 &&
		isFamilyPrefixExpandable(flags)
	);
}

function estimateUtf8Bytes(text: string): number {
	return textEncoder.encode(text).byteLength;
}
