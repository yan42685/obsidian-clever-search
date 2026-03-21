import { MyLib } from "src/utils/my-lib";

export type RetryAsyncOptions = {
	maxAttempts: number;
	shouldRetry?: (error: unknown, attempt: number) => boolean;
	getDelayMs?: (error: unknown, attempt: number) => number;
	onRetry?: (error: unknown, attempt: number, delayMs: number) => void | Promise<void>;
};

export async function retryAsync<T>(
	work: (attempt: number) => Promise<T>,
	options: RetryAsyncOptions,
): Promise<T> {
	const shouldRetry = options.shouldRetry ?? (() => false);
	const getDelayMs = options.getDelayMs ?? (() => 0);
	let lastError: unknown = null;

	for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
		try {
			return await work(attempt);
		} catch (error) {
			lastError = error;
			if (attempt >= options.maxAttempts || !shouldRetry(error, attempt)) {
				throw error;
			}
			const delayMs = Math.max(0, getDelayMs(error, attempt));
			await options.onRetry?.(error, attempt, delayMs);
			if (delayMs > 0) {
				await MyLib.sleep(delayMs);
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("retryAsync exhausted without a terminal result");
}

export class AsyncRateGate {
	private gate: Promise<void> = Promise.resolve();
	private nextAllowedAt = 0;

	constructor(private readonly minSpacingMs: number) {}

	async wait(): Promise<void> {
		let release!: () => void;
		const previousGate = this.gate;
		this.gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		await previousGate;
		try {
			const delayMs = Math.max(0, this.nextAllowedAt - Date.now());
			if (delayMs > 0) {
				await MyLib.sleep(delayMs);
			}
			this.nextAllowedAt = Date.now() + this.minSpacingMs;
		} finally {
			release();
		}
	}
}

export type WeightedTaskRunnerOptions<T> = {
	maxConcurrent: number;
	maxWeight: number;
	getWeight: (item: T) => number;
	isExclusive?: (item: T) => boolean;
};

export async function runWeightedTasks<T>(
	items: T[],
	options: WeightedTaskRunnerOptions<T>,
	handler: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) {
		return;
	}

	const maxConcurrent = Math.max(1, options.maxConcurrent);
	const maxWeight = Math.max(1, options.maxWeight);
	const isExclusive = options.isExclusive ?? (() => false);

	let nextIndex = 0;
	let inFlight = 0;
	let inFlightWeight = 0;
	let hasExclusiveTask = false;

	await new Promise<void>((resolve, reject) => {
		const schedule = () => {
			if (nextIndex >= items.length && inFlight === 0) {
				resolve();
				return;
			}

			while (nextIndex < items.length) {
				const item = items[nextIndex];
				const weight = Math.max(1, options.getWeight(item));
				const exclusive = isExclusive(item);
				const canRunExclusive = exclusive && !hasExclusiveTask && inFlight === 0;
				const canRunShared =
					!exclusive &&
					!hasExclusiveTask &&
					inFlight < maxConcurrent &&
					(inFlight === 0 || inFlightWeight + weight <= maxWeight);

				if (!canRunExclusive && !canRunShared) {
					break;
				}

				nextIndex += 1;
				inFlight += 1;
				inFlightWeight += weight;
				if (exclusive) {
					hasExclusiveTask = true;
				}

				void handler(item)
					.then(() => {
						inFlight -= 1;
						inFlightWeight -= weight;
						if (exclusive) {
							hasExclusiveTask = false;
						}
						schedule();
					})
					.catch((error) => reject(error));
			}
		};

		schedule();
	});
}
