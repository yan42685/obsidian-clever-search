import { OuterSetting } from 'src/globals/plugin-setting';
import { EngineType, FileItem, FileSubItem } from 'src/globals/search-types';
import type { LocaleKey } from 'src/services/obsidian/translations/locale-helper';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import { Database } from 'src/services/database/database';
import type { VectorPrecision, BigChunk, RawBigChunk, RawChunk, Chunk } from './hybrid-types';
import { chunkFile } from './chunker';
import { Embedder } from './embedder';
import { BM25Engine } from './bm25';
import { HnswIndex } from './hnsw';
import type { RankedResult } from './ranking';
import { HybridReranker, SEARCH_EMBED_TOKEN_KEY, type RerankCandidate } from './reranker';
import {
	type BigChunkRow,
	type ChunkRow,
	bigChunkToRow,
	blobToBm25,
	blobToHnsw,
	bm25ToBlob,
	chunkToRow,
	hnswToBlob,
	rowToBigChunk,
	rowToChunk,
} from './hybrid-store';

const BM25_RECALL_LIMIT = 25;
const DENSE_RECALL_LIMIT = 25;
const SEARCH_EF = 80;
const MAX_FILE_RESULTS = 20;
type HybridWriteOption = {
	persistIndices?: boolean;
};

type SmallChunkCandidate = {
	id: number;
	bigChunkId: number;
	filePath: string;
	text: string;
	row: number;
	col: number;
	startOffset: number;
	endOffset: number;
	score: number;
};

export class HybridEngine {
	private readonly db = getInstance(Database);
	private readonly setting = getInstance(OuterSetting);
	private readonly embedder = new Embedder();
	private readonly reranker = new HybridReranker();
	private readonly bm25 = new BM25Engine();
	private readonly hnswSmall = new HnswIndex();
	private readonly hnswBig = new HnswIndex();

	private _ready = false;
	private _canSearch = false;
	private lastIndexingFallbackNoticeKey: LocaleKey | null = null;
	private lastSearchFallbackNoticeKey: LocaleKey | null = null;

	private get precision(): VectorPrecision {
		return this.setting.hybrid.vectorCompression === 'float16'
			? 'float16'
			: 'int8';
	}

	async load(): Promise<void> {
		await Promise.all([this.loadBm25(), this.loadHnsw()]);
		this._ready = true;
	}

