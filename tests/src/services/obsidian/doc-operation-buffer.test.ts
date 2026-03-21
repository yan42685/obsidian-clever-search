import {
	DocAddOperation,
	DocDeleteOperation,
	DocOperationBuffer,
	DocRenameOperation,
	reduceDocOperations,
} from "src/services/obsidian/user-data/doc-operation-buffer";

function createFile(path: string) {
	return { path } as any;
}

describe("DocOperationBuffer", () => {
	test("reduceDocOperations keeps only the final same-path intent", () => {
		const reduced = reduceDocOperations([
			new DocAddOperation(createFile("note.md")),
			new DocDeleteOperation("note.md"),
			new DocAddOperation(createFile("note.md")),
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

		buffer.add(new DocAddOperation(createFile("note.md")));
		buffer.add(new DocDeleteOperation("note.md"));
		buffer.add(new DocAddOperation(createFile("note.md")));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "upsert",
				path: "note.md",
			}),
		]);
	});

	test("reduces rename followed by modify on new path to delete old and upsert new", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99);

		buffer.add(new DocRenameOperation("old.md", createFile("new.md")));
		buffer.add(new DocAddOperation(createFile("new.md")));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "delete",
				path: "old.md",
			}),
			expect.objectContaining({
				type: "upsert",
				path: "new.md",
			}),
		]);
	});

	test("reduces chained renames to the final surviving path", async () => {
		const batches: any[] = [];
		const buffer = new DocOperationBuffer(async (operations) => {
			batches.push(operations);
		}, 99);

		buffer.add(new DocRenameOperation("a.md", createFile("b.md")));
		buffer.add(new DocRenameOperation("b.md", createFile("c.md")));
		await buffer.forceFlush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual([
			expect.objectContaining({
				type: "delete",
				path: "a.md",
			}),
			expect.objectContaining({
				type: "delete",
				path: "b.md",
			}),
			expect.objectContaining({
				type: "upsert",
				path: "c.md",
			}),
		]);
	});
});
