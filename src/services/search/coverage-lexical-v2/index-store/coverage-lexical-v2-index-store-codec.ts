import type {
	CoverageLexicalV2CandidateCascadePostingField,
} from "../candidate-cascade";
import type {
	CoverageLexicalV2CanonicalTermId,
	CoverageLexicalV2IndexStoreResidentSegment,
	CoverageLexicalV2MetadataPostingField,
	CoverageLexicalV2PackedNumberList,
	CoverageLexicalV2SerializedAdaptivePostingFieldSegment,
	CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment,
	CoverageLexicalV2SerializedExactSegmentFields,
	CoverageLexicalV2SerializedMetadataSegmentFields,
} from "./coverage-lexical-v2-index-store-types";

type CoverageLexicalV2AdaptivePostingCodecProfile = {
	smallInlineCap: number;
	enablePairLane: boolean;
};

const DEFAULT_ADAPTIVE_POSTING_CODEC_PROFILE: CoverageLexicalV2AdaptivePostingCodecProfile = {
	smallInlineCap: 4,
	enablePairLane: true,
};

const BODY_HAN_ADAPTIVE_POSTING_CODEC_PROFILE: CoverageLexicalV2AdaptivePostingCodecProfile = {
	smallInlineCap: 8,
	enablePairLane: true,
};

export function buildCoverageLexicalV2ResidentSegment(options: {
	id: string;
	createdAt: number;
	docCount: number;
	exactByField: Record<
		CoverageLexicalV2CandidateCascadePostingField,
		ReadonlyMap<CoverageLexicalV2CanonicalTermId, readonly number[]>
	>;
	metadataHanByField: Record<
		CoverageLexicalV2MetadataPostingField,
		ReadonlyMap<string, readonly number[]>
	>;
	getCanonicalTermId(term: string): CoverageLexicalV2CanonicalTermId | undefined;
}): CoverageLexicalV2IndexStoreResidentSegment {
	return {
		id: options.id,
		createdAt: options.createdAt,
		docCount: options.docCount,
		exactByField: buildCoverageLexicalV2ExactResidentSegmentFields(options.exactByField),
		metadataHanByField: buildCoverageLexicalV2MetadataResidentSegmentFields(
			options.metadataHanByField,
			options.getCanonicalTermId,
		),
	};
}

export function decodeCoverageLexicalV2ResidentSegmentPosting(
	fieldSegment: CoverageLexicalV2SerializedAdaptivePostingFieldSegment,
	termId: CoverageLexicalV2CanonicalTermId,
): readonly number[] | undefined {
	return decodeCoverageLexicalV2ResidentAdaptivePosting(fieldSegment, termId);
}

export function decodeCoverageLexicalV2ResidentBodyPosting(
	fieldSegment: CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment,
	termId: CoverageLexicalV2CanonicalTermId,
): readonly number[] | undefined {
	return decodeCoverageLexicalV2ResidentAdaptivePosting(fieldSegment, termId);
}

export function decodeCoverageLexicalV2ResidentAdaptivePosting(
	fieldSegment: CoverageLexicalV2SerializedAdaptivePostingFieldSegment,
	termId: CoverageLexicalV2CanonicalTermId,
): readonly number[] | undefined {
	const singletonIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.singletonTermIds,
		termId,
	);
	if (fieldSegment.singletonTermIds[singletonIndex] === termId) {
		return [fieldSegment.singletonValueIds[singletonIndex] ?? 0];
	}

	const pairIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.pairTermIds,
		termId,
	);
	if (fieldSegment.pairTermIds[pairIndex] === termId) {
		return [
			fieldSegment.pairFirstValueIds[pairIndex] ?? 0,
			fieldSegment.pairSecondValueIds[pairIndex] ?? 0,
		];
	}

	const smallIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.smallTermIds,
		termId,
	);
	if (fieldSegment.smallTermIds[smallIndex] === termId) {
		const localIndex = smallIndex;
		const start = fieldSegment.smallValueStarts[localIndex] ?? 0;
		const nextStart =
			fieldSegment.smallValueStarts[localIndex + 1] ?? fieldSegment.smallValueIds.length;
		const count = Math.max(0, nextStart - start);
		return sliceCoverageLexicalV2PackedNumberList(
			fieldSegment.smallValueIds,
			start,
			start + count,
		);
	}

	const deltaIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.deltaTermIds,
		termId,
	);
	if (fieldSegment.deltaTermIds[deltaIndex] !== termId) {
		return undefined;
	}
	const localIndex = deltaIndex;
	const tapeStart = fieldSegment.deltaTapeStarts[localIndex] ?? 0;
	const tapeEnd =
		fieldSegment.deltaTapeStarts[localIndex + 1] ?? fieldSegment.postingTape.length;
	return decodeCoverageLexicalV2DeltaVarintPosting(
		sliceCoverageLexicalV2PackedNumberList(
			fieldSegment.postingTape,
			tapeStart,
			tapeEnd,
		),
	);
}

