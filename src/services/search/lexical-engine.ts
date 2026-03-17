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
import { PriorityQueue } from "src/utils/data-structure";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { OuterSetting, innerSetting } from "../../globals/plugin-setting";
import { Tokenizer } from "./tokenizer";
import { TruncateOption, type TruncateType } from "./truncate-option";

// If @singleton() is not used,
// then the lifecycle of the instance obtained through tsyringe container is transient.
@singleton()
export class LexicalEngine {
	private option = getInstance(LexicalOptions);
	private outerSetting = getInstance(OuterSetting);
	public filesIndex = new MiniSearch(this.option.fileIndexOption);
	private linesIndex = new MiniSearch(this.option.lineIndexOption);
	private tokenizer = getInstance(Tokenizer);
	private _isReady = false;

	@monitorDecorator
	async reIndexAll(
		data: IndexedDocument[] | AsPlainObject,
	): Promise<boolean> {
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
			try {
				// slower than loadJS, but more stable, maybe I should test the perf difference someday
				this.filesIndex = MiniSearch.loadJS(
					data,
					this.option.fileIndexOption,
				);
			} catch (e) {
				// alert("Lexical engine might have been updated, the vault need to be reindexed\n(clever-search)");
				logger.error(e);
				return false;
			}
		}
		this._isReady = true;
		logger.trace(this.filesIndex);
		return true;
	}

	// NOTE: need be checked before opening a search-in-vault modal to avoid error when search during indexing
	get isReady(): boolean {
		return this._isReady;
	}

	async addDocuments(documents: IndexedDocument[]) {
	// 1. 获取所有待处理路径
    const paths = documents.map(doc => doc.path);
    // 2. 强制先从索引中移除旧条目（minisearch.discard 会处理不存在的情况）
    this.filesIndex.discardAll(paths); 
    
    // 3. 现在可以安全地添加了
    await this.filesIndex.addAllAsync(documents, {
        chunkSize: this.option.documentChunkSize,
    });
    logger.debug(`updated/added ${documents.length} docs`);
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
			.slice(0, this.outerSetting.ui.maxItemResults)
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
		// TODO: if queryText.length === 0, return empty,
		//       else if (length === 1 && isn't Chinese char) only search filename
		const query = new Query(queryText);
		const minisearchResult = this.filesIndex.search(
			query.text,
			this.option.getFileSearchOption(query.userOption),
		);
		logger.debug(`maxFileItems: ${this.outerSetting.ui.maxItemResults}`);
		return minisearchResult
			.slice(0, this.outerSetting.ui.maxItemResults)
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
		truncateType: TruncateType,
		queryText: string,
		fileItem: FileItem,
		maxParsedLines: number,
	): Promise<MatchedLine[]> {
		logger.debug(fileItem.queryTerms);
		logger.debug(fileItem.matchedTerms);
		const maxSubItems = 50;
		logger.debug(`max subItems: ${maxSubItems}`);

		// optimization for large charset language to avoid using jieba segmenter
		// if (LangUtil.isLargeCharset(queryText)) {
		const linesMatcher = new LinesMatcher(
			lines,
			truncateType,
			queryText,
			fileItem.queryTerms,
			fileItem.matchedTerms,
			maxParsedLines,
		);
		return linesMatcher.parse();
		// } else {
		// 	// NOTE: lengthy Japanese and Korean file might be a bit slow due to the jieba segmenter,
		// 	// and they are small charset language, so I don't know how to optimize them using bm25Calculator at the moment
		// 	return await this.searchLinesForSmallCharset(
		// 		lines,
		// 		queryText,
		// 		maxSubItems,
		// 	);
		// }
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
	private readonly outerSetting = getInstance(OuterSetting);
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
		// will be applied when indexing and searching
		processTerm: (term) =>
			this.outerSetting.isCaseSensitive ? term : term.toLocaleLowerCase(),
	};
	readonly lineIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "row",
		fields: ["text"] as LineFields,
		// storeFields: ["text"] as LineFields,
	};

	getFileSearchOption(userOption: UserSearchOption): SearchOptions {
		return {
			tokenize: this.tokenizeSearch,
			// TODO: for autosuggestion, we can choose to do a prefix match only when the term is
			// at the last index of the query terms
			prefix: (term) =>
				userOption.isPrefixMatch
					? term.length >= this.inSetting.minTermLengthForPrefixSearch
					: false,
			// TODO: fuzziness based on language
			fuzzy: (term) =>
				userOption.isFuzzy
					? term.length <= 3
						? 0
						: this.inSetting.fuzzyProportion
					: false,
			// if `fields` are omitted, all fields will be search with weight 1
			boost: {
				basename: this.inSetting.weightFilename,
				aliases: this.inSetting.weightFilename,
				folder: this.inSetting.weightFolder,
				tags: this.inSetting.weightTagText,
				headings: this.inSetting.weightHeading,
			} as DocumentWeight,
			combineWith: "and",
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

class LinesMatcher {
	private outerSetting = getInstance(OuterSetting);
	private userOption: UserSearchOption;
	private lines: Line[];
	private queryTermsLowerCase: string[];
	private matchedTerms: string[];
	private maxParsedLines: number;
	private preChars: number;
	private postChars: number;

	constructor(
		lines: Line[],
		truncateType: TruncateType,
		queryText: string,
		queryTerms: string[],
		matchedTerms: string[],
		maxParsedLines: number,
	) {
		const query = new Query(queryText);

		this.userOption = query.userOption;
		this.lines = lines;
		this.queryTermsLowerCase = queryTerms.map((t)=>t.toLocaleLowerCase());
		this.matchedTerms = this.filterMatchedTerms(queryTerms, matchedTerms);
		this.maxParsedLines = maxParsedLines;
		// TODO: use token rather than chars
		const truncateLimit = TruncateOption.forType(truncateType, query.text);
		this.preChars = truncateLimit.maxPreChars;
		this.postChars = truncateLimit.maxPostChars;

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
			// NOTE: based on the fact that matchedTerms only contain unique term
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

	// const opts = {
	// 	unicode: true,
	// 	interSplit: "[^\\p{L}\\d']+",
	// 	intraSplit: "\\p{Ll}\\p{Lu}",
	// 	intraBound: "\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}",
	// 	intraChars: "[\\p{L}\\d']",
	// 	intraContr: "'\\p{L}{1,2}\\b",
	// };
	// const uf = new uFuzzy(opts);
	// // const [idxs, info, order] = uf.search(haystack, needle);
	// const idx =
	// 	uf.filter(
	// 		lines.map((line) => line.text),
	// 		this.matchedTerms.join(" "),
	// 	) || [];
	// const result = [];
	// for (const i of idx.slice(0, topK)) {
	// 	result.push(lines[i]);
	// }
	@monitorDecorator
private getTopRelevantLines(lines: Line[], topK: number): Line[] {
    const nTerms = this.matchedTerms.length;
    if (nTerms === 0) return [];

    /**
     * 1. 【核心优化：构造单次扫描正则】
     * 将所有搜索词合并为一个带捕获组的巨型正则。
     * 排序逻辑：长词排在前面（如 "obsidian" 排在 "obs" 前），防止短词因正则贪婪匹配而拦截长词。
     */
    const sortedMatchedTerms = [...this.matchedTerms].sort((a, b) => b.length - a.length);
    const combinedPattern = sortedMatchedTerms
        .map(term => `(${this.generateRegExpForTerm(term).source})`)
        .join("|");
    const flags = this.outerSetting.isCaseSensitive ? "g" : "gi";
    const bigRegex = new RegExp(combinedPattern, flags);

    /**
     * 2. 【预处理权重与位掩码】
     * 提前计算每个捕获组对应的权重，避免在循环内进行复杂计算。
     */
    const termWeightMap = new Map<number, { weight: number, bit: number }>();
    sortedMatchedTerms.forEach((term, index) => {
        const lower = term.toLowerCase();
        // 查找当前词在用户原始输入中的位置，用于计算“末尾词权重”
        const queryIdx = this.queryTermsLowerCase.findIndex(q => lower.startsWith(q));
        
        termWeightMap.set(index + 1, { // 正则捕获组索引从 1 开始
            // 权重采用 10^i，确保后一个搜索词的权重绝对压倒前词总和（符合直觉）
            weight: queryIdx !== -1 ? Math.pow(10, queryIdx) : 1,
            // 位掩码：用二进制中的一位记录该词是否出现，方便后续计算“覆盖了多少个词”
            bit: 1 << (queryIdx !== -1 ? queryIdx : 15)
        });
    });

    const topKLinesScores = new PriorityQueue<number>((a, b) => a - b, topK);
    topKLinesScores.push(0);
    const candidateLineMap = new Map<Line, number>();
    
    // 唯一词覆盖数的乘数，确保“覆盖更多搜索词”拥有最高优先级
    const UNIQUE_TERM_MULTIPLIER = 1_000_000_000;

    /**
     * 3. 【高性能主循环】
     * 遍历十几万行数据。由于使用了单次扫描正则，每行字符串只会被正则引擎处理一遍。
     */
    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i];
        const text = line.text;
        
        bigRegex.lastIndex = 0; // 重置正则扫描位置
        let match;
        let matchedBits = 0;    // 位掩码状态，记录匹配到的关键词种类
        let weightedScore = 0;  // 基础加权分
        let proximityBonus = 0; // 连续性/短语加分
        let lastMatchEnd = -1;  // 记录上一个匹配结束的位置，计算距离
        let lastQueryIdx = -1;  // 记录上一个匹配词的索引，判断顺序
        let hasMatch = false;

        while ((match = bigRegex.exec(text)) !== null) {
            hasMatch = true;
            
            // 确定是哪个捕获组（关键词）被匹配到了
            let groupIdx = 1;
            while (!match[groupIdx]) groupIdx++;
            
            const data = termWeightMap.get(groupIdx)!;
            const matchStart = match.index;
            const matchText = match[0];
            const currentQueryIdx = Math.log10(data.weight); // 通过权重反推在 Query 中的索引位

            // 更新唯一词追踪位
            matchedBits |= data.bit;

            // 基础分：权重 * 匹配长度
            weightedScore += data.weight * matchText.length;

            /**
             * 【智能排序：连续性与顺序加分】
             * 如果当前词紧跟在上一个词后面（短语匹配），或符合输入顺序，给予额外奖励。
             */
            if (lastMatchEnd !== -1) {
                const distance = matchStart - lastMatchEnd;
                // 距离奖分：距离越近（如挨在一起的短语），分数越高
                if (distance < 10) {
                    proximityBonus += 500 / (distance + 1);
                }
                // 顺序奖分：如果原文中出现的顺序和搜索框输入的顺序一致，加分
                if (currentQueryIdx > lastQueryIdx) {
                    proximityBonus += 50;
                }
            }

            lastMatchEnd = matchStart + matchText.length;
            lastQueryIdx = currentQueryIdx;
        }

        if (!hasMatch) continue;

        /**
         * 4. 【最终评分计算】
         * 计算公式：(唯一词个数 * 10亿) + 基础权重分 + 连续性奖分 + 长度惩罚
         */
        const uniqueCount = this.popcount(matchedBits); // 计算二进制中有几个 1（即几个不同词）
        
        // 长度惩罚：在同等匹配情况下，行越短（密度越高）排名越靠前
        const lengthPenalty = (1 / text.length) * 0.1;
        
        const finalScore = (uniqueCount * UNIQUE_TERM_MULTIPLIER) + 
                           weightedScore + 
                           proximityBonus + 
                           lengthPenalty;

        // 使用优先队列只保留前 topK 个高分结果
        if (finalScore > (topKLinesScores.peek() as number)) {
            topKLinesScores.push(finalScore);
            candidateLineMap.set(line, finalScore);
        }
    }

    // 5. 将 Map 转换回数组，按最终得分降序排列并返回
    return Array.from(candidateLineMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map((entry) => entry[0]);
}

/**
 * 计算二进制位中 1 的个数（Hamming Weight）
 * 极速算法：利用位移和掩码在常数时间内求得结果，避免循环。
 */
private popcount(n: number): number {
    n = n - ((n >> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
    return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

	@monitorDecorator
	private highlightLines(lines: Line[]): MatchedLine[] {
		const termRegexMap = new Map<string, RegExp>();
		for (const term of this.matchedTerms) {
			// termRegexMap.set(term, new RegExp(term, "gi"));
			termRegexMap.set(term, this.generateRegExpForTerm(term));
		}
		return lines.map((line) => {
			const positions = new Set<number>();
			let highlightStart = -1;
			let highlightEnd = -1;

			// find the first occurrence from right to left in the matchedTerms
			for (let i = this.matchedTerms.length - 1; i >= 0; i--) {
				const term = this.matchedTerms[i];
				const startIndex = line.text.search(
					termRegexMap.get(term) as RegExp,
				);

				if (startIndex !== -1) {
					highlightStart = Math.max(0, startIndex - this.preChars);
					highlightEnd = Math.min(
						line.text.length,
						startIndex + term.length + this.postChars,
					);
					break;
				}
			}

			if (highlightStart !== -1 && highlightEnd !== -1) {
				const textSlice = line.text.slice(highlightStart, highlightEnd);
				// highlight all matchedTerms in a limited range
				for (const term of this.matchedTerms) {
					const regex = termRegexMap.get(term) as RegExp;
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

	private generateRegExpForTerm(term: string): RegExp {
		const flags = this.outerSetting.isCaseSensitive ? "g" : "gi";
		const pattern = this.userOption.isPrefixMatch
			? term
			: `${term}(?![a-zA-Z])`;
		return new RegExp(pattern, flags);
	}

	// generate a weight for each term based on its position in the query
	private positionWeight(matchedTerm: string): number {
		const lowerTerm = matchedTerm.toLocaleLowerCase();
		const exactIndex = this.queryTermsLowerCase.indexOf(lowerTerm);
		
		// if exact match exists, prioritize it with (index+1)^2
		if (exactIndex !== -1) {
			return (exactIndex + 1) * (exactIndex + 1);
		}
		
		// find the longest prefix match among query terms
		let longestPreMatchIndex = -1;
		let maxPrefixLength = 0;
		
		for (let i = 0; i <this.queryTermsLowerCase.length; i++) {
			const queryTerm = this.queryTermsLowerCase[i];
			if (lowerTerm.startsWith(queryTerm) && queryTerm.length > maxPrefixLength) {
				maxPrefixLength = queryTerm.length;
				longestPreMatchIndex = i;
			}
		}
		
		// not the exact match, but a fuzzy match or indirect match
		if (longestPreMatchIndex === -1) {
			return 1;
		} else {
			return  (longestPreMatchIndex + 1) * (longestPreMatchIndex + 1) 
		}
	}
}

class UserSearchOption {
	private outerSetting = getInstance(OuterSetting);
	public isPrefixMatch: boolean;
	public isFuzzy: boolean;

	constructor() {
		this.isPrefixMatch = this.outerSetting.isPrefixMatch;
		this.isFuzzy = this.outerSetting.isFuzzy;
	}
}

class Query {
	private static readonly registeredCommands = new Set([
		"ap", // allow prefix matching
		"np", // no prefix matching
		"af", // allow fuzziness
		"nf", // no fuzziness
	]);

	public text: string;
	public userOption: UserSearchOption = new UserSearchOption();

	constructor(queryText: string) {
		this.parse(queryText);
	}

	private parse(queryText: string): void {
		const parts = queryText.split(" ");
		const commands = [];

		// check if the first part is a command
		if (parts[0].startsWith("/")) {
			const firstPart = parts.shift() as string; // remove the first part 
			commands.push(...firstPart.split("/"));
		}

		// check if the last part is a command
		if (parts.length > 0 && parts[parts.length - 1].startsWith("/")) {
			const lastPart = parts.pop() as string; // remove the last part
			commands.push(...lastPart.split("/"));
		}

		// remaining parts are the search text
		this.text = parts.join(" ");

		for (const command of commands) {
			if (command === "") {
				continue;
			}
			if (command === "ap") {
				this.userOption.isPrefixMatch = true;
			} else if (command === "np") {
				this.userOption.isPrefixMatch = false;
			} else if (command === "af") {
				this.userOption.isFuzzy = true;
			} else if (command === "nf") {
				this.userOption.isFuzzy = false;
			} else {
				// reset options if an unregistered command is encountered
				this.userOption = new UserSearchOption();
				logger.info("invalid command: /" + command);
				break;
			}
		}
	}
}
