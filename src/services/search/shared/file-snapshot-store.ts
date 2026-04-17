import { TFile, Vault, htmlToMarkdown } from "obsidian";
import type { HybridIndexedFileRef } from "src/services/search/hybrid/hybrid-store";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { Database } from "src/services/database/database";

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

type CurrentFileEntry = {
	path: string;
	slot: number;
	text: string;
	generation?: number;
};

export type FileSnapshotRuntimeMemoryEstimate = {
	capacityBytes: number;
	pathBytes: number;
	currentTextBytes: number;
	generationBytes: number;
	fileCount: number;
	slotCount: number;
	freeSlotCount: number;
	totalBytes: number;
	largestEntries: Array<{
		path: string;
		totalBytes: number;
		pathBytes: number;
		textBytes: number;
		generationBytes: number;
	}>;
};

export type FileSnapshotAvailabilityDebugInfo = Readonly<{
	path: string;
	expectedGeneration?: number;
	fileExists: boolean;
	fileMtime?: number;
	currentGeneration?: number;
	persistedGeneration?: number;
	shadowGeneration?: number;
	currentGenerationMatch: boolean;
	persistedGenerationMatch: boolean;
	shadowGenerationMatch: boolean;
}>;

@singleton()
export class FileSnapshotStore {
	private static readonly INDEXED_SNAPSHOT_SCAN_BATCH_SIZE = 256;
	private static readonly RUNTIME_REPORT_TOP_ENTRY_LIMIT = 5;
	private static readonly CURRENT_TEXT_CACHE_CAPACITY_BYTES = 32 * 1024 * 1024;
	private static readonly STRING_CODE_UNIT_BYTES = 2;
	private static readonly GENERATION_BYTES = 8;
	private readonly vault = getInstance(Vault);
	private readonly currentFilePathToSlot = new Map<string, number>();
	private readonly currentFileLru = new Map<string, true>();
	private readonly currentSlotTexts: Array<string | undefined> = [];
	private readonly currentSlotGenerations: Array<number | undefined> = [];
	private readonly currentSlotBytes: Array<number | undefined> = [];
	private readonly freeCurrentSlots: number[] = [];
	private currentRuntimeBytes = 0;

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

	async inspectIndexedTextAvailability(
		path: string,
		expectedGeneration?: number,
	): Promise<FileSnapshotAvailabilityDebugInfo> {
		const file = this.resolveFile(path);
		const current = this.getCurrentFile(path, false);
		const [persistedRow, shadowRow] = await Promise.all([
			this.database.db.fileSnapshots.get(path),
			this.database.db.hybridDirtyShadows.get(path),
		]);
		return {
			path,
			expectedGeneration,
			fileExists: file instanceof TFile,
			fileMtime: file instanceof TFile ? file.stat.mtime : undefined,
			currentGeneration: current?.generation,
			persistedGeneration: persistedRow?.generation,
			shadowGeneration: shadowRow?.generation,
			currentGenerationMatch: this.isGenerationMatch(
				current?.generation,
				expectedGeneration,
			),
			persistedGenerationMatch: this.isGenerationMatch(
				persistedRow?.generation,
				expectedGeneration,
			),
			shadowGenerationMatch: this.isGenerationMatch(
				shadowRow?.generation,
				expectedGeneration,
			),
		};
	}

	async publishIndexedTexts(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		await this.commitCurrentFilesAsIndexed(files);
	}

