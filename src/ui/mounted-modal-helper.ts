import { EventEnum } from "src/globals/enums";
import {
	EngineType,
	FileItem,
	SearchResult,
	SearchType,
	type HybridSearchMode,
} from "src/globals/search-types";
import type { SearchService } from "src/services/obsidian/search-service";
import { t } from "src/services/obsidian/translations/locale-helper";
import {
	DataManager,
	type HybridFreshnessSummary,
} from "src/services/obsidian/user-data/data-manager";
import { resolveHybridFreshnessState } from "src/services/obsidian/user-data/search-availability";
import { eventBus, type EventCallback } from "src/utils/event-bus";
import { getInstance } from "src/utils/my-lib";

export type HybridFreshnessNoticeState = {
	visible: boolean;
	message: string;
};

type HybridFreshnessNoticeControllerOptions = {
	getSearchType: () => SearchType;
	getIsHybrid: () => boolean;
	onNoticeChange: (state: HybridFreshnessNoticeState) => void;
};

type HybridQuerySession = {
	id: number;
	query: string;
	prepareTimer: ReturnType<typeof setTimeout> | null;
	rerankGateTimer: ReturnType<typeof setTimeout> | null;
	startedAt: number;
	rerankEligibleAt: number;
	abortPrepare: AbortController;
	abortRerank: AbortController;
	cancelled: boolean;
	prepared:
		| Awaited<ReturnType<SearchService["prepareSearchInVaultHybrid"]>>["prepared"]
		| null;
};

type HybridQuerySessionControllerOptions = {
	searchService: SearchService;
	getSearchType: () => SearchType;
	getIsHybrid: () => boolean;
	getHybridMode: () => HybridSearchMode;
	getAutoTriggerDelayMs: () => number;
	getCurrentQueryText: () => string;
	getCachedResult: (query: string) => SearchResult | undefined;
	setCachedResult: (query: string, result: SearchResult) => void;
	onResultApplied: (query: string, result: SearchResult) => Promise<void>;
};

