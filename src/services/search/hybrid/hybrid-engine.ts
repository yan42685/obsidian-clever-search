import { OuterSetting } from 'src/globals/plugin-setting';
import { EngineType, FileItem, FileSubItem } from 'src/globals/search-types';
import type { LocaleKey } from 'src/services/obsidian/translations/locale-helper';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import { Database } from 'src/services/database/database';
import type { VectorPrecision, BigChunk, RawBigChunk, RawChunk, Chunk } from './hybrid-types';
import { chunkFile, createTokenWindows } from './chunker';
import { Embedder } from './embedder';
import { BM25Engine } from './bm25';
import { HnswIndex } from './hnsw';
import { reciprocalRankFuse, type RankedResult } from './ranking';
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

const BM25_RECALL_LIMIT = 50;
const DENSE_RECALL_LIMIT = 50;
const RRF_LIMIT = 100;
const SEARCH_EF = 80;
const BIG_CHUNK_RERANK_LIMIT = 60;
const MAX_FILE_RESULTS = 20;
const MAX_SUBITEMS_PER_FILE = 3;
const SNIPPET_CHAR_LIMIT = 240;
const SNIPPET_TOKEN_TARGET = 100;
const SNIPPET_TOKEN_MAX = 120;

type HybridWriteOption = {
	persistIndices?: boolean;
};

type SmallChunkHit = {
	id: number;
	bigChunkId: number;
	filePath: string;
	startOffset: number;
	endOffset: number;
	score: number;
};

