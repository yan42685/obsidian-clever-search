import {
	COMPACT_MAX_INPUT_SHARDS,
	COMPACT_MAX_INPUT_SOURCE_BYTES,
	DEFAULT_SHARD_SEAL_SOURCE_BYTES,
	INTERNAL_COMPACT_MIN_STALE_RATIO,
	SMALL_SHARD_MERGE_MAX_INPUT_SHARDS,
	SMALL_SHARD_MERGE_MAX_OUTPUT_SOURCE_BYTES,
	SMALL_SHARD_MERGE_MAX_SINGLE_SOURCE_BYTES,
	SMALL_SHARD_REPACK_MIN_SHARD_COUNT,
} from "src/services/search/coverage-lexical-v3/shards";
import {
	chooseNextCompactPlan,
	handleCompactWorkerRequest,
	planCompactMaintenanceHeal,
	planStartupRegistrySafety,
	type CompactJobManifest,
} from "src/services/search/coverage-lexical-v3/compact";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";

function shard(
	shardId: string,
	state: ResidentShardDescriptor["state"] = "sealed",
	sourceBytes = 1024,
	staleSourceBytes = 0,
): ResidentShardDescriptor {
	return {
		shardId,
		generation: 1,
		state,
		sourceBytes,
		staleSourceBytes,
		docCount: 4,
		createdOrder: Number(shardId.replace(/\D/g, "")) || 0,
		artifactOwner: shardId,
	};
}

function job(status: CompactJobManifest["status"]): CompactJobManifest {
	return {
		jobId: `job-${status}`,
		kind: "internal",
		inputShardIds: ["sealed-1", "sealed-2"],
		outputShardId: "sealed-3",
		status,
		createdAt: 1,
		updatedAt: 2,
	};
}

