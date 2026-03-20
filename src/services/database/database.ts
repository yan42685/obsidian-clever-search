import Dexie from "dexie";
import type { AsPlainObject } from "minisearch";
import type { HybridTokenRecord, OuterSetting } from "src/globals/plugin-setting";
import type { DocumentRef } from "src/globals/search-types";
import type {
	BlobRecord,
	ChunkRow,
	ChunkVectorShardRow,
	HybridDocRef,
} from "src/services/search/hybrid/hybrid-store";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { inject, singleton } from "tsyringe";
import { PrivateApi } from "../obsidian/private-api";

@singleton()
export class Database {
	readonly db = getInstance(DexieWrapper);

	async estimatePluginStorageUsage(): Promise<{
		totalBytes: number;
		tables: Array<{ name: string; rows: number; bytes: number }>;
		hybridChunkBreakdown?: {
			textBytes: number;
			vectorBytes: number;
			vectorF16Bytes: number;
			metadataBytes: number;
		};
		hybridVectorBreakdown?: {
			chunkIdBytes: number;
			vectorBytes: number;
			scaleBytes: number;
			metadataBytes: number;
		};
	}> {
		const tableEntries = [
			{ name: "pluginSetting", table: this.db.pluginSetting },
			{ name: "minisearch", table: this.db.minisearch },
			{ name: "lexicalDocRefs", table: this.db.lexicalDocRefs },
			{ name: "semanticDocRefs", table: this.db.semanticDocRefs },
			{ name: "hybridChunks", table: this.db.hybridChunks },
			{ name: "hybridChunkVectors", table: this.db.hybridChunkVectors },
			{ name: "hybridBm25Index", table: this.db.hybridBm25Index },
			{ name: "hybridHnswSmall", table: this.db.hybridHnswSmall },
			{ name: "hybridDocRefs", table: this.db.hybridDocRefs },
			{ name: "hybridTokenStats", table: this.db.hybridTokenStats },
		] as const;

		const tables = await Promise.all(
			tableEntries.map(async ({ name, table }) => {
				const rows = await table.toArray();
				return {
					name,
					rows: rows.length,
					bytes: estimateValueBytes(rows),
				};
			}),
		);
		const hybridChunkRows = await this.db.hybridChunks.toArray();
		const hybridVectorRows = await this.db.hybridChunkVectors.toArray();
		const hybridChunkBreakdown = this.estimateHybridChunkBreakdown(hybridChunkRows);
		const hybridVectorBreakdown = this.estimateHybridVectorBreakdown(hybridVectorRows);

		return {
			totalBytes: tables.reduce((sum, item) => sum + item.bytes, 0),
			tables,
			hybridChunkBreakdown,
			hybridVectorBreakdown,
		};
	}

	private estimateHybridChunkBreakdown(rows: ChunkRow[]) {
		const breakdown = {
			textBytes: 0,
			vectorBytes: 0,
			vectorF16Bytes: 0,
			metadataBytes: 0,
		};

		for (const row of rows) {
			breakdown.textBytes += estimateValueBytes(row.text);
			breakdown.metadataBytes +=
				estimateValueBytes(row.id) +
				estimateValueBytes(row.filePath) +
				estimateValueBytes(row.chunkIndex) +
				estimateValueBytes(row.startLine) +
				estimateValueBytes(row.startCol) +
				estimateValueBytes(row.endLine);
		}

		return breakdown;
	}

	private estimateHybridVectorBreakdown(rows: ChunkVectorShardRow[]) {
		const breakdown = {
			chunkIdBytes: 0,
			vectorBytes: 0,
			scaleBytes: 0,
			metadataBytes: 0,
		};

		for (const row of rows) {
			breakdown.chunkIdBytes += row.chunkIds?.size ?? 0;
			breakdown.vectorBytes += row.vectorData?.size ?? 0;
			breakdown.scaleBytes += row.scaleData?.size ?? 0;
			breakdown.metadataBytes +=
				estimateValueBytes(row.filePath) +
				estimateValueBytes(row.precision) +
				estimateValueBytes(row.dim) +
				estimateValueBytes(row.chunkCount);
		}

		return breakdown;
	}

