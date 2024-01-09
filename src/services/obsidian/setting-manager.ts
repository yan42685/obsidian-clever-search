import { PluginSettingTab, Setting } from "obsidian";
import { ICON_COLLAPSE, ICON_EXPAND, THIS_PLUGIN } from "src/globals/constants";
import {
    DEFAULT_OUTER_SETTING,
    OuterSetting,
    type LogLevelOptions,
} from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import type CleverSearch from "src/main";
import { logger, type LogLevel } from "src/utils/logger";
import { getInstance, isDevEnvironment } from "src/utils/my-lib";
import {
    AssetsProvider,
    stopWordsEnTargetUrl,
} from "src/utils/web/assets-provider";
import { container, inject, singleton } from "tsyringe";
import { DataManager } from "./user-data/data-manager";

@singleton()
export class SettingManager {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private setting: OuterSetting;

	async initAsync() {
		await this.loadSettings(); // must run this line before registering PluginSetting
		container.register(OuterSetting, { useValue: this.setting });
		this.plugin.addSettingTab(getInstance(GeneralTab));
	}

	async loadSettings() {
		this.setting = Object.assign(
			{},
			DEFAULT_OUTER_SETTING,
			await this.plugin.loadData(),
		);
		logger.setLevel(this.setting.logLevel);
	}

	async saveSettings() {
		await this.plugin.saveData(this.setting);
	}
}

@singleton()
class GeneralTab extends PluginSettingTab {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);
	private shouldDownloadAndRefreshIndex = false;
	// WARN: this class should not initialize any other modules on fields
	//       or there will be runtime exceptions that are hard to diagnose
	// BE CAUTIOUS

	constructor(@inject(THIS_PLUGIN) plugin: CleverSearch) {
		super(plugin.app, plugin);
	}
	hide() {
		if (this.shouldDownloadAndRefreshIndex) {
			this.shouldDownloadAndRefreshIndex = false;
			this.saveSettingDownloadRefresh();
		}
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
			.setName("Max item results")
			.setDesc("Due to renderer's limited capabilities, this plugin can find thousands of results, but cannot display them all at once")
			.addSlider(text => text
				.setLimits(1, 300, 1)
				.setValue(this.setting.ui.maxItemResults)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.setting.ui.maxItemResults = value;
					await this.settingManager.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("English word blacklist")
			.setDesc(
				`Exclude some meaningless English words like "was", "two", "top" from indexing, enhancing search and indexing speed. Modify the file at ${stopWordsEnTargetUrl} to tailor the list to your needs.`,
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsEn)
					.onChange(async (value) => {
						this.setting.enableStopWordsEn = value;
						this.shouldDownloadAndRefreshIndex = true;
					}),
			);

		new Setting(containerEl)
			.setName("Chinese Patch")
			.setDesc("Better search result for Chinese")
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
						this.shouldDownloadAndRefreshIndex = true;
					}),
			);

		new Setting(containerEl)
			.setName("Chinese word blacklist")
			.setDesc(
				`Activates only if the Chinese Patch is enabled. This excludes some meaningless Chinese words like "的", "所以", "防止" listed in 'stop-words-zh.txt', improving search efficiency and speed. More details are listed in 'English word blacklist' option`,
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsZh)
					.onChange(async (value) => {
						this.setting.enableStopWordsZh = value;
						this.shouldDownloadAndRefreshIndex = true;
					}),
			);

		// ======== For Development =======
		const settingGroup = containerEl.createDiv("cs-dev-setting-group");

		const devSettingTitle = settingGroup.createDiv({
			cls: "cs-setting-group-dev-title",
			text: "For Development",
		});

		// collapse by default
		const devSettingContent = settingGroup.createDiv({
			cls: "cs-setting-group-dev-content",
		});
		// devSettingContent.style.display = "none";
		const initialCollapsed = isDevEnvironment ? false : true;
		devSettingTitle.style.setProperty(
			"--cs-dev-collapse-icon",
			initialCollapsed ? ICON_COLLAPSE : ICON_EXPAND,
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
			.setName("Force Refresh Index")
			.setDesc("Reindex your vault")
			.addButton((button) => {
				button.setButtonText("Force Refresh").onClick(async () => {
					await getInstance(DataManager).forceRefreshAll();
				});
			});

		new Setting(devSettingContent)
			.setName("Log level")

			.setDesc("Select the log level.")
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

	private async saveSettingDownloadRefresh() {
		await getInstance(SettingManager).saveSettings();
		await getInstance(AssetsProvider).initAsync();
		if (this.setting.enableChinesePatch) {
			await getInstance(ChinesePatch).initAsync();
		}
		await getInstance(DataManager).forceRefreshAll();
	}
}
