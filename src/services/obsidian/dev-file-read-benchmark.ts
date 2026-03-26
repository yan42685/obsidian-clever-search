import { promises as fs } from "node:fs";
import * as path from "node:path";
import Dexie from "dexie";
import {
	FileSystemAdapter,
	normalizePath,
	TFile,
	Vault,
} from "obsidian";
import { singleton } from "tsyringe";
import { getInstance } from "src/utils/my-lib";
import { DataProvider } from "./user-data/data-provider";
import { MyNotice } from "./transformed-api";

type BenchmarkFile = {
	path: string;
	size: number;
	file: TFile;
};

type ExternalBenchmarkFile = {
	vaultRelativePath: string;
	absolutePath: string;
	size: number;
};

type BenchmarkStats = {
	label: string;
	iterations: number;
	avgMs: number;
	p50Ms: number;
	p95Ms: number;
	totalChars: number;
};

type TempSnapshotRow = {
	filePath: string;
	text: string;
};

type PreloadBudgetSummary = {
	budgetMb: number;
	fileCount: number;
	cachedBytes: number;
	coverageRatio: number;
};

type FirstPassResult = {
	durationMs: number;
	totalChars: number;
	texts: TempSnapshotRow[];
};

type BigCorpusManifest = {
	fileCount?: number;
	totalBytes?: number;
	totalMiB?: number;
	files?: { path: string; bytes: number }[];
};

class TempSnapshotBenchmarkDb extends Dexie {
	snapshots!: Dexie.Table<TempSnapshotRow, string>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({
			snapshots: "filePath",
		});
	}
}

@singleton()
export class DevFileReadBenchmark {
	private static readonly MAX_FILE_COUNT = 128;
	private static readonly MAX_TOTAL_BYTES = 16 * 1024 * 1024;
	private static readonly PRELOAD_BUDGETS_MB = [2, 4, 8, 16, 32, 64];
	private static readonly LARGE_FILE_THRESHOLD_BYTES = 64 * 1024;
	private static readonly VAULT_WARM_ITERATIONS = 6;
	private static readonly BIG_CORPUS_ADAPTER_WARM_ITERATIONS = 2;
	private static readonly BIG_CORPUS_FS_WARM_ITERATIONS = 2;
	private static readonly DEXIE_ITERATIONS = 12;
	private static readonly BIG_CORPUS_DEXIE_ITERATIONS = 6;
	private static readonly MEMORY_ITERATIONS = 200;
	private static readonly BIG_CORPUS_MEMORY_ITERATIONS = 100;
	private static readonly BIG_CORPUS_MANIFEST_PATH =
		".obsidian/plugins/obsidian-clever-search/.codex-bench/corpora/big-vault-mixed-v1/manifest.json";

	private readonly vault = getInstance(Vault);
	private readonly dataProvider = getInstance(DataProvider);

