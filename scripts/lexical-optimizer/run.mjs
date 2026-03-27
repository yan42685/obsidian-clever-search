import fs from "fs";
import path from "path";
import {
	DEFAULT_BENCHMARK_ARGS,
	DEFAULT_CANDIDATE_FILE,
	DEFAULT_PARAMETER_TARGET_FILE,
	DEFAULT_THRESHOLDS,
} from "./config.mjs";
import { BenchmarkUnavailableError, runBenchmark } from "./benchmark.mjs";
import {
	GitUnavailableError,
	readRepoState,
	withHeadWorktree,
} from "./git.mjs";
import { appendJsonl, writeLatestReport } from "./report.mjs";
import {
	extractCurrentTuningProfile,
	patchTuningValues,
	readCandidateManifest,
	readParameterFile,
} from "./search-space.mjs";

function round(value, digits = 6) {
	return Number(value.toFixed(digits));
}

function parseArgs(argv) {
	const args = {
		mode: "parameter",
		label: "",
		dryRun: false,
		applyBest: false,
		maxCandidates: Number.POSITIVE_INFINITY,
		benchmarkArgs: DEFAULT_BENCHMARK_ARGS,
		parameterFile: DEFAULT_PARAMETER_TARGET_FILE,
		candidateFile: DEFAULT_CANDIDATE_FILE,
	};

	for (const arg of argv.slice(2)) {
		if (arg.startsWith("--mode=")) {
			args.mode = arg.slice("--mode=".length);
		} else if (arg.startsWith("--label=")) {
			args.label = arg.slice("--label=".length);
		} else if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--apply-best") {
			args.applyBest = true;
		} else if (arg.startsWith("--max-candidates=")) {
			args.maxCandidates = Number(arg.slice("--max-candidates=".length)) || 0;
		} else if (arg.startsWith("--parameter-file=")) {
			args.parameterFile = path.resolve(arg.slice("--parameter-file=".length));
		} else if (arg.startsWith("--candidate-file=")) {
			args.candidateFile = path.resolve(arg.slice("--candidate-file=".length));
		}
	}

	return args;
}

function summarizeDelta(baseline, candidate) {
	return {
		objective: round(candidate.objective - baseline.objective),
		hits1: round(candidate.hits1 - baseline.hits1),
		hits3: round(candidate.hits3 - baseline.hits3),
		hits5: round(candidate.hits5 - baseline.hits5),
		avgLatencyMs: round(candidate.avgLatencyMs - baseline.avgLatencyMs),
		p100LatencyMs: round(candidate.p100LatencyMs - baseline.p100LatencyMs),
		persistedIndexBytes: candidate.persistedIndexBytes - baseline.persistedIndexBytes,
	};
}

function decideCandidate(baseline, candidate, thresholds = DEFAULT_THRESHOLDS) {
	const delta = summarizeDelta(baseline, candidate);
	const avgRatio = candidate.avgLatencyMs / Math.max(0.000001, baseline.avgLatencyMs);
	const tailRatio =
		candidate.p100LatencyMs / Math.max(0.000001, baseline.p100LatencyMs);
	const sizeRatio =
		candidate.persistedIndexBytes /
		Math.max(1, baseline.persistedIndexBytes);

	if (baseline.hits1 - candidate.hits1 > thresholds.hits1Regression) {
		return {
			decision: "rollback",
			reason: "hits@1 regressed beyond threshold",
			delta,
		};
	}

	if (delta.objective > thresholds.objectiveMeaningfulLift) {
		return {
			decision: "keep",
			reason: "objective improved",
			delta,
		};
	}

	if (delta.objective >= 0) {
		if (avgRatio < 1 && tailRatio <= 1 && sizeRatio <= 1) {
			return {
				decision: "keep",
				reason: "quality preserved with broad speed and size improvement",
				delta,
			};
		}
		if (avgRatio < 0.97 || tailRatio < 0.97 || sizeRatio < 0.97) {
			return {
				decision: "keep",
				reason: "quality preserved with material efficiency improvement",
				delta,
			};
		}
	}

	if (
		avgRatio > thresholds.avgLatencyRegressionRatio ||
		tailRatio > thresholds.tailLatencyRegressionRatio ||
		sizeRatio > thresholds.sizeRegressionRatio
	) {
		return {
			decision: "rollback",
			reason: "quality did not justify latency or size regression",
			delta,
		};
	}

	return {
		decision: "rollback",
		reason: "objective gain too small",
		delta,
	};
}

