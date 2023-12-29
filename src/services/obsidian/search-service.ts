import { App, Component } from "obsidian";
import { logger } from "src/utils/logger";
import { MathUtil } from "src/utils/math-util";
import { TO_BE_IMPL, getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	EngineType,
	FileItem,
	FileSubItem,
	Line,
	SearchResult,
	type MatchedFile,
} from "../../globals/search-types";
import { FileType, FileUtil } from "../../utils/file-util";
import { Database } from "../database/database";
import { Highlighter, LineHighlighter } from "../search/highlighter";
import { LexicalEngine } from "../search/search-engine";
import { DataProvider } from "./data-provider";

@singleton()
export class SearchService {
	app: App = getInstance(App);
	component: Component = new Component();
	database: Database = getInstance(Database);
	dataProvider: DataProvider = getInstance(DataProvider);
	lexicalEngine: LexicalEngine = getInstance(LexicalEngine);
	highlighter: Highlighter = getInstance(Highlighter);
	lineHighlighter = getInstance(LineHighlighter);

	@monitorDecorator
	async initAsync() {
		logger.trace("Init lexical engine...");
		const prevData = await this.database.getMiniSearchData();
		if (prevData) {
			logger.trace("Previous minisearch data is found.");
			this.lexicalEngine.reIndexAll(prevData);
		} else {
			logger.trace(
				"Previous minisearch data doesn't exists, reading files via obsidian...",
			);
			const documents =
				await this.dataProvider.generateAllIndexedDocuments();
			await this.lexicalEngine.reIndexAll(documents);
		}
		logger.trace("Lexical engine is ready");
	}

	async searchInVault(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("no result", []);
		if (queryText.length === 0) {
			return result;
		}
		const lexicalMatches = await this.lexicalEngine.searchFiles(
			queryText,
			"and",
		);
		const lexicalResult = [] as FileItem[];
		if (lexicalMatches.length !== 0) {
			return {
				currPath: TO_BE_IMPL,
				items: await this.parseFileItems(
					queryText,
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
	@monitorDecorator
	async parseFileItems(
		queryText: string,
		matchedFiles: MatchedFile[],
		engineType: EngineType,
	): Promise<FileItem[]> {
		logger.warn("current only highlight top 50 files");
		// TODO: do real highlight
		const result = await Promise.all(
			matchedFiles.slice(0, 50).map(async (f) => {
				const path = f.path;
				if (FileUtil.getFileType(path) === FileType.PLAIN_TEXT) {
					const content = await this.dataProvider.readPlainText(path);
					const lines = content
						.split("\n")
						.map((text, index) => new Line(text, index)); // 正则表达式匹配 \n 或 \r\n
					const firstTenLines = lines.slice(0, 10).join("\n");

					const matchedLines = await this.lexicalEngine.searchLines(
						lines,
						queryText,
					);
					const fileSubItems = matchedLines.map((matchedLine) => {

						const matchedLineTruncatedContext =
							this.lineHighlighter.getTruncatedContext(
								lines,
								matchedLine.row,
								MathUtil.minInSet(matchedLine.positions),
								"subItem",
							);
						return {
							// text: matchedLineTruncatedContext.lines.map(line=>line.text).join("\n"),
							text: matchedLine.text,
							originRow: matchedLine.row,
							originCol: MathUtil.minInSet(matchedLine.positions),
						} as FileSubItem;
					});

					// It is necessary to use a constructor with 'new', rather than using an object literal.
					// Otherwise, it is impossible to determine the type using 'instanceof', achieving polymorphic effects based on inheritance
					// (to correctly display data in Svelte components).
					return new FileItem(
						engineType,
						f.path,
						// [new FileSubItem(firstTenLines, 0, 0)],
						fileSubItems,
						null,
					);
				} else {
					return new FileItem(
						engineType,
						f.path,
						[],
						"not supported filetype",
					);
				}
			}),
		);
		return result;
	}
}
