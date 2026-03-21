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
import {
	beginHybridProfile,
	endHybridProfile,
	getHybridProfileMetric,
	profileHybridStage,
	setHybridProfileMeta,
} from "src/services/search/hybrid/hybrid-profiler";
import { retryAsync, runWeightedTasks } from "src/services/search/hybrid/runtime-control";
import { LexicalEngine } from "src/services/search/lexical-engine";
import type { SerializedFileSearchIndex } from "src/services/search/file-search-engine";
import { BufferSet } from "src/utils/data-structure";
import { eventBus } from "src/utils/event-bus";
import { logger } from "src/utils/logger";
import { getInstance, isDevEnvironment, monitorDecorator } from "src/utils/my-lib";
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

type HybridPreflightReport = {
	totalBytes: number;
	filesToAdd: number;
	filesToDelete: number;
	largeFiles: TFile[];
	largestFile: TFile | null;
	estimatedHybridBytes: number;
	currentHybridBytes: number;
	projectedUsageRatio: number | null;
};

type HybridStorageRepairReport = {
	repairedPaths: string[];
	reindexedPaths: string[];
};

type HybridIndexProgress = {
	stage: "repair" | "index" | "done";
	totalBytes: number;
	totalFiles: number;
	processedBytes: number;
	processedFiles: number;
	repairedPaths: number;
	failedFiles: number;
	sessionTokens: number;
};

class HybridIndexProgressNotice {
	private readonly notice: MyNotice;
	private lastRenderAt = 0;

	constructor() {
		this.notice = new MyNotice("Hybrid indexing...", 0);
	}

	update(progress: HybridIndexProgress, force = false) {
		const now = Date.now();
		if (!force && now - this.lastRenderAt < 400) {
			return;
		}
		this.lastRenderAt = now;
		this.notice.setText(this.buildMessage(progress));
	}

	hide() {
		this.notice.hide();
	}

	private buildMessage(progress: HybridIndexProgress): string {
		if (progress.stage === "repair") {
			return `Hybrid self-healing: repaired ${progress.repairedPaths} file state(s). Preparing reindex... ${this.buildTokenLabel(progress.sessionTokens)}`;
		}
		if (progress.stage === "done") {
			if (progress.totalFiles === 0) {
				return `Hybrid self-healing finished: repaired ${progress.repairedPaths} file state(s), failed ${progress.failedFiles}. ${this.buildTokenLabel(progress.sessionTokens)}`;
			}
			return `Hybrid indexing finished: ${formatBytesLabel(progress.processedBytes)} / ${formatBytesLabel(progress.totalBytes)} (${progress.processedFiles}/${progress.totalFiles} files), repaired ${progress.repairedPaths}, failed ${progress.failedFiles}. ${this.buildTokenLabel(progress.sessionTokens)}`;
		}
		return `Hybrid indexing: ${formatBytesLabel(progress.processedBytes)} / ${formatBytesLabel(progress.totalBytes)} (${progress.processedFiles}/${progress.totalFiles} files), repaired ${progress.repairedPaths}, failed ${progress.failedFiles}. ${this.buildTokenLabel(progress.sessionTokens)}`;
	}

	private buildTokenLabel(tokens: number): string {
		return `Session tokens ${tokens}`;
	}
}

