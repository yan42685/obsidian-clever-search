import type { IndexedDocument } from "src/globals/search-types";
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { loadCurrentActiveDocuments } from "src/services/search/coverage-lexical-v3/active-document-source";
import { publishActiveShardAppend } from "src/services/search/coverage-lexical-v3/active-shard-publisher";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";
import { createMemoryCoverageLexicalV3ProductionStores } from "src/services/search/coverage-lexical-v3/stores";

class FakeArtifactTable<Row extends Record<string, unknown>, Key extends string> {
	private rows = new Map<Key, Row>();

	constructor(private readonly keyOf: (row: Row) => Key) {}

	async get(key: Key): Promise<Row | undefined> {
		return this.rows.get(key);
	}

	async put(row: Row): Promise<void> {
		this.rows.set(this.keyOf(row), row);
	}

	async delete(key: Key): Promise<void> {
		this.rows.delete(key);
	}
}

function activeShard(overrides: Partial<ResidentShardDescriptor> = {}): ResidentShardDescriptor {
	return {
		shardId: overrides.shardId ?? "active-1",
		generation: overrides.generation ?? 1,
		state: overrides.state ?? "active",
		sourceBytes: overrides.sourceBytes ?? 0,
		docCount: overrides.docCount ?? 0,
		createdOrder: overrides.createdOrder ?? 1,
		artifactOwner: overrides.artifactOwner ?? overrides.shardId ?? "active-1",
	};
}

function doc(path: string, content: string, docRef: number, generation = 1): IndexedDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		folder: "notes",
		content,
		headings: content,
		docRef,
		generation,
	};
}

function indexedSnapshotReader(documents: readonly IndexedDocument[]) {
	const documentByRequestKey = new Map(
		documents.map((document) => [
			buildIndexedSnapshotRequestKey(document),
			document,
		]),
	);
	return {
		async readIndexedTextSnapshots(requests: ReadonlyArray<{ path: string; generation?: number }>) {
			return new Map(
				requests.flatMap((request) => {
					const document = documentByRequestKey.get(buildIndexedSnapshotRequestKey(request));
					if (document == null) {
						return [];
					}
					return [
						[
							buildIndexedSnapshotRequestKey(request),
							{
								path: request.path,
								text: document.content ?? "",
								generation: document.generation,
								source: "indexed" as const,
							},
						] as const,
					];
				}),
			);
		},
		async readIndexedMetadata(requests: ReadonlyArray<{ path: string; generation?: number }>) {
			return new Map(
				requests.flatMap((request) => {
					const document = documentByRequestKey.get(buildIndexedSnapshotRequestKey(request));
					if (document == null) {
						return [];
					}
					return [
						[
							buildIndexedSnapshotRequestKey(request),
							{
								aliasesText: document.aliases,
								tagsText: document.tags,
								headingsText: document.headings,
							},
						] as const,
					];
				}),
			);
		},
	};
}

