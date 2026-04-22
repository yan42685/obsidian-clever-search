import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import {
	buildBlockShortlistPriorityScore,
	compareBlockShortlistItems,
	getAttachedBlockShortlistSketch,
	passesBlockShortlistAdmission,
	type BlockShortlistItem,
	type BlockShortlistRepresentative,
} from "src/services/search/coverage-lexical-v3/body-locality/shortlist";
import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";
import {
	getBodyBlockExactFamilyIds,
	getDocHeadingFamilyIds,
	lookupQueryUnitFamilies,
	recallCandidateDocs,
	type V3QueryFamilyMatch,
	type V3QueryUnitFamilyMatches,
} from "src/services/search/coverage-lexical-v3/recall";
import { buildPackingProfile } from "src/services/search/coverage-lexical-v3/ranking";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";

type PositionedFamilyOccurrence = Readonly<{
	familyId: number;
	shardLocalFamilySlot: number;
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
}>;

type BodyOccurrence = Readonly<{
	blockId: number;
	unitIndex: number;
	match: V3QueryFamilyMatch;
	ordinalPosition: number;
	localPosition: number;
	localEndPosition: number;
	ordinalVirtualPosition: number;
	virtualPosition: number;
	virtualEndPosition: number;
}>;

type BodyWindowCandidate = Readonly<{
	blockIds: readonly number[];
	boundaryCrossingCount: number;
	coveredUnitIndices: readonly number[];
	coveredDistinctUnitCount: number;
	approxWindowStart: number;
	approxWindowEnd: number;
	approxHeadTailSpan: number;
	approxMaxAdjacentGap: number;
	approxTotalGapMass: number;
	preservesQueryOrder: boolean;
	representatives: readonly BodyOccurrence[];
}>;

type BodyScopePrefilter = Readonly<{
	blockIds: readonly number[];
	coveredDistinctUnitCount: number;
	preservesQueryOrder: boolean;
	approxHeadTailSpan: number;
	priorityScore: number;
	virtualOccurrences: readonly BodyOccurrence[];
}>;

const CHAIN_BOUNDARY_PENALTY = 0;
const BODY_WINDOW_PREFILTER_PER_BUCKET = 4;

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
			generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function readFamilyApproxLength(base: ResidentBase, familyId: number): number {
	const stringId = base.familyLexicon.familyStringIds[familyId] ?? 0;
	return base.stringArena.lengths[stringId] ?? 0;
}

function buildExactPositionedOccurrences(
	base: ResidentBase,
	familyIds: readonly number[],
): PositionedFamilyOccurrence[] {
	let cursor = 0;
	return familyIds.map((familyId, index) => {
		const approxLength = Math.max(1, readFamilyApproxLength(base, familyId));
		const occurrence = {
			familyId,
			shardLocalFamilySlot: familyId,
			ordinalPosition: index,
			localPosition: cursor,
			localEndPosition: cursor + approxLength,
		};
		cursor += approxLength + 1;
		return occurrence;
	});
}

function compareMatchPreference(
	left: V3QueryFamilyMatch,
	right: V3QueryFamilyMatch,
): number {
	return matchKindPreference(left.matchKind) - matchKindPreference(right.matchKind) ||
		left.editDistance - right.editDistance ||
		left.familyText.length - right.familyText.length ||
		left.familyText.localeCompare(right.familyText);
}

function matchKindPreference(kind: V3QueryFamilyMatch["matchKind"]): number {
	switch (kind) {
		case "exact":
			return 0;
		case "opaque_exact":
			return 1;
		case "prefix":
			return 2;
		default:
			return 3;
	}
}

function compareOccurrenceRepresentative(left: BodyOccurrence, right: BodyOccurrence): number {
	const preference = compareMatchPreference(left.match, right.match);
	if (preference !== 0) {
		return preference;
	}
	if (left.virtualPosition !== right.virtualPosition) {
		return left.virtualPosition - right.virtualPosition;
	}
	if (left.virtualEndPosition !== right.virtualEndPosition) {
		return left.virtualEndPosition - right.virtualEndPosition;
	}
	if (left.blockId !== right.blockId) {
		return left.blockId - right.blockId;
	}
	return left.match.familyId - right.match.familyId;
}

function compareBodyOccurrenceOrder(left: BodyOccurrence, right: BodyOccurrence): number {
	if (left.localPosition !== right.localPosition) {
		return left.localPosition - right.localPosition;
	}
	if (left.localEndPosition !== right.localEndPosition) {
		return left.localEndPosition - right.localEndPosition;
	}
	const preference = compareMatchPreference(left.match, right.match);
	if (preference !== 0) {
		return preference;
	}
	if (left.unitIndex !== right.unitIndex) {
		return left.unitIndex - right.unitIndex;
	}
	return left.match.familyId - right.match.familyId;
}

