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

function createJsonFetchResponse(body: unknown) {
	return {
		ok: true,
		status: 200,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type" ? "application/json" : null,
		},
		text: async () => JSON.stringify(body),
	};
}

function createEmbedding(index: number, dim: number): number[] {
	const vector = new Array(dim).fill(0);
	vector[0] = 1;
	vector[1] = index + 1;
	return vector;
}

function createEmbeddingFetchMock() {
	const { EMBED_DIM } = require("src/services/search/hybrid/hybrid-types");
	return jest.fn(async (_url: string, init: { body?: string }) => {
		const body = JSON.parse(init.body ?? "{}") as { input?: string[] };
		const input = body.input ?? [];
		return createJsonFetchResponse({
			data: input.map((_text, index) => ({
				index,
				embedding: createEmbedding(index, EMBED_DIM),
			})),
			usage: { total_tokens: 0 },
		});
	});
}

async function waitForEmbeddingQueue(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 340));
	await Promise.resolve();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 20; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for condition");
}

function setHybridSetting(overrides: Record<string, unknown> = {}) {
	mockInstanceMap.set(require("src/globals/plugin-setting").OuterSetting, {
		hybrid: {
			enabled: true,
			apiKey: "test-key",
			apiDomain: "example.com",
			weeklyTokenLimit: 0,
			...overrides,
		},
	});
}

describe("Embedder response validation", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockInstanceMap.clear();
		setHybridSetting();
	});

	afterEach(() => {
		delete (global as any).fetch;
	});

	test("rejects provider responses with a missing embedding item", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = jest.fn().mockResolvedValue(
			createJsonFetchResponse({
				data: [
					{
						index: 0,
						embedding: [0.1, 0.2, 0.3],
					},
				],
			}),
		);

		const embedder = new Embedder();

		await expect(
			(embedder as any).fetchEmbeddings(["alpha", "beta"]),
		).rejects.toThrow("count mismatch");
	});

	test("rejects provider responses with the wrong vector dimension", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		const { EMBED_DIM } = require("src/services/search/hybrid/hybrid-types");
		(global as any).fetch = jest.fn().mockResolvedValue(
			createJsonFetchResponse({
				data: [
					{
						index: 0,
						embedding: new Array(EMBED_DIM - 1).fill(0),
					},
				],
			}),
		);

		const embedder = new Embedder();

		await expect(
			(embedder as any).fetchEmbeddings(["alpha"]),
		).rejects.toThrow("dimension mismatch");
	});

	test("reports a clear error when a successful response is HTML", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: {
				get: (name: string) =>
					name.toLowerCase() === "content-type" ? "text/html" : null,
			},
			text: async () => "<!DOCTYPE html><html><title>Login</title></html>",
		});

		const embedder = new Embedder();

		await expect(
			(embedder as any).fetchEmbeddings(["alpha"]),
		).rejects.toThrow("returned non-JSON response");
		await expect(
			(embedder as any).fetchEmbeddings(["alpha"]),
		).rejects.toThrow("contentType=text/html");
	});
});

