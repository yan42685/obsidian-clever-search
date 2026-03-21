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

type ReducedDeleteOperation = {
	type: "delete";
	path: string;
	time: number;
	order: number;
};

type ReducedUpsertOperation = {
	type: "upsert";
	path: string;
	time: number;
	order: number;
};

type ReducedMoveOperation = {
	type: "move";
	oldPath: string;
	path: string;
	time: number;
	order: number;
	requiresReindex: boolean;
};

export type ReducedDocOperation =
	| ReducedDeleteOperation
	| ReducedUpsertOperation
	| ReducedMoveOperation;

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
): ReducedDocOperation[] {
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

	const reduced: ReducedDocOperation[] = [];
	const moveTargets = new Set<string>();
	const moveSources = new Set<string>();

	for (const [path, dirty] of pendingDirty) {
		const sourcePath = sourcePathByCurrentPath.get(path);
		if (!sourcePath || sourcePath === path) {
			continue;
		}
		moveTargets.add(path);
		moveSources.add(sourcePath);
		reduced.push({
			type: "move",
			oldPath: sourcePath,
			path,
			time: dirty.time,
			order: dirty.order,
			requiresReindex: dirty.requiresReindex,
		});
	}

	for (const [path, pendingDelete] of pendingDeletes) {
		if (moveSources.has(path)) {
			continue;
		}
		reduced.push({
			type: "delete",
			path,
			time: pendingDelete.time,
			order: pendingDelete.order,
		});
	}

	for (const [path, dirty] of pendingDirty) {
		if (moveTargets.has(path)) {
			continue;
		}
		reduced.push({
			type: "upsert",
			path,
			time: dirty.time,
			order: dirty.order,
		});
	}

	return reduced.sort((left, right) => left.order - right.order);
}

export class DocOperationBuffer {
	private readonly operations: DocOperation[] = [];
	private readonly flushThrottled = throttle(10000, () => {
		void this.forceFlush();
	});
	private flushQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly handler: (operations: ReducedDocOperation[]) => Promise<void>,
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
