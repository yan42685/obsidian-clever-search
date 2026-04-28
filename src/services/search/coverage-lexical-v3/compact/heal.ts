import { isReadableShardState, type ResidentShardDescriptor } from "../shards";
import type { CompactJobManifest } from "./types";

export type CompactStartupSafetyAction =
	| Readonly<{ type: "use_committed_registry" }>
	| Readonly<{ type: "fallback_rebuild"; reason: string }>;

export type CompactMaintenanceHealAction =
	| Readonly<{ type: "abort_temp_output"; jobId: string }>
	| Readonly<{ type: "complete_commit"; jobId: string }>
	| Readonly<{ type: "resume_gc"; jobId: string }>
	| Readonly<{ type: "retry_later"; jobId: string }>;

export function planStartupRegistrySafety(
	registry: readonly ResidentShardDescriptor[],
): CompactStartupSafetyAction {
	const readableShardCount = registry.filter(
		(shard) => shard.state === "active" || shard.state === "sealing" || shard.state === "sealed",
	).length;
	if (readableShardCount === 0) {
		return { type: "fallback_rebuild", reason: "no readable committed shards" };
	}
	const activeShardCount = registry.filter((shard) => shard.state === "active").length;
	if (activeShardCount > 1) {
		return { type: "fallback_rebuild", reason: "multiple active shards" };
	}
	return { type: "use_committed_registry" };
}

export function planCompactMaintenanceHeal(
	job: CompactJobManifest,
	committedRegistry: readonly ResidentShardDescriptor[],
): CompactMaintenanceHealAction {
	if (job.status === "building") {
		return { type: "abort_temp_output", jobId: job.jobId };
	}
	if (job.status === "ready_to_commit") {
		return compactOutputAlreadyCommitted(job, committedRegistry) ||
			compactInputsStillCommitted(job, committedRegistry)
			? { type: "complete_commit", jobId: job.jobId }
			: { type: "abort_temp_output", jobId: job.jobId };
	}
	if (job.status === "committed") {
		return { type: "resume_gc", jobId: job.jobId };
	}
	return { type: "retry_later", jobId: job.jobId };
}

function compactOutputAlreadyCommitted(
	job: CompactJobManifest,
	committedRegistry: readonly ResidentShardDescriptor[],
): boolean {
	return committedRegistry.some(
		(shard) =>
			shard.shardId === job.outputShardId &&
			isReadableShardState(shard.state),
	);
}

function compactInputsStillCommitted(
	job: CompactJobManifest,
	committedRegistry: readonly ResidentShardDescriptor[],
): boolean {
	const committedShardIds = new Set(
		committedRegistry
			.filter((shard) => shard.state === "sealed")
			.map((shard) => shard.shardId),
	);
	return job.inputShardIds.every((shardId) => committedShardIds.has(shardId));
}
