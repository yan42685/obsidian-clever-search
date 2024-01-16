import { App, Modal } from "obsidian";
import type { SearchType } from "src/globals/search-types";
import { CommandRegistry } from "src/services/obsidian/command-registry";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import MountedModal from "./MountedModal.svelte";

export class SearchModal extends Modal {
	mountedElement: any;
	constructor(app: App, searchType: SearchType, query?: string) {
		super(app);

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
				showRightPane: true,
				onConfirmExternal: () => this.close(),
				searchType: searchType,
				queryText: effectiveQuery || "",
			},
		});

		this.registerModalHotkeys();
	}

	onOpen() {
		// this.contentEl.empty();
		// this.contentEl.setText("Woah!");
	}

	onClose() {
		this.mountedElement.$destroy();
		logger.trace("mounted element has been destroyed.");
	}

	private registerModalHotkeys() {
		getInstance(CommandRegistry).registerNavigationHotkeys(this.scope);
	}

}
