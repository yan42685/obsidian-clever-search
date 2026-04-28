// @ts-nocheck
import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import { container } from "tsyringe";
import { registerProductionTokenizerStartupDependencies } from "./coverage-lexical-v3-startup-production-tokenizer";

const mockBenchmarkTextEncoder = new TextEncoder();

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

jest.mock("src/services/database/database", () => ({
	Database: class MockDatabase {},
}));

type PersistedLexicalColdEvidenceStats = {
	bodyEvidenceBytes: number;
	hanDocEvidenceBytes: number;
	hanBodyEvidenceBytes: number;
	fuzzyRescueBytes: number;
	bodyEvidenceRows: number;
	hanDocEvidenceRows: number;
	hanBodyEvidenceRows: number;
};

const mockPersistedLexicalColdEvidenceStats: PersistedLexicalColdEvidenceStats = {
	bodyEvidenceBytes: 0,
	hanDocEvidenceBytes: 0,
	hanBodyEvidenceBytes: 0,
	fuzzyRescueBytes: 0,
	bodyEvidenceRows: 0,
	hanDocEvidenceRows: 0,
	hanBodyEvidenceRows: 0,
};

function resetPersistedLexicalColdEvidenceStats(): void {
	mockPersistedLexicalColdEvidenceStats.bodyEvidenceBytes = 0;
	mockPersistedLexicalColdEvidenceStats.hanDocEvidenceBytes = 0;
	mockPersistedLexicalColdEvidenceStats.hanBodyEvidenceBytes = 0;
	mockPersistedLexicalColdEvidenceStats.fuzzyRescueBytes = 0;
	mockPersistedLexicalColdEvidenceStats.bodyEvidenceRows = 0;
	mockPersistedLexicalColdEvidenceStats.hanDocEvidenceRows = 0;
	mockPersistedLexicalColdEvidenceStats.hanBodyEvidenceRows = 0;
}

function mockBuildBenchmarkLexicalDocEvidenceRowId(locator: {
	shardId?: string;
	shardGeneration?: number;
	docRef: number;
	generation: number;
}): string {
	if (locator.shardId != null && locator.shardGeneration != null) {
		return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}`;
	}
	return `${locator.docRef}:${locator.generation}`;
}

function mockBuildBenchmarkLexicalBlockEvidenceRowId(locator: {
	shardId?: string;
	shardGeneration?: number;
	docRef: number;
	generation: number;
	blockOrdinal: number;
}): string {
	if (locator.shardId != null && locator.shardGeneration != null) {
		return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}:${locator.blockOrdinal}`;
	}
	return `${locator.docRef}:${locator.generation}:${locator.blockOrdinal}`;
}

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	buildLexicalDocEvidenceRowId(locator: {
		shardId?: string;
		shardGeneration?: number;
		docRef: number;
		generation: number;
	}): string {
		return mockBuildBenchmarkLexicalDocEvidenceRowId(locator);
	},
	buildLexicalBlockEvidenceRowId(locator: {
		shardId?: string;
		shardGeneration?: number;
		docRef: number;
		generation: number;
		blockOrdinal: number;
	}): string {
		return mockBuildBenchmarkLexicalBlockEvidenceRowId(locator);
	},
	FileSnapshotStore: class MockFileSnapshotStore {
		publishLexicalBodyEvidence(rows: readonly unknown[]): Promise<void> {
			mockPersistedLexicalColdEvidenceStats.bodyEvidenceRows += rows.length;
			mockPersistedLexicalColdEvidenceStats.bodyEvidenceBytes +=
				mockEstimateBenchmarkValueBytes(rows);
			return Promise.resolve();
		}

		publishLexicalHanDocEvidence(rows: readonly unknown[]): Promise<void> {
			mockPersistedLexicalColdEvidenceStats.hanDocEvidenceRows += rows.length;
			mockPersistedLexicalColdEvidenceStats.hanDocEvidenceBytes +=
				mockEstimateBenchmarkValueBytes(rows);
			return Promise.resolve();
		}

		publishLexicalHanBodyEvidence(rows: readonly unknown[]): Promise<void> {
			mockPersistedLexicalColdEvidenceStats.hanBodyEvidenceRows += rows.length;
			mockPersistedLexicalColdEvidenceStats.hanBodyEvidenceBytes +=
				mockEstimateBenchmarkValueBytes(rows);
			return Promise.resolve();
		}

		publishLexicalFuzzyRescue(sidecar: unknown): Promise<void> {
			mockPersistedLexicalColdEvidenceStats.fuzzyRescueBytes =
				mockEstimateBenchmarkValueBytes(sidecar);
			return Promise.resolve();
		}
	},
}));

