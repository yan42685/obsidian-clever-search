import type { RequestUrlResponse } from "obsidian";
import {
	FileItem,
	FileSubItem,
	type IndexedDocument,
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { SHOULD_NOT_HAPPEN, getInstance } from "src/utils/my-lib";
import { HttpClient } from "src/utils/web/http-client";
import { singleton } from "tsyringe";
import { PrivateApi } from "../obsidian/private-api";
import { MyNotice } from "../obsidian/transformed-api";
import { ViewRegistry, ViewType } from "../obsidian/view-registry";

@singleton()
export class SemanticEngine {
	private request = getInstance(RemoteRequest);
	private viewRegistry = getInstance(ViewRegistry);
	private _status: "stopped" | "indexing" | "ready" = "stopped";

	get status() {
		return this._status;
	}

	async testConnection(): Promise<void> {
		const connected = await this.request.testConnection();
		if (connected) {
			new MyNotice("Connected", 5000);
		} else {
			new MyNotice("Failed to connect", 5000);
		}
	}

	async doesCollectionExist(): Promise<boolean | null> {
		return this.request.doesCollectionExist();
	}

	async reindexAll(indexedDocs: IndexedDocument[]) {
		this._status = "indexing";
		const docs = this.convertToDocuments(indexedDocs);
		try {
			await this.request.reindexAll(docs);
			this._status = "ready";
		} catch (e) {
			logger.error(e);
			this._status = "stopped";
		}
	}

	async addDocuments(indexedDocs: IndexedDocument[]): Promise<boolean> {
		this._status = "indexing";
		const docs = this.convertToDocuments(indexedDocs);
		try {
			const result = await this.request.addDocuments(docs);
			this._status = "ready";
			return result;
		} catch (e) {
			logger.error(e);
			this._status = "stopped";
			return false;
		}
	}

	async deleteDocuments(paths: string[]): Promise<boolean> {
		this._status = "indexing";
		try {
			const result = await this.request.deleteDocuments(paths);
			this._status = "ready";
			return result;
		} catch (e) {
			logger.error(e);
			this._status = "stopped";
			return false;
		}
	}

	async search(queryText: string, viewType: ViewType): Promise<FileItem[]> {
		try {
			const rawResults = await this.request.search(queryText, viewType);
			this._status = "ready";

			return rawResults.map((rawResult) => {
				const subItems = rawResult.subItems.map(
					(subItemData) =>
						new FileSubItem(
							subItemData.text,
							subItemData.row,
							subItemData.col,
						),
				);

				return new FileItem(
					rawResult.engineType,
					rawResult.path,
					rawResult.queryTerms,
					rawResult.matchedTerms,
					subItems,
					rawResult.previewContent,
				);
			});
		} catch (e) {
			logger.error(e);
			this._status = "stopped";
			return [];
		}
	}

	async docsCount(): Promise<number | null> {
		return this.request.docsCount();
	}

	private convertToDocuments(indexedDocs: IndexedDocument[]): Document[] {
		return indexedDocs.map((x) => {
			return {
				path: x.path,
				view_type: this.viewRegistry.viewTypeByPath(x.path),
				content: x.content,
			} as Document;
		});
	}
}

@singleton()
class RemoteRequest {
	private responseProcessor = (resp: RequestUrlResponse): any | null => {
		if (resp.status === 200) {
			const res = resp.json as Result;
			if (res.code === 0) {
				return res.data;
			} else if (res.code === -1) {
				logger.error(`KnownException: ${res.message}`);
				return null;
			} else if (res.code === -2) {
				logger.error(`UnknownException: ${res.message}`);
				return null;
			} else {
				throw Error(SHOULD_NOT_HAPPEN);
			}
		} else {
			logger.error(resp.text);
			return null;
		}
	};
	private client = new HttpClient({
		baseUrl: "localhost:19528/api",
		protocol: "http",
		responseProcessor: this.responseProcessor,
		headers: { "X-vaultId": getInstance(PrivateApi).getAppId() },
	});

	async testConnection(): Promise<boolean> {
		try {
			const connected = await this.client.get("testConnection");
			return connected ? true : false;
		} catch (e) {
			logger.error(e);
			return false;
		}
	}

	async doesCollectionExist(): Promise<boolean | null> {
		try {
			const res = await this.client.get("doesCollectionExist", undefined);
			return res;
		} catch (e) {
			logger.error(e);
			return null;
		}
	}

	async reindexAll(docs: Document[]) {
		await this.client.post("reindexAll", undefined, docs);
	}

	async docsCount(): Promise<number | null> {
		try {
			const count = await this.client.get("docsCount");
			return count;
		} catch (e) {
			logger.error(e);
			return null;
		}
	}

	async addDocuments(docs: Document[]): Promise<boolean> {
		return await this.client.post("addDocuments", undefined, docs);
	}

	async deleteDocuments(paths: string[]): Promise<boolean> {
		return await this.client.post("deleteDocuments", undefined, paths);
	}

	async search(queryText: string, viewType: ViewType): Promise<FileItem[]> {
		return await this.client.get("search", {
			queryText,
			viewType,
		});
	}
}

type Document = {
	path: string;
	view_type: ViewType;
	content: string;
};

type Result = {
	data: any;
	message: string;
	code: number;
};
