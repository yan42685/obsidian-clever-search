import {
	buildAdaptivePostingField,
	createEmptyAdaptivePostingField,
	decodeAdaptivePosting,
	estimateAdaptivePostingBytes,
	type AdaptivePostingCodecProfile,
} from "./adaptive-postings";
import {
	buildSentinelStarts,
	estimateSentinelPostingBytes,
	flattenBuckets,
} from "./integer-arrays";
import {
	buildBlockPositionLane,
	estimateBlockPositionLaneBytes,
} from "./position-lanes";
import type { ResidentHanRouteArena } from "./types";

type HanRouteBuildInput = Readonly<{
	bigramIds: readonly number[];
	metadataDocIdsByBigram: readonly (readonly number[])[];
	bodyPostingsByBigramId: ReadonlyMap<number, readonly number[]>;
	metadataCharIds: readonly number[];
	metadataDocIdsByChar: readonly (readonly number[])[];
	bodyPostingsByCharId: ReadonlyMap<number, readonly number[]>;
	identityWitnessStringIdsByDoc: readonly (readonly number[])[];
	identityWitnessSourceMasksByDoc: readonly (readonly number[])[];
	routeWitnessStringIdsByDoc: readonly (readonly number[])[];
	routeWitnessSourceMasksByDoc: readonly (readonly number[])[];
	headingWitnessStringIdsByDoc: readonly (readonly number[])[];
	bodyWitnessOccurrenceStringIdsByBlock: readonly (readonly number[])[];
	bodyWitnessOccurrenceStartOffsetsByBlock: readonly (readonly number[])[];
}>;

const BODY_HAN_ADAPTIVE_POSTING_CODEC_PROFILE: AdaptivePostingCodecProfile = {
	smallInlineCap: 8,
	enablePairLane: true,
};

export function createEmptyHanRouteArena(): ResidentHanRouteArena {
	return buildHanRouteArena({
		bigramIds: [],
		metadataDocIdsByBigram: [],
		bodyPostingsByBigramId: new Map(),
		metadataCharIds: [],
		metadataDocIdsByChar: [],
		bodyPostingsByCharId: new Map(),
		identityWitnessStringIdsByDoc: [],
		identityWitnessSourceMasksByDoc: [],
		routeWitnessStringIdsByDoc: [],
		routeWitnessSourceMasksByDoc: [],
		headingWitnessStringIdsByDoc: [],
		bodyWitnessOccurrenceStringIdsByBlock: [],
		bodyWitnessOccurrenceStartOffsetsByBlock: [],
	});
}