const previousFixtureImportEnv = process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";
const v3FixtureModule = require("./coverage-lexical-automation-fixture") as {
	round(value: number): number;
};
if (previousFixtureImportEnv === undefined) {
	delete process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
} else {
	process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = previousFixtureImportEnv;
}

const { round } = v3FixtureModule;

type VaultBenchmarkDocument = {
	path: string;
	basename: string;
	folder: string;
	generation: number;
	content: string;
	docRef: number;
};

class BenchmarkArtifactTable<Row extends Record<string, unknown>> {
	private readonly rows = new Map<string, Row>();

	constructor(private readonly keyOf: (row: Row) => string) {}

	async get(key: string): Promise<Row | undefined> {
		return this.rows.get(key);
	}

	async put(row: Row): Promise<void> {
		this.rows.set(this.keyOf(row), row);
	}

	async delete(key: string): Promise<void> {
		this.rows.delete(key);
	}

	values(): Row[] {
		return [...this.rows.values()];
	}

	estimateBytes(): number {
		return mockEstimateBenchmarkValueBytes(this.values());
	}
}

function mockEstimateBenchmarkValueBytes(
	value: unknown,
	visited = new WeakSet<object>(),
): number {
	if (value === null || value === undefined) {
		return 0;
	}
	if (typeof value === "string") {
		return mockBenchmarkTextEncoder.encode(value).length;
	}
	if (typeof value === "number") {
		return 8;
	}
	if (typeof value === "boolean") {
		return 4;
	}
	if (typeof value === "bigint") {
		return mockBenchmarkTextEncoder.encode(value.toString()).length;
	}
	if (value instanceof Date) {
		return mockBenchmarkTextEncoder.encode(value.toISOString()).length;
	}
	if (value instanceof ArrayBuffer) {
		return value.byteLength;
	}
	if (ArrayBuffer.isView(value)) {
		return value.byteLength;
	}
	if (Array.isArray(value)) {
		return value.reduce(
			(sum, item) => sum + mockEstimateBenchmarkValueBytes(item, visited),
			0,
		);
	}
	if (value instanceof Map) {
		if (visited.has(value)) {
			return 0;
		}
		visited.add(value);
		return [...value.entries()].reduce(
			(sum, [key, childValue]) =>
				sum +
				mockEstimateBenchmarkValueBytes(key, visited) +
				mockEstimateBenchmarkValueBytes(childValue, visited),
			0,
		);
	}
	if (typeof value === "object") {
		if (visited.has(value)) {
			return 0;
		}
		visited.add(value);
		return Object.entries(value).reduce(
			(sum, [key, childValue]) =>
				sum +
				mockBenchmarkTextEncoder.encode(key).length +
				mockEstimateBenchmarkValueBytes(childValue, visited),
			0,
		);
	}
	return mockBenchmarkTextEncoder.encode(String(value)).length;
}

function defaultVaultRoot(): string {
	return path.resolve(process.cwd(), "../../..");
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
	return path.relative(vaultRoot, absolutePath).replace(/\\/g, "/");
}

function shouldSkipDirectory(relativePath: string): boolean {
	const normalized = relativePath.replace(/\\/g, "/");
	if (normalized.length === 0) {
		return false;
	}
	const segments = normalized.split("/");
	if (segments.includes("node_modules")) {
		return true;
	}
	if (segments.includes(".git")) {
		return true;
	}
	if (segments.includes(".codex-bench")) {
		return true;
	}
	if (segments.includes("tmp")) {
		return true;
	}
	if (normalized === ".obsidian") {
		return true;
	}
	return normalized.startsWith(".obsidian/");
}

