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
import type { ResidentHanRouteArena } from "./types";

type HanRouteBuildInput = Readonly<{
	bigramIds: readonly number[];
	metadataDocIdsByBigram: readonly (readonly number[])[];
	bodyPostingsByBigramId: ReadonlyMap<number, readonly number[]>;
	identityWitnessStringIdsByDoc: readonly (readonly number[])[];
	routeWitnessStringIdsByDoc: readonly (readonly number[])[];
	headingWitnessStringIdsByDoc: readonly (readonly number[])[];
	bodyWitnessStringIdsByBlock: readonly (readonly number[])[];
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
		identityWitnessStringIdsByDoc: [],
		routeWitnessStringIdsByDoc: [],
		headingWitnessStringIdsByDoc: [],
		bodyWitnessStringIdsByBlock: [],
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
	const identityWitnessBuckets = buildPostingBuckets(input.identityWitnessStringIdsByDoc);
	const routeWitnessBuckets = buildPostingBuckets(input.routeWitnessStringIdsByDoc);
	const headingWitnessBuckets = buildPostingBuckets(input.headingWitnessStringIdsByDoc);
	const bodyWitnessBuckets = buildPostingBuckets(input.bodyWitnessStringIdsByBlock);
	return {
		bigramIds: Uint32Array.from(input.bigramIds),
		metadataPostingStarts: metadataBuckets.starts,
		metadataDocIds: metadataBuckets.ids,
		bodyAdaptivePostings,
		identityWitnessStartByDocId: identityWitnessBuckets.starts,
		identityWitnessStringIds: identityWitnessBuckets.ids,
		routeWitnessStartByDocId: routeWitnessBuckets.starts,
		routeWitnessStringIds: routeWitnessBuckets.ids,
		headingWitnessStartByDocId: headingWitnessBuckets.starts,
		headingWitnessStringIds: headingWitnessBuckets.ids,
		bodyWitnessStartByBlockId: bodyWitnessBuckets.starts,
		bodyWitnessStringIds: bodyWitnessBuckets.ids,
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

export function estimateHanRouteBytes(arena: ResidentHanRouteArena): number {
	return (
		arena.bigramIds.byteLength +
		estimateSentinelPostingBytes(
			arena.metadataPostingStarts,
			arena.metadataDocIds,
		) +
		estimateAdaptivePostingBytes(arena.bodyAdaptivePostings) +
		estimateSentinelPostingBytes(
			arena.identityWitnessStartByDocId,
			arena.identityWitnessStringIds,
		) +
		estimateSentinelPostingBytes(
			arena.routeWitnessStartByDocId,
			arena.routeWitnessStringIds,
		) +
		estimateSentinelPostingBytes(
			arena.headingWitnessStartByDocId,
			arena.headingWitnessStringIds,
		) +
		estimateSentinelPostingBytes(
			arena.bodyWitnessStartByBlockId,
			arena.bodyWitnessStringIds,
		)
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
	metadataWitnessBytes: number;
	bodyWitnessBytes: number;
}> {
	const bodyAdaptivePostings = arena.bodyAdaptivePostings;
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
		metadataWitnessBytes:
			estimateSentinelPostingBytes(
				arena.identityWitnessStartByDocId,
				arena.identityWitnessStringIds,
			) +
			estimateSentinelPostingBytes(
				arena.routeWitnessStartByDocId,
				arena.routeWitnessStringIds,
			) +
			estimateSentinelPostingBytes(
				arena.headingWitnessStartByDocId,
				arena.headingWitnessStringIds,
			),
		bodyWitnessBytes: estimateSentinelPostingBytes(
			arena.bodyWitnessStartByBlockId,
			arena.bodyWitnessStringIds,
		),
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

function lookupBigramIndex(bigramIds: Uint32Array, bigramId: number): number {
	let low = 0;
	let high = bigramIds.length - 1;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const value = bigramIds[mid];
		if (value === bigramId) {
			return mid;
		}
		if (value < bigramId) {
			low = mid + 1;
			continue;
		}
		high = mid - 1;
	}
	return -1;
}
