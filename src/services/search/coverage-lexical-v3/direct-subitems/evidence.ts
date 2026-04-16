import type { ResidentBase } from "../layout/types";
import { getAttachedBlockShortlistSketch } from "../body-locality/shortlist";
import type { V3QueryAnalysis, V3QueryUnit } from "../query/analysis";
import {
	createV3BodyBlockChunkRanges,
	V3_BODY_BLOCK_MAX_TOKENS,
	V3_BODY_BLOCK_TARGET_TOKENS,
} from "../query/text";
import type { V3CandidateDocRecall } from "../recall";
import type { EvidencePackingProfile } from "../ranking";
import type {
	V3DirectSubitemCandidate,
	V3DirectSubitemOccurrence,
} from "./contracts";
import { compareV3DirectSubitemCandidates } from "./ranker";

const DIRECT_SUBITEM_WEIGHTED_GAP_LIMIT = 15;
const DIRECT_SUBITEM_HAN_GAP_WEIGHT = 0.65;
const DIRECT_SUBITEM_OTHER_GAP_WEIGHT = 0.25;
const DIRECT_SUBITEM_SHORTLIST_SCAN_LIMIT = 3;
const HAN_CHAR_PATTERN = /\p{Script=Han}/u;

export type ResolvedSnippetRange = Readonly<{
	start: number;
	end: number;
}>;

type RawBlock = Readonly<{
	ordinal: number;
	start: number;
	end: number;
	text: string;
}>;

export function buildV3DirectSubitemCandidates(params: {
	snapshotText: string;
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	residentBase: ResidentBase;
	candidateRangeMode?: "resident_locality" | "whole_document";
}): V3DirectSubitemCandidate[] {
	const supportedHanSurfaceGroupIndices = new Set(
		params.candidate.hanSurfaceCompletionGroups.map(
			(group) => group.surfaceGroupIndex,
		),
	);
	const rawBlocks = splitRawBodyBlocks(params.snapshotText);
	const candidateRanges = resolveCandidateRanges({
		rawBlocks,
		candidate: params.candidate,
		snapshotText: params.snapshotText,
		queryAnalysis: params.queryAnalysis,
		candidateRangeMode: params.candidateRangeMode,
	});
	const candidates = candidateRanges.flatMap((range) =>
		buildCandidatesForRange(
			params.snapshotText,
			range,
			params.queryAnalysis,
			supportedHanSurfaceGroupIndices,
		),
	);
	return candidates;
}

function resolveCandidateRanges(params: {
	rawBlocks: readonly RawBlock[];
	candidate: EvidencePackingProfile;
	snapshotText: string;
	queryAnalysis: V3QueryAnalysis;
	candidateRangeMode?: "resident_locality" | "whole_document";
}): ResolvedSnippetRange[] {
	if (params.candidateRangeMode === "whole_document") {
		return params.snapshotText.trim().length > 0
			? [{ start: 0, end: params.snapshotText.length }]
			: [];
	}
	const shortlist = getAttachedBlockShortlistSketch(params.candidate);
	if (shortlist != null && shortlist.length > 0) {
		const shortlistRanges = buildRangesFromShortlist(params.rawBlocks, shortlist);
		if (shortlistRanges.length > 0) {
			return shortlistRanges;
		}
	}
	const fallbackRanges = buildRangesFromLocalFallbackShortlist(
		params.snapshotText,
		params.rawBlocks,
		params.queryAnalysis,
		new Set(params.candidate.hanSurfaceCompletionGroups.map((group) => group.surfaceGroupIndex)),
	);
	if (fallbackRanges.length > 0) {
		return fallbackRanges;
	}
	if (
		params.snapshotText.trim().length > 0 &&
		(params.candidate.identityContainer != null || params.candidate.routeContainer != null)
	) {
		return [{ start: 0, end: params.snapshotText.length }];
	}
	return [];
}