	async notifyHybridIndexedRefsChanged(
		filePaths?: readonly string[],
	): Promise<void> {
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

	async putHybridIndexedFileRef(ref: HybridIndexedFileRef): Promise<void> {
		await this.database.db.hybridIndexedFileRefs.put(ref);
		if (ref.state !== "pending") {
			await this.notifyHybridIndexedRefsChanged([ref.path]);
		}
	}

	async getHybridIndexedFileRef(
		filePath: string,
	): Promise<HybridIndexedFileRef | undefined> {
		return await this.database.db.hybridIndexedFileRefs.get(filePath);
	}

	async getHybridIndexedFileRefs(
		filePaths: readonly string[],
	): Promise<Map<string, HybridIndexedFileRef>> {
		const uniquePaths = Array.from(new Set(filePaths));
		if (uniquePaths.length === 0) {
			return new Map<string, HybridIndexedFileRef>();
		}
		const rows = await this.database.db.hybridIndexedFileRefs.bulkGet(uniquePaths);
		const refs = new Map<string, HybridIndexedFileRef>();
		for (let index = 0; index < uniquePaths.length; index++) {
			const row = rows[index];
			if (row) {
				refs.set(uniquePaths[index], row);
			}
		}
		return refs;
	}

	async listHybridIndexedFileRefs(): Promise<HybridIndexedFileRef[]> {
		return await this.database.db.hybridIndexedFileRefs.toArray();
	}

	async deleteHybridIndexedFileRef(filePath: string): Promise<void> {
		await this.database.db.hybridIndexedFileRefs.delete(filePath);
		await this.notifyHybridIndexedRefsChanged([filePath]);
	}

	async clearHybridIndexedFileRefs(): Promise<void> {
		await this.database.db.hybridIndexedFileRefs.clear();
		await this.notifyHybridIndexedRefsChanged();
	}

	async removeFiles(filePaths: readonly string[]): Promise<void> {
		for (const filePath of filePaths) {
			this.deleteCurrentFile(filePath);
		}
		await this.deletePersistedFiles(filePaths);
	}

	async retainOnlyFiles(validPaths: ReadonlySet<string>): Promise<void> {
		for (const path of Array.from(this.currentFilePathToSlot.keys())) {
			if (!validPaths.has(path)) {
				this.deleteCurrentFile(path);
			}
		}
		await this.deleteRowsNotIn(
			() => this.database.db.fileSnapshots,
			(paths) => this.database.db.fileSnapshots.bulkDelete(paths),
			validPaths,
			(row: { filePath: string }) => row.filePath,
		);
		await this.deleteRowsNotIn(
			() => this.database.db.hybridIndexedFileRefs,
			(paths) => this.database.db.hybridIndexedFileRefs.bulkDelete(paths),
			validPaths,
			(row: { path: string }) => row.path,
		);
		await this.deleteRowsNotIn(
			() => this.database.db.hybridDirtyShadows,
			(paths) => this.database.db.hybridDirtyShadows.bulkDelete(paths),
			validPaths,
			(row: { filePath: string }) => row.filePath,
		);
	}

	private async readSearchableFileText(fileOrPath: TFile | string): Promise<string> {
		const file = this.resolveFile(fileOrPath);
		if (!(file instanceof TFile)) {
			return "";
		}
		const current = this.getCurrentFile(file.path);
		const cachedText = current?.text;
		const cachedGeneration = current?.generation;
		if (
			cachedText !== undefined &&
			(cachedGeneration === undefined ||
				file.stat.mtime === undefined ||
				cachedGeneration >= file.stat.mtime)
		) {
			return cachedText;
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
		const current = this.getCurrentFile(file.path);
		const cachedText = current?.text;
		const cachedGeneration = current?.generation;
		if (
			cachedText !== undefined &&
			(cachedGeneration === undefined ||
				file.stat.mtime === undefined ||
				cachedGeneration >= file.stat.mtime)
		) {
			return cachedText;
		}
		const plainText = await this.vault.cachedRead(file);
		const normalized =
			file.extension === "html" ? this.normalizeHtmlToText(plainText) : plainText;
		return this.writeCurrentFileText(file.path, normalized, file.stat.mtime);
	}

	resetRuntimeState(): void {
		this.currentFilePathToSlot.clear();
		this.currentFileLru.clear();
		this.currentSlotTexts.length = 0;
		this.currentSlotGenerations.length = 0;
		this.currentSlotBytes.length = 0;
		this.freeCurrentSlots.length = 0;
		this.currentRuntimeBytes = 0;
	}

	private writeCurrentFileText(
		path: string,
		text: string,
		generation?: number,
	): string {
		const existing = this.getCurrentFile(path, false);
		const existingText = existing?.text;
		const existingGeneration = existing?.generation;
		if (
			existingText !== undefined &&
			!this.shouldReplaceCurrentEntry(existingGeneration, generation)
		) {
			this.touchCurrentFile(path);
			return existingText;
		}
		const entryBytes = this.estimateCurrentEntryBytes(path, text, generation);
		if (
			entryBytes >
			FileSnapshotStore.CURRENT_TEXT_CACHE_CAPACITY_BYTES
		) {
			this.deleteCurrentFile(path);
			return text;
		}
		const slot = this.ensureCurrentSlot(path);
		const previousBytes = this.currentSlotBytes[slot] ?? 0;
		this.currentSlotTexts[slot] = text;
		this.currentSlotGenerations[slot] = generation;
		this.currentSlotBytes[slot] = entryBytes;
		this.currentRuntimeBytes += entryBytes - previousBytes;
		this.touchCurrentFile(path);
		this.enforceCurrentTextCacheBudget();
		return text;
	}

	private deleteCurrentFile(path: string): void {
		const slot = this.currentFilePathToSlot.get(path);
		if (slot === undefined) {
			return;
		}
		this.currentFilePathToSlot.delete(path);
		this.currentFileLru.delete(path);
		this.currentRuntimeBytes = Math.max(
			0,
			this.currentRuntimeBytes - (this.currentSlotBytes[slot] ?? 0),
		);
		this.currentSlotTexts[slot] = undefined;
		this.currentSlotGenerations[slot] = undefined;
		this.currentSlotBytes[slot] = undefined;
		if (slot === this.currentSlotTexts.length - 1) {
			this.trimTrailingCurrentSlots();
			return;
		}
		this.freeCurrentSlots.push(slot);
	}

	getRuntimeMemoryEstimate(): FileSnapshotRuntimeMemoryEstimate {
		let pathBytes = 0;
		let currentTextBytes = 0;
		let generationBytes = 0;
		const largestEntries: FileSnapshotRuntimeMemoryEstimate["largestEntries"] = [];

		for (const [path, slot] of this.currentFilePathToSlot) {
			const text = this.currentSlotTexts[slot];
			if (text === undefined) {
				continue;
			}
			const entryPathBytes = this.estimateStringBytes(path);
			const entryTextBytes = this.estimateStringBytes(text);
			const entryGenerationBytes =
				this.currentSlotGenerations[slot] !== undefined
					? FileSnapshotStore.GENERATION_BYTES
					: 0;
			pathBytes += entryPathBytes;
			currentTextBytes += entryTextBytes;
			generationBytes += entryGenerationBytes;
			largestEntries.push({
				path,
				totalBytes: entryPathBytes + entryTextBytes + entryGenerationBytes,
				pathBytes: entryPathBytes,
				textBytes: entryTextBytes,
				generationBytes: entryGenerationBytes,
			});
		}

		largestEntries.sort((left, right) => right.totalBytes - left.totalBytes);

		return {
			capacityBytes: FileSnapshotStore.CURRENT_TEXT_CACHE_CAPACITY_BYTES,
			pathBytes,
			currentTextBytes,
			generationBytes,
			fileCount: this.currentFilePathToSlot.size,
			slotCount: this.currentSlotTexts.length,
			freeSlotCount: this.freeCurrentSlots.length,
			totalBytes: this.currentRuntimeBytes,
			largestEntries: largestEntries.slice(
				0,
				FileSnapshotStore.RUNTIME_REPORT_TOP_ENTRY_LIMIT,
			),
		};
	}

	private async commitCurrentFilesAsIndexed(
		files: ReadonlyArray<IndexedTextPublishRequest>,
	): Promise<void> {
		await this.ensureCurrentEntriesForPublish(files);
		const rows: PersistedFileSnapshotRow[] = [];
		const persistedFiles: Array<{ path: string; generation?: number }> = [];
		for (const file of files) {
			const candidate = this.resolveIndexedPublishCandidate(file);
			if (!candidate) {
				continue;
			}
			rows.push({
				filePath: file.path,
				plainText: candidate.text,
				generation: candidate.generation,
			});
			persistedFiles.push({
				path: file.path,
				generation: candidate.generation,
			});
		}
		if (rows.length === 0) {
			return;
		}
		await this.preserveIndexedGenerationShadows(persistedFiles);
		await this.database.db.fileSnapshots.bulkPut(rows);
	}

	private resolveIndexedPublishCandidate(
		file: IndexedTextPublishRequest,
	): { text: string; generation?: number } | undefined {
		if (file.text !== undefined) {
			return {
				text: file.text,
				generation: file.generation ?? this.getCurrentFileGeneration(file.path),
			};
		}

		const current = this.getCurrentFile(file.path);
		if (!current || !this.isGenerationMatch(current.generation, file.generation)) {
			return undefined;
		}

		return {
			text: current.text,
			generation: file.generation ?? current.generation,
		};
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
			const current = this.getCurrentFile(filePath);
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
			const currentText = this.getCurrentFileText(file.path);
			const currentGeneration = this.getCurrentFileGeneration(file.path);
			if (
				currentText !== undefined &&
				this.isGenerationMatch(currentGeneration, file.generation)
			) {
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

	private getCurrentFile(
		path: string,
		touch = true,
	): CurrentFileEntry | undefined {
		const slot = this.currentFilePathToSlot.get(path);
		if (slot === undefined) {
			return undefined;
		}
		const text = this.currentSlotTexts[slot];
		if (text === undefined) {
			return undefined;
		}
		if (touch) {
			this.touchCurrentFile(path);
		}
		return {
			path,
			slot,
			text,
			generation: this.currentSlotGenerations[slot],
		};
	}

	private getCurrentFileText(path: string): string | undefined {
		return this.getCurrentFile(path)?.text;
	}

	private getCurrentFileGeneration(path: string): number | undefined {
		return this.getCurrentFile(path)?.generation;
	}

	private ensureCurrentSlot(path: string): number {
		const existingSlot = this.currentFilePathToSlot.get(path);
		if (existingSlot !== undefined) {
			return existingSlot;
		}
		const recycledSlot = this.freeCurrentSlots.pop();
		if (recycledSlot !== undefined) {
			this.currentFilePathToSlot.set(path, recycledSlot);
			return recycledSlot;
		}
		const nextSlot = this.currentSlotTexts.length;
		this.currentFilePathToSlot.set(path, nextSlot);
		this.currentSlotTexts.push(undefined);
		this.currentSlotGenerations.push(undefined);
		this.currentSlotBytes.push(undefined);
		return nextSlot;
	}

	private trimTrailingCurrentSlots(): void {
		while (this.currentSlotTexts.length > 0) {
			const lastSlot = this.currentSlotTexts.length - 1;
			if (this.currentSlotTexts[lastSlot] !== undefined) {
				return;
			}
			this.currentSlotTexts.pop();
			this.currentSlotGenerations.pop();
			this.currentSlotBytes.pop();
			const freeSlotIndex = this.freeCurrentSlots.lastIndexOf(lastSlot);
			if (freeSlotIndex >= 0) {
				this.freeCurrentSlots.splice(freeSlotIndex, 1);
			}
		}
	}

	private touchCurrentFile(path: string): void {
		if (!this.currentFilePathToSlot.has(path)) {
			return;
		}
		this.currentFileLru.delete(path);
		this.currentFileLru.set(path, true);
	}

	private enforceCurrentTextCacheBudget(): void {
		while (
			this.currentRuntimeBytes >
			FileSnapshotStore.CURRENT_TEXT_CACHE_CAPACITY_BYTES
		) {
			const oldestPath = this.currentFileLru.keys().next().value;
			if (typeof oldestPath !== "string") {
				return;
			}
			this.deleteCurrentFile(oldestPath);
		}
	}

	private estimateCurrentEntryBytes(
		path: string,
		text: string,
		generation?: number,
	): number {
		return (
			this.estimateStringBytes(path) +
			this.estimateStringBytes(text) +
			(generation !== undefined ? FileSnapshotStore.GENERATION_BYTES : 0)
		);
	}

	private estimateStringBytes(value: string): number {
		return value.length * FileSnapshotStore.STRING_CODE_UNIT_BYTES;
	}

	private async deleteRowsNotIn(
		getTable: () => { orderBy: (index: string) => any; where: (index: string) => any },
		deleteRows: (paths: string[]) => Promise<void>,
		validPaths: ReadonlySet<string>,
		getPath: (row: any) => string,
	): Promise<void> {
		let lastPath: string | null = null;
		while (true) {
			const rows: any[] =
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
				.map((row) => getPath(row))
				.filter((path) => !validPaths.has(path));
			if (stalePaths.length > 0) {
				await deleteRows(stalePaths);
			}

			lastPath = getPath(rows[rows.length - 1]);
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
