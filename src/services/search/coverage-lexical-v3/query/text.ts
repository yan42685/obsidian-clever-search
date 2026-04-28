const RAW_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const HAN_SEQUENCE_REGEX = /\p{Script=Han}+/gu;
const HAN_REGEX = /\p{Script=Han}/u;
const LATIN_REGEX = /[a-z0-9]/u;
const TAG_SPLIT_REGEX = /\s+/u;
export const V3_BODY_BLOCK_TARGET_TOKENS = 300;
export const V3_BODY_BLOCK_MAX_OVERFLOW_RATIO = 0.15;
export const V3_BODY_BLOCK_MAX_TOKENS =
	V3_BODY_BLOCK_TARGET_TOKENS * (1 + V3_BODY_BLOCK_MAX_OVERFLOW_RATIO);
const BODY_BLOCK_TOKEN_UNIT_SCALE = 20;
const BODY_BLOCK_TOKEN_UNITS_WIDE = 13; // 0.65
const BODY_BLOCK_TOKEN_UNITS_ASCII = 5; // 0.25
const BODY_BLOCK_TOKEN_UNITS_ASCII_STRUCTURAL = 7; // 0.35
const BODY_BLOCK_TOKEN_UNITS_UNICODE_OTHER = 8; // 0.4
const BODY_BLOCK_TOKEN_CHECKPOINT_STRIDE = 1024;
const BODY_BLOCK_SENTENCE_BOUNDARY_CHARS = new Set([
	"\u3002",
	"\uff01",
	"\uff1f",
	".",
	"!",
	"?",
]);
const BODY_BLOCK_CLOSING_BOUNDARY_CHARS = new Set([
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
const SINGLETON_HAN_STOP_CHARS = new Set([
	"的",
	"了",
	"是",
	"在",
	"和",
	"与",
	"及",
	"就",
	"都",
	"也",
	"很",
	"把",
	"被",
	"为",
	"于",
	"或",
	"而",
	"又",
	"并",
	"之",
]);

export type V3SurfaceKind = "latin" | "han" | "mixed" | "other";
export type V3DocumentTokenizer = (text: string) => readonly string[];
export const BODY_FAMILY_SUPPORT_STANDALONE = 1 << 0;
export const BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD = 1 << 1;
export type V3TextOccurrence = Readonly<{
	text: string;
	startOffset: number;
}>;
export type V3FamilyOccurrence = V3TextOccurrence &
	Readonly<{
		bodySupportMask: number;
	}>;

export type V3BodyBlockDraft = Readonly<{
	ordinal: number;
	normalizedText: string;
	familyTexts: readonly string[];
	exactFamilyTexts: readonly string[];
	exactFamilyStartOffsets: readonly number[];
	exactFamilySupportMasks: readonly number[];
	hanWitnessTexts: readonly string[];
	hanWitnessStartOffsets: readonly number[];
	hanBigramTexts: readonly string[];
	spanLength: number;
}>;

type TokenCheckpointLookup = Readonly<{
	textLength: number;
	checkpointStride: number;
	checkpoints: Uint32Array;
	totalUnits: number;
}>;

type ChunkRange = Readonly<{
	startOffset: number;
	endOffset: number;
}>;

export type V3BodyBlockChunkRange = ChunkRange;

export function normalizeText(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

export function classifySurfaceKind(text: string): V3SurfaceKind {
	const normalized = normalizeText(text);
	const hasHan = HAN_REGEX.test(normalized);
	const hasLatin = LATIN_REGEX.test(normalized);
	if (hasHan && hasLatin) {
		return "mixed";
	}
	if (hasHan) {
		return "han";
	}
	if (hasLatin) {
		return "latin";
	}
	return "other";
}

export function extractFamilyTexts(text: string): string[] {
	const normalized = normalizeText(text);
	const out: string[] = [];
	const seen = new Set<string>();
	for (const match of normalized.matchAll(RAW_SEGMENT_REGEX)) {
		const token = match[0].trim();
		if (token.length === 0 || seen.has(token)) {
			continue;
		}
		seen.add(token);
		out.push(token);
	}
	return out;
}

export function splitTagValues(tagsText: string): string[] {
	return normalizeText(tagsText)
		.split(TAG_SPLIT_REGEX)
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

export function extractDocumentFamilyTexts(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): string[] {
	return dedupePreservingOrder(
		extractDocumentFamilyOccurrences(text, tokenizeDocumentText).map(
			(occurrence) => occurrence.text,
		),
	);
}

export function extractDocumentFamilyTextSetOnly(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(RAW_SEGMENT_REGEX)) {
		const rawToken = match[0] ?? "";
		const token = normalizeText(rawToken).trim();
		if (token.length === 0) {
			continue;
		}
		if (classifySurfaceKind(token) !== "han") {
			pushLatinFamilyTexts(out, seen, rawToken);
			continue;
		}
		if (tokenizeDocumentText == null) {
			pushFamilyText(out, seen, token);
			continue;
		}
		for (const term of collectHanTokenizerTerms(token, tokenizeDocumentText)) {
			pushFamilyText(out, seen, term);
		}
	}
	return out;
}

export function extractDocumentFamilySequence(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): string[] {
	return extractDocumentFamilyOccurrences(text, tokenizeDocumentText).map(
		(occurrence) => occurrence.text,
	);
}

export function extractDocumentFamilyOccurrences(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): V3TextOccurrence[] {
	return extractDocumentFamilySupportOccurrences(text, tokenizeDocumentText).map(
		({ text: occurrenceText, startOffset: occurrenceStartOffset }) => ({
			text: occurrenceText,
			startOffset: occurrenceStartOffset,
		}),
	);
}

export function extractDocumentFamilySupportOccurrences(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): V3FamilyOccurrence[] {
	const out: V3FamilyOccurrence[] = [];
	for (const match of text.matchAll(RAW_SEGMENT_REGEX)) {
		const rawToken = match[0] ?? "";
		const token = normalizeText(rawToken).trim();
		const startOffset = match.index ?? 0;
		if (token.length === 0) {
			continue;
		}
		if (classifySurfaceKind(token) !== "han") {
			out.push(...collectLatinFamilyOccurrences(rawToken, startOffset));
			continue;
		}
		if (tokenizeDocumentText == null) {
			out.push({
				text: token,
				startOffset,
				bodySupportMask: BODY_FAMILY_SUPPORT_STANDALONE,
			});
			continue;
		}
		const hanTerms = collectHanTokenizerTerms(token, tokenizeDocumentText);
		for (const occurrence of collectHanTokenizerOccurrences(token, hanTerms)) {
			out.push({
				text: occurrence.text,
				startOffset: startOffset + occurrence.startOffset,
				bodySupportMask: BODY_FAMILY_SUPPORT_STANDALONE,
			});
		}
	}
	return out
		.map((occurrence, index) => ({
			...occurrence,
			sequenceOrdinal: index,
		}))
		.sort((left, right) =>
			left.startOffset - right.startOffset ||
			left.sequenceOrdinal - right.sequenceOrdinal ||
			left.text.localeCompare(right.text),
		)
		.map(
			({ text: occurrenceText, startOffset: occurrenceStartOffset, bodySupportMask }) => ({
				text: occurrenceText,
				startOffset: occurrenceStartOffset,
				bodySupportMask,
			}),
		);
}

export function extractHanSegments(text: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const match of normalizeText(text).matchAll(HAN_SEQUENCE_REGEX)) {
		const segment = match[0];
		if (segment.length === 0 || seen.has(segment)) {
			continue;
		}
		seen.add(segment);
		out.push(segment);
	}
	return out;
}

export function extractOrderedHanSegments(text: string): string[] {
	return extractOrderedHanSegmentOccurrences(text).map(
		(occurrence) => occurrence.text,
	);
}

export function extractOrderedHanSegmentOccurrences(
	text: string,
): V3TextOccurrence[] {
	return [...normalizeText(text).matchAll(HAN_SEQUENCE_REGEX)]
		.map((match) => ({
			text: match[0]?.trim() ?? "",
			startOffset: match.index ?? 0,
		}))
		.filter((occurrence) => occurrence.text.length > 0);
}

export function extractHanBigrams(text: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const match of normalizeText(text).matchAll(HAN_SEQUENCE_REGEX)) {
		const chars = Array.from(match[0]);
		for (let index = 0; index < chars.length - 1; index += 1) {
			const bigram = chars[index] + chars[index + 1];
			if (seen.has(bigram)) {
				continue;
			}
			seen.add(bigram);
			out.push(bigram);
		}
	}
	return out;
}

export function extractHanChars(text: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const match of normalizeText(text).matchAll(HAN_SEQUENCE_REGEX)) {
		for (const char of Array.from(match[0])) {
			if (seen.has(char)) {
				continue;
			}
			seen.add(char);
			out.push(char);
		}
	}
	return out;
}

