jest.mock("src/services/search/hybrid/embedder", () => ({
  NoApiKeyError: class NoApiKeyError extends Error {},
  WeeklyTokenLimitExceededError: class WeeklyTokenLimitExceededError extends Error {},
}));

import {
  HybridEmbeddingRecoveryManager,
  isAutoRetryHybridFailureKind,
} from "src/services/obsidian/user-data/hybrid-embedding-recovery-manager";

describe("HybridEmbeddingRecoveryManager", () => {
  test("treats auth failures as blocking instead of auto-retryable", () => {
    const manager = new HybridEmbeddingRecoveryManager(() => {});

    manager.recordFailure(
      "docs/auth.md",
      100,
      "incremental",
      new Error("Embedding API Error 401 Unauthorized"),
      "auth failed",
      60_000,
    );

    expect(isAutoRetryHybridFailureKind("auth_401")).toBe(false);
    expect(isAutoRetryHybridFailureKind("auth_403")).toBe(false);
    const summary = manager.getSummary(1);
    expect(summary.retryableCount).toBe(0);
    expect(summary.nextRetryAt).toBeNull();
    expect(summary.blockingKinds).toEqual([{ kind: "auth_401", count: 1 }]);
  });

  test("keeps transient provider failures on the timed retry path", () => {
    const manager = new HybridEmbeddingRecoveryManager(() => {});

    manager.recordFailure(
      "docs/transient.md",
      100,
      "incremental",
      new Error("Embedding API Error 429 Too Many Requests"),
      "rate limited",
      60_000,
    );

    expect(isAutoRetryHybridFailureKind("provider_429")).toBe(true);
    const summary = manager.getSummary(1);
    expect(summary.retryableCount).toBe(1);
    expect(summary.nextRetryAt).not.toBeNull();
    expect(summary.retryableKinds).toEqual([
      { kind: "provider_429", count: 1 },
    ]);
  });

  test("tracks deferred embedding separately from failure summaries", () => {
    const manager = new HybridEmbeddingRecoveryManager(() => {});

    manager.recordDeferredEmbedding(
      "docs/deferred.md",
      100,
      "incremental",
      65_000,
    );

    expect(manager.hasFailures()).toBe(false);
    expect(manager.getSummary(1)).toEqual({
      failedCount: 0,
      totalFiles: 1,
      retryableCount: 0,
      nextRetryAt: null,
      retryableKinds: [],
      blockingKinds: [],
    });
    expect(manager.listDeferredEntries()).toEqual([
      expect.objectContaining({
        path: "docs/deferred.md",
        recoveryKind: "deferred_embedding",
        nextRetryAt: 65_000,
      }),
    ]);
  });
});