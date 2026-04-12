export type CoverageLexicalV2TokenRange = {
	start: number;
	end: number;
};

export type CoverageLexicalV2PreparedStreamingSubsequence = {
	needle: readonly number[];
	lps: readonly number[];
};

export function encodeCoverageLexicalV2NumericTokenTape(
	values: readonly number[],
): Uint8Array {
	const bytes: number[] = [];
	for (const value of values) {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`Invalid coverage lexical V2 token id: ${value}`);
		}
		let remaining = value >>> 0;
		while (remaining >= 0x80) {
			bytes.push((remaining & 0x7f) | 0x80);
			remaining >>>= 7;
		}
		bytes.push(remaining);
	}
	return Uint8Array.from(bytes);
}

export function readCoverageLexicalV2NumericTokenRange(
	tape: Uint8Array,
	range: CoverageLexicalV2TokenRange | undefined,
): number[] | undefined {
	if (!range) {
		return undefined;
	}
	const values: number[] = [];
	let value = 0;
	let shift = 0;
	for (let index = range.start; index < range.end; index += 1) {
		const byte = tape[index];
		value |= (byte & 0x7f) << shift;
		if ((byte & 0x80) !== 0) {
			shift += 7;
			continue;
		}
		values.push(value >>> 0);
		value = 0;
		shift = 0;
	}
	return values;
}

export function estimateCoverageLexicalV2NumericTokenTapeBytes(
	tape: Uint8Array,
	ranges: readonly (CoverageLexicalV2TokenRange | undefined)[],
): {
	total: number;
	tapeBytes: number;
	rangeBytes: number;
	slotReferenceBytes: number;
	populatedCount: number;
} {
	let populatedCount = 0;
	for (const range of ranges) {
		if (range) {
			populatedCount += 1;
		}
	}
	const tapeBytes = tape.length;
	const rangeBytes = populatedCount * 16;
	const slotReferenceBytes = ranges.length * 8;
	return {
		total: tapeBytes + rangeBytes + slotReferenceBytes,
		tapeBytes,
		rangeBytes,
		slotReferenceBytes,
		populatedCount,
	};
}

export function containsCoverageLexicalV2NumericSubsequence(
	haystack: readonly number[],
	needle: readonly number[],
): boolean {
	if (needle.length === 0) {
		return true;
	}
	if (needle.length > haystack.length) {
		return false;
	}
	for (let start = 0; start <= haystack.length - needle.length; start += 1) {
		let matched = true;
		for (let index = 0; index < needle.length; index += 1) {
			if (haystack[start + index] !== needle[index]) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return true;
		}
	}
	return false;
}

export function collectCoverageLexicalV2NumericBigramMatchIndices(
	haystack: readonly number[],
	needle: readonly number[],
): Set<number> {
	const matched = new Set<number>();
	if (needle.length < 2 || haystack.length < 2) {
		return matched;
	}
	for (let index = 0; index < needle.length - 1; index += 1) {
		const left = needle[index];
		const right = needle[index + 1];
		for (let offset = 0; offset < haystack.length - 1; offset += 1) {
			if (haystack[offset] === left && haystack[offset + 1] === right) {
				matched.add(index);
				break;
			}
		}
	}
	return matched;
}

export function buildCoverageLexicalV2PreparedStreamingSubsequence(
	needle: readonly number[],
): CoverageLexicalV2PreparedStreamingSubsequence {
	return {
		needle,
		lps: buildCoverageLexicalV2KmpPrefixTable(needle),
	};
}

export function scanCoverageLexicalV2NumericTokenRange(
	tape: Uint8Array,
	range: CoverageLexicalV2TokenRange,
	onValue: (value: number) => boolean | void,
): boolean {
	let value = 0;
	let shift = 0;
	for (let index = range.start; index < range.end; index += 1) {
		const byte = tape[index];
		value |= (byte & 0x7f) << shift;
		if ((byte & 0x80) !== 0) {
			shift += 7;
			continue;
		}
		if (onValue(value >>> 0) === false) {
			return false;
		}
		value = 0;
		shift = 0;
	}
	return true;
}

export function containsCoverageLexicalV2NumericSubsequenceStreaming(
	tape: Uint8Array,
	range: CoverageLexicalV2TokenRange,
	prepared: CoverageLexicalV2PreparedStreamingSubsequence,
): boolean {
	if (prepared.needle.length === 0) {
		return true;
	}
	let matchedLength = 0;
	let found = false;
	scanCoverageLexicalV2NumericTokenRange(tape, range, (value) => {
		while (
			matchedLength > 0 &&
			value !== prepared.needle[matchedLength]
		) {
			matchedLength = prepared.lps[matchedLength - 1] ?? 0;
		}
		if (value === prepared.needle[matchedLength]) {
			matchedLength += 1;
			if (matchedLength >= prepared.needle.length) {
				found = true;
				return false;
			}
			return true;
		}
		return true;
	});
	return found;
}

export function collectCoverageLexicalV2NumericBigramMatchIndicesStreaming(
	tape: Uint8Array,
	range: CoverageLexicalV2TokenRange,
	bigramIndexByKey: ReadonlyMap<string, number>,
): Set<number> {
	const matched = new Set<number>();
	let previous: number | null = null;
	scanCoverageLexicalV2NumericTokenRange(tape, range, (value) => {
		if (previous != null) {
			const index = bigramIndexByKey.get(
				String(previous) + ":" + String(value),
			);
			if (index !== undefined) {
				matched.add(index);
			}
		}
		previous = value;
		return true;
	});
	return matched;
}

function buildCoverageLexicalV2KmpPrefixTable(needle: readonly number[]): number[] {
	if (needle.length === 0) {
		return [];
	}
	const lps = new Array<number>(needle.length).fill(0);
	let length = 0;
	for (let index = 1; index < needle.length; ) {
		if (needle[index] === needle[length]) {
			length += 1;
			lps[index] = length;
			index += 1;
			continue;
		}
		if (length > 0) {
			length = lps[length - 1] ?? 0;
			continue;
		}
		lps[index] = 0;
		index += 1;
	}
	return lps;
}
