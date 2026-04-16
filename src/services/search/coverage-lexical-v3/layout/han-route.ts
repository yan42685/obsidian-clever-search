import {
	buildIntegerArray,
	buildSentinelStarts,
	estimateSentinelPostingBytes,
	flattenBuckets,
	type ResidentIntegerArray,
} from "./integer-arrays";
import type { ResidentAdaptivePostingField, ResidentHanRouteArena } from "./types";

type HanRouteBuildInput = Readonly<{
	bigramIds: readonly number[];
	metadataDocIdsByBigram: readonly (readonly number[])[];
	bodyPostingsByBigramId: ReadonlyMap<number, readonly number[]>;
	identityWitnessStringIdsByDoc: readonly (readonly number[])[];
	routeWitnessStringIdsByDoc: readonly (readonly number[])[];
	headingWitnessStringIdsByDoc: readonly (readonly number[])[];
	bodyWitnessStringIdsByBlock: readonly (readonly number[])[];
}>;

type AdaptivePostingCodecProfile = Readonly<{
	smallInlineCap: number;
	enablePairLane: boolean;
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

export function createEmptyAdaptivePostingField(): ResidentAdaptivePostingField {
	return {
		singletonTermIds: buildIntegerArray([]),
		singletonValueIds: buildIntegerArray([]),
		pairTermIds: buildIntegerArray([]),
		pairFirstValueIds: buildIntegerArray([]),
		pairSecondValueIds: buildIntegerArray([]),
		smallTermIds: buildIntegerArray([]),
		smallValueStarts: buildIntegerArray([]),
		smallValueIds: buildIntegerArray([]),
		deltaTermIds: buildIntegerArray([]),
		deltaTapeStarts: buildIntegerArray([]),
		postingTape: new Uint8Array(),
	};
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
	starts: ReturnType<typeof buildIntegerArray>;
	ids: ReturnType<typeof buildIntegerArray>;
}> {
	return {
		starts: buildSentinelStarts(postingsByBigram),
		ids: flattenBuckets(postingsByBigram),
	};
}

function buildAdaptivePostingField(
	postingsByBigramId: ReadonlyMap<number, readonly number[]>,
	profile: AdaptivePostingCodecProfile,
): ResidentAdaptivePostingField {
	if (postingsByBigramId.size === 0) {
		return createEmptyAdaptivePostingField();
	}
	const singletonTermIds: number[] = [];
	const singletonValueIds: number[] = [];
	const pairTermIds: number[] = [];
	const pairFirstValueIds: number[] = [];
	const pairSecondValueIds: number[] = [];
	const smallTermIds: number[] = [];
	const smallValueStarts: number[] = [];
	const smallValueIds: number[] = [];
	const deltaTermIds: number[] = [];
	const deltaTapeStarts: number[] = [];
	const postingTape: number[] = [];

	const postings = [...postingsByBigramId.entries()]
		.map(([bigramId, rawValueIds]) => ({
			bigramId,
			valueIds: [...rawValueIds].sort((left, right) => left - right),
		}))
		.sort((left, right) => left.bigramId - right.bigramId);

	for (const posting of postings) {
		if (posting.valueIds.length === 1) {
			singletonTermIds.push(posting.bigramId);
			singletonValueIds.push(posting.valueIds[0] ?? 0);
			continue;
		}
		if (profile.enablePairLane && posting.valueIds.length === 2) {
			pairTermIds.push(posting.bigramId);
			pairFirstValueIds.push(posting.valueIds[0] ?? 0);
			pairSecondValueIds.push(posting.valueIds[1] ?? 0);
			continue;
		}
		if (posting.valueIds.length <= profile.smallInlineCap) {
			smallTermIds.push(posting.bigramId);
			smallValueStarts.push(smallValueIds.length);
			smallValueIds.push(...posting.valueIds);
			continue;
		}
		deltaTermIds.push(posting.bigramId);
		deltaTapeStarts.push(postingTape.length);
		postingTape.push(...encodeDeltaVarintPosting(posting.valueIds));
	}

	return {
		singletonTermIds: buildIntegerArray(singletonTermIds),
		singletonValueIds: buildIntegerArray(singletonValueIds),
		pairTermIds: buildIntegerArray(pairTermIds),
		pairFirstValueIds: buildIntegerArray(pairFirstValueIds),
		pairSecondValueIds: buildIntegerArray(pairSecondValueIds),
		smallTermIds: buildIntegerArray(smallTermIds),
		smallValueStarts: buildIntegerArray(smallValueStarts),
		smallValueIds: buildIntegerArray(smallValueIds),
		deltaTermIds: buildIntegerArray(deltaTermIds),
		deltaTapeStarts: buildIntegerArray(deltaTapeStarts),
		postingTape: Uint8Array.from(postingTape),
	};
}

function estimateAdaptivePostingBytes(
	field: ResidentAdaptivePostingField,
): number {
	return (
		field.singletonTermIds.byteLength +
		field.singletonValueIds.byteLength +
		field.pairTermIds.byteLength +
		field.pairFirstValueIds.byteLength +
		field.pairSecondValueIds.byteLength +
		field.smallTermIds.byteLength +
		field.smallValueStarts.byteLength +
		field.smallValueIds.byteLength +
		field.deltaTermIds.byteLength +
		field.deltaTapeStarts.byteLength +
		field.postingTape.byteLength
	);
}

function decodeAdaptivePosting(
	field: ResidentAdaptivePostingField,
	bigramId: number,
): number[] {
	const singletonIndex = lowerBoundNumber(field.singletonTermIds, bigramId);
	if (field.singletonTermIds[singletonIndex] === bigramId) {
		return [field.singletonValueIds[singletonIndex] ?? 0];
	}

	const pairIndex = lowerBoundNumber(field.pairTermIds, bigramId);
	if (field.pairTermIds[pairIndex] === bigramId) {
		return [
			field.pairFirstValueIds[pairIndex] ?? 0,
			field.pairSecondValueIds[pairIndex] ?? 0,
		];
	}

	const smallIndex = lowerBoundNumber(field.smallTermIds, bigramId);
	if (field.smallTermIds[smallIndex] === bigramId) {
		const start = field.smallValueStarts[smallIndex] ?? 0;
		const end =
			field.smallValueStarts[smallIndex + 1] ?? field.smallValueIds.length;
		return sliceResidentIntegerArray(field.smallValueIds, start, end);
	}

	const deltaIndex = lowerBoundNumber(field.deltaTermIds, bigramId);
	if (field.deltaTermIds[deltaIndex] !== bigramId) {
		return [];
	}
	const start = field.deltaTapeStarts[deltaIndex] ?? 0;
	const end =
		field.deltaTapeStarts[deltaIndex + 1] ?? field.postingTape.length;
	return decodeDeltaVarintPosting(field.postingTape, start, end);
}

function encodeDeltaVarintPosting(valueIds: readonly number[]): number[] {
	const bytes: number[] = [];
	let previous = 0;
	for (let index = 0; index < valueIds.length; index += 1) {
		const valueId = valueIds[index] ?? 0;
		const delta = index === 0 ? valueId : valueId - previous;
		let value = delta >>> 0;
		while (value >= 0x80) {
			bytes.push((value & 0x7f) | 0x80);
			value >>>= 7;
		}
		bytes.push(value);
		previous = valueId;
	}
	return bytes;
}

function decodeDeltaVarintPosting(
	bytes: Uint8Array,
	start: number,
	endExclusive: number,
): number[] {
	const valueIds: number[] = [];
	let value = 0;
	let shift = 0;
	let previous = 0;
	for (let index = start; index < endExclusive; index += 1) {
		const byte = bytes[index] ?? 0;
		value |= (byte & 0x7f) << shift;
		if ((byte & 0x80) !== 0) {
			shift += 7;
			continue;
		}
		const valueId = valueIds.length === 0 ? value : previous + value;
		valueIds.push(valueId >>> 0);
		previous = valueId >>> 0;
		value = 0;
		shift = 0;
	}
	return valueIds;
}

function sliceResidentIntegerArray(
	values: ResidentIntegerArray,
	start: number,
	endExclusive: number,
): number[] {
	if (endExclusive <= start) {
		return [];
	}
	return Array.from(values.slice(start, endExclusive));
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

function lowerBoundNumber(
	values: ArrayLike<number>,
	target: number,
	low = 0,
	high = values.length,
): number {
	let nextLow = low;
	let nextHigh = high;
	while (nextLow < nextHigh) {
		const middle = (nextLow + nextHigh) >>> 1;
		if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) {
			nextLow = middle + 1;
		} else {
			nextHigh = middle;
		}
	}
	return nextLow;
}
