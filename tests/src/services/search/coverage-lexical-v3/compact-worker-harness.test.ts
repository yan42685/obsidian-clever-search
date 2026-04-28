import {
	createBlobCompactWorker,
	runCompactWorkerComputeAsync,
	type CompactWorkerRuntime,
} from "src/services/search/coverage-lexical-v3/compact";
import type { CompactWorkerRequest } from "src/services/search/coverage-lexical-v3/compact";

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

	test("falls back to synchronous compute when Blob Worker is unavailable", async () => {
		const responses = await runCompactWorkerComputeAsync(request(), { useBlobWorker: false });

		expect(responses.at(-1)?.type).toBe("done");
	});
});
