import { performance } from "perf_hooks";
import { container } from "tsyringe";

const mockBenchmarkTextEncoder = new TextEncoder();

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
	if (value instanceof Blob) {
		return value.size;
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
	if (typeof value === "object") {
		if (visited.has(value)) {
			return 0;
		}
		visited.add(value);
		return Object.entries(value).reduce((sum, [key, childValue]) => {
			return (
				sum +
				mockBenchmarkTextEncoder.encode(key).length +
				mockEstimateBenchmarkValueBytes(childValue, visited)
			);
		}, 0);
	}
	return mockBenchmarkTextEncoder.encode(String(value)).length;
}

function mockBuildBenchmarkLexicalDocEvidenceRowId(locator: {
	docRef: number;
	generation: number;
}): string {
	return `${locator.docRef}:${locator.generation}`;
}

function mockBuildBenchmarkLexicalBlockEvidenceRowId(locator: {
	docRef: number;
	generation: number;
	blockOrdinal: number;
}): string {
	return `${locator.docRef}:${locator.generation}:${locator.blockOrdinal}`;
}

type PhaseTimingSummary = {
	queryCount: number;
	queryTotalMs: number;
	totalMeasuredMs: number;
	phases: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfMeasuredMs: number;
		shareOfQueryTime: number;
		shareOfParentMs?: number;
	}>;
	prepareSubphases: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfMeasuredMs: number;
		shareOfQueryTime: number;
		shareOfParentMs?: number;
	}>;
	rankSubphases: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfMeasuredMs: number;
		shareOfQueryTime: number;
		shareOfParentMs?: number;
	}>;
};

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

