import type { ResidentIntegerArray } from "../layout/integer-arrays";
import {
	getSentinelSliceEnd,
	getSentinelSliceStart,
	sliceResidentIntegerArray,
	sliceSentinelBucket,
} from "../layout/integer-arrays";
import { decodeBlockPositionLane } from "../layout/position-lanes";
import { collectBodyFamilyPostingBlockIdsForShardLocalFamilySlot as collectBodyFamilyPostingBlockIdsFromField } from "../layout/body-family-posting";
import type { ResidentBase } from "../layout/types";
import {
	decodeBodyHanCharPosting,
	decodeBodyHanPosting,
	lookupHanBigramIndex,
	lookupHanCharIndex,
} from "../layout/han-route";

export type BodyHanWitnessOccurrence = Readonly<{
	stringId: number;
	start: number;
}>;

export type BodyBlockFamilySupportEntry = Readonly<{
	familyId: number;
	supportMask: number;
}>;

export function readResidentString(
	base: ResidentBase,
	stringId: number,
): string {
	const offset = base.stringArena.offsets[stringId] ?? 0;
	const length = base.stringArena.lengths[stringId] ?? 0;
	return base.stringArena.text.slice(offset, offset + length);
}

export function getFamilyText(base: ResidentBase, familyId: number): string {
	const stringId = base.familyLexicon.familyStringIds[familyId] ?? 0;
	return readResidentString(base, stringId);
}

export function getShardLocalFamilySlot(
	base: ResidentBase,
	familyId: number,
): number {
	return base.familyLexicon.shardLocalFamilySlotByFamilyId[familyId] ?? familyId;
}

export function getFamilyIdForShardLocalFamilySlot(
	base: ResidentBase,
	shardLocalFamilySlot: number,
): number {
	return (
		base.familyLexicon.familyIdByShardLocalFamilySlot[shardLocalFamilySlot] ??
		shardLocalFamilySlot
	);
}

export function getShardLocalFamilyText(
	base: ResidentBase,
	shardLocalFamilySlot: number,
): string {
	return getFamilyText(base, getFamilyIdForShardLocalFamilySlot(base, shardLocalFamilySlot));
}

export function getDocPath(base: ResidentBase, docId: number): string {
	return readResidentString(base, base.docTable.pathStringIds[docId] ?? 0);
}

export function getLiveDocSlot(base: ResidentBase, docId: number): number {
	return base.docTable.liveDocSlotByDocId[docId] ?? docId;
}

export function getDocIdForLiveDocSlot(
	base: ResidentBase,
	liveDocSlot: number,
): number {
	return base.docTable.docIdByLiveDocSlot[liveDocSlot] ?? liveDocSlot;
}

export function getLiveDocSlotForBlockId(
	base: ResidentBase,
	blockId: number,
): number {
	return base.bodyBlocks.liveDocSlotByBlockId[blockId] ?? -1;
}

export function getDocRef(base: ResidentBase, docId: number): number | null {
	const docRef = base.docTable.docRefsByDocId[docId];
	return Number.isFinite(docRef) && docRef > 0 ? docRef : null;
}

export function getDocStableKey(base: ResidentBase, docId: number): string {
	const docRef = getDocRef(base, docId);
	return docRef === null ? getDocPath(base, docId) : `docref:${docRef}`;
}

export function getLiveDocPath(base: ResidentBase, liveDocSlot: number): string {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	const pathStringId = base.docTable.pathStringIds[docId] ?? 0;
	return readResidentString(base, pathStringId);
}

export function getLiveDocRef(
	base: ResidentBase,
	liveDocSlot: number,
): number | null {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	const docRef = base.docTable.docRefsByDocId[docId];
	return Number.isFinite(docRef) && docRef > 0 ? docRef : null;
}

export function getLiveDocStableKey(
	base: ResidentBase,
	liveDocSlot: number,
): string {
	const docRef = getLiveDocRef(base, liveDocSlot);
	return docRef === null
		? getLiveDocPath(base, liveDocSlot)
		: `docref:${docRef}`;
}

