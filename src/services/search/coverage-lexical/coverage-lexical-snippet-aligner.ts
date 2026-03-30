import type { CoverageLexicalHighlightRange } from "./coverage-lexical-types";

export type CoverageLexicalSnippetAlignmentResult = {
	alignmentScore: number;
	alignedRanges: CoverageLexicalHighlightRange[];
	unitCoverageCount: number;
	unitCoverageRatio: number;
	hanBigramCoverageCount: number;
	hanBigramCoverageRatio: number;
	exactWordHitCount: number;
	prefixWordHitCount: number;
	fuzzyWordHitCount: number;
	maxConsecutiveUnitRun: number;
	gapPenalty: number;
	maxGap: number;
	signature: string;
};

export type CoverageLexicalSnippetAlignmentUnitKind =
	| "han_char"
	| "latin_word"
	| "mixed_word";

export type CoverageLexicalSnippetAlignmentUnit = {
	kind: CoverageLexicalSnippetAlignmentUnitKind;
	text: string;
	normalized: string;
	start: number;
	end: number;
};

type AlignmentUnit = CoverageLexicalSnippetAlignmentUnit;

type HanAlignmentState = {
	score: number;
	queryIndex: number;
	snippetIndex: number;
	matchedQueryIndices: number[];
	matchedSnippetIndices: number[];
	matchedBigramCount: number;
	charRun: number;
	maxCharRun: number;
	gapPenalty: number;
	maxGap: number;
};

type HanAlignmentResult = {
	score: number;
	alignedRanges: CoverageLexicalHighlightRange[];
	matchedCharCount: number;
	matchedBigramCount: number;
	maxConsecutiveUnitRun: number;
	gapPenalty: number;
	maxGap: number;
	signature: string;
};

