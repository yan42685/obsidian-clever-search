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
	buildIndexedSnapshotRequestKey: (request: { path: string; generation?: number }) =>
		`${request.path}\0${request.generation ?? ""}`,
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
		mockInstanceMap.set(
			require("src/services/search/shared/file-snapshot-store").FileSnapshotStore,
			{
				readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			},
		);
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
					snippetText: "File: a\n\nalpha first useful sentence. trailing unrelated text.",
					snippetHtml: "File: a\n\nalpha first useful sentence. trailing unrelated text.",
					headerText: "File: a",
					bodyText: "alpha first useful sentence. trailing unrelated text.",
					highlightRanges: [],
					bodyHighlightRanges: [],
				},
				{
					filePath: "notes/b.md",
					queryTerms: ["alpha"],
					matchedTerms: ["alpha"],
					subItems: [],
					previewContent: "b",
					nativeSubItemsReady: true,
					score: 8,
					snippetText: "File: b\n\nprefix noise. alpha second useful sentence. suffix noise.",
					snippetHtml: "File: b\n\nprefix noise. alpha second useful sentence. suffix noise.",
					headerText: "File: b",
					bodyText: "prefix noise. alpha second useful sentence. suffix noise.",
					highlightRanges: [],
					bodyHighlightRanges: [],
				},
			],
			fallbackNoticeKey,
			fallbackToLexicalSearch: false,
		};
	}

	test("search preserves the prepared fallback notice after staged finalize succeeds", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		engine._ready = true;
		engine.prepareRecall = jest.fn().mockResolvedValue(createPreparedRecall("hybridNotice.searchFallbackToLexical"));
		engine.finalizePreparedRecall = jest.fn().mockResolvedValue({
			items: [{ id: 1 }],
			fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			fallbackToLexicalSearch: false,
		});

		const results = await engine.search("alpha", 10);

		expect(results).toEqual([{ id: 1 }]);
		expect(engine.consumeSearchFallbackNoticeKey()).toBe("hybridNotice.searchFallbackToLexical");
	});

	test("finalizePreparedRecall requests lexical fallback when rerank times out", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { HybridRerankTimeoutError } = require("src/services/search/hybrid/reranker");
		const engine = new HybridEngine() as any;
		engine.recallDenseDisplayCandidates = jest.fn().mockResolvedValue([]);
		engine.rerankDisplayCandidates = jest
			.fn()
			.mockRejectedValue(new HybridRerankTimeoutError(2800));

		const finalized = await engine.finalizePreparedRecall(createPreparedRecall(), 10);

		expect(finalized.items.map((item: any) => item.id)).toEqual([
			"notes/a.md:0",
			"notes/b.md:1",
		]);
		expect(finalized.items.map((item: any) => item.freshnessState)).toEqual([
			"lexical_only",
			"lexical_only",
		]);
		expect(finalized.items.map((item: any) => item.freshnessReason)).toEqual([
			"dense_unavailable",
			"dense_unavailable",
		]);
		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(finalized.fallbackToLexicalSearch).toBe(true);
	});

	test("finalizePreparedRecall keeps prepared ordering and requests lexical fallback when rerank fails", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { HybridRerankError } = require("src/services/search/hybrid/reranker");
		const engine = new HybridEngine() as any;
		engine.recallDenseDisplayCandidates = jest.fn().mockResolvedValue([]);
		engine.rerankDisplayCandidates = jest
			.fn()
			.mockRejectedValue(
				new HybridRerankError("rerank failed", { kind: "auth_403" }),
			);

		const finalized = await engine.finalizePreparedRecall(createPreparedRecall(), 10);

		expect(finalized.items.map((item: any) => item.id)).toEqual([
			"notes/a.md:0",
			"notes/b.md:1",
		]);
		expect(finalized.items.map((item: any) => item.freshnessState)).toEqual([
			"lexical_only",
			"lexical_only",
		]);
		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(finalized.fallbackToLexicalSearch).toBe(true);
	});

	test("finalizePreparedRecall keeps the earlier fallback notice when rerank also fails", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { HybridRerankTimeoutError } = require("src/services/search/hybrid/reranker");
		const engine = new HybridEngine() as any;
		engine.recallDenseDisplayCandidates = jest.fn().mockResolvedValue([]);
		engine.rerankDisplayCandidates = jest
			.fn()
			.mockRejectedValue(new HybridRerankTimeoutError(2800));

		const finalized = await engine.finalizePreparedRecall(
			createPreparedRecall("hybridNotice.searchFallbackToLexical"),
			10,
		);

		expect(finalized.items.map((item: any) => item.id)).toEqual([
			"notes/a.md:0",
			"notes/b.md:1",
		]);
		expect(finalized.items.map((item: any) => item.freshnessState)).toEqual([
			"lexical_only",
			"lexical_only",
		]);
		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(finalized.fallbackToLexicalSearch).toBe(true);
	});

	test("finalizePreparedRecall requests lexical fallback when query embedding fails", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const { NoApiKeyError } = require("src/services/search/hybrid/embedder");
		const engine = new HybridEngine() as any;
		engine.recallDenseDisplayCandidates = jest
			.fn()
			.mockRejectedValue(new NoApiKeyError());

		const finalized = await engine.finalizePreparedRecall(createPreparedRecall(), 10);

		expect(finalized.fallbackNoticeKey).toBe("hybridNotice.searchFallbackToLexical");
		expect(finalized.fallbackToLexicalSearch).toBe(true);
		expect(finalized.items.map((item: any) => item.freshnessState)).toEqual([
			"lexical_only",
			"lexical_only",
		]);
	});

	test("rerankDisplayCandidates applies normalized rerank scores to displayed candidates", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		engine.reranker = {
			rerank: jest.fn(async () => [
				{ id: 1, score: 1.7 },
				{ id: 0, score: 0.25 },
			]),
		};

		const reranked = await engine.rerankDisplayCandidates(
			"alpha",
			createPreparedRecall().displayCandidates,
			2,
		);

		expect(reranked.map((candidate: any) => candidate.filePath)).toEqual([
			"notes/b.md",
			"notes/a.md",
		]);
		expect(reranked.map((candidate: any) => candidate.score)).toEqual([1, 0.25]);
	});

	test("rerankDisplayCandidates applies returned offset window to displayed snippet", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		engine.reranker = {
			rerank: jest.fn(async () => [
				{ id: 1, score: 0.92, start: 14, end: 43 },
			]),
		};

		const reranked = await engine.rerankDisplayCandidates(
			"alpha",
			createPreparedRecall().displayCandidates,
			2,
		);

		expect(reranked).toHaveLength(1);
		expect(reranked[0].filePath).toBe("notes/b.md");
		expect(reranked[0].bodyText).toBe("alpha second useful sentence.");
		expect(reranked[0].snippetText).toBe(
			"File: b\n\nalpha second useful sentence.",
		);
		expect(reranked[0].snippetHtml).toBe(
			"File: b\n\nalpha second useful sentence.",
		);
		expect(reranked[0].score).toBe(0.92);
	});

	test("rerankDisplayCandidates does not re-add candidates omitted by rerank", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		engine.reranker = {
			rerank: jest.fn(async () => [{ id: 0, score: 0.95 }]),
		};

		const reranked = await engine.rerankDisplayCandidates(
			"alpha",
			createPreparedRecall().displayCandidates,
			2,
		);

		expect(reranked.map((candidate: any) => candidate.filePath)).toEqual([
			"notes/a.md",
		]);
		expect(reranked.map((candidate: any) => candidate.score)).toEqual([0.95]);
	});

	test("Gemini provider finalizes with lexical and dense candidates through rerank", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;
		const outerSetting = mockInstanceMap.get(require("src/globals/plugin-setting").OuterSetting);
		outerSetting.hybrid.embeddingProvider = "gemini";
		const prepared = createPreparedRecall();
		engine.recallDenseDisplayCandidates = jest.fn().mockResolvedValue([
			{
				filePath: "notes/dense.md",
				score: 0.81,
			},
		]);
		engine.rerankDisplayCandidates = jest.fn(async (_query, candidates) => [
			candidates[2],
			candidates[0],
		]);

		const finalized = await engine.finalizePreparedRecall(prepared, 10);

		expect(engine.recallDenseDisplayCandidates).toHaveBeenCalledWith(
			"alpha",
			prepared.displayCandidates.slice(0, 6),
			14,
			undefined,
		);
		expect(engine.rerankDisplayCandidates).toHaveBeenCalledWith(
			"alpha",
			[
				...prepared.displayCandidates.slice(0, 6),
				{ filePath: "notes/dense.md", score: 0.81 },
			],
			10,
			undefined,
		);
		expect(finalized.items.map((item: any) => item.id)).toEqual([
			"notes/dense.md:0",
			"notes/a.md:1",
		]);
		expect(finalized.fallbackToLexicalSearch).toBe(false);
	});

	test("Gemini provider prepares lexical lane candidates", async () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const lexicalLane = require("src/services/search/hybrid/lexical-lane");
		const engine = new HybridEngine() as any;
		const outerSetting = mockInstanceMap.get(require("src/globals/plugin-setting").OuterSetting);
		outerSetting.hybrid.embeddingProvider = "gemini";
		engine._ready = true;
		lexicalLane.buildHybridLexicalLaneFileShortlist.mockResolvedValue([
			{ path: "notes/a.md" },
		]);
		lexicalLane.prepareHybridLexicalLaneSearch.mockResolvedValue([
			{ filePath: "notes/a.md", score: 0.5 },
		]);

		const prepared = await engine.prepareRecall("alpha", 10);

		expect(prepared.displayCandidates).toEqual([
			{ filePath: "notes/a.md", score: 0.5 },
		]);
		expect(prepared.fallbackToLexicalSearch).toBe(false);
		expect(lexicalLane.buildHybridLexicalLaneFileShortlist).toHaveBeenCalled();
		expect(lexicalLane.prepareHybridLexicalLaneSearch).toHaveBeenCalled();
	});

	test("dense display candidates preserve snapshot generation and source", () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;

		const candidate = engine.buildDenseDisplayCandidate(
			{
				filePath: "notes/a.md",
				startOffset: 0,
				endOffset: 11,
			},
			"notes/a.md",
			0.91,
			"hello world",
			[0],
			123,
			"shadow",
		);

		expect(candidate).toMatchObject({
			filePath: "notes/a.md",
			snapshotGeneration: 123,
			snapshotSource: "shadow",
		});
	});

	test("drops dense candidate when positional overlap covers at least 70% of lexical span", () => {
		const { HybridEngine } = require("src/services/search/hybrid/hybrid-engine");
		const engine = new HybridEngine() as any;

		const covered = engine.isDenseCandidateCoveredByLexical(
			{
				filePath: "notes/a.md",
				startOffset: 20,
				endOffset: 90,
			},
			[
				{
					filePath: "notes/a.md",
					coreStart: 10,
					coreEnd: 100,
				},
			],
		);
		const uncovered = engine.isDenseCandidateCoveredByLexical(
			{
				filePath: "notes/a.md",
				startOffset: 120,
				endOffset: 180,
			},
			[
				{
					filePath: "notes/a.md",
					coreStart: 10,
					coreEnd: 100,
				},
			],
		);

		expect(covered).toBe(true);
		expect(uncovered).toBe(false);
	});
});
