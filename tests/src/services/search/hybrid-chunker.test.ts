import { SMALL_CHUNK_TARGET } from "src/services/search/hybrid/hybrid-types";
import {
	chunkFile,
	estimateTokenCount,
} from "src/services/search/hybrid/chunker";

function buildLongSingleLineText(sentenceCount: number): string {
	return Array.from({ length: sentenceCount }, (_, index) =>
		`Sentence ${String(index + 1).padStart(4, "0")} ends here. `,
	).join("");
}

function sharedOverlapText(left: string, right: string): string {
	const maxLength = Math.min(left.length, right.length);
	for (let length = maxLength; length > 0; length--) {
		if (left.slice(-length) === right.slice(0, length)) {
			return right.slice(0, length);
		}
	}
	return "";
}

describe("hybrid chunker", () => {
	test("estimates tokens with different weights for CJK and latin text", () => {
		expect(estimateTokenCount("\u4e2d\u6587ABCD")).toBeCloseTo(
			2 * 0.65 + 4 / 4,
			5,
		);
		expect(estimateTokenCount("A B C D")).toBeCloseTo(1, 5);
	});

	test("builds small chunks with sentence-aware overlap and start column tracking", () => {
		const text = buildLongSingleLineText(240);
		const { chunks } = chunkFile("demo.md", text);

		expect(chunks.length).toBeGreaterThan(2);
		expect(estimateTokenCount(chunks[0].text)).toBeLessThanOrEqual(
			SMALL_CHUNK_TARGET * 1.15 + 1,
		);

		const overlapText = sharedOverlapText(chunks[0].text, chunks[1].text);
		const overlapTokens = estimateTokenCount(overlapText);
		const overlapRatio = overlapTokens / SMALL_CHUNK_TARGET;
		expect(overlapRatio).toBeGreaterThanOrEqual(0.12);
		expect(overlapRatio).toBeLessThanOrEqual(0.2);
		expect(/[.\n]\s*$/.test(chunks[0].text)).toBe(true);
		expect(chunks[1].startLine).toBe(0);
		expect(chunks[1].startCol).toBeGreaterThan(0);

		const firstChunkLine = chunks[1].text.split("\n")[0];
		expect(
			text.slice(
				chunks[1].startCol,
				chunks[1].startCol + firstChunkLine.length,
			),
		).toBe(firstChunkLine);
	});
});