type WordAlignmentResult = {
	exactWordHitCount: number;
	prefixWordHitCount: number;
	fuzzyWordHitCount: number;
	alignedRanges: CoverageLexicalHighlightRange[];
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

const QUERY_UNIT_REGEX = /[\p{Script=Han}]|[a-z0-9]+(?:[-_./:+#][a-z0-9]+)*/giu;

export function alignSnippetToQueryUnits(params: {
	queryText: string;
	snippetText: string;
}): CoverageLexicalSnippetAlignmentResult {
	const queryUnits = unitizeQueryText(params.queryText);
	const snippetUnits = unitizeSnippetText(params.snippetText);
	const queryHanUnits = queryUnits.filter(
		(unit): unit is AlignmentUnit & { kind: "han_char" } => unit.kind === "han_char",
	);
	const snippetHanUnits = snippetUnits.filter(
		(unit): unit is AlignmentUnit & { kind: "han_char" } => unit.kind === "han_char",
	);
	const queryWordUnits = queryUnits.filter((unit) => unit.kind !== "han_char");
	const snippetWordUnits = snippetUnits.filter((unit) => unit.kind !== "han_char");
	const hanAlignment = alignHanUnits(queryHanUnits, snippetHanUnits);
	const wordAlignment = alignWordUnits(queryWordUnits, snippetWordUnits);
	const alignedRanges = mergeRanges([
		...hanAlignment.alignedRanges,
		...wordAlignment.alignedRanges,
	]);
	const totalUnitCount = queryUnits.length;
	const unitCoverageCount =
		hanAlignment.matchedCharCount +
		wordAlignment.exactWordHitCount +
		wordAlignment.prefixWordHitCount +
		wordAlignment.fuzzyWordHitCount;
	const unitCoverageRatio =
		totalUnitCount > 0 ? unitCoverageCount / totalUnitCount : 0;
	const totalHanBigrams = Math.max(queryHanUnits.length - 1, 0);
	const hanBigramCoverageRatio =
		totalHanBigrams > 0
			? hanAlignment.matchedBigramCount / totalHanBigrams
			: queryHanUnits.length > 0 && hanAlignment.matchedCharCount > 0
				? 1
				: 0;
	const alignmentScore =
		unitCoverageCount * 100 +
		hanAlignment.matchedBigramCount * 40 +
		wordAlignment.exactWordHitCount * 60 +
		wordAlignment.prefixWordHitCount * 35 +
		wordAlignment.fuzzyWordHitCount * 20 +
		hanAlignment.maxConsecutiveUnitRun * 10 -
		hanAlignment.gapPenalty;
	return {
		alignmentScore,
		alignedRanges,
		unitCoverageCount,
		unitCoverageRatio,
		hanBigramCoverageCount: hanAlignment.matchedBigramCount,
		hanBigramCoverageRatio,
		exactWordHitCount: wordAlignment.exactWordHitCount,
		prefixWordHitCount: wordAlignment.prefixWordHitCount,
		fuzzyWordHitCount: wordAlignment.fuzzyWordHitCount,
		maxConsecutiveUnitRun: hanAlignment.maxConsecutiveUnitRun,
		gapPenalty: hanAlignment.gapPenalty,
		maxGap: hanAlignment.maxGap,
		signature: JSON.stringify({
			q: queryUnits.map((unit) => unit.normalized),
			h: hanAlignment.signature,
			w: wordAlignment.signature,
		}),
	};
}

export function unitizeQueryText(text: string): CoverageLexicalSnippetAlignmentUnit[] {
	return unitizeText(text, false);
}

export function unitizeSnippetText(
	text: string,
): CoverageLexicalSnippetAlignmentUnit[] {
	return unitizeText(text, true);
}

function unitizeText(
	text: string,
	preserveOffsets: boolean,
): CoverageLexicalSnippetAlignmentUnit[] {
	const units: CoverageLexicalSnippetAlignmentUnit[] = [];
	for (const match of text.matchAll(QUERY_UNIT_REGEX)) {
		const raw = match[0];
		const start = match.index ?? 0;
		if (/^\p{Script=Han}$/u.test(raw)) {
			units.push({
				kind: "han_char",
				text: raw,
				normalized: raw,
				start,
				end: start + raw.length,
			});
			continue;
		}
		if (/^\p{Script=Han}+$/u.test(raw)) {
			let offset = start;
			for (const char of Array.from(raw)) {
				units.push({
					kind: "han_char",
					text: char,
					normalized: char,
					start: offset,
					end: offset + char.length,
				});
				offset += char.length;
			}
			continue;
		}
		const normalized = raw.toLowerCase();
		units.push({
			kind: /[a-z]/i.test(raw) && /[0-9_\-./:+#]/.test(raw) ? "mixed_word" : "latin_word",
			text: raw,
			normalized,
			start: preserveOffsets ? start : units.length,
			end: preserveOffsets ? start + raw.length : units.length + raw.length,
		});
	}
	return units;
}

function alignHanUnits(
	queryUnits: readonly (AlignmentUnit & { kind: "han_char" })[],
	snippetUnits: readonly (AlignmentUnit & { kind: "han_char" })[],
): HanAlignmentResult {
	if (queryUnits.length === 0 || snippetUnits.length === 0) {
		return {
			score: 0,
			alignedRanges: [],
			matchedCharCount: 0,
			matchedBigramCount: 0,
			maxConsecutiveUnitRun: 0,
			gapPenalty: 0,
			maxGap: 0,
			signature: "",
		};
	}
	let states: HanAlignmentState[] = [];
	for (let queryIndex = 0; queryIndex < queryUnits.length; queryIndex++) {
		const queryChar = queryUnits[queryIndex].normalized;
		const next = new Map<string, HanAlignmentState>();
		for (let snippetIndex = 0; snippetIndex < snippetUnits.length; snippetIndex++) {
			if (snippetUnits[snippetIndex].normalized !== queryChar) {
				continue;
			}
			upsertHanState(next, {
				score: hanCharWeight(queryChar),
				queryIndex,
				snippetIndex,
				matchedQueryIndices: [queryIndex],
				matchedSnippetIndices: [snippetIndex],
				matchedBigramCount: 0,
				charRun: 1,
				maxCharRun: 1,
				gapPenalty: 0,
				maxGap: 0,
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
					hanCharWeight(queryChar) -
					computeGapPenalty(gap);
				let charRun = 1;
				let maxCharRun = previous.maxCharRun;
				let matchedBigramCount = previous.matchedBigramCount;
				if (consecutiveQuery && consecutiveSnippet) {
					charRun = previous.charRun + 1;
					maxCharRun = Math.max(maxCharRun, charRun);
					matchedBigramCount += 1;
					score += 5;
				}
				upsertHanState(next, {
					score,
					queryIndex,
					snippetIndex,
					matchedQueryIndices: [...previous.matchedQueryIndices, queryIndex],
					matchedSnippetIndices: [...previous.matchedSnippetIndices, snippetIndex],
					matchedBigramCount,
					charRun,
					maxCharRun,
					gapPenalty: previous.gapPenalty + computeGapPenalty(gap),
					maxGap: Math.max(previous.maxGap, gap),
				});
			}
		}
		states = pruneHanStates([...states, ...next.values()]);
	}
	const best = pickBestHanState(states);
	if (!best) {
		return {
			score: 0,
			alignedRanges: [],
			matchedCharCount: 0,
			matchedBigramCount: 0,
			maxConsecutiveUnitRun: 0,
			gapPenalty: 0,
			maxGap: 0,
			signature: "",
		};
	}
	const supplemental = collectSupplementalHanMatches(
		queryUnits,
		snippetUnits,
		best.matchedQueryIndices,
		best.matchedSnippetIndices,
	);
	const snippetIndices = [
		...best.matchedSnippetIndices,
		...supplemental.snippetIndices,
	].sort((left, right) => left - right);
	return {
		score: best.score + supplemental.score,
		alignedRanges: mergeRanges(
			snippetIndices.map((index) => ({
				start: snippetUnits[index].start,
				end: snippetUnits[index].end,
			})),
		),
		matchedCharCount: best.matchedQueryIndices.length + supplemental.queryIndices.length,
		matchedBigramCount: best.matchedBigramCount,
		maxConsecutiveUnitRun: Math.max(best.maxCharRun, supplemental.maxRun),
		gapPenalty: best.gapPenalty,
		maxGap: best.maxGap,
		signature: JSON.stringify({
			q: [...best.matchedQueryIndices, ...supplemental.queryIndices].sort(
				(left, right) => left - right,
			),
			s: snippetIndices,
		}),
	};
}

function alignWordUnits(
	queryUnits: readonly AlignmentUnit[],
	snippetUnits: readonly AlignmentUnit[],
): WordAlignmentResult {
	const exact = new Set<string>();
	const prefix = new Set<string>();
	const fuzzy = new Set<string>();
	const ranges: CoverageLexicalHighlightRange[] = [];
	for (const queryUnit of queryUnits) {
		for (const snippetUnit of snippetUnits) {
			if (snippetUnit.normalized === queryUnit.normalized) {
				exact.add(queryUnit.normalized);
				ranges.push({ start: snippetUnit.start, end: snippetUnit.end });
				break;
			}
			if (
				snippetUnit.normalized.startsWith(queryUnit.normalized) ||
				queryUnit.normalized.startsWith(snippetUnit.normalized)
			) {
				prefix.add(queryUnit.normalized);
				ranges.push({ start: snippetUnit.start, end: snippetUnit.end });
				break;
			}
			const maxDistance = computeMaxWordFuzzyDistance(queryUnit.normalized);
			if (
				maxDistance > 0 &&
				boundedLevenshtein(
					snippetUnit.normalized,
					queryUnit.normalized,
					maxDistance,
				) <= maxDistance
			) {
				fuzzy.add(queryUnit.normalized);
				ranges.push({ start: snippetUnit.start, end: snippetUnit.end });
				break;
			}
		}
	}
	return {
		exactWordHitCount: exact.size,
		prefixWordHitCount: prefix.size,
		fuzzyWordHitCount: fuzzy.size,
		alignedRanges: mergeRanges(ranges),
		signature: JSON.stringify({
			e: [...exact].sort(),
			p: [...prefix].sort(),
			f: [...fuzzy].sort(),
		}),
	};
}

function upsertHanState(target: Map<string, HanAlignmentState>, state: HanAlignmentState): void {
	const key = `${state.queryIndex}:${state.snippetIndex}`;
	const existing = target.get(key);
	if (!existing || state.score > existing.score) {
		target.set(key, state);
	}
}

function pruneHanStates(states: HanAlignmentState[]): HanAlignmentState[] {
	const deduped = new Map<string, HanAlignmentState>();
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

function pickBestHanState(states: readonly HanAlignmentState[]): HanAlignmentState | null {
	let best: HanAlignmentState | null = null;
	for (const state of states) {
		if (!best || state.score > best.score) {
			best = state;
		}
	}
	return best;
}

function hanCharWeight(char: string): number {
	return WEAK_HAN_CHARS.has(char) ? 0.6 : 2;
}

function collectSupplementalHanMatches(
	queryUnits: readonly AlignmentUnit[],
	snippetUnits: readonly AlignmentUnit[],
	matchedQueryIndices: readonly number[],
	matchedSnippetIndices: readonly number[],
): {
	queryIndices: number[];
	snippetIndices: number[];
	score: number;
	maxRun: number;
} {
	const usedQuery = new Set(matchedQueryIndices);
	const usedSnippet = new Set(matchedSnippetIndices);
	const queryIndices: number[] = [];
	const snippetIndices: number[] = [];
	let currentRun = 0;
	let maxRun = 0;
	for (let queryIndex = 0; queryIndex < queryUnits.length; queryIndex++) {
		if (usedQuery.has(queryIndex)) {
			currentRun = 0;
			continue;
		}
		const snippetIndex = snippetUnits.findIndex(
			(unit, index) =>
				!usedSnippet.has(index) && unit.normalized === queryUnits[queryIndex].normalized,
		);
		if (snippetIndex < 0) {
			currentRun = 0;
			continue;
		}
		queryIndices.push(queryIndex);
		snippetIndices.push(snippetIndex);
		usedSnippet.add(snippetIndex);
		currentRun += 1;
		maxRun = Math.max(maxRun, currentRun);
	}
	return {
		queryIndices,
		snippetIndices,
		score: queryIndices.reduce(
			(total, queryIndex) => total + hanCharWeight(queryUnits[queryIndex].normalized) * 0.5,
			0,
		),
		maxRun,
	};
}

function computeGapPenalty(gap: number): number {
	if (gap <= 0) {
		return 0;
	}
	return gap * 0.35 + (gap >= 3 ? gap * 0.4 : 0);
}

function computeMaxWordFuzzyDistance(term: string): number {
	if (term.length <= 4) {
		return 0;
	}
	return Math.min(2, Math.max(1, Math.round(term.length * 0.2)));
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

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}
	const previous = new Array<number>(b.length + 1);
	const current = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		previous[index] = index;
	}
	for (let row = 1; row <= a.length; row++) {
		current[0] = row;
		let rowMin = current[0];
		for (let column = 1; column <= b.length; column++) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			current[column] = Math.min(
				previous[column] + 1,
				current[column - 1] + 1,
				previous[column - 1] + cost,
			);
			rowMin = Math.min(rowMin, current[column]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= b.length; index++) {
			previous[index] = current[index];
		}
	}
	return previous[b.length];
}
