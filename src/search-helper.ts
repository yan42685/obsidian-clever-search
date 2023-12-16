import { AsyncFzf } from "fzf";
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

	async search(queryText: string): Promise<SearchResult> {
		if (!queryText) {
			return new SearchResult(SearchType.IN_FILE, "", []);
		}

		// remove spaces
		queryText = queryText.replace(/\s/g, "");

		// HighlightChars function
		const HighlightChars = (str: string, indexes: number[]) => {
			const chars = str.split("");
			return chars
				.map((char, i) => {
					return indexes.includes(i) ? `<mark>${char}</mark>` : char;
				})
				.join("");
		};

		const dataSource = await this.getDataSource();

		const fzf = new AsyncFzf(dataSource.lines, {
			selector: (item) => item.text,
		});

		const entries = await fzf.find(queryText);
		const searchResult: SearchResult = new SearchResult(
			SearchType.IN_FILE,
			dataSource.path,
			[],
		);

		// Prepare the highlighted search results as a Markdown string
		entries.forEach((entry) => {
			const row = entry.item.row;
			const firstMatchedCol = MathUtil.minInSet(entry.positions);
			const originLine = entry.item.text;

			// only show part of the line that contains the highlighted chars
			const start = Math.max(firstMatchedCol - 10, 0);
			const end = Math.min(start + 50, originLine.length);
			const substring = originLine.substring(start, end);

			const newPositions = Array.from(entry.positions)
				.filter((position) => position >= start && position < end)
				.map((position) => position - start);

			const highlightedText = HighlightChars(
				substring,
				newPositions,
			);
			searchResult.items.push(
				new InFileItem(
					new MatchedLine(highlightedText, row, firstMatchedCol),
					this.getContext(row),
				),
			);
		});

		return searchResult;
	}

	/**
	 * get data from current note
	 */
	private async getDataSource(): Promise<DataSource> {
		// Ensure the active leaf is a markdown note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return { lines: [], path: "" };
		}

		// Read the content and split into lines
		const lines = (await this.app.vault.read(activeFile)).split("\n");

		// Map each line to a MatchedLine object
		return {
			lines: lines.map((line, index) => new Line(line, index)),
			path: activeFile.path,
		};
	}

	private getContext(lineNumber: number): string {
		return "";
	}
}

type DataSource = {
	lines: Line[];
	path: string;
};
