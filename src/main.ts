import {
	App,
	Editor,
	HoverPopover,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	Vault,
} from "obsidian";
import "reflect-metadata";
import { container } from "tsyringe";
import { devTest } from "./dev-test";
import { THIS_PLUGIN } from "./globals/constants";
import { SearchType } from "./globals/search-types";
import { OmnisearchIntegration } from "./integrations/omnisearch";
import { AuxiliaryService } from "./services/auxiliary/auxiliary-service";
import { PluginManager } from "./services/obsidian/plugin-manager";
import { SearchModal } from "./ui/search-modal";
import { getInstance, isDevEnvironment } from "./utils/my-lib";

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

		// this.exampleCode();
		this.registerCommands();

		this.addCommand({
			id: "clever-search-in-vault",
			name: "Search in Vault",
			callback: () =>
				new SearchModal(this.app, SearchType.IN_VAULT).open(),
		});

		if (isDevEnvironment) {
			this.addCommand({
				id: "clever-search-triggerTest",
				name: "clever-search-triggerTest",
				// hotkeys: [{modifiers: [currModifier], key: "5"}],
				callback: async () => await devTest(),
			});

			this.addCommand({
				id: "cs-open-test-modal",
				name: "Open test modal",
				callback: () => this.openTestModal(),
			});
		}
	}

	onunload() {
		document.body.classList.remove("cs-privacy-blur");
		getInstance(PluginManager).onunload();
	}

	openTestModal() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			let contentHTML = "";
			// 直接用innerHTML获取不到这个元素本身的标签，需要用临时div来包装一下
			const element = activeView.contentEl.querySelector(
				".markdown-source-view",
			);
			if (element) {
				const tempDiv = document.createElement("div");
				// cloneNode(true) 以克隆元素及其所有子元素
				tempDiv.appendChild(element.cloneNode(true));
				contentHTML = tempDiv.innerHTML;
			}
			// const modal = new MyCustomModal(this.app, activeView.contentEl.innerHTML);
			const modal = new RenderHTMLModal(this.app, contentHTML);
			modal.open();
		} else {
			throw Error("no active MarkdownView");
		}
	}

	registerCommands() {
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "clever-search-in-file",
			name: "Search in file",
			callback: () =>
				new SearchModal(this.app, SearchType.IN_FILE).open(),
		});

		this.addCommand({
			id: "cs-toggle-privacy-mode",
			name: "Toggle privacy mode",
			callback: () => getInstance(AuxiliaryService).togglePrivacyMode(),
		});

		this.addCommand({
			id: "cs-in-file-search-with-omnisearch-query",
			name: "Search in file with last Omnisearch query",
			callback: async () => {
				new SearchModal(
					this.app,
					SearchType.IN_FILE,
					await getInstance(OmnisearchIntegration).getLastQuery(),
				).open();
			},
		});
	}

	exampleCode() {
		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Sample Plugin",
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				new Notice("This is a notice!");
			},
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});

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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
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

class RenderHTMLModal extends Modal {
	contentHTML: string;

	constructor(app: App, contentHTML: string) {
		super(app);
		this.contentHTML = contentHTML;
	}

	onOpen() {
		MarkdownView;
		HoverPopover;

		console.log(this.contentHTML);
		this.containerEl.style.backgroundColor = "black";
		this.containerEl.innerHTML = this.contentHTML;

		// 或者如果您想将Markdown转换为HTML：
		// contentEl.innerHTML = yourMarkdownToHTMLFunction(this.content);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
