import type {
	CoverageLexicalBodyTokenColdBlockRow,
	CoverageLexicalBodyTokenColdDocRow,
	CoverageLexicalBodyTokenColdDocumentWrite,
} from "./coverage-lexical-body-token-cold-types";

export const COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK = 32;
export const COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_TOKENS_PER_BLOCK = 4096;

type CoverageLexicalBodyTokenColdDecodedDocument = {
	path: string;
	generation?: number;
	bodyTokens: string[];
	hanSegments: string[];
};

export function packCoverageLexicalBodyTokenColdDocuments(
	epoch: number,
	documents: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
	now: number,
	nextBlockId: () => string,
): {
	blockRows: CoverageLexicalBodyTokenColdBlockRow[];
	docRows: CoverageLexicalBodyTokenColdDocRow[];
} {
	const normalizedDocuments = [...documents].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const blockRows: CoverageLexicalBodyTokenColdBlockRow[] = [];
	const docRows: CoverageLexicalBodyTokenColdDocRow[] = [];
	let pendingDocs: CoverageLexicalBodyTokenColdDocumentWrite[] = [];
	let pendingTokenCount = 0;

	const flushPending = () => {
		if (pendingDocs.length === 0) {
			return;
		}
		const nextPacked = buildCoverageLexicalBodyTokenColdBlock(
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
		const nextDocTokenCount = document.bodyTokens.length;
		const wouldOverflowDocCount =
			pendingDocs.length >= COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK;
		const wouldOverflowTokenCount =
			pendingDocs.length > 0 &&
			pendingTokenCount + nextDocTokenCount >
				COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_TOKENS_PER_BLOCK;
		if (wouldOverflowDocCount || wouldOverflowTokenCount) {
			flushPending();
		}
		pendingDocs.push(document);
		pendingTokenCount += nextDocTokenCount;
	}
	flushPending();

	return { blockRows, docRows };
}

export function decodeCoverageLexicalBodyTokenColdDocument(
	blockRow: CoverageLexicalBodyTokenColdBlockRow,
	docRow: CoverageLexicalBodyTokenColdDocRow,
): CoverageLexicalBodyTokenColdDecodedDocument {
	const tokenIds = blockRow.tokenIds.subarray(
		docRow.tokenStart,
		docRow.tokenStart + docRow.tokenLength,
	);
	return {
		path: docRow.path,
		generation: docRow.generation,
		bodyTokens: Array.from(tokenIds, (tokenId) => blockRow.dictionaryTerms[tokenId]),
		hanSegments: [...docRow.hanSegments],
	};
}

function buildCoverageLexicalBodyTokenColdBlock(
	epoch: number,
	documents: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
	now: number,
	blockId: string,
): {
	blockRow: CoverageLexicalBodyTokenColdBlockRow;
	docRows: CoverageLexicalBodyTokenColdDocRow[];
} {
	const dictionaryTerms: string[] = [];
	const termIdByToken = new Map<string, number>();
	const tokenIds: number[] = [];
	const docRows: CoverageLexicalBodyTokenColdDocRow[] = [];

	documents.forEach((document, blockDocIndex) => {
		const tokenStart = tokenIds.length;
		for (const token of document.bodyTokens) {
			let tokenId = termIdByToken.get(token);
			if (tokenId === undefined) {
				tokenId = dictionaryTerms.length;
				dictionaryTerms.push(token);
				termIdByToken.set(token, tokenId);
			}
			tokenIds.push(tokenId);
		}
		docRows.push({
			path: document.path,
			epoch,
			generation: document.generation,
			blockId,
			blockDocIndex,
			tokenStart,
			tokenLength: document.bodyTokens.length,
			tokenCount: document.bodyTokens.length,
			hanSegments: [...document.hanSegments],
			updatedAt: now,
		});
	});

	return {
		blockRow: {
			id: blockId,
			epoch,
			documentCount: documents.length,
			tokenCount: tokenIds.length,
			dictionaryTerms,
			tokenIds: Uint32Array.from(tokenIds),
			createdAt: now,
			updatedAt: now,
		},
		docRows,
	};
}
