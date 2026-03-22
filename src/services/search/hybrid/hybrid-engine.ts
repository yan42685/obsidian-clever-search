import { OuterSetting } from 'src/globals/plugin-setting';
import { EngineType, FileItem, FileSubItem } from 'src/globals/search-types';
import type { LocaleKey } from 'src/services/obsidian/translations/locale-helper';
import { Database } from 'src/services/database/database';
import { DataProvider } from 'src/services/obsidian/user-data/data-provider';
import { Tokenizer } from 'src/services/search/tokenizer';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import {
	buildLineOffsets,
	buildRawChunkFromOffsets,
	chunkFile,
	chunkFileRange,
	createChunkContextBuilderFromOutline,
	createChunkEmbeddingInputBuilder,
} from './chunker';
import { BM25Engine } from './bm25';
import {
	Embedder,
	estimateTextsTokenUsage,
	NoApiKeyError,
	recordEstimatedTokenSavings,
	WeeklyTokenLimitExceededError,
} from './embedder';
import { HnswIndex } from './hnsw';
import {
	computeUnchangedOffsetBlocks,
	hashStableText,
} from './incremental-reuse';
import {
	blobToBm25,
	blobToHnsw,
	ChunkVectorShardBuilder,
	bm25ToBlob,
	chunkVectorShardToRow,
	type HybridFileSnapshotRow,
	type HybridIndexedFileRef,
	type ChunkRow,
	type ChunkVectorShardRow,
	chunkToRow,
	getBm25BlobVersion,
	hnswToBlob,
	rowToChunk,
	rowToChunkVectorShard,
	shardToChunkVectorRecords,
} from './hybrid-store';
import type {
	Chunk,
	HeadingOutlineEntry,
	RawChunk,
	StoredVector,
	VectorPrecision,
} from './hybrid-types';
import { buildHybridQueryProfile, type RankedResult } from './ranking';
import { HybridReranker, SEARCH_EMBED_TOKEN_KEY, type RerankCandidate } from './reranker';
import { EMBED_DIM } from './hybrid-types';
import {
	profileHybridStage,
	recordHybridProfileMetric,
} from './hybrid-profiler';
import {
	analyzeHybridStoredFileConsistency,
} from './hybrid-consistency';

const BM25_RECALL_LIMIT = 20;
const DENSE_RECALL_LIMIT = 30;
const SEARCH_EF = 80;
const HYBRID_BM25_USE_PROXIMITY = false;
const HYBRID_BM25_ENABLE_QUERY_EXPANSION = true;
const DEFAULT_MAX_FILE_RESULTS = 10;
const MIN_FILE_RESULTS = 1;
const MAX_FILE_RESULTS = 50;
const INDEX_CHUNK_BATCH_SIZE = 24;
const HNSW_HYDRATE_SHARD_BATCH_SIZE = 8;

type HybridWriteOption = {
	persistIndices?: boolean;
	deleteIndexedFileRef?: boolean;
};

type HybridIndexMode = 'full' | 'without-embedding';

type Bm25OnlyIndexedFileRefMeta = {
	lastErrorKind: string | null;
	lastIncrementalEmbedAt?: number;
	embeddingDeferred?: boolean;
};

type SmallChunkCandidate = {
	id: number;
	filePath: string;
	text: string;
	rerankText: string;
	row: number;
	col: number;
	score: number;
};

type StoredFileIndexState = {
	snapshot?: HybridFileSnapshotRow;
	chunkRows: ChunkRow[];
	vectorsByChunkId: Map<number, StoredVector>;
	vectorGeneration?: number;
	vectorChunkCount?: number;
	vectorPrecision?: VectorPrecision | null;
};

type PlannedChunk = {
	rawChunk: RawChunk;
	embedKey: string;
	reusedVector?: StoredVector;
};

export class HybridEngine {
	private readonly db = getInstance(Database);
	private readonly setting = getInstance(OuterSetting);
	private readonly dataProvider = getInstance(DataProvider);
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly embedder = new Embedder();
	private readonly reranker = new HybridReranker();
	private readonly bm25 = new BM25Engine();
	private readonly hnswSmall = new HnswIndex();

	private _ready = false;
	private _canSearch = false;
	private lastIndexingFallbackNoticeKey: LocaleKey | null = null;
	private lastSearchFallbackNoticeKey: LocaleKey | null = null;
	private readonly fileWriteLocks = new Map<string, Promise<void>>();

	private get precision(): VectorPrecision {
		return this.setting.hybrid.vectorCompression === 'float16' ? 'float16' : 'int8';
	}

	private get defaultResultCount(): number {
		const configured = this.setting.hybrid.maxResultCount;
		if (!Number.isFinite(configured)) {
			return DEFAULT_MAX_FILE_RESULTS;
		}
		return Math.min(
			MAX_FILE_RESULTS,
			Math.max(MIN_FILE_RESULTS, Math.round(configured)),
		);
	}

	async load(): Promise<void> {
		this.hnswSmall.clear(this.precision);
		await Promise.all([
			profileHybridStage('startup.load_bm25', async () => await this.loadBm25()),
			profileHybridStage('startup.load_hnsw', async () => await this.loadHnsw()),
		]);
		this._ready = true;
	}

