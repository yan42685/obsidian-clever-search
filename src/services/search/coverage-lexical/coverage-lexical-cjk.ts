const HAN_SEQUENCE_REGEX = /\p{Script=Han}+/gu;
const RAW_QUERY_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const TAG_SPLIT_REGEX = /\s+/u;

export type CoverageLexicalCharQuery = {
	terms: string[];
	rawSegments: string[];
	hanSegments: string[];
	uniqueHanSegments: string[];
	segmentBigrams: Map<string, string[]>;
	segmentTermIndices: Map<string, number[]>;
};

export type CoverageLexicalTagFallbackSignal = {
	exactMatchCount: number;
	exactTerms: string[];
	charMatchCount: number;
	charMatchRatio: number;
	matchedCharTerms: string[];
};

export type CoverageLexicalBodyCharVerification = {
	matchedTermIndices: number[];
	matchFlags: number[];
	matchCount: number;
	matchRatio: number;
};

export function extractHanSegments(text: string): string[] {
	const segments: string[] = [];
	const seen = new Set<string>();
	for (const match of normalizeCoverageLexicalText(text).matchAll(HAN_SEQUENCE_REGEX)) {
		const segment = match[0];
		if (segment.length === 0 || seen.has(segment)) {
			continue;
		}
		seen.add(segment);
		segments.push(segment);
	}
	return segments;
}

export function buildCoverageLexicalCharQuery(
	queryText: string,
): CoverageLexicalCharQuery {
	const normalized = normalizeCoverageLexicalText(queryText);
	const rawSegments = normalized.match(RAW_QUERY_SEGMENT_REGEX) ?? [];
	const hanSegments = rawSegments.filter((segment) => /\p{Script=Han}/u.test(segment));
	const uniqueHanSegments: string[] = [];
	const seenSegments = new Set<string>();
	const segmentBigrams = new Map<string, string[]>();
	const segmentTermIndices = new Map<string, number[]>();
	const terms: string[] = [];
	const seen = new Set<string>();
	for (const segment of hanSegments) {
		if (seenSegments.has(segment)) {
			continue;
		}
		seenSegments.add(segment);
		uniqueHanSegments.push(segment);
	}
	for (const segment of uniqueHanSegments) {
		const bigrams = extractHanBigrams(segment);
		segmentBigrams.set(segment, bigrams);
		const termIndices: number[] = [];
		for (const bigram of bigrams) {
			if (seen.has(bigram)) {
				termIndices.push(terms.indexOf(bigram));
				continue;
			}
			seen.add(bigram);
			const termIndex = terms.length;
			terms.push(bigram);
			termIndices.push(termIndex);
		}
		segmentTermIndices.set(segment, termIndices);
	}
	return {
		terms,
		rawSegments,
		hanSegments,
		uniqueHanSegments,
		segmentBigrams,
		segmentTermIndices,
	};
}

export function extractHanBigrams(text: string): string[] {
	const bigrams: string[] = [];
	const seen = new Set<string>();
	for (const match of normalizeCoverageLexicalText(text).matchAll(HAN_SEQUENCE_REGEX)) {
		const chars = Array.from(match[0]);
		for (let index = 0; index < chars.length - 1; index++) {
			const token = chars[index] + chars[index + 1];
			if (seen.has(token)) {
				continue;
			}
			seen.add(token);
			bigrams.push(token);
		}
	}
	return bigrams;
}

export function evaluateCoverageLexicalBodyCharVerification(
	bodyHanSegments: readonly string[],
	query: CoverageLexicalCharQuery,
): CoverageLexicalBodyCharVerification {
	if (query.terms.length === 0 || bodyHanSegments.length === 0) {
		return {
			matchedTermIndices: [],
			matchFlags: [],
			matchCount: 0,
			matchRatio: 0,
		};
	}
	const termIndexByBigram = new Map<string, number>();
	for (let termIndex = 0; termIndex < query.terms.length; termIndex += 1) {
		termIndexByBigram.set(query.terms[termIndex], termIndex);
	}
	const matchFlags: number[] = [];
	const matchedTermIndices: number[] = [];
	for (const segment of bodyHanSegments) {
		for (const bigram of extractHanBigrams(segment)) {
			const termIndex = termIndexByBigram.get(bigram);
			if (termIndex === undefined || matchFlags[termIndex] === 1) {
				continue;
			}
			matchFlags[termIndex] = 1;
			matchedTermIndices.push(termIndex);
		}
	}
	return {
		matchedTermIndices,
		matchFlags,
		matchCount: matchedTermIndices.length,
		matchRatio:
			query.terms.length > 0 ? matchedTermIndices.length / query.terms.length : 0,
	};
}

export function splitCoverageLexicalTagValues(tagsText: string): string[] {
	return normalizeCoverageLexicalText(tagsText)
		.split(TAG_SPLIT_REGEX)
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

export function normalizeCoverageLexicalText(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

export function evaluateCoverageLexicalTagFallback(
	tagValues: readonly string[],
	query: CoverageLexicalCharQuery,
): CoverageLexicalTagFallbackSignal {
	const exactTerms = query.rawSegments.filter((segment) => tagValues.includes(segment));
	let bestCharMatchCount = 0;
	let bestCharMatchRatio = 0;
	let bestMatchedCharTerms: string[] = [];
	for (const segment of query.hanSegments) {
		const segmentBigrams = query.segmentBigrams.get(segment) ?? [];
		if (segmentBigrams.length === 0) {
			continue;
		}
		for (const tagValue of tagValues) {
			const tagBigrams = new Set(extractHanBigrams(tagValue));
			if (tagBigrams.size === 0) {
				continue;
			}
			const matched = segmentBigrams.filter((bigram) => tagBigrams.has(bigram));
			const ratio = matched.length / segmentBigrams.length;
			if (!passesTagBigramThreshold(segmentBigrams.length, matched.length, ratio)) {
				continue;
			}
			if (
				matched.length > bestCharMatchCount ||
				(matched.length === bestCharMatchCount && ratio > bestCharMatchRatio)
			) {
				bestCharMatchCount = matched.length;
				bestCharMatchRatio = ratio;
				bestMatchedCharTerms = matched;
			}
		}
	}
	return {
		exactMatchCount: exactTerms.length,
		exactTerms,
		charMatchCount: bestCharMatchCount,
		charMatchRatio: bestCharMatchRatio,
		matchedCharTerms: bestMatchedCharTerms,
	};
}

function passesTagBigramThreshold(
	totalBigrams: number,
	matchedCount: number,
	ratio: number,
): boolean {
	if (totalBigrams <= 2) {
		return matchedCount === totalBigrams;
	}
	if (totalBigrams <= 4) {
		return matchedCount >= 2 && ratio >= 0.75;
	}
	return matchedCount >= 2 && ratio >= 0.7;
}
