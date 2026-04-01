import type {
  IndexArtifactEngine,
  IndexArtifactName,
  IndexArtifactStateRow,
} from "./index-artifact-state";

type IndexArtifactStateTable = {
  get(id: string): Promise<IndexArtifactStateRow | undefined>;
  put(row: IndexArtifactStateRow): Promise<unknown>;
  delete(id: string): Promise<unknown>;
};

type DirtyArtifactCoordinatorOptions = {
  engine: IndexArtifactEngine;
  artifact: IndexArtifactName;
  reason: string;
  markerId: string;
  stateTable: IndexArtifactStateTable;
  supportsDirtyTracking: () => boolean;
  estimatePathBytes: (path: string) => number;
  persistArtifact: () => Promise<void>;
  debounceMs: number;
  maxAgeMs: number;
  pathThreshold: number;
  bytesThreshold: number;
};

export class DirtyArtifactCoordinator {
  private readonly dirtyPaths = new Map<string, number>();
  private dirtySince: number | null = null;
  private lastMutationAt: number | null = null;
  private dirtyPersisted = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private persistWorker: Promise<void> | null = null;
  private mutationVersion = 0;

  constructor(private readonly options: DirtyArtifactCoordinatorOptions) {}

  reset(): void {
    this.clearFlushTimer();
    this.dirtyPaths.clear();
    this.dirtySince = null;
    this.lastMutationAt = null;
    this.dirtyPersisted = false;
    this.persistWorker = null;
    this.mutationVersion = 0;
  }

  dispose(): void {
    this.clearFlushTimer();
  }

  async hasPersistedDirtyMarker(): Promise<boolean> {
    return (await this.options.stateTable.get(this.options.markerId)) !== undefined;
  }

  async markDirty(paths: readonly string[] = []): Promise<void> {
    if (!this.options.supportsDirtyTracking()) {
      return;
    }

    const now = Date.now();
    if (this.dirtySince === null) {
      this.dirtySince = now;
    }
    this.lastMutationAt = now;
    this.mutationVersion += 1;

    for (const path of paths) {
      this.dirtyPaths.set(path, Math.max(0, this.options.estimatePathBytes(path)));
    }

    if (!this.dirtyPersisted) {
      await this.options.stateTable.put({
        id: this.options.markerId,
        engine: this.options.engine,
        artifact: this.options.artifact,
        dirtyAt: this.dirtySince,
        reason: this.options.reason,
      });
      this.dirtyPersisted = true;
    }

    if (this.shouldFlushNow(now)) {
      void this.flushIfDirty(true);
      return;
    }
    this.scheduleFlush();
  }

  async flushIfDirty(force = false): Promise<void> {
    return await this.runPersistWorker({ dirtyOnly: true, force });
  }

  async persistCurrentArtifact(): Promise<void> {
    return await this.runPersistWorker({ dirtyOnly: false, force: true });
  }

  private async runPersistWorker(options: {
    dirtyOnly: boolean;
    force: boolean;
  }): Promise<void> {
    if (this.persistWorker) {
      return await this.persistWorker;
    }
    if (options.dirtyOnly && !this.dirtyPersisted) {
      return;
    }
    if (options.dirtyOnly && !options.force && !this.shouldFlushNow()) {
      this.scheduleFlush();
      return;
    }

    this.clearFlushTimer();
    const expectedMutationVersion = this.mutationVersion;
    const worker = (async () => {
      try {
        await this.options.persistArtifact();
        if (this.mutationVersion === expectedMutationVersion) {
          await this.clearDirtyState();
        }
      } finally {
        this.persistWorker = null;
        if (this.dirtyPersisted) {
          this.scheduleFlush();
        }
      }
    })();
    this.persistWorker = worker;
    await worker;
  }

  private shouldFlushNow(now = Date.now()): boolean {
    if (!this.dirtyPersisted) {
      return false;
    }
    if (this.dirtyPaths.size >= this.options.pathThreshold) {
      return true;
    }
    if (this.getDirtyBytes() >= this.options.bytesThreshold) {
      return true;
    }
    if (this.dirtySince !== null && now - this.dirtySince >= this.options.maxAgeMs) {
      return true;
    }
    return (
      this.lastMutationAt !== null &&
      now - this.lastMutationAt >= this.options.debounceMs
    );
  }

  private getDirtyBytes(): number {
    let total = 0;
    for (const bytes of this.dirtyPaths.values()) {
      total += bytes;
    }
    return total;
  }

  private scheduleFlush(): void {
    if (!this.dirtyPersisted || !this.options.supportsDirtyTracking()) {
      return;
    }
    if (this.persistWorker) {
      return;
    }

    const now = Date.now();
    const debounceDueAt = (this.lastMutationAt ?? now) + this.options.debounceMs;
    const maxAgeDueAt = (this.dirtySince ?? now) + this.options.maxAgeMs;
    const delayMs = Math.max(0, Math.min(debounceDueAt, maxAgeDueAt) - now);

    this.clearFlushTimer();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushIfDirty();
    }, delayMs);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async clearDirtyState(): Promise<void> {
    this.clearFlushTimer();
    this.dirtyPaths.clear();
    this.dirtySince = null;
    this.lastMutationAt = null;
    this.dirtyPersisted = false;
    await this.options.stateTable.delete(this.options.markerId);
  }
}
