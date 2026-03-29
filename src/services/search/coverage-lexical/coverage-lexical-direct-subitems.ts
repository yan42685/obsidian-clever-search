import { Vault } from "obsidian";
import { FileSubItem } from "src/globals/search-types";
import { logger } from "src/utils/logger";
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
	charQuerySegments?: readonly string[];
	debugQueryText?: string;
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
	anchorOffset: number;
	absoluteRange: CharRange;
	snippetScore: number;
	sourceWindowScore: number;
	evidenceType: "full_segment" | "family_local" | "char_bridge";
	regionKey: string;
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
		const payloads: CoverageSnippetPayload[] = [];
		for (const window of displayWindows) {
			const snippet = this.buildSnippetPayload(
				snapshotText,
				lineOffsets,
				tokenOffsets,
				window,
				params.bodyTokenSequence,
				params.families,
				params.charQueryTerms ?? [],
				params.charQuerySegments ?? [],
			);
			if (!snippet) {
				continue;
			}
			payloads.push(snippet);
		}
		const rankedPayloads = rankSnippetPayloads(payloads);
		const selectedPayloads = selectDiverseSnippetPayloads(
			rankedPayloads,
			maxSubItemCount,
		);
		const subItems = selectedPayloads.map((payload) => {
			const subItem = new FileSubItem(
				payload.text,
				payload.row,
				payload.col,
				payload.snippetScore,
				payload.html,
			);
			subItem.snippetText = payload.text;
			subItem.highlightRanges = payload.highlightRanges.map((range) => ({
				start: range.start,
				end: range.end,
			}));
			return subItem;
		});
		if (shouldLogCoverageLexicalHanSubitemDebug(params.debugQueryText)) {
			logger.debug("[coverage-lexical][han-debug] subitems-final", {
				queryText: params.debugQueryText,
				path: params.path,
				payloads: selectedPayloads.map((payload) => ({
					row: payload.row,
					col: payload.col,
					anchorOffset: payload.anchorOffset,
					absoluteRange: payload.absoluteRange,
					snippetScore: payload.snippetScore,
					sourceWindowScore: payload.sourceWindowScore,
					text: payload.text,
					highlightRanges: payload.highlightRanges,
				})),
			});
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
		charQuerySegments: readonly string[],
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
			charQuerySegments,
		);
		const anchorOffset = pickAnchorOffset(
			text,
			searchRegion,
			mergedRanges,
			approximateWindow,
			matchedFamilies,
			charQuerySegments,
		);
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
			anchorOffset,
			absoluteRange: snippetRange,
			snippetScore: scoreSnippetPayload(
				snippetText,
				localRanges,
				matchedFamilies,
				charQuerySegments,
				window.signal.score,
			),
			sourceWindowScore: window.signal.score,
			evidenceType: classifySnippetEvidenceType(
				snippetText,
				matchedFamilies,
				charQuerySegments,
			),
			regionKey: buildSnippetRegionKey(row, anchorOffset),
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
	charQuerySegments: readonly string[],
): CoverageLexicalHighlightRange[] {
	const tokenRanges = collectTokenMatchedRanges(tokenOffsets, searchRegion, families);
	const substringRanges =
		tokenRanges.length > 0
			? []
			: collectSubstringMatchedRanges(text, searchRegion, families);
	const charRanges = collectCharMatchedRanges(
		text,
		searchRegion,
		charQueryTerms,
		charQuerySegments,
	);
	return mergeRanges([...tokenRanges, ...substringRanges, ...charRanges]);
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
	charQuerySegments: readonly string[],
): CoverageLexicalHighlightRange[] {
	if (charQueryTerms.length === 0 || charQuerySegments.length === 0) {
		return [];
	}
	const wanted = new Set(charQueryTerms);
	const matchedRanges = extractHanBigramsWithOffsets(text)
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
	if (matchedRanges.length === 0) {
		return [];
	}
	return filterCharRangesBySegmentCoverage(text, matchedRanges, charQuerySegments);
}