export function countHanCodepoints(text: string): number {
	let count = 0;
	for (const match of normalizeText(text).matchAll(HAN_SEQUENCE_REGEX)) {
		count += Array.from(match[0]).length;
	}
	return count;
}

export function encodeHanBigramId(bigram: string): number {
	const chars = Array.from(bigram);
	const left = chars[0]?.codePointAt(0) ?? 0;
	const right = chars[1]?.codePointAt(0) ?? 0;
	let hash = 0x811c9dc5;
	hash ^= left;
	hash = Math.imul(hash, 0x01000193);
	hash ^= right;
	hash = Math.imul(hash, 0x01000193);
	return hash >>> 0;
}

export function encodeHanCharId(char: string): number {
	return (Array.from(char)[0]?.codePointAt(0) ?? 0) >>> 0;
}

export function isSingletonHanStopChar(char: string): boolean {
	const normalizedChar = normalizeText(char).trim();
	return normalizedChar.length > 0 && SINGLETON_HAN_STOP_CHARS.has(normalizedChar);
}

export function splitBodyBlocks(text: string): V3BodyBlockDraft[] {
	const normalized = normalizeText(text).replace(/\r\n?/gu, "\n");
	return splitNormalizedBodyBlockTexts(normalized)
		.map<V3BodyBlockDraft>((block, index) => {
			const exactFamilyOccurrences = extractOrderedFamilySupportOccurrences(block);
			const hanWitnessOccurrences = extractOrderedHanSegmentOccurrences(block);
			return {
				ordinal: index,
				normalizedText: block,
				familyTexts: exactFamilyOccurrences.map((occurrence) => occurrence.text),
				exactFamilyTexts: exactFamilyOccurrences.map((occurrence) => occurrence.text),
				exactFamilyStartOffsets: exactFamilyOccurrences.map(
					(occurrence) => occurrence.startOffset,
				),
				exactFamilySupportMasks: exactFamilyOccurrences.map(
					(occurrence) => occurrence.bodySupportMask,
				),
				hanWitnessTexts: hanWitnessOccurrences.map((occurrence) => occurrence.text),
				hanWitnessStartOffsets: hanWitnessOccurrences.map(
					(occurrence) => occurrence.startOffset,
				),
				hanBigramTexts: extractHanBigrams(block),
				spanLength: block.length,
			};
		})
		.filter((block) => block.familyTexts.length > 0);
}

