import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis, V3QueryUnit } from "../query/analysis";
import { normalizeText } from "../query/text";
import type { V3CandidateDocRecall } from "../recall";
import type { EvidencePackingProfile } from "../ranking";
import type {
	V3DirectSubitemCandidate,
	V3DirectSubitemOccurrence,
} from "./contracts";

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
	const rawBlocks = splitRawBodyBlocks(params.snapshotText);
	const candidateRanges = resolveCandidateRanges({
		rawBlocks,
		candidate: params.candidate,
		candidateRecall: params.candidateRecall,
		residentBase: params.residentBase,
		snapshotText: params.snapshotText,
		candidateRangeMode: params.candidateRangeMode,
	});
	const candidates = candidateRanges
		.map((range) =>
			buildCandidateForRange(
				params.snapshotText,
				range,
				params.queryAnalysis,
			),
		)
		.filter((candidate): candidate is V3DirectSubitemCandidate => candidate != null);
	return dedupeCandidateRanges(candidates);
}

function resolveCandidateRanges(params: {
	rawBlocks: readonly RawBlock[];
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	residentBase: ResidentBase;
	snapshotText: string;
	candidateRangeMode?: "resident_locality" | "whole_document";
}): ResolvedSnippetRange[] {
	if (params.candidateRangeMode === "whole_document") {
		return params.snapshotText.trim().length > 0
			? [{ start: 0, end: params.snapshotText.length }]
			: [];
	}
	const prioritizedBlockIds = prioritizeShortlistedBlockIds(
		params.residentBase,
		params.candidate,
		params.candidateRecall,
	);
	const selectedBlocks = prioritizedBlockIds
		.map((blockId) => {
			const ordinal =
				params.residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId;
			return params.rawBlocks[ordinal];
		})
		.filter((block): block is RawBlock => block != null);
	const ranges: ResolvedSnippetRange[] = selectedBlocks.map((block) => ({
		start: block.start,
		end: block.end,
	}));
	for (let index = 0; index < selectedBlocks.length - 1; index += 1) {
		const left = selectedBlocks[index];
		const right = selectedBlocks[index + 1];
		if (right.ordinal !== left.ordinal + 1) {
			continue;
		}
		ranges.push({ start: left.start, end: right.end });
	}
	if (ranges.length > 0) {
		return ranges;
	}
	if (
		params.snapshotText.trim().length > 0 &&
		(params.candidate.identityContainer != null || params.candidate.routeContainer != null)
	) {
		return [{ start: 0, end: params.snapshotText.length }];
	}
	return [];
}

