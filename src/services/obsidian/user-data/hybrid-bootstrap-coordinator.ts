import type { TFile } from "obsidian";
import {
  beginHybridProfile,
  endHybridProfile,
  getHybridProfileMetric,
  profileHybridStage,
  setHybridProfileMeta,
} from "src/services/search/hybrid/hybrid-profiler";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";
import { logger } from "src/utils/logger";
import { MyNotice } from "../transformed-api";
import { t, type LocaleKey } from "../translations/locale-helper";
import type { DataProvider } from "./data-provider";
import type { HybridRepairMode } from "./index-recovery-state";

export type HybridIndexFailure = {
  path: string;
  reason: string;
  attempts: number;
  bm25FallbackIndexed: boolean;
};

type HybridStorageRepairReport = {
  repairedPaths: string[];
  reindexedPaths: string[];
  previousIndexedFileRefs: Map<string, HybridIndexedFileRef>;
};

export type HybridBootstrapPlan = {
  currFiles: Map<string, TFile>;
  repairReport: HybridStorageRepairReport;
  docsToAdd: TFile[];
  docsToDelete: string[];
};

export type HybridBootstrapSummary = {
  docsToAdd: number;
  docsToDelete: number;
  repairedPaths: number;
  failedFiles: number;
  fallbackNoticeKey: LocaleKey | null;
};

export type HybridIndexProgress = {
  stage: "repair" | "index" | "done";
  totalBytes: number;
  totalFiles: number;
  processedBytes: number;
  processedFiles: number;
  repairedPaths: number;
  failedFiles: number;
  sessionTokens: number;
};

export type HybridProgressReporter = {
  update(progress: HybridIndexProgress, force?: boolean): void;
  hide(): void;
};

export type HybridBootstrapRepairTask = {
  path: string;
  mode: HybridRepairMode;
  reason: string;
  eligibleAt: number;
  enqueuedAt: number;
  sourceGeneration?: number;
};

type HybridBootstrapEngine = {
  isEnabled(): boolean;
  shouldIndexPath(path: string): boolean;
  clearAll(): Promise<void>;
  load(): Promise<void>;
  deleteFile(
    path: string,
    options?: { persistIndices?: boolean },
  ): Promise<void>;
  consumeIndexingFallbackNoticeKey(): LocaleKey | null;
};

type HybridBootstrapCoordinatorOptions = {
  dataProvider: DataProvider;
  hybridEngine: HybridBootstrapEngine;
  shouldForceRefresh: () => boolean;
  markSearchBlocked: () => void;
  syncSearchAvailability: () => void;
  repairStoredState: (
    currFiles: Map<string, TFile>,
  ) => Promise<HybridStorageRepairReport>;
  restorePersistedRecoveryState: (
    currFiles: ReadonlyMap<string, TFile>,
    previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>,
  ) => Promise<void>;
  runPreflight: (
    currFiles: Map<string, TFile>,
    docsToAdd: TFile[],
    docsToDelete: string[],
    previousIndexedFileRefs?: ReadonlyMap<string, HybridIndexedFileRef>,
  ) => Promise<void>;
  createProgressNotice: (
    docsToAdd: TFile[],
    repairedPaths: number,
  ) => HybridProgressReporter | null;
  runRepairTasks: (
    tasks: HybridBootstrapRepairTask[],
    progressNotice: HybridProgressReporter | null,
    repairedPaths: number,
    failures: HybridIndexFailure[],
  ) => Promise<void>;
  enqueuePersistedRecoveryStates: (skipPaths: ReadonlySet<string>) => Promise<void>;
  noticeHybridIndexFailures: (failures: HybridIndexFailure[]) => void;
  getHybridIndexConcurrency: () => number;
};

export class HybridBootstrapCoordinator {
  constructor(private readonly options: HybridBootstrapCoordinatorOptions) {}

