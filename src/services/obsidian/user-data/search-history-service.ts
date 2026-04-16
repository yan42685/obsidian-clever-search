import {
	OuterSetting,
	type QuickSwitchHistoryEntry,
	type QuickSwitchHistoryQueryEntry,
	type SearchHistoryEntry,
	type SearchHistoryNavigationKind,
} from "src/globals/plugin-setting";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import {
	createLightweightFuzzyIndex,
	matchLightweightFuzzy,
	prepareLightweightFuzzyQuery,
	type LightweightFuzzyIndex,
} from "src/services/search/lightweight-fuzzy-matcher";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

export type SearchHistorySuggestion = SearchHistoryEntry & {
	positions: number[];
	fuzzyScore: number;
	historyScore: number;
	compositeScore: number;
};

export type RecentNavigationSelection = {
	queryText: string;
	path: string;
	openLinkText: string;
	primaryText: string;
	secondaryText?: string;
	kind: SearchHistoryNavigationKind;
	timestamp: number;
};

export type NavigationHabitSignal = {
	querySelectionCount: number;
	totalSelectionCount: number;
	recentDayCount: number;
	dayStreak: number;
	lastTimestamp: number;
	queryLastTimestamp: number;
};

type HistoryScoreContext = {
	maxCombinedUsageCount: number;
	now: number;
};

type IndexedSearchHistoryEntry = {
	entry: SearchHistoryEntry;
	normalizedQueryText: string;
	textIndex: LightweightFuzzyIndex;
	latestInteractionTimestamp: number;
	combinedUsageCount: number;
};

@singleton()
export class SearchHistoryService {
	private static readonly MAX_SUGGESTION_COUNT = 12;
	private static readonly RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 14;
	private static readonly CANDIDATE_MATCH_WEIGHT = 320;
	private static readonly NAVIGATION_RECENT_DAY_LIMIT = 7;
	private static readonly QUICK_SWITCH_QUERY_LIMIT = 20;
	private static readonly QUICK_SWITCH_QUICK_COMMAND_LIMIT = 1000;
	private static readonly DAY_MS = 1000 * 60 * 60 * 24;
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private get setting(): OuterSetting {
		return getInstance(OuterSetting);
	}
	private lastSettingRef: OuterSetting | null = null;
	private indexedEntriesCache: IndexedSearchHistoryEntry[] | null = null;
	private quickSwitchNavigationEntriesCache: QuickSwitchHistoryEntry[] | null = null;
	private quickSwitchQuickCommandEntriesCache: QuickSwitchHistoryEntry[] | null = null;
	private maxCombinedUsageCountCache: number | null = null;

	isEnabled(): boolean {
		return this.setting.searchHistory.enabled;
	}

	getEntryCount(): number {
		return this.getEntries().length;
	}

	getQuickSwitchEntryCount(): number {
		return (
			this.getQuickSwitchNavigationEntries().length +
			this.getQuickSwitchQuickCommandEntries().length
		);
	}

