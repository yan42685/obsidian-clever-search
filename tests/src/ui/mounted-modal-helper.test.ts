jest.mock("obsidian", () => ({
	moment: { locale: () => "en" },
}), { virtual: true });

jest.mock("electron", () => ({
	app: { getPath: () => "C:/tmp" },
	remote: { app: { getPath: () => "C:/tmp" } },
}), { virtual: true });

jest.mock("src/services/obsidian/user-data/data-manager", () => ({
	DataManager: class MockDataManager {
		async flushPendingDocOperations() {
			return undefined;
		}
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
				fallbackNoticeMessage: null,
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
				fallbackNoticeMessage: null,
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
				(query: string, signal: AbortSignal) => {
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
				fallbackNoticeMessage: null,
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
				fallbackNoticeMessage: null,
			},
			result: new SearchResult("prepared-order", []),
		};
		const fallbackNoticeKey = "hybridNotice.searchFallbackToLexical";
		const finalResult = new SearchResult(
			"prepared-order",
			[],
			fallbackNoticeKey,
			"provider offline",
		);
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
		expect(setCachedResult).not.toHaveBeenCalled();
	});

	test("hybrid query session does not cache known-kind fallback results without explicit messages", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { HybridQuerySessionController } = require("src/ui/mounted-modal-helper");
		const prepareResult = {
			prepared: {
				query: "alpha",
				topK: 5,
				displayCandidates: [],
				fallbackNoticeKey: null,
				fallbackNoticeMessage: null,
			},
			result: new SearchResult("prepared-order", []),
		};
		const finalResult = new SearchResult(
			"prepared-order",
			[],
			"hybridNotice.searchFallbackToLexical",
			null,
			[],
			"fallback_failed",
			"missing_api_key",
			null,
		);
		const setCachedResult = jest.fn();
		const searchService = {
			prepareSearchInVaultHybrid: jest.fn(async () => prepareResult),
			finalizePreparedSearchInVaultHybrid: jest.fn(async () => finalResult),
			notifyHybridFallback: jest.fn(),
		};
		let currentQuery = "alpha";
		const controller = new HybridQuerySessionController({
			searchService,
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			getHybridMode: () => "default",
			getCurrentQueryText: () => currentQuery,
			getCachedResult: () => undefined,
			setCachedResult,
			onResultApplied: async () => undefined,
		});

		controller.handleInput("alpha");
		await jest.advanceTimersByTimeAsync(100);
		await jest.advanceTimersByTimeAsync(300);

		expect(setCachedResult).not.toHaveBeenCalled();
	});

	test("auto hybrid fallback reports an empty-result state when lexical and hybrid are both 0", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { AutoHybridFallbackController } = require("src/ui/mounted-modal-helper");
		const searchService = {
			hybridEngine: {
				isEnabled: jest.fn(() => true),
			},
			getHybridFallbackNotice: jest.fn((result: InstanceType<typeof SearchResult>) => ({
				key: result.hybridFallbackNoticeKey ?? null,
				message: result.hybridSearchIssueMessage ?? result.hybridFallbackNoticeMessage ?? null,
			})),
			notifyHybridFallback: jest.fn(),
			searchInVaultHybrid: jest.fn(
				async () =>
					new SearchResult(
						"no result",
						[],
						null,
						null,
						[],
						"success",
					),
			),
		};
		const failureStates: Array<{
			key: string | null;
			message: string | null;
			emptyResult: boolean;
		}> = [];
		const applied: string[] = [];
		const controller = new AutoHybridFallbackController({
			searchService,
			setting: {
				hybrid: {
					autoShowResultsWhenLexicalEmpty: true,
				},
			},
			searchType: SearchType.IN_VAULT,
			isHybrid: false,
			getLatestRequestId: () => 1,
			getCurrentQueryText: () => "alpha",
			onFailureNoticeChange: (state: typeof failureStates[number]) => {
				failureStates.push(state);
			},
			onResultApplied: async (_query: string, result: InstanceType<typeof SearchResult>) => {
				applied.push(result.sourcePath);
			},
		});

		controller.schedule("alpha", 1);
		await Promise.resolve();

		expect(searchService.searchInVaultHybrid).toHaveBeenCalledWith("alpha", {
			preserveHybridFailureResult: true,
		});
		expect(searchService.notifyHybridFallback).toHaveBeenCalledTimes(1);
		expect(failureStates.at(-1)).toEqual({
			key: null,
			message: null,
			emptyResult: true,
		});
		expect(applied).toEqual(["no result"]);
	});

	test("auto hybrid fallback keeps failure notice and empty-result state together", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { AutoHybridFallbackController } = require("src/ui/mounted-modal-helper");
		const searchService = {
			hybridEngine: {
				isEnabled: jest.fn(() => true),
			},
			getHybridFallbackNotice: jest.fn((_result: InstanceType<typeof SearchResult>) => ({
				key: "hybridNotice.searchIssue.missingApiKey",
				message: null,
			})),
			notifyHybridFallback: jest.fn(),
			searchInVaultHybrid: jest.fn(
				async () =>
					new SearchResult(
						"no result",
						[],
						"hybridNotice.searchFallbackToLexical",
						null,
						[],
						"fallback_failed",
						"missing_api_key",
						null,
					),
			),
		};
		const failureStates: Array<{
			key: string | null;
			message: string | null;
			emptyResult: boolean;
		}> = [];
		const controller = new AutoHybridFallbackController({
			searchService,
			setting: {
				hybrid: {
					autoShowResultsWhenLexicalEmpty: true,
				},
			},
			searchType: SearchType.IN_VAULT,
			isHybrid: false,
			getLatestRequestId: () => 1,
			getCurrentQueryText: () => "alpha",
			onFailureNoticeChange: (state: typeof failureStates[number]) => {
				failureStates.push(state);
			},
			onResultApplied: async () => undefined,
		});

		controller.schedule("alpha", 1);
		await Promise.resolve();

		expect(searchService.notifyHybridFallback).toHaveBeenCalledTimes(1);
		expect(searchService.searchInVaultHybrid).toHaveBeenCalledWith("alpha", {
			preserveHybridFailureResult: true,
		});
		expect(failureStates.at(-1)).toEqual({
			key: "hybridNotice.searchIssue.missingApiKey",
			message: null,
			emptyResult: true,
		});
	});

	test("auto hybrid fallback preserves failure notice when hybrid recovers with results", async () => {
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { AutoHybridFallbackController } = require("src/ui/mounted-modal-helper");
		const searchService = {
			hybridEngine: {
				isEnabled: jest.fn(() => true),
			},
			getHybridFallbackNotice: jest.fn((_result: InstanceType<typeof SearchResult>) => ({
				key: "hybridNotice.searchIssue.provider429",
				message: null,
			})),
			notifyHybridFallback: jest.fn(),
			searchInVaultHybrid: jest.fn(
				async () =>
					new SearchResult(
						"hybrid result",
						[{ id: "file-1" }],
						"hybridNotice.searchFallbackToLexical",
						null,
						[],
						"fallback_failed",
						"provider_429",
						null,
					),
			),
		};
		const failureStates: Array<{
			key: string | null;
			message: string | null;
			emptyResult: boolean;
		}> = [];
		const applied: string[] = [];
		const controller = new AutoHybridFallbackController({
			searchService,
			setting: {
				hybrid: {
					autoShowResultsWhenLexicalEmpty: true,
				},
			},
			searchType: SearchType.IN_VAULT,
			isHybrid: false,
			getLatestRequestId: () => 1,
			getCurrentQueryText: () => "alpha",
			onFailureNoticeChange: (state: typeof failureStates[number]) => {
				failureStates.push(state);
			},
			onResultApplied: async (_query: string, result: InstanceType<typeof SearchResult>) => {
				applied.push(result.sourcePath);
			},
		});

		controller.schedule("alpha", 1);
		await Promise.resolve();

		expect(searchService.notifyHybridFallback).toHaveBeenCalledTimes(1);
		expect(searchService.searchInVaultHybrid).toHaveBeenCalledWith("alpha", {
			preserveHybridFailureResult: true,
		});
		expect(failureStates.at(-1)).toEqual({
			key: "hybridNotice.searchIssue.provider429",
			message: null,
			emptyResult: false,
		});
		expect(applied).toEqual(["hybrid result"]);
	});

	test("hybrid freshness notice polls at a low frequency", async () => {
		const { container } = require("tsyringe");
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { DataManager } = require("src/services/obsidian/user-data/data-manager");
		const { EventEnum } = require("src/globals/enums");
		const { eventBus } = require("src/utils/event-bus");
		const { HybridFreshnessNoticeController } = require("src/ui/mounted-modal-helper");
		const getHybridFreshnessSummary = jest.fn(async () => ({
			processingFileCount: 1,
			staleFileCount: 0,
			repairFileCount: 0,
			totalTrackedFiles: 1,
			processingSamplePaths: ["docs/example.md"],
			staleSamplePaths: [],
			repairSamplePaths: [],
			updatedAt: Date.now(),
		}));
		container.registerInstance(DataManager, {
			flushPendingDocOperations: jest.fn(async () => undefined),
			getHybridFreshnessSummary,
		});
		const states: Array<{ visible: boolean; message: string }> = [];
		const controller = new HybridFreshnessNoticeController({
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			onNoticeChange: (state: typeof states[number]) => {
				states.push(state);
			},
		});

		controller.syncFromResult(new SearchResult("freshness", []));
		await Promise.resolve();

		expect(getHybridFreshnessSummary).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(4999);
		expect(getHybridFreshnessSummary).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(1);
		expect(getHybridFreshnessSummary).toHaveBeenCalledTimes(2);
		expect(states.at(-1)?.visible).toBe(true);

		controller.clear();
		if (
			"reset" in container &&
			typeof (container as { reset?: () => void }).reset === "function"
		) {
			(container as { reset: () => void }).reset();
		} else {
			container.clearInstances();
		}
	});

	test("hybrid freshness notice coalesces runtime-status refresh bursts", async () => {
		const { container } = require("tsyringe");
		const { SearchResult, SearchType } = require("src/globals/search-types");
		const { EventEnum } = require("src/globals/enums");
		const { eventBus } = require("src/utils/event-bus");
		const { DataManager } = require("src/services/obsidian/user-data/data-manager");
		const { HybridFreshnessNoticeController } = require("src/ui/mounted-modal-helper");
		const summary = {
			processingFileCount: 1,
			staleFileCount: 0,
			repairFileCount: 0,
			totalTrackedFiles: 1,
			processingSamplePaths: ["docs/example.md"],
			staleSamplePaths: [],
			repairSamplePaths: [],
			updatedAt: Date.now(),
		};
		let resolveFirstRefresh: ((value: typeof summary) => void) | null = null;
		const getHybridFreshnessSummary = jest
			.fn()
			.mockImplementationOnce(
				async () =>
					await new Promise<typeof summary>((resolve) => {
						resolveFirstRefresh = resolve;
					}),
			)
			.mockImplementation(async () => summary);
		container.registerInstance(DataManager, {
			flushPendingDocOperations: jest.fn(async () => undefined),
			getHybridFreshnessSummary,
		});
		const controller = new HybridFreshnessNoticeController({
			getSearchType: () => SearchType.IN_VAULT,
			getIsHybrid: () => true,
			onNoticeChange: () => undefined,
		});

		controller.syncFromResult(new SearchResult("freshness", []));
		await Promise.resolve();
		expect(getHybridFreshnessSummary).toHaveBeenCalledTimes(1);

		const runtimeStatusCallback = (eventBus.on as jest.Mock).mock.calls.find(
			([event]: [string]) => event === EventEnum.HYBRID_RUNTIME_STATUS_CHANGED,
		)?.[1];
		expect(runtimeStatusCallback).toBeDefined();
		runtimeStatusCallback();
		runtimeStatusCallback();
		runtimeStatusCallback();
		expect(getHybridFreshnessSummary).toHaveBeenCalledTimes(1);

		resolveFirstRefresh?.(summary);
		await Promise.resolve();
		await Promise.resolve();
		expect(getHybridFreshnessSummary.mock.calls.length).toBeLessThanOrEqual(2);
		expect(getHybridFreshnessSummary).toHaveBeenCalledTimes(1);

		runtimeStatusCallback();
		await Promise.resolve();
		await Promise.resolve();
		expect(getHybridFreshnessSummary.mock.calls.length).toBeLessThanOrEqual(2);

		controller.clear();
		if (
			"reset" in container &&
			typeof (container as { reset?: () => void }).reset === "function"
		) {
			(container as { reset: () => void }).reset();
		}
	});
});
