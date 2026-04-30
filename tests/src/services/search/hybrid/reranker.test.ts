export {};

const mockInstanceMap = new Map<any, any>();
const mockReserveWeeklyTokenBudget = jest.fn();
const mockRecordTokenUsage = jest.fn();
const mockLogger = {
	error: jest.fn(),
	warn: jest.fn(),
};

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
	logger: mockLogger,
}));

jest.mock("src/services/search/hybrid/embedder", () => ({
	buildProviderApiUrl: jest.fn((provider: string) =>
		provider === "openai"
			? "https://api.openai.com/v1/responses"
			: "https://example.com/rerank",
	),
	getEmbeddingProviderSpec: jest.fn((provider: string) => ({
		id: provider === "openai" ? "openai" : "qwen",
		label:
			provider === "openai"
				? "OpenAI text-embedding-3-large"
				: "Qwen text-embedding-v4",
		embeddingModel:
			provider === "openai"
				? "text-embedding-3-large"
				: "text-embedding-v4",
		rerankModel: provider === "openai" ? "gpt-5.4-nano" : "qwen3-rerank",
		defaultDomain: provider === "openai" ? "api.openai.com" : "dashscope.aliyuncs.com",
	})),
	normalizeEmbeddingProvider: jest.fn((provider: string) =>
		provider === "openai" ? "openai" : "qwen",
	),
	NoApiKeyError: class NoApiKeyError extends Error {
		constructor() {
			super("No embedding provider API key configured");
			this.name = "NoApiKeyError";
		}
	},
	WeeklyTokenLimitExceededError: class WeeklyTokenLimitExceededError extends Error {
		constructor() {
			super("Weekly token limit exceeded");
			this.name = "WeeklyTokenLimitExceededError";
		}
	},
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

		await jest.advanceTimersByTimeAsync(5_000);

		await timeoutExpectation;
		expect((global as any).fetch).toHaveBeenCalledTimes(1);
		expect(mockReserveWeeklyTokenBudget).toHaveBeenCalledTimes(1);
	});

	test("classifies a 403 rerank response and preserves provider metadata", async () => {
		const { HybridReranker, HybridRerankError } = require("src/services/search/hybrid/reranker");
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: false,
			status: 403,
			headers: {
				get: jest.fn(() => null),
			},
			text: jest.fn().mockResolvedValue(
				JSON.stringify({
					code: "AccessDenied",
					message: "Model access denied for qwen3-rerank.",
					request_id: "req-403",
				}),
			),
		});

		const reranker = new HybridReranker();

		await expect(
			reranker.rerank(
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
			),
		).rejects.toMatchObject<InstanceType<typeof HybridRerankError>>({
			kind: "auth_403",
			status: 403,
			providerCode: "AccessDenied",
			requestId: "req-403",
		});
	});

	test("classifies quota-style 429 responses as quota exhaustion", async () => {
		const { HybridReranker, HybridRerankError } = require("src/services/search/hybrid/reranker");
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: false,
			status: 429,
			headers: {
				get: jest.fn(() => null),
			},
			text: jest.fn().mockResolvedValue(
				JSON.stringify({
					error: {
						message: "You exceeded your current quota, please check your plan and billing details.",
						type: "rate_limit_error",
						code: "insufficient_quota",
					},
				}),
			),
		});

		const reranker = new HybridReranker();

		await expect(
			reranker.rerank(
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
			),
		).rejects.toMatchObject<InstanceType<typeof HybridRerankError>>({
			kind: "quota_exhausted",
			status: 429,
			providerCode: "insufficient_quota",
		});
	});

	test("classifies transport failures as network errors", async () => {
		const { HybridReranker, HybridRerankError } = require("src/services/search/hybrid/reranker");
		(global as any).fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

		const reranker = new HybridReranker();

		await expect(
			reranker.rerank(
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
			),
		).rejects.toMatchObject<InstanceType<typeof HybridRerankError>>({
			kind: "network",
		});
	});

	test("uses OpenAI Responses API with gpt-5.4-nano when OpenAI provider is selected", async () => {
		const { HybridReranker } = require("src/services/search/hybrid/reranker");
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				apiKey: "test-key",
				apiDomain: "api.openai.com",
				embeddingProvider: "openai",
			},
		});
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: {
				get: jest.fn(() => null),
			},
			json: jest.fn().mockResolvedValue({
				output_text: JSON.stringify({
					results: [
						{ index: 1, score: 0.99 },
						{ index: 0, score: 0.5 },
					],
				}),
				usage: { total_tokens: 12 },
			}),
		});

		const reranker = new HybridReranker();

		await expect(
			reranker.rerank(
				"alpha",
				[
					{
						id: 1,
						filePath: "notes/a.md",
						text: "less relevant",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.8,
					},
					{
						id: 2,
						filePath: "notes/b.md",
						text: "more relevant alpha",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.7,
					},
				],
				2,
			),
		).resolves.toEqual([
			{ id: 2, score: 0.99 },
			{ id: 1, score: 0.5 },
		]);
		const [, init] = (global as any).fetch.mock.calls[0];
		expect(JSON.parse(init.body)).toMatchObject({
			model: "gpt-5.4-nano",
			text: { format: { type: "json_object" } },
		});
		expect(mockRecordTokenUsage).toHaveBeenCalledWith(
			"[search] gpt-5.4-nano",
			12,
		);
	});

	test("throws when rerank is requested without an API key", async () => {
		const { HybridReranker } = require("src/services/search/hybrid/reranker");
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				apiKey: "",
				apiDomain: "example.com",
			},
		});

		const reranker = new HybridReranker();

		await expect(
			reranker.rerank(
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
			),
		).rejects.toMatchObject({
			name: "NoApiKeyError",
		});
		expect((global as any).fetch).toBeUndefined();
	});
});
