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
			: provider === "gemini"
				? "https://api.vectorengine.ai/v1beta/models/gemini-3.1-flash-lite-preview:generateContent"
				: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
	),
	getEmbeddingProviderSpec: jest.fn((provider: string) => ({
		id: provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "qwen",
		label:
			provider === "openai"
				? "OpenAI text-embedding-3-large"
				: provider === "gemini"
					? "Gemini embedding-2-preview + Gemini 3.1 Flash Lite Preview"
				: "Qwen text-embedding-v4",
		embeddingModel:
			provider === "openai"
				? "text-embedding-3-large"
				: provider === "gemini"
					? "gemini-embedding-2-preview"
				: "text-embedding-v4",
		rerankModel:
			provider === "openai"
				? "gpt-5.4-nano"
				: provider === "gemini"
					? "gemini-3.1-flash-lite-preview"
					: "qwen-flash",
		defaultDomain:
			provider === "openai"
				? "api.openai.com"
				: provider === "gemini"
					? "api.vectorengine.ai"
					: "dashscope.aliyuncs.com",
	})),
	normalizeEmbeddingProvider: jest.fn((provider: string) =>
		provider === "openai" || provider === "gemini" ? provider : "qwen",
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

		await jest.advanceTimersByTimeAsync(15_000);

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
					message: "Model access denied for qwen-flash.",
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
						{ index: 1, score: 0.99, start: 5, end: 19 },
						{ index: 0, score: 0.5, start: 0, end: 9 },
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
			{ id: 2, score: 0.99, start: 5, end: 19 },
			{ id: 1, score: 0.5, start: 0, end: 9 },
		]);
		const [, init] = (global as any).fetch.mock.calls[0];
		expect(JSON.parse(init.body)).toMatchObject({
			model: "gpt-5.4-nano",
			text: { format: { type: "json_object" } },
		});
		expect(JSON.parse(init.body).input).toContain(
			"Return within 10s if possible.",
		);
		expect(JSON.parse(init.body).input).toContain(
			"Return exactly 2 results.",
		);
		expect(JSON.parse(init.body).input).toContain(
			'"start":0,"end":120',
		);
		expect(JSON.parse(init.body).input).toContain(
			"start/end are character offsets in the candidate text",
		);
		expect(mockRecordTokenUsage).toHaveBeenCalledWith(
			"[search] gpt-5.4-nano",
			12,
		);
	});

	test("uses Qwen Flash chat completions for Qwen rerank", async () => {
		const { HybridReranker } = require("src/services/search/hybrid/reranker");
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				apiKey: "test-key",
				apiDomain: "dashscope.aliyuncs.com",
				embeddingProvider: "qwen",
			},
		});
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: {
				get: jest.fn(() => null),
			},
			json: jest.fn().mockResolvedValue({
				choices: [
					{
						message: {
							content: JSON.stringify({
								results: [
									{ index: 1, score: 0.97, start: 4, end: 22 },
									{ index: 0, score: 0.6, start: 0, end: 12 },
								],
							}),
						},
					},
				],
				usage: { total_tokens: 15 },
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
			{ id: 2, score: 0.97, start: 4, end: 22 },
			{ id: 1, score: 0.6, start: 0, end: 12 },
		]);
		const [url, init] = (global as any).fetch.mock.calls[0];
		expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({
			model: "qwen-flash",
			response_format: { type: "json_object" },
			temperature: 0,
		});
		expect(body).not.toHaveProperty("query");
		expect(body).not.toHaveProperty("documents");
		expect(body).not.toHaveProperty("top_n");
		expect(body.messages[0].content).toContain(
			"Return within 10s if possible.",
		);
		expect(body.messages[0].content).toContain(
			"Return exactly 2 results.",
		);
		expect(body.messages[0].content).toContain(
			'"start":0,"end":120',
		);
		expect(mockRecordTokenUsage).toHaveBeenCalledWith(
			"[search] qwen-flash",
			15,
		);
	});

	test("uses Gemini generateContent rerank with Gemini flash lite preview", async () => {
		const { HybridReranker } = require("src/services/search/hybrid/reranker");
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				apiKey: "test-key",
				apiDomain: "api.vectorengine.ai",
				embeddingProvider: "gemini",
			},
		});
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: {
				get: jest.fn(() => null),
			},
			json: jest.fn().mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										results: [
											{ index: 1, score: 0.96, start: 7, end: 25 },
											{ index: 0, score: 0.42, start: 0, end: 10 },
										],
									}),
								},
							],
						},
					},
				],
				usageMetadata: { totalTokenCount: 18 },
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
						text: "some alpha context",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.8,
					},
					{
						id: 2,
						filePath: "notes/b.md",
						text: "strong alpha answer with surrounding context",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.7,
					},
				],
				2,
			),
		).resolves.toEqual([
			{ id: 2, score: 0.96, start: 7, end: 25 },
			{ id: 1, score: 0.42, start: 0, end: 10 },
		]);
		const [url, init] = (global as any).fetch.mock.calls[0];
		expect(url).toBe(
			"https://api.vectorengine.ai/v1beta/models/gemini-3.1-flash-lite-preview:generateContent",
		);
		const body = JSON.parse(init.body);
		expect(body.generationConfig).toEqual({
			responseMimeType: "application/json",
		});
		expect(body.contents[0].parts[0].text).toContain(
			"Return within 10s if possible.",
		);
		expect(body.contents[0].parts[0].text).toContain(
			"Return exactly 2 results.",
		);
		expect(body.contents[0].parts[0].text).toContain(
			'"start":0,"end":120',
		);
		expect(body.contents[0].parts[0].text).toContain(
			"start/end are character offsets in the candidate text",
		);
		expect(mockRecordTokenUsage).toHaveBeenCalledWith(
			"[search] gemini-3.1-flash-lite-preview",
			18,
		);
	});

	test("filters rerank items far below the top score", async () => {
		const { HybridReranker } = require("src/services/search/hybrid/reranker");
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				apiKey: "test-key",
				apiDomain: "api.vectorengine.ai",
				embeddingProvider: "gemini",
			},
		});
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: {
				get: jest.fn(() => null),
			},
			json: jest.fn().mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										results: [
											{ index: 0, score: 0.95 },
											{ index: 1, score: 0 },
											{ index: 2, score: 0.2 },
										],
									}),
								},
							],
						},
					},
				],
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
						text: "best alpha",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.9,
					},
					{
						id: 2,
						filePath: "notes/b.md",
						text: "weak",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.8,
					},
					{
						id: 3,
						filePath: "notes/c.md",
						text: "also weak",
						startLine: 0,
						startCol: 0,
						endLine: 0,
						recallScore: 0.7,
					},
				],
				3,
			),
		).resolves.toEqual([{ id: 1, score: 0.95 }]);
	});

	test("caps LLM rerank results at three even when provider returns more", async () => {
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
						{ index: 0, score: 1 },
						{ index: 1, score: 0.9 },
						{ index: 2, score: 0.8 },
						{ index: 3, score: 0.7 },
					],
				}),
			}),
		});

		const reranker = new HybridReranker();

		await expect(
			reranker.rerank(
				"alpha",
				[0, 1, 2, 3].map((id) => ({
					id,
					filePath: `notes/${id}.md`,
					text: `alpha ${id}`,
					startLine: 0,
					startCol: 0,
					endLine: 0,
					recallScore: 1,
				})),
				10,
			),
		).resolves.toEqual([
			{ id: 0, score: 1, start: undefined, end: undefined },
			{ id: 1, score: 0.9, start: undefined, end: undefined },
			{ id: 2, score: 0.8, start: undefined, end: undefined },
		]);
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
