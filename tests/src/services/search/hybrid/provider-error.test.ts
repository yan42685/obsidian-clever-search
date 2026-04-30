import {
	buildHybridFallbackNoticeMessage,
	buildHybridProviderErrorDetails,
	buildHybridSearchIssue,
	classifyHybridProviderFailure,
	NoApiKeyError,
	WeeklyTokenLimitExceededError,
} from "src/services/search/hybrid/provider-error";

describe("hybrid provider error helpers", () => {
	test("classifies explicit local guard errors", () => {
		expect(classifyHybridProviderFailure(new NoApiKeyError())).toBe(
			"missing_api_key",
		);
		expect(
			classifyHybridProviderFailure(
				new WeeklyTokenLimitExceededError(100, 90, 20),
			),
		).toBe("weekly_token_limit");
	});

	test("classifies API status-based failures from provider error messages", () => {
		expect(
			classifyHybridProviderFailure(
				new Error("Qwen embedding API error 403: access denied"),
			),
		).toBe("auth_403");
		expect(
			classifyHybridProviderFailure(
				new Error("Qwen rerank API error 429: rate limited"),
			),
		).toBe("provider_429");
		expect(
			classifyHybridProviderFailure(
				new Error("Qwen rerank API error 503: upstream unavailable"),
			),
		).toBe("provider_5xx");
	});

	test("detects quota and network failures from transport messages", () => {
		expect(
			classifyHybridProviderFailure(
				new Error("insufficient_quota: exceeded your current quota"),
			),
		).toBe("quota_exhausted");
		expect(
			classifyHybridProviderFailure(
				new Error("Qwen rerank API error 403: AllocationQuota.FreeTierOnly"),
			),
		).toBe("quota_exhausted");
		expect(
			classifyHybridProviderFailure(new TypeError("Failed to fetch")),
		).toBe("network");
	});

	test("parses DashScope response bodies into shared metadata", () => {
		expect(
			buildHybridProviderErrorDetails(
				403,
				JSON.stringify({
					code: "AccessDenied",
					message: "Model access denied.",
					request_id: "req-403",
				}),
			),
		).toMatchObject({
			kind: "auth_403",
			status: 403,
			providerCode: "AccessDenied",
			providerMessage: "Model access denied.",
			requestId: "req-403",
		});
	});

	test("parses OpenAI response bodies and request id headers into shared metadata", () => {
		expect(
			buildHybridProviderErrorDetails({
				provider: "openai",
				status: 401,
				body: JSON.stringify({
					error: {
						message: "Incorrect API key provided.",
						type: "invalid_request_error",
						code: "invalid_api_key",
						param: null,
					},
				}),
				requestIdHeader: "req-openai-401",
			}),
		).toMatchObject({
			provider: "openai",
			kind: "auth_401",
			status: 401,
			providerCode: "invalid_api_key",
			providerType: "invalid_request_error",
			providerMessage: "Incorrect API key provided.",
			requestId: "req-openai-401",
		});
	});

	test("classifies OpenAI insufficient quota responses as quota exhaustion", () => {
		expect(
			buildHybridProviderErrorDetails({
				provider: "openai",
				status: 429,
				body: JSON.stringify({
					error: {
						message: "You exceeded your current quota.",
						type: "insufficient_quota",
						code: "insufficient_quota",
					},
				}),
				retryAfterHeader: "30",
			}),
		).toMatchObject({
			kind: "quota_exhausted",
			providerCode: "insufficient_quota",
			providerType: "insufficient_quota",
			retryAfterHeader: "30",
		});
	});

	test("prefers provider message when building a fallback notice message", () => {
		const error = new Error("Qwen rerank API error 403");
		Object.assign(error, {
			providerMessage: "The free tier of the model has been exhausted.",
			requestId: "req-free-tier",
		});
		expect(
			buildHybridFallbackNoticeMessage(error),
		).toBe(
			"The free tier of the model has been exhausted. (request_id: req-free-tier)",
		);
	});

	test("builds a structured hybrid search issue from provider errors", () => {
		const error = new Error("Qwen rerank API error 403");
		Object.assign(error, {
			providerMessage: "The free tier of the model has been exhausted.",
			requestId: "req-free-tier",
		});
		expect(buildHybridSearchIssue(error)).toEqual({
			kind: "quota_exhausted",
			message:
				"The free tier of the model has been exhausted. (request_id: req-free-tier)",
		});
	});

	test("returns mapped known kinds without forcing generic messages", () => {
		expect(buildHybridSearchIssue(new NoApiKeyError())).toEqual({
			kind: "missing_api_key",
			message: null,
		});
	});

	test("keeps raw text for unknown structured issues", () => {
		expect(buildHybridSearchIssue(new Error("provider offline"))).toEqual({
			kind: "unknown",
			message: "provider offline",
		});
	});
});
