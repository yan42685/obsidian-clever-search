import { App, MarkdownView, WorkspaceLeaf } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { debounce } from "throttle-debounce";
import { singleton } from "tsyringe";

@singleton()
export class RecentFileManager {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private app: App = getInstance(App);
	private scrollElement: HTMLElement | null = null;

	private handleScroll = () => {
		const scrollTop = this.scrollElement?.scrollTop || 0;
		console.log("curr scrollTop:", scrollTop);
		const scrollInfo: ScrollInfo = { top: scrollTop, left: 0 };
		void scrollInfo;
	};

	private handleScrollDebounced = debounce(1000, () => this.handleScroll());

	init() {
		this.plugin.registerEvent(
			this.app.workspace.on(
				"active-leaf-change",
				async (newLeaf: WorkspaceLeaf | null) => {
					this.detachScrollListener();
					if (!(newLeaf && newLeaf.view instanceof MarkdownView)) {
						return;
					}

					// TODO: 澶勭悊缂栬緫鍜岄槄璇绘ā寮忥紝绫讳笉涓€鏍凤紙.cm-scroller)
					// 闃呰妯″紡
					// this.scrollElement = document.querySelector(".markdown-preview-view");
					// 缂栬緫妯″紡
					this.scrollElement =
						newLeaf.view.containerEl.querySelector(
							".cm-scroller",
						);
					if (this.scrollElement) {
						logger.info("add listener...");
						this.scrollElement.addEventListener(
							"scroll",
							this.handleScrollDebounced,
						);
					} else {
						logger.error("can't find scrollElement");
					}
				},
			),
		);
	}

	onAppQuit() {}

	private detachScrollListener(): void {
		if (!this.scrollElement) {
			return;
		}
		logger.info("remove listener...");
		this.scrollElement.removeEventListener(
			"scroll",
			this.handleScrollDebounced,
		);
		this.scrollElement = null;
	}
}

type ScrollInfo = {
	top: number;
	left: number;
};
