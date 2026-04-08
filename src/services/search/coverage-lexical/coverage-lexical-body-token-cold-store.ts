import { Database } from "src/services/database/database";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID,
	type CoverageLexicalBodyTokenColdConsistencySummary,
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

	async getMeta(): Promise<CoverageLexicalBodyTokenColdMetaRow | null> {
		return (
			(await this.database.db.lexicalBodyTokenColdMeta.get(
				COVERAGE_LEXICAL_BODY_TOKEN_COLD_META_ID,
			)) ?? null
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
			this.database.db.lexicalBodyTokenColdMeta,
			this.database.db.lexicalBodyTokenColdBlocks,
			this.database.db.lexicalBodyTokenColdDocs,
			async () => {
				const meta = await this.ensureMeta();
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
				await this.database.db.lexicalBodyTokenColdMeta.put({
					...meta,
					documentCount: Math.max(
						0,
						meta.documentCount - uniquePaths.length,
					),
					updatedAt: Date.now(),
				});
			},
		);
	}

	async inspectConsistency(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<CoverageLexicalBodyTokenColdConsistencySummary> {
		const meta = await this.getMeta();
		const currentFingerprint =
			buildCoverageLexicalBodyTokenColdIndexedRefsFingerprint(indexedFileRefs);
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
		if (meta.schemaVersion !== COVERAGE_LEXICAL_BODY_TOKEN_COLD_SCHEMA_VERSION) {
			return {
				needsRepair: indexedFileRefs.length > 0,
				requiresReset: true,
				reason: "schema-mismatch",
				missingOrStalePaths: indexedFileRefs.map((ref) => ref.path),
				danglingPaths: await this.listStoredPaths(),
			};
		}
		if (
			meta.documentCount === indexedFileRefs.length &&
			meta.indexedRefsFingerprint === currentFingerprint
		) {
			return {
				needsRepair: false,
				requiresReset: false,
				reason: "up-to-date",
				missingOrStalePaths: [],
				danglingPaths: [],
			};
		}
		const docRows = await this.database.db.lexicalBodyTokenColdDocs.bulkGet(
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
		const danglingPaths =
			meta.documentCount !== indexedFileRefs.length
				? (await this.listStoredPaths()).filter(
						(path) => !indexedPathSet.has(path),
				  )
				: [];
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
	): Promise<Map<string, CoverageLexicalBodyTokenColdDocumentWrite>> {
		const uniquePaths = Array.from(new Set(paths));
		if (uniquePaths.length === 0) {
			return new Map();
		}
		const meta = await this.getMeta();
		if (
			!meta ||
			meta.schemaVersion !== COVERAGE_LEXICAL_BODY_TOKEN_COLD_SCHEMA_VERSION
		) {
			return new Map();
		}
		const [docRowsByPath, indexedRefsByPath] = await Promise.all([
			this.database.db.lexicalBodyTokenColdDocs.bulkGet(uniquePaths),
			this.database.db.lexicalIndexedFileRefs.bulkGet(uniquePaths),
		]);
		const docRows: CoverageLexicalBodyTokenColdDocRow[] = [];
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
		const blockRows = await this.database.db.lexicalBodyTokenColdBlocks.bulkGet(
			blockIds,
		);
		const blockRowById = new Map(
			blockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const documents = new Map<string, CoverageLexicalBodyTokenColdDocumentWrite>();
		for (const docRow of docRows) {
			const blockRow = blockRowById.get(docRow.blockId);
			if (!blockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalBodyTokenColdDocument(blockRow, docRow);
			documents.set(decoded.path, decoded);
		}
		return documents;
	}

	async updateIndexedRefsMetadata(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<void> {
		const meta = await this.ensureMeta();
		await this.database.db.lexicalBodyTokenColdMeta.put({
			...meta,
			documentCount: indexedFileRefs.length,
			indexedRefsFingerprint:
				buildCoverageLexicalBodyTokenColdIndexedRefsFingerprint(
					indexedFileRefs,
				),
			updatedAt: Date.now(),
		});
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
					documentCount:
						meta.documentCount -
						replacement.removedDocPaths.length +
						replacement.docRows.length,
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
			documentCount: 0,
			indexedRefsFingerprint: "",
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
				.anyOf(Array.from(blockIds))
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

	private async listStoredPaths(): Promise<string[]> {
		return (await this.database.db.lexicalBodyTokenColdDocs.toArray()).map(
			(row) => row.path,
		);
	}
}

function buildCoverageLexicalBodyTokenColdIndexedRefsFingerprint(
	indexedFileRefs: readonly BaseIndexedFileRef[],
): string {
	let hash = 2166136261;
	const sortedRefs = [...indexedFileRefs].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	for (const ref of sortedRefs) {
		const signature = `${ref.path}\u0000${ref.generation}\u0000${ref.size}`;
		for (let index = 0; index < signature.length; index += 1) {
			hash ^= signature.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