	async clearAll(): Promise<void> {
		this.bm25.clear();
		this.hnswSmall.clear(this.precision);
		this._ready = false;
		this._canSearch = false;
		this.lastIndexingFallbackNoticeKey = null;
		this.lastSearchFallbackNoticeKey = null;

		await Promise.all([
			this.db.db.hybridChunks.clear(),
			this.db.db.hybridFileSnapshots.clear(),
			this.db.db.hybridChunkVectors.clear(),
			this.db.db.hybridBm25Index.clear(),
			this.db.db.hybridHnswSmall.clear(),
			this.db.db.hybridIndexedFileRefs.clear(),
		]);
	}

	isEnabled(): boolean {
		return this.setting.hybrid.enabled;
	}

	isReady(): boolean { return this._ready; }
	canSearch(): boolean { return this._canSearch; }
	isEmpty(): boolean { return this.bm25.docCount === 0; }

	consumeIndexingFallbackNoticeKey(): LocaleKey | null {
		const key = this.lastIndexingFallbackNoticeKey;
		this.lastIndexingFallbackNoticeKey = null;
		return key;
	}

	consumeSearchFallbackNoticeKey(): LocaleKey | null {
		const key = this.lastSearchFallbackNoticeKey;
		this.lastSearchFallbackNoticeKey = null;
		return key;
	}

	shouldIndexPath(filePath: string): boolean {
		if (!this.isEnabled()) return false;
		return !this.isExcludedPath(filePath);
	}

	async indexFile(
		filePath: string,
		plainText: string,
		updateTime = Date.now(),
		headingOutline: HeadingOutlineEntry[] = [],
	): Promise<void> {
		await this.indexInternal(filePath, plainText, updateTime, {}, false, headingOutline);
	}

	async indexFileStrict(
		filePath: string,
		plainText: string,
		updateTime = Date.now(),
		option: HybridWriteOption = {},
		headingOutline: HeadingOutlineEntry[] = [],
	): Promise<void> {
		await this.indexInternal(
			filePath,
			plainText,
			updateTime,
			option,
			true,
			headingOutline,
			'full',
		);
	}

	async indexFileWithoutEmbedding(
		filePath: string,
		plainText: string,
		updateTime = Date.now(),
		option: HybridWriteOption = {},
		headingOutline: HeadingOutlineEntry[] = [],
	): Promise<void> {
		await this.indexInternal(
			filePath,
			plainText,
			updateTime,
			option,
			false,
			headingOutline,
			'without-embedding',
		);
	}

	async deleteFile(filePath: string, option: HybridWriteOption = {}): Promise<void> {
		await this.withFileWriteLock(filePath, async () => {
			await this.deleteStoredFileData(filePath, option);
		});
	}

	async moveFile(
		oldPath: string,
		newPath: string,
		updateTime = Date.now(),
	): Promise<boolean> {
		if (oldPath === newPath) {
			return false;
		}

		return await this.withFileWriteLocks([oldPath, newPath], async () => {
			const chunkRows = await this.db.db.hybridChunks
				.where("filePath")
				.equals(oldPath)
				.toArray();
			const snapshotRow = await this.db.db.hybridFileSnapshots.get(oldPath);
			const vectorRow = await this.db.db.hybridChunkVectors.get(oldPath);
			const indexedFileRef = await this.db.db.hybridIndexedFileRefs.get(oldPath);
			const hasStoredData =
				chunkRows.length > 0 ||
				snapshotRow !== undefined ||
				vectorRow !== undefined ||
				indexedFileRef !== undefined;
			if (!hasStoredData) {
				return false;
			}

			const hasTargetData =
				(await this.db.db.hybridChunks.where("filePath").equals(newPath).count()) > 0 ||
				(await this.db.db.hybridFileSnapshots.get(newPath)) !== undefined ||
				(await this.db.db.hybridChunkVectors.get(newPath)) !== undefined ||
				(await this.db.db.hybridIndexedFileRefs.get(newPath)) !== undefined;
			if (hasTargetData) {
				await this.deleteStoredFileData(newPath, {
					persistIndices: false,
				});
			}

			if (chunkRows.length > 0) {
				await this.db.db.hybridChunks.bulkPut(
					chunkRows.map((row) => ({
						...row,
						filePath: newPath,
					})),
				);
			}

			if (snapshotRow) {
				await this.db.db.hybridFileSnapshots.put({
					...snapshotRow,
					filePath: newPath,
				});
				await this.db.db.hybridFileSnapshots.delete(oldPath);
			}

			if (vectorRow) {
				await this.db.db.hybridChunkVectors.put({
					...vectorRow,
					filePath: newPath,
				});
				await this.db.db.hybridChunkVectors.delete(oldPath);
			}

			if (indexedFileRef) {
				// Path-only move keeps the same semantic payload and generation.
				await this.putHybridIndexedFileRef({
					...indexedFileRef,
					path: newPath,
					updateTime,
				});
				await this.db.db.hybridIndexedFileRefs.delete(oldPath);
			}

			return true;
		});
	}

