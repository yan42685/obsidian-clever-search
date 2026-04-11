import { performance } from "perf_hooks";
import type { CoverageLexicalV2CandidateCascadeTrace } from "src/services/search/coverage-lexical-v2";
import { container } from "tsyringe";

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
	generation?: number;
};

type EngineLike = {
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	searchFiles(request: {
		queryText: string;
		isPrefixMatch: boolean;
		isFuzzy: boolean;
		maxItemResults: number;
	}): Promise<Array<{ path: string }>>;
	getLastBenchmarkV2CandidateCascadeDebug?():
		| CoverageLexicalV2CandidateCascadeTrace
		| null;
};

type StressSweepMode = "full" | "focused" | "staircase";
type StressScenarioProfile = "mixed" | "hot_only" | "all_cold";

type StressScenarioInput = {
	mode: StressSweepMode;
	profile: StressScenarioProfile;
	bucketDocCount: number;
	bodyTokensPerDoc: number;
	coldMatchingDocCount: number;
	targetVerificationBodyTokenSum: number;
	matchingDocTokenCounts?: readonly number[];
};

type StressScenarioMeasurement = {
	searchMs: number;
	resultCount: number;
	verificationBucketDocCount: number;
	verificationBodyDocCount: number;
	verificationEstimatedBodyTokenSum: number;
	verificationSkippedReason: string;
	coldAvailabilityCount: number;
	hotAvailabilityCount: number;
	residentAvailabilityCount: number;
	missingAvailabilityCount: number;
	coldStoreReadDocCount: number;
	coldStoreReadCallCount: number;
	snapshotReadDocCount: number;
	snapshotReadCallCount: number;
};

type StressScenarioResult = StressScenarioInput & {
	label: string;
	measurementCount: number;
	avgMs: number;
	p50Ms: number;
	p90Ms: number;
	p100Ms: number;
	avgVerificationBucketDocCount: number;
	avgVerificationBodyDocCount: number;
	avgVerificationEstimatedBodyTokenSum: number;
	avgColdAvailabilityCount: number;
	avgHotAvailabilityCount: number;
	avgResidentAvailabilityCount: number;
	avgMissingAvailabilityCount: number;
	avgColdStoreReadDocCount: number;
	avgColdStoreReadCallCount: number;
	avgSnapshotReadDocCount: number;
	avgSnapshotReadCallCount: number;
	overflowRepeatCount: number;
	skippedReasonSummary: string;
};

type StaircaseDocBudgetResult = {
	docCount: number;
	proximityEligible: boolean;
	hotProbeBestTokenSum: number;
	rawRecommendedTokenSum: number;
	monotoneRecommendedTokenSum: number;
	confirmedHotResult: StressScenarioResult | null;
	confirmedColdResult: StressScenarioResult | null;
	confirmedWorstP50Ms: number;
	confirmedWorstP90Ms: number;
	confirmedWorstP100Ms: number;
	nextHigherTokenSum: number | null;
	nextHigherHotResult: StressScenarioResult | null;
	nextHigherColdResult: StressScenarioResult | null;
};

const QUERY_TEXT = "alpha beta";
const MAX_ITEM_RESULTS = 20;
const EVICTION_FILLER_DOC_COUNT = 32;
const EVICTION_FILLER_BODY_TOKENS = 32;
const FULL_REPEAT_COUNT = 3;
const FOCUSED_REPEAT_COUNT = 9;
const FULL_BUCKET_DOC_COUNTS = [1, 4, 8, 12, 16, 20, 24];
const FULL_BODY_TOKENS_PER_DOC_VALUES = [64, 256, 1024, 4096];
const FOCUSED_BUCKET_DOC_COUNTS = [12, 16, 20];
const FOCUSED_TARGET_TOKEN_SUMS = [1024, 16384, 65536, 81920];
const FOCUSED_PROFILES: readonly StressScenarioProfile[] = [
	"hot_only",
	"all_cold",
];
const STAIRCASE_DOC_LIST = (process.env.COVERAGE_LEXICAL_STAIRCASE_DOC_LIST ?? "")
	.split(",")
	.map((part) => Number.parseInt(part.trim(), 10))
	.filter((value) => Number.isInteger(value) && value >= 1);
const STAIRCASE_DOC_COUNT_MIN = Math.max(
	1,
	Number.parseInt(process.env.COVERAGE_LEXICAL_STAIRCASE_DOC_MIN ?? "1", 10) || 1,
);
const STAIRCASE_DOC_COUNT_MAX = Math.max(
	STAIRCASE_DOC_COUNT_MIN,
	Number.parseInt(process.env.COVERAGE_LEXICAL_STAIRCASE_DOC_MAX ?? "32", 10) ||
		32,
);
const STAIRCASE_DOC_COUNTS =
	STAIRCASE_DOC_LIST.length > 0
		? [...new Set(STAIRCASE_DOC_LIST)].sort((left, right) => left - right)
		: Array.from(
				{ length: STAIRCASE_DOC_COUNT_MAX - STAIRCASE_DOC_COUNT_MIN + 1 },
				(_, index) => STAIRCASE_DOC_COUNT_MIN + index,
			);
const STAIRCASE_PROXIMITY_DOC_CAP = 20;
const STAIRCASE_TAIL_TARGET_MS = 120;
const STAIRCASE_COARSE_PROBE_REPEATS = 2;
const STAIRCASE_FINE_PROBE_REPEATS = 3;
const STAIRCASE_CONFIRM_REPEATS = 10;
const STAIRCASE_MAX_TOKEN_SUM = Math.max(
	1024,
	Number.parseInt(
		process.env.COVERAGE_LEXICAL_STAIRCASE_MAX_TOKEN_SUM ?? "131072",
		10,
	) || 131072,
);
const STAIRCASE_MAX_TOKENS_PER_DOC = 32768;
const STAIRCASE_TOKEN_SUM_LADDER = [
	1024,
	2048,
	4096,
	8192,
	12288,
	16384,
	24576,
	32768,
	49152,
	65536,
	81920,
	98304,
	114688,
	131072,
	163840,
	196608,
	262144,
];