function printBackend(prefix, backend) {
	console.log(
		`${prefix}: objective=${backend.objective.toFixed(4)} hits1=${backend.hits1.toFixed(4)} hits3=${backend.hits3.toFixed(4)} hits5=${backend.hits5.toFixed(4)} avg=${backend.avgLatencyMs.toFixed(3)}ms p100=${backend.p100LatencyMs.toFixed(3)}ms size=${backend.persistedIndexBytes}B`,
	);
}

function buildRecord({
	mode,
	label,
	baseline,
	candidate,
	decision,
	reason,
	notes = [],
	candidateMeta = null,
}) {
	return {
		time: new Date().toISOString(),
		mode,
		label,
		decision,
		reason,
		notes,
		candidateMeta,
		baseline,
		candidate,
	};
}

function isCandidateBetter(currentBest, nextRun) {
	if (nextRun.backend.objective > currentBest.backend.objective) {
		return true;
	}
	if (nextRun.backend.objective < currentBest.backend.objective) {
		return false;
	}
	if (nextRun.backend.hits1 > currentBest.backend.hits1) {
		return true;
	}
	if (nextRun.backend.hits1 < currentBest.backend.hits1) {
		return false;
	}
	if (nextRun.backend.avgLatencyMs < currentBest.backend.avgLatencyMs) {
		return true;
	}
	if (nextRun.backend.avgLatencyMs > currentBest.backend.avgLatencyMs) {
		return false;
	}
	return nextRun.backend.persistedIndexBytes < currentBest.backend.persistedIndexBytes;
}

function buildRepoNotes(extraNotes = []) {
	const repoState = readRepoState();
	return {
		repoState,
		notes: [
			`head=${repoState.head}`,
			`dirtyFiles=${repoState.available ? repoState.dirtyFiles.length : "unavailable"}`,
			...repoState.notes,
			...extraNotes,
		],
	};
}

function createDryRunRecord(mode, label, reason, notes, candidateMeta = null) {
	const record = buildRecord({
		mode,
		label,
		baseline: null,
		candidate: null,
		decision: "dry-run",
		reason,
		notes,
		candidateMeta,
	});
	appendJsonl(record);
	writeLatestReport(record);
	return record;
}

function createBlockedRecord(mode, label, reason, notes, candidateMeta = null) {
	const record = buildRecord({
		mode,
		label,
		baseline: null,
		candidate: null,
		decision: "blocked",
		reason,
		notes,
		candidateMeta,
	});
	appendJsonl(record);
	writeLatestReport(record);
	return record;
}

function runMechanismMode(args) {
	const { repoState, notes } = buildRepoNotes();
	const label = args.label || (args.dryRun ? "mechanism-dry-run" : "mechanism");

	if (args.dryRun) {
		return createDryRunRecord(
			"mechanism",
			label,
			"benchmark skipped",
			notes,
		);
	}

	if (!repoState.available) {
		const record = createBlockedRecord(
			"mechanism",
			label,
			"mechanism mode requires git/worktree subprocess access; run it in a normal local terminal",
			notes,
		);
		console.log(record.reason);
		return record;
	}

	let candidateRun;
	try {
		candidateRun = runBenchmark(process.cwd(), args.benchmarkArgs);
	} catch (error) {
		if (error instanceof BenchmarkUnavailableError) {
			const record = createBlockedRecord(
				"mechanism",
				label,
				error.message,
				notes,
			);
			console.log(record.reason);
			return record;
		}
		throw error;
	}
	printBackend("candidate", candidateRun.backend);

	let baselineRun;
	try {
		baselineRun = withHeadWorktree((worktreePath) =>
			runBenchmark(worktreePath, args.benchmarkArgs),
		);
	} catch (error) {
		if (
			error instanceof BenchmarkUnavailableError ||
			error instanceof GitUnavailableError
		) {
			const record = createBlockedRecord(
				"mechanism",
				label,
				error.message,
				notes,
			);
			console.log(record.reason);
			return record;
		}
		throw error;
	}
	printBackend("baseline", baselineRun.backend);

	const verdict = decideCandidate(baselineRun.backend, candidateRun.backend);
	const record = buildRecord({
		mode: "mechanism",
		label,
		baseline: baselineRun,
		candidate: candidateRun,
		decision: verdict.decision,
		reason: verdict.reason,
		notes,
	});
	appendJsonl(record);
	writeLatestReport(record);
	console.log(`decision=${verdict.decision} reason=${verdict.reason}`);
	return record;
}

