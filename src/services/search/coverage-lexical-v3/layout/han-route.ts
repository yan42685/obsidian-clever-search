import type { ResidentHanRouteArena } from "./types";

type HanRouteBuildInput = Readonly<{
	bigramIds: readonly number[];
	metadataIdentityDocIdsByBigram: readonly (readonly number[])[];
	metadataRouteDocIdsByBigram: readonly (readonly number[])[];
	metadataHeadingDocIdsByBigram: readonly (readonly number[])[];
	bodyBlockIdsByBigram: readonly (readonly number[])[];
	identityWitnessFamilyIdsByDoc: readonly (readonly number[])[];
	routeWitnessFamilyIdsByDoc: readonly (readonly number[])[];
	headingWitnessFamilyIdsByDoc: readonly (readonly number[])[];
	bodyWitnessFamilyIdsByBlock: readonly (readonly number[])[];
}>;

export function createEmptyHanRouteArena(): ResidentHanRouteArena {
	return buildHanRouteArena({
		bigramIds: [],
		metadataIdentityDocIdsByBigram: [],
		metadataRouteDocIdsByBigram: [],
		metadataHeadingDocIdsByBigram: [],
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
	const identityBuckets = buildPostingBuckets(input.metadataIdentityDocIdsByBigram);
	const routeBuckets = buildPostingBuckets(input.metadataRouteDocIdsByBigram);
	const headingBuckets = buildPostingBuckets(input.metadataHeadingDocIdsByBigram);
	const bodyBuckets = buildPostingBuckets(input.bodyBlockIdsByBigram);
	const identityWitnessBuckets = buildPostingBuckets(input.identityWitnessFamilyIdsByDoc);
	const routeWitnessBuckets = buildPostingBuckets(input.routeWitnessFamilyIdsByDoc);
	const headingWitnessBuckets = buildPostingBuckets(input.headingWitnessFamilyIdsByDoc);
	const bodyWitnessBuckets = buildPostingBuckets(input.bodyWitnessFamilyIdsByBlock);
	return {
		bigramIds: Uint32Array.from(input.bigramIds),
		metadataIdentityPostingStarts: identityBuckets.starts,
		metadataIdentityPostingCounts: identityBuckets.counts,
		metadataIdentityDocIds: identityBuckets.ids,
		metadataRoutePostingStarts: routeBuckets.starts,
		metadataRoutePostingCounts: routeBuckets.counts,
		metadataRouteDocIds: routeBuckets.ids,
		metadataHeadingPostingStarts: headingBuckets.starts,
		metadataHeadingPostingCounts: headingBuckets.counts,
		metadataHeadingDocIds: headingBuckets.ids,
		bodyBlockPostingStarts: bodyBuckets.starts,
		bodyBlockPostingCounts: bodyBuckets.counts,
		bodyBlockIds: bodyBuckets.ids,
		identityWitnessStartByDocId: identityWitnessBuckets.starts,
		identityWitnessCountByDocId: identityWitnessBuckets.counts,
		identityWitnessFamilyIds: identityWitnessBuckets.ids,
		routeWitnessStartByDocId: routeWitnessBuckets.starts,
		routeWitnessCountByDocId: routeWitnessBuckets.counts,
		routeWitnessFamilyIds: routeWitnessBuckets.ids,
		headingWitnessStartByDocId: headingWitnessBuckets.starts,
		headingWitnessCountByDocId: headingWitnessBuckets.counts,
		headingWitnessFamilyIds: headingWitnessBuckets.ids,
		bodyWitnessStartByBlockId: bodyWitnessBuckets.starts,
		bodyWitnessCountByBlockId: bodyWitnessBuckets.counts,
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
		arena.metadataIdentityPostingStarts.byteLength +
		arena.metadataIdentityPostingCounts.byteLength +
		arena.metadataIdentityDocIds.byteLength +
		arena.metadataRoutePostingStarts.byteLength +
		arena.metadataRoutePostingCounts.byteLength +
		arena.metadataRouteDocIds.byteLength +
		arena.metadataHeadingPostingStarts.byteLength +
		arena.metadataHeadingPostingCounts.byteLength +
		arena.metadataHeadingDocIds.byteLength +
		arena.bodyBlockPostingStarts.byteLength +
		arena.bodyBlockPostingCounts.byteLength +
		arena.bodyBlockIds.byteLength +
		arena.identityWitnessStartByDocId.byteLength +
		arena.identityWitnessCountByDocId.byteLength +
		arena.identityWitnessFamilyIds.byteLength +
		arena.routeWitnessStartByDocId.byteLength +
		arena.routeWitnessCountByDocId.byteLength +
		arena.routeWitnessFamilyIds.byteLength +
		arena.headingWitnessStartByDocId.byteLength +
		arena.headingWitnessCountByDocId.byteLength +
		arena.headingWitnessFamilyIds.byteLength +
		arena.bodyWitnessStartByBlockId.byteLength +
		arena.bodyWitnessCountByBlockId.byteLength +
		arena.bodyWitnessFamilyIds.byteLength
	);
}

function buildPostingBuckets(
	postingsByBigram: readonly (readonly number[])[],
): Readonly<{
	starts: Uint32Array;
	counts: Uint32Array;
	ids: Uint32Array;
}> {
	const starts: number[] = [];
	const counts: number[] = [];
	const ids: number[] = [];
	for (const bucket of postingsByBigram) {
		starts.push(ids.length);
		counts.push(bucket.length);
		for (const value of bucket) {
			ids.push(value);
		}
	}
	return {
		starts: Uint32Array.from(starts),
		counts: Uint32Array.from(counts),
		ids: Uint32Array.from(ids),
	};
}
