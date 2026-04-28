// @ts-nocheck
import { performance } from "perf_hooks";
import { container } from "tsyringe";
import { registerProductionTokenizerStartupDependencies } from "./coverage-lexical-v3-startup-production-tokenizer";

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

jest.mock("src/services/database/database", () => ({
	Database: class MockDatabase {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	buildLexicalDocEvidenceRowId(locator: {
		shardId?: string;
		shardGeneration?: number;
		docRef: number;
		generation: number;
	}): string {
		if (locator.shardId != null && locator.shardGeneration != null) {
			return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}`;
		}
		return `${locator.docRef}:${locator.generation}`;
	},
	buildLexicalBlockEvidenceRowId(locator: {
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
	},
	FileSnapshotStore: class MockFileSnapshotStore {
		publishLexicalBodyEvidence(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalHanDocEvidence(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalHanBodyEvidence(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalFuzzyRescue(): Promise<void> {
			return Promise.resolve();
		}
	},
}));

const previousFixtureImportEnv = process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";
const v3FixtureModule = require("./coverage-lexical-automation-fixture") as {
	createAutomationCorpus(): {
		documents: Array<Record<string, unknown>>;
		queryCases: Array<Record<string, unknown>>;
	};
	round(value: number): number;
};
if (previousFixtureImportEnv === undefined) {
	delete process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
} else {
	process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = previousFixtureImportEnv;
}

const {
	createAutomationCorpus,
	round,
} = v3FixtureModule;

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
}

function attachStableDocRefsToDocuments(
	documents: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
	return documents.map((document, index) => ({
		...document,
		docRef:
			typeof document.docRef === "number" && Number.isFinite(document.docRef)
				? document.docRef
				: index + 1,
	}));
}

describe("coverage lexical v3 startup snapshot benchmark", () => {
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

	test("measure coverage lexical v3 startup snapshot restore", async () => {
		const { documents, queryCases } = createAutomationCorpus();
		const coverageV3Documents = attachStableDocRefsToDocuments(documents);
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
		const persistentStores = {
			productionStores: createMemoryCoverageLexicalV3ProductionStores(),
			artifactStore: createDexieCoverageLexicalV3ResidentShardArtifactStore(
				new BenchmarkArtifactTable((row: { id: string }) => row.id),
			),
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore(),
		};
		const source = new CoverageLexicalV3FileSearchEngine();
		(source as any).getPersistentStores = () => persistentStores;
		const rebuildStartedAt = performance.now();
		await source.addDocuments(coverageV3Documents);
		const rebuildMs = performance.now() - rebuildStartedAt;
		const snapshotWriteStartedAt = performance.now();
		await source.persistFileIndexArtifact();
		const snapshotWriteMs = performance.now() - snapshotWriteStartedAt;
		const restored = new CoverageLexicalV3FileSearchEngine();
		(restored as any).getPersistentStores = () => persistentStores;
		const hydrateStartedAt = performance.now();
		const restoredOk = await restored.restorePersistedFileIndex();
		const hydrateMs = performance.now() - hydrateStartedAt;
		const readyToSearchMs = hydrateMs;
		const estimatedIndexBytes = restored.estimateIndexBytes?.() ?? 0;
		console.log(
			"[coverage-lexical-v3-startup-benchmark] startup-snapshot",
			JSON.stringify(
				{
					noteCount: documents.length,
					queryCount: queryCases.length,
					snapshotBytes: round(estimatedIndexBytes),
					snapshotWriteMs: round(snapshotWriteMs),
					hydrateMs: round(hydrateMs),
					readyToSearchMs: round(readyToSearchMs),
					fallbackRebuildMs: round(rebuildMs),
					selfHealRepairMs: 0,
					repairChangedDocCount: 0,
					schemaVersion: 1,
					vaultFingerprintMode: "docRef-generation",
					tokenizerProfile: "production-tokenizer-chinese-patch-jieba-wasm",
					ratios: {
						hydrateToRebuild: round(hydrateMs / Math.max(rebuildMs, 1)),
						readyToSearchToRebuild: round(
							readyToSearchMs / Math.max(rebuildMs, 1),
						),
						snapshotBytesToEstimatedIndexBytes: 1,
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
