import { EventEnum } from "src/globals/enums";
import type { OuterSetting } from "src/globals/plugin-setting";
import {
	EngineType,
	FileItem,
	SearchResult,
	SearchType,
} from "src/globals/search-types";
import type { SearchService } from "src/services/obsidian/search-service";
import { t, type LocaleKey } from "src/services/obsidian/translations/locale-helper";
import {
	DataManager,
	type HybridFreshnessSummary,
} from "src/services/obsidian/user-data/data-manager";
import { eventBus, type EventCallback } from "src/utils/event-bus";
import { getInstance } from "src/utils/my-lib";

export type HybridFreshnessNoticeState = {
	visible: boolean;
	message: string;
};

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

type HybridFreshnessNoticeControllerOptions = {
	getSearchType: () => SearchType;
	getIsHybrid: () => boolean;
	onNoticeChange: (state: HybridFreshnessNoticeState) => void;
};

export function usesDirectFileSubItems(item: FileItem): boolean {
	return (
		item.engineType === EngineType.SEMANTIC ||
		item.nativeSubItemsReady ||
		item.subItems.length > 0
	);
}

export function getMountedModalFileItemScore(
	item: FileItem,
): number | undefined {
	return item.subItems[0]?.score;
}

export function createHiddenHybridFreshnessNoticeState(): HybridFreshnessNoticeState {
	return {
		visible: false,
		message: "",
	};
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

export class HybridFreshnessNoticeController {
	private static readonly REFRESH_INTERVAL_MS = 1000;

	private readonly dataManager = getInstance(DataManager);
	private readonly getSearchType: () => SearchType;
	private readonly getIsHybrid: () => boolean;
	private readonly onNoticeChange: (state: HybridFreshnessNoticeState) => void;
	private readonly runtimeStatusCallback: EventCallback;
	private timer: ReturnType<typeof setInterval> | null = null;
	private refreshToken = 0;
	private destroyed = false;

	constructor(options: HybridFreshnessNoticeControllerOptions) {
		this.getSearchType = options.getSearchType;
		this.getIsHybrid = options.getIsHybrid;
		this.onNoticeChange = options.onNoticeChange;
		this.runtimeStatusCallback = () => {
			if (!this.shouldTrack()) {
				return;
			}
			void this.refreshNow();
		};
		eventBus.on(EventEnum.HYBRID_RUNTIME_STATUS_CHANGED, this.runtimeStatusCallback);
	}

	clear(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.stopTicker();
		eventBus.off(EventEnum.HYBRID_RUNTIME_STATUS_CHANGED, this.runtimeStatusCallback);
		this.onNoticeChange(createHiddenHybridFreshnessNoticeState());
	}

	syncFromResult(_result: SearchResult): void {
		if (!this.shouldTrack()) {
			this.stopTicker();
			this.onNoticeChange(createHiddenHybridFreshnessNoticeState());
			return;
		}
		this.startTicker();
		void this.refreshNow();
	}

	private shouldTrack(): boolean {
		return (
			!this.destroyed &&
			this.getSearchType() === SearchType.IN_VAULT &&
			this.getIsHybrid()
		);
	}

	private startTicker(): void {
		if (this.timer) {
			return;
		}
		this.timer = setInterval(() => {
			if (!this.shouldTrack()) {
				this.stopTicker();
				this.onNoticeChange(createHiddenHybridFreshnessNoticeState());
				return;
			}
			void this.refreshNow();
		}, HybridFreshnessNoticeController.REFRESH_INTERVAL_MS);
	}

	private stopTicker(): void {
		this.refreshToken += 1;
		if (!this.timer) {
			return;
		}
		clearInterval(this.timer);
		this.timer = null;
	}

	private async refreshNow(): Promise<void> {
		const token = ++this.refreshToken;
		const summary = await this.dataManager.getHybridFreshnessSummary();
		if (
			this.destroyed ||
			token !== this.refreshToken ||
			!this.shouldTrack()
		) {
			return;
		}
		this.onNoticeChange(this.buildNoticeState(summary));
	}

	private buildNoticeState(
		summary: HybridFreshnessSummary,
	): HybridFreshnessNoticeState {
		const clauses: string[] = [];
		if (summary.updatingFileCount > 0) {
			clauses.push(
				`${t("hybridModal.freshnessNotice.updatingPrefix")}${summary.updatingFileCount}${t("hybridModal.freshnessNotice.updatingSuffix")}`,
			);
		}
		if (summary.repairFileCount > 0) {
			clauses.push(
				`${t("hybridModal.freshnessNotice.repairPrefix")}${summary.repairFileCount}${t("hybridModal.freshnessNotice.repairSuffix")}`,
			);
		}
		if (clauses.length === 0) {
			return createHiddenHybridFreshnessNoticeState();
		}

		return {
			visible: true,
			message: this.buildMessage(summary),
		};
	}

	private buildMessage(summary: HybridFreshnessSummary): string {
		if (summary.updatingFileCount > 0 && summary.repairFileCount > 0) {
			return [
				t("hybridModal.freshnessNotice.messageBothPrefix"),
				String(summary.updatingFileCount),
				t("hybridModal.freshnessNotice.updatingSegmentSuffix"),
				t("hybridModal.freshnessNotice.messageJoiner"),
				String(summary.repairFileCount),
				t("hybridModal.freshnessNotice.repairSegmentSuffix"),
				t("hybridModal.freshnessNotice.detailTail"),
			].join("");
		}
		if (summary.updatingFileCount > 0) {
			return [
				t("hybridModal.freshnessNotice.messageUpdatingOnlyPrefix"),
				String(summary.updatingFileCount),
				t("hybridModal.freshnessNotice.updatingSegmentSuffix"),
				t("hybridModal.freshnessNotice.detailTail"),
			].join("");
		}
		return [
			t("hybridModal.freshnessNotice.messageRepairOnlyPrefix"),
			String(summary.repairFileCount),
			t("hybridModal.freshnessNotice.repairSegmentSuffix"),
			t("hybridModal.freshnessNotice.detailTail"),
		].join("");
	}
}