export function estimateCoverageLexicalV2ResidentSegmentBytes(
	segment: CoverageLexicalV2IndexStoreResidentSegment,
): { exactIncidence: number; metadataHanGate: number } {
	let exactIncidence = estimateCoverageLexicalV2SerializedAdaptiveFieldSegmentBytes(
		segment.exactByField.body,
	);
	let metadataHanGate = 0;
	for (const fieldSegment of [
		segment.exactByField.basename,
		segment.exactByField.aliases,
		segment.exactByField.headings,
		segment.exactByField.folder,
		segment.exactByField.tag,
	]) {
		exactIncidence += estimateCoverageLexicalV2SerializedAdaptiveFieldSegmentBytes(
			fieldSegment,
		);
	}
	for (const fieldSegment of Object.values(segment.metadataHanByField)) {
		metadataHanGate += estimateCoverageLexicalV2SerializedAdaptiveFieldSegmentBytes(
			fieldSegment,
		);
	}
	return {
		exactIncidence,
		metadataHanGate,
	};
}

export function encodeCoverageLexicalV2DeltaVarintPosting(
	valueIds: readonly number[],
): number[] {
	const bytes: number[] = [];
	let previous = 0;
	for (let index = 0; index < valueIds.length; index += 1) {
		const valueId = valueIds[index];
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

export function decodeCoverageLexicalV2DeltaVarintPosting(
	bytes: readonly number[],
	docCount?: number,
): number[] {
	const docIds: number[] = [];
	let value = 0;
	let shift = 0;
	let previous = 0;
	for (const byte of bytes) {
		value |= (byte & 0x7f) << shift;
		if ((byte & 0x80) !== 0) {
			shift += 7;
			continue;
		}
		const docId = docIds.length === 0 ? value : previous + value;
		docIds.push(docId);
		previous = docId;
		value = 0;
		shift = 0;
	}
	if (docCount !== undefined && docIds.length !== docCount) {
		throw new Error("Coverage lexical V2 posting tape decode mismatch");
	}
	return docIds;
}

function buildCoverageLexicalV2ExactResidentSegmentFields(
	postingsByField: Record<
		CoverageLexicalV2CandidateCascadePostingField,
		ReadonlyMap<CoverageLexicalV2CanonicalTermId, readonly number[]>
	>
): CoverageLexicalV2SerializedExactSegmentFields {
	return {
		basename: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
			postingsByField.basename,
		),
		aliases: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
			postingsByField.aliases,
		),
		headings: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
			postingsByField.headings,
		),
		folder: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
			postingsByField.folder,
		),
		tag: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
			postingsByField.tag,
		),
		body: buildCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
			postingsByField.body,
		),
	};
}

function buildCoverageLexicalV2MetadataResidentSegmentFields(
	postingsByField: Record<
		CoverageLexicalV2MetadataPostingField,
		ReadonlyMap<string, readonly number[]>
	>,
	getCanonicalTermId: (term: string) => CoverageLexicalV2CanonicalTermId | undefined,
): CoverageLexicalV2SerializedMetadataSegmentFields {
	return {
		basename: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
			postingsByField.basename,
			getCanonicalTermId,
		),
		aliases: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
			postingsByField.aliases,
			getCanonicalTermId,
		),
		headings: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
			postingsByField.headings,
			getCanonicalTermId,
		),
		folder: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
			postingsByField.folder,
			getCanonicalTermId,
		),
		tag: buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
			postingsByField.tag,
			getCanonicalTermId,
		),
	};
}

function buildCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
	postingsByTermId: ReadonlyMap<CoverageLexicalV2CanonicalTermId, readonly number[]>,
): CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment {
	return buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
		postingsByTermId,
		DEFAULT_ADAPTIVE_POSTING_CODEC_PROFILE,
	);
}

