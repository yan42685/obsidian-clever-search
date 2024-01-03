import { App, Modal, type Modifier } from "obsidian";
import { EventEnum } from "src/globals/enums";
import type { SearchType } from "src/globals/search-types";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import { currModifier } from "src/utils/my-lib";
import MountedModal from "./MountedModal.svelte";

export class SearchModal extends Modal {
	mountedElement: any;
	constructor(app: App, searchType: SearchType, query?: string) {
		super(app);
		eventBus.emit(EventEnum.MODAL_OPEN);

		// get text selected by user
		const selectedText = window.getSelection()?.toString() || "";
		const effectiveQuery = query || selectedText;

		// remove predefined child node
		this.modalEl.replaceChildren();
		this.modalEl.addClass("cs-modal");

		// BUG: In fact, the onMount method won't be called
		//      Use custom init() method instead
		this.mountedElement = new MountedModal({
			target: this.modalEl,
			props: {
				modal: this,
				searchType: searchType,
				queryText: effectiveQuery || "",
			},
		});

		this.registerHotkeys();
	}

	onOpen() {
		// this.contentEl.empty();
		// this.contentEl.setText("Woah!");
	}

	onClose() {
		this.modalEl.removeEventListener("contextmenu", handleRightClick);
		this.mountedElement.$destroy();
		logger.trace("mounted element has been destroyed.");
	}

	private registerHotkeys() {
		// 检测平台，以确定是使用 'Ctrl' 还是 'Cmd'（Mac）
		const modKey = currModifier;
		// console.log("current modifier: " + modKey);

		// 使用registerHotKey代替直接调用scope.register
		this.newHotKey([modKey], "J", EventEnum.NEXT_ITEM);
		this.newHotKey([], "ArrowDown", EventEnum.NEXT_ITEM);

		this.newHotKey([modKey], "K", EventEnum.PREV_ITEM);
		this.newHotKey([], "ArrowUp", EventEnum.PREV_ITEM);

		this.newHotKey([modKey], "N", EventEnum.NEXT_SUB_ITEM);
		this.newHotKey([modKey], "P", EventEnum.PREV_SUB_ITEM);

		this.newHotKey([], "Enter", EventEnum.CONFIRM_ITEM);
		// right click === "contextmenu" event
		this.modalEl.addEventListener("contextmenu", handleRightClick);

	}

	private newHotKey(
		modifiers: Modifier[],
		key: string,
		eventEnum: EventEnum,
	) {
		this.scope.register(modifiers, key, emitEvent(eventEnum));
	}
}

function emitEvent(eventEnum: EventEnum) {
	return (e: Event) => {
		e.preventDefault();
		eventBus.emit(eventEnum);
		console.log("emit...");
	};
}

function handleRightClick(event: MouseEvent) {
	// 防止默认的上下文菜单出现
	event.preventDefault();
	eventBus.emit(EventEnum.CONFIRM_ITEM);
	console.log("Right-click on button, confirm item event emitted.");
}
