import { TFile, Vault, htmlToMarkdown } from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { Database } from "src/services/database/database";

type CurrentFileCacheEntry = {
	text: string;
	generation?: number;
};

type PersistedFileSnapshotRow = {
	filePath: string;
	plainText: string;
	generation?: number;
};

const textEncoder = new TextEncoder();

export type FileSnapshotStoreStatus = {
	enabled: boolean;
	active: boolean;
	thresholdMb: number;
	totalIndexableBytes: number;
	cachedFileCount: number;
	preloading: boolean;
};

@singleton()
export class FileSnapshotStore {
	private readonly vault = getInstance(Vault);
	private readonly setting = getInstance(OuterSetting);
	private readonly currentFileCache = new Map<string, CurrentFileCacheEntry>();
	private currentPreloadTask: Promise<void> | null = null;
	private currentPreloadRunId = 0;
	private lastIndexableBytes = 0;
	private highPerformanceActive = false;

	async readCurrentFileText(fileOrPath: TFile | string): Promise<string> {
		const file =
			typeof fileOrPath === "string"
				? this.vault.getAbstractFileByPath(fileOrPath)
				: fileOrPath;
		if (!(file instanceof TFile)) {
			return "";
		}
		const cached = this.currentFileCache.get(file.path);
		if (
			cached !== undefined &&
			(cached.generation === undefined ||
				file.stat.mtime === undefined ||
				cached.generation >= file.stat.mtime)
		) {
			return cached.text;
		}
		const plainText = await this.vault.cachedRead(file);
		const normalized =
			file.extension === "html" ? this.normalizeHtmlToText(plainText) : plainText;
		return this.setCurrentFileText(file.path, normalized, file.stat.mtime);
	}

	setCurrentFileText(path: string, text: string, generation?: number): string {
		const existing = this.currentFileCache.get(path);
		if (
			existing &&
			!this.shouldReplaceCurrentEntry(existing.generation, generation)
		) {
			return existing.text;
		}
		this.currentFileCache.set(path, { text, generation });
		return text;
	}

	clearCurrentFiles(): void {
		this.currentFileCache.clear();
	}

	peekCurrentFileText(path: string): string | undefined {
		return this.currentFileCache.get(path)?.text;
	}

	peekCurrentFileGeneration(path: string): number | undefined {
		return this.currentFileCache.get(path)?.generation;
	}

	invalidateCurrentFile(path: string): void {
		this.currentFileCache.delete(path);
	}

	estimateCurrentCacheBytes(): number {
		let total = 0;
		for (const [path, entry] of this.currentFileCache) {
			total += textEncoder.encode(path).length;
			total += textEncoder.encode(entry.text).length;
			if (entry.generation !== undefined) {
				total += 8;
			}
		}
		return total;
	}

	async persistIndexedSnapshot(
		filePath: string,
		text: string,
		generation?: number,
	): Promise<void> {
		await this.database.db.fileSnapshots.put({
			filePath,
			plainText: text,
			generation,
		});
	}

	async commitCurrentFileAsIndexed(
		filePath: string,
		generation?: number,
	): Promise<void> {
		const cached = this.currentFileCache.get(filePath);
		if (cached === undefined) {
			return;
		}
		await this.persistIndexedSnapshot(
			filePath,
			cached.text,
			generation ?? cached.generation,
		);
	}

	async commitCurrentFilesAsIndexed(
		files: ReadonlyArray<{ path: string; generation?: number }>,
	): Promise<void> {
		const rows: PersistedFileSnapshotRow[] = [];
		for (const file of files) {
			const cached = this.currentFileCache.get(file.path);
			if (!cached) {
				continue;
			}
			rows.push({
				filePath: file.path,
				plainText: cached.text,
				generation: file.generation ?? cached.generation,
			});
		}
		if (rows.length === 0) {
			return;
		}
		await this.database.db.fileSnapshots.bulkPut(rows);
	}

	async deleteIndexedSnapshot(filePath: string): Promise<void> {
		await this.database.db.fileSnapshots.delete(filePath);
	}

	async deleteIndexedSnapshots(filePaths: readonly string[]): Promise<void> {
		if (filePaths.length === 0) {
			return;
		}
		await this.database.db.fileSnapshots.bulkDelete(Array.from(filePaths));
	}

