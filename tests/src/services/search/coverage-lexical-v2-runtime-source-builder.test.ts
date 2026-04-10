import {
	buildCoverageLexicalV2RuntimeSourceEntries,
} from "src/services/search/coverage-lexical-v2/runtime";

describe("coverage lexical v2 runtime source builder", () => {
	test("builds exact-match runtime source entries with body-local best-window evidence", () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(["ai", "exam"], [
			{
				docId: 7,
				path: "notes/ai-planning.md",
				fieldTerms: {
					basenameTerms: ["ai"],
					bodyTerms: ["ai", "exam", "design"],
				},
				bodyTokenSequence: ["design", "ai", "exam", "design"],
			},
			{
				docId: 8,
				path: "notes/exam-summary.md",
				fieldTerms: {
					bodyTerms: ["exam", "summary"],
				},
				bodyTokenSequence: ["exam", "summary"],
			},
		]);

		expect(entries).toEqual([
			{
				docId: 7,
				path: "notes/ai-planning.md",
				stableDeterministicKey: "notes/ai-planning.md",
				sourceKind: "metadata",
				matchedPrimaryUnits: [
					{
						normalizedText: "ai",
						surfaceGroupIndex: 0,
						surfaceKind: "latin",
						strongestField: "basename",
						corroboratedFields: ["body"],
						matchQuality: "exact",
					},
					{
						normalizedText: "exam",
						surfaceGroupIndex: 1,
						surfaceKind: "latin",
						strongestField: "body",
						corroboratedFields: [],
						matchQuality: "exact",
					},
				],
				bestWindow: {
					field: "body",
					matchedUnitKeys: ["0:ai", "1:exam"],
					windowWidth: 2,
					averageDistance: 1,
					preservesSurfaceOrder: true,
				},
			},
			{
				docId: 8,
				path: "notes/exam-summary.md",
				stableDeterministicKey: "notes/exam-summary.md",
				sourceKind: "body",
				matchedPrimaryUnits: [
					{
						normalizedText: "exam",
						surfaceGroupIndex: 1,
						surfaceKind: "latin",
						strongestField: "body",
						corroboratedFields: [],
						matchQuality: "exact",
					},
				],
				bestWindow: {
					field: "body",
					matchedUnitKeys: ["1:exam"],
					windowWidth: 1,
					averageDistance: 0,
					preservesSurfaceOrder: true,
				},
			},
		]);
	});

	test("prefers tighter heading-local exact windows over wider body-local windows", () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(["deploy", "check"], [
			{
				docId: 9,
				path: "notes/deploy-check.md",
				fieldTerms: {
					headingsTerms: ["deploy", "check"],
					bodyTerms: ["deploy", "check"],
				},
				headingsTokenSequence: ["deploy", "check"],
				bodyTokenSequence: ["deploy", "many", "prep", "steps", "check"],
			},
		]);

		expect(entries[0]).toMatchObject({
			docId: 9,
			bestWindow: {
				field: "headings",
				matchedUnitKeys: ["0:deploy", "1:check"],
				windowWidth: 2,
				averageDistance: 1,
				preservesSurfaceOrder: true,
			},
		});
	});

	test("derives latin exact prefix and fuzzy match quality without changing field priority", () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(
			["cache", "reset"],
			[
				{
					docId: 10,
					path: "notes/cache-reset.md",
					fieldTerms: {
						bodyTerms: ["cache", "reset"],
					},
					bodyTokenSequence: ["cache", "reset"],
				},
				{
					docId: 11,
					path: "notes/cached-reset.md",
					fieldTerms: {
						bodyTerms: ["cached", "reset"],
					},
					bodyTokenSequence: ["cached", "reset"],
				},
				{
					docId: 12,
					path: "notes/cace-reset.md",
					fieldTerms: {
						bodyTerms: ["cace", "reset"],
					},
					bodyTokenSequence: ["cace", "reset"],
				},
			],
			{
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.2,
			},
		);

		expect(entries.map((entry) => ({
			path: entry.path,
			qualities: entry.matchedPrimaryUnits?.map((unit) => unit.matchQuality),
		}))).toEqual([
			{
				path: "notes/cache-reset.md",
				qualities: ["exact", "exact"],
			},
			{
				path: "notes/cached-reset.md",
				qualities: ["prefix", "exact"],
			},
			{
				path: "notes/cace-reset.md",
				qualities: ["fuzzy", "exact"],
			},
		]);
	});

	test("keeps Han matching exact-only even when prefix and fuzzy are enabled", () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(
			["\u653f\u6cbb"],
			[
				{
					docId: 13,
					path: "notes/politics.md",
					fieldTerms: {
						bodyTerms: ["\u653f\u6cbb"],
					},
					bodyTokenSequence: ["\u653f\u6cbb"],
				},
				{
					docId: 14,
					path: "notes/politics-partial.md",
					fieldTerms: {
						bodyTerms: ["\u653f\u7b56"],
					},
					bodyTokenSequence: ["\u653f\u7b56"],
				},
			],
			{
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.2,
			},
		);

		expect(entries.map((entry) => entry.path)).toEqual(["notes/politics.md"]);
		expect(entries[0]?.matchedPrimaryUnits?.[0]?.matchQuality).toBe("exact");
	});
});
