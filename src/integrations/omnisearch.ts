import Dexie from "dexie";
import { App, Notice } from "obsidian";
import { container, singleton } from "tsyringe";

@singleton()
export class OmnisearchIntegration {
	// BUG: must be the same version defined by omnisearch, or we can't get the searchHistory
	// see: public static readonly dbVersion = ? at
	// https://github.com/scambier/obsidian-omnisearch/blob/master/src/database.ts
	private static readonly DB_VERSION = 8;
	private app: any = container.resolve(App);
	private db: any;

	async init() {
		if (this.app.plugins.plugins.omnisearch) {
			// BUG: 最新的api移除了this.app.appId的定义，以后可能会废除这个属性
			const dbName = "omnisearch/cache/" + this.app.appId;
			// console.log(dbName);
			const db: any = new Dexie(dbName);

			db.version(OmnisearchIntegration.DB_VERSION).stores({
				searchHistory: "++id",
				minisearch: "date",
			});
			this.db = db;
		}
	}
	/**
	 * get the last query from database created by omnisearch.
	 */
	async getLastQuery(): Promise<string> {
		let lastQuery = "";
		if (this.checkOmnisearchStatus()) {
			const recentQueries = await this.db.searchHistory.toArray();
			lastQuery =
				recentQueries.length !== 0
					? recentQueries[recentQueries.length - 1].query
					: "";
			// console.log("last query: " + lastQuery);
		}
		return lastQuery;
	}

	private checkOmnisearchStatus() {
		const omnisearch = this.app.plugins.plugins.omnisearch;
		let isAvailable = true;
		if (!omnisearch) {
			new Notice("Omnisearch isn't installed");
			isAvailable = false;
		} else if (!omnisearch._loaded) {
			new Notice("Omnisearch is installed but not enabled");
			isAvailable = false;
		}
		return isAvailable;
	}
}
