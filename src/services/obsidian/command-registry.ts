import { App, type Command } from "obsidian";
import { devTest } from "src/dev-test";
import { THIS_PLUGIN } from "src/globals/constants";
import { SearchType } from "src/globals/search-types";
import { OmnisearchIntegration } from "src/integrations/omnisearch";
import type CleverSearch from "src/main";
import { SearchModal } from "src/ui/search-modal";
import { getInstance, isDevEnvironment } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { AuxiliaryService } from "../auxiliary/auxiliary-service";

@singleton()
export class CommandRegistry {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private app = getInstance(App);

	// only for developer
	addDevCommands() {
		if (isDevEnvironment) {
			this.addCommand({
				id: "clever-search-triggerTest",
				name: "clever-search-triggerTest",
				// hotkeys: [{modifiers: [currModifier], key: "5"}],
				callback: async () => await devTest(),
			});

			this.addCommand({
				id: "cs-open-test-modal",
				name: "Open test modal",
				callback: () => this.plugin.openTestModal(),
			});
		}
	}

	addCommandsWithoutDependency() {
		this.addCommand({
			id: "clever-search-in-file",
			name: "Search in file",
			callback: () =>
				new SearchModal(this.app, SearchType.IN_FILE).open(),
		});

		this.addCommand({
			id: "cs-toggle-privacy-mode",
			name: "Toggle privacy mode",
			callback: () => getInstance(AuxiliaryService).togglePrivacyMode(),
		});
	}

	addInVaultLexicalCommands() {
		this.addCommand({
			id: "clever-search-in-vault",
			name: "Search in Vault",
			callback: () =>
				new SearchModal(this.app, SearchType.IN_VAULT).open(),
		});

		this.addCommand({
			id: "cs-in-file-search-with-omnisearch-query",
			name: "Search in file with last Omnisearch query",
			callback: async () => {
				new SearchModal(
					this.app,
					SearchType.IN_FILE,
					await getInstance(OmnisearchIntegration).getLastQuery(),
				).open();
			},
		});
	}

	private addCommand(command: Command) {
		this.plugin.addCommand(command);
	}
}
