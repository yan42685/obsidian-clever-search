import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK,
	decodeCoverageLexicalBodyTokenColdDocument,
	packCoverageLexicalBodyTokenColdDocuments,
} from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-packing";

describe("coverage lexical body token cold packing", () => {
	test("packs multiple small documents into a shared block and decodes them losslessly", () => {
		let nextBlockCounter = 0;
		const packed = packCoverageLexicalBodyTokenColdDocuments(
			1,
			[
				{
					path: "notes/a.md",
					generation: 1,
					bodyTokens: ["alpha", "beta", "alpha"],
				},
				{
					path: "notes/b.md",
					generation: 2,
					bodyTokens: ["beta", "gamma"],
				},
			],
			123,
			() => `block-${nextBlockCounter++}`,
		);

		expect(packed.blockRows).toHaveLength(1);
		expect(packed.docRows).toHaveLength(2);
		expect(packed.blockRows[0]?.documentCount).toBe(2);
		expect(new Set(packed.docRows.map((row) => row.blockId))).toEqual(
			new Set(["block-0"]),
		);

		const firstDecoded = decodeCoverageLexicalBodyTokenColdDocument(
			packed.blockRows[0],
			packed.docRows[0],
		);
		const secondDecoded = decodeCoverageLexicalBodyTokenColdDocument(
			packed.blockRows[0],
			packed.docRows[1],
		);

		expect(firstDecoded).toEqual({
			path: "notes/a.md",
			generation: 1,
			bodyTokens: ["alpha", "beta", "alpha"],
		});
		expect(secondDecoded).toEqual({
			path: "notes/b.md",
			generation: 2,
			bodyTokens: ["beta", "gamma"],
		});
	});

	test("splits large batches into multiple blocks instead of growing one block forever", () => {
		let nextBlockCounter = 0;
		const documents = Array.from(
			{ length: COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK + 5 },
			(_, index) => ({
				path: `notes/${index}.md`,
				bodyTokens: [`token-${index}`],
			}),
		);

		const packed = packCoverageLexicalBodyTokenColdDocuments(
			1,
			documents,
			456,
			() => `block-${nextBlockCounter++}`,
		);

		expect(packed.blockRows.length).toBeGreaterThan(1);
		expect(
			packed.blockRows.every(
				(block) =>
					block.documentCount <=
					COVERAGE_LEXICAL_BODY_TOKEN_COLD_MAX_DOCS_PER_BLOCK,
			),
		).toBe(true);
		expect(packed.docRows).toHaveLength(documents.length);
	});
});
