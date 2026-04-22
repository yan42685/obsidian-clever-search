jest.mock("obsidian", () => ({
  TFile: class TFile {},
}));

jest.mock("src/services/search/hybrid/hybrid-profiler", () => ({
  beginHybridProfile: jest.fn(),
  endHybridProfile: jest.fn(),
  getHybridProfileMetric: jest.fn(() => 0),
  profileHybridStage: jest.fn(async (_name: string, work: () => Promise<unknown>) => await work()),
  setHybridProfileMeta: jest.fn(),
}));

jest.mock("src/services/obsidian/transformed-api", () => ({
  MyNotice: class MyNotice {
    hide() {}
    setText() {}
  },
}));

jest.mock("src/services/obsidian/translations/locale-helper", () => ({
  t: (key: string) => key,
}));

import { hashStableText } from "src/services/search/hybrid/incremental-reuse";
import {
  HybridBootstrapCoordinator,
  type HybridBootstrapPlan,
} from "src/services/obsidian/user-data/hybrid-bootstrap-coordinator";
import type { DocRegistryRow } from "src/services/database/database";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";

type TestFile = {
  path: string;
  stat: {
    mtime: number;
    size: number;
  };
};

function createCoordinatorHarness(params?: {
  currentFiles?: TestFile[];
  previousIndexedFileRefs?: Map<string, HybridIndexedFileRef>;
  previousDocRegistryEntries?: Map<string, DocRegistryRow>;
  readPlainText?: (file: TestFile) => Promise<string>;
  moveFileResult?: boolean;
}) {
  const currentFiles = params?.currentFiles ?? [];
  const previousIndexedFileRefs =
    params?.previousIndexedFileRefs ?? new Map<string, HybridIndexedFileRef>();
  const previousDocRegistryEntries =
    params?.previousDocRegistryEntries ?? new Map<string, DocRegistryRow>();
  const readPlainText =
    params?.readPlainText ??
    (async () => {
      throw new Error("readPlainText not stubbed");
    });
  const moveFile = jest.fn(async () => params?.moveFileResult ?? false);
  const deleteFile = jest.fn(async () => undefined);
  const runRepairTasks = jest.fn(async () => undefined);
  const restorePersistedRecoveryState = jest.fn(async () => undefined);
  const enqueuePersistedRecoveryStates = jest.fn(async () => undefined);
  const runPreflight = jest.fn(async () => undefined);

  const coordinator = new HybridBootstrapCoordinator({
    dataProvider: {
      allFilesToBeIndexed: () => currentFiles as any,
      readPlainText,
    } as any,
    hybridEngine: {
      isEnabled: () => true,
      shouldIndexPath: () => true,
      clearAll: async () => undefined,
      load: async () => undefined,
      moveFile,
      deleteFile,
      consumeIndexingFallbackNoticeKey: () => null,
    },
    shouldForceRefresh: () => false,
    blockRuntimeQueryGate: jest.fn(),
    syncRuntimeQueryGate: jest.fn(),
    repairStoredState: jest.fn(async () => ({
      repairedPaths: [],
      reindexedPaths: [],
      previousIndexedFileRefs,
      previousDocRegistryEntries,
    })),
    restorePersistedRecoveryState,
    runPreflight,
    createProgressNotice: () => null,
    runRepairTasks,
    enqueuePersistedRecoveryStates,
    noticeHybridIndexFailures: jest.fn(),
    getHybridIndexConcurrency: () => 2,
  });

  return {
    coordinator,
    moveFile,
    deleteFile,
    runRepairTasks,
    restorePersistedRecoveryState,
    enqueuePersistedRecoveryStates,
    runPreflight,
  };
}

describe("HybridBootstrapCoordinator", () => {
  test("preparePlan detects a unique fingerprint move from doc registry state", async () => {
    const newFile: TestFile = {
      path: "docs/new.md",
      stat: {
        mtime: 200,
        size: 12,
      },
    };
    const oldFingerprint = hashStableText("same body");
    const previousIndexedFileRefs = new Map<string, HybridIndexedFileRef>([
      [
        "docs/old.md",
        {
          path: "docs/old.md",
          docRef: 7,
          generation: 150,
          state: "ready",
        },
      ],
    ]);
    const previousDocRegistryEntries = new Map<string, DocRegistryRow>([
      [
        "docs/old.md",
        {
          docRef: 7,
          path: "docs/old.md",
          deleted: false,
          liveGeneration: 150,
          contentFingerprint: oldFingerprint,
          updatedAt: 1,
        },
      ],
    ]);
    const { coordinator, restorePersistedRecoveryState } = createCoordinatorHarness({
      currentFiles: [newFile],
      previousIndexedFileRefs,
      previousDocRegistryEntries,
      readPlainText: async () => "same body",
    });

    const plan = await coordinator.preparePlan();

    expect(plan).not.toBeNull();
    expect(plan?.docsToAdd).toEqual([]);
    expect(plan?.docsToDelete).toEqual([]);
    expect(plan?.docsToMove).toEqual([
      {
        oldPath: "docs/old.md",
        newPath: "docs/new.md",
        docRef: 7,
        sourceGeneration: 150,
      },
    ]);
    expect(restorePersistedRecoveryState).toHaveBeenCalledWith(
      new Map([["docs/new.md", newFile]]),
      previousIndexedFileRefs,
    );
  });

  test("healPlan prefers moveFile for startup moves and skips delete-plus-reindex when it succeeds", async () => {
    const newFile: TestFile = {
      path: "docs/new.md",
      stat: {
        mtime: 220,
        size: 24,
      },
    };
    const { coordinator, moveFile, deleteFile, runRepairTasks, enqueuePersistedRecoveryStates } =
      createCoordinatorHarness({
        currentFiles: [newFile],
        moveFileResult: true,
      });
    const plan: HybridBootstrapPlan = {
      currFiles: new Map([["docs/new.md", newFile as any]]),
      repairReport: {
        repairedPaths: [],
        reindexedPaths: [],
        previousIndexedFileRefs: new Map(),
        previousDocRegistryEntries: new Map(),
      },
      docsToAdd: [],
      docsToDelete: [],
      docsToMove: [
        {
          oldPath: "docs/old.md",
          newPath: "docs/new.md",
          docRef: 3,
          sourceGeneration: 220,
        },
      ],
    };

    const summary = await coordinator.healPlan(plan);

    expect(moveFile).toHaveBeenCalledWith("docs/old.md", "docs/new.md", 220);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(runRepairTasks).toHaveBeenCalledWith([], null, 0, []);
    expect(enqueuePersistedRecoveryStates).toHaveBeenCalledWith(
      new Set(["docs/old.md", "docs/new.md"]),
    );
    expect(summary).toEqual({
      docsToAdd: 0,
      docsToDelete: 0,
      repairedPaths: 0,
      failedFiles: 0,
      fallbackNoticeKey: null,
    });
  });
});
