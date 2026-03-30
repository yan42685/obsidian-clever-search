import { Vault } from "obsidian";
import { FileSubItem } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import { buildLineOffsets, offsetToLine } from "../hybrid/chunker";
import { estimateTokenCount } from "../hybrid/chunker";
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

type HanSegmentDescriptor = {
	text: string;
	bigrams: string[];
};

const MAX_SNIPPET_WINDOW_CHARS = 220;
const SNIPPET_LEADING_CONTEXT_CHARS = 12;
const SNIPPET_TRAILING_CONTEXT_CHARS = 32;
const MATCH_SEARCH_CONTEXT_CHARS = 96;
const MIN_SNIPPET_SCORE = 24;
const TARGET_SNIPPET_TOKEN_BUDGET = 40;
const MAX_SNIPPET_EXPANSION_GAP_CHARS = 24;
const SNIPPET_NEARBY_OFFSET_THRESHOLD = 16;
const FINAL_DUPLICATE_OFFSET_THRESHOLD = 72;
const MAX_SNIPPET_DISTANCE_FROM_ANCHOR_CHARS = 48;

@singleton()
export class CoverageLexicalDirectSubItemBuilder {
	private readonly tokenizer = getInstance(Tokenizer);
	private fileSnapshotStore?: FileSnapshotStore | null;
	private readonly offsetCache = new Map<
		string,
		{ lineOffsets: number[]; tokenOffsets: TokenOffset[] }
	>();
	private readonly charOffsetCache = new Map<
		string,
		Array<{ token: string; start: number; end: number }>
	>();