export function splitBodyBlocksWithDocumentTokenizer(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): V3BodyBlockDraft[] {
	const normalized = normalizeText(text).replace(/\r\n?/gu, "\n");
	return splitNormalizedBodyBlockTexts(normalized)
		.map<V3BodyBlockDraft>((block, index) => {
			const exactFamilyOccurrences = extractDocumentFamilySupportOccurrences(
				block,
				tokenizeDocumentText,
			);
			const hanWitnessOccurrences = extractOrderedHanSegmentOccurrences(block);
			return {
				ordinal: index,
				normalizedText: block,
				familyTexts: dedupePreservingOrder(
					exactFamilyOccurrences.map((occurrence) => occurrence.text),
				),
				exactFamilyTexts: exactFamilyOccurrences.map((occurrence) => occurrence.text),
				exactFamilyStartOffsets: exactFamilyOccurrences.map(
					(occurrence) => occurrence.startOffset,
				),
				exactFamilySupportMasks: exactFamilyOccurrences.map(
					(occurrence) => occurrence.bodySupportMask,
				),
				hanWitnessTexts: hanWitnessOccurrences.map((occurrence) => occurrence.text),
				hanWitnessStartOffsets: hanWitnessOccurrences.map(
					(occurrence) => occurrence.startOffset,
				),
				hanBigramTexts: extractHanBigrams(block),
				spanLength: block.length,
			};
		})
		.filter(
			(block) =>
				block.familyTexts.length > 0 ||
				block.hanWitnessTexts.length > 0 ||
				block.hanBigramTexts.length > 0,
		);
}