	private async deleteStoredFileData(
		filePath: string,
		option: HybridWriteOption = {},
	): Promise<void> {
		const rows = await this.db.db.hybridChunks.where('filePath').equals(filePath).toArray();
		const ids = rows.map((row) => row.id!).filter((id) => id !== undefined);

		await this.db.db.hybridChunks.bulkDelete(ids);
		await this.db.db.hybridFileSnapshots.delete(filePath);
		await this.db.db.hybridChunkVectors.delete(filePath);
		if (option.deleteIndexedFileRef ?? true) {
			await this.db.db.hybridIndexedFileRefs.delete(filePath);
		}

		for (const id of ids) {
			this.bm25.removeDocument(id);
			this.hnswSmall.delete(id);
		}

		if (this.hnswSmall.needsRebuild()) {
			this.hnswSmall.rebuild();
		}
		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
	}

	async search(query: string, topK = this.defaultResultCount): Promise<FileItem[]> {
		if (!this.isEnabled() || !this._ready || !query.trim()) return [];

		const queryTokens = this.tokenizer.tokenize(query, 'search');
		const bm25Small = this.bm25.search(query, BM25_RECALL_LIMIT, {
			useProximity: HYBRID_BM25_USE_PROXIMITY,
			enableQueryExpansion: HYBRID_BM25_ENABLE_QUERY_EXPANSION,
		}).map((result) => ({
			id: result.docId,
			score: result.score,
		}));
		const queryProfile = buildHybridQueryProfile(
			query,
			queryTokens.length,
			bm25Small.length > 0,
		);
		const denseSearchEf = Math.max(SEARCH_EF, queryProfile.searchEf);

		let denseSmall: RankedResult[] = [];
		try {
			if (this._canSearch) {
				const embedded = await this.embedder.embedQuery(query, this.precision, SEARCH_EMBED_TOKEN_KEY);
				denseSmall = this.hnswSmall.search(embedded, DENSE_RECALL_LIMIT, denseSearchEf)
					.map((result) => ({ id: result.id, score: result.score }));
			}
		} catch (error) {
			logger.warn('hybrid query embedding failed; rerank will use BM25-only chunks.', error);
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
		}

		const smallCandidates = await this.loadDedupedSmallChunkCandidates([bm25Small, denseSmall]);
		if (smallCandidates.length === 0) {
			return [];
		}

		try {
			const items = await this.rerankAndBuildFileItems(query, smallCandidates, topK);
			this.lastSearchFallbackNoticeKey = null;
			return items;
		} catch (error) {
			logger.warn('hybrid rerank failed; falling back to source ordering.', error);
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
			return this.buildFileItemsFromSmallChunks(query, smallCandidates, topK);
		}
	}

	async persistIndicesForBatch(): Promise<void> {
		await this.persistIndices();
	}

	async migrateBm25StorageFormatIfNeeded(): Promise<boolean> {
		const record = await this.db.db.hybridBm25Index.get(0);
		if (!record) {
			return false;
		}
		const blobVersion = await getBm25BlobVersion(record.data);
		if (blobVersion === 4) {
			return false;
		}

		const migrated = new BM25Engine();
		migrated.deserialize(await blobToBm25(record.data));
		await this.db.db.hybridBm25Index.put({ id: 0, data: bm25ToBlob(migrated.serialize()) });
		return true;
	}

