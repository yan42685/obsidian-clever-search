import {
	BIG_CHUNK_MAX,
	BIG_CHUNK_TARGET,
	CHUNK_MAX_OVERFLOW_RATIO,
	CHUNK_OVERLAP_MAX_RATIO,
	CHUNK_OVERLAP_MIN_RATIO,
	CHUNK_OVERLAP_TARGET_RATIO,
	SMALL_CHUNK_TARGET,
	type RawBigChunk,
	type RawChunk,
} from "./hybrid-types";

export type ChunkerOutput = {
	bigChunks: RawBigChunk[];
	chunks: RawChunk[];
};

type ChunkRange = {
	startOffset: number;
	endOffset: number;
};

const TOKEN_UNIT_SCALE = 20;
const TOKEN_UNITS_WIDE = 13; // 0.65
const TOKEN_UNITS_ASCII = 5; // 0.25
const TOKEN_UNITS_ASCII_STRUCTURAL = 7; // 0.35
const TOKEN_UNITS_UNICODE_OTHER = 8; // 0.4

const SENTENCE_BOUNDARY_CHARS = new Set(["\u3002", "\uff01", "\uff1f", ".", "!", "?"]);
const CLOSING_BOUNDARY_CHARS = new Set([
	'"',
	"'",
	"\u201d",
	"\u2019",
	")",
	"]",
	"}",
	"\uff09",
	"\u3011",
	"\u300b",
	"\u300d",
	"\u300f",
]);

/**
 * Build a line-start offset array for O(1) line-number lookup.
 * lineOffsets[i] = char offset of line i (0-indexed).
 */
function buildLineOffsets(text: string): number[] {
	const offsets = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") offsets.push(i + 1);
	}
	return offsets;
}

/** Binary search: return 0-indexed line number for a char offset. */
function offsetToLine(offsets: number[], offset: number): number {
	let lo = 0;
	let hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

function isWhitespaceCharCode(code: number): boolean {
	return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isWideCharCode(code: number): boolean {
	return (
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0x3040 && code <= 0x30ff) ||
		(code >= 0x31f0 && code <= 0x31ff) ||
		(code >= 0xac00 && code <= 0xd7af) ||
		(code >= 0x1100 && code <= 0x11ff) ||
		(code >= 0x3000 && code <= 0x303f) ||
		(code >= 0xff01 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffee)
	);
}

function isAsciiStructuralCharCode(code: number): boolean {
	return (
		(code >= 0x30 && code <= 0x39) ||
		code === 0x2f || // /
		code === 0x5c || // \
		code === 0x2e || // .
		code === 0x5f || // _
		code === 0x2d || // -
		code === 0x3a || // :
		code === 0x23 || // #
		code === 0x25 || // %
		code === 0x3f || // ?
		code === 0x26 || // &
		code === 0x3d || // =
		code === 0x2b || // +
		code === 0x40 || // @
		code === 0x7e || // ~
		code === 0x60 // `
	);
}

function charTokenUnits(code: number): number {
	if (isWhitespaceCharCode(code)) {
		return 0;
	}
	if (code <= 0x7f) {
		return isAsciiStructuralCharCode(code)
			? TOKEN_UNITS_ASCII_STRUCTURAL
			: TOKEN_UNITS_ASCII;
	}
	if (isWideCharCode(code)) {
		return TOKEN_UNITS_WIDE;
	}
	return TOKEN_UNITS_UNICODE_OTHER;
}

function buildTokenPrefix(text: string): Uint32Array {
	const prefix = new Uint32Array(text.length + 1);
	for (let i = 0; i < text.length; i++) {
		prefix[i + 1] = prefix[i] + charTokenUnits(text.charCodeAt(i));
	}
	return prefix;
}

export function estimateTokenCount(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	const prefix = buildTokenPrefix(text);
	return prefix[prefix.length - 1] / TOKEN_UNIT_SCALE;
}

function buildPreferredBoundaries(text: string): number[] {
	const boundaries = new Set<number>([0, text.length]);
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "\n") {
			boundaries.add(i + 1);
			continue;
		}
		if (!SENTENCE_BOUNDARY_CHARS.has(char)) {
			continue;
		}

		let boundary = i + 1;
		while (
			boundary < text.length &&
			CLOSING_BOUNDARY_CHARS.has(text[boundary])
		) {
			boundary++;
		}
		if (text[boundary] === "\r") boundary++;
		if (text[boundary] === "\n") boundary++;
		boundaries.add(boundary);
	}
	return Array.from(boundaries).sort((a, b) => a - b);
}

function lowerBound(
	values: Uint32Array,
	target: number,
	start = 0,
	end = values.length,
): number {
	let lo = start;
	let hi = end;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid] < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function offsetForForwardTokens(
	prefix: Uint32Array,
	startOffset: number,
	targetTokens: number,
	textLength: number,
): number {
	const targetValue =
		prefix[startOffset] + Math.ceil(targetTokens * TOKEN_UNIT_SCALE);
	const index = lowerBound(prefix, targetValue, startOffset + 1);
	return Math.min(index, textLength);
}

function offsetForBackwardTokens(
	prefix: Uint32Array,
	endOffset: number,
	targetTokens: number,
): number {
	const targetValue = Math.max(
		0,
		prefix[endOffset] - Math.ceil(targetTokens * TOKEN_UNIT_SCALE),
	);
	return lowerBound(prefix, targetValue, 0, endOffset);
}

