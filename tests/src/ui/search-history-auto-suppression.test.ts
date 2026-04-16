import {
	shouldSuppressAutoGhostCompletionForQuery,
	shouldSuppressAutoSuggestionsForQuery,
} from "src/ui/search-history-auto-suppression";

describe("search history auto suppression", () => {
	test("keeps auto suggestions suppressed for a dismissed query until the text changes", () => {
		expect(
			shouldSuppressAutoSuggestionsForQuery(
				"history search",
				"",
				"history search",
			),
		).toBe(true);
		expect(
			shouldSuppressAutoSuggestionsForQuery(
				"history search next",
				"",
				"history search",
			),
		).toBe(false);
	});

	test("keeps both auto suggestions and ghost completion suppressed after accepting a suggestion", () => {
		expect(
			shouldSuppressAutoSuggestionsForQuery(
				"history search",
				"history search",
				"",
			),
		).toBe(true);
		expect(
			shouldSuppressAutoGhostCompletionForQuery(
				"history search",
				"history search",
			),
		).toBe(true);
		expect(
			shouldSuppressAutoGhostCompletionForQuery(
				"history search next",
				"history search",
			),
		).toBe(false);
	});
});