function runParameterMode(args) {
	const originalSource = readParameterFile(args.parameterFile);
	const baselineProfile = extractCurrentTuningProfile(originalSource);
	const candidates = readCandidateManifest(args.candidateFile).slice(
		0,
		args.maxCandidates,
	);
	const { notes } = buildRepoNotes([
		`parameterFile=${args.parameterFile}`,
		`candidateFile=${args.candidateFile}`,
		`baselineProfile=${JSON.stringify(baselineProfile)}`,
	]);
	const label = args.label || (args.dryRun ? "parameter-dry-run" : "parameter");

	if (args.dryRun) {
		return createDryRunRecord(
			"parameter",
			label,
			candidates.length > 0
				? `would evaluate ${candidates.length} tuning candidates`
				: "no candidate manifest provided; automation should generate candidates",
			notes,
			candidates,
		);
	}

	if (candidates.length === 0) {
		const record = createBlockedRecord(
			"parameter",
			label,
			"no candidate manifest provided; controller no longer owns a fixed parameter grid, so automation must supply candidate patches",
			notes,
			baselineProfile,
		);
		console.log(record.reason);
		return record;
	}

	let baselineRun;
	try {
		baselineRun = runBenchmark(process.cwd(), args.benchmarkArgs);
	} catch (error) {
		if (error instanceof BenchmarkUnavailableError) {
			const record = createBlockedRecord(
				"parameter",
				label,
				error.message,
				notes,
				baselineProfile,
			);
			console.log(record.reason);
			return record;
		}
		throw error;
	} finally {
		fs.writeFileSync(args.parameterFile, originalSource, "utf8");
	}
	printBackend("baseline", baselineRun.backend);

	let best = {
		run: baselineRun,
		decision: "baseline",
		reason: "baseline",
		candidateMeta: baselineProfile,
	};

	for (const candidate of candidates) {
		const patched = patchTuningValues(originalSource, candidate);
		fs.writeFileSync(args.parameterFile, patched, "utf8");
		let candidateRun;
		try {
			candidateRun = runBenchmark(process.cwd(), args.benchmarkArgs);
		} catch (error) {
			if (error instanceof BenchmarkUnavailableError) {
				const record = createBlockedRecord(
					"parameter",
					label,
					error.message,
					notes,
					candidate,
				);
				console.log(record.reason);
				return record;
			}
			throw error;
		} finally {
			fs.writeFileSync(args.parameterFile, originalSource, "utf8");
		}

		const verdict = decideCandidate(baselineRun.backend, candidateRun.backend);
		console.log(
			`${verdict.decision.padEnd(8)} ${candidate.label} objective=${candidateRun.backend.objective.toFixed(4)} hits1=${candidateRun.backend.hits1.toFixed(4)} avg=${candidateRun.backend.avgLatencyMs.toFixed(3)}ms size=${candidateRun.backend.persistedIndexBytes}B reason=${verdict.reason}`,
		);

		if (verdict.decision === "keep" && isCandidateBetter(best.run, candidateRun)) {
			best = {
				run: candidateRun,
				decision: verdict.decision,
				reason: verdict.reason,
				candidateMeta: candidate,
			};
		}
	}

	const shouldApplyBest =
		args.applyBest &&
		best.candidateMeta &&
		JSON.stringify(best.candidateMeta) !== JSON.stringify(baselineProfile);
	if (shouldApplyBest) {
		fs.writeFileSync(
			args.parameterFile,
			patchTuningValues(originalSource, best.candidateMeta),
			"utf8",
		);
	}

	const record = buildRecord({
		mode: "parameter",
		label,
		baseline: baselineRun,
		candidate: best.run,
		decision: best.decision === "baseline" ? "rollback" : best.decision,
		reason:
			best.decision === "baseline"
				? "no candidate cleared keep threshold"
				: best.reason,
		notes,
		candidateMeta: best.candidateMeta,
	});
	appendJsonl(record);
	writeLatestReport(record);
	console.log(
		`best=${JSON.stringify(best.candidateMeta)} decision=${record.decision} reason=${record.reason}`,
	);
	return record;
}

function main() {
	const args = parseArgs(process.argv);
	try {
		if (args.mode === "mechanism") {
			runMechanismMode(args);
			return;
		}
		if (args.mode === "parameter") {
			runParameterMode(args);
			return;
		}
		throw new Error(`Unsupported mode: ${args.mode}`);
	} catch (error) {
		if (
			error instanceof BenchmarkUnavailableError ||
			error instanceof GitUnavailableError
		) {
			console.error(error.message);
			process.exitCode = 2;
			return;
		}
		throw error;
	}
}

main();
