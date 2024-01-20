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

		// this.exampleCode();
	}

	onunload() {
		document.body.classList.remove("cs-privacy-blur");
		getInstance(PluginManager).onunload();
	}

	exampleCode() {
		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000),
		);
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

	onClose() {
		// const { contentEl } = this;
		// contentEl.empty();
	}
}