export function buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
	postingsByTermId: ReadonlyMap<number, readonly number[]>,
	profile: CoverageLexicalV2AdaptivePostingCodecProfile = DEFAULT_ADAPTIVE_POSTING_CODEC_PROFILE,
): CoverageLexicalV2SerializedAdaptivePostingFieldSegment {
	const singletonTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const singletonValueIds: number[] = [];
	const pairTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const pairFirstValueIds: number[] = [];
	const pairSecondValueIds: number[] = [];
	const smallTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const smallValueStarts: number[] = [];
	const smallValueIds: number[] = [];
	const deltaTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const deltaTapeStarts: number[] = [];
	const postingTape: number[] = [];

	const tokenPostings: Array<{
		termId: CoverageLexicalV2CanonicalTermId;
		valueIds: number[];
	}> = [];
	for (const [termId, rawValueIds] of postingsByTermId.entries()) {
		tokenPostings.push({
			termId,
			valueIds: [...rawValueIds].sort((left, right) => left - right),
		});
	}
	tokenPostings.sort((left, right) => left.termId - right.termId);

	for (const posting of tokenPostings) {
		if (posting.valueIds.length === 1) {
			singletonTermIds.push(posting.termId);
			singletonValueIds.push(posting.valueIds[0]);
			continue;
		}
		if (profile.enablePairLane && posting.valueIds.length === 2) {
			pairTermIds.push(posting.termId);
			pairFirstValueIds.push(posting.valueIds[0]);
			pairSecondValueIds.push(posting.valueIds[1]);
			continue;
		}
		if (posting.valueIds.length <= profile.smallInlineCap) {
			smallTermIds.push(posting.termId);
			smallValueStarts.push(smallValueIds.length);
			smallValueIds.push(...posting.valueIds);
			continue;
		}
		const encoded = encodeCoverageLexicalV2DeltaVarintPosting(posting.valueIds);
		deltaTermIds.push(posting.termId);
		deltaTapeStarts.push(postingTape.length);
		postingTape.push(...encoded);
	}

	return {
		singletonTermIds: packCoverageLexicalV2UnsignedList(singletonTermIds),
		singletonValueIds: packCoverageLexicalV2UnsignedList(singletonValueIds),
		pairTermIds: packCoverageLexicalV2UnsignedList(pairTermIds),
		pairFirstValueIds: packCoverageLexicalV2UnsignedList(pairFirstValueIds),
		pairSecondValueIds: packCoverageLexicalV2UnsignedList(pairSecondValueIds),
		smallTermIds: packCoverageLexicalV2UnsignedList(smallTermIds),
		smallValueStarts: packCoverageLexicalV2UnsignedList(smallValueStarts),
		smallValueIds: packCoverageLexicalV2UnsignedList(smallValueIds),
		deltaTermIds: packCoverageLexicalV2UnsignedList(deltaTermIds),
		deltaTapeStarts: packCoverageLexicalV2UnsignedList(deltaTapeStarts),
		postingTape: Uint8Array.from(postingTape),
	};
}

function buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
	postingsByTerm: ReadonlyMap<string, readonly number[]>,
	getCanonicalTermId: (term: string) => CoverageLexicalV2CanonicalTermId | undefined,
	profile: CoverageLexicalV2AdaptivePostingCodecProfile = DEFAULT_ADAPTIVE_POSTING_CODEC_PROFILE,
): CoverageLexicalV2SerializedAdaptivePostingFieldSegment {
	const dictionaryEntries = [...postingsByTerm.entries()]
		.map(([term, docIds]) => ({
			termId: getCanonicalTermId(term),
			docIds,
		}))
		.filter(
			(entry): entry is {
				termId: CoverageLexicalV2CanonicalTermId;
				docIds: readonly number[];
			} => entry.termId !== undefined,
		)
		.sort((left, right) => left.termId - right.termId);
	return buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
		new Map(
			dictionaryEntries.map((entry) => [
				entry.termId,
				[...entry.docIds].sort((left, right) => left - right),
			]),
		),
		profile,
	);
}

function estimateCoverageLexicalV2SerializedAdaptiveFieldSegmentBytes(
	fieldSegment: CoverageLexicalV2SerializedAdaptivePostingFieldSegment,
): number {
	let total = 0;
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.singletonTermIds,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.singletonValueIds,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.pairTermIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.pairFirstValueIds,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.pairSecondValueIds,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.smallTermIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.smallValueStarts,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.smallValueIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.deltaTermIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.deltaTapeStarts,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.postingTape);
	return total;
}

export function buildCoverageLexicalV2BodyHanAdaptivePostingFieldSegment(
	postingsByBigramId: ReadonlyMap<number, readonly number[]>,
): CoverageLexicalV2SerializedAdaptivePostingFieldSegment {
	return buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
		postingsByBigramId,
		BODY_HAN_ADAPTIVE_POSTING_CODEC_PROFILE,
	);
}

function lowerBoundCoverageLexicalV2String(
	values: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function lowerBoundCoverageLexicalV2Number(
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

function packCoverageLexicalV2UnsignedList(
	values: readonly number[],
): CoverageLexicalV2PackedNumberList {
	if (values.length === 0) {
		return [];
	}
	let maxValue = 0;
	for (const value of values) {
		if (value > maxValue) {
			maxValue = value;
		}
	}
	if (maxValue <= 0xff) {
		return Uint8Array.from(values);
	}
	if (maxValue <= 0xffff) {
		return Uint16Array.from(values);
	}
	return Uint32Array.from(values);
}

function estimateCoverageLexicalV2PackedNumberListBytes(
	values: CoverageLexicalV2PackedNumberList,
): number {
	return "byteLength" in values ? values.byteLength : values.length * 4;
}

function sliceCoverageLexicalV2PackedNumberList(
	values: CoverageLexicalV2PackedNumberList,
	start: number,
	end: number,
): number[] {
	if ("subarray" in values) {
		return Array.from(values.subarray(start, end));
	}
	return values.slice(start, end);
}
