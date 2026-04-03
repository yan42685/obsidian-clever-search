jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import { container } from "tsyringe";

type GuardQueryCase = {
	query: string;
	relevantPath: string;
	type: string;
};

type GuardIndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

type GuardMetrics = {
	top1: number;
	top3: number;
	top5: number;
	zeroRate: number;
};

function resetContainer(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
		return;
	}
	container.clearInstances();
}

function createCoverageLexicalHarness(tokenizer: {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
}) {
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting");
	const { Tokenizer } = require("src/services/search/tokenizer");
	const { CoverageLexicalFileSearchEngine } = require(
		"src/services/search/coverage-lexical/coverage-lexical-engine",
	);
	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.fileSearchBackend = "coverage-lexical";
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = false;
	setting.enableStopWordsEn = false;
	setting.enableStopWordsZh = false;

	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, { useValue: tokenizer });

	return new CoverageLexicalFileSearchEngine() as {
		addDocuments(documents: GuardIndexedDocument[]): Promise<void>;
		searchFiles(request: {
			queryText: string;
			isPrefixMatch: boolean;
			isFuzzy: boolean;
			maxItemResults: number;
		}): Promise<Array<{ path: string }>>;
	};
}

async function measureFamilyMetrics(params: {
	engine: {
		searchFiles(request: {
			queryText: string;
			isPrefixMatch: boolean;
			isFuzzy: boolean;
			maxItemResults: number;
		}): Promise<Array<{ path: string }>>;
	};
	queryCases: GuardQueryCase[];
	type: "mixed_script_anchor" | "partial_memory";
}): Promise<GuardMetrics> {
	const targets = params.queryCases.filter((queryCase) => queryCase.type === params.type);
	expect(targets.length).toBeGreaterThan(0);

	let top1Hits = 0;
	let top3Hits = 0;
	let top5Hits = 0;
	let misses = 0;

	for (const queryCase of targets) {
		const results = await params.engine.searchFiles({
			queryText: queryCase.query,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});
		const rank = results.findIndex((item) => item.path === queryCase.relevantPath) + 1;
		if (rank === 1) {
			top1Hits += 1;
		}
		if (rank > 0 && rank <= 3) {
			top3Hits += 1;
		}
		if (rank > 0 && rank <= 5) {
			top5Hits += 1;
		}
		if (rank === 0) {
			misses += 1;
		}
	}

	const total = targets.length;
	return {
		top1: top1Hits / total,
		top3: top3Hits / total,
		top5: top5Hits / total,
		zeroRate: misses / total,
	};
}

describe("hybrid BM25 retirement guard", () => {
	test("keeps lexical benchmark families at the current baseline", async () => {
		process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		resetContainer();

		try {
			const {
				createAutomationCorpus,
				createMockTokenizer,
			} = require("tests/src/services/search/coverage-lexical-automation-benchmark.bench");
			const { documents, queryCases } = createAutomationCorpus() as {
				documents: GuardIndexedDocument[];
				queryCases: GuardQueryCase[];
			};
			const engine = createCoverageLexicalHarness(createMockTokenizer());
			await engine.addDocuments(documents);

			const mixedScript = await measureFamilyMetrics({
				engine,
				queryCases,
				type: "mixed_script_anchor",
			});
			expect(mixedScript.top1).toBeGreaterThanOrEqual(0.5);
			expect(mixedScript.top3).toBeGreaterThanOrEqual(0.75);
			expect(mixedScript.top5).toBeGreaterThanOrEqual(1);
			expect(mixedScript.zeroRate).toBeLessThanOrEqual(0);

			const partialMemory = await measureFamilyMetrics({
				engine,
				queryCases,
				type: "partial_memory",
			});
			expect(partialMemory.top1).toBeGreaterThanOrEqual(0.8);
			expect(partialMemory.top3).toBeGreaterThanOrEqual(0.95);
			expect(partialMemory.top5).toBeGreaterThanOrEqual(1);
			expect(partialMemory.zeroRate).toBeLessThanOrEqual(0);
		} finally {
			delete process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;
			delete (global as any).window;
			resetContainer();
		}
	});
});