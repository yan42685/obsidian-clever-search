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

	function createCandidate(id: number, filePath: string, score: number) {
		return {
			id,
			filePath,
			text: `${filePath}:${id}`,
			rerankText: `${filePath}:${id}`,
			row: 0,
			col: 0,
			score,
		};
	}

	function createEngineHarness() {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		engine._ready = true;
		engine._canSearch = true;
		engine.bm25 = {
			docCount: 2,
			search: jest.fn(() => [
				{ docId: 11, score: 11 },
				{ docId: 22, score: 9 },
			]),
		};
		engine.hnswSmall = {
			search: jest.fn(() => [{ id: 33, score: 0.8 }]),
		};
		engine.embedder = {
			embedQuery: jest.fn().mockResolvedValue({
				precision: "int8",
				vector: new Int8Array([1]),
				scale: 1,
			}),
		};
		engine.loadDedupedSmallChunkCandidates = jest.fn().mockResolvedValue([
			createCandidate(11, "notes/a.md", 11),
			createCandidate(22, "notes/b.md", 9),
			createCandidate(33, "notes/c.md", 0.8),
		]);
		engine.buildFileItemsFromSmallChunks = jest
			.fn()
			.mockImplementation((_query: string, candidates: Array<{ id: number }>) =>
				candidates.map((candidate) => ({ id: candidate.id })),
			);
		return engine;
	}

	test("preserves the BM25 fallback notice when dense search is unavailable from startup", async () => {
		const engine = createEngineHarness();
		engine._canSearch = false;
		engine.rerankAndBuildFileItems = jest.fn().mockResolvedValue([{ id: 11 }]);

		await engine.search("alpha", 10);

		expect(engine.consumeSearchFallbackNoticeKey()).toBe("hybridNotice.searchFallbackToBm25");
	});

	test("keeps the embedding fallback notice when query embedding fails but rerank still succeeds", async () => {
		const engine = createEngineHarness();
		engine.embedder.embedQuery.mockRejectedValue(new Error("embedding failed"));
		engine.loadDedupedSmallChunkCandidates.mockResolvedValue([
			createCandidate(11, "notes/a.md", 11),
			createCandidate(22, "notes/b.md", 9),
		]);
		engine.rerankAndBuildFileItems = jest.fn().mockResolvedValue([{ id: 11 }]);

		await engine.search("alpha", 10);

		expect(engine.consumeSearchFallbackNoticeKey()).toBe("hybridNotice.searchFallbackToBm25");
	});

	test("uses a rerank-specific notice and BM25-only fallback ordering when rerank fails", async () => {
		const engine = createEngineHarness();
		const { HybridRerankError } = require("src/services/search/hybrid/reranker");
		engine.rerankAndBuildFileItems = jest
			.fn()
			.mockRejectedValue(new HybridRerankError("rerank failed"));

		const results = await engine.search("alpha", 10);

		expect(engine.buildFileItemsFromSmallChunks).toHaveBeenCalledWith(
			"alpha",
			[
				expect.objectContaining({ id: 11 }),
				expect.objectContaining({ id: 22 }),
			],
			10,
		);
		expect(results).toEqual([{ id: 11 }, { id: 22 }]);
		expect(engine.consumeSearchFallbackNoticeKey()).toBe(
			"hybridNotice.searchRerankFallbackToBm25",
		);
	});
});
