import type { TAbstractFile } from "obsidian";
import { throttle } from "throttle-debounce";
import { logger } from "src/utils/logger";

export abstract class DocOperation {
	readonly type: "add" | "delete" | "rename";
	readonly path: string;
	readonly time: number = performance.now();

	protected constructor(
		type: "add" | "delete" | "rename",
		fileOrPath: string | TAbstractFile,
	) {
		this.type = type;
		if (typeof fileOrPath === "string") {
			this.path = fileOrPath;
		} else {
			this.path = fileOrPath.path;
		}
	}
}

export class DocAddOperation extends DocOperation {
	readonly file: TAbstractFile;

	constructor(file: TAbstractFile) {
		super("add", file);
		this.file = file;
	}
}

export class DocDeleteOperation extends DocOperation {
	constructor(path: string) {
		super("delete", path);
	}
}

export class DocRenameOperation extends DocOperation {
	readonly oldPath: string;
	readonly file: TAbstractFile;

	constructor(oldPath: string, file: TAbstractFile) {
		super("rename", file);
		this.oldPath = oldPath;
		this.file = file;
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
	file: TAbstractFile;
	time: number;
	order: number;
};

export type ReducedDocOperation =
	| ReducedDeleteOperation
	| ReducedUpsertOperation;

function reduceDocOperation(
	reducedByPath: Map<string, ReducedDocOperation>,
	operation: DocOperation,
	allocateOrder: () => number,
): void {
	if (operation instanceof DocAddOperation) {
		reducedByPath.set(operation.path, {
			type: "upsert",
			path: operation.path,
			file: operation.file,
			time: operation.time,
			order: allocateOrder(),
		});
		return;
	}

	if (operation instanceof DocDeleteOperation) {
		reducedByPath.set(operation.path, {
			type: "delete",
			path: operation.path,
			time: operation.time,
			order: allocateOrder(),
		});
		return;
	}

	if (operation instanceof DocRenameOperation) {
		reducedByPath.set(operation.oldPath, {
			type: "delete",
			path: operation.oldPath,
			time: operation.time,
			order: allocateOrder(),
		});
		reducedByPath.set(operation.file.path, {
			type: "upsert",
			path: operation.file.path,
			file: operation.file,
			time: operation.time,
			order: allocateOrder(),
		});
	}
}

export function reduceDocOperations(
	operations: DocOperation[],
): ReducedDocOperation[] {
	const reducedByPath = new Map<string, ReducedDocOperation>();
	let nextOrder = 0;
	const allocateOrder = () => {
		nextOrder += 1;
		return nextOrder;
	};

	for (const operation of operations) {
		reduceDocOperation(reducedByPath, operation, allocateOrder);
	}

	return Array.from(reducedByPath.values()).sort(
		(left, right) => left.order - right.order,
	);
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
