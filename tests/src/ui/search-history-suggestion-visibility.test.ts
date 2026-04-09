import { shouldHideSingleRedundantSuggestion } from "src/ui/search-history-suggestion-visibility";

describe("search history suggestion visibility", () => {
	test("hides the dropdown when the only suggestion duplicates the ghost completion", () => {
		expect(
			shouldHideSingleRedundantSuggestion(
				[
					{
						queryText: "history search",
					} as any,
				],
				{
					queryText: "history search",
				} as any,
				false,
			),
		).toBe(true);
	});

	test("keeps the dropdown when the user manually opens suggestions", () => {
		expect(
			shouldHideSingleRedundantSuggestion(
				[
					{
						queryText: "history search",
					} as any,
				],
				{
					queryText: "history search",
				} as any,
				true,
			),
		).toBe(false);
	});

	test("keeps the dropdown when additional distinct suggestions remain", () => {
		expect(
			shouldHideSingleRedundantSuggestion(
				[
					{
						queryText: "history search",
					} as any,
					{
						queryText: "history helper",
					} as any,
				],
				{
					queryText: "history search",
				} as any,
				false,
			),
		).toBe(false);
	});
});
