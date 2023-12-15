import { AsyncFzf } from "fzf";
import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import { container, singleton } from "tsyringe";
import { Line, MatchedLine } from "./entities/search-types";
import { minInSet } from "./utils/math-utils";

@singleton()
export class SearchHelper {
	app: App = container.resolve(App);

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

		// Get list of MatchedLine objects
		const list = await this.getDataSource();

		// FZF search

		const fzf = new AsyncFzf(list, { selector: (item) => item.text });
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
			const col = minInSet(entry.positions);
			searchResult.push(new MatchedLine(highlightedText, row, col));
			resultsMarkdown += `Line ${row}, Start ${col}: ${highlightedText}\n`;
		});

		// Create a new notice to display the results
		const notice = new Notice("", 20 * 1000); // Duration set to 0 for persistent notice

		// Render the Markdown string into the notice
		MarkdownRenderer.render(
			this.app,
			resultsMarkdown,
			notice.noticeEl,
			"",
			new Component(),
		);

		console.log(searchResult);
	}

	/**
	 * get lines from current note
	 */
	async getDataSource(): Promise<Line[]> {
		// Ensure the active leaf is a markdown note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return [];
		}

		// Read the content and split into lines
		const lines = (await this.app.vault.read(activeFile)).split("\n");

		// Map each line to a MatchedLine object
		return lines.map((line, index) => new Line(line, index));
	}
}