jest.mock("src/services/search/shared/file-snapshot-store", () => {
	const actual = jest.requireActual(
		"src/services/search/shared/file-snapshot-store",
	) as Record<string, unknown>;
	return {
		...actual,
		buildLexicalDocEvidenceRowId:
			typeof actual.buildLexicalDocEvidenceRowId === "function"
				? actual.buildLexicalDocEvidenceRowId
				: mockBuildBenchmarkLexicalDocEvidenceRowId,
		buildLexicalBlockEvidenceRowId:
			typeof actual.buildLexicalBlockEvidenceRowId === "function"
				? actual.buildLexicalBlockEvidenceRowId
				: mockBuildBenchmarkLexicalBlockEvidenceRowId,
		FileSnapshotStore: class MockFileSnapshotStore {
		private static currentTexts = new Map<string, string>();
		private static indexedTexts = new Map<
			string,
			{ generation?: number; text?: string }
		>();
		private static indexedMetadata = new Map<
			string,
			{
				generation?: number;
				aliasesText?: string;
				tagsText?: string;
				headingsText?: string;
			}
		>();
		private static lexicalFuzzyRescue: unknown = null;
		private static benchmarkPersistedLexicalBytes = 0;
		private static lexicalBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				exactFamilyIds: number[];
				exactTokenPositions: number[];
				familySupportEntries: Array<{ familyId: number; supportMask: number }>;
			}
		>();
		private static lexicalHanDocEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				identityWitnessStringIds: number[];
				identityWitnessSourceMasks: number[];
				routeWitnessStringIds: number[];
				routeWitnessSourceMasks: number[];
				headingWitnessStringIds: number[];
			}
		>();
		private static lexicalHanBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				bodyWitnessStringIds: number[];
				bodyWitnessStartOffsets: number[];
			}
		>();

		private static recomputeBenchmarkPersistedLexicalBytes(): void {
			MockFileSnapshotStore.benchmarkPersistedLexicalBytes =
				mockEstimateBenchmarkValueBytes(
					[...MockFileSnapshotStore.indexedTexts.entries()].map(([path, row]) => ({
						path,
						generation: row.generation,
						text: row.text,
					})),
				) +
				mockEstimateBenchmarkValueBytes(
					[...MockFileSnapshotStore.indexedMetadata.entries()].map(([path, row]) => ({
						path,
						generation: row.generation,
						aliasesText: row.aliasesText,
						tagsText: row.tagsText,
						headingsText: row.headingsText,
					})),
				) +
				mockEstimateBenchmarkValueBytes(MockFileSnapshotStore.lexicalFuzzyRescue) +
				mockEstimateBenchmarkValueBytes([
					...MockFileSnapshotStore.lexicalBodyEvidence.values(),
				]) +
				mockEstimateBenchmarkValueBytes([
					...MockFileSnapshotStore.lexicalHanDocEvidence.values(),
				]) +
				mockEstimateBenchmarkValueBytes([
					...MockFileSnapshotStore.lexicalHanBodyEvidence.values(),
				]);
		}

		static reset(): void {
			MockFileSnapshotStore.currentTexts.clear();
			MockFileSnapshotStore.indexedTexts.clear();
			MockFileSnapshotStore.indexedMetadata.clear();
			MockFileSnapshotStore.lexicalFuzzyRescue = null;
			MockFileSnapshotStore.lexicalBodyEvidence.clear();
			MockFileSnapshotStore.lexicalHanDocEvidence.clear();
			MockFileSnapshotStore.lexicalHanBodyEvidence.clear();
			MockFileSnapshotStore.benchmarkPersistedLexicalBytes = 0;
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
				MockFileSnapshotStore.indexedTexts.set(file.path, {
					generation: file.generation,
					text: file.text,
				});
			}
			MockFileSnapshotStore.recomputeBenchmarkPersistedLexicalBytes();
			return Promise.resolve();
		}

		readIndexedTexts(
			requests: ReadonlyArray<{
				path: string;
				generation?: number;
			}>,
		): Promise<Map<string, string>> {
			const result = new Map<string, string>();
			for (const request of requests) {
				const row = MockFileSnapshotStore.indexedTexts.get(request.path);
				if (!row) {
					continue;
				}
				if (
					request.generation !== undefined &&
					row.generation !== undefined &&
					row.generation !== request.generation
				) {
					continue;
				}
				if (typeof row.text === "string") {
					result.set(request.path, row.text);
				}
			}
			return Promise.resolve(result);
		}

		publishIndexedMetadata(
			files: ReadonlyArray<{
				path: string;
				generation?: number;
				aliasesText?: string;
				tagsText?: string;
				headingsText?: string;
			}>,
		): Promise<void> {
			for (const file of files) {
				MockFileSnapshotStore.indexedMetadata.set(file.path, {
					generation: file.generation,
					aliasesText: file.aliasesText,
					tagsText: file.tagsText,
					headingsText: file.headingsText,
				});
			}
			MockFileSnapshotStore.recomputeBenchmarkPersistedLexicalBytes();
			return Promise.resolve();
		}

		readIndexedMetadata(
			requests: ReadonlyArray<{
				path: string;
				generation?: number;
			}>,
		): Promise<
			Map<
				string,
				{
					aliasesText?: string;
					tagsText?: string;
					headingsText?: string;
				}
			>
		> {
			const result = new Map<
				string,
				{
					aliasesText?: string;
					tagsText?: string;
					headingsText?: string;
				}
			>();
			for (const request of requests) {
				const row = MockFileSnapshotStore.indexedMetadata.get(request.path);
				if (!row) {
					continue;
				}
				if (
					request.generation !== undefined &&
					row.generation !== undefined &&
					row.generation !== request.generation
				) {
					continue;
				}
				result.set(request.path, {
					aliasesText: row.aliasesText,
					tagsText: row.tagsText,
					headingsText: row.headingsText,
				});
			}
			return Promise.resolve(result);
		}

		publishLexicalFuzzyRescue(sidecar: unknown): Promise<void> {
			MockFileSnapshotStore.lexicalFuzzyRescue = sidecar;
			MockFileSnapshotStore.recomputeBenchmarkPersistedLexicalBytes();
			return Promise.resolve();
		}

		readLexicalFuzzyRescueForLookupKeys(
			fuzzyLookupKeys: ReadonlyArray<string>,
		): Promise<unknown> {
			const sidecar = MockFileSnapshotStore.lexicalFuzzyRescue as
				| {
						candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey?: ReadonlyMap<
							string,
							unknown
						>;
						fuzzyLookupKeyCount?: number;
				  }
				| null;
			if (sidecar == null) {
				return Promise.resolve(null);
			}
			const candidates =
				sidecar.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey ??
				new Map<string, unknown>();
			return Promise.resolve({
				...sidecar,
				candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: new Map(
					fuzzyLookupKeys.flatMap((fuzzyLookupKey) => {
						const familyIds = candidates.get(fuzzyLookupKey);
						return familyIds == null ? [] : [[fuzzyLookupKey, familyIds] as const];
					}),
				),
				fuzzyLookupKeyCount: fuzzyLookupKeys.filter((fuzzyLookupKey) =>
					candidates.has(fuzzyLookupKey),
				).length,
			});
		}

		publishLexicalBodyEvidence(
			rows: ReadonlyArray<{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				exactFamilyIds: readonly number[];
				exactTokenPositions: readonly number[];
				familySupportFamilyIds: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}>,
		): Promise<void> {
			MockFileSnapshotStore.lexicalBodyEvidence.clear();
			for (const row of rows) {
				MockFileSnapshotStore.lexicalBodyEvidence.set(row.id, {
					id: row.id,
					docRef: row.docRef,
					generation: row.generation,
					blockOrdinal: row.blockOrdinal,
					exactFamilyIds: [...row.exactFamilyIds],
					exactTokenPositions: [...row.exactTokenPositions],
					familySupportEntries: row.familySupportFamilyIds.map((familyId, index) => ({
						familyId,
						supportMask: row.familySupportMaskByEntry[index] ?? 0,
					})),
				});
			}
			MockFileSnapshotStore.recomputeBenchmarkPersistedLexicalBytes();
			return Promise.resolve();
		}

		readLexicalBodyEvidenceForBlocks(
			locators: ReadonlyArray<{
				docRef: number;
				generation: number;
				blockOrdinal: number;
			}>,
		): Promise<
			ReadonlyMap<
				string,
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
			const out = new Map<string, {
				exactFamilyIds: readonly number[];
				exactTokenPositions: readonly number[];
				familySupportEntries: ReadonlyArray<{
					familyId: number;
					supportMask: number;
				}>;
			}>();
			for (const locator of locators) {
				const rowId = mockBuildBenchmarkLexicalBlockEvidenceRowId(locator);
				const snapshot = MockFileSnapshotStore.lexicalBodyEvidence.get(rowId);
				if (snapshot != null) {
					out.set(rowId, {
						exactFamilyIds: snapshot.exactFamilyIds,
						exactTokenPositions: snapshot.exactTokenPositions,
						familySupportEntries: snapshot.familySupportEntries,
					});
				}
			}
			return Promise.resolve(out);
		}

		publishLexicalHanDocEvidence(
			rows: ReadonlyArray<{
				id: string;
				docRef: number;
				generation: number;
				identityWitnessStringIds: readonly number[];
				identityWitnessSourceMaskByDocEntry: readonly number[];
				routeWitnessStringIds: readonly number[];
				routeWitnessSourceMaskByDocEntry: readonly number[];
				headingWitnessStringIds: readonly number[];
			}>,
		): Promise<void> {
			MockFileSnapshotStore.lexicalHanDocEvidence.clear();
			for (const row of rows) {
				MockFileSnapshotStore.lexicalHanDocEvidence.set(row.id, {
					id: row.id,
					docRef: row.docRef,
					generation: row.generation,
					identityWitnessStringIds: [...row.identityWitnessStringIds],
					identityWitnessSourceMasks: [...row.identityWitnessSourceMaskByDocEntry],
					routeWitnessStringIds: [...row.routeWitnessStringIds],
					routeWitnessSourceMasks: [...row.routeWitnessSourceMaskByDocEntry],
					headingWitnessStringIds: [...row.headingWitnessStringIds],
				});
			}
			MockFileSnapshotStore.recomputeBenchmarkPersistedLexicalBytes();
			return Promise.resolve();
		}

		readLexicalHanDocEvidenceForDocs(
			locators: ReadonlyArray<{
				docRef: number;
				generation: number;
			}>,
		): Promise<
			ReadonlyMap<
				string,
				{
					identityWitnessStringIds: readonly number[];
					identityWitnessSourceMasks: readonly number[];
					routeWitnessStringIds: readonly number[];
					routeWitnessSourceMasks: readonly number[];
					headingWitnessStringIds: readonly number[];
				}
			>
		> {
			const out = new Map<string, {
				identityWitnessStringIds: readonly number[];
				identityWitnessSourceMasks: readonly number[];
				routeWitnessStringIds: readonly number[];
				routeWitnessSourceMasks: readonly number[];
				headingWitnessStringIds: readonly number[];
			}>();
			for (const locator of locators) {
				const rowId = mockBuildBenchmarkLexicalDocEvidenceRowId(locator);
				const snapshot = MockFileSnapshotStore.lexicalHanDocEvidence.get(rowId);
				if (snapshot != null) {
					out.set(rowId, {
						identityWitnessStringIds: snapshot.identityWitnessStringIds,
						identityWitnessSourceMasks: snapshot.identityWitnessSourceMasks,
						routeWitnessStringIds: snapshot.routeWitnessStringIds,
						routeWitnessSourceMasks: snapshot.routeWitnessSourceMasks,
						headingWitnessStringIds: snapshot.headingWitnessStringIds,
					});
				}
			}
			return Promise.resolve(out);
		}

		publishLexicalHanBodyEvidence(
			rows: ReadonlyArray<{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				bodyWitnessStringIds: readonly number[];
				bodyWitnessStartOffsets: readonly number[];
			}>,
		): Promise<void> {
			MockFileSnapshotStore.lexicalHanBodyEvidence.clear();
			for (const row of rows) {
				MockFileSnapshotStore.lexicalHanBodyEvidence.set(row.id, {
					id: row.id,
					docRef: row.docRef,
					generation: row.generation,
					blockOrdinal: row.blockOrdinal,
					bodyWitnessStringIds: [...row.bodyWitnessStringIds],
					bodyWitnessStartOffsets: [...row.bodyWitnessStartOffsets],
				});
			}
			MockFileSnapshotStore.recomputeBenchmarkPersistedLexicalBytes();
			return Promise.resolve();
		}

		readLexicalHanBodyEvidenceForBlocks(
			locators: ReadonlyArray<{
				docRef: number;
				generation: number;
				blockOrdinal: number;
			}>,
		): Promise<
			ReadonlyMap<
				string,
				{
					bodyWitnessStringIds: readonly number[];
					bodyWitnessStartOffsets: readonly number[];
				}
			>
		> {
			const out = new Map<string, {
				bodyWitnessStringIds: readonly number[];
				bodyWitnessStartOffsets: readonly number[];
			}>();
			for (const locator of locators) {
				const rowId = mockBuildBenchmarkLexicalBlockEvidenceRowId(locator);
				const snapshot = MockFileSnapshotStore.lexicalHanBodyEvidence.get(rowId);
				if (snapshot != null) {
					out.set(rowId, {
						bodyWitnessStringIds: snapshot.bodyWitnessStringIds,
						bodyWitnessStartOffsets: snapshot.bodyWitnessStartOffsets,
					});
				}
			}
			return Promise.resolve(out);
		}

		getBenchmarkPersistedLexicalBytes(): number {
			return MockFileSnapshotStore.benchmarkPersistedLexicalBytes;
		}
		},
	};
});

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
	): Promise<{ summary: any; phaseTiming: PhaseTimingSummary | null }>;
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

