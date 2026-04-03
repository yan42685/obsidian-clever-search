import { performance } from "perf_hooks";
import { container } from "tsyringe";
import { BM25Engine } from "src/services/search/hybrid/bm25";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
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

type QueryCase = {
	query: string;
	relevantPath: string;
	type: string;
	suite: string;
};

type BenchmarkMetric = {
	top1: number;
	top3: number;
	top5: number;
	zeroRate: number;
	count: number;
};

type QueryOutcome = {
	query: string;
	relevantPath: string;
	type: string;
	suite: string;
	rank: number;
	fileMatchRank?: number;
	shortlistRank?: number;
	shortlistSize?: number;
};

type BenchmarkEvaluation = {
	metric: BenchmarkMetric;
	outcomes: QueryOutcome[];
};

type FocusDiagnostic = {
	query: string;
	relevantPath: string;
	type: string;
	suite: string;
	fileMatchTop5: string[];
	shortlistTop5: string[];
	fileAggregatesTop5: Array<{
		path: string;
		aggregateScore: number;
		bestScore: number;
		subItemScores: number[];
		subItemSnippets: string[];
	}>;
	displayTop5: Array<{
		path: string;
		score: number;
		snippetText: string;
	}>;
};

type OutcomeRegression = {
	query: string;
	relevantPath: string;
	type: string;
	suite: string;
	baselineRank: number;
	lexicalRank: number;
	rankDelta: number;
	fileMatchRank: number;
	shortlistRank: number;
	shortlistSize: number;
};

function createMockTokenizer(): MockTokenizer {
	return {
		tokenize(text: string): string[] {
			return text
				.split(/[^A-Za-z0-9_-]+/g)
				.map((term) => term.trim())
				.filter((term) => term.length > 0);
		},
		tokenizeSequence(text: string): string[] {
			return text
				.split(/[^A-Za-z0-9_-]+/g)
				.map((term) => term.trim())
				.filter((term) => term.length > 0);
		},
	};
}

function round(value: number): number {
	return Number(value.toFixed(3));
}

function createEmptyMetric(): BenchmarkMetric {
	return {
		top1: 0,
		top3: 0,
		top5: 0,
		zeroRate: 0,
		count: 0,
	};
}

function updateMetric(metric: BenchmarkMetric, rank: number): void {
	metric.count += 1;
	metric.top1 += rank === 1 ? 1 : 0;
	metric.top3 += rank > 0 && rank <= 3 ? 1 : 0;
	metric.top5 += rank > 0 && rank <= 5 ? 1 : 0;
	metric.zeroRate += rank === 0 ? 1 : 0;
}

function finalizeMetric(metric: BenchmarkMetric): BenchmarkMetric {
	if (metric.count === 0) {
		return metric;
	}
	return {
		count: metric.count,
		top1: round(metric.top1 / metric.count),
		top3: round(metric.top3 / metric.count),
		top5: round(metric.top5 / metric.count),
		zeroRate: round(metric.zeroRate / metric.count),
	};
}

function createOutcome(
	queryCase: QueryCase,
	rank: number,
	diagnostics: Partial<
		Pick<QueryOutcome, "fileMatchRank" | "shortlistRank" | "shortlistSize">
	> = {},
): QueryOutcome {
	return {
		query: queryCase.query,
		relevantPath: queryCase.relevantPath,
		type: queryCase.type,
		suite: queryCase.suite,
		rank,
		...diagnostics,
	};
}

function summarizeOutcomeBuckets(
	outcomes: readonly QueryOutcome[],
	key: "type" | "suite",
): Array<BenchmarkMetric & { bucket: string }> {
	const byBucket = new Map<string, BenchmarkMetric>();
	for (const outcome of outcomes) {
		const bucket = outcome[key];
		const metric = byBucket.get(bucket) ?? createEmptyMetric();
		updateMetric(metric, outcome.rank);
		if (!byBucket.has(bucket)) {
			byBucket.set(bucket, metric);
		}
	}
	return [...byBucket.entries()]
		.map(([bucket, metric]) => ({
			bucket,
			...finalizeMetric(metric),
		}))
		.sort((left, right) => left.bucket.localeCompare(right.bucket));
}

