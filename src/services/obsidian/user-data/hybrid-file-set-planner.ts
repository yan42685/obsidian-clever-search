import type { TFile } from "obsidian";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";

export type HybridIndexedFileSetChangePlan = {
  docsToAdd: TFile[];
  docsToDelete: string[];
};

export function planIndexedFileSetChanges(params: {
  currFiles: ReadonlyMap<string, TFile>;
  previousIndexedFileRefs: ReadonlyMap<string, HybridIndexedFileRef>;
  reindexedPaths?: readonly string[];
}): HybridIndexedFileSetChangePlan {
  const docsToAdd: TFile[] = [];
  const docsToDelete: string[] = [];

  for (const [path, file] of params.currFiles) {
    const previousIndexedFileRef = params.previousIndexedFileRefs.get(path);
    if (!previousIndexedFileRef) {
      docsToAdd.push(file);
    } else if (file.stat.mtime > previousIndexedFileRef.generation) {
      docsToDelete.push(path);
      docsToAdd.push(file);
    }
  }

  for (const prevPath of params.previousIndexedFileRefs.keys()) {
    if (!params.currFiles.has(prevPath)) {
      docsToDelete.push(prevPath);
    }
  }

  for (const reindexPath of params.reindexedPaths ?? []) {
    const file = params.currFiles.get(reindexPath);
    if (file && !docsToAdd.some((item) => item.path === reindexPath)) {
      docsToAdd.push(file);
    }
  }

  return { docsToAdd, docsToDelete };
}
