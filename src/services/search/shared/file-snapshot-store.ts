import { TFile, Vault, htmlToMarkdown } from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { Database } from "src/services/database/database";

type IndexedSnapshotCacheEntry = {
	text: string;
	generation?: number;
};

export type FileSnapshotStoreStatus = {
	enabled: boolean;
	active: boolean;
	thresholdMb: number;
	totalIndexableBytes: number;
	currentCachedFileCount: number;
	indexedCachedFileCount: number;
	currentPreloading: boolean;
	indexedPreloading: boolean;
};

@singleton()
export class FileSnapshotStore {
	private readonly vault = getInstance(Vault);
	private readonly setting = getInstance(OuterSetting);
	private readonly currentFileCache = new Map<string, string>();
	private readonly indexedSnapshotCache = new Map<string, IndexedSnapshotCacheEntry>();
	private currentPreloadTask: Promise<void> | null = null;
	private indexedPreloadTask: Promise<void> | null = null;
	private currentPreloadRunId = 0;
	private indexedPreloadRunId = 0;
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
		if (cached !== undefined) {
			return cached;
		}
		const plainText = await this.vault.cachedRead(file);
		const normalized =
			file.extension === "html" ? this.normalizeHtmlToText(plainText) : plainText;
		this.currentFileCache.set(file.path, normalized);
		return normalized;
	}

	setCurrentFileText(path: string, text: string): void {
		this.currentFileCache.set(path, text);
	}

	peekCurrentFileText(path: string): string | undefined {
		return this.currentFileCache.get(path);
	}

	invalidateCurrentFile(path: string): void {
		this.currentFileCache.delete(path);
	}

	renameCurrentFile(oldPath: string, newPath: string): void {
		const cached = this.currentFileCache.get(oldPath);
		if (cached === undefined) {
			return;
		}
		this.currentFileCache.delete(oldPath);
		this.currentFileCache.set(newPath, cached);
	}

	setIndexedSnapshot(
		filePath: string,
		text: string,
		generation?: number,
	): void {
		this.indexedSnapshotCache.set(filePath, { text, generation });
	}

	deleteIndexedSnapshot(filePath: string): void {
		this.indexedSnapshotCache.delete(filePath);
	}

	clearIndexedSnapshots(): void {
		this.indexedSnapshotCache.clear();
	}

	renameIndexedSnapshot(
		oldPath: string,
		newPath: string,
		generation?: number,
	): void {
		const cached = this.indexedSnapshotCache.get(oldPath);
		if (cached === undefined) {
			return;
		}
		this.indexedSnapshotCache.delete(oldPath);
		this.indexedSnapshotCache.set(newPath, {
			text: cached.text,
			generation: generation ?? cached.generation,
		});
	}

	async getIndexedSnapshotText(
		filePath: string,
		expectedGeneration?: number,
	): Promise<string | undefined> {
		const cached = this.indexedSnapshotCache.get(filePath);
		if (
			cached &&
			(expectedGeneration === undefined ||
				cached.generation === undefined ||
				cached.generation === expectedGeneration)
		) {
			return cached.text;
		}

		const row = await this.database.db.hybridFileSnapshots.get(filePath);
		if (!row) {
			return undefined;
		}
		this.indexedSnapshotCache.set(filePath, {
			text: row.plainText,
			generation: row.generation,
		});
		return row.plainText;
	}

	async getIndexedSnapshotTexts(
		filePaths: string[],
	): Promise<Map<string, string>> {
		const uniquePaths = Array.from(new Set(filePaths));
		const snapshots = new Map<string, string>();
		const missingPaths: string[] = [];

		for (const filePath of uniquePaths) {
			const cached = this.indexedSnapshotCache.get(filePath);
			if (cached) {
				snapshots.set(filePath, cached.text);
				continue;
			}
			missingPaths.push(filePath);
		}

		if (missingPaths.length === 0) {
			return snapshots;
		}

		const rows = await this.database.db.hybridFileSnapshots.bulkGet(missingPaths);
		for (const row of rows) {
			if (!row) {
				continue;
			}
			this.indexedSnapshotCache.set(row.filePath, {
				text: row.plainText,
				generation: row.generation,
			});
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
			if (this.highPerformanceActive) {
				this.indexedSnapshotCache.clear();
			}
			this.highPerformanceActive = false;
			return;
		}
		this.highPerformanceActive = true;
		void this.preloadCurrentFiles(indexableFiles);
		if (this.setting.hybrid.enabled) {
			void this.preloadIndexedSnapshots();
		}
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
			currentCachedFileCount: this.currentFileCache.size,
			indexedCachedFileCount: this.indexedSnapshotCache.size,
			currentPreloading: this.currentPreloadTask !== null,
			indexedPreloading: this.indexedPreloadTask !== null,
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
		this.indexedPreloadRunId++;
		this.currentPreloadTask = null;
		this.indexedPreloadTask = null;
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

	private async preloadIndexedSnapshots(): Promise<void> {
		if (this.indexedPreloadTask) {
			return this.indexedPreloadTask;
		}
		const runId = ++this.indexedPreloadRunId;
		this.indexedPreloadTask = (async () => {
			const rows = await this.database.db.hybridFileSnapshots.toArray();
			for (const row of rows) {
				if (runId !== this.indexedPreloadRunId || !this.isHighPerformanceActive()) {
					return;
				}
				if (this.indexedSnapshotCache.has(row.filePath)) {
					continue;
				}
				this.indexedSnapshotCache.set(row.filePath, {
					text: row.plainText,
					generation: row.generation,
				});
			}
		})().finally(() => {
			if (runId === this.indexedPreloadRunId) {
				this.indexedPreloadTask = null;
			}
		});
		return this.indexedPreloadTask;
	}

	private normalizeHtmlToText(htmlText: string): string {
		return htmlToMarkdown(htmlText)
			.replace(/\[([^[\]]+)\]\([^()]*\)/g, "$1")
			.replace(/\*\*(.*?)\*\*/g, "$1")
			.replace(/`(.*?)`/g, "$1");
	}

	private get database(): Database {
		const { Database } =
			// Delay loading the Dexie-backed module so lexical-only tests do not have
			// to parse the decorated database class eagerly.
			require("src/services/database/database") as typeof import("src/services/database/database");
		return getInstance(Database);
	}
}
