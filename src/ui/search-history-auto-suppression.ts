export function shouldSuppressAutoSuggestionsForQuery(
	currentQuery: string,
	lastAcceptedQuery: string,
	lastDismissedSuggestionQuery: string,
): boolean {
	return (
		currentQuery === lastAcceptedQuery ||
		currentQuery === lastDismissedSuggestionQuery
	);
}

export function shouldSuppressAutoGhostCompletionForQuery(
	currentQuery: string,
	lastAcceptedQuery: string,
): boolean {
	return currentQuery === lastAcceptedQuery;
}