import type { CompactJobStats, CompactWorkerInput } from "./types";

export type CompactComputeResult = Readonly<{
	stats: CompactJobStats;
	batches: readonly Readonly<{
		batchKind: "metadata";
		batchIndex: number;
		rows: readonly unknown[];
	}>[];
}>;

export function runCompactCompute(input: CompactWorkerInput): CompactComputeResult {
	const startedAt = Date.now();
	const inputSourceBytes = input.inputShards.reduce(
		(sum, shard) => sum + shard.sourceBytes,
		0,
	);
	const inputDocCount = input.inputShards.reduce((sum, shard) => sum + shard.docCount, 0);
	const droppedDocCount = input.invalidatedDocKeys.length;
	const liveDocCount = Math.max(0, inputDocCount - droppedDocCount);
	const outputSourceBytes = Math.max(
		0,
		inputSourceBytes - Math.floor(inputSourceBytes * safeRatio(droppedDocCount, inputDocCount)),
	);
	return {
		stats: {
			inputShardCount: input.inputShards.length,
			inputSourceBytes,
			outputSourceBytes,
			liveDocCount,
			droppedDocCount,
			workerTotalMs: Math.max(0, Date.now() - startedAt),
			mainReadBatchMaxMs: 0,
			mainWriteBatchMaxMs: 0,
			commitMs: 0,
		},
		batches: [
			{
				batchKind: "metadata",
				batchIndex: 0,
				rows: [
					{
						inputShardIds: input.inputShards.map((shard) => shard.shardId),
						inputSourceBytes,
						outputSourceBytes,
						liveDocCount,
						droppedDocCount,
					},
				],
			},
		],
	};
}

function safeRatio(numerator: number, denominator: number): number {
	return denominator <= 0 ? 0 : Math.min(1, Math.max(0, numerator / denominator));
}
