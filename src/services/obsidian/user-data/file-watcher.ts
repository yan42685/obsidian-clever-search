import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataManager, DocAddOperation, DocDeleteOperation } from "./data-manager";
import { App, TAbstractFile } from "obsidian";
import { logger } from "src/utils/logger";

@singleton()
export class FileWatcher {
	private readonly dataManager = getInstance(DataManager);
	private readonly app = getInstance(App);

	start() {
		this.stop(); // in case THIS_PLUGIN.onunload isn't called correctly, sometimes it happens
		this.app.vault.on("create", this.onCreate);
		this.app.vault.on("delete", this.onDelete);
		this.app.vault.on("rename", this.onRename);
		this.app.vault.on("modify", this.onModify);
		logger.debug("FileWatcher started");
	}

	stop() {
		this.app.vault.off("create", this.onCreate);
		this.app.vault.off("delete", this.onDelete);
		this.app.vault.off("rename", this.onRename);
		this.app.vault.off("modify", this.onModify);
	}

	// should define callbacks as arrow functions rather than methods,
	// otherwise `this` will be changed when used as callbacks
	private readonly onCreate = (file: TAbstractFile) => {
		logger.debug(`created: ${file.path}`);
		this.dataManager.receiveDocOperation(new DocAddOperation(file));
	};
	private readonly onDelete = (file: TAbstractFile) => {
		logger.debug(`deleted: ${file.path}`);
		this.dataManager.receiveDocOperation(new DocDeleteOperation(file.path));
	};
	private readonly onRename = (file: TAbstractFile, oldPath: string) => {
		logger.debug(`renamed: ${oldPath} => ${file.path}`);
		this.dataManager.receiveDocOperation(new DocDeleteOperation(oldPath));
		this.dataManager.receiveDocOperation(new DocAddOperation(file));
	};
	private readonly onModify = (file: TAbstractFile) => {
		logger.debug(`modified: ${file.path}`);
		this.dataManager.receiveDocOperation(new DocDeleteOperation(file.path));
		this.dataManager.receiveDocOperation(new DocAddOperation(file));
	};

}