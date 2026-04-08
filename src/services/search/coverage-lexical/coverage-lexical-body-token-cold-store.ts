import { Database } from "src/services/database/database";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID,
	type CoverageLexicalBodyTokenColdStoreApi,
	type CoverageLexicalBodyTokenColdBlockRow,
	type CoverageLexicalBodyTokenColdDocRow,
	type CoverageLexicalBodyTokenColdDocumentWrite,
	type CoverageLexicalBodyTokenColdMetaRow,
} from "./coverage-lexical-body-token-cold-types";

const COVERAGE_LEXICAL_BODY_TOKEN_COLD_SCHEMA_VERSION = 1;

@singleton()
export class CoverageLexicalBodyTokenColdStore
	implements CoverageLexicalBodyTokenColdStoreApi
{
	private readonly database = getInstance(Database);
	private nextBlockCounter = 0;

	async clearAll(): Promise<void> {
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalBodyTokenColdMeta,
			this.database.db.lexicalBodyTokenColdBlocks,
			this.database.db.lexicalBodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalBodyTokenColdMeta.clear();
				await this.database.db.lexicalBodyTokenColdBlocks.clear();
				await this.database.db.lexicalBodyTokenColdDocs.clear();
			},
		);
	}

	async deleteDocuments(paths: readonly string[]): Promise<void> {
		const uniquePaths = Array.from(new Set(paths));
		if (uniquePaths.length === 0) {
			return;
		}
		const existingRows =
			await this.database.db.lexicalBodyTokenColdDocs.bulkGet(uniquePaths);
		const staleBlockIds = existingRows.flatMap((row) =>
			row ? [row.blockId] : [],
		);
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalBodyTokenColdBlocks,
			this.database.db.lexicalBodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalBodyTokenColdDocs.bulkDelete(uniquePaths);
				if (staleBlockIds.length > 0) {
					await this.database.db.lexicalBodyTokenColdBlocks.bulkDelete(
						Array.from(new Set(staleBlockIds)),
					);
				}
			},
		);
	}

	async upsertDocuments(
		documents: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
	): Promise<void> {
		const normalizedDocuments = Array.from(
			new Map(documents.map((document) => [document.path, document])).values(),
		);
		if (normalizedDocuments.length === 0) {
			return;
		}
		const meta = await this.ensureMeta();
		const now = Date.now();
		const nextBlocks: CoverageLexicalBodyTokenColdBlockRow[] = [];
		const nextDocRows: CoverageLexicalBodyTokenColdDocRow[] = [];
		for (const document of normalizedDocuments) {
			const nextBlock = this.buildSingleDocumentBlock(
				meta.epoch,
				document,
				now,
			);
			nextBlocks.push(nextBlock.blockRow);
			nextDocRows.push(nextBlock.docRow);
		}
		const existingRows = await this.database.db.lexicalBodyTokenColdDocs.bulkGet(
			normalizedDocuments.map((document) => document.path),
		);
		const staleBlockIds = existingRows.flatMap((row) =>
			row ? [row.blockId] : [],
		);
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalBodyTokenColdMeta,
			this.database.db.lexicalBodyTokenColdBlocks,
			this.database.db.lexicalBodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalBodyTokenColdMeta.put({
					...meta,
					updatedAt: now,
				});
				await this.database.db.lexicalBodyTokenColdBlocks.bulkPut(nextBlocks);
				await this.database.db.lexicalBodyTokenColdDocs.bulkPut(nextDocRows);
				if (staleBlockIds.length > 0) {
					await this.database.db.lexicalBodyTokenColdBlocks.bulkDelete(
						Array.from(new Set(staleBlockIds)),
					);
				}
			},
		);
	}

	private async ensureMeta(): Promise<CoverageLexicalBodyTokenColdMetaRow> {
		const existing = await this.database.db.lexicalBodyTokenColdMeta.get(
			COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID,
		);
		if (existing) {
			return existing;
		}
		const created: CoverageLexicalBodyTokenColdMetaRow = {
			id: COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID,
			epoch: 1,
			schemaVersion: COVERAGE_LEXICAL_BODY_TOKEN_COLD_SCHEMA_VERSION,
			blockWriteMode: "single-doc",
			updatedAt: Date.now(),
		};
		await this.database.db.lexicalBodyTokenColdMeta.put(created);
		return created;
	}

	private buildSingleDocumentBlock(
		epoch: number,
		document: CoverageLexicalBodyTokenColdDocumentWrite,
		now: number,
	): {
		blockRow: CoverageLexicalBodyTokenColdBlockRow;
		docRow: CoverageLexicalBodyTokenColdDocRow;
	} {
		const dictionaryTerms: string[] = [];
		const termIdByToken = new Map<string, number>();
		const localTokenIds = document.bodyTokens.map((token) => {
			const existing = termIdByToken.get(token);
			if (existing !== undefined) {
				return existing;
			}
			const nextId = dictionaryTerms.length;
			dictionaryTerms.push(token);
			termIdByToken.set(token, nextId);
			return nextId;
		});
		const blockId = `lexical-body-cold:${epoch}:${now}:${this.nextBlockCounter}`;
		this.nextBlockCounter += 1;
		return {
			blockRow: {
				id: blockId,
				epoch,
				documentCount: 1,
				tokenCount: localTokenIds.length,
				dictionaryTerms,
				tokenIds: Uint32Array.from(localTokenIds),
				createdAt: now,
				updatedAt: now,
			},
			docRow: {
				path: document.path,
				epoch,
				generation: document.generation,
				blockId,
				blockDocIndex: 0,
				tokenStart: 0,
				tokenLength: localTokenIds.length,
				tokenCount: localTokenIds.length,
				hanSegments: [...document.hanSegments],
				updatedAt: now,
			},
		};
	}
}