export function splitBodyBlockFamilyTextSetsWithDocumentTokenizer(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): string[][] {
	const normalized = normalizeText(text).replace(/\r\n?/gu, "\n");
	return splitNormalizedBodyBlockTexts(normalized)
		.map((block) => extractDocumentFamilyTextSetOnly(block, tokenizeDocumentText))
		.filter((familyTexts) => familyTexts.length > 0);
}

export function extractOrderedFamilyOccurrences(text: string): V3TextOccurrence[] {
	return extractOrderedFamilySupportOccurrences(text).map(
		({ text: occurrenceText, startOffset: occurrenceStartOffset }) => ({
			text: occurrenceText,
			startOffset: occurrenceStartOffset,
		}),
	);
}

export function extractOrderedFamilySupportOccurrences(
	text: string,
): V3FamilyOccurrence[] {
	const out: V3FamilyOccurrence[] = [];
	for (const match of text.matchAll(RAW_SEGMENT_REGEX)) {
		const token = normalizeText(match[0] ?? "").trim();
		if (token.length === 0) {
			continue;
		}
		out.push({
			text: token,
			startOffset: match.index ?? 0,
			bodySupportMask: BODY_FAMILY_SUPPORT_STANDALONE,
		});
	}
	return out;
}

export function extractOrderedFamilySequence(text: string): string[] {
	return extractOrderedFamilyOccurrences(text).map((occurrence) => occurrence.text);
}

function collectHanTokenizerTerms(
	surfaceText: string,
	tokenizeDocumentText: V3DocumentTokenizer,
): string[] {
	const out: string[] = [];
	for (const term of tokenizeDocumentText(surfaceText)) {
		const normalized = normalizeText(term).trim();
		if (normalized.length === 0) {
			continue;
		}
		if (classifySurfaceKind(normalized) !== "han") {
			continue;
		}
		if (Array.from(normalized).length < 2) {
			continue;
		}
		if (!surfaceText.includes(normalized)) {
			continue;
		}
		out.push(normalized);
	}
	return out;
}

function collectLatinFamilyOccurrences(
	rawToken: string,
	startOffset: number,
): V3FamilyOccurrence[] {
	const occurrences: V3FamilyOccurrence[] = [];
	const seen = new Set<string>();
	const hasCompoundDelimiter = /[-_]/u.test(rawToken);
	pushLatinOccurrence(
		occurrences,
		seen,
		normalizeText(rawToken).trim(),
		startOffset,
		BODY_FAMILY_SUPPORT_STANDALONE,
	);
	for (const segment of collectLatinWordSegments(rawToken, startOffset)) {
		const normalizedSegment = normalizeText(segment.text).trim();
		pushLatinOccurrence(
		occurrences,
		seen,
		normalizedSegment,
		segment.startOffset,
		hasCompoundDelimiter
			? BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD
			: BODY_FAMILY_SUPPORT_STANDALONE,
		);
		for (const part of splitCamelCaseSegments(segment.text, segment.startOffset)) {
			pushLatinOccurrence(
				occurrences,
				seen,
				normalizeText(part.text).trim(),
				part.startOffset,
				BODY_FAMILY_SUPPORT_STANDALONE,
			);
		}
	}
	return occurrences;
}

function pushLatinFamilyTexts(
	target: string[],
	seen: Set<string>,
	rawToken: string,
): void {
	pushFamilyText(target, seen, normalizeText(rawToken).trim());
	for (const segment of collectLatinWordSegments(rawToken, 0)) {
		pushFamilyText(target, seen, normalizeText(segment.text).trim());
		for (const part of splitCamelCaseSegments(segment.text, 0)) {
			pushFamilyText(target, seen, normalizeText(part.text).trim());
		}
	}
}

