import type { ShardInvalidationEntry } from "src/services/search/coverage-lexical-v3/invalidation";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import type { IndexedDocument } from "src/globals/search-types";
import type { ResidentShard } from "src/services/search/coverage-lexical-v3/layout/types";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";
import {
	createDexieCoverageLexicalV3ProductionStores,
	createMemoryCoverageLexicalV3ProductionStores,
	type CoverageLexicalV3InvalidationRow,
	type CoverageLexicalV3ShardRegistryRow,
	MemoryCoverageLexicalV3InvalidationStore,
	MemoryCoverageLexicalV3ShardRegistryStore,
	recordShardInvalidationStaleStats,
	reconcileShardInvalidationStaleStats,
} from "src/services/search/coverage-lexical-v3/stores";

class FakeAsyncTable<Row extends Record<string, unknown>, Key extends string | number> {
	private rows = new Map<Key, Row>();

	constructor(private readonly keyOf: (row: Row) => Key) {}

	async toArray(): Promise<Row[]> {
		return [...this.rows.values()];
	}

	async get(key: Key): Promise<Row | undefined> {
		return this.rows.get(key);
	}

	async bulkPut(rows: readonly Row[]): Promise<void> {
		for (const row of rows) {
			this.rows.set(this.keyOf(row), row);
		}
	}

	async put(row: Row): Promise<void> {
		this.rows.set(this.keyOf(row), row);
	}

	async delete(key: Key): Promise<void> {
		this.rows.delete(key);
	}

	async clear(): Promise<void> {
		this.rows.clear();
	}
}

function shard(shardId: string, createdOrder: number): ResidentShardDescriptor {
	return {
		shardId,
		generation: 1,
		state: "sealed",
		sourceBytes: 1024,
		docCount: 1,
		createdOrder,
		artifactOwner: shardId,
	};
}

function invalidation(shardId: string, docRef: number): ShardInvalidationEntry {
	return {
		shardId,
		shardGeneration: 1,
		docRef,
		docGeneration: 1,
		reason: "superseded",
		createdAt: 1,
	};
}

function doc(path: string, content: string, docRef: number, generation = 1): IndexedDocument {
	return {
		path,
		basename: content,
		folder: "notes",
		content,
		headings: content,
		docRef,
		generation,
	};
}

function residentShard(
	shardId: string,
	generation: number,
	documents: readonly IndexedDocument[],
): ResidentShard {
	const artifacts = buildResidentHotBaseArtifacts(documents);
	return {
		shardId,
		generation,
		base: {
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		},
	};
}

