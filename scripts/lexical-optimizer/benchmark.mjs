import { spawnSync } from "child_process";
import { OBJECTIVE_WEIGHTS } from "./config.mjs";

export class BenchmarkUnavailableError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = "BenchmarkUnavailableError";
		this.code = options.code ?? "BENCHMARK_UNAVAILABLE";
		this.cause = options.cause;
	}
}

function extractJsonAfterMarker(output, marker) {
	const markerIndex = output.indexOf(marker);
	if (markerIndex < 0) {
		return null;
	}
	const jsonStart = output.indexOf("[", markerIndex + marker.length);
	if (jsonStart < 0) {
		return null;
	}

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = jsonStart; index < output.length; index++) {
		const char = output[index];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "\"") {
				inString = false;
			}
			continue;
		}

		if (char === "\"") {
			inString = true;
			continue;
		}
		if (char === "[") {
			depth += 1;
		} else if (char === "]") {
			depth -= 1;
			if (depth === 0) {
				return output.slice(jsonStart, index + 1);
			}
		}
	}
	return null;
}

function isPermissionError(error) {
	return error?.code === "EPERM" || error?.errno === -4048;
}

function runNodeCommand(cwd, benchmarkArgs) {
	const result = spawnSync(process.execPath, benchmarkArgs, {
		cwd,
		encoding: "utf8",
		maxBuffer: 1024 * 1024 * 64,
	});
	if (result.error) {
		const detail = result.error.message ?? String(result.error);
		throw new BenchmarkUnavailableError(
			`Benchmark subprocess is unavailable. Run the optimizer in a normal local terminal; the current Codex sandbox blocks nested Node subprocesses.\n\n${detail}`,
			{
				code: isPermissionError(result.error)
					? "BENCHMARK_SUBPROCESS_BLOCKED"
					: "BENCHMARK_UNAVAILABLE",
				cause: result.error,
			},
		);
	}
	return result;
}

function round(value, digits = 6) {
	return Number(value.toFixed(digits));
}

export function computeObjective(result) {
	return (
		result.hits1 * OBJECTIVE_WEIGHTS.hits1 +
		result.hits3 * OBJECTIVE_WEIGHTS.hits3 +
		result.hits5 * OBJECTIVE_WEIGHTS.hits5
	);
}

export function normalizeSummary(summary) {
	return {
		name: summary.name,
		hits1: summary.top1,
		hits3: summary.top3 ?? summary.top5,
		hits5: summary.top5,
		mrr: summary.mrr,
		zeroRate: summary.zeroRate,
		avgLatencyMs: summary.avgMsPerQuery,
		p50LatencyMs: summary.p50Ms,
		p100LatencyMs: summary.p100Ms,
		persistedIndexBytes:
			typeof summary.estimatedIndexBytes === "number"
				? summary.estimatedIndexBytes
				: Math.round((summary.estimatedIndexKB ?? 0) * 1024),
		byBucket: summary.byBucket ?? {},
		byType: summary.byType ?? {},
		bySuite: summary.bySuite ?? {},
		objective: round(
			computeObjective({
				hits1: summary.top1,
				hits3: summary.top3 ?? summary.top5,
				hits5: summary.top5,
			}),
		),
	};
}

export function runBenchmark(cwd, benchmarkArgs, backendName = "PassageBM25") {
	const result = runNodeCommand(cwd, benchmarkArgs);
	if (result.status !== 0) {
		throw new Error(
			[
				`Benchmark command failed in ${cwd}`,
				result.stdout?.trim(),
				result.stderr?.trim(),
			]
				.filter(Boolean)
				.join("\n\n"),
		);
	}

	const summaryText = extractJsonAfterMarker(
		result.stdout,
		"[file-search-web-benchmark] summary",
	);
	if (!summaryText) {
		throw new Error("Unable to parse benchmark summary from stdout");
	}

	const summary = JSON.parse(summaryText);
	const backend = summary.find((entry) => entry.name === backendName);
	if (!backend) {
		throw new Error(`Benchmark summary did not include ${backendName}`);
	}

	return {
		cwd,
		rawSummary: summary,
		backend: normalizeSummary(backend),
		stdout: result.stdout,
		stderr: result.stderr,
	};
}
