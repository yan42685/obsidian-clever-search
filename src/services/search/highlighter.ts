import { AsyncFzf, type FzfResultItem } from "fzf";
import { LanguageEnum, getCurrLanguage } from "src/globals/language-enum";
import {
	Line,
	LineItem,
	MatchedLine,
} from "src/globals/search-types";
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
class LineHighlighter implements LineHighlighter {
	private readonly fileRetriever = getInstance(FileUtil);

	async parseLineItems(lines: Line[], queryText: string): Promise<LineItem[]> {

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

	private getTruncatedContext(
		lines: Line[],
		matchedRow: number,
		firstMatchedCol: number,
		truncateType: TruncateType,
	): TruncatedContext {
		if (lines.length === 0) {
			return { lines: [], firstLineOffset: 0 };
		}
		const limit = TruncateLimit.forType(truncateType);
		const resultLines: Line[] = [];
		let startRow = matchedRow;
		let endRow = matchedRow + 1;
		let firstLineStartCol = 0;
		let firstLineEndCol = 0;
		const lastLineEndCol = 0;
		let preCharsCount = firstMatchedCol;
		let postCharsCount = 0;
		// add matchRow and extend above
		while (
			startRow > 0 &&
			matchedRow - startRow <= limit.maxPreLines &&
			preCharsCount < limit.maxPreChars
		) {
			resultLines.unshift(lines[startRow]);
			preCharsCount += lines[startRow].text.length;
			--startRow;
		}
		if (matchedRow - startRow > limit.maxPreLines) {
			resultLines.shift();
			preCharsCount -= lines[startRow - 1].text.length;
			++startRow;
		}
		// need to truncate the first row
		if (preCharsCount > limit.maxPreChars) {
			const lineText = lines[startRow].text;
			firstLineStartCol = preCharsCount - limit.maxPreChars;
			firstLineEndCol = Math.min(
				firstMatchedCol + limit.maxPostChars,
				lineText.length - 1,
			);
			postCharsCount = firstLineEndCol - firstMatchedCol;
			const subStr = lines[startRow].text.substring(
				firstLineStartCol,
				firstLineEndCol + 1,
			);
			resultLines.unshift({ text: subStr, row: startRow });
		}
		// extend below but don't add matchedRow
		while (
			endRow < lines.length &&
			endRow - matchedRow <= limit.maxPostLines &&
			postCharsCount < limit.maxPostChars
		) {
			resultLines.push(lines[endRow]);
			postCharsCount += lines[endRow].text.length;
			++endRow;
		}
		if (endRow - matchedRow > limit.maxPostLines) {
			resultLines.pop();
			postCharsCount -= lines[endRow + 1].text.length;
			--endRow;
		}
		if (postCharsCount > limit.maxPostChars) {
			const overflowCount = postCharsCount - limit.maxPostChars;
			const lastLineEndCol =
				lines[endRow].text.length - overflowCount - 1;
			const subString = lines[endRow].text.substring(
				0,
				lastLineEndCol + 1,
			);
			resultLines.push({ text: subString, row: endRow });
		}

		return { lines: resultLines, firstLineOffset: firstLineStartCol };
	}
}
type TruncatedContext = { lines: Line[]; firstLineOffset: number };

type TruncateType = "line" | "paragraph" | "subItem";

type TruncateOption = {
	maxPreLines: number;
	maxPostLines: number;
	maxPreChars: number;
	maxPostChars: number;
};

type AllTruncateOption = {
	[key in TruncateType]: TruncateOption;
};

class TruncateLimit {
	// Default truncate options for all types and languages
	private static readonly default: AllTruncateOption = {
		line: {
			maxPreLines: 0,
			maxPostLines: 0,
			maxPreChars: 30,
			maxPostChars: 230,
		},
		paragraph: {
			maxPreLines: 4,
			maxPostLines: 7,
			maxPreChars: 220,
			maxPostChars: 600,
		},
		subItem: {
			maxPreLines: 1,
			maxPostLines: 1,
			maxPreChars: 120,
			maxPostChars: 230,
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
			subItem: { ...this.default.subItem, maxPostChars: 120 },
		},
	};

	/**
	 * Retrieve the truncate options for a given type in the current language.
	 */
	static forType(type: TruncateType): TruncateOption {
		return this.limitsByLanguage[getCurrLanguage()][type];
	}
}
