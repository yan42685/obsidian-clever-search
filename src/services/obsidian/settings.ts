import { PluginSettingTab, Setting } from "obsidian";
import type CleverSearch from "src/main";
import { ICON_COLLAPSE, ICON_EXPAND, THIS_PLUGIN } from "src/utils/constants";
import { logger, type LogLevel } from "src/utils/logger";
import { isDevEnvironment } from "src/utils/my-lib";
import { container } from "tsyringe";

export type ApiProvider = {
	domain: string;
	key: string;
};

export class SettingManager {
	plugin: CleverSearch = container.resolve(THIS_PLUGIN);
	constructor() {
		this.plugin.addSettingTab(new GeneralTab(this.plugin));
	}
}

class GeneralTab extends PluginSettingTab {
	plugin: CleverSearch;
	constructor(plugin: CleverSearch) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		// 清空设置面板的内容
		containerEl.empty();

		// 创建设置组
		const settingGroup = containerEl.createDiv("cs-dev-setting-group");

		// 创建设置组标题
		const devSettingTitle = settingGroup.createDiv({
			cls: "cs-setting-group-dev-title",
			text: "For Development",
		});

		// 创建设置组内容，初始状态为折叠
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
					.setValue(this.plugin.settings.apiProvider1.domain)
					.onChange((domain) => {
						this.plugin.settings.apiProvider1.domain = domain;
						this.plugin.saveSettings();
					}),
			)

			.addText((text) =>
				text
					.setPlaceholder("API key")

					.setValue(this.plugin.settings.apiProvider1.key)
					.onChange((key) => {
						this.plugin.settings.apiProvider1.key = key;
						this.plugin.saveSettings();
					}),
			);

		new Setting(devSettingContent)
			.setName("API provider2")
			.setDesc("description")
			.addText((text) =>
				text
					.setPlaceholder("api.openai.com")
					.setValue(this.plugin.settings.apiProvider2.domain)
					.onChange((domain) => {
						this.plugin.settings.apiProvider2.domain = domain;
						this.plugin.saveSettings();
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder("API key")
					.setValue(this.plugin.settings.apiProvider2.key)
					.onChange((key) => {
						this.plugin.settings.apiProvider2.key = key;
						this.plugin.saveSettings();
					}),
			);

		new Setting(devSettingContent)
			.setName("Log level")

			.setDesc("Select the log level.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						debug: "debug",
						info: "info",
						warn: "warn",
						error: "error",
						none: "none",
					})
					// 不能用大写的字符串作为key...
					.setValue(this.plugin.settings.logLevel.toLowerCase())
					.onChange(async (value) => {
						const level = value as LogLevel;
						logger.setLevel(level);
						this.plugin.settings.logLevel = level;
						await this.plugin.saveSettings();
					}),
			);
	}
}

export class PluginSettings {
	mySetting = "default";
	logLevel: LogLevel = "debug";
	apiProvider1: ApiProvider;
	apiProvider2: ApiProvider;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	mySetting: "default",
	logLevel: isDevEnvironment ? "debug" : "none",
	apiProvider1: {
		domain: "",
		key: "",
	},
	apiProvider2: {
		domain: "",
		key: "",
	},
};