import type { AsPlainObject } from "minisearch";
import type { DocumentRef } from "src/globals/search-types";

export class Database {
	/**
	 * @returns JSON string
	 */
	async getMiniSearchData(): Promise<AsPlainObject | null> {
		return null;
	}

    async getDocumentRefs(): Promise<DocumentRef[]> {
        return [];
    }
}
