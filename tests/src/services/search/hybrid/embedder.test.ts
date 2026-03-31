export {};

const mockInstanceMap = new Map<any, any>();

jest.mock("src/globals/plugin-setting", () => ({
	OuterSetting: class OuterSetting {},
}));

jest.mock("src/services/database/database", () => ({
	Database: class Database {},
}));

jest.mock("src/services/obsidian/transformed-api", () => ({
	MyNotice: class MyNotice {
		constructor(_message: string, _timeout?: number) {}
	},
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn((token: any) => {
		if (!mockInstanceMap.has(token)) {
			throw new Error(`Missing test instance for token: ${token?.name ?? String(token)}`);
		}
		return mockInstanceMap.get(token);
	}),
	MyLib: {
		sleep: async (_ms: number) => undefined,
	},
}));

jest.mock("src/utils/logger", () => ({
	logger: {
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	},
}));

jest.mock("throttle-debounce", () => ({
	throttle: (_ms: number, fn: (...args: any[]) => unknown) => fn,
}));

jest.mock("src/services/search/hybrid/hybrid-profiler", () => ({
	profileHybridStage: async (_name: string, fn: () => Promise<unknown>) => await fn(),
	recordHybridProfileMetric: jest.fn(),
}));

describe("Embedder response validation", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockInstanceMap.clear();
		mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
			hybrid: {
				enabled: true,
				apiKey: "test-key",
				apiDomain: "example.com",
			},
		});
	});

	afterEach(() => {
		delete (global as any).fetch;
	});

	test("rejects provider responses with a missing embedding item", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						index: 0,
						embedding: [0.1, 0.2, 0.3],
					},
				],
			}),
		});

		const embedder = new Embedder();

		await expect(
			(embedder as any).fetchEmbeddings(["alpha", "beta"]),
		).rejects.toThrow("count mismatch");
	});

	test("rejects provider responses with the wrong vector dimension", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		const { EMBED_DIM } = require("src/services/search/hybrid/hybrid-types");
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						index: 0,
						embedding: new Array(EMBED_DIM - 1).fill(0),
					},
				],
			}),
		});

		const embedder = new Embedder();

		await expect(
			(embedder as any).fetchEmbeddings(["alpha"]),
		).rejects.toThrow("dimension mismatch");
	});
});
