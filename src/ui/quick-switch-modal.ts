import { App, Modal } from "obsidian";
import type { SearchAutocompleteMode } from "src/services/obsidian/user-data/search-autocomplete-service";
import QuickSwitchModalView from "./QuickSwitchModal.svelte";

export class QuickSwitchModal extends Modal {
	private mountedElement: QuickSwitchModalView;

	constructor(app: App, mode: SearchAutocompleteMode = "navigation") {
		super(app);
		this.modalEl.replaceChildren();
		this.modalEl.addClass("cs-modal", "cs-quickswitch-modal");
		this.mountedElement = new QuickSwitchModalView({
			target: this.modalEl,
			props: {
				mode,
				requestClose: () => this.close(),
			},
		});
	}

	onOpen() {}

	onClose() {
		this.mountedElement.$destroy();
	}
}