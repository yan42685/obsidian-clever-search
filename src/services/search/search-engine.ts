import type { Options } from "minisearch";
import MiniSearch from "minisearch";
import type { DocumentWeight, MatchedFile } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { monitorDecorator } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import { Database } from "../database/database";
import { PluginSetting, type SearchSetting } from "../obsidian/setting";
import { DataProvider } from "./data-provider";
import { Query } from "./query";

// If @singleton() is not used,
// then the lifecycle of the instance obtained through tsyringe container is transient.
@singleton()
export class LexicalEngine {
	private static readonly OPTIONS: Options = {
		idField: "path",
		fields: ["basename", "aliases", "content"],
	};
	private readonly dataProvider = container.resolve(DataProvider);
	private readonly database = container.resolve(Database);
	private miniSearch: MiniSearch;
	private settings: SearchSetting = container.resolve(PluginSetting).search;
	private _isReady = false;

	@monitorDecorator
	async initAsync() {
		logger.debug("init lexical engine...");
		const prevData = await this.database.getMiniSearchData();
		if (prevData) {
			this.miniSearch = MiniSearch.loadJS(
				prevData,
				LexicalEngine.OPTIONS,
			);
		} else {
			this.miniSearch = new MiniSearch(LexicalEngine.OPTIONS);
			await this.reIndexAll();
		}
		this._isReady = true;
	}

	get isReady() {
		return this._isReady;
	}

	async reIndexAll() {
		this._isReady = false;
		const allIndexedDocs =
			await this.dataProvider.generateAllIndexedDocuments();
		await this.miniSearch.removeAll();
		// TODO: add chunks rather than all
		await this.miniSearch.addAllAsync(allIndexedDocs);
		logger.debug(this.miniSearch);
		this._isReady = true;
	}

	// all tokens are matched and can be scattered
	async searchAnd(query: string) {
		return this.search(query, "and");
	}

	async searchOr(query: string) {
		return this.search(query, "or");
	}

	/**
	 * Performs a search using the provided query and combination mode.
	 *
	 * @param {"and"|"or"} combinationMode - The combination mode:
	 * - "and": Requires any single token to appear in the fields.
	 * - "or": Requires all tokens to appear across the fields.
	 */
	@monitorDecorator
	private async search(
		queryText: string,
		combinationMode: "and" | "or",
	): Promise<MatchedFile[]> {
		// TODO: if queryText.length === 0, return empty,
		//       else if (length === 1 && isn't Chinese char) only search filename
		const query = new Query(queryText);
		const minisearchResult = this.miniSearch.search(query.text, {
			// TODO: for autosuggestion, we can choose to do a prefix match only when the term is
			// at the last index of the query terms
			prefix: (term) =>
				term.length >= this.settings.minTermLengthForPrefixSearch,
			// TODO: fuzziness based on language
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.settings.fuzzyProportion,
			// if `fields` are omitted, all fields will be search with weight 1
			boost: {
				path: this.settings.weightPath,
				basename: this.settings.weightPath,
				aliases: this.settings.weightPath,
			} as DocumentWeight,
			combineWith: combinationMode,
		});
		return minisearchResult.map((item) => {
			return {
				path: item.id,
				matchedTerms: item.terms,
			};
		});
	}
}
