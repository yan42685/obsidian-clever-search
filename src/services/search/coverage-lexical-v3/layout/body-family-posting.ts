import {
	buildAdaptivePostingField,
	createEmptyAdaptivePostingField,
	decodeAdaptivePosting,
	estimateAdaptivePostingBytes,
	type AdaptivePostingCodecProfile,
} from "./adaptive-postings";
import type { ResidentBodyFamilyPostingField } from "./types";

type BodyFamilyPostingBuildInput = Readonly<{
	familyIdsByBlock: readonly (readonly number[])[];
}>;

const BODY_FAMILY_POSTING_CODEC_PROFILE: AdaptivePostingCodecProfile = {
	smallInlineCap: 8,
	enablePairLane: true,
};

export function buildBodyFamilyPostingField(
	input: BodyFamilyPostingBuildInput,
): ResidentBodyFamilyPostingField {
	const blocksByFamilyId = new Map<number, number[]>();
	for (let blockId = 0; blockId < input.familyIdsByBlock.length; blockId += 1) {
		for (const familyId of input.familyIdsByBlock[blockId] ?? []) {
			let blockIds = blocksByFamilyId.get(familyId);
			if (blockIds == null) {
				blockIds = [];
				blocksByFamilyId.set(familyId, blockIds);
			}
			blockIds.push(blockId);
		}
	}
	if (blocksByFamilyId.size === 0) {
		return createEmptyAdaptivePostingField();
	}
	return buildAdaptivePostingField(
		blocksByFamilyId,
		BODY_FAMILY_POSTING_CODEC_PROFILE,
	);
}

export function estimateBodyFamilyPostingBytes(
	arena: ResidentBodyFamilyPostingField,
): number {
	return estimateAdaptivePostingBytes(arena);
}

export function describeBodyFamilyPostingByteBreakdown(
	arena: ResidentBodyFamilyPostingField,
): Readonly<{
	termIdsBytes: number;
	postingStartsBytes: number;
	blockIdsBytes: number;
	singletonTermIdsBytes: number;
	singletonBlockIdsBytes: number;
	pairTermIdsBytes: number;
	pairFirstBlockIdsBytes: number;
	pairSecondBlockIdsBytes: number;
	smallTermIdsBytes: number;
	smallPostingStartsBytes: number;
	smallBlockIdsBytes: number;
	deltaTermIdsBytes: number;
	deltaTapeStartsBytes: number;
	deltaPostingTapeBytes: number;
}> {
	return {
		termIdsBytes:
			arena.singletonTermIds.byteLength +
			arena.pairTermIds.byteLength +
			arena.smallTermIds.byteLength +
			arena.deltaTermIds.byteLength,
		postingStartsBytes:
			arena.smallValueStarts.byteLength +
			arena.deltaTapeStarts.byteLength,
		blockIdsBytes:
			arena.singletonValueIds.byteLength +
			arena.pairFirstValueIds.byteLength +
			arena.pairSecondValueIds.byteLength +
			arena.smallValueIds.byteLength +
			arena.postingTape.byteLength,
		singletonTermIdsBytes: arena.singletonTermIds.byteLength,
		singletonBlockIdsBytes: arena.singletonValueIds.byteLength,
		pairTermIdsBytes: arena.pairTermIds.byteLength,
		pairFirstBlockIdsBytes: arena.pairFirstValueIds.byteLength,
		pairSecondBlockIdsBytes: arena.pairSecondValueIds.byteLength,
		smallTermIdsBytes: arena.smallTermIds.byteLength,
		smallPostingStartsBytes: arena.smallValueStarts.byteLength,
		smallBlockIdsBytes: arena.smallValueIds.byteLength,
		deltaTermIdsBytes: arena.deltaTermIds.byteLength,
		deltaTapeStartsBytes: arena.deltaTapeStarts.byteLength,
		deltaPostingTapeBytes: arena.postingTape.byteLength,
	};
}

export function collectBodyFamilyPostingBlockIdsForFamily(
	arena: ResidentBodyFamilyPostingField,
	familyId: number,
): number[] {
	return decodeAdaptivePosting(arena, familyId);
}