function pushFamilyText(
	target: string[],
	seen: Set<string>,
	text: string,
): void {
	if (text.length === 0 || seen.has(text)) {
		return;
	}
	seen.add(text);
	target.push(text);
}

function pushLatinOccurrence(
	target: V3FamilyOccurrence[],
	seen: Set<string>,
	text: string,
	startOffset: number,
	bodySupportMask: number,
): void {
	if (text.length === 0) {
		return;
	}
	const key = `${startOffset}:${text}`;
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	target.push({ text, startOffset, bodySupportMask });
}

function collectLatinWordSegments(
	rawToken: string,
	tokenStartOffset: number,
): V3TextOccurrence[] {
	const segments: V3TextOccurrence[] = [];
	for (const match of rawToken.matchAll(/[a-z0-9]+/giu)) {
		const text = match[0] ?? "";
		if (text.length === 0) {
			continue;
		}
		segments.push({
			text,
			startOffset: tokenStartOffset + (match.index ?? 0),
		});
	}
	return segments;
}

function splitCamelCaseSegments(
	rawSegment: string,
	segmentStartOffset: number,
): V3TextOccurrence[] {
	const parts: V3TextOccurrence[] = [];
	let start = 0;
	for (let index = 0; index < rawSegment.length; index += 1) {
		const current = rawSegment[index];
		const previous = index > 0 ? rawSegment[index - 1] : "";
		const next = index + 1 < rawSegment.length ? rawSegment[index + 1] : "";
		const shouldSplit =
			(previous >= "a" &&
				previous <= "z" &&
				current >= "A" &&
				current <= "Z") ||
			(previous >= "A" &&
				previous <= "Z" &&
				current >= "A" &&
				current <= "Z" &&
				next >= "a" &&
				next <= "z");
		if (!shouldSplit) {
			continue;
		}
		if (index > start) {
			parts.push({
				text: rawSegment.slice(start, index),
				startOffset: segmentStartOffset + start,
			});
		}
		start = index;
	}
	if (start < rawSegment.length) {
		parts.push({
			text: rawSegment.slice(start),
			startOffset: segmentStartOffset + start,
		});
	}
	return parts.filter((part) => part.text.length > 1);
}

function collectHanTokenizerOccurrences(
	surfaceText: string,
	hanTerms: readonly string[],
): V3TextOccurrence[] {
	const orderedOccurrences: V3TextOccurrence[] = [];
	const offsetsByTerm = new Map<string, number[]>();
	const consumedCountByTerm = new Map<string, number>();
	for (const term of hanTerms) {
		let offsets = offsetsByTerm.get(term);
		if (offsets == null) {
			offsets = findOverlappingMatchOffsets(surfaceText, term);
			offsetsByTerm.set(term, offsets);
		}
		if (offsets.length === 0) {
			continue;
		}
		const consumedCount = consumedCountByTerm.get(term) ?? 0;
		const startOffset = offsets[Math.min(consumedCount, offsets.length - 1)] ?? -1;
		if (startOffset < 0) {
			continue;
		}
		consumedCountByTerm.set(term, consumedCount + 1);
		orderedOccurrences.push({ text: term, startOffset });
	}
	return orderedOccurrences
		.map((occurrence, index) => ({
			...occurrence,
			sequenceOrdinal: index,
		}))
		.sort((left, right) =>
			left.startOffset - right.startOffset ||
			left.sequenceOrdinal - right.sequenceOrdinal ||
			left.text.localeCompare(right.text),
		)
		.map(({ text, startOffset }) => ({ text, startOffset }));
}

function findOverlappingMatchOffsets(text: string, term: string): number[] {
	const offsets: number[] = [];
	let searchStart = 0;
	while (searchStart <= text.length - term.length) {
		const matchIndex = text.indexOf(term, searchStart);
		if (matchIndex < 0) {
			break;
		}
		offsets.push(matchIndex);
		searchStart = matchIndex + 1;
	}
	return offsets;
}

