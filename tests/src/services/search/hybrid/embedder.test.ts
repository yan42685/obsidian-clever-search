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