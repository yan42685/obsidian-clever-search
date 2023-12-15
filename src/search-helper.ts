import { AsyncFzf } from "fzf";
import { App, Component } from "obsidian";
import { container, singleton } from "tsyringe";
import { InFileItem, InFileResult, Line, MatchedLine } from "./entities/search-types";
import { MathUtil } from "./utils/math-util";

@singleton()
export class SearchHelper {
	app: App = container.resolve(App);
	component: Component = new Component();

	async search(queryText: string): Promise<InFileResult> {
        if (!queryText) {
            return new InFileResult("", []);
        }
		// HighlightChars function
		const HighlightChars = (str: string, indexes: Set<number>) => {
			const chars = str.split("");
			return chars
				.map((char, i) => {
					return indexes.has(i) ? `<mark>${char}</mark>` : char;
				})
				.join("");
		};

		const dataSource = await this.getDataSource();

		const fzf = new AsyncFzf(dataSource.lines, {
			selector: (item) => item.text,
		});
		// const entries = await fzf.find("li");
		const entries = await fzf.find(queryText);
		const searchResult: InFileResult = new InFileResult(dataSource.path, []);

		// Prepare the highlighted search results as a Markdown string
		let resultsMarkdown = "";
		entries.forEach((entry) => {
			const highlightedText = HighlightChars(
				entry.item.text,
				entry.positions,
			);
			const row = entry.item.row;
			const col = MathUtil.minInSet(entry.positions);
			searchResult.items.push(
				new InFileItem(
					new MatchedLine(highlightedText, row, col),
					this.getContext(row),
				)
			);
			resultsMarkdown += `Line ${row}, Start ${col}: ${highlightedText}\n`;
		});

		// // Create a new notice to display the results
		// const notice = new Notice("", 20 * 1000);

		// // TODO: 使用modal的component
		// // Render the Markdown string into the notice
		// MarkdownRenderer.render(
		// 	this.app,
		// 	resultsMarkdown,
		// 	notice.noticeEl,
		// 	dataSource.path,
		// 	this.component,
		// );

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
