import type { TAbstractFile, TFile } from "obsidian";
import { EventEnum } from "src/globals/enums";
import { Database } from "src/services/database/database";
import { LexicalEngine } from "src/services/search/search-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import { SHOULD_NOT_HAPPEN, getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataProvider } from "./data-provider";

@singleton()
export class DataManager {
    private database = getInstance(Database);
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

    @monitorDecorator
	async initAsync() {
        await this.initLexicalEngines();
		// don't need to eventBus.off because the life cycle of this singleton is the same with eventBus
		eventBus.on(EventEnum.MODAL_OPEN, () =>
			this.docOperationsBuffer.flush(),
		);
	}

	receiveDocOperation(operation: DocOperation) {
		this.docOperationsBuffer.add(operation);
	}

	private async addDocument(file: TAbstractFile) {
		if (this.dataProvider.shouldIndex(file)) {
			const document = (
				await this.dataProvider.generateAllIndexedDocuments([
					file as TFile,
				])
			)[0];
			this.lexicalEngine.addAllDocuments([document]);
		}
	}

	private async deleteDocument(path: string) {
		if (this.dataProvider.shouldIndex(path)) {
			this.lexicalEngine.deleteAllDocuments([path]);
		}
	}


	private async initLexicalEngines() {
		logger.trace("Init lexical engine...");
		const prevData = await this.database.getMiniSearchData();
		if (prevData) {
			logger.trace("Previous minisearch data is found.");
			this.lexicalEngine.reIndexAll(prevData);
		} else {
			logger.trace(
				"Previous minisearch data doesn't exists, reading files via obsidian...",
			);
			const filesToIndex = this.dataProvider.allFilesToBeIndexed();
			const documents =
				await this.dataProvider.generateAllIndexedDocuments(
					filesToIndex,
				);
			await this.lexicalEngine.reIndexAll(documents);
		}
		logger.trace("Lexical engine is ready");
        // serialize lexical engine
        await this.database.setMiniSearchData(this.lexicalEngine.filesIndex.toJSON());
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
