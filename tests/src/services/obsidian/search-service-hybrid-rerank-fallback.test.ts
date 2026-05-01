// @ts-nocheck
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

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	buildIndexedSnapshotRequestKey: (request: { path: string; generation?: number }) =>
		`${request.path}\0${request.generation ?? ""}`,
	FileSnapshotStore: class FileSnapshotStore {},
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
		const { FileSnapshotStore } = require("src/services/search/shared/file-snapshot-store");
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
			parseAll: jest.fn(() => []),
		});
		mockInstanceMap.set(FileSnapshotStore, {
			readIndexedTexts: jest.fn(async () => new Map()),
			readIndexedTextSnapshots: jest.fn(async () => new Map()),
		});
		mockInstanceMap.set(ViewRegistry, {
			viewTypeByPath: jest.fn(() => "markdown"),
		});
		const dataManager = {
			flushPendingDocOperations: jest.fn(async () => undefined),
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
			getHybridFileFreshnessMap: jest.fn(async () => new Map()),
		};
		mockInstanceMap.set(DataManager, dataManager);

		return {
			service: new SearchService(),
			dataManager,
		};
	}

	function configurePreparedFlow(finalNoticeKey: string | null = null) {
		const prepared = {
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: null,
			fallbackNoticeMessage: null,
			fallbackToLexicalSearch: false,
		};
		mockHybridEngine.prepareRecall.mockResolvedValue(prepared);
		mockHybridEngine.buildItemsFromPreparedRecall.mockReturnValue([{ id: "prepared-item" }]);
		mockHybridEngine.finalizePreparedRecall.mockResolvedValue({
			items: [{ id: "final-item" }],
			fallbackNoticeKey: finalNoticeKey,
			fallbackNoticeMessage: null,
			fallbackToLexicalSearch: false,
		});
	}

	test("keeps hybrid results and notice flow when finalize succeeds normally", async () => {
		configurePreparedFlow("hybridNotice.searchFallbackToLexical");
		const { service } = createHarness();

		const result = await service.searchInVaultHybrid("alpha");

		expect(mockHybridEngine.prepareRecall).toHaveBeenCalledWith("alpha", 10, undefined);
		expect(mockHybridEngine.finalizePreparedRecall).toHaveBeenCalledWith(
			expect.objectContaining({ query: "alpha" }),
			10,
			undefined,
		);
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridSearchOutcome).toBe("fallback_with_results");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.unavailablehybridNotice.lexicalFallbackSwitchedSuffix",
		]);
	});

	test("falls back to the normal lexical search path when finalize requests lexical fallback", async () => {
		configurePreparedFlow();
		const { service } = createHarness();
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
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridSearchOutcome).toBe("fallback_with_results");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.unavailablehybridNotice.lexicalFallbackSwitchedSuffix",
		]);
	});

	test("preserves hybrid failure result instead of falling back to lexical when requested", async () => {
		configurePreparedFlow();
		const { service } = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		mockHybridEngine.finalizePreparedRecall.mockResolvedValue({
			items: [{ id: "stale-hybrid-item" }],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackNoticeMessage: "provider offline",
			fallbackIssueKind: "unknown",
			fallbackIssueMessage: "provider offline",
			fallbackToLexicalSearch: true,
		});

		const result = await service.searchInVaultHybrid("alpha", {
			preserveHybridFailureResult: true,
		});

		expect(lexicalEngine.searchFiles).not.toHaveBeenCalled();
		expect(result.items).toHaveLength(0);
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridFallbackNoticeMessage).toBe("provider offline");
		expect(result.hybridSearchOutcome).toBe("fallback_failed");
		expect(result.hybridSearchIssueKind).toBe("unknown");
		expect(result.hybridSearchIssueMessage).toBe("provider offline");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"provider offlinehybridNotice.lexicalFallbackSuffix",
		]);
	});

	test("preserves hybrid failure result for lexical-lane mode when requested", async () => {
		mockHybridEngine.prepareRecall.mockResolvedValue({
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackNoticeMessage: "provider offline",
			fallbackIssueKind: "unknown",
			fallbackIssueMessage: "provider offline",
			fallbackToLexicalSearch: true,
		});
		const { service } = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);

		const result = await service.searchInVaultHybridLexicalLane("alpha", {
			preserveHybridFailureResult: true,
		});

		expect(lexicalEngine.searchFiles).not.toHaveBeenCalled();
		expect(mockHybridEngine.finalizePreparedRecall).not.toHaveBeenCalled();
		expect(result.items).toHaveLength(0);
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridFallbackNoticeMessage).toBe("provider offline");
		expect(result.hybridSearchOutcome).toBe("fallback_failed");
		expect(result.hybridSearchIssueKind).toBe("unknown");
		expect(result.hybridSearchIssueMessage).toBe("provider offline");
	});

	test("falls back to the normal lexical search path with a generic notice when hybrid requests lexical fallback without details", async () => {
		mockHybridEngine.prepareRecall.mockResolvedValue({
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackNoticeMessage: null,
			fallbackToLexicalSearch: true,
		});
		const { service } = createHarness();
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
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridSearchOutcome).toBe("fallback_with_results");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.unavailablehybridNotice.lexicalFallbackSwitchedSuffix",
		]);
	});

	test("falls back to the normal lexical search path when hybrid prepare throws", async () => {
		mockHybridEngine.prepareRecall.mockRejectedValue(
			new Error("provider offline"),
		);
		const { service } = createHarness();
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
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridFallbackNoticeMessage).toBe("provider offline");
		expect(result.hybridSearchOutcome).toBe("fallback_failed");
		expect(result.hybridSearchIssueKind).toBe("unknown");
		expect(result.hybridSearchIssueMessage).toBe("provider offline");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"provider offlinehybridNotice.lexicalFallbackSuffix",
		]);
	});

	test("propagates cancelled hybrid prepare without lexical fallback", async () => {
		const abortError = new Error("Hybrid operation aborted");
		abortError.name = "AbortError";
		mockHybridEngine.prepareRecall.mockRejectedValue(abortError);
		const { service } = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);

		await expect(service.prepareSearchInVaultHybrid("alpha")).rejects.toBe(abortError);

		expect(lexicalEngine.searchFiles).not.toHaveBeenCalled();
		expect(mockNotices).toEqual([]);
	});

	test("marks auto fallback failures with no lexical results as fallback_failed", async () => {
		mockHybridEngine.prepareRecall.mockRejectedValue(
			new Error("provider offline"),
		);
		const { service } = createHarness();

		const result = await service.searchInVaultHybrid("alpha");

		expect(result.items).toHaveLength(0);
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(result.hybridFallbackNoticeMessage).toBe("provider offline");
		expect(result.hybridSearchOutcome).toBe("fallback_failed");
		expect(result.hybridSearchIssueKind).toBe("unknown");
		expect(result.hybridSearchIssueMessage).toBe("provider offline");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"provider offlinehybridNotice.lexicalFallbackSuffix",
		]);
	});

	test("preserves lexical subitem readiness when hybrid fallback returns lexical results", async () => {
		mockHybridEngine.prepareRecall.mockResolvedValue({
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackNoticeMessage: null,
			fallbackToLexicalSearch: true,
		});
		const { service } = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		lexicalEngine.searchFiles.mockResolvedValue([
			{
				path: "notes/lazy-subitems.md",
				queryTerms: ["alpha"],
				matchedTerms: ["alpha"],
				score: 7,
				directSubItems: [],
				nativeSubItemsReady: false,
			},
		]);

		const result = await service.searchInVaultHybrid("alpha");
		const item = result.items[0];

		expect(item.path).toBe("notes/lazy-subitems.md");
		expect(item.freshnessState).toBe("lexical_only");
		expect(item.nativeSubItemsReady).toBe(false);
		expect(item.subItems).toEqual([]);
	});

	test("uses mapped notice text for known issue kinds without provider-specific messages", async () => {
		const { NoApiKeyError } = require("src/services/search/hybrid/provider-error");
		mockHybridEngine.prepareRecall.mockRejectedValue(new NoApiKeyError());
		const { service } = createHarness();
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

		expect(result.hybridSearchIssueKind).toBe("missing_api_key");
		expect(result.hybridSearchIssueMessage).toBeNull();
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.missingApiKeyhybridNotice.lexicalFallbackSuffix",
		]);
	});

	test("uses the disabled hybrid notice when hybrid search is turned off", async () => {
		const { service, dataManager } = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		lexicalEngine.searchFiles.mockResolvedValue([
			{
				path: "notes/disabled.md",
				queryTerms: ["alpha"],
				matchedTerms: ["alpha"],
				score: 7,
				directSubItems: [],
				nativeSubItemsReady: true,
			},
		]);
		dataManager.getHybridAvailabilityState.mockReturnValue({
			enabled: false,
			bootstrap: "searchable",
			query: "unavailable",
			reasons: ["disabled"],
			prompt: {
				blockingNoticeKey: "hybridNotice.disabled",
				fallbackNoticeKey: "hybridNotice.disabled",
			},
		});

		const result = await service.searchInVaultHybrid("alpha");

		expect(mockHybridEngine.prepareRecall).not.toHaveBeenCalled();
		expect(result.hybridFallbackNoticeKey).toBe("hybridNotice.disabled");
		expect(result.hybridAvailabilityReasons).toEqual(["disabled"]);
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.disabledhybridNotice.lexicalSearchSuffix",
		]);
	});

	test("keeps known issue kinds when finalize falls back to lexical results", async () => {
		configurePreparedFlow();
		const { service } = createHarness();
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		lexicalEngine.searchFiles.mockResolvedValue([
			{
				path: "notes/finalize-known-kind.md",
				queryTerms: ["alpha"],
				matchedTerms: ["alpha"],
				score: 11,
				directSubItems: [],
				nativeSubItemsReady: true,
			},
		]);
		mockHybridEngine.finalizePreparedRecall.mockResolvedValue({
			items: [],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackNoticeMessage: null,
			fallbackIssueKind: "missing_api_key",
			fallbackIssueMessage: null,
			fallbackToLexicalSearch: true,
		});

		const result = await service.searchInVaultHybrid("alpha");

		expect(result.hybridSearchIssueKind).toBe("missing_api_key");
		expect(result.hybridSearchIssueMessage).toBeNull();
		expect(result.hybridSearchOutcome).toBe("fallback_failed");
		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.missingApiKeyhybridNotice.lexicalFallbackSuffix",
		]);
	});

	test("prefers explicit issue messages over mapped notice text", () => {
		const { service } = createHarness();
		const { SearchResult } = require("src/globals/search-types");
		const result = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
			null,
			[],
			"fallback_failed",
			"missing_api_key",
			"provider said something more specific",
		);

		service.notifyHybridFallback(result);

		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"provider said something more specifichybridNotice.lexicalFallbackSuffix",
		]);
	});

	test("dedupes identical fallback notices across staged updates", () => {
		const { service } = createHarness();
		const { SearchResult } = require("src/globals/search-types");
		const preparedResult = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
		);
		const finalResult = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
		);

		service.notifyHybridFallback(preparedResult);
		service.notifyHybridFallback(finalResult);

		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.unavailablehybridNotice.lexicalFallbackSwitchedSuffix",
		]);
	});

	test("keeps a single fallback notice instance after the aggregated state clears", () => {
		const { service } = createHarness();
		const { SearchResult } = require("src/globals/search-types");
		const fallbackResult = new SearchResult(
			"notes/current.md",
			[],
			"hybridNotice.searchFallbackToLexical",
		);
		const cleanResult = new SearchResult("notes/current.md", [], null);

		service.notifyHybridFallback(fallbackResult);
		service.notifyHybridFallback(cleanResult);
		service.notifyHybridFallback(fallbackResult);

		expect(mockNotices.map((entry) => entry.message)).toEqual([
			"hybridReason.unavailablehybridNotice.lexicalFallbackSwitchedSuffix",
		]);
	});

	test("flushes pending doc operations before hybrid prepare starts", async () => {
		configurePreparedFlow();
		const { service, dataManager } = createHarness();

		await service.searchInVaultHybrid("alpha");

		expect(dataManager.flushPendingDocOperations).toHaveBeenCalledTimes(1);
		expect(dataManager.flushPendingDocOperations.mock.invocationCallOrder[0]).toBeLessThan(
			mockHybridEngine.prepareRecall.mock.invocationCallOrder[0],
		);
	});

	test("decorates hybrid file items with stale-grace freshness and item banner", async () => {
		const { FileItem, EngineType } = require("src/globals/search-types");
		const prepared = {
			query: "alpha",
			topK: 10,
			displayCandidates: [],
			fallbackNoticeKey: null,
			fallbackNoticeMessage: null,
			fallbackToLexicalSearch: false,
		};
		const hybridItem = new FileItem(
			EngineType.HYBRID,
			"notes/stale.md",
			["alpha"],
			["alpha"],
			[],
			"nothing",
			true,
		);
		mockHybridEngine.prepareRecall.mockResolvedValue(prepared);
		mockHybridEngine.buildItemsFromPreparedRecall.mockReturnValue([hybridItem]);
		mockHybridEngine.finalizePreparedRecall.mockResolvedValue({
			items: [hybridItem],
			fallbackNoticeKey: null,
			fallbackNoticeMessage: null,
			fallbackToLexicalSearch: false,
		});

		const { service, dataManager } = createHarness();
		dataManager.getHybridFileFreshnessMap.mockResolvedValue(
			new Map([
				[
					"notes/stale.md",
					{
						state: "stale_grace",
						reason: "embedding_wait_interval",
						snapshotGeneration: 180,
						snapshotSource: "shadow",
					},
				],
			]),
		);

		const result = await service.searchInVaultHybrid("alpha");
		const item = result.items[0];

		expect(dataManager.getHybridFileFreshnessMap).toHaveBeenCalledWith([
			"notes/stale.md",
		]);
		expect(item.freshnessState).toBe("stale_grace");
		expect(item.freshnessReason).toBe("embedding_wait_interval");
		expect(item.snapshotGeneration).toBe(180);
		expect(item.snapshotSource).toBe("shadow");
		expect(item.nativeSubItemsReady).toBe(false);
		expect(item.bannerKey).toBe("hybridNotice.fileEmbeddingWaitInterval");
	});

	test("loads stale-grace hybrid subitems from the matching shadow snapshot", async () => {
		const { FileItem, EngineType, FileSubItem } = require("src/globals/search-types");
		const { DataProvider } = require("src/services/obsidian/user-data/data-provider");
		const { LexicalEngine } = require("src/services/search/lexical-engine");
		const { LineHighlighter } = require("src/services/search/highlighter");
		const { FileSnapshotStore } = require("src/services/search/shared/file-snapshot-store");
		const { service } = createHarness();

		const lexicalEngine = mockInstanceMap.get(LexicalEngine);
		const lineHighlighter = mockInstanceMap.get(LineHighlighter);
		const snapshotStore = mockInstanceMap.get(FileSnapshotStore);
		const dataProvider = mockInstanceMap.get(DataProvider);

		snapshotStore.readIndexedTextSnapshots.mockResolvedValue(
			new Map([
				[
					`notes/stale.md\0${180}`,
					{
						path: "notes/stale.md",
						text: "shadow body line",
						generation: 180,
						source: "shadow",
					},
				],
			]),
		);
		lexicalEngine.searchLinesByFileItem.mockResolvedValue([
			{
				text: "shadow body line",
				row: 0,
				positions: new Set([0, 1, 2]),
			},
		]);
		lineHighlighter.parseAll.mockReturnValue([
			{
				text: "shadow body line",
				row: 0,
				col: 0,
			},
		]);

		const staleItem = new FileItem(
			EngineType.HYBRID,
			"notes/stale.md",
			["shadow"],
			["shadow"],
			[],
			"nothing",
			false,
		);
		staleItem.freshnessState = "stale_grace";
		staleItem.freshnessReason = "embedding_updating";
		staleItem.snapshotGeneration = 180;
		staleItem.snapshotSource = "shadow";

		const subItems = await service.getFileSubItems("shadow", staleItem);

		expect(snapshotStore.readIndexedTextSnapshots).toHaveBeenCalledWith([
			{
				path: "notes/stale.md",
				generation: 180,
			},
		]);
		expect(dataProvider.readPlainText).not.toHaveBeenCalled();
		expect(lexicalEngine.searchLinesByFileItem).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ text: "shadow body line", row: 0 }),
			]),
			"subItem",
			"shadow",
			expect.objectContaining({ path: "notes/stale.md" }),
			60,
		);
		expect(lineHighlighter.parseAll).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ text: "shadow body line", row: 0 }),
			]),
			[
				{
					text: "shadow body line",
					row: 0,
					positions: new Set([0, 1, 2]),
				},
			],
			expect.anything(),
			false,
		);
		expect(subItems).toHaveLength(1);
		expect(subItems[0]).toBeInstanceOf(FileSubItem);
		expect(subItems[0].text).toBe("shadow body line");
		expect(subItems[0].snippet).toBe("shadow body line");
		expect(staleItem.nativeSubItemsReady).toBe(true);
		expect(staleItem.snapshotSource).toBe("shadow");
	});

	test("downgrades stale-grace hybrid subitems to lexical-only when shadow snapshot is missing", async () => {
		const { FileItem, EngineType } = require("src/globals/search-types");
		const { DataProvider } = require("src/services/obsidian/user-data/data-provider");
		const { FileSnapshotStore } = require("src/services/search/shared/file-snapshot-store");
		const { service } = createHarness();

		const snapshotStore = mockInstanceMap.get(FileSnapshotStore);
		const dataProvider = mockInstanceMap.get(DataProvider);
		snapshotStore.readIndexedTextSnapshots.mockResolvedValue(new Map());

		const staleItem = new FileItem(
			EngineType.HYBRID,
			"notes/stale.md",
			["shadow"],
			["shadow"],
			[],
			"nothing",
			false,
		);
		staleItem.freshnessState = "stale_grace";
		staleItem.freshnessReason = "embedding_updating";
		staleItem.snapshotGeneration = 180;
		staleItem.snapshotSource = "shadow";

		const subItems = await service.getFileSubItems("shadow", staleItem);

		expect(subItems).toEqual([]);
		expect(dataProvider.readPlainText).not.toHaveBeenCalled();
		expect(staleItem.freshnessState).toBe("lexical_only");
		expect(staleItem.freshnessReason).toBe("shadow_missing");
		expect(staleItem.snapshotSource).toBe("live");
		expect(staleItem.bannerKey).toBeNull();
	});

});
