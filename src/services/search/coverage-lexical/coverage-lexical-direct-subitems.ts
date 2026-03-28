import { Vault } from "obsidian";
import { FileSubItem } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import { buildLineOffsets, offsetToLine } from "../hybrid/chunker";
import { FileSnapshotStore } from "../shared/file-snapshot-store";
import { Tokenizer } from "../tokenizer";
import { buildCoverageLexicalDisplayWindowSignals } from "./coverage-lexical-windowing";
import type {
	CoverageLexicalDisplayWindow,
	CoverageLexicalFamily,
	CoverageLexicalHighlightRange,
	CoverageLexicalPairSignature,
} from "./coverage-lexical-types";

type CoverageDirectSubItemBuilderParams = {
	path: string;
	bodyTextFallback: string;
	bodyTokenSequence: readonly string[];
	families: readonly CoverageLexicalFamily[];
	pairSignatures: readonly CoverageLexicalPairSignature[];
	maxSubItemCount: number;
};

type TokenOffset = {
	token: string;
	start: number;
	end: number;
};

type CoverageSnippetPayload = {
	text: string;
	html: string;
	row: number;
	col: number;
	highlightRanges: CoverageLexicalHighlightRange[];
};

const MAX_SNIPPET_WINDOW_CHARS = 220;
const SNIPPET_LEADING_CONTEXT_CHARS = 24;
const NEAR_DUPLICATE_OVERLAP_RATIO = 0.72;

@singleton()
export class CoverageLexicalDirectSubItemBuilder {
	private readonly tokenizer = getInstance(Tokenizer);
	private fileSnapshotStore?: FileSnapshotStore | null;
	private readonly offsetCache = new Map<
		string,
		{ lineOffsets: number[]; tokenOffsets: TokenOffset[] }
	>();

	async build(params: CoverageDirectSubItemBuilderParams): Promise<FileSubItem[]> {
		const maxSubItemCount = Math.max(0, params.maxSubItemCount);
		if (maxSubItemCount === 0 || params.bodyTokenSequence.length === 0) {
			return [];
		}
		const displayWindows = this.selectDisplayWindows(
			params.bodyTokenSequence,
			params.families,
			params.pairSignatures,
			maxSubItemCount,
		);
		if (displayWindows.length === 0) {
			return [];
		}
		const snapshotText = await this.readSnapshotText(
			params.path,
			params.bodyTextFallback,
		);
		if (!snapshotText) {
			return [];
		}
		const tokenOffsets = this.getTokenOffsets(params.path, snapshotText);
		if (tokenOffsets.length === 0) {
			return [];
		}
		const lineOffsets = this.getLineOffsets(params.path, snapshotText);
		const subItems: FileSubItem[] = [];
		for (const window of displayWindows) {
			const snippet = this.buildSnippetPayload(
				snapshotText,
				lineOffsets,
				tokenOffsets,
				window,
				params.bodyTokenSequence,
				params.families,
			);
			if (!snippet) {
				continue;
			}
			const subItem = new FileSubItem(
				snippet.text,
				snippet.row,
				snippet.col,
				window.signal.score,
				snippet.html,
			);
			subItem.snippetText = snippet.text;
			subItem.highlightRanges = snippet.highlightRanges.map((range) => ({
				start: range.start,
				end: range.end,
			}));
			subItems.push(subItem);
		}
		return subItems;
	}

	private selectDisplayWindows(
		bodyTokenSequence: readonly string[],
		families: readonly CoverageLexicalFamily[],
		pairSignatures: readonly CoverageLexicalPairSignature[],
		maxSubItemCount: number,
	): CoverageLexicalDisplayWindow[] {
		const rawSignals = buildCoverageLexicalDisplayWindowSignals(
			bodyTokenSequence,
			families,
			pairSignatures,
		);
		const remaining = rawSignals.map((signal, index) => toDisplayWindow(signal, index));
		const selected: CoverageLexicalDisplayWindow[] = [];
		while (remaining.length > 0 && selected.length < maxSubItemCount) {
			let bestIndex = -1;
			let bestScore = -Infinity;
			for (let index = 0; index < remaining.length; index++) {
				const candidate = remaining[index];
				const adjusted = computeSelectionPriority(candidate, selected);
				if (
					adjusted > bestScore ||
					(adjusted === bestScore &&
						candidate.signal.score >
							(remaining[bestIndex]?.signal.score ?? -Infinity))
				) {
					bestScore = adjusted;
					bestIndex = index;
				}
			}
			if (bestIndex < 0 || bestScore === -Infinity) {
				break;
			}
			const [best] = remaining.splice(bestIndex, 1);
			if (selected.some((existing) => isNearDuplicateWindow(best, existing))) {
				continue;
			}
			selected.push(best);
		}
		return selected;
	}

