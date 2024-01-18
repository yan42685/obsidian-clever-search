import { App, Scope, type Command, type Modifier } from "obsidian";
import { devTest } from "src/dev-test";
import { THIS_PLUGIN } from "src/globals/constants";
import { EventEnum } from "src/globals/enums";
import { SearchType } from "src/globals/search-types";
import { OmnisearchIntegration } from "src/integrations/omnisearch";
import type CleverSearch from "src/main";
import { FloatingWindow } from "src/ui/floating-window";
import { SearchModal } from "src/ui/search-modal";
import { eventBus } from "src/utils/event-bus";
import { currModifier, getInstance, isDevEnvironment } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { AuxiliaryService } from "../auxiliary/auxiliary-service";

@singleton()
export class CommandRegistry {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private app = getInstance(App);

	constructor() {
		this.registerNavigationHotkeys(this.app.scope);
	}

	// only for developer
	addDevCommands() {
		if (isDevEnvironment) {
			this.addCommand({
				id: "cs-in-file-search-floating-window",
				name: "In file search - floating window",
				callback: () => getInstance(FloatingWindow).toggle()
			})

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
			callback: () => {
				eventBus.emit(EventEnum.IN_VAULT_SEARCH);
				new SearchModal(this.app, SearchType.IN_VAULT).open();
			},
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

	onunload() {

	}

	private addCommand(command: Command) {
		this.plugin.addCommand(command);
	}

	// register global hotkeys for FloatingWindow and scoped hotkeys for each Modal
	registerNavigationHotkeys(scope: Scope) {
		// 检测平台，以确定是使用 'Ctrl' 还是 'Cmd'（Mac）
		const modKey = currModifier;
		// console.log("current modifier: " + modKey);

		this.newHotKey(scope, [modKey], "J", EventEnum.NEXT_ITEM);
		this.newHotKey(scope, [], "ArrowDown", EventEnum.NEXT_ITEM);

		this.newHotKey(scope, [modKey], "K", EventEnum.PREV_ITEM);
		this.newHotKey(scope, [], "ArrowUp", EventEnum.PREV_ITEM);

		this.newHotKey(scope, [modKey], "N", EventEnum.NEXT_SUB_ITEM);
		this.newHotKey(scope, [modKey], "P", EventEnum.PREV_SUB_ITEM);

		this.newHotKey(scope, [], "Enter", EventEnum.CONFIRM_ITEM);
	}

	private newHotKey(
		scope: Scope,
		modifiers: Modifier[],
		key: string,
		eventEnum: EventEnum,
	) {
		// this.scope.register(modifiers, key, emitEvent(eventEnum));
		scope.register(modifiers, key, emitEvent(eventEnum));
	}
}

function emitEvent(eventEnum: EventEnum) {
	return (e: Event) => {
		e.preventDefault();
		eventBus.emit(eventEnum);
		console.log("emit...");


	};
}
