import { App, TAbstractFile, TFile } from "obsidian";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataManager } from "./data-manager";
import {
	DocDeleteOperation,
	DocMoveOperation,
	DocUpsertOperation,
} from "./doc-operation-buffer";

@singleton()
export class FileWatcher {
	private readonly dataManager = getInstance(DataManager);
	private readonly app = getInstance(App);
	private modifyTimers: Map<string, NodeJS.Timeout> = new Map();

	start() {
		this.stop(); // in case THIS_PLUGIN.onunload isn't called correctly, sometimes it happens
		this.app.vault.on("create", this.onCreate);
		this.app.vault.on("delete", this.onDelete);
		this.app.vault.on("rename", this.onRename);
		this.app.vault.on("modify", this.onModify);
		logger.trace("FileWatcher started");
	}

	stop() {
		this.app.vault.off("create", this.onCreate);
		this.app.vault.off("delete", this.onDelete);
		this.app.vault.off("rename", this.onRename);
		this.app.vault.off("modify", this.onModify);
		this.clearAllModifyTimers();
	}

	// should define callbacks as arrow functions rather than methods,
	// otherwise `this` will be changed when used as callbacks
	private readonly onCreate = (file: TAbstractFile) => {
		logger.debug(`created: ${file.path}`);
		this.dataManager.receiveDocOperation(new DocUpsertOperation(file.path));
	};

	private readonly onDelete = (file: TAbstractFile) => {
		logger.debug(`deleted: ${file.path}`);
		this.dataManager.receiveDocOperation(new DocDeleteOperation(file.path));
	};

	private readonly onRename = (file: TAbstractFile, oldPath: string) => {
		logger.debug(`renamed: ${oldPath} => ${file.path}`);
		this.dataManager.receiveDocOperation(
			new DocMoveOperation(oldPath, file.path),
		);
	};

	// Debounce modify events and always re-read the latest file state at flush time.
	private readonly onModify = (file: TAbstractFile) => {
		if (!(file instanceof TFile)) return;

		const path = file.path;
		this.clearModifyTimer(path);

		const timer = setTimeout(() => {
			const currentFile = this.app.vault.getAbstractFileByPath(path);
			if (currentFile instanceof TFile) {
				this.dataManager.receiveDocOperation(new DocUpsertOperation(path));
			}
			this.modifyTimers.delete(path);
		}, 800);

		this.modifyTimers.set(path, timer);
	};

	private clearModifyTimer(path: string): void {
		const timer = this.modifyTimers.get(path);
		if (!timer) {
			return;
		}
		clearTimeout(timer);
		this.modifyTimers.delete(path);
	}

	private clearAllModifyTimers(): void {
		for (const timer of this.modifyTimers.values()) {
			clearTimeout(timer);
		}
		this.modifyTimers.clear();
	}
}
