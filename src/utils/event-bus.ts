import type { EventEnum } from "../globals/enums";

export type EventCallback = (...args: any[]) => void;

export class EventBus {
	private listeners: Map<EventEnum, EventCallback[]>;

	constructor() {
		this.listeners = new Map();
	}

	// 监听事件
	on(event: EventEnum, callback: EventCallback): void {
        // console.log("registered");
		if (!this.listeners.has(event)) {
			this.listeners.set(event, []);
		}
		this.listeners.get(event)?.push(callback);
	}

	// 移除监听器
	off(event: EventEnum, callback: EventCallback): void {
        // console.log("unregistered");
		const callbacks = this.listeners.get(event);
		if (callbacks) {
			const index = callbacks.indexOf(callback);
			if (index > -1) {
				callbacks.splice(index, 1);
			}
		}
	}

	// 触发事件
	emit(event: EventEnum, ...args: any[]): void {
		this.listeners.get(event)?.forEach((callback) => {
			callback(...args);
		});
	}
}

export const eventBus = new EventBus();