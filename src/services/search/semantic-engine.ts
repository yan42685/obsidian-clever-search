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

	async testConnection() {
		const connected = await this.request.testConnection();
		if (connected) {
			new MyNotice("Connected", 5000);
		} else {
			new MyNotice("Failed to connect", 5000);
		}
	}

	async reindexAll(indexedDocs: IndexedDocument[]) {
		const docs = this.convertToDocuments(indexedDocs);
		await this.request.reindexAll(docs);
	}

	async addDocuments(indexedDocs: IndexedDocument[]): Promise<boolean> {
		const docs = this.convertToDocuments(indexedDocs);
		return await this.request.addDocuments(docs);
	}

	async deleteDocuments(paths: string[]): Promise<boolean> {
		return await this.request.deleteDocuments(paths);
	}

	async search(queryText: string, viewType: ViewType): Promise<FileItem[]> {
		const rawResults = await this.request.search(queryText, viewType);

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
		baseUrl: "localhost:8000/api",
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

	async reindexAll(docs: Document[]) {
		return this.client.post("reindex_all", undefined, docs);
	}

	async addDocuments(docs: Document[]): Promise<boolean> {
		try {
			await this.client.post("addDocuments", undefined, docs);
			return true;
		} catch (e) {
			logger.error(e);
			return false;
		}
	}

	async deleteDocuments(paths: string[]): Promise<boolean> {
		try {
			await this.client.post("deleteDocuments", undefined, paths);
			return true;
		} catch (e) {
			logger.error(e);
			return false;
		}
	}

	async search(queryText: string, viewType: ViewType): Promise<FileItem[]> {
		const res = await this.client.get("search", { queryText, viewType });
		return res || [];
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
