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
import { Query } from "./query";

// If @singleton() is not used,
// then the lifecycle of the instance obtained through tsyringe container is transient.
@singleton()
export class LexicalEngine {
	private option = getInstance(LexicalOptions);
	private minisearch: MiniSearch = new MiniSearch(
		this.option.fileIndexOption,
	);
	private _isReady = false;

	@monitorDecorator
	async reIndexAll(data: IndexedDocument[] | AsPlainObject) {
		this._isReady = false;
		await this.minisearch.removeAll();

		if (Array.isArray(data)) {
			logger.trace("Indexing all documents...");
			// Process data with type: IndexedDocument[], need lots of time to create reversed indexes
			await this.minisearch.addAllAsync(data, {
				chunkSize: this.option.documentChunkSize,
			});
		} else {
			logger.trace("Loading indexed data...");
			// Process data with type: AsPlainObject, faster
			this.minisearch = MiniSearch.loadJS(
				data,
				this.option.fileIndexOption,
			);
		}
		this._isReady = true;
		logger.trace(this.minisearch);
	}

	get isReady() {
		return this._isReady;
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
		const minisearchResult = this.minisearch.search(
			query.text,
			this.option.getFileSearchOption(combinationMode),
		);
		return minisearchResult.map((item) => {
			return {
				path: item.id,
				matchedTerms: item.terms,
			};
		});
	}

	async searchLines(
		lines: Line[],
		queryText: string,
	): Promise<MatchedLine[]> {
		const tmpIndex = new MiniSearch(this.option.lineIndexOption);
		await tmpIndex.addAllAsync(lines, {
			chunkSize: this.option.lineChunkSize,
		});
		const minisearchResult = tmpIndex.search(
			queryText,
			this.option.getLineSearchOption(),
		);
		
		return minisearchResult.map((item)=> {
			return {
				"text": item.text,
				"row": item.id,
				positions: this.findAllTermPositions(item.text, item.terms)
			} as MatchedLine
		})
	}

	// TODO: refactor with KMP algorithm if necessary
	findAllTermPositions(line: string, terms: string[]): Set<number> {
		const positions = new Set<number>;

		terms.forEach((term) => {
			let index = line.indexOf(term);

			while (index !== -1) {
				for (let i = 0; i < term.length; i++) {
					positions.add(index + i);
				}
				index = line.indexOf(term, index + 1);
			}
		});

		return positions;
	}
}

@singleton()
class LexicalOptions {
	private readonly setting: SearchSetting = getInstance(PluginSetting).search;

	readonly documentChunkSize: 200;
	readonly lineChunkSize: 500;
	readonly fileIndexOption: Options = {
		idField: "path",
		fields: ["basename", "aliases", "content"] as DocumentFields,
	};
	readonly lineIndexOption: Options = {
		idField: "row",
		fields: ["text"] as LineFields,
		storeFields: ["text"] as LineFields,
	};

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

	getLineSearchOption(): SearchOptions {
		return {
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.setting.fuzzyProportion,
			combineWith: "or",
			// combineWith: "and",
		};
	}
}
