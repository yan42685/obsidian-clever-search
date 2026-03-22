import {
	buildHybridQueryProfile,
	buildSemanticQueryVariants,
	filterSemanticMatches,
	getHybridBm25ProbeLimit,
	mergeHybridRankings,
	reciprocalRankFuse,
	resolveHybridRecallBudget,
} from "src/services/search/hybrid/ranking";

describe("hybrid ranking", () => {
	test("filters out low-confidence semantic matches", () => {
		const filtered = filterSemanticMatches(
			[
				{ id: 1, score: 0.33 },
				{ id: 2, score: 0.27 },
				{ id: 3, score: 0.19 },
				{ id: 4, score: 0.11 },
			],
			0.18,
			0.08,
			10,
		);

		expect(filtered).toEqual([
			{ id: 1, score: 0.33 },
			{ id: 2, score: 0.27 },
		]);
	});

	test("hybrid recall budget is fixed at 10x30", () => {
		expect(getHybridBm25ProbeLimit()).toBe(10);
		expect(resolveHybridRecallBudget()).toEqual({
			bm25RecallLimit: 10,
			denseRecallLimit: 30,
		});
	});

	test("fixed hybrid profile still lets strong lexical hits win", () => {
		const profile = buildHybridQueryProfile();
		expect(profile.queryVariantLimit).toBe(2);
		expect(profile.searchEf).toBe(72);
		const merged = mergeHybridRankings(
			[
				{ id: 101, score: 12 },
				{ id: 202, score: 4 },
			],
			[
				{ id: 202, score: 0.41 },
				{ id: 101, score: 0.29 },
			],
			[],
			profile,
			10,
		);

		expect(merged[0]?.id).toBe(101);
		expect(merged[1]?.id).toBe(202);
	});

	test("semantic-only results still rank when lexical has no hits", () => {
		const profile = buildHybridQueryProfile();
		const merged = mergeHybridRankings(
			[],
			[
				{ id: 11, score: 0.52 },
				{ id: 22, score: 0.35 },
			],
			[
				{ id: 11, score: 0.33 },
				{ id: 22, score: 0.29 },
			],
			profile,
			10,
		);

		expect(merged.map((item) => item.id)).toEqual([11, 22]);
		expect(merged[0]?.score).toBeGreaterThan(merged[1]?.score ?? 0);
	});

	test("builds extra semantic query variants for long queries", () => {
		const variants = buildSemanticQueryVariants(
			"how to rotate aws access keys safely in production",
			["rotate", "aws", "access", "keys", "safely", "production"],
			3,
		);

		expect(variants).toHaveLength(3);
		expect(variants[0]?.weight).toBe(1);
		expect(variants[1]?.text).toContain("rotate aws access keys");
		expect(variants[2]?.weight).toBeLessThan(variants[1]?.weight ?? 1);
	});

	test("fuses lexical and dense small chunk rankings with RRF", () => {
		const fused = reciprocalRankFuse(
			[
				[
					{ id: 1, score: 10 },
					{ id: 2, score: 8 },
					{ id: 3, score: 6 },
				],
				[
					{ id: 2, score: 0.92 },
					{ id: 1, score: 0.88 },
					{ id: 4, score: 0.8 },
				],
			],
			10,
		);

		expect(fused.slice(0, 2).map((item) => item.id)).toEqual([1, 2]);
		expect(fused.some((item) => item.id === 4)).toBe(true);
	});
});
