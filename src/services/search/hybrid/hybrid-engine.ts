import { OuterSetting } from 'src/globals/plugin-setting';
import { EngineType, FileItem, FileSubItem } from 'src/globals/search-types';
import type { LocaleKey } from 'src/services/obsidian/translations/locale-helper';
import { getInstance } from 'src/utils/my-lib';
import { Database } from 'src/services/database/database';
import type { VectorPrecision, BigChunk, RawBigChunk } from './hybrid-types';
import { chunkFile } from './chunker';
import {
	Embedder,
} from './embedder';
import { BM25Engine } from './bm25';
import { HnswIndex } from './hnsw';
import {
	bigChunkToRow,
	blobToBm25,
	blobToHnsw,
	bm25ToBlob,
	chunkToRow,
	hnswToBlob,
	rowToBigChunk,
	rowToChunk,
} from './hybrid-store';

const RRF_K = 60;
const VEC_BIG_WEIGHT = 0.7; // big-chunk vector is semantically coarser

export class HybridEngine {
	private readonly db = getInstance(Database);
	private readonly setting = getInstance(OuterSetting);
	private readonly embedder = new Embedder();
	private readonly bm25 = new BM25Engine();
	private readonly hnswSmall = new HnswIndex();
	private readonly hnswBig = new HnswIndex();

	private precision: VectorPrecision = 'int8';
	private _ready = false;
	private _canSearch = false; // false → BM25-only fallback
	private lastIndexingFallbackNoticeKey: LocaleKey | null = null;
	private lastSearchFallbackNoticeKey: LocaleKey | null = null;

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	async load(): Promise<void> {
		if (!this.isEnabled()) {
			this._ready = true;
			this._canSearch = false;
			return;
		}
		await Promise.all([
			this.loadBm25(),
			this.loadHnsw(),
		]);
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

	isEnabled(): boolean { return this.setting.hybrid.enabled; }
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

	// ─── Indexing ─────────────────────────────────────────────────────────────

	async indexFile(filePath: string, plainText: string, updateTime = Date.now()): Promise<void> {
		if (!this.shouldIndexPath(filePath)) {
			await this.deleteFile(filePath);
			return;
		}

		// Remove stale data first
		await this.deleteFile(filePath);

		const { bigChunks: rawBig, chunks: rawSmall } = chunkFile(filePath, plainText);
		if (rawBig.length === 0) return;

		// Embed all texts
		const bigTexts = rawBig.map(b => b.text);
		const smallTexts = rawSmall.map(s => s.text);

		let bigVecs: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }>;
		let smallVecs: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }>;

		try {
			[bigVecs, smallVecs] = await Promise.all([
				this.embedder.embedBatch(bigTexts, this.precision, filePath),
				this.embedder.embedBatch(smallTexts, this.precision, filePath),
			]);
			this._canSearch = true;
			this.lastIndexingFallbackNoticeKey = null;
		} catch (e) {
				this._canSearch = false;
				this.lastIndexingFallbackNoticeKey =
					"hybridNotice.indexFallbackToBm25";
				// Index BM25 only
				for (let i = 0; i < rawBig.length; i++) {
					// We need a temporary id — use a placeholder; real id assigned after DB insert
					// For BM25-only mode we skip vector indexing
				}
				await this.indexBm25Only(filePath, rawBig, updateTime);
				return;
		}

		// Persist big chunks
		const bigChunkIds: number[] = [];
		for (let i = 0; i < rawBig.length; i++) {
			const rb = rawBig[i];
			const { vec, scale, vecF16 } = bigVecs[i];
			const row = bigChunkToRow({
				id: undefined,
				filePath: rb.filePath,
				text: rb.text,
				startLine: rb.startLine,
				endLine: rb.endLine,
				chunkIds: [],
				vector: vec,
				scale,
				vectorF16: vecF16,
			});
			const id = await this.db.db.hybridBigChunks.add(row);
			bigChunkIds.push(id as number);
		}