	private async readSnapshotText(
		path: string,
		bodyTextFallback: string,
	): Promise<string> {
		const snapshotStore = this.getFileSnapshotStore();
		if (!snapshotStore) {
			return bodyTextFallback;
		}
		const currentText = snapshotStore.peekCurrentFileText(path);
		if (currentText !== undefined) {
			return currentText;
		}
		const indexed = await snapshotStore.getIndexedSnapshotTexts([path]);
		return indexed.get(path) ?? bodyTextFallback;
	}

	private getTokenOffsets(path: string, text: string): TokenOffset[] {
		const cacheKey = buildOffsetCacheKey(path, text);
		const cached = this.offsetCache.get(cacheKey);
		if (cached) {
			return cached.tokenOffsets;
		}
		const tokenizeWithOffsets = (
			this.tokenizer as Tokenizer & {
				tokenizeSequenceWithOffsets?: (
					text: string,
					mode: "index" | "search",
				) => Array<{ token: string; start: number; end: number }>;
			}
		).tokenizeSequenceWithOffsets;
		if (!tokenizeWithOffsets) {
			return [];
		}
		const tokenOffsets = tokenizeWithOffsets.call(this.tokenizer, text, "index")
			.map((entry) => ({
				token: entry.token.toLowerCase(),
				start: entry.start,
				end: entry.end,
			}));
		const lineOffsets = buildLineOffsets(text);
		this.offsetCache.set(cacheKey, { lineOffsets, tokenOffsets });
		return tokenOffsets;
	}

	private getLineOffsets(path: string, text: string): number[] {
		const cacheKey = buildOffsetCacheKey(path, text);
		const cached = this.offsetCache.get(cacheKey);
		if (cached) {
			return cached.lineOffsets;
		}
		const tokenizeWithOffsets = (
			this.tokenizer as Tokenizer & {
				tokenizeSequenceWithOffsets?: (
					text: string,
					mode: "index" | "search",
				) => Array<{ token: string; start: number; end: number }>;
			}
		).tokenizeSequenceWithOffsets;
		const tokenOffsets = tokenizeWithOffsets
			? tokenizeWithOffsets.call(this.tokenizer, text, "index")
			.map((entry) => ({
				token: entry.token.toLowerCase(),
				start: entry.start,
				end: entry.end,
			}))
			: [];
		const lineOffsets = buildLineOffsets(text);
		this.offsetCache.set(cacheKey, { lineOffsets, tokenOffsets });
		return lineOffsets;
	}

