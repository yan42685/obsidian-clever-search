import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function createSimpleCoverageTokenizer() {
	return {
		tokenize(text: string): string[] {
			return this.tokenizeSequence(text);
		},
		tokenizeSequence(text: string): string[] {
			return normalize(text).match(/[a-z0-9_-]+/gu) ?? [];
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			return Array.from(normalize(text).matchAll(/[a-z0-9_-]+/gu)).map(
				(match) => ({
					token: match[0],
					start: match.index ?? 0,
					end: (match.index ?? 0) + match[0].length,
				}),
			);
		},
	};
}

function createWholeHanCoverageTokenizer() {
	return {
		tokenize(text: string): string[] {
			return this.tokenizeSequence(text);
		},
		tokenizeSequence(text: string): string[] {
			return normalize(text).match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			return Array.from(normalize(text).matchAll(/[\p{Script=Han}]+|[a-z0-9_-]+/gu)).map(
				(match) => ({
					token: match[0],
					start: match.index ?? 0,
					end: (match.index ?? 0) + match[0].length,
				}),
			);
		},
	};
}

describe("coverage lexical v2 engine candidate-cascade path", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		container.registerInstance(Tokenizer, createSimpleCoverageTokenizer());
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

test("searchFiles routes through the independent V2 lexical engine", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/ai-design.md",
				basename: "ai",
				folder: "notes",
				content: "ai exam design",
			},
			{
				path: "notes/exam-summary.md",
				basename: "exam-summary",
				folder: "notes",
				content: "ai exam summary",
			},
			{
				path: "notes/study-plan.md",
				basename: "study-plan",
				folder: "notes",
				content: "exam plan",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("notes/ai-design.md");
		expect(results[0]?.matchedTerms).toEqual(["ai", "exam"]);
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	test("experimental v2 candidate-cascade path keeps latin exact above prefix above fuzzy on tied coverage", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/cache-reset.md",
				basename: "cache-reset",
				folder: "notes",
				content: "cache reset",
			},
			{
				path: "notes/cached-reset.md",
				basename: "cached-reset",
				folder: "notes",
				content: "cached reset",
			},
			{
				path: "notes/cace-reset.md",
				basename: "cace-reset",
				folder: "notes",
				content: "cace reset",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "cache reset",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.slice(0, 3).map((result) => result.path)).toEqual([
			"notes/cache-reset.md",
			"notes/cached-reset.md",
			"notes/cace-reset.md",
		]);
	});

	test("searchFiles recovers metadata and body Han hits even when the tokenizer drops Han query terms", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/win-song-metadata.md",
				basename: "关于赢宋的笔记",
				folder: "notes",
				content: "latin filler",
			},
			{
				path: "notes/win-song-body.md",
				basename: "misc",
				folder: "notes",
				content: "这里提到了赢宋这两个字",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "赢宋",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/win-song-metadata.md",
			"notes/win-song-body.md",
		]);
	});

	test("searchFiles recovers fragile-covered Han body hits when tokenizer keeps the whole Han query opaque", async () => {
		container.registerInstance(Tokenizer, createWholeHanCoverageTokenizer());
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/chairperson.md",
				basename: "misc",
				folder: "notes",
				content: "委员长大之后继续发言",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "委员长",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/chairperson.md",
		]);
	});

test("searchFiles keeps using the independent v2 candidate-cascade path without configuration switches", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/ai-design.md",
				basename: "ai-design",
				folder: "notes",
				content: "ai exam design",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/ai-design.md",
		]);
		expect(results[0]?.matchedTerms).toEqual(["ai", "exam"]);
	});
});
