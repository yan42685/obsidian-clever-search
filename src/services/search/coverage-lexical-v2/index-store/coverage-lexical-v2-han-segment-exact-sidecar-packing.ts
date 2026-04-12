import type {
	CoverageLexicalV2HanSegmentExactSidecarBlockRow,
	CoverageLexicalV2HanSegmentExactSidecarDocRow,
	CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-types";
import {
	encodeCoverageLexicalV2NumericTokenTape,
	readCoverageLexicalV2NumericTokenRange,
} from "./coverage-lexical-v2-shared-token-ids";

export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_DOCS_PER_BLOCK = 32;
export const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_SYMBOLS_PER_BLOCK = 4096;

type CoverageLexicalV2HanSegmentExactSidecarDecodedDocument = {
	path: string;
	generation?: number;
	bodyHanSymbolIds: Uint32Array;
	segmentCount: number;
};

export function packCoverageLexicalV2HanSegmentExactSidecarDocuments(
	epoch: number,
	documents: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
	now: number,
	nextBlockId: () => string,
): {
	blockRows: CoverageLexicalV2HanSegmentExactSidecarBlockRow[];
	docRows: CoverageLexicalV2HanSegmentExactSidecarDocRow[];
} {
	const normalizedDocuments = [...documents].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const blockRows: CoverageLexicalV2HanSegmentExactSidecarBlockRow[] = [];
	const docRows: CoverageLexicalV2HanSegmentExactSidecarDocRow[] = [];
	let pendingDocs: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[] = [];
	let pendingSymbolCount = 0;

	const flushPending = () => {
		if (pendingDocs.length === 0) {
			return;
		}
		const nextPacked = buildCoverageLexicalV2HanSegmentExactSidecarBlock(
			epoch,
			pendingDocs,
			now,
			nextBlockId(),
		);
		blockRows.push(nextPacked.blockRow);
		docRows.push(...nextPacked.docRows);
		pendingDocs = [];
		pendingSymbolCount = 0;
	};

	for (const document of normalizedDocuments) {
		const nextDocSymbolCount = document.bodyHanSymbolIds.length;
		const wouldOverflowDocCount =
			pendingDocs.length >=
			COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_DOCS_PER_BLOCK;
		const wouldOverflowSymbolCount =
			pendingDocs.length > 0 &&
			pendingSymbolCount + nextDocSymbolCount >
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_MAX_SYMBOLS_PER_BLOCK;
		if (wouldOverflowDocCount || wouldOverflowSymbolCount) {
			flushPending();
		}
		pendingDocs.push(document);
		pendingSymbolCount += nextDocSymbolCount;
	}
	flushPending();

	return { blockRows, docRows };
}

export function decodeCoverageLexicalV2HanSegmentExactSidecarDocument(
	blockRow: CoverageLexicalV2HanSegmentExactSidecarBlockRow,
	docRow: CoverageLexicalV2HanSegmentExactSidecarDocRow,
): CoverageLexicalV2HanSegmentExactSidecarDecodedDocument {
	const decoded =
		readCoverageLexicalV2NumericTokenRange(blockRow.symbolIdTape, {
			start: docRow.symbolStart,
			end: docRow.symbolStart + docRow.symbolLength,
		}) ?? [];
	return {
		path: docRow.path,
		generation: docRow.generation,
		bodyHanSymbolIds: Uint32Array.from(decoded),
		segmentCount: docRow.segmentCount,
	};
}

function buildCoverageLexicalV2HanSegmentExactSidecarBlock(
	epoch: number,
	documents: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
	now: number,
	blockId: string,
): {
	blockRow: CoverageLexicalV2HanSegmentExactSidecarBlockRow;
	docRows: CoverageLexicalV2HanSegmentExactSidecarDocRow[];
} {
	const symbolIdTape: number[] = [];
	const docRows: CoverageLexicalV2HanSegmentExactSidecarDocRow[] = [];
	let blockSegmentCount = 0;

	documents.forEach((document, blockDocIndex) => {
		const encodedSymbolIds = encodeCoverageLexicalV2NumericTokenTape(
			Array.from(document.bodyHanSymbolIds),
		);
		const symbolStart = symbolIdTape.length;
		for (const byte of encodedSymbolIds) {
			symbolIdTape.push(byte);
		}
		blockSegmentCount += document.segmentCount;
		docRows.push({
			path: document.path,
			epoch,
			generation: document.generation,
			blockId,
			blockDocIndex,
			symbolStart,
			symbolLength: encodedSymbolIds.length,
			symbolCount: document.bodyHanSymbolIds.length,
			segmentCount: document.segmentCount,
			updatedAt: now,
		});
	});

	return {
		blockRow: {
			id: blockId,
			epoch,
			documentCount: documents.length,
			symbolCount: documents.reduce(
				(sum, document) => sum + document.bodyHanSymbolIds.length,
				0,
			),
			segmentCount: blockSegmentCount,
			symbolIdTape: Uint8Array.from(symbolIdTape),
			createdAt: now,
			updatedAt: now,
		},
		docRows,
	};
}
