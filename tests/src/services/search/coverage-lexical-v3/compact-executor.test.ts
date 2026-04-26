import type { IndexedDocument } from "src/globals/search-types";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import {
	commitCompactTempArtifact,
	MemoryCompactJobManifestStore,
	MemoryCompactTempArtifactStore,
	runCompactGc,
	runCompactMaintenanceHeal,
	type CompactJobManifest,
} from "src/services/search/coverage-lexical-v3/compact";
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

function doc(path: string, content: string, docRef: number): IndexedDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		folder: "notes",
		content,
		docRef,
		generation: 1,
	};
}

function residentShard(shardId: string, documents: readonly IndexedDocument[]): ResidentShard {
	const artifacts = buildResidentHotBaseArtifacts(documents);
	return {
		shardId,
		generation: 1,
		base: {
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		},
	};
}

function descriptor(shardId: string, state: ResidentShardDescriptor["state"]): ResidentShardDescriptor {
	return {
		shardId,
		generation: 1,
		state,
		sourceBytes: 100,
		docCount: 1,
		createdOrder: Number(shardId.replace(/\D/g, "")) || 1,
		artifactOwner: shardId,
	};
}

function job(status: CompactJobManifest["status"]): CompactJobManifest {
	return {
		jobId: `job-${status}`,
		kind: "adjacent_small_shard_merge",
		inputShardIds: ["sealed-1", "sealed-2"],
		outputShardId: "sealed-3",
		status,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("coverage lexical v3 compact executor", () => {
	test("temp artifact is not visible until atomic registry commit", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "sealed"), descriptor("sealed-2", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const jobStore = new MemoryCompactJobManifestStore([job("ready_to_commit")]);
		const tempStore = new MemoryCompactTempArtifactStore();
		await tempStore.saveTempArtifact({
			jobId: "job-ready_to_commit",
			outputShardId: "sealed-3",
			shard: residentShard("sealed-3", [doc("merged.md", "merged target", 3)]),
			createdAt: 1,
		});
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).not.toContain(
			"sealed-3",
		);

		const result = await commitCompactTempArtifact({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			job: job("ready_to_commit"),
			outputDescriptor: descriptor("sealed-3", "sealed"),
			now: 2,
		});

		expect(result.committed).toBe(true);
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).toContain(
			"sealed-3",
		);
		expect((await artifactStore.loadResidentShard(descriptor("sealed-3", "sealed")))?.base.docTable.docCount).toBe(1);
	});

	test("committed job GC removes old garbage shards and temp output", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "garbage"), descriptor("sealed-2", "garbage"), descriptor("sealed-3", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		await artifactStore.publishResidentShardArtifact({
			descriptor: descriptor("sealed-1", "garbage"),
			shard: residentShard("sealed-1", [doc("old.md", "old", 1)]),
			createdAt: 1,
		});
		const jobStore = new MemoryCompactJobManifestStore([job("committed")]);
		const tempStore = new MemoryCompactTempArtifactStore();
		await tempStore.saveTempArtifact({
			jobId: "job-committed",
			outputShardId: "sealed-3",
			shard: residentShard("sealed-3", [doc("merged.md", "merged", 3)]),
			createdAt: 1,
		});

		await runCompactGc({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			job: job("committed"),
		});

		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).toEqual([
			"sealed-3",
		]);
		expect(await tempStore.loadTempArtifact("job-committed")).toBeUndefined();
		expect(await jobStore.loadJobs()).toHaveLength(0);
	});

	test("maintenance heal aborts building jobs and completes ready commits", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "sealed"), descriptor("sealed-2", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const jobStore = new MemoryCompactJobManifestStore([
			job("building"),
			job("ready_to_commit"),
		]);
		const tempStore = new MemoryCompactTempArtifactStore();
		await tempStore.saveTempArtifact({
			jobId: "job-ready_to_commit",
			outputShardId: "sealed-3",
			shard: residentShard("sealed-3", [doc("merged.md", "merged", 3)]),
			createdAt: 1,
		});

		const results = await runCompactMaintenanceHeal({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			outputDescriptorsByJobId: new Map([
				["job-ready_to_commit", descriptor("sealed-3", "sealed")],
			]),
			now: 2,
		});

		expect(results.map((result) => result.action)).toEqual(["aborted", "committed"]);
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).toContain(
			"sealed-3",
		);
	});

	test("crash at manifest-created keeps old shards visible and aborts temp", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "sealed"), descriptor("sealed-2", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const jobStore = new MemoryCompactJobManifestStore([job("building")]);
		const tempStore = new MemoryCompactTempArtifactStore();

		const results = await runCompactMaintenanceHeal({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			outputDescriptorsByJobId: new Map(),
			now: 2,
		});

		expect(results).toEqual([{ action: "aborted", jobId: "job-building" }]);
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).toEqual([
			"sealed-1",
			"sealed-2",
		]);
		expect((await jobStore.loadJobs())[0].status).toBe("aborted");
	});

	test("crash with partially-written temp aborts building output", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "sealed"), descriptor("sealed-2", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const jobStore = new MemoryCompactJobManifestStore([job("building")]);
		const tempStore = new MemoryCompactTempArtifactStore();
		await tempStore.saveTempArtifact({
			jobId: "job-building",
			outputShardId: "sealed-3",
			shard: residentShard("sealed-3", [doc("partial.md", "partial", 3)]),
			createdAt: 1,
		});

		await runCompactMaintenanceHeal({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			outputDescriptorsByJobId: new Map(),
			now: 2,
		});

		expect(await tempStore.loadTempArtifact("job-building")).toBeUndefined();
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).not.toContain(
			"sealed-3",
		);
	});

	test("crash at ready-to-commit finishes flip only when inputs still match", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "sealed"), descriptor("sealed-2", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const jobStore = new MemoryCompactJobManifestStore([job("ready_to_commit")]);
		const tempStore = new MemoryCompactTempArtifactStore();
		await tempStore.saveTempArtifact({
			jobId: "job-ready_to_commit",
			outputShardId: "sealed-3",
			shard: residentShard("sealed-3", [doc("merged.md", "merged", 3)]),
			createdAt: 1,
		});

		const results = await runCompactMaintenanceHeal({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			outputDescriptorsByJobId: new Map([
				["job-ready_to_commit", descriptor("sealed-3", "sealed")],
			]),
			now: 2,
		});

		expect(results).toEqual([{ action: "committed", jobId: "job-ready_to_commit" }]);
		expect((await stores.shardRegistry.loadRegistry()).find((shard) => shard.shardId === "sealed-1")?.state).toBe(
			"garbage",
		);
		expect((await stores.shardRegistry.loadRegistry()).find((shard) => shard.shardId === "sealed-3")?.state).toBe(
			"sealed",
		);
	});

	test("crash after commit before GC resumes garbage cleanup", async () => {
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [descriptor("sealed-1", "garbage"), descriptor("sealed-2", "garbage"), descriptor("sealed-3", "sealed")],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		await artifactStore.publishResidentShardArtifact({
			descriptor: descriptor("sealed-1", "garbage"),
			shard: residentShard("sealed-1", [doc("old-a.md", "old a", 1)]),
			createdAt: 1,
		});
		await artifactStore.publishResidentShardArtifact({
			descriptor: descriptor("sealed-2", "garbage"),
			shard: residentShard("sealed-2", [doc("old-b.md", "old b", 2)]),
			createdAt: 1,
		});
		const jobStore = new MemoryCompactJobManifestStore([job("committed")]);
		const tempStore = new MemoryCompactTempArtifactStore();

		const results = await runCompactMaintenanceHeal({
			stores,
			residentShardArtifactStore: artifactStore,
			jobStore,
			tempArtifactStore: tempStore,
			outputDescriptorsByJobId: new Map(),
			now: 2,
		});

		expect(results).toEqual([{ action: "gc", jobId: "job-committed" }]);
		expect((await stores.shardRegistry.loadRegistry()).map((shard) => shard.shardId)).toEqual([
			"sealed-3",
		]);
		expect(await jobStore.loadJobs()).toHaveLength(0);
	});
});