	private async indexInternal(
		filePath: string,
		plainText: string,
		updateTime: number,
		option: HybridWriteOption,
		strict: boolean,
		headingOutline: HeadingOutlineEntry[],
		mode: HybridIndexMode = 'full',
	): Promise<void> {
		await this.withFileWriteLock(filePath, async () => {
			if (!this.shouldIndexPath(filePath)) {
				await this.deleteStoredFileData(filePath, option);
				return;
			}

			const generation = Date.now();
			const previousState = await this.loadStoredFileIndexState(filePath);
			const previousIndexedFileRef = await this.db.db.hybridIndexedFileRefs.get(filePath);
			const reusableState = this.getReusableStoredFileIndexState(
				filePath,
				previousState,
				previousIndexedFileRef,
			);
			await this.putHybridIndexedFileRef({
				path: filePath,
				updateTime,
				state: 'pending',
				generation,
				chunkCount: 0,
				vectorPrecision: null,
				indexedAt: generation,
				lastErrorKind: null,
				lastIncrementalEmbedAt: previousIndexedFileRef?.lastIncrementalEmbedAt,
				embeddingDeferred: false,
			});
			await this.deleteStoredFileData(filePath, { ...option, deleteIndexedFileRef: false });

			const { chunks: rawChunks } = await profileHybridStage(
				'index.chunk_file',
				async () => chunkFile(filePath, plainText),
			);
			const buildEmbedInput = await profileHybridStage(
				'index.build_embed_context',
				async () =>
					createChunkEmbeddingInputBuilder(
						filePath,
						plainText,
						headingOutline,
					),
			);
			const lineOffsets = buildLineOffsets(plainText);
			const plannedChunks = await profileHybridStage(
				'index.plan_incremental_reuse',
				async () =>
					await this.planIncrementalChunks(
						filePath,
						plainText,
						lineOffsets,
						buildEmbedInput,
						rawChunks,
						reusableState,
					),
			);
			if (plannedChunks.length === 0) {
				await this.db.db.hybridIndexedFileRefs.delete(filePath);
				if (option.persistIndices ?? true) {
					await this.persistIndices();
				}
				return;
			}
			recordHybridProfileMetric('index.chunk_count', plannedChunks.length);

			if (mode === 'without-embedding') {
				await this.indexBm25Only(
					filePath,
					plannedChunks,
					updateTime,
					option,
					generation,
					{
						lastErrorKind: null,
						lastIncrementalEmbedAt: previousIndexedFileRef?.lastIncrementalEmbedAt,
						embeddingDeferred: true,
					},
				);
				await this.persistSnapshot(filePath, plainText, generation);
				return;
			}

			try {
				const shardBuilder = new ChunkVectorShardBuilder(this.precision, EMBED_DIM);
				for (
					let chunkStart = 0;
					chunkStart < plannedChunks.length;
					chunkStart += INDEX_CHUNK_BATCH_SIZE
				) {
					const batchChunks = plannedChunks.slice(
						chunkStart,
						chunkStart + INDEX_CHUNK_BATCH_SIZE,
					);
					const batchVectors = await this.resolveBatchVectors(
						filePath,
						batchChunks,
						buildEmbedInput,
					);
					const batchChunkIds = await profileHybridStage(
						'index.persist_chunks',
						async () =>
							await this.persistChunks(
								filePath,
								batchChunks,
								strict,
								chunkStart,
							),
					);
					shardBuilder.append(batchChunkIds, batchVectors);
					await profileHybridStage('index.update_memory_indices', async () => {
						for (let i = 0; i < batchChunkIds.length; i++) {
							const chunkId = batchChunkIds[i];
							this.bm25.addDocument(chunkId, batchChunks[i].rawChunk.text);
							this.hnswSmall.insert(chunkId, batchVectors[i]);
						}
					});
				}
				await profileHybridStage('index.persist_vector_shard', async () => {
					await this.persistVectorShard({
						...shardBuilder.build(filePath),
						generation,
					});
				});
				await this.persistSnapshot(filePath, plainText, generation);
				this._canSearch = true;
				this.lastIndexingFallbackNoticeKey = null;
			} catch (error) {
				await this.deleteStoredFileData(filePath, {
					persistIndices: false,
					deleteIndexedFileRef: false,
				});
				logger.warn(`hybrid indexing fell back to BM25 for ${filePath}`, error);
				this._canSearch = false;
				this.lastIndexingFallbackNoticeKey = 'hybridNotice.indexFallbackToBm25';
				try {
					await this.indexBm25Only(filePath, plannedChunks, updateTime, option, generation);
					await this.persistSnapshot(filePath, plainText, generation);
					await this.putHybridIndexedFileRef({
						path: filePath,
						updateTime,
						state: 'bm25_only',
						generation,
						chunkCount: plannedChunks.length,
						vectorPrecision: null,
						indexedAt: Date.now(),
						lastErrorKind: this.classifyIndexErrorKind(error),
						lastIncrementalEmbedAt: previousIndexedFileRef?.lastIncrementalEmbedAt,
						embeddingDeferred: false,
					});
					return;
				} catch (fallbackError) {
					await this.putHybridIndexedFileRef({
						path: filePath,
						updateTime,
						state: 'failed',
						generation,
						chunkCount: 0,
						vectorPrecision: null,
						indexedAt: Date.now(),
						lastErrorKind: this.classifyIndexErrorKind(fallbackError),
						lastIncrementalEmbedAt: previousIndexedFileRef?.lastIncrementalEmbedAt,
						embeddingDeferred: false,
					});
					throw fallbackError;
				}
			}

			const indexedAt = Date.now();
			if (option.persistIndices ?? true) {
				await this.persistIndices();
			}
			await this.putHybridIndexedFileRef({
				path: filePath,
				updateTime,
				state: 'ready',
				generation,
				chunkCount: plannedChunks.length,
				vectorPrecision: this.precision,
				indexedAt,
				lastErrorKind: null,
				lastIncrementalEmbedAt: indexedAt,
				embeddingDeferred: false,
			});
		});
	}

	private async loadStoredFileIndexState(
		filePath: string,
	): Promise<StoredFileIndexState> {
		const [snapshot, chunkRows, vectorRow] = await Promise.all([
			this.db.db.hybridFileSnapshots.get(filePath),
			this.db.db.hybridChunks.where('filePath').equals(filePath).sortBy('chunkIndex'),
			this.db.db.hybridChunkVectors.get(filePath),
		]);
		const vectorsByChunkId = new Map<number, StoredVector>();
		if (vectorRow && vectorRow.precision === this.precision) {
			const shard = await rowToChunkVectorShard(vectorRow);
			for (const record of shardToChunkVectorRecords(shard)) {
				vectorsByChunkId.set(record.id, record.vector);
			}
		}
		return {
			snapshot,
			chunkRows,
			vectorsByChunkId,
			vectorGeneration: vectorRow?.generation,
			vectorChunkCount: vectorRow?.chunkCount,
			vectorPrecision:
				vectorRow?.precision === this.precision ? this.precision : null,
		};
	}