function collectBlockOccurrences(
	blockId: number,
	unitIndex: number,
	matches: readonly V3QueryFamilyMatch[],
	positionedOccurrences: readonly PositionedFamilyOccurrence[],
): BodyOccurrence[] {
	const occurrences: BodyOccurrence[] = [];
	for (const positionedOccurrence of positionedOccurrences) {
		const match = matches.find((candidate) => candidate.familyId === positionedOccurrence.familyId);
		if (match == null) {
			continue;
		}
		occurrences.push({
			blockId,
			unitIndex,
			match,
			ordinalPosition: positionedOccurrence.ordinalPosition,
			localPosition: positionedOccurrence.localPosition,
			localEndPosition: positionedOccurrence.localEndPosition,
			ordinalVirtualPosition: positionedOccurrence.ordinalPosition,
			virtualPosition: positionedOccurrence.localPosition,
			virtualEndPosition: positionedOccurrence.localEndPosition,
		});
	}
	return occurrences;
}

function buildChainVirtualOccurrences(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
): BodyOccurrence[] {
	const out: BodyOccurrence[] = [];
	let baseOffset = 0;
	let ordinalBaseOffset = 0;
	for (const blockId of blockIds) {
		const blockOccurrences = bodyOccurrencesByBlockId.get(blockId) ?? [];
		for (const occurrence of blockOccurrences) {
			out.push({
				...occurrence,
				ordinalVirtualPosition: ordinalBaseOffset + occurrence.ordinalPosition,
				virtualPosition: baseOffset + occurrence.localPosition,
				virtualEndPosition: baseOffset + occurrence.localEndPosition,
			});
		}
		baseOffset += (bodyApproxSpanByBlockId.get(blockId) ?? 0) + CHAIN_BOUNDARY_PENALTY;
		ordinalBaseOffset += (bodyOrdinalSpanByBlockId.get(blockId) ?? 0) + CHAIN_BOUNDARY_PENALTY;
	}
	return out.sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return compareBodyOccurrenceOrder(left, right);
	});
}

function buildBodyScopePrefilter(
	base: ResidentBase,
	blockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
): BodyScopePrefilter | null {
	const virtualOccurrences = buildChainVirtualOccurrences(
		base,
		blockIds,
		bodyOccurrencesByBlockId,
		bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId,
	);
	if (virtualOccurrences.length === 0) {
		return null;
	}
	const representativeByUnit = new Map<number, BodyOccurrence>();
	for (const occurrence of virtualOccurrences) {
		const existing = representativeByUnit.get(occurrence.unitIndex);
		if (existing == null || compareOccurrenceRepresentative(occurrence, existing) < 0) {
			representativeByUnit.set(occurrence.unitIndex, occurrence);
		}
	}
	if (representativeByUnit.size < 2) {
		return null;
	}
	const representatives = [...representativeByUnit.values()].sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return left.unitIndex - right.unitIndex;
	});
	const approxWindowStart = representatives[0]?.virtualPosition ?? 0;
	const approxWindowEnd =
		representatives[representatives.length - 1]?.virtualEndPosition ?? approxWindowStart;
	const coveredUnitIndices = [...representativeByUnit.keys()].sort((left, right) => left - right);
	const preservesQueryOrder = coveredUnitIndices.every((unitIndex, index) => {
		if (index === 0) {
			return true;
		}
		const previous = representativeByUnit.get(coveredUnitIndices[index - 1]);
		const current = representativeByUnit.get(unitIndex);
		return (previous?.virtualPosition ?? 0) <= (current?.virtualPosition ?? 0);
	});
	return {
		blockIds,
		coveredDistinctUnitCount: representativeByUnit.size,
		preservesQueryOrder,
		approxHeadTailSpan: Math.max(1, approxWindowEnd - approxWindowStart),
		priorityScore:
			representativeByUnit.size * 10000 +
			(preservesQueryOrder ? 500 : 0) -
			Math.max(1, approxWindowEnd - approxWindowStart) * 12 -
			(blockIds.length - 1) * 40,
		virtualOccurrences,
	};
}

function compareBlockIdLists(left: readonly number[], right: readonly number[]): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		if (left[index] !== right[index]) {
			return left[index] - right[index];
		}
	}
	return left.length - right.length;
}

