import { Line } from "src/globals/search-types";
import {
	LineHighlighter,
	type TruncateType,
} from "src/services/search/highlighter";
import { getInstance } from "src/utils/my-lib";

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
			// 40 chars per line
			(_, i) => new Line(`Line111111111111111111111111111111111111`, i),
		);
	};

	test("For line - sufficient context", () => {
		const lines = generateLines(20); // 20 lines of context
		const matchedRow = 10;
		const firstMatchedCol = 33;  
		const truncateType = "line";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		expect(result.lines.length).toBe(1);
		expect(result.lines[0].row).toBe(10);
		expect(result.firstLineStartCol).toBe(3);  // maxPreChars for line is 30 by default
	});

	test("For line - insufficient context", () => {
		const lines = generateLines(1); // 20 lines of context
		const matchedRow = 0;
		const firstMatchedCol = 5;
		const truncateType = "line";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		expect(result.lines.length).toBe(1);
		expect(result.lines[0].row).toBe(0);
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
		expect(result.firstLineStartCol).toBe(0);
	});

	test("Empty lines array", () => {
		const lines = generateLines(0); // Empty array of lines
		const matchedRow = 0;
		const firstMatchedCol = 0;
		const truncateType = "paragraph";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		expect(result.lines).toHaveLength(0);
		expect(result.firstLineStartCol).toBe(0);
	});

	test("Matched line at the end of the document", () => {
		const lines = generateLines(20);
		const matchedRow = 19; // Last line of the document
		const firstMatchedCol = 5;
		const truncateType = "paragraph";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		expect(result.lines[result.lines.length - 1].row).toBe(19);
	});

	test("Matched column at the end of the line", () => {
		const lines = generateLines(20);
		const matchedRow = 10;
		const firstMatchedCol = lines[10].text.length - 1; // End of the line
		const truncateType = "line";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);
		expect(result.lines.length).toBe(1);
	});

	test("Actual truncation at the start of the document", () => {
		const lines = generateLines(20);
		const matchedRow = 1; // Second line of the document
		const firstMatchedCol = 5;
		const truncateType = "paragraph";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		// Check if the first line is actually truncated
		expect(result.lines[0].row).toBe(matchedRow - 1);
	});

	test("Actual truncation at the end of the document", () => {
		const lines = Array.from(
			{ length: 10 },
			// 40 chars per line
			(_, i) =>
				new Line(
					"333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333",
					i,
				),
		);
		const matchedRow = 1; // Second last line of the document
		const firstMatchedCol = 0;
		const truncateType = "subItem";

		const result = getTruncatedContext(
			lines,
			matchedRow,
			firstMatchedCol,
			truncateType,
		);

		const lastLine = result.lines[result.lines.length - 1];
		// Check if the last line is actually truncated
		expect(lastLine.text.length).toBeLessThan(
			lines[lastLine.row].text.length,
		);
	});
});
