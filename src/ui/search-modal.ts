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
		this.mountedElement.$destroy();
		console.log("mounted element has been destroyed.");
	}

	private registerHotkeys() {
		// 检测平台，以确定是使用 'Ctrl' 还是 'Cmd'（Mac）
		const modKey = currModifier;
		// console.log("current modifier: " + modKey);

		this.scope.register([modKey], "J", emitEvent(EventEnum.NEXT_ITEM));
		this.scope.register([modKey], "Q", emitEvent(EventEnum.NEXT_ITEM));
		this.scope.register([], "ArrowDown", emitEvent(EventEnum.NEXT_ITEM));

		this.scope.register([modKey], "K", emitEvent(EventEnum.PREV_ITEM));
		this.scope.register([], "ArrowUp", emitEvent(EventEnum.PREV_ITEM));
		this.scope.register([], "Enter", emitEvent(EventEnum.CONFIRM_ITEM));
	}
}

function emitEvent(eventEnum: EventEnum) {
	return (e: Event) => {
		e.preventDefault();
		eventBus.emit(eventEnum);
		console.log("emit...");
	};
}
