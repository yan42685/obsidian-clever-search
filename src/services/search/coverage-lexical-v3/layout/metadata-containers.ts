import type {
	ResidentMetadataContainerArena,
	ResidentPostingList,
} from "./types";

type MetadataContainersBuildInput = Readonly<{
	familyCount: number;
	identityFamilyIdsByDoc: readonly (readonly number[])[];
	routeFamilyIdsByDoc: readonly (readonly number[])[];
	headingFamilyIdsByDoc: readonly (readonly number[])[];
}>;

export type MetadataContainersBuildOutput = Readonly<{
	arena: ResidentMetadataContainerArena;
	identityStartByDocId: Uint32Array;
	identityCountByDocId: Uint32Array;
	routeStartByDocId: Uint32Array;
	routeCountByDocId: Uint32Array;
	headingStartByDocId: Uint32Array;
	headingCountByDocId: Uint32Array;
}>;

export function buildMetadataContainerArena(
	input: MetadataContainersBuildInput,
): MetadataContainersBuildOutput {
	const identitySummary = flattenDocFamilyIds(input.identityFamilyIdsByDoc);
	const routeSummary = flattenDocFamilyIds(input.routeFamilyIdsByDoc);
	const headingSummary = flattenDocFamilyIds(input.headingFamilyIdsByDoc);
	return {
		arena: {
			identityFamiliesByDoc: identitySummary.values,
			routeFamiliesByDoc: routeSummary.values,
			headingFamiliesByDoc: headingSummary.values,
			identityPostings: buildPostingList(
				input.familyCount,
				input.identityFamilyIdsByDoc,
			),
			routePostings: buildPostingList(
				input.familyCount,
				input.routeFamilyIdsByDoc,
			),
			headingPostings: buildPostingList(
				input.familyCount,
				input.headingFamilyIdsByDoc,
			),
		},
		identityStartByDocId: identitySummary.starts,
		identityCountByDocId: identitySummary.counts,
		routeStartByDocId: routeSummary.starts,
		routeCountByDocId: routeSummary.counts,
		headingStartByDocId: headingSummary.starts,
		headingCountByDocId: headingSummary.counts,
	};
}

export function estimateMetadataContainerBytes(
	arena: ResidentMetadataContainerArena,
): number {
	return (
		arena.identityFamiliesByDoc.byteLength +
		arena.routeFamiliesByDoc.byteLength +
		estimatePostingListBytes(arena.identityPostings) +
		estimatePostingListBytes(arena.routePostings)
	);
}

export function estimateHeadingBytes(
	arena: ResidentMetadataContainerArena,
): number {
	return (
		arena.headingFamiliesByDoc.byteLength +
		estimatePostingListBytes(arena.headingPostings)
	);
}

function flattenDocFamilyIds(
	docFamilyIds: readonly (readonly number[])[],
): Readonly<{
	values: Uint32Array;
	starts: Uint32Array;
	counts: Uint32Array;
}> {
	const values: number[] = [];
	const starts: number[] = [];
	const counts: number[] = [];
	for (const familyIds of docFamilyIds) {
		starts.push(values.length);
		counts.push(familyIds.length);
		for (const familyId of familyIds) {
			values.push(familyId);
		}
	}
	return {
		values: Uint32Array.from(values),
		starts: Uint32Array.from(starts),
		counts: Uint32Array.from(counts),
	};
}

function buildPostingList(
	familyCount: number,
	docFamilyIds: readonly (readonly number[])[],
): ResidentPostingList {
	const buckets = Array.from({ length: familyCount }, () => [] as number[]);
	for (let docId = 0; docId < docFamilyIds.length; docId += 1) {
		for (const familyId of docFamilyIds[docId]) {
			buckets[familyId]?.push(docId);
		}
	}
	const postingStarts: number[] = [];
	const postingCounts: number[] = [];
	const docIds: number[] = [];
	for (const bucket of buckets) {
		postingStarts.push(docIds.length);
		postingCounts.push(bucket.length);
		for (const docId of bucket) {
			docIds.push(docId);
		}
	}
	return {
		postingStarts: Uint32Array.from(postingStarts),
		postingCounts: Uint32Array.from(postingCounts),
		docIds: Uint32Array.from(docIds),
	};
}

function estimatePostingListBytes(postings: ResidentPostingList): number {
	return (
		postings.postingStarts.byteLength +
		postings.postingCounts.byteLength +
		postings.docIds.byteLength
	);
}