function compareOutcomeBuckets(params: {
	baseline: readonly QueryOutcome[];
	lexicalLane: readonly QueryOutcome[];
	key: "type" | "suite";
}) {
	const baselineBuckets = summarizeOutcomeBuckets(params.baseline, params.key);
	const lexicalBuckets = summarizeOutcomeBuckets(params.lexicalLane, params.key);
	const baselineByBucket = new Map(
		baselineBuckets.map((bucket) => [bucket.bucket, bucket] as const),
	);
	return lexicalBuckets
		.map((bucket) => {
			const baseline = baselineByBucket.get(bucket.bucket);
			return {
				bucket: bucket.bucket,
				count: bucket.count,
				baselineTop1: baseline?.top1 ?? 0,
				lexicalTop1: bucket.top1,
				top1Delta: round(bucket.top1 - (baseline?.top1 ?? 0)),
				baselineTop3: baseline?.top3 ?? 0,
				lexicalTop3: bucket.top3,
				top3Delta: round(bucket.top3 - (baseline?.top3 ?? 0)),
				baselineZeroRate: baseline?.zeroRate ?? 0,
				lexicalZeroRate: bucket.zeroRate,
				zeroRateDelta: round(bucket.zeroRate - (baseline?.zeroRate ?? 0)),
			};
		})
		.sort(
			(left, right) =>
				left.top1Delta - right.top1Delta ||
				left.top3Delta - right.top3Delta ||
				right.zeroRateDelta - left.zeroRateDelta,
		);
}

function findWorstOutcomeRegressions(params: {
	baseline: readonly QueryOutcome[];
	lexicalLane: readonly QueryOutcome[];
	limit?: number;
}): OutcomeRegression[] {
	const lexicalByKey = new Map(
		params.lexicalLane.map((outcome) => [
			`${outcome.query}\u001f${outcome.relevantPath}`,
			outcome,
		]),
	);
	return params.baseline
		.map((baselineOutcome) => {
			const lexicalOutcome = lexicalByKey.get(
				`${baselineOutcome.query}\u001f${baselineOutcome.relevantPath}`,
			);
			if (!lexicalOutcome) {
				return null;
			}
			return {
				query: baselineOutcome.query,
				relevantPath: baselineOutcome.relevantPath,
				type: baselineOutcome.type,
				suite: baselineOutcome.suite,
				baselineRank: baselineOutcome.rank,
				lexicalRank: lexicalOutcome.rank,
				rankDelta: lexicalOutcome.rank - baselineOutcome.rank,
				fileMatchRank: lexicalOutcome.fileMatchRank ?? 0,
				shortlistRank: lexicalOutcome.shortlistRank ?? 0,
				shortlistSize: lexicalOutcome.shortlistSize ?? 0,
			};
		})
		.filter((outcome): outcome is OutcomeRegression => outcome !== null)
		.sort((left, right) => {
			const leftMissPenalty = left.lexicalRank === 0 ? 100 : 0;
			const rightMissPenalty = right.lexicalRank === 0 ? 100 : 0;
			return (
				right.rankDelta +
				rightMissPenalty -
				(left.rankDelta + leftMissPenalty) ||
				left.baselineRank - right.baselineRank ||
				left.query.localeCompare(right.query)
			);
		})
		.slice(0, params.limit ?? 12);
}

function documentText(document: IndexedDocument): string {
	return [
		document.path,
		document.basename,
		document.folder,
		document.aliases ?? "",
		document.tags ?? "",
		document.headings ?? "",
		document.content ?? "",
	].join("\n");
}

function ensureBrowserLikeWindow(): void {
	const globalScope = globalThis as Record<string, unknown>;
	const existingWindow = globalScope.window as
		| { localStorage?: Storage }
		| undefined;
	if (existingWindow?.localStorage) {
		return;
	}
	const store = new Map<string, string>();
	globalScope.window = {
		localStorage: {
			get length(): number {
				return store.size;
			},
			getItem(key: string): string | null {
				return store.has(key) ? store.get(key) ?? null : null;
			},
			setItem(key: string, value: string): void {
				store.set(key, value);
			},
			removeItem(key: string): void {
				store.delete(key);
			},
			clear(): void {
				store.clear();
			},
			key(index: number): string | null {
				return Array.from(store.keys())[index] ?? null;
			},
		},
	} satisfies { localStorage: Storage };
}

