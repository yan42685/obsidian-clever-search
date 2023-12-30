import { AsyncFzf, type FzfResultItem } from "fzf";
import { LanguageEnum, getCurrLanguage } from "src/globals/language-enum";
import {
	Line,
	LineItem,
	type HighlightedLine,
	type MatchedLine,
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MathUtil } from "src/utils/math-util";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { FileUtil } from "../../utils/file-util";

@singleton()
export class Highlighter {
	private readonly lineHighlighter = getInstance(LineHighlighter);

	async parseLineItems(
		lines: Line[],
		queryText: string,
		style: "minisearch" | "fzf",
	): Promise<LineItem[]> {
		if (style === "fzf") {
			return this.lineHighlighter.parseLineItems(lines, queryText);
		} else if (style === "minisearch") {
			throw new Error(TO_BE_IMPL);
		} else {
			throw new Error(TO_BE_IMPL);
		}
	}
}

@singleton()
export class LineHighlighter {
	private readonly fileRetriever = getInstance(FileUtil);

	async parseLineItems(
		lines: Line[],
		queryText: string,
	): Promise<LineItem[]> {
		const queryTextNoSpaces = queryText.replace(/\s/g, "");
		const lineItems: LineItem[] = [];

		const matchedLines = await this.fzfMatch(queryTextNoSpaces, lines);
		for (const matchedLine of matchedLines) {
			const row = matchedLine.row;
			const firstMatchedCol = MathUtil.minInSet(matchedLine.positions);
			const originLine = lines[row].text;

			// only show part of the line that contains the highlighted chars
			const start = Math.max(firstMatchedCol - 30, 0);
			const end = Math.min(start + 200, originLine.length);
			const substring = originLine.substring(start, end);

			const adjustedPositions = this.adjustPositionsByOffset(
				matchedLine.positions,
				-start,
			);

			const highlightedText = this.highlightLineByCharPositions(
				substring,
				adjustedPositions,
			);

			const paragraphContext = await this.getLineHighlightedContext(
				lines,
				row,
				firstMatchedCol,
				queryText,
			);

			lineItems.push(
				new LineItem(
					{
						text: highlightedText,
						row: row,
						col: firstMatchedCol,
					} as HighlightedLine,
					paragraphContext,
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
	private async getLineHighlightedContext(
		lines: Line[],
		matchedRow: number,
		firstMatchedCol: number,
		queryText: string,
	): Promise<string> {
		const currLang = getCurrLanguage();
		const context = this.getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			"paragraph",
		);
		const contextLines = context.lines;

		const highlightedContext = await Promise.all(
			contextLines.map(async (line, index) => {
				if (line.row === matchedRow) {
					// apply fzfMatch to the targetLine
					const matchedLines = await this.fzfMatch(queryText, [line]);
					try {
						// There should be only one matchedLine
						const matchedLine = matchedLines[0];
						let positions = matchedLine.positions;
						if (index === 0) {
							// the first line has been truncated
							positions = this.adjustPositionsByOffset(
								positions,
								context.firstLineStartCol,
							);
						}
						return `<span class="target-line">${this.highlightLineByCharPositions(
							line.text,
							positions,
						)}</span>`;
					} catch (e) {
						logger.warn(
							"There might be inconsistency with previous search step, which lead to a missed match to target line",
						);
						logger.error(e);
					}
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

		return highlightedContext.join(FileUtil.JOIN_EOL);
	}

	// TODO: highlight set positions
	private highlightLineByCharPositions(
		str: string,
		positions: Set<number>,
	): string {
		return str
			.split("")
			.map((char, i) => {
				// avoid spaces being ignored when rendering html
				// if (char === " ") {
				// 	return "&nbsp;";
				// }
				return positions.has(i) ? `<mark>${char}</mark>` : char;
			})
			.join("");
	}

	private async fzfMatch(
		queryText: string,
		lines: Line[],
	): Promise<MatchedLine[]> {
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

	private adjustPositionsByOffset(
		positions: Set<number>,
		offset: number,
	): Set<number> {
		const adjustedPositions = new Set<number>();

		positions.forEach((position) => {
			if (position >= offset) {
				adjustedPositions.add(position + offset);
			}
		});

		return adjustedPositions;
	}

	// private getTruncatedContext(
	getTruncatedContext(
		lines: Line[],
		matchedRow: number,
		firstMatchedCol: number,
		truncateType: TruncateType,
	): TruncatedContext {
		if (lines.length === 0) {
			return { lines: [], firstLineStartCol: 0 };
		}
		const limit = TruncateLimit.forType(truncateType);
		let resultLines: Line[];
		let firstLineStartCol = 0;
		let postCharsCount = 0;

		// for the matchedRow
		const matchedLineText = lines[matchedRow].text;
		if (firstMatchedCol < limit.maxPreChars) {
			// don't have to truncate the start of the matched row
			const contextAbove = this.extendContextAbove(
				lines,
				matchedRow - 1,
				limit.maxPreChars - firstMatchedCol,
				limit.maxPreLines,
				limit.boundaryLineMinChars,
			);
			resultLines = contextAbove.lines;
			firstLineStartCol = contextAbove.firstLineStartCol;
			const endCol = Math.min(
				matchedLineText.length - 1,
				firstMatchedCol + limit.maxPostChars,
			);
			const needTruncateEnd = endCol < matchedLineText.length - 1;
			// need to truncate the end of the matched row
			if (needTruncateEnd) {
				// logger.debug(`The end of matched line is truncated`);
				const subStr = matchedLineText.substring(0, endCol + 1);
				resultLines.push({ text: subStr, row: matchedRow });
			} else {
				resultLines.push(lines[matchedRow]);
			}
			postCharsCount += endCol - firstMatchedCol;
		} else {
			// need to truncate the start of the matched row
			const startCol = firstMatchedCol - limit.maxPreChars;
			firstLineStartCol = startCol;
			const endCol = Math.min(
				matchedLineText.length - 1,
				firstMatchedCol + limit.maxPostChars,
			);
			const isEndTruncated = endCol < matchedLineText.length - 1;
			if (isEndTruncated) {
				// logger.debug(`The end of matched line is truncated`);
				const subStr = matchedLineText.substring(startCol, endCol + 1);
				resultLines = [{ text: subStr, row: matchedRow }];
			} else {
				resultLines = [lines[matchedRow]];
			}
			postCharsCount += endCol - firstMatchedCol;
		}
		// logger.debug(`resultLines counts: ${resultLines.length}`)
		resultLines = resultLines.concat(
			this.extendContextBelow(
				lines,
				matchedRow + 1,
				limit.maxPostChars - postCharsCount,
				limit.maxPostLines,
				limit.boundaryLineMinChars,
			),
		);

		return {
			lines: resultLines,
			firstLineStartCol: firstLineStartCol,
		};
	}

	/**
	 * @param lines all lines
	 */
	private extendContextAbove(
		lines: Line[],
		startRow: number,
		maxPreChars: number,
		maxLines: number,
		boundaryLineMinChars: number,
	): TruncatedContext {
		let firstLineStartCol = 0;
		let currRow = startRow;
		let preCharsCount = 0;
		const resultLines: Line[] = [];
		// logger.debug(`extendContextAbove`);
		while (currRow >= 0 && startRow - currRow < maxLines) {
			// logger.debug(`extendContextAbove`);
			const currLineText = lines[currRow].text;
			if (preCharsCount + currLineText.length < maxPreChars) {
				// logger.debug(`first line truncated`);
				resultLines.unshift(lines[currRow]);
				preCharsCount += currLineText.length;
				--currRow;
			} else if (preCharsCount + currLineText.length == maxPreChars) {
				resultLines.unshift(lines[currRow]);
				break;
			} else {
				// need to truncate the top line
				// logger.debug(`first line truncated`);
				const startCol =
					preCharsCount + currLineText.length - maxPreChars;
				firstLineStartCol = startCol;
				const subStr = lines[currRow].text.substring(startCol);
				resultLines.unshift({ text: subStr, row: currRow });
				break;
			}
		}
		if (
			resultLines.length > 0 &&
			resultLines[0].text.length < boundaryLineMinChars
		) {
			resultLines.shift();
		}
		return {
			lines: resultLines,
			firstLineStartCol: firstLineStartCol,
		} as TruncatedContext;
	}

	private extendContextBelow(
		lines: Line[],
		startRow: number,
		maxPostChars: number,
		maxLines: number,
		boundaryLineMinChars: number,
	): Line[] {
		// logger.trace(`extendContextBelow`);
		// logger.trace(`startRow: ${startRow}`);
		// logger.trace(`maxPostChars: ${maxPostChars}`);
		// logger.trace(`maxLines: ${maxLines}`);
		let currRow = startRow;
		let postCharsCount = 0;
		const resultLines: Line[] = [];
		while (currRow <= lines.length - 1 && currRow - startRow < maxLines) {
			// logger.info(`real extendContextBelow`);
			const currLineText = lines[currRow].text;
			if (postCharsCount + currLineText.length < maxPostChars) {
				resultLines.push(lines[currRow]);
				postCharsCount += currLineText.length;
				++currRow;
			} else if (postCharsCount + currLineText.length == maxPostChars) {
				resultLines.push(lines[currRow]);
				break;
			} else {
				// need to truncate the last line
				// logger.debug(`last line truncated`);
				const endCol =
					currLineText.length -
					(postCharsCount + currLineText.length - maxPostChars) -
					1;
				const subStr = lines[currRow].text.substring(0, endCol + 1);
				resultLines.push({ text: subStr, row: currRow });
				break;
			}
		}
		// logger.debug(`extend below counts: ${resultLines.length}`);
		if (
			resultLines.length > 0 &&
			resultLines[0].text.length < boundaryLineMinChars
		) {
			resultLines.pop();
		}
		return resultLines;
	}
}
export type TruncatedContext = { lines: Line[]; firstLineStartCol: number };

export type TruncateType = "line" | "paragraph" | "subItem";

export type TruncateOption = {
	maxPreLines: number;
	maxPostLines: number;
	maxPreChars: number;
	maxPostChars: number; // include the EOL
	/**
	 * if (currLine !== matchedLine && isFirstOrLastLine(currLine) && currLine.text.length < boundaryLineMinChars)
	 * currLine won't be added to the context
	 */
	boundaryLineMinChars: number;
};

export type AllTruncateOption = {
	[key in TruncateType]: TruncateOption;
};

export class TruncateLimit {
	// Default truncate options for all types and languages
	private static readonly default: AllTruncateOption = {
		line: {
			maxPreLines: 0,
			maxPostLines: 0,
			maxPreChars: 30,
			maxPostChars: 230,
			boundaryLineMinChars: 4,
		},
		paragraph: {
			maxPreLines: 4,
			maxPostLines: 7,
			maxPreChars: 220,
			maxPostChars: 600,
			boundaryLineMinChars: 4,
		},
		subItem: {
			maxPreLines: 1,
			maxPostLines: 1,
			maxPreChars: 30,
			maxPostChars: 40,
			boundaryLineMinChars: 4,
		},
	};

	// Truncate options set by language
	private static readonly limitsByLanguage: Record<
		LanguageEnum,
		AllTruncateOption
	> = {
		[LanguageEnum.other]: TruncateLimit.default,
		[LanguageEnum.en]: TruncateLimit.default,
		[LanguageEnum.zh]: {
			line: { ...this.default.line, maxPreChars: 30 },
			paragraph: { ...this.default.paragraph, maxPreChars: 220 },
			subItem: { ...this.default.subItem, maxPreChars: 50 },
		},
	};

	/**
	 * Retrieve the truncate options for a given type in the current language.
	 */
	static forType(type: TruncateType): TruncateOption {
		// return this.limitsByLanguage[getCurrLanguage()][type];
		return this.limitsByLanguage[LanguageEnum.en][type];
	}
}
