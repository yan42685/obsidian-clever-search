import type { FileItem, IndexedDocument } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { HttpClient } from "src/utils/web/http-client";
import { singleton } from "tsyringe";
import { ViewRegistry, ViewType } from "../obsidian/view-registry";

@singleton()
export class SemanticEngine {
	private request = getInstance(RemoteRequest);
	private viewRegistry = getInstance(ViewRegistry);

	async reindexAll(data: IndexedDocument[]) {
		const docs = data.map((x) => {
			return {
				path: x.path,
				view_type: this.viewRegistry.viewTypeByPath(x.path),
				content: x.content,
			} as Document;
		});
		await this.request.reindexAll(docs);
	}

	async search(queryText: string, viewType: ViewType) {
		return this.request.search(queryText, viewType);
	}
}

@singleton()
class RemoteRequest {
	private client = new HttpClient({
		baseUrl: "localhost:8000/api",
		protocol: "http",
	});

	async reindexAll(docs: Document[]) {
		return this.client.post(
			"reindex_all",
			{
				vault_id: "test_collection",
			},
			docs,
		);
	}

	async search(queryText: string, viewType: ViewType): Promise<FileItem[]> {
		return (
			JSON.parse(
				(await this.client.get("search", { queryText, viewType })).json,
			) || []
		);
	}
}

type Document = {
	path: string;
	view_type: ViewType;
	content: string;
};
