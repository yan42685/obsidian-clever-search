import type { IndexedDocument } from "src/globals/search-types";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import { bootstrapCoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/bootstrap";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { ShardInvalidationEntry } from "src/services/search/coverage-lexical-v3/invalidation";
import type { ResidentShard } from "src/services/search/coverage-lexical-v3/layout/types";
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

function descriptor(
	shardId: string,
	state: ResidentShardDescriptor["state"],
	createdOrder: number,
): ResidentShardDescriptor {
	return {
		shardId,
		generation: 1,
		state,
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
		reason: "deleted",
		createdAt: 1,
	};
}

function residentShardLoader(residentShards: readonly ResidentShard[]) {
	return {
		async loadResidentShard(descriptor: ResidentShardDescriptor) {
			return residentShards.find(
				(shard) =>
					shard.shardId === descriptor.shardId &&
					shard.generation === descriptor.generation,
			);
		},
	};
}

describe("coverage lexical v3 bootstrap", () => {
	test("loads engine from stores and applies invalidations", async () => {
		const engine = new CoverageLexicalV3Engine();
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "sealed", 1), descriptor("active-2", "active", 2)],
			invalidations: [invalidation("sealed-1", 1)],
		});
		const result = await bootstrapCoverageLexicalV3Engine({
			engine,
			stores,
			residentShardArtifactLoader: residentShardLoader([
				residentShard("sealed-1", 1, [doc("old.md", "alpha target", 1)]),
				residentShard("active-2", 1, [doc("new.md", "alpha target", 2)]),
			]),
		});

		expect(result).toEqual({
			loaded: true,
			reason: "loaded",
			loadedShardIds: ["sealed-1", "active-2"],
		});
		expect(engine.search("alpha target").rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"new.md",
		]);
	});

	test("loads resident shards through artifact loader in committed registry order", async () => {
		const engine = new CoverageLexicalV3Engine();
		const sealed2 = descriptor("sealed-2", "sealed", 2);
		const sealed1 = descriptor("sealed-1", "sealed", 1);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [sealed2, sealed1],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		await artifactStore.publishResidentShardArtifact({
			descriptor: sealed2,
			shard: residentShard("sealed-2", 1, [doc("b.md", "beta target", 2)]),
			createdAt: 2,
		});
		await artifactStore.publishResidentShardArtifact({
			descriptor: sealed1,
			shard: residentShard("sealed-1", 1, [doc("a.md", "alpha target", 1)]),
			createdAt: 1,
		});
		const loadOrder: string[] = [];

		const result = await bootstrapCoverageLexicalV3Engine({
			engine,
			stores,
			residentShardArtifactLoader: {
				async loadResidentShard(descriptor) {
					loadOrder.push(descriptor.shardId);
					return artifactStore.loadResidentShard(descriptor);
				},
			},
		});

		expect(result).toEqual({
			loaded: true,
			reason: "loaded",
			loadedShardIds: ["sealed-1", "sealed-2"],
		});
		expect(loadOrder).toEqual(["sealed-1", "sealed-2"]);
		expect(engine.search("target").rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"a.md",
			"b.md",
		]);
	});

	test("returns safety fallback when registry is not startup-safe", async () => {
		const result = await bootstrapCoverageLexicalV3Engine({
			engine: new CoverageLexicalV3Engine(),
			stores: createMemoryCoverageLexicalV3ProductionStores({
				registry: [descriptor("temp-1", "compact_temp", 1)],
			}),
			residentShardArtifactLoader: residentShardLoader([
				residentShard("temp-1", 1, [doc("tmp.md", "temp", 1)]),
			]),
		});

		expect(result.loaded).toBe(false);
		expect(result.reason).toBe("startup_safety_failed");
		expect(result.fallbackRebuildReason).toBe("no readable committed shards");
	});

	test("returns missing shard when registry references unavailable artifacts", async () => {
		const result = await bootstrapCoverageLexicalV3Engine({
			engine: new CoverageLexicalV3Engine(),
			stores: createMemoryCoverageLexicalV3ProductionStores({
				registry: [descriptor("sealed-1", "sealed", 1), descriptor("active-2", "active", 2)],
			}),
			residentShardArtifactLoader: residentShardLoader([
				residentShard("sealed-1", 1, [doc("old.md", "alpha", 1)]),
			]),
		});

		expect(result).toEqual({
			loaded: false,
			reason: "missing_resident_shard",
			loadedShardIds: ["sealed-1"],
		});
	});
});
