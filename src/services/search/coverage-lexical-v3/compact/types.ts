import type { ResidentShardDescriptor } from "../shards";

export type CompactJobStatus =
	| "building"
	| "ready_to_commit"
	| "committed"
	| "failed"
	| "aborted";

export type CompactJobStats = Readonly<{
	inputShardCount: number;
	inputSourceBytes: number;
	outputSourceBytes: number;
	liveDocCount: number;
	droppedDocCount: number;
	workerTotalMs: number;
	mainReadBatchMaxMs: number;
	mainWriteBatchMaxMs: number;
	commitMs: number;
}>;

export type CompactJobKind = "internal" | "adjacent_small_shard_merge" | "small_shard_repack";

export type CompactJobManifest = Readonly<{
	jobId: string;
	kind: CompactJobKind;
	inputShardIds: readonly string[];
	outputShardId: string;
	status: CompactJobStatus;
	createdAt: number;
	updatedAt: number;
	stats?: Partial<CompactJobStats>;
}>;

export type CompactWorkerConfig = Readonly<{
	maxInputShards: number;
	maxInputSourceBytes: number;
	mainThreadBatchTargetMs: number;
	mainThreadBatchHardCeilingMs: number;
}>;

export type CompactWorkerInput = Readonly<{
	inputShards: readonly ResidentShardDescriptor[];
	invalidatedDocKeys: readonly string[];
}>;

export type CompactWorkerBatchKind = "docTable" | "hotPayload" | "coldSlice" | "metadata";

export type CompactWorkerRequest =
	| Readonly<{
			type: "start";
			jobId: string;
			kind: CompactJobKind;
			inputShardIds: readonly string[];
			outputShardId: string;
			config: CompactWorkerConfig;
			input: CompactWorkerInput;
		}>
	| Readonly<{
			type: "cancel";
			jobId: string;
		}>;

export type CompactWorkerResponse =
	| Readonly<{ type: "ready" }>
	| Readonly<{
			type: "progress";
			jobId: string;
			processedDocs: number;
			totalDocs: number;
			processedSourceBytes: number;
			emittedRows: number;
			elapsedMs: number;
		}>
	| Readonly<{
			type: "batch";
			jobId: string;
			batchKind: CompactWorkerBatchKind;
			batchIndex: number;
			rows: readonly unknown[];
		}>
	| Readonly<{
			type: "done";
			jobId: string;
			stats: CompactJobStats;
		}>
	| Readonly<{
			type: "error";
			jobId: string;
			message: string;
			stack?: string;
		}>
	| Readonly<{
			type: "cancelled";
			jobId: string;
		}>;