export function usesDirectFileSubItems(item: FileItem): boolean {
	if (
		item.engineType === EngineType.HYBRID &&
		item.freshnessState === "stale_grace" &&
		!item.nativeSubItemsReady
	) {
		return false;
	}
	return (
		item.engineType === EngineType.HYBRID ||
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

function createAbortedSearchResult(): SearchResult {
	return new SearchResult("no result", []);
}

export class HybridQuerySessionController {
	private static readonly PREPARE_DEBOUNCE_MS = 100;

	private readonly searchService: SearchService;
	private readonly getSearchType: () => SearchType;
	private readonly getIsHybrid: () => boolean;
	private readonly getHybridMode: () => HybridSearchMode;
	private readonly getAutoTriggerDelayMs: () => number;
	private readonly getCurrentQueryText: () => string;
	private readonly getCachedResult: (query: string) => SearchResult | undefined;
	private readonly setCachedResult: (query: string, result: SearchResult) => void;
	private readonly onResultApplied: (
		query: string,
		result: SearchResult,
	) => Promise<void>;

	private currentSession: HybridQuerySession | null = null;
	private nextSessionId = 0;

	constructor(options: HybridQuerySessionControllerOptions) {
		this.searchService = options.searchService;
		this.getSearchType = options.getSearchType;
		this.getIsHybrid = options.getIsHybrid;
		this.getHybridMode = options.getHybridMode;
		this.getAutoTriggerDelayMs = options.getAutoTriggerDelayMs;
		this.getCurrentQueryText = options.getCurrentQueryText;
		this.getCachedResult = options.getCachedResult;
		this.setCachedResult = options.setCachedResult;
		this.onResultApplied = options.onResultApplied;
	}

	clear(): void {
		this.cancelSession(this.currentSession);
	}

	handleInput(query: string, options: { immediate?: boolean } = {}): void {
		if (!this.shouldHandle()) {
			this.clear();
			return;
		}
		const trimmedQuery = query.trim();
		if (trimmedQuery.length === 0) {
			this.clear();
			void this.onResultApplied(query, createAbortedSearchResult());
			return;
		}
		const cachedResult = this.getCachedResult(query);
		if (cachedResult) {
			this.clear();
			void this.applyCachedResult(query, cachedResult);
			return;
		}

		this.cancelSession(this.currentSession);
		const rerankGateMs = options.immediate
			? 0
			: this.getNormalizedAutoTriggerDelayMs();
		const prepareDelayMs = options.immediate
			? 0
			: HybridQuerySessionController.PREPARE_DEBOUNCE_MS;
		const now = Date.now();
		const session: HybridQuerySession = {
			id: ++this.nextSessionId,
			query,
			prepareTimer: null,
			rerankGateTimer: null,
			startedAt: now,
			rerankEligibleAt: now + rerankGateMs,
			abortPrepare: new AbortController(),
			abortRerank: new AbortController(),
			cancelled: false,
			prepared: null,
		};
		this.currentSession = session;
		session.prepareTimer = setTimeout(() => {
			session.prepareTimer = null;
			void this.runPrepare(session);
		}, prepareDelayMs);
	}

	private shouldHandle(): boolean {
		return (
			this.getSearchType() === SearchType.IN_VAULT &&
			this.getIsHybrid()
		);
	}

	private getNormalizedAutoTriggerDelayMs(): number {
		const value = this.getAutoTriggerDelayMs();
		if (!Number.isFinite(value)) {
			return 400;
		}
		return Math.min(5000, Math.max(200, Math.round(value)));
	}

	private cancelSession(session: HybridQuerySession | null): void {
		if (!session) {
			return;
		}
		session.cancelled = true;
		if (session.prepareTimer) {
			clearTimeout(session.prepareTimer);
			session.prepareTimer = null;
		}
		if (session.rerankGateTimer) {
			clearTimeout(session.rerankGateTimer);
			session.rerankGateTimer = null;
		}
		session.abortPrepare.abort();
		session.abortRerank.abort();
		if (this.currentSession?.id === session.id) {
			this.currentSession = null;
		}
	}

	private async applyCachedResult(
		query: string,
		result: SearchResult,
	): Promise<void> {
		if (query !== this.getCurrentQueryText()) {
			return;
		}
		this.searchService.notifyHybridFallback(result);
		await this.onResultApplied(query, result);
	}

	private shouldCacheResult(result: SearchResult): boolean {
		return result.hybridSearchOutcome === "success";
	}

	private isCurrentSession(session: HybridQuerySession): boolean {
		return Boolean(
			this.currentSession &&
			this.currentSession.id === session.id &&
			!session.cancelled &&
			session.query === this.getCurrentQueryText(),
		);
	}

	private async runPrepare(session: HybridQuerySession): Promise<void> {
		if (!this.isCurrentSession(session)) {
			return;
		}
		try {
			const preparedResult = await this.searchService.prepareSearchInVaultHybrid(
				session.query,
				session.abortPrepare.signal,
			);
			if (!this.isCurrentSession(session)) {
				return;
			}
			session.prepared = preparedResult.prepared;
			if (!preparedResult.prepared) {
				this.searchService.notifyHybridFallback(preparedResult.result);
				await this.onResultApplied(session.query, preparedResult.result);
				if (this.shouldCacheResult(preparedResult.result)) {
					this.setCachedResult(session.query, preparedResult.result);
				}
				return;
			}
			const remainingGateMs = session.rerankEligibleAt - Date.now();
			if (remainingGateMs <= 0) {
				void this.runFinalize(session);
				return;
			}
			session.rerankGateTimer = setTimeout(() => {
				session.rerankGateTimer = null;
				void this.runFinalize(session);
			}, remainingGateMs);
		} catch (error) {
			if (this.isAbortError(error)) {
				return;
			}
			throw error;
		}
	}

	private async runFinalize(session: HybridQuerySession): Promise<void> {
		if (!this.isCurrentSession(session) || !session.prepared) {
			return;
		}
		try {
			const finalizedResult =
				await this.searchService.finalizePreparedSearchInVaultHybrid(
					session.prepared,
					this.getHybridMode(),
					session.abortRerank.signal,
				);
			if (!this.isCurrentSession(session)) {
				return;
			}
			this.searchService.notifyHybridFallback(finalizedResult);
			if (this.shouldCacheResult(finalizedResult)) {
				this.setCachedResult(session.query, finalizedResult);
			}
			await this.onResultApplied(session.query, finalizedResult);
		} catch (error) {
			if (this.isAbortError(error)) {
				return;
			}
			throw error;
		}
	}

	private isAbortError(error: unknown): boolean {
		return Boolean(
			error &&
			typeof error === "object" &&
			"name" in error &&
			error.name === "AbortError",
		);
	}
}

export class HybridFreshnessNoticeController {
	private static readonly REFRESH_INTERVAL_MS = 5000;

	private readonly dataManager = getInstance(DataManager);
	private readonly getSearchType: () => SearchType;
	private readonly getIsHybrid: () => boolean;
	private readonly onNoticeChange: (state: HybridFreshnessNoticeState) => void;
	private readonly runtimeStatusCallback: EventCallback;
	private timer: ReturnType<typeof setInterval> | null = null;
	private refreshToken = 0;
	private refreshInFlight: Promise<void> | null = null;
	private refreshQueued = false;
	private runtimeStatusDirty = false;
	private destroyed = false;

	constructor(options: HybridFreshnessNoticeControllerOptions) {
		this.getSearchType = options.getSearchType;
		this.getIsHybrid = options.getIsHybrid;
		this.onNoticeChange = options.onNoticeChange;
		this.runtimeStatusCallback = () => {
			if (!this.shouldTrack()) {
				return;
			}
			this.runtimeStatusDirty = true;
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
		this.runtimeStatusDirty = false;
		this.requestRefresh();
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
			this.runtimeStatusDirty = false;
			this.requestRefresh();
		}, HybridFreshnessNoticeController.REFRESH_INTERVAL_MS);
	}

	private stopTicker(): void {
		this.refreshToken += 1;
		this.refreshQueued = false;
		this.runtimeStatusDirty = false;
		if (!this.timer) {
			return;
		}
		clearInterval(this.timer);
		this.timer = null;
	}

	private requestRefresh(): void {
		if (this.destroyed) {
			return;
		}
		if (this.refreshInFlight) {
			this.refreshQueued = true;
			return;
		}
		const run = async () => {
			try {
				await this.refreshNow();
			} finally {
				this.refreshInFlight = null;
				if (this.refreshQueued && !this.destroyed && this.shouldTrack()) {
					this.refreshQueued = false;
					this.requestRefresh();
				}
			}
		};
		this.refreshInFlight = run();
		void this.refreshInFlight;
	}

	private async refreshNow(): Promise<void> {
		const token = ++this.refreshToken;
		await this.dataManager.flushPendingDocOperations();
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
		const freshnessState = resolveHybridFreshnessState({
			processingFileCount: summary.processingFileCount,
			staleFileCount: summary.staleFileCount,
			repairFileCount: summary.repairFileCount,
		});
		if (freshnessState === "current") {
			return createHiddenHybridFreshnessNoticeState();
		}

		return {
			visible: true,
			message: this.buildMessage(summary, freshnessState),
		};
	}

	private buildMessage(
		summary: HybridFreshnessSummary,
		freshnessState: ReturnType<typeof resolveHybridFreshnessState>,
	): string {
		if (freshnessState === "partial") {
			return [
				t("hybridModal.freshnessNotice.messageProcessingOnlyPrefix"),
				String(summary.processingFileCount),
				t("hybridModal.freshnessNotice.processingSegmentSuffix"),
				t("hybridModal.freshnessNotice.messageJoiner"),
				String(summary.staleFileCount),
				t("hybridModal.freshnessNotice.staleSegmentSuffix"),
				t("hybridModal.freshnessNotice.detailTail"),
			].join("");
		}
		if (freshnessState === "processing") {
			if (summary.processingFileCount <= 0 && summary.repairFileCount > 0) {
				return [
					t("hybridModal.freshnessNotice.messageStaleOnlyPrefix"),
					String(summary.repairFileCount),
					t("hybridModal.freshnessNotice.repairSuffix"),
					t("hybridModal.freshnessNotice.detailTail"),
				].join("");
			}
			return [
				t("hybridModal.freshnessNotice.messageProcessingOnlyPrefix"),
				String(summary.processingFileCount),
				t("hybridModal.freshnessNotice.processingSegmentSuffix"),
				t("hybridModal.freshnessNotice.detailTail"),
			].join("");
		}
		return [
			t("hybridModal.freshnessNotice.messageStaleOnlyPrefix"),
			String(summary.staleFileCount),
			t("hybridModal.freshnessNotice.staleSegmentSuffix"),
			t("hybridModal.freshnessNotice.detailTail"),
		].join("");
	}
}
