import { OuterSetting, type SearchHistoryEntry } from "src/globals/plugin-setting";
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
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private readonly setting = getInstance(OuterSetting);
	private indexedEntriesCache: IndexedSearchHistoryEntry[] | null = null;
	private maxCombinedUsageCountCache: number | null = null;

	isEnabled(): boolean {
		return this.setting.searchHistory.enabled;
	}

	getEntryCount(): number {
		return this.getEntries().length;
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
		this.invalidateEntriesCache();
		await this.plugin.saveData(this.setting);
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
		this.invalidateEntriesCache();
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
		this.invalidateEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	async clearHistory(): Promise<void> {
		this.setting.searchHistory.entries = [];
		this.invalidateEntriesCache();
		await this.plugin.saveData(this.setting);
	}

	private getEntries(): IndexedSearchHistoryEntry[] {
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

	private sanitizeEntries(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
		return entries
			.filter((entry) => typeof entry?.queryText === "string")
			.map((entry) => ({
				queryText: entry.queryText.trim(),
				timestamp:
					typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
				count:
					typeof entry.count === "number" && entry.count > 0
						? entry.count
						: 1,
				selectionCount:
					typeof entry.selectionCount === "number" && entry.selectionCount > 0
						? entry.selectionCount
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
		for (const entry of entries) {
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

	private normalizeQuery(queryText: string): string {
		return queryText.trim().toLocaleLowerCase();
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
		// The shared matcher only measures textual relevance.
		// History-specific ranking stays in this service via recency/frequency scores.
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

	private invalidateEntriesCache() {
		this.indexedEntriesCache = null;
		this.maxCombinedUsageCountCache = null;
	}

	private getLatestInteractionTimestamp(entry: SearchHistoryEntry): number {
		return Math.max(entry.timestamp, entry.selectionTimestamp ?? 0);
	}

	private getCombinedUsageCount(entry: SearchHistoryEntry): number {
		return (entry.count ?? 1) + (entry.selectionCount ?? 0) * 1.25;
	}
}
