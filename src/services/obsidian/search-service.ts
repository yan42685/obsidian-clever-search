import { App } from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import {
	EngineType,
	FileItem,
	FileSubItem,
	type HybridSearchOutcome,
	type HybridSearchIssueKind,
	Line,
	LineItem,
	SearchResult,
} from "../../globals/search-types";
import type {
	HybridSearchMode,
	MatchedFile,
} from "../../globals/search-types";
import { FileUtil } from "../../utils/file-util";
import { LineHighlighter } from "../search/highlighter";
import {
	HybridEngine,
	type PreparedHybridRecall,
} from "../search/hybrid/hybrid-engine";
import { LexicalEngine } from "../search/lexical-engine";
import { TruncateOption } from "../search/truncate-option";
import { throttle } from "throttle-debounce";
import { MyNotice } from "./transformed-api";
import { t } from "./translations/locale-helper";
import { DataProvider } from "./user-data/data-provider";
import { DataManager } from "./user-data/data-manager";
import type { HybridAvailabilityReason } from "./user-data/search-availability";
import { ViewRegistry, ViewType } from "./view-registry";
import {
	buildHybridSearchIssue,
} from "../search/hybrid/provider-error";

export type PreparedHybridSearchResult = {
	prepared: PreparedHybridRecall | null;
	result: SearchResult;
};

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
	private readonly noticeHybridFallback = (message: string) =>
		new MyNotice(message, 5000);
	private readonly noticeSearchBootstrapBlocked = throttle(
		2000,
		(message: string) => new MyNotice(message, 2500),
	);
	private lastHybridFallbackNoticeSignature: string | null = null;
	private readonly hybridIssueNoticeKeyByKind: Record<
		Exclude<HybridSearchIssueKind, "none">,
		"hybridNotice.searchIssue.missingApiKey" |
		"hybridNotice.searchIssue.weeklyTokenLimit" |
		"hybridNotice.searchIssue.quotaExhausted" |
		"hybridNotice.searchIssue.auth401" |
		"hybridNotice.searchIssue.auth403" |
		"hybridNotice.searchIssue.provider429" |
		"hybridNotice.searchIssue.timeout" |
		"hybridNotice.searchIssue.provider5xx" |
		"hybridNotice.searchIssue.network" |
		"hybridNotice.searchIssue.unknown"
	> = {
		missing_api_key: "hybridNotice.searchIssue.missingApiKey",
		weekly_token_limit: "hybridNotice.searchIssue.weeklyTokenLimit",
		quota_exhausted: "hybridNotice.searchIssue.quotaExhausted",
		auth_401: "hybridNotice.searchIssue.auth401",
		auth_403: "hybridNotice.searchIssue.auth403",
		provider_429: "hybridNotice.searchIssue.provider429",
		timeout: "hybridNotice.searchIssue.timeout",
		provider_5xx: "hybridNotice.searchIssue.provider5xx",
		network: "hybridNotice.searchIssue.network",
		unknown: "hybridNotice.searchIssue.unknown",
	};

	@monitorDecorator
	async searchInVault(queryText: string): Promise<SearchResult> {
		const blocked = this.getBlockedSearchResult(queryText);
		if (blocked) {
			return blocked;
		}
		const result = await this.searchInVaultLexical(queryText);
		this.notifyHybridFallback(result);
		return result;
	}

	async searchInVaultHybrid(queryText: string): Promise<SearchResult> {
		return await this.searchInVaultHybridByMode(queryText, "default");
	}

	async searchInVaultHybridLexicalLane(
		queryText: string,
	): Promise<SearchResult> {
		return await this.searchInVaultHybridByMode(queryText, "lexical-lane");
	}

	notifyHybridFallback(result: SearchResult): void {
		const notice = this.resolveHybridFallbackNotice(result);
		const signature = notice.message ?? notice.key ?? null;
		if (signature === this.lastHybridFallbackNoticeSignature) {
			return;
		}
		this.lastHybridFallbackNoticeSignature = signature;
		if (notice.message) {
			this.noticeHybridFallback(notice.message);
			return;
		}
		if (notice.key) {
			this.noticeHybridFallback(t(notice.key));
		}
	}

	private resolveHybridFallbackNotice(result: SearchResult): {
		key: SearchResult["hybridFallbackNoticeKey"];
		message: string | null;
	} {
		const issueMessage = result.hybridSearchIssueMessage?.trim() || null;
		if (issueMessage) {
			return {
				key: null,
				message: issueMessage,
			};
		}

		const issueKind = result.hybridSearchIssueKind;
		if (issueKind && issueKind !== "none") {
			return {
				key: this.hybridIssueNoticeKeyByKind[issueKind],
				message: null,
			};
		}

		return {
			key: this.resolveHybridFallbackNoticeKey(result.hybridFallbackNoticeKey),
			message: result.hybridFallbackNoticeMessage?.trim() || null,
		};
	}

	private buildHybridSearchResult(
		sourcePath: string,
		items: SearchResult["items"],
		noticeMessage: string | null = null,
		outcome: HybridSearchOutcome = "success",
		issueKind: HybridSearchIssueKind | null = null,
		issueMessage: string | null = null,
		...noticeKeys: Array<SearchResult["hybridFallbackNoticeKey"]>
	): SearchResult {
		const hybridAvailability = getInstance(DataManager).getHybridAvailabilityState();
		return new SearchResult(
			sourcePath,
			items,
			this.resolveHybridFallbackNoticeKey(...noticeKeys),
			noticeMessage,
			hybridAvailability.reasons,
			outcome,
			issueKind,
			issueMessage,
		);
	}

	private resolveHybridFallbackNoticeKey(
		...noticeKeys: Array<SearchResult["hybridFallbackNoticeKey"]>
	): SearchResult["hybridFallbackNoticeKey"] {
		for (const noticeKey of noticeKeys) {
			if (noticeKey) {
				return noticeKey;
			}
		}
		return null;
	}

	private attachHybridFallbackNotice(
		result: SearchResult,
		noticeMessage: string | null = null,
		outcome?: HybridSearchOutcome | null,
		issueKind?: HybridSearchIssueKind | null,
		issueMessage?: string | null,
		...noticeKeys: Array<SearchResult["hybridFallbackNoticeKey"]>
	): SearchResult {
		return result.withHybridFallbackNotice(
			this.resolveHybridFallbackNoticeKey(
				result.hybridFallbackNoticeKey,
				...noticeKeys,
			),
			noticeMessage ?? result.hybridFallbackNoticeMessage,
			outcome ?? result.hybridSearchOutcome,
			issueKind ?? result.hybridSearchIssueKind,
			issueMessage ?? result.hybridSearchIssueMessage,
		);
	}

	private getCurrentHybridAvailabilityReasons(): HybridAvailabilityReason[] {
		return getInstance(DataManager).getHybridAvailabilityState().reasons;
	}

	private async buildLexicalFallbackResult(
		queryText: string,
		options: {
			hybridAvailabilityReasons?: HybridAvailabilityReason[];
			noticeKeys?: Array<SearchResult["hybridFallbackNoticeKey"]>;
			noticeMessage?: string | null;
			outcome?: HybridSearchOutcome;
			issueKind?: HybridSearchIssueKind | null;
			issueMessage?: string | null;
		} = {},
	): Promise<SearchResult> {
		const lexicalResult = await this.searchInVaultLexical(queryText, {
			hybridAvailabilityReasons:
				options.hybridAvailabilityReasons ??
				this.getCurrentHybridAvailabilityReasons(),
		});
		const hasSearchFailure = Boolean(
			options.noticeMessage ||
				options.issueKind ||
				options.issueMessage,
		);
		return this.attachHybridFallbackNotice(
			lexicalResult,
			options.noticeMessage ?? null,
			options.outcome ??
				(hasSearchFailure
					? "fallback_failed"
					: lexicalResult.items.length > 0
						? "fallback_with_results"
						: "success"),
			options.issueKind ?? null,
			options.issueMessage ?? options.noticeMessage ?? null,
			...(options.noticeKeys ?? []),
		);
	}

	async prepareSearchInVaultHybrid(
		queryText: string,
		signal?: AbortSignal,
	): Promise<PreparedHybridSearchResult> {
		const dataManager = getInstance(DataManager);
		await dataManager.flushPendingDocOperations();
		const hybridAvailability = dataManager.getHybridAvailabilityState();
		const blocked = this.getBlockedSearchResult(queryText);
		if (blocked) {
			return {
				prepared: null,
				result: blocked,
			};
		}
		if (queryText.length === 0) {
			return {
				prepared: null,
				result: new SearchResult("no result", []),
			};
		}
		if (hybridAvailability.query === "unavailable") {
			return {
				prepared: null,
				result: await this.buildLexicalFallbackResult(queryText, {
					hybridAvailabilityReasons: hybridAvailability.reasons,
					noticeKeys: [hybridAvailability.prompt.fallbackNoticeKey],
				}),
			};
		}

		const topK = this.hybridEngine.getEffectiveResultCount();
		let prepared: PreparedHybridRecall;
		try {
			prepared = await this.hybridEngine.prepareRecall(
				queryText,
				topK,
				signal,
			);
		} catch (error) {
			const issue = buildHybridSearchIssue(error);
			logger.error(
				"hybrid lexical-lane prepare failed; falling back to lexical search.",
				error,
			);
			return {
				prepared: null,
				result: await this.buildLexicalFallbackResult(queryText, {
					hybridAvailabilityReasons: hybridAvailability.reasons,
					noticeKeys: ["hybridNotice.searchFallbackToLexical"],
					noticeMessage: issue.message,
					issueKind: issue.kind,
					issueMessage: issue.message,
				}),
			};
		}
		if (prepared.fallbackToLexicalSearch) {
			return {
				prepared: null,
				result: await this.buildLexicalFallbackResult(queryText, {
					hybridAvailabilityReasons: hybridAvailability.reasons,
					noticeKeys: [prepared.fallbackNoticeKey],
				}),
			};
		}
		const sourcePath =
			this.app.workspace.getActiveFile()?.path || "no source path";
		const earlyItems = this.hybridEngine.buildItemsFromPreparedRecall(
			prepared,
			topK,
		);
		return {
			prepared,
				result: this.buildHybridSearchResult(
					sourcePath,
					earlyItems,
					prepared.fallbackNoticeMessage,
					prepared.fallbackIssueKind ||
					prepared.fallbackIssueMessage ||
					prepared.fallbackNoticeMessage
						? "fallback_failed"
						: prepared.fallbackNoticeKey
							? "fallback_with_results"
							: "success",
					prepared.fallbackIssueKind,
					prepared.fallbackIssueMessage,
					prepared.fallbackNoticeKey,
				),
			};
	}

	async finalizePreparedSearchInVaultHybrid(
		prepared: PreparedHybridRecall,
		mode: HybridSearchMode = "default",
		signal?: AbortSignal,
	): Promise<SearchResult> {
		const sourcePath =
			this.app.workspace.getActiveFile()?.path || "no source path";
		if (prepared.fallbackToLexicalSearch) {
			return await this.buildLexicalFallbackResult(prepared.query, {
				noticeKeys: [prepared.fallbackNoticeKey],
				noticeMessage: prepared.fallbackNoticeMessage,
				issueKind: prepared.fallbackIssueKind,
				issueMessage: prepared.fallbackIssueMessage,
			});
		}
		if (mode === "lexical-lane") {
			return this.buildHybridSearchResult(
				sourcePath,
				this.hybridEngine.buildItemsFromPreparedRecall(prepared, prepared.topK),
				prepared.fallbackNoticeMessage,
				prepared.fallbackIssueKind ||
				prepared.fallbackIssueMessage ||
				prepared.fallbackNoticeMessage
					? "fallback_failed"
					: prepared.fallbackNoticeKey
						? "fallback_with_results"
						: "success",
				prepared.fallbackIssueKind,
				prepared.fallbackIssueMessage,
				prepared.fallbackNoticeKey,
			);
		}
		const finalized = await this.hybridEngine.finalizePreparedRecall(
			prepared,
			prepared.topK,
			signal,
		);
		if (finalized.fallbackToLexicalSearch) {
			return await this.buildLexicalFallbackResult(prepared.query, {
				noticeKeys: [finalized.fallbackNoticeKey],
				noticeMessage: finalized.fallbackNoticeMessage,
				issueKind: finalized.fallbackIssueKind,
				issueMessage: finalized.fallbackIssueMessage,
			});
		}
		return this.buildHybridSearchResult(
			sourcePath,
			finalized.items,
			finalized.fallbackNoticeMessage,
			finalized.fallbackIssueKind ||
			finalized.fallbackIssueMessage ||
			finalized.fallbackNoticeMessage
				? "fallback_failed"
				: finalized.fallbackNoticeKey
					? "fallback_with_results"
					: "success",
			finalized.fallbackIssueKind,
			finalized.fallbackIssueMessage,
			finalized.fallbackNoticeKey,
		);
	}

	private async searchInVaultHybridByMode(
		queryText: string,
		mode: HybridSearchMode,
	): Promise<SearchResult> {
		const prepared = await this.prepareSearchInVaultHybrid(queryText);
		const result = prepared.prepared
			? await this.finalizePreparedSearchInVaultHybrid(
				prepared.prepared,
				mode,
			)
			: prepared.result;
		this.notifyHybridFallback(result);
		return result;
	}

	private async searchInVaultLexical(
		queryText: string,
		options: {
			hybridAvailabilityReasons?: HybridAvailabilityReason[];
		} = {},
	): Promise<SearchResult> {
		const result = new SearchResult(
			"no result",
			[],
			null,
			null,
			options.hybridAvailabilityReasons ?? [],
			"success",
		);
		if (queryText.length === 0) {
			return result;
		}
		const sourcePath =
			this.app.workspace.getActiveFile()?.path || "no source path";
		const maxDisplayItems = this.setting.ui.maxItemResults;
		const activeBackend = this.lexicalEngine.getActiveFileSearchBackend();
		const searchLimit =
			activeBackend === "coverage-lexical"
				? maxDisplayItems
				: this.getLexicalFileCandidateLimit(maxDisplayItems);
		const lexicalMatches = await this.lexicalEngine.searchFiles(
			queryText,
			searchLimit,
			maxDisplayItems,
			SearchService.LEXICAL_SUBITEM_MAX_LINES,
		);
		const rerankedMatches =
			activeBackend === "coverage-lexical"
				? lexicalMatches
				: await this.rerankLexicalMatchesByLineEvidence(
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
					matchedFile.basenameHighlightRanges,
					matchedFile.folderHighlightRanges,
				);
			}),
			null,
			null,
			options.hybridAvailabilityReasons ?? [],
			"success",
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
		const nativeSubItems = await this.lexicalEngine.getNativeFileSubItems(
			queryText,
			path,
			SearchService.LEXICAL_SUBITEM_MAX_LINES,
		);
		if (nativeSubItems) {
			fileItem.nativeSubItemsReady = true;
			return nativeSubItems;
		}

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

		fileItem.nativeSubItemsReady = true;
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
		return new SearchResult(activeFile.path, lineItems);
	}

	private getBlockedSearchResult(queryText: string): SearchResult | null {
		if (queryText.length === 0) {
			return null;
		}
		const dataManager = getInstance(DataManager);
		const lexicalAvailability = dataManager.getLexicalAvailabilityState();
		if (lexicalAvailability.searchable) {
			return null;
		}
		const noticeKey = lexicalAvailability.blockingNoticeKey;
		if (noticeKey) {
			this.noticeSearchBootstrapBlocked(t(noticeKey));
		}
		return new SearchResult("no result", []);
	}
}