const LOCAL_STORAGE_DEBUG_QUERY_KEY = "coverage-lexical-v3-debug-query";
const LOCAL_STORAGE_DEBUG_MODE_KEY = "coverage-lexical-v3-debug-mode";
const BENCHMARK_DEBUG_QUERY_ENV_KEY = "COVERAGE_LEXICAL_V3_DEBUG_QUERY";
const BENCHMARK_DEBUG_MODE_ENV_KEY = "COVERAGE_LEXICAL_V3_DEBUG_MODE";
const BENCHMARK_SLOW_QUERY_LIMIT_ENV_KEY =
	"COVERAGE_LEXICAL_V3_SLOW_QUERY_LIMIT";

type BenchmarkQueryCase = Readonly<{
	query: string;
	type?: string;
	suite?: string;
	relevantPath?: string;
}>;

type SlowQuerySample = Readonly<{
	query: string;
	type: string;
	suite: string;
	relevantPath: string;
	elapsedMs: number;
	resultCount: number;
	topResultPath: string | null;
	hitTop1: boolean;
	missed: boolean;
}>;

function createCoverageLexicalV3BenchmarkLocalStorage(): {
	getItem: jest.Mock;
	setItem: jest.Mock;
	removeItem: jest.Mock;
} {
	const configuredDebugQuery =
		process.env[BENCHMARK_DEBUG_QUERY_ENV_KEY]?.trim() ?? "";
	const configuredDebugMode =
		process.env[BENCHMARK_DEBUG_MODE_ENV_KEY]?.trim() ?? "";
	return {
		getItem: jest.fn((key: string) => {
			if (key === LOCAL_STORAGE_DEBUG_QUERY_KEY) {
				return configuredDebugQuery;
			}
			if (key === LOCAL_STORAGE_DEBUG_MODE_KEY) {
				return configuredDebugMode;
			}
			return "zh";
		}),
		setItem: jest.fn(),
		removeItem: jest.fn(),
	};
}

