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

const textEncoder = new TextEncoder();


@singleton()
export class FileSnapshotStore {
	private static readonly INDEXED_SNAPSHOT_SCAN_BATCH_SIZE = 256;
	private readonly vault = getInstance(Vault);
	private readonly currentFileCache = new Map<string, CurrentFileCacheEntry>();

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
		options: { clearShadowIfAligned?: boolean } = {},
	): Promise<void> {
		await this.database.db.fileSnapshots.put({
			filePath,
			plainText: text,
			generation,
		});
		if (options.clearShadowIfAligned) {
			await this.clearIndexedShadowIfAligned(filePath, generation);
		}
	}

	async commitCurrentFileAsIndexed(
		filePath: string,
		generation?: number,
	): Promise<void> {
		await this.commitCurrentFilesAsIndexed([{ path: filePath, generation }]);
	}

	async commitCurrentFilesAsIndexed(
		files: ReadonlyArray<{ path: string; generation?: number }>,
	): Promise<void> {
		const rows: PersistedFileSnapshotRow[] = [];
		const persistedFiles: Array<{ path: string; generation?: number }> = [];
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

	async deleteIndexedSnapshot(filePath: string): Promise<void> {
		await this.deleteIndexedSnapshots([filePath]);
	}

	async deleteIndexedSnapshots(filePaths: readonly string[]): Promise<void> {
		if (filePaths.length === 0) {
			return;
		}
		const uniquePaths = Array.from(new Set(filePaths));
		await Promise.all([
			this.database.db.fileSnapshots.bulkDelete(uniquePaths),
			this.database.db.hybridDirtyShadows.bulkDelete(uniquePaths),
		]);
	}

	async deleteIndexedShadow(filePath: string): Promise<void> {
		await this.deleteIndexedShadows([filePath]);
	}

	async deleteIndexedShadows(filePaths: readonly string[]): Promise<void> {
		if (filePaths.length === 0) {
			return;
		}
		await this.database.db.hybridDirtyShadows.bulkDelete(Array.from(new Set(filePaths)));
	}

	async deleteIndexedSnapshotsNotIn(
		validPaths: ReadonlySet<string>,
	): Promise<void> {
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

	async readGenerationAlignedText(
		filePath: string,
		expectedGeneration?: number,
	): Promise<string | undefined> {
		const expectedGenerations =
			expectedGeneration === undefined
				? undefined
				: new Map([[filePath, expectedGeneration]]);
		const texts = await this.readGenerationAlignedTexts(
			[filePath],
			expectedGenerations,
		);
		return texts.get(filePath);
	}

	async readGenerationAlignedTexts(
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

	async getIndexedSnapshotTexts(
		filePaths: string[],
		expectedGenerations?: ReadonlyMap<string, number | undefined>,
	): Promise<Map<string, string>> {
		return await this.readGenerationAlignedTexts(filePaths, expectedGenerations);
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

	private async clearIndexedShadowIfAligned(
		filePath: string,
		generation?: number,
	): Promise<void> {
		if (generation === undefined) {
			return;
		}
		const currentRow = await this.database.db.fileSnapshots.get(filePath);
		if (currentRow?.generation !== generation) {
			return;
		}
		await this.database.db.hybridDirtyShadows.delete(filePath);
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