function loadAutomationCorpus(): {
	documents: IndexedDocument[];
	queryCases: QueryCase[];
} {
	const globalScope = globalThis as Record<string, unknown>;
	const hookNames = [
		"describe",
		"it",
		"test",
		"beforeEach",
		"afterEach",
		"beforeAll",
		"afterAll",
	];
	const originals = new Map<string, unknown>();
	const noop = () => undefined;
	for (const hookName of hookNames) {
		originals.set(hookName, globalScope[hookName]);
		globalScope[hookName] = noop;
	}
	try {
		const modulePath = require.resolve("./coverage-lexical-automation-benchmark.bench");
		delete require.cache[modulePath];
		const fixtureModule = require(modulePath) as {
			createAutomationCorpus: () => {
				documents: IndexedDocument[];
				queryCases: QueryCase[];
			};
		};
		return fixtureModule.createAutomationCorpus();
	} finally {
		for (const hookName of hookNames) {
			globalScope[hookName] = originals.get(hookName);
		}
	}
}

async function evaluateLexicalLaneAgainstCorpus(params: {
	documents: readonly IndexedDocument[];
	queryCases: readonly QueryCase[];
	tokenizer: MockTokenizer;
}): Promise<BenchmarkEvaluation> {
	ensureBrowserLikeWindow();
	const { OuterSetting, DEFAULT_OUTER_SETTING } = require(
		"src/globals/plugin-setting",
	) as typeof import("src/globals/plugin-setting");
	const { CoverageLexicalFileSearchEngine } = require(
		"src/services/search/coverage-lexical/coverage-lexical-engine",
	) as typeof import("src/services/search/coverage-lexical/coverage-lexical-engine");
	const { buildHybridLexicalLaneFileCandidates } = require(
		"src/services/search/hybrid/lexical-lane/file-shortlist",
	) as typeof import("src/services/search/hybrid/lexical-lane/file-shortlist");
	const { buildHybridLexicalLaneBlockCandidatesForSnapshot } = require(
		"src/services/search/hybrid/lexical-lane/local-block-recall",
	) as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");
	const { runHybridLexicalLaneFileItemPipeline } = require(
		"src/services/search/hybrid/lexical-lane",
	) as typeof import("src/services/search/hybrid/lexical-lane");
	const { runHybridLexicalLaneCandidatePipeline } = require(
		"src/services/search/hybrid/lexical-lane",
	) as typeof import("src/services/search/hybrid/lexical-lane");

	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.isCaseSensitive = false;
	setting.isPrefixMatch = true;
	setting.isFuzzy = true;
	setting.enableChinesePatch = false;
	setting.enableStopWordsEn = false;
	setting.enableStopWordsZh = false;
	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, {
		useValue: params.tokenizer,
	});

	const engine = new CoverageLexicalFileSearchEngine();
	await engine.addDocuments([...params.documents]);

	const docByPath = new Map(
		params.documents.map((document) => [document.path, document] as const),
	);
	const metric = createEmptyMetric();
	const outcomes: QueryOutcome[] = [];
	const focusDiagnostics: FocusDiagnostic[] = [];
	for (const queryCase of params.queryCases) {
		const matchedFiles = await engine.searchFiles({
			queryText: queryCase.query,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 24,
		});
		const fileCandidates = buildHybridLexicalLaneFileCandidates({
			queryText: queryCase.query,
			limit: 8,
			matches: matchedFiles.map((match, index) => ({
				path: match.path,
				score: match.score ?? 0,
				rank: index,
			})),
		resolveMetadata: (path) => {
			const document = docByPath.get(path);
			if (!document) {
				return null;
			}
			return {
				aliases: parseSyntheticMetadataList(document.aliases),
				headings: parseSyntheticMetadataList(document.headings),
			};
		},
	});

		const snapshotTextByPath = new Map<string, string>();
		const blockCandidates = fileCandidates.flatMap((fileCandidate) => {
			const document = docByPath.get(fileCandidate.filePath);
			const snapshotText = document?.content ?? "";
			snapshotTextByPath.set(fileCandidate.filePath, snapshotText);
			return buildHybridLexicalLaneBlockCandidatesForSnapshot({
				queryText: queryCase.query,
				file: fileCandidate,
				snapshotText,
				maxBlocksPerFile: 8,
			});
		});
		const displayCandidates = runHybridLexicalLaneCandidatePipeline({
			blockCandidates,
			snapshotTextByPath,
			rerankTopK: 16,
			displayTopK: 8,
		});

		const fileItems = runHybridLexicalLaneFileItemPipeline({
			queryText: queryCase.query,
			blockCandidates,
			snapshotTextByPath,
			rerankTopK: 16,
			displayTopK: 8,
		});
		const fileMatchRank =
			matchedFiles.findIndex((match) => match.path === queryCase.relevantPath) + 1;
		const shortlistRank =
			fileCandidates.findIndex(
				(fileCandidate) => fileCandidate.filePath === queryCase.relevantPath,
			) + 1;
		const rank =
			fileItems.findIndex((item: { path: string }) => item.path === queryCase.relevantPath) +
			1;
		updateMetric(metric, rank);
		outcomes.push(
			createOutcome(queryCase, rank, {
				fileMatchRank,
				shortlistRank,
				shortlistSize: fileCandidates.length,
			}),
		);
		if (
			queryCase.type === "title_exact" ||
			queryCase.type === "template_collision"
		) {
			focusDiagnostics.push({
				query: queryCase.query,
				relevantPath: queryCase.relevantPath,
				type: queryCase.type,
				suite: queryCase.suite,
				fileMatchTop5: matchedFiles.slice(0, 5).map((match) => match.path),
				shortlistTop5: fileCandidates.slice(0, 5).map((candidate) => candidate.filePath),
				fileAggregatesTop5: summarizeFileAggregates(
					fileItems as Array<{ path: string; subItems: Array<{ score?: number }> }>,
				).slice(0, 5),
				displayTop5: displayCandidates.slice(0, 5).map((candidate) => ({
					path: candidate.filePath,
					score: round(candidate.score),
					snippetText: candidate.snippetText,
				})),
			});
		}
	}
	console.log(
		"[hybrid-lexical-lane-benchmark] focus-diagnostics",
		JSON.stringify(focusDiagnostics, null, 2),
	);
	return {
		metric: finalizeMetric(metric),
		outcomes,
	};
}