function filterCharRangesBySegmentCoverage(
	text: string,
	ranges: readonly CoverageLexicalHighlightRange[],
	charQuerySegments: readonly string[],
): CoverageLexicalHighlightRange[] {
	const merged = mergeRanges(ranges);
	const kept: CoverageLexicalHighlightRange[] = [];
	for (const range of merged) {
		const clusterText = text.slice(range.start, range.end);
		for (const segment of charQuerySegments) {
			if (!segment) {
				continue;
			}
			if (clusterText.includes(segment)) {
				kept.push(range);
				break;
			}
			const segmentBigrams = extractHanBigramsWithOffsets(segment).map((entry) => entry.token);
			if (segmentBigrams.length === 0) {
				continue;
			}
			const clusterBigrams = new Set(
				extractHanBigramsWithOffsets(clusterText).map((entry) => entry.token),
			);
			const matchedCount = segmentBigrams.filter((token) => clusterBigrams.has(token)).length;
			if (acceptsCharClusterCoverage(segmentBigrams.length, matchedCount)) {
				kept.push(range);
				break;
			}
		}
	}
	return kept;
}

function acceptsCharClusterCoverage(totalBigrams: number, matchedCount: number): boolean {
	if (matchedCount <= 0 || totalBigrams <= 0) {
		return false;
	}
	if (totalBigrams <= 2) {
		return matchedCount === totalBigrams;
	}
	return matchedCount / totalBigrams >= 0.7;
}

function pickAnchorOffset(
	text: string,
	searchRegion: CharRange,
	ranges: readonly CoverageLexicalHighlightRange[],
	approximateWindow: CharRange,
	families: readonly CoverageLexicalFamily[],
	charQuerySegments: readonly string[],
): number {
	const clusterAnchor = pickBestEvidenceClusterAnchor(
		text,
		searchRegion,
		ranges,
		families,
		charQuerySegments,
	);
	if (clusterAnchor >= 0) {
		return clusterAnchor;
	}
	if (ranges.length === 0) {
		return approximateWindow.start;
	}
	return ranges[0].start;
}

function pickBestEvidenceClusterAnchor(
	text: string,
	searchRegion: CharRange,
	ranges: readonly CoverageLexicalHighlightRange[],
	families: readonly CoverageLexicalFamily[],
	charQuerySegments: readonly string[],
): number {
	if (ranges.length === 0) {
		return -1;
	}
	const clusters = buildEvidenceClusters(ranges);
	let bestCluster: { start: number; score: number } | null = null;
	for (const cluster of clusters) {
		const clusterText = text.slice(cluster.start, cluster.end);
		const score = scoreEvidenceCluster(clusterText, families, charQuerySegments);
		if (!bestCluster || score > bestCluster.score) {
			bestCluster = { start: cluster.start, score };
		}
	}
	if (bestCluster && bestCluster.score > 0) {
		return bestCluster.start;
	}
	const haystack = text.slice(searchRegion.start, searchRegion.end);
	for (const segment of charQuerySegments) {
		if (!segment) {
			continue;
		}
		const foundAt = haystack.indexOf(segment);
		if (foundAt >= 0) {
			return searchRegion.start + foundAt;
		}
	}
	return -1;
}

function buildEvidenceClusters(
	ranges: readonly CoverageLexicalHighlightRange[],
): CoverageLexicalHighlightRange[] {
	const ordered = mergeRanges(ranges);
	if (ordered.length <= 1) {
		return ordered;
	}
	const clusters: CoverageLexicalHighlightRange[] = [{ ...ordered[0] }];
	for (let index = 1; index < ordered.length; index++) {
		const current = ordered[index];
		const previous = clusters[clusters.length - 1];
		if (current.start - previous.end <= 16) {
			previous.end = Math.max(previous.end, current.end);
			continue;
		}
		clusters.push({ start: current.start, end: current.end });
	}
	return clusters;
}

