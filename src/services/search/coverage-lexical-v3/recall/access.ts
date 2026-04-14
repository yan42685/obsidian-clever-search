import type { ResidentBase } from "../layout/types";
import { lookupHanBigramIndex } from "../layout/han-route";

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
	return readResidentString(base, base.docTable.stableKeyStringIds[docId] ?? 0);
}

export function getDocIdentityFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceUint32Array(
		base.metadataContainers.identityFamiliesByDoc,
		base.docTable.identityStartByDocId[docId] ?? 0,
		base.docTable.identityCountByDocId[docId] ?? 0,
	);
}

export function getDocRouteFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceUint32Array(
		base.metadataContainers.routeFamiliesByDoc,
		base.docTable.routeStartByDocId[docId] ?? 0,
		base.docTable.routeCountByDocId[docId] ?? 0,
	);
}

export function getDocHeadingFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceUint32Array(
		base.metadataContainers.headingFamiliesByDoc,
		base.docTable.headingStartByDocId[docId] ?? 0,
		base.docTable.headingCountByDocId[docId] ?? 0,
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
	return sliceUint32Array(
		base.bodySummary.postings.blockIds,
		base.bodySummary.postings.postingStarts[familyId] ?? 0,
		base.bodySummary.postings.postingCounts[familyId] ?? 0,
	);
}

export function getBodyBlockExactFamilyIds(
	base: ResidentBase,
	blockId: number,
): number[] {
	return sliceUint32Array(
		base.exactTapes.familyIds,
		base.bodyBlocks.exactTapeStartByBlockId[blockId] ?? 0,
		base.bodyBlocks.exactTapeCountByBlockId[blockId] ?? 0,
	);
}

export function getBodyBlockExactTokenPositions(
	base: ResidentBase,
	blockId: number,
): number[] {
	return sliceUint32Array(
		base.exactTapes.tokenPositions,
		base.bodyBlocks.exactTapeStartByBlockId[blockId] ?? 0,
		base.bodyBlocks.exactTapeCountByBlockId[blockId] ?? 0,
	);
}

export function getDocIdentityHanWitnessFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceUint32Array(
		base.hanRoute.identityWitnessFamilyIds,
		base.hanRoute.identityWitnessStartByDocId[docId] ?? 0,
		base.hanRoute.identityWitnessCountByDocId[docId] ?? 0,
	);
}

export function getDocRouteHanWitnessFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceUint32Array(
		base.hanRoute.routeWitnessFamilyIds,
		base.hanRoute.routeWitnessStartByDocId[docId] ?? 0,
		base.hanRoute.routeWitnessCountByDocId[docId] ?? 0,
	);
}

export function getDocHeadingHanWitnessFamilyIds(
	base: ResidentBase,
	docId: number,
): number[] {
	return sliceUint32Array(
		base.hanRoute.headingWitnessFamilyIds,
		base.hanRoute.headingWitnessStartByDocId[docId] ?? 0,
		base.hanRoute.headingWitnessCountByDocId[docId] ?? 0,
	);
}

export function getBodyBlockHanWitnessFamilyIds(
	base: ResidentBase,
	blockId: number,
): number[] {
	return sliceUint32Array(
		base.hanRoute.bodyWitnessFamilyIds,
		base.hanRoute.bodyWitnessStartByBlockId[blockId] ?? 0,
		base.hanRoute.bodyWitnessCountByBlockId[blockId] ?? 0,
	);
}

export function collectPostingDocIds(
	postingStarts: Uint32Array,
	postingCounts: Uint32Array,
	docIds: Uint32Array,
	familyId: number,
): number[] {
	return sliceUint32Array(
		docIds,
		postingStarts[familyId] ?? 0,
		postingCounts[familyId] ?? 0,
	);
}

export function collectHanMetadataIdentityDocIds(
	base: ResidentBase,
	bigramId: number,
): number[] {
	return collectHanPostingDocIds(
		base.hanRoute.metadataIdentityPostingStarts,
		base.hanRoute.metadataIdentityPostingCounts,
		base.hanRoute.metadataIdentityDocIds,
		base,
		bigramId,
	);
}

export function collectHanMetadataRouteDocIds(
	base: ResidentBase,
	bigramId: number,
): number[] {
	return collectHanPostingDocIds(
		base.hanRoute.metadataRoutePostingStarts,
		base.hanRoute.metadataRoutePostingCounts,
		base.hanRoute.metadataRouteDocIds,
		base,
		bigramId,
	);
}

export function collectHanMetadataHeadingDocIds(
	base: ResidentBase,
	bigramId: number,
): number[] {
	return collectHanPostingDocIds(
		base.hanRoute.metadataHeadingPostingStarts,
		base.hanRoute.metadataHeadingPostingCounts,
		base.hanRoute.metadataHeadingDocIds,
		base,
		bigramId,
	);
}

export function collectHanBodyBlockIds(
	base: ResidentBase,
	bigramId: number,
): number[] {
	const bigramIndex = lookupHanBigramIndex(base.hanRoute, bigramId);
	if (bigramIndex === -1) {
		return [];
	}
	return sliceUint32Array(
		base.hanRoute.bodyBlockIds,
		base.hanRoute.bodyBlockPostingStarts[bigramIndex] ?? 0,
		base.hanRoute.bodyBlockPostingCounts[bigramIndex] ?? 0,
	);
}

function sliceUint32Array(values: Uint32Array, start: number, count: number): number[] {
	if (count <= 0) {
		return [];
	}
	return Array.from(values.slice(start, start + count));
}

function collectHanPostingDocIds(
	postingStarts: Uint32Array,
	postingCounts: Uint32Array,
	docIds: Uint32Array,
	base: ResidentBase,
	bigramId: number,
): number[] {
	const bigramIndex = lookupHanBigramIndex(base.hanRoute, bigramId);
	if (bigramIndex === -1) {
		return [];
	}
	return sliceUint32Array(
		docIds,
		postingStarts[bigramIndex] ?? 0,
		postingCounts[bigramIndex] ?? 0,
	);
}
