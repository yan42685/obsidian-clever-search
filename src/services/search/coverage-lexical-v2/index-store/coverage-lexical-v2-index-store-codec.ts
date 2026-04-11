import type {
	CoverageLexicalV2CandidateCascadePostingField,
} from "../candidate-cascade";
import type {
	CoverageLexicalV2IndexStoreResidentSegment,
	CoverageLexicalV2MetadataPostingField,
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
}): CoverageLexicalV2IndexStoreResidentSegment {
	return {
		id: options.id,
		createdAt: options.createdAt,
		docCount: options.docCount,
		exactByField: buildCoverageLexicalV2ExactResidentSegmentFields(
			options.exactByField,
		),
		metadataHanByField: buildCoverageLexicalV2MetadataResidentSegmentFields(
			options.metadataHanByField,
		),
	};
}

export function decodeCoverageLexicalV2ResidentSegmentPosting(
	fieldSegment: CoverageLexicalV2SerializedPostingFieldSegment,
	term: string,
): readonly number[] | undefined {
	const index = lowerBoundCoverageLexicalV2String(
		fieldSegment.termDictionary,
		term,
	);
	if (fieldSegment.termDictionary[index] !== term) {
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

export function estimateCoverageLexicalV2ResidentSegmentBytes(
	segment: CoverageLexicalV2IndexStoreResidentSegment,
): { exactIncidence: number; metadataHanGate: number } {
	let exactIncidence = 0;
	let metadataHanGate = 0;
	for (const fieldSegment of Object.values(segment.exactByField)) {
		exactIncidence += estimateCoverageLexicalV2SerializedFieldSegmentBytes(
			fieldSegment,
		);
	}
	for (const fieldSegment of Object.values(segment.metadataHanByField)) {
		metadataHanGate += estimateCoverageLexicalV2SerializedFieldSegmentBytes(
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
): CoverageLexicalV2SerializedExactSegmentFields {
	return {
		basename: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.basename,
		),
		aliases: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.aliases,
		),
		headings: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.headings,
		),
		folder: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.folder,
		),
		tag: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.tag,
		),
		body: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.body,
		),
	};
}

function buildCoverageLexicalV2MetadataResidentSegmentFields(
	postingsByField: Record<
		CoverageLexicalV2MetadataPostingField,
		ReadonlyMap<string, readonly number[]>
	>,
): CoverageLexicalV2SerializedMetadataSegmentFields {
	return {
		basename: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.basename,
		),
		aliases: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.aliases,
		),
		headings: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.headings,
		),
		folder: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.folder,
		),
		tag: buildCoverageLexicalV2SerializedPostingFieldSegment(
			postingsByField.tag,
		),
	};
}

function buildCoverageLexicalV2SerializedPostingFieldSegment(
	postingsByTerm: ReadonlyMap<string, readonly number[]>,
): CoverageLexicalV2SerializedPostingFieldSegment {
	const termDictionary = [...postingsByTerm.keys()].sort();
	const postingDirectory: CoverageLexicalV2SerializedPostingDirectoryEntry[] = [];
	const postingTape: number[] = [];
	for (let termIndex = 0; termIndex < termDictionary.length; termIndex += 1) {
		const term = termDictionary[termIndex];
		const docIds = [...(postingsByTerm.get(term) ?? [])].sort((left, right) => left - right);
		if (docIds.length <= TINY_INLINE_DOC_CAP) {
			postingDirectory.push({
				termIndex,
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
			termIndex,
			encoding: "delta_varint",
			docCount: docIds.length,
			tapeStart,
			tapeLength: encoded.length,
		});
	}
	return {
		termDictionary,
		postingDirectory,
		postingTape,
	};
}

function estimateCoverageLexicalV2SerializedFieldSegmentBytes(
	fieldSegment: CoverageLexicalV2SerializedPostingFieldSegment,
): number {
	let total = 0;
	for (const term of fieldSegment.termDictionary) {
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

function estimateCoverageLexicalV2StringBytes(value: string): number {
	return new TextEncoder().encode(value).length;
}