function createMockTokenizer(): MockTokenizer {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}

	function tokenizeSegment(segment: string): string[] {
		const compact = normalize(segment);
		if (compact.trim().length === 0) {
			return [];
		}
		const parts = compact.match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
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

function resetStressBenchmarkContainerState(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
	} else {
		container.clearInstances();
	}
}

function createEngineHarness(
	EngineCtor: new () => EngineLike,
	tokenizer: MockTokenizer,
): EngineLike {
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting");
	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.fileSearchBackend = "coverage-lexical";
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = false;
	setting.enableStopWordsEn = false;
	setting.enableStopWordsZh = false;

	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, {
		useValue: tokenizer,
	});

	return new EngineCtor();
}

function registerMockFileSnapshotStore(
	documents: readonly IndexedDocument[],
): {
	currentTexts: Map<string, string>;
	readCurrentTexts: jest.Mock;
	readIndexedTexts: jest.Mock;
} {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const currentTexts = new Map<string, string>();
	for (const document of documents) {
		currentTexts.set(document.path, document.content ?? "");
	}
	const readCurrentTexts = jest.fn(
		async (fileOrPaths: ReadonlyArray<string | { path: string }>) => {
			const result = new Map<string, string>();
			for (const fileOrPath of fileOrPaths) {
				const path =
					typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
				const text = currentTexts.get(path);
				if (text !== undefined) {
					result.set(path, text);
				}
			}
			return result;
		},
	);
	const readIndexedTexts = jest.fn(
		async (
			requests: ReadonlyArray<{
				path: string;
				generation?: number;
			}>,
		) => {
			const result = new Map<string, string>();
			for (const request of requests) {
				const text = currentTexts.get(request.path);
				if (text !== undefined) {
					result.set(request.path, text);
				}
			}
			return result;
		},
	);
	container.registerInstance(FileSnapshotStore, {
		readCurrentTexts,
		readIndexedTexts,
	} as any);
	return { currentTexts, readCurrentTexts, readIndexedTexts };
}

function registerMockBodyTokenColdStore(): {
	storedDocuments: Map<string, any>;
	upsertDocuments: jest.Mock;
	deleteDocuments: jest.Mock;
	getMeta: jest.Mock;
	inspectConsistency: jest.Mock;
	readDocuments: jest.Mock;
	updateIndexedRefsMetadata: jest.Mock;
	clearAll: jest.Mock;
} {
	const {
		COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
	} = require(
		"src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types",
	) as {
		COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN: string;
	};
	const storedDocuments = new Map<string, any>();
	const upsertDocuments = jest.fn(async (documents: any[]) => {
		for (const document of documents) {
			storedDocuments.set(document.path, {
				path: document.path,
				generation: document.generation,
				bodyTokens: [...document.bodyTokens],
			});
		}
	});
	const deleteDocuments = jest.fn(async (paths: string[]) => {
		for (const path of paths) {
			storedDocuments.delete(path);
		}
	});
	const readDocuments = jest.fn(async (paths: string[]) => {
		const next = new Map<string, any>();
		for (const path of paths) {
			const document = storedDocuments.get(path);
			if (document) {
				next.set(path, {
					path: document.path,
					generation: document.generation,
					bodyTokens: [...document.bodyTokens],
				});
			}
		}
		return next;
	});
	const clearAll = jest.fn(async () => {
		storedDocuments.clear();
	});
	const getMeta = jest.fn(async () => null);
	const inspectConsistency = jest.fn(async () => ({
		needsRepair: false,
		requiresReset: false,
		reason: "up-to-date",
		missingOrStalePaths: [],
		danglingPaths: [],
	}));
	const updateIndexedRefsMetadata = jest.fn(async () => {});

	container.registerInstance(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, {
		upsertDocuments,
		deleteDocuments,
		getMeta,
		inspectConsistency,
		readDocuments,
		updateIndexedRefsMetadata,
		clearAll,
	} as any);

	return {
		storedDocuments,
		upsertDocuments,
		deleteDocuments,
		getMeta,
		inspectConsistency,
		readDocuments,
		updateIndexedRefsMetadata,
		clearAll,
	};
}

async function withCoverageBodyTokenOffloadEnv<T>(
	enabled: boolean,
	action: () => Promise<T>,
): Promise<T> {
	const previous = process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
	process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = enabled
		? "1"
		: "0";
	try {
		return await action();
	} finally {
		if (previous === undefined) {
			delete process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
		} else {
			process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = previous;
		}
	}
}

function createBodyContent(tokenCount: number, prefix: string): string {
	if (tokenCount < 3) {
		throw new Error("tokenCount must be at least 3");
	}
	const tokens = ["alpha", `${prefix}_bridge`, "beta"];
	for (let index = 3; index < tokenCount; index += 1) {
		tokens.push(`${prefix}_body_${index}`);
	}
	return tokens.join(" ");
}

function createNonMatchingBodyContent(tokenCount: number, prefix: string): string {
	const tokens: string[] = [];
	for (let index = 0; index < tokenCount; index += 1) {
		tokens.push(`${prefix}_noise_${index}`);
	}
	return tokens.join(" ");
}

function createIndexedDocument(
	path: string,
	content: string,
	headings = "Stress note",
): IndexedDocument {
	return {
		path,
		basename: path.slice(path.lastIndexOf("/") + 1, path.length - 3),
		folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
		content,
		headings,
	};
}

