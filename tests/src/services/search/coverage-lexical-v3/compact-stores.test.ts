import {
	MemoryCompactJobManifestStore,
	MemoryCompactTempArtifactStore,
	runCompactWorkerCompute,
	type CompactJobManifest,
} from "src/services/search/coverage-lexical-v3/compact";
import type { ResidentShard } from "src/services/search/coverage-lexical-v3/layout/types";

function job(jobId: string, createdAt: number): CompactJobManifest {
	return {
		jobId,
		kind: "internal",
		inputShardIds: ["sealed-1"],
		outputShardId: "sealed-2",
		status: "building",
		createdAt,
		updatedAt: createdAt,
	};
}

describe("coverage lexical v3 compact production stores", () => {
	test("manifest store saves jobs in created order and removes by id", async () => {
		const store = new MemoryCompactJobManifestStore();

		await store.saveJob(job("job-2", 2));
		await store.saveJob(job("job-1", 1));
		expect((await store.loadJobs()).map((entry) => entry.jobId)).toEqual([
			"job-1",
			"job-2",
		]);

		await store.removeJob("job-1");
		expect((await store.loadJobs()).map((entry) => entry.jobId)).toEqual(["job-2"]);
	});

	test("temp artifact store keeps temp output invisible until caller commits", async () => {
		const store = new MemoryCompactTempArtifactStore();
		const shard = {
			shardId: "sealed-temp",
			generation: 1,
			base: {} as ResidentShard["base"],
		};

		await store.saveTempArtifact({
			jobId: "job-1",
			outputShardId: "sealed-temp",
			outputDescriptor: {
				shardId: "sealed-temp",
				generation: 1,
				state: "sealed",
				sourceBytes: 1,
				docCount: 1,
				createdOrder: 1,
				artifactOwner: "sealed-temp",
			},
			shard,
			createdAt: 1,
		});

		expect((await store.loadTempArtifact("job-1"))?.shard.shardId).toBe("sealed-temp");
		await store.removeTempArtifact("job-1");
		expect(await store.loadTempArtifact("job-1")).toBeUndefined();
	});

	test("cpu-only worker harness exposes done without implying registry commit", () => {
		const responses = runCompactWorkerCompute({
			type: "start",
			jobId: "job-1",
			kind: "internal",
			inputShardIds: ["sealed-1"],
			outputShardId: "sealed-2",
			config: {
				maxInputShards: 2,
				maxInputSourceBytes: 16,
				mainThreadBatchTargetMs: 100,
				mainThreadBatchHardCeilingMs: 500,
			},
			input: {
				inputShards: [],
				invalidatedDocKeys: [],
			},
		});

		expect(responses.map((response) => response.type)).toContain("done");
	});
});
