import { splitBodyBlocks } from "src/services/search/coverage-lexical-v3/query";

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
});