function buildStressDocuments(
	scenarioIndex: number,
	repeatIndex: number,
	input: StressScenarioInput,
): IndexedDocument[] {
	const documents: IndexedDocument[] = [];
	const scenarioPrefix = `stress-s${scenarioIndex + 1}-r${repeatIndex + 1}`;
	const matchingDocTokenCounts =
		input.matchingDocTokenCounts ??
		Array.from({ length: input.bucketDocCount }, () => input.bodyTokensPerDoc);

	const addMatchingDocuments = (
		tokenCounts: readonly number[],
		bucket: "cold" | "hot",
	): void => {
		tokenCounts.forEach((tokenCount, index) => {
			const ordinal = index + 1;
			const path = `stress/${scenarioPrefix}/${bucket}/doc-${String(ordinal).padStart(2, "0")}.md`;
			documents.push(
				createIndexedDocument(
					path,
					createBodyContent(tokenCount, `${scenarioPrefix}-${bucket}-${ordinal}`),
				),
			);
		});
	};

	const addFillerDocuments = (): void => {
		for (let index = 0; index < EVICTION_FILLER_DOC_COUNT; index += 1) {
			const ordinal = index + 1;
			const path = `stress/${scenarioPrefix}/filler/doc-${String(ordinal).padStart(2, "0")}.md`;
			documents.push(
				createIndexedDocument(
					path,
					createNonMatchingBodyContent(
						EVICTION_FILLER_BODY_TOKENS,
						`${scenarioPrefix}-filler-${ordinal}`,
					),
				),
			);
		}
	};

	if (input.coldMatchingDocCount === 0) {
		addFillerDocuments();
		addMatchingDocuments(matchingDocTokenCounts, "hot");
		return documents;
	}

	addMatchingDocuments(
		matchingDocTokenCounts.slice(0, input.coldMatchingDocCount),
		"cold",
	);
	addFillerDocuments();
	addMatchingDocuments(
		matchingDocTokenCounts.slice(input.coldMatchingDocCount),
		"hot",
	);
	return documents;
}

function buildDistributedMatchingDocTokenCounts(
	targetVerificationBodyTokenSum: number,
	bucketDocCount: number,
): number[] {
	const baseTokenCountPerDoc = Math.floor(
		targetVerificationBodyTokenSum / bucketDocCount,
	);
	if (baseTokenCountPerDoc < 3) {
		throw new Error(
			`targetVerificationBodyTokenSum=${targetVerificationBodyTokenSum} is too small for bucketDocCount=${bucketDocCount}`,
		);
	}
	const remainder = targetVerificationBodyTokenSum % bucketDocCount;
	return Array.from({ length: bucketDocCount }, (_, index) =>
		baseTokenCountPerDoc + (index < remainder ? 1 : 0),
	);
}

function buildFullStressScenarioInputs(): StressScenarioInput[] {
	const scenarios: StressScenarioInput[] = [];
	for (const bucketDocCount of FULL_BUCKET_DOC_COUNTS) {
		for (const bodyTokensPerDoc of FULL_BODY_TOKENS_PER_DOC_VALUES) {
			const coldCounts = Array.from(
				new Set([0, Math.floor(bucketDocCount / 2), bucketDocCount]),
			).sort((left, right) => left - right);
			for (const coldMatchingDocCount of coldCounts) {
				scenarios.push({
					mode: "full",
					profile: "mixed",
					bucketDocCount,
					bodyTokensPerDoc,
					coldMatchingDocCount,
					targetVerificationBodyTokenSum:
						bodyTokensPerDoc * bucketDocCount,
				});
			}
		}
	}
	return scenarios;
}

function buildFocusedStressScenarioInputs(): StressScenarioInput[] {
	const scenarios: StressScenarioInput[] = [];
	for (const bucketDocCount of FOCUSED_BUCKET_DOC_COUNTS) {
		for (const targetVerificationBodyTokenSum of FOCUSED_TARGET_TOKEN_SUMS) {
			const matchingDocTokenCounts = buildDistributedMatchingDocTokenCounts(
				targetVerificationBodyTokenSum,
				bucketDocCount,
			);
			const bodyTokensPerDoc = Math.round(
				targetVerificationBodyTokenSum / bucketDocCount,
			);
			for (const profile of FOCUSED_PROFILES) {
				scenarios.push({
					mode: "focused",
					profile,
					bucketDocCount,
					bodyTokensPerDoc,
					coldMatchingDocCount:
						profile === "all_cold" ? bucketDocCount : 0,
					targetVerificationBodyTokenSum,
					matchingDocTokenCounts,
				});
			}
		}
	}
	return scenarios;
}

function resolveStressSweepMode(): StressSweepMode {
	const raw = process.env.COVERAGE_LEXICAL_STRESS_MODE?.trim().toLowerCase();
	if (raw === "full" || raw === "focused" || raw === "staircase") {
		return raw;
	}
	return "focused";
}

function buildStressScenarioInputs(mode: StressSweepMode): StressScenarioInput[] {
	if (mode === "full") {
		return buildFullStressScenarioInputs();
	}
	if (mode === "focused") {
		return buildFocusedStressScenarioInputs();
	}
	return [];
}

function getStressRepeatCount(mode: StressSweepMode): number {
	if (mode === "full") {
		return FULL_REPEAT_COUNT;
	}
	if (mode === "focused") {
		return FOCUSED_REPEAT_COUNT;
	}
	return STAIRCASE_CONFIRM_REPEATS;
}

function buildProfileStressScenarioInput(
	mode: StressSweepMode,
	profile: StressScenarioProfile,
	bucketDocCount: number,
	targetVerificationBodyTokenSum: number,
): StressScenarioInput {
	const safeTargetVerificationBodyTokenSum = Math.max(
		targetVerificationBodyTokenSum,
		bucketDocCount * 3,
	);
	const matchingDocTokenCounts = buildDistributedMatchingDocTokenCounts(
		safeTargetVerificationBodyTokenSum,
		bucketDocCount,
	);
	return {
		mode,
		profile,
		bucketDocCount,
		bodyTokensPerDoc: Math.round(
			safeTargetVerificationBodyTokenSum / bucketDocCount,
		),
		coldMatchingDocCount:
			profile === "all_cold"
				? bucketDocCount
				: profile === "hot_only"
					? 0
					: Math.floor(bucketDocCount / 2),
		targetVerificationBodyTokenSum: safeTargetVerificationBodyTokenSum,
		matchingDocTokenCounts,
	};
}

