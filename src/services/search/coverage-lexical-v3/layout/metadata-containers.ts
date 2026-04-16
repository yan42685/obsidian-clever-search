import {
	buildIntegerArray,
	buildSentinelStarts,
	estimateSentinelPostingBytes,
	flattenBuckets,
} from "./integer-arrays";
import type {
	ResidentMetadataContainerArena,
	ResidentPostingList,
} from "./types";

type MetadataContainersBuildInput = Readonly<{
	familyCount: number;
	identityFamilyIdsByDoc: readonly (readonly number[])[];
	identitySourceMasksByDoc: readonly (readonly number[])[];
	routeFamilyIdsByDoc: readonly (readonly number[])[];
	routeSourceMasksByDoc: readonly (readonly number[])[];
	headingFamilyIdsByDoc: readonly (readonly number[])[];
}>;

export type MetadataContainersBuildOutput = Readonly<{
	arena: ResidentMetadataContainerArena;
	identityStartByDocId: ReturnType<typeof buildIntegerArray>;
	identityCountByDocId: ReturnType<typeof buildIntegerArray>;
	routeStartByDocId: ReturnType<typeof buildIntegerArray>;
	routeCountByDocId: ReturnType<typeof buildIntegerArray>;
	headingStartByDocId: ReturnType<typeof buildIntegerArray>;
	headingCountByDocId: ReturnType<typeof buildIntegerArray>;
}>;

export function buildMetadataContainerArena(
	input: MetadataContainersBuildInput,
): MetadataContainersBuildOutput {
	const identitySummary = flattenDocFamilyEntries(
		input.identityFamilyIdsByDoc,
		input.identitySourceMasksByDoc,
	);
	const routeSummary = flattenDocFamilyEntries(
		input.routeFamilyIdsByDoc,
		input.routeSourceMasksByDoc,
	);
	const headingSummary = flattenDocFamilyIds(input.headingFamilyIdsByDoc);
	return {
		arena: {
			identityFamiliesByDoc: identitySummary.values,
			identitySourceMaskByDocEntry: identitySummary.sourceMasks,
			routeFamiliesByDoc: routeSummary.values,
			routeSourceMaskByDocEntry: routeSummary.sourceMasks,
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
		arena.identitySourceMaskByDocEntry.byteLength +
		arena.routeFamiliesByDoc.byteLength +
		arena.routeSourceMaskByDocEntry.byteLength +
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
	values: ReturnType<typeof buildIntegerArray>;
	starts: ReturnType<typeof buildIntegerArray>;
	counts: ReturnType<typeof buildIntegerArray>;
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
		values: buildIntegerArray(values),
		starts: buildIntegerArray(starts),
		counts: buildIntegerArray(counts),
	};
}

function flattenDocFamilyEntries(
	docFamilyIds: readonly (readonly number[])[],
	docSourceMasks: readonly (readonly number[])[],
): Readonly<{
	values: ReturnType<typeof buildIntegerArray>;
	sourceMasks: Uint8Array;
	starts: ReturnType<typeof buildIntegerArray>;
	counts: ReturnType<typeof buildIntegerArray>;
}> {
	const values: number[] = [];
	const sourceMasks: number[] = [];
	const starts: number[] = [];
	const counts: number[] = [];
	for (let docId = 0; docId < docFamilyIds.length; docId += 1) {
		const familyIds = docFamilyIds[docId] ?? [];
		const masks = docSourceMasks[docId] ?? [];
		if (familyIds.length !== masks.length) {
			throw new Error(
				`metadata source mask length mismatch for doc ${docId}: ${familyIds.length} families vs ${masks.length} masks`,
			);
		}
		starts.push(values.length);
		counts.push(familyIds.length);
		for (let index = 0; index < familyIds.length; index += 1) {
			values.push(familyIds[index]);
			sourceMasks.push(masks[index] ?? 0);
		}
	}
	return {
		values: buildIntegerArray(values),
		sourceMasks: Uint8Array.from(sourceMasks),
		starts: buildIntegerArray(starts),
		counts: buildIntegerArray(counts),
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
	return {
		postingStarts: buildSentinelStarts(buckets),
		docIds: flattenBuckets(buckets),
	};
}

function estimatePostingListBytes(postings: ResidentPostingList): number {
	return estimateSentinelPostingBytes(postings.postingStarts, postings.docIds);
}