describe("Embedder chunk queue", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockInstanceMap.clear();
		setHybridSetting();
	});

	afterEach(() => {
		delete (global as any).fetch;
	});

	test("coalesces concurrent Qwen single-chunk calls and caps requests at ten inputs", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = createEmbeddingFetchMock();
		const embedder = new Embedder();

		const promises = Array.from({ length: 12 }, (_value, index) =>
			embedder.embedBatch([`chunk-${index}`], "int8", `note-${index}.md`),
		);
		await waitForEmbeddingQueue();
		await Promise.all(promises);

		expect((global as any).fetch).toHaveBeenCalledTimes(2);
		const requestInputs = (global as any).fetch.mock.calls.map(
			([_url, init]: [string, { body: string }]) =>
				(JSON.parse(init.body) as { input: string[] }).input,
		);
		expect(requestInputs.map((input: string[]) => input.length)).toEqual([10, 2]);
		expect(requestInputs.flat()).toEqual(
			Array.from({ length: 12 }, (_value, index) => `chunk-${index}`),
		);
	});

	test("uses the larger OpenAI synchronous embedding batch cap", async () => {
		setHybridSetting({ embeddingProvider: "openai" });
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = createEmbeddingFetchMock();
		const embedder = new Embedder();

		const promises = Array.from({ length: 101 }, (_value, index) =>
			embedder.embedBatch([`chunk-${index}`], "int8", `note-${index}.md`),
		);
		await waitForEmbeddingQueue();
		await Promise.all(promises);

		expect((global as any).fetch).toHaveBeenCalledTimes(2);
		const requestInputs = (global as any).fetch.mock.calls.map(
			([_url, init]: [string, { body: string }]) =>
				(JSON.parse(init.body) as { input: string[] }).input,
		);
		expect(requestInputs.map((input: string[]) => input.length)).toEqual([100, 1]);
	});

	test("preserves each embedBatch caller order while interleaving queued work", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = createEmbeddingFetchMock();
		const embedder = new Embedder();

		const first = embedder.embedBatch(["a-0", "a-1"], "int8", "a.md");
		const second = embedder.embedBatch(["b-0"], "float16", "b.md");
		await waitForEmbeddingQueue();
		const [firstVectors, secondVectors] = await Promise.all([first, second]);

		expect(firstVectors).toHaveLength(2);
		expect(firstVectors[0].precision).toBe("int8");
		expect(firstVectors[1].precision).toBe("int8");
		expect(secondVectors).toHaveLength(1);
		expect(secondVectors[0].precision).toBe("float16");
		const [, init] = (global as any).fetch.mock.calls[0];
		expect((JSON.parse(init.body) as { input: string[] }).input).toEqual([
			"a-0",
			"a-1",
			"b-0",
		]);
	});

	test("serves repeated embedQuery calls from cache after the first request", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = createEmbeddingFetchMock();
		const embedder = new Embedder();

		const first = embedder.embedQuery("cached query", "int8", "<query>");
		await waitForEmbeddingQueue();
		await first;
		await embedder.embedQuery("cached query", "int8", "<query>");

		expect((global as any).fetch).toHaveBeenCalledTimes(1);
	});

	test("prioritizes embedQuery instead of waiting behind a full flush delay", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = createEmbeddingFetchMock();
		const embedder = new Embedder();

		const background = embedder.embedBatch(["background"], "int8", "note.md");
		const query = embedder.embedQuery("query", "int8", "<query>");
		await waitForEmbeddingQueue();
		await Promise.all([background, query]);

		const [, init] = (global as any).fetch.mock.calls[0];
		expect((JSON.parse(init.body) as { input: string[] }).input[0]).toBe("query");
	});

	test("rejects every caller in a failed provider batch with provider details", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = jest.fn().mockResolvedValue({
			ok: false,
			status: 403,
			headers: {
				get: (name: string) =>
					name.toLowerCase() === "content-type" ? "application/json" : null,
			},
			text: async () =>
				JSON.stringify({
					code: "Forbidden",
					message: "denied",
					request_id: "request-1",
				}),
		});
		const embedder = new Embedder();

		const first = embedder.embedBatch(["a"], "int8", "a.md");
		const second = embedder.embedBatch(["b"], "int8", "b.md");
		const firstExpectation = expect(first).rejects.toMatchObject({
			kind: "auth_403",
			status: 403,
			requestId: "request-1",
		});
		const secondExpectation = expect(second).rejects.toMatchObject({
			kind: "auth_403",
			status: 403,
			requestId: "request-1",
		});
		await waitForEmbeddingQueue();

		await firstExpectation;
		await secondExpectation;
		expect((global as any).fetch).toHaveBeenCalledTimes(1);
	});

	test("rejects queued work when its abort signal fires before flush", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		(global as any).fetch = createEmbeddingFetchMock();
		const embedder = new Embedder();
		const controller = new AbortController();

		const promise = embedder.embedBatch(
			["abort me"],
			"int8",
			"abort.md",
			controller.signal,
		);
		controller.abort();
		await expect(promise).rejects.toThrow("aborted");
		await waitForEmbeddingQueue();

		expect((global as any).fetch).not.toHaveBeenCalled();
	});

	test("rejects queued work when its abort signal fires during the provider request", async () => {
		const { Embedder } = require("src/services/search/hybrid/embedder");
		const { EMBED_DIM } = require("src/services/search/hybrid/hybrid-types");
		let resolveFetch!: (value: unknown) => void;
		(global as any).fetch = jest.fn(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const embedder = new Embedder();
		const controller = new AbortController();

		const promise = embedder.embedQuery(
			"abort during request",
			"int8",
			"<query>",
			controller.signal,
		);
		const expectation = expect(promise).rejects.toThrow("aborted");
		await waitUntil(() => (global as any).fetch.mock.calls.length === 1);
		controller.abort();
		await expectation;
		resolveFetch(
			createJsonFetchResponse({
				data: [{ index: 0, embedding: createEmbedding(0, EMBED_DIM) }],
				usage: { total_tokens: 0 },
			}),
		);
		await waitForEmbeddingQueue();

		expect((global as any).fetch).toHaveBeenCalledTimes(1);
		const [, init] = (global as any).fetch.mock.calls[0] as [
			string,
			{ signal?: AbortSignal },
		];
		expect(init.signal?.aborted).toBe(true);
	});
});

