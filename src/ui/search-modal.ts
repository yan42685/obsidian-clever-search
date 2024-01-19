import { App, Modal } from "obsidian";
import type { SearchType } from "src/globals/search-types";
import { ModalNavigationHotkeys } from "src/services/obsidian/command-registry";
import MountedModal from "./MountedModal.svelte";

// TODO: make it an abstract class
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
				uiType: "modal",
				onConfirmExternal: () => this.close(),
				searchType: searchType,
				queryText: effectiveQuery || "",
			},
		});

		// register for transient scope. In this scope, app.scope won't accept keyMapEvents
		new ModalNavigationHotkeys(this.scope).registerAll();
	}

	onOpen() { }

	onClose() {
		this.mountedElement.$destroy();
	}
}