type BigChunkCandidate = {
	id: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	score: number;
	order: number;
	smallMatches: SmallChunkHit[];
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

		if (!this._canSearch) {
			if (bm25Small.length > 0) {
				this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
			}
			return this.searchFromSmallChunkRanking(query, bm25Small, topK, false);
		}

		let denseSmall: RankedResult[];
		try {
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
		} catch (error) {
			logger.warn('hybrid query embedding failed; falling back to BM25.', error);
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
			return this.searchFromSmallChunkRanking(query, bm25Small, topK, false);
		}

		const fusedSmall = reciprocalRankFuse([bm25Small, denseSmall], RRF_LIMIT);
		if (fusedSmall.length === 0) {
			return [];
		}

		try {
			const items = await this.searchFromSmallChunkRanking(query, fusedSmall, topK, true);
			this.lastSearchFallbackNoticeKey = null;
			return items;
		} catch (error) {
			logger.warn('hybrid rerank failed; falling back to RRF-only ordering.', error);
			this.lastSearchFallbackNoticeKey = 'hybridNotice.searchFallbackToBm25';
			return this.searchFromSmallChunkRanking(query, fusedSmall, topK, false);
		}
	}

	async persistIndicesForBatch(): Promise<void> {
		await this.persistIndices();
	}

	private async searchFromSmallChunkRanking(
		query: string,
		smallRanking: RankedResult[],
		topK: number,
		shouldRerankBigChunks: boolean,
	): Promise<FileItem[]> {
		const smallMatches = await this.loadSmallChunkMatches(smallRanking);
		if (smallMatches.length === 0) {
			return [];
		}

		const bigCandidates = await this.buildBigChunkCandidates(smallMatches);
		if (bigCandidates.length === 0) {
			return [];
		}

		let selectedBigCandidates = bigCandidates;
		if (shouldRerankBigChunks) {
			const rerankResults = await this.reranker.rerank(
				query,
				bigCandidates
					.slice(0, BIG_CHUNK_RERANK_LIMIT)
					.map((candidate) => this.toRerankCandidate(candidate)),
				Math.min(BIG_CHUNK_RERANK_LIMIT, bigCandidates.length),
			);
			const selectedIds = new Set(rerankResults.map((item) => item.id));
			selectedBigCandidates = bigCandidates.filter((candidate) =>
				selectedIds.has(candidate.id),
			);
			if (selectedBigCandidates.length === 0) {
				selectedBigCandidates = bigCandidates;
			}
		}

		const globalBigChunkOrder = selectedBigCandidates
			.map((candidate) => candidate.id);

		return this.buildFileItemsFromBigCandidates(
			selectedBigCandidates,
			globalBigChunkOrder,
			query,
			topK,
		);
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

	private async loadSmallChunkMatches(ranking: RankedResult[]): Promise<SmallChunkHit[]> {
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
					bigChunkId: chunk.bigChunkId,
					filePath: chunk.filePath,
					startOffset: chunk.startOffset,
					endOffset: chunk.endOffset,
					score: item.score,
				} as SmallChunkHit;
			})
			.filter((item): item is SmallChunkHit => item !== null);
	}

	private async buildBigChunkCandidates(
		smallMatches: SmallChunkHit[],
	): Promise<BigChunkCandidate[]> {
		const bigOrder = new Map<number, number>();
		const groupedSmallMatches = new Map<number, SmallChunkHit[]>();

		smallMatches.forEach((match, index) => {
			if (!bigOrder.has(match.bigChunkId)) {
				bigOrder.set(match.bigChunkId, index);
			}
			const bucket = groupedSmallMatches.get(match.bigChunkId) ?? [];
			bucket.push(match);
			groupedSmallMatches.set(match.bigChunkId, bucket);
		});

		const bigIds = Array.from(bigOrder.entries())
			.sort((a, b) => a[1] - b[1])
			.map(([bigChunkId]) => bigChunkId);
		const rows = await this.db.db.hybridBigChunks.bulkGet(bigIds);
		const bigChunksById = new Map<number, BigChunk>();
		for (const row of rows) {
			if (!row?.id) continue;
			bigChunksById.set(row.id, await rowToBigChunk(row));
		}

		return bigIds
			.map((bigChunkId) => {
				const bigChunk = bigChunksById.get(bigChunkId);
				if (!bigChunk) return null;
				const orderedSmallMatches = (groupedSmallMatches.get(bigChunkId) ?? [])
					.sort((a, b) => b.score - a.score);
				return {
					id: bigChunk.id,
					filePath: bigChunk.filePath,
					text: bigChunk.text,
					startLine: bigChunk.startLine,
					startCol: bigChunk.startCol,
					endLine: bigChunk.endLine,
					score: orderedSmallMatches[0]?.score ?? 0,
					order: bigOrder.get(bigChunkId) ?? Number.MAX_SAFE_INTEGER,
					smallMatches: orderedSmallMatches,
				} as BigChunkCandidate;
			})
			.filter((item): item is BigChunkCandidate => item !== null);
	}

	private buildFileItemsFromBigCandidates(
		bigCandidates: BigChunkCandidate[],
		globalBigChunkOrder: number[],
		query: string,
		topK: number,
	): FileItem[] {
		const candidateById = new Map(
			bigCandidates.map((candidate) => [candidate.id, candidate]),
		);
		const byFile = new Map<
			string,
			{ filePath: string; orderedBigChunks: BigChunkCandidate[] }
		>();

		for (const bigChunkId of globalBigChunkOrder) {
			const candidate = candidateById.get(bigChunkId);
			if (!candidate) continue;
			const entry = byFile.get(candidate.filePath) ?? {
				filePath: candidate.filePath,
				orderedBigChunks: [],
			};
			entry.orderedBigChunks.push(candidate);
			if (!byFile.has(candidate.filePath)) {
				byFile.set(candidate.filePath, entry);
			}
		}

		return Array.from(byFile.values())
			.slice(0, topK)
			.map((entry) =>
				new FileItem(
					EngineType.SEMANTIC,
					entry.filePath,
					[query],
					[],
					this.buildOrderedSubItems(entry.orderedBigChunks, query),
					null,
				),
			);
	}

	private buildOrderedSubItems(
		orderedBigChunks: BigChunkCandidate[],
		query: string,
	): FileSubItem[] {
		const subItems: FileSubItem[] = [];

		for (const bigChunk of orderedBigChunks) {
			const orderedSmallMatches = [...bigChunk.smallMatches].sort(
				(a, b) => b.score - a.score,
			);
			for (const smallMatch of orderedSmallMatches) {
				if (subItems.length >= MAX_SUBITEMS_PER_FILE) {
					return subItems;
				}
				const snippetText = buildSmallChunkSnippet(
					bigChunk.text.slice(smallMatch.startOffset, smallMatch.endOffset),
					query,
				);
				const location = offsetToLocation(
					bigChunk.text,
					bigChunk.startLine,
					bigChunk.startCol,
					smallMatch.startOffset,
				);
				subItems.push(
					new FileSubItem(
						snippetText,
						location.row,
						location.col,
						smallMatch.score,
						snippetText,
					),
				);
			}
		}

		return subItems;
	}

	private toRerankCandidate(candidate: BigChunkCandidate): RerankCandidate {
		return {
			id: candidate.id,
			filePath: candidate.filePath,
			text: candidate.text,
			startLine: candidate.startLine,
			startCol: candidate.startCol,
			endLine: candidate.endLine,
			recallScore: candidate.score,
		};
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

function buildSmallChunkSnippet(text: string, query: string): string {
	const normalizedText = text.trim();
	if (!normalizedText) {
		return '';
	}

	const windows = createTokenWindows(
		normalizedText,
		SNIPPET_TOKEN_TARGET,
		SNIPPET_TOKEN_MAX,
	);
	if (windows.length === 0) {
		return cleanSnippet(normalizedText);
	}

	const queryLower = query.trim().toLowerCase();
	const queryTerms = Array.from(
		new Set(
			queryLower
				.split(/\s+/)
				.map((term) => term.trim())
				.filter((term) => term.length >= 2),
		),
	);

	let bestWindow = windows[0];
	let bestScore = scoreSnippetWindow(
		normalizedText.slice(bestWindow.startOffset, bestWindow.endOffset),
		queryLower,
		queryTerms,
	);

	for (let i = 1; i < windows.length; i++) {
		const window = windows[i];
		const score = scoreSnippetWindow(
			normalizedText.slice(window.startOffset, window.endOffset),
			queryLower,
			queryTerms,
		);
		if (score > bestScore) {
			bestScore = score;
			bestWindow = window;
		}
	}

	return cleanSnippet(
		normalizedText.slice(bestWindow.startOffset, bestWindow.endOffset),
	);
}

function scoreSnippetWindow(
	snippet: string,
	queryLower: string,
	queryTerms: string[],
): number {
	const normalized = snippet.toLowerCase();
	let score = 0;

	if (queryLower && normalized.includes(queryLower)) {
		score += Math.max(20, queryLower.length * 1.5);
	}

	for (const term of queryTerms) {
		let searchStart = 0;
		let hits = 0;
		while (searchStart < normalized.length) {
			const index = normalized.indexOf(term, searchStart);
			if (index < 0) break;
			hits++;
			searchStart = index + term.length;
		}
		score += hits * Math.max(3, Math.min(term.length, 12));
	}

	return score;
}

function cleanSnippet(text: string): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHAR_LIMIT);
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
