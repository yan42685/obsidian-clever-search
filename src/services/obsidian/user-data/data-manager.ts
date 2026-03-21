import { TFile, type TAbstractFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { devOption } from "src/globals/dev-option";
import { EventEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import type { DocumentRef } from "src/globals/search-types";
import type CleverSearch from "src/main";
import { Database } from "src/services/database/database";
import {
	HybridDisabledError,
	NoApiKeyError,
	WeeklyTokenLimitExceededError,
} from "src/services/search/hybrid/embedder";
import { LexicalEngine } from "src/services/search/lexical-engine";
import type { SerializedFileSearchIndex } from "src/services/search/file-search-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import { MyLib, getInstance, isDevEnvironment, monitorDecorator } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { MyNotice } from "../transformed-api";
import { t } from "../translations/locale-helper";
import { SearchService } from "../search-service";
import { DataProvider } from "./data-provider";
import { FileWatcher } from "./file-watcher";

type HybridIndexFailure = {
	path: string;
	reason: string;
	attempts: number;
	bm25FallbackIndexed: boolean;
};

@singleton()
export class DataManager {
	private static readonly HYBRID_INDEX_MAX_RETRIES = 3;
	private static readonly HYBRID_INDEX_RETRY_DELAY_MS = 1500;
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private database = getInstance(Database);
	private dataProvider = getInstance(DataProvider);
	private setting = getInstance(OuterSetting);
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
					const failure = await this.indexHybridFileWithRetry(op.file);
					if (failure) {
						this.noticeHybridIndexFailures([failure]);
					}
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
		if (!this.hybridEngine.isEnabled()) {
			await this.hybridEngine.migrateBm25StorageFormatIfNeeded().catch((e) => {
				logger.warn("hybrid BM25 storage migration failed:", e);
			});
		}
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

		if (isDevEnvironment) {
			await this.noticeDevStorageStats();
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
		let prevData: SerializedFileSearchIndex | null;
		if (
			!devOption.loadIndexFromDatabase ||
			this.shouldForceRefresh ||
			!this.lexicalEngine.supportsSerializedFileIndex()
		) {
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
		const lexicalIndexData = this.lexicalEngine.serializeFileIndex();
		if (lexicalIndexData) {
			await this.database.setMiniSearchData(lexicalIndexData);
		}
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
		const hybridIndexStart = Date.now();
		const concurrency = this.getHybridIndexConcurrency();
		logger.debug(
			`hybrid batch start: delete=${docsToDelete.length}, add=${docsToAdd.length}, concurrency=${concurrency}`,
		);

		for (const path of docsToDelete) {
			await this.hybridEngine.deleteFile(path, { persistIndices: false }).catch((e) =>
				logger.warn(`hybrid deleteFile failed for ${path}:`, e),
			);
		}
		const failures: HybridIndexFailure[] = [];
		await this.processFilesWithConcurrency(
			docsToAdd,
			concurrency,
			async (file) => {
				const failure = await this.indexHybridFileWithRetry(file);
				if (failure) {
					failures.push(failure);
				}
			},
		);
		await this.hybridEngine.persistIndicesForBatch();
		const fallbackNoticeKey =
			this.hybridEngine.consumeIndexingFallbackNoticeKey();
		if (failures.length > 0) {
			this.noticeHybridIndexFailures(failures);
		} else if (fallbackNoticeKey) {
			new MyNotice(t(fallbackNoticeKey), 7000);
		}
		logger.debug(
			`hybrid batch finished in ${Date.now() - hybridIndexStart} ms, failures=${failures.length}, persisted=true`,
		);
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

	private async processFilesWithConcurrency<T>(
		items: T[],
		concurrency: number,
		handler: (item: T) => Promise<void>,
	) {
		if (items.length === 0) {
			return;
		}

		const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
		let nextIndex = 0;

		await Promise.all(
			Array.from({ length: safeConcurrency }, async () => {
				while (nextIndex < items.length) {
					const currentIndex = nextIndex++;
					await handler(items[currentIndex]);
				}
			}),
		);
	}

	private async indexHybridFileWithRetry(
		file: TFile,
	): Promise<HybridIndexFailure | null> {
		const fileIndexStart = Date.now();
		const text = await this.dataProvider.readPlainText(file.path);
		let lastError: unknown = null;
		let attempts = 0;

		for (
			let attempt = 1;
			attempt <= DataManager.HYBRID_INDEX_MAX_RETRIES;
			attempt++
		) {
			attempts = attempt;
			try {
				await this.hybridEngine.indexFileStrict(
					file.path,
					text,
					file.stat.mtime,
					{ persistIndices: false },
				);
				logger.debug(
					`hybrid indexed ${file.path} in ${Date.now() - fileIndexStart} ms after ${attempts} attempt(s)`,
				);
				return null;
			} catch (error) {
				lastError = error;
				const reason = this.formatHybridIndexError(error);
				const retryable = this.isRetryableHybridIndexError(error);
				logger.warn(
					`hybrid semantic index attempt ${attempt}/${DataManager.HYBRID_INDEX_MAX_RETRIES} failed for ${file.path}: ${reason}`,
				);
				if (
					!retryable ||
					attempt >= DataManager.HYBRID_INDEX_MAX_RETRIES
				) {
					break;
				}
				await MyLib.sleep(
					DataManager.HYBRID_INDEX_RETRY_DELAY_MS * attempt,
				);
			}
		}

		let bm25FallbackIndexed = false;
		try {
			await this.hybridEngine.indexFile(file.path, text, file.stat.mtime);
			bm25FallbackIndexed = true;
		} catch (fallbackError) {
			logger.error(
				`hybrid BM25 fallback indexing failed for ${file.path}:`,
				fallbackError,
			);
			if (lastError === null) {
				lastError = fallbackError;
			}
		}

		return {
			path: file.path,
			reason: this.formatHybridIndexError(lastError),
			attempts,
			bm25FallbackIndexed,
		};
	}

	private getHybridIndexConcurrency(): number {
		const configured = this.setting.hybrid.indexConcurrency ?? 3;
		return Math.max(1, Math.min(configured, 8));
	}

	private isRetryableHybridIndexError(error: unknown): boolean {
		if (
			error instanceof NoApiKeyError ||
			error instanceof WeeklyTokenLimitExceededError ||
			error instanceof HybridDisabledError
		) {
			return false;
		}

		if (!(error instanceof Error)) {
			return false;
		}

		const message = `${error.name}: ${error.message}`.toLowerCase();
		if (
			message.includes("insufficient_quota") ||
			message.includes("quota") ||
			message.includes("weekly token limit exceeded")
		) {
			return false;
		}

		const statusMatch = message.match(/embedding api error (\d{3})/);
		if (statusMatch) {
			const status = Number(statusMatch[1]);
			if (status === 408 || status === 409 || status === 425 || status === 429) {
				return true;
			}
			if (status >= 500) {
				return true;
			}
			return false;
		}

		return (
			error.name === "TypeError" ||
			message.includes("failed to fetch") ||
			message.includes("network") ||
			message.includes("timeout") ||
			message.includes("econn") ||
			message.includes("socket")
		);
	}

	private formatHybridIndexError(error: unknown): string {
		if (error instanceof Error) {
			return `${error.name}: ${error.message}`;
		}
		return String(error);
	}

	private noticeHybridIndexFailures(failures: HybridIndexFailure[]) {
		if (failures.length === 0) {
			return;
		}

		const failedWithoutBm25 = failures.filter(
			(item) => !item.bm25FallbackIndexed,
		).length;
		const message = this.buildHybridFailureNotice(
			failures.length,
			failedWithoutBm25,
		);
		new MyNotice(message, 12000);

		console.groupCollapsed(
			`[clever-search] Hybrid semantic indexing incomplete (${failures.length} files)`,
		);
		failures.forEach((failure) => {
			console.error(
				`[clever-search] ${failure.path}\nAttempts: ${failure.attempts}\nBM25 fallback indexed: ${failure.bm25FallbackIndexed}\nReason: ${failure.reason}`,
			);
		});
		console.groupEnd();
	}

	private buildHybridFailureNotice(
		failureCount: number,
		failedWithoutBm25: number,
	): string {
		const isChinese =
			(window.localStorage.getItem("language") || "")
				.toLowerCase()
				.startsWith("zh");
		if (isChinese) {
			const fallbackText =
				failedWithoutBm25 > 0
					? `，其中 ${failedWithoutBm25} 个文件连 BM25 降级索引也失败了`
					: "";
			return `由于网络或 token/额度等问题，${failureCount} 个文件在 ${DataManager.HYBRID_INDEX_MAX_RETRIES} 次尝试后仍未完成 embedding 索引${fallbackText}。按 Ctrl+Shift+I 在控制台查看具体原因。`;
		}

		const fallbackText =
			failedWithoutBm25 > 0
				? ` ${failedWithoutBm25} file(s) also failed BM25 fallback indexing.`
				: "";
		return `${failureCount} file(s) did not finish semantic embedding indexing after ${DataManager.HYBRID_INDEX_MAX_RETRIES} attempts due to network or quota/token issues.${fallbackText} Press Ctrl+Shift+I to view details in the console.`;
	}

	private async noticeDevStorageStats() {
		const indexableFiles = this.dataProvider.allFilesToBeIndexed();
		const indexableBytes = indexableFiles.reduce(
			(sum, file) => sum + file.stat.size,
			0,
		);
		const storageUsage = await this.database.estimatePluginStorageUsage();
		const bytesByName = new Map(
			storageUsage.tables.map((item) => [item.name, item.bytes]),
		);

		const lexicalFileIndexBytes = bytesByName.get("minisearch") ?? 0;
		const vectorShardBytes = bytesByName.get("hybridChunkVectors") ?? 0;
		const bm25Bytes = bytesByName.get("hybridBm25Index") ?? 0;
		const hnswBytes = bytesByName.get("hybridHnswSmall") ?? 0;
		const chunkStoreBytes = bytesByName.get("hybridChunks") ?? 0;
		const otherBytes = Math.max(
			0,
			storageUsage.totalBytes -
				lexicalFileIndexBytes -
				vectorShardBytes -
				bm25Bytes -
				hnswBytes -
				chunkStoreBytes,
		);
		const isChineseDevLocale =
			(window.localStorage.getItem("language") || "")
				.toLowerCase()
				.startsWith("zh");
		const localOnlyHint = isChineseDevLocale
			? "本次统计纯本地，不会调用 embedding/rerank API，不消耗 token"
			: "This report is local-only: no embedding API, no rerank API, no token usage.";

		new MyNotice(
			`${this.buildDevStorageNotice(
				indexableBytes,
				storageUsage.totalBytes,
				this.setting.hybrid.vectorCompression,
				lexicalFileIndexBytes,
				chunkStoreBytes,
				vectorShardBytes,
				bm25Bytes,
				hnswBytes,
				otherBytes,
			)}\n${localOnlyHint}`,
			15000,
		);

		console.groupCollapsed("[clever-search] 开发模式索引与存储统计");
		console.log(
			`可索引文件总大小: ${this.formatBytes(indexableBytes)}\n插件本地存储估算: ${this.formatBytes(storageUsage.totalBytes)}`,
		);
		console.table(
			storageUsage.tables
					.map((item) => ({
						table:
							item.name === "minisearch"
								? `lexicalFileIndex(${this.setting.fileSearchBackend})`
								: item.name,
						rows: item.rows,
						bytes: item.bytes,
					size: this.formatBytes(item.bytes),
				}))
				.sort((a, b) => b.bytes - a.bytes),
		);
		console.log(`[clever-search] ${localOnlyHint}`);
		if (storageUsage.hybridChunkBreakdown) {
			console.table([
				{
					segment: "chunk-text",
					bytes: storageUsage.hybridChunkBreakdown.textBytes,
					size: this.formatBytes(storageUsage.hybridChunkBreakdown.textBytes),
				},
				{
					segment: "chunk-metadata",
					bytes: storageUsage.hybridChunkBreakdown.metadataBytes,
					size: this.formatBytes(storageUsage.hybridChunkBreakdown.metadataBytes),
				},
			]);
		}
		if (storageUsage.hybridVectorBreakdown) {
			console.table([
				{
					segment: "vector-shard-ids",
					bytes: storageUsage.hybridVectorBreakdown.chunkIdBytes,
					size: this.formatBytes(storageUsage.hybridVectorBreakdown.chunkIdBytes),
				},
				{
					segment: "vector-shard-data",
					bytes: storageUsage.hybridVectorBreakdown.vectorBytes,
					size: this.formatBytes(storageUsage.hybridVectorBreakdown.vectorBytes),
				},
				{
					segment: "vector-shard-scale",
					bytes: storageUsage.hybridVectorBreakdown.scaleBytes,
					size: this.formatBytes(storageUsage.hybridVectorBreakdown.scaleBytes),
				},
				{
					segment: "vector-shard-metadata",
					bytes: storageUsage.hybridVectorBreakdown.metadataBytes,
					size: this.formatBytes(storageUsage.hybridVectorBreakdown.metadataBytes),
				},
			]);
		}
		if (storageUsage.hybridBm25Breakdown) {
			console.table([
				{
					segment: "bm25-header",
					bytes: storageUsage.hybridBm25Breakdown.headerBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.headerBytes),
				},
				{
					segment: "bm25-term-text",
					bytes: storageUsage.hybridBm25Breakdown.termTextBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.termTextBytes),
				},
				{
					segment: "bm25-term-meta",
					bytes: storageUsage.hybridBm25Breakdown.termMetaBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.termMetaBytes),
				},
				{
					segment: "bm25-posting-header",
					bytes: storageUsage.hybridBm25Breakdown.postingHeaderBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.postingHeaderBytes),
				},
				{
					segment: "bm25-posting-doc-delta",
					bytes: storageUsage.hybridBm25Breakdown.postingDocDeltaBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.postingDocDeltaBytes),
				},
				{
					segment: "bm25-posting-tfNorm",
					bytes: storageUsage.hybridBm25Breakdown.postingTfNormBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.postingTfNormBytes),
				},
				{
					segment: "bm25-posting-pos-count",
					bytes: storageUsage.hybridBm25Breakdown.postingPositionCountBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.postingPositionCountBytes),
				},
				{
					segment: "bm25-posting-pos-delta",
					bytes: storageUsage.hybridBm25Breakdown.postingPositionDeltaBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.postingPositionDeltaBytes),
				},
				{
					segment: "bm25-doc-lengths",
					bytes: storageUsage.hybridBm25Breakdown.docLengthsBytes,
					size: this.formatBytes(storageUsage.hybridBm25Breakdown.docLengthsBytes),
				},
			]);
			console.log(
				`[clever-search] HybridBM25 details: version=${storageUsage.hybridBm25Breakdown.version}, terms=${storageUsage.hybridBm25Breakdown.termCount}, postings=${storageUsage.hybridBm25Breakdown.postingCount}, postingsWithPositions=${storageUsage.hybridBm25Breakdown.postingsWithPositions}, termsWithPositions=${storageUsage.hybridBm25Breakdown.termsWithPositions}, positionValues=${storageUsage.hybridBm25Breakdown.positionValueCount}`,
			);
			console.table(storageUsage.hybridBm25Breakdown.topPositionHeavyTerms);
		}
		console.groupEnd();
	}

	private buildDevStorageNotice(
		indexableBytes: number,
		totalBytes: number,
		precision: string,
		lexicalFileIndexBytes: number,
		chunkStoreBytes: number,
		vectorShardBytes: number,
		bm25Bytes: number,
		hnswBytes: number,
		otherBytes: number,
	): string {
		const isChinese =
			(window.localStorage.getItem("language") || "")
				.toLowerCase()
				.startsWith("zh");

		if (isChinese) {
			return [
				`开发模式统计`,
				`可索引文件总大小: ${this.formatBytes(indexableBytes)}`,
				`当前向量量化: ${precision}`,
				`插件本地存储估算: ${this.formatBytes(totalBytes)}`,
				`LexicalFileIndex ${this.formatBytes(lexicalFileIndexBytes)} | HybridChunk ${this.formatBytes(chunkStoreBytes)} | VectorShard ${this.formatBytes(vectorShardBytes)} | HybridBM25 ${this.formatBytes(bm25Bytes)} | HybridHNSW ${this.formatBytes(hnswBytes)} | 其他 ${this.formatBytes(otherBytes)}`,
			].join("\n");
		}

		return [
			`Dev stats`,
			`Indexable vault size: ${this.formatBytes(indexableBytes)}`,
			`Current vector quantization: ${precision}`,
			`Estimated plugin storage: ${this.formatBytes(totalBytes)}`,
			`LexicalFileIndex ${this.formatBytes(lexicalFileIndexBytes)} | HybridChunk ${this.formatBytes(chunkStoreBytes)} | VectorShard ${this.formatBytes(vectorShardBytes)} | HybridBM25 ${this.formatBytes(bm25Bytes)} | HybridHNSW ${this.formatBytes(hnswBytes)} | Other ${this.formatBytes(otherBytes)}`,
		].join("\n");
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} B`;
		}

		const units = ["KB", "MB", "GB", "TB"];
		let value = bytes / 1024;
		let unitIndex = 0;

		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex++;
		}

		return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
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