describe("DashScope API domain normalization", () => {
	test.each([
		[undefined, "dashscope.aliyuncs.com"],
		["", "dashscope.aliyuncs.com"],
		["dashscope.aliyuncs.com", "dashscope.aliyuncs.com"],
		["dashscope.aliyuncs.com/", "dashscope.aliyuncs.com"],
		["dashscope.aliyuncs.com/compatible-mode", "dashscope.aliyuncs.com"],
		["dashscope.aliyuncs.com/compatible-mode/", "dashscope.aliyuncs.com"],
		["http://dashscope.aliyuncs.com/compatible-mode/", "dashscope.aliyuncs.com"],
		["https://dashscope.aliyuncs.com/compatible-mode/", "dashscope.aliyuncs.com"],
	])("normalizes %p to %p", (input, expected) => {
		const { normalizeApiDomain } = require("src/services/search/hybrid/embedder");

		expect(normalizeApiDomain(input)).toBe(expected);
	});

	test("builds compatible-mode path for embeddings from the normalized host", () => {
		const { buildDashScopeApiUrl } = require("src/services/search/hybrid/embedder");

		expect(
			buildDashScopeApiUrl("dashscope.aliyuncs.com/compatible-mode/", "embedding"),
		).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings");
	});

	test("builds provider-specific embedding URLs and request bodies", () => {
		const {
			buildEmbeddingApiUrl,
			buildEmbeddingRequestBody,
		} = require("src/services/search/hybrid/embedder");
		const { EMBED_DIM } = require("src/services/search/hybrid/hybrid-types");

		expect(buildEmbeddingApiUrl("qwen", undefined)).toBe(
			"https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
		);
		expect(buildEmbeddingApiUrl("openai", undefined)).toBe(
			"https://api.openai.com/v1/embeddings",
		);
		expect(buildEmbeddingRequestBody("qwen", ["alpha"])).toEqual({
			model: "text-embedding-v4",
			input: ["alpha"],
			dimensions: EMBED_DIM,
			encoding_format: "float",
		});
		expect(buildEmbeddingRequestBody("openai", ["alpha"])).toEqual({
			model: "text-embedding-3-large",
			input: ["alpha"],
			dimensions: EMBED_DIM,
			encoding_format: "float",
		});
	});
});

type MockTokenRecord = {
	id?: number;
	filePath: string;
	dateKey: string;
	tokens: number;
};

type MockBudgetResetRecord = {
	id?: number;
	periodKey: string;
	tokens: number;
};

