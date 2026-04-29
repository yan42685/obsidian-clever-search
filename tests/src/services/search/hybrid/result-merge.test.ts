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

	test("does not suppress overlapping same-path candidates from different snapshot generations", () => {
		const first = createDisplayCandidate({
			snapshotGeneration: 1,
			snapshotSource: "indexed",
			score: 120,
			bodyHighlightRanges: [{ start: 0, end: 6 }],
			highlightRanges: [{ start: 14, end: 20 }],
			anchorOffset: 4,
		});
		const second = createDisplayCandidate({
			snapshotGeneration: 2,
			snapshotSource: "indexed",
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

		expect(merged.map((candidate) => candidate.snapshotGeneration)).toEqual([
			1,
			2,
		]);
	});
});
