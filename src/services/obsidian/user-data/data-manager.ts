import type { TAbstractFile, TFile } from "obsidian";
import { EventEnum } from "src/globals/enums";
import type { DocumentRef } from "src/globals/search-types";
import { Database } from "src/services/database/database";
import { LexicalEngine } from "src/services/search/search-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import {
	SHOULD_NOT_HAPPEN,
	getInstance,
	monitorDecorator,
} from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataProvider } from "./data-provider";

@singleton()
export class DataManager {
	private database = getInstance(Database);
	private dataProvider = getInstance(DataProvider);
	private lexicalEngine = getInstance(LexicalEngine);
	private isLexicalEngineUpToDate = false;

	private docOperationsHandler = async (operations: DocOperation[]) => {
		operations.sort((a, b) => a.time - b.time);
		for (const op of operations) {
			if (op instanceof DocAddOperation) {
				await this.addDocuments([op.file]);
			} else if (op instanceof DocDeleteOperation) {
				await this.deleteDocuments([op.path]);
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

		await this.updateIndexDataByMtime();

		// serialize lexical engine
		await this.database.setMiniSearchData(
			this.lexicalEngine.filesIndex.toJSON(),
		);
	}

	receiveDocOperation(operation: DocOperation) {
		this.docOperationsBuffer.add(operation);
	}

	private async addDocuments(files: TAbstractFile[]) {
		const documents = await this.dataProvider.generateAllIndexedDocuments(
			files.filter((f) => this.dataProvider.shouldIndex(f)) as TFile[],
		);
		await this.lexicalEngine.addDocuments(documents);
	}

	private async deleteDocuments(paths: string[]) {
		this.lexicalEngine.deleteDocuments(
			paths.filter((p) => this.dataProvider.shouldIndex(p)),
		);
	}

	private async initLexicalEngines() {
		logger.trace("Init lexical engine...");
		const prevData = await this.database.getMiniSearchData();
		if (prevData) {
			logger.trace("Previous minisearch data is found.");
			await this.lexicalEngine.reIndexAll(prevData);
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
			this.isLexicalEngineUpToDate = true;
		}
		logger.trace("Lexical engine is ready");
	}

    // use case: users have changed files without obsidian open. so we need to update the index
	private async updateIndexDataByMtime() {
		// update index data based on file modification time
        // TODO: for semantic engine
		if (!this.isLexicalEngineUpToDate) {
			const currFiles = new Map<string, TFile>(
				this.dataProvider
					.allFilesToBeIndexed()
					.map((file) => [file.path, file]),
			);
			const prevRefs = new Map<string, DocumentRef>(
				(await this.database.getDocumentRefs())?.map((ref) => [
					ref.path,
					ref,
				]),
			);

			const docsToAdd: TAbstractFile[] = [];
			const docsToDelete: string[] = [];

			// identify docs to add or update
			for (const [path, file] of currFiles) {
				const prevRef = prevRefs.get(path);
				if (!prevRef || file.stat.mtime > prevRef.lexicalMtime) {
					docsToAdd.push(file);
				}
			}

			// identify docs to delete
			for (const prevRef of prevRefs.keys()) {
				if (!currFiles.has(prevRef)) {
					docsToDelete.push(prevRef);
				}
			}

			// perform batch delete and add operations
            logger.trace(`docs to add: ${docsToAdd.length}`);
            logger.trace(`docs to delete: ${docsToDelete.length}`);
			await this.addDocuments(docsToAdd);
			await this.deleteDocuments(docsToDelete);

			// update the document refs in the database
			const updatedRefs = Array.from(currFiles.values()).map((file) => ({
				path: file.path,
				lexicalMtime: file.stat.mtime,
				embeddingMtime: file.stat.mtime, // assuming embeddingMtime should be updated as well
			}));
			this.database.setDocumentRefs(updatedRefs);

			this.isLexicalEngineUpToDate = true;
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
