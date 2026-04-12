import type {
	CoverageLexicalV2BodyTokenColdBlockRow,
	CoverageLexicalV2BodyTokenColdDocRow,
	CoverageLexicalV2BodyTokenColdDocumentWrite,
} from "./coverage-lexical-v2-body-token-cold-types";

export const COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK = 32;
export const COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_MAX_TOKENS_PER_BLOCK = 4096;

type CoverageLexicalV2BodyTokenColdDecodedDocument = {
	path: string;
	generation?: number;
	bodyTokenIds: Uint32Array;
};

export function packCoverageLexicalV2BodyTokenColdDocuments(
	epoch: number,
	documents: readonly CoverageLexicalV2BodyTokenColdDocumentWrite[],
	now: number,
	nextBlockId: () => string,
): {
	blockRows: CoverageLexicalV2BodyTokenColdBlockRow[];
	docRows: CoverageLexicalV2BodyTokenColdDocRow[];
} {
	const normalizedDocuments = [...documents].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const blockRows: CoverageLexicalV2BodyTokenColdBlockRow[] = [];
	const docRows: CoverageLexicalV2BodyTokenColdDocRow[] = [];
	let pendingDocs: CoverageLexicalV2BodyTokenColdDocumentWrite[] = [];
	let pendingTokenCount = 0;

	const flushPending = () => {
		if (pendingDocs.length === 0) {
			return;
		}
		const nextPacked = buildCoverageLexicalV2BodyTokenColdBlock(
			epoch,
			pendingDocs,
			now,
			nextBlockId(),
		);
		blockRows.push(nextPacked.blockRow);
		docRows.push(...nextPacked.docRows);
		pendingDocs = [];
		pendingTokenCount = 0;
	};

	for (const document of normalizedDocuments) {
		const nextDocTokenCount = document.bodyTokenIds.length;
		const wouldOverflowDocCount =
			pendingDocs.length >= COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK;
		const wouldOverflowTokenCount =
			pendingDocs.length > 0 &&
			pendingTokenCount + nextDocTokenCount >
				COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_MAX_TOKENS_PER_BLOCK;
		if (wouldOverflowDocCount || wouldOverflowTokenCount) {
			flushPending();
		}
		pendingDocs.push(document);
		pendingTokenCount += nextDocTokenCount;
	}
	flushPending();

	return { blockRows, docRows };
}

export function decodeCoverageLexicalV2BodyTokenColdDocument(
	blockRow: CoverageLexicalV2BodyTokenColdBlockRow,
	docRow: CoverageLexicalV2BodyTokenColdDocRow,
): CoverageLexicalV2BodyTokenColdDecodedDocument {
	return {
		path: docRow.path,
		generation: docRow.generation,
		bodyTokenIds: blockRow.termIdTape.slice(
			docRow.tokenStart,
			docRow.tokenStart + docRow.tokenLength,
		),
	};
}

function buildCoverageLexicalV2BodyTokenColdBlock(
	epoch: number,
	documents: readonly CoverageLexicalV2BodyTokenColdDocumentWrite[],
	now: number,
	blockId: string,
): {
	blockRow: CoverageLexicalV2BodyTokenColdBlockRow;
	docRows: CoverageLexicalV2BodyTokenColdDocRow[];
} {
	const termIdTape: number[] = [];
	const docRows: CoverageLexicalV2BodyTokenColdDocRow[] = [];

	documents.forEach((document, blockDocIndex) => {
		const tokenStart = termIdTape.length;
		for (const tokenId of document.bodyTokenIds) {
			termIdTape.push(tokenId);
		}
		docRows.push({
			path: document.path,
			epoch,
			generation: document.generation,
			blockId,
			blockDocIndex,
			tokenStart,
			tokenLength: document.bodyTokenIds.length,
			tokenCount: document.bodyTokenIds.length,
			updatedAt: now,
		});
	});

	return {
		blockRow: {
			id: blockId,
			epoch,
			documentCount: documents.length,
			tokenCount: termIdTape.length,
			termIdTape: Uint32Array.from(termIdTape),
			createdAt: now,
			updatedAt: now,
		},
		docRows,
	};
}
