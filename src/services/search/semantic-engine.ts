import type { IndexedDocument } from "src/globals/search-types";
import { getInstance } from "src/utils/my-lib";
import { HttpClient } from "src/utils/web/http-client";
import { singleton } from "tsyringe";
import { ViewType } from "../obsidian/view-registry";

@singleton()
export class SemanticEngine {
	private request = getInstance(RemoteRequest);
	async reindexAll(data?: IndexedDocument[]) {
		const docs = [
			{
				path: "abc.txt",
				view_type: ViewType.MARKDOWN,
				content: "test content",
			} as Document,
		];
		await this.request.reindexAll(docs);
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
}

type Document = {
	path: string;
	view_type: ViewType;
	content: string;
};
