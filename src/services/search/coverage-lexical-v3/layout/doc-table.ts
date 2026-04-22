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
		docRefsByLiveDocSlot: Float64Array.from(rows.map((row) => row.docRef)),
		liveDocSlotByDocId: buildIntegerArray(liveDocSlots),
		docIdByLiveDocSlot: buildIntegerArray(liveDocSlots),
		pathStringIds: buildIntegerArray(rows.map((row) => row.pathStringId)),
		pathStringIdsByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.pathStringId),
		),
		generationByDocId: Float64Array.from(rows.map((row) => row.generation)),
		generationByLiveDocSlot: Float64Array.from(rows.map((row) => row.generation)),
		identityStartByDocId: buildIntegerArray(rows.map((row) => row.identityStart)),
		identityCountByDocId: buildIntegerArray(rows.map((row) => row.identityCount)),
		identityStartByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.identityStart),
		),
		identityCountByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.identityCount),
		),
		routeStartByDocId: buildIntegerArray(rows.map((row) => row.routeStart)),
		routeCountByDocId: buildIntegerArray(rows.map((row) => row.routeCount)),
		routeStartByLiveDocSlot: buildIntegerArray(rows.map((row) => row.routeStart)),
		routeCountByLiveDocSlot: buildIntegerArray(rows.map((row) => row.routeCount)),
		headingStartByDocId: buildIntegerArray(rows.map((row) => row.headingStart)),
		headingCountByDocId: buildIntegerArray(rows.map((row) => row.headingCount)),
		headingStartByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.headingStart),
		),
		headingCountByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.headingCount),
		),
		bodyBlockStartByDocId: buildIntegerArray(rows.map((row) => row.bodyBlockStart)),
		bodyBlockCountByDocId: buildIntegerArray(rows.map((row) => row.bodyBlockCount)),
		bodyBlockStartByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.bodyBlockStart),
		),
		bodyBlockCountByLiveDocSlot: buildIntegerArray(
			rows.map((row) => row.bodyBlockCount),
		),
	};
}

export function estimateDocTableBytes(docTable: ResidentDocTable): number {
	return (
		docTable.docRefsByDocId.byteLength +
		docTable.docRefsByLiveDocSlot.byteLength +
		docTable.liveDocSlotByDocId.byteLength +
		docTable.docIdByLiveDocSlot.byteLength +
		docTable.pathStringIds.byteLength +
		docTable.pathStringIdsByLiveDocSlot.byteLength +
		docTable.generationByDocId.byteLength +
		docTable.generationByLiveDocSlot.byteLength +
		docTable.identityStartByDocId.byteLength +
		docTable.identityCountByDocId.byteLength +
		docTable.identityStartByLiveDocSlot.byteLength +
		docTable.identityCountByLiveDocSlot.byteLength +
		docTable.routeStartByDocId.byteLength +
		docTable.routeCountByDocId.byteLength +
		docTable.routeStartByLiveDocSlot.byteLength +
		docTable.routeCountByLiveDocSlot.byteLength +
		docTable.headingStartByDocId.byteLength +
		docTable.headingCountByDocId.byteLength +
		docTable.headingStartByLiveDocSlot.byteLength +
		docTable.headingCountByLiveDocSlot.byteLength +
		docTable.bodyBlockStartByDocId.byteLength +
		docTable.bodyBlockCountByDocId.byteLength +
		docTable.bodyBlockStartByLiveDocSlot.byteLength +
		docTable.bodyBlockCountByLiveDocSlot.byteLength
	);
}
