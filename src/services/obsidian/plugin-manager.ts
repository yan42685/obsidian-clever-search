import { singleton } from "tsyringe";
import { getInstance } from "../../utils/my-lib";
import { FileWatcher, SearchService } from "./search-service";
import { SettingManager } from "./setting-manager";
import { DataManager } from "./user-data/data-manager";

@singleton()
export class PluginManager {
	// private readonly obFileUtil = getInstance(Vault).adapter as FileSystemAdapter;
	async initAsync() {
		await getInstance(SettingManager).initAsync();
		await getInstance(SearchService).initAsync();
		await getInstance(DataManager).initAsync();
		getInstance(FileWatcher).start();
	}

	// should be called in CleverSearch.onunload()
	onunload() {
		getInstance(FileWatcher).stop();
	}
}
