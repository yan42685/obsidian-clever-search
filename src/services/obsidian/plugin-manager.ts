import { OmnisearchIntegration } from "src/integrations/omnisearch";
import { SearchClient } from "src/web-workers/client";
import { singleton } from "tsyringe";
import { getInstance } from "../../utils/my-lib";
import { SettingManager } from "./setting-manager";
import { DataManager } from "./user-data/data-manager";

@singleton()
export class PluginManager {
	// private readonly obFileUtil = getInstance(Vault).adapter as FileSystemAdapter;
	async initAsync() {
		await getInstance(SearchClient).createChildThreads();
		await getInstance(SettingManager).initAsync();
		await getInstance(DataManager).initAsync();
		await getInstance(OmnisearchIntegration).initAsync();
	}

	// should be called in CleverSearch.onunload()
	onunload() {
		getInstance(DataManager).onunload();
	}
}
