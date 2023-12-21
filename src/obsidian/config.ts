import { PluginSettingTab, Setting } from "obsidian";
import type CleverSearch from "src/main";
import { THIS_PLUGIN } from "src/utils/constants";
import { container } from "tsyringe";

export class ConfigManager {
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
