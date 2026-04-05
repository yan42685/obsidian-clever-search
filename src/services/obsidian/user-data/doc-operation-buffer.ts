import { throttle } from "throttle-debounce";
import { logger } from "src/utils/logger";

export abstract class DocOperation {
	readonly type: "upsert" | "delete" | "move";
	readonly path: string;
	readonly time: number = performance.now();
	readonly sourceGeneration?: number;

	protected constructor(
		type: "upsert" | "delete" | "move",
		path: string,
		sourceGeneration?: number,
	) {
		this.type = type;
		this.path = path;
		this.sourceGeneration = sourceGeneration;
	}
}

export class DocUpsertOperation extends DocOperation {
	constructor(path: string, sourceGeneration?: number) {
		super("upsert", path, sourceGeneration);
	}
}

export class DocDeleteOperation extends DocOperation {
	constructor(path: string) {
		super("delete", path);
	}
}

export class DocMoveOperation extends DocOperation {
	readonly oldPath: string;

	constructor(oldPath: string, newPath: string, sourceGeneration?: number) {
		super("move", newPath, sourceGeneration);
		this.oldPath = oldPath;
	}
}

export type ReducedDirtyPath = {
	path: string;
	time: number;
	order: number;
	renameFromPath?: string;
	requiresReindex: boolean;
	sourceGeneration?: number;
};

export type ReducedStalePath = {
	path: string;
	time: number;
	order: number;
};

export type ReducedDocOperationBatch = {
	// Dirty paths are re-read from the vault at flush time.
	dirtyPaths: ReducedDirtyPath[];
	// Stale paths are cleanup targets whose previous indexed state must be removed.
	stalePaths: ReducedStalePath[];
};

type PendingDelete = {
	time: number;
	order: number;
};

type PendingDirty = {
	time: number;
	order: number;
	requiresReindex: boolean;
	sourceGeneration?: number;
};

export function reduceDocOperations(
	operations: DocOperation[],
): ReducedDocOperationBatch {
	const pendingDeletes = new Map<string, PendingDelete>();
	const pendingDirty = new Map<string, PendingDirty>();
	const sourcePathByCurrentPath = new Map<string, string>();
	let nextOrder = 0;
	const allocateOrder = () => {
		nextOrder += 1;
		return nextOrder;
	};

	for (const operation of operations) {
		if (operation instanceof DocUpsertOperation) {
			pendingDeletes.delete(operation.path);
			pendingDirty.set(operation.path, {
				time: operation.time,
				order: allocateOrder(),
				requiresReindex: true,
				sourceGeneration: operation.sourceGeneration,
			});
			continue;
		}

		if (operation instanceof DocDeleteOperation) {
			pendingDirty.delete(operation.path);
			pendingDeletes.set(operation.path, {
				time: operation.time,
				order: allocateOrder(),
			});
			sourcePathByCurrentPath.delete(operation.path);
			continue;
		}

		if (operation instanceof DocMoveOperation) {
			const sourcePath =
				sourcePathByCurrentPath.get(operation.oldPath) ?? operation.oldPath;
			sourcePathByCurrentPath.delete(operation.oldPath);
			sourcePathByCurrentPath.set(operation.path, sourcePath);
			pendingDirty.delete(operation.oldPath);
			pendingDeletes.set(operation.oldPath, {
				time: operation.time,
				order: allocateOrder(),
			});
			pendingDeletes.delete(operation.path);
			pendingDirty.set(operation.path, {
				time: operation.time,
				order: allocateOrder(),
				requiresReindex: false,
				sourceGeneration: operation.sourceGeneration,
			});
		}
	}

	const dirtyPaths = Array.from(pendingDirty.entries())
		.map(([path, dirty]) => {
			const sourcePath = sourcePathByCurrentPath.get(path);
			return {
				path,
				time: dirty.time,
				order: dirty.order,
				renameFromPath:
					sourcePath && sourcePath !== path ? sourcePath : undefined,
				requiresReindex: dirty.requiresReindex,
				sourceGeneration: dirty.sourceGeneration,
			};
		})
		.sort((left, right) => left.order - right.order);

	const dirtyPathSet = new Set(dirtyPaths.map((item) => item.path));
	const stalePaths = Array.from(pendingDeletes.entries())
		.filter(([path]) => !dirtyPathSet.has(path))
		.map(([path, pendingDelete]) => ({
			path,
			time: pendingDelete.time,
			order: pendingDelete.order,
		}))
		.sort((left, right) => left.order - right.order);

	return {
		dirtyPaths,
		stalePaths,
	};
}

export class DocOperationBuffer {
	private readonly operations: DocOperation[] = [];
	private readonly flushThrottled = throttle(10000, () => {
		void this.forceFlush();
	});
	private autoFlushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushQueue: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(
		private readonly handler: (operations: ReducedDocOperationBatch) => Promise<void>,
		private readonly autoFlushThreshold: number,
		private readonly autoFlushDelayMs = 2000,
	) {}

	add(operation: DocOperation): void {
		if (this.disposed) {
			return;
		}
		this.operations.push(operation);
		if (this.operations.length === 1) {
			this.scheduleAutoFlush();
		}

		if (this.operations.length >= this.autoFlushThreshold) {
			this.clearAutoFlushTimer();
			this.flushThrottled();
		}
	}

	peekReducedBatch(): ReducedDocOperationBatch {
		if (this.disposed) {
			return {
				dirtyPaths: [],
				stalePaths: [],
			};
		}
		return reduceDocOperations(this.operations);
	}

	async forceFlush(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.clearAutoFlushTimer();
		const previous = this.flushQueue;
		const current = previous
			.catch(() => undefined)
			.then(async () => {
				if (this.disposed) {
					this.operations.length = 0;
					return;
				}
				if (this.operations.length === 0) {
					return;
				}

				const operations = reduceDocOperations(this.operations);
				this.operations.length = 0;

				await this.handler(operations);
				logger.debug("flushed reduced doc operations");
			});
		this.flushQueue = current.then(
			() => undefined,
			() => undefined,
		);
		await current;
	}

	dispose(): void {
		this.disposed = true;
		this.clearAutoFlushTimer();
		this.operations.length = 0;
	}

	private scheduleAutoFlush(): void {
		if (this.disposed || this.autoFlushTimer) {
			return;
		}
		this.autoFlushTimer = setTimeout(() => {
			this.autoFlushTimer = null;
			void this.forceFlush();
		}, this.autoFlushDelayMs);
	}

	private clearAutoFlushTimer(): void {
		if (!this.autoFlushTimer) {
			return;
		}
		clearTimeout(this.autoFlushTimer);
		this.autoFlushTimer = null;
	}
}