function splitNormalizedBodyBlockTexts(normalizedText: string): string[] {
	if (normalizedText.trim().length === 0) {
		return [];
	}
	return createV3BodyBlockChunkRanges(
		normalizedText,
		V3_BODY_BLOCK_TARGET_TOKENS,
		V3_BODY_BLOCK_MAX_TOKENS,
	)
		.map((range) =>
			normalizedText.slice(range.startOffset, range.endOffset).trim(),
		)
		.filter((block) => block.length > 0);
}

export function createV3BodyBlockChunkRanges(
	text: string,
	targetTokens: number,
	maxTokens: number,
): V3BodyBlockChunkRange[] {
	if (text.trim().length === 0) {
		return [];
	}

	const lookup = buildTokenCheckpoints(text);
	const preferredBoundaries = buildPreferredBoundaries(text);
	const ranges: ChunkRange[] = [];
	let startOffset = 0;

	while (startOffset < lookup.textLength) {
		while (
			startOffset < lookup.textLength &&
			isWhitespaceCharCode(text.charCodeAt(startOffset))
		) {
			startOffset += 1;
		}
		if (startOffset >= lookup.textLength) {
			break;
		}

		const remainingTokens =
			(lookup.totalUnits - tokenUnitsAtOffset(text, lookup, startOffset)) /
			BODY_BLOCK_TOKEN_UNIT_SCALE;
		let endOffset: number;
		if (remainingTokens <= maxTokens) {
			endOffset = lookup.textLength;
		} else {
			const targetOffset = offsetForForwardTokens(
				text,
				lookup,
				startOffset,
				targetTokens,
			);
			const maxOffset = offsetForForwardTokens(
				text,
				lookup,
				startOffset,
				maxTokens,
			);
			const minPreferredOffset = offsetForForwardTokens(
				text,
				lookup,
				startOffset,
				targetTokens * 0.75,
			);
			const candidateStart = lowerBound(
				preferredBoundaries,
				Math.max(startOffset + 1, minPreferredOffset),
			);
			const candidateEnd = lowerBound(preferredBoundaries, maxOffset + 1);
			endOffset =
				candidateStart < candidateEnd
					? pickClosestBoundary(
						preferredBoundaries,
						candidateStart,
						candidateEnd,
						targetOffset,
					)
					: Math.max(startOffset + 1, maxOffset);
		}

		while (endOffset > startOffset && isWhitespaceCharCode(text.charCodeAt(endOffset - 1))) {
			endOffset -= 1;
		}
		if (endOffset <= startOffset) {
			break;
		}

		ranges.push({ startOffset, endOffset });
		startOffset = endOffset;
	}

	return ranges;
}

function buildPreferredBoundaries(text: string): number[] {
	const boundaries = new Set<number>([0, text.length]);
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "\n") {
			boundaries.add(index + 1);
			continue;
		}
		if (!BODY_BLOCK_SENTENCE_BOUNDARY_CHARS.has(char)) {
			continue;
		}

		let boundary = index + 1;
		while (
			boundary < text.length &&
			BODY_BLOCK_CLOSING_BOUNDARY_CHARS.has(text[boundary])
		) {
			boundary += 1;
		}
		if (text[boundary] === "\r") {
			boundary += 1;
		}
		if (text[boundary] === "\n") {
			boundary += 1;
		}
		boundaries.add(boundary);
	}
	return Array.from(boundaries).sort((left, right) => left - right);
}

function buildTokenCheckpoints(text: string): TokenCheckpointLookup {
	const checkpointCount =
		Math.floor(text.length / BODY_BLOCK_TOKEN_CHECKPOINT_STRIDE) + 1;
	const checkpoints = new Uint32Array(checkpointCount + 1);
	let totalUnits = 0;

	for (let index = 0; index < text.length; index += 1) {
		totalUnits += charTokenUnits(text.charCodeAt(index));
		if ((index + 1) % BODY_BLOCK_TOKEN_CHECKPOINT_STRIDE === 0) {
			checkpoints[(index + 1) / BODY_BLOCK_TOKEN_CHECKPOINT_STRIDE] = totalUnits;
		}
	}

	checkpoints[checkpointCount] = totalUnits;
	return {
		textLength: text.length,
		checkpointStride: BODY_BLOCK_TOKEN_CHECKPOINT_STRIDE,
		checkpoints,
		totalUnits,
	};
}