function compareBodyScopePrefilter(left: BodyScopePrefilter, right: BodyScopePrefilter): number {
	if (left.coveredDistinctUnitCount !== right.coveredDistinctUnitCount) {
		return right.coveredDistinctUnitCount - left.coveredDistinctUnitCount;
	}
	if (left.preservesQueryOrder !== right.preservesQueryOrder) {
		return left.preservesQueryOrder ? -1 : 1;
	}
	if (left.approxHeadTailSpan !== right.approxHeadTailSpan) {
		return left.approxHeadTailSpan - right.approxHeadTailSpan;
	}
	if (left.priorityScore !== right.priorityScore) {
		return right.priorityScore - left.priorityScore;
	}
	return compareBlockIdLists(left.blockIds, right.blockIds);
}

function buildPrefilteredBodyScopes(
	base: ResidentBase,
	shortlistedBlockIds: readonly number[],
	bodyOccurrencesByBlockId: ReadonlyMap<number, readonly BodyOccurrence[]>,
	bodyApproxSpanByBlockId: ReadonlyMap<number, number>,
	bodyOrdinalSpanByBlockId: ReadonlyMap<number, number>,
): BodyScopePrefilter[] {
	const scopes: BodyScopePrefilter[] = [];
	for (const blockId of shortlistedBlockIds) {
		const scope = buildBodyScopePrefilter(
			base,
			[blockId],
			bodyOccurrencesByBlockId,
			bodyApproxSpanByBlockId,
			bodyOrdinalSpanByBlockId,
		);
		if (scope != null) {
			scopes.push(scope);
		}
	}
	for (let index = 0; index < shortlistedBlockIds.length - 1; index += 1) {
		const leftBlockId = shortlistedBlockIds[index];
		const rightBlockId = shortlistedBlockIds[index + 1];
		const leftOrdinal = base.bodyBlocks.blockOrdinalByBlockId[leftBlockId] ?? leftBlockId;
		const rightOrdinal = base.bodyBlocks.blockOrdinalByBlockId[rightBlockId] ?? rightBlockId;
		if (rightOrdinal !== leftOrdinal + 1) {
			continue;
		}
		const scope = buildBodyScopePrefilter(
			base,
			[leftBlockId, rightBlockId],
			bodyOccurrencesByBlockId,
			bodyApproxSpanByBlockId,
			bodyOrdinalSpanByBlockId,
		);
		if (scope != null) {
			scopes.push(scope);
		}
	}
	const buckets = new Map<number, BodyScopePrefilter[]>();
	for (const scope of scopes) {
		const bucket = buckets.get(scope.coveredDistinctUnitCount) ?? [];
		bucket.push(scope);
		buckets.set(scope.coveredDistinctUnitCount, bucket);
	}
	const selected: BodyScopePrefilter[] = [];
	for (const unitCount of [...buckets.keys()].sort((left, right) => right - left)) {
		const bucket = buckets.get(unitCount) ?? [];
		bucket.sort(compareBodyScopePrefilter);
		selected.push(...bucket.slice(0, BODY_WINDOW_PREFILTER_PER_BUCKET));
	}
	return selected;
}

function summarizeWindowCandidate(
	windowOccurrences: readonly BodyOccurrence[],
): BodyWindowCandidate | null {
	if (windowOccurrences.length === 0) {
		return null;
	}
	const representativeByUnit = new Map<number, BodyOccurrence>();
	for (const occurrence of windowOccurrences) {
		const existing = representativeByUnit.get(occurrence.unitIndex);
		if (existing == null || compareOccurrenceRepresentative(occurrence, existing) < 0) {
			representativeByUnit.set(occurrence.unitIndex, occurrence);
		}
	}
	const representatives = [...representativeByUnit.values()].sort((left, right) => {
		if (left.virtualPosition !== right.virtualPosition) {
			return left.virtualPosition - right.virtualPosition;
		}
		return left.unitIndex - right.unitIndex;
	});
	const coveredUnitIndices = [...representativeByUnit.keys()].sort((left, right) => left - right);
	if (coveredUnitIndices.length === 0) {
		return null;
	}
	let approxMaxAdjacentGap = 0;
	let approxTotalGapMass = 0;
	for (let index = 1; index < representatives.length; index += 1) {
		const approxGap = Math.max(
			0,
			representatives[index].virtualPosition - representatives[index - 1].virtualEndPosition,
		);
		approxMaxAdjacentGap = Math.max(approxMaxAdjacentGap, approxGap);
		approxTotalGapMass += approxGap;
	}
	const blockIds = [...new Set(representatives.map((occurrence) => occurrence.blockId))].sort(
		(left, right) => left - right,
	);
	const approxWindowStart = representatives[0]?.virtualPosition ?? 0;
	const approxWindowEnd =
		representatives[representatives.length - 1]?.virtualEndPosition ?? approxWindowStart;
	return {
		blockIds,
		boundaryCrossingCount: Math.max(0, blockIds.length - 1),
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		approxWindowStart,
		approxWindowEnd,
		approxHeadTailSpan: Math.max(1, approxWindowEnd - approxWindowStart),
		approxMaxAdjacentGap,
		approxTotalGapMass,
		preservesQueryOrder: coveredUnitIndices.every((unitIndex, index) => {
			if (index === 0) {
				return true;
			}
			const previous = representativeByUnit.get(coveredUnitIndices[index - 1]);
			const current = representativeByUnit.get(unitIndex);
			return (previous?.virtualPosition ?? 0) <= (current?.virtualPosition ?? 0);
		}),
		representatives,
	};
}