function parseSyntheticMetadataList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	const normalized = value
		.split(/\s*;\s*/u)
		.map((item) => item.replace(/\s+/g, " ").trim())
		.filter((item) => item.length > 0);
	return normalized.length > 0 ? normalized : [];
}

function summarizeFileAggregates(
	fileItems: ReadonlyArray<{
		path: string;
		subItems: Array<{ score?: number; snippetText?: string; snippet?: string }>;
	}>,
): Array<{
	path: string;
	aggregateScore: number;
	bestScore: number;
	subItemScores: number[];
	subItemSnippets: string[];
}> {
	return fileItems.map((item) => {
		const subItemScores = item.subItems.map((subItem) => round(subItem.score ?? 0));
		const bestScore = subItemScores[0] ?? 0;
		const secondary = item.subItems.slice(1, 4).reduce((sum, subItem, index) => {
			const weight = index === 0 ? 0.24 : index === 1 ? 0.12 : 0.06;
			return sum + (subItem.score ?? 0) * weight;
		}, 0);
		return {
			path: item.path,
			aggregateScore: round(
				bestScore + secondary + Math.min(6, Math.max(0, subItemScores.length - 1) * 1.5),
			),
			bestScore,
			subItemScores,
			subItemSnippets: item.subItems
				.slice(0, 3)
				.map((subItem) =>
					(subItem.snippetText ?? subItem.snippet ?? "")
						.replace(/\s+/g, " ")
						.trim()
						.slice(0, 140),
				),
		};
	});
}

