import type { Line, MatchedLine } from "src/globals/search-types";
import { logger } from "./logger";

export class Collections {
	static minInSet(set: Set<number>) {
		let minInSet = Number.MAX_VALUE;
		for (const num of set) {
			if (num < minInSet) {
				minInSet = num;
			}
		}
		return minInSet;
	}
}

/**
 * A class that manages a set of buffered items. It automatically flushes the buffered items
 * to a handler function when a specified threshold is reached. If multiple items have the same
 * identifier, the older item will be replaced by the newer one.
 */
export class BufferSet<T> {
	private elementsMap: Map<string, T>;
	private handler: (elements: T[]) => Promise<void>;
	private identifier: (element: T) => string;
	private autoFlushThreshold: number;
	private isFlushing = false;
	private pendingFlushRequested = false;

	/**
	 * Creates an instance of BufferSet.
	 * @param handler The function to handle elements.
	 * @param identifier A function that provides a unique string identifier for each element.
	 * @param autoFlushThreshold The number of elements at which the BufferSet should automatically flush.
	 */
	constructor(
		handler: (elements: T[]) => Promise<void>,
		identifier: (element: T) => string,
		autoFlushThreshold: number,
	) {
		this.elementsMap = new Map();
		this.handler = handler;
		this.identifier = identifier;
		this.autoFlushThreshold = autoFlushThreshold;
	}

	/**
	 * Adds a new element to the buffer. If the buffer reaches the autoFlushThreshold, it triggers a flush.
	 * If an element with the same identifier already exists, it will be replaced by the new element.
	 * @param element The element to be added to the buffer.
	 */
	add(element: T): void {
		const id = this.identifier(element);
		this.elementsMap.set(id, element);

		if (this.elementsMap.size >= this.autoFlushThreshold) {
			this.flush();
		}
	}

	/**
	 * Flushes all buffered elements to the handler function and clears the buffer.
	 */
	async flush(): Promise<void> {
		if (this.isFlushing) {
			// A flush operation is already in progress, so we note that another flush is requested.
			this.pendingFlushRequested = true;
			return;
		}
		if (this.elementsMap.size === 0) {
			return;
		}
		this.isFlushing = true;

		const elementsToHandle = Array.from(this.elementsMap.values());
		this.elementsMap.clear();

		try {
			await this.handler(elementsToHandle);
			logger.debug("flushed");
		} finally {
			this.isFlushing = false;
			// check if a new flush was requested while we were flushing.
			if (this.pendingFlushRequested) {
				// reset the flag and call flush again.
				this.pendingFlushRequested = false;
				this.flush();
			}
		}
	}
}
