import { PluginSettingTab, Setting } from "obsidian";
import {
	ICON_COLLAPSE,
	ICON_EXPAND,
	THIS_PLUGIN
} from "src/globals/constants";
import { DEFAULT_PLUGIN_SETTING, PluginSetting, type LogLevelOptions } from "src/globals/plugin-setting";
import type CleverSearch from "src/main";
import { logger, type LogLevel } from "src/utils/logger";
import { getInstance, isDevEnvironment } from "src/utils/my-lib";
import { container, inject, singleton } from "tsyringe";

@singleton()
export class SettingManager {
	private  plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private  setting: PluginSetting;

	async initAsync() {
		await this.loadSettings()  // must run this line before registering PluginSetting
		container.register(PluginSetting, { useValue: this.setting });
		this.plugin.addSettingTab(getInstance(GeneralTab));
	}

	async loadSettings() {
		this.setting = Object.assign(
			{},
			DEFAULT_PLUGIN_SETTING,
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
	private readonly setting = getInstance(PluginSetting);

	constructor(@inject(THIS_PLUGIN) plugin: CleverSearch) {
		super(plugin.app, plugin);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Min word Length to Trigger Prefix Search")
			// For Chinese users, a setting of 1 or 2 is typically sufficient, because there are many different chars
			.setDesc("Affect the responding speed for the first several characters")
			.addSlider(text => text
				.setLimits(1, 4, 1)
				.setValue(this.setting.search.minTermLengthForPrefixSearch)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.setting.search.minTermLengthForPrefixSearch = value as 1 | 2 | 3 | 4;
					await this.settingManager.saveSettings();
				}),
			);

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
}