function summarizeNumberSeries(values: readonly number[]): {
	avg: number;
	p50: number;
	p90: number;
	p100: number;
} {
	if (values.length === 0) {
		return {
			avg: 0,
			p50: 0,
			p90: 0,
			p100: 0,
		};
	}
	const sorted = [...values].sort((left, right) => left - right);
	const getPercentileValue = (percentile: number): number =>
		sorted[
			Math.min(
				sorted.length - 1,
				Math.max(0, Math.ceil(sorted.length * percentile) - 1),
			)
		] ?? 0;
	return {
		avg: values.reduce((sum, value) => sum + value, 0) / values.length,
		p50: getPercentileValue(0.5),
		p90: getPercentileValue(0.9),
		p100: sorted[sorted.length - 1] ?? 0,
	};
}

function formatFixed(value: number): string {
	return value.toFixed(2);
}

function logStaircaseProgress(
	docCount: number,
	stage: string,
	tokenSum: number | null,
	result?: StressScenarioResult | null,
	extra?: string,
): void {
	const parts = [
		"[staircase-progress]",
		`doc=${docCount}`,
		`stage=${stage}`,
	];
	if (tokenSum !== null) {
		parts.push(`tokenSum=${tokenSum}`);
	}
	if (result) {
		parts.push(`p50=${formatFixed(result.p50Ms)}`);
		parts.push(`p90=${formatFixed(result.p90Ms)}`);
		parts.push(`p100=${formatFixed(result.p100Ms)}`);
		parts.push(
			`accept=${isStressTailAcceptable(result, STAIRCASE_TAIL_TARGET_MS) ? "yes" : "no"}`,
		);
	}
	if (extra) {
		parts.push(extra);
	}
	console.log(parts.join("\t"));
}

function summarizeSkippedReasons(
	measurements: readonly StressScenarioMeasurement[],
): string {
	const counts = new Map<string, number>();
	for (const measurement of measurements) {
		const next = counts.get(measurement.verificationSkippedReason) ?? 0;
		counts.set(measurement.verificationSkippedReason, next + 1);
	}
	return [...counts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([reason, count]) => `${reason}:${count}`)
		.join(",");
}

function countMockArrayArgs(mockFn: jest.Mock): number {
	return mockFn.mock.calls.reduce((sum, call) => {
		const first = call[0];
		return sum + (Array.isArray(first) ? first.length : 0);
	}, 0);
}

function summarizeScenarioResult(
	label: string,
	input: StressScenarioInput,
	measurements: readonly StressScenarioMeasurement[],
): StressScenarioResult {
	const searchSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.searchMs),
	);
	const verificationBucketDocCountSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.verificationBucketDocCount),
	);
	const verificationBodyDocCountSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.verificationBodyDocCount),
	);
	const verificationEstimatedBodyTokenSumSeries = summarizeNumberSeries(
		measurements.map(
			(measurement) => measurement.verificationEstimatedBodyTokenSum,
		),
	);
	const coldAvailabilitySeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.coldAvailabilityCount),
	);
	const hotAvailabilitySeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.hotAvailabilityCount),
	);
	const residentAvailabilitySeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.residentAvailabilityCount),
	);
	const missingAvailabilitySeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.missingAvailabilityCount),
	);
	const coldStoreReadDocCountSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.coldStoreReadDocCount),
	);
	const coldStoreReadCallCountSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.coldStoreReadCallCount),
	);
	const snapshotReadDocCountSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.snapshotReadDocCount),
	);
	const snapshotReadCallCountSeries = summarizeNumberSeries(
		measurements.map((measurement) => measurement.snapshotReadCallCount),
	);
	return {
		...input,
		label,
		measurementCount: measurements.length,
		avgMs: searchSeries.avg,
		p50Ms: searchSeries.p50,
		p90Ms: searchSeries.p90,
		p100Ms: searchSeries.p100,
		avgVerificationBucketDocCount: verificationBucketDocCountSeries.avg,
		avgVerificationBodyDocCount: verificationBodyDocCountSeries.avg,
		avgVerificationEstimatedBodyTokenSum:
			verificationEstimatedBodyTokenSumSeries.avg,
		avgColdAvailabilityCount: coldAvailabilitySeries.avg,
		avgHotAvailabilityCount: hotAvailabilitySeries.avg,
		avgResidentAvailabilityCount: residentAvailabilitySeries.avg,
		avgMissingAvailabilityCount: missingAvailabilitySeries.avg,
		avgColdStoreReadDocCount: coldStoreReadDocCountSeries.avg,
		avgColdStoreReadCallCount: coldStoreReadCallCountSeries.avg,
		avgSnapshotReadDocCount: snapshotReadDocCountSeries.avg,
		avgSnapshotReadCallCount: snapshotReadCallCountSeries.avg,
		overflowRepeatCount: measurements.filter(
			(measurement) => measurement.verificationSkippedReason === "overflow",
		).length,
		skippedReasonSummary: summarizeSkippedReasons(measurements),
	};
}

function buildStressScenarioLabel(input: StressScenarioInput): string {
	if (input.mode === "focused" || input.mode === "staircase") {
		return (
			`profile=${input.profile}` +
			` docs=${input.bucketDocCount}` +
			` tokenSum=${input.targetVerificationBodyTokenSum}`
		);
	}
	return (
		`docs=${input.bucketDocCount}` +
		` cold=${input.coldMatchingDocCount}` +
		` tokens=${input.bodyTokensPerDoc}`
	);
}

