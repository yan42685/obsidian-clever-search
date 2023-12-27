import { AsyncFzf, type FzfResultItem } from "fzf";
import { LanguageEnum, getCurrLanguage } from "src/globals/language-enum";
import {
	EngineType,
	FileItem,
	FileType,
	Line,
	LineItem,
	MatchedLine,
	type MatchedFile
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MathUtil } from "src/utils/math-util";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { FileRetriever } from "./data-provider";

@singleton()
export class Highlighter {
	private readonly fileRetriever: FileRetriever = getInstance(FileRetriever);
	private readonly lineHighlighter = getInstance(LineHighlighter);

	// TODO: highlight by page, rather than reading all files
	async parseFileItems(
		matchedFiles: MatchedFile[],
		engineType: EngineType,
	): Promise<FileItem[]> {
		// TODO: do real highlight
		const result = await Promise.all(
			matchedFiles.slice(0, 50).map(async (f) => {
				const path = f.path;
				if (
					this.fileRetriever.getFileType(path) === FileType.PLAIN_TEXT
				) {
					const content =
						await this.fileRetriever.readPlainText(path);
					const lines = content.split("\n"); // 正则表达式匹配 \n 或 \r\n
					const firstTenLines = lines.slice(0, 10).join("\n");
					// It is necessary to use a constructor with 'new', rather than using an object literal.
					// Otherwise, it is impossible to determine the type using 'instanceof', achieving polymorphic effects based on inheritance
					// (to correctly display data in Svelte components).
					return new FileItem(engineType, f.path, [firstTenLines]);
				} else {
					return new FileItem(engineType, f.path, [
						"not supported file type",
					]);
				}
			}),
		);
		logger.warn("current only highlight top 50 files");
		return result;
	}

	async parseLineItems(
		path: string,
		queryText: string,
		style: "minisearch" | "fzf",
	): Promise<LineItem[]> {
		if (style === "fzf") {
			return this.lineHighlighter.parseLineItems(path, queryText);
		} else if (style === "minisearch") {
			throw new Error(TO_BE_IMPL);
		} else {
			throw new Error(TO_BE_IMPL);
		}
	}
}

export interface TruncateLimitConfig {
	maxPreCharsForItem: number;
	maxPreCharsForPreview: number;
	maxPreLines: number;
}

export class TruncateLimit {
	private static readonly limitsByLanguage: Record<
		LanguageEnum,
		TruncateLimitConfig
	> = {
		[LanguageEnum.other]: {
			maxPreCharsForItem: 80,
			maxPreCharsForPreview: 200,
			maxPreLines: 10,
		},
		[LanguageEnum.en]: {
			maxPreCharsForItem: 80,
			maxPreCharsForPreview: 200,
			maxPreLines: 10,
		},
		[LanguageEnum.zh]: {
			maxPreCharsForItem: 30,
			maxPreCharsForPreview: 120,
			maxPreLines: 10,
		},
	};

	// public static getConfig(strArray: string[]): TruncateLimitConfig {
	// 	const languageResult = textAnalyzer.detectLanguage(strArray);

	// }
}


@singleton()
class LineHighlighter implements LineHighlighter {
	private readonly fileRetriever = getInstance(FileRetriever);

	async parseLineItems(path: string, queryText: string): Promise<LineItem[]> {
		const lines = (await this.fileRetriever.readPlainTextLines(path)).map(
			(line, index) => new Line(line, index),
		);

		const queryTextNoSpaces = queryText.replace(/\s/g, "");
		const lineItems: LineItem[] = [];

		const entries = await this.fzfMatch(queryTextNoSpaces, lines);
		for (const entry of entries) {
			const row = entry.item.row;
			const firstMatchedCol = MathUtil.minInSet(entry.positions);
			const originLine = lines[row].text;

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

			lineItems.push(
				new LineItem(
					new MatchedLine(highlightedText, row, firstMatchedCol),
					await this.getHighlightedContext(
						lines,
						row,
						firstMatchedCol,
						queryText,
					),
				),
			);
		}
		return lineItems;
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
		lines: Line[],
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
			preCharsCount += lines[start].text.length;
		}

		if (preCharsCount > MAX_PRE_CAHRS_COUNT) {
			if (start < matchedRow) {
				start++; // remove the last added line if it's not the matched line
			} else if (start === matchedRow) {
				// truncate the line from firstMatchedCol backward
				const line = lines[start];
				const startIdx = Math.max(
					firstMatchedCol - MAX_PRE_CAHRS_COUNT,
					0,
				);
				const truncatedLine =
					line.text.substring(startIdx, firstMatchedCol) +
					line.text.substring(firstMatchedCol);
				lines[start] = new Line(truncatedLine, line.row);

				// update preCharsCount and postCharsCount
				// preCharsCount = firstMatchedCol - startIdx;
				postCharsCount = line.text.length - firstMatchedCol;
			}
		}
		while (
			end < lines.length - 1 &&
			postCharsCount < 3 * MAX_PRE_CAHRS_COUNT
		) {
			end++;
			postCharsCount += lines[end].text.length;
		}
		const contextLines = lines.slice(start, end + 1);

		const highlightedContext = await Promise.all(
			contextLines.map(async (line, index) => {
				const isTargetLine = matchedRow === start + index;

				if (isTargetLine) {
					// apply fzfMatch to the targetLine
					const entries = await this.fzfMatch(queryText, [line]);
					if (entries.length > 0) {
						// There will be at most one entry
						const entry = entries[0]; 
						return `<span class="target-line">${this.highlightLineByCharPositions(
							line.text,
							Array.from(entry.positions),
						)}</span>`;
					}
					return `<span class="target-line">${line.text}</div>`;
				} else {
					// Perform strict matching on other lines
					const regex = new RegExp(queryText, "gi");
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
