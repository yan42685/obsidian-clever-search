import { createFileSearchQueryPlanner } from "src/services/search/file-search-query-planner";

describe("file search query planner", () => {
	test("promotes a metadata slug plus body evidence query to path_like", () => {
		const planner = createFileSearchQueryPlanner({
			rawQueryText: "tech-zh pod data",
			queryTerms: ["tech-zh", "tech", "zh", "pod", "data"],
			docCount: 60,
			termStats: [
				{
					index: 0,
					queryTerm: "tech-zh",
					matchedDocCount: 9,
					matchedMetadataDocCount: 9,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 1,
					queryTerm: "tech",
					matchedDocCount: 26,
					matchedMetadataDocCount: 26,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 2,
					queryTerm: "zh",
					matchedDocCount: 20,
					matchedMetadataDocCount: 20,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 3,
					queryTerm: "pod",
					matchedDocCount: 16,
					matchedMetadataDocCount: 10,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 4,
					queryTerm: "data",
					matchedDocCount: 17,
					matchedMetadataDocCount: 4,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
			],
		});

		expect(planner.queryKind).toBe("path_like");
		expect(planner.anchorTermIndexes.has(0)).toBe(true);
	});

	test("does not promote ordinary hyphenated prose queries to path_like", () => {
		const planner = createFileSearchQueryPlanner({
			rawQueryText: "warm-start recovery",
			queryTerms: ["warm-start", "warm", "start", "recovery"],
			docCount: 60,
			termStats: [
				{
					index: 0,
					queryTerm: "warm-start",
					matchedDocCount: 8,
					matchedMetadataDocCount: 3,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 1,
					queryTerm: "warm",
					matchedDocCount: 15,
					matchedMetadataDocCount: 4,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 2,
					queryTerm: "start",
					matchedDocCount: 20,
					matchedMetadataDocCount: 4,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
				{
					index: 3,
					queryTerm: "recovery",
					matchedDocCount: 10,
					matchedMetadataDocCount: 2,
					hasAnyMatch: true,
					hasExactMatch: true,
				},
			],
		});

		expect(planner.queryKind).toBe("mixed");
	});
});
