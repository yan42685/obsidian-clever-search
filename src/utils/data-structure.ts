import { throttle } from "throttle-debounce";
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
	private flushThrottled = throttle(10000, () => this.forceFlush());

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
			this.flushThrottled();
		}
	}

	/**
	 * Flushes all buffered elements to the handler function and clears the buffer.
	 */
	async forceFlush(): Promise<void> {
		if (this.elementsMap.size === 0) {
			return;
		}

		const elementsToHandle = Array.from(this.elementsMap.values());
		this.elementsMap.clear();

		await this.handler(elementsToHandle);
		logger.debug("flushed");
	}
}

type Comparator<T> = (a: T, b: T) => number;

// min heap
export class PriorityQueue<T> {
	private heap: T[];
	private compare: Comparator<T>;
	private capacity: number;

	constructor(
		comparator: Comparator<T>,
		capacity: number = Number.MAX_VALUE,
	) {
		this.heap = [];
		this.compare = comparator;
		this.capacity = capacity;
	}
	public values(): T[] {
		return this.heap;
	}

	public push(item: T): void {
		if (this.size() < this.capacity) {
			this.heap.push(item);
			this.heapifyUp();
		} else if (this.compare(item, this.heap[0]) > 0) {
			this.heap[0] = item;
			this.heapifyDown();
		}
	}

	public clear(): void {
		this.heap = [];
	}

	public pop(): T | undefined {
		if (this.isEmpty()) {
			return undefined;
		}
		const item = this.heap[0];
		this.heap[0] = this.heap[this.heap.length - 1];
		this.heap.pop();
		this.heapifyDown();
		return item;
	}

	public peek(): T | undefined {
		return this.heap[0];
	}

	public isEmpty(): boolean {
		return this.heap.length === 0;
	}

	public size(): number {
		return this.heap.length;
	}

	private getLeftChildIndex(parentIndex: number): number {
		return 2 * parentIndex + 1;
	}

	private getRightChildIndex(parentIndex: number): number {
		return 2 * parentIndex + 2;
	}

	private getParentIndex(childIndex: number): number {
		return Math.floor((childIndex - 1) / 2);
	}

	private swap(index1: number, index2: number): void {
		[this.heap[index1], this.heap[index2]] = [
			this.heap[index2],
			this.heap[index1],
		];
	}

	private heapifyUp(): void {
		let index = this.heap.length - 1;
		while (
			this.getParentIndex(index) >= 0 &&
			this.compare(
				this.heap[this.getParentIndex(index)],
				this.heap[index],
			) > 0
		) {
			this.swap(this.getParentIndex(index), index);
			index = this.getParentIndex(index);
		}
	}

	private heapifyDown(): void {
		let index = 0;
		while (this.getLeftChildIndex(index) < this.heap.length) {
			let smallerChildIndex = this.getLeftChildIndex(index);
			if (
				this.getRightChildIndex(index) < this.heap.length &&
				this.compare(
					this.heap[this.getRightChildIndex(index)],
					this.heap[smallerChildIndex],
				) < 0
			) {
				smallerChildIndex = this.getRightChildIndex(index);
			}

			if (
				this.compare(this.heap[index], this.heap[smallerChildIndex]) < 0
			) {
				break;
			} else {
				this.swap(index, smallerChildIndex);
			}
			index = smallerChildIndex;
		}
	}
}
