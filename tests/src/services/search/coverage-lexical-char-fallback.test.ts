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

function createWholeHanTokenizer() {
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

function createNoHanTokenizer() {
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
			return Array.from(normalize(text).matchAll(/[a-z0-9_-]+/gu)).map((match) => ({
				token: match[0],
				start: match.index ?? 0,
				end: (match.index ?? 0) + match[0].length,
			}));
		},
	};
}

describe("coverage lexical char fallback", () => {
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
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("recovers a Han body hit when word tokenization keeps the whole sequence opaque", async () => {
		container.registerInstance(Tokenizer, createWholeHanTokenizer());
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/zh-config.md",
				basename: "zh-config.md",
				folder: "notes",
				content: "配置中心化可以减少重复配置并统一变更入口。",
			},
			{
				path: "notes/zh-noise.md",
				basename: "zh-noise.md",
				folder: "notes",
				content: "中心化方案讨论的是流程治理，不涉及配置入口。",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "配置中心",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("notes/zh-config.md");
	});

	test("uses a simplified tag fallback when the tokenizer drops Han tags entirely", async () => {
		container.registerInstance(Tokenizer, createNoHanTokenizer());
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/tag-exact.md",
				basename: "tag-exact.md",
				folder: "notes",
				tags: "配置中心",
				content: "latin only filler",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "配置中心",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("notes/tag-exact.md");
	});

	test("does not combine separate tags to fake one Han tag fallback hit", async () => {
		container.registerInstance(Tokenizer, createNoHanTokenizer());
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/tag-joined.md",
				basename: "tag-joined.md",
				folder: "notes",
				tags: "配置中心化",
				content: "latin only filler",
			},
			{
				path: "notes/tag-split.md",
				basename: "tag-split.md",
				folder: "notes",
				tags: "配置 中心化",
				content: "latin only filler",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "配置中心",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("notes/tag-joined.md");
		expect(results.some((result) => result.path === "notes/tag-split.md")).toBe(false);
	});

	test("prefers the file that covers the full Han segment over one that only covers its prefix", async () => {
		container.registerInstance(Tokenizer, createWholeHanTokenizer());
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/full-segment.md",
				basename: "full-segment.md",
				folder: "notes",
				content: "这位作者上面这个例子讲得更清楚。",
			},
			{
				path: "notes/prefix-only.md",
				basename: "prefix-only.md",
				folder: "notes",
				content: "这里只提到了上面，没有后面的那个字。",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "上面这",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("notes/full-segment.md");
	});
});
