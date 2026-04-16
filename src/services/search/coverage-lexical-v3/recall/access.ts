import type { ResidentIntegerArray } from "../layout/integer-arrays";
import {
	getSentinelSliceEnd,
	getSentinelSliceStart,
	sliceResidentIntegerArray,
	sliceSentinelBucket,
} from "../layout/integer-arrays";
import { collectBodySummaryBlockIdsForFamily } from "../layout/body-summary-postings";
import type { ResidentBase } from "../layout/types";
import { decodeBodyHanPosting, lookupHanBigramIndex } from "../layout/han-route";

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

export function collectBodySummaryBlockIds(
	base: ResidentBase,
	familyId: number,
): number[] {
	return collectBodySummaryBlockIdsForFamily(base.bodySummary, familyId);
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
	return Array.from({ length: count }, (_, index) => index);
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
		base.hanRoute.bodyWitnessStartByBlockId,
		base.hanRoute.bodyWitnessStringIds,
		blockId,
	);
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
