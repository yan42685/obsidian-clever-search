import type { DocRef } from "src/globals/search-types";

export type IndexRecoveryEngine = "hybrid" | "lexical";

export type HybridRepairMode = "incremental" | "full";

export type HybridRecoveryKind = "failure" | "deferred_embedding";

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

export type IndexRecoveryState =
  | "retryable_waiting"
  | "retryable_ready"
  | "blocking"
  | "deferred_waiting"
  | "deferred_ready";

export type IndexRecoveryStateRow = {
  id: string;
  engine: IndexRecoveryEngine;
  docRef?: DocRef;
  path: string;
  targetGeneration: number;
  mode: HybridRepairMode;
  recoveryKind: HybridRecoveryKind;
  state: IndexRecoveryState;
  failureKind: HybridEmbeddingFailureKind | null;
  failureMessage: string | null;
  attemptCount: number;
  lastFailedAt: number | null;
  nextRetryAt: number | null;
  isBlocking: boolean;
};
export function buildIndexRecoveryStateId(
  engine: IndexRecoveryEngine,
  path: string,
): string {
  return `${engine}:${path}`;
}

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

export function deriveIndexRecoveryState(
  failureKind: HybridEmbeddingFailureKind,
  nextRetryAt: number | null,
  now = Date.now(),
): Extract<
  IndexRecoveryState,
  "retryable_waiting" | "retryable_ready" | "blocking"
> {
  if (!isAutoRetryHybridFailureKind(failureKind)) {
    return "blocking";
  }
  return nextRetryAt !== null && nextRetryAt > now
    ? "retryable_waiting"
    : "retryable_ready";
}
export function deriveDeferredIndexRecoveryState(
  nextRetryAt: number | null,
  now = Date.now(),
): Extract<IndexRecoveryState, "deferred_waiting" | "deferred_ready"> {
  return nextRetryAt !== null && nextRetryAt > now
    ? "deferred_waiting"
    : "deferred_ready";
}
