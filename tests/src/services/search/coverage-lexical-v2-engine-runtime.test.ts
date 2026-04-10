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

describe("coverage lexical v2 engine runtime path", () => {
	beforeEach(() => {
		process.env.COVERAGE_LEXICAL_RUNTIME_PATH = "v2";
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
		delete process.env.COVERAGE_LEXICAL_RUNTIME_PATH;
		delete process.env.COVERAGE_LEXICAL_V2_RUNTIME_EXPERIMENTAL;
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("searchFiles can route through the explicit V2 runtime path", async () => {
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

	test("explicit v1 runtime path overrides the legacy experimental alias", async () => {
		process.env.COVERAGE_LEXICAL_RUNTIME_PATH = "v1";
		process.env.COVERAGE_LEXICAL_V2_RUNTIME_EXPERIMENTAL = "1";
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
		const v2Spy = jest.spyOn(engine as any, "searchFilesWithCoverageLexicalV2Runtime");
		await engine.addDocuments([
			{
				path: "notes/ai-design.md",
				basename: "ai-design",
				folder: "notes",
				content: "ai exam design",
			},
		]);

		await engine.searchFiles({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(v2Spy).not.toHaveBeenCalled();
	});
});