	async deleteMinisearchData() {
		this.db.minisearch.clear();
	}

	// it may finished some time later even if using await
	async setMiniSearchData(data: AsPlainObject) {
		this.db.transaction("rw", this.db.minisearch, async () => {
			// Warning: The clear() here is just a marker for caution to avoid data duplication.
			// Ideally, clear() should be executed at an earlier stage.
			// Placing clear() and add() together, especially with large data sets,
			// may lead to conflicts and cause Obsidian to crash. It is an issue related to Dexie or IndexedDB
			await this.db.minisearch.clear();
			await this.db.minisearch.add({ data: data });
			logger.trace("minisearch data saved");
		});
	}

	@monitorDecorator
	async getMiniSearchData(): Promise<AsPlainObject | null> {
		return (await this.db.minisearch.toArray())[0]?.data || null;
	}

	async setLexicalDocRefs(refs: DocumentRef[]) {
		this.db.transaction("rw", this.db.lexicalDocRefs, async () => {
			await this.db.lexicalDocRefs.clear();
			await this.db.lexicalDocRefs.bulkAdd(refs);
		});
	}

	@monitorDecorator
	async getLexicalDocRefs(): Promise<DocumentRef[] | null> {
		return (await this.db.lexicalDocRefs.toArray()) || null;
	}

	async setSemanticDocRefs(refs: DocumentRef[]) {
		this.db.transaction("rw", this.db.semanticDocRefs, async () => {
			await this.db.semanticDocRefs.clear();
			await this.db.semanticDocRefs.bulkAdd(refs);
		});
	}

	async getSemanticDocRefs(): Promise<DocumentRef[] | null> {
		return (await this.db.semanticDocRefs.toArray()) || null;
	}

	async setPluginSetting(setting: OuterSetting): Promise<boolean> {
		try {
			await this.db.transaction("rw", this.db.pluginSetting, () => {
				this.db.pluginSetting.clear();
				this.db.pluginSetting.add({ data: setting });
			});
			logger.trace("settings have been saved to database");
			return true;
		} catch (e) {
			logger.trace(`settings failed to be saved: ${e}`);
			return false;
		}
	}

	// copied from https://github.com/scambier/obsidian-omnisearch/blob/master/src/database.ts#L36
	async deleteOldDatabases() {
		const toDelete = (await indexedDB.databases()).filter(
			(db) =>
				db.name === this.db.dbName &&
				// version multiplied by 10 https://github.com/dexie/Dexie.js/issues/59
				db.version !== this.db.dbVersion * 10,
		);
		if (toDelete.length) {
			logger.info("Old version databases will be deleted");
			for (const db of toDelete) {
				if (db.name) {
					indexedDB.deleteDatabase(db.name);
				}
			}
		}
	}
}

@singleton()
class DexieWrapper extends Dexie {
	private static readonly _dbVersion = 7;
	private static readonly dbNamePrefix = "clever-search/";
	private privateApi: PrivateApi;
	pluginSetting!: Dexie.Table<{ id?: number; data: OuterSetting }, number>;
	minisearch!: Dexie.Table<{ id?: number; data: AsPlainObject }, number>;
	// TODO: put data together because it takes lots of time for a database connection  (70ms) in my machine
	lexicalDocRefs!: Dexie.Table<DocumentRef, number>;
	semanticDocRefs!: Dexie.Table<DocumentRef, number>;
	// Hybrid search tables
	hybridChunks!: Dexie.Table<ChunkRow, number>;
	hybridChunkVectors!: Dexie.Table<ChunkVectorShardRow, string>;
	hybridBm25Index!: Dexie.Table<BlobRecord, number>;
	hybridHnswSmall!: Dexie.Table<BlobRecord, number>;
	hybridDocRefs!: Dexie.Table<HybridDocRef, string>;
	hybridTokenStats!: Dexie.Table<HybridTokenRecord, number>;

