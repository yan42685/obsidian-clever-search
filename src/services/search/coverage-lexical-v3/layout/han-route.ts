import {
	buildIntegerArray,
	buildSentinelStarts,
	estimateSentinelPostingBytes,
	flattenBuckets,
} from "./integer-arrays";
import type { ResidentHanRouteArena } from "./types";

type HanRouteBuildInput = Readonly<{
	bigramIds: readonly number[];
	metadataDocIdsByBigram: readonly (readonly number[])[];
	bodyBlockIdsByBigram: readonly (readonly number[])[];
	identityWitnessStringIdsByDoc: readonly (readonly number[])[];
	routeWitnessStringIdsByDoc: readonly (readonly number[])[];
	headingWitnessStringIdsByDoc: readonly (readonly number[])[];
	bodyWitnessStringIdsByBlock: readonly (readonly number[])[];
}>;

export function createEmptyHanRouteArena(): ResidentHanRouteArena {
	return buildHanRouteArena({
		bigramIds: [],
		metadataDocIdsByBigram: [],
		bodyBlockIdsByBigram: [],
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
	const bodyBuckets = buildPostingBuckets(input.bodyBlockIdsByBigram);
	const identityWitnessBuckets = buildPostingBuckets(input.identityWitnessStringIdsByDoc);
	const routeWitnessBuckets = buildPostingBuckets(input.routeWitnessStringIdsByDoc);
	const headingWitnessBuckets = buildPostingBuckets(input.headingWitnessStringIdsByDoc);
	const bodyWitnessBuckets = buildPostingBuckets(input.bodyWitnessStringIdsByBlock);
	return {
		bigramIds: Uint32Array.from(input.bigramIds),
		metadataPostingStarts: metadataBuckets.starts,
		metadataDocIds: metadataBuckets.ids,
		bodyPostingStarts: bodyBuckets.starts,
		bodyBlockIds: bodyBuckets.ids,
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
	let low = 0;
	let high = arena.bigramIds.length - 1;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const value = arena.bigramIds[mid];
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

export function estimateHanRouteBytes(arena: ResidentHanRouteArena): number {
	return (
		arena.bigramIds.byteLength +
		estimateSentinelPostingBytes(
			arena.metadataPostingStarts,
			arena.metadataDocIds,
		) +
		estimateSentinelPostingBytes(
			arena.bodyPostingStarts,
			arena.bodyBlockIds,
		) +
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
	metadataHanPostingsBytes: number;
	bodyHanPostingsBytes: number;
	bodyHanPostingStartsBytes: number;
	bodyHanBodyBlockIdsBytes: number;
	metadataWitnessBytes: number;
	bodyWitnessBytes: number;
}> {
	return {
		metadataHanPostingsBytes:
			arena.bigramIds.byteLength +
			estimateSentinelPostingBytes(
				arena.metadataPostingStarts,
				arena.metadataDocIds,
			),
		bodyHanPostingsBytes: estimateSentinelPostingBytes(
			arena.bodyPostingStarts,
			arena.bodyBlockIds,
		),
		bodyHanPostingStartsBytes: arena.bodyPostingStarts.byteLength,
		bodyHanBodyBlockIdsBytes: arena.bodyBlockIds.byteLength,
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
	starts: ReturnType<typeof buildIntegerArray>;
	ids: ReturnType<typeof buildIntegerArray>;
}> {
	return {
		starts: buildSentinelStarts(postingsByBigram),
		ids: flattenBuckets(postingsByBigram),
	};
}