describe("coverage lexical v3 compact production contracts", () => {
	test("exposes fixed bounded shard and compact defaults", () => {
		expect(DEFAULT_SHARD_SEAL_SOURCE_BYTES).toBe(8 * 1024 * 1024);
		expect(INTERNAL_COMPACT_MIN_STALE_RATIO).toBe(0.2);
		expect(SMALL_SHARD_MERGE_MAX_SINGLE_SOURCE_BYTES).toBe(4 * 1024 * 1024);
		expect(SMALL_SHARD_MERGE_MAX_OUTPUT_SOURCE_BYTES).toBe(8 * 1024 * 1024);
		expect(SMALL_SHARD_MERGE_MAX_INPUT_SHARDS).toBe(4);
		expect(SMALL_SHARD_REPACK_MIN_SHARD_COUNT).toBe(8);
		expect(COMPACT_MAX_INPUT_SHARDS).toBe(SMALL_SHARD_MERGE_MAX_INPUT_SHARDS);
		expect(COMPACT_MAX_INPUT_SOURCE_BYTES).toBe(DEFAULT_SHARD_SEAL_SOURCE_BYTES);
	});

	test("plans internal compact before small-shard merge", () => {
		const plan = chooseNextCompactPlan([
			shard("sealed-1", "sealed", 8 * 1024 * 1024, 2 * 1024 * 1024),
			shard("sealed-2", "sealed", 2 * 1024 * 1024),
			shard("sealed-3", "sealed", 2 * 1024 * 1024),
		]);

		expect(plan).toEqual({
			kind: "internal",
			inputShardIds: ["sealed-1"],
			estimatedInputSourceBytes: 8 * 1024 * 1024,
			estimatedOutputSourceBytes: 6 * 1024 * 1024,
		});
	});

	test("plans internal compact for the stalest eligible sealed shard", () => {
		const plan = chooseNextCompactPlan([
			shard("sealed-1", "sealed", 8 * 1024 * 1024, 2 * 1024 * 1024),
			shard("sealed-2", "sealed", 8 * 1024 * 1024, 4 * 1024 * 1024),
			shard("sealed-3", "sealed", 8 * 1024 * 1024, 3 * 1024 * 1024),
		]);

		expect(plan?.kind).toBe("internal");
		expect(plan?.inputShardIds).toEqual(["sealed-2"]);
	});

	test("plans merge only for adjacent small sealed shards under the seal threshold", () => {
		const plan = chooseNextCompactPlan([
			shard("sealed-1", "sealed", 5 * 1024 * 1024),
			shard("sealed-2", "sealed", 3 * 1024 * 1024),
			shard("sealed-3", "sealed", 3 * 1024 * 1024),
		]);

	expect(plan).toEqual({
			kind: "adjacent_small_shard_merge",
			inputShardIds: ["sealed-2", "sealed-3"],
			estimatedInputSourceBytes: 6 * 1024 * 1024,
			estimatedOutputSourceBytes: 6 * 1024 * 1024,
		});
	});

	test("repack merges non-adjacent small shards only after small shards accumulate", () => {
		const plan = chooseNextCompactPlan([
			shard("sealed-1", "sealed", 5 * 1024 * 1024),
			shard("sealed-2", "sealed", 1 * 1024 * 1024),
			shard("sealed-3", "sealed", 5 * 1024 * 1024),
			shard("sealed-4", "sealed", 2 * 1024 * 1024),
			shard("sealed-5", "sealed", 5 * 1024 * 1024),
			shard("sealed-6", "sealed", 1 * 1024 * 1024),
			shard("sealed-7", "sealed", 5 * 1024 * 1024),
			shard("sealed-8", "sealed", 2 * 1024 * 1024),
			shard("sealed-9", "sealed", 5 * 1024 * 1024),
			shard("sealed-10", "sealed", 1 * 1024 * 1024),
			shard("sealed-11", "sealed", 5 * 1024 * 1024),
			shard("sealed-12", "sealed", 2 * 1024 * 1024),
			shard("sealed-13", "sealed", 5 * 1024 * 1024),
			shard("sealed-14", "sealed", 1 * 1024 * 1024),
			shard("sealed-15", "sealed", 5 * 1024 * 1024),
			shard("sealed-16", "sealed", 2 * 1024 * 1024),
		]);

		expect(plan).toEqual({
			kind: "small_shard_repack",
			inputShardIds: ["sealed-2", "sealed-6", "sealed-10", "sealed-14"],
			estimatedInputSourceBytes: 4 * 1024 * 1024,
			estimatedOutputSourceBytes: 4 * 1024 * 1024,
		});
	});

	test("startup safety only accepts a readable committed registry", () => {
		expect(planStartupRegistrySafety([shard("active-1", "active")])).toEqual({
			type: "use_committed_registry",
		});
		expect(planStartupRegistrySafety([shard("temp-1", "compact_temp")])).toEqual({
			type: "fallback_rebuild",
			reason: "no readable committed shards",
		});
	});

	test("maintenance heal defers expensive compact recovery after startup", () => {
		const registry = [shard("sealed-1"), shard("sealed-2"), shard("active-3", "active")];

		expect(planCompactMaintenanceHeal(job("building"), registry)).toEqual({
			type: "abort_temp_output",
			jobId: "job-building",
		});
		expect(planCompactMaintenanceHeal(job("ready_to_commit"), registry)).toEqual({
			type: "complete_commit",
			jobId: "job-ready_to_commit",
		});
		expect(planCompactMaintenanceHeal(job("committed"), registry)).toEqual({
			type: "resume_gc",
			jobId: "job-committed",
		});
		expect(planCompactMaintenanceHeal(job("failed"), registry)).toEqual({
			type: "retry_later",
			jobId: "job-failed",
		});
	});

	test("worker done is a compute result, not a registry commit", () => {
		const responses = handleCompactWorkerRequest({
			type: "start",
			jobId: "job-1",
			kind: "internal",
			inputShardIds: ["sealed-1"],
			outputShardId: "sealed-3",
			config: {
				maxInputShards: COMPACT_MAX_INPUT_SHARDS,
				maxInputSourceBytes: COMPACT_MAX_INPUT_SOURCE_BYTES,
				mainThreadBatchTargetMs: 100,
				mainThreadBatchHardCeilingMs: 500,
			},
			input: {
				inputShards: [shard("sealed-1")],
				invalidatedDocKeys: ["docref:1@1"],
			},
		});

		expect(responses.map((response) => response.type)).toEqual([
			"ready",
			"progress",
			"batch",
			"done",
		]);
		expect(responses[responses.length - 1]?.type).toBe("done");
	});
});
