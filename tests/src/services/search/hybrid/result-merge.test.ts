import {
	mergeHybridLexicalLaneDisplayCandidates,
} from "src/services/search/hybrid/lexical-lane/result-merge";
import type { HybridLexicalLaneDisplayCandidate } from "src/services/search/hybrid/lexical-lane/contracts";

function createDisplayCandidate(
	overrides: Partial<HybridLexicalLaneDisplayCandidate> = {},
): HybridLexicalLaneDisplayCandidate {
	return {
		filePath: "notes/example.md",
		basename: "example",
		headingChain: ["Section"],
		segmentText: "Section",
		startLine: 0,
		startCol: 0,
		endLine: 0,
		endCol: 10,
		score: 100,
		snippetText: "File: example\n\nabcdefghijklmnopqrstuvwxyz",
		snippetHtml: "File: example\n\nabcdefghijklmnopqrstuvwxyz",
		headerText: "File: example",
		bodyText: "abcdefghijklmnopqrstuvwxyz",
		highlightRanges: [{ start: 14, end: 17 }],
		bodyHighlightRanges: [{ start: 0, end: 3 }],
		coreStart: 0,
		coreEnd: 26,
		displayStart: 0,
		displayEnd: 26,
		bodyStart: 0,
		bodyEnd: 26,
		anchorOffset: 1,
		...overrides,
	};
}

describe("hybrid lexical lane result merge", () => {
	test("keeps suppress-only behavior by default", () => {
		const first = createDisplayCandidate({
			score: 120,
			bodyHighlightRanges: [{ start: 0, end: 6 }],
			highlightRanges: [{ start: 14, end: 20 }],
			anchorOffset: 4,
		});
		const second = createDisplayCandidate({
			score: 100,
			bodyStart: 0,
			bodyEnd: 24,
			displayStart: 0,
			displayEnd: 24,
			bodyHighlightRanges: [{ start: 0, end: 6 }],
			highlightRanges: [{ start: 14, end: 20 }],
			anchorOffset: 20,
		});

		const merged = mergeHybridLexicalLaneDisplayCandidates(
			[first, second],
			8,
		);

		expect(merged).toHaveLength(1);
		expect(merged[0].score).toBe(120);
	});

	test("trim-overlap keeps a candidate when the anchor sits outside the overlap", () => {
		const first = createDisplayCandidate({
			score: 120,
			bodyText: "abcdefghijklmnopqrstuvwxyz",
			bodyHighlightRanges: [
				{ start: 0, end: 4 },
				{ start: 6, end: 10 },
				{ start: 12, end: 16 },
				{ start: 18, end: 22 },
			],
			highlightRanges: [
				{ start: 14, end: 18 },
				{ start: 20, end: 24 },
				{ start: 26, end: 30 },
				{ start: 32, end: 36 },
			],
			anchorOffset: 4,
		});
		const second = createDisplayCandidate({
			score: 100,
			bodyText: "cdefghijklmnopqrstuvwxyz0123456789",
			snippetText: "File: example\n\ncdefghijklmnopqrstuvwxyz0123456789",
			snippetHtml: "File: example\n\ncdefghijklmnopqrstuvwxyz0123456789",
			bodyStart: 2,
			bodyEnd: 36,
			displayStart: 2,
			displayEnd: 36,
			bodyHighlightRanges: [
				{ start: 0, end: 4 },
				{ start: 6, end: 10 },
				{ start: 12, end: 16 },
				{ start: 18, end: 22 },
				{ start: 24, end: 30 },
			],
			highlightRanges: [
				{ start: 14, end: 18 },
				{ start: 20, end: 24 },
				{ start: 26, end: 30 },
				{ start: 32, end: 36 },
				{ start: 38, end: 44 },
			],
			anchorOffset: 30,
		});

		const merged = mergeHybridLexicalLaneDisplayCandidates(
			[first, second],
			8,
			{ mode: "trim-overlap" },
		);

		expect(merged).toHaveLength(2);
		expect(merged[1].bodyStart).toBe(26);
		expect(merged[1].bodyEnd).toBe(36);
		expect(merged[1].bodyText).toBe("0123456789");
		expect(merged[1].bodyHighlightRanges).toEqual([{ start: 0, end: 6 }]);
		expect(merged[1].snippetText).toContain("File: example");
		expect(merged[1].snippetText).toContain("0123456789");
	});
});
