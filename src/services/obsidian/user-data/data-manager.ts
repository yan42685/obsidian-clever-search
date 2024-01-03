import type { TAbstractFile, TFile } from "obsidian";
import { EventEnum } from "src/globals/enums";
import { LexicalEngine } from "src/services/search/search-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { SHOULD_NOT_HAPPEN, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataProvider } from "./data-provider";

@singleton()
export class DataManager {
	private dataProvider = getInstance(DataProvider);
	private lexicalEngine = getInstance(LexicalEngine);

	private docOperationsHandler = async (operations: DocOperation[]) => {
		operations.sort((a, b) => a.time - b.time);
		for (const op of operations) {
			if (op instanceof DocAddOperation) {
				await this.addDocument(op.file);
			} else if (op instanceof DocDeleteOperation) {
				await this.deleteDocument(op.path);
			} else {
				throw Error(SHOULD_NOT_HAPPEN);
			}
		}
	};
    // help avoid unnecessary add or delete operations
	private docOperationsBuffer = new BufferSet<DocOperation>(
		this.docOperationsHandler,
		(op) => op.path + op.type,
		3,
	);

	async initAsync() {
		// don't need to eventBus.off because the life cycle of this singleton is the same with eventBus
		eventBus.on(EventEnum.MODAL_OPEN, () =>
			this.docOperationsBuffer.flush(),
		);
	}

	receiveDocOperation(operation: DocOperation) {
		this.docOperationsBuffer.add(operation);
	}

	async addDocument(file: TAbstractFile) {
		if (this.dataProvider.shouldIndex(file)) {
			const document = (
				await this.dataProvider.generateAllIndexedDocuments([
					file as TFile,
				])
			)[0];
			this.lexicalEngine.addAllDocuments([document]);
		}
	}

	async deleteDocument(path: string) {
		if (this.dataProvider.shouldIndex(path)) {
			this.lexicalEngine.deleteAllDocuments([path]);
		}
	}

	// TODO: do not use debounce because when a filename changed, all back links will be changed
	async updateDocument(file: TAbstractFile, oldPath: string) {
		if (this.dataProvider.shouldIndex(file)) {
			await this.deleteDocument(oldPath);
			await this.addDocument(file);
		}
	}
}

abstract class DocOperation {
	readonly type: "add" | "delete";
	readonly path: string;
	readonly time: number = performance.now();
	constructor(type: "add" | "delete", fileOrPath: string | TAbstractFile) {
		this.type = type;
		if (typeof fileOrPath === "string") {
			this.path = fileOrPath;
		} else {
			this.path = fileOrPath.path;
		}
	}
}

export class DocAddOperation extends DocOperation {
	readonly file: TAbstractFile;
	constructor(file: TAbstractFile) {
		super("add", file);
		this.file = file;
	}
}

export class DocDeleteOperation extends DocOperation {
	constructor(path: string) {
		super("delete", path);
	}
}
