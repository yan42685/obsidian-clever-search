export type ResidentShardState =
	| "active"
	| "sealing"
	| "sealed"
	| "compact_temp"
	| "garbage";

export type ResidentShardDescriptor = Readonly<{
	shardId: string;
	generation: number;
	state: ResidentShardState;
	sourceBytes: number;
	staleSourceBytes?: number;
	docCount: number;
	staleDocCount?: number;
	createdOrder: number;
	artifactOwner: string;
}>;

export type ShardAwareCandidateKey = Readonly<{
	shardId: string;
	shardGeneration: number;
	docRef: number;
	docGeneration: number;
}>;

export const DEFAULT_SHARD_SEAL_SOURCE_BYTES = 8 * 1024 * 1024;
export const INTERNAL_COMPACT_MIN_SOURCE_BYTES = 1 * 1024 * 1024;
export const INTERNAL_COMPACT_MIN_STALE_RATIO = 0.2;
export const SMALL_SHARD_MERGE_MAX_SINGLE_SOURCE_BYTES = 4 * 1024 * 1024;
export const SMALL_SHARD_MERGE_MAX_OUTPUT_SOURCE_BYTES = DEFAULT_SHARD_SEAL_SOURCE_BYTES;
export const SMALL_SHARD_MERGE_MAX_INPUT_SHARDS = 4;
export const SMALL_SHARD_REPACK_MIN_SHARD_COUNT = 8;
export const COMPACT_MAX_INPUT_SHARDS = SMALL_SHARD_MERGE_MAX_INPUT_SHARDS;
export const COMPACT_MAX_INPUT_SOURCE_BYTES = DEFAULT_SHARD_SEAL_SOURCE_BYTES;

export function isReadableShardState(state: ResidentShardState): boolean {
	return state === "active" || state === "sealing" || state === "sealed";
}

export function buildDefaultShardDescriptor(params: {
	shardId: string;
	generation: number;
	state?: ResidentShardState;
	sourceBytes?: number;
	staleSourceBytes?: number;
	docCount?: number;
	staleDocCount?: number;
	createdOrder?: number;
	artifactOwner?: string;
}): ResidentShardDescriptor {
	return {
		shardId: params.shardId,
		generation: params.generation,
		state: params.state ?? "sealed",
		sourceBytes: params.sourceBytes ?? 0,
		staleSourceBytes: params.staleSourceBytes,
		docCount: params.docCount ?? 0,
		staleDocCount: params.staleDocCount,
		createdOrder: params.createdOrder ?? 0,
		artifactOwner: params.artifactOwner ?? params.shardId,
	};
}
