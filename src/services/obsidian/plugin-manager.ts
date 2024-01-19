import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import { OmnisearchIntegration } from "src/integrations/omnisearch";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { SearchClient } from "src/web-workers/client";
import { singleton } from "tsyringe";
import { getInstance } from "../../utils/my-lib";
import { CommandRegistry } from "./command-registry";
import { SettingManager } from "./setting-manager";
import { DataManager } from "./user-data/data-manager";
import { ViewRegistry } from "./view-registry";
import { FloatingWindowManager } from "src/ui/floating-window";

@singleton()
export class PluginManager {
	// private readonly obFileUtil = getInstance(Vault).adapter as FileSystemAdapter;

	async onload() {
		await getInstance(SettingManager).initAsync();
		getInstance(ViewRegistry).init();

		getInstance(CommandRegistry).addCommandsWithoutDependency();

		await getInstance(AssetsProvider).initAsync();
		await getInstance(ChinesePatch).initAsync();
		await getInstance(SearchClient).createChildThreads();
	}

	async onLayoutReady() {
		await getInstance(DataManager).initAsync();
		await getInstance(OmnisearchIntegration).initAsync();

		const commandRegistry = getInstance(CommandRegistry);
		commandRegistry.addInVaultLexicalCommands();
		commandRegistry.addDevCommands();
	}

	// should be called in CleverSearch.onunload()
	onunload() {
		getInstance(DataManager).onunload();
		getInstance(FloatingWindowManager).onunload();
	}

	onAppQuit() {
		// getInstance(SettingManager).saveSettings();
	}
}
