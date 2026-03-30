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
import { alignSnippetToQueryChars } from "./coverage-lexical-snippet-aligner";
import type { CoverageLexicalSnippetAlignerAtomInput } from "./coverage-lexical-snippet-aligner";
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
	semanticRange: CharRange;
	semanticSignature: string;
	absoluteRange: CharRange;
	finalFamilyHitCount: number;
	finalFullSegmentCount: number;
	finalBestSegmentCoverageCount: number;
	finalBestSegmentCoverageRatio: number;
	exactFamilyHitCount: number;
	prefixFamilyHitCount: number;
	fuzzyFamilyHitCount: number;
	substringFamilyHitCount: number;
	gapPenalty: number;
	maxGap: number;
	alignmentScore: number;
	snippetScore: number;
	sourceWindowScore: number;
};

type CharRange = {
	start: number;
	end: number;
};

type HanSegmentDescriptor = {
	text: string;
	bigrams: string[];
};

type SnippetMatchAtomKind =
	| "family_exact"
	| "family_prefix"
	| "family_fuzzy"
	| "family_substring"
	| "segment_exact"
	| "han_bigram"
	| "han_char";

type SnippetMatchAtom = {
	start: number;
	end: number;
	queryKey: string;
	kind: SnippetMatchAtomKind;
	weight: number;
};

type SnippetCoverageMetrics = {
	signature: string;
	queryKeys: string[];
	familyKeyCount: number;
	segmentKeyCount: number;
	bigramKeyCount: number;
	charKeyCount: number;
	weightedCoverage: number;
};

type SnippetSemanticIsland = {
	start: number;
	end: number;
	atoms: SnippetMatchAtom[];
	metrics: SnippetCoverageMetrics;
	score: number;
};

