import {
	createBlobCompactWorker,
	handleCompactWorkerRequest,
	runCompactWorkerComputeAsync,
	type CompactWorkerRuntime,
} from "src/services/search/coverage-lexical-v3/compact";
import type {
	CompactWorkerRequest,
	CompactWorkerResponse,
} from "src/services/search/coverage-lexical-v3/compact";

function request(): CompactWorkerRequest {
	return {
		type: "start",
		jobId: "job-1",
		kind: "internal",
		inputShardIds: ["sealed-1"],
		outputShardId: "sealed-2",
		config: {
			maxInputShards: 2,
			maxInputSourceBytes: 16 * 1024 * 1024,
			mainThreadBatchTargetMs: 100,
			mainThreadBatchHardCeilingMs: 500,
		},
		input: {
			inputShards: [
				{
					shardId: "sealed-1",
					generation: 1,
					state: "sealed",
					sourceBytes: 100,
					docCount: 4,
					createdOrder: 1,
					artifactOwner: "sealed-1",
				},
			],
			invalidatedDocKeys: ["1@1"],
		},
	};
}

class InlineWorker implements CompactWorkerRuntime {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	private scope: { onmessage?: (event: { data: CompactWorkerRequest }) => void; postMessage: (response: unknown) => void };

	constructor(source: string) {
		this.scope = {
			postMessage: (response) => {
				setTimeout(() => this.onmessage?.({ data: response } as MessageEvent), 0);
			},
		};
		new Function("self", source)(this.scope);
	}

	postMessage(message: CompactWorkerRequest): void {
		setTimeout(() => this.scope.onmessage?.({ data: message }), 0);
	}

	terminate(): void {}
}

function normalizeTiming(
	responses: readonly CompactWorkerResponse[],
): readonly CompactWorkerResponse[] {
	return responses.map((response) => {
		if (response.type === "progress") {
			return {
				...response,
				elapsedMs: 0,
			};
		}
		if (response.type === "done") {
			return {
				...response,
				stats: {
					...response.stats,
					workerTotalMs: 0,
				},
			};
		}
		return response;
	});
}

describe("coverage lexical v3 compact blob worker harness", () => {
	test("creates a Blob Worker from embedded compact source", () => {
		let capturedSource = "";
		const worker = createBlobCompactWorker((source) => {
			capturedSource = source;
			return new InlineWorker(source);
		});

		expect(capturedSource).toContain("runCompactCompute");
		worker.terminate();
	});

	test("runs compact compute through worker protocol and emits done after batches", async () => {
		const responses = await runCompactWorkerComputeAsync(request(), {
			factory: (source) => new InlineWorker(source),
		});

		expect(responses.map((response) => response.type)).toEqual([
			"ready",
			"progress",
			"batch",
			"done",
		]);
		const done = responses.find((response) => response.type === "done");
		const batch = responses.find((response) => response.type === "batch");
		expect(batch?.type === "batch" ? batch.rows[0] : null).toEqual(
			expect.objectContaining({
				inputSourceBytes: 100,
				outputSourceBytes: 75,
			}),
		);
		expect(done?.type === "done" ? done.stats.outputSourceBytes : 0).toBe(75);
	});

	test("keeps embedded worker compute output in parity with the fallback handler", async () => {
		const baseRequest = request();
		if (baseRequest.type !== "start") {
			throw new Error("compact parity fixture requires a start request");
		}
		const fixture: CompactWorkerRequest = {
			...baseRequest,
			jobId: "job-parity",
			inputShardIds: ["sealed-1", "sealed-2"],
			input: {
				inputShards: [
					{
						shardId: "sealed-1",
						generation: 1,
						state: "sealed",
						sourceBytes: 100,
						docCount: 4,
						createdOrder: 1,
						artifactOwner: "sealed-1",
					},
					{
						shardId: "sealed-2",
						generation: 3,
						state: "sealed",
						sourceBytes: 300,
						docCount: 6,
						staleSourceBytes: 120,
						staleDocCount: 2,
						createdOrder: 2,
						artifactOwner: "sealed-2",
					},
				],
				invalidatedDocKeys: ["sealed-1@1:docref:1@10", "sealed-2@3:docref:2@20"],
			},
		};

		const embeddedResponses = await runCompactWorkerComputeAsync(fixture, {
			factory: (source) => new InlineWorker(source),
		});
		const fallbackResponses = handleCompactWorkerRequest(fixture);

		expect(normalizeTiming(embeddedResponses)).toEqual(
			normalizeTiming(fallbackResponses),
		);
	});

	test("falls back to synchronous compute when Blob Worker is unavailable", async () => {
		const responses = await runCompactWorkerComputeAsync(request(), { useBlobWorker: false });

		expect(responses.at(-1)?.type).toBe("done");
	});
});