function tokenUnitsAtOffset(
	text: string,
	lookup: TokenCheckpointLookup,
	offset: number,
): number {
	const clampedOffset = Math.max(0, Math.min(offset, lookup.textLength));
	const blockIndex = Math.floor(clampedOffset / lookup.checkpointStride);
	let units = lookup.checkpoints[blockIndex];
	const blockStart = blockIndex * lookup.checkpointStride;

	for (let index = blockStart; index < clampedOffset; index += 1) {
		units += charTokenUnits(text.charCodeAt(index));
	}

	return units;
}

function findCheckpointIndexForUnits(
	checkpoints: Uint32Array,
	targetUnits: number,
): number {
	let lo = 0;
	let hi = checkpoints.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (checkpoints[mid] < targetUnits) {
			lo = mid + 1;
			continue;
		}
		hi = mid;
	}
	return lo;
}

function offsetForAbsoluteUnits(
	text: string,
	lookup: TokenCheckpointLookup,
	targetUnits: number,
): number {
	if (targetUnits <= 0) {
		return 0;
	}
	if (targetUnits >= lookup.totalUnits) {
		return lookup.textLength;
	}

	const checkpointIndex = findCheckpointIndexForUnits(
		lookup.checkpoints,
		targetUnits,
	);
	if (lookup.checkpoints[checkpointIndex] === targetUnits) {
		return Math.min(
			checkpointIndex * lookup.checkpointStride,
			lookup.textLength,
		);
	}

	const blockIndex = Math.max(0, checkpointIndex - 1);
	let offset = blockIndex * lookup.checkpointStride;
	let units = lookup.checkpoints[blockIndex];
	while (offset < lookup.textLength && units < targetUnits) {
		units += charTokenUnits(text.charCodeAt(offset));
		offset += 1;
	}
	return offset;
}

function offsetForForwardTokens(
	text: string,
	lookup: TokenCheckpointLookup,
	startOffset: number,
	targetTokens: number,
): number {
	const startUnits = tokenUnitsAtOffset(text, lookup, startOffset);
	const targetUnits =
		startUnits + Math.ceil(targetTokens * BODY_BLOCK_TOKEN_UNIT_SCALE);
	return offsetForAbsoluteUnits(text, lookup, targetUnits);
}

function lowerBound(
	values: number[],
	target: number,
	start = 0,
	end = values.length,
): number {
	let lo = start;
	let hi = end;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid] < target) {
			lo = mid + 1;
			continue;
		}
		hi = mid;
	}
	return lo;
}

function pickClosestBoundary(
	boundaries: number[],
	startIndex: number,
	endIndexExclusive: number,
	targetOffset: number,
): number {
	let best = boundaries[startIndex];
	let bestDistance = Math.abs(best - targetOffset);
	for (let index = startIndex + 1; index < endIndexExclusive; index += 1) {
		const candidate = boundaries[index];
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
		code === 0x2f ||
		code === 0x5c ||
		code === 0x2e ||
		code === 0x5f ||
		code === 0x2d ||
		code === 0x3a ||
		code === 0x23 ||
		code === 0x25 ||
		code === 0x3f ||
		code === 0x26 ||
		code === 0x3d ||
		code === 0x2b ||
		code === 0x40 ||
		code === 0x7e ||
		code === 0x60
	);
}

function charTokenUnits(code: number): number {
	if (isWhitespaceCharCode(code)) {
		return 0;
	}
	if (code <= 0x7f) {
		return isAsciiStructuralCharCode(code)
			? BODY_BLOCK_TOKEN_UNITS_ASCII_STRUCTURAL
			: BODY_BLOCK_TOKEN_UNITS_ASCII;
	}
	if (isWideCharCode(code)) {
		return BODY_BLOCK_TOKEN_UNITS_WIDE;
	}
	return BODY_BLOCK_TOKEN_UNITS_UNICODE_OTHER;
}

function dedupePreservingOrder(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}