	private buildSnippetPayload(
		text: string,
		lineOffsets: number[],
		tokenOffsets: readonly TokenOffset[],
		window: CoverageLexicalDisplayWindow,
		bodyTokenSequence: readonly string[],
		families: readonly CoverageLexicalFamily[],
	): CoverageSnippetPayload | null {
		if (
			window.startTokenIndex < 0 ||
			window.endTokenIndex < window.startTokenIndex ||
			window.endTokenIndex >= tokenOffsets.length
		) {
			return null;
		}
		const anchorTokenIndex = findAnchorTokenIndex(
			bodyTokenSequence,
			window,
			families,
		);
		const anchorOffset = tokenOffsets[anchorTokenIndex];
		const windowStartOffset = tokenOffsets[window.startTokenIndex]?.start;
		const windowEndOffset = tokenOffsets[window.endTokenIndex]?.end;
		if (
			windowStartOffset === undefined ||
			windowEndOffset === undefined ||
			anchorOffset === undefined
		) {
			return null;
		}
		const rawRanges: CoverageLexicalHighlightRange[] = [];
		const familyMap = new Map(families.map((family) => [family.index, family] as const));
		for (
			let tokenIndex = window.startTokenIndex;
			tokenIndex <= window.endTokenIndex && tokenIndex < tokenOffsets.length;
			tokenIndex++
		) {
			const offset = tokenOffsets[tokenIndex];
			const token = bodyTokenSequence[tokenIndex];
			const isMatched = window.matchedFamilyIndices.some((familyIndex) => {
				const family = familyMap.get(familyIndex);
				return family ? matchesTokenToFamily(token, family) : false;
			});
			if (!isMatched) {
				continue;
			}
			rawRanges.push({
				start: offset.start,
				end: offset.end,
			});
		}
		const mergedRanges = mergeRanges(rawRanges);
		const snippetStart = Math.max(
			0,
			Math.min(
				windowStartOffset - SNIPPET_LEADING_CONTEXT_CHARS,
				Math.round((windowStartOffset + windowEndOffset) / 2) -
					Math.floor(MAX_SNIPPET_WINDOW_CHARS / 2),
			),
		);
		const snippetEnd = Math.min(text.length, snippetStart + MAX_SNIPPET_WINDOW_CHARS);
		const normalizedStart = Math.max(0, snippetEnd - MAX_SNIPPET_WINDOW_CHARS);
		const snippetText = text.slice(normalizedStart, snippetEnd);
		const localRanges = mergedRanges
			.filter((range) => range.end > normalizedStart && range.start < snippetEnd)
			.map((range) => ({
				start: Math.max(0, range.start - normalizedStart),
				end: Math.min(snippetEnd - normalizedStart, range.end - normalizedStart),
			}));
		const prefixEllipsis = normalizedStart > 0;
		const suffixEllipsis = snippetEnd < text.length;
		const snippetTextWithEllipsis = `${
			prefixEllipsis ? "…" : ""
		}${snippetText}${suffixEllipsis ? "…" : ""}`;
		const adjustedRanges = localRanges.map((range) => ({
			start: range.start + (prefixEllipsis ? 1 : 0),
			end: range.end + (prefixEllipsis ? 1 : 0),
		}));
		const row = offsetToLine(lineOffsets, anchorOffset.start);
		const lineStartOffset = lineOffsets[row] ?? 0;
		const col = Math.max(0, anchorOffset.start - lineStartOffset);
		return {
			text: snippetTextWithEllipsis,
			html: renderHighlightedSnippet(snippetText, localRanges, {
				prefixEllipsis,
				suffixEllipsis,
			}),
			row,
			col,
			highlightRanges: adjustedRanges,
		};
	}

	private getFileSnapshotStore(): FileSnapshotStore | null {
		if (this.fileSnapshotStore !== undefined) {
			return this.fileSnapshotStore;
		}
		if (!container.isRegistered(Vault, true)) {
			this.fileSnapshotStore = null;
			return null;
		}
		this.fileSnapshotStore = getInstance(FileSnapshotStore);
		return this.fileSnapshotStore;
	}
}

function toDisplayWindow(
	signal: CoverageLexicalDisplayWindow["signal"],
	rank: number,
): CoverageLexicalDisplayWindow {
	return {
		startTokenIndex: signal.start,
		endTokenIndex: signal.end,
		signal,
		matchedFamilyIndices: uniqueSortedNumbers([
			...signal.matchedExactCoreFamilyIndices,
			...signal.matchedPrefixCoreFamilyIndices,
			...signal.matchedFuzzyCoreFamilyIndices,
			...signal.matchedAnchorFamilyIndices,
			...signal.matchedSoftFamilyIndices,
		]),
		kind: rank === 0 ? "primary" : rank === 1 ? "support" : "supplemental",
		rank,
	};
}

function isNearDuplicateWindow(
	left: CoverageLexicalDisplayWindow,
	right: CoverageLexicalDisplayWindow,
): boolean {
	const overlap = computeWindowOverlapRatio(left, right);
	if (overlap < NEAR_DUPLICATE_OVERLAP_RATIO) {
		return false;
	}
	const leftSpan = Math.max(1, left.endTokenIndex - left.startTokenIndex + 1);
	const rightSpan = Math.max(1, right.endTokenIndex - right.startTokenIndex + 1);
	return (
		Math.abs(leftSpan - rightSpan) <= 3 &&
		intersectCount(left.matchedFamilyIndices, right.matchedFamilyIndices) >=
			Math.min(left.matchedFamilyIndices.length, right.matchedFamilyIndices.length)
	);
}

function computeSelectionPriority(
	candidate: CoverageLexicalDisplayWindow,
	selected: readonly CoverageLexicalDisplayWindow[],
): number {
	let score = candidate.signal.score;
	for (const existing of selected) {
		const overlap = computeWindowOverlapRatio(candidate, existing);
		if (overlap >= NEAR_DUPLICATE_OVERLAP_RATIO) {
			return -Infinity;
		}
		const familyOverlap = computeFamilyOverlapRatio(
			candidate.matchedFamilyIndices,
			existing.matchedFamilyIndices,
		);
		const tokenGap = computeTokenGap(candidate, existing);
		if (familyOverlap >= 1 && tokenGap <= 48) {
			score -= 18;
			continue;
		}
		if (familyOverlap >= 0.75 && tokenGap <= 24) {
			score -= 10;
			continue;
		}
		if (familyOverlap >= 0.5 && tokenGap <= 12) {
			score -= 4;
		}
	}
	return score;
}

