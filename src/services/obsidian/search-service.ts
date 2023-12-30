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
	LineItem,
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

	@monitorDecorator
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

	@monitorDecorator
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
		// TODO: limit to one and search on demand
		const limit = 1;
		logger.warn("current only highlight top " + limit + "files");
		// TODO: do real highlight
		const result = await Promise.all(
			matchedFiles.slice(0, limit).map(async (f) => {
				const path = f.path;
				if (FileUtil.getFileType(path) === FileType.PLAIN_TEXT) {
					const content = await this.dataProvider.readPlainText(path);
					const lines = content
						.split(FileUtil.SPLIT_EOL)
						.map((text, index) => new Line(text, index));
					logger.debug("target file lines count: ", lines.length);
					const matchedLines = await this.lexicalEngine.searchLines(
						lines,
						queryText,
					);
					logger.debug(`matched lines count: ${matchedLines.length}`);
					const fileSubItems = matchedLines.map((matchedLine) => {
						const matchedLineTruncatedContext =
							this.lineHighlighter.getTruncatedContext(
								lines,
								matchedLine.row,
								MathUtil.minInSet(matchedLine.positions),
								"line",
								// "subItem",
							);
						return {
							text: matchedLineTruncatedContext.lines
								.map((line) => line.text)
								.join(FileUtil.JOIN_EOL),
							// text: matchedLine.text,
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

	@monitorDecorator
	async parseLineItems(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("", []);
		const activeFile = this.app.workspace.getActiveFile();
		if (
			!queryText ||
			!activeFile ||
			FileUtil.getFileType(activeFile.path) !== FileType.PLAIN_TEXT
		) {
			return result;
		}

		const lines = (
			await this.dataProvider.readPlainTextLines(activeFile.path)
		).map((line, index) => new Line(line, index));
		const queryTextNoSpaces = queryText.replace(/\s/g, "");

		const matchedLines = await this.lexicalEngine.fzfMatch(
			queryTextNoSpaces,
			lines,
		);
		const lineItems = matchedLines.map((matchedLine) => {
			const highlightedLine = this.lineHighlighter.parse(
				lines,
				matchedLine,
				[queryTextNoSpaces],
				"line",
			);
			// logger.debug(highlightedLine);
			const paragraphContext = this.lineHighlighter.parse(
				lines,
				matchedLine,
				[queryTextNoSpaces],
				"paragraph",
			);
			return new LineItem(highlightedLine, paragraphContext.text);
		});
		return {
			currPath: activeFile.path,
			items: lineItems,
		} as SearchResult;
	}
}
