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
import {
	decodeCoverageLexicalBodyTokenColdDocument,
	packCoverageLexicalBodyTokenColdDocuments,
} from "./coverage-lexical-body-token-cold-packing";

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
		const staleBlockIds = Array.from(
			new Set(existingRows.flatMap((row) => (row ? [row.blockId] : []))),
		);
		if (staleBlockIds.length === 0) {
			return;
		}
		const replacement = await this.buildReplacementBlocksForAffectedBlockIds(
			staleBlockIds,
			new Set(uniquePaths),
			[],
		);
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalBodyTokenColdBlocks,
			this.database.db.lexicalBodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalBodyTokenColdBlocks.bulkDelete(staleBlockIds);
				await this.database.db.lexicalBodyTokenColdDocs.bulkDelete(
					replacement.removedDocPaths,
				);
				if (replacement.blockRows.length > 0) {
					await this.database.db.lexicalBodyTokenColdBlocks.bulkPut(
						replacement.blockRows,
					);
				}
				if (replacement.docRows.length > 0) {
					await this.database.db.lexicalBodyTokenColdDocs.bulkPut(
						replacement.docRows,
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
		const existingRows = await this.database.db.lexicalBodyTokenColdDocs.bulkGet(
			normalizedDocuments.map((document) => document.path),
		);
		const staleBlockIds = Array.from(
			new Set(existingRows.flatMap((row) => (row ? [row.blockId] : []))),
		);
		const replacement = await this.buildReplacementBlocksForAffectedBlockIds(
			staleBlockIds,
			new Set(normalizedDocuments.map((document) => document.path)),
			normalizedDocuments,
			meta.epoch,
			now,
		);
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalBodyTokenColdMeta,
			this.database.db.lexicalBodyTokenColdBlocks,
			this.database.db.lexicalBodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalBodyTokenColdMeta.put({
					...meta,
					blockWriteMode: "multi-doc-v1",
					updatedAt: now,
				});
				if (replacement.removedDocPaths.length > 0) {
					await this.database.db.lexicalBodyTokenColdDocs.bulkDelete(
						replacement.removedDocPaths,
					);
				}
				if (staleBlockIds.length > 0) {
					await this.database.db.lexicalBodyTokenColdBlocks.bulkDelete(
						staleBlockIds,
					);
				}
				if (replacement.blockRows.length > 0) {
					await this.database.db.lexicalBodyTokenColdBlocks.bulkPut(
						replacement.blockRows,
					);
				}
				if (replacement.docRows.length > 0) {
					await this.database.db.lexicalBodyTokenColdDocs.bulkPut(
						replacement.docRows,
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
			blockWriteMode: "multi-doc-v1",
			updatedAt: Date.now(),
		};
		await this.database.db.lexicalBodyTokenColdMeta.put(created);
		return created;
	}

	private async buildReplacementBlocksForAffectedBlockIds(
		staleBlockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
		nextDocuments: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
		epoch = 1,
		now = Date.now(),
	): Promise<{
		blockRows: CoverageLexicalBodyTokenColdBlockRow[];
		docRows: CoverageLexicalBodyTokenColdDocRow[];
		removedDocPaths: string[];
	}> {
		const survivorDocuments =
			staleBlockIds.length === 0
				? []
				: await this.readBlockSurvivors(staleBlockIds, replacedPaths);
		const packed = packCoverageLexicalBodyTokenColdDocuments(
			epoch,
			[...survivorDocuments, ...nextDocuments],
			now,
			() => this.nextBlockId(epoch, now),
		);
		return {
			blockRows: packed.blockRows,
			docRows: packed.docRows,
			removedDocPaths: Array.from(
				new Set([...replacedPaths, ...survivorDocuments.map((doc) => doc.path)]),
			),
		};
	}

	private async readBlockSurvivors(
		blockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
	): Promise<CoverageLexicalBodyTokenColdDocumentWrite[]> {
		const [blockRows, docRows] = await Promise.all([
			this.database.db.lexicalBodyTokenColdBlocks.bulkGet(blockIds),
			this.database.db.lexicalBodyTokenColdDocs
				.where("blockId")
				.anyOf(blockIds as string[])
				.toArray(),
		]);
		const blockRowById = new Map(
			blockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const survivors: CoverageLexicalBodyTokenColdDocumentWrite[] = [];
		for (const docRow of docRows) {
			if (replacedPaths.has(docRow.path)) {
				continue;
			}
			const blockRow = blockRowById.get(docRow.blockId);
			if (!blockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalBodyTokenColdDocument(blockRow, docRow);
			survivors.push(decoded);
		}
		return survivors;
	}

	private nextBlockId(epoch: number, now: number): string {
		const blockId = `lexical-body-cold:${epoch}:${now}:${this.nextBlockCounter}`;
		this.nextBlockCounter += 1;
		return blockId;
	}
}
