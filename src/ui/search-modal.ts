import { App, Modal } from "obsidian";
import { eventBus } from "src/utils/event-bus";
import { EventEnum } from "src/utils/event-enum";
import { currModifier } from "src/utils/my-lib";
import MountedModal from "./MountedModal.svelte";

export class SearchModal extends Modal {
	mountedElement: any;
	constructor(app: App) {
		super(app);
		// remove predefined child node
		this.modalEl.replaceChildren();
		this.modalEl.addClass("cs-modal");

		// BUG: In fact, the onMount method won't be called
		//      Use custom init() method instead
		this.mountedElement = new MountedModal({
			target: this.modalEl,
			props: {
				app: app,
				modal: this,
				// queryText: this.queryText,
				queryText: "",
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
		console.log("mounted element has been destroyed.");
	}

	private registerHotkeys() {
		// 检测平台，以确定是使用 'Ctrl' 还是 'Cmd'（Mac）
		const modKey = currModifier;
		// console.log("current modifier: " + modKey);

		this.scope.register([modKey], "J", emitEvent(EventEnum.NEXT_ITEM));
		// this.scope.register([modKey], "Q", emitEvent(EventEnum.NEXT_ITEM));
		this.scope.register([], "ArrowDown", emitEvent(EventEnum.NEXT_ITEM));

		this.scope.register([modKey], "K", emitEvent(EventEnum.PREV_ITEM));
		this.scope.register([], "ArrowUp", emitEvent(EventEnum.PREV_ITEM));
		this.scope.register([], "Enter", emitEvent(EventEnum.CONFIRM_ITEM));
		// right click === "contextmenu" event
		this.modalEl.addEventListener("contextmenu", handleRightClick);
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
