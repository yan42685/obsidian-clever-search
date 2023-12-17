import { AsyncFzf, type FzfResultItem } from "fzf";
import { App, Component } from "obsidian";
import { container, singleton } from "tsyringe";
import {
	InFileItem,
	Line,
	MatchedLine,
	SearchResult,
	SearchType,
} from "./entities/search-types";
import { MathUtil } from "./utils/math-util";

@singleton()
export class SearchHelper {
	app: App = container.resolve(App);
	component: Component = new Component();
	dataSource: DataSource = { lines: [], path: "" };

	async search(queryText: string): Promise<SearchResult> {
		if (!queryText) {
			return new SearchResult(SearchType.IN_FILE, "", []);
		}

		await this.updateDataSource();
		queryText = queryText.replace(/\s/g, "");

		const searchResult = new SearchResult(
			SearchType.IN_FILE,
			this.dataSource.path,
			[],
		);

		const entries = await this.fzfMatch(queryText, this.dataSource.lines);
		for (const entry of entries) {
			const row = entry.item.row;
			const firstMatchedCol = MathUtil.minInSet(entry.positions);
			const originLine = this.dataSource.lines[row].text;

			// only show part of the line that contains the highlighted chars
			const start = Math.max(firstMatchedCol - 10, 0);
			const end = Math.min(start + 50, originLine.length);
			const substring = originLine.substring(start, end);

			const newPositions = Array.from(entry.positions)
				.filter((position) => position >= start && position < end)
				.map((position) => position - start);

			const highlightedText = this.highlightChars(
				substring,
				newPositions,
			);

			searchResult.items.push(
				new InFileItem(
					new MatchedLine(highlightedText, row, firstMatchedCol),
					await this.getContext(row, queryText),
				),
			);
		}

		return searchResult;
	}

	private async updateDataSource() {
		// Ensure the active leaf is a markdown note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return { lines: [], path: "" };
		}

		// Read the content and split into lines
		const lines = (await this.app.vault.read(activeFile)).split("\n");

		// Map each line to a MatchedLine object
		this.dataSource = {
			lines: lines.map((line, index) => new Line(line, index)),
			path: activeFile.path,
		};
	}

	private async getContext(
		lineNumber: number,
		queryText: string,
	): Promise<string> {
		const start = Math.max(lineNumber - 10, 0);
		const end = Math.min(lineNumber + 10, this.dataSource.lines.length - 1);
		const contextLines = this.dataSource.lines.slice(start, end + 1);

		const highlightedContext = await Promise.all(
			contextLines.map(async (line, index) => {
				// here, it should match line by line to ensure the order of lines remains unchanged, 
				// unlike the logic in search method
				const entries = await this.fzfMatch(queryText, [line]);
				const isTargetLine = lineNumber === start + index;
				if (entries.length > 0) {
					const entry = entries[0];
					const highlighted = this.highlightChars(
						line.text,
						Array.from(entry.positions),
					);
					// Wrap matched line with a div and specified classes
					return isTargetLine
						? `<div class="cm-active cm-line">${highlighted}</div>`
						: highlighted;
				} else {
					return isTargetLine
						? `<div class="cm-active cm-line">${line.text}</div>`
						: line.text;
				}
			}),
		);

		return highlightedContext.join("\n");
	}

	private highlightChars(str: string, indexes: number[]): string {
		return str
			.split("")
			.map((char, i) => {
				// avoid spaces being ignored when rendering html
				if (char === " ") {
					return "&nbsp;";
				}
				return indexes.includes(i) ? `<mark>${char}</mark>` : char;
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

type DataSource = {
	lines: Line[];
	path: string;
};
