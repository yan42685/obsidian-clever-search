import type { OuterSetting } from "src/globals/plugin-setting";
import {
	EngineType,
	FileItem,
	SearchResult,
	SearchType,
} from "src/globals/search-types";
import type { SearchService } from "src/services/obsidian/search-service";
import type { LocaleKey } from "src/services/obsidian/translations/locale-helper";

type AutoHybridFallbackControllerOptions = {
	searchService: SearchService;
	setting: OuterSetting;
	searchType: SearchType;
	isHybrid: boolean;
	getLatestRequestId: () => number;
	getCurrentQueryText: () => string;
	onFailureNoticeChange: (key: LocaleKey | null) => void;
	onResultApplied: (query: string, result: SearchResult) => Promise<void>;
};

export function usesDirectFileSubItems(item: FileItem): boolean {
	return item.engineType === EngineType.SEMANTIC;
}

export function getMountedModalFileItemScore(
	item: FileItem,
): number | undefined {
	return item.subItems[0]?.score;
}

export class AutoHybridFallbackController {
	private static readonly DEBOUNCE_MS = 500;

	private readonly searchService: SearchService;
	private readonly setting: OuterSetting;
	private readonly searchType: SearchType;
	private readonly isHybrid: boolean;
	private readonly getLatestRequestId: () => number;
	private readonly getCurrentQueryText: () => string;
	private readonly onFailureNoticeChange: (key: LocaleKey | null) => void;
	private readonly onResultApplied: (
		query: string,
		result: SearchResult,
	) => Promise<void>;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastTriggeredAt = 0;

	constructor(options: AutoHybridFallbackControllerOptions) {
		this.searchService = options.searchService;
		this.setting = options.setting;
		this.searchType = options.searchType;
		this.isHybrid = options.isHybrid;
		this.getLatestRequestId = options.getLatestRequestId;
		this.getCurrentQueryText = options.getCurrentQueryText;
		this.onFailureNoticeChange = options.onFailureNoticeChange;
		this.onResultApplied = options.onResultApplied;
	}

	clear(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	syncFailureNoticeFromResult(result: SearchResult): void {
		this.onFailureNoticeChange(
			result.items.length === 0 ? result.hybridFallbackNoticeKey ?? null : null,
		);
	}

	schedule(query: string, requestId: number): void {
		if (!this.shouldAutoShow(query)) {
			this.clear();
			return;
		}

		const now = Date.now();
		if (
			this.lastTriggeredAt === 0 ||
			now - this.lastTriggeredAt >= AutoHybridFallbackController.DEBOUNCE_MS
		) {
			this.clear();
			this.lastTriggeredAt = now;
			void this.apply(query, requestId);
			return;
		}

		this.clear();
		this.timer = setTimeout(() => {
			this.timer = null;
			this.lastTriggeredAt = Date.now();
			void this.apply(query, requestId);
		}, AutoHybridFallbackController.DEBOUNCE_MS);
	}

	private shouldAutoShow(query: string): boolean {
		return (
			this.searchType === SearchType.IN_VAULT &&
			!this.isHybrid &&
			this.searchService.hybridEngine.isEnabled() &&
			(this.setting.hybrid.autoShowResultsWhenLexicalEmpty ?? false) &&
			query.trim().length >= 3
		);
	}

	private async apply(query: string, requestId: number): Promise<void> {
		const hybridResult = await this.searchService.searchInVaultHybrid(query);
		if (
			requestId !== this.getLatestRequestId() ||
			query !== this.getCurrentQueryText()
		) {
			return;
		}

		this.onFailureNoticeChange(
			hybridResult.items.length === 0
				? hybridResult.hybridFallbackNoticeKey ?? null
				: null,
		);
		await this.onResultApplied(query, hybridResult);
	}
}
