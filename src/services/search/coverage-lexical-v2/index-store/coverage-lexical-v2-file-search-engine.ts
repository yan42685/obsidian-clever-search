import type {
	BaseIndexedFileRef,
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { performance } from "perf_hooks";
import { container, singleton } from "tsyringe";
import { Database } from "src/services/database/database";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { Tokenizer } from "src/services/search/tokenizer";
import {
	buildDirectSubitemsExactFileSubItems,
} from "src/services/search/coverage-lexical/direct-subitems";
import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
	type CoverageLexicalBodyTokenColdDocumentWrite,
	type CoverageLexicalBodyTokenColdStoreApi,
} from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types";
import type {
	CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult,
	CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus,
} from "../candidate-cascade";
import {
	COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
	COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
	type CoverageLexicalV2HanSegmentExactSidecarDocumentWrite,
	type CoverageLexicalV2HanSegmentExactSidecarStoreApi,
} from "./coverage-lexical-v2-han-segment-exact-sidecar-types";
import {
	extractHanBigrams,
	extractHanSegments,
	splitCoverageLexicalTagValues,
} from "src/services/search/coverage-lexical/coverage-lexical-cjk";
import type {
	FileSearchEngine,
	FileSearchIndexTimingSummary,
	FileSearchRequest,
	PersistentFileIndexRecoveryPlan,
	SerializedCoverageLexicalBinarySnapshot,
	SerializedFileSearchIndex,
} from "../../file-search-engine";
import {
	searchCoverageLexicalV2Engine,
} from "../coverage-lexical-v2-engine";
import {
	decodeCoverageLexicalV2IndexStoreSnapshot,
	encodeCoverageLexicalV2IndexStoreSnapshot,
} from "./coverage-lexical-v2-index-store-snapshot";
import {
	COVERAGE_LEXICAL_V2_INDEX_STORE_META_ID,
	type CoverageLexicalV2IndexStoreJournalEntry,
	type CoverageLexicalV2PersistedJournalDocument,
	type CoverageLexicalV2PreparedDocument,
	type CoverageLexicalV2RuntimeMemoryBreakdown,
} from "./coverage-lexical-v2-index-store-types";
import {
	planCoverageLexicalV2PersistentRecovery,
} from "./coverage-lexical-v2-index-store-recovery";
import {
	CoverageLexicalV2IndexStore,
	estimateCoverageLexicalV2BodyTokenIdSequenceBytes,
} from "./coverage-lexical-v2-index-store";

type CoverageLexicalV2PersistentStoreApi = {
	supportsPersistentFileIndex(): boolean;
	restorePersistedFileIndex(): Promise<boolean>;
	persistFileIndexArtifact(): Promise<void>;
	clearPersistedFileIndexArtifact(): Promise<void>;
	beginBatchReindex?(): void;
	finishBatchReindex?(): void | Promise<void>;
	abortBatchReindex?(): void | Promise<void>;
};

type CoverageLexicalV2BenchmarkIndexPhaseName =
	| "prepareDocuments"
	| "replaceDocuments"
	| "compactOverlay"
	| "bodyTokenColdSidecar"
	| "bodyHanExactSidecar"
	| "journal";

type CoverageLexicalV2BenchmarkIndexPhaseTimingEntry = {
	totalMs: number;
	maxMs: number;
	count: number;
	unitCount: number;
};

type CoverageLexicalV2BenchmarkIndexTimingState = {
	batchCount: number;
	documentCount: number;
	bodyTokenCount: number;
	exactTermCount: number;
	metadataHanBigramCount: number;
	bodyHanSegmentCount: number;
	bodyHanLogicalBlockCount: number;
	phases: Map<
		CoverageLexicalV2BenchmarkIndexPhaseName,
		CoverageLexicalV2BenchmarkIndexPhaseTimingEntry
	>;
};

