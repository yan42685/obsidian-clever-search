import type {
	CoverageLexicalV2CandidateCascadePostingField,
} from "../candidate-cascade";
import type {
	CoverageLexicalV2CanonicalTermId,
	CoverageLexicalV2IndexStoreResidentSegment,
	CoverageLexicalV2MetadataPostingField,
	CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment,
	CoverageLexicalV2SerializedExactSegmentFields,
	CoverageLexicalV2SerializedMetadataSegmentFields,
	CoverageLexicalV2SerializedPostingDirectoryEntry,
	CoverageLexicalV2SerializedPostingFieldSegment,
} from "./coverage-lexical-v2-index-store-types";

const TINY_INLINE_DOC_CAP = 4;

export function buildCoverageLexicalV2ResidentSegment(options: {
	id: string;
	createdAt: number;
	docCount: number;
	exactByField: Record<
		CoverageLexicalV2CandidateCascadePostingField,
		ReadonlyMap<string, readonly number[]>
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
		exactByField: buildCoverageLexicalV2ExactResidentSegmentFields(
			options.exactByField,
			options.getCanonicalTermId,
		),
		metadataHanByField: buildCoverageLexicalV2MetadataResidentSegmentFields(
			options.metadataHanByField,
			options.getCanonicalTermId,
		),
	};
}

export function decodeCoverageLexicalV2ResidentSegmentPosting(
	fieldSegment: CoverageLexicalV2SerializedPostingFieldSegment,
	termId: CoverageLexicalV2CanonicalTermId,
): readonly number[] | undefined {
	const index = lowerBoundCoverageLexicalV2Number(
		fieldSegment.termIdDictionary,
		termId,
	);
	if (fieldSegment.termIdDictionary[index] !== termId) {
		return undefined;
	}
	const entry = fieldSegment.postingDirectory[index];
	if (!entry) {
		return undefined;
	}
	if (entry.encoding === "tiny_inline") {
		return entry.inlineDocIds ?? [];
	}
	return decodeCoverageLexicalV2DeltaVarintPosting(
		fieldSegment.postingTape.slice(
			entry.tapeStart,
			entry.tapeStart + entry.tapeLength,
		),
		entry.docCount,
	);
}

export function decodeCoverageLexicalV2ResidentBodyPosting(
	fieldSegment: CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment,
	termId: CoverageLexicalV2CanonicalTermId,
): readonly number[] | undefined {
	const singletonIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.termIdLexicon,
		termId,
		0,
		fieldSegment.singletonDocIds.length,
	);
	if (fieldSegment.termIdLexicon[singletonIndex] === termId) {
		return [fieldSegment.singletonDocIds[singletonIndex]];
	}

	const smallStart = fieldSegment.singletonDocIds.length;
	const smallIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.termIdLexicon,
		termId,
		smallStart,
		smallStart + fieldSegment.smallTermIds.length,
	);
	if (fieldSegment.termIdLexicon[smallIndex] === termId) {
		const localIndex = smallIndex - smallStart;
		const start = fieldSegment.smallDocStarts[localIndex] ?? 0;
		const count = fieldSegment.smallDocCounts[localIndex] ?? 0;
		return fieldSegment.smallDocIds.slice(start, start + count);
	}

	const deltaStart = smallStart + fieldSegment.smallTermIds.length;
	const deltaIndex = lowerBoundCoverageLexicalV2Number(
		fieldSegment.termIdLexicon,
		termId,
		deltaStart,
		deltaStart + fieldSegment.deltaTermIds.length,
	);
	if (fieldSegment.termIdLexicon[deltaIndex] !== termId) {
		return undefined;
	}
	const localIndex = deltaIndex - deltaStart;
	return decodeCoverageLexicalV2DeltaVarintPosting(
		fieldSegment.postingTape.slice(
			fieldSegment.deltaTapeStarts[localIndex] ?? 0,
			(fieldSegment.deltaTapeStarts[localIndex] ?? 0) +
				(fieldSegment.deltaTapeLengths[localIndex] ?? 0),
		),
		fieldSegment.deltaDocCounts[localIndex] ?? 0,
	);
}

