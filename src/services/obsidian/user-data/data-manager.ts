import type { AsPlainObject } from "minisearch";
import type { TAbstractFile, TFile } from "obsidian";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import type { DocumentRef } from "src/globals/search-types";
import { Database } from "src/services/database/database";
import { LexicalEngine } from "src/services/search/lexical-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import {
	SHOULD_NOT_HAPPEN,
	getInstance,
	monitorDecorator,
} from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { MyNotice } from "../transformed-api";
import { t } from "../translations/locale-helper";
import { DataProvider } from "./data-provider";
import { FileWatcher } from "./file-watcher";

@singleton()
export class DataManager {
	private database = getInstance(Database);
	private dataProvider = getInstance(DataProvider);
	private lexicalEngine = getInstance(LexicalEngine);
	private shouldForceRefresh = false;
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
		// TODO: delete old version databases
		await this.initLexicalEngines();
		await this.updateDocRefsByMtime();

		if (!this.shouldForceRefresh) {
			// don't need to eventBus.off because the life cycle of this singleton is the same with eventBus
			eventBus.on(EventEnum.IN_VAULT_SEARCH, () =>
				this.docOperationsBuffer.forceFlush(),
			);
			getInstance(FileWatcher).start();
		}

		// serialize lexical engine
		await this.database.setMiniSearchData(
			this.lexicalEngine.filesIndex.toJSON(),
		);
	}

	onunload() {
		getInstance(FileWatcher).stop();
	}

	receiveDocOperation(operation: DocOperation) {
		this.docOperationsBuffer.add(operation);
	}

	async refreshAllAsync() {
		const prevNotice = new MyNotice(t("Reindexing..."));
		this.shouldForceRefresh = true;
		await this.initAsync();
		prevNotice.hide();
		new MyNotice(t("Indexing finished"), 5000);
		this.shouldForceRefresh = false;
	}

	private async addDocuments(files: TAbstractFile[]) {
		const documents = await this.dataProvider.generateAllIndexedDocuments(
			files.filter((f) => this.dataProvider.isIndexable(f)) as TFile[],
		);
		await this.lexicalEngine.addDocuments(documents);
	}

	private async deleteDocuments(paths: string[]) {
		this.lexicalEngine.deleteDocuments(
			paths.filter((p) => this.dataProvider.isIndexable(p)),
		);
	}

	private async initLexicalEngines() {
		logger.trace("Init lexical engine...");
		let prevData: AsPlainObject | null;
		if (!devOption.loadIndexFromDatabase || this.shouldForceRefresh) {
			prevData = null;
		} else {
			prevData = await this.database.getMiniSearchData();
		}
		if (prevData) {
			this.database.deleteMinisearchData(); // for minisearch update
			logger.trace("Previous minisearch data is found.");
			const isSuccessful = await this.lexicalEngine.reIndexAll(prevData);
			if (!isSuccessful) {
				new MyNotice(
					t("Database has been updated, a reindex is required"),
					7000,
				);
				await this.reindexLexicalEngineWithCurrFiles();
			}
		} else {
			await this.reindexLexicalEngineWithCurrFiles();
		}
		logger.trace("Lexical engine is ready");
	}

	private async reindexLexicalEngineWithCurrFiles() {
		logger.trace("Indexing the whole vault...");
		const filesToIndex = this.dataProvider.allFilesToBeIndexed();
		let size = 0;
		for (const file of filesToIndex) {
			size += file.stat.size;
		}
		size /= 1024;
		if (size > 2000) {
			const sizeText = (size / 1024).toFixed(2) + " MB";
			new MyNotice(
				`${sizeText} ${t(
					"files need to be indexed. Obsidian may freeze for a while",
				)}`,
				7000,
			);
		}
		const documents =
			await this.dataProvider.generateAllIndexedDocuments(filesToIndex);
		await this.lexicalEngine.reIndexAll(documents);
		this.isLexicalEngineUpToDate = true;
	}

	// use case: users have changed files without obsidian open. so we need to update the index and refs
	private async updateDocRefsByMtime() {
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

			for (const [path, file] of currFiles) {
				const prevRef = prevRefs.get(path);
				if (!prevRef) {
					// to add
					docsToAdd.push(file);
				} else if (file.stat.mtime > prevRef.lexicalMtime) {
					// to update
					docsToDelete.push(file.path);
					docsToAdd.push(file);
				}
			}

			// to delete
			for (const prevPath of prevRefs.keys()) {
				if (!currFiles.has(prevPath)) {
					docsToDelete.push(prevPath);
				}
			}

			// perform batch delete and add operations
			logger.trace(`docs to delete: ${docsToDelete.length}`);
			logger.trace(`docs to add: ${docsToAdd.length}`);
			await this.deleteDocuments(docsToDelete);
			await this.addDocuments(docsToAdd);

			// update the document refs in the database
			const updatedRefs = Array.from(currFiles.values()).map((file) => ({
				path: file.path,
				lexicalMtime: file.stat.mtime,
				// TODO: finish this for semantic engine
				embeddingMtime: file.stat.mtime,
			}));
			this.database.setDocumentRefs(updatedRefs);
			logger.trace(`${updatedRefs.length} doc refs updated`);

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