async function measureStressScenario(
	EngineCtor: new () => EngineLike,
	tokenizer: MockTokenizer,
	scenarioIndex: number,
	input: StressScenarioInput,
	repeatCount: number,
): Promise<StressScenarioResult> {
	const measurements: StressScenarioMeasurement[] = [];
	const label = buildStressScenarioLabel(input);

	for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
		resetStressBenchmarkContainerState();
		const documents = buildStressDocuments(
			scenarioIndex,
			repeatIndex,
			input,
		);
		const fileSnapshotStore = registerMockFileSnapshotStore(documents);
		const coldStore = registerMockBodyTokenColdStore();
		const engine = createEngineHarness(EngineCtor, tokenizer);

		await engine.addDocuments(documents);

		coldStore.readDocuments.mockClear();
		fileSnapshotStore.readCurrentTexts.mockClear();
		fileSnapshotStore.readIndexedTexts.mockClear();

		const startedAt = performance.now();
		const results = await engine.searchFiles({
			queryText: QUERY_TEXT,
			isPrefixMatch: false,
			isFuzzy: false,
			maxItemResults: MAX_ITEM_RESULTS,
		});
		const searchMs = performance.now() - startedAt;
		const debug = engine.getLastBenchmarkV2CandidateCascadeDebug?.() ?? null;
		expect(debug).not.toBeNull();
		if (!debug) {
			throw new Error(`Missing candidate cascade debug for ${label}`);
		}
		const verificationBucketDocCount =
			debug.verificationBucketDocCount ??
			debug.verificationBucketCandidateIds?.length ??
			0;
		const verificationBodyDocCount =
			debug.verificationBodyDocCount ?? verificationBucketDocCount;
		const verificationEstimatedBodyTokenSum =
			debug.verificationEstimatedBodyTokenSum ??
			input.targetVerificationBodyTokenSum;
		const verificationBodyAvailability =
			debug.verificationBodyAvailability ??
			({
				resident: input.profile === "hot_only" ? input.bucketDocCount : 0,
				hotCache: 0,
				coldOrSnapshot:
					input.profile === "all_cold" ? input.bucketDocCount : input.coldMatchingDocCount,
				missing: 0,
			} as const);

		expect(verificationBucketDocCount).toBe(input.bucketDocCount);
		expect(verificationBodyDocCount).toBe(input.bucketDocCount);
		expect(results.length).toBeGreaterThan(0);

		measurements.push({
			searchMs,
			resultCount: results.length,
			verificationBucketDocCount,
			verificationBodyDocCount,
			verificationEstimatedBodyTokenSum,
			verificationSkippedReason: debug.verificationSkippedReason,
			coldAvailabilityCount: verificationBodyAvailability.coldOrSnapshot,
			hotAvailabilityCount: verificationBodyAvailability.hotCache,
			residentAvailabilityCount: verificationBodyAvailability.resident,
			missingAvailabilityCount: verificationBodyAvailability.missing,
			coldStoreReadDocCount: countMockArrayArgs(coldStore.readDocuments),
			coldStoreReadCallCount: coldStore.readDocuments.mock.calls.length,
			snapshotReadDocCount:
				countMockArrayArgs(fileSnapshotStore.readCurrentTexts) +
				countMockArrayArgs(fileSnapshotStore.readIndexedTexts),
			snapshotReadCallCount:
				fileSnapshotStore.readCurrentTexts.mock.calls.length +
				fileSnapshotStore.readIndexedTexts.mock.calls.length,
		});
		resetStressBenchmarkContainerState();
	}

	return summarizeScenarioResult(label, input, measurements);
}

function printAggregateByDimension(
	label: string,
	results: readonly StressScenarioResult[],
	keySelector: (result: StressScenarioResult) => number,
): void {
	const grouped = new Map<number, StressScenarioResult[]>();
	for (const result of results) {
		const key = keySelector(result);
		const group = grouped.get(key) ?? [];
		group.push(result);
		grouped.set(key, group);
	}
	console.log(
		`[stress] ${label}\tkey\tavgMs\tmaxP100\tavgTokenSum\tavgColdReads\toverflowScenarios`,
	);
	for (const [key, group] of [...grouped.entries()].sort(
		([left], [right]) => left - right,
	)) {
		const avgMs =
			group.reduce((sum, result) => sum + result.avgMs, 0) / group.length;
		const maxP100 = Math.max(...group.map((result) => result.p100Ms));
		const avgTokenSum =
			group.reduce(
				(sum, result) => sum + result.avgVerificationEstimatedBodyTokenSum,
				0,
			) / group.length;
		const avgColdReads =
			group.reduce((sum, result) => sum + result.avgColdStoreReadDocCount, 0) /
			group.length;
		const overflowScenarios = group.filter(
			(result) => result.overflowRepeatCount > 0,
		).length;
		console.log(
			[
				`[stress] ${label}`,
				String(key),
				formatFixed(avgMs),
				formatFixed(maxP100),
				formatFixed(avgTokenSum),
				formatFixed(avgColdReads),
				String(overflowScenarios),
			].join("\t"),
		);
	}
}

function printStressSummary(results: readonly StressScenarioResult[]): void {
	const baselineAvgMs = Math.max(results[0]?.avgMs ?? 0, 0.001);
	const sweepMode = results[0]?.mode ?? "focused";
	const repeatCount = getStressRepeatCount(sweepMode);
	console.log("[stress] Coverage lexical V2 candidate cascade proximity sweep");
	console.log(
		`[stress] mode=${sweepMode} query=${QUERY_TEXT} maxItemResults=${MAX_ITEM_RESULTS} repeats=${repeatCount} fillerDocs=${EVICTION_FILLER_DOC_COUNT}`,
	);
	console.log(
		"[stress] scenario\tprofile\tdocs\tcold\ttokens/doc\ttargetTokenSum\tobservedTokenSum\tavgMs\tp50Ms\tp90Ms\tp100Ms\tavgMsRatio\tcoldAvail\tcoldReads\tsnapshotReads\tskipped",
	);
	for (const result of results) {
		console.log(
			[
				`[stress] ${result.label}`,
				result.profile,
				String(result.bucketDocCount),
				String(result.coldMatchingDocCount),
				String(result.bodyTokensPerDoc),
				String(result.targetVerificationBodyTokenSum),
				formatFixed(result.avgVerificationEstimatedBodyTokenSum),
				formatFixed(result.avgMs),
				formatFixed(result.p50Ms),
				formatFixed(result.p90Ms),
				formatFixed(result.p100Ms),
				formatFixed(result.avgMs / baselineAvgMs),
				formatFixed(result.avgColdAvailabilityCount),
				formatFixed(result.avgColdStoreReadDocCount),
				formatFixed(result.avgSnapshotReadDocCount),
				result.skippedReasonSummary,
			].join("\t"),
		);
	}
	printAggregateByDimension("by-doc-count", results, (result) => result.bucketDocCount);
	printAggregateByDimension(
		"by-token-sum",
		results,
		(result) => result.targetVerificationBodyTokenSum,
	);
	printAggregateByDimension(
		"by-cold-doc-count",
		results,
		(result) => result.coldMatchingDocCount,
	);

	console.log(
		"[stress] slowest-scenarios\tlabel\tavgMs\tp90Ms\tp100Ms\ttokenSum\tcoldReads\tskipped",
	);
	for (const result of [...results]
		.sort((left, right) => right.avgMs - left.avgMs)
		.slice(0, 12)) {
		console.log(
			[
				"[stress] slowest",
				result.label,
				formatFixed(result.avgMs),
				formatFixed(result.p90Ms),
				formatFixed(result.p100Ms),
				formatFixed(result.avgVerificationEstimatedBodyTokenSum),
				formatFixed(result.avgColdStoreReadDocCount),
				result.skippedReasonSummary,
			].join("\t"),
		);
	}
}

