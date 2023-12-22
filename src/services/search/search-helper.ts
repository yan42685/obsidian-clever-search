import { AsyncFzf, type FzfResultItem } from "fzf";
import type { Options } from "minisearch";
import MiniSearch from "minisearch";
import { App, Component } from "obsidian";
import { logger } from "src/utils/logger";
import { container, singleton } from "tsyringe";
import { getCurrLanguage } from "../../globals/language-enum";
import {
	InFileItem,
	Line,
	MatchedLine,
	SearchResult,
	SearchType,
	type InFileDataSource,
	type MiniSearchResult,
} from "../../globals/search-types";
import { MathUtil } from "../../utils/math-util";
import { Database } from "../database/database";
import { DataProvider } from "./data-provider";

@singleton()
export class SearchHelper {
	app: App = container.resolve(App);
	component: Component = new Component();
	inFileDataSource: InFileDataSource = { lines: [], path: "" };

	async searchInFile(queryText: string): Promise<SearchResult> {
		if (!queryText) {
			return new SearchResult(SearchType.IN_FILE, "", []);
		}

		await this.updateDataSource();
		queryText = queryText.replace(/\s/g, "");

		const searchResult = new SearchResult(
			SearchType.IN_FILE,
			this.inFileDataSource.path,
			[],
		);

		const entries = await this.fzfMatch(
			queryText,
			this.inFileDataSource.lines,
		);
		for (const entry of entries) {
			const row = entry.item.row;
			const firstMatchedCol = MathUtil.minInSet(entry.positions);
			const originLine = this.inFileDataSource.lines[row].text;

			// only show part of the line that contains the highlighted chars
			const start = Math.max(firstMatchedCol - 30, 0);
			const end = Math.min(start + 200, originLine.length);
			const substring = originLine.substring(start, end);

			const newPositions = Array.from(entry.positions)
				.filter((position) => position >= start && position < end)
				.map((position) => position - start);

			const highlightedText = this.highlightLineByCharPositions(
				substring,
				newPositions,
			);

			searchResult.items.push(
				new InFileItem(
					new MatchedLine(highlightedText, row, firstMatchedCol),
					await this.getHighlightedContext(
						row,
						firstMatchedCol,
						queryText,
					),
				),
			);
		}

		return searchResult;
	}

	async searchInVault() {}

	private async updateDataSource() {
		// Ensure the active leaf is a markdown note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return { lines: [], path: "" };
		}

		// Read the content and split into lines
		const lines = (await this.app.vault.read(activeFile)).split("\n");

		// Map each line to a MatchedLine object
		this.inFileDataSource = {
			lines: lines.map((line, index) => new Line(line, index)),
			path: activeFile.path,
		};
	}

	/**
	 * Get the HTML of context lines surrounding a matched line in a document.
	 *
	 * @param matchedRow - The row number of the matched line.
	 * @param firstMatchedCol - The column number of the first matched character in the matched line.
	 * @param queryText - The query text used for matching.
	 * @returns A string representing the highlighted context HTML.
	 */
	private async getHighlightedContext(
		matchedRow: number,
		firstMatchedCol: number,
		queryText: string,
	): Promise<string> {
		const currLang = getCurrLanguage();
		// TODO: modify this by currLanguage
		const MAX_PRE_CAHRS_COUNT = 220;
		let preCharsCount = firstMatchedCol;
		let postCharsCount = 0;
		let start = matchedRow;
		let end = matchedRow;

		// extend the context upwards until the start of the document or 7 lines
		// or reaching the required number of characters
		while (
			start > 0 &&
			matchedRow - start <= 7 &&
			preCharsCount < MAX_PRE_CAHRS_COUNT
		) {
			start--;
			preCharsCount += this.inFileDataSource.lines[start].text.length;
		}

		if (preCharsCount > MAX_PRE_CAHRS_COUNT) {
			if (start < matchedRow) {
				start++; // remove the last added line if it's not the matched line
			} else if (start === matchedRow) {
				// truncate the line from firstMatchedCol backward
				const line = this.inFileDataSource.lines[start];
				const startIdx = Math.max(
					firstMatchedCol - MAX_PRE_CAHRS_COUNT,
					0,
				);
				const truncatedLine =
					line.text.substring(startIdx, firstMatchedCol) +
					line.text.substring(firstMatchedCol);
				this.inFileDataSource.lines[start] = new Line(
					truncatedLine,
					line.row,
				);

				// update preCharsCount and postCharsCount
				// preCharsCount = firstMatchedCol - startIdx;
				postCharsCount = line.text.length - firstMatchedCol;
			}
		}
		while (
			end < this.inFileDataSource.lines.length - 1 &&
			postCharsCount < 3 * MAX_PRE_CAHRS_COUNT
		) {
			end++;
			postCharsCount += this.inFileDataSource.lines[end].text.length;
		}
		const contextLines = this.inFileDataSource.lines.slice(start, end + 1);

		const processedQueryText = queryText.replace(/\s/g, "").toLowerCase();

		const highlightedContext = await Promise.all(
			contextLines.map(async (line, index) => {
				const isTargetLine = matchedRow === start + index;

				if (isTargetLine) {
					// 对目标行使用 fzfMatch
					const entries = await this.fzfMatch(queryText, [line]);
					if (entries.length > 0) {
						const entry = entries[0];
						return `<span class="target-line">${this.highlightLineByCharPositions(
							line.text,
							Array.from(entry.positions),
						)}</span>`;
					}
					return `<span class="target-line">${line.text}</div>`;
				} else {
					// 对其他行进行严格匹配，并只高亮匹配的字符
					const regex = new RegExp(processedQueryText, "gi");
					return line.text.replace(
						regex,
						(match) => `<mark>${match}</mark>`,
					);
					// .replace(/ /g, "&nbsp;");
				}
			}),
		);

		return highlightedContext.join("\n");
	}

	private highlightLineByCharPositions(
		str: string,
		positions: number[],
	): string {
		return str
			.split("")
			.map((char, i) => {
				// avoid spaces being ignored when rendering html
				// if (char === " ") {
				// 	return "&nbsp;";
				// }
				return positions.includes(i) ? `<mark>${char}</mark>` : char;
			})
			.join("");
	}

	private async fzfMatch(
		queryText: string,
		lines: Line[],
	): Promise<FzfResultItem<Line>[]> {
		const fzf = new AsyncFzf(lines, {
			selector: (item) => item.text,
		});
		return await fzf.find(queryText);
	}
}

export class LexicalEngine {
	private static readonly OPTIONS: Options = {
		idField: "path",
		fields: ["basename", "aliases", "content"],
	};
	private readonly dataProvider = container.resolve(DataProvider);
	private readonly database = container.resolve(Database);
	private miniSearch: MiniSearch;

	async init() {
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
	}
	async search(query: string): Promise<MiniSearchResult[]> {
		return this.miniSearch.search(query, {
			fields: ["basename", "content"],
		});
	}

	async reIndexAll() {
		const allIndexedDocs = this.dataProvider.getIndexedDocuments();
		await this.miniSearch.removeAll();
		// TODO: add chunks rather than all
		await this.miniSearch.addAllAsync(allIndexedDocs);
		logger.debug(this.miniSearch);
	}
}
