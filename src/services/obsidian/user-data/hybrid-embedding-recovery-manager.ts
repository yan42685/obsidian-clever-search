import {
	NoApiKeyError,
	WeeklyTokenLimitExceededError,
} from "src/services/search/hybrid/embedder";

export type HybridRepairMode = "incremental" | "full";

export type HybridEmbeddingFailureKind =
	| "missing_api_key"
	| "weekly_token_limit"
	| "quota_exhausted"
	| "auth_401"
	| "auth_403"
	| "provider_429"
	| "timeout"
	| "provider_5xx"
	| "network"
	| "unknown";

type HybridFailedEmbeddingEntry = {
	path: string;
	mode: HybridRepairMode;
	errorKind: HybridEmbeddingFailureKind;
	reason: string;
	lastFailedAt: number;
	nextRetryAt: number | null;
	attemptCount: number;
};

export type HybridFailedEmbeddingSummary = {
	failedCount: number;
	totalFiles: number;
	retryableCount: number;
	nextRetryAt: number | null;
	retryableKinds: Array<{
		kind: HybridEmbeddingFailureKind;
		count: number;
	}>;
	blockingKinds: Array<{
		kind: HybridEmbeddingFailureKind;
		count: number;
	}>;
};

export function isAutoRetryHybridFailureKind(
	kind: HybridEmbeddingFailureKind,
): boolean {
	return (
		kind === "network" ||
		kind === "timeout" ||
		kind === "provider_429" ||
		kind === "provider_5xx"
	);
}

export class HybridEmbeddingRecoveryManager {
	private readonly failedEmbeddings = new Map<string, HybridFailedEmbeddingEntry>();
	private readonly onChanged: () => void;

	constructor(onChanged: () => void) {
		this.onChanged = onChanged;
	}

	hasFailures(): boolean {
		return this.failedEmbeddings.size > 0;
	}

	clearAll(): void {
		if (this.failedEmbeddings.size === 0) {
			return;
		}
		this.failedEmbeddings.clear();
		this.onChanged();
	}

	clearPath(path: string): void {
		if (!this.failedEmbeddings.delete(path)) {
			return;
		}
		this.onChanged();
	}

	movePath(oldPath: string, newPath: string): void {
		const entry = this.failedEmbeddings.get(oldPath);
		if (!entry) {
			return;
		}
		this.failedEmbeddings.delete(oldPath);
		this.failedEmbeddings.set(newPath, {
			...entry,
			path: newPath,
		});
		this.onChanged();
	}

	recordFailure(
		path: string,
		mode: HybridRepairMode,
		error: unknown,
		reason: string,
		retryIntervalMs: number,
	): void {
		const errorKind = this.classifyErrorKind(error);

		const previous = this.failedEmbeddings.get(path);
		this.failedEmbeddings.set(path, {
			path,
			mode:
				previous?.mode === "full" || mode === "full"
					? "full"
					: "incremental",
			errorKind,
			reason,
			lastFailedAt: Date.now(),
			nextRetryAt: isAutoRetryHybridFailureKind(errorKind)
				? Date.now() + retryIntervalMs
				: null,
			attemptCount: (previous?.attemptCount ?? 0) + 1,
		});
		this.onChanged();
	}

