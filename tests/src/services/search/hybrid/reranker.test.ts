export {};

const mockInstanceMap = new Map<any, any>();
const mockReserveWeeklyTokenBudget = jest.fn();
const mockRecordTokenUsage = jest.fn();

jest.mock("src/globals/plugin-setting", () => ({
	OuterSetting: class OuterSetting {},
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
		error: jest.fn(),
		warn: jest.fn(),
	},
}));

jest.mock("src/services/search/hybrid/embedder", () => ({
	buildDashScopeApiUrl: jest.fn(() => "https://example.com/rerank"),
	estimateTextsTokenUsage: jest.fn(() => 42),
	recordTokenUsage: (...args: any[]) => mockRecordTokenUsage(...args),
	reserveWeeklyTokenBudget: (...args: any[]) => mockReserveWeeklyTokenBudget(...args),
}));

describe("HybridReranker", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.clearAllMocks();
		mockInstanceMap.clear();
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				apiKey: "test-key",
				apiDomain: "example.com",
			},
		});
		mockReserveWeeklyTokenBudget.mockResolvedValue({
			release: jest.fn(),
		});
	});

	afterEach(() => {
		jest.useRealTimers();
		delete (global as any).fetch;
	});

	test("aborts a hung rerank request after the hard timeout without retrying", async () => {
		const { HybridReranker, HybridRerankTimeoutError } = require("src/services/search/hybrid/reranker");
		(global as any).fetch = jest.fn((_url: string, init?: { signal?: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const error = new Error("aborted");
					(error as Error & { name: string }).name = "AbortError";
					reject(error);
				});
			}),
		);

		const reranker = new HybridReranker();
		const promise = reranker.rerank(
			"alpha",
			[
				{
					id: 1,
					filePath: "notes/a.md",
					text: "alpha",
					startLine: 0,
					startCol: 0,
					endLine: 0,
					recallScore: 1,
				},
			],
			1,
		);
		const timeoutExpectation = expect(promise).rejects.toBeInstanceOf(HybridRerankTimeoutError);

		await jest.advanceTimersByTimeAsync(2_800);

		await timeoutExpectation;
		expect((global as any).fetch).toHaveBeenCalledTimes(1);
		expect(mockReserveWeeklyTokenBudget).toHaveBeenCalledTimes(1);
	});
});