	private getReusableStoredFileIndexState(
		filePath: string,
		previousState: StoredFileIndexState,
		previousIndexedFileRef: HybridIndexedFileRef | undefined,
	): StoredFileIndexState {
		const consistency = analyzeHybridStoredFileConsistency({
			existsInVault: true,
			hasChunks: previousState.chunkRows.length > 0,
			chunkCount: previousState.chunkRows.length,
			snapshot: previousState.snapshot
				? { generation: previousState.snapshot.generation }
				: undefined,
			vectorInfo:
				previousState.vectorChunkCount !== undefined &&
				previousState.vectorPrecision !== null &&
				previousState.vectorPrecision !== undefined
					? {
						precision: previousState.vectorPrecision,
						chunkCount: previousState.vectorChunkCount,
						generation: previousState.vectorGeneration,
					}
					: undefined,
			indexedFileRef: previousIndexedFileRef,
			currentPrecision: this.precision,
		});
		const inconsistencyReasons = consistency.reuseBlockedReasons;

		if (inconsistencyReasons.length === 0) {
			return previousState;
		}

		logger.debug(
			`hybrid incremental reuse ignored inconsistent local state for ${filePath}: ${inconsistencyReasons.join(', ')}`,
		);
		return {
			snapshot: undefined,
			chunkRows: [],
			vectorsByChunkId: new Map<number, StoredVector>(),
			vectorGeneration: undefined,
			vectorChunkCount: undefined,
			vectorPrecision: null,
		};
	}

	private async persistSnapshot(
		filePath: string,
		plainText: string,
		generation: number,
	): Promise<void> {
		await this.db.db.hybridFileSnapshots.put({
			filePath,
			plainText,
			generation,
		});
	}

	private async planIncrementalChunks(
		filePath: string,
		plainText: string,
		lineOffsets: number[],
		buildEmbedInput: (chunk: RawChunk) => string,
		fullChunks: RawChunk[],
		previousState: StoredFileIndexState,
	): Promise<PlannedChunk[]> {
		const basePlan = (chunks: RawChunk[]): PlannedChunk[] =>
			chunks.map((rawChunk) => {
				const embedKey = hashStableText(buildEmbedInput(rawChunk));
				return {
					rawChunk,
					embedKey,
				};
			});

		if (
			!previousState.snapshot ||
			previousState.chunkRows.length === 0
		) {
			return basePlan(fullChunks);
		}

		const oldText = previousState.snapshot.plainText;
		const unchangedBlocks = computeUnchangedOffsetBlocks(oldText, plainText);
		if (unchangedBlocks.length === 0) {
			return basePlan(fullChunks);
		}

		const reusedPlans = unchangedBlocks
			.flatMap((block) =>
				previousState.chunkRows
					.filter(
						(row) =>
							row.startOffset >= block.oldStartOffset &&
							row.endOffset <= block.oldEndOffset,
					)
					.map((row) =>
						this.reuseStoredChunk(
							row,
							plainText,
							lineOffsets,
							buildEmbedInput,
							previousState.vectorsByChunkId,
							block.newStartOffset + (row.startOffset - block.oldStartOffset),
							block.newStartOffset + (row.endOffset - block.oldStartOffset),
						),
					)
					.filter((chunk): chunk is PlannedChunk => chunk !== null),
			)
			.sort((left, right) => left.rawChunk.startOffset - right.rawChunk.startOffset);

		if (reusedPlans.length === 0) {
			return basePlan(fullChunks);
		}

		const plannedChunks: PlannedChunk[] = [];
		let cursor = 0;
		for (const chunk of reusedPlans) {
			if (cursor < chunk.rawChunk.startOffset) {
				plannedChunks.push(
					...basePlan(
						chunkFileRange(
							filePath,
							plainText,
							cursor,
							chunk.rawChunk.startOffset,
							lineOffsets,
						),
					),
				);
			}
			plannedChunks.push(chunk);
			cursor = Math.max(cursor, chunk.rawChunk.endOffset);
		}
		if (cursor < plainText.length) {
			plannedChunks.push(
				...basePlan(
					chunkFileRange(
						filePath,
						plainText,
						cursor,
						plainText.length,
						lineOffsets,
					),
				),
			);
		}

		return plannedChunks
			.filter((chunk) => chunk.rawChunk.text.trim().length > 0)
			.sort((left, right) => left.rawChunk.startOffset - right.rawChunk.startOffset);
	}