@singleton()
export class CoverageLexicalV2FileSearchEngine
	implements FileSearchEngine, CoverageLexicalV2PersistentStoreApi {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = true;
	private static readonly BODY_HAN_EXACT_CACHE_MAX_BLOCKS = 2048;
	private static readonly BODY_HAN_EXACT_CACHE_MAX_BYTES = 12 * 1024 * 1024;

	private readonly tokenizer = container.resolve(Tokenizer);
	private readonly database = container.resolve(Database);
	private readonly fileSnapshotStore = container.resolve(FileSnapshotStore);
	private readonly store = new CoverageLexicalV2IndexStore();
	private readonly bodyTokenCacheByDocId = new Map<number, Uint32Array>();
	private readonly bodyHanExactCacheByDocKey = new Map<string, Uint32Array>();
	private bodyHanExactCacheBytes = 0;
	private bodyTokenColdStore:
		| CoverageLexicalBodyTokenColdStoreApi
		| null
		| undefined;
	private bodyHanSegmentExactSidecarStore:
		| CoverageLexicalV2HanSegmentExactSidecarStoreApi
		| null
		| undefined;
	private batchReindexing = false;
	private journalTransactionOrdinal = 0;
	private benchmarkIndexTiming: CoverageLexicalV2BenchmarkIndexTimingState | null =
		null;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (Array.isArray(data)) {
			this.clearIndex();
			await this.addDocuments(data);
			return true;
		}
		if (!isSerializedCoverageLexicalBinarySnapshot(data)) {
			this.clearIndex();
			return false;
		}
		try {
			const snapshot = decodeCoverageLexicalV2IndexStoreSnapshot(data.data);
			this.clearIndex();
			this.store.restoreSnapshot(snapshot);
			return true;
		} catch {
			this.clearIndex();
			return false;
		}
	}

	clearIndex(): void {
		this.store.clear();
		this.bodyTokenCacheByDocId.clear();
		this.bodyHanExactCacheByDocKey.clear();
		this.bodyHanExactCacheBytes = 0;
	}

	resetBenchmarkIndexTiming(): void {
		this.benchmarkIndexTiming = createCoverageLexicalV2BenchmarkIndexTimingState();
	}

	getBenchmarkIndexTimingSummary(): FileSearchIndexTimingSummary | null {
		if (!this.benchmarkIndexTiming) {
			return null;
		}
		const totalMeasuredMs = Array.from(
			this.benchmarkIndexTiming.phases.values(),
		).reduce((sum, phase) => sum + phase.totalMs, 0);
		return {
			batchCount: this.benchmarkIndexTiming.batchCount,
			documentCount: this.benchmarkIndexTiming.documentCount,
			bodyTokenCount: this.benchmarkIndexTiming.bodyTokenCount,
			exactTermCount: this.benchmarkIndexTiming.exactTermCount,
			metadataHanBigramCount:
				this.benchmarkIndexTiming.metadataHanBigramCount,
			bodyHanSegmentCount: this.benchmarkIndexTiming.bodyHanSegmentCount,
			bodyHanLogicalBlockCount:
				this.benchmarkIndexTiming.bodyHanLogicalBlockCount,
			totalMeasuredMs,
			phases: Array.from(this.benchmarkIndexTiming.phases.entries())
				.map(([phase, stats]) => ({
					phase,
					totalMs: stats.totalMs,
					maxMs: stats.maxMs,
					count: stats.count,
					unitCount: stats.unitCount,
					avgMsPerCall:
						stats.count > 0 ? stats.totalMs / stats.count : 0,
					avgMsPerUnit:
						stats.unitCount > 0 ? stats.totalMs / stats.unitCount : 0,
					shareOfMeasuredMs:
						totalMeasuredMs > 0 ? stats.totalMs / totalMeasuredMs : 0,
				}))
				.sort(
					(left, right) =>
						right.totalMs - left.totalMs ||
						right.unitCount - left.unitCount ||
						left.phase.localeCompare(right.phase),
				),
		};
	}

	beginBatchReindex(): void {
		this.batchReindexing = true;
	}

	finishBatchReindex(): void {
		this.batchReindexing = false;
		this.recordBenchmarkIndexPhase(
			"compactOverlay",
			this.store.getIndexedDocumentCount(),
			() => {
				this.store.compactOverlayIntoSegment(true);
			},
		);
	}

	abortBatchReindex(): void {
		this.batchReindexing = false;
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		const preparedDocuments = this.recordBenchmarkIndexPhase(
			"prepareDocuments",
			documents.length,
			() =>
				documents.map((document) =>
					buildCoverageLexicalV2PreparedDocument(this.tokenizer, document),
				),
		);
		this.recordBenchmarkIndexBatchPreparedDocuments(preparedDocuments);
		const journalEntries: CoverageLexicalV2IndexStoreJournalEntry[] = [];
		const coldWrites: CoverageLexicalBodyTokenColdDocumentWrite[] = [];
		const bodyHanExactWrites: CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[] = [];
		const bodyHanExactDeletes: string[] = [];
		const hotCacheDocIds: number[] = [];
		for (const preparedDocument of preparedDocuments) {
			const updatedAt = Date.now();
			const docId = this.recordBenchmarkIndexPhase(
				"replaceDocuments",
				1,
				() => this.store.replaceDocument(preparedDocument),
			);
			if (preparedDocument.bodyTokens.length > 0) {
				this.bodyTokenCacheByDocId.set(
					docId,
					this.store.getOrCreateBodyTokenIds(preparedDocument.bodyTokens),
				);
				hotCacheDocIds.push(docId);
			} else {
				this.bodyTokenCacheByDocId.delete(docId);
			}
			coldWrites.push({
				path: preparedDocument.path,
				generation: preparedDocument.generation,
				bodyTokens: preparedDocument.bodyTokens,
			});
			const bodyHanExactWrite = this.recordBenchmarkIndexPhase(
				"bodyHanExactSidecar",
				1,
				() => this.buildBodyHanExactSidecarWrite(preparedDocument),
			);
			if (bodyHanExactWrite) {
				bodyHanExactWrites.push(bodyHanExactWrite);
				if (this.benchmarkIndexTiming) {
					this.benchmarkIndexTiming.bodyHanLogicalBlockCount +=
						bodyHanExactWrite.logicalBlocks.length;
				}
			} else {
				bodyHanExactDeletes.push(preparedDocument.path);
			}
			this.deleteCachedBodyHanExact([docId]);
			if (!this.batchReindexing) {
				journalEntries.push({
					kind: "replace",
					path: preparedDocument.path,
					updatedAt,
					transaction: this.createJournalTransaction(
						`replace:${preparedDocument.path}`,
						updatedAt,
					),
					document: this.requirePersistedJournalDocument(docId),
				});
			}
		}
		this.recordBenchmarkIndexPhase(
			"compactOverlay",
			preparedDocuments.length,
			() => {
				this.store.compactOverlayIntoSegment();
			},
		);
		const coldBacked = await this.recordBenchmarkIndexPhaseAsync(
			"bodyTokenColdSidecar",
			coldWrites.length,
			async () => await this.upsertBodyTokenColdDocuments(coldWrites),
		);
		if (coldBacked) {
			this.releaseHotBodyTokenCache(hotCacheDocIds);
		}
		if (bodyHanExactDeletes.length > 0) {
			await this.recordBenchmarkIndexPhaseAsync(
				"bodyHanExactSidecar",
				bodyHanExactDeletes.length,
				async () =>
					await this.deleteBodyHanExactSidecarDocuments(bodyHanExactDeletes),
			);
		}
		await this.recordBenchmarkIndexPhaseAsync(
			"bodyHanExactSidecar",
			bodyHanExactWrites.length,
			async () =>
				await this.upsertBodyHanExactSidecarDocuments(bodyHanExactWrites),
		);
		if (!this.batchReindexing) {
			await this.recordBenchmarkIndexPhaseAsync(
				"journal",
				journalEntries.length,
				async () =>
					await this.database.appendCoverageLexicalV2IndexStoreJournalEntries(
						journalEntries,
					),
			);
		}
	}

	deleteDocuments(paths: string[]): void {
		if (paths.length === 0) {
			return;
		}
		const journalEntries: CoverageLexicalV2IndexStoreJournalEntry[] = [];
		const deletedPaths: string[] = [];
		for (const path of paths) {
			const docId = this.store.getDocumentId(path);
			if (docId === undefined) {
				continue;
			}
			const updatedAt = Date.now();
			this.store.deleteDocument(path);
			this.bodyTokenCacheByDocId.delete(docId);
			this.deleteCachedBodyHanExact([docId]);
			deletedPaths.push(path);
			if (!this.batchReindexing) {
				journalEntries.push({
					kind: "delete",
					path,
					updatedAt,
					transaction: this.createJournalTransaction(`delete:${path}`, updatedAt),
				});
			}
		}
		if (deletedPaths.length === 0) {
			return;
		}
		this.store.compactOverlayIntoSegment();
		void this.deleteBodyTokenColdDocuments(deletedPaths);
		void this.deleteBodyHanExactSidecarDocuments(deletedPaths);
		if (!this.batchReindexing) {
			void this.database.appendCoverageLexicalV2IndexStoreJournalEntries(
				journalEntries,
			);
		}
	}

	async moveDocument(oldPath: string, document: IndexedDocument): Promise<boolean> {
		const preparedDocument = buildCoverageLexicalV2PreparedDocument(
			this.tokenizer,
			document,
		);
		const updatedAt = Date.now();
		const docId = this.store.replaceDocument(preparedDocument, oldPath);
		if (preparedDocument.bodyTokens.length > 0) {
			this.bodyTokenCacheByDocId.set(
				docId,
				this.store.getOrCreateBodyTokenIds(preparedDocument.bodyTokens),
			);
		} else {
			this.bodyTokenCacheByDocId.delete(docId);
		}
		const coldBacked = await this.upsertBodyTokenColdDocuments([
			{
				path: preparedDocument.path,
				generation: preparedDocument.generation,
				bodyTokens: preparedDocument.bodyTokens,
			},
		]);
		if (coldBacked && preparedDocument.bodyTokens.length > 0) {
			this.releaseHotBodyTokenCache([docId]);
		}
		if (oldPath !== preparedDocument.path) {
			await this.deleteBodyTokenColdDocuments([oldPath]);
		}
		const bodyHanExactWrite = this.buildBodyHanExactSidecarWrite(preparedDocument);
		const bodyHanExactStore = this.getBodyHanExactSidecarStore();
		if (bodyHanExactStore) {
			if (
				bodyHanExactWrite &&
				oldPath !== preparedDocument.path &&
				(await bodyHanExactStore.moveDocument(oldPath, bodyHanExactWrite))
			) {
				// No-op: moved in-place without rewriting the payload block.
			} else {
				if (oldPath !== preparedDocument.path) {
					await this.deleteBodyHanExactSidecarDocuments([oldPath]);
				}
				if (bodyHanExactWrite) {
					await this.upsertBodyHanExactSidecarDocuments([bodyHanExactWrite]);
				} else {
					await this.deleteBodyHanExactSidecarDocuments([preparedDocument.path]);
				}
			}
		}
		this.deleteCachedBodyHanExact([docId]);
		this.store.compactOverlayIntoSegment();
		if (!this.batchReindexing) {
			await this.database.appendCoverageLexicalV2IndexStoreJournalEntries([
				{
					kind: "move",
					path: preparedDocument.path,
					previousPath: oldPath,
					updatedAt,
					transaction: this.createJournalTransaction(
						`move:${oldPath}->${preparedDocument.path}`,
						updatedAt,
					),
					document: this.requirePersistedJournalDocument(docId),
				},
			]);
		}
		return true;
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		if (this.store.getIndexedDocumentCount() === 0) {
			return [];
		}
		const queryLocalBodyHanExactCache = new Map<number, Uint32Array>();
		const result = await searchCoverageLexicalV2Engine({
			queryText: request.queryText,
			isPrefixMatch: request.isPrefixMatch,
			isFuzzy: request.isFuzzy,
			weakFilePruneMode: request.weakFilePruneMode,
			maxItemResults: request.maxItemResults,
			fuzzyProportion: 0.2,
			tokenizeQueryText: (queryText) =>
				tokenizeCoverageLexicalV2QueryText(this.tokenizer, queryText),
			storageReader: this.store.createStorageReader({
				getBodyTokenSequence: (docId) => {
					const tokenIds = this.bodyTokenCacheByDocId.get(docId);
					return tokenIds
						? this.store.decodeBodyTokenIds(tokenIds)
						: undefined;
				},
				prefetchBodyTokenSequences: async (docIds) => {
					await this.prefetchBodyTokenSequences(docIds);
				},
				prefetchBodyHanExactBlocks: async (blockIds, budget) =>
					await this.prefetchBodyHanExactBlocks(
						blockIds,
						queryLocalBodyHanExactCache,
						budget,
					),
				getBodyHanExactBlockBackstopStats: (blockId, normalizedText, bigrams) => {
					const symbolIds =
						queryLocalBodyHanExactCache.get(blockId) ??
						this.getCachedBodyHanExact(blockId);
					return symbolIds
						? this.store.buildBodyHanExactBackstopStatsFromSymbolIds(
								symbolIds,
								normalizedText,
								bigrams,
						  )
						: null;
				},
				getBodyHanExactBlockWitness: (blockId, normalizedText, bigrams) => {
					const symbolIds =
						queryLocalBodyHanExactCache.get(blockId) ??
						this.getCachedBodyHanExact(blockId);
					return symbolIds
						? this.store.buildBodyHanExactWitnessFromSymbolIds(
								symbolIds,
								normalizedText,
								bigrams,
						  )
						: null;
				},
				tokenizeText: (text) =>
					tokenizeCoverageLexicalV2DocumentText(this.tokenizer, text),
			}),
		});
		return result.matchedFiles;
	}

	async getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemCount: number,
	): Promise<FileSubItem[] | null> {
		if (!this.store.hasPath(path)) {
			return null;
		}
		const snapshotText = (
			await this.fileSnapshotStore.readCurrentTexts([path])
		).get(path);
		if (!snapshotText) {
			return null;
		}
		return buildDirectSubitemsExactFileSubItems({
			queryText,
			snapshotText,
			options: {
				maxChars: 220,
				mergeGap: 32,
				contextLeft: 24,
				contextRight: 40,
				boundaryLookaround: 24,
			},
		}).slice(0, maxSubItemCount);
	}

	getIndexedDocumentCount(): number {
		return this.store.getIndexedDocumentCount();
	}

	serialize(): SerializedFileSearchIndex | null {
		return {
			__backend: "coverage-lexical",
			__version: 2,
			__encoding: "binary-snapshot-v2",
			data: encodeCoverageLexicalV2IndexStoreSnapshot(
				this.store.buildSnapshotState(),
			),
		};
	}

	estimateIndexBytes(): number | null {
		return this.buildRuntimeMemoryBreakdown().estimatedBytes.residentHot.total;
	}

	getIndexBreakdown(): Record<string, unknown> | null {
		return this.buildRuntimeMemoryBreakdown();
	}

	supportsPersistentFileIndex(): boolean {
		return true;
	}

	async restorePersistedFileIndex(): Promise<boolean> {
		try {
			const snapshot = await this.database.readCoverageLexicalV2IndexStoreSnapshot();
			if (!snapshot) {
				return false;
			}
			this.clearIndex();
			this.store.restoreSnapshot(snapshot);
			const journal =
				await this.database.readCoverageLexicalV2IndexStoreJournalEntries();
			for (const entry of journal) {
				if (entry.kind === "replace" || entry.kind === "move") {
					this.store.replacePersistedJournalDocument(
						entry.document,
						entry.previousPath,
					);
					continue;
				}
				const docId = this.store.getDocumentId(entry.path);
				if (docId !== undefined) {
					this.store.deleteDocument(entry.path);
					this.bodyTokenCacheByDocId.delete(docId);
				}
			}
			this.store.compactOverlayIntoSegment(true);
			return true;
		} catch {
			this.clearIndex();
			return false;
		}
	}

	async planPersistentRecovery(
		currentIndexedRefs: readonly BaseIndexedFileRef[],
	): Promise<PersistentFileIndexRecoveryPlan> {
		const persistedIndexedRefs =
			(await this.database.getLexicalIndexedFileRefs()) ?? [];
		const coldConsistency = await this.getBodyTokenColdStore()?.inspectConsistency(
			currentIndexedRefs,
		);
		const hanExactConsistency =
			await this.getBodyHanExactSidecarStore()?.summarizeConsistency(
				currentIndexedRefs,
			);
		if (
			this.store.getIndexedDocumentCount() === 0 &&
			persistedIndexedRefs.length > 0
		) {
			return {
				status: "needs_full_rebuild",
				reason: "missing_snapshot",
				docsToDelete: [],
				docsToAdd: [],
				docsToUpdate: [],
				docsToMove: [],
			};
		}
		if (coldConsistency?.requiresReset || hanExactConsistency?.requiresReset) {
			return {
				status: currentIndexedRefs.length === 0 ? "up_to_date" : "needs_heal",
				reason:
					currentIndexedRefs.length === 0 ? "up_to_date" : "cold_sidecar_drift",
				docsToDelete: [],
				docsToAdd: [],
				docsToUpdate: currentIndexedRefs.map((ref) => ref.path),
				docsToMove: [],
			};
		}
		return planCoverageLexicalV2PersistentRecovery({
			currentIndexedRefs,
			persistedIndexedRefs,
			storeIndexedRefs: this.store.getIndexedRefs(),
			structuralInvalidityReason: this.store.getStructuralInvalidityReason() ?? undefined,
			coldConsistency,
			hanExactConsistency,
		});
	}

	async persistFileIndexArtifact(): Promise<void> {
		this.store.compactOverlayIntoSegment(true);
		await this.database.writeCoverageLexicalV2IndexStoreSnapshot(
			this.store.buildSnapshotState(),
			{
				snapshotDocumentCount: this.store.getIndexedDocumentCount(),
				updatedAt: Date.now(),
			},
		);
	}

	async clearPersistedFileIndexArtifact(): Promise<void> {
		await this.database.clearCoverageLexicalV2IndexStorePersistence();
	}

	buildBodyTokenColdDocument(
		path: string,
		generation: number | undefined,
		bodyText: string,
	): CoverageLexicalBodyTokenColdDocumentWrite {
		return {
			path,
			generation,
			bodyTokens: tokenizeCoverageLexicalV2DocumentText(this.tokenizer, bodyText),
		};
	}

	buildBodyHanExactSidecarDocument(
		path: string,
		generation: number | undefined,
		bodyText: string,
	): CoverageLexicalV2HanSegmentExactSidecarDocumentWrite | null {
		return this.buildBodyHanExactSidecarWrite(
			buildCoverageLexicalV2PreparedDocument(this.tokenizer, {
				path,
				generation,
				content: bodyText,
				basename: "",
				folder: "",
				aliases: "",
				tags: "",
				headings: "",
			}),
		);
	}

	private async prefetchBodyTokenSequences(docIds: readonly number[]): Promise<void> {
		const coldStore = this.getBodyTokenColdStore();
		if (!coldStore) {
			return;
		}
		const missingDocIds = docIds.filter(
			(docId) => !this.bodyTokenCacheByDocId.has(docId),
		);
		if (missingDocIds.length === 0) {
			return;
		}
		const paths = missingDocIds.flatMap((docId) => {
			const path = this.store.getDocumentPath(docId);
			return path ? [path] : [];
		});
		if (paths.length === 0) {
			return;
		}
		const documents = await coldStore.readDocuments(paths);
		for (const docId of missingDocIds) {
			const path = this.store.getDocumentPath(docId);
			if (!path) {
				continue;
			}
			const stored = documents.get(path);
			if (stored) {
				this.bodyTokenCacheByDocId.set(
					docId,
					this.store.getOrCreateBodyTokenIds(stored.bodyTokens),
				);
			}
		}
	}

	private async prefetchBodyHanExactBlocks(
		blockIds: readonly number[],
		queryLocalCache: Map<number, Uint32Array>,
		budget: CoverageLexicalV2CandidateCascadeHanExactPrefetchBudget,
	): Promise<{
		fetchedBlockIds: readonly number[];
		fetchedBlockCount: number;
		byteSum: number;
		skippedByBudget: number;
		skippedReason: "none" | "block_budget" | "byte_budget" | "time_budget";
		blockResults: readonly CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult[];
	}> {
		const coldStore = this.getBodyHanExactSidecarStore();
		if (!coldStore || blockIds.length === 0) {
			return {
				fetchedBlockIds: [],
				fetchedBlockCount: 0,
				byteSum: 0,
				skippedByBudget: 0,
				skippedReason: "none",
				blockResults: blockIds.map((blockId) => {
					const descriptor = this.store.getBodyHanLogicalBlockDescriptor(blockId);
					return {
					blockId,
					docId: descriptor?.docId ?? null,
					path: descriptor?.path ?? null,
					blockOrdinal: descriptor?.blockOrdinal ?? null,
					status: "cold_store_unavailable",
					estimatedBytes: descriptor?.encodedByteLength ?? null,
					segmentCount: descriptor?.segmentCount ?? null,
					symbolCount: descriptor?.symbolCount ?? null,
				};
				}),
			};
		}
		const deadline = Date.now() + Math.max(0, budget.timeBudgetMs);
		const fetchedBlockIds: number[] = [];
		const requestsToFetch: Array<{ blockId: number; path: string; blockOrdinal: number }> = [];
		const blockResultsById = new Map<
			number,
			CoverageLexicalV2CandidateCascadeHanExactPrefetchDocResult
		>();
		let budgetedByteSum = 0;
		const budgetedByteSumByDocId = new Map<number, number>();
		let byteSum = 0;
		let skippedReason: "none" | "block_budget" | "byte_budget" | "time_budget" = "none";
		let skippedByBudget = 0;
		const setBlockResult = (
			blockId: number,
			docId: number | null,
			path: string | null,
			status: CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus,
			blockOrdinal: number | null,
			estimatedBytes: number | null,
			segmentCount: number | null,
			symbolCount: number | null,
		): void => {
			blockResultsById.set(blockId, {
				blockId,
				docId,
				path,
				blockOrdinal,
				status,
				estimatedBytes,
				segmentCount,
				symbolCount,
			});
		};
		for (const blockId of blockIds) {
			const descriptor = this.store.getBodyHanLogicalBlockDescriptor(blockId);
			if (!descriptor) {
				setBlockResult(
					blockId,
					null,
					null,
					"missing_block_descriptor",
					null,
					null,
					null,
					null,
				);
				continue;
			}
			const cached = this.getCachedBodyHanExact(blockId);
			if (cached) {
				queryLocalCache.set(blockId, cached);
				fetchedBlockIds.push(blockId);
				byteSum += cached.length * 4;
				setBlockResult(
					blockId,
					descriptor.docId,
					descriptor.path,
					"cache_hit",
					descriptor.blockOrdinal,
					null,
					null,
					null,
				);
				continue;
			}
			if (!descriptor.path) {
				setBlockResult(
					blockId,
					descriptor.docId,
					null,
					"missing_path",
					descriptor.blockOrdinal,
					descriptor.encodedByteLength,
					descriptor.segmentCount,
					descriptor.symbolCount,
				);
				continue;
			}
			if (descriptor.symbolCount <= 0) {
				setBlockResult(
					blockId,
					descriptor.docId,
					descriptor.path,
					"zero_symbol_count",
					descriptor.blockOrdinal,
					descriptor.encodedByteLength,
					descriptor.segmentCount,
					descriptor.symbolCount,
				);
				continue;
			}
			if (requestsToFetch.length >= Math.max(0, budget.blockBudget)) {
				skippedReason = "block_budget";
				skippedByBudget += 1;
				setBlockResult(
					blockId,
					descriptor.docId,
					descriptor.path,
					"block_budget",
					descriptor.blockOrdinal,
					descriptor.encodedByteLength,
					descriptor.segmentCount,
					descriptor.symbolCount,
				);
				continue;
			}
			if (
				budgetedByteSum + descriptor.encodedByteLength >
				Math.max(0, budget.byteBudget)
			) {
				skippedReason = "byte_budget";
				skippedByBudget += 1;
				setBlockResult(
					blockId,
					descriptor.docId,
					descriptor.path,
					"byte_budget",
					descriptor.blockOrdinal,
					descriptor.encodedByteLength,
					descriptor.segmentCount,
					descriptor.symbolCount,
				);
				continue;
			}
			const budgetedDocByteSum =
				budgetedByteSumByDocId.get(descriptor.docId) ?? 0;
			if (
				budgetedDocByteSum + descriptor.encodedByteLength >
				Math.max(0, budget.perDocByteBudget)
			) {
				skippedReason = "byte_budget";
				skippedByBudget += 1;
				setBlockResult(
					blockId,
					descriptor.docId,
					descriptor.path,
					"byte_budget",
					descriptor.blockOrdinal,
					descriptor.encodedByteLength,
					descriptor.segmentCount,
					descriptor.symbolCount,
				);
				continue;
			}
			if (Date.now() > deadline) {
				skippedReason = "time_budget";
				skippedByBudget += 1;
				setBlockResult(
					blockId,
					descriptor.docId,
					descriptor.path,
					"time_budget",
					descriptor.blockOrdinal,
					descriptor.encodedByteLength,
					descriptor.segmentCount,
					descriptor.symbolCount,
				);
				continue;
			}
			requestsToFetch.push({
				blockId,
				path: descriptor.path,
				blockOrdinal: descriptor.blockOrdinal,
			});
			budgetedByteSum += descriptor.encodedByteLength;
			budgetedByteSumByDocId.set(
				descriptor.docId,
				budgetedDocByteSum + descriptor.encodedByteLength,
			);
		}
		if (requestsToFetch.length > 0) {
			const logicalBlocks = await coldStore.readLogicalBlocks(
				requestsToFetch.map((request) => ({
					path: request.path,
					blockOrdinal: request.blockOrdinal,
				})),
			);
			const missingRequests = requestsToFetch.filter(
				(request) =>
					!logicalBlocks.has(
						this.getBodyHanExactLogicalBlockLookupKey(
							request.path,
							request.blockOrdinal,
						),
					),
			);
			const missingDiagnostics =
				missingRequests.length > 0
					? await this.diagnoseMissingBodyHanExactLogicalBlocks(missingRequests)
					: new Map<
							string,
							{
								status: CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus;
								estimatedBytes: number | null;
								segmentCount: number | null;
								symbolCount: number | null;
							}
					  >();
			for (const request of requestsToFetch) {
				const descriptor = this.store.getBodyHanLogicalBlockDescriptor(request.blockId);
				const lookupKey = this.getBodyHanExactLogicalBlockLookupKey(
					request.path,
					request.blockOrdinal,
				);
				const stored = logicalBlocks.get(lookupKey);
				if (!stored || !descriptor) {
					const diagnosis = missingDiagnostics.get(lookupKey);
					setBlockResult(
						request.blockId,
						descriptor?.docId ?? null,
						request.path,
						diagnosis?.status ?? "read_miss",
						request.blockOrdinal,
						diagnosis?.estimatedBytes ?? descriptor?.encodedByteLength ?? null,
						diagnosis?.segmentCount ?? descriptor?.segmentCount ?? null,
						diagnosis?.symbolCount ?? descriptor?.symbolCount ?? null,
					);
					continue;
				}
				const symbolIds = Uint32Array.from(stored.bodyHanSymbolIds);
				queryLocalCache.set(request.blockId, symbolIds);
				this.setCachedBodyHanExact(request.blockId, symbolIds);
				fetchedBlockIds.push(request.blockId);
				byteSum += symbolIds.length * 4;
				setBlockResult(
					request.blockId,
					descriptor.docId,
					request.path,
					"fetched",
					request.blockOrdinal,
					symbolIds.length * 4,
					stored.segmentCount,
					stored.symbolCount,
				);
			}
		}
		return {
			fetchedBlockIds,
			fetchedBlockCount: fetchedBlockIds.length,
			byteSum,
			skippedByBudget,
			skippedReason,
			blockResults: blockIds.map(
				(blockId) => {
					const descriptor = this.store.getBodyHanLogicalBlockDescriptor(blockId);
					return (
					blockResultsById.get(blockId) ?? {
						blockId,
						docId: descriptor?.docId ?? null,
						path: descriptor?.path ?? null,
						blockOrdinal: descriptor?.blockOrdinal ?? null,
						status: "read_miss",
						estimatedBytes: descriptor?.encodedByteLength ?? null,
						segmentCount: descriptor?.segmentCount ?? null,
						symbolCount: descriptor?.symbolCount ?? null,
					}
					);
				},
			),
		};
	}

	private async diagnoseMissingBodyHanExactLogicalBlocks(
		requests: readonly {
			blockId: number;
			path: string;
			blockOrdinal: number;
		}[],
	): Promise<
		Map<
			string,
			{
				status: CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus;
				estimatedBytes: number | null;
				segmentCount: number | null;
				symbolCount: number | null;
			}
		>
	> {
		const uniqueRequests = Array.from(
			new Map(
				requests.map((request) => [
					this.getBodyHanExactLogicalBlockLookupKey(
						request.path,
						request.blockOrdinal,
					),
					request,
				]),
			).values(),
		);
		const diagnoses = new Map<
			string,
			{
				status: CoverageLexicalV2CandidateCascadeHanExactPrefetchDocStatus;
				estimatedBytes: number | null;
				segmentCount: number | null;
				symbolCount: number | null;
			}
		>();
		if (uniqueRequests.length === 0) {
			return diagnoses;
		}
		const meta = await this.database.db.lexicalV2HanSegmentExactSidecarMeta.get(
			COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_META_ID,
		);
		if (!meta) {
			for (const request of uniqueRequests) {
				diagnoses.set(
					this.getBodyHanExactLogicalBlockLookupKey(
						request.path,
						request.blockOrdinal,
					),
					{
					status: "sidecar_meta_missing",
					estimatedBytes: null,
					segmentCount: null,
					symbolCount: null,
				},
				);
			}
			return diagnoses;
		}
		if (meta.schemaVersion !== 3) {
			for (const request of uniqueRequests) {
				diagnoses.set(
					this.getBodyHanExactLogicalBlockLookupKey(
						request.path,
						request.blockOrdinal,
					),
					{
					status: "sidecar_schema_mismatch",
					estimatedBytes: null,
					segmentCount: null,
					symbolCount: null,
				},
				);
			}
			return diagnoses;
		}
		const [logicalBlockRows, docSummariesByPath, indexedRefsByPath] = await Promise.all([
			this.database.db.lexicalV2HanSegmentExactSidecarLogicalBlocks
				.where("[path+blockOrdinal]")
				.anyOf(
					uniqueRequests.map((request) => [request.path, request.blockOrdinal]),
				)
				.toArray(),
			this.database.db.lexicalV2HanSegmentExactSidecarDocs.bulkGet(
				Array.from(new Set(uniqueRequests.map((request) => request.path))),
			),
			this.database.db.lexicalIndexedFileRefs.bulkGet(
				Array.from(new Set(uniqueRequests.map((request) => request.path))),
			),
		]);
		const logicalBlockRowByLookupKey = new Map(
			logicalBlockRows.map((logicalBlockRow) => [
				this.getBodyHanExactLogicalBlockLookupKey(
					logicalBlockRow.path,
					logicalBlockRow.blockOrdinal,
				),
				logicalBlockRow,
			] as const),
		);
		const docSummaryByPath = new Map(
			Array.from(new Set(uniqueRequests.map((request) => request.path))).flatMap(
				(path, index) =>
					docSummariesByPath[index]
						? [[path, docSummariesByPath[index]] as const]
						: [],
			),
		);
		const indexedRefByPath = new Map(
			Array.from(new Set(uniqueRequests.map((request) => request.path))).flatMap(
				(path, index) =>
					indexedRefsByPath[index] ? [[path, indexedRefsByPath[index]] as const] : [],
			),
		);
		const candidateStorageBlockIds = Array.from(
			new Set(
				logicalBlockRows.flatMap((logicalBlockRow) =>
					logicalBlockRow && logicalBlockRow.epoch === meta.epoch
						? [logicalBlockRow.storageBlockId]
						: [],
				),
			),
		);
		const storageBlockRows =
			candidateStorageBlockIds.length > 0
				? await this.database.db.lexicalV2HanSegmentExactSidecarBlocks.bulkGet(
						candidateStorageBlockIds,
				  )
				: [];
		const storageBlockIds = new Set(
			storageBlockRows.flatMap((storageBlockRow) =>
				storageBlockRow ? [storageBlockRow.id] : [],
			),
		);
		for (const request of uniqueRequests) {
			const lookupKey = this.getBodyHanExactLogicalBlockLookupKey(
				request.path,
				request.blockOrdinal,
			);
			const logicalBlockRow = logicalBlockRowByLookupKey.get(lookupKey);
			const docSummary = docSummaryByPath.get(request.path);
			const indexedRef = indexedRefByPath.get(request.path);
			if (!docSummary) {
				diagnoses.set(lookupKey, {
					status: "sidecar_doc_summary_missing",
					estimatedBytes: null,
					segmentCount: null,
					symbolCount: null,
				});
				continue;
			}
			if (!indexedRef) {
				diagnoses.set(lookupKey, {
					status: "sidecar_generation_mismatch",
					estimatedBytes: null,
					segmentCount: docSummary.segmentCount,
					symbolCount: docSummary.symbolCount,
				});
				continue;
			}
			if (docSummary.epoch !== meta.epoch) {
				diagnoses.set(lookupKey, {
					status: "sidecar_epoch_mismatch",
					estimatedBytes: docSummary.symbolCount * 4,
					segmentCount: docSummary.segmentCount,
					symbolCount: docSummary.symbolCount,
				});
				continue;
			}
			if (docSummary.generation !== indexedRef.generation) {
				diagnoses.set(lookupKey, {
					status: "sidecar_generation_mismatch",
					estimatedBytes: docSummary.symbolCount * 4,
					segmentCount: docSummary.segmentCount,
					symbolCount: docSummary.symbolCount,
				});
				continue;
			}
			if (!logicalBlockRow) {
				diagnoses.set(lookupKey, {
					status: "sidecar_logical_block_missing",
					estimatedBytes: null,
					segmentCount: null,
					symbolCount: null,
				});
				continue;
			}
			if (logicalBlockRow.epoch !== meta.epoch) {
				diagnoses.set(lookupKey, {
					status: "sidecar_epoch_mismatch",
					estimatedBytes: logicalBlockRow.symbolCount * 4,
					segmentCount: logicalBlockRow.segmentCount,
					symbolCount: logicalBlockRow.symbolCount,
				});
				continue;
			}
			if (logicalBlockRow.generation !== indexedRef.generation) {
				diagnoses.set(lookupKey, {
					status: "sidecar_generation_mismatch",
					estimatedBytes: logicalBlockRow.symbolCount * 4,
					segmentCount: logicalBlockRow.segmentCount,
					symbolCount: logicalBlockRow.symbolCount,
				});
				continue;
			}
			if (!storageBlockIds.has(logicalBlockRow.storageBlockId)) {
				diagnoses.set(lookupKey, {
					status: "sidecar_storage_block_missing",
					estimatedBytes: logicalBlockRow.symbolCount * 4,
					segmentCount: logicalBlockRow.segmentCount,
					symbolCount: logicalBlockRow.symbolCount,
				});
				continue;
			}
			diagnoses.set(lookupKey, {
				status: "read_miss",
				estimatedBytes: logicalBlockRow.symbolCount * 4,
				segmentCount: logicalBlockRow.segmentCount,
				symbolCount: logicalBlockRow.symbolCount,
			});
		}
		return diagnoses;
	}

	private buildRuntimeMemoryBreakdown(): CoverageLexicalV2RuntimeMemoryBreakdown {
		const hotCacheEstimate = this.estimateBodyTokenHotCacheBytes();
		return this.store.buildIndexBreakdown({
			bodyTokensHotBytes: hotCacheEstimate.bytes,
			bodyTokensHotVsSidecarBytes: hotCacheEstimate.overlapBytes,
		});
	}

	private estimateBodyTokenHotCacheBytes(): {
		bytes: number;
		overlapBytes: number;
	} {
		let bytes = 0;
		for (const bodyTokenIds of this.bodyTokenCacheByDocId.values()) {
			bytes += estimateCoverageLexicalV2BodyTokenIdSequenceBytes(bodyTokenIds);
		}
		return {
			bytes,
			overlapBytes: bytes,
		};
	}

	private releaseHotBodyTokenCache(docIds: readonly number[]): void {
		for (const docId of docIds) {
			this.bodyTokenCacheByDocId.delete(docId);
		}
	}

	private getCachedBodyHanExact(blockId: number): Uint32Array | undefined {
		const cacheKey = this.getBodyHanExactCacheKey(blockId);
		if (!cacheKey) {
			return undefined;
		}
		const cached = this.bodyHanExactCacheByDocKey.get(cacheKey);
		if (!cached) {
			return undefined;
		}
		this.bodyHanExactCacheByDocKey.delete(cacheKey);
		this.bodyHanExactCacheByDocKey.set(cacheKey, cached);
		return cached;
	}

	private setCachedBodyHanExact(blockId: number, symbolIds: Uint32Array): void {
		const cacheKey = this.getBodyHanExactCacheKey(blockId);
		if (!cacheKey) {
			return;
		}
		const cacheBytes = symbolIds.byteLength;
		const existing = this.bodyHanExactCacheByDocKey.get(cacheKey);
		if (existing) {
			this.bodyHanExactCacheByDocKey.delete(cacheKey);
			this.bodyHanExactCacheBytes = Math.max(
				0,
				this.bodyHanExactCacheBytes - existing.byteLength,
			);
		}
		if (
			cacheBytes >
			CoverageLexicalV2FileSearchEngine.BODY_HAN_EXACT_CACHE_MAX_BYTES
		) {
			return;
		}
		this.bodyHanExactCacheByDocKey.set(cacheKey, symbolIds);
		this.bodyHanExactCacheBytes += cacheBytes;
		while (
			this.bodyHanExactCacheByDocKey.size >
				CoverageLexicalV2FileSearchEngine.BODY_HAN_EXACT_CACHE_MAX_BLOCKS ||
			this.bodyHanExactCacheBytes >
				CoverageLexicalV2FileSearchEngine.BODY_HAN_EXACT_CACHE_MAX_BYTES
		) {
			const oldestKey = this.bodyHanExactCacheByDocKey.keys().next().value;
			if (!oldestKey) {
				break;
			}
			const oldest = this.bodyHanExactCacheByDocKey.get(oldestKey);
			this.bodyHanExactCacheByDocKey.delete(oldestKey);
			this.bodyHanExactCacheBytes = Math.max(
				0,
				this.bodyHanExactCacheBytes - (oldest?.byteLength ?? 0),
			);
		}
	}

	private deleteCachedBodyHanExact(docIds: readonly number[]): void {
		const targetDocIds = new Set(docIds);
		for (const [cacheKey] of this.bodyHanExactCacheByDocKey) {
			const docId = Number(cacheKey.split(":", 1)[0]);
			if (targetDocIds.has(docId)) {
				const cached = this.bodyHanExactCacheByDocKey.get(cacheKey);
				this.bodyHanExactCacheByDocKey.delete(cacheKey);
				this.bodyHanExactCacheBytes = Math.max(
					0,
					this.bodyHanExactCacheBytes - (cached?.byteLength ?? 0),
				);
			}
		}
	}

	private getBodyHanExactCacheKey(blockId: number): string | null {
		const descriptor = this.store.getBodyHanLogicalBlockDescriptor(blockId);
		if (!descriptor) {
			return null;
		}
		return `${descriptor.docId}:${descriptor.generation ?? -1}:${descriptor.blockOrdinal}`;
	}

	private getBodyHanExactLogicalBlockLookupKey(
		path: string,
		blockOrdinal: number,
	): string {
		return `${path}#${blockOrdinal}`;
	}

	private getBodyTokenColdStore(): CoverageLexicalBodyTokenColdStoreApi | null {
		if (this.bodyTokenColdStore !== undefined) {
			return this.bodyTokenColdStore;
		}
		if (!container.isRegistered(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, false)) {
			this.bodyTokenColdStore = null;
			return this.bodyTokenColdStore;
		}
		this.bodyTokenColdStore =
			container.resolve<CoverageLexicalBodyTokenColdStoreApi>(
				COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
			);
		return this.bodyTokenColdStore;
	}

	private getBodyHanExactSidecarStore():
		| CoverageLexicalV2HanSegmentExactSidecarStoreApi
		| null {
		if (this.bodyHanSegmentExactSidecarStore !== undefined) {
			return this.bodyHanSegmentExactSidecarStore;
		}
		if (
			!container.isRegistered(
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
				false,
			)
		) {
			this.bodyHanSegmentExactSidecarStore = null;
			return this.bodyHanSegmentExactSidecarStore;
		}
		this.bodyHanSegmentExactSidecarStore =
			container.resolve<CoverageLexicalV2HanSegmentExactSidecarStoreApi>(
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
			);
		return this.bodyHanSegmentExactSidecarStore;
	}

	private async upsertBodyTokenColdDocuments(
		documents: readonly CoverageLexicalBodyTokenColdDocumentWrite[],
	): Promise<boolean> {
		const coldStore = this.getBodyTokenColdStore();
		if (!coldStore || documents.length === 0) {
			return false;
		}
		await coldStore.upsertDocuments(documents);
		return true;
	}

	private async deleteBodyTokenColdDocuments(paths: readonly string[]): Promise<void> {
		const coldStore = this.getBodyTokenColdStore();
		if (!coldStore || paths.length === 0) {
			return;
		}
		await coldStore.deleteDocuments(paths);
	}

	private async upsertBodyHanExactSidecarDocuments(
		documents: readonly CoverageLexicalV2HanSegmentExactSidecarDocumentWrite[],
	): Promise<void> {
		const coldStore = this.getBodyHanExactSidecarStore();
		if (!coldStore || documents.length === 0) {
			return;
		}
		await coldStore.upsertDocuments(documents);
	}

	private async deleteBodyHanExactSidecarDocuments(
		paths: readonly string[],
	): Promise<void> {
		const coldStore = this.getBodyHanExactSidecarStore();
		if (!coldStore || paths.length === 0) {
			return;
		}
		await coldStore.deleteDocuments(paths);
	}

	private buildBodyHanExactSidecarWrite(
		document: CoverageLexicalV2PreparedDocument,
	): CoverageLexicalV2HanSegmentExactSidecarDocumentWrite | null {
		const logicalBlocks = this.store.getOrCreateBodyHanLogicalBlockWrites(
			document.bodyHanSegments,
		);
		if (logicalBlocks.length === 0) {
			return null;
		}
		return {
			path: document.path,
			generation: document.generation,
			logicalBlocks,
		};
	}

	private createJournalTransaction(seed: string, updatedAt: number) {
		this.journalTransactionOrdinal += 1;
		return {
			transactionId: `${updatedAt}:${this.journalTransactionOrdinal}:${seed}`,
		};
	}

	private requirePersistedJournalDocument(
		docId: number,
	): CoverageLexicalV2PersistedJournalDocument {
		const document = this.store.buildPersistedJournalDocument(docId);
		if (!document) {
			throw new Error(
				`Missing persisted journal document for coverage lexical V2 doc ${docId}`,
			);
		}
		return document;
	}

	private recordBenchmarkIndexBatchPreparedDocuments(
		documents: readonly CoverageLexicalV2PreparedDocument[],
	): void {
		if (!this.benchmarkIndexTiming) {
			return;
		}
		this.benchmarkIndexTiming.batchCount += 1;
		this.benchmarkIndexTiming.documentCount += documents.length;
		for (const document of documents) {
			this.benchmarkIndexTiming.bodyTokenCount += document.bodyTokens.length;
			this.benchmarkIndexTiming.bodyHanSegmentCount +=
				document.bodyHanSegments.length;
			for (const fieldTerms of Object.values(document.exactTermsByField)) {
				this.benchmarkIndexTiming.exactTermCount += fieldTerms.length;
			}
			for (const bigrams of Object.values(document.metadataHanBigramsByField)) {
				this.benchmarkIndexTiming.metadataHanBigramCount += bigrams.length;
			}
		}
	}

	private recordBenchmarkIndexPhase<Result>(
		phase: CoverageLexicalV2BenchmarkIndexPhaseName,
		unitCount: number,
		work: () => Result,
	): Result {
		if (!this.benchmarkIndexTiming) {
			return work();
		}
		const startedAt = performance.now();
		try {
			return work();
		} finally {
			recordCoverageLexicalV2BenchmarkIndexPhase(
				this.benchmarkIndexTiming,
				phase,
				performance.now() - startedAt,
				unitCount,
			);
		}
	}

	private async recordBenchmarkIndexPhaseAsync<Result>(
		phase: CoverageLexicalV2BenchmarkIndexPhaseName,
		unitCount: number,
		work: () => Promise<Result>,
	): Promise<Result> {
		if (!this.benchmarkIndexTiming) {
			return await work();
		}
		const startedAt = performance.now();
		try {
			return await work();
		} finally {
			recordCoverageLexicalV2BenchmarkIndexPhase(
				this.benchmarkIndexTiming,
				phase,
				performance.now() - startedAt,
				unitCount,
			);
		}
	}
}

