import { App, Modal } from "obsidian";
import Component from "./Component.svelte";

export class SearchModal extends Modal {
	tempNode: any;
	constructor(app: App) {
		super(app);
		// remove predefined child node
		this.modalEl.replaceChildren();
		this.modalEl.addClass("cs-modal");

		this.tempNode = new Component({
			target: this.modalEl,
			props: {
				queryText: ""
			}
		});
	}

	onOpen() {
		this.contentEl.empty();
		// this.contentEl.setText("Woah!");
	}

	onClose() {
		this.tempNode.$destroy();
	}
}