	async run(): Promise<void> {
		const indexableFiles = this.dataProvider.allFilesToBeIndexed();
		if (indexableFiles.length === 0) {
			new MyNotice("No indexable files available for file-read benchmark.", 6000);
			return;
		}

		const benchmarkFiles = this.selectBenchmarkFiles(indexableFiles);
		if (benchmarkFiles.length === 0) {
			new MyNotice("No files selected for file-read benchmark.", 6000);
			return;
		}

		const totalVaultBytes = indexableFiles.reduce(
			(sum, file) => sum + file.stat.size,
			0,
		);
		const selectedBytes = benchmarkFiles.reduce((sum, file) => sum + file.size, 0);
		const coverageRatio =
			totalVaultBytes > 0 ? selectedBytes / totalVaultBytes : 0;

		const loadingNotice = new MyNotice(
			`Running file-read benchmark on ${benchmarkFiles.length} files...`,
			0,
		);

		try {
			const firstPass = await this.measureVaultFirstPass(benchmarkFiles);
			const memoryCache = new Map<string, string>(
				firstPass.texts.map((entry) => [entry.filePath, entry.text]),
			);

			const dexieDb = await this.createTempDexieDb(firstPass.texts);
			try {
				const [vaultWarm, dexieBulkGet, memoryMap] = await Promise.all([
					this.measureAsyncReads(
						"vault.cachedRead (warm)",
						DevFileReadBenchmark.VAULT_WARM_ITERATIONS,
						async () => await this.readAllViaVault(benchmarkFiles),
					),
					this.measureAsyncReads(
						"Dexie bulkGet (temp db)",
						DevFileReadBenchmark.DEXIE_ITERATIONS,
						async () =>
							await this.readAllViaDexie(
								dexieDb,
								benchmarkFiles.map((file) => file.path),
							),
					),
					this.measureSyncReads(
						"Map.get (memory)",
						DevFileReadBenchmark.MEMORY_ITERATIONS,
						() =>
							this.readAllViaMemory(
								memoryCache,
								benchmarkFiles.map((file) => file.path),
							),
					),
				]);

				const budgetSummary = this.buildPreloadBudgetSummary(
					indexableFiles.map((file) => file.stat.size),
				);
				this.logVaultBenchmarkResult({
					indexableFiles,
					benchmarkFiles,
					totalVaultBytes,
					selectedBytes,
					coverageRatio,
					firstPassMs: firstPass.durationMs,
					firstPassChars: firstPass.totalChars,
					vaultWarm,
					dexieBulkGet,
					memoryMap,
					budgetSummary,
				});

				loadingNotice.hide();
				new MyNotice(
					`File-read benchmark finished. Selected ${benchmarkFiles.length} files / ${this.formatBytes(selectedBytes)}. See console for details.`,
					8000,
				);
			} finally {
				await dexieDb.delete().catch(() => undefined);
			}
		} catch (error) {
			loadingNotice.hide();
			console.error("[clever-search] file-read benchmark failed", error);
			new MyNotice(
				`File-read benchmark failed: ${error instanceof Error ? error.message : String(error)}`,
				8000,
			);
		}
	}

	async runBigCorpus(): Promise<void> {
		const adapter = this.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			new MyNotice(
				"Big-corpus benchmark requires desktop FileSystemAdapter.",
				6000,
			);
			return;
		}

		const manifestPath = path.join(
			adapter.getBasePath(),
			DevFileReadBenchmark.BIG_CORPUS_MANIFEST_PATH,
		);

		let manifest: BigCorpusManifest;
		try {
			manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as BigCorpusManifest;
		} catch (error) {
			new MyNotice(
				`Big-corpus manifest missing. Run node scripts/sync-big-vault-corpus.mjs first. ${error instanceof Error ? error.message : String(error)}`,
				8000,
			);
			return;
		}

		const manifestFiles = manifest.files ?? [];
		if (manifestFiles.length === 0) {
			new MyNotice("Big-corpus manifest contains no files.", 6000);
			return;
		}

		const corpusRoot = path.dirname(manifestPath);
		const manifestDirInVault = path
			.dirname(DevFileReadBenchmark.BIG_CORPUS_MANIFEST_PATH)
			.replace(/\\/g, "/");
		const benchmarkFiles: ExternalBenchmarkFile[] = manifestFiles.map((file) => ({
			vaultRelativePath: normalizePath(`${manifestDirInVault}/${file.path}`),
			absolutePath: path.join(corpusRoot, file.path),
			size: file.bytes,
		}));

		const totalBytes =
			manifest.totalBytes ??
			benchmarkFiles.reduce((sum, file) => sum + file.size, 0);
		const totalMiB =
			manifest.totalMiB ?? Number((totalBytes / (1024 * 1024)).toFixed(2));

		const loadingNotice = new MyNotice(
			`Running big-corpus benchmark on ${benchmarkFiles.length} files...`,
			0,
		);

