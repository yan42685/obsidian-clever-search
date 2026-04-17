import {
	classifySurfaceKind,
	extractHanBigrams,
	normalizeText,
} from "./text";

export type V3QueryUnitSource =
	| "surface"
	| "han_tokenizer_real"
	| "opaque_han_confirmed";

export type V3QueryUnit = Readonly<{
	index: number;
	text: string;
	source: V3QueryUnitSource;
	surfaceGroupIndex: number | null;
}>;

export type V3QuerySurfaceGroup = Readonly<{
	index: number;
	text: string;
	kind: ReturnType<typeof classifySurfaceKind>;
	hanBigramTexts: readonly string[];
}>;

export type V3HanBackstopGroup = Readonly<{
	surfaceGroupIndex: number;
	normalizedText: string;
	bigrams: readonly string[];
	charLength: number;
	triggerKind: "residual_span" | "bridge_bigram" | "whole_group_backstop";
}>;

export type V3QueryAnalysis = Readonly<{
	queryText: string;
	normalizedQueryText: string;
	surfaceGroups: readonly V3QuerySurfaceGroup[];
	primaryUnits: readonly V3QueryUnit[];
	hanBackstopGroups: readonly V3HanBackstopGroup[];
	surfaceCoverageShapeKey: string;
}>;

const RAW_SURFACE_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const HAN_REGEX = /\p{Script=Han}/u;

export function analyzeQuery(
	queryText: string,
	queryTerms: readonly string[] = [],
): V3QueryAnalysis {
	const normalizedQueryText = normalizeText(queryText);
	const normalizedQueryTerms = queryTerms
		.map((term) => normalizeText(term).trim())
		.filter((term) => term.length > 0);
	const surfaceGroups = (normalizedQueryText.match(RAW_SURFACE_REGEX) ?? [])
		.map((text) => text.trim())
		.filter((text) => text.length > 0)
		.map<V3QuerySurfaceGroup>((text, index) => ({
			index,
			text,
			kind: classifySurfaceKind(text),
			hanBigramTexts:
				classifySurfaceKind(text) === "han" ? extractHanBigrams(text) : [],
		}));
	const primaryUnits: V3QueryUnit[] = [];
	const hanBackstopGroups: V3HanBackstopGroup[] = [];
	const seenPrimaryTexts = new Set<string>();
	for (const group of surfaceGroups) {
		if (group.kind !== "han") {
			pushPrimaryUnit(primaryUnits, seenPrimaryTexts, {
				text: group.text,
				source: "surface",
				surfaceGroupIndex: group.index,
			});
			continue;
		}
		const realHanTerms = collectHanPrimaryTerms(group.text, normalizedQueryTerms);
		for (const term of realHanTerms) {
			pushPrimaryUnit(primaryUnits, seenPrimaryTexts, {
				text: term,
				source: "han_tokenizer_real",
				surfaceGroupIndex: group.index,
			});
		}
		const charLength = Array.from(group.text).length;
		if (realHanTerms.length === 0) {
			if (charLength >= 2) {
				pushPrimaryUnit(primaryUnits, seenPrimaryTexts, {
					text: group.text,
					source: "opaque_han_confirmed",
					surfaceGroupIndex: group.index,
				});
				const bigrams = extractHanBigrams(group.text);
				if (bigrams.length > 0) {
					hanBackstopGroups.push({
						surfaceGroupIndex: group.index,
						normalizedText: group.text,
						bigrams,
						charLength,
						triggerKind: "whole_group_backstop",
					});
				}
			}
			continue;
		}
		hanBackstopGroups.push(...buildHanBackstopGroups(group, realHanTerms));
	}
	return {
		queryText,
		normalizedQueryText,
		surfaceGroups,
		primaryUnits,
		hanBackstopGroups,
		surfaceCoverageShapeKey: surfaceGroups.map((group) => group.kind[0]).join(""),
	};
}