describe("hybrid BM25 query expansion", () => {
	beforeEach(() => {
		container.clearInstances();
		container.registerInstance(Tokenizer, createMockTokenizer() as InstanceType<typeof Tokenizer>);
	});

	test("matches case-folded query terms without requiring exact casing", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "calendar event schedule");
		bm25.addDocument(2, "kanban lane cards");

		const results = bm25.search("Calendar", 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("exact search does not depend on building the expansion lexicon first", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "markdown export flow");
		bm25.addDocument(2, "kanban lane cards");

		const results = bm25.search("MARKDOWN", 5, {
			useProximity: false,
			enableQueryExpansion: false,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("expands prefix queries for longer hybrid entity terms", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "calendar event schedule");
		bm25.addDocument(2, "kanban lane cards");

		const results = bm25.search("calend", 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("recovers a single-typo hybrid entity query with fuzzy expansion", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "dataview inline fields metadata");
		bm25.addDocument(2, "calendar event schedule");

		const results = bm25.search("dateview", 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});

		expect(results[0]?.docId).toBe(1);
	});

	test("keeps only the highest scoring topK matches without sorting the full tail", () => {
		const bm25 = new BM25Engine();
		bm25.addDocument(1, "alpha alpha alpha alpha");
		bm25.addDocument(2, "alpha alpha alpha");
		bm25.addDocument(3, "alpha alpha");
		bm25.addDocument(4, "alpha");
		bm25.addDocument(5, "beta");

		const results = bm25.search("alpha", 2, {
			useProximity: false,
			enableQueryExpansion: false,
		});

		expect(results.map((item) => item.docId)).toEqual([1, 2]);
	});

test("compares lexical lane against BM25 baseline on the automation corpus", async () => {
		const { documents, queryCases } = loadAutomationCorpus();
		const tokenizer = createMockTokenizer();
		container.registerInstance(
			Tokenizer,
			tokenizer as InstanceType<typeof Tokenizer>,
		);
		const bm25 = new BM25Engine();
		const docPathById = new Map<number, string>();

		documents.forEach((document, index) => {
			const docId = index + 1;
			docPathById.set(docId, document.path);
			bm25.addDocument(docId, documentText(document));
		});

		const baselineMetric = createEmptyMetric();
		const baselineOutcomes: QueryOutcome[] = [];
		const baselineStartedAt = performance.now();
		for (const queryCase of queryCases) {
			const results = bm25.search(queryCase.query, 8, {
				useProximity: false,
				enableQueryExpansion: true,
			});
			const rank =
				results
					.map((result) => docPathById.get(result.docId) ?? null)
					.filter((path): path is string => path !== null)
					.findIndex((path) => path === queryCase.relevantPath) + 1;
			updateMetric(baselineMetric, rank);
			baselineOutcomes.push(createOutcome(queryCase, rank));
		}
		const baselineElapsedMs = performance.now() - baselineStartedAt;
		const lexicalStartedAt = performance.now();
		const lexicalEvaluation = await evaluateLexicalLaneAgainstCorpus({
			documents,
			queryCases,
			tokenizer,
		});
		const lexicalElapsedMs = performance.now() - lexicalStartedAt;
		const finalizedBaselineMetric = finalizeMetric(baselineMetric);
		const typeBreakdown = compareOutcomeBuckets({
			baseline: baselineOutcomes,
			lexicalLane: lexicalEvaluation.outcomes,
			key: "type",
		});
		const suiteBreakdown = compareOutcomeBuckets({
			baseline: baselineOutcomes,
			lexicalLane: lexicalEvaluation.outcomes,
			key: "suite",
		});
		const focusedWarmStartOutcome = lexicalEvaluation.outcomes.find(
			(outcome) =>
				outcome.query === "template incident warm-start recovery" &&
				outcome.relevantPath === "pkm-en/incidents/incident-review.md",
		);
		const worstQueryRegressions = findWorstOutcomeRegressions({
			baseline: baselineOutcomes,
			lexicalLane: lexicalEvaluation.outcomes,
			limit: 12,
		});

		console.log("[hybrid-lexical-lane-benchmark] compare", {
			corpus: {
				documents: documents.length,
				queries: queryCases.length,
			},
			bm25Baseline: {
				...finalizedBaselineMetric,
				avgMsPerQuery: round(baselineElapsedMs / Math.max(1, queryCases.length)),
			},
			lexicalLane: {
				...lexicalEvaluation.metric,
				avgMsPerQuery: round(lexicalElapsedMs / Math.max(1, queryCases.length)),
			},
			worstTypes: typeBreakdown.slice(0, 6),
			worstSuites: suiteBreakdown.slice(0, 6),
			worstQueryRegressions,
		});

		expect(lexicalEvaluation.metric.top3).toBeGreaterThanOrEqual(
			Math.max(0.6, finalizedBaselineMetric.top3 - 0.1),
		);
		expect(lexicalEvaluation.metric.top5).toBeGreaterThanOrEqual(
			Math.max(0.75, finalizedBaselineMetric.top5 - 0.08),
		);
		expect(lexicalEvaluation.metric.zeroRate).toBeLessThanOrEqual(
			Math.min(0.2, finalizedBaselineMetric.zeroRate + 0.06),
		);
		expect(focusedWarmStartOutcome?.rank ?? 0).toBeGreaterThanOrEqual(1);
		expect(focusedWarmStartOutcome?.rank ?? 99).toBeLessThanOrEqual(3);
	});
});
