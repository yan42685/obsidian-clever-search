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

describe("SearchService bootstrap gate", () => {
	beforeEach(() => {
		jest.resetModules();
		mockInstanceMap.clear();
		mockNotices.length = 0;
		mockHybridEngine = {
			isEnabled: jest.fn().mockReturnValue(false),
			canServeQuery: jest.fn().mockReturnValue(false),
			search: jest.fn().mockResolvedValue([]),
			consumeSearchFallbackNoticeKey: jest.fn().mockReturnValue(null),
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

	function createHarness(options: {
		searchable: boolean;
		hybridEnabled?: boolean;
		hybridCanServeQuery?: boolean;
		hybridUnavailable?: boolean;
		lexicalMatches?: any[];
		hybridItems?: any[];
		lexicalBackend?: "minisearch" | "coverage-lexical";
	}) {
		const { App } = require("obsidian");
		const { OuterSetting } = require("src/globals/plugin-setting");
		const { DataProvider } = require("src/services/obsidian/user-data/data-provider");
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const { LineHighlighter } = require("src/services/search/highlighter");
		const {
			ViewRegistry,
			ViewType,
		} = require("src/services/obsidian/view-registry");
		const { DataManager } = require("src/services/obsidian/user-data/data-manager");
		const {
			FileItem,
			EngineType,
		} = require("src/globals/search-types");

		const app = {
			workspace: {
				getActiveFile: jest.fn(() => ({ path: "notes/current.md" })),
			},
		};
		const setting = {
			ui: {
				maxItemResults: 10,
			},
		};
		const dataProvider = {
			readPlainText: jest.fn(),
			readPlainTextLines: jest.fn().mockResolvedValue(["alpha beta"]),
		};
		const lexicalEngine = {
			searchFiles: jest
				.fn()
				.mockResolvedValue(options.lexicalMatches ?? []),
			searchLinesByFileItem: jest.fn().mockResolvedValue([]),
			matchLinesFuzzy: jest.fn().mockResolvedValue([]),
			getActiveFileSearchBackend: jest
				.fn()
				.mockReturnValue(options.lexicalBackend ?? "minisearch"),
		};
		const lineHighlighter = {
			parse: jest.fn((lines: any[], matchedLine: any, truncateOption: any, isParagraph: boolean) =>
				isParagraph
					? { text: matchedLine?.text ?? lines?.[0]?.text ?? "" }
					: {
						text: matchedLine?.text ?? lines?.[0]?.text ?? "",
						row: matchedLine?.row ?? 0,
						col: 0,
					},
			),
		};
		const viewRegistry = {
			viewTypeByPath: jest.fn(() => ViewType.MARKDOWN),
		};
		const dataManager = {
			isSearchSearchable: jest.fn(() => options.searchable),
			getSearchBootstrapNoticeKey: jest.fn(() =>
				options.searchable ? null : "searchBootstrap.restoring",
			),
			isHybridSearchUnavailable: jest.fn(() => options.hybridUnavailable ?? false),
			hasHybridFailedEmbeddings: jest.fn(() => false),
		};

		mockHybridEngine.isEnabled.mockReturnValue(options.hybridEnabled ?? false);
		mockHybridEngine.canServeQuery.mockReturnValue(
			options.hybridCanServeQuery ?? options.hybridEnabled ?? false,
		);
		mockHybridEngine.search.mockResolvedValue(options.hybridItems ?? []);
		mockHybridEngine.consumeSearchFallbackNoticeKey.mockReturnValue(null);

		mockInstanceMap.set(App, app);
		mockInstanceMap.set(OuterSetting, setting);
		mockInstanceMap.set(DataProvider, dataProvider);
		mockInstanceMap.set(LexicalEngine, lexicalEngine);
		mockInstanceMap.set(LineHighlighter, lineHighlighter);
		mockInstanceMap.set(ViewRegistry, viewRegistry);
		mockInstanceMap.set(DataManager, dataManager);

		const { SearchService } = require("src/services/obsidian/search-service");
		const service = new SearchService();

		return {
			service,
			app,
			dataProvider,
			dataManager,
			lexicalEngine,
			FileItem,
			EngineType,
		};
	}

	test("blocks lexical and hybrid search before searchable, but keeps in-file search available", async () => {
		const { service, lexicalEngine, dataProvider } = createHarness({
			searchable: false,
			hybridEnabled: true,
		});

		const lexicalResult = await service.searchInVault("alpha");
		const hybridResult = await service.searchInVaultHybrid("alpha");
		const inFileResult = await service.searchInFile("alpha");

		expect(lexicalResult.items).toEqual([]);
		expect(hybridResult.items).toEqual([]);
		expect(lexicalEngine.searchFiles).not.toHaveBeenCalled();
		expect(mockHybridEngine.search).not.toHaveBeenCalled();
		expect(dataProvider.readPlainTextLines).toHaveBeenCalledWith("notes/current.md");
		expect(inFileResult.items).toHaveLength(0);
		expect(mockNotices.map((entry) => entry.message)).toContain(
			"searchBootstrap.restoring",
		);
	});

	test("delegates to lexical search after searchable", async () => {
		const { service, lexicalEngine, FileItem } = createHarness({
			searchable: true,
			lexicalMatches: [
				{
					path: "notes/alpha.md",
					queryTerms: ["alpha"],
					matchedTerms: ["alpha"],
					score: 1,
				},
			],
		});

		const result = await service.searchInVault("alpha");

		expect(lexicalEngine.searchFiles).toHaveBeenCalledWith("alpha", 22, 10, 60);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toBeInstanceOf(FileItem);
		expect((result.items[0] as any).path).toBe("notes/alpha.md");
	});

	test("does not rerank coverage lexical results through legacy line evidence", async () => {
		const { service, lexicalEngine } = createHarness({
			searchable: true,
			lexicalBackend: "coverage-lexical",
			lexicalMatches: [
				{
					path: "notes/alpha.md",
					queryTerms: ["alpha"],
					matchedTerms: ["alpha"],
					score: 1,
					nativeSubItemsReady: true,
					directSubItems: [],
				},
			],
		});

		const result = await service.searchInVault("alpha");

		expect(lexicalEngine.searchFiles).toHaveBeenCalledWith("alpha", 10, 10, 60);
		expect(lexicalEngine.searchLinesByFileItem).not.toHaveBeenCalled();
		expect(result.items).toHaveLength(1);
		expect((result.items[0] as any).path).toBe("notes/alpha.md");
	});

	test("delegates to hybrid search after searchable", async () => {
		const { service, EngineType, FileItem } = createHarness({
			searchable: true,
			hybridEnabled: true,
			hybridCanServeQuery: true,
			hybridItems: [],
		});
		mockHybridEngine.search.mockResolvedValue([
			new FileItem(
				EngineType.SEMANTIC,
				"notes/hybrid.md",
				["hybrid"],
				["hybrid"],
				[],
				"nothing",
			),
		]);

		const result = await service.searchInVaultHybrid("hybrid");

		expect(mockHybridEngine.search).toHaveBeenCalledWith("hybrid");
		expect(result.items).toHaveLength(1);
		expect((result.items[0] as any).path).toBe("notes/hybrid.md");
	});

	test("keeps hybrid search available when the engine can still serve BM25-only queries", async () => {
		const { service, dataManager, EngineType, FileItem } = createHarness({
			searchable: true,
			hybridEnabled: true,
			hybridCanServeQuery: true,
			hybridUnavailable: true,
		});
		mockHybridEngine.search.mockResolvedValue([
			new FileItem(
				EngineType.SEMANTIC,
				"notes/bm25-only.md",
				["hybrid"],
				["hybrid"],
				[],
				"nothing",
			),
		]);

		const result = await service.searchInVaultHybrid("hybrid");

		expect(dataManager.isHybridSearchUnavailable).not.toHaveBeenCalled();
		expect(mockHybridEngine.search).toHaveBeenCalledWith("hybrid");
		expect((result.items[0] as any).path).toBe("notes/bm25-only.md");
	});

	test("falls back to lexical when hybrid cannot serve any query yet", async () => {
		const { service, lexicalEngine } = createHarness({
			searchable: true,
			hybridEnabled: true,
			hybridCanServeQuery: false,
			lexicalMatches: [
				{
					path: "notes/lexical-fallback.md",
					queryTerms: ["hybrid"],
					matchedTerms: ["hybrid"],
					score: 1,
				},
			],
		});

		const result = await service.searchInVaultHybrid("hybrid");

		expect(mockHybridEngine.search).not.toHaveBeenCalled();
		expect(lexicalEngine.searchFiles).toHaveBeenCalledWith("hybrid", 22, 10, 60);
		expect((result.items[0] as any).path).toBe("notes/lexical-fallback.md");
	});
});