function isStressTailAcceptable(
	result: StressScenarioResult,
	tailTargetMs: number,
): boolean {
	return result.p90Ms <= tailTargetMs;
}

function buildStaircaseCandidateTokenSums(
	docCount: number,
): readonly number[] {
	const minimumTokenSum = Math.max(1024, docCount * 3);
	const maximumTokenSum = Math.min(
		STAIRCASE_MAX_TOKEN_SUM,
		docCount * STAIRCASE_MAX_TOKENS_PER_DOC,
	);
	return STAIRCASE_TOKEN_SUM_LADDER.filter(
		(tokenSum) =>
			tokenSum >= minimumTokenSum && tokenSum <= maximumTokenSum,
	);
}

function buildFineTokenCandidates(
	docCount: number,
	lowerTokenSum: number,
	upperTokenSum: number,
): number[] {
	const minimumTokenSum = Math.max(1024, docCount * 3);
	const clampedLowerTokenSum = Math.max(minimumTokenSum, lowerTokenSum);
	const clampedUpperTokenSum = Math.min(
		Math.min(
			STAIRCASE_MAX_TOKEN_SUM,
			docCount * STAIRCASE_MAX_TOKENS_PER_DOC,
		),
		Math.max(clampedLowerTokenSum, upperTokenSum),
	);
	const fineStep =
		clampedUpperTokenSum <= 16384
			? 1024
			: clampedUpperTokenSum <= 65536
				? 4096
				: 8192;
	const candidates = new Set<number>([
		clampedLowerTokenSum,
		clampedUpperTokenSum,
	]);
	for (
		let tokenSum = clampedLowerTokenSum;
		tokenSum <= clampedUpperTokenSum;
		tokenSum += fineStep
	) {
		candidates.add(tokenSum);
	}
	return [...candidates].sort((left, right) => left - right);
}

function getTokenSearchStep(tokenSum: number): number {
	if (tokenSum <= 16384) {
		return 1024;
	}
	if (tokenSum <= 65536) {
		return 4096;
	}
	return 8192;
}

function getNextHigherTokenCandidate(
	currentTokenSum: number,
	docCount: number,
): number | null {
	const minimumTokenSum = Math.max(1024, docCount * 3);
	const nextCandidate =
		Math.max(minimumTokenSum, currentTokenSum) + getTokenSearchStep(currentTokenSum);
	return nextCandidate <= Math.min(
		STAIRCASE_MAX_TOKEN_SUM,
		docCount * STAIRCASE_MAX_TOKENS_PER_DOC,
	)
		? nextCandidate
		: null;
}

