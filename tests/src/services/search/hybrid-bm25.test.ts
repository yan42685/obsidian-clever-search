import { container } from "tsyringe";
import { BM25Engine } from "src/services/search/hybrid/bm25";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

function createMockTokenizer(): MockTokenizer {
	return {
		tokenize(text: string): string[] {
			return text
				.split(/[^A-Za-z0-9_-]+/g)
				.map((term) => term.trim())
				.filter((term) => term.length > 0);
		},
		tokenizeSequence(text: string): string[] {
			return text
				.split(/[^A-Za-z0-9_-]+/g)
				.map((term) => term.trim())
				.filter((term) => term.length > 0);
		},
	};
}

describe("hybrid BM25 query expansion", () => {
	beforeEach(() => {
		container.clearInstances();
		container.registerInstance(Tokenizer, createMockTokenizer() as InstanceType<typeof Tokenizer>);
	});

	test("matches case-folded query terms without requiring exact casing", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "calendar event schedule");
		bm25.addDocument(2, "kanban lane cards");

		const results = bm25.search("Calendar", 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("exact search does not depend on building the expansion lexicon first", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "markdown export flow");
		bm25.addDocument(2, "kanban lane cards");

		const results = bm25.search("MARKDOWN", 5, {
			useProximity: false,
			enableQueryExpansion: false,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("expands prefix queries for longer hybrid entity terms", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "calendar event schedule");
		bm25.addDocument(2, "kanban lane cards");

		const results = bm25.search("calend", 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("recovers a single-typo hybrid entity query with fuzzy expansion", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "dataview inline fields metadata");
		bm25.addDocument(2, "calendar event schedule");

		const results = bm25.search("dateview", 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("keeps only the highest scoring topK matches without sorting the full tail", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "alpha alpha alpha alpha");
		bm25.addDocument(2, "alpha alpha alpha");
		bm25.addDocument(3, "alpha alpha");
		bm25.addDocument(4, "alpha");
		bm25.addDocument(5, "beta");

		const results = bm25.search("alpha", 2, {
			useProximity: false,
			enableQueryExpansion: false,
		});

		expect(results.map((item) => item.docId)).toEqual([1, 2]);
	});
});