function pushPrimaryUnit(
	target: V3QueryUnit[],
	seenPrimaryTexts: Set<string>,
	input: Omit<V3QueryUnit, "index">,
): void {
	if (input.text.length === 0 || seenPrimaryTexts.has(input.text)) {
		return;
	}
	seenPrimaryTexts.add(input.text);
	target.push({
		index: target.length,
		...input,
	});
}

function collectHanPrimaryTerms(
	surfaceText: string,
	queryTerms: readonly string[],
): string[] {
	const candidateTerms = dedupePreservingOrder(
		queryTerms.filter(
			(term) =>
				classifySurfaceKind(term) === "han" &&
				Array.from(term).length >= 2 &&
				surfaceText.includes(term),
		),
	);
	if (candidateTerms.length === 0) {
		return [];
	}
	const chars = Array.from(surfaceText);
	const occurrencesByStart = new Map<number, HanTermOccurrence[]>();
	for (const term of candidateTerms) {
		const termChars = Array.from(term);
		if (termChars.length === 0 || termChars.length > chars.length) {
			continue;
		}
		for (let start = 0; start <= chars.length - termChars.length; start += 1) {
			if (!matchesCharsAt(chars, termChars, start)) {
				continue;
			}
			const occurrence: HanTermOccurrence = {
				text: term,
				start,
				end: start + termChars.length,
				length: termChars.length,
			};
			const existing = occurrencesByStart.get(start);
			if (existing != null) {
				existing.push(occurrence);
				continue;
			}
			occurrencesByStart.set(start, [occurrence]);
		}
	}
	const bestCoverByStart = new Map<number, HanCoverChoice>();
	for (let start = chars.length; start >= 0; start -= 1) {
		let bestChoice =
			start < chars.length
				? bestCoverByStart.get(start + 1) ?? createEmptyHanCoverChoice()
				: createEmptyHanCoverChoice();
		for (const occurrence of occurrencesByStart.get(start) ?? []) {
			const suffix = bestCoverByStart.get(occurrence.end) ?? createEmptyHanCoverChoice();
			const candidate = prependHanCoverChoice(occurrence, suffix);
			if (compareHanCoverChoice(candidate, bestChoice) > 0) {
				bestChoice = candidate;
			}
		}
		bestCoverByStart.set(start, bestChoice);
	}
	return (bestCoverByStart.get(0) ?? createEmptyHanCoverChoice()).terms.map(
		(occurrence) => occurrence.text,
	);
}

type HanTermOccurrence = Readonly<{
	text: string;
	start: number;
	end: number;
	length: number;
}>;

type HanCoverChoice = Readonly<{
	coveredChars: number;
	termCount: number;
	longestTermLength: number;
	terms: readonly HanTermOccurrence[];
}>;

function matchesCharsAt(
	chars: readonly string[],
	termChars: readonly string[],
	start: number,
): boolean {
	for (let index = 0; index < termChars.length; index += 1) {
		if (chars[start + index] !== termChars[index]) {
			return false;
		}
	}
	return true;
}

function createEmptyHanCoverChoice(): HanCoverChoice {
	return {
		coveredChars: 0,
		termCount: 0,
		longestTermLength: 0,
		terms: [],
	};
}

function prependHanCoverChoice(
	occurrence: HanTermOccurrence,
	choice: HanCoverChoice,
): HanCoverChoice {
	return {
		coveredChars: occurrence.length + choice.coveredChars,
		termCount: 1 + choice.termCount,
		longestTermLength: Math.max(occurrence.length, choice.longestTermLength),
		terms: [occurrence, ...choice.terms],
	};
}