	private reuseStoredChunk(
		row: ChunkRow,
		plainText: string,
		lineOffsets: number[],
		buildEmbedInput: (chunk: RawChunk) => string,
		vectorsByChunkId: Map<number, StoredVector>,
		startOffset: number,
		endOffset: number,
	): PlannedChunk | null {
		const rawChunk = buildRawChunkFromOffsets(
			row.filePath,
			plainText,
			lineOffsets,
			startOffset,
			endOffset,
		);
		if (!rawChunk) {
			return null;
		}

		const embedKey = hashStableText(buildEmbedInput(rawChunk));
		return {
			rawChunk,
			embedKey,
			reusedVector:
				row.embedKey === embedKey && row.id !== undefined
					? vectorsByChunkId.get(row.id)
					: undefined,
		};
	}

	private async resolveBatchVectors(
		filePath: string,
		batchChunks: PlannedChunk[],
		buildEmbedInput: (chunk: RawChunk) => string,
	): Promise<StoredVector[]> {
		const vectors = new Array<StoredVector>(batchChunks.length);
		const pendingIndexes: number[] = [];
		const pendingInputs: string[] = [];
		const fullInputs = new Array<string>(batchChunks.length);

		for (let i = 0; i < batchChunks.length; i++) {
			const input = buildEmbedInput(batchChunks[i].rawChunk);
			fullInputs[i] = input;
			const reusedVector = batchChunks[i].reusedVector;
			if (reusedVector) {
				vectors[i] = reusedVector;
				continue;
			}
			pendingIndexes.push(i);
			pendingInputs.push(input);
		}

		if (pendingInputs.length > 0) {
			const embedded = await profileHybridStage(
				'index.embed_batch',
				async () =>
					await this.embedder.embedBatch(
						pendingInputs,
						this.precision,
						filePath,
					),
			);
			for (let i = 0; i < pendingIndexes.length; i++) {
				vectors[pendingIndexes[i]] = embedded[i];
			}
		}

		const savedEstimatedTokens = Math.max(
			0,
			estimateTextsTokenUsage(fullInputs) - estimateTextsTokenUsage(pendingInputs),
		);
		if (savedEstimatedTokens > 0) {
			await recordEstimatedTokenSavings(savedEstimatedTokens);
		}

		return vectors;
	}

	private async persistChunks(
		filePath: string,
		plannedChunks: PlannedChunk[],
		strict: boolean,
		chunkIndexOffset = 0,
	): Promise<number[]> {
		const rows = plannedChunks.map((chunk, index) => {
			return chunkToRow({
				id: undefined,
				filePath,
				chunkIndex: chunkIndexOffset + index,
				text: chunk.rawChunk.text,
				startOffset: chunk.rawChunk.startOffset,
				endOffset: chunk.rawChunk.endOffset,
				startLine: chunk.rawChunk.startLine,
				startCol: chunk.rawChunk.startCol,
				endLine: chunk.rawChunk.endLine,
				embedKey: chunk.embedKey,
			});
		});

		if (!strict) {
			const ids: number[] = [];
			for (const row of rows) {
				const id = await this.db.db.hybridChunks.add(row);
				ids.push(id as number);
			}
			return ids;
		}

		return await (this.db.db.hybridChunks as unknown as {
			bulkAdd(rows: ChunkRow[], option: { allKeys: true }): Promise<number[]>;
		}).bulkAdd(rows, { allKeys: true });
	}

	private async persistVectorShard(shard: ReturnType<ChunkVectorShardBuilder['build']>): Promise<void> {
		await this.db.db.hybridChunkVectors.put(chunkVectorShardToRow(shard));
	}

	private async indexBm25Only(
		filePath: string,
		plannedChunks: PlannedChunk[],
		updateTime: number,
		option: HybridWriteOption,
		generation?: number,
		meta?: Bm25OnlyIndexedFileRefMeta,
	): Promise<void> {
		for (
			let chunkStart = 0;
			chunkStart < plannedChunks.length;
			chunkStart += INDEX_CHUNK_BATCH_SIZE
		) {
			const batchChunks = plannedChunks.slice(
				chunkStart,
				chunkStart + INDEX_CHUNK_BATCH_SIZE,
			);
			const ids = await profileHybridStage(
				'index.persist_chunks_bm25_only',
				async () =>
					await this.persistChunks(
						filePath,
						batchChunks,
						false,
						chunkStart,
					),
			);
			await profileHybridStage('index.update_memory_indices_bm25_only', async () => {
				for (let i = 0; i < ids.length; i++) {
					this.bm25.addDocument(ids[i], batchChunks[i].rawChunk.text);
				}
			});
		}

		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
		await this.putHybridIndexedFileRef({
			path: filePath,
			updateTime,
			state: 'bm25_only',
			generation,
			chunkCount: plannedChunks.length,
			vectorPrecision: null,
			indexedAt: Date.now(),
			lastErrorKind: meta?.lastErrorKind ?? null,
			lastIncrementalEmbedAt: meta?.lastIncrementalEmbedAt,
			embeddingDeferred: meta?.embeddingDeferred ?? false,
		});
	}

	private async putHybridIndexedFileRef(ref: HybridIndexedFileRef): Promise<void> {
		await this.db.db.hybridIndexedFileRefs.put(ref);
	}

