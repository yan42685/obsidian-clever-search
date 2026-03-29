import { Vault } from "obsidian";
import { FileSubItem } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import { buildLineOffsets, offsetToLine } from "../hybrid/chunker";
import { FileSnapshotStore } from "../shared/file-snapshot-store";
import { Tokenizer } from "../tokenizer";
import { extractHanBigramsWithOffsets } from "./coverage-lexical-cjk";
import { selectCoverageLexicalDisplayWindows } from "./coverage-lexical-display-windows";
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
	charQueryTerms?: readonly string[];
	displayWindows?: readonly CoverageLexicalDisplayWindow[];
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

type CharRange = {
	start: number;
	end: number;
};

const MAX_SNIPPET_WINDOW_CHARS = 220;
const SNIPPET_LEADING_CONTEXT_CHARS = 24;
const SNIPPET_TRAILING_CONTEXT_CHARS = 32;
const MATCH_SEARCH_CONTEXT_CHARS = 96;

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
		const displayWindows =
			params.displayWindows?.slice(0, maxSubItemCount) ??
			selectCoverageLexicalDisplayWindows(
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
				params.charQueryTerms ?? [],
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
		const lineOffsets = buildLineOffsets(text);
		this.offsetCache.set(cacheKey, { lineOffsets, tokenOffsets: [] });
		return lineOffsets;
	}

	private buildSnippetPayload(
		text: string,
		lineOffsets: number[],
		tokenOffsets: readonly TokenOffset[],
		window: CoverageLexicalDisplayWindow,
		bodyTokenSequence: readonly string[],
		families: readonly CoverageLexicalFamily[],
		charQueryTerms: readonly string[],
	): CoverageSnippetPayload | null {
		if (window.startTokenIndex < 0 || window.endTokenIndex < window.startTokenIndex) {
			return null;
		}
		const approximateWindow = resolveApproximateWindowRange(
			text.length,
			tokenOffsets,
			bodyTokenSequence.length,
			window,
		);
		const familyMap = new Map(families.map((family) => [family.index, family] as const));
		const matchedFamilies = window.matchedFamilyIndices
			.map((familyIndex) => familyMap.get(familyIndex))
			.filter((family): family is CoverageLexicalFamily => family !== undefined);
		const searchRegion = expandRange(
			approximateWindow,
			text.length,
			MATCH_SEARCH_CONTEXT_CHARS,
		);
		const mergedRanges = collectMatchedRanges(
			text,
			tokenOffsets,
			searchRegion,
			matchedFamilies,
			charQueryTerms,
		);
		const anchorOffset = pickAnchorOffset(mergedRanges, approximateWindow);
		const snippetRange = buildSnippetRange(
			text.length,
			mergedRanges,
			anchorOffset,
			approximateWindow,
		);
		const snippetText = text.slice(snippetRange.start, snippetRange.end);
		const localRanges = mergedRanges
			.filter((range) => range.end > snippetRange.start && range.start < snippetRange.end)
			.map((range) => ({
				start: Math.max(0, range.start - snippetRange.start),
				end: Math.min(
					snippetRange.end - snippetRange.start,
					range.end - snippetRange.start,
				),
			}));
		const prefixEllipsis = snippetRange.start > 0;
		const suffixEllipsis = snippetRange.end < text.length;
		const snippetTextWithEllipsis = `${prefixEllipsis ? "…" : ""}${snippetText}${
			suffixEllipsis ? "…" : ""
		}`;
		const adjustedRanges = localRanges.map((range) => ({
			start: range.start + (prefixEllipsis ? 1 : 0),
			end: range.end + (prefixEllipsis ? 1 : 0),
		}));
		const row = offsetToLine(lineOffsets, anchorOffset);
		const lineStartOffset = lineOffsets[row] ?? 0;
		const col = Math.max(0, anchorOffset - lineStartOffset);
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

function resolveApproximateWindowRange(
	textLength: number,
	tokenOffsets: readonly TokenOffset[],
	bodyTokenCount: number,
	window: CoverageLexicalDisplayWindow,
): CharRange {
	const exactStart = tokenOffsets[window.startTokenIndex]?.start;
	const exactEnd = tokenOffsets[window.endTokenIndex]?.end;
	if (exactStart !== undefined && exactEnd !== undefined) {
		return {
			start: exactStart,
			end: Math.max(exactStart, exactEnd),
		};
	}
	const tokenCount = Math.max(bodyTokenCount, tokenOffsets.length, 1);
	const startRatio = clamp(window.startTokenIndex / tokenCount, 0, 1);
	const endRatio = clamp((window.endTokenIndex + 1) / tokenCount, 0, 1);
	const estimatedStart = Math.floor(textLength * startRatio);
	const estimatedEnd = Math.ceil(textLength * Math.max(startRatio, endRatio));
	return {
		start: estimatedStart,
		end: Math.max(estimatedStart, Math.min(textLength, estimatedEnd)),
	};
}

function expandRange(
	range: CharRange,
	maxLength: number,
	padding: number,
): CharRange {
	return {
		start: Math.max(0, range.start - padding),
		end: Math.min(maxLength, range.end + padding),
	};
}

function collectMatchedRanges(
	text: string,
	tokenOffsets: readonly TokenOffset[],
	searchRegion: CharRange,
	families: readonly CoverageLexicalFamily[],
	charQueryTerms: readonly string[],
): CoverageLexicalHighlightRange[] {
	const tokenRanges = collectTokenMatchedRanges(tokenOffsets, searchRegion, families);
	if (tokenRanges.length > 0) {
		return mergeRanges(tokenRanges);
	}
	const substringRanges = collectSubstringMatchedRanges(text, searchRegion, families);
	if (substringRanges.length > 0) {
		return mergeRanges(substringRanges);
	}
	return mergeRanges(collectCharMatchedRanges(text, searchRegion, charQueryTerms));
}

function collectTokenMatchedRanges(
	tokenOffsets: readonly TokenOffset[],
	searchRegion: CharRange,
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalHighlightRange[] {
	const ranges: CoverageLexicalHighlightRange[] = [];
	for (const offset of tokenOffsets) {
		if (offset.end <= searchRegion.start || offset.start >= searchRegion.end) {
			continue;
		}
		for (const family of families) {
			const range = resolveTokenMatchRange(offset, family);
			if (!range) {
				continue;
			}
			ranges.push(range);
		}
	}
	return ranges;
}

function resolveTokenMatchRange(
	offset: TokenOffset,
	family: CoverageLexicalFamily,
): CoverageLexicalHighlightRange | null {
	if (offset.token === family.normalizedTerm) {
		return {
			start: offset.start,
			end: offset.start + family.normalizedTerm.length,
		};
	}
	if (family.allowPrefix && offset.token.startsWith(family.normalizedTerm)) {
		return {
			start: offset.start,
			end: Math.min(offset.end, offset.start + family.normalizedTerm.length),
		};
	}
	if (!family.allowFuzzy) {
		return null;
	}
	const maxDistance = computeMaxFuzzyDistance(family.normalizedTerm);
	if (
		maxDistance <= 0 ||
		offset.token[0] !== family.normalizedTerm[0] ||
		boundedLevenshtein(offset.token, family.normalizedTerm, maxDistance) > maxDistance
	) {
		return null;
	}
	return {
		start: offset.start,
		end: offset.end,
	};
}

function collectSubstringMatchedRanges(
	text: string,
	searchRegion: CharRange,
	families: readonly CoverageLexicalFamily[],
): CoverageLexicalHighlightRange[] {
	const haystack = text.slice(searchRegion.start, searchRegion.end).toLowerCase();
	const ranges: CoverageLexicalHighlightRange[] = [];
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
				start: searchRegion.start + foundAt,
				end: searchRegion.start + foundAt + family.normalizedTerm.length,
			});
			fromIndex = foundAt + Math.max(1, family.normalizedTerm.length);
		}
	}
	return ranges;
}

