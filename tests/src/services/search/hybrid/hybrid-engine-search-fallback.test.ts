export {};

const mockInstanceMap = new Map<any, any>();

jest.mock("src/services/database/database", () => ({
	Database: class Database {},
}));

jest.mock("src/globals/plugin-setting", () => ({
	OuterSetting: class OuterSetting {},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class FileSnapshotStore {},
}));

jest.mock("src/services/search/hybrid/embedder", () => ({
	Embedder: class Embedder {},
	NoApiKeyError: class NoApiKeyError extends Error {},
	WeeklyTokenLimitExceededError: class WeeklyTokenLimitExceededError extends Error {},
	estimateTextsTokenUsage: jest.fn(() => 0),
	recordEstimatedTokenSavings: jest.fn(),
}));

jest.mock("src/services/search/hybrid/lexical-lane", () => ({
	buildHybridLexicalLaneFileItems: jest.fn((_query: string, candidates: Array<{ filePath: string }>) =>
		candidates.map((candidate, index) => ({ id: `${candidate.filePath}:${index}` })),
	),
	buildHybridLexicalLaneFileCandidates: jest.fn(),
	buildHybridLexicalLaneFileShortlist: jest.fn(),
	HYBRID_LEXICAL_LANE_FILE_SHORTLIST: 24,
	prepareHybridLexicalLaneSearch: jest.fn(async () => []),
	resolveHybridLexicalLaneFileMetadata: jest.fn(),
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn((token: any) => {
		if (!mockInstanceMap.has(token)) {
			throw new Error(`Missing test instance for token: ${token?.name ?? String(token)}`);
		}
		return mockInstanceMap.get(token);
	}),
}));

jest.mock("src/utils/logger", () => ({
	logger: {
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
		trace: jest.fn(),
	},
}));

jest.mock("src/services/search/hybrid/bm25", () => ({
	BM25Engine: class BM25Engine {
		docCount = 0;
		search() {
			return [];
		}
		clear() {}
		removeDocument() {}
		serialize() {
			return {};
		}
		optimizeStorage() {
			return false;
		}
		estimateRuntimeMemoryBreakdown() {
			return {
				totalBytes: 0,
			};
		}
	},
}));

jest.mock("src/services/search/hybrid/hnsw", () => ({
	HnswIndex: class HnswIndex {
		search() {
			return [];
		}
		clear() {}
		delete() {}
		needsRebuild() {
			return false;
		}
		rebuild() {}
		isNonEmpty() {
			return false;
		}
		hasVectors() {
			return false;
		}
		hydrateVectors() {}
		estimateRuntimeMemoryBytes() {
			return {
				vectorBytes: 0,
				graphBytes: 0,
				totalBytes: 0,
			};
		}
	},
}));

jest.mock("src/services/search/hybrid/hybrid-profiler", () => ({
	profileHybridStage: async (_name: string, fn: () => Promise<unknown>) => await fn(),
	recordHybridProfileMetric: jest.fn(),
}));

describe("HybridEngine search fallback notices", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockInstanceMap.clear();
		mockInstanceMap.set(require("src/services/database/database").Database, {
			db: {},
		});
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				enabled: true,
				vectorCompression: "int8",
				maxResultCount: 10,
				excludedPaths: [],
			},
		});
		mockInstanceMap.set(require("src/services/obsidian/user-data/data-provider").DataProvider, {});
		mockInstanceMap.set(require("src/services/search/shared/file-snapshot-store").FileSnapshotStore, {});
	});

	function createPreparedRecall(fallbackNoticeKey: string | null = null) {
		return {
			query: "alpha",
			topK: 10,
			displayCandidates: [
				{
					filePath: "notes/a.md",
					queryTerms: ["alpha"],
					matchedTerms: ["alpha"],
					subItems: [],
					previewContent: "a",
					nativeSubItemsReady: true,
					score: 10,
				},
				{
					filePath: "notes/b.md",
					queryTerms: ["alpha"],
					matchedTerms: ["alpha"],
					subItems: [],
					previewContent: "b",
					nativeSubItemsReady: true,
					score: 8,
				},
			],
			fallbackNoticeKey,
		};
	}

	test("search preserves the prepared fallback notice after staged finalize succeeds", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		engine._ready = true;
		engine.prepareRecall = jest.fn().mockResolvedValue(createPreparedRecall("hybridNotice.searchFallbackToBm25"));
		engine.finalizePreparedRecall = jest.fn().mockResolvedValue({
			items: [{ id: 1 }],
			fallbackNoticeKey: "hybridNotice.searchFallbackToBm25",
		});

		const results = await engine.search("alpha", 10);

		expect(results).toEqual([{ id: 1 }]);
		expect(engine.consumeSearchFallbackNoticeKey()).toBe("hybridNotice.searchFallbackToBm25");
	});

	test("finalizePreparedRecall uses a timeout-specific notice when rerank times out", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { HybridRerankTimeoutError } = require("src/services/search/hybrid/reranker");
		const engine = new HybridEngine() as any;
		const baseItems = [{ id: "prepared-a" }, { id: "prepared-b" }];
		engine.buildItemsFromPreparedRecall = jest.fn().mockReturnValue(baseItems);
		engine.rerankDisplayCandidates = jest
			.fn()
			.mockRejectedValue(new HybridRerankTimeoutError(2800));

		const finalized = await engine.finalizePreparedRecall(createPreparedRecall(), 10);

		expect(finalized.items).toBe(baseItems);
		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchRerankTimeoutFallbackToBm25");
	});

	test("finalizePreparedRecall keeps prepared ordering and uses a rerank-specific notice when rerank fails", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { HybridRerankError } = require("src/services/search/hybrid/reranker");
		const engine = new HybridEngine() as any;
		const baseItems = [{ id: "prepared-a" }, { id: "prepared-b" }];
		engine.buildItemsFromPreparedRecall = jest.fn().mockReturnValue(baseItems);
		engine.rerankDisplayCandidates = jest
			.fn()
			.mockRejectedValue(new HybridRerankError("rerank failed"));

		const finalized = await engine.finalizePreparedRecall(createPreparedRecall(), 10);

		expect(finalized.items).toBe(baseItems);
		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchRerankFallbackToBm25");
	});

	test("finalizePreparedRecall keeps the earlier fallback notice when rerank also fails", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { HybridRerankTimeoutError } = require("src/services/search/hybrid/reranker");
		const engine = new HybridEngine() as any;
		const baseItems = [{ id: "prepared-a" }];
		engine.buildItemsFromPreparedRecall = jest.fn().mockReturnValue(baseItems);
		engine.rerankDisplayCandidates = jest
			.fn()
			.mockRejectedValue(new HybridRerankTimeoutError(2800));

		const finalized = await engine.finalizePreparedRecall(
			createPreparedRecall("hybridNotice.searchFallbackToBm25"),
			10,
		);

		expect(finalized.items).toBe(baseItems);
		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchFallbackToBm25");
	});
});
