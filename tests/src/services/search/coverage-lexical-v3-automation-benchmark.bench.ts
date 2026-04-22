import { performance } from "perf_hooks";
import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

jest.mock("src/services/database/database", () => ({
	Database: class MockDatabase {
		appendCoverageLexicalV2IndexStoreJournalEntries(): Promise<void> {
			return Promise.resolve();
		}
	},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class MockFileSnapshotStore {
		private static currentTexts = new Map<string, string>();
		private static lexicalFuzzyRescue: unknown = null;
		private static lexicalBodyEvidence = new Map<
			number,
			{
				exactFamilyIds: number[];
				exactTokenPositions: number[];
				familySupportEntries: Array<{ familyId: number; supportMask: number }>;
			}
		>();
		private static lexicalHanDocEvidence = new Map<
			number,
			{
				identityWitnessStringIds: number[];
				identityWitnessSourceMasks: number[];
				routeWitnessStringIds: number[];
				routeWitnessSourceMasks: number[];
				headingWitnessStringIds: number[];
			}
		>();
		private static lexicalHanBodyEvidence = new Map<
			number,
			{
				bodyWitnessStringIds: number[];
				bodyWitnessStartOffsets: number[];
			}
		>();

		static reset(): void {
			MockFileSnapshotStore.currentTexts.clear();
			MockFileSnapshotStore.lexicalFuzzyRescue = null;
			MockFileSnapshotStore.lexicalBodyEvidence.clear();
			MockFileSnapshotStore.lexicalHanDocEvidence.clear();
			MockFileSnapshotStore.lexicalHanBodyEvidence.clear();
		}

		readCurrentTexts(): Promise<Map<string, string>> {
			return Promise.resolve(new Map(MockFileSnapshotStore.currentTexts));
		}

		publishIndexedTexts(
			files: ReadonlyArray<{
				path: string;
				text?: string;
			}>,
		): Promise<void> {
			for (const file of files) {
				MockFileSnapshotStore.currentTexts.set(file.path, file.text ?? "");
			}
			return Promise.resolve();
		}

		publishIndexedMetadata(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalFuzzyRescue(sidecar: unknown): Promise<void> {
			MockFileSnapshotStore.lexicalFuzzyRescue = sidecar;
			return Promise.resolve();
		}

		readLexicalFuzzyRescue(): Promise<unknown> {
			return Promise.resolve(MockFileSnapshotStore.lexicalFuzzyRescue);
		}

		publishLexicalBodyEvidence(
			rows: ReadonlyArray<{
				blockId: number;
				exactFamilyIds: readonly number[];
				exactTokenPositions: readonly number[];
				familySupportFamilyIds: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}>,
		): Promise<void> {
			for (const row of rows) {
				MockFileSnapshotStore.lexicalBodyEvidence.set(row.blockId, {
					exactFamilyIds: [...row.exactFamilyIds],
					exactTokenPositions: [...row.exactTokenPositions],
					familySupportEntries: row.familySupportFamilyIds.map((familyId, index) => ({
						familyId,
						supportMask: row.familySupportMaskByEntry[index] ?? 0,
					})),
				});
			}
			return Promise.resolve();
		}

		readLexicalBodyEvidenceForBlocks(
			blockIds: ReadonlyArray<number>,
		): Promise<
			ReadonlyMap<
				number,
				{
					exactFamilyIds: readonly number[];
					exactTokenPositions: readonly number[];
					familySupportEntries: ReadonlyArray<{
						familyId: number;
						supportMask: number;
					}>;
				}
			>
		> {
			const out = new Map<number, {
				exactFamilyIds: readonly number[];
				exactTokenPositions: readonly number[];
				familySupportEntries: ReadonlyArray<{
					familyId: number;
					supportMask: number;
				}>;
			}>();
			for (const blockId of new Set(blockIds)) {
				const snapshot = MockFileSnapshotStore.lexicalBodyEvidence.get(blockId);
				if (snapshot != null) {
					out.set(blockId, snapshot);
				}
			}
			return Promise.resolve(out);
		}

		publishLexicalHanDocEvidence(
			rows: ReadonlyArray<{
				docId: number;
				identityWitnessStringIds: readonly number[];
				identityWitnessSourceMaskByDocEntry: readonly number[];
				routeWitnessStringIds: readonly number[];
				routeWitnessSourceMaskByDocEntry: readonly number[];
				headingWitnessStringIds: readonly number[];
			}>,
		): Promise<void> {
			for (const row of rows) {
				MockFileSnapshotStore.lexicalHanDocEvidence.set(row.docId, {
					identityWitnessStringIds: [...row.identityWitnessStringIds],
					identityWitnessSourceMasks: [...row.identityWitnessSourceMaskByDocEntry],
					routeWitnessStringIds: [...row.routeWitnessStringIds],
					routeWitnessSourceMasks: [...row.routeWitnessSourceMaskByDocEntry],
					headingWitnessStringIds: [...row.headingWitnessStringIds],
				});
			}
			return Promise.resolve();
		}

		readLexicalHanDocEvidenceForDocs(
			docIds: ReadonlyArray<number>,
		): Promise<
			ReadonlyMap<
				number,
				{
					identityWitnessStringIds: readonly number[];
					identityWitnessSourceMasks: readonly number[];
					routeWitnessStringIds: readonly number[];
					routeWitnessSourceMasks: readonly number[];
					headingWitnessStringIds: readonly number[];
				}
			>
		> {
			const out = new Map<number, {
				identityWitnessStringIds: readonly number[];
				identityWitnessSourceMasks: readonly number[];
				routeWitnessStringIds: readonly number[];
				routeWitnessSourceMasks: readonly number[];
				headingWitnessStringIds: readonly number[];
			}>();
			for (const docId of new Set(docIds)) {
				const snapshot = MockFileSnapshotStore.lexicalHanDocEvidence.get(docId);
				if (snapshot != null) {
					out.set(docId, snapshot);
				}
			}
			return Promise.resolve(out);
		}

		publishLexicalHanBodyEvidence(
			rows: ReadonlyArray<{
				blockId: number;
				bodyWitnessStringIds: readonly number[];
				bodyWitnessStartOffsets: readonly number[];
			}>,
		): Promise<void> {
			for (const row of rows) {
				MockFileSnapshotStore.lexicalHanBodyEvidence.set(row.blockId, {
					bodyWitnessStringIds: [...row.bodyWitnessStringIds],
					bodyWitnessStartOffsets: [...row.bodyWitnessStartOffsets],
				});
			}
			return Promise.resolve();
		}

		readLexicalHanBodyEvidenceForBlocks(
			blockIds: ReadonlyArray<number>,
		): Promise<
			ReadonlyMap<
				number,
				{
					bodyWitnessStringIds: readonly number[];
					bodyWitnessStartOffsets: readonly number[];
				}
			>
		> {
			const out = new Map<number, {
				bodyWitnessStringIds: readonly number[];
				bodyWitnessStartOffsets: readonly number[];
			}>();
			for (const blockId of new Set(blockIds)) {
				const snapshot = MockFileSnapshotStore.lexicalHanBodyEvidence.get(blockId);
				if (snapshot != null) {
					out.set(blockId, snapshot);
				}
			}
			return Promise.resolve(out);
		}
	},
}));

const previousFixtureImportEnv = process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";
const legacyFixtureModule = require("./coverage-lexical-legacy-automation-benchmark.bench") as {
	createAutomationCorpus(): {
		documents: Array<Record<string, unknown>>;
		queryCases: Array<Record<string, unknown>>;
	};
	createMockTokenizer(): {
		tokenize(text: string, mode?: "index" | "search"): string[];
		tokenizeSequence(text: string, mode?: "index" | "search"): string[];
	};
	createEngineHarness(
		EngineCtor: new () => any,
		tokenizer: {
			tokenize(text: string, mode?: "index" | "search"): string[];
			tokenizeSequence(text: string, mode?: "index" | "search"): string[];
		},
		backend: "minisearch" | "coverage-lexical",
	): any;
	runBenchmark(
		name: string,
		engine: any,
		documents: Array<Record<string, unknown>>,
		queryCases: Array<Record<string, unknown>>,
	): Promise<{ summary: any }>;
	computeLanguageMix(documents: Array<Record<string, unknown>>): {
		docsWithHan: number;
		docsWithLatinAndHan: number;
		hanRatio: number;
		mixedRatio: number;
	};
	computeQueryLanguageMix(queryCases: Array<Record<string, unknown>>): {
		zh: number;
		mixed: number;
		en: number;
	};
	round(value: number): number;
	computeRelativeRatio(numerator: number, denominator: number): number | null;
};
if (previousFixtureImportEnv === undefined) {
	delete process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
} else {
	process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = previousFixtureImportEnv;
}

const {
	createAutomationCorpus,
	createMockTokenizer,
	createEngineHarness,
	runBenchmark,
	computeLanguageMix,
	computeQueryLanguageMix,
	round,
	computeRelativeRatio,
} = legacyFixtureModule;

function attachCoverageLexicalV3BenchmarkPersistence(engine: {
	addDocuments(documents: Array<Record<string, unknown>>): Promise<void>;
	notifyIndexedTextsCommitted?: (
		files: ReadonlyArray<{
			path: string;
			generation?: number;
		}>,
	) => void;
}): void {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const originalAddDocuments = engine.addDocuments.bind(engine);
	engine.addDocuments = async (documents: Array<Record<string, unknown>>) => {
		await originalAddDocuments(documents);
		const snapshotStore = container.resolve(FileSnapshotStore) as {
			publishIndexedTexts?: (
				files: ReadonlyArray<{
					path: string;
					generation?: number;
					text?: string;
				}>,
			) => Promise<void>;
			publishIndexedMetadata?: (
				files: ReadonlyArray<{
					path: string;
					generation?: number;
					aliasesText?: string;
					tagsText?: string;
					headingsText?: string;
				}>,
			) => Promise<void>;
		};
		await snapshotStore.publishIndexedTexts?.(
			documents.map((document) => ({
				path: String(document.path),
				generation:
					typeof document.generation === "number"
						? document.generation
						: undefined,
				text:
					typeof document.content === "string" ? document.content : undefined,
			})),
		);
		await snapshotStore.publishIndexedMetadata?.(
			documents.map((document) => ({
				path: String(document.path),
				generation:
					typeof document.generation === "number"
						? document.generation
						: undefined,
				aliasesText:
					typeof document.aliases === "string"
						? document.aliases
						: undefined,
				tagsText:
					typeof document.tags === "string" ? document.tags : undefined,
				headingsText:
					typeof document.headings === "string"
						? document.headings
						: undefined,
			})),
		);
		engine.notifyIndexedTextsCommitted?.(
			documents.map((document) => ({
				path: String(document.path),
				generation:
					typeof document.generation === "number"
						? document.generation
						: undefined,
			})),
		);
	};
}

describe("coverage lexical v3 automation benchmark", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		const { FileSnapshotStore } = require(
			"src/services/search/shared/file-snapshot-store",
		) as {
			FileSnapshotStore: { reset?: () => void };
		};
		FileSnapshotStore.reset?.();
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		const { FileSnapshotStore } = require(
			"src/services/search/shared/file-snapshot-store",
		) as {
			FileSnapshotStore: { reset?: () => void };
		};
		FileSnapshotStore.reset?.();
	});

	test("compare coverage lexical v3 against minisearch on legacy automation corpus", async () => {
		const benchmarkStartedAt = performance.now();
		const tokenizer = createMockTokenizer();
		const { documents, queryCases } = createAutomationCorpus();
		const languageMix = computeLanguageMix(documents);
		const queryLanguageMix = computeQueryLanguageMix(queryCases);
		const { DevMiniSearchFileEngine } = require("./helpers/dev-minisearch-file-engine");
		const { CoverageLexicalV3FileSearchEngine } = require(
			"src/services/search/coverage-lexical-v3/file-search-engine",
		);

		const mini = createEngineHarness(DevMiniSearchFileEngine, tokenizer, "minisearch");
		const miniResult = await runBenchmark("MiniSearch", mini, documents, queryCases);

		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};

		const coverageV3 = createEngineHarness(
			CoverageLexicalV3FileSearchEngine,
			tokenizer,
			"coverage-lexical",
		);
		attachCoverageLexicalV3BenchmarkPersistence(coverageV3);
		const coverageV3Result = await runBenchmark(
			"CoverageLexical(V3)",
			coverageV3,
			documents,
			queryCases,
		);
		const benchmarkElapsedMs = performance.now() - benchmarkStartedAt;

		console.log(
			"[coverage-lexical-v3-automation-benchmark] corpus",
			JSON.stringify(
				{
					noteCount: documents.length,
					queryCount: queryCases.length,
					docsWithHan: languageMix.docsWithHan,
					docsWithLatinAndHan: languageMix.docsWithLatinAndHan,
					hanRatio: round(languageMix.hanRatio),
					mixedRatio: round(languageMix.mixedRatio),
					queryZhCount: queryLanguageMix.zh,
					queryMixedCount: queryLanguageMix.mixed,
					queryEnCount: queryLanguageMix.en,
					queryZhRatio: round(queryLanguageMix.zh / queryCases.length),
					queryMixedRatio: round(queryLanguageMix.mixed / queryCases.length),
					queryEnRatio: round(queryLanguageMix.en / queryCases.length),
					totalElapsedMs: round(benchmarkElapsedMs),
				},
				null,
				2,
			),
		);

		console.log(
			"[coverage-lexical-v3-automation-benchmark] summary",
			JSON.stringify(
				[miniResult.summary, coverageV3Result.summary].map((summary) => ({
					name: summary.name,
					objective: round(summary.objective),
					top1: round(summary.top1),
					top3: round(summary.top3),
					top5: round(summary.top5),
					zeroRate: round(summary.zeroRate),
					mrr: round(summary.mrr),
					avgMsPerQuery: round(summary.avgMsPerQuery),
					p50Ms: round(summary.p50Ms),
					p100Ms: round(summary.p100Ms),
					estimatedIndexKB: round(summary.estimatedIndexBytes / 1024),
					bySuite: Object.fromEntries(
						Object.entries(summary.bySuite).map(([suite, stats]) => [
							suite,
							{
								top1: round((stats as any).top1),
								top3: round((stats as any).top3),
								top5: round((stats as any).top5),
								zeroRate: round((stats as any).zeroRate),
								count: (stats as any).count,
							},
						]),
					),
					byType: Object.fromEntries(
						Object.entries(summary.byType).map(([type, stats]) => [
							type,
							{
								top1: round((stats as any).top1),
								top3: round((stats as any).top3),
								top5: round((stats as any).top5),
								zeroRate: round((stats as any).zeroRate),
								count: (stats as any).count,
							},
						]),
					),
					byGate: Object.fromEntries(
						Object.entries(summary.byGate).map(([gate, stats]) => [
							gate,
							{
								objective: round((stats as any).objective),
								top1: round((stats as any).top1),
								top3: round((stats as any).top3),
								top5: round((stats as any).top5),
								zeroRate: round((stats as any).zeroRate),
								count: (stats as any).count,
								types: (stats as any).types,
							},
						]),
					),
				})),
				null,
				2,
			),
		);

		console.log(
			"[coverage-lexical-v3-automation-benchmark] relative-anchor",
			JSON.stringify(
				{
					primaryNote:
						"Use relative ratios as the timing anchor because absolute milliseconds vary with battery and power mode. V3 comparisons on the legacy automation corpus anchor on MiniSearch vs CoverageLexical(V3).",
					v3VsMiniSearch: {
						avgMsPerQueryRatio: round(
							computeRelativeRatio(
								coverageV3Result.summary.avgMsPerQuery,
								miniResult.summary.avgMsPerQuery,
							) ?? 0,
						),
						p50MsRatio: round(
							computeRelativeRatio(
								coverageV3Result.summary.p50Ms,
								miniResult.summary.p50Ms,
							) ?? 0,
						),
						p100MsRatio: round(
							computeRelativeRatio(
								coverageV3Result.summary.p100Ms,
								miniResult.summary.p100Ms,
							) ?? 0,
						),
						estimatedIndexBytesRatio: round(
							computeRelativeRatio(
								coverageV3Result.summary.estimatedIndexBytes,
								miniResult.summary.estimatedIndexBytes,
							) ?? 0,
						),
					},
				},
				null,
				2,
			),
		);

		expect(documents.length).toBeGreaterThanOrEqual(70);
		expect(queryCases.length).toBeGreaterThanOrEqual(145);
		expect(languageMix.hanRatio).toBeGreaterThanOrEqual(0.4);
		expect(languageMix.hanRatio).toBeLessThanOrEqual(0.65);
		expect(languageMix.mixedRatio).toBeGreaterThanOrEqual(0.4);
		expect(queryLanguageMix.en).toBeGreaterThan(0);
		expect(queryLanguageMix.zh).toBeGreaterThan(0);
		expect(queryLanguageMix.mixed).toBeGreaterThan(0);
		expect(benchmarkElapsedMs).toBeLessThan(20000);
	});
});
