import type { AsPlainObject, Options, SearchOptions } from "minisearch";
import MiniSearch from "minisearch";
import type {
	DocumentFields,
	DocumentWeight,
	IndexedDocument,
	Line,
	LineFields,
	MatchedFile,
	MatchedLine,
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	PluginSetting,
	type SearchSetting,
} from "../../globals/plugin-setting";
import { Database } from "../database/database";
import { DataProvider } from "./data-provider";
import { Query } from "./query";

// If @singleton() is not used,
// then the lifecycle of the instance obtained through tsyringe container is transient.
@singleton()
export class LexicalEngine {
	private static readonly inVaultOption: Options = {
		idField: "path",
		fields: ["basename", "aliases", "content"] as DocumentFields,
	};
	private readonly dataProvider = getInstance(DataProvider);
	private readonly database = getInstance(Database);
	private filesIndex: MiniSearch;
	private settings: SearchSetting = getInstance(PluginSetting).search;
	private _isReady = false;

	@monitorDecorator
	async initAsync(previousData?: AsPlainObject) {
		logger.trace("init lexical engine...");
		const prevData = await this.database.getMiniSearchData();
		if (prevData) {
			this.filesIndex = MiniSearch.loadJS(
				prevData,
				LexicalEngine.inVaultOption,
			);
		} else {
			this.filesIndex = new MiniSearch(LexicalEngine.inVaultOption);
			await this.reIndexAllFiles();
		}
		this._isReady = true;
	}

	get isReady() {
		return this._isReady;
	}

	async reIndexAllFiles(newIndexedDocuments?: IndexedDocument[]) {
		this._isReady = false;
		const allIndexedDocs =
			await this.dataProvider.generateAllIndexedDocuments();
		await this.filesIndex.removeAll();
		// TODO: add chunks rather than all
		await this.filesIndex.addAllAsync(allIndexedDocs);
		logger.debug(this.filesIndex);
		this._isReady = true;
	}

	/**
	 * Performs a search using the provided query and combination mode.
	 *
	 * @param {"and"|"or"} combinationMode - The combination mode:
	 * - "and": Requires any single token to appear in the fields.
	 * - "or": Requires all tokens to appear across the fields.
	 */
	@monitorDecorator
	async searchFiles(
		queryText: string,
		combinationMode: "and" | "or",
	): Promise<MatchedFile[]> {
		// TODO: if queryText.length === 0, return empty,
		//       else if (length === 1 && isn't Chinese char) only search filename
		const query = new Query(queryText);
		const minisearchResult = this.filesIndex.search(query.text, {
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

	searchLines(lines: Line[], queryText: string): MatchedLine[] {
		return [];
	}
}

@singleton()
class LexicalOptions {
	private readonly setting: SearchSetting = getInstance(PluginSetting).search;
	getFileIndexOption(): Options {
		return {
			idField: "path",
			fields: ["basename", "aliases", "content"] as DocumentFields,
		};
	}

	getFileSearchOption(combinationMode: "and" | "or"): SearchOptions {
		return {
			// TODO: for autosuggestion, we can choose to do a prefix match only when the term is
			// at the last index of the query terms
			prefix: (term) =>
				term.length >= this.setting.minTermLengthForPrefixSearch,
			// TODO: fuzziness based on language
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.setting.fuzzyProportion,
			// if `fields` are omitted, all fields will be search with weight 1
			boost: {
				path: this.setting.weightPath,
				basename: this.setting.weightPath,
				aliases: this.setting.weightPath,
			} as DocumentWeight,
			combineWith: combinationMode,
		};
	}

	getLineIndexOption(): Options {
		return {
			fields: ["text", "row"] as LineFields,
			storeFields: ["text", "row"] as LineFields,
		};
	}

	getLineSearchOption(): SearchOptions {
		return {}
	}
}