export function buildCoverageLexicalV2PreparedDocument(
	tokenizer: Tokenizer,
	document: IndexedDocument,
): CoverageLexicalV2PreparedDocument {
	const basenameText = document.basename ?? "";
	const folderText = document.folder ?? "";
	const aliasesText = document.aliases ?? "";
	const tagsText = document.tags ?? "";
	const headingsText = document.headings ?? "";
	const bodyText = document.content ?? "";
	const bodyTokens = tokenizeCoverageLexicalV2DocumentText(tokenizer, bodyText);
	return {
		path: document.path,
		generation: document.generation,
		indexedRef: {
			path: document.path,
			generation: document.generation ?? 0,
			size: document.size,
		},
		record: {
			path: document.path,
			stableDeterministicKey: document.path,
			basenameText,
			aliasesText,
			headingsText,
			folderText,
			tagsText,
		},
		exactTermsByField: {
			basename: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, basenameText),
			),
			aliases: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, aliasesText),
			),
			headings: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, headingsText),
			),
			folder: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, folderText),
			),
			tag: dedupeCoverageLexicalV2Terms(
				tokenizeCoverageLexicalV2DocumentText(tokenizer, tagsText),
			),
			body: dedupeCoverageLexicalV2Terms(bodyTokens),
		},
		metadataHanBigramsByField: {
			basename: dedupeCoverageLexicalV2Terms(extractHanBigrams(basenameText)),
			aliases: dedupeCoverageLexicalV2Terms(extractHanBigrams(aliasesText)),
			headings: dedupeCoverageLexicalV2Terms(extractHanBigrams(headingsText)),
			folder: dedupeCoverageLexicalV2Terms(extractHanBigrams(folderText)),
			tag: dedupeCoverageLexicalV2Terms(
				splitCoverageLexicalTagValues(tagsText).flatMap((tagValue) =>
					extractHanBigrams(tagValue),
				),
			),
		},
		bodyHanSegments: extractHanSegments(bodyText),
		bodyTokens,
	};
}

