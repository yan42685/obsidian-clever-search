import path from "path";

export const OBJECTIVE_WEIGHTS = {
	hits1: 0.55,
	hits3: 0.25,
	hits5: 0.2,
};

export const DEFAULT_THRESHOLDS = {
	hits1Regression: 0.005,
	objectiveMeaningfulLift: 0.002,
	avgLatencyRegressionRatio: 1.05,
	tailLatencyRegressionRatio: 1.08,
	sizeRegressionRatio: 1.05,
};

export const DEFAULT_RESULTS_DIR = path.resolve(
	process.cwd(),
	".codex-bench/lexical-optimizer",
);

export const DEFAULT_LANE = "default";

export const DEFAULT_LANE_NAMES = [
	"mechanism-a",
	"mechanism-b",
	"mechanism-c",
	"benchmark",
	"regression",
];

export const DEFAULT_LANES_DIR = path.join(
	DEFAULT_RESULTS_DIR,
	"lanes",
);

export const DEFAULT_RESULTS_JSONL = path.join(
	DEFAULT_RESULTS_DIR,
	"results.jsonl",
);

export const DEFAULT_LATEST_REPORT = path.join(
	DEFAULT_RESULTS_DIR,
	"latest-report.md",
);

export const DEFAULT_BENCHMARK_ARGS = [
	"node_modules/jest/bin/jest.js",
	"--config",
	"jest.file-search-web-benchmark.config.js",
	"--runInBand",
	"tests/src/services/search/file-search-web-benchmark.bench.ts",
];

export const DEFAULT_PARAMETER_TARGET_FILE = path.resolve(
	process.cwd(),
	"src/services/search/passage-lexical/passage-lexical-ranker.ts",
);

export const DEFAULT_IMPLEMENTATION_TARGET_FILE = path.resolve(
	process.cwd(),
	"src/services/search/passage-lexical/coverage-lexical-engine.ts",
);

export const DEFAULT_CANDIDATE_FILE = path.resolve(
	process.cwd(),
	".codex-bench/lexical-optimizer/candidates.json",
);

export const DEFAULT_TOP_K_REVALIDATE = 3;

export const DEFAULT_PARALLEL_WORKERS = 2;

export const DEFAULT_BASELINE_REF = "HEAD";

export const DEFAULT_WORKTREE_ROOT = path.join(
	DEFAULT_RESULTS_DIR,
	"worktrees",
);

export function sanitizeLaneName(lane) {
	const normalized = String(lane || DEFAULT_LANE)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || DEFAULT_LANE;
}

export function buildLaneDir(lane) {
	return path.join(DEFAULT_LANES_DIR, sanitizeLaneName(lane));
}

export function buildLaneCandidateFile(lane) {
	return path.join(buildLaneDir(lane), "candidates.json");
}

export function buildLaneResultsDir(lane) {
	return path.join(buildLaneDir(lane), "results");
}

export function buildLaneResultsJsonl(lane) {
	return path.join(buildLaneResultsDir(lane), "results.jsonl");
}

export function buildLaneLatestReport(lane) {
	return path.join(buildLaneResultsDir(lane), "latest-report.md");
}

export function buildParallelRunDir(runLabel) {
	return path.join(DEFAULT_RESULTS_DIR, "parallel", runLabel);
}
