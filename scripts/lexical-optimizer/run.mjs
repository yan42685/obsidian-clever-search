import fs from "fs";
import path from "path";
import {
	DEFAULT_BASELINE_REF,
	DEFAULT_BENCHMARK_ARGS,
	DEFAULT_CANDIDATE_FILE,
	DEFAULT_IMPLEMENTATION_TARGET_FILE,
	DEFAULT_LANE,
	DEFAULT_PARALLEL_WORKERS,
	DEFAULT_PARAMETER_TARGET_FILE,
	DEFAULT_THRESHOLDS,
	DEFAULT_TOP_K_REVALIDATE,
	buildLaneCandidateFile,
	buildLaneLatestReport,
	buildLaneResultsJsonl,
	sanitizeLaneName,
} from "./config.mjs";
import { BenchmarkUnavailableError, runBenchmark } from "./benchmark.mjs";
import {
	GitUnavailableError,
	cleanupOptimizerResources,
	commitScopedFiles,
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

function sanitizeLabel(value, fallback = "run") {
	const normalized = String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || fallback;
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

function parseArgs(argv) {
	const args = {
		mode: "mechanism",
		label: "",
		lane: DEFAULT_LANE,
		dryRun: false,
		help: false,
		applyBest: false,
		autoCommit: true,
		cleanupTempResources: true,
		commitMessage: "",
		maxCandidates: Number.POSITIVE_INFINITY,
		benchmarkArgs: DEFAULT_BENCHMARK_ARGS,
		parameterFile: DEFAULT_PARAMETER_TARGET_FILE,
		implementationFile: DEFAULT_IMPLEMENTATION_TARGET_FILE,
		candidateFile: "",
		baselineRef: DEFAULT_BASELINE_REF,
		resultsJsonl: "",
		latestReport: "",
		parallelWorkers: DEFAULT_PARALLEL_WORKERS,
		revalidateTopK: DEFAULT_TOP_K_REVALIDATE,
		syncFiles: [],
	};

	for (const arg of argv.slice(2)) {
		if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else if (arg.startsWith("--mode=")) {
			args.mode = arg.slice("--mode=".length);
		} else if (arg.startsWith("--label=")) {
			args.label = arg.slice("--label=".length);
		} else if (arg.startsWith("--lane=")) {
			args.lane = arg.slice("--lane=".length);
		} else if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--apply-best") {
			args.applyBest = true;
		} else if (arg === "--no-auto-commit") {
			args.autoCommit = false;
		} else if (arg === "--no-cleanup") {
			args.cleanupTempResources = false;
		} else if (arg.startsWith("--commit-message=")) {
			args.commitMessage = arg.slice("--commit-message=".length);
		} else if (arg.startsWith("--max-candidates=")) {
			args.maxCandidates = Number(arg.slice("--max-candidates=".length)) || 0;
		} else if (arg.startsWith("--parameter-file=")) {
			args.parameterFile = path.resolve(arg.slice("--parameter-file=".length));
		} else if (arg.startsWith("--implementation-file=")) {
			args.implementationFile = path.resolve(
				arg.slice("--implementation-file=".length),
			);
		} else if (arg.startsWith("--candidate-file=")) {
			args.candidateFile = path.resolve(arg.slice("--candidate-file=".length));
		} else if (arg.startsWith("--baseline-ref=")) {
			args.baselineRef = arg.slice("--baseline-ref=".length) || DEFAULT_BASELINE_REF;
		} else if (arg.startsWith("--results-jsonl=")) {
			args.resultsJsonl = path.resolve(arg.slice("--results-jsonl=".length));
		} else if (arg.startsWith("--latest-report=")) {
			args.latestReport = path.resolve(arg.slice("--latest-report=".length));
		} else if (arg.startsWith("--parallel-workers=")) {
			args.parallelWorkers =
				Math.max(1, Number(arg.slice("--parallel-workers=".length)) || 1);
		} else if (arg.startsWith("--revalidate-topk=")) {
			args.revalidateTopK =
				Math.max(1, Number(arg.slice("--revalidate-topk=".length)) || 1);
		} else if (arg.startsWith("--sync-file=")) {
			args.syncFiles.push(path.resolve(arg.slice("--sync-file=".length)));
		}
	}

	args.lane = sanitizeLaneName(args.lane);
	if (!args.candidateFile) {
		args.candidateFile =
			args.lane === DEFAULT_LANE
				? DEFAULT_CANDIDATE_FILE
				: buildLaneCandidateFile(args.lane);
	}
	if (!args.resultsJsonl) {
		args.resultsJsonl = buildLaneResultsJsonl(args.lane);
	}
	if (!args.latestReport) {
		args.latestReport = buildLaneLatestReport(args.lane);
	}
	if (args.syncFiles.length === 0) {
		args.syncFiles = [args.parameterFile, args.implementationFile];
	}
	args.syncFiles = Array.from(new Set(args.syncFiles.map((file) => path.resolve(file))));
	return args;
}

function buildAutoCommitMessage(args, candidateMeta) {
	if (args.commitMessage) {
		return args.commitMessage;
	}
	const candidateLabel = sanitizeLabel(candidateMeta?.label, "best");
	return `自动优化 lexical ${args.lane}: ${candidateLabel}`;
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
		candidate.persistedIndexBytes / Math.max(1, baseline.persistedIndexBytes);

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

function compareBackends(left, right) {
	if (left.objective !== right.objective) {
		return right.objective - left.objective;
	}
	if (left.hits1 !== right.hits1) {
		return right.hits1 - left.hits1;
	}
	if (left.hits3 !== right.hits3) {
		return right.hits3 - left.hits3;
	}
	if (left.avgLatencyMs !== right.avgLatencyMs) {
		return left.avgLatencyMs - right.avgLatencyMs;
	}
	return left.persistedIndexBytes - right.persistedIndexBytes;
}

function printBackend(prefix, backend) {
	console.log(
		`${prefix}: objective=${backend.objective.toFixed(4)} hits1=${backend.hits1.toFixed(4)} hits3=${backend.hits3.toFixed(4)} hits5=${backend.hits5.toFixed(4)} avg=${backend.avgLatencyMs.toFixed(3)}ms p100=${backend.p100LatencyMs.toFixed(3)}ms size=${backend.persistedIndexBytes}B`,
	);
}

function buildRecord({
	mode,
	label,
	lane,
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
		lane,
		decision,
		reason,
		notes,
		candidateMeta,
		recommendedCommands,
		baseline,
		candidate,
	};
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

function hasPreexistingScopedChange(repoState, filePath) {
	if (!repoState?.available || !filePath) {
		return false;
	}
	const relativePath = path.relative(process.cwd(), path.resolve(filePath));
	return repoState.dirtyFiles.some((entry) => entry.endsWith(relativePath));
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
		`--lane=${args.lane}`,
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
	if (options.disableAutoCommit || !args.autoCommit) {
		parts.push("--no-auto-commit");
	}
	if (options.disableCleanup || !args.cleanupTempResources) {
		parts.push("--no-cleanup");
	}
	return buildCommand(parts);
}

function buildMechanismCommand(args, options = {}) {
	const parts = [
		"node",
		"scripts/lexical-optimizer/run.mjs",
		"--mode=mechanism",
		`--lane=${args.lane}`,
		`--baseline-ref=${args.baselineRef}`,
	];
	if (options.dryRun) {
		parts.push("--dry-run");
	}
	if (options.disableAutoCommit || !args.autoCommit) {
		parts.push("--no-auto-commit");
	}
	if (options.disableCleanup || !args.cleanupTempResources) {
		parts.push("--no-cleanup");
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
			commands.push(
				buildParameterCommand(args, {
					disableAutoCommit: true,
				}),
			);
			commands.push(buildParameterCommand(args));
			return commands;
		}
		if (context.decision === "keep") {
			commands.push(buildCommand(["git", "show", "--stat", "--oneline", "HEAD"]));
			commands.push(buildCommand(["git", "status", "--short"]));
			return commands;
		}
		commands.push(
			buildParameterCommand(args, {
				dryRun: true,
				disableAutoCommit: true,
			}),
		);
		commands.push(buildParameterCommand(args, { disableAutoCommit: true }));
		return commands;
	}

	if (context.mode === "mechanism") {
		if (context.decision === "dry-run") {
			commands.push(buildMechanismCommand(args, { dryRun: true }));
			return commands;
		}
		commands.push(buildMechanismCommand(args));
		commands.push(buildCommand(["git", "diff", args.baselineRef, "--"]));
		commands.push(buildCommand(["git", "status", "--short"]));
	}
	return commands;
}

function persistRecord(record, args) {
	const enrichedRecord = {
		...record,
		recommendedCommands:
			record.recommendedCommands?.length > 0
				? record.recommendedCommands
				: buildRecommendedCommands(args, record),
	};
	appendJsonl(enrichedRecord, args.resultsJsonl);
	writeLatestReport(enrichedRecord, args.latestReport);
	return enrichedRecord;
}

function createDryRunRecord(mode, label, reason, notes, args, candidateMeta = null) {
	return persistRecord(
		buildRecord({
			mode,
			label,
			lane: args.lane,
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
			lane: args.lane,
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

function evaluateCandidateInCurrentWorkspace(args, originalSource, candidate) {
	const patched = patchTuningValues(originalSource, candidate);
	fs.writeFileSync(args.parameterFile, patched, "utf8");
	try {
		return runBenchmark(process.cwd(), args.benchmarkArgs);
	} finally {
		fs.writeFileSync(args.parameterFile, originalSource, "utf8");
	}
}

async function runParameterMode(args) {
	const originalSource = readParameterFile(args.parameterFile);
	const baselineProfile = extractCurrentTuningProfile(originalSource);
	const candidates = readCandidateManifest(args.candidateFile).slice(
		0,
		args.maxCandidates,
	);
	const { repoState, notes } = buildRepoNotes([
		`lane=${args.lane}`,
		`parameterFile=${args.parameterFile}`,
		`implementationFile=${args.implementationFile}`,
		`candidateFile=${args.candidateFile}`,
		`resultsJsonl=${args.resultsJsonl}`,
		`latestReport=${args.latestReport}`,
		"execution=serial",
		`parallelWorkers=${args.parallelWorkers} (compat-only)`,
		`revalidateTopK=${args.revalidateTopK} (compat-only)`,
		`baselineProfile=${JSON.stringify(baselineProfile)}`,
	]);
	const label = args.label || (args.dryRun ? "parameter-dry-run" : "parameter");

	if (args.dryRun) {
		return createDryRunRecord(
			"parameter",
			label,
			candidates.length > 0
				? `would evaluate ${candidates.length} tuning candidates serially in the current workspace`
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
	const revalidated = [];

	for (const candidate of candidates) {
		let candidateRun;
		try {
			candidateRun = evaluateCandidateInCurrentWorkspace(args, originalSource, candidate);
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
		}
		const verdict = decideCandidate(baselineRun.backend, candidateRun.backend);
		revalidated.push({
			candidate,
			run: candidateRun,
			verdict,
		});
		console.log(
			`${verdict.decision.padEnd(8)} ${candidate.label} objective=${candidateRun.backend.objective.toFixed(4)} hits1=${candidateRun.backend.hits1.toFixed(4)} avg=${candidateRun.backend.avgLatencyMs.toFixed(3)}ms size=${candidateRun.backend.persistedIndexBytes}B reason=${verdict.reason}`,
		);
		if (
			verdict.decision === "keep" &&
			compareBackends(candidateRun.backend, best.run.backend) < 0
		) {
			best = {
				run: candidateRun,
				decision: verdict.decision,
				reason: verdict.reason,
				candidateMeta: candidate,
			};
		}
	}

	const shouldApplyBest =
		(args.applyBest || args.autoCommit) &&
		best.candidateMeta &&
		JSON.stringify(best.candidateMeta) !== JSON.stringify(baselineProfile);
	let autoCommitNote = "autoCommit=skipped";
	if (shouldApplyBest) {
		fs.writeFileSync(
			args.parameterFile,
			patchTuningValues(originalSource, best.candidateMeta),
			"utf8",
		);
		if (
			args.autoCommit &&
			best.decision !== "baseline" &&
			!hasPreexistingScopedChange(repoState, args.parameterFile)
		) {
			try {
				const commitResult = commitScopedFiles(
					[args.parameterFile],
					buildAutoCommitMessage(args, best.candidateMeta),
				);
				autoCommitNote = commitResult.committed
					? `autoCommit=${commitResult.commit}`
					: `autoCommit=${commitResult.reason}`;
			} catch (error) {
				autoCommitNote = `autoCommitError=${error?.message ?? String(error)}`;
			}
		} else if (
			args.autoCommit &&
			hasPreexistingScopedChange(repoState, args.parameterFile)
		) {
			autoCommitNote = "autoCommit=skipped-preexisting-dirty-target";
		}
	} else {
		fs.writeFileSync(args.parameterFile, originalSource, "utf8");
	}
	if (args.cleanupTempResources) {
		cleanupOptimizerResources();
	}

	const finalNotes = [
		...notes,
		`serialCandidates=${candidates.length}`,
		`serialEvaluated=${revalidated.length}`,
		`cleanupTempResources=${args.cleanupTempResources}`,
		autoCommitNote,
		revalidated.length > 0
			? `revalidatedCandidates=${revalidated
					.map((entry) => entry.candidate.label)
					.join(",")}`
			: "revalidatedCandidates=none",
	];

	const record = createFinalRecord(
		{
			mode: "parameter",
			label,
			lane: args.lane,
			baseline: baselineRun,
			candidate: best.run,
			decision: best.decision === "baseline" ? "rollback" : best.decision,
			reason:
				best.decision === "baseline"
					? "no candidate cleared keep threshold after serial revalidation"
					: best.reason,
			notes: finalNotes,
			candidateMeta: best.candidateMeta,
		},
		args,
	);
	console.log(
		`best=${JSON.stringify(best.candidateMeta)} decision=${record.decision} reason=${record.reason}`,
	);
	return record;
}

function runMechanismMode(args) {
	const { repoState, notes } = buildRepoNotes([
		`lane=${args.lane}`,
		`baselineRef=${args.baselineRef}`,
		`resultsJsonl=${args.resultsJsonl}`,
		`latestReport=${args.latestReport}`,
	]);
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
		baselineRun = withWorktreeAtRef(
			args.baselineRef,
			(worktreePath) => {
				syncWorktreeBenchmarkAssets(worktreePath);
				return runBenchmark(worktreePath, args.benchmarkArgs);
			},
			`${args.lane}-baseline`,
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
				args,
			);
			console.log(record.reason);
			return record;
		}
		throw error;
	}
	printBackend("baseline", baselineRun.backend);

	const verdict = decideCandidate(baselineRun.backend, candidateRun.backend);
	const mechanismNotes = [...notes];
	if (args.autoCommit && verdict.decision === "keep") {
		try {
			const commitResult = commitScopedFiles(
				args.syncFiles,
				buildAutoCommitMessage(args, { label: args.lane }),
			);
			mechanismNotes.push(
				commitResult.committed
					? `autoCommit=${commitResult.commit}`
					: `autoCommit=${commitResult.reason}`,
			);
		} catch (error) {
			mechanismNotes.push(
				`autoCommitError=${error?.message ?? String(error)}`,
			);
		}
	} else {
		mechanismNotes.push(`autoCommit=${args.autoCommit ? "skipped" : "disabled"}`);
	}
	if (args.cleanupTempResources) {
		cleanupOptimizerResources();
	}
	mechanismNotes.push(`cleanupTempResources=${args.cleanupTempResources}`);
	const record = createFinalRecord(
		{
			mode: "mechanism",
			label,
			lane: args.lane,
			baseline: baselineRun,
			candidate: candidateRun,
			decision: verdict.decision,
			reason: verdict.reason,
			notes: mechanismNotes,
		},
		args,
	);
	console.log(`decision=${verdict.decision} reason=${verdict.reason}`);
	return record;
}

function printHelp() {
	console.log(
		[
			"Lexical Optimizer",
			"",
			"Usage:",
			"  node scripts/lexical-optimizer/run.mjs [--lane=mechanism-a] [--baseline-ref=HEAD] [--no-auto-commit] [--no-cleanup]",
			"  node scripts/lexical-optimizer/run.mjs --mode=parameter [--lane=mechanism-a] [--candidate-file=...] [--no-auto-commit] [--no-cleanup]",
			"",
			"Lane conventions:",
			"  - each lane gets its own candidate manifest and output files",
			"  - default lane files live under .codex-bench/lexical-optimizer/lanes/<lane>/...",
			"  - mechanism mode is the default and compares the current workspace against a baseline ref",
			"  - parameter mode is legacy opt-in tuning for the old passage ranker surface",
			"",
			"Recommended local workflow:",
			"  1. Compare the whole current workspace against the baseline ref:",
			`     ${buildMechanismCommand(parseArgs(["node", "run", "--lane=mechanism-a"]))}`,
			"  2. Prepare a lane-specific manifest only when you explicitly want legacy parameter tuning:",
			`     ${formatPathForCommand(buildLaneCandidateFile("mechanism-a"))}`,
			"  3. Dry-run the legacy parameter lane:",
			`     ${buildParameterCommand(parseArgs(["node", "run", "--mode=parameter", "--lane=mechanism-a"]), { dryRun: true })}`,
		].join("\n"),
	);
}

async function main() {
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
			await runParameterMode(args);
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

await main();
