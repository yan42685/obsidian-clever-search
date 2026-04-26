import {
	DEFAULT_SHARD_SEAL_SOURCE_BYTES,
	INTERNAL_COMPACT_MIN_SOURCE_BYTES,
	INTERNAL_COMPACT_MIN_STALE_RATIO,
	SMALL_SHARD_MERGE_MAX_INPUT_SHARDS,
	SMALL_SHARD_MERGE_MAX_OUTPUT_SOURCE_BYTES,
	SMALL_SHARD_MERGE_MAX_SINGLE_SOURCE_BYTES,
	SMALL_SHARD_REPACK_MIN_SHARD_COUNT,
	type ResidentShardDescriptor,
} from "../shards";
import type { CompactJobKind } from "./types";

export type CompactPlan = Readonly<{
	kind: CompactJobKind;
	inputShardIds: readonly string[];
	estimatedInputSourceBytes: number;
	estimatedOutputSourceBytes: number;
}>;

export function chooseNextCompactPlan(
	registry: readonly ResidentShardDescriptor[],
): CompactPlan | null {
	const sealedShards = registry
		.filter((shard) => shard.state === "sealed")
		.sort((left, right) => left.createdOrder - right.createdOrder);
	return (
		chooseInternalCompactPlan(sealedShards) ??
		chooseAdjacentSmallShardMergePlan(sealedShards) ??
		chooseSmallShardRepackPlan(sealedShards)
	);
}

export function chooseInternalCompactPlan(
	sealedShards: readonly ResidentShardDescriptor[],
): CompactPlan | null {
	const selectedShard = [...sealedShards]
		.filter(canInternalCompact)
		.sort(
			(left, right) =>
				computeStaleSourceRatio(right) - computeStaleSourceRatio(left) ||
				(right.staleSourceBytes ?? 0) - (left.staleSourceBytes ?? 0) ||
				left.createdOrder - right.createdOrder,
		)[0];
	if (selectedShard == null) {
		return null;
	}
	return {
		kind: "internal",
		inputShardIds: [selectedShard.shardId],
		estimatedInputSourceBytes: selectedShard.sourceBytes,
		estimatedOutputSourceBytes: estimateLiveSourceBytes(selectedShard),
	};
}

export function chooseAdjacentSmallShardMergePlan(
	sealedShards: readonly ResidentShardDescriptor[],
): CompactPlan | null {
	for (let startIndex = 0; startIndex < sealedShards.length; startIndex += 1) {
		const group: ResidentShardDescriptor[] = [];
		let totalSourceBytes = 0;
		for (
			let index = startIndex;
			index < sealedShards.length && group.length < SMALL_SHARD_MERGE_MAX_INPUT_SHARDS;
			index += 1
		) {
			const shard = sealedShards[index];
			if (shard == null || !canUseAsSmallMergeInput(shard)) {
				break;
			}
			if (totalSourceBytes + estimateLiveSourceBytes(shard) > SMALL_SHARD_MERGE_MAX_OUTPUT_SOURCE_BYTES) {
				break;
			}
			group.push(shard);
			totalSourceBytes += estimateLiveSourceBytes(shard);
			if (group.length >= 2) {
				return {
					kind: "adjacent_small_shard_merge",
					inputShardIds: group.map((candidate) => candidate.shardId),
					estimatedInputSourceBytes: group.reduce(
						(sum, candidate) => sum + candidate.sourceBytes,
						0,
					),
					estimatedOutputSourceBytes: totalSourceBytes,
				};
			}
		}
	}
	return null;
}

export function chooseSmallShardRepackPlan(
	sealedShards: readonly ResidentShardDescriptor[],
): CompactPlan | null {
	const smallShards = sealedShards.filter(canUseAsSmallMergeInput);
	if (smallShards.length < SMALL_SHARD_REPACK_MIN_SHARD_COUNT) {
		return null;
	}
	const selectedShards: ResidentShardDescriptor[] = [];
	let totalOutputSourceBytes = 0;
	for (const shard of [...smallShards].sort(
		(left, right) =>
			estimateLiveSourceBytes(left) - estimateLiveSourceBytes(right) ||
			left.createdOrder - right.createdOrder,
	)) {
		if (selectedShards.length >= SMALL_SHARD_MERGE_MAX_INPUT_SHARDS) {
			break;
		}
		const liveSourceBytes = estimateLiveSourceBytes(shard);
		if (totalOutputSourceBytes + liveSourceBytes > SMALL_SHARD_MERGE_MAX_OUTPUT_SOURCE_BYTES) {
			continue;
		}
		selectedShards.push(shard);
		totalOutputSourceBytes += liveSourceBytes;
	}
	if (selectedShards.length < 2) {
		return null;
	}
	return {
		kind: "small_shard_repack",
		inputShardIds: selectedShards.map((shard) => shard.shardId),
		estimatedInputSourceBytes: selectedShards.reduce(
			(sum, shard) => sum + shard.sourceBytes,
			0,
		),
		estimatedOutputSourceBytes: totalOutputSourceBytes,
	};
}

export function canInternalCompact(shard: ResidentShardDescriptor): boolean {
	return (
		shard.state === "sealed" &&
		shard.sourceBytes >= INTERNAL_COMPACT_MIN_SOURCE_BYTES &&
		computeStaleSourceRatio(shard) >= INTERNAL_COMPACT_MIN_STALE_RATIO
	);
}

export function canUseAsSmallMergeInput(shard: ResidentShardDescriptor): boolean {
	return (
		shard.state === "sealed" &&
		shard.sourceBytes > 0 &&
		shard.sourceBytes <= SMALL_SHARD_MERGE_MAX_SINGLE_SOURCE_BYTES &&
		estimateLiveSourceBytes(shard) <= DEFAULT_SHARD_SEAL_SOURCE_BYTES
	);
}

export function estimateLiveSourceBytes(shard: ResidentShardDescriptor): number {
	return Math.max(0, shard.sourceBytes - (shard.staleSourceBytes ?? 0));
}

export function computeStaleSourceRatio(shard: ResidentShardDescriptor): number {
	if (shard.sourceBytes <= 0) {
		return 0;
	}
	return Math.min(1, Math.max(0, (shard.staleSourceBytes ?? 0) / shard.sourceBytes));
}
