import { runCompactCompute } from "./compute";
import type { CompactWorkerRequest, CompactWorkerResponse } from "./types";

export type CompactWorkerRuntime = Pick<Worker, "postMessage" | "terminate"> & {
	onmessage: ((event: MessageEvent<CompactWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
};

export type CompactWorkerFactory = (source: string) => CompactWorkerRuntime;

const COMPACT_WORKER_SOURCE = `
const safeRatio = (numerator, denominator) => denominator <= 0 ? 0 : Math.min(1, Math.max(0, numerator / denominator));
const runCompactCompute = (input) => {
  const startedAt = Date.now();
  const inputSourceBytes = input.inputShards.reduce((sum, shard) => sum + shard.sourceBytes, 0);
  const inputDocCount = input.inputShards.reduce((sum, shard) => sum + shard.docCount, 0);
  const droppedDocCount = input.invalidatedDocKeys.length;
  const liveDocCount = Math.max(0, inputDocCount - droppedDocCount);
  const outputSourceBytes = Math.max(0, inputSourceBytes - Math.floor(inputSourceBytes * safeRatio(droppedDocCount, inputDocCount)));
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
    batches: [{
      batchKind: "metadata",
      batchIndex: 0,
      rows: [{
        inputShardIds: input.inputShards.map((shard) => shard.shardId),
        inputSourceBytes,
        outputSourceBytes,
        liveDocCount,
        droppedDocCount,
      }],
    }],
  };
};
self.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    self.postMessage({ type: "cancelled", jobId: request.jobId });
    return;
  }
  try {
    self.postMessage({ type: "ready" });
    const result = runCompactCompute(request.input);
    self.postMessage({
      type: "progress",
      jobId: request.jobId,
      processedDocs: result.stats.liveDocCount + result.stats.droppedDocCount,
      totalDocs: result.stats.liveDocCount + result.stats.droppedDocCount,
      processedSourceBytes: result.stats.inputSourceBytes,
      emittedRows: result.batches.reduce((sum, batch) => sum + batch.rows.length, 0),
      elapsedMs: result.stats.workerTotalMs,
    });
    for (const batch of result.batches) {
      self.postMessage({
        type: "batch",
        jobId: request.jobId,
        batchKind: batch.batchKind,
        batchIndex: batch.batchIndex,
        rows: batch.rows,
      });
    }
    self.postMessage({ type: "done", jobId: request.jobId, stats: result.stats });
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};
`;

export function handleCompactWorkerRequest(
	request: CompactWorkerRequest,
): readonly CompactWorkerResponse[] {
	if (request.type === "cancel") {
		return [{ type: "cancelled", jobId: request.jobId }];
	}
	try {
		const result = runCompactCompute(request.input);
		return [
			{ type: "ready" },
			{
				type: "progress",
				jobId: request.jobId,
				processedDocs: result.stats.liveDocCount + result.stats.droppedDocCount,
				totalDocs: result.stats.liveDocCount + result.stats.droppedDocCount,
				processedSourceBytes: result.stats.inputSourceBytes,
				emittedRows: result.batches.reduce((sum, batch) => sum + batch.rows.length, 0),
				elapsedMs: result.stats.workerTotalMs,
			},
			...result.batches.map(
				(batch): CompactWorkerResponse => ({
					type: "batch",
					jobId: request.jobId,
					batchKind: batch.batchKind,
					batchIndex: batch.batchIndex,
					rows: batch.rows,
				}),
			),
			{ type: "done", jobId: request.jobId, stats: result.stats },
		];
	} catch (error) {
		return [
			{
				type: "error",
				jobId: request.jobId,
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
		];
	}
}

export function runCompactWorkerCompute(
	request: CompactWorkerRequest,
): readonly CompactWorkerResponse[] {
	return handleCompactWorkerRequest(request);
}

export function createBlobCompactWorker(factory: CompactWorkerFactory = defaultWorkerFactory): CompactWorkerRuntime {
	return factory(COMPACT_WORKER_SOURCE);
}

export function runCompactWorkerComputeAsync(
	request: CompactWorkerRequest,
	options: Readonly<{
		factory?: CompactWorkerFactory;
		useBlobWorker?: boolean;
	}> = {},
): Promise<readonly CompactWorkerResponse[]> {
	if (request.type === "cancel" || options.useBlobWorker === false || !canUseBlobWorker(options.factory)) {
		return Promise.resolve(handleCompactWorkerRequest(request));
	}
	return new Promise((resolve) => {
		const responses: CompactWorkerResponse[] = [];
		const worker = createBlobCompactWorker(options.factory);
		worker.onmessage = (event) => {
			responses.push(event.data);
			if (event.data.type === "done" || event.data.type === "error" || event.data.type === "cancelled") {
				worker.terminate();
				resolve(responses);
			}
		};
		worker.onerror = (event) => {
			worker.terminate();
			resolve([
				{
					type: "error",
					jobId: request.jobId,
					message: event.message,
				},
			]);
		};
		worker.postMessage(request);
	});
}

function canUseBlobWorker(factory: CompactWorkerFactory | undefined): boolean {
	return factory != null || (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined");
}

function defaultWorkerFactory(source: string): CompactWorkerRuntime {
	const blob = new Blob([source], { type: "text/javascript" });
	const url = URL.createObjectURL(blob);
	const worker = new Worker(url) as CompactWorkerRuntime;
	const originalTerminate = worker.terminate.bind(worker);
	worker.terminate = () => {
		URL.revokeObjectURL(url);
		originalTerminate();
	};
	return worker;
}
