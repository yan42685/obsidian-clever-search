import { TFile, Vault, htmlToMarkdown } from "obsidian";
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

type PersistedFileShadowRow = {
	filePath: string;
	plainText: string;
	generation?: number;
};

type IndexedTextRequest = {
	path: string;
	generation?: number;
};

type IndexedTextPublishRequest = {
	path: string;
	generation?: number;
	text?: string;
};

const textEncoder = new TextEncoder();


@singleton()
export class FileSnapshotStore {
	private static readonly INDEXED_SNAPSHOT_SCAN_BATCH_SIZE = 256;
	private readonly vault = getInstance(Vault);
	private readonly currentFileCache = new Map<string, CurrentFileCacheEntry>();

	async readCurrentTexts(
		fileOrPaths: ReadonlyArray<TFile | string>,
	): Promise<Map<string, string>> {
		const texts = new Map<string, string>();
		for (const fileOrPath of fileOrPaths) {
			const file = this.resolveFile(fileOrPath);
			if (!(file instanceof TFile)) {
				continue;
			}
			texts.set(file.path, await this.readSearchableFileText(file));
		}
		return texts;
	}

	async readIndexedTexts(
		requests: ReadonlyArray<IndexedTextRequest>,
	): Promise<Map<string, string>> {
		const expectedGenerations = new Map<string, number | undefined>();
		for (const request of requests) {
			expectedGenerations.set(request.path, request.generation);
		}
		return await this.readGenerationAlignedTexts(
			requests.map((request) => request.path),
			expectedGenerations,
		);
	}

	async publishIndexedTexts(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		await this.commitCurrentFilesAsIndexed(files);
	}

	async reconcileHybridShadows(filePaths?: readonly string[]): Promise<void> {
		const paths =
			filePaths !== undefined
				? Array.from(new Set(filePaths))
				: (
						await this.database.db.hybridDirtyShadows
							.orderBy(":id")
							.toArray()
					).map((row) => row.filePath);
		if (paths.length === 0) {
			return;
		}

		const [shadowRows, indexedRefs, snapshotRows] = await Promise.all([
			this.database.db.hybridDirtyShadows.bulkGet(paths),
			this.database.db.hybridIndexedFileRefs.bulkGet(paths),
			this.database.db.fileSnapshots.bulkGet(paths),
		]);

		const stalePaths: string[] = [];
		for (let index = 0; index < paths.length; index++) {
			const shadowRow = shadowRows[index];
			if (!shadowRow) {
				continue;
			}

			const indexedGeneration = indexedRefs[index]?.generation;
			const shadowGeneration = shadowRow.generation;
			const snapshotGeneration = snapshotRows[index]?.generation;
			const shouldKeep =
				indexedGeneration !== undefined &&
				shadowGeneration !== undefined &&
				shadowGeneration === indexedGeneration &&
				snapshotGeneration !== indexedGeneration;
			if (!shouldKeep) {
				stalePaths.push(paths[index]);
			}
		}

		if (stalePaths.length === 0) {
			return;
		}
		await this.database.db.hybridDirtyShadows.bulkDelete(stalePaths);
	}

	async removeFiles(filePaths: readonly string[]): Promise<void> {
		for (const filePath of filePaths) {
			this.deleteCurrentFile(filePath);
		}
		await this.deletePersistedFiles(filePaths);
	}

	async retainOnlyFiles(validPaths: ReadonlySet<string>): Promise<void> {
		for (const path of Array.from(this.currentFileCache.keys())) {
			if (!validPaths.has(path)) {
				this.deleteCurrentFile(path);
			}
		}
		await this.deleteRowsNotIn(
			() => this.database.db.fileSnapshots,
			(paths) => this.database.db.fileSnapshots.bulkDelete(paths),
			validPaths,
		);
		await this.deleteRowsNotIn(
			() => this.database.db.hybridDirtyShadows,
			(paths) => this.database.db.hybridDirtyShadows.bulkDelete(paths),
			validPaths,
		);
	}

	private async readSearchableFileText(fileOrPath: TFile | string): Promise<string> {
		const file = this.resolveFile(fileOrPath);
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
		const indexedSnapshot = await this.database.db.fileSnapshots.get(file.path);
		if (
			indexedSnapshot &&
			this.isIndexedSnapshotAligned(
				indexedSnapshot.generation,
				file.stat.mtime,
			)
		) {
			return this.writeCurrentFileText(
				file.path,
				indexedSnapshot.plainText,
				indexedSnapshot.generation ?? file.stat.mtime,
			);
		}
		return await this.readCurrentFileText(file);
	}

