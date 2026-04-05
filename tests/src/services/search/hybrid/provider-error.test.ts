import {
	buildHybridProviderErrorDetails,
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
});