function collectMarkdownFiles(vaultRoot: string): string[] {
	const files: string[] = [];
	const visit = (directory: string) => {
		const relativeDirectory = toVaultRelativePath(vaultRoot, directory);
		if (shouldSkipDirectory(relativeDirectory)) {
			return;
		}
		const entries = fs.readdirSync(directory, { withFileTypes: true });
		for (const entry of entries) {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
				continue;
			}
			if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
				files.push(absolutePath);
			}
		}
	};
	visit(vaultRoot);
	return files.sort((left, right) =>
		toVaultRelativePath(vaultRoot, left).localeCompare(
			toVaultRelativePath(vaultRoot, right),
		),
	);
}

function loadVaultDocuments(vaultRoot: string): VaultBenchmarkDocument[] {
	return collectMarkdownFiles(vaultRoot).map((absolutePath, index) => {
		const content = fs.readFileSync(absolutePath, "utf8");
		const relativePath = toVaultRelativePath(vaultRoot, absolutePath);
		const parsedPath = path.posix.parse(relativePath);
		const stat = fs.statSync(absolutePath);
		return {
			path: relativePath,
			basename: parsedPath.name,
			folder: parsedPath.dir,
			generation: Math.max(1, Math.round(stat.mtimeMs)),
			content,
			docRef: index + 1,
		};
	});
}

function summarizeMarkdownBytes(documents: readonly VaultBenchmarkDocument[]) {
	const byteCounts = documents
		.map((document) => mockBenchmarkTextEncoder.encode(document.content).length)
		.sort((left, right) => left - right);
	const totalBytes = byteCounts.reduce((sum, bytes) => sum + bytes, 0);
	const percentile = (ratio: number) => {
		if (byteCounts.length === 0) {
			return 0;
		}
		const index = Math.min(
			byteCounts.length - 1,
			Math.max(0, Math.floor((byteCounts.length - 1) * ratio)),
		);
		return byteCounts[index];
	};
	return {
		totalMarkdownBytes: totalBytes,
		avgMarkdownBytes: byteCounts.length > 0 ? totalBytes / byteCounts.length : 0,
		p50MarkdownBytes: percentile(0.5),
		p95MarkdownBytes: percentile(0.95),
		maxMarkdownBytes: byteCounts[byteCounts.length - 1] ?? 0,
	};
}