function buildRangesFromShortlist(
	rawBlocks: readonly RawBlock[],
	shortlist: NonNullable<ReturnType<typeof getAttachedBlockShortlistSketch>>,
): ResolvedSnippetRange[] {
	const ranges: ResolvedSnippetRange[] = [];
	const seen = new Set<string>();
	for (const item of shortlist.slice(0, DIRECT_SUBITEM_SHORTLIST_SCAN_LIMIT)) {
		const startBlock = rawBlocks[item.blockStart];
		const endBlock = rawBlocks[item.blockEnd];
		if (startBlock == null || endBlock == null) {
			continue;
		}
		const key = `${startBlock.start}:${endBlock.end}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		ranges.push({
			start: startBlock.start,
			end: endBlock.end,
		});
	}
	return ranges;
}

function buildRangesFromLocalFallbackShortlist(
	snapshotText: string,
	rawBlocks: readonly RawBlock[],
	queryAnalysis: V3QueryAnalysis,
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): ResolvedSnippetRange[] {
	const localBlocks = subdivideRawBlocksForFallback(snapshotText, rawBlocks);
	const shortlisted: Array<{
		range: ResolvedSnippetRange;
		bestCandidate: V3DirectSubitemCandidate;
	}> = [];
	for (let index = 0; index < localBlocks.length; index += 1) {
		const block = localBlocks[index];
		pushFallbackRangeCandidate(
			shortlisted,
			snapshotText,
			{ start: block.start, end: block.end },
			queryAnalysis,
			supportedHanSurfaceGroupIndices,
		);
		const nextBlock = localBlocks[index + 1];
		if (nextBlock == null) {
			continue;
		}
		pushFallbackRangeCandidate(
			shortlisted,
			snapshotText,
			{ start: block.start, end: nextBlock.end },
			queryAnalysis,
			supportedHanSurfaceGroupIndices,
		);
	}
	shortlisted.sort((left, right) =>
		compareV3DirectSubitemCandidates(left.bestCandidate, right.bestCandidate),
	);
	const selected: ResolvedSnippetRange[] = [];
	const seen = new Set<string>();
	for (const item of shortlisted) {
		const key = `${item.range.start}:${item.range.end}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		selected.push(item.range);
		if (selected.length >= DIRECT_SUBITEM_SHORTLIST_SCAN_LIMIT) {
			break;
		}
	}
	return selected;
}

function buildCandidatesForRange(
	snapshotText: string,
	range: ResolvedSnippetRange,
	queryAnalysis: V3QueryAnalysis,
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): V3DirectSubitemCandidate[] {
	const occurrences = collectOccurrences(snapshotText, range, queryAnalysis);
	const displayOccurrences = resolveDominantDisplayOccurrences(
		occurrences,
		queryAnalysis,
		supportedHanSurfaceGroupIndices,
	);
	const occurrenceWindows = buildOccurrenceWindows(
		snapshotText,
		displayOccurrences.length > 0 ? displayOccurrences : occurrences,
	);
	if (occurrenceWindows.length === 0) {
		const candidate = buildCandidateFromOccurrences(
			snapshotText,
			occurrences,
			displayOccurrences,
			supportedHanSurfaceGroupIndices,
		);
		return candidate == null ? [] : [candidate];
	}
	return occurrenceWindows
		.map((window) =>
			buildCandidateFromOccurrenceWindow(
				snapshotText,
				occurrences,
				displayOccurrences,
				window,
				supportedHanSurfaceGroupIndices,
			),
		)
		.filter((candidate): candidate is V3DirectSubitemCandidate => candidate != null);
}

function pushFallbackRangeCandidate(
	shortlisted: Array<{
		range: ResolvedSnippetRange;
		bestCandidate: V3DirectSubitemCandidate;
	}>,
	snapshotText: string,
	range: ResolvedSnippetRange,
	queryAnalysis: V3QueryAnalysis,
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): void {
	const candidates = buildCandidatesForRange(
		snapshotText,
		range,
		queryAnalysis,
		supportedHanSurfaceGroupIndices,
	);
	if (candidates.length === 0) {
		return;
	}
	const bestCandidate = [...candidates].sort(compareV3DirectSubitemCandidates)[0];
	if (bestCandidate == null) {
		return;
	}
	shortlisted.push({ range, bestCandidate });
}

function buildCandidateFromOccurrenceWindow(
	snapshotText: string,
	occurrences: readonly V3DirectSubitemOccurrence[],
	displayOccurrences: readonly V3DirectSubitemOccurrence[],
	window: ResolvedSnippetRange,
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): V3DirectSubitemCandidate | null {
	const localOccurrences = occurrences.filter(
		(occurrence) =>
			occurrence.start >= window.start && occurrence.end <= window.end,
	);
	const localDisplayOccurrences = displayOccurrences.filter(
		(occurrence) =>
			occurrence.start >= window.start && occurrence.end <= window.end,
	);
	return buildCandidateFromOccurrences(
		snapshotText,
		localOccurrences,
		localDisplayOccurrences,
		supportedHanSurfaceGroupIndices,
	);
}

