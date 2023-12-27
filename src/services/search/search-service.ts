import { App, Component } from "obsidian";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	EngineType,
	FileItem,
	FileType,
	SearchResult,
} from "../../globals/search-types";
import { FileRetriever } from "./data-provider";
import { Highlighter } from "./highlighter";
import { LexicalEngine } from "./search-engine";

@singleton()
export class SearchService {
	app: App = getInstance(App);
	component: Component = new Component();
	lexicalEngine: LexicalEngine = getInstance(LexicalEngine);
	highlighter: Highlighter = getInstance(Highlighter);
	async searchInVault(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("no result", []);
		if (queryText.length === 0) {
			return result;
		}
		const lexicalMatches = await this.lexicalEngine.searchAnd(queryText);
		const lexicalResult = [] as FileItem[];
		if (lexicalMatches.length !== 0) {
			return {
				currPath: TO_BE_IMPL,
				items: await this.highlighter.parseFileItems(
					lexicalMatches,
					EngineType.LEXICAL,
				),
			};
		} else {
			// TODO: do semantic search
			return result;
		}
	}

	async searchInFile(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("", []);
		const fileRetriever = getInstance(FileRetriever);
		const activeFile = this.app.workspace.getActiveFile();
		if (
			!queryText ||
			!activeFile ||
			fileRetriever.getFileType(activeFile.path) !== FileType.PLAIN_TEXT
		) {
			return result;
		}

		const path = activeFile.path;
		const lineItems = await this.highlighter.parseLineItems(
			path,
			queryText,
			"fzf",
		);

		return {
			currPath: path,
			items: lineItems,
		} as SearchResult;
	}
}