export function getLiveDocGeneration(
	base: ResidentBase,
	liveDocSlot: number,
): number {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	return base.docTable.generationByDocId[docId] ?? 0;
}

function resolveLiveDocSliceBounds(
	base: ResidentBase,
	liveDocSlot: number,
	params: Readonly<{
		startByDocId: ResidentIntegerArray;
		countByDocId: ResidentIntegerArray;
	}>,
): readonly [number, number] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	const start = params.startByDocId[docId] ?? 0;
	const count = params.countByDocId[docId] ?? 0;
	return [start, start + count];
}

export function getDocIdentityFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceResidentIntegerArray(
		base.metadataContainers.identityFamiliesByDoc,
		base.docTable.identityStartByDocId[docId] ?? 0,
		(base.docTable.identityStartByDocId[docId] ?? 0) +
			(base.docTable.identityCountByDocId[docId] ?? 0),
	);
}

export function getLiveDocIdentityFamilyIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const [start, end] = resolveLiveDocSliceBounds(base, liveDocSlot, {
		startByDocId: base.docTable.identityStartByDocId,
		countByDocId: base.docTable.identityCountByDocId,
	});
	return sliceResidentIntegerArray(
		base.metadataContainers.identityFamiliesByDoc,
		start,
		end,
	);
}

export function getDocIdentitySourceMasks(
	base: ResidentBase,
	docId: number,
): number[] {
	return Array.from(
		base.metadataContainers.identitySourceMaskByDocEntry.slice(
			base.docTable.identityStartByDocId[docId] ?? 0,
			(base.docTable.identityStartByDocId[docId] ?? 0) +
			(base.docTable.identityCountByDocId[docId] ?? 0),
		),
	);
}

export function getLiveDocIdentitySourceMasks(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const [start, end] = resolveLiveDocSliceBounds(base, liveDocSlot, {
		startByDocId: base.docTable.identityStartByDocId,
		countByDocId: base.docTable.identityCountByDocId,
	});
	return Array.from(
		base.metadataContainers.identitySourceMaskByDocEntry.slice(start, end),
	);
}

export function getDocRouteFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceResidentIntegerArray(
		base.metadataContainers.routeFamiliesByDoc,
		base.docTable.routeStartByDocId[docId] ?? 0,
		(base.docTable.routeStartByDocId[docId] ?? 0) +
			(base.docTable.routeCountByDocId[docId] ?? 0),
	);
}

export function getLiveDocRouteFamilyIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const [start, end] = resolveLiveDocSliceBounds(base, liveDocSlot, {
		startByDocId: base.docTable.routeStartByDocId,
		countByDocId: base.docTable.routeCountByDocId,
	});
	return sliceResidentIntegerArray(
		base.metadataContainers.routeFamiliesByDoc,
		start,
		end,
	);
}

export function getDocRouteSourceMasks(
	base: ResidentBase,
	docId: number,
): number[] {
	return Array.from(
		base.metadataContainers.routeSourceMaskByDocEntry.slice(
			base.docTable.routeStartByDocId[docId] ?? 0,
			(base.docTable.routeStartByDocId[docId] ?? 0) +
			(base.docTable.routeCountByDocId[docId] ?? 0),
		),
	);
}

export function getLiveDocRouteSourceMasks(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const [start, end] = resolveLiveDocSliceBounds(base, liveDocSlot, {
		startByDocId: base.docTable.routeStartByDocId,
		countByDocId: base.docTable.routeCountByDocId,
	});
	return Array.from(
		base.metadataContainers.routeSourceMaskByDocEntry.slice(start, end),
	);
}

export function getDocHeadingFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceResidentIntegerArray(
		base.metadataContainers.headingFamiliesByDoc,
		base.docTable.headingStartByDocId[docId] ?? 0,
		(base.docTable.headingStartByDocId[docId] ?? 0) +
			(base.docTable.headingCountByDocId[docId] ?? 0),
	);
}

export function getLiveDocHeadingFamilyIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const [start, end] = resolveLiveDocSliceBounds(base, liveDocSlot, {
		startByDocId: base.docTable.headingStartByDocId,
		countByDocId: base.docTable.headingCountByDocId,
	});
	return sliceResidentIntegerArray(
		base.metadataContainers.headingFamiliesByDoc,
		start,
		end,
	);
}

export function getDocBodyBlockIds(
	base: ResidentBase,
	docId: number,
): number[] {
	const start = base.docTable.bodyBlockStartByDocId[docId] ?? 0;
	const count = base.docTable.bodyBlockCountByDocId[docId] ?? 0;
	return Array.from({ length: count }, (_, index) => start + index);
}

export function getLiveDocBodyBlockIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	const start = base.docTable.bodyBlockStartByDocId[docId] ?? 0;
	const count = base.docTable.bodyBlockCountByDocId[docId] ?? 0;
	return Array.from({ length: count }, (_, index) => start + index);
}

export function collectBodyFamilyPostingBlockIds(
	base: ResidentBase,
	shardLocalFamilySlot: number,
): number[] {
	return collectBodyFamilyPostingBlockIdsFromField(
		base.bodyFamilyPosting,
		shardLocalFamilySlot,
	);
}

export function collectBodyFamilyPostingBlockIdsForShardLocalFamilySlot(
	base: ResidentBase,
	shardLocalFamilySlot: number,
): number[] {
	return collectBodyFamilyPostingBlockIds(base, shardLocalFamilySlot);
}

export function getBodyBlockExactFamilyIds(
	base: ResidentBase,
	blockId: number,
): number[] {
	return sliceResidentIntegerArray(
		base.exactTapes.familyIds,
		base.bodyBlocks.exactTapeStartByBlockId[blockId] ?? 0,
		(base.bodyBlocks.exactTapeStartByBlockId[blockId] ?? 0) +
			(base.bodyBlocks.exactTapeCountByBlockId[blockId] ?? 0),
	);
}

export function getBodyBlockExactTokenPositions(
	base: ResidentBase,
	blockId: number,
): number[] {
	const count = base.bodyBlocks.exactTapeCountByBlockId[blockId] ?? 0;
	return decodeBlockPositionLane(base.exactTapes, blockId, count);
}

export function getBodyBlockFamilySupportEntries(
	base: ResidentBase,
	blockId: number,
): BodyBlockFamilySupportEntry[] {
	const start = base.bodyBlocks.familySupportStartByBlockId[blockId] ?? 0;
	const end = base.bodyBlocks.familySupportStartByBlockId[blockId + 1] ?? start;
	const familyIds = sliceResidentIntegerArray(
		base.bodyBlocks.familySupportShardLocalFamilySlots,
		start,
		end,
	);
	return familyIds.map((familyId, index) => ({
		familyId,
		supportMask: base.bodyBlocks.familySupportMaskByEntry[start + index] ?? 0,
	}));
}

export function getBodyBlockFamilySupportMask(
	base: ResidentBase,
	blockId: number,
	familyId: number,
): number {
	for (const entry of getBodyBlockFamilySupportEntries(base, blockId)) {
		if (entry.familyId === familyId) {
			return entry.supportMask;
		}
	}
	return 0;
}

export function getDocIdentityHanWitnessStringIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.identityWitnessStartByDocId,
		base.hanRoute.identityWitnessTextIds,
		docId,
	);
}

export function getLiveDocIdentityHanWitnessStringIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	return sliceSentinelBucket(
		base.hanRoute.identityWitnessStartByDocId,
		base.hanRoute.identityWitnessTextIds,
		docId,
	);
}

export function getDocIdentityHanWitnessSourceMasks(
	base: ResidentBase,
	docId: number,
): number[] {
	const start = base.hanRoute.identityWitnessStartByDocId[docId] ?? 0;
	const end = base.hanRoute.identityWitnessStartByDocId[docId + 1] ?? start;
	return Array.from(base.hanRoute.identityWitnessSourceMaskByDocEntry.slice(start, end));
}