function buildCandidateForRange(
	snapshotText: string,
	range: ResolvedSnippetRange,
	queryAnalysis: V3QueryAnalysis,
): V3DirectSubitemCandidate | null {
	const occurrences = collectOccurrences(snapshotText, range, queryAnalysis);
	const displayOccurrences = resolveDominantDisplayOccurrences(
		occurrences,
		queryAnalysis,
	);
	const realOccurrences = occurrences.filter(
		(occurrence) => occurrence.kind === "real_exact",
	);
	const surfaceOccurrences = occurrences.filter(
		(occurrence) => occurrence.kind === "surface_completion",
	);
	const coveredUnitIndices = uniqueSortedNumbers(
		realOccurrences
			.map((occurrence) => occurrence.queryUnitIndex)
			.filter((value): value is number => value != null),
	);
	const completedSurfaceGroupIndices = uniqueSortedNumbers(
		surfaceOccurrences
			.map((occurrence) => occurrence.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	if (
		coveredUnitIndices.length === 0 &&
		completedSurfaceGroupIndices.length === 0
	) {
		return null;
	}
	const representativeOccurrences = selectRepresentativeOccurrences(displayOccurrences);
	if (representativeOccurrences.length === 0) {
		return null;
	}
	const orderedRealOccurrences = representativeOccurrences.filter(
		(occurrence) => occurrence.kind === "real_exact",
	);
	let totalGap = 0;
	let maxAdjacentGap = 0;
	for (let index = 1; index < representativeOccurrences.length; index += 1) {
		const gap = Math.max(
			0,
			representativeOccurrences[index].start -
				representativeOccurrences[index - 1].end,
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
): V3DirectSubitemOccurrence[] {
	const unitByIndex = new Map(
		queryAnalysis.primaryUnits.map((unit) => [unit.index, unit]),
	);
	const surfaceOccurrencesByGroup = new Map<number, V3DirectSubitemOccurrence[]>();
	for (const occurrence of occurrences) {
		if (
			occurrence.kind !== "surface_completion" ||
			occurrence.surfaceGroupIndex == null
		) {
			continue;
		}
		const existing =
			surfaceOccurrencesByGroup.get(occurrence.surfaceGroupIndex) ?? [];
		existing.push(occurrence);
		surfaceOccurrencesByGroup.set(occurrence.surfaceGroupIndex, existing);
	}
	return occurrences.filter((occurrence) => {
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

function splitRawBodyBlocks(snapshotText: string): RawBlock[] {
	const blocks: RawBlock[] = [];
	const separator = /\r?\n\s*\r?\n+/gu;
	let start = 0;
	let ordinal = 0;
	for (const match of snapshotText.matchAll(separator)) {
		pushBlock(snapshotText, start, match.index ?? start, ordinal, blocks);
		if (blocks.length > ordinal) {
			ordinal += 1;
		}
		start = (match.index ?? start) + match[0].length;
	}
	pushBlock(snapshotText, start, snapshotText.length, ordinal, blocks);
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

function prioritizeShortlistedBlockIds(
	residentBase: ResidentBase,
	candidate: EvidencePackingProfile,
	candidateRecall: V3CandidateDocRecall,
): number[] {
	const shortlistedBlockIds = [...candidateRecall.shortlistedBodyBlockIds].sort(
		(left, right) => compareBlockOrder(residentBase, left, right),
	);
	const bestBodyWindowBlockIds = new Set(candidate.bodyWindowContainer?.blockIds ?? []);
	const bestBodyWindowOrdinals = new Set<number>(
		[...bestBodyWindowBlockIds].map(
			(blockId) => residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId,
		),
	);
	const adjacentChainBlockIds = new Set<number>(
		shortlistedBlockIds.filter((blockId) => {
			if (bestBodyWindowBlockIds.has(blockId)) {
				return false;
			}
			const blockOrdinal =
				residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId;
			return (
				bestBodyWindowOrdinals.has(blockOrdinal - 1) ||
				bestBodyWindowOrdinals.has(blockOrdinal + 1)
			);
		}),
	);
	const hanRouteBlockIds = new Set<number>(
		candidateRecall.hanBodyBlockGateStats.map((gate) => gate.blockId),
	);
	const prioritized: number[] = [];
	const seen = new Set<number>();
	for (const bucket of [
		bestBodyWindowBlockIds,
		adjacentChainBlockIds,
		hanRouteBlockIds,
	]) {
		for (const blockId of shortlistedBlockIds) {
			if (!bucket.has(blockId) || seen.has(blockId)) {
				continue;
			}
			seen.add(blockId);
			prioritized.push(blockId);
		}
	}
	for (const blockId of shortlistedBlockIds) {
		if (seen.has(blockId)) {
			continue;
		}
		seen.add(blockId);
		prioritized.push(blockId);
	}
	return prioritized;
}

function compareBlockOrder(
	residentBase: ResidentBase,
	left: number,
	right: number,
): number {
	const leftOrdinal = residentBase.bodyBlocks.blockOrdinalByBlockId[left] ?? left;
	const rightOrdinal = residentBase.bodyBlocks.blockOrdinalByBlockId[right] ?? right;
	return leftOrdinal - rightOrdinal || left - right;
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function dedupeCandidateRanges(
	candidates: readonly V3DirectSubitemCandidate[],
): V3DirectSubitemCandidate[] {
	const seen = new Set<string>();
	const deduped: V3DirectSubitemCandidate[] = [];
	for (const candidate of candidates) {
		const key = `${candidate.start}:${candidate.end}:${candidate.coveredRealPrimaryCount}:${candidate.completedHanSurfaceGroupCount}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(candidate);
	}
	return deduped;
}