		// Persist small chunks and collect ids per big chunk
		const bigChunkChildIds: Map<number, number[]> = new Map(bigChunkIds.map(id => [id, []]));
		for (let i = 0; i < rawSmall.length; i++) {
			const rs = rawSmall[i];
			const bigId = bigChunkIds[rs.bigChunkIdx];
			const { vec, scale, vecF16 } = smallVecs[i];
			const row = chunkToRow({
				id: undefined,
				bigChunkId: bigId,
				filePath,
				vector: vec,
				scale,
				vectorF16: vecF16,
			});
			const id = await this.db.db.hybridChunks.add(row);
			bigChunkChildIds.get(bigId)!.push(id as number);
		}

		// Update big chunk chunkIds
		for (const [bigId, childIds] of bigChunkChildIds) {
			await this.db.db.hybridBigChunks.update(bigId, { chunkIds: JSON.stringify(childIds) });
		}

		// Build in-memory indices
		for (let i = 0; i < rawBig.length; i++) {
			const bigId = bigChunkIds[i];
			const { vec, scale, vecF16 } = bigVecs[i];
			this.bm25.addDocument(bigId, rawBig[i].text);
			this.hnswBig.insert(bigId, vec, scale, vecF16);
		}

		const smallRows = await this.db.db.hybridChunks.where('filePath').equals(filePath).toArray();
		for (let i = 0; i < smallRows.length; i++) {
			const row = smallRows[i];
			const chunk = await rowToChunk(row);
			this.hnswSmall.insert(chunk.id, chunk.vector, chunk.scale, chunk.vectorF16);
		}

		// Persist updated indices
		await this.persistIndices();