	private async readCurrentFileText(fileOrPath: TFile | string): Promise<string> {
		const file = this.resolveFile(fileOrPath);
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
		return this.writeCurrentFileText(file.path, normalized, file.stat.mtime);
	}

	resetRuntimeState(): void {
		this.currentFileCache.clear();
	}

	private writeCurrentFileText(
		path: string,
		text: string,
		generation?: number,
	): string {
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

	private deleteCurrentFile(path: string): void {
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

	private async commitCurrentFilesAsIndexed(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		await this.ensureCurrentEntriesForPublish(files);
		const rows: PersistedFileSnapshotRow[] = [];
		const persistedFiles: Array<{ path: string; generation?: number }> = [];
		for (const file of files) {
			const cached = this.currentFileCache.get(file.path);
			if (!this.isGenerationMatch(cached?.generation, file.generation)) {
				continue;
			}
			if (!cached) {
				continue;
			}
			rows.push({
				filePath: file.path,
				plainText: cached.text,
				generation: file.generation ?? cached.generation,
			});
			persistedFiles.push({
				path: file.path,
				generation: file.generation ?? cached.generation,
			});
		}
		if (rows.length === 0) {
			return;
		}
		await this.preserveIndexedGenerationShadows(persistedFiles);
		await this.database.db.fileSnapshots.bulkPut(rows);
	}

	private async deletePersistedFiles(filePaths: readonly string[]): Promise<void> {
		if (filePaths.length === 0) {
			return;
		}
		const uniquePaths = Array.from(new Set(filePaths));
		await Promise.all([
			this.database.db.fileSnapshots.bulkDelete(uniquePaths),
			this.database.db.hybridDirtyShadows.bulkDelete(uniquePaths),
		]);
	}

	private async readGenerationAlignedTexts(
		filePaths: string[],
		expectedGenerations?: ReadonlyMap<string, number | undefined>,
	): Promise<Map<string, string>> {
		const uniquePaths = Array.from(new Set(filePaths));
		const snapshots = new Map<string, string>();
		const missingPaths: string[] = [];

		for (const filePath of uniquePaths) {
			const expectedGeneration = expectedGenerations?.get(filePath);
			const current = this.currentFileCache.get(filePath);
			if (current && this.isGenerationMatch(current.generation, expectedGeneration)) {
				snapshots.set(filePath, current.text);
				continue;
			}
			missingPaths.push(filePath);
		}

		if (missingPaths.length === 0) {
			return snapshots;
		}

		const persistedRows = await this.database.db.fileSnapshots.bulkGet(missingPaths);
		const shadowMissingPaths: string[] = [];
		for (let index = 0; index < missingPaths.length; index++) {
			const row = persistedRows[index];
			const filePath = missingPaths[index];
			const expectedGeneration = expectedGenerations?.get(filePath);
			if (row && this.isGenerationMatch(row.generation, expectedGeneration)) {
				snapshots.set(filePath, row.plainText);
				continue;
			}
			shadowMissingPaths.push(filePath);
		}

		if (!expectedGenerations || shadowMissingPaths.length === 0) {
			return snapshots;
		}

		const shadowRows = await this.database.db.hybridDirtyShadows.bulkGet(shadowMissingPaths);
		for (let index = 0; index < shadowMissingPaths.length; index++) {
			const row = shadowRows[index];
			if (!row) {
				continue;
			}
			const expectedGeneration = expectedGenerations.get(shadowMissingPaths[index]);
			if (!this.isGenerationMatch(row.generation, expectedGeneration)) {
				continue;
			}
			snapshots.set(row.filePath, row.plainText);
		}

		return snapshots;
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

	private isGenerationMatch(
		actualGeneration: number | undefined,
		expectedGeneration: number | undefined,
	): boolean {
		if (expectedGeneration === undefined) {
			return true;
		}
		return actualGeneration !== undefined && actualGeneration === expectedGeneration;
	}

	private isIndexedSnapshotAligned(
		snapshotGeneration: number | undefined,
		fileGeneration: number | undefined,
	): boolean {
		if (fileGeneration === undefined) {
			return true;
		}
		return (
			snapshotGeneration !== undefined && snapshotGeneration === fileGeneration
		);
	}

	private resolveFile(fileOrPath: TFile | string): TFile | null {
		const file =
			typeof fileOrPath === "string"
				? this.vault.getAbstractFileByPath(fileOrPath)
				: fileOrPath;
		return file instanceof TFile ? file : null;
	}

	private async ensureCurrentEntriesForPublish(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		for (const file of files) {
			if (file.text !== undefined) {
				this.writeCurrentFileText(file.path, file.text, file.generation);
				continue;
			}
			const cached = this.currentFileCache.get(file.path);
			if (this.isGenerationMatch(cached?.generation, file.generation)) {
				continue;
			}
			await this.hydrateCurrentEntryForPublish(file.path, file.generation);
		}
	}

	private async hydrateCurrentEntryForPublish(
		path: string,
		expectedGeneration?: number,
	): Promise<void> {
		const file = this.resolveFile(path);
		if (!(file instanceof TFile)) {
			return;
		}
		if (
			expectedGeneration !== undefined &&
			file.stat.mtime !== undefined &&
			file.stat.mtime !== expectedGeneration
		) {
			return;
		}
		await this.readCurrentFileText(file);
	}

	private async preserveIndexedGenerationShadows(
		files: ReadonlyArray<{ path: string; generation?: number }>,
	): Promise<void> {
		const dedupedFiles: Array<{ path: string; generation?: number }> = [];
		const seenPaths = new Set<string>();
		for (const file of files) {
			if (seenPaths.has(file.path)) {
				continue;
			}
			seenPaths.add(file.path);
			dedupedFiles.push(file);
		}
		if (dedupedFiles.length === 0) {
			return;
		}
		const paths = dedupedFiles.map((file) => file.path);
		const [indexedRefs, currentRows] = await Promise.all([
			this.database.db.hybridIndexedFileRefs.bulkGet(paths),
			this.database.db.fileSnapshots.bulkGet(paths),
		]);
		const shadowRows: PersistedFileShadowRow[] = [];
		for (let index = 0; index < dedupedFiles.length; index++) {
			const indexedRef = indexedRefs[index];
			const currentRow = currentRows[index];
			const nextGeneration = dedupedFiles[index].generation;
			if (!indexedRef || !currentRow) {
				continue;
			}
			if (
				indexedRef.generation === undefined ||
				currentRow.generation === undefined ||
				indexedRef.generation !== currentRow.generation
			) {
				continue;
			}
			if (nextGeneration !== undefined && indexedRef.generation === nextGeneration) {
				continue;
			}
			shadowRows.push({
				filePath: currentRow.filePath,
				plainText: currentRow.plainText,
				generation: currentRow.generation,
			});
		}
		if (shadowRows.length === 0) {
			return;
		}
		await this.database.db.hybridDirtyShadows.bulkPut(shadowRows);
	}

	private async deleteRowsNotIn(
		getTable: () => { orderBy: (index: string) => any; where: (index: string) => any },
		deleteRows: (paths: string[]) => Promise<void>,
		validPaths: ReadonlySet<string>,
	): Promise<void> {
		let lastPath: string | null = null;
		while (true) {
			const rows: Array<{ filePath: string }> =
				lastPath === null
					? await getTable()
						.orderBy(":id")
						.limit(FileSnapshotStore.INDEXED_SNAPSHOT_SCAN_BATCH_SIZE)
						.toArray()
					: await getTable()
						.where(":id")
						.above(lastPath)
						.limit(FileSnapshotStore.INDEXED_SNAPSHOT_SCAN_BATCH_SIZE)
						.toArray();
			if (rows.length === 0) {
				return;
			}

			const stalePaths = rows
				.map((row) => row.filePath)
				.filter((path) => !validPaths.has(path));
			if (stalePaths.length > 0) {
				await deleteRows(stalePaths);
			}

			lastPath = rows[rows.length - 1].filePath;
		}
	}

	private get database(): Database {
		const { Database } =
			// Delay loading the Dexie-backed module so lexical-only tests do not have
			// to parse the decorated database class eagerly.
			require("src/services/database/database") as typeof import("src/services/database/database");
		return getInstance(Database);
	}
}
