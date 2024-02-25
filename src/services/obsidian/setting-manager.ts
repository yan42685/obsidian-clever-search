import {
	App,
	Modal,
	PluginSettingTab,
	Setting,
	TFolder,
	Vault,
} from "obsidian";
import { ICON_COLLAPSE, ICON_EXPAND, THIS_PLUGIN } from "src/globals/constants";
import {
	DEFAULT_OUTER_SETTING,
	OuterSetting,
	type LogLevelOptions,
} from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import type CleverSearch from "src/main";
import { FloatingWindowManager } from "src/ui/floating-window";
import { logger, type LogLevel } from "src/utils/logger";
import { MyLib, getInstance } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { container, inject, singleton } from "tsyringe";
import { SemanticEngine } from "../search/semantic-engine";
import { CommonSuggester, MyNotice } from "./transformed-api";
import { t } from "./translations/locale-helper";
import { DataManager } from "./user-data/data-manager";
import { DataProvider } from "./user-data/data-provider";
import { ViewRegistry } from "./view-registry";

@singleton()
export class SettingManager {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private setting: OuterSetting;
	shouldReload = false;

	async initAsync() {
		await this.loadSettings(); // must run this line before registering PluginSetting
		container.register(OuterSetting, { useValue: this.setting });
		this.plugin.addSettingTab(getInstance(GeneralTab));
	}

	// NOTE: this.plugin.saveData() can't handle Set
	async saveSettings() {
		await this.plugin.saveData(this.setting);
	}

	async postSettingUpdated() {
		this.saveSettings();

		if (this.shouldReload) {
			this.shouldReload = false;
			await this.downloadAndRefresh();
		}
	}

	private async loadSettings() {
		// shallow merge can't handle nested object correctly
		// this.setting = Object.assign(
		// 	{},
		// 	DEFAULT_OUTER_SETTING,
		// 	await this.plugin.loadData(),
		// );
		this.setting = MyLib.mergeDeep(
			DEFAULT_OUTER_SETTING,
			await this.plugin.loadData(),
		);
		logger.setLevel(this.setting.logLevel);
	}

	private async downloadAndRefresh() {
		getInstance(ViewRegistry).refreshAll();
		await getInstance(AssetsProvider).initAsync();
		await getInstance(ChinesePatch).initAsync();

		getInstance(DataProvider).init();
		await getInstance(DataManager).refreshAllAsync();
	}
}

