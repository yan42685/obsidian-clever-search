import { App, MarkdownView, WorkspaceLeaf } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import CleverSearch from "src/main";
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
        const scrollInfo: ScrollInfo = {top: scrollTop, left: 0};
	};
	private handleScrollDebounced = debounce(1000, () => this.handleScroll());

	init() {
		this.plugin.registerEvent(
			this.app.workspace.on(
				"active-leaf-change",
				async (newLeaf: WorkspaceLeaf | null) => {
					if (newLeaf && newLeaf.view instanceof MarkdownView) {
						if (this.scrollElement) {
							logger.info("remove listener...");
							this.scrollElement.removeEventListener(
								"scroll",
								this.handleScrollDebounced,
								true,
							);
						}

						// TODO: 处理编辑和阅读模式，类不一样（.cm-scroller)
						// 阅读模式
						// this.scrollElement = document.querySelector(".markdown-preview-view");
						// 编辑模式
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
					}
				},
			),
		);
	}

	onAppQuit() {}
}

type ScrollInfo = {
	top: number;
	left: number;
};
