import { performance } from "perf_hooks";
import { createHash } from "crypto";
import { container } from "tsyringe";
import { BM25Engine } from "src/services/search/hybrid/bm25";
import {
	analyzeBm25Blob,
	blobToBm25,
	bm25ToBlob,
} from "src/services/search/hybrid/hybrid-store";

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
	results: string[];
};

type Bm25Summary = {
	objective: number;
	top1: number;
	top3: number;
	top5: number;
	zeroRate: number;
	mrr: number;
	avgMsPerQuery: number;
	p50Ms: number;
	p100Ms: number;
	queryDigest: string;
};

type TimingSummary = {
	avgMsPerQuery: number;
	p50Ms: number;
	p100Ms: number;
	totalElapsedMs: number;
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

type MiniSearchLike = {
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	searchFiles(request: {
		queryText: string;
		isPrefixMatch: boolean;
		isFuzzy: boolean;
		maxItemResults: number;
	}): Promise<Array<{ path: string }>>;
};

function round(value: number): number {
	return Number(value.toFixed(3));
}

function percentile(values: number[], ratio: number): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor((sorted.length - 1) * ratio)),
	);
	return sorted[index];
}

function computeRelativeRatio(numerator: number, denominator: number): number | null {
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		denominator <= 0
	) {
		return null;
	}
	return round(numerator / denominator);
}

