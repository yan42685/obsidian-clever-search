import {
	App,
	Scope,
	type Command,
	type KeymapEventHandler,
	type Modifier
} from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import { SearchType } from "src/globals/search-types";
import { OmnisearchIntegration } from "src/integrations/omnisearch";
import type CleverSearch from "src/main";
import { FloatingWindowManager } from "src/ui/floating-window";
import { QuickSwitchModal } from "src/ui/quick-switch-modal";
import { SearchModal } from "src/ui/search-modal";
import { eventBus } from "src/utils/event-bus";
import { getInstance, isDevEnvironment } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { AuxiliaryService } from "../auxiliary/auxiliary-service";
import { openHybridSearchModal } from "./setting-manager";
import { DataManager } from "./user-data/data-manager";
import { MyNotice } from "./transformed-api";
import { t } from "./translations/locale-helper";
import { registerDevCommands } from "./command-registry.dev";


const CTRL: Modifier = "Ctrl";
const ALT: Modifier = "Alt";
const SHIFT: Modifier = "Shift";

type DevCommandRegistryContext = {
	app: App;
	addCommand: (command: Command) => void;
	runWhenSearchSearchable: (callback: () => void | Promise<void>) => void;
};

@singleton()
export class CommandRegistry {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private setting = getInstance(OuterSetting);
	private app = getInstance(App);

	constructor() {
		getInstance(GlobalNavigationHotkeys).registerAll();
	}

	// only for developer
	async addDevCommands(): Promise<void> {
		if (!isDevEnvironment) {
			return;
		}

		await registerDevCommands({
			app: this.app,
			addCommand: (command) => this.addCommand(command),
			runWhenSearchSearchable: (callback) =>
				this.runWhenSearchSearchable(callback),
		});
	}

	addCommandsWithoutDependency() {
		this.addCommand({
			id: "clever-search-in-file",
			name: "Search in file",
			callback: () => {
				if (this.setting.ui.floatingWindowForInFile) {
					getInstance(FloatingWindowManager).toggle("inFile");
				} else {
					new SearchModal(this.app, SearchType.IN_FILE).open();
				}
			},
		});

		this.addCommand({
			id: "cs-quickswitch",
			name: "QuickSwitch",
			callback: () => new QuickSwitchModal(this.app).open(),
		});

		this.addCommand({
			id: "cs-search-commands",
			name: "Search commands",
			callback: () => new QuickSwitchModal(this.app, "command").open(),
		});


		this.addCommand({
			id: "cs-toggle-privacy-mode",
			name: "Toggle privacy mode",
			callback: () => getInstance(AuxiliaryService).togglePrivacyMode(),
		});

		this.addCommand({
			id: "cs-manage-hybrid-search",
			name: "Manage hybrid search",
			callback: () => openHybridSearchModal(this.app),
		});
	}

	addInVaultCommands() {
		this.addCommand({
			id: "clever-search-in-vault",
			name: "Search in Vault",
			callback: () =>
				this.runWhenSearchSearchable(() => {
					eventBus.emit(EventEnum.IN_VAULT_SEARCH);
					new SearchModal(this.app, SearchType.IN_VAULT).open();
				}),
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

	private runWhenSearchSearchable(callback: () => void | Promise<void>): void {
		const dataManager = getInstance(DataManager);
		if (dataManager.isSearchSearchable()) {
			void callback();
			return;
		}
		const noticeKey = dataManager.getSearchBootstrapNoticeKey();
		if (noticeKey) {
			new MyNotice(t(noticeKey), 2500);
		}
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
		this.handlers = [];
		this.register([CTRL], "J", EventEnum.NEXT_ITEM_FLOATING_WINDOW);
		this.register([CTRL], "K", EventEnum.PREV_ITEM_FLOATING_WINDOW);
	}
}

// non-singleton, create for each modal
export class ModalNavigationHotkeys extends AbstractNavigationHotkeys {
	constructor(scope: Scope) {
		super(scope);
	}

	registerAll(): void {
		this.register([CTRL], "J", EventEnum.NEXT_ITEM);
		this.register([CTRL], "K", EventEnum.PREV_ITEM);

		this.register([], "ArrowDown", EventEnum.NEXT_ITEM);
		this.register([], "ArrowUp", EventEnum.PREV_ITEM);
		this.register([], "Enter", EventEnum.CONFIRM_ITEM);
		this.register([CTRL], "R", EventEnum.TOGGLE_HISTORY_SUGGESTIONS);
		this.register([CTRL], "Enter", EventEnum.CONFIRM_ITEM_IN_BACKGROUND);
		this.register([CTRL], "N", EventEnum.NEXT_SUB_ITEM);
		this.register([CTRL], "P", EventEnum.PREV_SUB_ITEM);
		this.register([ALT], "I", EventEnum.INSERT_FILE_LINK);
	}
}
