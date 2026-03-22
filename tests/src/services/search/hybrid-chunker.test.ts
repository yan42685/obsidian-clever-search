import { SMALL_CHUNK_TARGET } from "src/services/search/hybrid/hybrid-types";
import {
	buildChunkEmbeddingInputs,
	chunkFile,
	createChunkContextBuilderFromOutline,
	estimateTokenCount,
} from "src/services/search/hybrid/chunker";
import type { RawChunk } from "src/services/search/hybrid/hybrid-types";

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

function extractContext(input: string, chunkText: string): string {
	return input.slice(0, input.length - chunkText.length).trim();
}

function createRawChunk(
	filePath: string,
	text: string,
	chunkText: string,
	startLine: number,
	startCol: number,
	endLine: number,
): RawChunk {
	const startOffset = text.indexOf(chunkText);
	if (startOffset < 0) {
		throw new Error(`chunk text not found: ${chunkText}`);
	}
	return {
		filePath,
		text: chunkText,
		startOffset,
		endOffset: startOffset + chunkText.length,
		startLine,
		startCol,
		endLine,
	};
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

	test("builds embedding inputs with basename and budgeted heading path without changing chunk text", () => {
		const text = [
			"# Plugin Index",
			"",
			"Short intro paragraph.",
			"",
			"## Calendar",
			"Use Full Calendar for weekly scheduling and event planning.",
			"",
			"### Advanced Views",
			"Timeline and agenda views help compare appointments.",
			"",
			"```md",
			"# ignored heading inside code block",
			"```",
			"",
			"## Dataview",
			"Query note properties as a table.",
		].join("\n");
		const chunks = [
			createRawChunk(
				"planning/full-calendar-notes.md",
				text,
				"Use Full Calendar for weekly scheduling and event planning.",
				5,
				0,
				5,
			),
			createRawChunk(
				"planning/full-calendar-notes.md",
				text,
				"Timeline and agenda views help compare appointments.",
				8,
				0,
				8,
			),
		];
		const embedInputs = buildChunkEmbeddingInputs(
			"planning/full-calendar-notes.md",
			text,
			chunks,
		);

		expect(embedInputs).toHaveLength(chunks.length);
		expect(embedInputs[0]).toContain("File: full-calendar-notes");
		expect(embedInputs[0]).toContain("Section: Plugin Index > Calendar");
		expect(embedInputs[1]).toContain(
			"Section: Plugin Index > Calendar > Advanced Views",
		);
		expect(embedInputs.some((input) => input.includes("ignored heading inside code block"))).toBe(false);
		expect(embedInputs[0].endsWith(chunks[0].text)).toBe(true);
	});

	test("prefers provided heading outline over local markdown parsing", () => {
		const text = [
			"# Wrong Title In Text",
			"",
			"Paragraph under the wrong visible heading.",
			"",
			"## Another Wrong Section",
			"Paragraph in second section.",
		].join("\n");
		const chunks = [
			createRawChunk(
				"planning/full-calendar-notes.md",
				text,
				"Paragraph under the wrong visible heading.",
				2,
				0,
				2,
			),
			createRawChunk(
				"planning/full-calendar-notes.md",
				text,
				"Paragraph in second section.",
				5,
				0,
				5,
			),
		];
		const outline = [
			{ line: 0, level: 1, title: "Plugin Index" },
			{ line: 4, level: 2, title: "Calendar" },
		];

		const embedInputs = buildChunkEmbeddingInputs(
			"planning/full-calendar-notes.md",
			text,
			chunks,
			outline,
		);

		expect(embedInputs[0]).toContain("Section: Plugin Index");
		expect(embedInputs[0]).not.toContain("Wrong Title In Text");
		expect(embedInputs[1]).toContain("Section: Plugin Index > Calendar");
		expect(embedInputs[1]).not.toContain("Another Wrong Section");
	});

	test("reuses provided heading outline to rebuild the same chunk context", () => {
		const text = [
			"# Plugin Index",
			"",
			"## Calendar",
			"Use Full Calendar for weekly scheduling and event planning.",
			"",
			"### Advanced Views",
			"Timeline and agenda views help compare appointments.",
		].join("\n");
		const chunk = createRawChunk(
			"planning/full-calendar-notes.md",
			text,
			"Timeline and agenda views help compare appointments.",
			6,
			0,
			6,
		);
		const outline = [
			{ line: 0, level: 1, title: "Plugin Index" },
			{ line: 2, level: 2, title: "Calendar" },
			{ line: 5, level: 3, title: "Advanced Views" },
		];

		const [embedInput] = buildChunkEmbeddingInputs(
			"planning/full-calendar-notes.md",
			text,
			[chunk],
			outline,
		);
		const buildContext = createChunkContextBuilderFromOutline(
			"planning/full-calendar-notes.md",
			text.split("\n").length,
			outline,
		);
		const context = buildContext(chunk.startLine);

		expect(embedInput).toBe(`${context}\n\n${chunk.text}`);
	});

	test("skips low-signal headings and keeps up to four nearest informative headings", () => {
		const text = [
			"# Welcome",
			"",
			"## Tasks",
			"",
			"### Project Atlas",
			"",
			"#### Calendar Integration",
			"",
			"##### Dense Retrieval",
			"Important chunk content.",
		].join("\n");
		const chunks = [
			createRawChunk(
				"planning/calendar-atlas.md",
				text,
				"Important chunk content.",
				9,
				0,
				9,
			),
		];

		const embedInputs = buildChunkEmbeddingInputs(
			"planning/calendar-atlas.md",
			text,
			chunks,
		);

		expect(embedInputs[0]).toContain("File: calendar-atlas");
		expect(embedInputs[0]).toContain(
			"Section: Project Atlas > Calendar Integration > Dense Retrieval",
		);
		expect(embedInputs[0]).not.toContain("Welcome");
		expect(embedInputs[0]).not.toContain("Tasks");
	});

	test("reserves basename budget and keeps embed context within fixed total budget", () => {
		const text = [
			"# Extremely Verbose Parent Heading About Weekly Planning Coordination",
			"",
			"## Another Very Long Section Heading About Dense Semantic Retrieval",
			"Chunk body that should stay untouched.",
		].join("\n");
		const chunkText = "Chunk body that should stay untouched.";
		const chunks = [
			createRawChunk(
				"planning/extremely-verbose-calendar-planning-notebook-reference.md",
				text,
				chunkText,
				3,
				0,
				3,
			),
		];

		const embedInputs = buildChunkEmbeddingInputs(
			"planning/extremely-verbose-calendar-planning-notebook-reference.md",
			text,
			chunks,
		);
		const context = extractContext(embedInputs[0], chunkText);

		expect(context).toContain("File: extremely-verbose-calen");
		expect(context).toContain("Section:");
		expect(estimateTokenCount(context)).toBeLessThanOrEqual(22.5);
		expect(embedInputs[0].endsWith(chunkText)).toBe(true);
	});
});
