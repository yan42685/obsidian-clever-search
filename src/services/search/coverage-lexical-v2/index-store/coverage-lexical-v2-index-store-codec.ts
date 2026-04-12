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

const TINY_INLINE_DOC_CAP = 4;

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
		return [fieldSegment.singletonDocIds[singletonIndex] ?? 0];
	}

	const smallIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.smallTermIds,
		termId,
	);
	if (fieldSegment.smallTermIds[smallIndex] === termId) {
		const localIndex = smallIndex;
		const start = fieldSegment.smallDocStarts[localIndex] ?? 0;
		const nextStart =
			fieldSegment.smallDocStarts[localIndex + 1] ?? fieldSegment.smallDocIds.length;
		const count = Math.max(0, nextStart - start);
		return sliceCoverageLexicalV2PackedNumberList(
			fieldSegment.smallDocIds,
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
	docIds: readonly number[],
): number[] {
	const bytes: number[] = [];
	let previous = 0;
	for (let index = 0; index < docIds.length; index += 1) {
		const docId = docIds[index];
		const delta = index === 0 ? docId : docId - previous;
		let value = delta >>> 0;
		while (value >= 0x80) {
			bytes.push((value & 0x7f) | 0x80);
			value >>>= 7;
		}
		bytes.push(value);
		previous = docId;
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
	);
}

function buildCoverageLexicalV2SerializedAdaptivePostingFieldSegment(
	postingsByTermId: ReadonlyMap<CoverageLexicalV2CanonicalTermId, readonly number[]>,
): CoverageLexicalV2SerializedAdaptivePostingFieldSegment {
	const singletonTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const singletonDocIds: number[] = [];
	const smallTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const smallDocStarts: number[] = [];
	const smallDocIds: number[] = [];
	const deltaTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const deltaTapeStarts: number[] = [];
	const postingTape: number[] = [];

	const tokenPostings: Array<{
		termId: CoverageLexicalV2CanonicalTermId;
		docIds: number[];
	}> = [];
	for (const [termId, rawDocIds] of postingsByTermId.entries()) {
		tokenPostings.push({
			termId,
			docIds: [...rawDocIds].sort((left, right) => left - right),
		});
	}
	tokenPostings.sort((left, right) => left.termId - right.termId);

	for (const posting of tokenPostings) {
		if (posting.docIds.length === 1) {
			singletonTermIds.push(posting.termId);
			singletonDocIds.push(posting.docIds[0]);
			continue;
		}
		if (posting.docIds.length <= TINY_INLINE_DOC_CAP) {
			smallTermIds.push(posting.termId);
			smallDocStarts.push(smallDocIds.length);
			smallDocIds.push(...posting.docIds);
			continue;
		}
		const encoded = encodeCoverageLexicalV2DeltaVarintPosting(posting.docIds);
		deltaTermIds.push(posting.termId);
		deltaTapeStarts.push(postingTape.length);
		postingTape.push(...encoded);
	}

	return {
		singletonTermIds: packCoverageLexicalV2UnsignedList(singletonTermIds),
		singletonDocIds: packCoverageLexicalV2UnsignedList(singletonDocIds),
		smallTermIds: packCoverageLexicalV2UnsignedList(smallTermIds),
		smallDocStarts: packCoverageLexicalV2UnsignedList(smallDocStarts),
		smallDocIds: packCoverageLexicalV2UnsignedList(smallDocIds),
		deltaTermIds: packCoverageLexicalV2UnsignedList(deltaTermIds),
		deltaTapeStarts: packCoverageLexicalV2UnsignedList(deltaTapeStarts),
		postingTape: Uint8Array.from(postingTape),
	};
}

function buildCoverageLexicalV2SerializedAdaptivePostingFieldSegmentFromTerms(
	postingsByTerm: ReadonlyMap<string, readonly number[]>,
	getCanonicalTermId: (term: string) => CoverageLexicalV2CanonicalTermId | undefined,
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
		fieldSegment.singletonDocIds,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.smallTermIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.smallDocStarts,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.smallDocIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.deltaTermIds);
	total += estimateCoverageLexicalV2PackedNumberListBytes(
		fieldSegment.deltaTapeStarts,
	);
	total += estimateCoverageLexicalV2PackedNumberListBytes(fieldSegment.postingTape);
	return total;
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
