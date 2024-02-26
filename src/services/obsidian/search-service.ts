import { App } from "obsidian";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	EngineType,
	FileItem,
	FileSubItem,
	Line,
	LineItem,
	SearchResult,
} from "../../globals/search-types";
import { FileUtil } from "../../utils/file-util";
import { LineHighlighter } from "../search/highlighter";
import { LexicalEngine } from "../search/lexical-engine";
import { SemanticEngine } from "../search/semantic-engine";
import { TruncateOption } from "../search/truncate-option";
import { DataProvider } from "./user-data/data-provider";
import { ViewRegistry, ViewType } from "./view-registry";

@singleton()
export class SearchService {
	private readonly app = getInstance(App);
	private readonly dataProvider = getInstance(DataProvider);
	private readonly lexicalEngine = getInstance(LexicalEngine);
	private readonly semanticEngine = getInstance(SemanticEngine);
	private readonly lineHighlighter = getInstance(LineHighlighter);
	private readonly viewRegistry = getInstance(ViewRegistry);

	@monitorDecorator
	async searchInVault(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("no result", []);
		if (queryText.length === 0) {
			return result;
		}
		const sourcePath =
			this.app.workspace.getActiveFile()?.path || "no source path";
		const lexicalMatches = await this.lexicalEngine.searchFiles(queryText);
		const lexicalResult = [] as FileItem[];
		if (lexicalMatches.length !== 0) {
			return {
				sourcePath: sourcePath,
				items: lexicalMatches.map((matchedFile) => {
					// It is necessary to use a constructor with 'new', rather than using an object literal.
					// Otherwise, it is impossible to determine the type using 'instanceof', achieving polymorphic effects based on inheritance
					// (to correctly display data in Svelte components).
					return new FileItem(
						EngineType.LEXICAL,
						matchedFile.path,
						matchedFile.queryTerms,
						matchedFile.matchedTerms,
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

	async searchInVaultSemantic(queryText: string): Promise<SearchResult> {
		const result = new SearchResult("no result", []);
		if (queryText.length === 0) {
			return result;
		} else {
			const sourcePath =
				this.app.workspace.getActiveFile()?.path || "no source path";
			const result = {
				sourcePath: sourcePath,
				items: await this.semanticEngine.search(
					queryText,
					ViewType.MARKDOWN,
				),
			} as SearchResult;
			logger.debug(result)
			return result;
		}
	}

	/**
	 * it should be called on demand for better performance
	 */
	@monitorDecorator
	async getFileSubItems(
		queryText: string,
		fileItem: FileItem,
	): Promise<FileSubItem[]> {
		const path = fileItem.path;

		if (this.viewRegistry.viewTypeByPath(path) !== ViewType.MARKDOWN) {
			logger.warn(
				`view type for path "${path}" is not supported for sub-items.`,
			);
			return [];
		}

		const content = await this.dataProvider.readPlainText(path);
		const lines = content
			.split(FileUtil.SPLIT_EOL)
			.map((text, index) => new Line(text, index));
		logger.debug("target file lines count: ", lines.length);

		const matchedLines = await this.lexicalEngine.searchLinesByFileItem(
			lines,
			"subItem",
			queryText,
			fileItem,
			30,
		);

		const fileSubItems = this.lineHighlighter
			.parseAll(
				lines,
				matchedLines,
				TruncateOption.forType("subItem", queryText),
				false,
			)
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

		if (
			this.viewRegistry.viewTypeByPath(activeFile.path) !==
			ViewType.MARKDOWN
		) {
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
				TruncateOption.forType("line"),
				false,
			);
			// logger.debug(highlightedLine);
			const paragraphContext = this.lineHighlighter.parse(
				lines,
				matchedLine,
				TruncateOption.forType("paragraph"),
				true,
			);
			return new LineItem(highlightedLine, paragraphContext.text);
		});
		return {
			sourcePath: activeFile.path,
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
			this.viewRegistry.viewTypeByPath(activeFile.path) !==
				ViewType.MARKDOWN
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
			sourcePath: path,
			items: lineItems,
		} as SearchResult;
	}
}
