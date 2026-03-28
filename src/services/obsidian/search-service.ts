import { App } from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
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
import type { MatchedFile } from "../../globals/search-types";
import { FileUtil } from "../../utils/file-util";
import { LineHighlighter } from "../search/highlighter";
import { HybridEngine } from "../search/hybrid/hybrid-engine";
import { LexicalEngine } from "../search/lexical-engine";
import { TruncateOption } from "../search/truncate-option";
import { throttle } from "throttle-debounce";
import { MyNotice } from "./transformed-api";
import { t } from "./translations/locale-helper";
import { DataProvider } from "./user-data/data-provider";
import { DataManager } from "./user-data/data-manager";
import { ViewRegistry, ViewType } from "./view-registry";

@singleton()
export class SearchService {
	private static readonly LEXICAL_FILE_CANDIDATE_CAP = 48;
	private static readonly LEXICAL_FILE_CANDIDATE_BONUS = 12;
	private static readonly LEXICAL_LINE_RERANK_CANDIDATE_CAP = 36;
	private static readonly LEXICAL_LINE_RERANK_CANDIDATE_BONUS = 8;
	private static readonly LEXICAL_LINE_RERANK_MIN_WINDOW = 12;
	private static readonly LEXICAL_LINE_RERANK_SKIP_ABS_GAP = 1.6;
	private static readonly LEXICAL_LINE_RERANK_SKIP_REL_GAP = 0.12;
	private static readonly LEXICAL_LINE_RERANK_MAX_LINES = 6;
	private static readonly LEXICAL_SUBITEM_MAX_LINES = 60;
	private static readonly LEXICAL_LINE_EVIDENCE_WEIGHT = 0.4;
	private static readonly LEXICAL_LINE_COUNT_WEIGHT = 0.12;
	private readonly app = getInstance(App);
	private readonly setting = getInstance(OuterSetting);
	private readonly dataProvider = getInstance(DataProvider);
	private readonly lexicalEngine = getInstance(LexicalEngine);
	private readonly lineHighlighter = getInstance(LineHighlighter);
	private readonly viewRegistry = getInstance(ViewRegistry);
	readonly hybridEngine = new HybridEngine();
	private readonly noticeHybridFallback = throttle(
		5000,
		(message: string) => new MyNotice(message, 5000),
	);
	private readonly noticeSearchBootstrapBlocked = throttle(
		2000,
		(message: string) => new MyNotice(message, 2500),
	);

	@monitorDecorator
	async searchInVault(queryText: string): Promise<SearchResult> {
		const blocked = this.getBlockedSearchResult(queryText);
		if (blocked) {
			return blocked;
		}
		return await this.searchInVaultLexical(queryText);
	}

	async searchInVaultHybrid(queryText: string): Promise<SearchResult> {
		const blocked = this.getBlockedSearchResult(queryText);
		if (blocked) {
			return blocked;
		}
		if (queryText.length === 0) {
			return new SearchResult("no result", []);
		}
		if (!this.hybridEngine.isEnabled()) {
			return await this.searchInVaultLexical(queryText);
		}

		const dataManager = getInstance(DataManager);
		if (dataManager.isHybridSearchUnavailable()) {
			return await this.searchInVaultLexical(queryText);
		}
		if (dataManager.hasHybridFailedEmbeddings()) {
			return await this.searchInVaultLexical(queryText, {
				hybridEmbeddingIncomplete: true,
			});
		}
		const sourcePath = this.app.workspace.getActiveFile()?.path || "no source path";
		const items = await this.hybridEngine.search(queryText);
		const fallbackNoticeKey =
			this.hybridEngine.consumeSearchFallbackNoticeKey();
		if (fallbackNoticeKey) {
			this.noticeHybridFallback(t(fallbackNoticeKey));
		}
		return new SearchResult(sourcePath, items, fallbackNoticeKey, false);
	}