function toBlockShortlistItem(
	base: ResidentBase,
	candidate: BodyWindowCandidate,
): BlockShortlistItem {
	const representatives: BlockShortlistRepresentative[] = candidate.representatives.map(
		(representative) => ({
			queryUnitIndex: representative.unitIndex,
			familyId: representative.match.familyId,
			shardLocalFamilySlot:
				representative.match.shardLocalFamilySlot ??
				representative.match.familyId,
			familyText: representative.match.familyText,
			matchKind: representative.match.matchKind,
			blockId: representative.blockId,
			approxStart: representative.virtualPosition,
			approxEnd: representative.virtualEndPosition,
		}),
	);
	const blockStartId = candidate.blockIds[0] ?? 0;
	const blockEndId = candidate.blockIds[candidate.blockIds.length - 1] ?? 0;
	return {
		blockStart: base.bodyBlocks.blockOrdinalByBlockId[blockStartId] ?? blockStartId,
		blockEnd: base.bodyBlocks.blockOrdinalByBlockId[blockEndId] ?? blockEndId,
		blockIds: candidate.blockIds,
		boundaryCrossingCount: candidate.boundaryCrossingCount,
		coveredUnitIndices: candidate.coveredUnitIndices,
		coveredDistinctUnitCount: candidate.coveredDistinctUnitCount,
		representatives,
		approxWindowStart: candidate.approxWindowStart,
		approxWindowEnd: candidate.approxWindowEnd,
		approxMaxAdjacentGap: candidate.approxMaxAdjacentGap,
		approxHeadTailSpan: candidate.approxHeadTailSpan,
		approxTotalGapMass: candidate.approxTotalGapMass,
		preservesQueryOrder: candidate.preservesQueryOrder,
		priorityScore: buildBlockShortlistPriorityScore(candidate),
	};
}

function pushExhaustiveShortlistCandidate(
	shortlist: BlockShortlistItem[],
	item: BlockShortlistItem,
): void {
	shortlist.push(item);
	shortlist.sort(compareBlockShortlistItems);
	if (shortlist.length > 6) {
		shortlist.length = 6;
	}
}