type SemanticSpanEvaluation = {
	range: CharRange;
	atoms: SnippetMatchAtom[];
	semanticScore: number;
	coverageCount: number;
	anchorOffset: number;
	signature: string;
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
const MAX_SEMANTIC_ISLAND_GAP_CHARS = 24;
const MAX_HAN_CHAR_ATOM_SEGMENT_LENGTH = 6;

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
			logHanSubitemDebug(params.debugQueryText, "subitems-empty", {
				path: params.path,
				stage: "snapshot-empty",
			});
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
			logHanSubitemDebug(params.debugQueryText, "subitems-empty", {
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
		logHanSubitemDebug(params.debugQueryText, "subitems-final", {
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
		const atoms = collectSnippetMatchAtoms(
			text,
			tokenOffsets,
			charOffsets,
			searchRegion,
			[],
			charQueryTerms,
			segmentDescriptors,
		);
		logHanSubitemDebug(debugQueryText, "char-fallback", {
			path,
			stage: atoms.length === 0 ? "no-merged-ranges" : "merged-ranges",
			matchedCharOffsetsCount: matchedCharOffsets.length,
			matchedCharTokens: Array.from(
				new Set(matchedCharOffsets.map((entry) => entry.token)),
			),
			mergedRanges: mergeRanges(
				atoms.map((atom) => ({ start: atom.start, end: atom.end })),
			),
		});
		if (atoms.length === 0) {
			return [];
		}
		const islands = rankSnippetSemanticIslands(atoms);
		logHanSubitemDebug(debugQueryText, "char-fallback", {
			path,
			stage: "clusters",
			clusters: islands.map((island) => ({
				start: island.start,
				end: island.end,
				score: island.score,
				text: text.slice(island.start, island.end),
			})),
		});
		const payloads = this.buildPayloadsFromAtoms(
			text,
			lineOffsets,
			atoms,
			searchRegion,
			[],
			segmentDescriptors,
			0,
			debugQueryText,
			path,
			islands,
		);
		logHanSubitemDebug(debugQueryText, "char-fallback", {
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
		return payloads;
	}

	private buildPayloadsFromAtoms(
		text: string,
		lineOffsets: readonly number[],
		atoms: readonly SnippetMatchAtom[],
		approximateWindow: CharRange,
		families: readonly CoverageLexicalFamily[],
		segmentDescriptors: readonly HanSegmentDescriptor[],
		sourceWindowScore: number,
		debugQueryText?: string,
		path?: string,
		precomputedIslands?: readonly SnippetSemanticIsland[],
	): CoverageSnippetPayload[] {
		const islands = precomputedIslands ?? rankSnippetSemanticIslands(atoms);
		return islands
			.map((island) =>
				buildSnippetPayloadFromIsland(
					text,
					lineOffsets,
					atoms,
					island,
					approximateWindow,
					families,
					segmentDescriptors,
					sourceWindowScore || island.score,
					debugQueryText,
					path,
				),
			)
			.filter((payload): payload is CoverageSnippetPayload => payload !== null)
			.filter((payload) => payload.snippetScore >= MIN_SNIPPET_SCORE);
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
		const atoms = collectSnippetMatchAtoms(
			text,
			tokenOffsets,
			charOffsets,
			searchRegion,
			matchedFamilies,
			charQueryTerms,
			segmentDescriptors,
		);
		if (atoms.length === 0) {
			return [];
		}
		return this.buildPayloadsFromAtoms(
			text,
			lineOffsets,
			atoms,
			approximateWindow,
			matchedFamilies,
			segmentDescriptors,
			window.signal.score,
		);
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




function collectSnippetMatchAtoms(
	text: string,
	tokenOffsets: readonly TokenOffset[],
	charOffsets: ReadonlyArray<{ token: string; start: number; end: number }>,
	searchRegion: CharRange,
	families: readonly CoverageLexicalFamily[],
	charQueryTerms: readonly string[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
): SnippetMatchAtom[] {
	const atoms: SnippetMatchAtom[] = [];
	let familyAtomsAdded = 0;
	for (const offset of tokenOffsets) {
		if (offset.end <= searchRegion.start || offset.start >= searchRegion.end) {
			continue;
		}
		for (const family of families) {
			if (!family.normalizedTerm) {
				continue;
			}
			if (offset.token === family.normalizedTerm) {
				atoms.push({
					start: offset.start,
					end: offset.start + family.normalizedTerm.length,
					queryKey: `family:${family.normalizedTerm}`,
					kind: "family_exact",
					weight: 6,
				});
				familyAtomsAdded += 1;
				continue;
			}
			if (family.allowPrefix && offset.token.startsWith(family.normalizedTerm)) {
				atoms.push({
					start: offset.start,
					end: Math.min(offset.end, offset.start + family.normalizedTerm.length),
					queryKey: `family:${family.normalizedTerm}`,
					kind: "family_prefix",
					weight: 5,
				});
				familyAtomsAdded += 1;
				continue;
			}
			if (!family.allowFuzzy) {
				continue;
			}
			const maxDistance = computeMaxFuzzyDistance(family.normalizedTerm);
			if (
				maxDistance <= 0 ||
				offset.token[0] !== family.normalizedTerm[0] ||
				boundedLevenshtein(offset.token, family.normalizedTerm, maxDistance) >
					maxDistance
			) {
				continue;
			}
			atoms.push({
				start: offset.start,
				end: offset.end,
				queryKey: `family:${family.normalizedTerm}`,
				kind: "family_fuzzy",
				weight: 3.5,
			});
			familyAtomsAdded += 1;
		}
	}
	if (familyAtomsAdded === 0) {
		const lowerSlice = text.slice(searchRegion.start, searchRegion.end).toLowerCase();
		for (const family of families) {
			if (!family.normalizedTerm) {
				continue;
			}
			let fromIndex = 0;
			while (fromIndex < lowerSlice.length) {
				const foundAt = lowerSlice.indexOf(family.normalizedTerm, fromIndex);
				if (foundAt < 0) {
					break;
				}
				atoms.push({
					start: searchRegion.start + foundAt,
					end: searchRegion.start + foundAt + family.normalizedTerm.length,
					queryKey: `family:${family.normalizedTerm}`,
					kind: "family_substring",
					weight: 2.5,
				});
				fromIndex = foundAt + Math.max(1, family.normalizedTerm.length);
			}
		}
	}
	for (const segment of segmentDescriptors) {
		let fromIndex = searchRegion.start;
		while (fromIndex < searchRegion.end) {
			const foundAt = text.indexOf(segment.text, fromIndex);
			if (foundAt < 0 || foundAt >= searchRegion.end) {
				break;
			}
			atoms.push({
				start: foundAt,
				end: foundAt + segment.text.length,
				queryKey: `segment:${segment.text}`,
				kind: "segment_exact",
				weight: 8,
			});
			fromIndex = foundAt + Math.max(1, segment.text.length);
		}
	}
	const wantedBigrams = new Set(charQueryTerms);
	for (const entry of charOffsets) {
		if (
			entry.end <= searchRegion.start ||
			entry.start >= searchRegion.end ||
			!wantedBigrams.has(entry.token)
		) {
			continue;
		}
		atoms.push({
			start: entry.start,
			end: entry.end,
			queryKey: `bigram:${entry.token}`,
			kind: "han_bigram",
			weight: 1.5,
		});
	}
	for (const segment of segmentDescriptors) {
		const chars = Array.from(segment.text);
		if (chars.length > MAX_HAN_CHAR_ATOM_SEGMENT_LENGTH) {
			continue;
		}
		const unigramChars = chars.filter(
			(char, index, array) => !!char && array.indexOf(char) === index,
		);
		for (const char of unigramChars) {
			let fromIndex = searchRegion.start;
			while (fromIndex < searchRegion.end) {
				const foundAt = text.indexOf(char, fromIndex);
				if (foundAt < 0 || foundAt >= searchRegion.end) {
					break;
				}
				atoms.push({
					start: foundAt,
					end: foundAt + char.length,
					queryKey: `char:${char}`,
					kind: "han_char",
					weight: 0.5,
				});
				fromIndex = foundAt + 1;
			}
		}
	}
	return dedupeSnippetMatchAtoms(atoms);
}

function dedupeSnippetMatchAtoms(atoms: readonly SnippetMatchAtom[]): SnippetMatchAtom[] {
	const byKey = new Map<string, SnippetMatchAtom>();
	for (const atom of atoms) {
		const key = `${atom.start}:${atom.end}:${atom.queryKey}`;
		const existing = byKey.get(key);
		if (!existing || atom.weight > existing.weight) {
			byKey.set(key, atom);
		}
	}
	return [...byKey.values()].sort((left, right) => {
		if (left.start !== right.start) {
			return left.start - right.start;
		}
		if (left.end !== right.end) {
			return left.end - right.end;
		}
		return left.queryKey.localeCompare(right.queryKey);
	});
}

function buildSnippetSemanticIslands(
	atoms: readonly SnippetMatchAtom[],
): SnippetSemanticIsland[] {
	if (atoms.length === 0) {
		return [];
	}
	const islands: SnippetSemanticIsland[] = [];
	let currentAtoms: SnippetMatchAtom[] = [atoms[0]];
	for (let index = 1; index < atoms.length; index++) {
		const atom = atoms[index];
		const previous = currentAtoms[currentAtoms.length - 1];
		if (atom.start - previous.end <= MAX_SEMANTIC_ISLAND_GAP_CHARS) {
			currentAtoms.push(atom);
			continue;
		}
		islands.push(finalizeSnippetSemanticIsland(currentAtoms));
		currentAtoms = [atom];
	}
	islands.push(finalizeSnippetSemanticIsland(currentAtoms));
	return islands;
}

function finalizeSnippetSemanticIsland(
	atoms: readonly SnippetMatchAtom[],
): SnippetSemanticIsland {
	const metrics = computeAtomCoverageMetrics(atoms);
	const start = atoms[0]?.start ?? 0;
	const end = atoms[atoms.length - 1]?.end ?? start;
	return {
		start,
		end,
		atoms: [...atoms],
		metrics,
		score: metrics.weightedCoverage * 100 - Math.max(1, end - start) * 0.2,
	};
}

function rankSnippetSemanticIslands(
	atoms: readonly SnippetMatchAtom[],
): SnippetSemanticIsland[] {
	return buildSnippetSemanticIslands(atoms).sort((left, right) => {
		if (right.metrics.weightedCoverage !== left.metrics.weightedCoverage) {
			return right.metrics.weightedCoverage - left.metrics.weightedCoverage;
		}
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		if (left.start !== right.start) {
			return left.start - right.start;
		}
		return left.end - right.end;
	});
}

function computeAtomCoverageMetrics(
	atoms: readonly SnippetMatchAtom[],
): SnippetCoverageMetrics {
	const familyKeys = new Set<string>();
	const segmentKeys = new Set<string>();
	const bigramKeys = new Set<string>();
	const charKeys = new Set<string>();
	for (const atom of atoms) {
		if (atom.queryKey.startsWith("family:")) {
			familyKeys.add(atom.queryKey);
			continue;
		}
		if (atom.queryKey.startsWith("segment:")) {
			segmentKeys.add(atom.queryKey);
			continue;
		}
		if (atom.queryKey.startsWith("bigram:")) {
			bigramKeys.add(atom.queryKey);
			continue;
		}
		if (atom.queryKey.startsWith("char:")) {
			charKeys.add(atom.queryKey);
		}
	}
	const queryKeys = [
		...familyKeys,
		...segmentKeys,
		...bigramKeys,
		...charKeys,
	].sort();
	return {
		signature: JSON.stringify(queryKeys),
		queryKeys,
		familyKeyCount: familyKeys.size,
		segmentKeyCount: segmentKeys.size,
		bigramKeyCount: bigramKeys.size,
		charKeyCount: charKeys.size,
		weightedCoverage:
			segmentKeys.size * 10 +
			familyKeys.size * 6 +
			bigramKeys.size * 2 +
			charKeys.size * 1,
	};
}

function buildBestSemanticSpanFromIslands(
	islands: readonly SnippetSemanticIsland[],
	seedIsland: SnippetSemanticIsland,
): SemanticSpanEvaluation {
	const seedIndex = Math.max(
		0,
		islands.findIndex(
			(island) =>
				island.start === seedIsland.start && island.end === seedIsland.end,
		),
	);
	let left = seedIndex;
	let right = seedIndex;
	let best = evaluateSemanticAtomSpan(islands.slice(left, right + 1));
	while (true) {
		let bestExpansion:
			| {
					left: number;
					right: number;
					evaluation: SemanticSpanEvaluation;
			  }
			| null = null;
		if (
			left > 0 &&
			computeRangeGap(islands[left - 1], islands[left]) <= MAX_SEMANTIC_ISLAND_GAP_CHARS
		) {
			const evaluation = evaluateSemanticAtomSpan(islands.slice(left - 1, right + 1));
			bestExpansion = { left: left - 1, right, evaluation };
		}
		if (
			right < islands.length - 1 &&
			computeRangeGap(islands[right], islands[right + 1]) <=
				MAX_SEMANTIC_ISLAND_GAP_CHARS
		) {
			const evaluation = evaluateSemanticAtomSpan(islands.slice(left, right + 2));
			if (
				!bestExpansion ||
				compareSemanticEvaluations(evaluation, bestExpansion.evaluation) < 0
			) {
				bestExpansion = { left, right: right + 1, evaluation };
			}
		}
		if (!bestExpansion) {
			break;
		}
		if (!doesAtomCoverageImprove(best, bestExpansion.evaluation)) {
			break;
		}
		left = bestExpansion.left;
		right = bestExpansion.right;
		best = bestExpansion.evaluation;
	}
	return best;
}

function evaluateSemanticAtomSpan(
	islands: readonly SnippetSemanticIsland[],
): SemanticSpanEvaluation {
	const atoms = islands.flatMap((island) => island.atoms);
	const metrics = computeAtomCoverageMetrics(atoms);
	const start = islands[0]?.start ?? 0;
	const end = islands[islands.length - 1]?.end ?? start;
	let gapPenalty = 0;
	for (let index = 1; index < islands.length; index++) {
		gapPenalty += computeRangeGap(islands[index - 1], islands[index]);
	}
	const spanLength = Math.max(1, end - start);
	return {
		range: { start, end },
		atoms,
		semanticScore: metrics.weightedCoverage * 100 - gapPenalty * 6 - spanLength * 0.2,
		coverageCount:
			metrics.segmentKeyCount * 3 +
			metrics.familyKeyCount * 2 +
			metrics.bigramKeyCount +
			metrics.charKeyCount,
		anchorOffset: pickSemanticAnchorOffset(start, end, atoms),
		signature: metrics.signature,
	};
}

function doesAtomCoverageImprove(
	current: SemanticSpanEvaluation,
	candidate: SemanticSpanEvaluation,
): boolean {
	if (candidate.signature === current.signature) {
		return false;
	}
	if (candidate.coverageCount > current.coverageCount) {
		return true;
	}
	return candidate.semanticScore > current.semanticScore;
}

function buildRenderSnippetRangeFromAtoms(
	text: string,
	textLength: number,
	semanticSpan: SemanticSpanEvaluation,
	approximateWindow: CharRange,
	allAtoms: readonly SnippetMatchAtom[],
): CharRange {
	const focusStart = semanticSpan.range.start;
	const focusEnd =
		semanticSpan.range.end > semanticSpan.range.start
			? semanticSpan.range.end
			: approximateWindow.end;
	let start = Math.max(0, focusStart - SNIPPET_LEADING_CONTEXT_CHARS);
	let end = Math.min(textLength, focusEnd + SNIPPET_TRAILING_CONTEXT_CHARS);
	if (end - start > MAX_SNIPPET_WINDOW_CHARS) {
		start = Math.max(
			0,
			semanticSpan.anchorOffset - Math.floor(MAX_SNIPPET_WINDOW_CHARS / 2),
		);
		end = Math.min(textLength, start + MAX_SNIPPET_WINDOW_CHARS);
		start = Math.max(0, end - MAX_SNIPPET_WINDOW_CHARS);
	}
	let renderRange = clampSnippetRangeToTokenBudget(
		text,
		{ start, end },
		semanticSpan.anchorOffset,
	);
	renderRange = expandRenderRangeForSupportingAtoms(
		text,
		renderRange,
		semanticSpan,
		allAtoms,
	);
	return renderRange;
}

function expandRenderRangeForSupportingAtoms(
	text: string,
	range: CharRange,
	semanticSpan: SemanticSpanEvaluation,
	allAtoms: readonly SnippetMatchAtom[],
): CharRange {
	let currentRange = { ...range };
	let currentMetrics = computeAtomCoverageMetrics(
		allAtoms.filter(
			(atom) => atom.start >= currentRange.start && atom.end <= currentRange.end,
		),
	);
	const candidates = allAtoms
		.filter(
			(atom) =>
				atom.end <= currentRange.start || atom.start >= currentRange.end,
		)
		.sort((left, right) => {
			const leftGap =
				left.end <= currentRange.start
					? currentRange.start - left.end
					: left.start - currentRange.end;
			const rightGap =
				right.end <= currentRange.start
					? currentRange.start - right.end
					: right.start - currentRange.end;
			return leftGap - rightGap;
		});
	for (const atom of candidates) {
		const gap =
			atom.end <= currentRange.start
				? currentRange.start - atom.end
				: atom.start - currentRange.end;
		if (gap > MAX_SNIPPET_EXPANSION_GAP_CHARS) {
			continue;
		}
		const expandedRange = clampSnippetRangeToTokenBudget(
			text,
			{
				start: Math.min(currentRange.start, atom.start),
				end: Math.max(currentRange.end, atom.end),
			},
			semanticSpan.anchorOffset,
		);
		const expandedAtoms = allAtoms.filter(
			(candidate) =>
				candidate.start >= expandedRange.start &&
				candidate.end <= expandedRange.end,
		);
		const expandedMetrics = computeAtomCoverageMetrics(expandedAtoms);
		if (!doesAtomMetricsImprove(currentMetrics, expandedMetrics)) {
			continue;
		}
		currentRange = expandedRange;
		currentMetrics = expandedMetrics;
	}
	return currentRange;
}

function doesAtomMetricsImprove(
	current: SnippetCoverageMetrics,
	candidate: SnippetCoverageMetrics,
): boolean {
	if (candidate.signature === current.signature) {
		return false;
	}
	if (candidate.segmentKeyCount > current.segmentKeyCount) {
		return true;
	}
	if (candidate.familyKeyCount > current.familyKeyCount) {
		return true;
	}
	if (candidate.bigramKeyCount > current.bigramKeyCount) {
		return true;
	}
	if (candidate.charKeyCount > current.charKeyCount) {
		return true;
	}
	return candidate.weightedCoverage > current.weightedCoverage;
}

function buildHighlightRangesFromAtoms(
	snippetRange: CharRange,
	atoms: readonly SnippetMatchAtom[],
): CoverageLexicalHighlightRange[] {
	return mergeRanges(
		atoms
			.filter(
				(atom) =>
					atom.start >= snippetRange.start && atom.end <= snippetRange.end,
			)
			.map((atom) => ({
				start: atom.start - snippetRange.start,
				end: atom.end - snippetRange.start,
			})),
	);
}

function buildSnippetPayloadFromIsland(
	text: string,
	lineOffsets: readonly number[],
	allAtoms: readonly SnippetMatchAtom[],
	island: SnippetSemanticIsland,
	approximateWindow: CharRange,
	families: readonly CoverageLexicalFamily[],
	segmentDescriptors: readonly HanSegmentDescriptor[],
	sourceWindowScore: number,
	debugQueryText?: string,
	path?: string,
): CoverageSnippetPayload | null {
	const allIslands = rankSnippetSemanticIslands(allAtoms);
	const semanticSpan = buildBestSemanticSpanFromIslands(allIslands, island);
	const snippetRange = buildRenderSnippetRangeFromAtoms(
		text,
		text.length,
		semanticSpan,
		approximateWindow,
		allAtoms,
	);
	const snippetText = text.slice(snippetRange.start, snippetRange.end);
	const alignment = alignSnippetToQueryChars({
		snippetText,
		families,
		hanSegments: segmentDescriptors.map((segment) => ({ text: segment.text })),
		familyAtoms: allAtoms
			.filter(
				(atom) =>
					atom.start >= snippetRange.start &&
					atom.end <= snippetRange.end &&
					atom.kind.startsWith("family_"),
			)
			.map((atom) => ({
				kind: atom.kind as CoverageLexicalSnippetAlignerAtomInput["kind"],
				queryKey: atom.queryKey,
			})),
	});
	const highlightRanges = alignment.alignedRanges;
	const snippetScore =
		alignment.alignmentScore * 100 +
		semanticSpan.semanticScore * 0.05 +
		sourceWindowScore * 0.01;
	logHanSubitemDebug(debugQueryText, "snippet-atom-span", {
		path,
		island: {
			start: island.start,
			end: island.end,
			score: island.score,
			signature: island.metrics.signature,
		},
		semanticSpan: {
			range: semanticSpan.range,
			semanticScore: semanticSpan.semanticScore,
			coverageCount: semanticSpan.coverageCount,
			signature: semanticSpan.signature,
		},
		snippetRange,
		snippetText,
		finalSignature: alignment.signature,
		highlightRangeCount: highlightRanges.length,
		alignmentScore: alignment.alignmentScore,
		snippetScore,
	});
	if (highlightRanges.length === 0) {
		return null;
	}
	const prefixEllipsis = snippetRange.start > 0;
	const suffixEllipsis = snippetRange.end < text.length;
	const snippetTextWithEllipsis = `${prefixEllipsis ? "…" : ""}${snippetText}${
		suffixEllipsis ? "…" : ""
	}`;
	const adjustedRanges = highlightRanges.map((range) => ({
		start: range.start + (prefixEllipsis ? 1 : 0),
		end: range.end + (prefixEllipsis ? 1 : 0),
	}));
	const row = offsetToLine(lineOffsets, semanticSpan.anchorOffset);
	const lineStartOffset = lineOffsets[row] ?? 0;
	const col = Math.max(0, semanticSpan.anchorOffset - lineStartOffset);
	return {
		text: snippetTextWithEllipsis,
		html: renderHighlightedSnippet(snippetText, highlightRanges, {
			prefixEllipsis,
			suffixEllipsis,
		}),
		row,
		col,
		highlightRanges: adjustedRanges,
		anchorOffset: semanticSpan.anchorOffset,
		semanticRange: semanticSpan.range,
		semanticSignature: semanticSpan.signature,
		absoluteRange: snippetRange,
		finalFamilyHitCount: alignment.familyHitCount,
		finalFullSegmentCount: alignment.fullSegmentCount,
		finalBestSegmentCoverageCount:
			alignment.matchedBigramCount + alignment.matchedCharCount,
		finalBestSegmentCoverageRatio: alignment.coverageRatio,
		exactFamilyHitCount: alignment.exactFamilyHitCount,
		prefixFamilyHitCount: alignment.prefixFamilyHitCount,
		fuzzyFamilyHitCount: alignment.fuzzyFamilyHitCount,
		substringFamilyHitCount: alignment.substringFamilyHitCount,
		gapPenalty: alignment.gapPenalty,
		maxGap: alignment.maxGap,
		alignmentScore: alignment.alignmentScore,
		snippetScore,
		sourceWindowScore,
	};
}

function compareSemanticEvaluations(
	left: SemanticSpanEvaluation,
	right: SemanticSpanEvaluation,
): number {
	if (right.coverageCount !== left.coverageCount) {
		return right.coverageCount - left.coverageCount;
	}
	if (right.semanticScore !== left.semanticScore) {
		return right.semanticScore - left.semanticScore;
	}
	if (left.range.start !== right.range.start) {
		return left.range.start - right.range.start;
	}
	return left.range.end - right.range.end;
}

function pickSemanticAnchorOffset(
	start: number,
	end: number,
	units: readonly CoverageLexicalHighlightRange[] | readonly SnippetMatchAtom[],
): number {
	if (units.length === 0) {
		return start;
	}
	let best = units[0];
	for (const unit of units) {
		const bestWeight = "weight" in best ? best.weight : 0;
		const unitWeight = "weight" in unit ? unit.weight : 0;
		if (unitWeight > bestWeight) {
			best = unit;
			continue;
		}
		if (unitWeight === bestWeight && unit.start < best.start) {
			best = unit;
		}
	}
	return best.start;
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

function rankSnippetPayloads(
	payloads: readonly CoverageSnippetPayload[],
): CoverageSnippetPayload[] {
	return [...payloads].sort((left, right) => {
		if (right.finalFullSegmentCount !== left.finalFullSegmentCount) {
			return right.finalFullSegmentCount - left.finalFullSegmentCount;
		}
		if (right.finalBestSegmentCoverageRatio !== left.finalBestSegmentCoverageRatio) {
			return (
				right.finalBestSegmentCoverageRatio -
				left.finalBestSegmentCoverageRatio
			);
		}
		if (right.finalBestSegmentCoverageCount !== left.finalBestSegmentCoverageCount) {
			return (
				right.finalBestSegmentCoverageCount -
				left.finalBestSegmentCoverageCount
			);
		}
		if (right.finalFamilyHitCount !== left.finalFamilyHitCount) {
			return right.finalFamilyHitCount - left.finalFamilyHitCount;
		}
		if (right.exactFamilyHitCount !== left.exactFamilyHitCount) {
			return right.exactFamilyHitCount - left.exactFamilyHitCount;
		}
		if (right.prefixFamilyHitCount !== left.prefixFamilyHitCount) {
			return right.prefixFamilyHitCount - left.prefixFamilyHitCount;
		}
		if (right.fuzzyFamilyHitCount !== left.fuzzyFamilyHitCount) {
			return right.fuzzyFamilyHitCount - left.fuzzyFamilyHitCount;
		}
		if (right.substringFamilyHitCount !== left.substringFamilyHitCount) {
			return right.substringFamilyHitCount - left.substringFamilyHitCount;
		}
		if (left.gapPenalty !== right.gapPenalty) {
			return left.gapPenalty - right.gapPenalty;
		}
		if (left.maxGap !== right.maxGap) {
			return left.maxGap - right.maxGap;
		}
		if (right.alignmentScore !== left.alignmentScore) {
			return right.alignmentScore - left.alignmentScore;
		}
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
			logHanSubitemDebug(debugQueryText, "final-dedupe-drop", {
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
			continue;
		}
		logHanSubitemDebug(debugQueryText, "final-dedupe-keep", {
			payload: summarizeSnippetPayload(payload),
		});
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
	const sameSemanticSignature =
		left.semanticSignature.length > 0 &&
		left.semanticSignature === right.semanticSignature;
	const offsetsAreNear =
		Math.abs(left.anchorOffset - right.anchorOffset) <= FINAL_DUPLICATE_OFFSET_THRESHOLD;
	if (!offsetsAreNear && rangeGap > 16) {
		return false;
	}
	if (
		sameSemanticSignature &&
		(rangeOverlap >= 0.72 || rangeGap <= 8 || offsetsAreNear)
	) {
		return true;
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
		nearbySelected.some(
			(item) => item.semanticSignature === candidate.semanticSignature,
		)
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
	const sameSemanticSignature =
		left.semanticSignature.length > 0 &&
		left.semanticSignature === right.semanticSignature;
	if (
		sameSemanticSignature &&
		(rangeOverlap >= 0.72 ||
			rangeGap <= 8 ||
			Math.abs(left.anchorOffset - right.anchorOffset) <= SNIPPET_NEARBY_OFFSET_THRESHOLD)
	) {
		return true;
	}
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

function logHanSubitemDebug(
	queryText: string | undefined,
	stage: string,
	payload: Record<string, unknown>,
): void {
	if (!shouldLogCoverageLexicalHanSubitemDebug(queryText)) {
		return;
	}
	logger.debug(`[coverage-lexical][han-debug] ${stage}`, {
		queryText,
		...payload,
	});
}
