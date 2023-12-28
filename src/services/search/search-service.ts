import { App, Component } from "obsidian";
import { logger } from "src/utils/logger";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	EngineType,
	FileItem,
	FileType,
	SearchResult,
	type MatchedFile,
	Line,
} from "../../globals/search-types";
import { FileUtil } from "../../utils/file-util";
import { DataProvider } from "./data-provider";
import { Highlighter } from "./highlighter";
import { LexicalEngine } from "./search-engine";

@singleton()
export class SearchService {
	app: App = getInstance(App);
	component: Component = new Component();
	lexicalEngine: LexicalEngine = getInstance(LexicalEngine);
	highlighter: Highlighter = getInstance(Highlighter);
	dataProvider: DataProvider = getInstance(DataProvider);
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
				items: await this.parseFileItems(
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
		const fileRetriever = getInstance(FileUtil);
		const activeFile = this.app.workspace.getActiveFile();
		if (
			!queryText ||
			!activeFile ||
			FileUtil.getFileType(activeFile.path) !== FileType.PLAIN_TEXT
		) {
			return result;
		}

		const path = activeFile.path;

		const lines = (await this.dataProvider.readPlainTextLines(path)).map(
			(line, index) => new Line(line, index),
		);
		const lineItems = await this.highlighter.parseLineItems(
			lines,
			queryText,
			"fzf",
		);

		return {
			currPath: path,
			items: lineItems,
		} as SearchResult;
	}


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
					FileUtil.getFileType(path) === FileType.PLAIN_TEXT
				) {
					const content =
						await this.dataProvider.readPlainText(path);
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
}
