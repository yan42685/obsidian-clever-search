import { App, Modal, type KeymapEventHandler } from "obsidian";
import type {
	HybridSearchMode,
	SearchType,
} from "src/globals/search-types";
import { ModalNavigationHotkeys } from "src/services/obsidian/command-registry";
import MountedModal from "./MountedModal.svelte";

// TODO: make it an abstract class
export class SearchModal extends Modal {
	private static readonly ESCAPE_CLOSE_SUPPRESS_MS = 80;
	private static readonly ESCAPE_FALLBACK_WINDOW_MS = 160;
	mountedElement: any;
	private readonly escapeHandler: KeymapEventHandler;
	private readonly keydownCaptureHandler = (event: KeyboardEvent) => {
		if (event.key !== "Escape") {
			return;
		}
		this.handleEscape(event);
	};
	private suppressCloseUntil = 0;
	private lastEscapeKeydownAt = 0;
	constructor(
		app: App,
		searchType: SearchType,
		isHybrid = false,
		query?: string,
		hybridMode: HybridSearchMode = "default",
	) {
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
				isHybrid: isHybrid,
				hybridMode,
				queryText: effectiveQuery || "",
			},
		});

		// register for transient scope. In this scope, app.scope won't accept keyMapEvents
		new ModalNavigationHotkeys(this.scope).registerAll();
		window.addEventListener("keydown", this.keydownCaptureHandler, true);
		this.escapeHandler = this.scope.register([], "Escape", (event) => {
			this.handleEscape(event);
			return false;
		});
	}

	onEscapeKey(event?: KeyboardEvent): void {
		this.handleEscape(event);
	}

	private handleEscape(event?: KeyboardEvent): boolean {
		this.lastEscapeKeydownAt = Date.now();
		const consumed = this.mountedElement?.consumeEscape?.() ?? false;
		if (consumed) {
			this.suppressCloseUntil =
				Date.now() + SearchModal.ESCAPE_CLOSE_SUPPRESS_MS;
			event?.preventDefault();
			event?.stopPropagation();
			event?.stopImmediatePropagation();
			return true;
		}
		this.close();
		event?.preventDefault();
		event?.stopPropagation();
		event?.stopImmediatePropagation();
		return false;
	}

	close(): void {
		const now = Date.now();
		if (
			now - this.lastEscapeKeydownAt <= SearchModal.ESCAPE_FALLBACK_WINDOW_MS
		) {
			const consumed = this.mountedElement?.consumeEscape?.() ?? false;
			if (consumed) {
				this.suppressCloseUntil = 0;
				return;
			}
		}
		if (now <= this.suppressCloseUntil) {
			this.suppressCloseUntil = 0;
			return;
		}
		super.close();
	}

	onOpen() { }

	onClose() {
		this.suppressCloseUntil = 0;
		this.lastEscapeKeydownAt = 0;
		window.removeEventListener("keydown", this.keydownCaptureHandler, true);
		this.scope.unregister(this.escapeHandler);
		this.mountedElement.$destroy();
	}
}
