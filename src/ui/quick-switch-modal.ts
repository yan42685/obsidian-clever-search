import { App, Modal } from "obsidian";
import type { SearchAutocompleteMode } from "src/services/obsidian/user-data/search-autocomplete-service";
import QuickSwitchModalView from "./QuickSwitchModal.svelte";

export class QuickSwitchModal extends Modal {
	private mountedElement: QuickSwitchModalView & {
		activate?: () => Promise<void> | void;
	};
	private readonly mode: SearchAutocompleteMode;

	constructor(app: App, mode: SearchAutocompleteMode = "navigation") {
		super(app);
		this.mode = mode;
		this.modalEl.replaceChildren();
		this.modalEl.addClass("cs-modal", "cs-quickswitch-modal");
		if (this.mode === "quickCommand") {
			this.modalEl.addClass("cs-quick-command-modal");
		}
		this.mountedElement = new QuickSwitchModalView({
			target: this.modalEl,
			props: {
				mode,
				requestClose: () => this.close(),
			},
		});
	}

	onOpen() {
		void this.mountedElement.activate?.();
	}

	onClose() {
		this.modalEl.removeClass("cs-quick-command-modal");
		this.mountedElement.$destroy();
	}
}