export function buildHanRouteArena(
	input: HanRouteBuildInput,
): ResidentHanRouteArena {
	const metadataBuckets = buildPostingBuckets(input.metadataDocIdsByBigram);
	const bodyAdaptivePostings = buildAdaptivePostingField(
		input.bodyPostingsByBigramId,
		BODY_HAN_ADAPTIVE_POSTING_CODEC_PROFILE,
	);
	const metadataCharBuckets = buildPostingBuckets(input.metadataDocIdsByChar);
	const bodyCharAdaptivePostings = buildAdaptivePostingField(
		input.bodyPostingsByCharId,
		BODY_HAN_ADAPTIVE_POSTING_CODEC_PROFILE,
	);
	const identityWitnessBuckets = buildPostingBuckets(input.identityWitnessStringIdsByDoc);
	const routeWitnessBuckets = buildPostingBuckets(input.routeWitnessStringIdsByDoc);
	const headingWitnessBuckets = buildPostingBuckets(input.headingWitnessStringIdsByDoc);
	const bodyWitnessBuckets = buildPostingBuckets(
		input.bodyWitnessOccurrenceStringIdsByBlock,
	);
	const identityWitnessSourceMasksByDoc =
		input.identityWitnessSourceMasksByDoc ??
		input.identityWitnessStringIdsByDoc.map(() => []);
	const routeWitnessSourceMasksByDoc =
		input.routeWitnessSourceMasksByDoc ??
		input.routeWitnessStringIdsByDoc.map(() => []);
	const bodyWitnessPositionLane = buildBlockPositionLane(
		input.bodyWitnessOccurrenceStartOffsetsByBlock,
	);
	return {
		bigramIds: Uint32Array.from(input.bigramIds),
		metadataPostingStarts: metadataBuckets.starts,
		metadataDocIds: metadataBuckets.ids,
		bodyAdaptivePostings,
		metadataCharIds: Uint32Array.from(input.metadataCharIds),
		metadataCharPostingStarts: metadataCharBuckets.starts,
		metadataCharDocIds: metadataCharBuckets.ids,
		bodyCharAdaptivePostings,
		identityWitnessStartByDocId: identityWitnessBuckets.starts,
		identityWitnessStringIds: identityWitnessBuckets.ids,
		identityWitnessSourceMaskByDocEntry: Uint8Array.from(
			flattenBuckets(identityWitnessSourceMasksByDoc),
		),
		routeWitnessStartByDocId: routeWitnessBuckets.starts,
		routeWitnessStringIds: routeWitnessBuckets.ids,
		routeWitnessSourceMaskByDocEntry: Uint8Array.from(
			flattenBuckets(routeWitnessSourceMasksByDoc),
		),
		headingWitnessStartByDocId: headingWitnessBuckets.starts,
		headingWitnessStringIds: headingWitnessBuckets.ids,
		bodyWitnessOccurrenceStartByBlockId: bodyWitnessBuckets.starts,
		bodyWitnessOccurrenceStringIds: bodyWitnessBuckets.ids,
		bodyWitnessPositionEncodingByBlockId:
			bodyWitnessPositionLane.positionEncodingByBlockId,
		bodyWitnessPositionStartByBlockId:
			bodyWitnessPositionLane.positionStartByBlockId,
		bodyWitnessPositionDeltaU8Tape:
			bodyWitnessPositionLane.positionDeltaU8Tape,
		bodyWitnessPositionDeltaU16Tape:
			bodyWitnessPositionLane.positionDeltaU16Tape,
		bodyWitnessPositionDeltaU32Tape:
			bodyWitnessPositionLane.positionDeltaU32Tape,
	};
}

export function lookupHanBigramIndex(
	arena: ResidentHanRouteArena,
	bigramId: number,
): number {
	return lookupBigramIndex(arena.bigramIds, bigramId);
}

export function decodeBodyHanPosting(
	arena: ResidentHanRouteArena,
	bigramId: number,
): number[] {
	return decodeAdaptivePosting(arena.bodyAdaptivePostings, bigramId);
}

export function lookupHanCharIndex(
	arena: ResidentHanRouteArena,
	charId: number,
): number {
	return lookupKeyIndex(arena.metadataCharIds, charId);
}

export function decodeBodyHanCharPosting(
	arena: ResidentHanRouteArena,
	charId: number,
): number[] {
	return decodeAdaptivePosting(arena.bodyCharAdaptivePostings, charId);
}

export function estimateHanRouteBytes(arena: ResidentHanRouteArena): number {
	return (
		arena.bigramIds.byteLength +
		estimateSentinelPostingBytes(
			arena.metadataPostingStarts,
			arena.metadataDocIds,
		) +
		estimateAdaptivePostingBytes(arena.bodyAdaptivePostings) +
		arena.metadataCharIds.byteLength +
		estimateSentinelPostingBytes(
			arena.metadataCharPostingStarts,
			arena.metadataCharDocIds,
		) +
		estimateAdaptivePostingBytes(arena.bodyCharAdaptivePostings) +
		estimateSentinelPostingBytes(
			arena.identityWitnessStartByDocId,
			arena.identityWitnessStringIds,
		) +
		arena.identityWitnessSourceMaskByDocEntry.byteLength +
		estimateSentinelPostingBytes(
			arena.routeWitnessStartByDocId,
			arena.routeWitnessStringIds,
		) +
		arena.routeWitnessSourceMaskByDocEntry.byteLength +
		estimateSentinelPostingBytes(
			arena.headingWitnessStartByDocId,
			arena.headingWitnessStringIds,
		) +
		estimateSentinelPostingBytes(
			arena.bodyWitnessOccurrenceStartByBlockId,
			arena.bodyWitnessOccurrenceStringIds,
		) +
		estimateBlockPositionLaneBytes({
			positionEncodingByBlockId: arena.bodyWitnessPositionEncodingByBlockId,
			positionStartByBlockId: arena.bodyWitnessPositionStartByBlockId,
			positionDeltaU8Tape: arena.bodyWitnessPositionDeltaU8Tape,
			positionDeltaU16Tape: arena.bodyWitnessPositionDeltaU16Tape,
			positionDeltaU32Tape: arena.bodyWitnessPositionDeltaU32Tape,
		})
	);
}

