import {
	DocDeleteOperation,
	DocMoveOperation,
	DocOperationBuffer,
	DocUpsertOperation,
	reduceDocOperations,
} from "src/services/obsidian/user-data/doc-operation-buffer";

describe("DocOperationBuffer", () => {
	test("reduceDocOperations keeps only the final same-path intent", () => {
		const reduced = reduceDocOperations([
			new DocUpsertOperation("note.md"),
			new DocDeleteOperation("note.md"),
			new DocUpsertOperation("note.md"),
		]);

		expect(reduced).toEqual([
			expect.objectContaining({
				type: "upsert",
				path: "note.md",
			}),
		]);
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
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "upsert",
				path: "note.md",
			}),
		]);
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
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "move",
				oldPath: "old.md",
				path: "new.md",
				requiresReindex: true,
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
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "delete",
				path: "b.md",
			}),
			expect.objectContaining({
				type: "move",
				oldPath: "a.md",
				path: "c.md",
			}),
		]);
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
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "move",
				oldPath: "a.md",
				path: "b.md",
			}),
			expect.objectContaining({
				type: "upsert",
				path: "a.md",
			}),
		]);
	});
});