function formatBytesLabel(bytes: number): string {
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

@singleton()
export class DataManager {
	private static readonly HYBRID_INDEX_MAX_RETRIES = 3;
	private static readonly HYBRID_INDEX_RETRY_DELAY_MS = 1500;
	private static readonly HYBRID_LARGE_FILE_BYTES = 1024 * 1024;
	private static readonly HYBRID_PRECHECK_NOTICE_BYTES = 64 * 1024 * 1024;
	private static readonly HYBRID_QUOTA_WARN_RATIO = 0.7;
	private static readonly HYBRID_STORAGE_RATIO_FALLBACK = 1.6;
	private static readonly HYBRID_STORAGE_RATIO_MIN = 0.8;
	private static readonly HYBRID_STORAGE_RATIO_MAX = 4.0;
	private static readonly HYBRID_IN_FLIGHT_BYTES_BUDGET = 4 * 1024 * 1024;
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
		beginHybridProfile("hybrid-init", {
			forceRefresh: this.shouldForceRefresh ? 1 : 0,
		});

		try {
			if (this.shouldForceRefresh) {
				await profileHybridStage("startup.clear_all", async () => {
					await this.hybridEngine.clearAll();
				});
			}
			await profileHybridStage("startup.load_engine", async () => {
				await this.hybridEngine.load();
			});
			const currFiles = await profileHybridStage("startup.scan_indexable_files", async () =>
				new Map<string, TFile>(
					this.dataProvider
						.allFilesToBeIndexed()
						.filter((file) => this.hybridEngine.shouldIndexPath(file.path))
						.map((file) => [file.path, file]),
				),
			);
			const repairReport = await profileHybridStage(
				"startup.repair_stored_state",
				async () => await this.repairHybridStoredState(currFiles),
			);
			const prevRefs = new Map(
				(await this.database.db.hybridDocRefs.toArray()).map((ref) => [ref.path, ref]),
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
			for (const reindexPath of repairReport.reindexedPaths) {
				const file = currFiles.get(reindexPath);
				if (file && !docsToAdd.some((item) => item.path === reindexPath)) {
					docsToAdd.push(file);
				}
			}

			logger.trace(`hybrid docs to delete: ${docsToDelete.length}`);
			logger.trace(`hybrid docs to add: ${docsToAdd.length}`);
			const hybridIndexStart = Date.now();
			const concurrency = this.getHybridIndexConcurrency();
			setHybridProfileMeta("concurrency", concurrency);
			setHybridProfileMeta("docsToAdd", docsToAdd.length);
			setHybridProfileMeta("docsToDelete", docsToDelete.length);
			logger.debug(
				`hybrid batch start: delete=${docsToDelete.length}, add=${docsToAdd.length}, concurrency=${concurrency}`,
			);
			await this.runHybridPreflight(currFiles, docsToAdd, docsToDelete);
			const progressNotice = this.createHybridIndexProgressNotice(
				docsToAdd,
				repairReport.repairedPaths.length,
			);
			const failures: HybridIndexFailure[] = [];
			try {
				await profileHybridStage("startup.delete_stale_paths", async () => {
					for (const path of docsToDelete) {
						await this.hybridEngine.deleteFile(path, { persistIndices: false }).catch((e) =>
							logger.warn(`hybrid deleteFile failed for ${path}:`, e),
						);
					}
				});
				await profileHybridStage("startup.index_files", async () => {
					await this.indexHybridFilesInBatches(
						docsToAdd,
						concurrency,
						async (file, complete) => {
							const failure = await this.indexHybridFileWithRetry(file);
							if (failure) {
								failures.push(failure);
							}
							complete(failure !== null);
						},
						progressNotice,
						repairReport.repairedPaths.length,
					);
				});
				await profileHybridStage("startup.persist_indices_batch", async () => {
					await this.hybridEngine.persistIndicesForBatch();
				});
				const fallbackNoticeKey =
					this.hybridEngine.consumeIndexingFallbackNoticeKey();
				if (failures.length > 0) {
					this.noticeHybridIndexFailures(failures);
				} else if (fallbackNoticeKey) {
					new MyNotice(t(fallbackNoticeKey), 7000);
				}
				progressNotice?.update(
					{
						stage: "done",
						totalBytes: docsToAdd.reduce((sum, file) => sum + file.stat.size, 0),
						totalFiles: docsToAdd.length,
						processedBytes: docsToAdd.reduce((sum, file) => sum + file.stat.size, 0),
						processedFiles: docsToAdd.length,
						repairedPaths: repairReport.repairedPaths.length,
						failedFiles: failures.length,
						sessionTokens: getHybridProfileMetric("provider_tokens"),
					},
					true,
				);
				logger.debug(
					`hybrid batch finished in ${Date.now() - hybridIndexStart} ms, failures=${failures.length}, persisted=true, repaired=${repairReport.repairedPaths.length}`,
				);
				endHybridProfile({
					failures: failures.length,
					repairedPaths: repairReport.repairedPaths.length,
				});
			} finally {
				progressNotice?.hide();
			}
		} catch (error) {
			endHybridProfile({ error: error instanceof Error ? error.message : String(error) });
			throw error;
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

	private async indexHybridFilesInBatches(
		files: TFile[],
		concurrency: number,
		handler: (file: TFile, complete: (failed: boolean) => void) => Promise<void>,
		progressNotice: HybridIndexProgressNotice | null,
		repairedPaths: number,
	) {
		if (files.length === 0) {
			progressNotice?.update(
				{
					stage: "done",
					totalBytes: 0,
					totalFiles: 0,
					processedBytes: 0,
					processedFiles: 0,
					repairedPaths,
					failedFiles: 0,
					sessionTokens: getHybridProfileMetric("provider_tokens"),
				},
				true,
			);
			return;
		}

		const largeFiles: TFile[] = [];
		const normalFiles: TFile[] = [];
		for (const file of files) {
			if (file.stat.size >= DataManager.HYBRID_LARGE_FILE_BYTES) {
				largeFiles.push(file);
			} else {
				normalFiles.push(file);
			}
		}

		largeFiles.sort((left, right) => right.stat.size - left.stat.size);
		normalFiles.sort((left, right) => right.stat.size - left.stat.size);
		logger.debug(
			`hybrid batch tiers: large=${largeFiles.length}, normal=${normalFiles.length}, normalConcurrency=${concurrency}`,
		);
		let processedBytes = 0;
		let processedFiles = 0;
		let failedFiles = 0;
		const totalBytes = files.reduce((sum, file) => sum + file.stat.size, 0);
		const totalFiles = files.length;
		progressNotice?.update(
			{
				stage: "index",
				totalBytes,
				totalFiles,
				processedBytes: 0,
				processedFiles: 0,
				repairedPaths,
				failedFiles: 0,
				sessionTokens: getHybridProfileMetric("provider_tokens"),
			},
			true,
		);

		await runWeightedTasks(
			[...largeFiles, ...normalFiles],
			{
				maxConcurrent: concurrency,
				maxWeight: DataManager.HYBRID_IN_FLIGHT_BYTES_BUDGET,
				getWeight: (file) => file.stat.size,
				isExclusive: (file) => file.stat.size >= DataManager.HYBRID_LARGE_FILE_BYTES,
			},
			async (file) => {
				await handler(file, (failed) => {
					processedBytes += file.stat.size;
					processedFiles += 1;
					if (failed) {
						failedFiles += 1;
					}
					progressNotice?.update({
						stage: "index",
						totalBytes,
						totalFiles,
						processedBytes,
						processedFiles,
						repairedPaths,
						failedFiles,
						sessionTokens: getHybridProfileMetric("provider_tokens"),
					});
				});
			},
		);
	}

	private async indexHybridFileWithRetry(
		file: TFile,
	): Promise<HybridIndexFailure | null> {
		const fileIndexStart = Date.now();
		const text = await this.dataProvider.readPlainText(file.path);
		const headingOutline = this.dataProvider.getHeadingOutline(file);
		let attempts = 0;
		let lastError: unknown = null;
		try {
			await retryAsync(
				async (attempt) => {
					attempts = attempt;
					await this.hybridEngine.indexFileStrict(
						file.path,
						text,
					file.stat.mtime,
					{ persistIndices: false },
						headingOutline,
					);
				},
				{
					maxAttempts: DataManager.HYBRID_INDEX_MAX_RETRIES,
					shouldRetry: (error, attempt) => {
						lastError = error;
						const reason = this.formatHybridIndexError(error);
						const retryable = this.isRetryableHybridIndexError(error);
						logger.warn(
							`hybrid semantic index attempt ${attempt}/${DataManager.HYBRID_INDEX_MAX_RETRIES} failed for ${file.path}: ${reason}`,
						);
						return retryable;
					},
					getDelayMs: (error, attempt) =>
						this.getHybridRetryDelayMs(error, attempt),
				},
			);
			logger.debug(
				`hybrid indexed ${file.path} in ${Date.now() - fileIndexStart} ms after ${attempts} attempt(s)`,
			);
			return null;
		} catch (error) {
			lastError = error;
		}

		let bm25FallbackIndexed = false;
		try {
			await this.hybridEngine.indexFile(
				file.path,
				text,
				file.stat.mtime,
				headingOutline,
			);
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

	private getHybridRetryDelayMs(error: unknown, attempt: number): number {
		if (!(error instanceof Error)) {
			return DataManager.HYBRID_INDEX_RETRY_DELAY_MS * attempt;
		}
		const message = `${error.name}: ${error.message}`.toLowerCase();
		if (message.includes("429")) {
			return 4_000 * attempt;
		}
		if (
			message.includes("408") ||
			message.includes("425") ||
			message.includes("timeout")
		) {
			return 2_500 * attempt;
		}
		if (
			message.includes("500") ||
			message.includes("502") ||
			message.includes("503") ||
			message.includes("504")
		) {
			return 3_000 * attempt;
		}
		return DataManager.HYBRID_INDEX_RETRY_DELAY_MS * attempt;
	}

	private createHybridIndexProgressNotice(
		docsToAdd: TFile[],
		repairedPaths: number,
	): HybridIndexProgressNotice | null {
		if (docsToAdd.length === 0 && repairedPaths === 0) {
			return null;
		}
		const progressNotice = new HybridIndexProgressNotice();
		if (repairedPaths > 0) {
			progressNotice.update(
				{
					stage: "repair",
					totalBytes: docsToAdd.reduce((sum, file) => sum + file.stat.size, 0),
					totalFiles: docsToAdd.length,
					processedBytes: 0,
					processedFiles: 0,
					repairedPaths,
					failedFiles: 0,
					sessionTokens: getHybridProfileMetric("provider_tokens"),
				},
				true,
			);
		}
		return progressNotice;
	}

	private async repairHybridStoredState(
		currFiles: Map<string, TFile>,
	): Promise<HybridStorageRepairReport> {
		const chunkPaths = new Set<string>(
			(await this.database.db.hybridChunks.orderBy("filePath").keys()) as string[],
		);
		const vectorRows = await this.database.db.hybridChunkVectors.toArray();
		const vectorPrecisionByPath = new Map<string, string>(
			vectorRows.map((row) => [row.filePath, row.precision]),
		);
		const docRefs = await this.database.db.hybridDocRefs.toArray();
		const docRefPaths = new Set(docRefs.map((ref) => ref.path));
		const allPaths = new Set<string>([
			...chunkPaths,
			...vectorPrecisionByPath.keys(),
			...docRefPaths,
		]);
		const currentPrecision =
			this.setting.hybrid.vectorCompression === "float16" ? "float16" : "int8";
		const repairedPaths: string[] = [];
		const reindexedPaths: string[] = [];

		for (const path of allPaths) {
			const hasChunks = chunkPaths.has(path);
			const vectorPrecision = vectorPrecisionByPath.get(path);
			const hasVector = vectorPrecision !== undefined;
			const hasDocRef = docRefPaths.has(path);
			const existsNow = currFiles.has(path);

			const inconsistent =
				(hasVector && !hasChunks) ||
				(!hasDocRef && (hasChunks || hasVector)) ||
				(hasDocRef && !hasChunks);
			const obsolete = !existsNow && (hasChunks || hasVector || hasDocRef);
			const precisionMismatch =
				hasVector && vectorPrecision !== currentPrecision;
			if (!inconsistent && !obsolete && !precisionMismatch) {
				continue;
			}

			repairedPaths.push(path);
			if (existsNow) {
				reindexedPaths.push(path);
			}
		}

		if (repairedPaths.length === 0) {
			return { repairedPaths, reindexedPaths };
		}

		console.groupCollapsed(
			`[clever-search] Hybrid startup self-healing (${repairedPaths.length} paths)`,
		);
		console.table(
			repairedPaths.map((path) => ({
				path,
				inVault: currFiles.has(path),
				hasChunks: chunkPaths.has(path),
				hasVector: vectorPrecisionByPath.has(path),
				hasDocRef: docRefPaths.has(path),
				vectorPrecision: vectorPrecisionByPath.get(path) ?? "-",
			})),
		);
		console.groupEnd();

		for (const path of repairedPaths) {
			await this.hybridEngine.deleteFile(path, { persistIndices: false }).catch((error) =>
				logger.warn(`hybrid self-healing delete failed for ${path}:`, error),
			);
		}

		return { repairedPaths, reindexedPaths };
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

	private async runHybridPreflight(
		currFiles: Map<string, TFile>,
		docsToAdd: TFile[],
		docsToDelete: string[],
	): Promise<void> {
		if (
			docsToAdd.length === 0 &&
			docsToDelete.length === 0 &&
			!this.shouldForceRefresh
		) {
			return;
		}

		const report = await this.buildHybridPreflightReport(
			currFiles,
			docsToAdd,
			docsToDelete,
		);
		console.groupCollapsed("[clever-search] Hybrid indexing preflight");
		console.table([
			{
				filesToAdd: report.filesToAdd,
				filesToDelete: report.filesToDelete,
				totalSize: this.formatBytes(report.totalBytes),
				largeFiles: report.largeFiles.length,
				largestFile: report.largestFile
					? `${report.largestFile.path} (${this.formatBytes(report.largestFile.stat.size)})`
					: "-",
				estimatedHybridSize: this.formatBytes(report.estimatedHybridBytes),
				currentHybridSize: this.formatBytes(report.currentHybridBytes),
				projectedQuotaUsage:
					report.projectedUsageRatio === null
						? "n/a"
						: `${(report.projectedUsageRatio * 100).toFixed(1)}%`,
			},
		]);
		console.groupEnd();

		const shouldNotice =
			this.shouldForceRefresh ||
			report.totalBytes >= DataManager.HYBRID_PRECHECK_NOTICE_BYTES ||
			report.largeFiles.length > 0 ||
			(report.projectedUsageRatio ?? 0) >= DataManager.HYBRID_QUOTA_WARN_RATIO;
		if (!shouldNotice) {
			return;
		}

		new MyNotice(this.buildHybridPreflightNotice(report), 12000);
	}

	private async buildHybridPreflightReport(
		currFiles: Map<string, TFile>,
		docsToAdd: TFile[],
		docsToDelete: string[],
	): Promise<HybridPreflightReport> {
		const currFileList = Array.from(currFiles.values());
		const totalBytes = currFileList.reduce((sum, file) => sum + file.stat.size, 0);
		const largeFiles = currFileList.filter(
			(file) => file.stat.size >= DataManager.HYBRID_LARGE_FILE_BYTES,
		);
		const largestFile =
			largeFiles.length > 0
				? largeFiles.reduce((max, file) =>
					file.stat.size > max.stat.size ? file : max,
				)
				: null;

		const storageUsage = await this.database.estimatePluginStorageUsage();
		const currentHybridBytes = storageUsage.tables
			.filter((item) =>
				item.name === "hybridChunks" ||
				item.name === "hybridChunkVectors" ||
				item.name === "hybridBm25Index" ||
				item.name === "hybridHnswSmall" ||
				item.name === "hybridDocRefs",
			)
			.reduce((sum, item) => sum + item.bytes, 0);

		const existingHybridRefs = new Set(
			(await this.database.db.hybridDocRefs.toArray()).map((ref) => ref.path),
		);
		const indexedSourceBytes = currFileList
			.filter((file) => existingHybridRefs.has(file.path))
			.reduce((sum, file) => sum + file.stat.size, 0);
		const ratioFromCurrent =
			indexedSourceBytes > 0 && currentHybridBytes > 0
				? currentHybridBytes / indexedSourceBytes
				: DataManager.HYBRID_STORAGE_RATIO_FALLBACK;
		const estimatedRatio = Math.min(
			DataManager.HYBRID_STORAGE_RATIO_MAX,
			Math.max(DataManager.HYBRID_STORAGE_RATIO_MIN, ratioFromCurrent),
		);
		const estimatedHybridBytes = Math.round(totalBytes * estimatedRatio);

		const storageEstimate = await navigator.storage?.estimate?.().catch(() => null);
		const quotaBytes =
			storageEstimate && typeof storageEstimate.quota === "number"
				? storageEstimate.quota
				: null;
		const usageBytes =
			storageEstimate && typeof storageEstimate.usage === "number"
				? storageEstimate.usage
				: null;
		const projectedUsageRatio =
			quotaBytes && usageBytes !== null
				? Math.min(
					1,
					(usageBytes - currentHybridBytes + estimatedHybridBytes) / quotaBytes,
				)
				: null;

		return {
			totalBytes,
			filesToAdd: docsToAdd.length,
			filesToDelete: docsToDelete.length,
			largeFiles,
			largestFile,
			estimatedHybridBytes,
			currentHybridBytes,
			projectedUsageRatio,
		};
	}

	private buildHybridPreflightNotice(report: HybridPreflightReport): string {
		const quotaText =
			report.projectedUsageRatio === null
				? "IndexedDB quota: n/a"
				: `IndexedDB quota usage may reach ${(report.projectedUsageRatio * 100).toFixed(0)}%`;
		const largeFileText =
			report.largeFiles.length > 0
				? `, ${report.largeFiles.length} large file(s)`
				: "";
		return `Hybrid indexing preflight: ${report.filesToAdd} file(s) to add/update, ${report.filesToDelete} to delete, vault ${this.formatBytes(report.totalBytes)}${largeFileText}, estimated hybrid storage ${this.formatBytes(report.estimatedHybridBytes)}. ${quotaText}. Large files will be indexed serially.`;
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
		return formatBytesLabel(bytes);
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