export function getLiveDocIdentityHanWitnessSourceMasks(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	const start = base.hanRoute.identityWitnessStartByDocId[docId] ?? 0;
	const end = base.hanRoute.identityWitnessStartByDocId[docId + 1] ?? start;
	return Array.from(base.hanRoute.identityWitnessSourceMaskByDocEntry.slice(start, end));
}

export function getDocIdentityHanWitnessTexts(
	base: ResidentBase,
	docId: number,
): string[] {
	return getDocIdentityHanWitnessStringIds(base, docId).map((stringId) =>
		readResidentString(base, stringId),
	);
}

export function getLiveDocIdentityHanWitnessTexts(
	base: ResidentBase,
	liveDocSlot: number,
): string[] {
	return getLiveDocIdentityHanWitnessStringIds(base, liveDocSlot).map(
		(stringId) => readResidentString(base, stringId),
	);
}

export function getDocRouteHanWitnessStringIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.routeWitnessStartByDocId,
		base.hanRoute.routeWitnessTextIds,
		docId,
	);
}

export function getLiveDocRouteHanWitnessStringIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	return sliceSentinelBucket(
		base.hanRoute.routeWitnessStartByDocId,
		base.hanRoute.routeWitnessTextIds,
		docId,
	);
}

export function getDocRouteHanWitnessSourceMasks(
	base: ResidentBase,
	docId: number,
): number[] {
	const start = base.hanRoute.routeWitnessStartByDocId[docId] ?? 0;
	const end = base.hanRoute.routeWitnessStartByDocId[docId + 1] ?? start;
	return Array.from(base.hanRoute.routeWitnessSourceMaskByDocEntry.slice(start, end));
}

export function getLiveDocRouteHanWitnessSourceMasks(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	const start = base.hanRoute.routeWitnessStartByDocId[docId] ?? 0;
	const end = base.hanRoute.routeWitnessStartByDocId[docId + 1] ?? start;
	return Array.from(base.hanRoute.routeWitnessSourceMaskByDocEntry.slice(start, end));
}

export function getDocRouteHanWitnessTexts(
	base: ResidentBase,
	docId: number,
): string[] {
	return getDocRouteHanWitnessStringIds(base, docId).map((stringId) =>
		readResidentString(base, stringId),
	);
}

export function getLiveDocRouteHanWitnessTexts(
	base: ResidentBase,
	liveDocSlot: number,
): string[] {
	return getLiveDocRouteHanWitnessStringIds(base, liveDocSlot).map(
		(stringId) => readResidentString(base, stringId),
	);
}

export function getDocHeadingHanWitnessStringIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.headingWitnessStartByDocId,
		base.hanRoute.headingWitnessTextIds,
		docId,
	);
}

export function getLiveDocHeadingHanWitnessStringIds(
	base: ResidentBase,
	liveDocSlot: number,
): number[] {
	const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
	return sliceSentinelBucket(
		base.hanRoute.headingWitnessStartByDocId,
		base.hanRoute.headingWitnessTextIds,
		docId,
	);
}

export function getDocHeadingHanWitnessTexts(
	base: ResidentBase,
	docId: number,
): string[] {
	return getDocHeadingHanWitnessStringIds(base, docId).map((stringId) =>
		readResidentString(base, stringId),
	);
}

export function getLiveDocHeadingHanWitnessTexts(
	base: ResidentBase,
	liveDocSlot: number,
): string[] {
	return getLiveDocHeadingHanWitnessStringIds(base, liveDocSlot).map(
		(stringId) => readResidentString(base, stringId),
	);
}

export function getBodyBlockHanWitnessStringIds(
	base: ResidentBase,
	blockId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.bodyWitnessOccurrenceStartByBlockId,
		base.hanRoute.bodyWitnessOccurrenceTextIds,
		blockId,
	);
}