export function estimateCoverageLexicalV2ResidentSegmentBytes(
	segment: CoverageLexicalV2IndexStoreResidentSegment,
	canonicalTermLexicon: readonly string[],
): { exactIncidence: number; metadataHanGate: number } {
	let exactIncidence = estimateCoverageLexicalV2SerializedAdaptiveBodyFieldSegmentBytes(
		segment.exactByField.body,
		canonicalTermLexicon,
	);
	let metadataHanGate = 0;
	for (const fieldSegment of [
		segment.exactByField.basename,
		segment.exactByField.aliases,
		segment.exactByField.headings,
		segment.exactByField.folder,
		segment.exactByField.tag,
	]) {
		exactIncidence += estimateCoverageLexicalV2SerializedFieldSegmentBytes(
			fieldSegment,
			canonicalTermLexicon,
		);
	}
	for (const fieldSegment of Object.values(segment.metadataHanByField)) {
		metadataHanGate += estimateCoverageLexicalV2SerializedFieldSegmentBytes(
			fieldSegment,
			canonicalTermLexicon,
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
	docCount: number,
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
	if (docIds.length !== docCount) {
		throw new Error("Coverage lexical V2 posting tape decode mismatch");
	}
	return docIds;
}

function buildCoverageLexicalV2ExactResidentSegmentFields(
	postingsByField: Record<
		CoverageLexicalV2CandidateCascadePostingField,
		ReadonlyMap<string, readonly number[]>
	>,
	getCanonicalTermId: (term: string) => CoverageLexicalV2CanonicalTermId | undefined,
): CoverageLexicalV2SerializedExactSegmentFields {
	return {
		basename: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.basename,
			getCanonicalTermId,
		),
		aliases: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.aliases,
			getCanonicalTermId,
		),
		headings: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.headings,
			getCanonicalTermId,
		),
		folder: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.folder,
			getCanonicalTermId,
		),
		tag: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.tag,
			getCanonicalTermId,
		),
		body: buildCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
			postingsByField.body,
			getCanonicalTermId,
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
		basename: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.basename,
			getCanonicalTermId,
		),
		aliases: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.aliases,
			getCanonicalTermId,
		),
		headings: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.headings,
			getCanonicalTermId,
		),
		folder: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.folder,
			getCanonicalTermId,
		),
		tag: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.tag,
			getCanonicalTermId,
		),
	};
}

function buildCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
	postingsByTerm: ReadonlyMap<string, readonly number[]>,
	getCanonicalTermId: (term: string) => CoverageLexicalV2CanonicalTermId | undefined,
): CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment {
	const singletonTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const singletonDocIds: number[] = [];
	const smallTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const smallDocStarts: number[] = [];
	const smallDocCounts: number[] = [];
	const smallDocIds: number[] = [];
	const deltaTermIds: CoverageLexicalV2CanonicalTermId[] = [];
	const deltaDocCounts: number[] = [];
	const deltaTapeStarts: number[] = [];
	const deltaTapeLengths: number[] = [];
	const postingTape: number[] = [];

	const tokenPostings: Array<{ termId: CoverageLexicalV2CanonicalTermId; docIds: number[] }> = [];
	for (const [term, rawDocIds] of postingsByTerm.entries()) {
		const termId = getCanonicalTermId(term);
		if (termId === undefined) {
			continue;
		}
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
			smallDocCounts.push(posting.docIds.length);
			smallDocIds.push(...posting.docIds);
			continue;
		}
		const encoded = encodeCoverageLexicalV2DeltaVarintPosting(posting.docIds);
		deltaTermIds.push(posting.termId);
		deltaDocCounts.push(posting.docIds.length);
		deltaTapeStarts.push(postingTape.length);
		deltaTapeLengths.push(encoded.length);
		postingTape.push(...encoded);
	}

	return {
		termIdLexicon: [...singletonTermIds, ...smallTermIds, ...deltaTermIds],
		singletonDocIds,
		smallTermIds,
		smallDocStarts,
		smallDocCounts,
		smallDocIds,
		deltaTermIds,
		deltaDocCounts,
		deltaTapeStarts,
		deltaTapeLengths,
		postingTape,
	};
}

