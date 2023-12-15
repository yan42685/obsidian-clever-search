import {
	App,
	Editor,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import "reflect-metadata";
import { container } from "tsyringe";
import { SearchHelper } from "./search-helper";
import { SearchModal } from "./ui/search-modal";

// Remember to rename these classes and interfaces!

class CleverSearchSettings {
	mySetting = "hello";
}

const DEFAULT_SETTINGS: CleverSearchSettings = {
	mySetting: "default",
};

export default class CleverSearch extends Plugin {
	settings: CleverSearchSettings = new CleverSearchSettings();
	blurEnabled = false;

	async onload() {
		// logger.info("test");
		// logger.debug("test");
		// logger.warn("test");
		// logger.error("test");
		await this.loadSettings();
		this.exampleCode();
		this.registerSearchUI();
		// 由于plugin不能让框架自己new，而是要注册this依赖，所以这里需要在CleverSearch手动注册this对象
		// register <"cleverSearch", this> to the container
		// cant't use CleverSearch as a key here to void cycle dependencies
		container.register("CleverSearch", { useValue: this });
		container.register(App, { useValue: this.app });

		const searchHelper = container.resolve(SearchHelper);
		searchHelper.search();

		this.addCommand({
			id: "cs-toggle-blur",
			name: "Toggle Blur",
			callback: () => this.toggleBlur(),
		});
	}

	toggleBlur() {
		this.blurEnabled = !this.blurEnabled;
		if (this.blurEnabled) {
			document.body.classList.add("my-custom-blur");
		} else {
			document.body.classList.remove("my-custom-blur");
		}
	}

	registerSearchUI() {
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "clever-search-from-vault",
			name: "Clever Search from Vault",
			callback: () => {
				new SearchModal(this.app).open();
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

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

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

	onunload() {
		document.body.classList.remove("my-custom-blur");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: CleverSearch;

	constructor(app: App, plugin: CleverSearch) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings?.mySetting as any)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					}),
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