@singleton()
class GeneralTab extends PluginSettingTab {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);
	// WARN: this class should not initialize any other modules on fields
	//       or there will be runtime exceptions that are hard to diagnose
	// BE CAUTIOUS

	constructor(@inject(THIS_PLUGIN) plugin: CleverSearch) {
		super(plugin.app, plugin);
	}
	hide() {
		this.settingManager.postSettingUpdated();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// new Setting(containerEl)
		// 	.setName("Min word Length to Trigger Prefix Search")
		// 	// For Chinese users, a setting of 1 or 2 is typically sufficient, because there are many different chars
		// 	.setDesc("Affect the responding speed for the first several characters")
		// 	.addSlider(text => text
		// 		.setLimits(1, 4, 1)
		// 		.setValue(this.setting.search.minTermLengthForPrefixSearch)
		// 		.setDynamicTooltip()
		// 		.onChange(async (value) => {
		// 			this.setting.search.minTermLengthForPrefixSearch = value as 1 | 2 | 3 | 4;
		// 			await this.settingManager.saveSettings();
		// 		}),
		// 	);

		new Setting(containerEl)
			.setName(t("Max items count"))
			.setDesc(t("Max items count desc"))
			.addSlider((text) =>
				text
					.setLimits(1, 300, 1)
					.setValue(this.setting.ui.maxItemResults)
					.setDynamicTooltip()
					.onChange((value) => {
						this.setting.ui.maxItemResults = value;
					}),
			);

		new Setting(containerEl)
			.setName(t("Floating window for in-file search"))
			.setDesc(t("Floating window for in-file search desc"))
			.addToggle((t) =>
				t
					.setValue(this.setting.ui.floatingWindowForInFile)
					.onChange(
						(v) => (this.setting.ui.floatingWindowForInFile = v),
					),
			);

		new Setting(containerEl)
			.setName(t("English word blacklist"))
			.setDesc(t("English word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsEn)
					.onChange((value) => {
						this.setting.enableStopWordsEn = value;
						this.settingManager.shouldReload = true;
					}),
			);

		new Setting(containerEl)
			.setName(t("Chinese patch"))
			.setDesc(t("Chinese patch desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableChinesePatch)
					.onChange(async (value) => {
						this.setting.enableChinesePatch = value;
						logger.info(
							`enable chinese: ${
								getInstance(OuterSetting).enableChinesePatch
							}`,
						);
						this.settingManager.shouldReload = true;
					}),
			);

		new Setting(containerEl)
			.setName(t("Chinese word blacklist"))
			.setDesc(t("Chinese word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsZh)
					.onChange(async (value) => {
						this.setting.enableStopWordsZh = value;
						this.settingManager.shouldReload = true;
					}),
			);
		new Setting(containerEl)
			.setName(t("Advanced"))
			.setDesc(t("Advanced.desc"));

		new Setting(containerEl)
			.setName("Semantic search")
			.addButton((b) =>
				b
					.setButtonText(t("Manage"))
					.onClick(() =>
						new SemanticSearchModal(getInstance(App)).open(),
					),
			);

		new Setting(containerEl).setName(t("Excluded files")).addButton((b) =>
			b.setButtonText(t("Manage")).onClick(() => {
				new ExcludePathModal(getInstance(App)).open();
			}),
		);

		new Setting(containerEl)
			.setName(t("Customize extensions"))
			.addButton((b) =>
				b
					.setButtonText(t("Manage"))
					.onClick(() =>
						new CustomExtensionModal(getInstance(App)).open(),
					),
			);

		// ======== For Development =======
		const settingGroup = containerEl.createDiv("cs-dev-setting-group");
		settingGroup.style.marginTop = "1.5em";

		const devSettingTitle = settingGroup.createDiv({
			cls: "cs-setting-group-dev-title",
			text: t("For Development"),
		});

		// collapse by default
		const devSettingContent = settingGroup.createDiv({
			cls: "cs-setting-group-dev-content",
		});

		const collapseDevSettingByDefault =
			this.setting.ui.collapseDevSettingByDefault;
		devSettingContent.style.display = collapseDevSettingByDefault
			? "none"
			: "block";
		devSettingTitle.style.setProperty(
			"--cs-dev-collapse-icon",
			collapseDevSettingByDefault ? ICON_COLLAPSE : ICON_EXPAND,
		);

		// 点击标题时切换设置组的显示状态，并更新伪元素的图标
		devSettingTitle.onclick = () => {
			const isCollapsed = devSettingContent.style.display === "none";
			devSettingContent.style.display = isCollapsed ? "block" : "none";
			devSettingTitle.style.setProperty(
				"--cs-dev-collapse-icon",
				isCollapsed ? ICON_EXPAND : ICON_COLLAPSE,
			);
		};

		new Setting(devSettingContent)
			.setName(t("Collapse development setting by default"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.ui.collapseDevSettingByDefault)
					.onChange((value) => {
						this.setting.ui.collapseDevSettingByDefault = value;
					}),
			);

		new Setting(devSettingContent)
			.setName(t("Reindex the vault"))
			.addButton((button) => {
				button.setButtonText(t("Reindex")).onClick(async () => {
					await getInstance(DataManager).refreshAllAsync();
				});
			});

		new Setting(devSettingContent)
			.setName(t("Log level"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						trace: "trace",
						debug: "debug",
						info: "info",
						warn: "warn",
						error: "error",
						none: "none",
					} as LogLevelOptions)
					// 不能用大写的字符串作为key...
					.setValue(this.setting.logLevel.toLowerCase())
					.onChange(async (value) => {
						const level = value as LogLevel;
						logger.setLevel(level);
						this.setting.logLevel = level;
					}),
			);

		new Setting(devSettingContent)
			.setName(t("Reset floating window position"))
			.setDesc(t("Reset floating window position desc"))
			.addButton((b) =>
				b.setButtonText(t("Reset position")).onClick((e) => {
					getInstance(FloatingWindowManager).resetAllPositions();
				}),
			);

		new Setting(devSettingContent)
			.setName(t("Support the Project"))
			.setDesc(t("Support the Project desc"))
			.addButton((button) => {
				button.setButtonText(t("Visit GitHub")).onClick(() => {
					window.open(
						"https://github.com/yan42685/obsidian-clever-search",
						"_blank",
					);
				});
			});

		new Setting(devSettingContent)
			.setName("API provider1")
			.setDesc("domain and key")
			.addText((text) =>
				text
					.setPlaceholder("api.openai.com")
					.setValue(this.setting.apiProvider1.domain)
					.onChange((domain) => {
						this.setting.apiProvider1.domain = domain;
						this.settingManager.saveSettings();
					}),
			)

			.addText((text) =>
				text
					.setPlaceholder("API key")

					.setValue(this.setting.apiProvider1.key)
					.onChange((key) => {
						this.setting.apiProvider1.key = key;
					}),
			);

		new Setting(devSettingContent)
			.setName("API provider2")
			.setDesc("description")
			.addText((text) =>
				text
					.setPlaceholder("api.openai.com")
					.setValue(this.setting.apiProvider2.domain)
					.onChange((domain) => {
						this.setting.apiProvider2.domain = domain;
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder("API key")
					.setValue(this.setting.apiProvider2.key)
					.onChange((key) => {
						this.setting.apiProvider2.key = key;
					}),
			);
	}
}

class ExcludePathModal extends Modal {
	private settingManager = getInstance(SettingManager);
	private setting = getInstance(OuterSetting);
	private excludedPaths = this.setting.excludedPaths;
	private allPaths = new Set<string>();
	private allFolders = new Set<string>();

	private excludesEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private suggester: CommonSuggester;

	constructor(app: App) {
		super(app);
		const allAbstractFiles = getInstance(Vault).getAllLoadedFiles();
		for (const aFile of allAbstractFiles) {
			this.allPaths.add(aFile.path);
			if (aFile instanceof TFolder) {
				this.allFolders.add(aFile.path);
			}
		}
	}

	onOpen() {
		this.modalEl.style.width = "48vw";
		this.modalEl.style.marginBottom = "5em";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const contentEl = this.contentEl;
		new Setting(contentEl)
			.setName(t("Follow Obsidian Excluded Files"))
			.addToggle((t) =>
				t
					.setValue(this.setting.followObsidianExcludedFiles)
					.onChange((v) => {
						this.setting.followObsidianExcludedFiles = v;
						this.settingManager.shouldReload = true;
					}),
			);
		contentEl.createEl("h2", { text: t("Excluded files") });
		this.excludesEl = contentEl.createDiv();
		this.renderExcludedList(this.excludesEl);

		new Setting(contentEl)
			.addText((text) => {
				this.inputEl = text.inputEl;
				text.setPlaceholder(t("Enter path...")).onChange((value) => {
					this.suggester.close();
					this.suggester.open();
				});
			})
			.addButton((btn) => {
				btn.setButtonText(t("Add")).onClick(() => {
					this.addPath(this.inputEl.value);
				});
			});

		this.suggester = new CommonSuggester(
			this.inputEl,
			this.allFolders,
			(v) => {
				this.addPath(v);
			},
		);
		setTimeout(() => {
			this.inputEl.focus();
		}, 1);
	}

	private renderExcludedList(listEl: HTMLElement) {
		listEl.empty();

		this.excludedPaths.forEach((path, index) => {
			const pathDiv = listEl.createDiv();
			pathDiv.style.overflow = "auto";
			pathDiv.style.display = "flex";
			pathDiv.style.margin = "0.7em 0 0.7em 0";
			pathDiv.style.justifyContent = "space-between";

			const pathText = pathDiv.createSpan();
			pathText.setText(path);
			pathText.style.width = "90%";
			pathText.style.overflow = "auto";

			const span = pathDiv.createSpan();
			span.setText("✕");
			span.style.cursor = "pointer";
			span.onClickEvent(() => {
				this.excludedPaths.splice(index, 1);
				this.settingManager.shouldReload = true;
				this.renderExcludedList(listEl);
			});
		});
	}

	private addPath(inputPath: string) {
		if (inputPath && !this.excludedPaths.includes(inputPath)) {
			if (!this.allPaths.has(inputPath)) {
				new MyNotice(`Path doesn't exist: ${inputPath}`, 5000);
			} else {
				this.excludedPaths.push(inputPath);
				this.settingManager.shouldReload = true;
				this.renderExcludedList(this.excludesEl);
			}
		}
	}
}

class CustomExtensionModal extends Modal {
	private setting = getInstance(OuterSetting);
	private settingManager = getInstance(SettingManager);
	onOpen(): void {
		this.modalEl.style.width = "60vw";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const contentEl = this.contentEl;

		new Setting(contentEl).setDesc(t("extensionModal.desc"));
		new Setting(contentEl)
			.setName(t("extensionModal.plaintextName"))
			.setDesc(t("extensionModal.plaintextDesc"))
			.addTextArea((textArea) => {
				textArea.inputEl.style.minWidth = "20vw";
				textArea.inputEl.style.minHeight = "20vh";
				textArea.setValue(
					this.setting.customExtensions.plaintext.join(" "),
				);

				textArea.onChange((newValue) => {
					const extensions = newValue
						.split(/[\s\n]+/)
						.map((ext) =>
							ext.startsWith(".") ? ext.substring(1) : ext,
						)
						.filter((ext) => ext.length > 0);

					this.setting.customExtensions.plaintext = extensions;
					this.settingManager.shouldReload = true;
				});
			});

		new Setting(contentEl).setName("Image").setDesc("Todo");
	}
}

class SemanticSearchModal extends Modal {
	private semanticEngine = getInstance(SemanticEngine);
	private setting = getInstance(OuterSetting).semantic;
	private settingManager = getInstance(SettingManager);
	private needInitSemanticEngine = false;
	onOpen(): void {
		this.modalEl.style.width = "50vw";
		this.modalEl.style.height = "80vh";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const contentEl = this.contentEl;
		new Setting(contentEl).setName("Enable").addToggle((t) =>
			t.setValue(this.setting.isEnabled).onChange((v) => {
				this.setting.isEnabled = v;
				if (v === true) {
					this.needInitSemanticEngine = true;
				}
			}),
		);
		new Setting(contentEl)
			.setName("Server type")
			.setDesc(
				"For local server, Clever Search AI Helper needs to run in the background. For remote server, it has not been implemented yet.",
			)
			.addDropdown((d) =>
				d
					.addOptions({ local: "local", remote: "remote" })
					.setValue(this.setting.serverType)
					.onChange(
						(v) =>
							(this.setting.serverType = v as "local" | "remote"),
					),
			);
		new Setting(contentEl)
			.setName("Utilities")
			.addButton((b) =>
				b
					.setButtonText("Test connection")
					.onClick(() => this.semanticEngine.testConnection()),
			);
		// .addButton(b=>b.setButtonText("Refresh states").onClick(async ()=>{
		// 	const count = await this.semanticEngine.docsCount();
		// 	if (count) {
		// 		new MyNotice(`Indexed docs count: ${count}`, 5000)
		// 	}
		// }))
		// .addButton((b) => b.setButtonText("Reindex").onClick(() => {}));
	}
	onClose(): void {
		if (this.needInitSemanticEngine) {
			this.needInitSemanticEngine = false;
			getInstance(DataManager).initSemanticEngine();
		}
	}
}