function computeWindowOverlapRatio(
	left: CoverageLexicalDisplayWindow,
	right: CoverageLexicalDisplayWindow,
): number {
	const overlapStart = Math.max(left.startTokenIndex, right.startTokenIndex);
	const overlapEnd = Math.min(left.endTokenIndex, right.endTokenIndex);
	if (overlapEnd < overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart + 1;
	const base = Math.max(
		1,
		Math.min(
			left.endTokenIndex - left.startTokenIndex + 1,
			right.endTokenIndex - right.startTokenIndex + 1,
		),
	);
	return overlap / base;
}

function computeTokenGap(
	left: CoverageLexicalDisplayWindow,
	right: CoverageLexicalDisplayWindow,
): number {
	if (left.endTokenIndex < right.startTokenIndex) {
		return right.startTokenIndex - left.endTokenIndex;
	}
	if (right.endTokenIndex < left.startTokenIndex) {
		return left.startTokenIndex - right.endTokenIndex;
	}
	return 0;
}

function findAnchorTokenIndex(
	bodyTokenSequence: readonly string[],
	window: CoverageLexicalDisplayWindow,
	families: readonly CoverageLexicalFamily[],
): number {
	const familyMap = new Map(families.map((family) => [family.index, family] as const));
	for (
		let tokenIndex = window.startTokenIndex;
		tokenIndex <= window.endTokenIndex && tokenIndex < bodyTokenSequence.length;
		tokenIndex++
	) {
		const token = bodyTokenSequence[tokenIndex];
		for (const familyIndex of window.matchedFamilyIndices) {
			const family = familyMap.get(familyIndex);
			if (!family) {
				continue;
			}
			if (matchesTokenToFamily(token, family)) {
				return tokenIndex;
			}
		}
	}
	return window.startTokenIndex;
}

function matchesTokenToFamily(
	token: string,
	family: CoverageLexicalFamily,
): boolean {
	if (token === family.normalizedTerm) {
		return true;
	}
	if (family.allowPrefix && token.startsWith(family.normalizedTerm)) {
		return true;
	}
	if (!family.allowFuzzy) {
		return false;
	}
	const maxDistance = computeMaxFuzzyDistance(family.normalizedTerm);
	return (
		maxDistance > 0 &&
		token[0] === family.normalizedTerm[0] &&
		boundedLevenshtein(token, family.normalizedTerm, maxDistance) <= maxDistance
	);
}

function renderHighlightedSnippet(
	snippetText: string,
	ranges: readonly CoverageLexicalHighlightRange[],
	options: {
		prefixEllipsis: boolean;
		suffixEllipsis: boolean;
	},
): string {
	if (ranges.length === 0) {
		return escapeHtml(snippetText);
	}
	let rendered = options.prefixEllipsis ? "&hellip;" : "";
	let cursor = 0;
	for (const range of mergeRanges(ranges)) {
		rendered += escapeHtml(snippetText.slice(cursor, range.start));
		rendered += `<mark>${escapeHtml(snippetText.slice(range.start, range.end))}</mark>`;
		cursor = range.end;
	}
	rendered += escapeHtml(snippetText.slice(cursor));
	if (options.suffixEllipsis) {
		rendered += "&hellip;";
	}
	return rendered;
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

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
	return Array.from(new Set(values)).sort((left, right) => left - right);
}

function intersectCount(left: readonly number[], right: readonly number[]): number {
	const rightSet = new Set(right);
	let count = 0;
	for (const value of left) {
		if (rightSet.has(value)) {
			count += 1;
		}
	}
	return count;
}

function computeFamilyOverlapRatio(
	left: readonly number[],
	right: readonly number[],
): number {
	if (left.length === 0 || right.length === 0) {
		return 0;
	}
	return intersectCount(left, right) / Math.max(1, Math.min(left.length, right.length));
}

function computeMaxFuzzyDistance(queryTerm: string): number {
	if (queryTerm.length <= 4) {
		return 0;
	}
	return Math.min(2, Math.max(1, Math.round(queryTerm.length * 0.2)));
}

function buildOffsetCacheKey(path: string, text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${path}::${text.length}::${hash >>> 0}`;
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
