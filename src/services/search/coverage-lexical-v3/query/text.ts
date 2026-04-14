const RAW_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const HAN_SEQUENCE_REGEX = /\p{Script=Han}+/gu;
const HAN_REGEX = /\p{Script=Han}/u;
const LATIN_REGEX = /[a-z0-9]/u;
const TAG_SPLIT_REGEX = /\s+/u;

export type V3SurfaceKind = "latin" | "han" | "mixed" | "other";
export type V3DocumentTokenizer = (text: string) => readonly string[];

export type V3BodyBlockDraft = Readonly<{
	ordinal: number;
	normalizedText: string;
	familyTexts: readonly string[];
	exactFamilyTexts: readonly string[];
	hanWitnessTexts: readonly string[];
	hanBigramTexts: readonly string[];
	spanLength: number;
}>;

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
	const normalized = normalizeText(text);
	return dedupePreservingOrder(
		extractDocumentFamilySequence(normalized, tokenizeDocumentText),
	);
}

export function extractDocumentFamilySequence(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): string[] {
	const normalized = normalizeText(text);
	const out: string[] = [];
	for (const match of normalized.matchAll(RAW_SEGMENT_REGEX)) {
		const token = match[0].trim();
		if (token.length === 0) {
			continue;
		}
		if (classifySurfaceKind(token) !== "han" || tokenizeDocumentText == null) {
			out.push(token);
			continue;
		}
		const hanTerms = collectHanTokenizerTerms(token, tokenizeDocumentText);
		if (hanTerms.length > 0) {
			out.push(...hanTerms);
		}
	}
	return out;
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

export function splitBodyBlocks(text: string): V3BodyBlockDraft[] {
	const normalized = normalizeText(text).replace(/\r\n?/gu, "\n");
	if (normalized.trim().length === 0) {
		return [];
	}
	const rawBlocks = normalized
		.split(/\n\s*\n+/u)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
	const blocks = rawBlocks.length > 0 ? rawBlocks : [normalized.trim()];
	return blocks
		.map<V3BodyBlockDraft>((block, index) => ({
			ordinal: index,
			normalizedText: block,
			familyTexts: extractOrderedFamilySequence(block),
			exactFamilyTexts: extractOrderedFamilySequence(block),
			hanWitnessTexts: dedupePreservingOrder(extractHanSegments(block)),
			hanBigramTexts: extractHanBigrams(block),
			spanLength: block.length,
		}))
		.filter((block) => block.familyTexts.length > 0);
}

export function splitBodyBlocksWithDocumentTokenizer(
	text: string,
	tokenizeDocumentText?: V3DocumentTokenizer,
): V3BodyBlockDraft[] {
	const normalized = normalizeText(text).replace(/\r\n?/gu, "\n");
	if (normalized.trim().length === 0) {
		return [];
	}
	const rawBlocks = normalized
		.split(/\n\s*\n+/u)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
	const blocks = rawBlocks.length > 0 ? rawBlocks : [normalized.trim()];
	return blocks
		.map<V3BodyBlockDraft>((block, index) => {
			const exactFamilyTexts = extractDocumentFamilySequence(
				block,
				tokenizeDocumentText,
			);
			return {
				ordinal: index,
				normalizedText: block,
				familyTexts: dedupePreservingOrder(exactFamilyTexts),
				exactFamilyTexts,
				hanWitnessTexts: dedupePreservingOrder(extractHanSegments(block)),
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

export function extractOrderedFamilySequence(text: string): string[] {
	const normalized = normalizeText(text);
	const out: string[] = [];
	for (const match of normalized.matchAll(RAW_SEGMENT_REGEX)) {
		const token = match[0].trim();
		if (token.length === 0) {
			continue;
		}
		out.push(token);
	}
	return out;
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
