import uFuzzy from "@leeoniya/ufuzzy";
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
import { LangUtil } from "src/utils/lang-util";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { OuterSetting, innerSetting } from "../../globals/plugin-setting";
import { Query } from "./query";
import { Tokenizer } from "./tokenizer";

// If @singleton() is not used,
// then the lifecycle of the instance obtained through tsyringe container is transient.
@singleton()
export class LexicalEngine {
	private option = getInstance(LexicalOptions);
	private pluginSetting = getInstance(OuterSetting);
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
		return (await fzf.find(queryText))
			.slice(0, this.pluginSetting.ui.maxItemResults)
			.map((entry: FzfResultItem<Line>) => {
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
	 */
	@monitorDecorator
	async searchFiles(queryText: string): Promise<MatchedFile[]> {
		// const combinationMode = this.tokenizer.isLargeCharset(queryText) ? "or" : "and";
		const combinationMode = "and";
		// TODO: if queryText.length === 0, return empty,
		//       else if (length === 1 && isn't Chinese char) only search filename
		const query = new Query(queryText);
		const minisearchResult = this.filesIndex.search(
			query.text,
			this.option.getFileSearchOption(combinationMode),
		);
		logger.debug(`maxFileItems: ${this.pluginSetting.ui.maxItemResults}`);
		return minisearchResult
			.slice(0, this.pluginSetting.ui.maxItemResults)
			.map((item) => {
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
		logger.debug(fileItem.queryTerms);
		logger.debug(fileItem.matchedTerms);
		const maxSubItems = 50;
		logger.debug(`max subItems: ${maxSubItems}`);

		// optimization for large charset language to avoid using jieba segmenter
		if (LangUtil.isLargeCharset(queryText)) {
			const bm25Calculator = new LinesCalculator(
				lines,
				queryText,
				fileItem.queryTerms,
				fileItem.matchedTerms,
				(maxParsedLines = maxSubItems),
			);
			return bm25Calculator.parse();
		} else {
			// NOTE: lengthy Japanese and Korean file might be a bit slow due to the jieba segmenter,
			// and they are small charset language, so I don't know how to optimize them using bm25Calculator at the moment
			return await this.searchLinesForSmallCharset(
				lines,
				queryText,
				maxSubItems,
			);
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
	// private readonly setting: SearchSetting = getInstance(OuterSetting).search;
	private readonly inSetting = innerSetting.search;
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly tokenizeIndex = (text: string) =>
		this.tokenizer.tokenize(text, "index");
	private readonly tokenizeSearch = (text: string) =>
		this.tokenizer.tokenize(text, "search");

	readonly documentChunkSize: 100;
	readonly lineChunkSize: 500;
	readonly fileIndexOption: Options = {
		// terms will be lowercased by minisearch
		tokenize: this.tokenizeIndex,
		idField: "path",
		fields: [
			"basename",
			"aliases",
			"folder",
			"headings",
			"content",
		] as DocumentFields,
		storeFields: ["tags"] as DocumentFields,
	};
	readonly lineIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "row",
		fields: ["text"] as LineFields,
		// storeFields: ["text"] as LineFields,
	};

	/**
	 * @param {"and"|"or"} combinationMode - The combination mode:
	 * - "and": Requires any single token to appear in the fields.
	 * - "or": Requires all tokens to appear across the fields.
	 */
	getFileSearchOption(combinationMode: "and" | "or"): SearchOptions {
		return {
			tokenize: this.tokenizeSearch,
			// TODO: for autosuggestion, we can choose to do a prefix match only when the term is
			// at the last index of the query terms
			prefix: (term) =>
				term.length >= this.inSetting.minTermLengthForPrefixSearch,
			// TODO: fuzziness based on language
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.inSetting.fuzzyProportion,
			// if `fields` are omitted, all fields will be search with weight 1
			boost: {
				basename: this.inSetting.weightFilename,
				aliases: this.inSetting.weightFilename,
				folder: this.inSetting.weightFolder,
				tags: this.inSetting.weightTagText,
				headings: this.inSetting.weightHeading,
			} as DocumentWeight,
			combineWith: combinationMode,
		};
	}

	getLineSearchOption(): SearchOptions {
		return {
			prefix: (term) =>
				term.length >= this.inSetting.minTermLengthForPrefixSearch,
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.inSetting.fuzzyProportion,
			combineWith: "or",
			// combineWith: "and",
		};
	}
}

// have a good performance for large charset language but is pretty slow for small charset language
// maybe a Trie could solve this problem
class LinesCalculator {
	private lines: Line[];
	private matchedTerms: string[];
	private maxParsedLines: number;
	private preChars: number;
	private postChars: number;

	constructor(
		lines: Line[],
		queryText: string,
		queryTerms: string[],
		matchedTerms: string[],
		maxParsedLines = 30,
	) {
		this.lines = lines;
		this.matchedTerms = this.filterMatchedTerms(queryTerms, matchedTerms);
		this.maxParsedLines = maxParsedLines;
		this.preChars = Math.max(30, queryText.length * 3);
		this.postChars = Math.max(40, queryText.length * 4);

		logger.debug(`doc matchedTerms: ${this.matchedTerms.join(" ")}`);
	}

	parse(): MatchedLine[] {
		return this.highlightLines(
			this.getTopRelevantLines(this.lines, this.maxParsedLines),
		);
	}

	// @monitorDecorator
	private filterMatchedTerms(
		queryTerms: string[],
		matchedTerms: string[],
	): string[] {
		const matchedQueryTerms = queryTerms.filter(
			(t) =>
				!queryTerms.some(
					(other) => other.length > t.length && other.includes(t),
				) && matchedTerms.includes(t),
		);

		let result: string[];
		if (matchedQueryTerms.length === 0) {
			result = matchedTerms.filter(
				(t) =>
					!matchedTerms.some(
						(other) => other.length > t.length && other.includes(t),
					),
			);
		} else {
			result = matchedQueryTerms;
			// NOTE: based on the fact that matchedTerms only contains unique term
			for (const mTerm of matchedTerms) {
				if (
					!matchedQueryTerms.includes(mTerm) &&
					!this.isSubstringOrSuperString(mTerm, matchedTerms)
				) {
					result.push(mTerm);
				}
			}
		}
		return result;
	}

	private isSubstringOrSuperString(str: string, strArray: string[]): boolean {
		return strArray.some(
			(s) =>
				(s.length > str.length && s.includes(str)) ||
				(str.length > s.length && str.includes(s)),
		);
	}

	// @monitorDecorator
	private getTopRelevantLines(lines: Line[], topK: number): Line[] {
		const opts = {
			unicode: true,
			interSplit: "[^\\p{L}\\d']+",
			intraSplit: "\\p{Ll}\\p{Lu}",
			intraBound: "\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}",
			intraChars: "[\\p{L}\\d']",
			intraContr: "'\\p{L}{1,2}\\b",
		};
		const uf = new uFuzzy(opts);
		// const [idxs, info, order] = uf.search(haystack, needle);
		const idx =
			uf.filter(
				lines.map((line) => line.text),
				this.matchedTerms.join(" "),
			) || [];
		const result = [];
		for (const i of idx.slice(0, topK)) {
			result.push(lines[i]);
		}
		return result;
	}

	// @monitorDecorator
	private highlightLines(lines: Line[]): MatchedLine[] {
		return lines.map((line) => {
			const positions = new Set<number>();
			let highlightStart = -1;
			let highlightEnd = -1;

			// find the last matchedTerm
			for (let i = this.matchedTerms.length - 1; i >= 0; i--) {
				const term = this.matchedTerms[i];
				const lastMatchIndex = line.text.lastIndexOf(term);

				if (lastMatchIndex !== -1) {
					highlightStart = Math.max(
						0,
						lastMatchIndex - this.preChars,
					);
					highlightEnd = Math.min(
						line.text.length,
						lastMatchIndex + term.length + this.postChars,
					);
					break;
				}
			}

			if (highlightStart !== -1 && highlightEnd !== -1) {
				const textSlice = line.text.slice(highlightStart, highlightEnd);
				// highlight all matchedTerms in a limited range
				for (const term of this.matchedTerms) {
					const regex = new RegExp(term, "g");
					let match;
					while ((match = regex.exec(textSlice)) !== null) {
						const termStart = match.index + highlightStart;
						const termEnd = termStart + match[0].length;

						for (let i = termStart; i < termEnd; i++) {
							positions.add(i);
						}
					}
				}
			}

			return {
				text: line.text,
				row: line.row,
				positions: positions,
			};
		});
	}
}