function collectCharMatchedRanges(
	text: string,
	searchRegion: CharRange,
	charQueryTerms: readonly string[],
): CoverageLexicalHighlightRange[] {
	if (charQueryTerms.length === 0) {
		return [];
	}
	const wanted = new Set(charQueryTerms);
	return extractHanBigramsWithOffsets(text)
		.filter(
			(entry) =>
				entry.end > searchRegion.start &&
				entry.start < searchRegion.end &&
				wanted.has(entry.token),
		)
		.map((entry) => ({
			start: entry.start,
			end: entry.end,
		}));
}

function pickAnchorOffset(
	ranges: readonly CoverageLexicalHighlightRange[],
	approximateWindow: CharRange,
): number {
	if (ranges.length === 0) {
		return approximateWindow.start;
	}
	return ranges[0].start;
}

function buildSnippetRange(
	textLength: number,
	ranges: readonly CoverageLexicalHighlightRange[],
	anchorOffset: number,
	approximateWindow: CharRange,
): CharRange {
	const focusStart = ranges.length > 0 ? ranges[0].start : anchorOffset;
	const focusEnd = ranges.length > 0 ? ranges[ranges.length - 1].end : approximateWindow.end;
	let start = Math.max(0, focusStart - SNIPPET_LEADING_CONTEXT_CHARS);
	let end = Math.min(
		textLength,
		Math.max(
			focusEnd + SNIPPET_TRAILING_CONTEXT_CHARS,
			start + MAX_SNIPPET_WINDOW_CHARS,
		),
	);
	if (end - start > MAX_SNIPPET_WINDOW_CHARS) {
		start = Math.max(0, anchorOffset - Math.floor(MAX_SNIPPET_WINDOW_CHARS / 2));
		end = Math.min(textLength, start + MAX_SNIPPET_WINDOW_CHARS);
		start = Math.max(0, end - MAX_SNIPPET_WINDOW_CHARS);
	}
	return { start, end };
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
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
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

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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