	constructor(@inject(PrivateApi) privateApi: PrivateApi) {
		super(DexieWrapper.dbNamePrefix + privateApi.getAppId());
		this.privateApi = privateApi;
		this.version(2).stores({
			pluginSetting: "++id",
			minisearch: "++id",
			lexicalDocRefs: "++id",
			semanticDocRefs: "++id",
		});
		this.version(3).stores({
			pluginSetting: "++id",
			minisearch: "++id",
			lexicalDocRefs: "++id",
			semanticDocRefs: "++id",
			hybridChunks: "++id, bigChunkId, filePath",
			hybridBm25Index: "id",
			hybridHnswSmall: "id",
			hybridDocRefs: "path",
		});
		this.version(4).stores({
			pluginSetting: "++id",
			minisearch: "++id",
			lexicalDocRefs: "++id",
			semanticDocRefs: "++id",
			hybridChunks: "++id, bigChunkId, filePath",
			hybridBm25Index: "id",
			hybridHnswSmall: "id",
			hybridDocRefs: "path",
			hybridTokenStats: "++id, filePath, dateKey, [filePath+dateKey]",
		});
		this.version(6)
			.stores({
				pluginSetting: "++id",
				minisearch: "++id",
				lexicalDocRefs: "++id",
				semanticDocRefs: "++id",
				hybridChunks: "++id, filePath",
				hybridBm25Index: "id",
				hybridHnswSmall: "id",
				hybridDocRefs: "path",
				hybridTokenStats: "++id, filePath, dateKey, [filePath+dateKey]",
			})
			.upgrade(async (tx) => {
				await Promise.all([
					tx.table("hybridChunks").clear(),
					tx.table("hybridBm25Index").clear(),
					tx.table("hybridHnswSmall").clear(),
					tx.table("hybridDocRefs").clear(),
				]);
			});
		this.version(DexieWrapper._dbVersion)
			.stores({
				pluginSetting: "++id",
				minisearch: "++id",
				lexicalDocRefs: "++id",
				semanticDocRefs: "++id",
				hybridChunks: "++id, filePath",
				hybridChunkVectors: "filePath",
				hybridBm25Index: "id",
				hybridHnswSmall: "id",
				hybridDocRefs: "path",
				hybridTokenStats: "++id, filePath, dateKey, [filePath+dateKey]",
			})
			.upgrade(async (tx) => {
				await Promise.all([
					tx.table("hybridChunks").clear(),
					tx.table("hybridChunkVectors").clear(),
					tx.table("hybridBm25Index").clear(),
					tx.table("hybridHnswSmall").clear(),
					tx.table("hybridDocRefs").clear(),
				]);
			});
	}
	get dbVersion() {
		return DexieWrapper._dbVersion;
	}
	get dbName() {
		return DexieWrapper.dbNamePrefix + this.privateApi.getAppId();
	}
}

const textEncoder = new TextEncoder();

function estimateValueBytes(value: unknown, visited = new WeakSet<object>()): number {
	if (value === null || value === undefined) {
		return 0;
	}

	if (typeof value === "string") {
		return textEncoder.encode(value).length;
	}

	if (typeof value === "number") {
		return 8;
	}

	if (typeof value === "boolean") {
		return 4;
	}

	if (typeof value === "bigint") {
		return textEncoder.encode(value.toString()).length;
	}

	if (value instanceof Blob) {
		return value.size;
	}

	if (value instanceof Date) {
		return textEncoder.encode(value.toISOString()).length;
	}

	if (value instanceof ArrayBuffer) {
		return value.byteLength;
	}

	if (ArrayBuffer.isView(value)) {
		return value.byteLength;
	}

	if (Array.isArray(value)) {
		return value.reduce(
			(sum, item) => sum + estimateValueBytes(item, visited),
			0,
		);
	}

	if (typeof value === "object") {
		if (visited.has(value)) {
			return 0;
		}
		visited.add(value);

		return Object.entries(value).reduce((sum, [key, childValue]) => {
			return sum + textEncoder.encode(key).length + estimateValueBytes(childValue, visited);
		}, 0);
	}

	return textEncoder.encode(String(value)).length;
}
