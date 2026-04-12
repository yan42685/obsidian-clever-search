import { Database } from "src/services/database/database";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_META_ID,
	type CoverageLexicalV2BodyTokenColdBlockRow,
	type CoverageLexicalV2BodyTokenColdConsistencySummary,
	type CoverageLexicalV2BodyTokenColdDocRow,
	type CoverageLexicalV2BodyTokenColdDocumentWrite,
	type CoverageLexicalV2BodyTokenColdMetaRow,
	type CoverageLexicalV2BodyTokenColdStoreApi,
} from "./coverage-lexical-v2-body-token-cold-types";
import {
	decodeCoverageLexicalV2BodyTokenColdDocument,
	packCoverageLexicalV2BodyTokenColdDocuments,
} from "./coverage-lexical-v2-body-token-cold-packing";

const COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_SCHEMA_VERSION = 1;

@singleton()
export class CoverageLexicalV2BodyTokenColdStore
	implements CoverageLexicalV2BodyTokenColdStoreApi
{
	private readonly database = getInstance(Database);
	private nextBlockCounter = 0;

	async clearAll(): Promise<void> {
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2BodyTokenColdMeta,
			this.database.db.lexicalV2BodyTokenColdBlocks,
			this.database.db.lexicalV2BodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalV2BodyTokenColdMeta.clear();
				await this.database.db.lexicalV2BodyTokenColdBlocks.clear();
				await this.database.db.lexicalV2BodyTokenColdDocs.clear();
			},
		);
	}

	async getMeta(): Promise<CoverageLexicalV2BodyTokenColdMetaRow | null> {
		return (
			(await this.database.db.lexicalV2BodyTokenColdMeta.get(
				COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_META_ID,
			)) ?? null
		);
	}

	async deleteDocuments(paths: readonly string[]): Promise<void> {
		const uniquePaths = Array.from(new Set(paths));
		if (uniquePaths.length === 0) {
			return;
		}
		const existingRows =
			await this.database.db.lexicalV2BodyTokenColdDocs.bulkGet(uniquePaths);
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
			this.database.db.lexicalV2BodyTokenColdMeta,
			this.database.db.lexicalV2BodyTokenColdBlocks,
			this.database.db.lexicalV2BodyTokenColdDocs,
			async () => {
				const meta = await this.ensureMeta();
				await this.database.db.lexicalV2BodyTokenColdBlocks.bulkDelete(staleBlockIds);
				await this.database.db.lexicalV2BodyTokenColdDocs.bulkDelete(
					replacement.removedDocPaths,
				);
				if (replacement.blockRows.length > 0) {
					await this.database.db.lexicalV2BodyTokenColdBlocks.bulkPut(
						replacement.blockRows,
					);
				}
				if (replacement.docRows.length > 0) {
					await this.database.db.lexicalV2BodyTokenColdDocs.bulkPut(
						replacement.docRows,
					);
				}
				await this.database.db.lexicalV2BodyTokenColdMeta.put({
					...meta,
					documentCount: Math.max(0, meta.documentCount - uniquePaths.length),
					updatedAt: Date.now(),
				});
			},
		);
	}

	async inspectConsistency(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<CoverageLexicalV2BodyTokenColdConsistencySummary> {
		const meta = await this.getMeta();
		const currentFingerprint =
			buildCoverageLexicalV2BodyTokenColdIndexedRefsFingerprint(indexedFileRefs);
		const indexedPathSet = new Set(indexedFileRefs.map((ref) => ref.path));
		if (!meta) {
			return {
				needsRepair: indexedFileRefs.length > 0,
				requiresReset: false,
				reason: "missing-meta",
				missingOrStalePaths: indexedFileRefs.map((ref) => ref.path),
				danglingPaths: [],
			};
		}
		if (meta.schemaVersion !== COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_SCHEMA_VERSION) {
			return {
				needsRepair: indexedFileRefs.length > 0,
				requiresReset: true,
				reason: "schema-mismatch",
				missingOrStalePaths: indexedFileRefs.map((ref) => ref.path),
				danglingPaths: await this.listStoredPaths(),
			};
		}
		const docRows = await this.database.db.lexicalV2BodyTokenColdDocs.bulkGet(
			indexedFileRefs.map((ref) => ref.path),
		);
		const missingOrStalePaths: string[] = [];
		for (let index = 0; index < indexedFileRefs.length; index += 1) {
			const ref = indexedFileRefs[index];
			const row = docRows[index];
			if (!row || row.epoch !== meta.epoch || row.generation !== ref.generation) {
				missingOrStalePaths.push(ref.path);
			}
		}
		const metadataAligned =
			meta.documentCount === indexedFileRefs.length &&
			meta.indexedRefsFingerprint === currentFingerprint;
		const danglingPaths =
			!metadataAligned || missingOrStalePaths.length > 0
				? (await this.listStoredPaths()).filter(
						(path) => !indexedPathSet.has(path),
				  )
				: [];
		if (metadataAligned && missingOrStalePaths.length === 0 && danglingPaths.length === 0) {
			return {
				needsRepair: false,
				requiresReset: false,
				reason: "up-to-date",
				missingOrStalePaths: [],
				danglingPaths: [],
			};
		}
		return {
			needsRepair:
				missingOrStalePaths.length > 0 || danglingPaths.length > 0,
			requiresReset: false,
			reason:
				meta.documentCount !== indexedFileRefs.length
					? "count-mismatch"
					: "fingerprint-mismatch",
			missingOrStalePaths,
			danglingPaths,
		};
	}

	async readDocuments(
		paths: readonly string[],
	): Promise<Map<string, CoverageLexicalV2BodyTokenColdDocumentWrite>> {
		const uniquePaths = Array.from(new Set(paths));
		if (uniquePaths.length === 0) {
			return new Map();
		}
		const meta = await this.getMeta();
		if (
			!meta ||
			meta.schemaVersion !== COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_SCHEMA_VERSION
		) {
			return new Map();
		}
		const [docRowsByPath, indexedRefsByPath] = await Promise.all([
			this.database.db.lexicalV2BodyTokenColdDocs.bulkGet(uniquePaths),
			this.database.db.lexicalIndexedFileRefs.bulkGet(uniquePaths),
		]);
		const docRows: CoverageLexicalV2BodyTokenColdDocRow[] = [];
		for (let index = 0; index < uniquePaths.length; index += 1) {
			const docRow = docRowsByPath[index];
			const indexedRef = indexedRefsByPath[index];
			if (
				docRow &&
				indexedRef &&
				docRow.epoch === meta.epoch &&
				docRow.generation === indexedRef.generation
			) {
				docRows.push(docRow);
			}
		}
		if (docRows.length === 0) {
			return new Map();
		}
		const blockIds = Array.from(new Set(docRows.map((row) => row.blockId)));
		const blockRows = await this.database.db.lexicalV2BodyTokenColdBlocks.bulkGet(
			blockIds,
		);
		const blockRowById = new Map(
			blockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const documents = new Map<string, CoverageLexicalV2BodyTokenColdDocumentWrite>();
		for (const docRow of docRows) {
			const blockRow = blockRowById.get(docRow.blockId);
			if (!blockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalV2BodyTokenColdDocument(blockRow, docRow);
			documents.set(decoded.path, decoded);
		}
		return documents;
	}

	async updateIndexedRefsMetadata(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<void> {
		const meta = await this.ensureMeta();
		await this.database.db.lexicalV2BodyTokenColdMeta.put({
			...meta,
			documentCount: indexedFileRefs.length,
			indexedRefsFingerprint:
				buildCoverageLexicalV2BodyTokenColdIndexedRefsFingerprint(
					indexedFileRefs,
				),
			updatedAt: Date.now(),
		});
	}

	async upsertDocuments(
		documents: readonly CoverageLexicalV2BodyTokenColdDocumentWrite[],
	): Promise<void> {
		const normalizedDocuments = Array.from(
			new Map(documents.map((document) => [document.path, document])).values(),
		);
		if (normalizedDocuments.length === 0) {
			return;
		}
		const meta = await this.ensureMeta();
		const now = Date.now();
		const existingRows = await this.database.db.lexicalV2BodyTokenColdDocs.bulkGet(
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
			this.database.db.lexicalV2BodyTokenColdMeta,
			this.database.db.lexicalV2BodyTokenColdBlocks,
			this.database.db.lexicalV2BodyTokenColdDocs,
			async () => {
				await this.database.db.lexicalV2BodyTokenColdMeta.put({
					...meta,
					blockWriteMode: "multi-doc-v2",
					documentCount:
						meta.documentCount -
						replacement.removedDocPaths.length +
						replacement.docRows.length,
					updatedAt: now,
				});
				if (replacement.removedDocPaths.length > 0) {
					await this.database.db.lexicalV2BodyTokenColdDocs.bulkDelete(
						replacement.removedDocPaths,
					);
				}
				if (staleBlockIds.length > 0) {
					await this.database.db.lexicalV2BodyTokenColdBlocks.bulkDelete(
						staleBlockIds,
					);
				}
				if (replacement.blockRows.length > 0) {
					await this.database.db.lexicalV2BodyTokenColdBlocks.bulkPut(
						replacement.blockRows,
					);
				}
				if (replacement.docRows.length > 0) {
					await this.database.db.lexicalV2BodyTokenColdDocs.bulkPut(
						replacement.docRows,
					);
				}
			},
		);
	}

	private async ensureMeta(): Promise<CoverageLexicalV2BodyTokenColdMetaRow> {
		const existing = await this.database.db.lexicalV2BodyTokenColdMeta.get(
			COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_META_ID,
		);
		if (existing) {
			return existing;
		}
		const created: CoverageLexicalV2BodyTokenColdMetaRow = {
			id: COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_META_ID,
			epoch: 1,
			schemaVersion: COVERAGE_LEXICAL_V2_BODY_TOKEN_COLD_SCHEMA_VERSION,
			blockWriteMode: "multi-doc-v2",
			documentCount: 0,
			indexedRefsFingerprint: "",
			updatedAt: Date.now(),
		};
		await this.database.db.lexicalV2BodyTokenColdMeta.put(created);
		return created;
	}

	private async buildReplacementBlocksForAffectedBlockIds(
		staleBlockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
		nextDocuments: readonly CoverageLexicalV2BodyTokenColdDocumentWrite[],
		epoch = 1,
		now = Date.now(),
	): Promise<{
		blockRows: CoverageLexicalV2BodyTokenColdBlockRow[];
		docRows: CoverageLexicalV2BodyTokenColdDocRow[];
		removedDocPaths: string[];
	}> {
		const survivorDocuments =
			staleBlockIds.length === 0
				? []
				: await this.readBlockSurvivors(staleBlockIds, replacedPaths);
		const packed = packCoverageLexicalV2BodyTokenColdDocuments(
			epoch,
			[...survivorDocuments, ...nextDocuments],
			now,
			() => this.nextBlockId(epoch, now),
		);
		return {
			blockRows: packed.blockRows,
			docRows: packed.docRows,
			removedDocPaths: [...replacedPaths],
		};
	}

	private async readBlockSurvivors(
		blockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
	): Promise<CoverageLexicalV2BodyTokenColdDocumentWrite[]> {
		const [blockRows, docRows] = await Promise.all([
			this.database.db.lexicalV2BodyTokenColdBlocks.bulkGet(Array.from(blockIds)),
			this.database.db.lexicalV2BodyTokenColdDocs
				.where("blockId")
				.anyOf(Array.from(blockIds))
				.toArray(),
		]);
		const blockRowById = new Map(
			blockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const survivors: CoverageLexicalV2BodyTokenColdDocumentWrite[] = [];
		for (const docRow of docRows) {
			if (replacedPaths.has(docRow.path)) {
				continue;
			}
			const blockRow = blockRowById.get(docRow.blockId);
			if (!blockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalV2BodyTokenColdDocument(blockRow, docRow);
			survivors.push(decoded);
		}
		return survivors;
	}

	private async listStoredPaths(): Promise<string[]> {
		return (await this.database.db.lexicalV2BodyTokenColdDocs.toArray()).map(
			(row) => row.path,
		);
	}

	private nextBlockId(epoch: number, now: number): string {
		this.nextBlockCounter += 1;
		return `v2:${epoch}:${now}:${this.nextBlockCounter}`;
	}
}

function buildCoverageLexicalV2BodyTokenColdIndexedRefsFingerprint(
	indexedFileRefs: readonly BaseIndexedFileRef[],
): string {
	return indexedFileRefs
		.map((ref) => `${ref.path}:${ref.generation}:${ref.size ?? -1}`)
		.sort()
		.join("|");
}