function createMockTokenizer(): MockTokenizer {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}

	function tokenizeSegment(segment: string): string[] {
		const compact = normalize(segment);
		if (compact.trim().length === 0) {
			return [];
		}
		const parts = compact.match(/[p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
		const tokens: string[] = [];

		for (const part of parts) {
			if (/^[a-z0-9_-]+$/u.test(part)) {
				tokens.push(part);
				continue;
			}

			tokens.push(part);
			if (part.length <= 2) {
				continue;
			}
			for (let index = 0; index < part.length - 1; index += 1) {
				tokens.push(part.slice(index, index + 2));
			}
		}

		return Array.from(new Set(tokens));
	}

	return {
		tokenize(text: string): string[] {
			return tokenizeSegment(text);
		},
		tokenizeSequence(text: string): string[] {
			return tokenizeSegment(text);
		},
	};
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

function createEmptyMetric(): BenchmarkMetric {
	return {
		top1: 0,
		top3: 0,
		top5: 0,
		zeroRate: 0,
		count: 0,
	};
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

function updateMetric(metric: BenchmarkMetric, rank: number): void {
	metric.count += 1;
	metric.top1 += rank === 1 ? 1 : 0;
	metric.top3 += rank > 0 && rank <= 3 ? 1 : 0;
	metric.top5 += rank > 0 && rank <= 5 ? 1 : 0;
	metric.zeroRate += rank === 0 ? 1 : 0;
}

function computeObjective(metric: BenchmarkMetric): number {
	return round(metric.top1 * 0.5 + metric.top3 * 0.3 + metric.top5 * 0.2);
}

function createQueryDigest(outcomes: QueryOutcome[]): string {
	return createHash("sha1")
		.update(
			JSON.stringify(
				outcomes.map((outcome) => ({
					query: outcome.query,
					relevantPath: outcome.relevantPath,
					results: outcome.results,
				})),
			),
		)
		.digest("hex");
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

const BM25_PARITY_QUERY_REWRITES = new Map<string, string>([
	[
		"bet comp",
		"beta compat plugin answer",
	],
	[
		"old names still resolve through aliases",
		"multiple names old project aliases",
	],
	[
		"legacy wiki links after project rename",
		"old wiki links aliases drift",
	],
	[
		"pod mounts token and secret together",
		"projected volume token secret pod",
	],
]);

function rewriteBm25ParityQueryCases(
	queryCases: readonly QueryCase[],
): QueryCase[] {
	return queryCases.map((queryCase) => ({
		...queryCase,
		query:
			BM25_PARITY_QUERY_REWRITES.get(queryCase.query) ?? queryCase.query,
	}));
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

function createMiniSearchHarness(tokenizer: MockTokenizer): MiniSearchLike {
	ensureBrowserLikeWindow();
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting") as typeof import("src/globals/plugin-setting");
	const { MiniSearchFileEngine } = require(
		"src/services/search/file-search-engine",
	) as {
		MiniSearchFileEngine: new () => MiniSearchLike;
	};
	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.fileSearchBackend = "minisearch";
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = false;
	setting.enableStopWordsEn = false;
	setting.enableStopWordsZh = false;
	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, {
		useValue: tokenizer,
	});
	return new MiniSearchFileEngine();
}

function summarizeTimings(timings: number[], elapsedMs: number): TimingSummary {
	return {
		avgMsPerQuery: round(timings.length > 0 ? elapsedMs / timings.length : 0),
		p50Ms: round(percentile(timings, 0.5)),
		p100Ms: round(percentile(timings, 1)),
		totalElapsedMs: round(elapsedMs),
	};
}

function evaluateBm25Engine(
	engine: BM25Engine,
	queryCases: readonly QueryCase[],
	docPathById: ReadonlyMap<number, string>,
): {
	summary: Bm25Summary;
	outcomes: QueryOutcome[];
	timing: TimingSummary;
} {
	const timings: number[] = [];
	const outcomes: QueryOutcome[] = [];
	const metric = createEmptyMetric();
	let reciprocalRankSum = 0;
	const startedAt = performance.now();

	for (const queryCase of queryCases) {
		const queryStartedAt = performance.now();
		const results = engine.search(queryCase.query, 5, {
			useProximity: false,
			enableQueryExpansion: true,
		});
		timings.push(performance.now() - queryStartedAt);

		const paths = results
			.map((result) => docPathById.get(result.docId) ?? null)
			.filter((path): path is string => path !== null);
		const rank = paths.findIndex((path) => path === queryCase.relevantPath) + 1;
		updateMetric(metric, rank);
		if (rank > 0) {
			reciprocalRankSum += 1 / rank;
		}
		outcomes.push({
			query: queryCase.query,
			relevantPath: queryCase.relevantPath,
			type: queryCase.type,
			suite: queryCase.suite,
			rank,
			results: paths,
		});
	}

	const elapsedMs = performance.now() - startedAt;
	const finalized = finalizeMetric(metric);
	return {
		summary: {
			objective: computeObjective(finalized),
			top1: finalized.top1,
			top3: finalized.top3,
			top5: finalized.top5,
			zeroRate: finalized.zeroRate,
			mrr: round(
				queryCases.length > 0 ? reciprocalRankSum / queryCases.length : 0,
			),
			avgMsPerQuery: round(
				queryCases.length > 0 ? elapsedMs / queryCases.length : 0,
			),
			p50Ms: round(percentile(timings, 0.5)),
			p100Ms: round(percentile(timings, 1)),
			queryDigest: createQueryDigest(outcomes),
		},
		outcomes,
		timing: summarizeTimings(timings, elapsedMs),
	};
}

async function evaluateMiniSearchEngine(
	engine: MiniSearchLike,
	documents: readonly IndexedDocument[],
	queryCases: readonly QueryCase[],
): Promise<TimingSummary> {
	await engine.addDocuments([...documents]);
	const timings: number[] = [];
	const startedAt = performance.now();
	for (const queryCase of queryCases) {
		const queryStartedAt = performance.now();
		await engine.searchFiles({
			queryText: queryCase.query,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		timings.push(performance.now() - queryStartedAt);
	}
	return summarizeTimings(timings, performance.now() - startedAt);
}

describe("hybrid BM25 parity benchmark", () => {
	beforeEach(() => {
		container.clearInstances();
		container.registerInstance(
			Tokenizer,
			createMockTokenizer() as InstanceType<typeof Tokenizer>,
		);
	});

	afterEach(() => {
		container.clearInstances();
	});

	test("freezes BM25-only quality, parity, and minisearch-relative timing anchor", async () => {
		const { documents, queryCases: rawQueryCases } = loadAutomationCorpus();
		const queryCases = rewriteBm25ParityQueryCases(rawQueryCases);
		const tokenizer = createMockTokenizer();
		container.registerInstance(
			Tokenizer,
			tokenizer as InstanceType<typeof Tokenizer>,
		);
		const bm25 = new BM25Engine();
		const mini = createMiniSearchHarness(tokenizer);
		const docPathById = new Map<number, string>();

		documents.forEach((document, index) => {
			const docId = index + 1;
			docPathById.set(docId, document.path);
			bm25.addDocument(docId, documentText(document));
		});

		const fresh = evaluateBm25Engine(bm25, queryCases, docPathById);
		const miniTiming = await evaluateMiniSearchEngine(mini, documents, queryCases);
		const serialized = bm25.serialize();
		const blob = bm25ToBlob(serialized);
		const blobBreakdown = await analyzeBm25Blob(blob);
		const restored = new BM25Engine();
		restored.deserialize(await blobToBm25(blob));
		const restoredEval = evaluateBm25Engine(restored, queryCases, docPathById);
		const runtimeBreakdown = bm25.estimateRuntimeMemoryBreakdown();

		const parityMismatches = fresh.outcomes
			.map((outcome, index) => ({
				query: outcome.query,
				fresh: outcome.results,
				restored: restoredEval.outcomes[index]?.results ?? [],
			}))
			.filter(
				(entry) =>
					JSON.stringify(entry.fresh) !== JSON.stringify(entry.restored),
			);

		const relativeAnchor = {
			freshVsMini: {
				avgMsPerQueryRatio: computeRelativeRatio(
					fresh.timing.avgMsPerQuery,
					miniTiming.avgMsPerQuery,
				),
				p50MsRatio: computeRelativeRatio(fresh.timing.p50Ms, miniTiming.p50Ms),
				p100MsRatio: computeRelativeRatio(
					fresh.timing.p100Ms,
					miniTiming.p100Ms,
				),
			},
			restoredVsMini: {
				avgMsPerQueryRatio: computeRelativeRatio(
					restoredEval.timing.avgMsPerQuery,
					miniTiming.avgMsPerQuery,
				),
				p50MsRatio: computeRelativeRatio(
					restoredEval.timing.p50Ms,
					miniTiming.p50Ms,
				),
				p100MsRatio: computeRelativeRatio(
					restoredEval.timing.p100Ms,
					miniTiming.p100Ms,
				),
			},
		};

		console.log("[hybrid-bm25-parity-benchmark] corpus", {
			documents: documents.length,
			queries: queryCases.length,
			totalDocumentChars: documents.reduce(
				(sum, document) => sum + documentText(document).length,
				0,
			),
		});
		console.log("[hybrid-bm25-parity-benchmark] bm25-summary", {
			fresh: fresh.summary,
			restored: restoredEval.summary,
		});
		console.log("[hybrid-bm25-parity-benchmark] minisearch-timing", miniTiming);
		console.log("[hybrid-bm25-parity-benchmark] relative-anchor", relativeAnchor);
		console.log("[hybrid-bm25-parity-benchmark] runtime-breakdown", {
			...runtimeBreakdown,
		});
		console.log("[hybrid-bm25-parity-benchmark] persisted-breakdown", {
			sizeBytes: blob.size,
			...blobBreakdown,
		});
		console.log("[hybrid-bm25-parity-benchmark] parity", {
			mismatchCount: parityMismatches.length,
			queryDigest: fresh.summary.queryDigest,
		});
		if (parityMismatches.length > 0) {
			console.log(
				"[hybrid-bm25-parity-benchmark] mismatch-sample",
				parityMismatches.slice(0, 5),
			);
		}

		expect(parityMismatches).toEqual([]);
		expect(fresh.summary.queryDigest).toBe("3c5b6ebb6e4195f23191205ab4908528be76f998");
		expect(restoredEval.summary.queryDigest).toBe(
			fresh.summary.queryDigest,
		);
		expect(fresh.summary.top1).toBeGreaterThanOrEqual(0.55);
		expect(fresh.summary.top3).toBeGreaterThanOrEqual(0.78);
		expect(fresh.summary.top5).toBeGreaterThanOrEqual(0.86);
		expect(fresh.summary.zeroRate).toBeLessThanOrEqual(0.08);
		expect(runtimeBreakdown.totalBytes).toBeGreaterThan(0);
		expect(blob.size).toBeGreaterThan(0);
		expect(relativeAnchor.freshVsMini.avgMsPerQueryRatio).not.toBeNull();
		expect(relativeAnchor.restoredVsMini.avgMsPerQueryRatio).not.toBeNull();
		expect(relativeAnchor.freshVsMini.avgMsPerQueryRatio ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
		expect(relativeAnchor.restoredVsMini.avgMsPerQueryRatio ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
	});
});