function attachCoverageLexicalV3SlowQueryDiagnostics(
	engine: {
		searchFiles(request: {
			queryText?: string;
		}): Promise<Array<{ path: string }>>;
	},
	queryCases: readonly BenchmarkQueryCase[],
): () => readonly SlowQuerySample[] {
	const samples: SlowQuerySample[] = [];
	const originalSearchFiles = engine.searchFiles.bind(engine);
	let queryCaseCursor = 0;
	engine.searchFiles = async (
		request: {
			queryText?: string;
		},
	) => {
		const benchmarkQueryCase = queryCases[queryCaseCursor] ?? null;
		queryCaseCursor += 1;
		const startedAt = performance.now();
		const results = await originalSearchFiles(request);
		const elapsedMs = performance.now() - startedAt;
		const topResultPath = results[0]?.path ?? null;
		samples.push({
			query: String(request.queryText ?? benchmarkQueryCase?.query ?? ""),
			type: benchmarkQueryCase?.type ?? "unknown",
			suite: benchmarkQueryCase?.suite ?? "unknown",
			relevantPath: benchmarkQueryCase?.relevantPath ?? "",
			elapsedMs,
			resultCount: results.length,
			topResultPath,
			hitTop1:
				benchmarkQueryCase?.relevantPath != null &&
				topResultPath === benchmarkQueryCase.relevantPath,
			missed:
				benchmarkQueryCase?.relevantPath != null &&
				!results.some((result) => result.path === benchmarkQueryCase.relevantPath),
		});
		return results;
	};
	return () =>
		[...samples].sort((left, right) => right.elapsedMs - left.elapsedMs);
}

