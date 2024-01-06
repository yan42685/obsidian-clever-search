import { AsyncFzf, type FzfResultItem } from "fzf";
import type { AsPlainObject, Options, SearchOptions } from "minisearch";
import MiniSearch from "minisearch";
import type {
	DocumentFields,
	DocumentWeight,
	FileItem,
	IndexedDocument,
	Line,
	LineFields,
	MatchedFile,
	MatchedLine,
} from "src/globals/search-types";
import { BM25Calculator } from "src/utils/data-structure";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	PluginSetting,
	type SearchSetting,
} from "../../globals/plugin-setting";
import { Query } from "./query";
import { Tokenizer } from "./tokenizer";

// If @singleton() is not used,
// then the lifecycle of the instance obtained through tsyringe container is transient.
@singleton()
export class LexicalEngine {
	private option = getInstance(LexicalOptions);
	public filesIndex = new MiniSearch(this.option.fileIndexOption);
	private linesIndex = new MiniSearch(this.option.lineIndexOption);
	private tokenizer = getInstance(Tokenizer);
	private _isReady = false;

	@monitorDecorator
	async reIndexAll(data: IndexedDocument[] | AsPlainObject) {
		this._isReady = false;
		this.filesIndex.removeAll();
		// this.linesIndex.removeAll();

		if (Array.isArray(data)) {
			logger.trace("Indexing all documents...");
			// Process data with type: IndexedDocument[], need lots of time to create reversed indexes
			await this.addDocuments(data);
		} else {
			logger.trace("Loading indexed data...");
			// Process data with type: AsPlainObject, faster
			this.filesIndex = MiniSearch.loadJS(
				data,
				this.option.fileIndexOption,
			);
		}
		this._isReady = true;
		logger.trace(this.filesIndex);
	}

	// NOTE: need be checked before opening a search-in-vault modal to avoid error when search during indexing
	get isReady(): boolean {
		return this._isReady;
	}

	async addDocuments(documents: IndexedDocument[]) {
		const docsToAdd = documents.filter(
			(doc) => !this.filesIndex.has(doc.path),
		);
		await this.filesIndex.addAllAsync(docsToAdd, {
			chunkSize: this.option.documentChunkSize,
		});
		logger.debug(`added ${docsToAdd.length}`);
	}

	deleteDocuments(paths: string[]) {
		const docsToDiscard = paths.filter((path) => this.filesIndex.has(path));
		this.filesIndex.discardAll(docsToDiscard);
		logger.debug(`deleted ${docsToDiscard.length}`);
	}

	// for in-file search
	async fzfMatch(queryText: string, lines: Line[]): Promise<MatchedLine[]> {
		const fzf = new AsyncFzf(lines, {
			selector: (item) => item.text,
		});
		return (await fzf.find(queryText)).map((entry: FzfResultItem<Line>) => {
			return {
				text: entry.item.text,
				row: entry.item.row,
				positions: entry.positions,
			} as MatchedLine;
		});
	}

	/**
	 * Performs a search using the provided query and combination mode.
	 * NOTE: minisearch.search() is async in fact
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
		const minisearchResult = this.filesIndex.search(
			query.text,
			this.option.getFileSearchOption(combinationMode),
		);

		return minisearchResult.map((item) => {
			return {
				path: item.id,
				queryTerms: item.queryTerms,
				matchedTerms: item.terms,
			};
		});
	}

	// faster version of `searchLines`, but might be less accuracy, haven't test it
	// I write this method because when searching in a lengthy CJK language file,
	// the tokenizing speed is unsatisfactory
	async searchLinesByFileItem(
		lines: Line[],
		queryText: string,
		fileItem: FileItem,
		maxParsedLines: number,
	): Promise<MatchedLine[]> {
		logger.debug(fileItem.matchedTerms);
		// optimization for large charset language to avoid using jieba segmenter 
		if (this.tokenizer.isLargeCharset(queryText)) {
			const bm25Calculator = new BM25Calculator(
				lines,
				fileItem.queryTerms,
				fileItem.matchedTerms,
			);
			return bm25Calculator.calculate(maxParsedLines);
		} else {
			// NOTE: lengthy Japanese and Korean file might be a bit slow due to the jieba segmenter,
			// and they are small charset language, so I don't know how to optimize them using bm25Calculator at the moment
			return await this.searchLinesForSmallCharset(lines, queryText, 30);
		}
	}

	/**
	 * @deprecated 0.1.x Use `searchLinesByFileItem` instead. This method is pretty slow, and doesn't reuse the prev search result;
	 */
	@monitorDecorator
	private async searchLinesForSmallCharset(
		lines: Line[],
		queryText: string,
		maxParsedLines: number,
	): Promise<MatchedLine[]> {
		this.linesIndex.removeAll();
		// logger.info(lines);

		// NOTE: can't use `addAllAsync` here, there might be some bugs in minisearch
		this.linesIndex.addAll(lines);
		// await this.linesIndex.addAllAsync(lines, {
		// 	chunkSize: this.option.lineChunkSize,
		// });

		const minisearchResult = this.linesIndex.search(
			queryText,
			this.option.getLineSearchOption(),
		);

		logger.debug(`matched lines count: ${minisearchResult.length}`);
		logger.debug(`only parse top ${maxParsedLines} matched lines per file`);
		return minisearchResult.slice(0, maxParsedLines).map((item) => {
			const lineText = lines[item.id].text;
			return {
				text: lineText,
				row: item.id,
				positions: this.findAllTermPositions(lineText, item.terms),
			} as MatchedLine;
		});
	}

	/**
	 * @deprecated 0.1.x Use `searchLinesByTerms` instead
	 * find all chars positions of terms in a given line
	 */
	private findAllTermPositions(line: string, terms: string[]): Set<number> {
		const regex = new RegExp(terms.join("|"), "gi");
		const positions = new Set<number>();

		let match: RegExpExecArray | null;
		let lastIndex = -1;

		while ((match = regex.exec(line)) !== null) {
			// skip and move to the next character if a match is an empty string or at the same position
			if (match.index === lastIndex || match[0].length === 0) {
				regex.lastIndex++;
				continue;
			}

			for (let i = 0; i < match[0].length; i++) {
				positions.add(match.index + i);
			}

			lastIndex = match.index;
		}

		return positions;
		// return new Set([1]);  // test if this function consumes too much time
	}
}

@singleton()
class LexicalOptions {
	private readonly setting: SearchSetting = getInstance(PluginSetting).search;
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly tokenize = (text: string) => this.tokenizer.tokenize(text);

	readonly documentChunkSize: 50;
	readonly lineChunkSize: 500;
	readonly fileIndexOption: Options = {
		// terms will be lowercased by minisearch
		tokenize: this.tokenize,
		idField: "path",
		fields: ["basename", "folder", "aliases", "content"] as DocumentFields,
	};
	readonly lineIndexOption: Options = {
		tokenize: this.tokenize,
		idField: "row",
		fields: ["text"] as LineFields,
		// storeFields: ["text"] as LineFields,
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
			prefix: (term) =>
				term.length >= this.setting.minTermLengthForPrefixSearch,
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.setting.fuzzyProportion,
			combineWith: "or",
			// combineWith: "and",
		};
	}
}
