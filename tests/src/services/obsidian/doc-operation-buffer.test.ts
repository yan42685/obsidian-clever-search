import {
	DocDeleteOperation,
	DocMoveOperation,
	DocOperationBuffer,
	DocUpsertOperation,
	reduceDocOperations,
} from "src/services/obsidian/user-data/doc-operation-buffer";

describe("DocOperationBuffer", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test("reduceDocOperations keeps only the final same-path intent", () => {
		const reduced = reduceDocOperations([
			new DocUpsertOperation("note.md"),
			new DocDeleteOperation("note.md"),
			new DocUpsertOperation("note.md"),
		]);

		expect(reduced).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "note.md",
					renameFromPath: undefined,
				}),
			],
			stalePaths: [],
		});
	});

	test("reduces same-path add delete add into the last upsert intent", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99);

		buffer.add(new DocUpsertOperation("note.md"));
		buffer.add(new DocDeleteOperation("note.md"));
		buffer.add(new DocUpsertOperation("note.md"));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "note.md",
					renameFromPath: undefined,
				}),
			],
			stalePaths: [],
		});
	});

	test("reduces rename followed by modify on new path to move old content and require reindex", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99);

		buffer.add(new DocMoveOperation("old.md", "new.md"));
		buffer.add(new DocUpsertOperation("new.md"));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "new.md",
					renameFromPath: "old.md",
					requiresReindex: true,
				}),
			],
			stalePaths: [
				expect.objectContaining({
					path: "old.md",
				}),
			],
		});
	});

	test("preserves the latest sourceGeneration on reduced dirty paths", () => {
		const reduced = reduceDocOperations([
			new DocUpsertOperation("note.md", 100),
			new DocUpsertOperation("note.md", 140),
			new DocMoveOperation("note.md", "renamed.md", 180),
		]);

		expect(reduced.dirtyPaths).toEqual([
			expect.objectContaining({
				path: "renamed.md",
				renameFromPath: "note.md",
				sourceGeneration: 180,
			}),
		]);
	});

	test("keeps latest sourceGeneration through rename then modify burst on new path", () => {
		const reduced = reduceDocOperations([
			new DocMoveOperation("old.md", "new.md", 120),
			new DocUpsertOperation("new.md", 160),
		]);

		expect(reduced.dirtyPaths).toEqual([
			expect.objectContaining({
				path: "new.md",
				renameFromPath: "old.md",
				requiresReindex: true,
				sourceGeneration: 160,
			}),
		]);
	});

	test("reduces chained renames to the final surviving path", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99);

		buffer.add(new DocMoveOperation("a.md", "b.md"));
		buffer.add(new DocMoveOperation("b.md", "c.md"));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "c.md",
					renameFromPath: "a.md",
					requiresReindex: false,
				}),
			],
			stalePaths: [
				expect.objectContaining({
					path: "a.md",
				}),
				expect.objectContaining({
					path: "b.md",
				}),
			],
		});
	});

	test("keeps move intent before recreating the old path", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99);

		buffer.add(new DocMoveOperation("a.md", "b.md"));
		buffer.add(new DocUpsertOperation("a.md"));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "b.md",
					renameFromPath: "a.md",
				}),
				expect.objectContaining({
					path: "a.md",
					renameFromPath: undefined,
				}),
			],
			stalePaths: [],
		});
	});

	test("reduces rename chain followed by delete to pure stale cleanup", () => {
		const reduced = reduceDocOperations([
			new DocMoveOperation("a.md", "b.md"),
			new DocMoveOperation("b.md", "c.md"),
			new DocDeleteOperation("c.md"),
		]);

		expect(reduced).toEqual({
			dirtyPaths: [],
			stalePaths: [
				expect.objectContaining({
					path: "a.md",
				}),
				expect.objectContaining({
					path: "b.md",
				}),
				expect.objectContaining({
					path: "c.md",
				}),
			],
		});
	});

	test("peekReducedBatch exposes pending dirty paths before flush", () => {
		const buffer = new DocOperationBuffer(async () => undefined, 99);

		buffer.add(new DocUpsertOperation("note.md", 120));

		expect(buffer.peekReducedBatch()).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "note.md",
					sourceGeneration: 120,
				}),
			],
			stalePaths: [],
		});
	});

	test("auto flushes after the first operation delay even below the threshold", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99, 2000);

		buffer.add(new DocUpsertOperation("note.md"));
		await jest.advanceTimersByTimeAsync(1999);
		expect(batches).toHaveLength(0);

		await jest.advanceTimersByTimeAsync(1);
		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual({
			dirtyPaths: [
				expect.objectContaining({
					path: "note.md",
				}),
			],
			stalePaths: [],
		});
	});

	test("dispose cancels pending auto flushes", async () => {
		const handler = jest.fn(async () => undefined);
		const buffer = new DocOperationBuffer(handler, 99, 2000);

		buffer.add(new DocUpsertOperation("note.md"));
		buffer.dispose();
		await jest.runOnlyPendingTimersAsync();

		expect(handler).not.toHaveBeenCalled();
		expect(buffer.peekReducedBatch()).toEqual({
			dirtyPaths: [],
			stalePaths: [],
		});
	});
});