	getSummary(totalFiles: number): HybridFailedEmbeddingSummary {
		const blockingCounts = new Map<HybridEmbeddingFailureKind, number>();
		const retryableCounts = new Map<HybridEmbeddingFailureKind, number>();
		let retryableCount = 0;
		let nextRetryAt: number | null = null;

		for (const entry of this.failedEmbeddings.values()) {
			if (isAutoRetryHybridFailureKind(entry.errorKind)) {
				retryableCount += 1;
				retryableCounts.set(
					entry.errorKind,
					(retryableCounts.get(entry.errorKind) ?? 0) + 1,
				);
				if (
					entry.nextRetryAt !== null &&
					(nextRetryAt === null || entry.nextRetryAt < nextRetryAt)
				) {
					nextRetryAt = entry.nextRetryAt;
				}
				continue;
			}

			blockingCounts.set(
				entry.errorKind,
				(blockingCounts.get(entry.errorKind) ?? 0) + 1,
			);
		}

		return {
			failedCount: this.failedEmbeddings.size,
			totalFiles,
			retryableCount,
			nextRetryAt,
			retryableKinds: Array.from(retryableCounts.entries())
				.sort((left, right) => right[1] - left[1])
				.map(([kind, count]) => ({ kind, count })),
			blockingKinds: Array.from(blockingCounts.entries())
				.sort((left, right) => right[1] - left[1])
				.map(([kind, count]) => ({ kind, count })),
		};
	}

	refreshRetrySchedule(retryIntervalMs: number): void {
		let changed = false;
		for (const entry of this.failedEmbeddings.values()) {
			if (!isAutoRetryHybridFailureKind(entry.errorKind)) {
				continue;
			}
			entry.nextRetryAt = entry.lastFailedAt + retryIntervalMs;
			changed = true;
		}
		if (changed) {
			this.onChanged();
		}
	}

	getNextRetryAt(): number | null {
		let nextRetryAt = Number.POSITIVE_INFINITY;
		for (const entry of this.failedEmbeddings.values()) {
			if (
				isAutoRetryHybridFailureKind(entry.errorKind) &&
				entry.nextRetryAt !== null
			) {
				nextRetryAt = Math.min(nextRetryAt, entry.nextRetryAt);
			}
		}
		return Number.isFinite(nextRetryAt) ? nextRetryAt : null;
	}

	listPathsReadyForRetry(now = Date.now()): string[] {
		return Array.from(this.failedEmbeddings.values())
			.filter(
				(entry) =>
					isAutoRetryHybridFailureKind(entry.errorKind) &&
					entry.nextRetryAt !== null &&
					entry.nextRetryAt <= now,
			)
			.map((entry) => entry.path);
	}

	listTrackedPaths(): string[] {
		return Array.from(this.failedEmbeddings.keys());
	}

	getEntry(path: string): { path: string; mode: HybridRepairMode } | null {
		const entry = this.failedEmbeddings.get(path);
		if (!entry) {
			return null;
		}
		return {
			path: entry.path,
			mode: entry.mode,
		};
	}

	markRetryQueued(
		path: string,
		retryIntervalMs: number,
	): void {
		const entry = this.failedEmbeddings.get(path);
		if (!entry || !isAutoRetryHybridFailureKind(entry.errorKind)) {
			return;
		}
		entry.nextRetryAt = Date.now() + retryIntervalMs;
		this.onChanged();
	}

	private classifyErrorKind(error: unknown): HybridEmbeddingFailureKind {
		if (error instanceof NoApiKeyError) {
			return "missing_api_key";
		}
		if (error instanceof WeeklyTokenLimitExceededError) {
			return "weekly_token_limit";
		}
		if (!(error instanceof Error)) {
			return "unknown";
		}

		const message = `${error.name}: ${error.message}`.toLowerCase();
		if (
			message.includes("insufficient_quota") ||
			message.includes("quota exhausted") ||
			message.includes("quota exceeded")
		) {
			return "quota_exhausted";
		}

		const statusMatch = message.match(/embedding api error (\d{3})/);
		if (statusMatch) {
			const status = Number(statusMatch[1]);
			if (status === 401) return "auth_401";
			if (status === 403) return "auth_403";
			if (status === 408) return "timeout";
			if (status === 409 || status === 425 || status === 429) {
				return "provider_429";
			}
			if (status >= 500) return "provider_5xx";
		}

		if (error.name === "AbortError" || message.includes("timeout")) {
			return "timeout";
		}
		if (
			message.includes("failed to fetch") ||
			message.includes("network") ||
			message.includes("econn") ||
			message.includes("socket")
		) {
			return "network";
		}
		return "unknown";
	}
}
