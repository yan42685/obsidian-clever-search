import { App, Modal, PluginSettingTab, Setting, Vault } from "obsidian";
import { ICON_COLLAPSE, ICON_EXPAND, THIS_PLUGIN } from "src/globals/constants";
import {
	DEFAULT_OUTER_SETTING,
	OuterSetting,
	type LogLevelOptions,
} from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import type CleverSearch from "src/main";
import { logger, type LogLevel } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { container, inject, singleton } from "tsyringe";
import { t } from "./translations/locale-helper";
import { DataManager } from "./user-data/data-manager";

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

	async saveSettings() {
		await this.plugin.saveData(this.setting);
	}

	async postSettingUpdated() {
		if (this.shouldReload) {
			this.shouldReload = false;
			await this.saveSettingDownloadRefresh();
		} else {
			this.saveSettings();
		}
	}

	private async loadSettings() {
		this.setting = Object.assign(
			{},
			DEFAULT_OUTER_SETTING,
			await this.plugin.loadData(),
		);
		logger.setLevel(this.setting.logLevel);
	}

	private async saveSettingDownloadRefresh() {
		await getInstance(SettingManager).saveSettings();
		await getInstance(AssetsProvider).initAsync();
		await getInstance(ChinesePatch).initAsync();
		await getInstance(DataManager).forceRefreshAll();
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
					.onChange(async (value) => {
						this.setting.ui.maxItemResults = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Filter files").addButton((b) =>
			b.setButtonText("Open Setting").onClick(() => {
				new FileFilterModal(getInstance(App)).open();
			}),
		);

		new Setting(containerEl)
			.setName(t("English word blacklist"))
			.setDesc(t("English word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsEn)
					.onChange(async (value) => {
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

		// ======== For Development =======
		const settingGroup = containerEl.createDiv("cs-dev-setting-group");

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
					.onChange(async (value) => {
						this.setting.ui.collapseDevSettingByDefault = value;
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
						this.settingManager.saveSettings();
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
						this.settingManager.saveSettings();
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder("API key")
					.setValue(this.setting.apiProvider2.key)
					.onChange((key) => {
						this.setting.apiProvider2.key = key;
						this.settingManager.saveSettings();
					}),
			);

		new Setting(devSettingContent)
			.setName(t("Reindex the vault"))
			.addButton((button) => {
				button.setButtonText(t("Reindex")).onClick(async () => {
					await getInstance(DataManager).forceRefreshAll();
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
						await this.settingManager.saveSettings();
					}),
			);
	}
}

class FileFilterModal extends Modal {
	private setting = getInstance(OuterSetting);
	private excludedPaths: string[] = this.setting.excludedPaths;
	private allFolders = this.getAllFolders();

	private excludesEl: HTMLElement;
	private inputEl: HTMLInputElement; 
	private suggestionsEl: HTMLElement; 

	onOpen() {
		const { contentEl } = this;
		this.contentEl.empty();
		contentEl.createEl("h2", { text: "Excluded Files" });
		this.excludesEl = contentEl.createDiv("cs-excluded-paths");

		this.suggestionsEl = contentEl.createDiv("suggestions-container");
		this.renderExcludedList(this.excludesEl);

		new Setting(contentEl)
			.setName("Add filter")
			.addText((text) => {
				text.setPlaceholder("Enter path...").onChange((value) => {
					this.inputEl = text.inputEl;
					// this.handleAutocomplete(value);
				});
			})
			.addButton((btn) => {
				btn.setButtonText("Add").onClick(() => {
					const filterValue = this.inputEl.value;
					if (filterValue) {
						if (!this.excludedPaths.includes(filterValue)) {
							this.excludedPaths.push(filterValue);
							this.renderExcludedList(this.excludesEl);
						}
					}
				});
			});
	}

	private renderExcludedList(listEl: HTMLElement) {
		listEl.empty();

		this.excludedPaths.forEach((path, index) => {
			const pathDiv = listEl.createDiv();
			pathDiv.style.margin = "0.7em 0 0.7em 0";
			pathDiv.style.display = "flex";
			pathDiv.style.justifyContent = "space-between";

			const pathText = pathDiv.createSpan();
			pathText.setText(path);

			const span = pathDiv.createSpan();
			span.setText("✕");
			span.style.cursor = "pointer";
			span.onClickEvent(() => {
				this.excludedPaths.splice(index, 1);
				this.renderExcludedList(listEl);
			});
		});
	}

	private getAllFolders(): string[] {
		const folderSet = new Set(
			getInstance(Vault)
				.getFiles()
				.map((f) => f.parent?.path || ""),
		);
		return [...folderSet];
	}
}
