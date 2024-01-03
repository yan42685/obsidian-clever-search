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
	private handler: (elements: T[]) => void;
	private identifier: (element: T) => string;
	private autoFlushThreshold: number;

   /**
     * Creates an instance of BufferSet.
     * @param handler The function to handle elements.
     * @param identifier A function that provides a unique string identifier for each element.
     * @param autoFlushThreshold The number of elements at which the BufferSet should automatically flush.
     */
	constructor(
		handler: (elements: T[]) => void,
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
	flush(): void {
		if (this.elementsMap.size === 0) return;

		const elementsToHandle = Array.from(this.elementsMap.values());
		this.elementsMap.clear();

		this.handler(elementsToHandle);
	}

}