		// Update doc ref
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
	}

	async deleteFile(filePath: string): Promise<void> {
		// Get big chunk ids for this file
		const bigRows = await this.db.db.hybridBigChunks.where('filePath').equals(filePath).toArray();
		const bigIds = bigRows.map(r => r.id!);

		// Get small chunk ids
		const smallRows = await this.db.db.hybridChunks.where('filePath').equals(filePath).toArray();
		const smallIds = smallRows.map(r => r.id!);

		// Remove from DB
		await this.db.db.hybridBigChunks.bulkDelete(bigIds);
		await this.db.db.hybridChunks.bulkDelete(smallIds);
		await this.db.db.hybridDocRefs.delete(filePath);

		// Remove from in-memory indices
		for (const id of bigIds) {
			this.bm25.removeDocument(id);
			this.hnswBig.delete(id);
		}
		for (const id of smallIds) {
			this.hnswSmall.delete(id);
		}

		// Rebuild HNSW if too many deleted nodes
		if (this.hnswSmall.needsRebuild()) this.hnswSmall.rebuild();
		if (this.hnswBig.needsRebuild()) this.hnswBig.rebuild();
		await this.persistIndices();
	}

	async indexFileStrict(
		filePath: string,
		plainText: string,
		updateTime = Date.now(),
	): Promise<void> {
		if (!this.shouldIndexPath(filePath)) {
			await this.deleteFile(filePath);
			return;
		}

		await this.deleteFile(filePath);

		const { bigChunks: rawBig, chunks: rawSmall } = chunkFile(filePath, plainText);
		if (rawBig.length === 0) return;

		const bigTexts = rawBig.map((b) => b.text);
		const smallTexts = rawSmall.map((s) => s.text);
		const [bigVecs, smallVecs] = await Promise.all([
			this.embedder.embedBatch(bigTexts, this.precision, filePath),
			this.embedder.embedBatch(smallTexts, this.precision, filePath),
		]);

		this._canSearch = true;
		this.lastIndexingFallbackNoticeKey = null;

		const bigChunkIds: number[] = [];
		for (let i = 0; i < rawBig.length; i++) {
			const rb = rawBig[i];
			const { vec, scale, vecF16 } = bigVecs[i];
			const row = bigChunkToRow({
				id: undefined,
				filePath: rb.filePath,
				text: rb.text,
				startLine: rb.startLine,
				endLine: rb.endLine,
				chunkIds: [],
				vector: vec,
				scale,
				vectorF16: vecF16,
			});
			const id = await this.db.db.hybridBigChunks.add(row);
			bigChunkIds.push(id as number);
		}

		const bigChunkChildIds: Map<number, number[]> = new Map(
			bigChunkIds.map((id) => [id, []]),
		);
		for (let i = 0; i < rawSmall.length; i++) {
			const rs = rawSmall[i];
			const bigId = bigChunkIds[rs.bigChunkIdx];
			const { vec, scale, vecF16 } = smallVecs[i];
			const row = chunkToRow({
				id: undefined,
				bigChunkId: bigId,
				filePath,
				vector: vec,
				scale,
				vectorF16: vecF16,
			});
			const id = await this.db.db.hybridChunks.add(row);
			bigChunkChildIds.get(bigId)!.push(id as number);
		}

		for (const [bigId, childIds] of bigChunkChildIds) {
			await this.db.db.hybridBigChunks.update(bigId, {
				chunkIds: JSON.stringify(childIds),
			});
		}

		for (let i = 0; i < rawBig.length; i++) {
			const bigId = bigChunkIds[i];
			const { vec, scale, vecF16 } = bigVecs[i];
			this.bm25.addDocument(bigId, rawBig[i].text);
			this.hnswBig.insert(bigId, vec, scale, vecF16);
		}

		const smallRows = await this.db.db.hybridChunks
			.where('filePath')
			.equals(filePath)
			.toArray();
		for (let i = 0; i < smallRows.length; i++) {
			const row = smallRows[i];
			const chunk = await rowToChunk(row);
			this.hnswSmall.insert(
				chunk.id,
				chunk.vector,
				chunk.scale,
				chunk.vectorF16,
			);
		}

		await this.persistIndices();
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
	}

	// ─── Search ───────────────────────────────────────────────────────────────

	async search(query: string, topK = 20): Promise<FileItem[]> {
		if (!this.isEnabled() || !this._ready) return [];

		// BM25 search (always available)
		const bm25Results = this.bm25.search(query, topK * 2);

		if (!this._canSearch || bm25Results.length === 0) {
			if (!this._canSearch && bm25Results.length > 0) {
				this.lastSearchFallbackNoticeKey =
					"hybridNotice.searchFallbackToBm25";
			}
			return this.bm25ResultsToFileItems(bm25Results.slice(0, topK), query);
		}

		// Vector search
		let queryVec: Int8Array;
		let queryScale: number;
		let queryVecF16: Uint16Array | undefined;

		try {
			const q = await this.embedder.embedQuery(query, this.precision);
			queryVec = q.vec;
			queryScale = q.scale;
			queryVecF16 = q.vecF16;
			this.lastSearchFallbackNoticeKey = null;
		} catch (e) {
			this._canSearch = false;
			this.lastSearchFallbackNoticeKey =
				"hybridNotice.searchFallbackToBm25";
			return this.bm25ResultsToFileItems(bm25Results.slice(0, topK), query);
		}

		const vecSmallRaw = this.hnswSmall.search(queryVec, queryScale, topK * 3, undefined, this.precision, queryVecF16);
		const vecBigRaw = this.hnswBig.search(queryVec, queryScale, topK * 2, undefined, this.precision, queryVecF16);

		// Roll up small chunk scores to big chunk (max score)
		const smallToBig = await this.buildSmallToBigMap(vecSmallRaw.map(r => r.id));
		const vecSmallByBig = new Map<number, number>();
		for (const { id, score } of vecSmallRaw) {
			const bigId = smallToBig.get(id);
			if (bigId === undefined) continue;
			const prev = vecSmallByBig.get(bigId) ?? 0;
			if (score > prev) vecSmallByBig.set(bigId, score);
		}

		// RRF fusion
		const vecSmallRanked = rankByScore(Array.from(vecSmallByBig.entries()).map(([id, score]) => ({ id, score })));
		const vecBigRanked = rankByScore(vecBigRaw);
		const bm25Ranked = rankByScore(bm25Results.map(r => ({ id: r.bigChunkId, score: r.score })));

		const allIds = new Set([
			...vecSmallRanked.map(r => r.id),
			...vecBigRanked.map(r => r.id),
			...bm25Ranked.map(r => r.id),
		]);

		const rrfScores = new Map<number, number>();
		for (const id of allIds) {
			const rankSmall = vecSmallRanked.findIndex(r => r.id === id);
			const rankBig = vecBigRanked.findIndex(r => r.id === id);
			const rankBm25 = bm25Ranked.findIndex(r => r.id === id);

			let score = 0;
			if (rankSmall >= 0) score += 1 / (RRF_K + rankSmall + 1);
			if (rankBig >= 0) score += VEC_BIG_WEIGHT / (RRF_K + rankBig + 1);
			if (rankBm25 >= 0) score += 1 / (RRF_K + rankBm25 + 1);
			rrfScores.set(id, score);
		}

		const topBigIds = Array.from(rrfScores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, topK * 3)
			.map(([id]) => id);

		return this.bigIdsToFileItems(topBigIds, query, topK);
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private async indexBm25Only(filePath: string, rawBig: RawBigChunk[], updateTime: number): Promise<void> {
		for (const rb of rawBig) {
			const row = bigChunkToRow({
				id: undefined,
				filePath: rb.filePath,
				text: rb.text,
				startLine: rb.startLine,
				endLine: rb.endLine,
				chunkIds: [],
				vector: new Int8Array(0),
				scale: 1,
			});
			const id = await this.db.db.hybridBigChunks.add(row);
			this.bm25.addDocument(id as number, rb.text);
		}
		await this.persistBm25();
		await this.db.db.hybridDocRefs.put({ path: filePath, updateTime });
	}

	private async buildSmallToBigMap(smallIds: number[]): Promise<Map<number, number>> {
		const map = new Map<number, number>();
		if (smallIds.length === 0) return map;
		const rows = await this.db.db.hybridChunks.bulkGet(smallIds);
		for (const row of rows) {
			if (row) map.set(row.id!, row.bigChunkId);
		}
		return map;
	}

	private async bigIdsToFileItems(bigIds: number[], query: string, topK: number): Promise<FileItem[]> {
		const rows = await this.db.db.hybridBigChunks.bulkGet(bigIds);
		const byFile = new Map<string, BigChunk[]>();

		for (const row of rows) {
			if (!row) continue;
			const bc = await rowToBigChunk(row);
			const arr = byFile.get(bc.filePath) ?? [];
			arr.push(bc);
			byFile.set(bc.filePath, arr);
		}

		const items: FileItem[] = [];
		for (const [filePath, bcs] of byFile) {
			const subItems = bcs.slice(0, 3).map(bc =>
				new FileSubItem(bc.text.slice(0, 120), bc.startLine, 0),
			);
			items.push(new FileItem(EngineType.SEMANTIC, filePath, [query], [], subItems, null));
			if (items.length >= topK) break;
		}
		return items;
	}

	private async bm25ResultsToFileItems(
		results: Array<{ bigChunkId: number; score: number }>,
		query: string,
	): Promise<FileItem[]> {
		return this.bigIdsToFileItems(results.map(r => r.bigChunkId), query, results.length);
	}

	// ─── Persistence ─────────────────────────────────────────────────────────

	private async persistIndices(): Promise<void> {
		await Promise.all([this.persistBm25(), this.persistHnsw()]);
	}

	private async persistBm25(): Promise<void> {
		const blob = bm25ToBlob(this.bm25.serialize());
		await this.db.db.hybridBm25Index.put({ id: 0, data: blob });
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
		if (record) this.bm25.deserialize(await blobToBm25(record.data));
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
			this.lastSearchFallbackNoticeKey =
				"hybridNotice.searchFallbackToBm25";
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

// ─── Utility ──────────────────────────────────────────────────────────────────

function rankByScore(items: Array<{ id: number; score: number }>): Array<{ id: number; score: number }> {
	return [...items].sort((a, b) => b.score - a.score);
}