export function getBodyBlockHanWitnessStartOffsets(
	base: ResidentBase,
	blockId: number,
): number[] {
	const count =
		(base.hanRoute.bodyWitnessOccurrenceStartByBlockId[blockId + 1] ?? 0) -
		(base.hanRoute.bodyWitnessOccurrenceStartByBlockId[blockId] ?? 0);
	return decodeBlockPositionLane(
		{
			positionEncodingByBlockId:
				base.hanRoute.bodyWitnessPositionEncodingByBlockId,
			positionStartByBlockId:
				base.hanRoute.bodyWitnessPositionStartByBlockId,
			positionDeltaU8Tape: base.hanRoute.bodyWitnessPositionDeltaU8Tape,
			positionDeltaU16Tape: base.hanRoute.bodyWitnessPositionDeltaU16Tape,
			positionDeltaU32Tape: base.hanRoute.bodyWitnessPositionDeltaU32Tape,
		},
		blockId,
		count,
	);
}

export function getBodyBlockHanWitnessOccurrences(
	base: ResidentBase,
	blockId: number,
): BodyHanWitnessOccurrence[] {
	const stringIds = getBodyBlockHanWitnessStringIds(base, blockId);
	const starts = getBodyBlockHanWitnessStartOffsets(base, blockId);
	return stringIds.map((stringId, index) => ({
		stringId,
		start: starts[index] ?? 0,
	}));
}

export function getBodyBlockHanWitnessTexts(
	base: ResidentBase,
	blockId: number,
): string[] {
	return getBodyBlockHanWitnessStringIds(base, blockId).map((stringId) =>
		readResidentString(base, stringId),
	);
}

export function collectPostingDocIds(
	postingStarts: ResidentIntegerArray,
	docIds: ResidentIntegerArray,
	familyId: number,
): number[] {
	return sliceSentinelBucket(postingStarts, docIds, familyId);
}

export function collectPostingDocIdsForShardLocalFamilySlot(
	base: ResidentBase,
	postingStarts: ResidentIntegerArray,
	docIds: ResidentIntegerArray,
	shardLocalFamilySlot: number,
): number[] {
	return collectPostingDocIds(
		postingStarts,
		docIds,
		getFamilyIdForShardLocalFamilySlot(base, shardLocalFamilySlot),
	);
}

export function collectHanMetadataDocIds(
	base: ResidentBase,
	bigramId: number,
): number[] {
	return collectHanPostingDocIds(
		base.hanRoute.metadataPostingStarts,
		base.hanRoute.metadataDocIds,
		base,
		bigramId,
	);
}

export function collectHanBodyBlockIds(
	base: ResidentBase,
	bigramId: number,
): number[] {
	return decodeBodyHanPosting(base.hanRoute, bigramId);
}

export function collectHanMetadataDocIdsByChar(
	base: ResidentBase,
	charId: number,
): number[] {
	const charIndex = lookupHanCharIndex(base.hanRoute, charId);
	if (charIndex === -1) {
		return [];
	}
	return sliceResidentIntegerArray(
		base.hanRoute.metadataCharDocIds,
		getSentinelSliceStart(base.hanRoute.metadataCharPostingStarts, charIndex),
		getSentinelSliceEnd(base.hanRoute.metadataCharPostingStarts, charIndex),
	);
}

export function collectHanBodyBlockIdsByChar(
	base: ResidentBase,
	charId: number,
): number[] {
	return decodeBodyHanCharPosting(base.hanRoute, charId);
}

export function confirmHanBodyBlockSurface(
	base: ResidentBase,
	blockId: number,
	surfaceText: string,
): boolean {
	return getBodyBlockHanWitnessTexts(base, blockId).some((text) =>
		text.includes(surfaceText),
	);
}

function collectHanPostingDocIds(
	postingStarts: ResidentIntegerArray,
	docIds: ResidentIntegerArray,
	base: ResidentBase,
	bigramId: number,
): number[] {
	const bigramIndex = lookupHanBigramIndex(base.hanRoute, bigramId);
	if (bigramIndex === -1) {
		return [];
	}
	return sliceResidentIntegerArray(
		docIds,
		getSentinelSliceStart(postingStarts, bigramIndex),
		getSentinelSliceEnd(postingStarts, bigramIndex),
	);
}