describe("coverage lexical v3 production stores", () => {
	test("memory registry store saves, sorts, updates, and removes descriptors", async () => {
		const store = new MemoryCoverageLexicalV3ShardRegistryStore();

		await store.saveRegistry([shard("sealed-2", 2), shard("sealed-1", 1)]);
		expect((await store.loadRegistry()).map((entry) => entry.shardId)).toEqual([
			"sealed-1",
			"sealed-2",
		]);

		await store.updateShard({ ...shard("sealed-1", 1), state: "garbage" });
		expect((await store.loadRegistry())[0]?.state).toBe("garbage");

		await store.removeShards(["sealed-1"]);
		expect((await store.loadRegistry()).map((entry) => entry.shardId)).toEqual([
			"sealed-2",
		]);
	});

	test("memory invalidation store appends and removes by shard", async () => {
		const store = new MemoryCoverageLexicalV3InvalidationStore([
			invalidation("sealed-1", 1),
		]);

		await store.appendInvalidations([
			invalidation("sealed-2", 2),
			invalidation("sealed-1", 3),
		]);
		expect(await store.loadInvalidations()).toHaveLength(3);

		await store.removeInvalidationsForShards(["sealed-1"]);
		expect((await store.loadInvalidations()).map((entry) => entry.docRef)).toEqual([2]);

		await store.clearInvalidations();
		expect(await store.loadInvalidations()).toHaveLength(0);
	});

	test("factory creates paired production stores", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [shard("active-1", 1)],
			invalidations: [invalidation("sealed-1", 1)],
		});

		expect(await stores.shardRegistry.loadRegistry()).toHaveLength(1);
		expect(await stores.invalidations.loadInvalidations()).toHaveLength(1);
	});

	test("records stale descriptor stats for invalidated readable shard generations", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [
				{ ...shard("sealed-1", 1), sourceBytes: 1000, docCount: 4 },
				{ ...shard("sealed-2", 2), generation: 2, sourceBytes: 500, docCount: 2 },
				{ ...shard("garbage-1", 3), state: "garbage", sourceBytes: 500, docCount: 2 },
			],
		});

		await recordShardInvalidationStaleStats({
			stores,
			entries: [
				invalidation("sealed-1", 1),
				invalidation("sealed-1", 2),
				{ ...invalidation("sealed-2", 3), shardGeneration: 2 },
				invalidation("garbage-1", 4),
			],
		});

		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry.find((entry) => entry.shardId === "sealed-1")).toMatchObject({
			staleDocCount: 2,
			staleSourceBytes: 500,
		});
		expect(registry.find((entry) => entry.shardId === "sealed-2")).toMatchObject({
			staleDocCount: 1,
			staleSourceBytes: 250,
		});
		expect(registry.find((entry) => entry.shardId === "garbage-1")?.staleDocCount).toBeUndefined();
	});

	test("reconciles stale descriptor stats from durable invalidations", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [
				{ ...shard("sealed-1", 1), sourceBytes: 1000, docCount: 4 },
				{
					...shard("sealed-2", 2),
					generation: 2,
					sourceBytes: 800,
					docCount: 4,
					staleDocCount: 3,
					staleSourceBytes: 600,
				},
				{ ...shard("garbage-1", 3), state: "garbage", sourceBytes: 500, docCount: 2 },
			],
			invalidations: [
				invalidation("sealed-1", 1),
				invalidation("sealed-1", 1),
				invalidation("sealed-1", 2),
				{ ...invalidation("sealed-2", 3), shardGeneration: 2 },
				invalidation("garbage-1", 4),
			],
		});

		await expect(reconcileShardInvalidationStaleStats({ stores })).resolves.toBe(true);

		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry.find((entry) => entry.shardId === "sealed-1")).toMatchObject({
			staleDocCount: 2,
			staleSourceBytes: 500,
		});
		expect(registry.find((entry) => entry.shardId === "sealed-2")).toMatchObject({
			staleDocCount: 1,
			staleSourceBytes: 200,
		});
		expect(registry.find((entry) => entry.shardId === "garbage-1")?.staleDocCount).toBeUndefined();
		await expect(reconcileShardInvalidationStaleStats({ stores })).resolves.toBe(false);
	});

	test("dexie registry adapter saves, sorts, updates, and removes descriptors", async () => {
		const table = new FakeAsyncTable<CoverageLexicalV3ShardRegistryRow, string>(
			(row) => row.shardId,
		);
		const stores = createDexieCoverageLexicalV3ProductionStores({
			shardRegistry: table,
			invalidations: new FakeAsyncTable<CoverageLexicalV3InvalidationRow, string>(
				(row) => row.id,
			),
		});

		await stores.shardRegistry.saveRegistry([
			shard("sealed-2", 2),
			shard("sealed-1", 1),
		]);
		expect((await stores.shardRegistry.loadRegistry()).map((entry) => entry.shardId)).toEqual([
			"sealed-1",
			"sealed-2",
		]);

		await stores.shardRegistry.updateShard({
			...shard("sealed-2", 2),
			state: "garbage",
		});
		expect((await stores.shardRegistry.loadRegistry())[1]?.state).toBe("garbage");

		await stores.shardRegistry.removeShards(["sealed-1"]);
		expect((await stores.shardRegistry.loadRegistry()).map((entry) => entry.shardId)).toEqual([
			"sealed-2",
		]);
	});

	test("dexie invalidation adapter dedupes stable keys and removes by shard", async () => {
		const table = new FakeAsyncTable<CoverageLexicalV3InvalidationRow, string>(
			(row) => row.id,
		);
		const stores = createDexieCoverageLexicalV3ProductionStores({
			shardRegistry: new FakeAsyncTable<CoverageLexicalV3ShardRegistryRow, string>(
				(row) => row.shardId,
			),
			invalidations: table,
		});

		await stores.invalidations.appendInvalidations([
			invalidation("sealed-1", 1),
			invalidation("sealed-1", 1),
			invalidation("sealed-2", 2),
		]);
		expect(await stores.invalidations.loadInvalidations()).toHaveLength(2);

		await stores.invalidations.removeInvalidationsForShards(["sealed-1"]);
		expect((await stores.invalidations.loadInvalidations()).map((entry) => entry.docRef)).toEqual([
			2,
		]);

		await stores.invalidations.clearInvalidations();
		expect(await stores.invalidations.loadInvalidations()).toHaveLength(0);
	});

	test("dexie resident shard artifact store publishes, loads, and removes artifacts", async () => {
		const table = new FakeAsyncTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
			(row) => row.id,
		);
		const store = createDexieCoverageLexicalV3ResidentShardArtifactStore(table);
		const descriptor = shard("sealed-1", 1);
		const artifact = residentShard("sealed-1", 1, [doc("a.md", "alpha target", 1)]);

		await store.publishResidentShardArtifact({
			descriptor,
			shard: artifact,
			createdAt: 42,
		});

		const loaded = await store.loadResidentShard(descriptor);
		expect(loaded?.shardId).toBe("sealed-1");
		expect(loaded?.generation).toBe(1);
		expect(loaded?.base.docTable.docCount).toBe(1);

		await store.removeResidentShardArtifact(descriptor);
		expect(await store.loadResidentShard(descriptor)).toBeUndefined();
	});
});
