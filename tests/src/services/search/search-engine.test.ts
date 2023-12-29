// LexicalEngine.test.ts

import { LexicalEngine } from "src/services/search/search-engine";

describe("LexicalEngine", () => {
	let lexicalEngine: LexicalEngine;
	let findAllTermPositions: any;

	beforeEach(() => {
		lexicalEngine = new LexicalEngine();

		findAllTermPositions = (line: string, terms: string[]) => {
			return (lexicalEngine as any).findAllTermPositions(line, terms);
		};
	});

	describe("findAllTermPositions", () => {
		it("should find all positions of terms in a line", () => {
			const line = "This is a test line for testing findAllTermPositions";
			const terms = ["test", "line", "find"];
			const expectedPositions = new Set([
				10, 11, 12, 13, 15, 16, 17, 18, 24, 25, 26, 27, 32, 33, 34, 35,
			]);

			const positions = findAllTermPositions(line, terms);

			expect(positions).toEqual(expectedPositions);
		});

		it("should return empty set for no matches", () => {
			const line = "This line has no matches";
			const terms = ["xyz", "123"];

			const positions = findAllTermPositions(line, terms);

			expect(positions.size).toBe(0);
		});
	});

	// Additional tests for other methods will go here
});
