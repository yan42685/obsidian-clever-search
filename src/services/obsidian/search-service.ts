import { App, TAbstractFile, TFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { logger } from "src/utils/logger";
import { TO_BE_IMPL, getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	EngineType,
	FileItem,
	FileSubItem,
	Line,
	LineItem,
	SearchResult,
} from "../../globals/search-types";
import { FileType, FileUtil } from "../../utils/file-util";
import { Database } from "../database/database";
import { LineHighlighter } from "../search/highlighter";
import { LexicalEngine } from "../search/search-engine";
import { DataProvider } from "./data-provider";

@singleton()
export class SearchService {
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private readonly app = getInstance(App);
	private readonly database = getInstance(Database);
	private readonly dataProvider = getInstance(DataProvider);
	private readonly lexicalEngine = getInstance(LexicalEngine);
	private readonly lineHighlighter = getInstance(LineHighlighter);

	@monitorDecorator
	async initAsync() {
		await this.initLexicalEngines();
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
				items: lexicalMatches.map((matchedFile) => {
					// It is necessary to use a constructor with 'new', rather than using an object literal.
					// Otherwise, it is impossible to determine the type using 'instanceof', achieving polymorphic effects based on inheritance
					// (to correctly display data in Svelte components).
					return new FileItem(
						EngineType.LEXICAL,
						matchedFile.path,
						[], // should be populated on demand
						"nothing",
					);
				}),
			};
		} else {
			logger.trace("lexical matched files count is 0");
			// TODO: do semantic search
			return result;
		}
	}

	/**
	 * it should be called on demand for better performance
	 */
	@monitorDecorator
	async getFileSubItems(
		path: string,
		queryText: string,
	): Promise<FileSubItem[]> {
		if (FileUtil.getFileType(path) !== FileType.PLAIN_TEXT) {
			logger.warn(
				`file type for path "${path}" is not supported for sub-items.`,
			);
			return [];
		}

		const content = await this.dataProvider.readPlainText(path);
		const lines = content
			.split(FileUtil.SPLIT_EOL)
			.map((text, index) => new Line(text, index));
		logger.debug("target file lines count: ", lines.length);

		const matchedLines = await this.lexicalEngine.searchLines(
			lines,
			queryText,
			30,
		);

		const fileSubItems = this.lineHighlighter
			.parseAll(lines, matchedLines, "subItem", false)
			.map((itemContext) => {
				return {
					text: itemContext.text,
					row: itemContext.row,
					col: itemContext.col,
				} as FileSubItem;
			});

		return fileSubItems;
	}

	@monitorDecorator
	async searchInFile(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("", []);
		const activeFile = this.app.workspace.getActiveFile();
		if (!queryText || !activeFile) {
			return result;
		}
		if (FileUtil.getFileType(activeFile.path) !== FileType.PLAIN_TEXT) {
			logger.trace("Current file isn't PLAINT_TEXT");
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
				"line",
				false,
			);
			// logger.debug(highlightedLine);
			const paragraphContext = this.lineHighlighter.parse(
				lines,
				matchedLine,
				"paragraph",
				true,
			);
			return new LineItem(highlightedLine, paragraphContext.text);
		});
		return {
			currPath: activeFile.path,
			items: lineItems,
		} as SearchResult;
	}

	@monitorDecorator
	/**
	 * @deprecated since 0.1.x, use SearchService.searchInFile instead
	 */
	async deprecatedSearchInFile(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("", []);
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
		const lineItems = await this.lineHighlighter.parseLineItems(
			lines,
			queryText,
		);

		return {
			currPath: path,
			items: lineItems,
		} as SearchResult;
	}

	private async initLexicalEngines() {
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
}

@singleton()
export class FileWatcher {
	private readonly database = getInstance(Database);
	private readonly dataProvider = getInstance(DataProvider);
	private readonly lexicalEngine = getInstance(LexicalEngine);
	private readonly app = getInstance(App);
	private readonly TIME_OUT = 1000;
	private async onCreate(file: TAbstractFile) {
		if (file instanceof TFile) {
			logger.debug(`created: ${file.path}`);
		}
	}
	private async onDelete(file: TAbstractFile) {
		if (file instanceof TFile) {
			logger.debug(`deleted: ${file.path}`);
		}
	}
	private async onRename(file: TAbstractFile, oldPath: string) {
		if (file instanceof TFile) {
			logger.debug(`renamed: ${oldPath} => ${file.path}`);
		}
	}
	private async onModify(file: TAbstractFile) {
		if (file instanceof TFile) {
			logger.debug(`modified: ${file.path}`);
		}
	}

	start() {
		// // Create
		// this.app.vault.on("create", async (file) => {
		// 	if ( this.dataProvider.shouldIndex(file)) {
		// 		const indexedDocument =
		// 			await this.dataProvider.generateIndexedDocument(file);
		// 		this.lexicalEngine.addDocument(indexedDocument);
		// 	}
		// });

		// // Delete
		// this.app.vault.on("delete", (file) => {
		// 	if (this.dataProvider.shouldIndex(file)) {
		// 		this.lexicalEngine.removeDocument(file.path);
		// 	}
		// });

		// Modify  // it will be triggered twice by obsidian
		this.app.vault.on("create", this.onCreate);
		this.app.vault.on("delete", this.onDelete);
		this.app.vault.on("rename", this.onRename);
		this.app.vault.on("modify", this.onModify);
		logger.debug("FileWatcher started");
		// // Rename
		// this.app.vault.on("rename", async (file, oldPath) => {
		// 	if (this.dataProvider.shouldIndex(file)) {
		// 		this.lexicalEngine.removeDocument(oldPath);
		// 		const indexedDocument =
		// 			await this.dataProvider.generateIndexedDocument(file);
		// 		this.lexicalEngine.addDocument(indexedDocument);
		// 	}
		// });
	}

	stop() {
		this.app.vault.off("create", this.onCreate);
		this.app.vault.off("delete", this.onDelete);
		this.app.vault.off("rename", this.onRename);
		this.app.vault.off("modify", this.onModify);
		logger.debug("FileWatcher stopped");
	}
}
