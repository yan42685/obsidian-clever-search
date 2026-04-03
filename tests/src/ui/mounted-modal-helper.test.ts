jest.mock("obsidian", () => ({
	moment: { locale: () => "en" },
}), { virtual: true });

jest.mock("electron", () => ({
	app: { getPath: () => "C:/tmp" },
	remote: { app: { getPath: () => "C:/tmp" } },
}), { virtual: true });

jest.mock("src/services/obsidian/user-data/data-manager", () => ({
	DataManager: class MockDataManager {
		async getHybridFreshnessSummary() {
			return null;
		}
	},
}));

jest.mock("src/utils/event-bus", () => ({
	eventBus: {
		on: jest.fn(),
		off: jest.fn(),
	},
}));

export {};

describe("mounted modal helper", () => {
	beforeEach(() => {
		jest.useFakeTimers();
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
		jest.useRealTimers();
		jest.resetModules();
	});

	test("treats native lexical subitems as direct even when the list is empty", () => {
		const { EngineType, FileItem } = require("src/globals/search-types");
		const { usesDirectFileSubItems } = require("src/ui/mounted-modal-helper");
		const item = new FileItem(
			EngineType.LEXICAL,
			"notes/example.md",
			["cache"],
			["cache"],
			[],
			"nothing",
			true,
		);

		expect(usesDirectFileSubItems(item)).toBe(true);
	});

	test("hybrid query session waits for rerank gate after early prepare result", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { HybridQuerySessionController } = require("src/ui/mounted-modal-helper");
		const prepareResult = {
			prepared: {
				query: "alpha",
				topK: 5,
				displayCandidates: [],
				fallbackNoticeKey: null,
			},
			result: new SearchResult("prepare", []),
		};
		const finalResult = new SearchResult("final", []);
		const searchService = {
			prepareSearchInVaultHybrid: jest.fn(async () => prepareResult),
			finalizePreparedSearchInVaultHybrid: jest.fn(async () => finalResult),
			notifyHybridFallback: jest.fn(),
		};
		let currentQuery = "alpha";
		const applied: string[] = [];
		const controller = new HybridQuerySessionController({
			searchService,
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			getHybridMode: () => "default",
			getCurrentQueryText: () => currentQuery,
			getCachedResult: () => undefined,
			setCachedResult: jest.fn(),
			onResultApplied: async (_query: string, result: InstanceType<typeof SearchResult>) => {
				applied.push(result.sourcePath);
			},
		});

		controller.handleInput("alpha");
		await jest.advanceTimersByTimeAsync(100);
		expect(searchService.prepareSearchInVaultHybrid).toHaveBeenCalledTimes(1);
		expect(searchService.finalizePreparedSearchInVaultHybrid).not.toHaveBeenCalled();
		expect(applied).toEqual(["prepare"]);

		await jest.advanceTimersByTimeAsync(299);
		expect(searchService.finalizePreparedSearchInVaultHybrid).not.toHaveBeenCalled();
		expect(applied).toEqual(["prepare"]);

		await jest.advanceTimersByTimeAsync(1);
		expect(searchService.finalizePreparedSearchInVaultHybrid).toHaveBeenCalledTimes(1);
		expect(applied).toEqual(["prepare", "final"]);
	});

	test("hybrid query session starts finalize immediately when prepare completes after the rerank gate", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { HybridQuerySessionController } = require("src/ui/mounted-modal-helper");
		const prepareDeferred: { resolve: (value: any) => void } = {
			resolve: () => undefined,
		};
		const finalResult = new SearchResult("final-after-slow-prepare", []);
		const searchService = {
			prepareSearchInVaultHybrid: jest.fn(
				() =>
					new Promise((resolve) => {
						prepareDeferred.resolve = resolve;
					}),
			),
			finalizePreparedSearchInVaultHybrid: jest.fn(async () => finalResult),
			notifyHybridFallback: jest.fn(),
		};
		let currentQuery = "alpha";
		const applied: string[] = [];
		const controller = new HybridQuerySessionController({
			searchService,
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			getHybridMode: () => "default",
			getCurrentQueryText: () => currentQuery,
			getCachedResult: () => undefined,
			setCachedResult: jest.fn(),
			onResultApplied: async (_query: string, result: InstanceType<typeof SearchResult>) => {
				applied.push(result.sourcePath);
			},
		});

		controller.handleInput("alpha");
		await jest.advanceTimersByTimeAsync(100);
		expect(searchService.prepareSearchInVaultHybrid).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(400);
		expect(searchService.finalizePreparedSearchInVaultHybrid).not.toHaveBeenCalled();

		prepareDeferred.resolve({
			prepared: {
				query: "alpha",
				topK: 5,
				displayCandidates: [],
				fallbackNoticeKey: null,
			},
			result: new SearchResult("prepare-after-gate", []),
		});
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(applied).toEqual(["prepare-after-gate", "final-after-slow-prepare"]);
		expect(searchService.finalizePreparedSearchInVaultHybrid).toHaveBeenCalledTimes(1);
	});

	test("hybrid query session aborts stale prepare work on continuous typing", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { HybridQuerySessionController } = require("src/ui/mounted-modal-helper");
		const prepareResolvers = new Map<string, (value: unknown) => void>();
		const prepareSignals = new Map<string, AbortSignal>();
		const searchService = {
			prepareSearchInVaultHybrid: jest.fn(
				(query: string, _mode: string, signal: AbortSignal) => {
					prepareSignals.set(query, signal);
					return new Promise((resolve) => {
						prepareResolvers.set(query, resolve);
					});
				},
			),
			finalizePreparedSearchInVaultHybrid: jest.fn(),
			notifyHybridFallback: jest.fn(),
		};
		let currentQuery = "alpha";
		const applied: string[] = [];
		const controller = new HybridQuerySessionController({
			searchService,
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			getHybridMode: () => "default",
			getCurrentQueryText: () => currentQuery,
			getCachedResult: () => undefined,
			setCachedResult: jest.fn(),
			onResultApplied: async (_query: string, result: InstanceType<typeof SearchResult>) => {
				applied.push(result.sourcePath);
			},
		});

		controller.handleInput("alpha");
		await jest.advanceTimersByTimeAsync(100);
		expect(searchService.prepareSearchInVaultHybrid).toHaveBeenCalledTimes(1);
		expect(prepareSignals.get("alpha")?.aborted).toBe(false);

		currentQuery = "beta";
		controller.handleInput("beta");
		expect(prepareSignals.get("alpha")?.aborted).toBe(true);

		prepareResolvers.get("alpha")?.({
			prepared: {
				query: "alpha",
				topK: 5,
				displayCandidates: [],
				fallbackNoticeKey: null,
			},
			result: new SearchResult("alpha-prepare", []),
		});
		await Promise.resolve();
		expect(applied).toEqual([]);

		await jest.advanceTimersByTimeAsync(100);
		expect(searchService.prepareSearchInVaultHybrid).toHaveBeenCalledTimes(2);
		prepareResolvers.get("beta")?.({
			prepared: null,
			result: new SearchResult("beta-prepare", []),
		});
		await Promise.resolve();
		expect(applied).toEqual(["beta-prepare"]);
	});

	test("hybrid query session keeps prepared results and surfaces rerank fallback notice when finalize degrades", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { HybridQuerySessionController } = require("src/ui/mounted-modal-helper");
		const prepareResult = {
			prepared: {
				query: "alpha",
				topK: 5,
				displayCandidates: [],
				fallbackNoticeKey: null,
			},
			result: new SearchResult("prepared-order", []),
		};
		const fallbackNoticeKey = "hybridNotice.searchRerankFallbackToBm25";
		const finalResult = new SearchResult("prepared-order", [], fallbackNoticeKey, false);
		const setCachedResult = jest.fn();
		const searchService = {
			prepareSearchInVaultHybrid: jest.fn(async () => prepareResult),
			finalizePreparedSearchInVaultHybrid: jest.fn(async () => finalResult),
			notifyHybridFallback: jest.fn(),
		};
		let currentQuery = "alpha";
		const applied: string[] = [];
		const controller = new HybridQuerySessionController({
			searchService,
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			getHybridMode: () => "default",
			getCurrentQueryText: () => currentQuery,
			getCachedResult: () => undefined,
			setCachedResult,
			onResultApplied: async (_query: string, result: InstanceType<typeof SearchResult>) => {
				applied.push(result.sourcePath);
			},
		});

		controller.handleInput("alpha");
		await jest.advanceTimersByTimeAsync(100);
		await jest.advanceTimersByTimeAsync(300);

		expect(applied).toEqual(["prepared-order", "prepared-order"]);
		expect(searchService.notifyHybridFallback).toHaveBeenNthCalledWith(1, prepareResult.result);
		expect(searchService.notifyHybridFallback).toHaveBeenNthCalledWith(2, finalResult);
		expect(setCachedResult).toHaveBeenCalledWith("alpha", finalResult);
	});
});