function buildCandidateFromOccurrences(
	snapshotText: string,
	occurrences: readonly V3DirectSubitemOccurrence[],
	displayOccurrences: readonly V3DirectSubitemOccurrence[],
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): V3DirectSubitemCandidate | null {
	if (occurrences.length === 0) {
		return null;
	}
	const realOccurrences = occurrences.filter(
		(occurrence) => occurrence.kind === "real_exact",
	);
	const validatedSurfaceOccurrences = resolveValidatedSurfaceCompletions(
		occurrences,
		supportedHanSurfaceGroupIndices,
	);
	const coveredUnitIndices = uniqueSortedNumbers(
		realOccurrences
			.map((occurrence) => occurrence.queryUnitIndex)
			.filter((value): value is number => value != null),
	);
	const completedSurfaceGroupIndices = uniqueSortedNumbers(
		validatedSurfaceOccurrences
			.map((occurrence) => occurrence.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	if (
		coveredUnitIndices.length === 0 &&
		completedSurfaceGroupIndices.length === 0
	) {
		return null;
	}
	const effectiveDisplayOccurrences =
		displayOccurrences.length > 0 ? displayOccurrences : occurrences;
	const representativeOccurrences = selectRepresentativeOccurrences(
		effectiveDisplayOccurrences,
	);
	if (representativeOccurrences.length === 0) {
		return null;
	}
	const orderedRealOccurrences = representativeOccurrences.filter(
		(occurrence) => occurrence.kind === "real_exact",
	);
	let totalGap = 0;
	let maxAdjacentGap = 0;
	for (let index = 1; index < representativeOccurrences.length; index += 1) {
		const gap = computeWeightedGap(
			snapshotText,
			representativeOccurrences[index - 1].end,
			representativeOccurrences[index].start,
		);
		totalGap += gap;
		maxAdjacentGap = Math.max(maxAdjacentGap, gap);
	}
	return {
		start: representativeOccurrences[0].start,
		end: representativeOccurrences[representativeOccurrences.length - 1].end,
		anchorOffset:
			orderedRealOccurrences[0]?.start ?? representativeOccurrences[0].start,
		occurrences,
		displayOccurrences,
		coveredRealPrimaryCount: coveredUnitIndices.length,
		completedHanSurfaceGroupCount: completedSurfaceGroupIndices.length,
		preservesQueryOrder: preservesQueryOrder(orderedRealOccurrences),
		windowWidth:
			representativeOccurrences[representativeOccurrences.length - 1].end -
			representativeOccurrences[0].start,
		maxAdjacentGap,
		totalGap,
	};
}

function buildOccurrenceWindows(
	snapshotText: string,
	occurrences: readonly V3DirectSubitemOccurrence[],
): ResolvedSnippetRange[] {
	if (occurrences.length === 0) {
		return [];
	}
	const sortedOccurrences = [...occurrences].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const windows: ResolvedSnippetRange[] = [];
	for (let startIndex = 0; startIndex < sortedOccurrences.length; startIndex += 1) {
		let endIndex = startIndex;
		let weightedGapTotal = 0;
		while (endIndex + 1 < sortedOccurrences.length) {
			const nextGap = computeWeightedGap(
				snapshotText,
				sortedOccurrences[endIndex].end,
				sortedOccurrences[endIndex + 1].start,
			);
			if (
				weightedGapTotal + nextGap >
				DIRECT_SUBITEM_WEIGHTED_GAP_LIMIT
			) {
				break;
			}
			weightedGapTotal += nextGap;
			endIndex += 1;
		}
		windows.push({
			start: sortedOccurrences[startIndex].start,
			end: sortedOccurrences[endIndex].end,
		});
	}
	return dedupeOccurrenceWindows(windows);
}

function dedupeOccurrenceWindows(
	windows: readonly ResolvedSnippetRange[],
): ResolvedSnippetRange[] {
	const deduped: ResolvedSnippetRange[] = [];
	const seen = new Set<string>();
	for (const window of windows) {
		const key = `${window.start}:${window.end}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(window);
	}
	return deduped;
}

function collectOccurrences(
	snapshotText: string,
	range: ResolvedSnippetRange,
	queryAnalysis: V3QueryAnalysis,
): V3DirectSubitemOccurrence[] {
	const segmentText = snapshotText.slice(range.start, range.end);
	const occurrences: V3DirectSubitemOccurrence[] = [];
	for (const unit of queryAnalysis.primaryUnits) {
		if (unit.source === "opaque_han_confirmed") {
			continue;
		}
		for (const occurrence of findTextOccurrences(segmentText, unit.text, unit)) {
			occurrences.push({
				kind: "real_exact",
				start: range.start + occurrence.start,
				end: range.start + occurrence.end,
				queryUnitIndex: unit.index,
				surfaceGroupIndex: unit.surfaceGroupIndex,
				text: unit.text,
			});
		}
	}
	for (const group of queryAnalysis.surfaceGroups) {
		if (group.kind !== "han" || Array.from(group.text).length < 2) {
			continue;
		}
		for (const occurrence of findTextOccurrences(segmentText, group.text)) {
			occurrences.push({
				kind: "surface_completion",
				start: range.start + occurrence.start,
				end: range.start + occurrence.end,
				queryUnitIndex: null,
				surfaceGroupIndex: group.index,
				text: group.text,
			});
		}
	}
	return occurrences.sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function findTextOccurrences(
	haystack: string,
	needle: string,
	unit?: V3QueryUnit,
): Array<{ start: number; end: number }> {
	const out: Array<{ start: number; end: number }> = [];
	if (needle.length === 0 || haystack.length === 0) {
		return out;
	}
	const useCaseInsensitive = unit == null || unit.source === "surface";
	const haystackText = useCaseInsensitive ? haystack.toLowerCase() : haystack;
	const needleText = useCaseInsensitive ? needle.toLowerCase() : needle;
	let searchStart = 0;
	while (searchStart < haystackText.length) {
		const index = haystackText.indexOf(needleText, searchStart);
		if (index < 0) {
			break;
		}
		out.push({ start: index, end: index + needleText.length });
		searchStart = index + 1;
	}
	return out;
}

function selectRepresentativeOccurrences(
	occurrences: readonly V3DirectSubitemOccurrence[],
): V3DirectSubitemOccurrence[] {
	const bestByKey = new Map<string, V3DirectSubitemOccurrence>();
	for (const occurrence of occurrences) {
		const key =
			occurrence.kind === "real_exact"
				? `unit:${occurrence.queryUnitIndex ?? -1}`
				: `surface:${occurrence.surfaceGroupIndex ?? -1}`;
		const existing = bestByKey.get(key);
		if (existing == null || occurrence.start < existing.start) {
			bestByKey.set(key, occurrence);
		}
	}
	return [...bestByKey.values()].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function computeWeightedGap(
	snapshotText: string,
	start: number,
	end: number,
): number {
	if (end <= start) {
		return 0;
	}
	let total = 0;
	for (const char of snapshotText.slice(start, end)) {
		total += HAN_CHAR_PATTERN.test(char)
			? DIRECT_SUBITEM_HAN_GAP_WEIGHT
			: DIRECT_SUBITEM_OTHER_GAP_WEIGHT;
	}
	return total;
}

function preservesQueryOrder(
	occurrences: readonly V3DirectSubitemOccurrence[],
): boolean {
	for (let index = 1; index < occurrences.length; index += 1) {
		if (
			(occurrences[index - 1].queryUnitIndex ?? -1) >
			(occurrences[index].queryUnitIndex ?? -1)
		) {
			return false;
		}
	}
	return true;
}

function resolveDominantDisplayOccurrences(
	occurrences: readonly V3DirectSubitemOccurrence[],
	queryAnalysis: V3QueryAnalysis,
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): V3DirectSubitemOccurrence[] {
	const unitByIndex = new Map(
		queryAnalysis.primaryUnits.map((unit) => [unit.index, unit]),
	);
	const validatedSurfaceOccurrences = resolveValidatedSurfaceCompletions(
		occurrences,
		supportedHanSurfaceGroupIndices,
	);
	const validatedSurfaceKeys = new Set(
		validatedSurfaceOccurrences.map((occurrence) =>
			buildOccurrenceKey(occurrence),
		),
	);
	const surfaceOccurrencesByGroup = new Map<number, V3DirectSubitemOccurrence[]>();
	for (const occurrence of validatedSurfaceOccurrences) {
		const existing =
			surfaceOccurrencesByGroup.get(occurrence.surfaceGroupIndex ?? -1) ?? [];
		existing.push(occurrence);
		surfaceOccurrencesByGroup.set(occurrence.surfaceGroupIndex ?? -1, existing);
	}
	return occurrences.filter((occurrence) => {
		if (occurrence.kind === "surface_completion") {
			return validatedSurfaceKeys.has(buildOccurrenceKey(occurrence));
		}
		if (
			occurrence.kind !== "real_exact" ||
			occurrence.surfaceGroupIndex == null
		) {
			return occurrence.kind !== "route_only";
		}
		const unit = unitByIndex.get(occurrence.queryUnitIndex ?? -1);
		if (unit?.source !== "han_tokenizer_real") {
			return true;
		}
		const surfaceOccurrences =
			surfaceOccurrencesByGroup.get(occurrence.surfaceGroupIndex) ?? [];
		return surfaceOccurrences.length === 0;
	});
}

function resolveValidatedSurfaceCompletions(
	occurrences: readonly V3DirectSubitemOccurrence[],
	supportedHanSurfaceGroupIndices: ReadonlySet<number>,
): V3DirectSubitemOccurrence[] {
	const realOccurrencesBySurfaceGroup = new Map<number, V3DirectSubitemOccurrence[]>();
	for (const occurrence of occurrences) {
		if (
			occurrence.kind !== "real_exact" ||
			occurrence.surfaceGroupIndex == null
		) {
			continue;
		}
		const existing =
			realOccurrencesBySurfaceGroup.get(occurrence.surfaceGroupIndex) ?? [];
		existing.push(occurrence);
		realOccurrencesBySurfaceGroup.set(occurrence.surfaceGroupIndex, existing);
	}
	return occurrences.filter((occurrence) => {
		if (
			occurrence.kind !== "surface_completion" ||
			occurrence.surfaceGroupIndex == null
		) {
			return false;
		}
		const groupRealOccurrences =
			realOccurrencesBySurfaceGroup.get(occurrence.surfaceGroupIndex) ?? [];
		const distinctRealSurfaceGroupCount = realOccurrencesBySurfaceGroup.size;
		const hasCorroboration =
			supportedHanSurfaceGroupIndices.has(occurrence.surfaceGroupIndex) ||
			distinctRealSurfaceGroupCount > 1;
		return groupRealOccurrences.some((realOccurrence) =>
			realOccurrence.start >= occurrence.start &&
			realOccurrence.end <= occurrence.end,
		) && hasCorroboration;
	});
}

function buildOccurrenceKey(
	occurrence: V3DirectSubitemOccurrence,
): string {
	return `${occurrence.kind}:${occurrence.queryUnitIndex ?? -1}:${occurrence.surfaceGroupIndex ?? -1}:${occurrence.start}:${occurrence.end}`;
}

function splitRawBodyBlocks(snapshotText: string): RawBlock[] {
	const blocks: RawBlock[] = [];
	const ranges = createV3BodyBlockChunkRanges(
		snapshotText,
		V3_BODY_BLOCK_TARGET_TOKENS,
		V3_BODY_BLOCK_MAX_TOKENS,
	);
	for (let ordinal = 0; ordinal < ranges.length; ordinal += 1) {
		const range = ranges[ordinal];
		pushBlock(snapshotText, range.startOffset, range.endOffset, ordinal, blocks);
	}
	return blocks;
}

function pushBlock(
	snapshotText: string,
	rangeStart: number,
	rangeEnd: number,
	ordinal: number,
	blocks: RawBlock[],
): void {
	const rawText = snapshotText.slice(rangeStart, rangeEnd);
	const leadingTrim = rawText.search(/\S/u);
	if (leadingTrim < 0) {
		return;
	}
	const trailingTrim = rawText.length - rawText.trimEnd().length;
	const start = rangeStart + leadingTrim;
	const end = rangeEnd - trailingTrim;
	const text = snapshotText.slice(start, end);
	blocks.push({
		ordinal,
		start,
		end,
		text,
	});
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function subdivideRawBlocksForFallback(
	snapshotText: string,
	rawBlocks: readonly RawBlock[],
): RawBlock[] {
	const paragraphs: RawBlock[] = [];
	for (const block of rawBlocks) {
		const localParagraphs = splitBlockIntoParagraphs(snapshotText, block);
		if (localParagraphs.length <= 1) {
			paragraphs.push(block);
			continue;
		}
		paragraphs.push(...localParagraphs);
	}
	return paragraphs;
}

function splitBlockIntoParagraphs(
	snapshotText: string,
	block: RawBlock,
): RawBlock[] {
	const paragraphs: RawBlock[] = [];
	const paragraphBreakPattern = /\n\s*\n+/gu;
	let cursor = block.start;
	for (const match of block.text.matchAll(paragraphBreakPattern)) {
		const matchStart = block.start + (match.index ?? 0);
		pushParagraphBlock(snapshotText, cursor, matchStart, block.ordinal, paragraphs);
		cursor = block.start + (match.index ?? 0) + match[0].length;
	}
	pushParagraphBlock(snapshotText, cursor, block.end, block.ordinal, paragraphs);
	return paragraphs;
}

function pushParagraphBlock(
	snapshotText: string,
	start: number,
	end: number,
	ordinal: number,
	blocks: RawBlock[],
): void {
	if (end <= start) {
		return;
	}
	pushBlock(snapshotText, start, end, ordinal, blocks);
}
