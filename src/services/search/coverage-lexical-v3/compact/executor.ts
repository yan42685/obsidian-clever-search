import type { CoverageLexicalV3ResidentShardArtifactStore } from "../artifact-loader";
import type { ActiveShardColdEvidencePublisher } from "../active-shard-publisher";
import type { ResidentShardDescriptor } from "../shards";
import type { CoverageLexicalV3ProductionStores } from "../stores";
import { planCompactMaintenanceHeal } from "./heal";
import type { CompactJobManifest } from "./types";
import type { CompactJobManifestStore, CompactTempArtifactStore } from "./stores";

export type CompactCommitResult = Readonly<{
	committed: boolean;
	job: CompactJobManifest;
	commitMs: number;
}>;

export async function commitCompactTempArtifact(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	jobStore: CompactJobManifestStore;
	tempArtifactStore: CompactTempArtifactStore;
	job: CompactJobManifest;
	outputDescriptor: ResidentShardDescriptor;
	coldEvidencePublisher?: ActiveShardColdEvidencePublisher;
	now?: number;
}): Promise<CompactCommitResult> {
	const startedAt = Date.now();
	const tempArtifact = await params.tempArtifactStore.loadTempArtifact(params.job.jobId);
	if (tempArtifact == null) {
		const failedJob = updateJob(params.job, "failed", params.now);
		await params.jobStore.saveJob(failedJob);
		return { committed: false, job: failedJob, commitMs: Date.now() - startedAt };
	}
	await publishTempArtifactColdEvidence(params.coldEvidencePublisher, tempArtifact);
	await params.residentShardArtifactStore.publishResidentShardArtifact({
		descriptor: params.outputDescriptor,
		shard: tempArtifact.shard,
		createdAt: params.now ?? Date.now(),
	});
	const registry = await params.stores.shardRegistry.loadRegistry();
	const inputShardIds = new Set(params.job.inputShardIds);
	const garbageInputDescriptors = registry
		.filter((shard) => inputShardIds.has(shard.shardId))
		.map((shard) => ({
			...shard,
			state: "garbage" as const,
		}));
	await params.stores.shardRegistry.updateShards([
		...garbageInputDescriptors,
		params.outputDescriptor,
	]);
	const committedJob = updateJob(params.job, "committed", params.now, {
		commitMs: Date.now() - startedAt,
	});
	await params.jobStore.saveJob(committedJob);
	return { committed: true, job: committedJob, commitMs: Date.now() - startedAt };
}

export async function runCompactGc(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	jobStore: CompactJobManifestStore;
	tempArtifactStore: CompactTempArtifactStore;
	job: CompactJobManifest;
}): Promise<void> {
	const registry = await params.stores.shardRegistry.loadRegistry();
	const garbage = registry.filter(
		(shard) => shard.state === "garbage" && params.job.inputShardIds.includes(shard.shardId),
	);
	for (const shard of garbage) {
		await params.residentShardArtifactStore.removeResidentShardArtifact(shard);
		await params.stores.shardRegistry.removeShards([shard.shardId]);
	}
	await params.tempArtifactStore.removeTempArtifact(params.job.jobId);
	await params.jobStore.removeJob(params.job.jobId);
}

export type CompactMaintenanceExecutorResult = Readonly<{
	action: "aborted" | "committed" | "gc" | "retry_later";
	jobId: string;
}>;

export async function runCompactMaintenanceHeal(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	jobStore: CompactJobManifestStore;
	tempArtifactStore: CompactTempArtifactStore;
	outputDescriptorsByJobId: ReadonlyMap<string, ResidentShardDescriptor>;
	coldEvidencePublisher?: ActiveShardColdEvidencePublisher;
	now?: number;
}): Promise<readonly CompactMaintenanceExecutorResult[]> {
	const jobs = await params.jobStore.loadJobs();
	const registry = await params.stores.shardRegistry.loadRegistry();
	const results: CompactMaintenanceExecutorResult[] = [];
	for (const job of jobs) {
		const action = planCompactMaintenanceHeal(job, registry);
		if (action.type === "abort_temp_output") {
			await params.tempArtifactStore.removeTempArtifact(job.jobId);
			await params.jobStore.saveJob(updateJob(job, "aborted", params.now));
			results.push({ action: "aborted", jobId: job.jobId });
		} else if (action.type === "complete_commit") {
			const outputDescriptor = params.outputDescriptorsByJobId.get(job.jobId);
			if (outputDescriptor == null) {
				await params.jobStore.saveJob(updateJob(job, "failed", params.now));
				results.push({ action: "retry_later", jobId: job.jobId });
				continue;
			}
			await commitCompactTempArtifact({ ...params, job, outputDescriptor });
			results.push({ action: "committed", jobId: job.jobId });
		} else if (action.type === "resume_gc") {
			await runCompactGc({ ...params, job });
			results.push({ action: "gc", jobId: job.jobId });
		} else {
			results.push({ action: "retry_later", jobId: job.jobId });
		}
	}
	return results;
}

async function publishTempArtifactColdEvidence(
	publisher: ActiveShardColdEvidencePublisher | undefined,
	tempArtifact: NonNullable<Awaited<ReturnType<CompactTempArtifactStore["loadTempArtifact"]>>>,
): Promise<void> {
	if (publisher == null) {
		return;
	}
	await Promise.all([
		(tempArtifact.bodyEvidenceRows?.length ?? 0) > 0
			? publisher.publishBodyEvidence?.(tempArtifact.bodyEvidenceRows ?? []) ?? Promise.resolve()
			: Promise.resolve(),
		(tempArtifact.hanDocEvidenceRows?.length ?? 0) > 0
			? publisher.publishHanDocEvidence?.(tempArtifact.hanDocEvidenceRows ?? []) ?? Promise.resolve()
			: Promise.resolve(),
		(tempArtifact.hanBodyEvidenceRows?.length ?? 0) > 0
			? publisher.publishHanBodyEvidence?.(tempArtifact.hanBodyEvidenceRows ?? []) ?? Promise.resolve()
			: Promise.resolve(),
	]);
}

function updateJob(
	job: CompactJobManifest,
	status: CompactJobManifest["status"],
	now = Date.now(),
	stats?: Partial<NonNullable<CompactJobManifest["stats"]>>,
): CompactJobManifest {
	return {
		...job,
		status,
		updatedAt: now,
		stats: stats == null ? job.stats : { ...job.stats, ...stats },
	};
}
