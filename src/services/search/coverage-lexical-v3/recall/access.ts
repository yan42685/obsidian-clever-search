import type { ResidentIntegerArray } from "../layout/integer-arrays";
import {
	getSentinelSliceEnd,
	getSentinelSliceStart,
	sliceResidentIntegerArray,
	sliceSentinelBucket,
} from "../layout/integer-arrays";
import { decodeBlockPositionLane } from "../layout/position-lanes";
import { collectBodyFamilyPostingBlockIdsForFamily } from "../layout/body-family-posting";
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

export function getDocPath(base: ResidentBase, docId: number): string {
	return readResidentString(base, base.docTable.pathStringIds[docId] ?? 0);
}

export function getDocStableKey(base: ResidentBase, docId: number): string {
	return getDocPath(base, docId);
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

export function getDocBodyBlockIds(
	base: ResidentBase,
	docId: number,
): number[] {
	const start = base.docTable.bodyBlockStartByDocId[docId] ?? 0;
	const count = base.docTable.bodyBlockCountByDocId[docId] ?? 0;
	return Array.from({ length: count }, (_, index) => start + index);
}

export function collectBodyFamilyPostingBlockIds(
	base: ResidentBase,
	familyId: number,
): number[] {
	return collectBodyFamilyPostingBlockIdsForFamily(
		base.bodyFamilyPosting,
		familyId,
	);
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
		base.bodyBlocks.familySupportFamilyIds,
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
		base.hanRoute.identityWitnessStringIds,
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

export function getDocIdentityHanWitnessTexts(
	base: ResidentBase,
	docId: number,
): string[] {
	return getDocIdentityHanWitnessStringIds(base, docId).map((stringId) =>
		readResidentString(base, stringId),
	);
}

export function getDocRouteHanWitnessStringIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.routeWitnessStartByDocId,
		base.hanRoute.routeWitnessStringIds,
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

export function getDocRouteHanWitnessTexts(
	base: ResidentBase,
	docId: number,
): string[] {
	return getDocRouteHanWitnessStringIds(base, docId).map((stringId) =>
		readResidentString(base, stringId),
	);
}

export function getDocHeadingHanWitnessStringIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.headingWitnessStartByDocId,
		base.hanRoute.headingWitnessStringIds,
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

export function getBodyBlockHanWitnessStringIds(
	base: ResidentBase,
	blockId: number,
): number[] {
	return sliceSentinelBucket(
		base.hanRoute.bodyWitnessOccurrenceStartByBlockId,
		base.hanRoute.bodyWitnessOccurrenceStringIds,
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
