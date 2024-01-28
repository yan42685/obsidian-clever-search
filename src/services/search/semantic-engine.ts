import type { RequestUrlParam } from "obsidian";
import type { IndexedDocument } from "src/globals/search-types";
import { singleton } from "tsyringe";

@singleton()
export class SemanticEngine {
	async reindexAll(data: IndexedDocument[]) {

    }
}

@singleton()
class RemoteRequest {
}