export type ResidentIntegerArray = Uint8Array | Uint16Array | Uint32Array;

export type ResidentIntegerArrayKind = "u8" | "u16" | "u32";

export type ResidentSectionEncodingDescriptor = Readonly<{
	sectionKind: string;
	elementCount: number;
	valueKind: ResidentIntegerArrayKind;
	bytesPerElement: 1 | 2 | 4;
	encodingFlags: number;
}>;

const SECTION_FLAG_SENTINEL_STARTS = 1 << 0;

export function buildIntegerArray(
	values: readonly number[],
): ResidentIntegerArray {
	const maxValue = computeMaxIntegerValue(values);
	const ArrayConstructor = selectIntegerArrayConstructor(maxValue);
	return ArrayConstructor.from(values);
}

export function buildSentinelStarts(
	buckets: readonly (readonly number[])[],
): ResidentIntegerArray {
	const starts: number[] = [];
	let offset = 0;
	for (const bucket of buckets) {
		starts.push(offset);
		offset += bucket.length;
	}
	starts.push(offset);
	return buildIntegerArray(starts);
}

export function flattenBuckets(
	buckets: readonly (readonly number[])[],
): ResidentIntegerArray {
	const values: number[] = [];
	for (const bucket of buckets) {
		values.push(...bucket);
	}
	return buildIntegerArray(values);
}

export function sliceResidentIntegerArray(
	values: ResidentIntegerArray,
	start: number,
	endExclusive: number,
): number[] {
	if (endExclusive <= start) {
		return [];
	}
	return Array.from(values.slice(start, endExclusive));
}

export function getSentinelSliceStart(
	starts: ResidentIntegerArray,
	index: number,
): number {
	return starts[index] ?? 0;
}

export function getSentinelSliceEnd(
	starts: ResidentIntegerArray,
	index: number,
): number {
	return starts[index + 1] ?? getSentinelSliceStart(starts, index);
}

export function sliceSentinelBucket(
	starts: ResidentIntegerArray,
	values: ResidentIntegerArray,
	index: number,
): number[] {
	return sliceResidentIntegerArray(
		values,
		getSentinelSliceStart(starts, index),
		getSentinelSliceEnd(starts, index),
	);
}

export function estimateSentinelPostingBytes(
	starts: ResidentIntegerArray,
	values: ResidentIntegerArray,
): number {
	return starts.byteLength + values.byteLength;
}

export function describeIntegerSection(
	sectionKind: string,
	values: ResidentIntegerArray,
	encodingFlags = 0,
): ResidentSectionEncodingDescriptor {
	const valueKind = resolveIntegerArrayKind(values);
	return {
		sectionKind,
		elementCount: values.length,
		valueKind,
		bytesPerElement: resolveBytesPerElement(valueKind),
		encodingFlags,
	};
}

export function sentinelStartsEncodingFlag(): number {
	return SECTION_FLAG_SENTINEL_STARTS;
}

export function resolveIntegerArrayKind(
	values: ResidentIntegerArray,
): ResidentIntegerArrayKind {
	if (values instanceof Uint8Array) {
		return "u8";
	}
	if (values instanceof Uint16Array) {
		return "u16";
	}
	return "u32";
}

function resolveBytesPerElement(
	valueKind: ResidentIntegerArrayKind,
): 1 | 2 | 4 {
	switch (valueKind) {
		case "u8":
			return 1;
		case "u16":
			return 2;
		default:
			return 4;
	}
}

function computeMaxIntegerValue(values: readonly number[]): number {
	let maxValue = 0;
	for (const value of values) {
		if (value > maxValue) {
			maxValue = value;
		}
	}
	return maxValue;
}

function selectIntegerArrayConstructor(
	maxValue: number,
): Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor {
	if (maxValue <= 0xff) {
		return Uint8Array;
	}
	if (maxValue <= 0xffff) {
		return Uint16Array;
	}
	return Uint32Array;
}
