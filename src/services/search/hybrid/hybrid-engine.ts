import { OuterSetting } from 'src/globals/plugin-setting';
import { EngineType, FileItem, FileSubItem } from 'src/globals/search-types';
import type { LocaleKey } from 'src/services/obsidian/translations/locale-helper';
import { Database } from 'src/services/database/database';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import { chunkFile } from './chunker';
import { BM25Engine } from './bm25';
import { Embedder } from './embedder';
import { HnswIndex } from './hnsw';
import {
	blobToBm25,
	blobToHnsw,
	bm25ToBlob,
	type ChunkRow,
	chunkToRow,
	hnswToBlob,
	rowToChunk,
	rowToChunkVector,
} from './hybrid-store';
import type { Chunk, RawChunk, VectorPrecision } from './hybrid-types';
import type { RankedResult } from './ranking';
import { HybridReranker, SEARCH_EMBED_TOKEN_KEY, type RerankCandidate } from './reranker';

const BM25_RECALL_LIMIT = 20;
const DENSE_RECALL_LIMIT = 20;
const SEARCH_EF = 80;
const DEFAULT_MAX_FILE_RESULTS = 5;
const MIN_FILE_RESULTS = 1;
const MAX_FILE_RESULTS = 30;

type HybridWriteOption = {
	persistIndices?: boolean;
};

type SmallChunkCandidate = {
	id: number;
	filePath: string;
	text: string;
	row: number;
	col: number;
	score: number;
};

export class HybridEngine {
	private readonly db = getInstance(Database);
	private readonly setting = getInstance(OuterSetting);
	private readonly embedder = new Embedder();
	private readonly reranker = new HybridReranker();
	private readonly bm25 = new BM25Engine();
	private readonly hnswSmall = new HnswIndex();