async function searchStaircaseBudgetForDocCount(
	EngineCtor: new () => EngineLike,
	tokenizer: MockTokenizer,
	docCount: number,
	scenarioSequenceRef: { value: number },
): Promise<StaircaseDocBudgetResult> {
	if (docCount > STAIRCASE_PROXIMITY_DOC_CAP) {
		logStaircaseProgress(
			docCount,
			"skip_overflow_cap",
			null,
			null,
			`docCap=${STAIRCASE_PROXIMITY_DOC_CAP}`,
		);
		return {
			docCount,
			proximityEligible: false,
			hotProbeBestTokenSum: 0,
			rawRecommendedTokenSum: 0,
			monotoneRecommendedTokenSum: 0,
			confirmedHotResult: null,
			confirmedColdResult: null,
			confirmedWorstP50Ms: 0,
			confirmedWorstP90Ms: 0,
			confirmedWorstP100Ms: 0,
			nextHigherTokenSum: null,
			nextHigherHotResult: null,
			nextHigherColdResult: null,
		};
	}

	const coarseCandidates = buildStaircaseCandidateTokenSums(docCount);
	logStaircaseProgress(
		docCount,
		"start",
		null,
		null,
		`coarseCandidates=${coarseCandidates.join(",")}`,
	);
	let bestHotProbeTokenSum = coarseCandidates[0] ?? Math.max(1024, docCount * 3);
	let firstFailedHotProbeTokenSum: number | null = null;

	for (const tokenSum of coarseCandidates) {
		const hotProbeInput = buildProfileStressScenarioInput(
			"staircase",
			"hot_only",
			docCount,
			tokenSum,
		);
		const hotProbeResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			hotProbeInput,
			STAIRCASE_COARSE_PROBE_REPEATS,
		);
		logStaircaseProgress(docCount, "coarse_hot_probe", tokenSum, hotProbeResult);
		if (isStressTailAcceptable(hotProbeResult, STAIRCASE_TAIL_TARGET_MS)) {
			bestHotProbeTokenSum = tokenSum;
			continue;
		}
		firstFailedHotProbeTokenSum = tokenSum;
		break;
	}

	const lowerFineBound =
		firstFailedHotProbeTokenSum === null
			? bestHotProbeTokenSum
			: Math.max(
					Math.max(1024, docCount * 3),
					bestHotProbeTokenSum,
				);
	const upperFineBound =
		firstFailedHotProbeTokenSum === null
			? Math.min(STAIRCASE_MAX_TOKEN_SUM, bestHotProbeTokenSum + 32768)
			: firstFailedHotProbeTokenSum;
	const fineCandidates = buildFineTokenCandidates(
		docCount,
		lowerFineBound,
		upperFineBound,
	);
	logStaircaseProgress(
		docCount,
		"fine_bounds",
		null,
		null,
		`lower=${lowerFineBound}\tupper=${upperFineBound}\tfineCandidates=${fineCandidates.join(",")}`,
	);

	let bestHotFineTokenSum = bestHotProbeTokenSum;
	for (const tokenSum of fineCandidates) {
		const hotFineInput = buildProfileStressScenarioInput(
			"staircase",
			"hot_only",
			docCount,
			tokenSum,
		);
		const hotFineResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			hotFineInput,
			STAIRCASE_FINE_PROBE_REPEATS,
		);
		logStaircaseProgress(docCount, "fine_hot_probe", tokenSum, hotFineResult);
		if (isStressTailAcceptable(hotFineResult, STAIRCASE_TAIL_TARGET_MS)) {
			bestHotFineTokenSum = tokenSum;
		}
	}

	const orderedFineCandidates = [...fineCandidates].sort(
		(left, right) => left - right,
	);
	let candidateIndex = Math.max(
		0,
		orderedFineCandidates.indexOf(bestHotFineTokenSum),
	);
	let confirmedHotResult: StressScenarioResult | null = null;
	let confirmedColdResult: StressScenarioResult | null = null;
	let confirmedTokenSum = orderedFineCandidates[candidateIndex] ?? bestHotFineTokenSum;

	while (candidateIndex >= 0) {
		const candidateTokenSum =
			orderedFineCandidates[candidateIndex] ?? confirmedTokenSum;
		const hotConfirmInput = buildProfileStressScenarioInput(
			"staircase",
			"hot_only",
			docCount,
			candidateTokenSum,
		);
		const coldConfirmInput = buildProfileStressScenarioInput(
			"staircase",
			"all_cold",
			docCount,
			candidateTokenSum,
		);
		const nextHotResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			hotConfirmInput,
			STAIRCASE_CONFIRM_REPEATS,
		);
		const nextColdResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			coldConfirmInput,
			STAIRCASE_CONFIRM_REPEATS,
		);
		logStaircaseProgress(docCount, "confirm_hot", candidateTokenSum, nextHotResult);
		logStaircaseProgress(
			docCount,
			"confirm_cold",
			candidateTokenSum,
			nextColdResult,
		);
		if (
			isStressTailAcceptable(nextHotResult, STAIRCASE_TAIL_TARGET_MS) &&
			isStressTailAcceptable(nextColdResult, STAIRCASE_TAIL_TARGET_MS)
		) {
			confirmedTokenSum = candidateTokenSum;
			confirmedHotResult = nextHotResult;
			confirmedColdResult = nextColdResult;
			break;
		}
		candidateIndex -= 1;
	}

	if (!confirmedHotResult || !confirmedColdResult) {
		const minimumTokenSum = Math.max(1024, docCount * 3);
		const hotFallbackInput = buildProfileStressScenarioInput(
			"staircase",
			"hot_only",
			docCount,
			minimumTokenSum,
		);
		const coldFallbackInput = buildProfileStressScenarioInput(
			"staircase",
			"all_cold",
			docCount,
			minimumTokenSum,
		);
		confirmedTokenSum = minimumTokenSum;
		confirmedHotResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			hotFallbackInput,
			STAIRCASE_CONFIRM_REPEATS,
		);
		confirmedColdResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			coldFallbackInput,
			STAIRCASE_CONFIRM_REPEATS,
		);
		logStaircaseProgress(
			docCount,
			"fallback_hot",
			minimumTokenSum,
			confirmedHotResult,
		);
		logStaircaseProgress(
			docCount,
			"fallback_cold",
			minimumTokenSum,
			confirmedColdResult,
		);
	}

	let nextHigherTokenSum = getNextHigherTokenCandidate(confirmedTokenSum, docCount);
	let nextHigherHotResult: StressScenarioResult | null = null;
	let nextHigherColdResult: StressScenarioResult | null = null;
	while (nextHigherTokenSum !== null) {
		const nextHotInput = buildProfileStressScenarioInput(
			"staircase",
			"hot_only",
			docCount,
			nextHigherTokenSum,
		);
		const nextColdInput = buildProfileStressScenarioInput(
			"staircase",
			"all_cold",
			docCount,
			nextHigherTokenSum,
		);
		nextHigherHotResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			nextHotInput,
			STAIRCASE_CONFIRM_REPEATS,
		);
		nextHigherColdResult = await measureStressScenario(
			EngineCtor,
			tokenizer,
			scenarioSequenceRef.value++,
			nextColdInput,
			STAIRCASE_CONFIRM_REPEATS,
		);
		logStaircaseProgress(
			docCount,
			"next_higher_hot",
			nextHigherTokenSum,
			nextHigherHotResult,
		);
		logStaircaseProgress(
			docCount,
			"next_higher_cold",
			nextHigherTokenSum,
			nextHigherColdResult,
		);
		if (
			isStressTailAcceptable(nextHigherHotResult, STAIRCASE_TAIL_TARGET_MS) &&
			isStressTailAcceptable(nextHigherColdResult, STAIRCASE_TAIL_TARGET_MS)
		) {
			confirmedTokenSum = nextHigherTokenSum;
			confirmedHotResult = nextHigherHotResult;
			confirmedColdResult = nextHigherColdResult;
			nextHigherTokenSum = getNextHigherTokenCandidate(confirmedTokenSum, docCount);
			continue;
		}
		break;
	}

	logStaircaseProgress(
		docCount,
		"selected",
		confirmedTokenSum,
		null,
		[
			`worstP50=${formatFixed(Math.max(confirmedHotResult.p50Ms, confirmedColdResult.p50Ms))}`,
			`worstP90=${formatFixed(Math.max(confirmedHotResult.p90Ms, confirmedColdResult.p90Ms))}`,
			`worstP100=${formatFixed(Math.max(confirmedHotResult.p100Ms, confirmedColdResult.p100Ms))}`,
			nextHigherTokenSum === null
				? "nextHigher=none"
				: `nextHigher=${nextHigherTokenSum}`,
		].join("\t"),
	);

	return {
		docCount,
		proximityEligible: true,
		hotProbeBestTokenSum: bestHotProbeTokenSum,
		rawRecommendedTokenSum: confirmedTokenSum,
		monotoneRecommendedTokenSum: confirmedTokenSum,
		confirmedHotResult,
		confirmedColdResult,
		confirmedWorstP50Ms: Math.max(
			confirmedHotResult.p50Ms,
			confirmedColdResult.p50Ms,
		),
		confirmedWorstP90Ms: Math.max(
			confirmedHotResult.p90Ms,
			confirmedColdResult.p90Ms,
		),
		confirmedWorstP100Ms: Math.max(
			confirmedHotResult.p100Ms,
			confirmedColdResult.p100Ms,
		),
		nextHigherTokenSum,
		nextHigherHotResult,
		nextHigherColdResult,
	};
}

