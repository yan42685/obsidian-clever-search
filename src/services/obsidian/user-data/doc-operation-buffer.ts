import { throttle } from "throttle-debounce";
import { logger } from "src/utils/logger";

export abstract class DocOperation {
	readonly type: "upsert" | "delete" | "move";
	readonly path: string;
	readonly time: number = performance.now();

	protected constructor(type: "upsert" | "delete" | "move", path: string) {
		this.type = type;
		this.path = path;
	}
}

export class DocUpsertOperation extends DocOperation {
	constructor(path: string) {
		super("upsert", path);
	}
}

export class DocDeleteOperation extends DocOperation {
	constructor(path: string) {
		super("delete", path);
	}
}

export class DocMoveOperation extends DocOperation {
	readonly oldPath: string;

	constructor(oldPath: string, newPath: string) {
		super("move", newPath);
		this.oldPath = oldPath;
	}
}

export type ReducedDirtyPath = {
	path: string;
	time: number;
	order: number;
	renameFromPath?: string;
	requiresReindex: boolean;
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
	private flushQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly handler: (operations: ReducedDocOperationBatch) => Promise<void>,
		private readonly autoFlushThreshold: number,
	) {}

	add(operation: DocOperation): void {
		this.operations.push(operation);

		if (this.operations.length >= this.autoFlushThreshold) {
			this.flushThrottled();
		}
	}

	async forceFlush(): Promise<void> {
		const previous = this.flushQueue;
		const current = previous
			.catch(() => undefined)
			.then(async () => {
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
}
