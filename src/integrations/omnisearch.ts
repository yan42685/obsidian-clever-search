import Dexie from "dexie";
import { App, Notice } from "obsidian";
import { PrivateApi } from "src/services/obsidian/private-api";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class OmnisearchIntegration {
	// BUG: must be the same version defined by omnisearch, or we can't get the searchHistory
	// see: public static readonly dbVersion = ? at
	// https://github.com/scambier/obsidian-omnisearch/blob/master/src/database.ts
	private static readonly DB_VERSION = 8;
	private app: any = getInstance(App);
	private privateApi = getInstance(PrivateApi)
	private db: any;

	async init() {
		if (this.app.plugins.plugins.omnisearch) {
			const dbName = "omnisearch/cache/" + this.privateApi.getAppId();
			// console.log(dbName);
			const db: any = new Dexie(dbName);

			// the schema must be the same as what Omnisearch defined
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

	private checkOmnisearchStatus(): boolean {
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