	private _ready = false;
	private _canSearch = false;
	private lastIndexingFallbackNoticeKey: LocaleKey | null = null;
	private lastSearchFallbackNoticeKey: LocaleKey | null = null;

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
		await Promise.all([this.loadBm25(), this.loadHnsw()]);
		this._ready = true;
	}

	async clearAll(): Promise<void> {
		this.bm25.clear();
		this.hnswSmall.clear();
		this._ready = false;
		this._canSearch = false;
		this.lastIndexingFallbackNoticeKey = null;
		this.lastSearchFallbackNoticeKey = null;

		await Promise.all([
			this.db.db.hybridChunks.clear(),
			this.db.db.hybridBm25Index.clear(),
			this.db.db.hybridHnswSmall.clear(),
			this.db.db.hybridDocRefs.clear(),
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

	async indexFile(filePath: string, plainText: string, updateTime = Date.now()): Promise<void> {
		await this.indexInternal(filePath, plainText, updateTime, {}, false);
	}

	async indexFileStrict(
		filePath: string,
		plainText: string,
		updateTime = Date.now(),
		option: HybridWriteOption = {},
	): Promise<void> {
		await this.indexInternal(filePath, plainText, updateTime, option, true);
	}

	async deleteFile(filePath: string, option: HybridWriteOption = {}): Promise<void> {
		const rows = await this.db.db.hybridChunks.where('filePath').equals(filePath).toArray();
		const ids = rows.map((row) => row.id!).filter((id) => id !== undefined);

		await this.db.db.hybridChunks.bulkDelete(ids);
		await this.db.db.hybridDocRefs.delete(filePath);

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

		const bm25Small = this.bm25.search(query, BM25_RECALL_LIMIT).map((result) => ({
			id: result.docId,
			score: result.score,
		}));

		let denseSmall: RankedResult[] = [];
		try {
			if (this._canSearch) {
				const embedded = await this.embedder.embedQuery(query, this.precision, SEARCH_EMBED_TOKEN_KEY);
				denseSmall = this.hnswSmall.search(
					embedded.vec,
					embedded.scale,
					DENSE_RECALL_LIMIT,
					SEARCH_EF,
					this.precision,
					embedded.vecF16,
				).map((result) => ({ id: result.id, score: result.score }));
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

	private async indexInternal(
		filePath: string,
		plainText: string,
		updateTime: number,
		option: HybridWriteOption,
		strict: boolean,
	): Promise<void> {
		if (!this.shouldIndexPath(filePath)) {
			await this.deleteFile(filePath, option);
			return;
		}

		await this.deleteFile(filePath, option);

		const { chunks: rawChunks } = chunkFile(filePath, plainText);
		if (rawChunks.length === 0) return;

		let vectors: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }> = [];
		try {
			vectors = await this.embedder.embedBatch(
				rawChunks.map((chunk) => chunk.text),
				this.precision,
				filePath,
			);
			this._canSearch = true;
			this.lastIndexingFallbackNoticeKey = null;
		} catch (error) {
			logger.warn(`hybrid indexing fell back to BM25 for ${filePath}`, error);
			this._canSearch = false;
			this.lastIndexingFallbackNoticeKey = 'hybridNotice.indexFallbackToBm25';
			await this.indexBm25Only(filePath, rawChunks, updateTime, option);
			return;
		}

		const chunkIds = await this.persistChunks(filePath, rawChunks, vectors, strict);
		for (let i = 0; i < chunkIds.length; i++) {
			const chunkId = chunkIds[i];
			const { vec, scale, vecF16 } = vectors[i];
			this.bm25.addDocument(chunkId, rawChunks[i].text);
			this.hnswSmall.insert(chunkId, vec, scale, vecF16);
		}

		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
	}

	private async persistChunks(
		filePath: string,
		rawChunks: RawChunk[],
		vectors: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }>,
		strict: boolean,
	): Promise<number[]> {
		const rows = rawChunks.map((chunk, index) => {
			const { vec, scale, vecF16 } = vectors[index];
			return chunkToRow({
				id: undefined,
				filePath,
				text: chunk.text,
				startLine: chunk.startLine,
				startCol: chunk.startCol,
				endLine: chunk.endLine,
				vector: vec,
				scale,
				vectorF16: vecF16,
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

	private async indexBm25Only(
		filePath: string,
		rawChunks: RawChunk[],
		updateTime: number,
		option: HybridWriteOption,
	): Promise<void> {
		const ids: number[] = [];
		for (const chunk of rawChunks) {
			const row = chunkToRow({
				id: undefined,
				filePath,
				text: chunk.text,
				startLine: chunk.startLine,
				startCol: chunk.startCol,
				endLine: chunk.endLine,
				vector: new Int8Array(0),
				scale: 1,
			});
			const id = await this.db.db.hybridChunks.add(row);
			ids.push(id as number);
			this.bm25.addDocument(id as number, chunk.text);
		}

		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
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
		const chunksById = new Map<number, Chunk>();
		for (const row of rows) {
			if (!row?.id) continue;
			chunksById.set(row.id, await rowToChunk(row));
		}

		return ranking
			.map((item) => {
				const chunk = chunksById.get(item.id);
				if (!chunk) return null;
				return {
					id: chunk.id,
					filePath: chunk.filePath,
					text: chunk.text,
					row: chunk.startLine,
					col: chunk.startCol,
					score: item.score,
				} as SmallChunkCandidate;
			})
			.filter((item): item is SmallChunkCandidate => item !== null);
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
				text: candidate.text,
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
			this.bm25.deserialize(await blobToBm25(record.data));
		}
	}

	private async loadHnsw(): Promise<void> {
		this.hnswSmall.clear();
		const small = await this.db.db.hybridHnswSmall.get(0);
		if (small) {
			const data = await blobToHnsw(small.data);
			const shouldRewriteBlob =
				Boolean(data.vectors?.length) ||
				Boolean(data.scales?.length) ||
				Boolean(data.vectorsF16?.length) ||
				data.deletedSet.length > 0;
			this.hnswSmall.deserialize(data);
			// Old persisted graphs may still include lazy-deleted nodes; compact first so
			// every in-memory node can hydrate from an existing hybridChunks row.
			if (this.hnswSmall.hasDeletedNodes()) {
				this.hnswSmall.rebuild();
			}
			await this.hydrateHnswVectors();
			if (shouldRewriteBlob) {
				await this.persistHnsw();
			}
		}
		this._canSearch = this.hnswSmall.isNonEmpty() && this.hnswSmall.hasVectors();
		if (!this._canSearch) {
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
		}
	}

	private async hydrateHnswVectors(): Promise<void> {
		const ids = this.hnswSmall.nodeIds();
		if (ids.length === 0) {
			this.hnswSmall.hydrateVectors([]);
			return;
		}

		const rows = await this.db.db.hybridChunks.bulkGet(ids);
		const records = await Promise.all(
			rows
				.filter((row): row is ChunkRow => Boolean(row?.id))
				.map((row) => rowToChunkVector(row)),
		);
		this.hnswSmall.hydrateVectors(records);
	}

	private isExcludedPath(filePath: string): boolean {
		const excludedPaths = this.setting.hybrid.excludedPaths ?? [];
		return excludedPaths.some(
			(excludedPath) => filePath === excludedPath || filePath.startsWith(`${excludedPath}/`),
		);
	}
}
