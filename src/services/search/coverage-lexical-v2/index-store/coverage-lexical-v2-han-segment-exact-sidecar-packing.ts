import type {
	CoverageLexicalV2HanSegmentExactSidecarDocSummaryRow,
	CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
	CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead,
	CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow,
	CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-types";
import {
	encodeCoverageLexicalV2NumericTokenTape,
	readCoverageLexicalV2NumericTokenRange,
} from "./coverage-lexical-v2-shared-token-ids";

export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_LOGICAL_BLOCKS_PER_STORAGE_BLOCK = 32;
export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_SYMBOLS_PER_STORAGE_BLOCK = 4096;

type PendingLogicalBlock = {
	id: string;
	path: string;
	generation?: number;
	blockOrdinal: number;
	bodyHanSymbolIds: readonly number[] | Uint32Array;
	symbolCount: number;
	segmentCount: number;
	encodedByteLength: number;
};

export function packCoverageLexicalV2HanSegmentExactSidecarDocuments(
	epoch: number,
	documents: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
	now: number,
	nextStorageBlockId: () => string,
	nextLogicalBlockId: () => string,
): {
	storageBlockRows: CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow[];
	logicalBlockRows: CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow[];
	docSummaryRows: CoverageLexicalV2HanSegmentExactSidecarDocSummaryRow[];
} {
	const normalizedDocuments = [...documents].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const pendingLogicalBlocks: PendingLogicalBlock[] = [];
	const docSummaryRows: CoverageLexicalV2HanSegmentExactSidecarDocSummaryRow[] = [];

	for (const document of normalizedDocuments) {
		let symbolCount = 0;
		let segmentCount = 0;
		for (const logicalBlock of document.logicalBlocks) {
			pendingLogicalBlocks.push({
				id: nextLogicalBlockId(),
				path: document.path,
				generation: document.generation,
				blockOrdinal: logicalBlock.blockOrdinal,
				bodyHanSymbolIds: logicalBlock.bodyHanSymbolIds,
				symbolCount: logicalBlock.symbolCount,
				segmentCount: logicalBlock.segmentCount,
				encodedByteLength: logicalBlock.encodedByteLength,
			});
			symbolCount += logicalBlock.symbolCount;
			segmentCount += logicalBlock.segmentCount;
		}
		docSummaryRows.push({
			path: document.path,
			epoch,
			generation: document.generation,
			blockCount: document.logicalBlocks.length,
			symbolCount,
			segmentCount,
			updatedAt: now,
		});
	}

	const storageBlockRows: CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow[] = [];
	const logicalBlockRows: CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow[] = [];
	let pendingStorageLogicalBlocks: PendingLogicalBlock[] = [];
	let pendingStorageSymbolCount = 0;

	const flushPending = () => {
		if (pendingStorageLogicalBlocks.length === 0) {
			return;
		}
		const packed = buildCoverageLexicalV2HanSegmentExactSidecarStorageBlock(
			epoch,
			pendingStorageLogicalBlocks,
			now,
			nextStorageBlockId(),
		);
		storageBlockRows.push(packed.storageBlockRow);
		logicalBlockRows.push(...packed.logicalBlockRows);
		pendingStorageLogicalBlocks = [];
		pendingStorageSymbolCount = 0;
	};

	for (const logicalBlock of pendingLogicalBlocks) {
		const wouldOverflowLogicalBlockCount =
			pendingStorageLogicalBlocks.length >=
			COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_LOGICAL_BLOCKS_PER_STORAGE_BLOCK;
		const wouldOverflowSymbolCount =
			pendingStorageLogicalBlocks.length > 0 &&
			pendingStorageSymbolCount + logicalBlock.symbolCount >
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_SYMBOLS_PER_STORAGE_BLOCK;
		if (wouldOverflowLogicalBlockCount || wouldOverflowSymbolCount) {
			flushPending();
		}
		pendingStorageLogicalBlocks.push(logicalBlock);
		pendingStorageSymbolCount += logicalBlock.symbolCount;
	}
	flushPending();

	return {
		storageBlockRows,
		logicalBlockRows,
		docSummaryRows,
	};
}

export function decodeCoverageLexicalV2HanSegmentExactSidecarLogicalBlock(
	storageBlockRow: CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow,
	logicalBlockRow: CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow,
): CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead {
	const decoded =
		readCoverageLexicalV2NumericTokenRange(storageBlockRow.symbolIdTape, {
			start: logicalBlockRow.symbolStart,
			end: logicalBlockRow.symbolStart + logicalBlockRow.symbolLength,
		}) ?? [];
	return {
		path: logicalBlockRow.path,
		generation: logicalBlockRow.generation,
		blockOrdinal: logicalBlockRow.blockOrdinal,
		bodyHanSymbolIds: Uint32Array.from(decoded),
		symbolCount: logicalBlockRow.symbolCount,
		segmentCount: logicalBlockRow.segmentCount,
		encodedByteLength: logicalBlockRow.encodedByteLength,
	};
}

function buildCoverageLexicalV2HanSegmentExactSidecarStorageBlock(
	epoch: number,
	logicalBlocks: readonly PendingLogicalBlock[],
	now: number,
	storageBlockId: string,
): {
	storageBlockRow: CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow;
	logicalBlockRows: CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow[];
} {
	const symbolIdTape: number[] = [];
	const logicalBlockRows: CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow[] = [];
	let storageSegmentCount = 0;

	for (const logicalBlock of logicalBlocks) {
		const encodedSymbolIds = encodeCoverageLexicalV2NumericTokenTape(
			Array.from(logicalBlock.bodyHanSymbolIds),
		);
		const symbolStart = symbolIdTape.length;
		for (const byte of encodedSymbolIds) {
			symbolIdTape.push(byte);
		}
		storageSegmentCount += logicalBlock.segmentCount;
		logicalBlockRows.push({
			id: logicalBlock.id,
			path: logicalBlock.path,
			epoch,
			generation: logicalBlock.generation,
			storageBlockId,
			blockOrdinal: logicalBlock.blockOrdinal,
			symbolStart,
			symbolLength: encodedSymbolIds.length,
			symbolCount: logicalBlock.symbolCount,
			segmentCount: logicalBlock.segmentCount,
			encodedByteLength: logicalBlock.encodedByteLength,
			updatedAt: now,
		});
	}

	return {
		storageBlockRow: {
			id: storageBlockId,
			epoch,
			logicalBlockCount: logicalBlocks.length,
			symbolCount: logicalBlocks.reduce(
				(sum, logicalBlock) => sum + logicalBlock.symbolCount,
				0,
			),
			segmentCount: storageSegmentCount,
			symbolIdTape: Uint8Array.from(symbolIdTape),
			createdAt: now,
			updatedAt: now,
		},
		logicalBlockRows,
	};
}