	async clearAll(): Promise<void> {
		this.bm25.clear();
		this.hnswSmall.clear();
		this.hnswBig.clear();
		this._ready = false;
		this._canSearch = false;
		this.lastIndexingFallbackNoticeKey = null;
		this.lastSearchFallbackNoticeKey = null;

		await Promise.all([
			this.db.db.hybridChunks.clear(),
			this.db.db.hybridBigChunks.clear(),
			this.db.db.hybridBm25Index.clear(),
			this.db.db.hybridHnswSmall.clear(),
			this.db.db.hybridHnswBig.clear(),
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
		const bigRows = await this.db.db.hybridBigChunks.where('filePath').equals(filePath).toArray();
		const bigIds = bigRows.map((row) => row.id!).filter((id) => id !== undefined);
		const smallRows = await this.db.db.hybridChunks.where('filePath').equals(filePath).toArray();
		const smallIds = smallRows.map((row) => row.id!).filter((id) => id !== undefined);

		await this.db.db.hybridBigChunks.bulkDelete(bigIds);
		await this.db.db.hybridChunks.bulkDelete(smallIds);
		await this.db.db.hybridDocRefs.delete(filePath);

		for (const id of smallIds) {
			this.bm25.removeDocument(id);
			this.hnswSmall.delete(id);
		}
		for (const id of bigIds) {
			this.hnswBig.delete(id);
		}

		if (this.hnswSmall.needsRebuild()) this.hnswSmall.rebuild();
		if (this.hnswBig.needsRebuild()) this.hnswBig.rebuild();
		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
	}

	async search(query: string, topK = MAX_FILE_RESULTS): Promise<FileItem[]> {
		if (!this.isEnabled() || !this._ready || !query.trim()) return [];

		const bm25Small = this.bm25.search(query, BM25_RECALL_LIMIT).map((result) => ({
			id: result.bigChunkId,
			score: result.score,
		}));

		let denseSmall: RankedResult[] = [];
		try {
			if (this._canSearch) {
				const embedded = await this.embedder.embedQuery(
					query,
					this.precision,
					SEARCH_EMBED_TOKEN_KEY,
				);
				denseSmall = this.hnswSmall.search(
					embedded.vec,
					embedded.scale,
					DENSE_RECALL_LIMIT,
					SEARCH_EF,
					this.precision,
					embedded.vecF16,
				).map((result) => ({
					id: result.id,
					score: result.score,
				}));
			}
		} catch (error) {
			logger.warn('hybrid query embedding failed; rerank will use BM25-only chunks.', error);
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
		}

		const smallCandidates = await this.loadDedupedSmallChunkCandidates([
			bm25Small,
			denseSmall,
		]);
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

		const { bigChunks: rawBig, chunks: rawSmall } = chunkFile(filePath, plainText);
		if (rawBig.length === 0) return;

		let smallVecs: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }> = [];
		try {
			smallVecs = await this.embedder.embedBatch(
				rawSmall.map((chunk) => chunk.text),
				this.precision,
				filePath,
			);
			this._canSearch = true;
			this.lastIndexingFallbackNoticeKey = null;
		} catch (error) {
			logger.warn(`hybrid indexing fell back to BM25 for ${filePath}`, error);
			this._canSearch = false;
			this.lastIndexingFallbackNoticeKey = 'hybridNotice.indexFallbackToBm25';
			await this.indexBm25Only(filePath, rawBig, rawSmall, updateTime, option);
			return;
		}

		const bigChunkIds = await this.persistBigChunks(rawBig, strict);
		const smallChunkIds = await this.persistSmallChunks(
			filePath,
			rawSmall,
			bigChunkIds,
			smallVecs,
			strict,
		);
		await this.updateBigChunkChildIds(bigChunkIds, rawSmall, smallChunkIds, strict);

		for (let i = 0; i < smallChunkIds.length; i++) {
			const chunkId = smallChunkIds[i];
			const { vec, scale, vecF16 } = smallVecs[i];
			this.bm25.addDocument(chunkId, rawSmall[i].text);
			this.hnswSmall.insert(chunkId, vec, scale, vecF16);
		}

		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
	}

	private async persistBigChunks(rawBig: RawBigChunk[], strict: boolean): Promise<number[]> {
		const bigRows = rawBig.map((chunk) =>
			bigChunkToRow({
				id: undefined,
				filePath: chunk.filePath,
				text: chunk.text,
				startLine: chunk.startLine,
				startCol: chunk.startCol,
				endLine: chunk.endLine,
				chunkIds: [],
				vector: new Int8Array(0),
				scale: 1,
			}),
		);

		if (!strict) {
			const ids: number[] = [];
			for (const row of bigRows) {
				const id = await this.db.db.hybridBigChunks.add(row);
				ids.push(id as number);
			}
			return ids;
		}

		return await (this.db.db.hybridBigChunks as unknown as {
			bulkAdd(rows: BigChunkRow[], option: { allKeys: true }): Promise<number[]>;
		}).bulkAdd(bigRows, { allKeys: true });
	}

	private async persistSmallChunks(
		filePath: string,
		rawSmall: RawChunk[],
		bigChunkIds: number[],
		smallVecs: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }>,
		strict: boolean,
	): Promise<number[]> {
		const rows = rawSmall.map((chunk, index) => {
			const bigId = bigChunkIds[chunk.bigChunkIdx];
			const { vec, scale, vecF16 } = smallVecs[index];
			return chunkToRow({
				id: undefined,
				bigChunkId: bigId,
				filePath,
				startOffset: chunk.startOffset,
				endOffset: chunk.endOffset,
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

	private async updateBigChunkChildIds(
		bigChunkIds: number[],
		rawSmall: RawChunk[],
		smallChunkIds: number[],
		strict: boolean,
	): Promise<void> {
		const bigChunkChildIds = new Map<number, number[]>(
			bigChunkIds.map((id) => [id, []]),
		);

		for (let i = 0; i < rawSmall.length; i++) {
			const bigId = bigChunkIds[rawSmall[i].bigChunkIdx];
			bigChunkChildIds.get(bigId)?.push(smallChunkIds[i]);
		}

		if (!strict) {
			for (const [bigId, childIds] of bigChunkChildIds) {
				await this.db.db.hybridBigChunks.update(bigId, {
					chunkIds: JSON.stringify(childIds),
				});
			}
			return;
		}

		const bigRows = await this.db.db.hybridBigChunks.bulkGet(bigChunkIds);
		const updatedRows = bigRows
			.map((row) => {
				if (!row?.id) return null;
				return {
					...row,
					chunkIds: JSON.stringify(bigChunkChildIds.get(row.id) ?? []),
				};
			})
			.filter((row): row is NonNullable<typeof row> => row !== null);
		await this.db.db.hybridBigChunks.bulkPut(updatedRows);
	}

	private async indexBm25Only(
		filePath: string,
		rawBig: RawBigChunk[],
		rawSmall: RawChunk[],
		updateTime: number,
		option: HybridWriteOption,
	): Promise<void> {
		const bigChunkIds = await this.persistBigChunks(rawBig, false);
		const smallChunkIds: number[] = [];

		for (const chunk of rawSmall) {
			const row = chunkToRow({
				id: undefined,
				bigChunkId: bigChunkIds[chunk.bigChunkIdx],
				filePath,
				startOffset: chunk.startOffset,
				endOffset: chunk.endOffset,
				vector: new Int8Array(0),
				scale: 1,
			});
			const id = await this.db.db.hybridChunks.add(row);
			smallChunkIds.push(id as number);
			this.bm25.addDocument(id as number, chunk.text);
		}

		await this.updateBigChunkChildIds(bigChunkIds, rawSmall, smallChunkIds, false);
		if (option.persistIndices ?? true) {
			await this.persistIndices();
		}
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
	}

	private async loadDedupedSmallChunkCandidates(
		rankings: RankedResult[][],
	): Promise<SmallChunkCandidate[]> {
		const mergedRanking: RankedResult[] = [];
		const seenIds = new Set<number>();

		for (const ranking of rankings) {
			for (const item of ranking) {
				if (seenIds.has(item.id)) continue;
				seenIds.add(item.id);
				mergedRanking.push(item);
			}
		}

		return this.loadSmallChunkCandidates(mergedRanking);
	}

	private async loadSmallChunkCandidates(ranking: RankedResult[]): Promise<SmallChunkCandidate[]> {
		const rows = await this.db.db.hybridChunks.bulkGet(ranking.map((item) => item.id));
		const chunksById = new Map<number, Chunk>();
		for (const row of rows) {
			if (!row?.id) continue;
			chunksById.set(row.id, await rowToChunk(row));
		}
		const bigChunkIds = Array.from(
			new Set(
				Array.from(chunksById.values()).map((chunk) => chunk.bigChunkId),
			),
		);
		const bigRows = await this.db.db.hybridBigChunks.bulkGet(bigChunkIds);
		const bigChunksById = new Map<number, BigChunk>();
		for (const row of bigRows) {
			if (!row?.id) continue;
			bigChunksById.set(row.id, await rowToBigChunk(row));
		}

		return ranking
			.map((item) => {
				const chunk = chunksById.get(item.id);
				const bigChunk = chunk ? bigChunksById.get(chunk.bigChunkId) : undefined;
				if (!chunk) return null;
				if (!bigChunk) return null;
				const chunkText = bigChunk.text.slice(chunk.startOffset, chunk.endOffset);
				const location = offsetToLocation(
					bigChunk.text,
					bigChunk.startLine,
					bigChunk.startCol,
					chunk.startOffset,
				);
				return {
					id: chunk.id,
					bigChunkId: chunk.bigChunkId,
					filePath: chunk.filePath,
					text: chunkText,
					row: location.row,
					col: location.col,
					startOffset: chunk.startOffset,
					endOffset: chunk.endOffset,
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
			smallCandidates.length,
		);
		const rerankScoreById = new Map(
			rerankResults.map((item) => [item.id, item.score]),
		);
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
		const byFile = new Map<
			string,
			{ filePath: string; subItems: FileSubItem[]; bestScore: number }
		>();

		for (const candidate of orderedSmallCandidates) {
			const entry = byFile.get(candidate.filePath) ?? {
				filePath: candidate.filePath,
				subItems: [],
				bestScore: candidate.score,
			};
			entry.bestScore = Math.max(entry.bestScore, candidate.score);
			entry.subItems.push(
				new FileSubItem(
					candidate.text,
					candidate.row,
					candidate.col,
					candidate.score,
					candidate.text,
				),
			);
			if (!byFile.has(candidate.filePath)) {
				byFile.set(candidate.filePath, entry);
			}
		}

		return Array.from(byFile.values())
			.sort((a, b) => b.bestScore - a.bestScore)
			.slice(0, topK)
			.map((entry) =>
				new FileItem(
					EngineType.SEMANTIC,
					entry.filePath,
					[query],
					[],
					entry.subItems,
					null,
				),
			);
	}

	private async persistIndices(): Promise<void> {
		await Promise.all([this.persistBm25(), this.persistHnsw()]);
	}

	private async persistBm25(): Promise<void> {
		await this.db.db.hybridBm25Index.put({
			id: 0,
			data: bm25ToBlob(this.bm25.serialize()),
		});
	}

	private async persistHnsw(): Promise<void> {
		await Promise.all([
			this.db.db.hybridHnswSmall.put({ id: 0, data: hnswToBlob(this.hnswSmall.serialize()) }),
			this.db.db.hybridHnswBig.put({ id: 0, data: hnswToBlob(this.hnswBig.serialize()) }),
		]);
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
		this.hnswBig.clear();
		const [small, big] = await Promise.all([
			this.db.db.hybridHnswSmall.get(0),
			this.db.db.hybridHnswBig.get(0),
		]);
		if (small) this.hnswSmall.deserialize(await blobToHnsw(small.data));
		if (big) this.hnswBig.deserialize(await blobToHnsw(big.data));
		this._canSearch = this.hnswSmall.isNonEmpty();
		if (!this._canSearch) {
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
		}
	}

	private isExcludedPath(filePath: string): boolean {
		const excludedPaths = this.setting.hybrid.excludedPaths ?? [];
		return excludedPaths.some(
			(excludedPath) =>
				filePath === excludedPath || filePath.startsWith(`${excludedPath}/`),
		);
	}
}

function offsetToLocation(
	text: string,
	baseRow: number,
	baseCol: number,
	offset: number,
): { row: number; col: number } {
	const prefix = text.slice(0, Math.max(0, offset));
	const lines = prefix.split('\n');
	const lineOffset = lines.length - 1;
	const colWithinLine = lines[lines.length - 1]?.length ?? 0;

	return {
		row: baseRow + lineOffset,
		col: lineOffset === 0 ? baseCol + colWithinLine : colWithinLine,
	};
}
