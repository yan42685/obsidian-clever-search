import { App, Modal } from "obsidian";
import QuickSwitchModalView from "./QuickSwitchModal.svelte";

export class QuickSwitchModal extends Modal {
	private mountedElement: QuickSwitchModalView;

	constructor(app: App) {
		super(app);
		this.modalEl.replaceChildren();
		this.modalEl.addClass("cs-modal", "cs-quickswitch-modal");
		this.mountedElement = new QuickSwitchModalView({
			target: this.modalEl,
			props: {
				onCloseExternal: () => this.close(),
			},
		});
	}

	onOpen() {}

	onClose() {
		this.mountedElement.$destroy();
	}
}
