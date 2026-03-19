import {
	BIG_CHUNK_MAX,
	BIG_CHUNK_TARGET,
	SMALL_CHUNK_OVERLAP,
	SMALL_CHUNK_TARGET,
	type RawBigChunk,
	type RawChunk,
} from './hybrid-types';

export type ChunkerOutput = {
	bigChunks: RawBigChunk[];
	chunks: RawChunk[];
};

// Matches ATX headings: #, ##, ### at start of line
const HEADING_REGEX = /^#{1,3}\s/m;

/**
 * Build a line-start offset array for O(1) line-number lookup.
 * lineOffsets[i] = char offset of line i (0-indexed).
 */
function buildLineOffsets(text: string): number[] {
	const offsets = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\n') offsets.push(i + 1);
	}
	return offsets;
}

/** Binary search: return 0-indexed line number for a char offset. */
function offsetToLine(offsets: number[], offset: number): number {
	let lo = 0, hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/**
 * Split text at sentence/newline boundaries to stay under maxLen.
 * Returns array of sub-strings.
 */
function splitLongParagraph(text: string, maxLen: number): string[] {
	if (text.length <= maxLen) return [text];
	const result: string[] = [];
	let remaining = text;
	while (remaining.length > maxLen) {
		// Try to cut at last sentence-ending punctuation before maxLen
		const slice = remaining.slice(0, maxLen);
		const lastPunct = Math.max(
			slice.lastIndexOf('。'),
			slice.lastIndexOf('. '),
			slice.lastIndexOf('!\n'),
			slice.lastIndexOf('?\n'),
			slice.lastIndexOf('\n'),
		);
		const cutAt = lastPunct > maxLen * 0.4 ? lastPunct + 1 : maxLen;
		result.push(remaining.slice(0, cutAt).trim());
		remaining = remaining.slice(cutAt).trim();
	}
	if (remaining.length > 0) result.push(remaining);
	return result;
}

/**
 * Segment plainText into big chunks (section-level).
 * Strategy:
 *   1. Split on ATX headings (# / ## / ###).
 *   2. Within each heading section, further split on blank lines if > BIG_CHUNK_TARGET.
 *   3. Merge tiny paragraphs with the next one.
 *   4. Split oversized paragraphs at sentence boundaries.
 */
function segmentBigChunks(text: string): Array<{ text: string; startOffset: number; endOffset: number }> {
	const lineOffsets = buildLineOffsets(text);
	const lines = text.split('\n');

	// Group lines into heading-sections
	const sections: Array<{ heading: string; body: string[]; startLine: number }> = [];
	let currentHeading = '';
	let currentBody: string[] = [];
	let currentStartLine = 0;

	for (let i = 0; i < lines.length; i++) {
		if (HEADING_REGEX.test(lines[i])) {
			if (currentBody.length > 0 || currentHeading) {
				sections.push({ heading: currentHeading, body: currentBody, startLine: currentStartLine });
			}
			currentHeading = lines[i];
			currentBody = [];
			currentStartLine = i;
		} else {
			currentBody.push(lines[i]);
		}
	}
	sections.push({ heading: currentHeading, body: currentBody, startLine: currentStartLine });

	const result: Array<{ text: string; startOffset: number; endOffset: number }> = [];

	for (const section of sections) {
		const headingPrefix = section.heading ? section.heading + '\n' : '';
		const bodyText = section.body.join('\n');

		// Split body on blank lines (paragraph boundaries)
		const paragraphs = bodyText.split(/\n{2,}/);
		let buffer = headingPrefix;
		let bufferStartLine = section.startLine;

		const flush = (text: string, startLine: number) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			// Split if oversized
			const parts = splitLongParagraph(trimmed, BIG_CHUNK_MAX);
			let lineOffset = startLine;
			for (const part of parts) {
				const partLines = part.split('\n').length;
				const startOff = lineOffsets[lineOffset] ?? text.length;
				const endLine = Math.min(lineOffset + partLines - 1, lineOffsets.length - 1);
				const endOff = lineOffsets[endLine + 1] !== undefined
					? lineOffsets[endLine + 1] - 1
					: text.length;
				result.push({ text: part, startOffset: startOff, endOffset: endOff });
				lineOffset += partLines;
			}
		};

		for (const para of paragraphs) {
			if (!para.trim()) continue;
			const candidate = buffer + para;
			if (candidate.length > BIG_CHUNK_TARGET && buffer.trim().length > 0) {
				flush(buffer, bufferStartLine);
				buffer = headingPrefix + para;
				bufferStartLine = section.startLine + section.body.indexOf(para.split('\n')[0]);
			} else {
				buffer = candidate + '\n\n';
			}
		}
		if (buffer.trim()) flush(buffer, bufferStartLine);
	}

	return result;
}

/**
 * Sliding-window small chunks over a big chunk's text.
 * Target ~SMALL_CHUNK_TARGET chars, overlap ~SMALL_CHUNK_OVERLAP chars.
 */
function makeSmallChunks(bigChunkIdx: number, text: string): RawChunk[] {
	const chunks: RawChunk[] = [];
	if (text.length <= SMALL_CHUNK_TARGET) {
		chunks.push({ bigChunkIdx, text });
		return chunks;
	}

	let start = 0;
	while (start < text.length) {
		const end = Math.min(start + SMALL_CHUNK_TARGET, text.length);
		chunks.push({ bigChunkIdx, text: text.slice(start, end) });
		if (end === text.length) break;
		start = end - SMALL_CHUNK_OVERLAP;
	}
	return chunks;
}

/**
 * Main entry point.
 * @param filePath  vault-relative file path (stored in BigChunk for retrieval)
 * @param plainText plain text content of the file (Markdown OK)
 */
export function chunkFile(filePath: string, plainText: string): ChunkerOutput {
	const lineOffsets = buildLineOffsets(plainText);
	const segments = segmentBigChunks(plainText);

	const bigChunks: RawBigChunk[] = [];
	const chunks: RawChunk[] = [];

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const startLine = offsetToLine(lineOffsets, seg.startOffset);
		const endLine = offsetToLine(lineOffsets, seg.endOffset);

		bigChunks.push({
			filePath,
			text: seg.text,
			startLine,
			endLine,
		});

		const smallChunks = makeSmallChunks(i, seg.text);
		for (const sc of smallChunks) chunks.push(sc);
	}

	return { bigChunks, chunks };
}
