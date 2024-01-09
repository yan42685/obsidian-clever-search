import { OuterSetting } from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import { OmnisearchIntegration } from "src/integrations/omnisearch";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { SearchClient } from "src/web-workers/client";
import { singleton } from "tsyringe";
import { getInstance } from "../../utils/my-lib";
import { SettingManager } from "./setting-manager";
import { DataManager } from "./user-data/data-manager";

@singleton()
export class PluginManager {
	// private readonly obFileUtil = getInstance(Vault).adapter as FileSystemAdapter;
	async onload() {
		await getInstance(SettingManager).initAsync();
		const setting = getInstance(OuterSetting);

		await getInstance(AssetsProvider).initAsync();
		if (setting.enableChinesePatch) {
			await getInstance(ChinesePatch).initAsync();
		}
		await getInstance(SearchClient).createChildThreads();
	}

	async onLayoutReady() {
		await getInstance(DataManager).initAsync();
		await getInstance(OmnisearchIntegration).initAsync();
	}

	// should be called in CleverSearch.onunload()
	onunload() {
		getInstance(DataManager).onunload();
	}
}