export function describeHanRouteByteBreakdown(
	arena: ResidentHanRouteArena,
): Readonly<{
	sharedBigramIdsBytes: number;
	metadataHanPostingsBytes: number;
	metadataHanPostingStartsBytes: number;
	metadataHanDocIdsBytes: number;
	bodyHanPostingsBytes: number;
	bodyBigramIdsBytes: number;
	bodyHanPostingStartsBytes: number;
	bodyHanBodyBlockIdsBytes: number;
	bodyHanSingletonTermIdsBytes: number;
	bodyHanSingletonBodyBlockIdsBytes: number;
	bodyHanPairTermIdsBytes: number;
	bodyHanPairFirstBodyBlockIdsBytes: number;
	bodyHanPairSecondBodyBlockIdsBytes: number;
	bodyHanSmallTermIdsBytes: number;
	bodyHanSmallPostingStartsBytes: number;
	bodyHanSmallBodyBlockIdsBytes: number;
	bodyHanDeltaTermIdsBytes: number;
	bodyHanDeltaTapeStartsBytes: number;
	bodyHanDeltaPostingTapeBytes: number;
	metadataHanCharIdsBytes: number;
	metadataHanCharPostingsBytes: number;
	metadataHanCharPostingStartsBytes: number;
	metadataHanCharDocIdsBytes: number;
	bodyHanCharPostingsBytes: number;
	bodyHanCharIdsBytes: number;
	bodyHanCharPostingStartsBytes: number;
	bodyHanCharBodyBlockIdsBytes: number;
	metadataWitnessBytes: number;
	bodyWitnessBytes: number;
	bodyWitnessPositionBytes: number;
}> {
	const bodyAdaptivePostings = arena.bodyAdaptivePostings;
	const bodyCharAdaptivePostings = arena.bodyCharAdaptivePostings;
	return {
		sharedBigramIdsBytes: arena.bigramIds.byteLength,
		metadataHanPostingsBytes:
			arena.metadataPostingStarts.byteLength +
			arena.metadataDocIds.byteLength,
		metadataHanPostingStartsBytes: arena.metadataPostingStarts.byteLength,
		metadataHanDocIdsBytes: arena.metadataDocIds.byteLength,
		bodyHanPostingsBytes: estimateAdaptivePostingBytes(bodyAdaptivePostings),
		bodyBigramIdsBytes:
			bodyAdaptivePostings.singletonTermIds.byteLength +
			bodyAdaptivePostings.pairTermIds.byteLength +
			bodyAdaptivePostings.smallTermIds.byteLength +
			bodyAdaptivePostings.deltaTermIds.byteLength,
		bodyHanPostingStartsBytes:
			bodyAdaptivePostings.smallValueStarts.byteLength +
			bodyAdaptivePostings.deltaTapeStarts.byteLength,
		bodyHanBodyBlockIdsBytes:
			bodyAdaptivePostings.singletonValueIds.byteLength +
			bodyAdaptivePostings.pairFirstValueIds.byteLength +
			bodyAdaptivePostings.pairSecondValueIds.byteLength +
			bodyAdaptivePostings.smallValueIds.byteLength +
			bodyAdaptivePostings.postingTape.byteLength,
		bodyHanSingletonTermIdsBytes:
			bodyAdaptivePostings.singletonTermIds.byteLength,
		bodyHanSingletonBodyBlockIdsBytes:
			bodyAdaptivePostings.singletonValueIds.byteLength,
		bodyHanPairTermIdsBytes: bodyAdaptivePostings.pairTermIds.byteLength,
		bodyHanPairFirstBodyBlockIdsBytes:
			bodyAdaptivePostings.pairFirstValueIds.byteLength,
		bodyHanPairSecondBodyBlockIdsBytes:
			bodyAdaptivePostings.pairSecondValueIds.byteLength,
		bodyHanSmallTermIdsBytes: bodyAdaptivePostings.smallTermIds.byteLength,
		bodyHanSmallPostingStartsBytes:
			bodyAdaptivePostings.smallValueStarts.byteLength,
		bodyHanSmallBodyBlockIdsBytes:
			bodyAdaptivePostings.smallValueIds.byteLength,
		bodyHanDeltaTermIdsBytes: bodyAdaptivePostings.deltaTermIds.byteLength,
		bodyHanDeltaTapeStartsBytes:
			bodyAdaptivePostings.deltaTapeStarts.byteLength,
		bodyHanDeltaPostingTapeBytes: bodyAdaptivePostings.postingTape.byteLength,
		metadataHanCharIdsBytes: arena.metadataCharIds.byteLength,
		metadataHanCharPostingsBytes:
			arena.metadataCharPostingStarts.byteLength +
			arena.metadataCharDocIds.byteLength,
		metadataHanCharPostingStartsBytes:
			arena.metadataCharPostingStarts.byteLength,
		metadataHanCharDocIdsBytes: arena.metadataCharDocIds.byteLength,
		bodyHanCharPostingsBytes: estimateAdaptivePostingBytes(bodyCharAdaptivePostings),
		bodyHanCharIdsBytes:
			bodyCharAdaptivePostings.singletonTermIds.byteLength +
			bodyCharAdaptivePostings.pairTermIds.byteLength +
			bodyCharAdaptivePostings.smallTermIds.byteLength +
			bodyCharAdaptivePostings.deltaTermIds.byteLength,
		bodyHanCharPostingStartsBytes:
			bodyCharAdaptivePostings.smallValueStarts.byteLength +
			bodyCharAdaptivePostings.deltaTapeStarts.byteLength,
		bodyHanCharBodyBlockIdsBytes:
			bodyCharAdaptivePostings.singletonValueIds.byteLength +
			bodyCharAdaptivePostings.pairFirstValueIds.byteLength +
			bodyCharAdaptivePostings.pairSecondValueIds.byteLength +
			bodyCharAdaptivePostings.smallValueIds.byteLength +
			bodyCharAdaptivePostings.postingTape.byteLength,
		metadataWitnessBytes:
			estimateSentinelPostingBytes(
				arena.identityWitnessStartByDocId,
				arena.identityWitnessStringIds,
			) +
			arena.identityWitnessSourceMaskByDocEntry.byteLength +
			estimateSentinelPostingBytes(
				arena.routeWitnessStartByDocId,
				arena.routeWitnessStringIds,
			) +
			arena.routeWitnessSourceMaskByDocEntry.byteLength +
			estimateSentinelPostingBytes(
				arena.headingWitnessStartByDocId,
				arena.headingWitnessStringIds,
			),
		bodyWitnessBytes: estimateSentinelPostingBytes(
			arena.bodyWitnessOccurrenceStartByBlockId,
			arena.bodyWitnessOccurrenceStringIds,
		),
		bodyWitnessPositionBytes: estimateBlockPositionLaneBytes({
			positionEncodingByBlockId: arena.bodyWitnessPositionEncodingByBlockId,
			positionStartByBlockId: arena.bodyWitnessPositionStartByBlockId,
			positionDeltaU8Tape: arena.bodyWitnessPositionDeltaU8Tape,
			positionDeltaU16Tape: arena.bodyWitnessPositionDeltaU16Tape,
			positionDeltaU32Tape: arena.bodyWitnessPositionDeltaU32Tape,
		}),
	};
}

function buildPostingBuckets(
	postingsByBigram: readonly (readonly number[])[],
): Readonly<{
	starts: ReturnType<typeof buildSentinelStarts>;
	ids: ReturnType<typeof flattenBuckets>;
}> {
	return {
		starts: buildSentinelStarts(postingsByBigram),
		ids: flattenBuckets(postingsByBigram),
	};
}

function lookupKeyIndex(keys: Uint32Array, target: number): number {
	let low = 0;
	let high = keys.length - 1;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const value = keys[mid];
		if (value === target) {
			return mid;
		}
		if (value < target) {
			low = mid + 1;
			continue;
		}
		high = mid - 1;
	}
	return -1;
}

function lookupBigramIndex(bigramIds: Uint32Array, bigramId: number): number {
	return lookupKeyIndex(bigramIds, bigramId);
}
