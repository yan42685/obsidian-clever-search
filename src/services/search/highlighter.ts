import { LanguageEnum } from "src/globals/enums";
import {
	Line,
	LineItem,
	type HighlightedContext,
	type MatchedLine,
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MathUtil } from "src/utils/math-util";
import { MyLib, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { FileUtil } from "../../utils/file-util";
import { LexicalEngine } from "./search-engine";

@singleton()
export class LineHighlighter {
	private readonly lexicalEngine = getInstance(LexicalEngine);

	// @monitorDecorator
	/**
	 * @param queryText used for highlight context except matchedLine
	 */
	parseAll(
		allLines: Line[],
		matchedLines: MatchedLine[],
		queryText: string,
		truncateType: TruncateType,
	): HighlightedContext[] {
		return matchedLines.map((matchedLine) => {
			const firstMatchedCol = MathUtil.minInSet(matchedLine.positions);
			const matchedRow = matchedLine.row;
			const context = this.getTruncatedContext(
				allLines,
				matchedRow,
				firstMatchedCol,
				truncateType,
			);
			let matchedLineText = matchedLine.text;
			let matchedLinePositions = matchedLine.positions;
			if (matchedLine.row === context.lines[0].row) {
				matchedLineText = context.lines[0].text;
				// if the matched line locates at the first row in the context, 
				// it's been truncated and we need to adjust positions
				matchedLinePositions = this.adjustPositionsByStartCol(
					matchedLinePositions,
					context.firstLineStartCol,
				);
			}
			const highlightedLineText = this.highlightMatchedLine(
				matchedLineText,
				matchedLinePositions,
			);
			const highlightedText = context.lines
				.map((line) =>
					// line.row === matchedRow ? highlightedLineText : this.highlightContextLine(line.text, queryText) ,
					line.row === matchedRow ? highlightedLineText : line.text
				)
				.join(FileUtil.JOIN_EOL);
			return {
				row: matchedLine.row,
				col: firstMatchedCol,
				text: highlightedText,
			} as HighlightedContext;
		});
	}

	/**
	 * @param queryText used for highlight context except matchedLine
	 */
	parse(
		allLines: Line[],
		matchedLine: MatchedLine,
		queryText: string,
		truncateType: TruncateType,
	): HighlightedContext {
		return this.parseAll(allLines, [matchedLine], queryText, truncateType)[0];
	}

	/**
	 * @deprecated since 0.1.x, use SearchService.searchInFile instead
	 */
	async parseLineItems(
		lines: Line[],
		queryText: string,
	): Promise<LineItem[]> {
		const queryTextNoSpaces = queryText.replace(/\s/g, "");
		const lineItems: LineItem[] = [];

		const matchedLines = await this.lexicalEngine.fzfMatch(
			queryTextNoSpaces,
			lines,
		);
		for (const matchedLine of matchedLines) {
			const row = matchedLine.row;
			const firstMatchedCol = MathUtil.minInSet(matchedLine.positions);
			const originLine = lines[row].text;

			// only show part of the line that contains the highlighted chars
			const start = Math.max(firstMatchedCol - 30, 0);
			const end = Math.min(start + 200, originLine.length);
			const substring = originLine.substring(start, end);

			const adjustedPositions = this.adjustPositionsByStartCol(
				matchedLine.positions,
				start,
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
					} as HighlightedContext,
					paragraphContext,
				),
			);
		}
		return lineItems;
	}

	private highlightMatchedLine(lineText: string, positions: Set<number>) {
		return `<span class="matched-line">${this.highlightLineByCharPositions(
			lineText,
			positions,
		)}</span>`;
	}

	private highlightContextLine(lineText: string, queryText: string): string {
		const regex = new RegExp(queryText, "gi");
		return lineText.replace(regex, (match) => `<mark>${match}</mark>`);
	}

	private highlightLineByCharPositions(
		lineText: string,
		positions: Set<number>,
	): string {
		return lineText
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

	private adjustPositionsByStartCol(
		positions: Set<number>,
		firstStartCol: number,
	): Set<number> {
		const adjustedPositions = new Set<number>();

		positions.forEach((position) => {
			if (position >= firstStartCol) {
				adjustedPositions.add(position - firstStartCol);
			}
		});

		return adjustedPositions;
	}

	private getTruncatedContext(
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
			// logger.debug(`truncate start of the line`)
			firstLineStartCol = startCol;
			const endCol = Math.min(
				matchedLineText.length - 1,
				firstMatchedCol + limit.maxPostChars,
			);
			const isEndTruncated = endCol < matchedLineText.length - 1;
			let subStr: string;
			if (isEndTruncated) {
				// logger.debug(`The end of matched line is truncated`);
				subStr = matchedLineText.substring(startCol, endCol + 1);
			} else {
				subStr = matchedLineText.substring(startCol);
			}
			resultLines = [{ text: subStr, row: matchedRow }];
			postCharsCount += endCol - firstMatchedCol;
		}
		// logger.debug(`resultLines counts: ${resultLines.length}`)
		MyLib.append(
			resultLines,
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

	/**
	 * Get the HTML of context lines surrounding a matched line in a document.
	
	 * @deprecated Since 0.1.x
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
		const currLang = MyLib.getCurrLanguage();
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
					const matchedLines = await this.lexicalEngine.fzfMatch(
						queryText,
						[line],
					);
					try {
						// There should be only one matchedLine
						const matchedLine = matchedLines[0];
						let positions = matchedLine.positions;
						if (index === 0) {
							// the first line has been truncated
							positions = this.adjustPositionsByStartCol(
								positions,
								context.firstLineStartCol,
							);
						}
						return this.highlightMatchedLine(line.text, positions);
					} catch (e) {
						logger.warn(
							"There might be inconsistency with previous search step, which lead to a missed match to target line",
						);
						logger.error(e);
					}
				} else {
					// Perform strict matching on other lines
					return this.highlightContextLine(line.text, queryText);
					// .replace(/ /g, "&nbsp;");
				}
			}),
		);

		return highlightedContext.join(FileUtil.JOIN_EOL);
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
			maxPreLines: 3,
			maxPostLines: 3,
			maxPreChars: 60,
			maxPostChars: 80,
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
