import Dexie from "dexie";
import type { AsPlainObject } from "minisearch";
import type { PluginSetting } from "src/globals/plugin-setting";
import type { DocumentRef } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { inject, singleton } from "tsyringe";
import { PrivateApi } from "../obsidian/private-api";

@singleton()
export class Database {
	readonly db = getInstance(DexieWrapper);

	async setMiniSearchData(data: AsPlainObject) {
		this.db.transaction("rw",this.db.minisearch, async () => {
			await this.db.minisearch.clear();
			await this.db.minisearch.add({data: data});
			logger.trace("minisearch data saved");
		})
	}

	async getMiniSearchData(): Promise<AsPlainObject | null> {
		return (await this.db.minisearch.toArray())[0].data || null;
	}

	async getDocumentRefs(): Promise<DocumentRef[] | null> {
		return [];
	}

	async getPluginSetting(): Promise<PluginSetting | null> {
		try {
			return (await this.db.pluginSetting.toArray())[0].data;
		} catch (e) {
			logger.trace(`database didn't find pluginSetting: ${e}`);
			return null;
		}
	}

	async setPluginSetting(setting: PluginSetting): Promise<boolean> {
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
			logger.trace("Those IndexedDb databases will be deleted:");
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
	private static readonly _dbVersion = 1;
	private static readonly dbNamePrefix = "clever-search/";
	private privateApi: PrivateApi;
	pluginSetting!: Dexie.Table<{ id?: number; data: PluginSetting }, number>;
	minisearch!: Dexie.Table<{ id?: number; data: AsPlainObject }, number>;
	documentRefs!: Dexie.Table<{ id?: number; data: DocumentRef[] }, number>;

	constructor(@inject(PrivateApi) privateApi: PrivateApi) {
		super(DexieWrapper.dbNamePrefix + privateApi.getAppId());
		this.privateApi = privateApi;
		this.version(DexieWrapper._dbVersion).stores({
			pluginSetting: "++id",
			minisearch: "++id",
			documentRefs: "path",
		});
	}
	get dbVersion() {
		return DexieWrapper._dbVersion;
	}
	get dbName() {
		return DexieWrapper.dbNamePrefix + this.privateApi.getAppId();
	}
}