	async recordSuggestionSelection(queryText: string): Promise<void> {
		if (!this.isEnabled()) {
			return;
		}

		const normalizedQuery = this.normalizeQuery(queryText);
		if (normalizedQuery.length === 0) {
			return;
		}

		const entry = this.getEntries().find(
			(candidate) => candidate.normalizedQueryText === normalizedQuery,
		)?.entry;
		if (!entry) {
			return;
		}

		entry.selectionCount = (entry.selectionCount ?? 0) + 1;
		entry.selectionTimestamp = Date.now();
		this.setting.searchHistory.entries = this.trimEntries(
			this.setting.searchHistory.entries ?? [],
		);
		this.invalidateQueryEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	async recordNavigationSelection(
		queryText: string,
		navigation: {
			path: string;
			primaryText: string;
			secondaryText?: string;
			kind: SearchHistoryNavigationKind;
			openLinkText?: string;
		},
	): Promise<void> {
		if (!this.isEnabled()) {
			return;
		}

		const nextPath = navigation.path.trim();
		const nextPrimaryText = navigation.primaryText.trim();
		const nextSecondaryText = navigation.secondaryText?.trim() || undefined;
		const nextOpenLinkText = navigation.openLinkText?.trim() || nextPath;
		if (
			nextPath.length === 0 ||
			nextPrimaryText.length === 0 ||
			nextOpenLinkText.length === 0
		) {
			return;
		}

		const isQuickCommand = navigation.kind === "quickCommand";
		const now = Date.now();
		const entries = isQuickCommand
			? [...this.getQuickSwitchQuickCommandEntries()]
			: [...this.getQuickSwitchNavigationEntries()];
		const targetKey = this.normalizeQuickSwitchTargetKey(nextOpenLinkText);
		let existingEntry = entries.find(
			(entry) => this.normalizeQuickSwitchTargetKey(entry.openLinkText) === targetKey,
		);
		if (!existingEntry) {
			existingEntry = {
				path: nextPath,
				primaryText: nextPrimaryText,
				secondaryText: nextSecondaryText,
				kind: navigation.kind,
				openLinkText: nextOpenLinkText,
				timestamp: now,
				count: 0,
				queries: [],
			};
			entries.push(existingEntry);
		}

		existingEntry.path = nextPath;
		existingEntry.primaryText = nextPrimaryText;
		existingEntry.secondaryText = nextSecondaryText;
		existingEntry.kind = navigation.kind;
		existingEntry.openLinkText = nextOpenLinkText;
		existingEntry.timestamp = now;
		this.updateQuickSwitchHabitEntry(existingEntry, now);
		this.updateQuickSwitchQueryEntry(existingEntry, queryText, now);

		const quickSwitchHistory = this.getQuickSwitchHistorySetting();
		if (isQuickCommand) {
			quickSwitchHistory.quickCommandEntries = this.trimQuickSwitchEntries(entries);
		} else {
			quickSwitchHistory.navigationEntries = this.trimQuickSwitchEntries(entries);
		}

		this.invalidateQuickSwitchEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	getRecentNavigationSelections(limit = 6): RecentNavigationSelection[] {
		return this.getQuickSwitchNavigationEntries()
			.slice(0, limit)
			.map((entry) => this.toRecentNavigationSelection(entry));
	}

	getRecentQuickCommandSelections(limit = 8): RecentNavigationSelection[] {
		return this.getQuickSwitchQuickCommandEntries()
			.slice(0, limit)
			.map((entry) => this.toRecentNavigationSelection(entry));
	}

	getNavigationHabitSignals(queryText: string): Map<string, NavigationHabitSignal> {
		return this.getQuickSwitchHabitSignals(
			this.getQuickSwitchNavigationEntries(),
			queryText,
		);
	}

	getQuickCommandHabitSignals(queryText: string): Map<string, NavigationHabitSignal> {
		return this.getQuickSwitchHabitSignals(
			this.getQuickSwitchQuickCommandEntries(),
			queryText,
		);
	}

	private getQuickSwitchHabitSignals(
		entries: QuickSwitchHistoryEntry[],
		queryText: string,
	): Map<string, NavigationHabitSignal> {
		const normalizedQuery = this.normalizeNavigationQuery(queryText);
		const signals = new Map<string, NavigationHabitSignal>();

		for (const entry of entries) {
			const queryEntry =
				normalizedQuery.length > 0
					? this.getQuickSwitchQueryEntry(entry, normalizedQuery)
					: null;
			signals.set(entry.openLinkText, {
				querySelectionCount: queryEntry ? this.getQuickSwitchQueryCount(queryEntry) : 0,
				totalSelectionCount: this.getQuickSwitchSelectionCount(entry),
				recentDayCount: this.getRecentNavigationDayCount(
					this.getQuickSwitchRecentDateKeys(entry),
				),
				dayStreak: this.getQuickSwitchDayStreak(entry),
				lastTimestamp: entry.timestamp,
				queryLastTimestamp: queryEntry?.timestamp ?? 0,
			});
		}

		return signals;
	}

	getGhostSuggestion(prefix: string): SearchHistoryEntry | null {
		const normalizedPrefix = this.normalizeQuery(prefix);
		if (!this.isEnabled() || normalizedPrefix.length === 0) {
			return null;
		}

		const entries = this.getEntries();
		const scoreContext = this.createHistoryScoreContext(entries);
		let bestEntry: IndexedSearchHistoryEntry | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;

		for (const entry of entries) {
			const normalizedQuery = entry.normalizedQueryText;
			if (
				normalizedQuery === normalizedPrefix ||
				!normalizedQuery.startsWith(normalizedPrefix)
			) {
				continue;
			}

			const score = this.getHistoryPriorityScore(entry, scoreContext);
			if (
				score > bestScore ||
				(score === bestScore &&
					bestEntry !== null &&
					entry.entry.queryText.localeCompare(bestEntry.entry.queryText) > 0)
			) {
				bestEntry = entry;
				bestScore = score;
			}
		}

		return bestEntry?.entry ?? null;
	}

	getCandidateSuggestions(
		query: string,
		limit = SearchHistoryService.MAX_SUGGESTION_COUNT,
	): SearchHistorySuggestion[] {
		const normalizedQuery = this.normalizeQuery(query);
		if (!this.isEnabled() || normalizedQuery.length === 0) {
			return [];
		}

		const allEntries = this.getEntries();
		if (allEntries.length === 0) {
			return [];
		}
		const scoreContext = this.createHistoryScoreContext(allEntries);
		const preparedQuery = prepareLightweightFuzzyQuery(
			normalizedQuery,
			"history",
		);
		const suggestions: SearchHistorySuggestion[] = [];

		for (const indexedEntry of allEntries) {
			if (indexedEntry.normalizedQueryText === normalizedQuery) {
				continue;
			}

			const match = this.matchCandidateQuery(preparedQuery, indexedEntry);
			if (!match) {
				continue;
			}

			const historyScore = this.getHistoryPriorityScore(indexedEntry, scoreContext);
			const suggestion: SearchHistorySuggestion = {
				...indexedEntry.entry,
				positions: match.positions,
				fuzzyScore: match.score,
				historyScore,
				compositeScore:
					match.score + historyScore * SearchHistoryService.CANDIDATE_MATCH_WEIGHT,
			};
			this.insertTopSuggestion(suggestions, suggestion, limit);
		}

		return suggestions;
	}

	async recordQuery(queryText: string): Promise<void> {
		if (!this.isEnabled()) {
			return;
		}

		const normalizedQuery = this.normalizeQuery(queryText);
		if (normalizedQuery.length === 0) {
			return;
		}

		const entries = this.getEntries();
		const existingEntry = entries.find(
			(entry) => entry.normalizedQueryText === normalizedQuery,
		)?.entry;
		if (existingEntry) {
			existingEntry.queryText = queryText.trim();
			existingEntry.timestamp = Date.now();
			existingEntry.count = (existingEntry.count ?? 1) + 1;
		} else {
			(this.setting.searchHistory.entries ??= []).push({
				queryText: queryText.trim(),
				timestamp: Date.now(),
				count: 1,
			});
		}

		this.setting.searchHistory.entries = this.trimEntries(
			this.setting.searchHistory.entries ?? [],
		);
		this.invalidateQueryEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	async removeQuery(queryText: string): Promise<void> {
		const normalizedQuery = this.normalizeQuery(queryText);
		if (normalizedQuery.length === 0) {
			return;
		}

		this.setting.searchHistory.entries = this.getEntries()
			.map((entry) => entry.entry)
			.filter(
				(entry) => this.normalizeQuery(entry.queryText) !== normalizedQuery,
			);
		this.invalidateQueryEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	async clearHistory(): Promise<void> {
		this.setting.searchHistory.entries = [];
		this.invalidateQueryEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	async clearQuickSwitchHistory(): Promise<void> {
		const quickSwitchHistory = this.getQuickSwitchHistorySetting();
		quickSwitchHistory.navigationEntries = [];
		quickSwitchHistory.quickCommandEntries = [];
		this.invalidateQuickSwitchEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	private getEntries(): IndexedSearchHistoryEntry[] {
		this.ensureSettingFresh();
		if (this.indexedEntriesCache) {
			return this.indexedEntriesCache;
		}

		const sanitizedEntries = this.trimEntries(
			this.sanitizeEntries(this.setting.searchHistory.entries ?? []),
		);
		this.setting.searchHistory.entries = sanitizedEntries;
		this.indexedEntriesCache = sanitizedEntries.map((entry) =>
			this.createIndexedEntry(entry),
		);
		return this.indexedEntriesCache;
	}

	private getQuickSwitchNavigationEntries(): QuickSwitchHistoryEntry[] {
		this.ensureSettingFresh();
		if (this.quickSwitchNavigationEntriesCache) {
			return this.quickSwitchNavigationEntriesCache;
		}

		const quickSwitchSetting = this.getQuickSwitchHistorySetting();
		const navigationEntries = this.trimQuickSwitchEntries(
			this.sanitizeQuickSwitchEntries(quickSwitchSetting.navigationEntries ?? []).filter(
				(entry) => entry.kind !== "quickCommand",
			),
		);
		quickSwitchSetting.navigationEntries = navigationEntries;
		this.quickSwitchNavigationEntriesCache = navigationEntries;
		return navigationEntries;
	}

	private getQuickSwitchQuickCommandEntries(): QuickSwitchHistoryEntry[] {
		this.ensureSettingFresh();
		if (this.quickSwitchQuickCommandEntriesCache) {
			return this.quickSwitchQuickCommandEntriesCache;
		}

		const quickSwitchSetting = this.getQuickSwitchHistorySetting();
		const quickCommandEntries = this.trimQuickSwitchEntries(
			this.sanitizeQuickSwitchEntries(quickSwitchSetting.quickCommandEntries ?? []).filter(
				(entry) => entry.kind === "quickCommand",
			),
		);
		quickSwitchSetting.quickCommandEntries = quickCommandEntries;
		this.quickSwitchQuickCommandEntriesCache = quickCommandEntries;
		return quickCommandEntries;
	}

	private getQuickSwitchHistorySetting() {
		this.ensureSettingFresh();
		const quickSwitchHistory = (this.setting.quickSwitchHistory ??= {
			maxItems: 5000,
			navigationEntries: [],
			quickCommandEntries: [],
		}) as typeof this.setting.quickSwitchHistory & {
			entries?: QuickSwitchHistoryEntry[];
		};

		const legacyEntries = Array.isArray(quickSwitchHistory.entries)
			? quickSwitchHistory.entries
			: [];
		const navigationEntries = Array.isArray(quickSwitchHistory.navigationEntries)
			? quickSwitchHistory.navigationEntries
			: [];
		const quickCommandEntries = Array.isArray(quickSwitchHistory.quickCommandEntries)
			? quickSwitchHistory.quickCommandEntries
			: [];

		if (legacyEntries.length > 0) {
			quickSwitchHistory.navigationEntries = [
				...navigationEntries,
				...legacyEntries.filter(
					(entry) => normalizeSearchHistoryNavigationKind(entry.kind) !== "quickCommand",
				),
			];
			quickSwitchHistory.quickCommandEntries = [
				...quickCommandEntries,
				...legacyEntries.filter(
					(entry) => normalizeSearchHistoryNavigationKind(entry.kind) === "quickCommand",
				),
			];
			delete quickSwitchHistory.entries;
		} else {
			quickSwitchHistory.navigationEntries = navigationEntries;
			quickSwitchHistory.quickCommandEntries = quickCommandEntries;
		}

		return quickSwitchHistory;
	}

	private ensureSettingFresh(): void {
		const currentSetting = this.setting;
		if (this.lastSettingRef === currentSetting) {
			return;
		}
		this.lastSettingRef = currentSetting;
		this.invalidateQueryEntriesCache();
		this.invalidateQuickSwitchEntriesCache();
	}

	private sanitizeEntries(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
		return entries
			.filter((entry) => typeof entry?.queryText === "string")
			.map((entry) => ({
				queryText: entry.queryText.trim(),
				timestamp:
					typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
				count:
					typeof entry.count === "number" && entry.count > 0
						? Math.floor(entry.count)
						: 1,
				selectionCount:
					typeof entry.selectionCount === "number" && entry.selectionCount > 0
						? Math.floor(entry.selectionCount)
						: 0,
				selectionTimestamp:
					typeof entry.selectionTimestamp === "number"
						? entry.selectionTimestamp
						: 0,
			}))
			.filter((entry) => entry.queryText.length > 0);
	}

	private trimEntries(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
		const dedupedEntries = new Map<string, SearchHistoryEntry>();
		for (const entry of this.sanitizeEntries(entries)) {
			const normalizedQuery = this.normalizeQuery(entry.queryText);
			if (normalizedQuery.length === 0) {
				continue;
			}
			const prevEntry = dedupedEntries.get(normalizedQuery);
			if (!prevEntry) {
				dedupedEntries.set(normalizedQuery, entry);
				continue;
			}
			prevEntry.queryText =
				entry.timestamp >= prevEntry.timestamp
					? entry.queryText.trim()
					: prevEntry.queryText.trim();
			prevEntry.timestamp = Math.max(prevEntry.timestamp, entry.timestamp);
			prevEntry.count = (prevEntry.count ?? 1) + (entry.count ?? 1);
			prevEntry.selectionCount =
				(prevEntry.selectionCount ?? 0) + (entry.selectionCount ?? 0);
			prevEntry.selectionTimestamp = Math.max(
				prevEntry.selectionTimestamp ?? 0,
				entry.selectionTimestamp ?? 0,
			);
		}

		const maxItems = this.setting.searchHistory.maxItems;
		return [...dedupedEntries.values()]
			.sort((left, right) => {
				const latestTimestampDiff =
					this.getLatestInteractionTimestamp(right) -
					this.getLatestInteractionTimestamp(left);
				if (latestTimestampDiff !== 0) {
					return latestTimestampDiff;
				}
				return this.getCombinedUsageCount(right) - this.getCombinedUsageCount(left);
			})
			.slice(0, maxItems);
	}

	private sanitizeQuickSwitchEntries(
		entries: QuickSwitchHistoryEntry[],
	): QuickSwitchHistoryEntry[] {
		return entries
			.filter((entry) => typeof entry?.path === "string")
			.map((entry) => {
				const sanitizedQueries = this.trimQuickSwitchQueries(
					this.sanitizeQuickSwitchQueryEntries(entry.queries ?? []),
				);
				return {
					path: entry.path.trim(),
					primaryText:
						typeof entry.primaryText === "string"
							? entry.primaryText.trim()
							: "",
					secondaryText:
						typeof entry.secondaryText === "string" &&
						entry.secondaryText.trim().length > 0
							? entry.secondaryText.trim()
							: undefined,
					kind: normalizeSearchHistoryNavigationKind(entry.kind),
					openLinkText:
						typeof entry.openLinkText === "string"
							? entry.openLinkText.trim()
							: entry.path.trim(),
					timestamp:
						typeof entry.timestamp === "number" ? entry.timestamp : 0,
					count: this.getSafePositiveInteger(
						entry.count,
						entry.timestamp > 0 ? 1 : 0,
					),
					lastDateKey: this.isDateKey(entry.lastDateKey)
						? entry.lastDateKey
						: undefined,
					recentDateKeys: this.sanitizeNavigationRecentDateKeys(
						entry.recentDateKeys,
					),
					dayStreak: this.getSafePositiveInteger(
						entry.dayStreak,
						entry.timestamp > 0 ? 1 : 0,
					),
					queries: sanitizedQueries.length > 0 ? sanitizedQueries : undefined,
				};
			})
			.filter(
				(entry) =>
					entry.path.length > 0 &&
					entry.primaryText.length > 0 &&
					entry.openLinkText.length > 0,
			);
	}

	private sanitizeQuickSwitchQueryEntries(
		entries: QuickSwitchHistoryQueryEntry[],
	): QuickSwitchHistoryQueryEntry[] {
		return entries
			.filter((entry) => typeof entry?.queryText === "string")
			.map((entry) => ({
				queryText: entry.queryText.trim(),
				timestamp:
					typeof entry.timestamp === "number" ? entry.timestamp : 0,
				count: this.getSafePositiveInteger(entry.count, 1),
			}))
			.filter((entry) => entry.queryText.length > 0);
	}

	private trimQuickSwitchEntries(
		entries: QuickSwitchHistoryEntry[],
	): QuickSwitchHistoryEntry[] {
		const dedupedEntries = new Map<string, QuickSwitchHistoryEntry>();
		for (const entry of this.sanitizeQuickSwitchEntries(entries)) {
			const targetKey = this.normalizeQuickSwitchTargetKey(entry.openLinkText);
			if (!targetKey) {
				continue;
			}

			const prevEntry = dedupedEntries.get(targetKey);
			if (!prevEntry) {
				dedupedEntries.set(targetKey, this.cloneQuickSwitchEntry(entry));
				continue;
			}

			const prevTimestamp = prevEntry.timestamp;
			prevEntry.count =
				this.getQuickSwitchSelectionCount(prevEntry) +
				this.getQuickSwitchSelectionCount(entry);
			prevEntry.timestamp = Math.max(prevEntry.timestamp, entry.timestamp);
			prevEntry.lastDateKey =
				this.maxDateKey(
					this.getQuickSwitchLastDateKey(prevEntry),
					this.getQuickSwitchLastDateKey(entry),
				) ?? undefined;
			prevEntry.recentDateKeys = this.mergeNavigationRecentDateKeys(
				this.getQuickSwitchRecentDateKeys(prevEntry),
				this.getQuickSwitchRecentDateKeys(entry),
			);
			prevEntry.dayStreak = Math.max(
				this.getQuickSwitchDayStreak(prevEntry),
				this.getQuickSwitchDayStreak(entry),
			);
			prevEntry.queries = this.trimQuickSwitchQueries([
				...(prevEntry.queries ?? []),
				...(entry.queries ?? []),
			]);
			if (entry.timestamp >= prevTimestamp) {
				prevEntry.path = entry.path;
				prevEntry.primaryText = entry.primaryText;
				prevEntry.secondaryText = entry.secondaryText;
				prevEntry.kind = entry.kind;
				prevEntry.openLinkText = entry.openLinkText;
			}
		}

		const maxItems = this.getQuickSwitchHistorySetting().maxItems;
		const trimmedEntries: QuickSwitchHistoryEntry[] = [];
		let quickCommandCount = 0;
		for (const entry of [...dedupedEntries.values()]
			.sort((left, right) => {
				if (left.timestamp !== right.timestamp) {
					return right.timestamp - left.timestamp;
				}
				const countDiff =
					this.getQuickSwitchSelectionCount(right) -
					this.getQuickSwitchSelectionCount(left);
				if (countDiff !== 0) {
					return countDiff;
				}
				return left.primaryText.localeCompare(right.primaryText);
			})) {
			if (trimmedEntries.length >= maxItems) {
				break;
			}
			if (entry.kind === "quickCommand") {
				if (
					quickCommandCount >=
					SearchHistoryService.QUICK_SWITCH_QUICK_COMMAND_LIMIT
				) {
					continue;
				}
				quickCommandCount += 1;
			}
			trimmedEntries.push(entry);
		}

		return trimmedEntries.map((entry) => ({
			...entry,
			recentDateKeys:
				entry.recentDateKeys && entry.recentDateKeys.length > 0
					? entry.recentDateKeys
					: undefined,
			secondaryText:
				entry.secondaryText && entry.secondaryText.length > 0
					? entry.secondaryText
					: undefined,
			queries:
				entry.queries && entry.queries.length > 0 ? entry.queries : undefined,
		}));
	}

	private trimQuickSwitchQueries(
		entries: QuickSwitchHistoryQueryEntry[],
	): QuickSwitchHistoryQueryEntry[] {
		const dedupedEntries = new Map<string, QuickSwitchHistoryQueryEntry>();
		for (const entry of this.sanitizeQuickSwitchQueryEntries(entries)) {
			const normalizedQuery = this.normalizeNavigationQuery(entry.queryText);
			if (normalizedQuery.length === 0) {
				continue;
			}
			const prevEntry = dedupedEntries.get(normalizedQuery);
			if (!prevEntry) {
				dedupedEntries.set(normalizedQuery, { ...entry });
				continue;
			}
			prevEntry.queryText =
				entry.timestamp >= prevEntry.timestamp
					? entry.queryText
					: prevEntry.queryText;
			prevEntry.timestamp = Math.max(prevEntry.timestamp, entry.timestamp);
			prevEntry.count =
				this.getQuickSwitchQueryCount(prevEntry) +
				this.getQuickSwitchQueryCount(entry);
		}

		return [...dedupedEntries.values()]
			.sort((left, right) => {
				if (left.timestamp !== right.timestamp) {
					return right.timestamp - left.timestamp;
				}
				return (
					this.getQuickSwitchQueryCount(right) -
					this.getQuickSwitchQueryCount(left)
				);
			})
			.slice(0, SearchHistoryService.QUICK_SWITCH_QUERY_LIMIT);
	}

	private updateQuickSwitchHabitEntry(
		entry: QuickSwitchHistoryEntry,
		timestamp: number,
	): void {
		const nextDateKey = this.toDateKey(timestamp);
		const previousDateKey = this.getQuickSwitchLastDateKey(entry);
		entry.count = this.getQuickSwitchSelectionCount(entry) + 1;
		entry.lastDateKey = nextDateKey;
		entry.recentDateKeys = this.mergeNavigationRecentDateKeys(
			[nextDateKey],
			this.getQuickSwitchRecentDateKeys(entry),
		);
		entry.dayStreak = this.getNextNavigationDayStreak(
			previousDateKey,
			nextDateKey,
			this.getQuickSwitchDayStreak(entry),
		);
	}

	private updateQuickSwitchQueryEntry(
		entry: QuickSwitchHistoryEntry,
		queryText: string,
		timestamp: number,
	): void {
		const normalizedQuery = this.normalizeNavigationQuery(queryText);
		if (normalizedQuery.length === 0) {
			return;
		}

		const queries = [...(entry.queries ?? [])];
		const existingQuery = queries.find(
			(candidate) =>
				this.normalizeNavigationQuery(candidate.queryText) === normalizedQuery,
		);
		if (existingQuery) {
			existingQuery.queryText = queryText.trim();
			existingQuery.timestamp = timestamp;
			existingQuery.count = this.getQuickSwitchQueryCount(existingQuery) + 1;
		} else {
			queries.push({
				queryText: queryText.trim(),
				timestamp,
				count: 1,
			});
		}
		entry.queries = this.trimQuickSwitchQueries(queries);
	}

	private sanitizeNavigationRecentDateKeys(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}
		return this.mergeNavigationRecentDateKeys(
			value.filter((item): item is string => typeof item === "string"),
			[],
		);
	}

	private mergeNavigationRecentDateKeys(left: string[], right: string[]): string[] {
		const uniqueDateKeys = new Set<string>();
		for (const dateKey of [...left, ...right]) {
			if (this.isDateKey(dateKey)) {
				uniqueDateKeys.add(dateKey);
			}
		}
		return [...uniqueDateKeys]
			.sort((a, b) => b.localeCompare(a))
			.slice(0, SearchHistoryService.NAVIGATION_RECENT_DAY_LIMIT);
	}

	private getRecentNavigationDayCount(dateKeys: string[]): number {
		const todayDateKey = this.toDateKey(Date.now());
		let count = 0;
		for (const dateKey of dateKeys) {
			const dayDiff = this.getDateKeyDiffDays(dateKey, todayDateKey);
			if (
				Number.isFinite(dayDiff) &&
				dayDiff >= 0 &&
				dayDiff < SearchHistoryService.NAVIGATION_RECENT_DAY_LIMIT
			) {
				count += 1;
			}
		}
		return count;
	}

	private getQuickSwitchSelectionCount(entry: QuickSwitchHistoryEntry): number {
		return this.getSafePositiveInteger(entry.count, entry.timestamp > 0 ? 1 : 0);
	}

	private getQuickSwitchRecentDateKeys(entry: QuickSwitchHistoryEntry): string[] {
		const sanitizedDateKeys = this.sanitizeNavigationRecentDateKeys(
			entry.recentDateKeys,
		);
		if (sanitizedDateKeys.length > 0) {
			return sanitizedDateKeys;
		}
		const fallbackDateKey = this.getQuickSwitchLastDateKey(entry);
		return fallbackDateKey ? [fallbackDateKey] : [];
	}

	private getQuickSwitchLastDateKey(entry: QuickSwitchHistoryEntry): string | null {
		if (this.isDateKey(entry.lastDateKey)) {
			return entry.lastDateKey;
		}
		return entry.timestamp > 0 ? this.toDateKey(entry.timestamp) : null;
	}

	private getQuickSwitchDayStreak(entry: QuickSwitchHistoryEntry): number {
		return this.getSafePositiveInteger(entry.dayStreak, entry.timestamp > 0 ? 1 : 0);
	}

	private getQuickSwitchQueryCount(entry: QuickSwitchHistoryQueryEntry): number {
		return this.getSafePositiveInteger(entry.count, 1);
	}

	private getQuickSwitchQueryEntry(
		entry: QuickSwitchHistoryEntry,
		normalizedQuery: string,
	): QuickSwitchHistoryQueryEntry | null {
		for (const queryEntry of entry.queries ?? []) {
			if (this.normalizeNavigationQuery(queryEntry.queryText) === normalizedQuery) {
				return queryEntry;
			}
		}
		return null;
	}

	private getLatestQuickSwitchQueryText(entry: QuickSwitchHistoryEntry): string {
		let latestQueryEntry: QuickSwitchHistoryQueryEntry | null = null;
		for (const queryEntry of entry.queries ?? []) {
			if (!latestQueryEntry || queryEntry.timestamp > latestQueryEntry.timestamp) {
				latestQueryEntry = queryEntry;
			}
		}
		return latestQueryEntry?.queryText ?? "";
	}

	private cloneQuickSwitchEntry(
		entry: QuickSwitchHistoryEntry,
	): QuickSwitchHistoryEntry {
		return {
			...entry,
			recentDateKeys: [...(entry.recentDateKeys ?? [])],
			queries: (entry.queries ?? []).map((queryEntry) => ({ ...queryEntry })),
		};
	}

	private toRecentNavigationSelection(
		entry: QuickSwitchHistoryEntry,
	): RecentNavigationSelection {
		return {
			queryText: this.getLatestQuickSwitchQueryText(entry),
			path: entry.path,
			openLinkText: entry.openLinkText,
			primaryText: entry.primaryText,
			secondaryText: entry.secondaryText,
			kind: entry.kind,
			timestamp: entry.timestamp,
		};
	}

	private getNextNavigationDayStreak(
		previousDateKey: string | null,
		nextDateKey: string,
		previousStreak: number,
	): number {
		if (!previousDateKey) {
			return 1;
		}
		if (previousDateKey === nextDateKey) {
			return Math.max(1, previousStreak);
		}
		const dayDiff = this.getDateKeyDiffDays(previousDateKey, nextDateKey);
		return dayDiff === 1 ? Math.max(1, previousStreak) + 1 : 1;
	}

	private getDateKeyDiffDays(previousDateKey: string, nextDateKey: string): number {
		const previousUtc = Date.parse(`${previousDateKey}T00:00:00Z`);
		const nextUtc = Date.parse(`${nextDateKey}T00:00:00Z`);
		if (!Number.isFinite(previousUtc) || !Number.isFinite(nextUtc)) {
			return Number.NaN;
		}
		return Math.round((nextUtc - previousUtc) / SearchHistoryService.DAY_MS);
	}

	private maxDateKey(left: string | null, right: string | null): string | null {
		if (!left) {
			return right;
		}
		if (!right) {
			return left;
		}
		return left >= right ? left : right;
	}

	private isDateKey(value: unknown): value is string {
		return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
	}

	private toDateKey(timestamp: number): string {
		const date = new Date(timestamp);
		const year = date.getFullYear();
		const month = `${date.getMonth() + 1}`.padStart(2, "0");
		const day = `${date.getDate()}`.padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	private normalizeNavigationQuery(queryText: string): string {
		const trimmedQuery = queryText.trimStart();
		if (/^[#^/>]/u.test(trimmedQuery)) {
			return this.normalizeQuery(trimmedQuery.slice(1));
		}
		return this.normalizeQuery(queryText);
	}

	private normalizeQuickSwitchTargetKey(openLinkText: string): string {
		return openLinkText.trim().toLocaleLowerCase();
	}

	private normalizeQuery(queryText: string): string {
		return queryText.trim().toLocaleLowerCase();
	}

	private getSafePositiveInteger(value: unknown, fallback: number): number {
		if (typeof value === "number" && value > 0) {
			return Math.floor(value);
		}
		return fallback;
	}

	private createIndexedEntry(entry: SearchHistoryEntry): IndexedSearchHistoryEntry {
		const normalizedQueryText = this.normalizeQuery(entry.queryText);
		return {
			entry,
			normalizedQueryText,
			textIndex: createLightweightFuzzyIndex(entry.queryText),
			latestInteractionTimestamp: this.getLatestInteractionTimestamp(entry),
			combinedUsageCount: this.getCombinedUsageCount(entry),
		};
	}

	private createHistoryScoreContext(
		entries: IndexedSearchHistoryEntry[],
	): HistoryScoreContext {
		return {
			maxCombinedUsageCount:
				this.maxCombinedUsageCountCache ??
				(this.maxCombinedUsageCountCache = Math.max(
					1,
					...entries.map((entry) => Math.max(1, entry.combinedUsageCount)),
				)),
			now: Date.now(),
		};
	}

	private getHistoryPriorityScore(
		entry: IndexedSearchHistoryEntry,
		context: HistoryScoreContext,
	): number {
		const countScore =
			Math.log1p(Math.max(1, entry.combinedUsageCount)) /
			Math.log1p(context.maxCombinedUsageCount);
		const ageMs = Math.max(0, context.now - entry.latestInteractionTimestamp);
		const recencyScore = Math.exp(
			-ageMs / SearchHistoryService.RECENCY_HALF_LIFE_MS,
		);
		return recencyScore * 0.58 + countScore * 0.42;
	}

	private matchCandidateQuery(
		queryText: ReturnType<typeof prepareLightweightFuzzyQuery>,
		entry: IndexedSearchHistoryEntry,
	) {
		return matchLightweightFuzzy(queryText, entry.textIndex);
	}

	private insertTopSuggestion(
		suggestions: SearchHistorySuggestion[],
		suggestion: SearchHistorySuggestion,
		limit: number,
	) {
		let insertIndex = 0;
		while (
			insertIndex < suggestions.length &&
			!this.isSuggestionBetter(suggestion, suggestions[insertIndex])
		) {
			insertIndex++;
		}

		if (insertIndex >= limit) {
			return;
		}

		suggestions.splice(insertIndex, 0, suggestion);
		if (suggestions.length > limit) {
			suggestions.pop();
		}
	}

	private isSuggestionBetter(
		left: SearchHistorySuggestion,
		right: SearchHistorySuggestion,
	): boolean {
		if (left.compositeScore !== right.compositeScore) {
			return left.compositeScore > right.compositeScore;
		}
		if (left.historyScore !== right.historyScore) {
			return left.historyScore > right.historyScore;
		}
		if (left.timestamp !== right.timestamp) {
			return left.timestamp > right.timestamp;
		}
		return (left.count ?? 1) > (right.count ?? 1);
	}

	private invalidateQueryEntriesCache(): void {
		this.indexedEntriesCache = null;
		this.maxCombinedUsageCountCache = null;
	}

	private invalidateQuickSwitchEntriesCache(): void {
		this.quickSwitchNavigationEntriesCache = null;
		this.quickSwitchQuickCommandEntriesCache = null;
	}

	private getLatestInteractionTimestamp(entry: SearchHistoryEntry): number {
		return Math.max(entry.timestamp, entry.selectionTimestamp ?? 0);
	}

	private getCombinedUsageCount(entry: SearchHistoryEntry): number {
		return (entry.count ?? 1) + (entry.selectionCount ?? 0) * 1.25;
	}
}

const SEARCH_HISTORY_NAVIGATION_KINDS = new Set<SearchHistoryNavigationKind>([
	"file",
	"alias",
	"heading",
	"path",
	"recent",
	"quickCommand",
]);

function isSearchHistoryNavigationKind(
	value: unknown,
): value is SearchHistoryNavigationKind {
	return (
		typeof value === "string" &&
		SEARCH_HISTORY_NAVIGATION_KINDS.has(value as SearchHistoryNavigationKind)
	);
}

function normalizeSearchHistoryNavigationKind(
	value: unknown,
): SearchHistoryNavigationKind {
	return isSearchHistoryNavigationKind(value) ? value : "file";
}