function dedupeCoverageLexicalV2Terms(terms: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const term of terms) {
		if (term.length === 0 || seen.has(term)) {
			continue;
		}
		seen.add(term);
		out.push(term);
	}
	return out;
}

function tokenizeCoverageLexicalV2DocumentText(
	tokenizer: Tokenizer,
	text: string,
): string[] {
	return tokenizer
		.tokenizeSequence(text, "index")
		.map((term) => term.toLowerCase());
}

function tokenizeCoverageLexicalV2QueryText(
	tokenizer: Tokenizer,
	text: string,
): string[] {
	return tokenizer
		.tokenizeSequence(text, "search")
		.map((term) => term.toLowerCase());
}

function isSerializedCoverageLexicalBinarySnapshot(
	data: unknown,
): data is SerializedCoverageLexicalBinarySnapshot {
	if (!data || typeof data !== "object") {
		return false;
	}
	return (
		(data as Record<string, unknown>).__backend === "coverage-lexical" &&
		(data as Record<string, unknown>).__version === 2 &&
		(data as Record<string, unknown>).__encoding === "binary-snapshot-v2" &&
		(data as Record<string, unknown>).data instanceof ArrayBuffer
	);
}

export const COVERAGE_LEXICAL_V2_PERSISTENT_ENGINE_METHODS = {
	supportsPersistentFileIndex: true,
	metaId: COVERAGE_LEXICAL_V2_INDEX_STORE_META_ID,
} as const;

function createCoverageLexicalV2BenchmarkIndexTimingState(): CoverageLexicalV2BenchmarkIndexTimingState {
	return {
		batchCount: 0,
		documentCount: 0,
		bodyTokenCount: 0,
		exactTermCount: 0,
		metadataHanBigramCount: 0,
		bodyHanSegmentCount: 0,
		bodyHanLogicalBlockCount: 0,
		phases: new Map(),
	};
}

function recordCoverageLexicalV2BenchmarkIndexPhase(
	state: CoverageLexicalV2BenchmarkIndexTimingState,
	phase: CoverageLexicalV2BenchmarkIndexPhaseName,
	durationMs: number,
	unitCount: number,
): void {
	const current = state.phases.get(phase) ?? {
		totalMs: 0,
		maxMs: 0,
		count: 0,
		unitCount: 0,
	};
	current.totalMs += durationMs;
	current.maxMs = Math.max(current.maxMs, durationMs);
	current.count += 1;
	current.unitCount += Math.max(0, unitCount);
	state.phases.set(phase, current);
}