function summarizePhaseTiming(phaseTiming: PhaseTimingSummary | null) {
	if (!phaseTiming) {
		return null;
	}
	const summarizeEntries = (
		entries: PhaseTimingSummary["phases"],
		includeParentShare: boolean,
	) =>
		entries.slice(0, 8).map((entry) => ({
			phase: entry.phase,
			totalMs: round(entry.totalMs),
			avgMsPerCall: round(entry.avgMsPerCall),
			avgMsPerUnit: round(entry.avgMsPerUnit),
			maxMs: round(entry.maxMs),
			count: entry.count,
			unitCount: entry.unitCount,
			shareOfMeasuredMs: round(entry.shareOfMeasuredMs),
			shareOfQueryTime: round(entry.shareOfQueryTime),
			...(includeParentShare
				? { shareOfParentMs: round(entry.shareOfParentMs ?? 0) }
				: {}),
		}));
	return {
		queryCount: phaseTiming.queryCount,
		queryTotalMs: round(phaseTiming.queryTotalMs),
		totalMeasuredMs: round(phaseTiming.totalMeasuredMs),
		topHotPhases: summarizeEntries(phaseTiming.phases, false),
		topPrepareSubphases: summarizeEntries(phaseTiming.prepareSubphases, true),
		topRankSubphases: summarizeEntries(phaseTiming.rankSubphases, true),
	};
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
			localStorage: createCoverageLexicalV3BenchmarkLocalStorage(),
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
		const coverageV3Documents = attachStableDocRefsToDocuments(documents);
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
			localStorage: createCoverageLexicalV3BenchmarkLocalStorage(),
		};

		const coverageV3 = createEngineHarness(
			CoverageLexicalV3FileSearchEngine,
			tokenizer,
			"coverage-lexical",
		);
		const getSlowQuerySamples = attachCoverageLexicalV3SlowQueryDiagnostics(
			coverageV3,
			queryCases as BenchmarkQueryCase[],
		);
		attachCoverageLexicalV3BenchmarkPersistence(coverageV3);
		const coverageV3Result = await runBenchmark(
			"CoverageLexical(V3)",
			coverageV3,
			coverageV3Documents,
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

		console.log(
			"[coverage-lexical-v3-automation-benchmark] phase-timing",
			JSON.stringify(
				{
					v3: summarizePhaseTiming(coverageV3Result.phaseTiming),
				},
				null,
				2,
			),
		);

		const slowQueryLimit = Number.parseInt(
			process.env[BENCHMARK_SLOW_QUERY_LIMIT_ENV_KEY] ?? "0",
			10,
		);
		if (Number.isFinite(slowQueryLimit) && slowQueryLimit > 0) {
			console.log(
				"[coverage-lexical-v3-automation-benchmark] slow-queries",
				JSON.stringify(
					getSlowQuerySamples()
						.slice(0, slowQueryLimit)
						.map((sample) => ({
							query: sample.query,
							type: sample.type,
							suite: sample.suite,
							elapsedMs: round(sample.elapsedMs),
							resultCount: sample.resultCount,
							hitTop1: sample.hitTop1,
							missed: sample.missed,
							relevantPath: sample.relevantPath,
							topResultPath: sample.topResultPath,
						})),
					null,
					2,
				),
			);
		}

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


