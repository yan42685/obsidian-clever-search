import {
	BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD,
	BODY_FAMILY_SUPPORT_STANDALONE,
	extractDocumentFamilyOccurrences,
	splitBodyBlocks,
	splitBodyBlocksWithDocumentTokenizer,
	type V3DocumentTokenizer,
} from "src/services/search/coverage-lexical-v3/query";

function buildLongSentenceText(sentenceCount: number): string {
	return Array.from({ length: sentenceCount }, (_, index) =>
		`Sentence ${String(index + 1).padStart(4, "0")} ends here.`,
	).join(" ");
}

function extractSentenceNumbers(blockText: string): number[] {
	return [...blockText.matchAll(/sentence (\d{4}) ends here\./gu)].map((match) =>
		Number.parseInt(match[1], 10),
	);
}

describe("coverage lexical v3 query text", () => {
	test("splits long body text near sentence boundaries without overlapping chunks", () => {
		const blocks = splitBodyBlocks(buildLongSentenceText(120));

		expect(blocks.length).toBeGreaterThan(1);
		expect(blocks[0]?.normalizedText.endsWith(".")).toBe(true);
		for (let index = 1; index < blocks.length; index += 1) {
			const previousNumbers = extractSentenceNumbers(blocks[index - 1].normalizedText);
			const currentNumbers = extractSentenceNumbers(blocks[index].normalizedText);
			expect(previousNumbers.at(-1)).toBeLessThan(currentNumbers[0] ?? Number.POSITIVE_INFINITY);
		}
	});

	test("does not create micro blocks from short blank-line separated paragraphs under budget", () => {
		const blocks = splitBodyBlocks("alpha.\n\nbeta.\n\ngamma.");

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.normalizedText).toContain("alpha.");
		expect(blocks[0]?.normalizedText).toContain("beta.");
		expect(blocks[0]?.normalizedText).toContain("gamma.");
	});

	test("captures real exact and Han witness start offsets within a body block", () => {
		const tokenizer: V3DocumentTokenizer = (text) =>
			text === "\u641c\u7d22\u5f15\u64ce\u4f18\u5316" ? ["\u641c\u7d22", "\u7d22\u5f15", "\u5f15\u64ce", "\u641c\u7d22\u5f15\u64ce"] : [];
		const blocks = splitBodyBlocksWithDocumentTokenizer(
			"\u524d\u7f00 \u641c\u7d22\u5f15\u64ce\u4f18\u5316 \u540e\u7f00 \u751f\u547d\u529b",
			tokenizer,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.exactFamilyTexts).toEqual([
			"\u641c\u7d22",
			"\u641c\u7d22\u5f15\u64ce",
			"\u7d22\u5f15",
			"\u5f15\u64ce",
		]);
		expect(blocks[0]?.exactFamilyStartOffsets).toEqual([3, 3, 4, 5]);
		expect(blocks[0]?.hanWitnessTexts).toEqual([
			"\u524d\u7f00",
			"\u641c\u7d22\u5f15\u64ce\u4f18\u5316",
			"\u540e\u7f00",
			"\u751f\u547d\u529b",
		]);
		expect(blocks[0]?.hanWitnessStartOffsets).toEqual([0, 3, 10, 13]);
	});

	test("extracts URL/path fragments and camel-case subparts as latin family occurrences", () => {
		const occurrences = extractDocumentFamilyOccurrences(
			"https://www.maoken.com/freefonts/25387.html CorpSrcWinSong",
		);

		expect(occurrences).toEqual(
			expect.arrayContaining([
				{ text: "//www.maoken.com/freefonts/25387.html", startOffset: 6 },
				{ text: "freefonts", startOffset: 23 },
				{ text: "corpsrcwinsong", startOffset: 44 },
				{ text: "corp", startOffset: 44 },
				{ text: "src", startOffset: 48 },
				{ text: "win", startOffset: 51 },
				{ text: "song", startOffset: 54 },
			]),
		);
	});

	test("marks compound latin subwords without polluting standalone siblings", () => {
		const blocks = splitBodyBlocksWithDocumentTokenizer("prefer prefer-cache");

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.exactFamilyTexts).toEqual([
			"prefer",
			"prefer-cache",
			"prefer",
			"cache",
		]);
		expect(blocks[0]?.exactFamilySupportMasks).toEqual([
			BODY_FAMILY_SUPPORT_STANDALONE,
			BODY_FAMILY_SUPPORT_STANDALONE,
			BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD,
			BODY_FAMILY_SUPPORT_COMPOUND_SUBWORD,
		]);
	});
});