	async build(params: CoverageDirectSubItemBuilderParams): Promise<FileSubItem[]> {
		const maxSubItemCount = Math.max(0, params.maxSubItemCount);
		if (maxSubItemCount === 0) {
			return [];
		}
		const displayWindows =
			params.displayWindows?.slice(0, maxSubItemCount) ??
			(params.bodyTokenSequence.length > 0
				? selectCoverageLexicalDisplayWindows(
						params.bodyTokenSequence,
						params.families,
						params.pairSignatures,
						maxSubItemCount,
				  )
				: []);
		const snapshotText = await this.readSnapshotText(
			params.path,
			params.bodyTextFallback,
		);
		if (!snapshotText) {
			if (shouldLogCoverageLexicalHanSubitemDebug(params.debugQueryText)) {
				logger.debug("[coverage-lexical][han-debug] subitems-empty", {
					queryText: params.debugQueryText,
					path: params.path,
					stage: "snapshot-empty",
				});
			}
			return [];
		}
		const tokenOffsets = this.getTokenOffsets(params.path, snapshotText);
		const charOffsets = this.getCharOffsets(params.path, snapshotText);
		const lineOffsets = this.getLineOffsets(params.path, snapshotText);
		const segmentDescriptors = buildHanSegmentDescriptors(
			params.charQuerySegments ?? [],
		);
		const payloads: CoverageSnippetPayload[] = [];
		for (const window of displayWindows) {
			const snippets = this.buildSnippetPayloads(
				snapshotText,
				lineOffsets,
				tokenOffsets,
				charOffsets,
				window,
				params.bodyTokenSequence,
				params.families,
				params.charQueryTerms ?? [],
				segmentDescriptors,
			);
			payloads.push(...snippets);
		}
		const payloadCountBeforeCharFallback = payloads.length;
		if (
			payloads.length === 0 &&
			((params.charQueryTerms?.length ?? 0) > 0 ||
				(params.charQuerySegments?.length ?? 0) > 0)
		) {
			payloads.push(
				...this.buildCharFallbackPayloads(
					snapshotText,
					lineOffsets,
					tokenOffsets,
					charOffsets,
					params.charQueryTerms ?? [],
					segmentDescriptors,
					params.debugQueryText,
					params.path,
				),
			);
		}
		const rankedPayloads = rankSnippetPayloads(payloads);
		const diversePayloads = selectDiverseSnippetPayloads(
			rankedPayloads,
			maxSubItemCount * 3,
		);
		const selectedPayloads = dedupeFinalSnippetPayloads(
			diversePayloads,
			params.debugQueryText,
		).slice(0, maxSubItemCount);
		if (
			selectedPayloads.length === 0 &&
			shouldLogCoverageLexicalHanSubitemDebug(params.debugQueryText)
		) {
			logger.debug("[coverage-lexical][han-debug] subitems-empty", {
				queryText: params.debugQueryText,
				path: params.path,
				stage: "no-selected-payloads",
				displayWindowCount: displayWindows.length,
				tokenOffsetCount: tokenOffsets.length,
				charOffsetCount: charOffsets.length,
				charQueryTermCount: params.charQueryTerms?.length ?? 0,
				charQuerySegmentCount: params.charQuerySegments?.length ?? 0,
				payloadCountBeforeCharFallback,
				payloadCountAfterCharFallback: payloads.length,
				rankedPayloadCount: rankedPayloads.length,
				diversePayloadCount: diversePayloads.length,
			});
		}
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

	private buildCharFallbackPayloads(
		text: string,
		lineOffsets: readonly number[],
		tokenOffsets: readonly TokenOffset[],
		charOffsets: ReadonlyArray<{ token: string; start: number; end: number }>,
		charQueryTerms: readonly string[],
		segmentDescriptors: readonly HanSegmentDescriptor[],
		debugQueryText?: string,
		path?: string,
	): CoverageSnippetPayload[] {
		const searchRegion = { start: 0, end: text.length };
		const matchedCharOffsets = charOffsets.filter((entry) =>
			charQueryTerms.includes(entry.token),
		);
		const mergedRanges = collectMatchedRanges(
			text,
			tokenOffsets,
			charOffsets,
			searchRegion,
			[],
			charQueryTerms,
			segmentDescriptors,
		);
		if (shouldLogCoverageLexicalHanSubitemDebug(debugQueryText)) {
			logger.debug("[coverage-lexical][han-debug] char-fallback", {
				queryText: debugQueryText,
				path,
				stage:
					mergedRanges.length === 0 ? "no-merged-ranges" : "merged-ranges",
				matchedCharOffsetsCount: matchedCharOffsets.length,
				matchedCharTokens: Array.from(
					new Set(matchedCharOffsets.map((entry) => entry.token)),
				),
				mergedRanges,
			});
		}
		if (mergedRanges.length === 0) {
			return [];
		}
		const clusters = rankEvidenceClusters(
			text,
			mergedRanges,
			[],
			segmentDescriptors,
		);
		if (shouldLogCoverageLexicalHanSubitemDebug(debugQueryText)) {
			logger.debug("[coverage-lexical][han-debug] char-fallback", {
				queryText: debugQueryText,
				path,
				stage: "clusters",
				clusters: clusters.map((cluster) => ({
					start: cluster.start,
					end: cluster.end,
					score: cluster.score,
					text: text.slice(cluster.start, cluster.end),
				})),
			});
		}
		const payloads = clusters
			.map((cluster) =>
				buildSnippetPayloadFromCluster(
					text,
					lineOffsets,
					mergedRanges,
					cluster,
					searchRegion,
					[],
					segmentDescriptors,
					cluster.score,
					debugQueryText,
					path,
				),
			)
			.filter((payload): payload is CoverageSnippetPayload => payload !== null)
			.filter((payload) => payload.snippetScore >= MIN_SNIPPET_SCORE);
		if (shouldLogCoverageLexicalHanSubitemDebug(debugQueryText)) {
			logger.debug("[coverage-lexical][han-debug] char-fallback", {
				queryText: debugQueryText,
				path,
				stage: payloads.length === 0 ? "no-payloads" : "payloads",
				payloads: payloads.map((payload) => ({
					row: payload.row,
					col: payload.col,
					anchorOffset: payload.anchorOffset,
					absoluteRange: payload.absoluteRange,
					snippetScore: payload.snippetScore,
					text: payload.text,
				})),
			});
		}
		return payloads;
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

	private getCharOffsets(
		path: string,
		text: string,
	): Array<{ token: string; start: number; end: number }> {
		const cacheKey = buildOffsetCacheKey(path, text);
		const cached = this.charOffsetCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const offsets = extractHanBigramsWithOffsets(text);
		this.charOffsetCache.set(cacheKey, offsets);
		return offsets;
	}

	private buildSnippetPayloads(
		text: string,
		lineOffsets: number[],
		tokenOffsets: readonly TokenOffset[],
		charOffsets: ReadonlyArray<{ token: string; start: number; end: number }>,
		window: CoverageLexicalDisplayWindow,
		bodyTokenSequence: readonly string[],
		families: readonly CoverageLexicalFamily[],
		charQueryTerms: readonly string[],
		segmentDescriptors: readonly HanSegmentDescriptor[],
	): CoverageSnippetPayload[] {
		if (window.startTokenIndex < 0 || window.endTokenIndex < window.startTokenIndex) {
			return [];
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
			charOffsets,
			searchRegion,
			matchedFamilies,
			charQueryTerms,
			segmentDescriptors,
		);
		if (mergedRanges.length === 0) {
			return [];
		}
		const clusters = rankEvidenceClusters(
			text,
			mergedRanges,
			matchedFamilies,
			segmentDescriptors,
		);
		return clusters
			.map((cluster) =>
				buildSnippetPayloadFromCluster(
					text,
					lineOffsets,
					mergedRanges,
					cluster,
					approximateWindow,
					matchedFamilies,
					segmentDescriptors,
					window.signal.score,
				),
			)
			.filter((payload): payload is CoverageSnippetPayload => payload !== null)
			.filter((payload) => payload.snippetScore >= MIN_SNIPPET_SCORE);
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
	charOffsets: ReadonlyArray<{ token: string; start: number; end: number }>,
	searchRegion: CharRange,
	families: readonly CoverageLexicalFamily[],
	charQueryTerms: readonly string[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
): CoverageLexicalHighlightRange[] {
	const tokenRanges = collectTokenMatchedRanges(tokenOffsets, searchRegion, families);
	const substringRanges =
		tokenRanges.length > 0
			? []
			: collectSubstringMatchedRanges(text, searchRegion, families);
	const charRanges = collectCharMatchedRanges(
		charOffsets,
		searchRegion,
		charQueryTerms,
		segmentDescriptors,
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
	charOffsets: ReadonlyArray<{ token: string; start: number; end: number }>,
	searchRegion: CharRange,
	charQueryTerms: readonly string[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
): CoverageLexicalHighlightRange[] {
	if (charQueryTerms.length === 0 || segmentDescriptors.length === 0) {
		return [];
	}
	const wanted = new Set(charQueryTerms);
	const matchedOffsets = charOffsets
		.filter(
			(entry) =>
				entry.end > searchRegion.start &&
				entry.start < searchRegion.end &&
				wanted.has(entry.token),
		)
	if (matchedOffsets.length === 0) {
		return [];
	}
	return filterCharRangesBySegmentCoverage(matchedOffsets, segmentDescriptors);
}

function filterCharRangesBySegmentCoverage(
	offsets: ReadonlyArray<{ token: string; start: number; end: number }>,
	segmentDescriptors: readonly HanSegmentDescriptor[],
): CoverageLexicalHighlightRange[] {
	const merged = mergeRanges(
		offsets.map((entry) => ({
			start: entry.start,
			end: entry.end,
		})),
	);
	const kept: CoverageLexicalHighlightRange[] = [];
	for (const range of merged) {
		const clusterOffsets = offsets.filter(
			(entry) => entry.start >= range.start && entry.end <= range.end,
		);
		for (const segment of segmentDescriptors) {
			const matchedOffsets = clusterOffsets.filter((entry) =>
				segment.bigrams.includes(entry.token),
			);
			const matchedTokenSet = new Set(matchedOffsets.map((entry) => entry.token));
			const matchedCount = segment.bigrams.filter((token) =>
				matchedTokenSet.has(token),
			).length;
			const bestRunLength = computeBestBigramRunLength(
				segment.bigrams,
				matchedTokenSet,
			);
			if (
				acceptsCharClusterCoverage(
					segment.bigrams.length,
					matchedCount,
					bestRunLength,
				)
			) {
				kept.push(
					...matchedOffsets.map((entry) => ({
						start: entry.start,
						end: entry.end,
					})),
				);
				break;
			}
		}
	}
	return mergeRanges(kept);
}

function collectExactSegmentRanges(
	snippetText: string,
	charQuerySegments: readonly string[],
): CoverageLexicalHighlightRange[] {
	const ranges: CoverageLexicalHighlightRange[] = [];
	for (const segment of charQuerySegments) {
		if (!segment) {
			continue;
		}
		let fromIndex = 0;
		while (fromIndex < snippetText.length) {
			const foundAt = snippetText.indexOf(segment, fromIndex);
			if (foundAt < 0) {
				break;
			}
			ranges.push({
				start: foundAt,
				end: foundAt + segment.length,
			});
			fromIndex = foundAt + Math.max(1, segment.length);
		}
	}
	return ranges;
}

function collectSnippetFamilyRanges(
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

function collectSnippetLevelSegmentRanges(
	snippetText: string,
	segmentDescriptors: readonly HanSegmentDescriptor[],
): CoverageLexicalHighlightRange[] {
	const kept: CoverageLexicalHighlightRange[] = [];
	const snippetBigramOffsets = extractHanBigramsWithOffsets(snippetText);
	for (const segment of segmentDescriptors) {
		if (segment.bigrams.length === 0) {
			continue;
		}
		const matchedOffsets = snippetBigramOffsets.filter((entry) =>
			segment.bigrams.includes(entry.token),
		);
		if (matchedOffsets.length === 0) {
			continue;
		}
		const matchedTokenSet = new Set(matchedOffsets.map((entry) => entry.token));
		const matchedCount = segment.bigrams.filter((token) =>
			matchedTokenSet.has(token),
		).length;
		const bestRunLength = computeBestBigramRunLength(
			segment.bigrams,
			matchedTokenSet,
		);
		if (
			!acceptsCharClusterCoverage(
				segment.bigrams.length,
				matchedCount,
				bestRunLength,
			)
		) {
			continue;
		}
		for (const entry of matchedOffsets) {
			kept.push({
				start: entry.start,
				end: entry.end,
			});
		}
	}
	return kept;
}

function acceptsCharClusterCoverage(
	totalBigrams: number,
	matchedCount: number,
	bestRunLength: number,
): boolean {
	if (matchedCount <= 0 || totalBigrams <= 0) {
		return false;
	}
	if (totalBigrams <= 2) {
		return matchedCount === totalBigrams;
	}
	return matchedCount / totalBigrams >= 0.7 || bestRunLength >= 2;
}

function computeBestBigramRunLength(
	segmentBigrams: readonly string[],
	matchedTokens: ReadonlySet<string>,
): number {
	let best = 0;
	let current = 0;
	for (const token of segmentBigrams) {
		if (matchedTokens.has(token)) {
			current += 1;
			best = Math.max(best, current);
			continue;
		}
		current = 0;
	}
	return best;
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
	segmentDescriptors: readonly HanSegmentDescriptor[],
): number {
	if (ranges.length === 0) {
		return -1;
	}
	const clusters = buildEvidenceClusters(ranges);
	let bestCluster: { start: number; score: number } | null = null;
	for (const cluster of clusters) {
		const clusterText = text.slice(cluster.start, cluster.end);
		const score = scoreEvidenceCluster(clusterText, families, segmentDescriptors);
		if (!bestCluster || score > bestCluster.score) {
			bestCluster = { start: cluster.start, score };
		}
	}
	if (bestCluster && bestCluster.score > 0) {
		return bestCluster.start;
	}
	const haystack = text.slice(searchRegion.start, searchRegion.end);
	for (const segment of segmentDescriptors) {
		const foundAt = haystack.indexOf(segment.text);
		if (foundAt >= 0) {
			return searchRegion.start + foundAt;
		}
	}
	return -1;
}

function rankEvidenceClusters(
	text: string,
	ranges: readonly CoverageLexicalHighlightRange[],
	families: readonly CoverageLexicalFamily[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
): Array<CoverageLexicalHighlightRange & { score: number }> {
	return buildEvidenceClusters(ranges)
		.map((cluster) => ({
			...cluster,
			score: scoreEvidenceCluster(
				text.slice(cluster.start, cluster.end),
				families,
				segmentDescriptors,
			),
		}))
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			if (left.start !== right.start) {
				return left.start - right.start;
			}
			return left.end - right.end;
		});
}

function buildSnippetPayloadFromCluster(
	text: string,
	lineOffsets: readonly number[],
	mergedRanges: readonly CoverageLexicalHighlightRange[],
	cluster: CoverageLexicalHighlightRange & { score: number },
	approximateWindow: CharRange,
	families: readonly CoverageLexicalFamily[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
	sourceWindowScore: number,
	debugQueryText?: string,
	path?: string,
): CoverageSnippetPayload | null {
	const anchorOffset = cluster.start;
	const snippetRange = buildSnippetRange(
		text,
		mergedRanges,
		text.length,
		[cluster],
		anchorOffset,
		approximateWindow,
	);
	const snippetText = text.slice(snippetRange.start, snippetRange.end);
	const familyRanges = collectSnippetFamilyRanges(snippetText, families);
	const snippetCharSegmentRanges = collectSnippetLevelSegmentRanges(
		snippetText,
		segmentDescriptors,
	);
	const exactSegmentRanges = collectExactSegmentRanges(
		snippetText,
		segmentDescriptors.map((segment) => segment.text),
	);
	const mergedLocalRanges = mergeRanges([
		...familyRanges,
		...snippetCharSegmentRanges,
		...exactSegmentRanges,
	]);
	const snippetScore = scoreSnippetPayload(
		snippetText,
		mergedLocalRanges,
		families,
		segmentDescriptors,
		sourceWindowScore,
	);
	if (shouldLogCoverageLexicalHanSubitemDebug(debugQueryText)) {
		logger.debug("[coverage-lexical][han-debug] char-fallback-cluster", {
			queryText: debugQueryText,
			path,
			cluster: {
				start: cluster.start,
				end: cluster.end,
				score: cluster.score,
				text: text.slice(cluster.start, cluster.end),
			},
			snippetRange,
			snippetText,
			familyRangeCount: familyRanges.length,
			segmentRangeCount: snippetCharSegmentRanges.length,
			exactSegmentRangeCount: exactSegmentRanges.length,
			mergedLocalRangeCount: mergedLocalRanges.length,
			snippetScore,
		});
	}
	if (mergedLocalRanges.length === 0) {
		return null;
	}
	const prefixEllipsis = snippetRange.start > 0;
	const suffixEllipsis = snippetRange.end < text.length;
	const snippetTextWithEllipsis = `${prefixEllipsis ? "…" : ""}${snippetText}${
		suffixEllipsis ? "…" : ""
	}`;
	const adjustedRanges = mergedLocalRanges.map((range) => ({
		start: range.start + (prefixEllipsis ? 1 : 0),
		end: range.end + (prefixEllipsis ? 1 : 0),
	}));
	const row = offsetToLine(lineOffsets, anchorOffset);
	const lineStartOffset = lineOffsets[row] ?? 0;
	const col = Math.max(0, anchorOffset - lineStartOffset);
	return {
		text: snippetTextWithEllipsis,
		html: renderHighlightedSnippet(snippetText, mergedLocalRanges, {
			prefixEllipsis,
			suffixEllipsis,
		}),
		row,
		col,
		highlightRanges: adjustedRanges,
		anchorOffset,
		absoluteRange: snippetRange,
		snippetScore,
		sourceWindowScore,
		evidenceType: classifySnippetEvidenceType(
			snippetText,
			families,
			segmentDescriptors.map((segment) => segment.text),
		),
		regionKey: buildSnippetRegionKey(row, anchorOffset),
	};
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

function buildHanSegmentDescriptors(
	segments: readonly string[],
): HanSegmentDescriptor[] {
	return segments
		.filter((segment) => segment.length > 0)
		.map((segment) => ({
			text: segment,
			bigrams: extractHanBigramsWithOffsets(segment).map((entry) => entry.token),
		}));
}

function scoreEvidenceCluster(
	clusterText: string,
	families: readonly CoverageLexicalFamily[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
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
	for (const segment of segmentDescriptors) {
		if (clusterText.includes(segment.text)) {
			fullSegmentCount += 1;
			bestSegmentCoverageRatio = 1;
			bestSegmentCoverageCount = Math.max(
				bestSegmentCoverageCount,
				segment.bigrams.length,
			);
			continue;
		}
		if (segment.bigrams.length === 0) {
			continue;
		}
		const matchedCount = segment.bigrams.filter((token) => clusterBigrams.has(token)).length;
		bestSegmentCoverageCount = Math.max(bestSegmentCoverageCount, matchedCount);
		bestSegmentCoverageRatio = Math.max(
			bestSegmentCoverageRatio,
			matchedCount / segment.bigrams.length,
		);
	}
	return (
		familyHitCount * 260 +
		fullSegmentCount * 180 +
		bestSegmentCoverageRatio * 10 +
		bestSegmentCoverageCount
	);
}

function buildSnippetRange(
	text: string,
	allRanges: readonly CoverageLexicalHighlightRange[],
	textLength: number,
	ranges: readonly CoverageLexicalHighlightRange[],
	anchorOffset: number,
	approximateWindow: CharRange,
): CharRange {
	const focusStart = ranges.length > 0 ? ranges[0].start : anchorOffset;
	const focusEnd = ranges.length > 0 ? ranges[ranges.length - 1].end : approximateWindow.end;
	let start = Math.max(0, focusStart - SNIPPET_LEADING_CONTEXT_CHARS);
	let end = Math.min(textLength, focusEnd + SNIPPET_TRAILING_CONTEXT_CHARS);
	if (end - start > MAX_SNIPPET_WINDOW_CHARS) {
		start = Math.max(0, anchorOffset - Math.floor(MAX_SNIPPET_WINDOW_CHARS / 2));
		end = Math.min(textLength, start + MAX_SNIPPET_WINDOW_CHARS);
		start = Math.max(0, end - MAX_SNIPPET_WINDOW_CHARS);
	}
	let snippetRange = { start, end };
	snippetRange = expandSnippetRangeForNearbyEvidence(
		text,
		snippetRange,
		allRanges,
	);
	return clampSnippetRangeToTokenBudget(text, snippetRange, anchorOffset);
}

function expandSnippetRangeForNearbyEvidence(
	text: string,
	range: CharRange,
	allRanges: readonly CoverageLexicalHighlightRange[],
): CharRange {
	const outsideRanges = allRanges
		.filter((candidate) => candidate.end <= range.start || candidate.start >= range.end)
		.map((candidate) => ({
			range: candidate,
			gap:
				candidate.end <= range.start
					? range.start - candidate.end
					: candidate.start - range.end,
		}))
		.filter((candidate) => candidate.gap <= MAX_SNIPPET_EXPANSION_GAP_CHARS)
		.sort((left, right) => left.gap - right.gap);
	let current = { ...range };
	for (const candidate of outsideRanges) {
		const expanded = {
			start: Math.max(0, Math.min(current.start, candidate.range.start)),
			end: Math.min(text.length, Math.max(current.end, candidate.range.end)),
		};
		if (expanded.end - expanded.start > MAX_SNIPPET_WINDOW_CHARS) {
			continue;
		}
		if (estimateTokenCount(text.slice(expanded.start, expanded.end)) > TARGET_SNIPPET_TOKEN_BUDGET) {
			continue;
		}
		current = expanded;
	}
	return current;
}

function clampSnippetRangeToTokenBudget(
	text: string,
	range: CharRange,
	anchorOffset: number,
): CharRange {
	let start = range.start;
	let end = range.end;
	const minStart = Math.max(0, anchorOffset - MAX_SNIPPET_DISTANCE_FROM_ANCHOR_CHARS);
	const maxEnd = Math.min(
		text.length,
		anchorOffset + MAX_SNIPPET_DISTANCE_FROM_ANCHOR_CHARS,
	);
	if (start < minStart) {
		start = minStart;
	}
	if (end > maxEnd) {
		end = maxEnd;
	}
	while (
		end - start > 1 &&
		estimateTokenCount(text.slice(start, end)) > TARGET_SNIPPET_TOKEN_BUDGET
	) {
		const leftDistance = Math.max(0, anchorOffset - start);
		const rightDistance = Math.max(0, end - anchorOffset);
		if (rightDistance > leftDistance) {
			end -= 1;
			continue;
		}
		start += 1;
	}
	return { start, end };
}

function scoreSnippetPayload(
	snippetText: string,
	localRanges: readonly CoverageLexicalHighlightRange[],
	families: readonly CoverageLexicalFamily[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
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
	for (const segment of segmentDescriptors) {
		if (snippetText.includes(segment.text)) {
			fullSegmentCount += 1;
			bestSegmentCoverageRatio = 1;
			bestSegmentCoverageCount = Math.max(
				bestSegmentCoverageCount,
				segment.bigrams.length,
			);
			continue;
		}
		if (segment.bigrams.length === 0) {
			continue;
		}
		const matchedCount = segment.bigrams.filter((token) => snippetBigrams.has(token)).length;
		bestSegmentCoverageRatio = Math.max(
			bestSegmentCoverageRatio,
			matchedCount / segment.bigrams.length,
		);
		bestSegmentCoverageCount = Math.max(bestSegmentCoverageCount, matchedCount);
	}
	const compactnessBonus =
		localRanges.length > 0
			? 1 / Math.max(1, localRanges[localRanges.length - 1].end - localRanges[0].start)
			: 0;
	return (
		familyHitCount * 320 +
		fullSegmentCount * 220 +
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
	return `anchor:${anchorOffset}`;
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
		if (left.anchorOffset !== right.anchorOffset) {
			return left.anchorOffset - right.anchorOffset;
		}
		return left.col - right.col;
	});
}

function selectDiverseSnippetPayloads(
	payloads: readonly CoverageSnippetPayload[],
	maxSubItemCount: number,
): CoverageSnippetPayload[] {
	const selected: CoverageSnippetPayload[] = [];
	if (payloads.length === 0 || maxSubItemCount <= 0) {
		return selected;
	}
	for (const payload of payloads) {
		if (selected.length >= maxSubItemCount) {
			break;
		}
		if (selected.some((existing) => shouldDedupeSnippetPayload(existing, payload))) {
			continue;
		}
		if (
			!passesSnippetBudget(
				selected,
				payload,
				maxSubItemCount,
			)
		) {
			continue;
		}
		selected.push(payload);
	}
	return selected;
}

function dedupeFinalSnippetPayloads(
	payloads: readonly CoverageSnippetPayload[],
	debugQueryText?: string,
): CoverageSnippetPayload[] {
	const selected: CoverageSnippetPayload[] = [];
	for (const payload of payloads) {
		const duplicateOf = selected.find((existing) =>
			shouldDedupeFinalSnippet(existing, payload),
		);
		if (duplicateOf) {
			if (shouldLogCoverageLexicalHanSubitemDebug(debugQueryText)) {
				logger.debug("[coverage-lexical][han-debug] final-dedupe-drop", {
					queryText: debugQueryText,
					dropped: summarizeSnippetPayload(payload),
					kept: summarizeSnippetPayload(duplicateOf),
					rangeOverlap: computeRangeOverlapRatio(
						duplicateOf.absoluteRange,
						payload.absoluteRange,
					),
					textOverlap: computeSnippetTextOverlapRatio(
						duplicateOf.text,
						payload.text,
					),
				});
			}
			continue;
		}
		if (shouldLogCoverageLexicalHanSubitemDebug(debugQueryText)) {
			logger.debug("[coverage-lexical][han-debug] final-dedupe-keep", {
				queryText: debugQueryText,
				payload: summarizeSnippetPayload(payload),
			});
		}
		selected.push(payload);
	}
	return selected;
}

function shouldDedupeFinalSnippet(
	left: CoverageSnippetPayload,
	right: CoverageSnippetPayload,
): boolean {
	const rangeGap = computeRangeGap(left.absoluteRange, right.absoluteRange);
	const rangeOverlap = computeRangeOverlapRatio(
		left.absoluteRange,
		right.absoluteRange,
	);
	const offsetsAreNear =
		Math.abs(left.anchorOffset - right.anchorOffset) <= FINAL_DUPLICATE_OFFSET_THRESHOLD;
	if (!offsetsAreNear && rangeGap > 16) {
		return false;
	}
	if (rangeOverlap >= 0.9) {
		return true;
	}
	if (
		Math.abs((left.snippetScore ?? 0) - (right.snippetScore ?? 0)) <= 8 &&
		areSnippetTextsEffectivelyContained(left.text, right.text) &&
		(offsetsAreNear || rangeGap <= 8 || rangeOverlap >= 0.72)
	) {
		return true;
	}
	if (
		(offsetsAreNear || rangeGap <= 8) &&
		rangeOverlap >= 0.82
	) {
		return true;
	}
	if (
		(offsetsAreNear || rangeGap <= 8 || rangeOverlap >= 0.72) &&
		computeSnippetTextOverlapRatio(left.text, right.text) >= 0.72
	) {
		return true;
	}
	return false;
}

function summarizeSnippetPayload(payload: CoverageSnippetPayload): Record<string, unknown> {
	return {
		row: payload.row,
		col: payload.col,
		anchorOffset: payload.anchorOffset,
		absoluteRange: payload.absoluteRange,
		snippetScore: payload.snippetScore,
		sourceWindowScore: payload.sourceWindowScore,
		text: payload.text,
	};
}

function passesSnippetBudget(
	selected: readonly CoverageSnippetPayload[],
	candidate: CoverageSnippetPayload,
	maxSubItemCount: number,
): boolean {
	const nearbySelected = selected.filter((item) =>
		areSnippetPayloadsNearby(item, candidate),
	);
	if (nearbySelected.length >= 2) {
		return false;
	}
	if (
		selected.length === 1 &&
		maxSubItemCount >= 2 &&
		computeRangeGap(selected[0].absoluteRange, candidate.absoluteRange) > 48
	) {
		return true;
	}
	if (
		nearbySelected.some((item) => item.evidenceType === candidate.evidenceType) &&
		candidate.evidenceType !== "full_segment"
	) {
		return false;
	}
	if (
		selected.length + 1 >= maxSubItemCount &&
		selected.some((item) => computeRangeGap(item.absoluteRange, candidate.absoluteRange) > 48)
	) {
		return true;
	}
	return true;
}

function areSnippetPayloadsNearby(
	left: CoverageSnippetPayload,
	right: CoverageSnippetPayload,
): boolean {
	return (
		computeRangeGap(left.absoluteRange, right.absoluteRange) <= 48 ||
		Math.abs(left.anchorOffset - right.anchorOffset) <= SNIPPET_NEARBY_OFFSET_THRESHOLD
	);
}

function shouldDedupeSnippetPayload(
	left: CoverageSnippetPayload,
	right: CoverageSnippetPayload,
): boolean {
	const rangeGap = computeRangeGap(left.absoluteRange, right.absoluteRange);
	const rangeOverlap = computeRangeOverlapRatio(
		left.absoluteRange,
		right.absoluteRange,
	);
	if (rangeOverlap >= 0.9) {
		return true;
	}
	if (
		Math.abs(left.anchorOffset - right.anchorOffset) <= SNIPPET_NEARBY_OFFSET_THRESHOLD &&
		(rangeGap <= 24 || rangeOverlap >= 0.72)
	) {
		return true;
	}
	if (rangeOverlap >= 0.82 && rangeGap <= 8) {
		return true;
	}
	return (
		computeSnippetTextOverlapRatio(left.text, right.text) >= 0.82 &&
		(rangeGap <= 8 || Math.abs(left.anchorOffset - right.anchorOffset) <= 32)
	);
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

function computeRangeGap(left: CharRange, right: CharRange): number {
	if (left.end < right.start) {
		return right.start - left.end;
	}
	if (right.end < left.start) {
		return left.start - right.end;
	}
	return 0;
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

function areSnippetTextsEffectivelyContained(left: string, right: string): boolean {
	const normalizedLeft = normalizeSnippetText(left);
	const normalizedRight = normalizeSnippetText(right);
	if (!normalizedLeft || !normalizedRight) {
		return false;
	}
	return (
		normalizedLeft.includes(normalizedRight) ||
		normalizedRight.includes(normalizedLeft)
	);
}

function buildTextShingles(text: string): Set<string> {
	const normalized = normalizeSnippetText(text);
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

function normalizeSnippetText(text: string): string {
	return text
		.replace(/…/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
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