describe("coverage lexical v3 active shard publisher", () => {
	test("appends documents into current active shard artifact", async () => {
		const active = activeShard({ sourceBytes: 10, docCount: 1 });
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);

		const result = await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [doc("old.md", "old alpha", 1)],
			changes: [{ document: doc("new.md", "new beta", 2) }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 100 },
		});

		expect(result.sealedActiveShard).toBeNull();
		expect(result.appendTargetShard.shardId).toBe("active-1");
		expect(result.appendTargetShard.docCount).toBe(2);
		expect((await stores.shardRegistry.loadRegistry())[0]?.docCount).toBe(2);
		expect((await artifacts.loadResidentShard(result.appendTargetShard))?.base.docTable.docCount).toBe(2);
	});

	test("loads current active documents from artifact and indexed snapshots", async () => {
		const active = activeShard({ sourceBytes: 0, docCount: 0 });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const oldDocument = {
			...doc("folder/old.md", "old alpha", 1),
			aliases: "old alias",
			tags: "#old",
			headings: "Old Heading",
		};
		await publishActiveShardAppend({
			stores: createMemoryCoverageLexicalV3ProductionStores({ registry: [active] }),
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: oldDocument }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 100 },
		});

		const loadedDocuments = await loadCurrentActiveDocuments({
			activeShard: { ...active, sourceBytes: 10, docCount: 1 },
			residentShardArtifactLoader: artifacts,
			indexedSnapshotReader: indexedSnapshotReader([oldDocument]),
		});

		expect(loadedDocuments).toEqual([
			expect.objectContaining({
				docRef: 1,
				path: "folder/old.md",
				basename: "old",
				folder: "folder",
				content: "old alpha",
				aliases: "old alias",
				tags: "#old",
				headings: "Old Heading",
			}),
		]);
	});

	test("loads same-path active documents by requested generation", async () => {
		const active = activeShard({ sourceBytes: 0, docCount: 0 });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const firstGeneration = doc("folder/same.md", "generation one", 1, 1);
		const secondGeneration = doc("folder/same.md", "generation two", 1, 2);
		await publishActiveShardAppend({
			stores: createMemoryCoverageLexicalV3ProductionStores({ registry: [active] }),
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: firstGeneration }, { document: secondGeneration }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 100 },
		});

		const loadedDocuments = await loadCurrentActiveDocuments({
			activeShard: { ...active, sourceBytes: 10, docCount: 2 },
			residentShardArtifactLoader: artifacts,
			indexedSnapshotReader: indexedSnapshotReader([firstGeneration, secondGeneration]),
		});

		expect(loadedDocuments.map((document) => ({
			generation: document.generation,
			content: document.content,
		}))).toEqual([
			{ generation: 1, content: "generation one" },
			{ generation: 2, content: "generation two" },
		]);
	});

	test("publisher can rebuild active shard from durable indexed snapshots", async () => {
		const active = activeShard({ sourceBytes: 0, docCount: 0 });
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const oldDocument = doc("old.md", "old alpha", 1);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: oldDocument }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 100 },
		});
		const activeAfterFirstAppend = (await stores.shardRegistry.loadRegistry())[0] ?? active;

		const result = await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: activeAfterFirstAppend,
			indexedSnapshotReader: indexedSnapshotReader([oldDocument]),
			changes: [{ document: doc("new.md", "new beta", 2) }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 101 },
		});

		expect(result.appendTargetShard.docCount).toBe(2);
		expect((await artifacts.loadResidentShard(result.appendTargetShard))?.base.docTable.docCount).toBe(2);
	});

	test("seals current active shard and publishes append batch into next active shard", async () => {
		const active = activeShard({ sourceBytes: 900, docCount: 3, createdOrder: 4 });
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);

		const result = await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [doc("old.md", "old alpha", 1)],
			changes: [
				{
					document: doc("large.md", "x".repeat(200), 9),
					previousVersion: {
						shardId: "sealed-1",
						shardGeneration: 1,
						docRef: 9,
						docGeneration: 1,
					},
				},
			],
			plannerOptions: {
				sealSourceBytes: 1000,
				nextShardId: "active-5",
				nextCreatedOrder: 5,
				now: 101,
			},
		});

		expect(result.sealedActiveShard).toMatchObject({
			shardId: "active-1",
			state: "sealing",
		});
		expect(result.appendTargetShard).toMatchObject({
			shardId: "active-5",
			state: "active",
			docCount: 1,
		});
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).toEqual([
			"active-1",
			"active-5",
		]);
		expect((await stores.invalidations.loadInvalidations())[0]).toMatchObject({
			shardId: "sealed-1",
			reason: "superseded",
		});
		expect((await artifacts.loadResidentShard(result.appendTargetShard))?.base.docTable.docCount).toBe(1);
	});

	test("publishes shard artifacts before invalidating old document versions", async () => {
		const active = activeShard({ sourceBytes: 10, docCount: 1 });
		const order: string[] = [];
		const registry = [active];
		const stores = {
			shardRegistry: {
				async loadRegistry() {
					return registry;
				},
				async saveRegistry() {
					order.push("registry");
				},
				async updateShard() {
					order.push("registry");
				},
				async updateShards() {
					order.push("registry");
				},
				async removeShards() {},
			},
			invalidations: {
				async loadInvalidations() {
					return [];
				},
				async appendInvalidations() {
					order.push("invalidations");
				},
				async removeInvalidationsForShards() {},
				async clearInvalidations() {},
			},
		};
		const artifacts = {
			async loadResidentShard() {
				return undefined;
			},
			async publishResidentShardArtifact() {
				order.push("artifact");
			},
			async removeResidentShardArtifact() {},
		};

		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [doc("old.md", "old alpha", 1)],
			changes: [
				{
					document: doc("new.md", "new beta", 2),
					previousVersion: {
						shardId: "active-1",
						shardGeneration: 1,
						docRef: 1,
						docGeneration: 1,
					},
				},
			],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 100 },
		});

		expect(order).toEqual(["artifact", "registry", "invalidations", "registry"]);
	});

	test("splits oversized append batch into bounded sealed shards plus one active shard", async () => {
		const active = activeShard({ sourceBytes: 900, docCount: 3, createdOrder: 4 });
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);

		const result = await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [doc("old.md", "old alpha", 1)],
			changes: [
				{ document: doc("large-1.md", "x".repeat(430), 11) },
				{ document: doc("large-2.md", "y".repeat(430), 12) },
				{ document: doc("large-3.md", "z".repeat(430), 13) },
			],
			plannerOptions: {
				sealSourceBytes: 1000,
				nextShardId: "active-5",
				nextCreatedOrder: 5,
				now: 102,
			},
		});

		expect(result.publishedShards.map((shard) => shard.shardId)).toEqual([
			"active-5",
			"active-6",
			"active-7",
		]);
		expect(result.publishedShards.map((shard) => shard.state)).toEqual([
			"sealed",
			"sealed",
			"active",
		]);
		expect(result.appendTargetShard.shardId).toBe("active-7");
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.state)).toEqual([
			"sealing",
			"sealed",
			"sealed",
			"active",
		]);
		expect((await artifacts.loadResidentShard(result.publishedShards[0]!))?.base.docTable.docCount).toBe(1);
		expect((await artifacts.loadResidentShard(result.publishedShards[1]!))?.base.docTable.docCount).toBe(1);
		expect((await artifacts.loadResidentShard(result.publishedShards[2]!))?.base.docTable.docCount).toBe(1);
	});

	test("seals non-empty active shard before splitting oversized append batch", async () => {
		const active = activeShard({ sourceBytes: 450, docCount: 1, createdOrder: 4 });
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);

		const result = await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [doc("existing.md", "e".repeat(430), 1)],
			changes: [
				{ document: doc("large-1.md", "x".repeat(430), 11) },
				{ document: doc("large-2.md", "y".repeat(430), 12) },
			],
			plannerOptions: {
				sealSourceBytes: 1000,
				now: 103,
			},
		});

		expect(result.publishedShards.map((shard) => shard.state)).toEqual([
			"sealed",
			"active",
		]);
		expect(result.publishedShards.every((shard) => shard.sourceBytes <= 1000)).toBe(true);
		expect((await artifacts.loadResidentShard(result.publishedShards[0]!))?.base.docTable.docCount).toBe(1);
		expect((await artifacts.loadResidentShard(result.publishedShards[1]!))?.base.docTable.docCount).toBe(1);
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.state)).toEqual([
			"sealing",
			"sealed",
			"active",
		]);
	});

	test("keeps a single document larger than the seal threshold as one oversized shard", async () => {
		const active = activeShard({ sourceBytes: 900, docCount: 3, createdOrder: 4 });
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);

		const result = await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [doc("old.md", "old alpha", 1)],
			changes: [{ document: { ...doc("huge.md", "h", 99), size: 2000 } }],
			plannerOptions: {
				sealSourceBytes: 1000,
				nextShardId: "active-5",
				nextCreatedOrder: 5,
				now: 104,
			},
		});

		expect(result.publishedShards).toHaveLength(1);
		expect(result.publishedShards[0]).toMatchObject({
			shardId: "active-5",
			state: "active",
			docCount: 1,
		});
		expect(result.publishedShards[0]!.sourceBytes).toBeGreaterThan(1000);
		expect((await artifacts.loadResidentShard(result.appendTargetShard))?.base.docTable.docCount).toBe(1);
	});
});
