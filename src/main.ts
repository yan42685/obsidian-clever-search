import {
	App,
	Component,
	MarkdownRenderer,
	Modal,
	Plugin,
	Vault
} from "obsidian";
import "reflect-metadata";
import { container } from "tsyringe";
import { THIS_PLUGIN } from "./globals/constants";
import { PluginManager } from "./services/obsidian/plugin-manager";
import { getInstance } from "./utils/my-lib";

export default class CleverSearch extends Plugin {
	async onload() {
		container.clearInstances();
		// can't register `this` as CleverSearch, because it is `export default` rather than `export`
		container.register(THIS_PLUGIN, { useValue: this });
		container.register(App, { useValue: this.app });
		container.register(Vault, { useValue: this.app.vault });

		const pluginManager = getInstance(PluginManager);

		await pluginManager.onload();
		// explicitly initialize this singleton because object is lazy-loading by default in tsyringe
		this.app.workspace.onLayoutReady(() => {
			pluginManager.onLayoutReady();
		});
		this.registerEvent(
			this.app.workspace.on("quit", () => pluginManager.onAppQuit(), this),
		);
	}

	onunload() {
		document.body.classList.remove("cs-privacy-blur");
		getInstance(PluginManager).onunload();
	}
}

export class RenderMarkdownModal extends Modal {
	mdContent: string;

	constructor(app: App, mdContent: string) {
		super(app);
		this.mdContent = mdContent;
	}

	onOpen() {
		this.containerEl.empty();
		this.containerEl.style.display = "block";
		this.containerEl.style.overflow = "auto";
		this.containerEl.style.backgroundColor = "black";
		MarkdownRenderer.render(
			getInstance(App),
			this.mdContent,
			this.containerEl,
			"",
			new Component(),
		);
	}
}
