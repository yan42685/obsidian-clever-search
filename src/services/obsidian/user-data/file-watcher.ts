import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataManager } from "./data-manager";
import { DataProvider } from "./data-provider";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import {
	DocDeleteOperation,
	DocMoveOperation,
	DocUpsertOperation,
} from "./doc-operation-buffer";

@singleton()
export class FileWatcher {
	private readonly dataManager = getInstance(DataManager);
	private readonly dataProvider = getInstance(DataProvider);
	private readonly fileSnapshotStore = getInstance(FileSnapshotStore);
	private readonly app = getInstance(App);
	private modifyTimers: Map<string, NodeJS.Timeout> = new Map();
	private compositionActive = false;
	private started = false;

	start() {
		if (this.started) {
			return;
		}
		this.started = true;
		this.app.vault.on("create", this.onCreate);
		this.app.vault.on("delete", this.onDelete);
		this.app.vault.on("rename", this.onRename);
		this.app.vault.on("modify", this.onModify);
		if (typeof document !== "undefined") {
			document.addEventListener("compositionstart", this.onCompositionStart, true);
			document.addEventListener("compositionend", this.onCompositionEnd, true);
		}
		logger.trace("FileWatcher started");
	}

	stop() {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.app.vault.off("create", this.onCreate);
		this.app.vault.off("delete", this.onDelete);
		this.app.vault.off("rename", this.onRename);
		this.app.vault.off("modify", this.onModify);
		if (typeof document !== "undefined") {
			document.removeEventListener("compositionstart", this.onCompositionStart, true);
			document.removeEventListener("compositionend", this.onCompositionEnd, true);
		}
		this.compositionActive = false;
		this.clearAllModifyTimers();
	}

	async flushPendingModifications(): Promise<void> {
		const pendingPaths = Array.from(this.modifyTimers.keys());
		if (pendingPaths.length === 0) {
			return;
		}

		for (const path of pendingPaths) {
			this.clearModifyTimer(path);
		}

		for (const path of pendingPaths) {
			const currentFile = this.app.vault.getAbstractFileByPath(path);
			if (currentFile instanceof TFile) {
				await this.enqueuePrimedUpsert(currentFile);
			}
		}
	}

	// should define callbacks as arrow functions rather than methods,
	// otherwise `this` will be changed when used as callbacks
	private readonly onCreate = (file: TAbstractFile) => {
		logger.debug(`created: ${file.path}`);
		if (file instanceof TFile) {
			void this.enqueuePrimedUpsert(file);
			return;
		}
		this.dataManager.receiveDocOperation(new DocUpsertOperation(file.path));
	};

	private readonly onDelete = (file: TAbstractFile) => {
		logger.debug(`deleted: ${file.path}`);
		this.dataManager.receiveDocOperation(new DocDeleteOperation(file.path));
	};

	private readonly onRename = async (file: TAbstractFile, oldPath: string) => {
		logger.debug(`renamed: ${oldPath} => ${file.path}`);
		if (file instanceof TFile) {
			await this.enqueuePrimedMove(oldPath, file);
			return;
		}
		if (file instanceof TFolder) {
			for (const descendant of this.collectDescendantFiles(file)) {
				const relativePath = descendant.path.slice(file.path.length + 1);
				const oldDescendantPath = `${oldPath}/${relativePath}`;
				this.clearModifyTimer(oldDescendantPath);
				this.clearModifyTimer(descendant.path);
				await this.enqueuePrimedMove(oldDescendantPath, descendant);
			}
		}
	};

	private collectDescendantFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectDescendantFiles(child));
			}
		}
		return files;
	}

	// Debounce modify events and always re-read the latest file state at flush time.
	private readonly onModify = (file: TAbstractFile) => {
		if (!(file instanceof TFile)) return;

		const path = file.path;
		this.scheduleModifyTimer(path, 800);
	};

	private readonly onCompositionStart = () => {
		this.compositionActive = true;
	};

	private readonly onCompositionEnd = () => {
		this.compositionActive = false;
	};

	private scheduleModifyTimer(path: string, delayMs: number): void {
		this.clearModifyTimer(path);
		const timer = setTimeout(() => {
			if (this.compositionActive) {
				this.scheduleModifyTimer(path, 100);
				return;
			}
			const currentFile = this.app.vault.getAbstractFileByPath(path);
			if (currentFile instanceof TFile) {
				void this.enqueuePrimedUpsert(currentFile);
			}
			this.modifyTimers.delete(path);
		}, delayMs);
		this.modifyTimers.set(path, timer);
	}

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

	private async enqueuePrimedUpsert(file: TFile): Promise<void> {
		if (!this.dataProvider.isIndexable(file)) {
			this.dataManager.receiveDocOperation(
				new DocUpsertOperation(file.path, file.stat.mtime),
			);
			return;
		}
		const sourceGeneration = await this.primeCurrentFileText(file);
		this.dataManager.receiveDocOperation(
			new DocUpsertOperation(file.path, sourceGeneration),
		);
	}

	private async enqueuePrimedMove(oldPath: string, file: TFile): Promise<void> {
		if (!this.dataProvider.isIndexable(file)) {
			this.dataManager.receiveDocOperation(
				new DocMoveOperation(oldPath, file.path, file.stat.mtime),
			);
			return;
		}
		const sourceGeneration = await this.primeCurrentFileText(file);
		this.dataManager.receiveDocOperation(
			new DocMoveOperation(oldPath, file.path, sourceGeneration),
		);
	}

	private async primeCurrentFileText(file: TFile): Promise<number> {
		while (true) {
			const sourcePath = file.path;
			const sourceGeneration = file.stat.mtime;
			try {
				await this.fileSnapshotStore.readCurrentTexts([file]);
			} catch (error) {
				logger.warn(`failed to prime current file text for ${file.path}:`, error);
				return sourceGeneration;
			}
			if (file.path === sourcePath && file.stat.mtime === sourceGeneration) {
				return sourceGeneration;
			}
		}
	}
}