function buildCoverageLexicalV2SerializedPostingFieldSegment(
	postingsByTerm: ReadonlyMap<string, readonly number[]>,
	getCanonicalTermId: (term: string) => CoverageLexicalV2CanonicalTermId | undefined,
): CoverageLexicalV2SerializedPostingFieldSegment {
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
	const postingDirectory: CoverageLexicalV2SerializedPostingDirectoryEntry[] = [];
	const postingTape: number[] = [];
	const termIdDictionary: CoverageLexicalV2CanonicalTermId[] = [];
	for (const entry of dictionaryEntries) {
		const docIds = [...entry.docIds].sort(
			(left, right) => left - right,
		);
		termIdDictionary.push(entry.termId);
		if (docIds.length <= TINY_INLINE_DOC_CAP) {
			postingDirectory.push({
				encoding: "tiny_inline",
				docCount: docIds.length,
				tapeStart: 0,
				tapeLength: 0,
				inlineDocIds: docIds,
			});
			continue;
		}
		const encoded = encodeCoverageLexicalV2DeltaVarintPosting(docIds);
		const tapeStart = postingTape.length;
		postingTape.push(...encoded);
		postingDirectory.push({
			encoding: "delta_varint",
			docCount: docIds.length,
			tapeStart,
			tapeLength: encoded.length,
		});
	}
	return {
		termIdDictionary,
		postingDirectory,
		postingTape,
	};
}

function estimateCoverageLexicalV2SerializedAdaptiveBodyFieldSegmentBytes(
	fieldSegment: CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment,
	canonicalTermLexicon: readonly string[],
): number {
	let total = 0;
	for (const termId of fieldSegment.termIdLexicon) {
		const token = canonicalTermLexicon[termId];
		if (token) {
			total += estimateCoverageLexicalV2StringBytes(token);
		}
	}
	total += fieldSegment.termIdLexicon.length * 4;
	total += fieldSegment.singletonDocIds.length * 4;
	total += fieldSegment.smallTermIds.length * 4;
	total += fieldSegment.smallDocStarts.length * 4;
	total += fieldSegment.smallDocCounts.length * 4;
	total += fieldSegment.smallDocIds.length * 4;
	total += fieldSegment.deltaTermIds.length * 4;
	total += fieldSegment.deltaDocCounts.length * 4;
	total += fieldSegment.deltaTapeStarts.length * 4;
	total += fieldSegment.deltaTapeLengths.length * 4;
	total += fieldSegment.postingTape.length;
	return total;
}

function estimateCoverageLexicalV2SerializedFieldSegmentBytes(
	fieldSegment: CoverageLexicalV2SerializedPostingFieldSegment,
	canonicalTermLexicon: readonly string[],
): number {
	let total = 0;
	for (const termId of fieldSegment.termIdDictionary) {
		const term = canonicalTermLexicon[termId] ?? "";
		total += estimateCoverageLexicalV2StringBytes(term);
	}
	total += fieldSegment.postingDirectory.length * 24;
	total += fieldSegment.postingTape.length;
	for (const entry of fieldSegment.postingDirectory) {
		if (entry.encoding === "tiny_inline") {
			total += (entry.inlineDocIds?.length ?? 0) * 4;
		}
	}
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
	values: readonly number[],
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

function estimateCoverageLexicalV2StringBytes(value: string): number {
	return new TextEncoder().encode(value).length;
}
