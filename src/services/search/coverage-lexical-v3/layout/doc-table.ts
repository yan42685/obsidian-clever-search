import type { ResidentDocTable } from "./types";

type DocRowBuildInput = Readonly<{
	pathStringId: number;
	basenameStringId: number;
	folderStringId: number;
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
	return {
		docCount: rows.length,
		pathStringIds: Uint32Array.from(rows.map((row) => row.pathStringId)),
		basenameStringIds: Uint32Array.from(rows.map((row) => row.basenameStringId)),
		folderStringIds: Uint32Array.from(rows.map((row) => row.folderStringId)),
		generationByDocId: Uint32Array.from(rows.map((row) => row.generation)),
		identityStartByDocId: Uint32Array.from(rows.map((row) => row.identityStart)),
		identityCountByDocId: Uint32Array.from(rows.map((row) => row.identityCount)),
		routeStartByDocId: Uint32Array.from(rows.map((row) => row.routeStart)),
		routeCountByDocId: Uint32Array.from(rows.map((row) => row.routeCount)),
		headingStartByDocId: Uint32Array.from(rows.map((row) => row.headingStart)),
		headingCountByDocId: Uint32Array.from(rows.map((row) => row.headingCount)),
		bodyBlockStartByDocId: Uint32Array.from(rows.map((row) => row.bodyBlockStart)),
		bodyBlockCountByDocId: Uint32Array.from(rows.map((row) => row.bodyBlockCount)),
	};
}

export function estimateDocTableBytes(docTable: ResidentDocTable): number {
	return (
		docTable.pathStringIds.byteLength +
		docTable.basenameStringIds.byteLength +
		docTable.folderStringIds.byteLength +
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