function createHybridTokenDb(
	tokenStats: MockTokenRecord[],
	budgetResets: MockBudgetResetRecord[] = [],
) {
	const tokenRows = tokenStats.map((row, index) => ({ ...row, id: row.id ?? index + 1 }));
	const resetRows = budgetResets.map((row, index) => ({ ...row, id: row.id ?? index + 1 }));
	let nextTokenId = tokenRows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
	let nextResetId = resetRows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;

	const db = {
		hybridTokenStats: {
			where(field: string) {
				if (field === 'dateKey') {
					return {
						between(fromDate: string, toDate: string) {
							const rows = tokenRows.filter(
								(row) => row.dateKey >= fromDate && row.dateKey <= toDate,
							);
							return {
								toArray: async () => rows.map((row) => ({ ...row })),
								primaryKeys: async () => rows.map((row) => row.id as number),
							};
						},
					};
				}
				if (field === '[filePath+dateKey]') {
					return {
						equals([filePath, dateKey]: [string, string]) {
							const rows = tokenRows.filter(
								(row) => row.filePath === filePath && row.dateKey === dateKey,
							);
							return {
								toArray: async () => rows.map((row) => ({ ...row })),
								first: async () => (rows[0] ? { ...rows[0] } : undefined),
							};
						},
					};
				}
				throw new Error(`Unsupported hybridTokenStats.where(${field})`);
			},
			async add(row: MockTokenRecord) {
				tokenRows.push({ ...row, id: nextTokenId++ });
			},
			async update(id: number, changes: Partial<MockTokenRecord>) {
				const target = tokenRows.find((row) => row.id === id);
				if (target) {
					Object.assign(target, changes);
				}
			},
			async bulkDelete(ids: number[]) {
				for (const id of ids) {
					const index = tokenRows.findIndex((row) => row.id === id);
					if (index >= 0) {
						tokenRows.splice(index, 1);
					}
				}
			},
		},
		hybridTokenBudgetResets: {
			where(field: string) {
				if (field !== 'periodKey') {
					throw new Error(`Unsupported hybridTokenBudgetResets.where(${field})`);
				}
				return {
					equals(periodKey: string) {
						const row = resetRows.find((item) => item.periodKey === periodKey);
						return {
							first: async () => (row ? { ...row } : undefined),
						};
					},
				};
			},
			async add(row: MockBudgetResetRecord) {
				resetRows.push({ ...row, id: nextResetId++ });
			},
			async update(id: number, changes: Partial<MockBudgetResetRecord>) {
				const target = resetRows.find((row) => row.id === id);
				if (target) {
					Object.assign(target, changes);
				}
			},
		},
		async transaction(_mode: string, ...args: any[]) {
			const callback = args[args.length - 1];
			return await callback();
		},
	};

	return {
		db,
		tokenRows,
		resetRows,
	};
}

describe('Embedder token accounting', () => {
	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-04-08T12:00:00Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test('resetting weekly quota preserves token stats and only resets budget usage', async () => {
		const { Database } = require('src/services/database/database');
		const mockDb = createHybridTokenDb([
			{ filePath: 'note-a.md', dateKey: '2026-04-06', tokens: 70 },
			{ filePath: 'note-b.md', dateKey: '2026-04-08', tokens: 30 },
			{ filePath: 'older.md', dateKey: '2026-03-15', tokens: 50 },
		]);
		mockInstanceMap.set(Database, { db: mockDb.db });

		const {
			getCurrentWeekDateRange,
			getCurrentWeekTokenUsage,
			getTotalTokens,
			recordTokenUsage,
			resetCurrentWeekTokenUsage,
		} = require('src/services/search/hybrid/embedder');

		const { fromDate, toDate } = getCurrentWeekDateRange();
		expect(await getCurrentWeekTokenUsage()).toBe(100);
		expect(await getTotalTokens(fromDate, toDate)).toBe(100);
		expect(await getTotalTokens('0000-01-01', '2026-04-08')).toBe(150);

		await resetCurrentWeekTokenUsage();

		expect(await getCurrentWeekTokenUsage()).toBe(0);
		expect(await getTotalTokens(fromDate, toDate)).toBe(100);
		expect(await getTotalTokens('0000-01-01', '2026-04-08')).toBe(150);
		expect(mockDb.tokenRows).toHaveLength(3);
		expect(mockDb.resetRows).toEqual([
			expect.objectContaining({
				periodKey: fromDate,
				tokens: 100,
			}),
		]);

		await recordTokenUsage('note-c.md', 25);
		expect(await getCurrentWeekTokenUsage()).toBe(25);
		expect(await getTotalTokens(fromDate, toDate)).toBe(125);
		expect(await getTotalTokens('0000-01-01', '2026-04-08')).toBe(175);
	});
});
