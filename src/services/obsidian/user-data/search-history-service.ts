import { Fzf } from "fzf";
import { OuterSetting, type SearchHistoryEntry } from "src/globals/plugin-setting";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

export type SearchHistorySuggestion = SearchHistoryEntry & {
	positions: number[];
	fuzzyScore: number;
	historyScore: number;
	compositeScore: number;
};

@singleton()
export class SearchHistoryService {
	private static readonly MAX_SUGGESTION_COUNT = 40;
	private static readonly RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 14;
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private readonly setting = getInstance(OuterSetting);

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
			(candidate) => this.normalizeQuery(candidate.queryText) === normalizedQuery,
		);
		if (!entry) {
			return;
		}

		entry.selectionCount = (entry.selectionCount ?? 0) + 1;
		entry.selectionTimestamp = Date.now();
		this.trimEntries(this.setting.searchHistory.entries);
		await this.plugin.saveData(this.setting);
	}

	getGhostSuggestion(prefix: string): SearchHistoryEntry | null {
		const normalizedPrefix = this.normalizeQuery(prefix);
		if (!this.isEnabled() || normalizedPrefix.length === 0) {
			return null;
		}

		return this.getEntries()
			.filter((entry) => {
				const normalizedQuery = this.normalizeQuery(entry.queryText);
				return (
					normalizedQuery !== normalizedPrefix &&
					normalizedQuery.startsWith(normalizedPrefix)
				);
			})
			.sort((left, right) => {
				const historyDiff =
					this.getHistoryPriorityScore(right) -
					this.getHistoryPriorityScore(left);
				if (historyDiff !== 0) {
					return historyDiff;
				}
				return right.queryText.localeCompare(left.queryText);
			})[0] ?? null;
	}

	getCandidateSuggestions(
		query: string,
		limit = SearchHistoryService.MAX_SUGGESTION_COUNT,
	): SearchHistorySuggestion[] {
		const normalizedQuery = this.normalizeQuery(query);
		if (!this.isEnabled() || normalizedQuery.length === 0) {
			return [];
		}

		const entries = this.getEntries().filter(
			(entry) => this.normalizeQuery(entry.queryText) !== normalizedQuery,
		);
		if (entries.length === 0) {
			return [];
		}

		const fzf = new Fzf(entries, {
			selector: (entry) => entry.queryText,
			casing: "case-insensitive",
			fuzzy: "v2",
		});

		const rawResults = fzf.find(query);
		if (rawResults.length === 0) {
			return [];
		}

		const maxFuzzyScore = Math.max(...rawResults.map((result) => result.score), 1);

		return rawResults
			.map((result) => {
				const historyScore = this.getHistoryPriorityScore(result.item);
				const fuzzyScore = result.score / maxFuzzyScore;
				return {
					...result.item,
					positions: [...result.positions].sort((left, right) => left - right),
					fuzzyScore,
					historyScore,
					compositeScore: fuzzyScore * 0.74 + historyScore * 0.26,
				};
			})
			.sort((left, right) => {
				if (right.compositeScore !== left.compositeScore) {
					return right.compositeScore - left.compositeScore;
				}
				if (right.historyScore !== left.historyScore) {
					return right.historyScore - left.historyScore;
				}
				if (right.timestamp !== left.timestamp) {
					return right.timestamp - left.timestamp;
				}
				return (right.count ?? 1) - (left.count ?? 1);
			})
			.slice(0, limit);
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
			(entry) => entry.queryText.toLocaleLowerCase() === normalizedQuery,
		);
		if (existingEntry) {
			existingEntry.queryText = queryText.trim();
			existingEntry.timestamp = Date.now();
			existingEntry.count = (existingEntry.count ?? 1) + 1;
		} else {
			entries.push({
				queryText: queryText.trim(),
				timestamp: Date.now(),
				count: 1,
			});
		}

		this.trimEntries(entries);
		await this.plugin.saveData(this.setting);
	}

	async removeQuery(queryText: string): Promise<void> {
		const normalizedQuery = this.normalizeQuery(queryText);
		if (normalizedQuery.length === 0) {
			return;
		}

		this.setting.searchHistory.entries = this.getEntries().filter(
			(entry) => this.normalizeQuery(entry.queryText) !== normalizedQuery,
		);
		await this.plugin.saveData(this.setting);
	}

	async clearHistory(): Promise<void> {
		this.setting.searchHistory.entries = [];
		await this.plugin.saveData(this.setting);
	}

	private getEntries(): SearchHistoryEntry[] {
		const entries = this.setting.searchHistory.entries ?? [];
		this.setting.searchHistory.entries = entries
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
		this.trimEntries(this.setting.searchHistory.entries);
		return this.setting.searchHistory.entries;
	}

	private trimEntries(entries: SearchHistoryEntry[]) {
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
		this.setting.searchHistory.entries = [...dedupedEntries.values()]
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

	private getHistoryPriorityScore(entry: SearchHistoryEntry): number {
		const entries = this.setting.searchHistory.entries ?? [];
		const maxCount = Math.max(
			1,
			...entries.map((candidate) =>
				Math.max(1, this.getCombinedUsageCount(candidate)),
			),
		);
		const countScore =
			Math.log1p(Math.max(1, this.getCombinedUsageCount(entry))) /
			Math.log1p(maxCount);
		const ageMs = Math.max(
			0,
			Date.now() - this.getLatestInteractionTimestamp(entry),
		);
		const recencyScore = Math.exp(
			-ageMs / SearchHistoryService.RECENCY_HALF_LIFE_MS,
		);
		return recencyScore * 0.58 + countScore * 0.42;
	}

	private getLatestInteractionTimestamp(entry: SearchHistoryEntry): number {
		return Math.max(entry.timestamp, entry.selectionTimestamp ?? 0);
	}

	private getCombinedUsageCount(entry: SearchHistoryEntry): number {
		return (entry.count ?? 1) + (entry.selectionCount ?? 0) * 1.25;
	}
}
