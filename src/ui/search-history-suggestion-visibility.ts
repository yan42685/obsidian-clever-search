import type { SearchHistoryEntry } from "src/globals/plugin-setting";
import type { SearchHistorySuggestion } from "src/services/obsidian/user-data/search-history-service";

function normalizeSuggestionQuery(query: string): string {
	return query.trim().toLocaleLowerCase();
}

export function shouldHideSingleRedundantSuggestion(
	suggestions: SearchHistorySuggestion[],
	ghostSuggestion: SearchHistoryEntry | null,
	manualSuggestionsOpen: boolean,
): boolean {
	if (manualSuggestionsOpen || !ghostSuggestion || suggestions.length !== 1) {
		return false;
	}

	return (
		normalizeSuggestionQuery(suggestions[0]?.queryText ?? "") ===
		normalizeSuggestionQuery(ghostSuggestion.queryText)
	);
}
