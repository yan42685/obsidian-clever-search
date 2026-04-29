import { EngineType } from "src/globals/search-types";
import type { HybridLexicalLaneDisplayCandidate } from "src/services/search/hybrid/lexical-lane/contracts";
import { buildHybridLexicalLaneFileItems } from "src/services/search/hybrid/lexical-lane/result-mapper";

function createDisplayCandidate(
	overrides: Partial<HybridLexicalLaneDisplayCandidate> = {},
): HybridLexicalLaneDisplayCandidate {
	return {
		filePath: "notes/a.md",
		basename: "a",
		headingChain: [],
		segmentText: "",
		startLine: 0,
		startCol: 0,
		endLine: 0,
		endCol: 10,
		score: 100,
		snippetText: "cache restore",
		snippetHtml: "cache <mark>restore</mark>",
		headerText: "",
		bodyText: "cache restore",
		highlightRanges: [{ start: 6, end: 13 }],
		bodyHighlightRanges: [{ start: 6, end: 13 }],
		coreStart: 0,
		coreEnd: 13,
		displayStart: 0,
		displayEnd: 13,
		bodyStart: 0,
		bodyEnd: 13,
		anchorOffset: 0,
		...overrides,
	};
}

describe("hybrid lexical lane result mapper", () => {
	test("keeps top three files with at most two subitems each", () => {
		const candidates = [
			createDisplayCandidate({ filePath: "notes/a.md", score: 100 }),
			createDisplayCandidate({ filePath: "notes/a.md", score: 90 }),
			createDisplayCandidate({ filePath: "notes/a.md", score: 80 }),
			createDisplayCandidate({ filePath: "notes/b.md", score: 70 }),
			createDisplayCandidate({ filePath: "notes/b.md", score: 60 }),
			createDisplayCandidate({ filePath: "notes/c.md", score: 50 }),
			createDisplayCandidate({ filePath: "notes/d.md", score: 40 }),
		];

		const items = buildHybridLexicalLaneFileItems("cache restore", candidates);

		expect(items.map((item) => item.path)).toEqual([
			"notes/a.md",
			"notes/b.md",
			"notes/c.md",
		]);
		expect(items.map((item) => item.subItems.length)).toEqual([2, 2, 1]);
		expect(items.every((item) => item.engineType === EngineType.HYBRID)).toBe(true);
	});

	test("propagates shadow snapshot freshness to file items", () => {
		const items = buildHybridLexicalLaneFileItems("cache restore", [
			createDisplayCandidate({
				filePath: "notes/shadow.md",
				snapshotGeneration: 7,
				snapshotSource: "shadow",
			}),
		]);

		expect(items).toHaveLength(1);
		expect(items[0].nativeSubItemsReady).toBe(true);
		expect(items[0].snapshotGeneration).toBe(7);
		expect(items[0].snapshotSource).toBe("shadow");
		expect(items[0].freshnessState).toBe("stale_grace");
		expect(items[0].freshnessReason).toBe("embedding_updating");
	});

	test("does not merge same-path candidates from different snapshot generations", () => {
		const items = buildHybridLexicalLaneFileItems("cache restore", [
			createDisplayCandidate({
				filePath: "notes/recovered.md",
				snapshotGeneration: 1,
				snapshotSource: "indexed",
				score: 100,
				snippetText: "old cache restore",
			}),
			createDisplayCandidate({
				filePath: "notes/recovered.md",
				snapshotGeneration: 2,
				snapshotSource: "indexed",
				score: 90,
				snippetText: "new cache restore",
			}),
		]);

		expect(items).toHaveLength(2);
		expect(items.map((item) => item.path)).toEqual([
			"notes/recovered.md",
			"notes/recovered.md",
		]);
		expect(items.map((item) => item.snapshotGeneration)).toEqual([1, 2]);
		expect(items.map((item) => item.subItems[0].snippetText)).toEqual([
			"old cache restore",
			"new cache restore",
		]);
	});
});