function buildExhaustiveBodyWindowSelection(
	base: ResidentBase,
	queryText: string,
	documents: readonly IndexedDocument[],
): Readonly<{
	bestItem: BlockShortlistItem | null;
	shortlist: readonly BlockShortlistItem[];
}> {
	const queryAnalysis = analyzeQuery(queryText);
	const unitFamilyMatches = lookupQueryUnitFamilies(base, queryAnalysis);
	const candidateRecall = recallCandidateDocs(base, queryAnalysis, unitFamilyMatches)[0];
	if (candidateRecall == null) {
		return {
			bestItem: null,
			shortlist: [],
		};
	}
	const bodyOccurrencesByBlockId = new Map<number, BodyOccurrence[]>();
	const bodyApproxSpanByBlockId = new Map<number, number>();
	const bodyOrdinalSpanByBlockId = new Map<number, number>();
	for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
		const exactOccurrences = buildExactPositionedOccurrences(
			base,
			getBodyBlockExactFamilyIds(base, blockId),
		);
		bodyApproxSpanByBlockId.set(
			blockId,
			Math.max(1, exactOccurrences.at(-1)?.localEndPosition ?? 0),
		);
		bodyOrdinalSpanByBlockId.set(blockId, Math.max(1, exactOccurrences.length));
		const blockOccurrences: BodyOccurrence[] = [];
		for (const unitMatches of unitFamilyMatches) {
			blockOccurrences.push(
				...collectBlockOccurrences(
					blockId,
					unitMatches.queryUnitIndex,
					unitMatches.matches,
					exactOccurrences,
				),
			);
		}
		if (blockOccurrences.length > 0) {
			bodyOccurrencesByBlockId.set(blockId, blockOccurrences.sort(compareBodyOccurrenceOrder));
		}
	}
	const scopes = buildPrefilteredBodyScopes(
		base,
		candidateRecall.shortlistedBodyBlockIds,
		bodyOccurrencesByBlockId,
		bodyApproxSpanByBlockId,
		bodyOrdinalSpanByBlockId,
	);
	let bestItem: BlockShortlistItem | null = null;
	const shortlist: BlockShortlistItem[] = [];
	for (const scope of scopes) {
		let scopeBestItem: BlockShortlistItem | null = null;
		for (let start = 0; start < scope.virtualOccurrences.length; start += 1) {
			for (let end = start; end < scope.virtualOccurrences.length; end += 1) {
				const candidate = summarizeWindowCandidate(scope.virtualOccurrences.slice(start, end + 1));
				if (candidate == null || !passesBlockShortlistAdmission(candidate)) {
					continue;
				}
				const item = toBlockShortlistItem(base, candidate);
				if (scopeBestItem == null || compareBlockShortlistItems(item, scopeBestItem) < 0) {
					scopeBestItem = item;
				}
				if (bestItem == null || compareBlockShortlistItems(item, bestItem) < 0) {
					bestItem = item;
				}
			}
		}
		if (scopeBestItem != null) {
			pushExhaustiveShortlistCandidate(shortlist, scopeBestItem);
		}
	}
	expect(documents).toHaveLength(1);
	expect(getDocHeadingFamilyIds(base, 0)).toEqual([]);
	return {
		bestItem,
		shortlist,
	};
}

describe("coverage lexical v3 body window selection", () => {
	test.each([
		{
			name: "single block repeated exact terms",
			query: "alpha beta gamma",
			document: createDocument({
				path: "notes/repeated.md",
				basename: "repeated",
				folder: "notes",
				content: "alpha beta alpha beta gamma beta alpha gamma beta",
			}),
		},
		{
			name: "single block exact beats prefix with duplicates",
			query: "project token access",
			document: createDocument({
				path: "notes/project-token.md",
				basename: "project token note",
				folder: "notes",
				content:
					"projected token access projected token project token access projected access",
			}),
		},
		{
			name: "later exact replaces earlier prefix for same unit",
			query: "project access",
			document: createDocument({
				path: "notes/replacement.md",
				basename: "replacement",
				folder: "notes",
				content:
					"projected access drift projected context project access final witness",
			}),
		},
		{
			name: "adjacent blocks still match exhaustive window choice",
			query: "alpha gamma",
			document: createDocument({
				path: "notes/adjacent.md",
				basename: "adjacent",
				folder: "notes",
				content: "alpha alpha context here\n\nnoise gamma gamma context here",
			}),
		},
		{
			name: "single block order flips and recovers with later exact window",
			query: "alpha beta gamma",
			document: createDocument({
				path: "notes/order-recovery.md",
				basename: "order recovery",
				folder: "notes",
				content:
					"beta gamma drift alpha drift gamma alpha beta gamma steady witness",
			}),
		},
		{
			name: "adjacent blocks preserve gap and boundary shortlist semantics",
			query: "alpha beta gamma",
			document: createDocument({
				path: "notes/gap-boundary.md",
				basename: "gap boundary",
				folder: "notes",
				content:
					"alpha filler filler beta\n\ngamma filler filler alpha beta gamma",
			}),
		},
	])("$name", ({ query, document }) => {
		const base = buildResidentBase([document]);
		const queryAnalysis = analyzeQuery(query);
		const unitFamilyMatches = lookupQueryUnitFamilies(base, queryAnalysis);
		const candidateRecall = recallCandidateDocs(base, queryAnalysis, unitFamilyMatches)[0];
		expect(candidateRecall).toBeDefined();

		const profile = buildPackingProfile(base, queryAnalysis, candidateRecall!, unitFamilyMatches);
		const shortlist = getAttachedBlockShortlistSketch(profile);
		const actualBest = shortlist?.[0] ?? null;
		const expectedSelection = buildExhaustiveBodyWindowSelection(base, query, [document]);

		expect(shortlist ?? []).toEqual(expectedSelection.shortlist);
		expect(actualBest).toEqual(expectedSelection.bestItem);
		expect(profile.bodyWindowContainer?.coveredUnitIndices ?? []).toEqual(
			expectedSelection.bestItem?.coveredUnitIndices ?? [],
		);
	});
});
