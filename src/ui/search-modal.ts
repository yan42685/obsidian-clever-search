import { App, Modal } from "obsidian";
import Component from "../../Component.svelte";

export class SearchModal extends Modal {
	constructor(app: App) {
		super(app);
		console.log(1111);
		
		new Component({
			target: this.modalEl,
			props: {
				queryText: "haha"
			}


		})
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

