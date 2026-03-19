import type { AsPlainObject } from "minisearch";
import { TFile, type TAbstractFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import type { DocumentRef } from "src/globals/search-types";
import type CleverSearch from "src/main";
import { Database } from "src/services/database/database";
import { LexicalEngine } from "src/services/search/lexical-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import { getInstance, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { MyNotice } from "../transformed-api";
import { t } from "../translations/locale-helper";
import { SearchService } from "../search-service";
import { DataProvider } from "./data-provider";
import { FileWatcher } from "./file-watcher";

@singleton()
export class DataManager {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private database = getInstance(Database);
	private dataProvider = getInstance(DataProvider);
	private lexicalEngine = getInstance(LexicalEngine);
	private shouldForceRefresh = false;
	private isLexicalEngineUpToDate = false;

	private get hybridEngine() {
		return getInstance(SearchService).hybridEngine;
	}

	private docOperationsHandler = async (operations: DocOperation[]) => {
		for (const op of operations) {
			if (op instanceof DocDeleteOperation) {
				await this.deleteDocuments([op.path]);
				if (this.hybridEngine.isEnabled()) {
					await this.hybridEngine.deleteFile(op.path);
				}
			} else if (op instanceof DocAddOperation) {
				await this.addDocuments([op.file]);
				if (
					this.hybridEngine.isEnabled() &&
					op.file instanceof TFile &&
					this.dataProvider.isIndexable(op.file) &&
					this.hybridEngine.shouldIndexPath(op.file.path)
				) {
					const text = await this.dataProvider.readPlainText(op.file.path);
					await this.hybridEngine.indexFile(op.file.path, text, op.file.stat.mtime).catch(e => logger.warn("hybrid indexFile failed:", e));
				}
			}
		}
	};

	private docOperationsBuffer = new BufferSet<DocOperation>(
		this.docOperationsHandler,
		(op) => op.path,
		3,
	);

	@monitorDecorator
	async initAsync() {
		await this.database.deleteOldDatabases();
		await this.initLexicalEngine();
		await this.initHybridEngine().catch((e) => {
			logger.warn("hybrid engine init failed:", e);
			new MyNotice(t("hybridNotice.indexFallbackToBm25"), 7000);
		});

		if (!this.shouldForceRefresh) {
			eventBus.on(EventEnum.IN_VAULT_SEARCH, () =>
				this.docOperationsBuffer.forceFlush(),
			);
			getInstance(FileWatcher).start();
		}
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
		getInstance(FileWatcher).stop();
		try {
			await this.initAsync();
			new MyNotice(t("Indexing finished"), 5000);
		} finally {
			prevNotice.hide();
			this.shouldForceRefresh = false;
			getInstance(FileWatcher).start();
		}
	}

	private async addDocuments(files: TAbstractFile[]) {
		if (files.length > 0) {
			const tFiles: TFile[] = [];
			for (const f of files) {
				if (f instanceof TFile) tFiles.push(f);
			}
			const documents = await this.dataProvider.generateAllIndexedDocuments(
				tFiles.filter((f) => this.dataProvider.isIndexable(f)),
			);
			await this.lexicalEngine.addDocuments(documents);
		}
	}

	private async deleteDocuments(paths: string[]) {
		if (paths.length > 0) {
			const indexablePaths = paths.filter((p) => this.dataProvider.isIndexable(p));
			this.lexicalEngine.deleteDocuments(indexablePaths);
		}
	}

	private async initLexicalEngine() {
		logger.trace("Init lexical engine...");
		let prevData: AsPlainObject | null;
		if (!devOption.loadIndexFromDatabase || this.shouldForceRefresh) {
			prevData = null;
		} else {
			prevData = await this.database.getMiniSearchData();
		}
		if (prevData) {
			this.database.deleteMinisearchData();
			logger.trace("Previous minisearch data is found.");
			const isSuccessful = await this.lexicalEngine.reIndexAll(prevData);
			if (!isSuccessful) {
				new MyNotice(t("Database has been updated, a reindex is required"), 7000);
				await this.reindexLexicalEngineWithCurrFiles();
			}
		} else {
			await this.reindexLexicalEngineWithCurrFiles();
		}
		if (!this.isLexicalEngineUpToDate) {
			await this.updateDocRefByMtime();
		}
		logger.trace("Lexical engine is ready");
		await this.database.setMiniSearchData(this.lexicalEngine.filesIndex.toJSON());
	}

	private async initHybridEngine() {
		if (!this.hybridEngine.isEnabled()) {
			return;
		}

		if (this.shouldForceRefresh) {
			await this.hybridEngine.clearAll();
		}

		await this.hybridEngine.load();
		const currFiles = new Map<string, TFile>(
			this.dataProvider
				.allFilesToBeIndexed()
				.filter((file) => this.hybridEngine.shouldIndexPath(file.path))
				.map((file) => [file.path, file]),
		);
		const prevRefs = new Map(
			(await this.database.db.hybridDocRefs.toArray()).map((ref) => [
				ref.path,
				ref,
			]),
		);

		const docsToAdd: TFile[] = [];
		const docsToDelete: string[] = [];

		for (const [path, file] of currFiles) {
			const prevRef = prevRefs.get(path);
			if (!prevRef) {
				docsToAdd.push(file);
			} else if (file.stat.mtime > prevRef.updateTime) {
				docsToDelete.push(path);
				docsToAdd.push(file);
			}
		}

		for (const prevPath of prevRefs.keys()) {
			if (!currFiles.has(prevPath)) {
				docsToDelete.push(prevPath);
			}
		}

		logger.trace(`hybrid docs to delete: ${docsToDelete.length}`);
		logger.trace(`hybrid docs to add: ${docsToAdd.length}`);

		for (const path of docsToDelete) {
			await this.hybridEngine.deleteFile(path).catch((e) =>
				logger.warn(`hybrid deleteFile failed for ${path}:`, e),
			);
		}
		for (const file of docsToAdd) {
			const text = await this.dataProvider.readPlainText(file.path);
			await this.hybridEngine.indexFile(file.path, text, file.stat.mtime).catch((e) =>
				logger.warn(`hybrid indexFile failed for ${file.path}:`, e),
			);
		}
		const fallbackNoticeKey =
			this.hybridEngine.consumeIndexingFallbackNoticeKey();
		if (fallbackNoticeKey) {
			new MyNotice(t(fallbackNoticeKey), 7000);
		}
	}

	private async reindexLexicalEngineWithCurrFiles() {
		logger.trace("Indexing the whole vault...");
		const filesToIndex = this.dataProvider.allFilesToBeIndexed();
		let size = 0;
		for (const file of filesToIndex) size += file.stat.size;
		size /= 1024;
		if (size > 2000) {
			const sizeText = (size / 1024).toFixed(2) + " MB";
			new MyNotice(`${sizeText} ${t("files need to be indexed. Obsidian may freeze for a while")}`, 7000);
		}
		const documents = await this.dataProvider.generateAllIndexedDocuments(filesToIndex);
		await this.lexicalEngine.reIndexAll(documents);
		await this.saveLexicalDocRefs(filesToIndex);
		this.isLexicalEngineUpToDate = true;
	}

	private async updateDocRefByMtime() {
		const currFiles = new Map<string, TFile>(
			this.dataProvider.allFilesToBeIndexed().map((file) => [file.path, file]),
		);
		const preRefsList = await this.database.getLexicalDocRefs();
		const prevRefs = new Map<string, DocumentRef>(
			preRefsList?.map((ref) => [ref.path, ref]),
		);

		const docsToAdd: TAbstractFile[] = [];
		const docsToDelete: string[] = [];

		for (const [path, file] of currFiles) {
			const prevRef = prevRefs.get(path);
			if (!prevRef) {
				docsToAdd.push(file);
			} else if (file.stat.mtime > prevRef.updateTime) {
				docsToDelete.push(file.path);
				docsToAdd.push(file);
			}
		}
		for (const prevPath of prevRefs.keys()) {
			if (!currFiles.has(prevPath)) docsToDelete.push(prevPath);
		}

		logger.trace(`docs to delete: ${docsToDelete.length}`);
		logger.trace(`docs to add: ${docsToAdd.length}`);
		await this.deleteDocuments(docsToDelete);
		await this.addDocuments(docsToAdd);
		await this.saveLexicalDocRefs(Array.from(currFiles.values()));
	}

	private async saveLexicalDocRefs(files: TFile[]) {
		const updatedRefs = files.map((file) => ({ path: file.path, updateTime: file.stat.mtime }));
		await this.database.setLexicalDocRefs(updatedRefs);
		logger.trace(`${updatedRefs.length} lexical refs updated`);
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