  async preparePlan(): Promise<HybridBootstrapPlan | null> {
    if (!this.options.hybridEngine.isEnabled()) {
      this.options.markSearchBlocked();
      return null;
    }
    beginHybridProfile("hybrid-init", {
      forceRefresh: this.options.shouldForceRefresh() ? 1 : 0,
    });

    try {
      if (this.options.shouldForceRefresh()) {
        await profileHybridStage("startup.clear_all", async () => {
          await this.options.hybridEngine.clearAll();
        });
      }
      await profileHybridStage("startup.load_engine", async () => {
        await this.options.hybridEngine.load();
      });
      const currFiles = await profileHybridStage(
        "startup.scan_indexable_files",
        async () => this.collectCurrentFiles(),
      );
      const repairReport = await profileHybridStage(
        "startup.repair_stored_state",
        async () => await this.options.repairStoredState(currFiles),
      );
      const previousIndexedFileRefs = repairReport.previousIndexedFileRefs;
      await this.options.restorePersistedRecoveryState(
        currFiles,
        previousIndexedFileRefs,
      );
      const { docsToAdd, docsToDelete } = this.planFileSetChanges(
        currFiles,
        previousIndexedFileRefs,
        repairReport.reindexedPaths,
      );

      logger.trace(`hybrid docs to delete: ${docsToDelete.length}`);
      logger.trace(`hybrid docs to add: ${docsToAdd.length}`);
      return {
        currFiles,
        repairReport,
        docsToAdd,
        docsToDelete,
      };
    } catch (error) {
      this.options.markSearchBlocked();
      endHybridProfile({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async healPlan(
    plan: HybridBootstrapPlan | null,
  ): Promise<HybridBootstrapSummary | null> {
    if (!plan) {
      return null;
    }

    const { currFiles, repairReport, docsToAdd, docsToDelete } = plan;
    const hybridIndexStart = Date.now();
    const concurrency = this.options.getHybridIndexConcurrency();
    setHybridProfileMeta("concurrency", concurrency);
    setHybridProfileMeta("docsToAdd", docsToAdd.length);
    setHybridProfileMeta("docsToDelete", docsToDelete.length);
    logger.debug(
      `hybrid batch start: delete=${docsToDelete.length}, add=${docsToAdd.length}, concurrency=${concurrency}`,
    );
    await this.options.runPreflight(
      currFiles,
      docsToAdd,
      docsToDelete,
      repairReport.previousIndexedFileRefs,
    );
    const progressNotice = this.options.createProgressNotice(
      docsToAdd,
      repairReport.repairedPaths.length,
    );
    const failures: HybridIndexFailure[] = [];
    const repairTasks: HybridBootstrapRepairTask[] = docsToAdd.map((file) => ({
      path: file.path,
      mode: "incremental",
      reason: "startup-self-heal",
      eligibleAt: Date.now(),
      enqueuedAt: Date.now(),
    }));

    try {
      await profileHybridStage("startup.delete_stale_paths", async () => {
        for (const path of docsToDelete) {
          await this.options.hybridEngine
            .deleteFile(path, { persistIndices: false })
            .catch((error) =>
              logger.warn(`hybrid deleteFile failed for ${path}:`, error),
            );
        }
      });
      await profileHybridStage("startup.index_files", async () => {
        await this.options.runRepairTasks(
          repairTasks,
          progressNotice,
          repairReport.repairedPaths.length,
          failures,
        );
      });
      const fallbackNoticeKey =
        this.options.hybridEngine.consumeIndexingFallbackNoticeKey();
      if (failures.length > 0) {
        this.options.noticeHybridIndexFailures(failures);
      } else if (fallbackNoticeKey) {
        new MyNotice(t(fallbackNoticeKey), 7000);
      }
      progressNotice?.update(
        {
          stage: "done",
          totalBytes: docsToAdd.reduce((sum, file) => sum + file.stat.size, 0),
          totalFiles: docsToAdd.length,
          processedBytes: docsToAdd.reduce(
            (sum, file) => sum + file.stat.size,
            0,
          ),
          processedFiles: docsToAdd.length,
          repairedPaths: repairReport.repairedPaths.length,
          failedFiles: failures.length,
          sessionTokens: getHybridProfileMetric("provider_tokens"),
        },
        true,
      );
      logger.debug(
        `hybrid batch finished in ${Date.now() - hybridIndexStart} ms, failures=${failures.length}, persisted=true, repaired=${repairReport.repairedPaths.length}`,
      );
      this.options.syncSearchAvailability();
      await this.options.enqueuePersistedRecoveryStates(
        new Set<string>([
          ...docsToAdd.map((file) => file.path),
          ...docsToDelete,
        ]),
      );
      endHybridProfile({
        failures: failures.length,
        repairedPaths: repairReport.repairedPaths.length,
      });
      return {
        docsToAdd: docsToAdd.length,
        docsToDelete: docsToDelete.length,
        repairedPaths: repairReport.repairedPaths.length,
        failedFiles: failures.length,
        fallbackNoticeKey,
      };
    } catch (error) {
      this.options.markSearchBlocked();
      endHybridProfile({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      progressNotice?.hide();
    }
  }

  private collectCurrentFiles(): Map<string, TFile> {
    return new Map<string, TFile>(
      this.options.dataProvider
        .allFilesToBeIndexed()
        .filter((file) => this.options.hybridEngine.shouldIndexPath(file.path))
        .map((file) => [file.path, file]),
    );
  }

  private planFileSetChanges(
    currFiles: ReadonlyMap<string, TFile>,
    previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>,
    reindexedPaths: readonly string[],
  ): {
    docsToAdd: TFile[];
    docsToDelete: string[];
  } {
    const docsToAdd: TFile[] = [];
    const docsToDelete: string[] = [];

    for (const [path, file] of currFiles) {
      const previousIndexedFileRef = previousIndexedFileRefs.get(path);
      if (!previousIndexedFileRef) {
        docsToAdd.push(file);
      } else if (file.stat.mtime > previousIndexedFileRef.generation) {
        docsToDelete.push(path);
        docsToAdd.push(file);
      }
    }

    for (const prevPath of previousIndexedFileRefs.keys()) {
      if (!currFiles.has(prevPath)) {
        docsToDelete.push(prevPath);
      }
    }

    for (const reindexPath of reindexedPaths) {
      const file = currFiles.get(reindexPath);
      if (file && !docsToAdd.some((item) => item.path === reindexPath)) {
        docsToAdd.push(file);
      }
    }

    return { docsToAdd, docsToDelete };
  }
}
