import type { DocRegistryRow } from "src/services/database/database";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";
import type { HybridRepairMode } from "./index-recovery-state";

export type HybridStorageRepairReport = {
  repairedPaths: string[];
  cleanedPaths: string[];
  reindexedPaths: string[];
  previousIndexedFileRefs: Map<string, HybridIndexedFileRef>;
  previousDocRegistryEntries: Map<string, DocRegistryRow>;
};

export type HybridRepairTask = {
  path: string;
  mode: HybridRepairMode;
  reason: string;
  eligibleAt: number;
  enqueuedAt: number;
  sourceGeneration?: number;
};

export type HybridRepairTaskRequest = Omit<HybridRepairTask, "enqueuedAt">;
