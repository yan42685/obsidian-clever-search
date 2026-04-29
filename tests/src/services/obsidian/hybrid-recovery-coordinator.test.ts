jest.mock("src/services/database/database", () => ({
  Database: class Database {},
}));

const mockPutIndexRecoveryState = jest.fn(async () => undefined);
const mockDeleteIndexRecoveryState = jest.fn(async () => undefined);
const mockMoveIndexRecoveryState = jest.fn(async () => undefined);
const mockGetIndexRecoveryStates = jest.fn(async () => []);
const mockBulkPutIndexRecoveryStates = jest.fn(async () => undefined);

jest.mock("src/utils/my-lib", () => ({
  getInstance: jest.fn(() => ({
    putIndexRecoveryState: mockPutIndexRecoveryState,
    deleteIndexRecoveryState: mockDeleteIndexRecoveryState,
    moveIndexRecoveryState: mockMoveIndexRecoveryState,
    getIndexRecoveryStates: mockGetIndexRecoveryStates,
    bulkPutIndexRecoveryStates: mockBulkPutIndexRecoveryStates,
  })),
}));

import { HybridRecoveryCoordinator } from "src/services/obsidian/user-data/hybrid-recovery-coordinator";

describe("HybridRecoveryCoordinator startup recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createCoordinator() {
    const enqueueRepair = jest.fn();
    const coordinator = new HybridRecoveryCoordinator({
      canRetryPath: () => true,
      enqueueRepair,
      onChanged: jest.fn(),
      getFailedEmbeddingRetryIntervalMs: () => 60_000,
    });

    return { coordinator: coordinator as any, enqueueRepair };
  }

  test("queues persisted unknown failures immediately when no retry time was stored", async () => {
    const { coordinator, enqueueRepair } = createCoordinator();
    coordinator.recoveryManager.replaceAll([
      {
        path: "docs/unknown.md",
        targetGeneration: 100,
        mode: "incremental",
        recoveryKind: "failure",
        errorKind: "unknown",
        reason: "Recovered persisted hybrid failure state",
        lastFailedAt: 100,
        nextRetryAt: null,
        attemptCount: 1,
      },
    ]);

    await coordinator.enqueuePersistedStartupRepairs(new Set());

    expect(enqueueRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "docs/unknown.md",
        mode: "incremental",
        reason: "startup-recover-persisted-retryable-failure",
        sourceGeneration: 100,
      }),
    );
    expect(mockPutIndexRecoveryState).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "docs/unknown.md",
        failureKind: "unknown",
        state: "retryable_waiting",
      }),
    );
  });

  test("probes hard blocking failures once during startup repair", async () => {
    const { coordinator, enqueueRepair } = createCoordinator();
    coordinator.recoveryManager.replaceAll([
      {
        path: "docs/auth.md",
        targetGeneration: 100,
        mode: "incremental",
        recoveryKind: "failure",
        errorKind: "auth_401",
        reason: "auth failed",
        lastFailedAt: 100,
        nextRetryAt: null,
        attemptCount: 1,
      },
    ]);

    await coordinator.enqueuePersistedStartupRepairs(new Set());

    expect(enqueueRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "docs/auth.md",
        mode: "incremental",
        reason: "startup-probe-persisted-blocking-failure",
        sourceGeneration: 100,
      }),
    );
    expect(mockPutIndexRecoveryState).not.toHaveBeenCalled();
  });
});
