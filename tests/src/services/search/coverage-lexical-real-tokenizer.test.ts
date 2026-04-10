import { container } from "tsyringe";

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

jest.mock("src/integrations/languages/chinese-patch", () => ({
	ChinesePatch: class MockChinesePatch {},
}));

describe("coverage lexical with real tokenizer", () => {
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
		const { DEFAULT_OUTER_SETTING, OuterSetting } = require(
			"src/globals/plugin-setting",
		) as typeof import("src/globals/plugin-setting");
		const { AssetsProvider } = require(
			"src/utils/web/assets-provider",
		) as {
			AssetsProvider: new () => unknown;
		};
		const { ChinesePatch } = require(
			"src/integrations/languages/chinese-patch",
		) as {
			ChinesePatch: new () => unknown;
		};
		const setting: OuterSetting = {
			...DEFAULT_OUTER_SETTING,
			enableChinesePatch: false,
			enableStopWordsZh: false,
			enableStopWordsEn: true,
		};
		container.registerInstance(OuterSetting, setting);
		container.registerInstance(AssetsProvider, {
			assets: {
				stopWordsZh: new Set<string>(),
				stopWordsEn: new Set<string>(),
				jiebaBinary: Promise.resolve(null),
			},
		} as unknown as AssetsProvider);
		container.registerInstance(ChinesePatch, {
			cut: () => [],
		} as unknown as ChinesePatch);
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("three-character ASCII query can reach basename password through assist prefix", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};
		const { Tokenizer } = require(
			"src/services/search/tokenizer",
		) as typeof import("src/services/search/tokenizer");

		const tokenizer = container.resolve(Tokenizer);
		expect(tokenizer.tokenizeSequence("pas", "search")).toEqual(["pas"]);

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "all_notes/test/unsorted/fix- cant push to github without password.md",
				basename: "fix- cant push to github without password",
				folder: "all_notes/test/unsorted",
				content: "credentials and access troubleshooting notes",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "pas",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results.map((result) => result.path)).toContain(
			"all_notes/test/unsorted/fix- cant push to github without password.md",
		);
	});

	test("prefix expansion stays reachable in mixed lexicons with symbol and Han terms", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/阿.md",
				basename: "阿",
				folder: "notes",
				content: "han token",
			},
			{
				path: "notes/中.md",
				basename: "中",
				folder: "notes",
				content: "han token",
			},
			{
				path: "notes/文.md",
				basename: "文",
				folder: "notes",
				content: "han token",
			},
			{
				path: "notes/测.md",
				basename: "测",
				folder: "notes",
				content: "han token",
			},
			{
				path: "notes/~tilde.md",
				basename: "~tilde",
				folder: "notes",
				content: "symbol token",
			},
			{
				path: "notes/fix- cant push to github without password.md",
				basename: "fix- cant push to github without password",
				folder: "notes",
				content: "credentials and access troubleshooting notes",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "pas",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results.map((result) => result.path)).toContain(
			"notes/fix- cant push to github without password.md",
		);
	});

	test("three-character ASCII query can reach folder headings and tags through metadata assist prefix", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/doc-folder.md",
				basename: "doc-folder",
				folder: "vault/secure-folder",
				content: "alpha body",
			},
			{
				path: "notes/doc-heading.md",
				basename: "doc-heading",
				folder: "vault/general",
				headings: "security checklist",
				content: "beta body",
			},
			{
				path: "notes/doc-tag.md",
				basename: "doc-tag",
				folder: "vault/general",
				tags: "securitytag",
				content: "gamma body",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "sec",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results.map((result) => result.path)).toEqual(
			expect.arrayContaining([
				"notes/doc-folder.md",
				"notes/doc-heading.md",
				"notes/doc-tag.md",
			]),
		);
	});

	test("semi-strong metadata assist outranks plain body prefix", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/password-note.md",
				basename: "Username Password Card Number",
				folder: "notes",
				content: "credentials reference",
			},
			{
				path: "notes/workspace.md",
				basename: "Workspace",
				folder: "notes",
				content: "passage reference",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "pass",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/password-note.md");
	});

	test("surface-form quality prefers natural metadata completion over noisy compound completion", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/password-note.md",
				basename: "password",
				folder: "notes",
				content: "reference",
			},
			{
				path: "notes/passage-first-note.md",
				basename: "passage-first",
				folder: "notes",
				content: "reference",
			},
			{
				path: "notes/passage-first-note.md",
				basename: "passage-first",
				folder: "notes",
				content: "reference",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "pass",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/password-note.md");
	});

	test("metadata field priority prefers basename prefix over folder prefix", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/security-basename.md",
				basename: "security handbook",
				folder: "vault/general",
				content: "reference",
			},
			{
				path: "notes/security-folder.md",
				basename: "workspace",
				folder: "vault/security-folder",
				content: "reference",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "sec",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/security-basename.md");
	});

	test("short Han basename identity outranks body single-character noise", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<Array<{ path: string }>>;
			};
		};
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/电子技术入门.md",
				basename: "电子技术入门",
				folder: "notes",
				headings: "电子技术入门",
				content: "基础电路与元件入门",
			},
			{
				path: "notes/读书笔记-游戏设计类.md",
				basename: "读书笔记-游戏设计类",
				folder: "notes",
				content:
					"电子游戏设计技巧和技能总结，包含多个技字相关片段与电子媒介讨论。",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "电子技",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/电子技术入门.md");
	});
});