function scoreEvidenceCluster(
	clusterText: string,
	families: readonly CoverageLexicalFamily[],
	charQuerySegments: readonly string[],
): number {
	let familyHitCount = 0;
	let fullSegmentCount = 0;
	let bestSegmentCoverageRatio = 0;
	let bestSegmentCoverageCount = 0;
	for (const family of families) {
		if (!family.normalizedTerm) {
			continue;
		}
		if (clusterText.toLowerCase().includes(family.normalizedTerm)) {
			familyHitCount += 1;
		}
	}
	const clusterBigrams = new Set(
		extractHanBigramsWithOffsets(clusterText).map((entry) => entry.token),
	);
	for (const segment of charQuerySegments) {
		if (!segment) {
			continue;
		}
		if (clusterText.includes(segment)) {
			fullSegmentCount += 1;
			bestSegmentCoverageRatio = 1;
			bestSegmentCoverageCount = Math.max(
				bestSegmentCoverageCount,
				Math.max(segment.length - 1, 1),
			);
			continue;
		}
		const segmentBigrams = extractHanBigramsWithOffsets(segment).map((entry) => entry.token);
		if (segmentBigrams.length === 0) {
			continue;
		}
		const matchedCount = segmentBigrams.filter((token) => clusterBigrams.has(token)).length;
		bestSegmentCoverageCount = Math.max(bestSegmentCoverageCount, matchedCount);
		bestSegmentCoverageRatio = Math.max(
			bestSegmentCoverageRatio,
			matchedCount / segmentBigrams.length,
		);
	}
	return (
		fullSegmentCount * 1000 +
		familyHitCount * 100 +
		bestSegmentCoverageRatio * 10 +
		bestSegmentCoverageCount
	);
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

function scoreSnippetPayload(
	snippetText: string,
	localRanges: readonly CoverageLexicalHighlightRange[],
	families: readonly CoverageLexicalFamily[],
	charQuerySegments: readonly string[],
	sourceWindowScore: number,
): number {
	const localText = snippetText.toLowerCase();
	let familyHitCount = 0;
	for (const family of families) {
		if (family.normalizedTerm && localText.includes(family.normalizedTerm)) {
			familyHitCount += 1;
		}
	}
	let fullSegmentCount = 0;
	let bestSegmentCoverageRatio = 0;
	let bestSegmentCoverageCount = 0;
	const snippetBigrams = new Set(
		extractHanBigramsWithOffsets(snippetText).map((entry) => entry.token),
	);
	for (const segment of charQuerySegments) {
		if (!segment) {
			continue;
		}
		if (snippetText.includes(segment)) {
			fullSegmentCount += 1;
			bestSegmentCoverageRatio = 1;
			bestSegmentCoverageCount = Math.max(bestSegmentCoverageCount, segment.length - 1);
			continue;
		}
		const segmentBigrams = extractHanBigramsWithOffsets(segment).map((entry) => entry.token);
		if (segmentBigrams.length === 0) {
			continue;
		}
		const matchedCount = segmentBigrams.filter((token) => snippetBigrams.has(token)).length;
		bestSegmentCoverageRatio = Math.max(
			bestSegmentCoverageRatio,
			matchedCount / segmentBigrams.length,
		);
		bestSegmentCoverageCount = Math.max(bestSegmentCoverageCount, matchedCount);
	}
	const compactnessBonus =
		localRanges.length > 0
			? 1 / Math.max(1, localRanges[localRanges.length - 1].end - localRanges[0].start)
			: 0;
	return (
		fullSegmentCount * 1000 +
		familyHitCount * 120 +
		bestSegmentCoverageRatio * 100 +
		bestSegmentCoverageCount * 10 +
		localRanges.length * 2 +
		compactnessBonus +
		sourceWindowScore * 0.01
	);
}

function classifySnippetEvidenceType(
	snippetText: string,
	families: readonly CoverageLexicalFamily[],
	charQuerySegments: readonly string[],
): "full_segment" | "family_local" | "char_bridge" {
	for (const segment of charQuerySegments) {
		if (segment && snippetText.includes(segment)) {
			return "full_segment";
		}
	}
	for (const family of families) {
		if (family.normalizedTerm && snippetText.toLowerCase().includes(family.normalizedTerm)) {
			return "family_local";
		}
	}
	return "char_bridge";
}

function buildSnippetRegionKey(row: number, anchorOffset: number): string {
	return `${row}:${Math.floor(anchorOffset / 64)}`;
}

function rankSnippetPayloads(
	payloads: readonly CoverageSnippetPayload[],
): CoverageSnippetPayload[] {
	return [...payloads].sort((left, right) => {
		if (right.snippetScore !== left.snippetScore) {
			return right.snippetScore - left.snippetScore;
		}
		if (right.sourceWindowScore !== left.sourceWindowScore) {
			return right.sourceWindowScore - left.sourceWindowScore;
		}
		if (left.row !== right.row) {
			return left.row - right.row;
		}
		return left.col - right.col;
	});
}

function selectDiverseSnippetPayloads(
	payloads: readonly CoverageSnippetPayload[],
	maxSubItemCount: number,
): CoverageSnippetPayload[] {
	const selected: CoverageSnippetPayload[] = [];
	const regionCounts = new Map<string, number>();
	const evidenceCounts = new Map<CoverageSnippetPayload["evidenceType"], number>();
	for (const payload of payloads) {
		if (selected.length >= maxSubItemCount) {
			break;
		}
		if (selected.some((existing) => shouldDedupeSnippetPayload(existing, payload))) {
			continue;
		}
		if (!passesSnippetBudget(selected, payload, maxSubItemCount, regionCounts, evidenceCounts)) {
			continue;
		}
		selected.push(payload);
		regionCounts.set(payload.regionKey, (regionCounts.get(payload.regionKey) ?? 0) + 1);
		evidenceCounts.set(
			payload.evidenceType,
			(evidenceCounts.get(payload.evidenceType) ?? 0) + 1,
		);
	}
	return selected;
}

function passesSnippetBudget(
	selected: readonly CoverageSnippetPayload[],
	candidate: CoverageSnippetPayload,
	maxSubItemCount: number,
	regionCounts: ReadonlyMap<string, number>,
	evidenceCounts: ReadonlyMap<CoverageSnippetPayload["evidenceType"], number>,
): boolean {
	const sameRegionCount = regionCounts.get(candidate.regionKey) ?? 0;
	if (sameRegionCount >= 2) {
		return false;
	}
	if (
		sameRegionCount >= 1 &&
		evidenceCounts.get(candidate.evidenceType) !== undefined &&
		candidate.evidenceType !== "full_segment"
	) {
		return false;
	}
	if (
		selected.length + 1 >= maxSubItemCount &&
		selected.some((item) => item.regionKey !== candidate.regionKey)
	) {
		return true;
	}
	return true;
}

function shouldDedupeSnippetPayload(
	left: CoverageSnippetPayload,
	right: CoverageSnippetPayload,
): boolean {
	if (left.row === right.row) {
		return true;
	}
	if (Math.abs(left.anchorOffset - right.anchorOffset) <= 32) {
		return true;
	}
	if (computeRangeOverlapRatio(left.absoluteRange, right.absoluteRange) >= 0.72) {
		return true;
	}
	return computeSnippetTextOverlapRatio(left.text, right.text) >= 0.72;
}

function computeRangeOverlapRatio(left: CharRange, right: CharRange): number {
	const overlapStart = Math.max(left.start, right.start);
	const overlapEnd = Math.min(left.end, right.end);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const base = Math.max(1, Math.min(left.end - left.start, right.end - right.start));
	return overlap / base;
}

function computeSnippetTextOverlapRatio(left: string, right: string): number {
	const leftShingles = buildTextShingles(left);
	const rightShingles = buildTextShingles(right);
	if (leftShingles.size === 0 || rightShingles.size === 0) {
		return 0;
	}
	let overlap = 0;
	for (const shingle of leftShingles) {
		if (rightShingles.has(shingle)) {
			overlap += 1;
		}
	}
	return overlap / Math.max(1, Math.min(leftShingles.size, rightShingles.size));
}

function buildTextShingles(text: string): Set<string> {
	const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
	const shingles = new Set<string>();
	if (normalized.length <= 6) {
		if (normalized) {
			shingles.add(normalized);
		}
		return shingles;
	}
	for (let index = 0; index <= normalized.length - 6; index++) {
		shingles.add(normalized.slice(index, index + 6));
	}
	return shingles;
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

function shouldLogCoverageLexicalHanSubitemDebug(
	queryText: string | undefined,
): boolean {
	return !!queryText && /[\u4e00-\u9fff]/.test(queryText) && queryText.trim().length <= 24;
}