	private classifyIndexErrorKind(error: unknown): string {
		if (error instanceof NoApiKeyError) return 'missing_api_key';
		if (error instanceof WeeklyTokenLimitExceededError) {
			return 'weekly_token_limit';
		}
		if (!(error instanceof Error)) {
			return 'unknown';
		}
		const message = `${error.name}: ${error.message}`.toLowerCase();
		if (message.includes('weekly token limit')) return 'weekly_token_limit';
		if (message.includes('api key')) return 'missing_api_key';
		if (
			message.includes('insufficient_quota') ||
			message.includes('quota exhausted') ||
			message.includes('quota exceeded')
		) {
			return 'quota_exhausted';
		}
		const statusMatch = message.match(/embedding api error (\d{3})/);
		if (statusMatch) {
			const status = Number(statusMatch[1]);
			if (status === 401) return 'auth_401';
			if (status === 403) return 'auth_403';
			if (status === 408) return 'timeout';
			if (status === 409 || status === 425 || status === 429) {
				return 'provider_429';
			}
			if (status >= 500) return 'provider_5xx';
		}
		if (message.includes('timeout')) return 'timeout';
		if (
			message.includes('500') ||
			message.includes('502') ||
			message.includes('503') ||
			message.includes('504')
		) {
			return 'provider_5xx';
		}
		if (message.includes('network') || message.includes('failed to fetch')) {
			return 'network';
		}
		return 'unknown';
	}

	private async withFileWriteLock<T>(filePath: string, work: () => Promise<T>): Promise<T> {
		const previous = this.fileWriteLocks.get(filePath);
		let release!: () => void;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.fileWriteLocks.set(filePath, current);
		await previous?.catch(() => undefined);
		try {
			return await work();
		} finally {
			release();
			if (this.fileWriteLocks.get(filePath) === current) {
				this.fileWriteLocks.delete(filePath);
			}
		}
	}

	private async withFileWriteLocks<T>(
		filePaths: string[],
		work: () => Promise<T>,
	): Promise<T> {
		const orderedPaths = Array.from(new Set(filePaths)).sort((left, right) =>
			left.localeCompare(right),
		);

		const run = async (index: number): Promise<T> => {
			if (index >= orderedPaths.length) {
				return await work();
			}
			return await this.withFileWriteLock(orderedPaths[index], async () => await run(index + 1));
		};

		return await run(0);
	}

	private async loadDedupedSmallChunkCandidates(rankings: RankedResult[][]): Promise<SmallChunkCandidate[]> {
		const merged: RankedResult[] = [];
		const seenIds = new Set<number>();

		for (const ranking of rankings) {
			for (const item of ranking) {
				if (seenIds.has(item.id)) continue;
				seenIds.add(item.id);
				merged.push(item);
			}
		}

		return this.loadSmallChunkCandidates(merged);
	}

	private async loadSmallChunkCandidates(ranking: RankedResult[]): Promise<SmallChunkCandidate[]> {
		const rows = await this.db.db.hybridChunks.bulkGet(ranking.map((item) => item.id));
		const snapshotByPath = await this.loadSnapshotTextByPaths(
			rows
				.filter((row): row is ChunkRow => row !== undefined)
				.map((row) => row.filePath),
		);
		const contextBuilderByPath = this.buildRerankContextBuilderByPath(snapshotByPath);
		const chunksById = new Map<number, Chunk>();
		for (const row of rows) {
			if (!row?.id) continue;
			const plainText = snapshotByPath.get(row.filePath);
			if (!plainText) continue;
			chunksById.set(row.id, rowToChunk(row, plainText));
		}

		return ranking
			.map((item) => {
				const chunk = chunksById.get(item.id);
				if (!chunk) return null;
				const buildContext = contextBuilderByPath.get(chunk.filePath);
				const context = buildContext?.(chunk.startLine) ?? '';
				return {
					id: chunk.id,
					filePath: chunk.filePath,
					text: chunk.text,
					rerankText: context ? `${context}\n\n${chunk.text}` : chunk.text,
					row: chunk.startLine,
					col: chunk.startCol,
					score: item.score,
				} as SmallChunkCandidate;
			})
			.filter((item): item is SmallChunkCandidate => item !== null);
	}

	private async loadSnapshotTextByPaths(filePaths: string[]): Promise<Map<string, string>> {
		const uniquePaths = Array.from(new Set(filePaths));
		if (uniquePaths.length === 0) {
			return new Map();
		}

		const rows = await this.db.db.hybridFileSnapshots.bulkGet(uniquePaths);
		const snapshots = new Map<string, string>();
		for (const row of rows) {
			if (!row) continue;
			snapshots.set(row.filePath, row.plainText);
		}
		return snapshots;
	}

	private async rerankAndBuildFileItems(
		query: string,
		smallCandidates: SmallChunkCandidate[],
		topK: number,
	): Promise<FileItem[]> {
		const rerankResults = await this.reranker.rerank(
			query,
			smallCandidates.map((candidate) => ({
				id: candidate.id,
				filePath: candidate.filePath,
				text: candidate.rerankText,
				startLine: candidate.row,
				startCol: candidate.col,
				endLine: candidate.row,
				recallScore: candidate.score,
			}) as RerankCandidate),
			topK,
		);

		const rerankScoreById = new Map(rerankResults.map((item) => [item.id, item.score]));
		const orderedSmallCandidates = smallCandidates
			.filter((candidate) => rerankScoreById.has(candidate.id))
			.map((candidate) => ({
				...candidate,
				score: rerankScoreById.get(candidate.id) ?? candidate.score,
			}))
			.sort((a, b) => b.score - a.score);

		return this.buildFileItemsFromSmallChunks(query, orderedSmallCandidates, topK);
	}

