import type {
	CoverageLexicalFamily,
	CoverageLexicalHighlightRange,
} from "./coverage-lexical-types";

type HanSegmentInput = {
	text: string;
};

export type CoverageLexicalSnippetAlignerAtomInput = {
	kind: "family_exact" | "family_prefix" | "family_fuzzy" | "family_substring";
	queryKey: string;
};

type AlignmentState = {
	score: number;
	queryIndex: number;
	snippetIndex: number;
	matchedCharCount: number;
	matchedBigramCount: number;
	charRun: number;
	maxCharRun: number;
	bigramRun: number;
	maxBigramRun: number;
	gapPenalty: number;
	maxGap: number;
	matchedQueryIndices: number[];
	matchedSnippetIndices: number[];
};

type CharUnit = {
	char: string;
	start: number;
	end: number;
};

export type CoverageLexicalSnippetAlignmentResult = {
	alignmentScore: number;
	alignedRanges: CoverageLexicalHighlightRange[];
	familyHitCount: number;
	fullSegmentCount: number;
	matchedCharCount: number;
	matchedBigramCount: number;
	maxConsecutiveCharRun: number;
	maxConsecutiveBigramRun: number;
	exactFamilyHitCount: number;
	prefixFamilyHitCount: number;
	fuzzyFamilyHitCount: number;
	substringFamilyHitCount: number;
	gapPenalty: number;
	maxGap: number;
	coverageRatio: number;
	signature: string;
};

const WEAK_HAN_CHARS = new Set([
	"的",
	"了",
	"是",
	"不",
	"有",
	"在",
	"和",
	"与",
	"及",
	"呢",
	"吗",
]);

export function alignSnippetToQueryChars(params: {
	snippetText: string;
	families: readonly CoverageLexicalFamily[];
	hanSegments: readonly HanSegmentInput[];
	familyAtoms?: readonly CoverageLexicalSnippetAlignerAtomInput[];
}): CoverageLexicalSnippetAlignmentResult {
	const snippetUnits = splitTextToCharUnits(params.snippetText);
	const familyRanges = collectFamilyRanges(params.snippetText, params.families);
	const familySignals = collectFamilySignals(params.familyAtoms ?? []);
	const segmentAlignments = params.hanSegments.map((segment) =>
		alignHanSegment(segment.text, snippetUnits),
	);
	const alignedRanges = mergeRanges([
		...familyRanges,
		...segmentAlignments.flatMap((alignment) => alignment.alignedRanges),
	]);
	const familyHitCount = familyRanges.length;
	const fullSegmentCount = segmentAlignments.filter((alignment) => alignment.isFullMatch)
		.length;
	const matchedCharCount = segmentAlignments.reduce(
		(total, alignment) => total + alignment.matchedCharCount,
		0,
	);
	const matchedBigramCount = segmentAlignments.reduce(
		(total, alignment) => total + alignment.matchedBigramCount,
		0,
	);
	const maxConsecutiveCharRun = segmentAlignments.reduce(
		(best, alignment) => Math.max(best, alignment.maxConsecutiveCharRun),
		0,
	);
	const maxConsecutiveBigramRun = segmentAlignments.reduce(
		(best, alignment) => Math.max(best, alignment.maxConsecutiveBigramRun),
		0,
	);
	const gapPenalty = segmentAlignments.reduce(
		(total, alignment) => total + alignment.gapPenalty,
		0,
	);
	const maxGap = segmentAlignments.reduce(
		(best, alignment) => Math.max(best, alignment.maxGap),
		0,
	);
	const totalQueryChars = params.hanSegments.reduce(
		(total, segment) => total + Array.from(segment.text).length,
		0,
	);
	const coverageRatio =
		totalQueryChars > 0 ? matchedCharCount / totalQueryChars : familyHitCount > 0 ? 1 : 0;
	const alignmentScore =
		segmentAlignments.reduce((total, alignment) => total + alignment.score, 0) +
		familyHitCount * 8 +
		matchedBigramCount * 4 +
		maxConsecutiveCharRun * 2 +
		maxConsecutiveBigramRun * 3;
	const signature = JSON.stringify({
		f: familyRanges.length,
		s: segmentAlignments.map((alignment) => alignment.signature),
	});
	return {
		alignmentScore,
		alignedRanges,
		familyHitCount,
		fullSegmentCount,
		matchedCharCount,
		matchedBigramCount,
		maxConsecutiveCharRun,
		maxConsecutiveBigramRun,
		exactFamilyHitCount: familySignals.exactFamilyHitCount,
		prefixFamilyHitCount: familySignals.prefixFamilyHitCount,
		fuzzyFamilyHitCount: familySignals.fuzzyFamilyHitCount,
		substringFamilyHitCount: familySignals.substringFamilyHitCount,
		gapPenalty,
		maxGap,
		coverageRatio,
		signature,
	};
}