function pickClosestBoundary(
	candidates: number[],
	targetOffset: number,
): number {
	let best = candidates[0];
	let bestDistance = Math.abs(best - targetOffset);
	for (let i = 1; i < candidates.length; i++) {
		const candidate = candidates[i];
		const distance = Math.abs(candidate - targetOffset);
		if (
			distance < bestDistance ||
			(distance === bestDistance && candidate > best)
		) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

function createChunkRanges(
	text: string,
	targetTokens: number,
	maxTokens: number,
): ChunkRange[] {
	if (!text.trim()) {
		return [];
	}

	const tokenPrefix = buildTokenPrefix(text);
	const preferredBoundaries = buildPreferredBoundaries(text);
	const textLength = text.length;
	const ranges: ChunkRange[] = [];
	let startOffset = 0;

	while (startOffset < textLength) {
		while (
			startOffset < textLength &&
			isWhitespaceCharCode(text.charCodeAt(startOffset))
		) {
			startOffset++;
		}
		if (startOffset >= textLength) {
			break;
		}

		const remainingTokens =
			(tokenPrefix[textLength] - tokenPrefix[startOffset]) /
			TOKEN_UNIT_SCALE;
		let endOffset: number;
		if (remainingTokens <= maxTokens) {
			endOffset = textLength;
		} else {
			const targetOffset = offsetForForwardTokens(
				tokenPrefix,
				startOffset,
				targetTokens,
				textLength,
			);
			const maxOffset = offsetForForwardTokens(
				tokenPrefix,
				startOffset,
				maxTokens,
				textLength,
			);
			const minPreferredOffset = offsetForForwardTokens(
				tokenPrefix,
				startOffset,
				targetTokens * 0.75,
				textLength,
			);
			const boundaryCandidates = preferredBoundaries.filter(
				(offset) =>
					offset > startOffset &&
					offset <= maxOffset &&
					offset >= minPreferredOffset,
			);
			endOffset =
				boundaryCandidates.length > 0
					? pickClosestBoundary(boundaryCandidates, targetOffset)
					: Math.max(startOffset + 1, maxOffset);
		}

		if (endOffset <= startOffset) {
			break;
		}
		ranges.push({ startOffset, endOffset });
		if (endOffset >= textLength) {
			break;
		}

		const earliestNextStart = offsetForBackwardTokens(
			tokenPrefix,
			endOffset,
			targetTokens * CHUNK_OVERLAP_MAX_RATIO,
		);
		const latestNextStart = offsetForBackwardTokens(
			tokenPrefix,
			endOffset,
			targetTokens * CHUNK_OVERLAP_MIN_RATIO,
		);
		const desiredNextStart = offsetForBackwardTokens(
			tokenPrefix,
			endOffset,
			targetTokens * CHUNK_OVERLAP_TARGET_RATIO,
		);
		const overlapCandidates = preferredBoundaries.filter(
			(offset) =>
				offset > startOffset &&
				offset < endOffset &&
				offset >= earliestNextStart &&
				offset <= latestNextStart,
		);
		const nextStart =
			overlapCandidates.length > 0
				? pickClosestBoundary(overlapCandidates, desiredNextStart)
				: Math.min(
					endOffset - 1,
					Math.max(startOffset + 1, desiredNextStart),
				);

		startOffset = nextStart;
	}

	return ranges;
}

/**
 * Sliding-window small chunks over a big chunk's text.
 * Target ~SMALL_CHUNK_TARGET tokens, overlap ~16% with sentence/newline boundaries.
 */
function makeSmallChunks(bigChunkIdx: number, text: string): RawChunk[] {
	return createChunkRanges(
		text,
		SMALL_CHUNK_TARGET,
		SMALL_CHUNK_TARGET * (1 + CHUNK_MAX_OVERFLOW_RATIO),
	)
		.map((range) => ({
			bigChunkIdx,
			text: text.slice(range.startOffset, range.endOffset),
		}))
		.filter((chunk) => chunk.text.trim().length > 0);
}

/**
 * Main entry point.
 * @param filePath  vault-relative file path (stored in BigChunk for retrieval)
 * @param plainText plain text content of the file (Markdown OK)
 */
export function chunkFile(filePath: string, plainText: string): ChunkerOutput {
	const lineOffsets = buildLineOffsets(plainText);
	const segments = createChunkRanges(plainText, BIG_CHUNK_TARGET, BIG_CHUNK_MAX);

	const bigChunks: RawBigChunk[] = [];
	const chunks: RawChunk[] = [];

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const startLine = offsetToLine(lineOffsets, seg.startOffset);
		const lastOffset = Math.max(seg.startOffset, seg.endOffset - 1);
		const endLine = offsetToLine(lineOffsets, lastOffset);
		const startCol = seg.startOffset - (lineOffsets[startLine] ?? 0);
		const text = plainText.slice(seg.startOffset, seg.endOffset);
		if (!text.trim()) continue;

		bigChunks.push({
			filePath,
			text,
			startLine,
			startCol,
			endLine,
		});

		const smallChunks = makeSmallChunks(bigChunks.length - 1, text);
		for (const sc of smallChunks) chunks.push(sc);
	}

	return { bigChunks, chunks };
}
