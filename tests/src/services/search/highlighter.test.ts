import { Line } from "src/globals/search-types";
import { LineHighlighter } from "src/services/search/highlighter";
import { getInstance } from "src/utils/my-lib";

type TruncateType = "line" | "paragraph" | "subItem";
const lineHighlighter = getInstance(LineHighlighter);
// test private method
const getTruncatedContext = (
	lines: Line[],
	matchedRow: number,
	firstMatchedCol: number,
	truncateType: TruncateType,
): any => {
	return (lineHighlighter as any).getTruncatedContext(
		lines,
		matchedRow,
		firstMatchedCol,
		truncateType,
	);
};

describe("getTruncatedContext", () => {
	// Helper function to generate lines of text
	const generateLines = (count: number) => {
		return Array.from(
			{ length: count },
			(_, i) => new Line(`Line ${i + 1}`, i),
		);
	};

	test("Normal case with sufficient context", () => {
		const lines = generateLines(20); // 20 lines of context
		const matchedRow = 10;
		const firstMatchedCol = 5;
		const truncateType = "paragraph";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		expect(result.lines.length).toBeLessThanOrEqual(12);
		expect(result.lines[0].text).toContain("Line");
		expect(result.firstLineOffset).toBe(0);
	});

	test("Matched line at the start of the document", () => {
		const lines = generateLines(20);
		const matchedRow = 0; // First line of the document
		const firstMatchedCol = 5;
		const truncateType = "paragraph";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		expect(result.lines[0].row).toBe(0); // First line should be the first in the document
		expect(result.firstLineOffset).toBe(0);
	});

	// More tests to be provided in the next message...
});