function collectFamilySignals(
	atoms: readonly CoverageLexicalSnippetAlignerAtomInput[],
): {
	exactFamilyHitCount: number;
	prefixFamilyHitCount: number;
	fuzzyFamilyHitCount: number;
	substringFamilyHitCount: number;
} {
	const exact = new Set<string>();
	const prefix = new Set<string>();
	const fuzzy = new Set<string>();
	const substring = new Set<string>();
	for (const atom of atoms) {
		switch (atom.kind) {
			case "family_exact":
				exact.add(atom.queryKey);
				break;
			case "family_prefix":
				prefix.add(atom.queryKey);
				break;
			case "family_fuzzy":
				fuzzy.add(atom.queryKey);
				break;
			case "family_substring":
				substring.add(atom.queryKey);
				break;
		}
	}
	return {
		exactFamilyHitCount: exact.size,
		prefixFamilyHitCount: prefix.size,
		fuzzyFamilyHitCount: fuzzy.size,
		substringFamilyHitCount: substring.size,
	};
}

function collectFamilyRanges(
	snippetText: string,
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalHighlightRange[] {
	const ranges: CoverageLexicalHighlightRange[] = [];
	const haystack = snippetText.toLowerCase();
	for (const family of families) {
		if (!family.normalizedTerm) {
			continue;
		}
		let fromIndex = 0;
		while (fromIndex < haystack.length) {
			const foundAt = haystack.indexOf(family.normalizedTerm, fromIndex);
			if (foundAt < 0) {
				break;
			}
			ranges.push({
				start: foundAt,
				end: foundAt + family.normalizedTerm.length,
			});
			fromIndex = foundAt + Math.max(1, family.normalizedTerm.length);
		}
	}
	return ranges;
}

function alignHanSegment(
	segmentText: string,
	snippetUnits: readonly CharUnit[],
): {
	score: number;
	alignedRanges: CoverageLexicalHighlightRange[];
	matchedCharCount: number;
	matchedBigramCount: number;
	maxConsecutiveCharRun: number;
	maxConsecutiveBigramRun: number;
	isFullMatch: boolean;
	signature: string;
} {
	const queryChars = Array.from(segmentText);
	if (queryChars.length === 0 || snippetUnits.length === 0) {
		return {
			score: 0,
			alignedRanges: [],
			matchedCharCount: 0,
			matchedBigramCount: 0,
			maxConsecutiveCharRun: 0,
			maxConsecutiveBigramRun: 0,
			isFullMatch: false,
			signature: "",
		};
	}
	let states: AlignmentState[] = [];
	for (let queryIndex = 0; queryIndex < queryChars.length; queryIndex++) {
		const queryChar = queryChars[queryIndex];
		const next = new Map<string, AlignmentState>();
		for (let snippetIndex = 0; snippetIndex < snippetUnits.length; snippetIndex++) {
			if (snippetUnits[snippetIndex].char !== queryChar) {
				continue;
			}
			upsertAlignmentState(next, {
				score: charWeight(queryChar),
				queryIndex,
				snippetIndex,
				matchedCharCount: 1,
				matchedBigramCount: 0,
				charRun: 1,
				maxCharRun: 1,
				bigramRun: 0,
				maxBigramRun: 0,
				gapPenalty: 0,
				maxGap: 0,
				matchedQueryIndices: [queryIndex],
				matchedSnippetIndices: [snippetIndex],
			});
			for (const previous of states) {
				if (previous.snippetIndex >= snippetIndex) {
					continue;
				}
				const gap = snippetIndex - previous.snippetIndex - 1;
				const consecutiveQuery = previous.queryIndex === queryIndex - 1;
				const consecutiveSnippet = snippetIndex === previous.snippetIndex + 1;
				let score =
					previous.score +
					charWeight(queryChar) -
					computeGapPenalty(gap);
				let charRun = 1;
				let maxCharRun = previous.maxCharRun;
				let matchedBigramCount = previous.matchedBigramCount;
				let bigramRun = 0;
				let maxBigramRun = previous.maxBigramRun;
				let gapPenalty = previous.gapPenalty + computeGapPenalty(gap);
				let maxGap = Math.max(previous.maxGap, gap);
				if (consecutiveQuery && consecutiveSnippet) {
					score += 2;
					charRun = previous.charRun + 1;
					maxCharRun = Math.max(maxCharRun, charRun);
					matchedBigramCount += 1;
					bigramRun = previous.bigramRun + 1;
					maxBigramRun = Math.max(maxBigramRun, bigramRun);
					score += 3;
				} else if (consecutiveQuery) {
					score += 0.5;
					maxCharRun = Math.max(maxCharRun, 1);
				}
				upsertAlignmentState(next, {
					score,
					queryIndex,
					snippetIndex,
					matchedCharCount: previous.matchedCharCount + 1,
					matchedBigramCount,
					charRun,
					maxCharRun,
					bigramRun,
					maxBigramRun,
					gapPenalty,
					maxGap,
					matchedQueryIndices: [
						...previous.matchedQueryIndices,
						queryIndex,
					],
					matchedSnippetIndices: [
						...previous.matchedSnippetIndices,
						snippetIndex,
					],
				});
			}
		}
		states = pruneAlignmentStates([...states, ...next.values()]);
	}
	const best = pickBestAlignmentState(states);
	if (!best) {
		return {
			score: 0,
			alignedRanges: [],
			matchedCharCount: 0,
			matchedBigramCount: 0,
			maxConsecutiveCharRun: 0,
			maxConsecutiveBigramRun: 0,
			gapPenalty: 0,
			maxGap: 0,
			isFullMatch: false,
			signature: "",
		};
	}
	const supplemental = collectSupplementalSegmentMatches(
		queryChars,
		snippetUnits,
		best.matchedQueryIndices,
		best.matchedSnippetIndices,
	);
	const alignedSnippetIndices = [
		...best.matchedSnippetIndices,
		...supplemental.snippetIndices,
	].sort((left, right) => left - right);
	const alignedRanges = mergeRanges(
		alignedSnippetIndices.map((snippetIndex) => ({
			start: snippetUnits[snippetIndex].start,
			end: snippetUnits[snippetIndex].end,
		})),
	);
	return {
		score: best.score + supplemental.score,
		alignedRanges,
		matchedCharCount: best.matchedCharCount + supplemental.queryIndices.length,
		matchedBigramCount: best.matchedBigramCount,
		maxConsecutiveCharRun: Math.max(
			best.maxCharRun,
			supplemental.maxSupplementalRun,
		),
		maxConsecutiveBigramRun: best.maxBigramRun,
		gapPenalty: best.gapPenalty,
		maxGap: best.maxGap,
		isFullMatch:
			best.matchedCharCount + supplemental.queryIndices.length === queryChars.length,
		signature: JSON.stringify({
			q: [...best.matchedQueryIndices, ...supplemental.queryIndices].sort(
				(left, right) => left - right,
			),
			s: alignedSnippetIndices,
		}),
	};
}

function upsertAlignmentState(
	target: Map<string, AlignmentState>,
	candidate: AlignmentState,
): void {
	const key = `${candidate.queryIndex}:${candidate.snippetIndex}`;
	const existing = target.get(key);
	if (!existing || candidate.score > existing.score) {
		target.set(key, candidate);
	}
}

function pruneAlignmentStates(states: AlignmentState[]): AlignmentState[] {
	const deduped = new Map<string, AlignmentState>();
	for (const state of states) {
		const key = `${state.queryIndex}:${state.snippetIndex}`;
		const existing = deduped.get(key);
		if (!existing || state.score > existing.score) {
			deduped.set(key, state);
		}
	}
	return [...deduped.values()]
		.sort((left, right) => right.score - left.score)
		.slice(0, 128);
}

function pickBestAlignmentState(states: readonly AlignmentState[]): AlignmentState | null {
	let best: AlignmentState | null = null;
	for (const state of states) {
		if (!best || state.score > best.score) {
			best = state;
		}
	}
	return best;
}

function charWeight(char: string): number {
	return WEAK_HAN_CHARS.has(char) ? 0.6 : 2;
}

function collectSupplementalSegmentMatches(
	queryChars: readonly string[],
	snippetUnits: readonly CharUnit[],
	matchedQueryIndices: readonly number[],
	matchedSnippetIndices: readonly number[],
): {
	queryIndices: number[];
	snippetIndices: number[];
	score: number;
	maxSupplementalRun: number;
} {
	const usedQuery = new Set(matchedQueryIndices);
	const usedSnippet = new Set(matchedSnippetIndices);
	const queryIndices: number[] = [];
	const snippetIndices: number[] = [];
	let currentRun = 0;
	let maxSupplementalRun = 0;
	for (let queryIndex = 0; queryIndex < queryChars.length; queryIndex++) {
		if (usedQuery.has(queryIndex)) {
			currentRun = 0;
			continue;
		}
		const snippetIndex = snippetUnits.findIndex(
			(unit, index) => !usedSnippet.has(index) && unit.char === queryChars[queryIndex],
		);
		if (snippetIndex < 0) {
			currentRun = 0;
			continue;
		}
		queryIndices.push(queryIndex);
		snippetIndices.push(snippetIndex);
		usedSnippet.add(snippetIndex);
		currentRun += 1;
		maxSupplementalRun = Math.max(maxSupplementalRun, currentRun);
	}
	return {
		queryIndices,
		snippetIndices,
		score: queryIndices.reduce(
			(total, queryIndex) => total + charWeight(queryChars[queryIndex]) * 0.5,
			0,
		),
		maxSupplementalRun,
	};
}

function computeGapPenalty(gap: number): number {
	if (gap <= 0) {
		return 0;
	}
	return gap * 0.35 + (gap >= 3 ? gap * 0.4 : 0);
}

function splitTextToCharUnits(text: string): CharUnit[] {
	const out: CharUnit[] = [];
	let offset = 0;
	for (const char of Array.from(text)) {
		out.push({
			char,
			start: offset,
			end: offset + char.length,
		});
		offset += char.length;
	}
	return out;
}

function mergeRanges(
	ranges: readonly CoverageLexicalHighlightRange[],
): CoverageLexicalHighlightRange[] {
	if (ranges.length <= 1) {
		return [...ranges];
	}
	const ordered = [...ranges].sort((left, right) => left.start - right.start);
	const merged: CoverageLexicalHighlightRange[] = [ordered[0]];
	for (let index = 1; index < ordered.length; index++) {
		const current = ordered[index];
		const previous = merged[merged.length - 1];
		if (current.start <= previous.end) {
			previous.end = Math.max(previous.end, current.end);
			continue;
		}
		merged.push({ start: current.start, end: current.end });
	}
	return merged;
}