describe("coverage lexical v3 TestVault startup benchmark", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	afterEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("measure coverage lexical v3 startup snapshot restore on local TestVault markdown", async () => {
		resetPersistedLexicalColdEvidenceStats();
		const vaultRoot = path.resolve(
			process.env.COVERAGE_LEXICAL_V3_STARTUP_VAULT_ROOT ?? defaultVaultRoot(),
		);
		const documents = loadVaultDocuments(vaultRoot);
		expect(documents.length).toBeGreaterThan(0);
		const markdownByteSummary = summarizeMarkdownBytes(documents);
		const { CoverageLexicalV3FileSearchEngine } = require(
			"src/services/search/coverage-lexical-v3/file-search-engine",
		);
		await registerProductionTokenizerStartupDependencies("coverage-lexical");
		const {
			createDexieCoverageLexicalV3ResidentShardArtifactStore,
		} = require("src/services/search/coverage-lexical-v3/artifact-loader");
		const {
			MemoryActiveOverlayJournalStore,
		} = require("src/services/search/coverage-lexical-v3/active-overlay-journal");
		const {
			MemoryCoverageLexicalV3SnapshotStore,
		} = require("src/services/search/coverage-lexical-v3/snapshot");
		const {
			createMemoryCoverageLexicalV3ProductionStores,
		} = require("src/services/search/coverage-lexical-v3/stores");
		const artifactTable = new BenchmarkArtifactTable((row: { id: string }) => row.id);
		const persistentStores = {
			productionStores: createMemoryCoverageLexicalV3ProductionStores(),
			artifactStore: createDexieCoverageLexicalV3ResidentShardArtifactStore(
				artifactTable,
			),
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore(),
		};
		const source = new CoverageLexicalV3FileSearchEngine();
		(source as any).getPersistentStores = () => persistentStores;
		const rebuildStartedAt = performance.now();
		await source.addDocuments(documents);
		const rebuildMs = performance.now() - rebuildStartedAt;
		const rebuildStats = source.getLastRebuildStats?.() ?? null;
		const rebuildMemory = process.memoryUsage();
		const snapshotWriteStartedAt = performance.now();
		await source.persistFileIndexArtifact();
		const snapshotWriteMs = performance.now() - snapshotWriteStartedAt;
		const maintenanceStats = source.getLastMaintenanceStats?.() ?? null;
		const restored = new CoverageLexicalV3FileSearchEngine();
		(restored as any).getPersistentStores = () => persistentStores;
		const hydrateStartedAt = performance.now();
		const restoredOk = await restored.restorePersistedFileIndex();
		const hydrateMs = performance.now() - hydrateStartedAt;
		const readyToSearchMs = hydrateMs;
		const estimatedResidentIndexBytes = restored.estimateIndexBytes?.() ?? 0;
		const diagnosticsStartedAt = performance.now();
		const restoredBreakdown = restored.getIndexBreakdown?.() ?? null;
		const diagnosticsMs = performance.now() - diagnosticsStartedAt;
		const manifestBytes = mockEstimateBenchmarkValueBytes(
			await persistentStores.snapshotStore.loadManifests(),
		);
		const registryBytes = mockEstimateBenchmarkValueBytes(
			await persistentStores.productionStores.shardRegistry.loadRegistry(),
		);
		const invalidationBytes = mockEstimateBenchmarkValueBytes(
			await persistentStores.productionStores.invalidations.loadInvalidations(),
		);
		const artifactBytes = artifactTable.estimateBytes();
		const coldEvidenceBytes =
			mockPersistedLexicalColdEvidenceStats.bodyEvidenceBytes +
			mockPersistedLexicalColdEvidenceStats.hanDocEvidenceBytes +
			mockPersistedLexicalColdEvidenceStats.hanBodyEvidenceBytes;
		const lexicalPersistedV3TotalBytes =
			artifactBytes +
			manifestBytes +
			registryBytes +
			invalidationBytes +
			coldEvidenceBytes +
			mockPersistedLexicalColdEvidenceStats.fuzzyRescueBytes;
		console.log(
			"[coverage-lexical-v3-startup-vault-benchmark] startup-snapshot",
			JSON.stringify(
				{
					vaultRoot,
					noteCount: documents.length,
					...Object.fromEntries(
						Object.entries(markdownByteSummary).map(([key, value]) => [
							key,
							round(value),
						]),
					),
					snapshotWriteMs: round(snapshotWriteMs),
					hydrateMs: round(hydrateMs),
					readyToSearchMs: round(readyToSearchMs),
					fallbackRebuildMs: round(rebuildMs),
					rebuildPhases: {
						batchMaxRawTextBytes: round(rebuildStats?.batchMaxRawTextBytes ?? 0),
						pass1Ms: round(rebuildStats?.pass1Ms ?? 0),
						pass2Ms: round(rebuildStats?.pass2Ms ?? 0),
						mergeMs: round(rebuildStats?.mergeMs ?? 0),
						diagnosticsMs: round(diagnosticsMs),
						coldEvidenceFlushCount: rebuildStats?.coldEvidenceFlushCount ?? 0,
						maxColdEvidenceChunkSize:
							rebuildStats?.maxColdEvidenceChunkSize ?? 0,
					},
					maintenance: {
						gcMs: round(maintenanceStats?.gcMs ?? 0),
						orphanArtifactRowsRemoved:
							maintenanceStats?.orphanArtifactRowsRemoved ?? 0,
						overlayEntriesRemoved: maintenanceStats?.overlayEntriesRemoved ?? 0,
						invalidationsRemoved: maintenanceStats?.invalidationsRemoved ?? 0,
						compactTempArtifactsRemoved:
							maintenanceStats?.compactTempArtifactsRemoved ?? 0,
						foldMs: round(maintenanceStats?.foldMs ?? 0),
						compactMs: round(maintenanceStats?.compactMs ?? 0),
						compactJobsHealed: maintenanceStats?.compactJobsHealed ?? 0,
						compactJobsStarted: maintenanceStats?.compactJobsStarted ?? 0,
					},
					memory: {
						heapUsedBytes: rebuildMemory.heapUsed,
						rssBytes: rebuildMemory.rss,
					},
					selfHealRepairMs: 0,
					repairChangedDocCount: 0,
					schemaVersion: 1,
					vaultFingerprintMode: "docRef-generation",
					tokenizerProfile: "production-tokenizer-chinese-patch-jieba-wasm",
					lexicalResidentRuntime: {
						estimatedResidentIndexBytes: round(estimatedResidentIndexBytes),
						documentCount:
							(restoredBreakdown as any)?.summary?.documentCount ?? documents.length,
						familyCount: (restoredBreakdown as any)?.summary?.familyCount ?? null,
						bodyBlockCount: (restoredBreakdown as any)?.summary?.blockCount ?? null,
						shardCount: (restoredBreakdown as any)?.indexSummary?.shardCount ?? null,
						hanRouteBytes:
							(restoredBreakdown as any)?.metrics?.hanRouteBytes ?? null,
						stringArenaBytes:
							(restoredBreakdown as any)?.metrics?.stringArenaBytes ?? null,
						familyPostingBytes:
							(restoredBreakdown as any)?.metrics?.familyPostingBytes ?? null,
						familyLexiconBytes:
							(restoredBreakdown as any)?.metrics?.familyLexiconBytes ?? null,
					},
					lexicalPersistedV3: {
						totalEstimatedBytes: round(lexicalPersistedV3TotalBytes),
						residentShardArtifactBytes: round(artifactBytes),
						snapshotManifestBytes: round(manifestBytes),
						shardRegistryBytes: round(registryBytes),
						invalidationBytes: round(invalidationBytes),
						coldEvidenceBytes: round(coldEvidenceBytes),
						fuzzyRescueBytes: round(
							mockPersistedLexicalColdEvidenceStats.fuzzyRescueBytes,
						),
						bodyEvidenceRows: mockPersistedLexicalColdEvidenceStats.bodyEvidenceRows,
						hanDocEvidenceRows:
							mockPersistedLexicalColdEvidenceStats.hanDocEvidenceRows,
						hanBodyEvidenceRows:
							mockPersistedLexicalColdEvidenceStats.hanBodyEvidenceRows,
					},
					hybridPersistedRuntimeState: {
						included: false,
						reason: "coverage lexical startup vault benchmark is lexical-only",
						persistedBytes: null,
						runtimeBytes: null,
					},
					ratios: {
						hydrateToRebuild: round(hydrateMs / Math.max(rebuildMs, 1)),
						readyToSearchToRebuild: round(
							readyToSearchMs / Math.max(rebuildMs, 1),
						),
						snapshotWriteToRebuild: round(snapshotWriteMs / Math.max(rebuildMs, 1)),
						residentIndexBytesToMarkdownBytes: round(
							estimatedResidentIndexBytes /
								Math.max(markdownByteSummary.totalMarkdownBytes, 1),
						),
						persistedV3BytesToMarkdownBytes: round(
							lexicalPersistedV3TotalBytes /
								Math.max(markdownByteSummary.totalMarkdownBytes, 1),
						),
					},
				},
				null,
				2,
			),
		);

		expect(restoredOk).toBe(true);
		expect(restored.getIndexedDocumentCount?.()).toBe(documents.length);
		expect(hydrateMs).toBeLessThan(rebuildMs);
	});
});
