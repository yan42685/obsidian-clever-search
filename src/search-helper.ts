import { AsyncFzf } from "fzf";
import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import { container, singleton } from "tsyringe";
import { Line, MatchedLine } from "./entities/search-types";
import { MathUtil } from "./utils/math-util";

@singleton()
export class SearchHelper {
	app: App = container.resolve(App);
	component: Component = new Component();

	async search() {
		// HighlightChars function
		const HighlightChars = (str: string, indices: Set<number>) => {
			const chars = str.split("");
			return chars
				.map((char, i) => {
					return indices.has(i) ? `<mark>${char}</mark>` : char;
				})
				.join("");
		};

		const dataSource = await this.getDataSource();

		const fzf = new AsyncFzf(dataSource.lines, { selector: (item) => item.text });
		const entries = await fzf.find("li");
		const searchResult: MatchedLine[] = [];

		// Prepare the highlighted search results as a Markdown string
		let resultsMarkdown = "";
		entries.forEach((entry) => {
			const highlightedText = HighlightChars(
				entry.item.text,
				entry.positions,
			);
			const row = entry.item.row;
			const col = MathUtil.minInSet(entry.positions);
			searchResult.push(new MatchedLine(highlightedText, row, col));
			resultsMarkdown += `Line ${row}, Start ${col}: ${highlightedText}\n`;
		});

		console.log(searchResult);

		// Create a new notice to display the results
		const notice = new Notice("", 20 * 1000);

        // TODO: 使用modal的component
		// Render the Markdown string into the notice
		MarkdownRenderer.render(
			this.app,
			resultsMarkdown,
			notice.noticeEl,
			dataSource.path,
			this.component,
		);
	}

	/**
	 * get lines from current note
	 */
	async getDataSource(): Promise<DataSource> {
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
}

type DataSource = {
	lines: Line[];
	path: string;
};