		try {
			const adapterFirstPass = await this.measureAdapterFirstPass(benchmarkFiles);
			const fsFirstPass = await this.measureNodeFsFirstPass(benchmarkFiles);
			const memoryCache = new Map<string, string>(
				fsFirstPass.texts.map((entry) => [entry.filePath, entry.text]),
			);
			const dexieDb = await this.createTempDexieDb(fsFirstPass.texts);

			try {
				const adapterWarm = await this.measureAsyncReads(
					"vault.adapter.read (warm)",
					DevFileReadBenchmark.BIG_CORPUS_ADAPTER_WARM_ITERATIONS,
					async () => await this.readAllViaAdapter(benchmarkFiles),
				);
				const nodeFsWarm = await this.measureAsyncReads(
					"fs.readFile (warm)",
					DevFileReadBenchmark.BIG_CORPUS_FS_WARM_ITERATIONS,
					async () => await this.readAllViaNodeFs(benchmarkFiles),
				);
				const dexieBulkGet = await this.measureAsyncReads(
					"Dexie bulkGet (temp db)",
					DevFileReadBenchmark.BIG_CORPUS_DEXIE_ITERATIONS,
					async () =>
						await this.readAllViaDexie(
							dexieDb,
							benchmarkFiles.map((file) => file.vaultRelativePath),
						),
				);
				const memoryMap = this.measureSyncReads(
					"Map.get (memory)",
					DevFileReadBenchmark.BIG_CORPUS_MEMORY_ITERATIONS,
					() =>
						this.readAllViaMemory(
							memoryCache,
							benchmarkFiles.map((file) => file.vaultRelativePath),
						),
				);

				const budgetSummary = this.buildPreloadBudgetSummary(
					benchmarkFiles.map((file) => file.size),
				);
				this.logBigCorpusBenchmarkResult({
					manifestPath,
					fileCount: benchmarkFiles.length,
					totalBytes,
					totalMiB,
					benchmarkFiles,
					adapterFirstPassMs: adapterFirstPass.durationMs,
					adapterFirstPassChars: adapterFirstPass.totalChars,
					fsFirstPassMs: fsFirstPass.durationMs,
					fsFirstPassChars: fsFirstPass.totalChars,
					adapterWarm,
					nodeFsWarm,
					dexieBulkGet,
					memoryMap,
					budgetSummary,
				});

				loadingNotice.hide();
				new MyNotice(
					`Big-corpus benchmark finished. ${benchmarkFiles.length} files / ${this.formatBytes(totalBytes)}. See console for details.`,
					8000,
				);
			} finally {
				await dexieDb.delete().catch(() => undefined);
			}
		} catch (error) {
			loadingNotice.hide();
			console.error("[clever-search] big-corpus file-read benchmark failed", error);
			new MyNotice(
				`Big-corpus benchmark failed: ${error instanceof Error ? error.message : String(error)}`,
				8000,
			);
		}
	}

	private selectBenchmarkFiles(files: readonly TFile[]): BenchmarkFile[] {
		const sorted = [...files]
			.sort((left, right) => right.stat.size - left.stat.size)
			.map((file) => ({
				path: file.path,
				size: file.stat.size,
				file,
			}));

		const selected: BenchmarkFile[] = [];
		let totalBytes = 0;
		for (const file of sorted) {
			if (selected.length >= DevFileReadBenchmark.MAX_FILE_COUNT) {
				break;
			}
			if (
				selected.length > 0 &&
				totalBytes + file.size > DevFileReadBenchmark.MAX_TOTAL_BYTES
			) {
				break;
			}
			selected.push(file);
			totalBytes += file.size;
		}

		if (selected.length === 0 && sorted[0]) {
			selected.push(sorted[0]);
		}

		return selected;
	}

	private async measureVaultFirstPass(
		files: readonly BenchmarkFile[],
	): Promise<FirstPassResult> {
		const startedAt = performance.now();
		const texts: TempSnapshotRow[] = [];
		let totalChars = 0;

		for (const file of files) {
			const text = await this.vault.cachedRead(file.file);
			texts.push({
				filePath: file.path,
				text,
			});
			totalChars += text.length;
		}

		return {
			durationMs: performance.now() - startedAt,
			totalChars,
			texts,
		};
	}

	private async measureAdapterFirstPass(
		files: readonly ExternalBenchmarkFile[],
	): Promise<FirstPassResult> {
		const startedAt = performance.now();
		const texts: TempSnapshotRow[] = [];
		let totalChars = 0;

		for (const file of files) {
			const text = await this.vault.adapter.read(file.vaultRelativePath);
			texts.push({
				filePath: file.vaultRelativePath,
				text,
			});
			totalChars += text.length;
		}

		return {
			durationMs: performance.now() - startedAt,
			totalChars,
			texts,
		};
	}

	private async measureNodeFsFirstPass(
		files: readonly ExternalBenchmarkFile[],
	): Promise<FirstPassResult> {
		const startedAt = performance.now();
		const texts: TempSnapshotRow[] = [];
		let totalChars = 0;

		for (const file of files) {
			const text = await fs.readFile(file.absolutePath, "utf8");
			texts.push({
				filePath: file.vaultRelativePath,
				text,
			});
			totalChars += text.length;
		}

		return {
			durationMs: performance.now() - startedAt,
			totalChars,
			texts,
		};
	}

	private async createTempDexieDb(
		rows: TempSnapshotRow[],
	): Promise<TempSnapshotBenchmarkDb> {
		const dbName = `clever-search-dev-read-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const db = new TempSnapshotBenchmarkDb(dbName);
		await db.open();
		await db.snapshots.bulkPut(rows);
		return db;
	}

	private async measureAsyncReads(
		label: string,
		iterations: number,
		readAll: () => Promise<number>,
	): Promise<BenchmarkStats> {
		const times: number[] = [];
		let totalChars = 0;

		for (let index = 0; index < iterations; index++) {
			const startedAt = performance.now();
			totalChars = await readAll();
			times.push(performance.now() - startedAt);
		}

		return this.buildStats(label, iterations, times, totalChars);
	}

	private measureSyncReads(
		label: string,
		iterations: number,
		readAll: () => number,
	): BenchmarkStats {
		const times: number[] = [];
		let totalChars = 0;

		for (let index = 0; index < iterations; index++) {
			const startedAt = performance.now();
			totalChars = readAll();
			times.push(performance.now() - startedAt);
		}

		return this.buildStats(label, iterations, times, totalChars);
	}

	private buildStats(
		label: string,
		iterations: number,
		times: number[],
		totalChars: number,
	): BenchmarkStats {
		const sorted = [...times].sort((left, right) => left - right);
		const avgMs =
			times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
		return {
			label,
			iterations,
			avgMs,
			p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
			p95Ms:
				sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
				0,
			totalChars,
		};
	}

	private async readAllViaVault(files: readonly BenchmarkFile[]): Promise<number> {
		let totalChars = 0;
		for (const file of files) {
			totalChars += (await this.vault.cachedRead(file.file)).length;
		}
		return totalChars;
	}

	private async readAllViaAdapter(
		files: readonly ExternalBenchmarkFile[],
	): Promise<number> {
		let totalChars = 0;
		for (const file of files) {
			totalChars += (await this.vault.adapter.read(file.vaultRelativePath)).length;
		}
		return totalChars;
	}

	private async readAllViaNodeFs(
		files: readonly ExternalBenchmarkFile[],
	): Promise<number> {
		let totalChars = 0;
		for (const file of files) {
			totalChars += (await fs.readFile(file.absolutePath, "utf8")).length;
		}
		return totalChars;
	}

	private async readAllViaDexie(
		db: TempSnapshotBenchmarkDb,
		filePaths: readonly string[],
	): Promise<number> {
		const rows = await db.snapshots.bulkGet([...filePaths]);
		let totalChars = 0;
		for (const row of rows) {
			totalChars += row?.text.length ?? 0;
		}
		return totalChars;
	}

	private readAllViaMemory(
		cache: ReadonlyMap<string, string>,
		filePaths: readonly string[],
	): number {
		let totalChars = 0;
		for (const filePath of filePaths) {
			totalChars += cache.get(filePath)?.length ?? 0;
		}
		return totalChars;
	}

	private buildPreloadBudgetSummary(
		sizes: readonly number[],
	): PreloadBudgetSummary[] {
		const sortedSizes = [...sizes].sort((left, right) => right - left);
		const totalBytes = sortedSizes.reduce((sum, size) => sum + size, 0);

		return DevFileReadBenchmark.PRELOAD_BUDGETS_MB.map((budgetMb) => {
			const budgetBytes = budgetMb * 1024 * 1024;
			let cachedBytes = 0;
			let fileCount = 0;
			for (const size of sortedSizes) {
				if (fileCount > 0 && cachedBytes + size > budgetBytes) {
					break;
				}
				cachedBytes += size;
				fileCount += 1;
			}
			return {
				budgetMb,
				fileCount,
				cachedBytes,
				coverageRatio: totalBytes > 0 ? cachedBytes / totalBytes : 0,
			};
		});
	}

	private logVaultBenchmarkResult(params: {
		indexableFiles: readonly TFile[];
		benchmarkFiles: readonly BenchmarkFile[];
		totalVaultBytes: number;
		selectedBytes: number;
		coverageRatio: number;
		firstPassMs: number;
		firstPassChars: number;
		vaultWarm: BenchmarkStats;
		dexieBulkGet: BenchmarkStats;
		memoryMap: BenchmarkStats;
		budgetSummary: PreloadBudgetSummary[];
	}): void {
		const {
			indexableFiles,
			benchmarkFiles,
			totalVaultBytes,
			selectedBytes,
			coverageRatio,
			firstPassMs,
			firstPassChars,
			vaultWarm,
			dexieBulkGet,
			memoryMap,
			budgetSummary,
		} = params;

		const largeFileCount = indexableFiles.filter(
			(file) => file.stat.size >= DevFileReadBenchmark.LARGE_FILE_THRESHOLD_BYTES,
		).length;

		console.groupCollapsed("[clever-search] Dev file-read benchmark");
		this.printSection("summary", {
			indexableFiles: indexableFiles.length,
			selectedFiles: benchmarkFiles.length,
			selectedBytes: this.formatBytes(selectedBytes),
			totalVaultBytes: this.formatBytes(totalVaultBytes),
			selectionCoverage: `${(coverageRatio * 100).toFixed(1)}%`,
			largeFilesOver64KB: largeFileCount,
			selectionMode:
				totalVaultBytes <= DevFileReadBenchmark.MAX_TOTAL_BYTES &&
				indexableFiles.length <= DevFileReadBenchmark.MAX_FILE_COUNT
					? "full"
					: "largest-first sample",
		});

		this.printSection("read timings", [
			this.buildFirstPassRow("vault.cachedRead (first pass)", firstPassMs, firstPassChars),
			this.toConsoleRow(vaultWarm),
			this.toConsoleRow(dexieBulkGet),
			this.toConsoleRow(memoryMap),
		]);

		this.printSection(
			"preload budget coverage",
			budgetSummary.map((item) => ({
				preloadBudget: `${item.budgetMb} MB`,
				fileCount: item.fileCount,
				cachedBytes: this.formatBytes(item.cachedBytes),
				vaultCoverage: `${(item.coverageRatio * 100).toFixed(1)}%`,
			})),
		);

		this.printSection(
			"largest selected files",
			benchmarkFiles.slice(0, 12).map((file) => ({
				path: file.path,
				size: this.formatBytes(file.size),
			})),
		);

		this.printSection(
			"notes",
			[
				"Full lexical rebuild / addDocuments reads source files via DataProvider -> FileSnapshotStore -> vault.cachedRead.",
				"After indexing, passage-bm25 search usually slices passage text from in-memory current snapshots instead of re-reading vault files.",
				"Runtime incremental updates normally read only changed files; search-time file IO is usually not the main bottleneck.",
			],
		);
		console.groupEnd();
	}

	private logBigCorpusBenchmarkResult(params: {
		manifestPath: string;
		fileCount: number;
		totalBytes: number;
		totalMiB: number;
		benchmarkFiles: readonly ExternalBenchmarkFile[];
		adapterFirstPassMs: number;
		adapterFirstPassChars: number;
		fsFirstPassMs: number;
		fsFirstPassChars: number;
		adapterWarm: BenchmarkStats;
		nodeFsWarm: BenchmarkStats;
		dexieBulkGet: BenchmarkStats;
		memoryMap: BenchmarkStats;
		budgetSummary: PreloadBudgetSummary[];
	}): void {
		const {
			manifestPath,
			fileCount,
			totalBytes,
			totalMiB,
			benchmarkFiles,
			adapterFirstPassMs,
			adapterFirstPassChars,
			fsFirstPassMs,
			fsFirstPassChars,
			adapterWarm,
			nodeFsWarm,
			dexieBulkGet,
			memoryMap,
			budgetSummary,
		} = params;

		console.groupCollapsed("[clever-search] Dev big-corpus file-read benchmark");
		this.printSection("summary", {
			fileCount,
			totalBytes: this.formatBytes(totalBytes),
			totalMiB,
			manifestPath,
		});

		this.printSection("read timings", [
			this.buildFirstPassRow(
				"vault.adapter.read (first pass)",
				adapterFirstPassMs,
				adapterFirstPassChars,
			),
			this.buildFirstPassRow(
				"fs.readFile (first pass)",
				fsFirstPassMs,
				fsFirstPassChars,
			),
			this.toConsoleRow(adapterWarm),
			this.toConsoleRow(nodeFsWarm),
			this.toConsoleRow(dexieBulkGet),
			this.toConsoleRow(memoryMap),
		]);

		this.printSection(
			"preload budget coverage",
			budgetSummary.map((item) => ({
				preloadBudget: `${item.budgetMb} MB`,
				fileCount: item.fileCount,
				cachedBytes: this.formatBytes(item.cachedBytes),
				corpusCoverage: `${(item.coverageRatio * 100).toFixed(1)}%`,
			})),
		);

		this.printSection(
			"largest files",
			[...benchmarkFiles]
				.sort((left, right) => right.size - left.size)
				.slice(0, 12)
				.map((file) => ({
					path: file.vaultRelativePath,
					size: this.formatBytes(file.size),
				})),
		);

		this.printSection(
			"notes",
			[
				"This corpus lives under the plugin-local .codex-bench cache, so it is not modeled as Obsidian TFile objects.",
				"Because of that, this benchmark uses vault.adapter.read instead of vault.cachedRead to avoid polluting the user's vault with 10k+ markdown files.",
				"Use this benchmark to compare adapter/file-system/Dexie/memory read costs under the Obsidian runtime on a realistic large corpus.",
			],
		);
		console.groupEnd();
	}

	private buildFirstPassRow(
		label: string,
		durationMs: number,
		totalChars: number,
	): Record<string, string | number> {
		const fixed = durationMs.toFixed(3);
		return {
			label,
			iterations: 1,
			avgMs: fixed,
			p50Ms: fixed,
			p95Ms: fixed,
			totalChars,
		};
	}

	private toConsoleRow(stats: BenchmarkStats): Record<string, string | number> {
		return {
			label: stats.label,
			iterations: stats.iterations,
			avgMs: stats.avgMs.toFixed(3),
			p50Ms: stats.p50Ms.toFixed(3),
			p95Ms: stats.p95Ms.toFixed(3),
			totalChars: stats.totalChars,
		};
	}

	private printSection(title: string, value: unknown): void {
		console.log(`[clever-search] ${title}`);
		console.log(JSON.stringify(value, null, 2));
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const units = ["KB", "MB", "GB"];
		let value = bytes / 1024;
		let unitIndex = 0;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex++;
		}
		return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
	}
}