function compareHanCoverChoice(left: HanCoverChoice, right: HanCoverChoice): number {
	if (left.coveredChars !== right.coveredChars) {
		return left.coveredChars - right.coveredChars;
	}
	if (left.termCount !== right.termCount) {
		return left.termCount - right.termCount;
	}
	if (left.longestTermLength !== right.longestTermLength) {
		return right.longestTermLength - left.longestTermLength;
	}
	const leftTerms = left.terms;
	const rightTerms = right.terms;
	for (let index = 0; index < Math.min(leftTerms.length, rightTerms.length); index += 1) {
		const startDifference = rightTerms[index].start - leftTerms[index].start;
		if (startDifference !== 0) {
			return startDifference;
		}
		const lengthDifference = rightTerms[index].length - leftTerms[index].length;
		if (lengthDifference !== 0) {
			return lengthDifference;
		}
		const textDifference = leftTerms[index].text.localeCompare(rightTerms[index].text);
		if (textDifference !== 0) {
			return -textDifference;
		}
	}
	return rightTerms.length - leftTerms.length;
}

function dedupePreservingOrder(values: readonly string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}

function buildHanBackstopGroups(
	group: V3QuerySurfaceGroup,
	realHanTerms: readonly string[],
): V3HanBackstopGroup[] {
	const chars = Array.from(group.text);
	const covered = markCoveredHanChars(group.text, chars.length, realHanTerms);
	const residualSpans = collectResidualSpans(chars, covered);
	const out: V3HanBackstopGroup[] = [];
	for (const span of residualSpans) {
		if (span.length >= 2) {
			const bigrams = extractHanBigrams(span.text);
			if (bigrams.length > 0) {
				out.push({
					surfaceGroupIndex: group.index,
					normalizedText: span.text,
					bigrams,
					charLength: span.length,
					triggerKind: "residual_span",
				});
			}
			continue;
		}
		const bigrams = collectBridgeBigrams(chars, span.start, span.end);
		if (bigrams.length > 0) {
			out.push({
				surfaceGroupIndex: group.index,
				normalizedText: span.text,
				bigrams,
				charLength: span.length,
				triggerKind: "bridge_bigram",
			});
		}
	}
	return out;
}

function markCoveredHanChars(
	surfaceText: string,
	charLength: number,
	terms: readonly string[],
): boolean[] {
	const covered = Array.from({ length: charLength }, () => false);
	for (const term of terms) {
		let searchStart = 0;
		while (searchStart < surfaceText.length) {
			const matchIndex = surfaceText.indexOf(term, searchStart);
			if (matchIndex < 0) {
				break;
			}
			const termCharLength = Array.from(term).length;
			for (let index = matchIndex; index < matchIndex + termCharLength; index += 1) {
				covered[index] = true;
			}
			searchStart = matchIndex + 1;
		}
	}
	return covered;
}

function collectResidualSpans(
	chars: readonly string[],
	covered: readonly boolean[],
): Array<{
	start: number;
	end: number;
	length: number;
	text: string;
}> {
	const out: Array<{
		start: number;
		end: number;
		length: number;
		text: string;
	}> = [];
	let start = -1;
	for (let index = 0; index < chars.length; index += 1) {
		if (!covered[index]) {
			if (start < 0) {
				start = index;
			}
			continue;
		}
		if (start >= 0) {
			out.push(buildResidualSpan(chars, start, index - 1));
			start = -1;
		}
	}
	if (start >= 0) {
		out.push(buildResidualSpan(chars, start, chars.length - 1));
	}
	return out;
}

function buildResidualSpan(
	chars: readonly string[],
	start: number,
	end: number,
): {
	start: number;
	end: number;
	length: number;
	text: string;
} {
	const text = chars.slice(start, end + 1).join("");
	return {
		start,
		end,
		length: end - start + 1,
		text,
	};
}

function collectBridgeBigrams(
	chars: readonly string[],
	start: number,
	end: number,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (bigram: string | null): void => {
		if (bigram == null || !HAN_REGEX.test(bigram) || seen.has(bigram)) {
			return;
		}
		seen.add(bigram);
		out.push(bigram);
	};
	if (start > 0) {
		push(chars[start - 1] + chars[start]);
	}
	if (end + 1 < chars.length) {
		push(chars[end] + chars[end + 1]);
	}
	return out;
}
