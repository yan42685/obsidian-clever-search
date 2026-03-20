import { OuterSetting, type SearchHistoryEntry } from "src/globals/plugin-setting";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class SearchHistoryService {
	private static readonly MAX_SUGGESTION_COUNT = 8;
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private readonly setting = getInstance(OuterSetting);

	isEnabled(): boolean {
		return this.setting.searchHistory.enabled;
	}

	getEntryCount(): number {
		return this.getEntries().length;
	}

	getSuggestions(
		prefix: string,
		limit = SearchHistoryService.MAX_SUGGESTION_COUNT,
	): SearchHistoryEntry[] {
		const normalizedPrefix = this.normalizeQuery(prefix);
		if (!this.isEnabled() || normalizedPrefix.length === 0) {
			return [];
		}

		return this.getEntries()
			.filter((entry) =>
				entry.queryText.toLocaleLowerCase().startsWith(normalizedPrefix),
			)
			.sort((left, right) => {
				const countDiff = (right.count ?? 1) - (left.count ?? 1);
				if (countDiff !== 0) {
					return countDiff;
				}
				return right.timestamp - left.timestamp;
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
		}

		const maxItems = this.setting.searchHistory.maxItems;
		this.setting.searchHistory.entries = [...dedupedEntries.values()]
			.sort((left, right) => {
				if (right.timestamp !== left.timestamp) {
					return right.timestamp - left.timestamp;
				}
				return (right.count ?? 1) - (left.count ?? 1);
			})
			.slice(0, maxItems);
	}

	private normalizeQuery(queryText: string): string {
		return queryText.trim().toLocaleLowerCase();
	}
}
