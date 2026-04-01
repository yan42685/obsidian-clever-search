import { performance } from "perf_hooks";
import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

type CoverageLexicalEngineLike = {
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	reIndexAll(data: unknown): Promise<boolean>;
	serialize(): unknown;
	searchFiles(request: {
		queryText: string;
		isPrefixMatch: boolean;
		isFuzzy: boolean;
		maxItemResults: number;
	}): Promise<Array<{ path: string }>>;
	estimateIndexBytes?(): number | null;
};

describe("coverage lexical startup snapshot benchmark", () => {
	beforeEach(() => {
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
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("measures rebuild versus binary snapshot hydrate on the automation corpus", async () => {
		process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";
		const benchmarkFixtures = require(
			"./coverage-lexical-automation-benchmark.bench",
		) as {
			createMockTokenizer: () => unknown;
			createAutomationCorpus: () => {
				documents: IndexedDocument[];
				queryCases: Array<{ query: string; relevantPath: string }>;
			};
		};
		delete process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;

		const tokenizer = benchmarkFixtures.createMockTokenizer();
		const { documents, queryCases } = benchmarkFixtures.createAutomationCorpus();
		container.registerInstance(Tokenizer, tokenizer);

		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => CoverageLexicalEngineLike;
		};

		const rebuildEngine = new CoverageLexicalFileSearchEngine();
		const rebuildStartedAt = performance.now();
		await rebuildEngine.addDocuments(documents);
		const rebuildMs = performance.now() - rebuildStartedAt;

		const serializeStartedAt = performance.now();
		const snapshot = rebuildEngine.serialize() as Record<string, unknown> | null;
		const snapshotWriteMs = performance.now() - serializeStartedAt;
		expect(snapshot).not.toBeNull();
		expect(snapshot).toMatchObject({
			__backend: "coverage-lexical",
			__version: 2,
			__encoding: "binary-snapshot-v2",
		});
		expect(snapshot?.data).toBeInstanceOf(ArrayBuffer);
		const snapshotBytes = (snapshot?.data as ArrayBuffer).byteLength;

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
		container.registerInstance(Tokenizer, tokenizer);

		const hydratedEngine = new CoverageLexicalFileSearchEngine();
		const hydrateStartedAt = performance.now();
		const restoreOk = await hydratedEngine.reIndexAll(snapshot);
		const hydrateMs = performance.now() - hydrateStartedAt;
		expect(restoreOk).toBe(true);
		const readyToSearchMs = hydrateMs;

		const smokeQueries = [
			queryCases[0],
			queryCases[Math.floor(queryCases.length / 2)],
			queryCases[queryCases.length - 1],
		].filter(
			(
				queryCase,
			): queryCase is { query: string; relevantPath: string } => queryCase != null,
		);
		for (const queryCase of smokeQueries) {
			const results = await hydratedEngine.searchFiles({
				queryText: queryCase.query,
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 10,
			});
			expect(results.some((result) => result.path === queryCase.relevantPath)).toBe(
				true,
			);
		}

		const estimatedIndexBytes = rebuildEngine.estimateIndexBytes?.() ?? 0;
		const snapshotVsEstimatedIndexRatio =
			estimatedIndexBytes > 0 ? snapshotBytes / estimatedIndexBytes : null;
		const hydrateVsRebuildRatio = rebuildMs > 0 ? hydrateMs / rebuildMs : null;
		const readyVsRebuildRatio =
			rebuildMs > 0 ? readyToSearchMs / rebuildMs : null;

		console.log(
			"[coverage-lexical-startup-snapshot] anchor",
			JSON.stringify(
				{
					corpus: {
						noteCount: documents.length,
						queryCount: queryCases.length,
					},
					snapshot: {
						snapshotBytes,
						snapshotWriteMs: round(snapshotWriteMs),
						hydrateMs: round(hydrateMs),
						readyToSearchMs: round(readyToSearchMs),
						fallbackRebuildMs: round(rebuildMs),
						selfHealRepairMs: null,
						repairChangedDocCount: 0,
						estimatedIndexBytes,
					},
					ratios: {
						hydrateVsRebuild:
							hydrateVsRebuildRatio == null
								? null
								: round(hydrateVsRebuildRatio),
						readyToSearchVsRebuild:
							readyVsRebuildRatio == null ? null : round(readyVsRebuildRatio),
						snapshotVsEstimatedIndex:
							snapshotVsEstimatedIndexRatio == null
								? null
								: round(snapshotVsEstimatedIndexRatio),
					},
				},
				null,
				2,
			),
		);
	});
});

function round(value: number): number {
	return Number(value.toFixed(3));
}