function applyMonotoneStaircaseBudgets(
	results: readonly StaircaseDocBudgetResult[],
): StaircaseDocBudgetResult[] {
	let runningBudget = Number.POSITIVE_INFINITY;
	return results.map((result) => {
		const monotoneRecommendedTokenSum = result.proximityEligible
			? Math.min(runningBudget, result.rawRecommendedTokenSum)
			: 0;
		runningBudget = monotoneRecommendedTokenSum;
		return {
			...result,
			monotoneRecommendedTokenSum,
		};
	});
}

function compressStaircaseRanges(
	results: readonly StaircaseDocBudgetResult[],
): Array<{
	fromDocCount: number;
	toDocCount: number;
		tokenSumCap: number;
	}> {
	const ranges: Array<{
		fromDocCount: number;
		toDocCount: number;
		tokenSumCap: number;
	}> = [];
	for (const result of results) {
		const previous = ranges[ranges.length - 1];
		if (
			previous &&
			previous.tokenSumCap === result.rawRecommendedTokenSum &&
			previous.toDocCount + 1 === result.docCount
		) {
			previous.toDocCount = result.docCount;
			continue;
		}
		ranges.push({
			fromDocCount: result.docCount,
			toDocCount: result.docCount,
			tokenSumCap: result.rawRecommendedTokenSum,
		});
	}
	return ranges;
}

function printStaircaseSummary(
	results: readonly StaircaseDocBudgetResult[],
): void {
	console.log(
		`[staircase] targetTailMs=${STAIRCASE_TAIL_TARGET_MS} confirmRepeats=${STAIRCASE_CONFIRM_REPEATS} proximityDocCap=${STAIRCASE_PROXIMITY_DOC_CAP}`,
	);
	console.log(
		"[staircase] doc\tselectedTokenCap\thotProbeBest\tworstP50\tworstP90\tworstP100\tnextHigher\teligibility",
	);
	for (const result of results) {
		console.log(
			[
				"[staircase]",
				String(result.docCount),
				String(result.rawRecommendedTokenSum),
				String(result.hotProbeBestTokenSum),
				formatFixed(result.confirmedWorstP50Ms),
				formatFixed(result.confirmedWorstP90Ms),
				formatFixed(result.confirmedWorstP100Ms),
				result.nextHigherTokenSum === null
					? "none"
					: String(result.nextHigherTokenSum),
				result.proximityEligible ? "eligible" : "overflow_skip",
			].join("\t"),
		);
	}
	console.log("[staircase] compressed\tfrom\tto\ttokenSumCap");
	for (const range of compressStaircaseRanges(results)) {
		console.log(
			[
				"[staircase] compressed",
				String(range.fromDocCount),
				String(range.toDocCount),
				String(range.tokenSumCap),
			].join("\t"),
		);
	}
}

describe("Coverage lexical candidate cascade stress benchmark", () => {
	beforeEach(() => {
		resetStressBenchmarkContainerState();
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
		resetStressBenchmarkContainerState();
	});

	test("sweeps proximity latency against token sum, bucket size, and cold reads", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => EngineLike;
		};
		const tokenizer = createMockTokenizer();
		const sweepMode = resolveStressSweepMode();
		const scenarioSequenceRef = { value: 1 };

		await withCoverageBodyTokenOffloadEnv(true, async () => {
			if (sweepMode === "staircase") {
				const staircaseResults: StaircaseDocBudgetResult[] = [];
				for (const docCount of STAIRCASE_DOC_COUNTS) {
					staircaseResults.push(
						await searchStaircaseBudgetForDocCount(
							CoverageLexicalFileSearchEngine,
							tokenizer,
							docCount,
							scenarioSequenceRef,
						),
					);
				}
				printStaircaseSummary(staircaseResults);
				expect(staircaseResults.length).toBe(STAIRCASE_DOC_COUNTS.length);
				return;
			}

			const repeatCount = getStressRepeatCount(sweepMode);
			const scenarioInputs = buildStressScenarioInputs(sweepMode);
			const scenarioResults: StressScenarioResult[] = [];
			for (const [scenarioIndex, scenarioInput] of scenarioInputs.entries()) {
				scenarioResults.push(
					await measureStressScenario(
						CoverageLexicalFileSearchEngine,
						tokenizer,
						scenarioSequenceRef.value + scenarioIndex,
						scenarioInput,
						repeatCount,
					),
				);
				scenarioSequenceRef.value += 1;
			}

			printStressSummary(scenarioResults);
			expect(scenarioResults.length).toBeGreaterThan(0);
		});
	});
});
