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
	identityWitnessFamilyIdsByDoc: readonly (readonly number[])[];
	routeWitnessFamilyIdsByDoc: readonly (readonly number[])[];
	headingWitnessFamilyIdsByDoc: readonly (readonly number[])[];
	bodyWitnessFamilyIdsByBlock: readonly (readonly number[])[];
}>;

export function createEmptyHanRouteArena(): ResidentHanRouteArena {
	return buildHanRouteArena({
		bigramIds: [],
		metadataDocIdsByBigram: [],
		bodyBlockIdsByBigram: [],
		identityWitnessFamilyIdsByDoc: [],
		routeWitnessFamilyIdsByDoc: [],
		headingWitnessFamilyIdsByDoc: [],
		bodyWitnessFamilyIdsByBlock: [],
	});
}

export function buildHanRouteArena(
	input: HanRouteBuildInput,
): ResidentHanRouteArena {
	const metadataBuckets = buildPostingBuckets(input.metadataDocIdsByBigram);
	const bodyBuckets = buildPostingBuckets(input.bodyBlockIdsByBigram);
	const identityWitnessBuckets = buildPostingBuckets(input.identityWitnessFamilyIdsByDoc);
	const routeWitnessBuckets = buildPostingBuckets(input.routeWitnessFamilyIdsByDoc);
	const headingWitnessBuckets = buildPostingBuckets(input.headingWitnessFamilyIdsByDoc);
	const bodyWitnessBuckets = buildPostingBuckets(input.bodyWitnessFamilyIdsByBlock);
	return {
		bigramIds: Uint32Array.from(input.bigramIds),
		metadataPostingStarts: metadataBuckets.starts,
		metadataDocIds: metadataBuckets.ids,
		bodyBlockPostingStarts: bodyBuckets.starts,
		bodyBlockIds: bodyBuckets.ids,
		identityWitnessStartByDocId: identityWitnessBuckets.starts,
		identityWitnessFamilyIds: identityWitnessBuckets.ids,
		routeWitnessStartByDocId: routeWitnessBuckets.starts,
		routeWitnessFamilyIds: routeWitnessBuckets.ids,
		headingWitnessStartByDocId: headingWitnessBuckets.starts,
		headingWitnessFamilyIds: headingWitnessBuckets.ids,
		bodyWitnessStartByBlockId: bodyWitnessBuckets.starts,
		bodyWitnessFamilyIds: bodyWitnessBuckets.ids,
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
			arena.bodyBlockPostingStarts,
			arena.bodyBlockIds,
		) +
		estimateSentinelPostingBytes(
			arena.identityWitnessStartByDocId,
			arena.identityWitnessFamilyIds,
		) +
		estimateSentinelPostingBytes(
			arena.routeWitnessStartByDocId,
			arena.routeWitnessFamilyIds,
		) +
		estimateSentinelPostingBytes(
			arena.headingWitnessStartByDocId,
			arena.headingWitnessFamilyIds,
		) +
		estimateSentinelPostingBytes(
			arena.bodyWitnessStartByBlockId,
			arena.bodyWitnessFamilyIds,
		)
	);
}

export function describeHanRouteByteBreakdown(
	arena: ResidentHanRouteArena,
): Readonly<{
	metadataHanPostingsBytes: number;
	bodyHanPostingsBytes: number;
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
			arena.bodyBlockPostingStarts,
			arena.bodyBlockIds,
		),
		metadataWitnessBytes:
			estimateSentinelPostingBytes(
				arena.identityWitnessStartByDocId,
				arena.identityWitnessFamilyIds,
			) +
			estimateSentinelPostingBytes(
				arena.routeWitnessStartByDocId,
				arena.routeWitnessFamilyIds,
			) +
			estimateSentinelPostingBytes(
				arena.headingWitnessStartByDocId,
				arena.headingWitnessFamilyIds,
			),
		bodyWitnessBytes: estimateSentinelPostingBytes(
			arena.bodyWitnessStartByBlockId,
			arena.bodyWitnessFamilyIds,
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
