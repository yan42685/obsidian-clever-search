export {};

const mockInstanceMap = new Map<any, any>();
let mockHybridEngine: any;
const mockNotices: Array<{ message: string; timeout?: number }> = [];

jest.mock("obsidian", () => ({
	App: class App {},
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn((token: any) => {
		if (!mockInstanceMap.has(token)) {
			throw new Error(`Missing test instance for token: ${token?.name ?? String(token)}`);
		}
		return mockInstanceMap.get(token);
	}),
	monitorDecorator: (
		_target: unknown,
		_propertyKey: string,
		descriptor: PropertyDescriptor,
	) => descriptor,
}));

jest.mock("throttle-debounce", () => ({
	throttle: (_ms: number, fn: (...args: any[]) => unknown) => fn,
}));

jest.mock("src/services/obsidian/transformed-api", () => ({
	MyNotice: class MyNotice {
		constructor(message: string, timeout?: number) {
			mockNotices.push({ message, timeout });
		}

		hide() {}
		setText() {}
	},
}));

jest.mock("src/services/obsidian/translations/locale-helper", () => ({
	t: (key: string) => key,
}));

jest.mock("src/globals/plugin-setting", () => ({
	OuterSetting: class OuterSetting {},
	DEFAULT_OUTER_SETTING: {
		ui: {
			maxItemResults: 10,
		},
	},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

jest.mock("src/services/search/lexical-engine", () => ({
	LexicalEngine: class LexicalEngine {},
}));

jest.mock("src/services/search/highlighter", () => ({
	LineHighlighter: class LineHighlighter {},
}));

jest.mock("src/services/obsidian/view-registry", () => ({
	ViewRegistry: class ViewRegistry {},
	ViewType: {
		MARKDOWN: "markdown",
	},
}));

jest.mock("src/services/obsidian/user-data/data-manager", () => ({
	DataManager: class DataManager {},
}));

jest.mock("src/services/search/hybrid/hybrid-engine", () => ({
	HybridEngine: jest.fn().mockImplementation(() => mockHybridEngine),
}));

describe("SearchService hybrid rerank fallback behavior", () => {
	beforeEach(() => {
		jest.resetModules();
		mockInstanceMap.clear();
		mockNotices.length = 0;
		mockHybridEngine = {
			isEnabled: jest.fn().mockReturnValue(true),
			isReady: jest.fn().mockReturnValue(true),
			getEffectiveResultCount: jest.fn().mockReturnValue(10),
			prepareRecall: jest.fn(),
			buildItemsFromPreparedRecall: jest.fn(),
			finalizePreparedRecall: jest.fn(),
		};
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
	});

	function createHarness() {
		const { App } = require("obsidian");
		const { OuterSetting } = require("src/globals/plugin-setting");
		const { DataProvider } = require("src/services/obsidian/user-data/data-provider");
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const { LineHighlighter } = require("src/services/search/highlighter");
		const { ViewRegistry } = require("src/services/obsidian/view-registry");
		const { DataManager } = require("src/services/obsidian/user-data/data-manager");
		const { SearchService } = require("src/services/obsidian/search-service");

		mockInstanceMap.set(App, {
			workspace: {
				getActiveFile: jest.fn(() => ({ path: "notes/current.md" })),
			},
		});
		mockInstanceMap.set(OuterSetting, {
			ui: {
				maxItemResults: 10,
			},
		});
		mockInstanceMap.set(DataProvider, {
			readPlainText: jest.fn(),
			readPlainTextLines: jest.fn(),
		});
		mockInstanceMap.set(LexicalEngine, {
			searchFiles: jest.fn().mockResolvedValue([]),
			searchLinesByFileItem: jest.fn().mockResolvedValue([]),
			matchLinesFuzzy: jest.fn().mockResolvedValue([]),
			getActiveFileSearchBackend: jest.fn().mockReturnValue("coverage-lexical"),
		});
		mockInstanceMap.set(LineHighlighter, {
			parse: jest.fn(),
		});
		mockInstanceMap.set(ViewRegistry, {
			viewTypeByPath: jest.fn(() => "markdown"),
		});
		mockInstanceMap.set(DataManager, {
			getLexicalAvailabilityState: jest.fn(() => ({
				bootstrap: "searchable",
				searchable: true,
				blockingNoticeKey: null,
			})),
			getHybridAvailabilityState: jest.fn(() => ({
				enabled: true,
				bootstrap: "searchable",
				query: "ready",
				reasons: [],
				prompt: {
					blockingNoticeKey: null,
					fallbackNoticeKey: null,
				},
			})),
			hasHybridFailedEmbeddings: jest.fn(() => false),
		});

		return new SearchService();
	}

	function configurePreparedFlow(finalNoticeKey: string | null = null) {
		const prepared = {
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: null,
			fallbackToLexicalSearch: false,
		};
		mockHybridEngine.prepareRecall.mockResolvedValue(prepared);
		mockHybridEngine.buildItemsFromPreparedRecall.mockReturnValue([{ id: "prepared-item" }]);
		mockHybridEngine.finalizePreparedRecall.mockResolvedValue({
			items: [{ id: "final-item" }],
			fallbackNoticeKey: finalNoticeKey,
			fallbackToLexicalSearch: false,
		});
	}

	test("keeps hybrid results and notice flow when finalize succeeds normally", async () => {
		configurePreparedFlow("hybridNotice.searchFallbackToLexical");
		const service = createHarness();

		const result = await service.searchInVaultHybrid("alpha");

		expect(mockHybridEngine.prepareRecall).toHaveBeenCalledWith("alpha", 10, undefined);
		expect(mockHybridEngine.finalizePreparedRecall).toHaveBeenCalledWith(
			expect.objectContaining({ query: "alpha" }),
			10,
			undefined,
		);
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridNotice.searchFallbackToLexical",
		]);
	});

	test("falls back to the normal lexical search path when finalize requests lexical fallback", async () => {
		configurePreparedFlow();
		const service = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		lexicalEngine.searchFiles.mockResolvedValue([
			{
				path: "notes/finalize-lexical.md",
				queryTerms: ["alpha"],
				matchedTerms: ["alpha"],
				score: 11,
				directSubItems: [],
				nativeSubItemsReady: true,
			},
		]);
		mockHybridEngine.finalizePreparedRecall.mockResolvedValue({
			items: [{ id: "stale-hybrid-item" }],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackToLexicalSearch: true,
		});

		const result = await service.searchInVaultHybrid("alpha");

		expect(mockHybridEngine.finalizePreparedRecall).toHaveBeenCalledWith(
			expect.objectContaining({ query: "alpha" }),
			10,
			undefined,
		);
		expect(lexicalEngine.searchFiles).toHaveBeenCalled();
		expect(result.items).toHaveLength(1);
		expect((result.items[0] as { path: string }).path).toBe("notes/finalize-lexical.md");
		expect(result.hybridFallbackNoticeKey).toBeNull();
		expect(mockNotices).toEqual([]);
	});

	test("falls back to the normal lexical search path when hybrid requests lexical fallback", async () => {
		mockHybridEngine.prepareRecall.mockResolvedValue({
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: null,
			fallbackToLexicalSearch: true,
		});
		const service = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		lexicalEngine.searchFiles.mockResolvedValue([
			{
				path: "notes/lexical.md",
				queryTerms: ["alpha"],
				matchedTerms: ["alpha"],
				score: 12,
				directSubItems: [],
				nativeSubItemsReady: true,
			},
		]);

		const result = await service.searchInVaultHybrid("alpha");

		expect(mockHybridEngine.prepareRecall).toHaveBeenCalledWith("alpha", 10, undefined);
		expect(mockHybridEngine.buildItemsFromPreparedRecall).not.toHaveBeenCalled();
		expect(mockHybridEngine.finalizePreparedRecall).not.toHaveBeenCalled();
		expect(lexicalEngine.searchFiles).toHaveBeenCalled();
		expect(result.items).toHaveLength(1);
		expect((result.items[0] as { path: string }).path).toBe("notes/lexical.md");
		expect(result.hybridFallbackNoticeKey).toBeNull();
	});

	test("falls back to the normal lexical search path when hybrid prepare throws", async () => {
		mockHybridEngine.prepareRecall.mockRejectedValue(new Error("prepare failed"));
		const service = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		lexicalEngine.searchFiles.mockResolvedValue([
			{
				path: "notes/recovery.md",
				queryTerms: ["alpha"],
				matchedTerms: ["alpha"],
				score: 7,
				directSubItems: [],
				nativeSubItemsReady: true,
			},
		]);

		const result = await service.searchInVaultHybrid("alpha");

		expect(mockHybridEngine.finalizePreparedRecall).not.toHaveBeenCalled();
		expect(lexicalEngine.searchFiles).toHaveBeenCalled();
		expect(result.items).toHaveLength(1);
		expect((result.items[0] as { path: string }).path).toBe("notes/recovery.md");
	});

	test("dedupes identical fallback notices across staged updates", () => {
		const service = createHarness();
		const { SearchResult } = require("src/globals/search-types");
		const preparedResult = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
			false,
		);
		const finalResult = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
			false,
		);

		service.notifyHybridFallback(preparedResult);
		service.notifyHybridFallback(finalResult);

		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridNotice.searchFallbackToLexical",
		]);
	});

	test("re-emits a fallback notice after the aggregated state clears", () => {
		const service = createHarness();
		const { SearchResult } = require("src/globals/search-types");
		const fallbackResult = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
			false,
		);
		const cleanResult = new SearchResult("notes/current.md", [], null, false);

		service.notifyHybridFallback(fallbackResult);
		service.notifyHybridFallback(cleanResult);
		service.notifyHybridFallback(fallbackResult);

		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridNotice.searchFallbackToLexical",
			"hybridNotice.searchFallbackToLexical",
		]);
	});

});

