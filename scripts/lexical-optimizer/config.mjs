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
	"src/services/search/passage-lexical/passage-lexical-ranker-tuning.ts",
);

export const DEFAULT_CANDIDATE_FILE = path.resolve(
	process.cwd(),
	".codex-bench/lexical-optimizer/candidates.json",
);

export const DEFAULT_BASELINE_REF = "HEAD";

export const DEFAULT_WORKTREE_ROOT = path.join(
	DEFAULT_RESULTS_DIR,
	"worktrees",
);