	private buildFileItemsFromSmallChunks(
		query: string,
		orderedSmallCandidates: SmallChunkCandidate[],
		topK: number,
	): FileItem[] {
		const limitedCandidates = orderedSmallCandidates.slice(0, topK);
		const byFile = new Map<string, { filePath: string; subItems: FileSubItem[]; bestScore: number }>();

		for (const candidate of limitedCandidates) {
			const entry = byFile.get(candidate.filePath) ?? {
				filePath: candidate.filePath,
				subItems: [],
				bestScore: candidate.score,
			};
			entry.bestScore = Math.max(entry.bestScore, candidate.score);
			entry.subItems.push(
				new FileSubItem(candidate.text, candidate.row, candidate.col, candidate.score, candidate.text),
			);
			if (!byFile.has(candidate.filePath)) {
				byFile.set(candidate.filePath, entry);
			}
		}

		return Array.from(byFile.values())
			.sort((a, b) => b.bestScore - a.bestScore)
			.map((entry) =>
				new FileItem(EngineType.SEMANTIC, entry.filePath, [query], [], entry.subItems, null),
			);
	}

	private async persistIndices(): Promise<void> {
		await Promise.all([this.persistBm25(), this.persistHnsw()]);
	}

	private async persistBm25(): Promise<void> {
		this.bm25.optimizeStorage();
		await this.db.db.hybridBm25Index.put({ id: 0, data: bm25ToBlob(this.bm25.serialize()) });
	}

	private async persistHnsw(): Promise<void> {
		if (this.hnswSmall.hasDeletedNodes()) {
			this.hnswSmall.rebuild();
		}
		await this.db.db.hybridHnswSmall.put({ id: 0, data: hnswToBlob(this.hnswSmall.serialize()) });
	}

	private async loadBm25(): Promise<void> {
		this.bm25.clear();
		const record = await this.db.db.hybridBm25Index.get(0);
		if (record) {
			const blobVersion = await getBm25BlobVersion(record.data);
			this.bm25.deserialize(await blobToBm25(record.data));
			if (blobVersion !== 4 || this.bm25.optimizeStorage()) {
				await this.persistBm25();
			}
		}
	}

	private async loadHnsw(): Promise<void> {
		const small = await this.db.db.hybridHnswSmall.get(0);
		if (small) {
			this.hnswSmall.deserialize(await blobToHnsw(small.data));
			await this.hydrateHnswVectors();
		}
		this._canSearch = this.hnswSmall.isNonEmpty() && this.hnswSmall.hasVectors();
		if (!this._canSearch) {
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
		}
	}

	private async hydrateHnswVectors(): Promise<void> {
		let offset = 0;
		let append = false;
		while (true) {
			const rows = await profileHybridStage(
				'startup.load_vector_shards',
				async () =>
					await this.db.db.hybridChunkVectors
						.orderBy('filePath')
						.offset(offset)
						.limit(HNSW_HYDRATE_SHARD_BATCH_SIZE)
						.toArray(),
			);
			if (rows.length === 0) {
				if (!append) {
					this.hnswSmall.hydrateVectors([]);
				}
				return;
			}

			const records = await profileHybridStage(
				'startup.decode_vector_shards',
				async () =>
					(
						await Promise.all(
							rows.map((row) => rowToChunkVectorShard(row as ChunkVectorShardRow)),
						)
					).flatMap((shard) => shardToChunkVectorRecords(shard)),
			);
			recordHybridProfileMetric('startup.hydrated_vector_count', records.length);
			await profileHybridStage('startup.hydrate_hnsw_vectors', async () => {
				this.hnswSmall.hydrateVectors(records, { append });
			});
			append = true;
			offset += rows.length;
		}
	}

	private buildRerankContextBuilderByPath(
		snapshotByPath: Map<string, string>,
	): Map<string, (startLine: number) => string> {
		const builders = new Map<string, (startLine: number) => string>();
		for (const [filePath, plainText] of snapshotByPath) {
			const headingOutline = this.dataProvider.getHeadingOutline(filePath);
			builders.set(
				filePath,
				createChunkContextBuilderFromOutline(
					filePath,
					countLines(plainText),
					headingOutline,
				),
			);
		}
		return builders;
	}

	private isExcludedPath(filePath: string): boolean {
		const excludedPaths = this.setting.hybrid.excludedPaths ?? [];
		return excludedPaths.some(
			(excludedPath) => filePath === excludedPath || filePath.startsWith(`${excludedPath}/`),
		);
	}
}

function countLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}

	let count = 1;
	for (let index = 0; index < text.length; index++) {
		if (text[index] === '\n') {
			count++;
		}
	}
	return count;
}
