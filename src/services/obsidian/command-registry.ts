import {
	App,
	Scope,
	type Command,
	type KeymapEventHandler,
	type Modifier,
} from "obsidian";
import { devTest } from "src/dev-test";
import { THIS_PLUGIN } from "src/globals/constants";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import { SearchType } from "src/globals/search-types";
import { OmnisearchIntegration } from "src/integrations/omnisearch";
import type CleverSearch from "src/main";
import { FloatingWindowManager } from "src/ui/floating-window";
import { SearchModal } from "src/ui/search-modal";
import { eventBus } from "src/utils/event-bus";
import { currModifier, getInstance, isDevEnvironment } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { AuxiliaryService } from "../auxiliary/auxiliary-service";

@singleton()
export class CommandRegistry {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private setting = getInstance(OuterSetting);
	private app = getInstance(App);

	constructor() {
		getInstance(GlobalNavigationHotkeys).registerAll();
	}

	// only for developer
	addDevCommands() {
		if (isDevEnvironment) {
			this.addCommand({
				id: "cs-in-file-search-floating-window",
				name: "In file search - floating window",
				callback: () =>
					getInstance(FloatingWindowManager).toggle("inFile"),
			});

			this.addCommand({
				id: "clever-search-triggerTest",
				name: "clever-search-triggerTest",
				// hotkeys: [{modifiers: [currModifier], key: "5"}],
				callback: async () => await devTest(),
			});

			this.addCommand({
				id: "clever-search-in-vault-semantic",
				name: "Search in vault semantically",
				callback: async () =>
					new SearchModal(this.app, SearchType.IN_VAULT, true).open(),
			});
		}
	}

	addCommandsWithoutDependency() {
		this.addCommand({
			id: "clever-search-in-file",
			name: "Search in file",
			callback: () => {
				if (this.setting.ui.floatingWindowForInFile) {
					getInstance(FloatingWindowManager).toggle("inFile");
				} else {
					new SearchModal(this.app, SearchType.IN_FILE, false).open();
				}
			},
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
				new SearchModal(this.app, SearchType.IN_VAULT, false).open();
			},
		});

		this.addCommand({
			id: "cs-in-file-search-with-omnisearch-query",
			name: "Search in file with last Omnisearch query",
			callback: async () => {
				new SearchModal(
					this.app,
					SearchType.IN_FILE,
					false,
					await getInstance(OmnisearchIntegration).getLastQuery(),
				).open();
			},
		});
	}

	onunload() {
		getInstance(GlobalNavigationHotkeys).unregisterAll();
	}

	private addCommand(command: Command) {
		this.plugin.addCommand(command);
	}
}

function emitEvent(eventEnum: EventEnum) {
	return (e: Event) => {
		e.preventDefault();
		eventBus.emit(eventEnum);
		console.log("emit...");
	};
}

// register global hotkeys for FloatingWindow and scoped hotkeys for each Modal
abstract class AbstractNavigationHotkeys {
	protected handlers: KeymapEventHandler[] = [];
	protected scope: Scope;

	constructor(scope: Scope) {
		this.scope = scope;
	}

	abstract registerAll(): void;

	unregisterAll() {
		this.handlers.forEach((h) => {
			this.scope.unregister(h);
		});
		this.handlers = [];
	}

	protected register(
		modifiers: Modifier[],
		key: string,
		eventEnum: EventEnum,
	) {
		this.handlers.push(
			this.scope.register(modifiers, key, emitEvent(eventEnum)),
		);
	}
}

@singleton()
class GlobalNavigationHotkeys extends AbstractNavigationHotkeys {
	constructor() {
		super(getInstance(App).scope);
	}

	registerAll() {
		// 检测平台，以确定是使用 'Ctrl' 还是 'Cmd'（Mac）
		const modKey = currModifier;
		// console.log("current modifier: " + modKey);
		this.handlers = [];
		this.register([modKey], "J", EventEnum.NEXT_ITEM_FLOATING_WINDOW);
		this.register([modKey], "K", EventEnum.PREV_ITEM_FLOATING_WINDOW);
	}
}

// non-singleton, create for each modal
export class ModalNavigationHotkeys extends AbstractNavigationHotkeys {
	constructor(scope: Scope) {
		super(scope);
	}

	registerAll(): void {
		const modKey = currModifier;
		// console.log("current modifier: " + modKey);

		this.register([modKey], "J", EventEnum.NEXT_ITEM);
		this.register([modKey], "K", EventEnum.PREV_ITEM);

		this.register([], "ArrowDown", EventEnum.NEXT_ITEM);
		this.register([], "ArrowUp", EventEnum.PREV_ITEM);
		this.register([], "Enter", EventEnum.CONFIRM_ITEM);
		this.register([modKey], "N", EventEnum.NEXT_SUB_ITEM);
		this.register([modKey], "P", EventEnum.PREV_SUB_ITEM);
	}
}
