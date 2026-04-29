import type { IndexedDocument } from "src/globals/search-types";
import {
	buildActiveOverlayJournalEntryId,
	createDexieActiveOverlayJournalStore,
	materializeOverlayDocuments,
	MemoryActiveOverlayJournalStore,
	type ActiveOverlayJournalEntry,
} from "src/services/search/coverage-lexical-v3/active-overlay-journal";

class FakeOverlayTable<Row extends Record<string, unknown>, Key extends string> {
	private rows = new Map<Key, Row>();

	constructor(private readonly keyOf: (row: Row) => Key) {}

	async toArray(): Promise<Row[]> {
		return [...this.rows.values()];
	}

	async bulkPut(rows: readonly Row[]): Promise<void> {
		for (const row of rows) {
			this.rows.set(this.keyOf(row), row);
		}
	}

	async delete(key: Key): Promise<void> {
		this.rows.delete(key);
	}

	async clear(): Promise<void> {
		this.rows.clear();
	}
}

function doc(path: string, content: string, docRef: number, generation = 1): IndexedDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		folder: "notes",
		content,
		docRef,
		generation,
	};
}

function entry(sequence: number, path = `doc-${sequence}.md`): ActiveOverlayJournalEntry {
	const activeShardId = "active-1";
	const activeShardGeneration = 1;
	return {
		id: buildActiveOverlayJournalEntryId({
			activeShardId,
			activeShardGeneration,
			sequence,
		}),
		sequence,
		activeShardId,
		activeShardGeneration,
		operation: "append",
		document: doc(path, "alpha", sequence),
		sourceBytes: 128,
		createdAt: 10 + sequence,
	};
}

describe("coverage lexical v3 active overlay journal", () => {
	test("memory store dedupes ids and loads entries in sequence order", async () => {
		const store = new MemoryActiveOverlayJournalStore();

		await store.appendEntries([entry(2), entry(1), entry(2, "updated.md")]);

		expect(
			(await store.loadEntries({ activeShardId: "active-1", activeShardGeneration: 1 })).map(
				(row) => row.document?.path,
			),
		).toEqual(["doc-1.md", "updated.md"]);
	});

	test("materialized overlay keeps the latest document version for a docRef", () => {
		const first = entry(1, "doc.md");
		const second: ActiveOverlayJournalEntry = {
			...entry(2, "doc.md"),
			document: doc("doc.md", "beta", 1, 2),
			previousVersion: {
				shardId: "active-1:overlay",
				shardGeneration: 1,
				docRef: 1,
				docGeneration: 1,
			},
		};

		expect(materializeOverlayDocuments([first, second])).toEqual([
			expect.objectContaining({
				content: "beta",
				docRef: 1,
				generation: 2,
			}),
		]);
	});

	test("dexie store removes selected entries and clears by active shard", async () => {
		const store = createDexieActiveOverlayJournalStore(
			new FakeOverlayTable<ActiveOverlayJournalEntry, string>((row) => row.id),
		);
		await store.appendEntries([
			entry(1),
			entry(2),
			{ ...entry(3), activeShardId: "active-2" },
		]);

		await store.removeEntries([entry(1).id]);
		expect(
			(await store.loadEntries({ activeShardId: "active-1", activeShardGeneration: 1 })).map(
				(row) => row.sequence,
			),
		).toEqual([2]);

		await store.clearEntriesForActiveShard({
			activeShardId: "active-1",
			activeShardGeneration: 1,
		});
		expect(
			await store.loadEntries({ activeShardId: "active-1", activeShardGeneration: 1 }),
		).toHaveLength(0);
		expect(
			await store.loadEntries({ activeShardId: "active-2", activeShardGeneration: 1 }),
		).toHaveLength(1);
	});
});
