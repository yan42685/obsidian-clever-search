import { Database } from "src/services/database/database";
import type { BaseIndexedFileRef } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
	type CoverageLexicalV2HanSegmentExactSidecarConsistencySummary,
	type CoverageLexicalV2HanSegmentExactSidecarDocSummaryRow,
	type CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
	type CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead,
	type CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow,
	type CoverageLexicalV2HanSegmentExactSidecarMetaRow,
	type CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow,
	type CoverageLexicalV2HanSegmentExactSidecarStoreApi,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-types";
import {
	decodeCoverageLexicalV2HanSegmentExactSidecarLogicalBlock,
	packCoverageLexicalV2HanSegmentExactSidecarDocuments,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-packing";

const COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_SCHEMA_VERSION = 3;

@singleton()
export class CoverageLexicalV2HanSegmentExactSidecarStore
	implements CoverageLexicalV2HanSegmentExactSidecarStoreApi
{
	private readonly database = getInstance(Database);
	private nextStorageBlockCounter = 0;
	private nextLogicalBlockCounter = 0;

	async clearAll(): Promise<void> {
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2HanSegmentExactSidecarMeta,
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				await this.database.db.lexicalV2HanSegmentExactSidecarMeta.clear();
				await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.clear();
				await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks.clear();
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
		const existingLogicalRows =
			await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
				.where("path")
				.anyOf(uniquePaths)
				.toArray();
		const staleStorageBlockIds = Array.from(
			new Set(existingLogicalRows.map((row) => row.storageBlockId)),
		);
		if (staleStorageBlockIds.length === 0) {
			await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkDelete(
				uniquePaths,
			);
			return;
		}
		const replacement = await this.buildReplacementData(
			staleStorageBlockIds,
			new Set(uniquePaths),
			[],
		);
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2HanSegmentExactSidecarMeta,
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				const meta = await this.ensureMeta();
				await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkDelete(
					staleStorageBlockIds,
				);
				if (replacement.removedLogicalBlockIds.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks.bulkDelete(
						replacement.removedLogicalBlockIds,
					);
				}
				if (replacement.removedDocPaths.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkDelete(
						replacement.removedDocPaths,
					);
				}
				if (replacement.storageBlockRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkPut(
						replacement.storageBlockRows,
					);
				}
				if (replacement.logicalBlockRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks.bulkPut(
						replacement.logicalBlockRows,
					);
				}
				if (replacement.docSummaryRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkPut(
						replacement.docSummaryRows,
					);
				}
				await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put({
					...meta,
					blockWriteMode: "logical-block-v3",
					documentCount: Math.max(0, meta.documentCount - uniquePaths.length),
					logicalBlockCount: Math.max(
						0,
						meta.logicalBlockCount - existingLogicalRows.length,
					),
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
		const [meta, existingDocRow, existingLogicalRows] = await Promise.all([
			this.getMeta(),
			this.database.db.lexicalV2HanSegmentExactSidecarDocs.get(oldPath),
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
				.where("path")
				.equals(oldPath)
				.sortBy("blockOrdinal"),
		]);
		if (!meta || !existingDocRow || oldPath === nextDocument.path) {
			return false;
		}
		if (existingDocRow.epoch !== meta.epoch) {
			return false;
		}
		const currentLogicalBlocks = await this.readLogicalBlocks(
			existingLogicalRows.map((row) => ({
				path: row.path,
				blockOrdinal: row.blockOrdinal,
			})),
		);
		if (currentLogicalBlocks.size !== nextDocument.logicalBlocks.length) {
			return false;
		}
		for (const nextLogicalBlock of nextDocument.logicalBlocks) {
			const current = currentLogicalBlocks.get(
				this.createLogicalBlockLookupKey(oldPath, nextLogicalBlock.blockOrdinal),
			);
			if (
				!current ||
				current.segmentCount !== nextLogicalBlock.segmentCount ||
				current.symbolCount !== nextLogicalBlock.symbolCount ||
				current.encodedByteLength !== nextLogicalBlock.encodedByteLength ||
				current.bodyHanSymbolIds.length !== nextLogicalBlock.bodyHanSymbolIds.length
			) {
				return false;
			}
			for (let index = 0; index < current.bodyHanSymbolIds.length; index += 1) {
				if (current.bodyHanSymbolIds[index] !== nextLogicalBlock.bodyHanSymbolIds[index]) {
					return false;
				}
			}
		}
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				await this.database.db.lexicalV2HanSegmentExactSidecarDocs.delete(oldPath);
				await this.database.db.lexicalV2HanSegmentExactSidecarDocs.put({
					...existingDocRow,
					path: nextDocument.path,
					generation: nextDocument.generation,
					updatedAt: Date.now(),
				});
				for (const existingLogicalRow of existingLogicalRows) {
					await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks.put({
						...existingLogicalRow,
						path: nextDocument.path,
						generation: nextDocument.generation,
						updatedAt: Date.now(),
					});
				}
			},
		);
		return true;
	}

	async readLogicalBlocks(
		requests: readonly {
			path: string;
			blockOrdinal: number;
		}[],
	): Promise<Map<string, CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead>> {
		const uniqueRequests = Array.from(
			new Map(
				requests.map((request) => [
					this.createLogicalBlockLookupKey(request.path, request.blockOrdinal),
					request,
				]),
			).values(),
		);
		if (uniqueRequests.length === 0) {
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
		const logicalRows =
			await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
				.where("[path+blockOrdinal]")
				.anyOf(uniqueRequests.map((request) => [request.path, request.blockOrdinal]))
				.toArray();
		if (logicalRows.length === 0) {
			return new Map();
		}
		const indexedRefsByPath = new Map(
			(
				await this.database.db.lexicalIndexedFileRefs.bulkGet(
					Array.from(new Set(logicalRows.map((row) => row.path))),
				)
			).flatMap((row) => (row ? [[row.path, row] as const] : [])),
		);
		const validLogicalRows = logicalRows.filter((logicalRow) => {
			const indexedRef = indexedRefsByPath.get(logicalRow.path);
			return (
				!!indexedRef &&
				logicalRow.epoch === meta.epoch &&
				logicalRow.generation === indexedRef.generation
			);
		});
		if (validLogicalRows.length === 0) {
			return new Map();
		}
		const storageBlockIds = Array.from(
			new Set(validLogicalRows.map((row) => row.storageBlockId)),
		);
		const storageBlockRows =
			await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkGet(
				storageBlockIds,
			);
		const storageBlockRowById = new Map(
			storageBlockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const blocks = new Map<
			string,
			CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRead
		>();
		for (const logicalRow of validLogicalRows) {
			const storageBlockRow = storageBlockRowById.get(logicalRow.storageBlockId);
			if (!storageBlockRow) {
				continue;
			}
			blocks.set(
				this.createLogicalBlockLookupKey(logicalRow.path, logicalRow.blockOrdinal),
				decodeCoverageLexicalV2HanSegmentExactSidecarLogicalBlock(
					storageBlockRow,
					logicalRow,
				),
			);
		}
		return blocks;
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
		const existingLogicalRows =
			await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
				.where("path")
				.anyOf(normalizedDocuments.map((document) => document.path))
				.toArray();
		const staleStorageBlockIds = Array.from(
			new Set(existingLogicalRows.map((row) => row.storageBlockId)),
		);
		const replacement = await this.buildReplacementData(
			staleStorageBlockIds,
			new Set(normalizedDocuments.map((document) => document.path)),
			normalizedDocuments,
			meta.epoch,
			now,
		);
		await this.database.db.transaction(
			"rw",
			this.database.db.lexicalV2HanSegmentExactSidecarMeta,
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks,
			this.database.db.lexicalV2HanSegmentExactSidecarDocs,
			async () => {
				await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put({
					...meta,
					blockWriteMode: "logical-block-v3",
					documentCount:
						meta.documentCount -
						replacement.removedDocPaths.length +
						replacement.docSummaryRows.length,
					logicalBlockCount:
						meta.logicalBlockCount -
						replacement.removedLogicalBlockIds.length +
						replacement.logicalBlockRows.length,
					updatedAt: now,
				});
				if (replacement.removedDocPaths.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkDelete(
						replacement.removedDocPaths,
					);
				}
				if (replacement.removedLogicalBlockIds.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks.bulkDelete(
						replacement.removedLogicalBlockIds,
					);
				}
				if (staleStorageBlockIds.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkDelete(
						staleStorageBlockIds,
					);
				}
				if (replacement.storageBlockRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkPut(
						replacement.storageBlockRows,
					);
				}
				if (replacement.logicalBlockRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks.bulkPut(
						replacement.logicalBlockRows,
					);
				}
				if (replacement.docSummaryRows.length > 0) {
					await this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkPut(
						replacement.docSummaryRows,
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
			blockWriteMode: "logical-block-v3",
			documentCount: 0,
			logicalBlockCount: 0,
			indexedRefsFingerprint: "",
			updatedAt: Date.now(),
		};
		await this.database.db.lexicalV2HanSegmentExactSidecarMeta.put(created);
		return created;
	}

	private async buildReplacementData(
		staleStorageBlockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
		nextDocuments: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
		epoch = 1,
		now = Date.now(),
	): Promise<{
		storageBlockRows: CoverageLexicalV2HanSegmentExactSidecarStorageBlockRow[];
		logicalBlockRows: CoverageLexicalV2HanSegmentExactSidecarLogicalBlockRow[];
		docSummaryRows: CoverageLexicalV2HanSegmentExactSidecarDocSummaryRow[];
		removedLogicalBlockIds: string[];
		removedDocPaths: string[];
	}> {
		const survivorDocuments =
			staleStorageBlockIds.length === 0
				? []
				: await this.readSurvivorDocuments(staleStorageBlockIds, replacedPaths);
		const packed = packCoverageLexicalV2HanSegmentExactSidecarDocuments(
			epoch,
			[...survivorDocuments, ...nextDocuments],
			now,
			() => this.nextStorageBlockId(epoch, now),
			() => this.nextLogicalBlockId(epoch, now),
		);
		const removedLogicalBlockIds =
			staleStorageBlockIds.length === 0
				? []
				: (
						await this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
							.where("storageBlockId")
							.anyOf(Array.from(staleStorageBlockIds))
							.primaryKeys()
				  ).map(String);
		return {
			storageBlockRows: packed.storageBlockRows,
			logicalBlockRows: packed.logicalBlockRows,
			docSummaryRows: packed.docSummaryRows,
			removedLogicalBlockIds,
			removedDocPaths: [...replacedPaths],
		};
	}

	private async readSurvivorDocuments(
		storageBlockIds: readonly string[],
		replacedPaths: ReadonlySet<string>,
	): Promise<CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[]> {
		const [storageBlockRows, logicalBlockRows] = await Promise.all([
			this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkGet(
				Array.from(storageBlockIds),
			),
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
				.where("storageBlockId")
				.anyOf(Array.from(storageBlockIds))
				.sortBy("blockOrdinal"),
		]);
		const storageBlockRowById = new Map(
			storageBlockRows.flatMap((row) => (row ? [[row.id, row] as const] : [])),
		);
		const survivorsByPath = new Map<string, CoverageLexicalV2HanSegmentExactSidecarDocumentWrite>();
		for (const logicalBlockRow of logicalBlockRows) {
			if (replacedPaths.has(logicalBlockRow.path)) {
				continue;
			}
			const storageBlockRow = storageBlockRowById.get(logicalBlockRow.storageBlockId);
			if (!storageBlockRow) {
				continue;
			}
			const decoded = decodeCoverageLexicalV2HanSegmentExactSidecarLogicalBlock(
				storageBlockRow,
				logicalBlockRow,
			);
			const existing =
				survivorsByPath.get(logicalBlockRow.path) ?? {
					path: logicalBlockRow.path,
					generation: logicalBlockRow.generation,
					logicalBlocks: [],
				};
			survivorsByPath.set(logicalBlockRow.path, {
				...existing,
				logicalBlocks: [
					...existing.logicalBlocks,
					{
						blockOrdinal: decoded.blockOrdinal,
						bodyHanSymbolIds: decoded.bodyHanSymbolIds,
						bigramIds: [],
						encodedByteLength: decoded.encodedByteLength,
						symbolCount: decoded.symbolCount,
						segmentCount: decoded.segmentCount,
					},
				],
			});
		}
		return [...survivorsByPath.values()].map((document) => ({
			...document,
			logicalBlocks: [...document.logicalBlocks].sort(
				(left, right) => left.blockOrdinal - right.blockOrdinal,
			),
		}));
	}

	private async listStoredPaths(): Promise<string[]> {
		return (await this.database.db.lexicalV2HanSegmentExactSidecarDocs.toArray()).map(
			(row) => row.path,
		);
	}

	private createLogicalBlockLookupKey(path: string, blockOrdinal: number): string {
		return `${path}#${blockOrdinal}`;
	}

	private nextStorageBlockId(epoch: number, now: number): string {
		this.nextStorageBlockCounter += 1;
		return `v3:han:storage:${epoch}:${now}:${this.nextStorageBlockCounter}`;
	}

	private nextLogicalBlockId(epoch: number, now: number): string {
		this.nextLogicalBlockCounter += 1;
		return `v3:han:logical:${epoch}:${now}:${this.nextLogicalBlockCounter}`;
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
