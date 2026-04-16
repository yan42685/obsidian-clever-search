import {
	FAMILY_SOURCE_MASK_FUZZY_RESCUE_METADATA,
	getFamilySourceMask,
	isFamilyPrefixExpandable,
} from "./family-lexicon";
import type { ResidentFuzzyRescueSidecar } from "./types";

const textEncoder = new TextEncoder();

export const FUZZY_RESCUE_MIN_QUERY_LENGTH = 6;

export function buildResidentFuzzyRescueSidecar(params: Readonly<{
	familyTexts: readonly string[];
	familyFlagsByFamilyId: Uint8Array;
}>): ResidentFuzzyRescueSidecar {
	const candidateMetadataFamilyIdsByDeletionKey = new Map<string, number[]>();
	let indexedMetadataFamilyCount = 0;
	for (let familyId = 0; familyId < params.familyTexts.length; familyId += 1) {
		const familyText = params.familyTexts[familyId] ?? "";
		const flags = params.familyFlagsByFamilyId[familyId] ?? 0;
		if (!isEligibleFuzzyRescueFamily(familyText, flags)) {
			continue;
		}
		indexedMetadataFamilyCount += 1;
		for (const deletionKey of buildFuzzyLookupKeys(familyText)) {
			let familyIds = candidateMetadataFamilyIdsByDeletionKey.get(deletionKey);
			if (familyIds == null) {
				familyIds = [];
				candidateMetadataFamilyIdsByDeletionKey.set(deletionKey, familyIds);
			}
			familyIds.push(familyId);
		}
	}
	const normalizedPostings = new Map<string, Uint32Array>();
	let bytes = 0;
	for (const [deletionKey, familyIds] of candidateMetadataFamilyIdsByDeletionKey.entries()) {
		const posting = Uint32Array.from(familyIds);
		normalizedPostings.set(deletionKey, posting);
		bytes += estimateUtf8Bytes(deletionKey) + posting.byteLength;
	}
	return {
		candidateMetadataFamilyIdsByDeletionKey: normalizedPostings,
		indexedMetadataFamilyCount,
		deletionKeyCount: normalizedPostings.size,
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
