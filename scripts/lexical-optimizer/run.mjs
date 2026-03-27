import fs from "fs";
import path from "path";
import {
	DEFAULT_BASELINE_REF,
	DEFAULT_BENCHMARK_ARGS,
	DEFAULT_CANDIDATE_FILE,
	DEFAULT_PARAMETER_TARGET_FILE,
	DEFAULT_THRESHOLDS,
} from "./config.mjs";
import { BenchmarkUnavailableError, runBenchmark } from "./benchmark.mjs";
import {
	GitUnavailableError,
	readRepoState,
	withWorktreeAtRef,
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
		help: false,
		applyBest: false,
		maxCandidates: Number.POSITIVE_INFINITY,
		benchmarkArgs: DEFAULT_BENCHMARK_ARGS,
		parameterFile: DEFAULT_PARAMETER_TARGET_FILE,
		candidateFile: DEFAULT_CANDIDATE_FILE,
		baselineRef: DEFAULT_BASELINE_REF,
	};

	for (const arg of argv.slice(2)) {
		if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else if (arg.startsWith("--mode=")) {
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
		} else if (arg.startsWith("--baseline-ref=")) {
			args.baselineRef = arg.slice("--baseline-ref=".length) || DEFAULT_BASELINE_REF;
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
	recommendedCommands = [],
}) {
	return {
		time: new Date().toISOString(),
		mode,
		label,
		decision,
		reason,
		notes,
		candidateMeta,
		recommendedCommands,
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

function formatPathForCommand(filePath) {
	const relativePath = path.relative(process.cwd(), filePath);
	if (relativePath && !relativePath.startsWith("..")) {
		return relativePath.replace(/\//g, "\\");
	}
	return filePath;
}

function quoteCommandPart(value) {
	return /\s/.test(value) ? `"${value}"` : value;
}

function buildCommand(parts) {
	return parts.map(quoteCommandPart).join(" ");
}

function buildParameterCommand(args, options = {}) {
	const parts = [
		"node",
		"scripts/lexical-optimizer/run.mjs",
		"--mode=parameter",
		`--candidate-file=${formatPathForCommand(args.candidateFile)}`,
	];
	if (args.parameterFile !== DEFAULT_PARAMETER_TARGET_FILE) {
		parts.push(`--parameter-file=${formatPathForCommand(args.parameterFile)}`);
	}
	if (Number.isFinite(args.maxCandidates)) {
		parts.push(`--max-candidates=${args.maxCandidates}`);
	}
	if (options.dryRun) {
		parts.push("--dry-run");
	}
	if (options.applyBest) {
		parts.push("--apply-best");
	}
	return buildCommand(parts);
}

function buildMechanismCommand(args, options = {}) {
	const parts = [
		"node",
		"scripts/lexical-optimizer/run.mjs",
		"--mode=mechanism",
		`--baseline-ref=${args.baselineRef}`,
	];
	if (options.dryRun) {
		parts.push("--dry-run");
	}
	return buildCommand(parts);
}

function buildRecommendedCommands(args, context) {
	const commands = [];
	if (context.mode === "parameter") {
		if (context.reason?.includes("no candidate manifest provided")) {
			commands.push(
				buildCommand([
					"Copy-Item",
					"scripts\\lexical-optimizer\\candidate-manifest.example.json",
					formatPathForCommand(args.candidateFile),
				]),
			);
			commands.push(buildParameterCommand(args, { dryRun: true }));
			commands.push(buildParameterCommand(args));
			return commands;
		}
		if (context.decision === "dry-run") {
			commands.push(buildParameterCommand(args));
			commands.push(buildParameterCommand(args, { applyBest: true }));
			return commands;
		}
		if (context.decision === "keep") {
			if (!args.applyBest) {
				commands.push(buildParameterCommand(args, { applyBest: true }));
			}
			commands.push(
				buildCommand([
					"git",
					"diff",
					"--",
					formatPathForCommand(args.parameterFile),
				]),
			);
			return commands;
		}
		commands.push(buildParameterCommand(args, { dryRun: true }));
		commands.push(buildParameterCommand(args));
		return commands;
	}

	if (context.mode === "mechanism") {
		if (context.decision === "dry-run") {
			commands.push(buildMechanismCommand(args));
			return commands;
		}
		commands.push(buildMechanismCommand(args));
		commands.push(
			buildCommand(["git", "diff", args.baselineRef, "--"]),
		);
		commands.push(buildCommand(["git", "status", "--short"]));
		return commands;
	}

	return commands;
}

function syncWorktreeBenchmarkAssets(worktreePath) {
	const relativePaths = ["benchmarks/corpora"];
	for (const relativePath of relativePaths) {
		const sourcePath = path.join(process.cwd(), relativePath);
		if (!fs.existsSync(sourcePath)) {
			continue;
		}
		const targetPath = path.join(worktreePath, relativePath);
		if (fs.existsSync(targetPath)) {
			continue;
		}
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.cpSync(sourcePath, targetPath, { recursive: true });
	}
}

function persistRecord(record, args) {
	const enrichedRecord = {
		...record,
		recommendedCommands:
			record.recommendedCommands?.length > 0
				? record.recommendedCommands
				: buildRecommendedCommands(args, record),
	};
	appendJsonl(enrichedRecord);
	writeLatestReport(enrichedRecord);
	return enrichedRecord;
}

function createDryRunRecord(mode, label, reason, notes, args, candidateMeta = null) {
	return persistRecord(
		buildRecord({
			mode,
			label,
			baseline: null,
			candidate: null,
			decision: "dry-run",
			reason,
			notes,
			candidateMeta,
		}),
		args,
	);
}

function createBlockedRecord(
	mode,
	label,
	reason,
	notes,
	args,
	candidateMeta = null,
) {
	return persistRecord(
		buildRecord({
			mode,
			label,
			baseline: null,
			candidate: null,
			decision: "blocked",
			reason,
			notes,
			candidateMeta,
		}),
		args,
	);
}

function createFinalRecord(params, args) {
	return persistRecord(buildRecord(params), args);
}

function printHelp() {
	console.log(
		[
			"Lexical Optimizer",
			"",
			"Usage:",
			"  node scripts/lexical-optimizer/run.mjs --mode=parameter [--candidate-file=...] [--apply-best]",
			"  node scripts/lexical-optimizer/run.mjs --mode=mechanism [--baseline-ref=HEAD]",
			"",
			"Recommended local workflow:",
			"  1. Prepare candidates in .codex-bench/lexical-optimizer/candidates.json",
			"  2. Dry-run the parameter loop:",
			`     ${buildParameterCommand(parseArgs(["node", "run", "--dry-run"]), { dryRun: true })}`,
			"  3. Run the actual comparison loop:",
			`     ${buildParameterCommand(parseArgs(["node", "run"]))}`,
			"  4. If the report says keep, apply the winning candidate:",
			`     ${buildParameterCommand(parseArgs(["node", "run"]), { applyBest: true })}`,
			"  5. Compare the whole current workspace against the baseline worktree:",
			`     ${buildMechanismCommand(parseArgs(["node", "run"]))}`,
			"",
			"Mechanism mode compares the current workspace against --baseline-ref using a git worktree.",
			"Parameter mode compares candidate patches against the current tuning file baseline.",
		].join("\n"),
	);
}

function runMechanismMode(args) {
	const { repoState, notes } = buildRepoNotes([`baselineRef=${args.baselineRef}`]);
	const label = args.label || (args.dryRun ? "mechanism-dry-run" : "mechanism");

	if (args.dryRun) {
		return createDryRunRecord("mechanism", label, "benchmark skipped", notes, args);
	}

	if (!repoState.available) {
		const record = createBlockedRecord(
			"mechanism",
			label,
			"mechanism mode requires git/worktree subprocess access; run it in a normal local terminal",
			notes,
			args,
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
				args,
			);
			console.log(record.reason);
			return record;
		}
		throw error;
	}
	printBackend("candidate", candidateRun.backend);

	let baselineRun;
	try {
		baselineRun = withWorktreeAtRef(args.baselineRef, (worktreePath) => {
			syncWorktreeBenchmarkAssets(worktreePath);
			return runBenchmark(worktreePath, args.benchmarkArgs);
		});
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
				args,
			);
			console.log(record.reason);
			return record;
		}
		throw error;
	}
	printBackend("baseline", baselineRun.backend);

	const verdict = decideCandidate(baselineRun.backend, candidateRun.backend);
	const record = createFinalRecord(
		{
			mode: "mechanism",
			label,
			baseline: baselineRun,
			candidate: candidateRun,
			decision: verdict.decision,
			reason: verdict.reason,
			notes,
		},
		args,
	);
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
			args,
			candidates,
		);
	}

	if (candidates.length === 0) {
		const record = createBlockedRecord(
			"parameter",
			label,
			"no candidate manifest provided; controller no longer owns a fixed parameter grid, so automation must supply candidate patches",
			notes,
			args,
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
				args,
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
					args,
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

	const record = createFinalRecord(
		{
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
		},
		args,
	);
	console.log(
		`best=${JSON.stringify(best.candidateMeta)} decision=${record.decision} reason=${record.reason}`,
	);
	return record;
}

function main() {
	const args = parseArgs(process.argv);
	if (args.help) {
		printHelp();
		return;
	}
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
