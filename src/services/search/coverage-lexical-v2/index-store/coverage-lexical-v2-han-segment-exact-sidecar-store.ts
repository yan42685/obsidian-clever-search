import { Database } from "src/services/database/database";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
	type CoverageLexicalV2HanSegmentExactSidecarBlockRow,
	type CoverageLexicalV2HanSegmentExactSidecarConsistencySummary,
	type CoverageLexicalV2HanSegmentExactSidecarDocRow,
	type CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
	type CoverageLexicalV2HanSegmentExactSidecarMetaRow,
	type CoverageLexicalV2HanSegmentExactSidecarStoreApi,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-types";
import {
	decodeCoverageLexicalV2HanSegmentExactSidecarDocument,
	packCoverageLexicalV2HanSegmentExactSidecarDocuments,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-packing";

const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_SCHEMA_VERSION = 2;

@singleton()
export class CoverageLexicalV2HanSegmentExactSidecarStore
	implements CoverageLexicalV2HanSegmentExactSidecarStoreApi
{
	private readonly database = getInstance(Database);
	private nextBlockCounter = 0;

	async clearAll(): Promise<void> {
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2HanSegmentExactSidecarMeta,
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				await this.database.db.lexicalV2HanSegmentExactSidecarMeta.clear();
				await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.clear();
				await this.database.db.lexicalV2HanSegmentExactSidecarDocs.clear();
			},
		);
	}

	async getMeta(): Promise<CoverageLexicalV2HanSegmentExactSidecarMetaRow | null> {
		return (
			(await this.database.db.lexicalV2HanSegmentExactSidecarMeta.get(
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
			)) ?? null
		);
	}

	async deleteDocuments(paths: readonly string[]): Promise<void> {
		const uniquePaths = Array.from(new Set(paths));
		if (uniquePaths.length === 0) {
			return;
		}
		const existingRows =
			await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkGet(
				uniquePaths,
			);
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
			this.database.db.lexicalV2HanSegmentExactSidecarMeta,
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				const meta = await this.ensureMeta();
				await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkDelete(
					staleBlockIds,
				);
				await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkDelete(
					replacement.removedDocPaths,
				);
				if (replacement.blockRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkPut(
						replacement.blockRows,
					);
				}
				if (replacement.docRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkPut(
						replacement.docRows,
					);
				}
				await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put({
					...meta,
					documentCount: Math.max(0, meta.documentCount - uniquePaths.length),
					updatedAt: Date.now(),
				});
			},
		);
	}

	async summarizeConsistency(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<CoverageLexicalV2HanSegmentExactSidecarConsistencySummary> {
		const meta = await this.getMeta();
		const currentFingerprint =
			buildCoverageLexicalV2HanSegmentExactSidecarIndexedRefsFingerprint(
				indexedFileRefs,
			);
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
		if (
			meta.schemaVersion !==
			COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_SCHEMA_VERSION
		) {
			return {
				needsRepair: indexedFileRefs.length > 0,
				requiresReset: true,
				reason: "schema-mismatch",
				missingOrStalePaths: indexedFileRefs.map((ref) => ref.path),
				danglingPaths: await this.listStoredPaths(),
			};
		}
		const docRows = await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkGet(
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
				? (await this.listStoredPaths()).filter((path) => !indexedPathSet.has(path))
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

	async moveDocument(
		oldPath: string,
		nextDocument: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
	): Promise<boolean> {
		const [meta, existingRow] = await Promise.all([
			this.getMeta(),
			this.database.db.lexicalV2HanSegmentExactSidecarDocs.get(oldPath),
		]);
		if (!meta || !existingRow || existingRow.path === nextDocument.path) {
			return false;
		}
		if (existingRow.epoch !== meta.epoch) {
			return false;
		}
		const blockRow = await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.get(
			existingRow.blockId,
		);
		if (!blockRow) {
			return false;
		}
		const decoded = decodeCoverageLexicalV2HanSegmentExactSidecarDocument(
			blockRow,
			existingRow,
		);
		if (
			decoded.segmentCount !== nextDocument.segmentCount ||
			decoded.bodyHanSymbolIds.length !== nextDocument.bodyHanSymbolIds.length
		) {
			return false;
		}
		for (let index = 0; index < decoded.bodyHanSymbolIds.length; index += 1) {
			if (decoded.bodyHanSymbolIds[index] !== nextDocument.bodyHanSymbolIds[index]) {
				return false;
			}
		}
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				await this.database.db.lexicalV2HanSegmentExactSidecarDocs.delete(oldPath);
				await this.database.db.lexicalV2HanSegmentExactSidecarDocs.put({
					...existingRow,
					path: nextDocument.path,
					generation: nextDocument.generation,
					updatedAt: Date.now(),
				});
			},
		);
		return true;
	}

	async readDocuments(
		paths: readonly string[],
	): Promise<Map<string, CoverageLexicalV2HanSegmentExactSidecarDocumentWrite>> {
		const uniquePaths = Array.from(new Set(paths));
		if (uniquePaths.length === 0) {
			return new Map();
		}
		const meta = await this.getMeta();
		if (
			!meta ||
			meta.schemaVersion !==
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_SCHEMA_VERSION
		) {
			return new Map();
		}
		const [docRowsByPath, indexedRefsByPath] = await Promise.all([
			this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkGet(uniquePaths),
			this.database.db.lexicalIndexedFileRefs.bulkGet(uniquePaths),
		]);
		const docRows: CoverageLexicalV2HanSegmentExactSidecarDocRow[] = [];
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
		const blockRows = await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkGet(
			blockIds,
		);
		const blockRowById = new Map(
			blockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const documents = new Map<
			string,
			CoverageLexicalV2HanSegmentExactSidecarDocumentWrite
		>();
		for (const docRow of docRows) {
			const blockRow = blockRowById.get(docRow.blockId);
			if (!blockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalV2HanSegmentExactSidecarDocument(
				blockRow,
				docRow,
			);
			documents.set(decoded.path, decoded);
		}
		return documents;
	}

	async updateIndexedRefsMetadata(
		indexedFileRefs: readonly BaseIndexedFileRef[],
	): Promise<void> {
		const meta = await this.ensureMeta();
		await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put({
			...meta,
			documentCount: indexedFileRefs.length,
			indexedRefsFingerprint:
				buildCoverageLexicalV2HanSegmentExactSidecarIndexedRefsFingerprint(
					indexedFileRefs,
				),
			updatedAt: Date.now(),
		});
	}

	async upsertDocuments(
		documents: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
	): Promise<void> {
		const normalizedDocuments = Array.from(
			new Map(documents.map((document) => [document.path, document])).values(),
		);
		if (normalizedDocuments.length === 0) {
			return;
		}
		const meta = await this.ensureMeta();
		const now = Date.now();
		const existingRows =
			await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkGet(
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
			this.database.db.lexicalV2HanSegmentExactSidecarMeta,
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put({
					...meta,
					blockWriteMode: "multi-doc-v2",
					documentCount:
						meta.documentCount -
						replacement.removedDocPaths.length +
						replacement.docRows.length,
					updatedAt: now,
				});
				if (replacement.removedDocPaths.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkDelete(
						replacement.removedDocPaths,
					);
				}
				if (staleBlockIds.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkDelete(
						staleBlockIds,
					);
				}
				if (replacement.blockRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkPut(
						replacement.blockRows,
					);
				}
				if (replacement.docRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkPut(
						replacement.docRows,
					);
				}
			},
		);
	}

	private async ensureMeta(): Promise<CoverageLexicalV2HanSegmentExactSidecarMetaRow> {
		const existing = await this.database.db.lexicalV2HanSegmentExactSidecarMeta.get(
			COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
		);
		if (existing) {
			return existing;
		}
		const created: CoverageLexicalV2HanSegmentExactSidecarMetaRow = {
			id: COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
			epoch: 1,
			schemaVersion: COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_SCHEMA_VERSION,
			blockWriteMode: "multi-doc-v2",
			documentCount: 0,
			indexedRefsFingerprint: "",
			updatedAt: Date.now(),
		};
		await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put(created);
		return created;
	}

	private async buildReplacementBlocksForAffectedBlockIds(
		staleBlockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
		nextDocuments: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
		epoch = 1,
		now = Date.now(),
	): Promise<{
		blockRows: CoverageLexicalV2HanSegmentExactSidecarBlockRow[];
		docRows: CoverageLexicalV2HanSegmentExactSidecarDocRow[];
		removedDocPaths: string[];
	}> {
		const survivorDocuments =
			staleBlockIds.length === 0
				? []
				: await this.readBlockSurvivors(staleBlockIds, replacedPaths);
		const packed = packCoverageLexicalV2HanSegmentExactSidecarDocuments(
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
	): Promise<CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[]> {
		const [blockRows, docRows] = await Promise.all([
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkGet(
				Array.from(blockIds),
			),
			this.database.db.lexicalV2HanSegmentExactSidecarDocs
				.where("blockId")
				.anyOf(Array.from(blockIds))
				.toArray(),
		]);
		const blockRowById = new Map(
			blockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const survivors: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[] = [];
		for (const docRow of docRows) {
			if (replacedPaths.has(docRow.path)) {
				continue;
			}
			const blockRow = blockRowById.get(docRow.blockId);
			if (!blockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalV2HanSegmentExactSidecarDocument(
				blockRow,
				docRow,
			);
			survivors.push(decoded);
		}
		return survivors;
	}

	private async listStoredPaths(): Promise<string[]> {
		return (await this.database.db.lexicalV2HanSegmentExactSidecarDocs.toArray()).map(
			(row) => row.path,
		);
	}

	private nextBlockId(epoch: number, now: number): string {
		this.nextBlockCounter += 1;
		return `v2:han:${epoch}:${now}:${this.nextBlockCounter}`;
	}
}

function buildCoverageLexicalV2HanSegmentExactSidecarIndexedRefsFingerprint(
	indexedFileRefs: readonly BaseIndexedFileRef[],
): string {
	return indexedFileRefs
		.map((ref) => `${ref.path}:${ref.generation}:${ref.size ?? -1}`)
		.sort()
		.join("|");
}

