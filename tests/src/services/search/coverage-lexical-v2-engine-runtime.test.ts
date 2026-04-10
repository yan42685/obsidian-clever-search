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

describe("coverage lexical v2 engine runtime path", () => {
	beforeEach(() => {
		process.env.COVERAGE_LEXICAL_V2_RUNTIME_EXPERIMENTAL = "1";
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
		delete process.env.COVERAGE_LEXICAL_V2_RUNTIME_EXPERIMENTAL;
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		jest.resetModules();
	});

	test("searchFiles can route through the experimental V2 runtime path", async () => {
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
				path: "notes/AI提供数值策划设计.md",
				basename: "AI提供数值策划设计",
				folder: "notes",
				content: "AI 省考 设计",
			},
			{
				path: "notes/省考总结.md",
				basename: "省考总结",
				folder: "notes",
				content: "AI 省考 总结",
			},
			{
				path: "notes/备考规划.md",
				basename: "备考规划",
				folder: "notes",
				content: "省考 规划",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "AI 省考",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/AI提供数值策划设计.md",
			"notes/省考总结.md",
			"notes/备考规划.md",
		]);
		expect(results[0]?.matchedTerms).toEqual(["ai", "省考"]);
	});
});