	async getIndexedSnapshotTexts(
		filePaths: string[],
		expectedGenerations?: ReadonlyMap<string, number | undefined>,
	): Promise<Map<string, string>> {
		const uniquePaths = Array.from(new Set(filePaths));
		const snapshots = new Map<string, string>();
		const missingPaths: string[] = [];

		for (const filePath of uniquePaths) {
			const expectedGeneration = expectedGenerations?.get(filePath);
			const current = this.currentFileCache.get(filePath);
			if (
				expectedGeneration !== undefined &&
				current?.generation !== undefined &&
				current.generation === expectedGeneration
			) {
				snapshots.set(filePath, current.text);
				continue;
			}
			missingPaths.push(filePath);
		}

		if (missingPaths.length === 0) {
			return snapshots;
		}

		const rows = await this.database.db.fileSnapshots.bulkGet(missingPaths);
		for (const row of rows) {
			if (!row) {
				continue;
			}
			const expectedGeneration = expectedGenerations?.get(row.filePath);
			if (
				expectedGeneration !== undefined &&
				row.generation !== expectedGeneration
			) {
				continue;
			}
			snapshots.set(row.filePath, row.plainText);
		}

		return snapshots;
	}

	async refreshHighPerformanceState(
		indexableFiles: readonly TFile[] = this.vault.getFiles(),
	): Promise<void> {
		this.lastIndexableBytes = indexableFiles.reduce(
			(sum, file) => sum + file.stat.size,
			0,
		);
		const shouldActivate = this.isHighPerformanceActive();
		if (!shouldActivate) {
			this.cancelPreloads();
			this.highPerformanceActive = false;
			return;
		}
		this.highPerformanceActive = true;
		void this.preloadCurrentFiles(indexableFiles);
	}

	getStatusSummary(
		indexableFiles?: readonly TFile[],
	): FileSnapshotStoreStatus {
		const totalIndexableBytes =
			indexableFiles?.reduce((sum, file) => sum + file.stat.size, 0) ??
			this.lastIndexableBytes;
		if (indexableFiles) {
			this.lastIndexableBytes = totalIndexableBytes;
		}
		return {
			enabled: this.getHighPerformanceThresholdBytes() > 0,
			active:
				this.getHighPerformanceThresholdBytes() > 0 &&
				totalIndexableBytes <= this.getHighPerformanceThresholdBytes(),
			thresholdMb: this.setting.hybrid.highPerformanceMaxMb ?? 60,
			totalIndexableBytes,
			cachedFileCount: this.currentFileCache.size,
			preloading: this.currentPreloadTask !== null,
		};
	}

	private isHighPerformanceActive(): boolean {
		const thresholdBytes = this.getHighPerformanceThresholdBytes();
		return thresholdBytes > 0 && this.lastIndexableBytes <= thresholdBytes;
	}

	private getHighPerformanceThresholdBytes(): number {
		return Math.max(0, this.setting.hybrid.highPerformanceMaxMb ?? 60) * 1024 * 1024;
	}

	private cancelPreloads(): void {
		this.currentPreloadRunId++;
		this.currentPreloadTask = null;
	}

	private async preloadCurrentFiles(indexableFiles: readonly TFile[]): Promise<void> {
		if (this.currentPreloadTask) {
			return this.currentPreloadTask;
		}
		const runId = ++this.currentPreloadRunId;
		this.currentPreloadTask = (async () => {
			for (const file of indexableFiles) {
				if (runId !== this.currentPreloadRunId || !this.isHighPerformanceActive()) {
					return;
				}
				if (this.currentFileCache.has(file.path)) {
					continue;
				}
				await this.readCurrentFileText(file);
			}
		})().finally(() => {
			if (runId === this.currentPreloadRunId) {
				this.currentPreloadTask = null;
			}
		});
		return this.currentPreloadTask;
	}

	private normalizeHtmlToText(htmlText: string): string {
		return htmlToMarkdown(htmlText)
			.replace(/\[([^[\]]+)\]\([^()]*\)/g, "$1")
			.replace(/\*\*(.*?)\*\*/g, "$1")
			.replace(/`(.*?)`/g, "$1");
	}

	private shouldReplaceCurrentEntry(
		existingGeneration: number | undefined,
		nextGeneration: number | undefined,
	): boolean {
		if (existingGeneration === undefined) {
			return true;
		}
		if (nextGeneration === undefined) {
			return false;
		}
		return nextGeneration >= existingGeneration;
	}

	private get database(): Database {
		const { Database } =
			// Delay loading the Dexie-backed module so lexical-only tests do not have
			// to parse the decorated database class eagerly.
			require("src/services/database/database") as typeof import("src/services/database/database");
		return getInstance(Database);
	}
}
