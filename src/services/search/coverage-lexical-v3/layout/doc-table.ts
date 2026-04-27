import { buildIntegerArray } from "./integer-arrays";
import type { ResidentDocTable } from "./types";

type DocRowBuildInput = Readonly<{
	docRef: number;
	pathStringId: number;
	generation: number;
	identityStart: number;
	identityCount: number;
	routeStart: number;
	routeCount: number;
	headingStart: number;
	headingCount: number;
	bodyBlockStart: number;
	bodyBlockCount: number;
}>;

export function buildDocTable(rows: readonly DocRowBuildInput[]): ResidentDocTable {
	const liveDocSlots = rows.map((_, docId) => docId);
	return {
		docCount: rows.length,
		liveDocCount: rows.length,
		docRefsByDocId: Float64Array.from(rows.map((row) => row.docRef)),
		liveDocSlotByDocId: buildIntegerArray(liveDocSlots),
		docIdByLiveDocSlot: buildIntegerArray(liveDocSlots),
		pathStringIds: buildIntegerArray(rows.map((row) => row.pathStringId)),
		generationByDocId: Float64Array.from(rows.map((row) => row.generation)),
		identityStartByDocId: buildIntegerArray(rows.map((row) => row.identityStart)),
		identityCountByDocId: buildIntegerArray(rows.map((row) => row.identityCount)),
		routeStartByDocId: buildIntegerArray(rows.map((row) => row.routeStart)),
		routeCountByDocId: buildIntegerArray(rows.map((row) => row.routeCount)),
		headingStartByDocId: buildIntegerArray(rows.map((row) => row.headingStart)),
		headingCountByDocId: buildIntegerArray(rows.map((row) => row.headingCount)),
		bodyBlockStartByDocId: buildIntegerArray(rows.map((row) => row.bodyBlockStart)),
		bodyBlockCountByDocId: buildIntegerArray(rows.map((row) => row.bodyBlockCount)),
	};
}

export function estimateDocTableBytes(docTable: ResidentDocTable): number {
	return (
		docTable.docRefsByDocId.byteLength +
		docTable.liveDocSlotByDocId.byteLength +
		docTable.docIdByLiveDocSlot.byteLength +
		docTable.pathStringIds.byteLength +
		docTable.generationByDocId.byteLength +
		docTable.identityStartByDocId.byteLength +
		docTable.identityCountByDocId.byteLength +
		docTable.routeStartByDocId.byteLength +
		docTable.routeCountByDocId.byteLength +
		docTable.headingStartByDocId.byteLength +
		docTable.headingCountByDocId.byteLength +
		docTable.bodyBlockStartByDocId.byteLength +
		docTable.bodyBlockCountByDocId.byteLength
	);
}
