import {
	buildIntegerArray,
	type ResidentIntegerArray,
} from "./integer-arrays";
import type { ResidentAdaptivePostingField } from "./types";

export type AdaptivePostingCodecProfile = Readonly<{
	smallInlineCap: number;
	enablePairLane: boolean;
}>;

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

export function buildAdaptivePostingField(
	postingsByTermId: ReadonlyMap<number, readonly number[]>,
	profile: AdaptivePostingCodecProfile,
): ResidentAdaptivePostingField {
	if (postingsByTermId.size === 0) {
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

	const postings = [...postingsByTermId.entries()]
		.map(([termId, rawValueIds]) => ({
			termId,
			valueIds: isSortedAscending(rawValueIds)
				? rawValueIds
				: [...rawValueIds].sort((left, right) => left - right),
		}))
		.sort((left, right) => left.termId - right.termId);

	for (const posting of postings) {
		if (posting.valueIds.length === 1) {
			singletonTermIds.push(posting.termId);
			singletonValueIds.push(posting.valueIds[0] ?? 0);
			continue;
		}
		if (profile.enablePairLane && posting.valueIds.length === 2) {
			pairTermIds.push(posting.termId);
			pairFirstValueIds.push(posting.valueIds[0] ?? 0);
			pairSecondValueIds.push(posting.valueIds[1] ?? 0);
			continue;
		}
		if (posting.valueIds.length <= profile.smallInlineCap) {
			smallTermIds.push(posting.termId);
			smallValueStarts.push(smallValueIds.length);
			smallValueIds.push(...posting.valueIds);
			continue;
		}
		deltaTermIds.push(posting.termId);
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

function isSortedAscending(values: readonly number[]): boolean {
	for (let index = 1; index < values.length; index += 1) {
		if ((values[index - 1] ?? 0) > (values[index] ?? 0)) {
			return false;
		}
	}
	return true;
}

export function decodeAdaptivePosting(
	field: ResidentAdaptivePostingField,
	termId: number,
): number[] {
	const singletonIndex = lowerBoundNumber(field.singletonTermIds, termId);
	if (field.singletonTermIds[singletonIndex] === termId) {
		return [field.singletonValueIds[singletonIndex] ?? 0];
	}

	const pairIndex = lowerBoundNumber(field.pairTermIds, termId);
	if (field.pairTermIds[pairIndex] === termId) {
		return [
			field.pairFirstValueIds[pairIndex] ?? 0,
			field.pairSecondValueIds[pairIndex] ?? 0,
		];
	}

	const smallIndex = lowerBoundNumber(field.smallTermIds, termId);
	if (field.smallTermIds[smallIndex] === termId) {
		const start = field.smallValueStarts[smallIndex] ?? 0;
		const end =
			field.smallValueStarts[smallIndex + 1] ?? field.smallValueIds.length;
		return sliceResidentIntegerArray(field.smallValueIds, start, end);
	}

	const deltaIndex = lowerBoundNumber(field.deltaTermIds, termId);
	if (field.deltaTermIds[deltaIndex] !== termId) {
		return [];
	}
	const start = field.deltaTapeStarts[deltaIndex] ?? 0;
	const end =
		field.deltaTapeStarts[deltaIndex + 1] ?? field.postingTape.length;
	return decodeDeltaVarintPosting(field.postingTape, start, end);
}

export function estimateAdaptivePostingBytes(
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