	private async searchInVaultLexical(
		queryText: string,
		options: {
			hybridEmbeddingIncomplete?: boolean;
		} = {},
	): Promise<SearchResult> {
		const result = new SearchResult(
			"no result",
			[],
			null,
			options.hybridEmbeddingIncomplete ?? false,
		);
		if (queryText.length === 0) {
			return result;
		}
		const sourcePath =
			this.app.workspace.getActiveFile()?.path || "no source path";
		const maxDisplayItems = this.setting.ui.maxItemResults;
		const lexicalMatches = await this.lexicalEngine.searchFiles(
			queryText,
			this.getLexicalFileCandidateLimit(maxDisplayItems),
			maxDisplayItems,
			SearchService.LEXICAL_SUBITEM_MAX_LINES,
		);
		const rerankedMatches = await this.rerankLexicalMatchesByLineEvidence(
			queryText,
			lexicalMatches,
		);
		if (rerankedMatches.length === 0) {
			logger.trace("lexical matched files count is 0");
			return result;
		}

		return new SearchResult(
			sourcePath,
			rerankedMatches.slice(0, maxDisplayItems).map((matchedFile) => {
				return new FileItem(
					EngineType.LEXICAL,
					matchedFile.path,
					matchedFile.queryTerms,
					matchedFile.matchedTerms,
					matchedFile.directSubItems ?? [],
					"nothing",
					matchedFile.nativeSubItemsReady ?? false,
				);
			}),
			null,
			options.hybridEmbeddingIncomplete ?? false,
		);
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
			SearchService.LEXICAL_SUBITEM_MAX_LINES,
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

	private getLexicalFileCandidateLimit(maxDisplayItems: number): number {
		return Math.min(
			SearchService.LEXICAL_FILE_CANDIDATE_CAP,
			Math.max(
				maxDisplayItems,
				maxDisplayItems * 2,
				maxDisplayItems + SearchService.LEXICAL_FILE_CANDIDATE_BONUS,
			),
		);
	}

	private async rerankLexicalMatchesByLineEvidence(
		queryText: string,
		matchedFiles: MatchedFile[],
	): Promise<MatchedFile[]> {
		if (matchedFiles.length <= 1) {
			return matchedFiles;
		}
		if (this.shouldSkipLexicalLineRerank(matchedFiles)) {
			return matchedFiles;
		}
		const rerankCandidateCount = this.getLexicalLineRerankCandidateCount(
			matchedFiles.length,
		);
		const rerankWindow = matchedFiles.slice(0, rerankCandidateCount);

		const evidenceRows = await Promise.all(
			rerankWindow.map((matchedFile, index) =>
				this.collectLexicalLineEvidence(queryText, matchedFile, index),
			),
		);
		const maxBaseScore =
			Math.max(...evidenceRows.map((row) => row.baseScore), 0) || 1;
		const maxBestDensity =
			Math.max(...evidenceRows.map((row) => row.bestLineDensity), 0) || 1;
		const maxLineCount =
			Math.max(...evidenceRows.map((row) => row.lineCount), 0) || 1;

		return evidenceRows
			.map((row) => {
				const baseSignal =
					row.baseScore > 0
						? row.baseScore / maxBaseScore
						: (matchedFiles.length - row.baseRank) / matchedFiles.length;
				const lineDensitySignal =
					row.bestLineDensity > 0
						? row.bestLineDensity / maxBestDensity
						: 0;
				const lineCountSignal =
					row.lineCount > 0 ? row.lineCount / maxLineCount : 0;
				return {
					...row,
					finalScore:
						baseSignal +
						lineDensitySignal *
							SearchService.LEXICAL_LINE_EVIDENCE_WEIGHT +
						lineCountSignal *
							SearchService.LEXICAL_LINE_COUNT_WEIGHT,
				};
			})
			.sort((a, b) => {
				if (b.finalScore !== a.finalScore) {
					return b.finalScore - a.finalScore;
				}
				if (b.baseScore !== a.baseScore) {
					return b.baseScore - a.baseScore;
				}
				return a.matchedFile.path.localeCompare(b.matchedFile.path);
			})
			.map((row) => row.matchedFile)
			.concat(matchedFiles.slice(rerankCandidateCount));
	}

	private getLexicalLineRerankCandidateCount(totalCandidates: number): number {
		const maxDisplayItems = this.setting.ui.maxItemResults;
		return Math.min(
			totalCandidates,
			Math.max(
				SearchService.LEXICAL_LINE_RERANK_MIN_WINDOW,
				maxDisplayItems,
				Math.min(
					SearchService.LEXICAL_LINE_RERANK_CANDIDATE_CAP,
					maxDisplayItems + SearchService.LEXICAL_LINE_RERANK_CANDIDATE_BONUS,
				),
			),
		);
	}

	private shouldSkipLexicalLineRerank(matchedFiles: MatchedFile[]): boolean {
		if (matchedFiles.length < 3) {
			return false;
		}
		const topScore = matchedFiles[0].score ?? 0;
		const secondScore = matchedFiles[1].score ?? 0;
		const probeScore =
			matchedFiles[
				Math.min(matchedFiles.length - 1, this.setting.ui.maxItemResults - 1)
			]?.score ?? secondScore;
		if (
			!Number.isFinite(topScore) ||
			!Number.isFinite(secondScore) ||
			topScore <= secondScore
		) {
			return false;
		}
		const leadGap = topScore - secondScore;
		const probeGap = topScore - probeScore;
		return (
			leadGap >= SearchService.LEXICAL_LINE_RERANK_SKIP_ABS_GAP &&
			leadGap >=
				Math.max(
					Math.abs(topScore) * SearchService.LEXICAL_LINE_RERANK_SKIP_REL_GAP,
					0.6,
				) &&
			probeGap >= leadGap * 1.4
		);
	}

	private async collectLexicalLineEvidence(
		queryText: string,
		matchedFile: MatchedFile,
		baseRank: number,
	): Promise<{
		matchedFile: MatchedFile;
		baseRank: number;
		baseScore: number;
		bestLineDensity: number;
		lineCount: number;
	}> {
		if (this.viewRegistry.viewTypeByPath(matchedFile.path) !== ViewType.MARKDOWN) {
			return {
				matchedFile,
				baseRank,
				baseScore: matchedFile.score ?? 0,
				bestLineDensity: 0,
				lineCount: 0,
			};
		}

		try {
			const content = await this.dataProvider.readPlainText(matchedFile.path);
			const lines = content
				.split(FileUtil.SPLIT_EOL)
				.map((text, index) => new Line(text, index));
			const tempFileItem = new FileItem(
				EngineType.LEXICAL,
				matchedFile.path,
				matchedFile.queryTerms,
				matchedFile.matchedTerms,
				[],
				"nothing",
			);
			const matchedLines = await this.lexicalEngine.searchLinesByFileItem(
				lines,
				"subItem",
				queryText,
				tempFileItem,
				SearchService.LEXICAL_LINE_RERANK_MAX_LINES,
			);
			let bestLineDensity = 0;
			for (const matchedLine of matchedLines) {
				bestLineDensity = Math.max(
					bestLineDensity,
					matchedLine.positions.size / Math.max(1, matchedLine.text.length),
				);
			}

			return {
				matchedFile,
				baseRank,
				baseScore: matchedFile.score ?? 0,
				bestLineDensity,
				lineCount: matchedLines.length,
			};
		} catch (error) {
			logger.warn(
				`failed to collect lexical line evidence for ${matchedFile.path}:`,
				error,
			);
			return {
				matchedFile,
				baseRank,
				baseScore: matchedFile.score ?? 0,
				bestLineDensity: 0,
				lineCount: 0,
			};
		}
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

		const matchedLines = await this.lexicalEngine.matchLinesFuzzy(
			queryText,
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

	private getBlockedSearchResult(queryText: string): SearchResult | null {
		if (queryText.length === 0) {
			return null;
		}
		const dataManager = getInstance(DataManager);
		if (dataManager.isSearchSearchable()) {
			return null;
		}
		const noticeKey = dataManager.getSearchBootstrapNoticeKey();
		if (noticeKey) {
			this.noticeSearchBootstrapBlocked(t(noticeKey));
		}
		return new SearchResult("no result", []);
	}
}
