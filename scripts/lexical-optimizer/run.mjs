import fs from "fs";
import path from "path";
import { spawn } from "child_process";
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
	buildParallelRunDir,
	sanitizeLaneName,
} from "./config.mjs";
import { BenchmarkUnavailableError, runBenchmark } from "./benchmark.mjs";
import {
	GitUnavailableError,
	createWorktreeAtRef,
	readRepoState,
	removeWorktree,
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

function ensureParentDir(filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolvePathWithinWorktree(worktreePath, sourcePath) {
	const relativePath = path.relative(process.cwd(), sourcePath);
	if (!relativePath || relativePath.startsWith("..")) {
		throw new Error(`Source path must stay inside workspace: ${sourcePath}`);
	}
	return path.join(worktreePath, relativePath);
}

function syncSourcePathToWorktree(worktreePath, sourcePath) {
	if (!fs.existsSync(sourcePath)) {
		return;
	}
	const targetPath = resolvePathWithinWorktree(worktreePath, sourcePath);
	ensureParentDir(targetPath);
	const stats = fs.statSync(sourcePath);
	if (stats.isDirectory()) {
		fs.cpSync(sourcePath, targetPath, { recursive: true });
		return;
	}
	fs.copyFileSync(sourcePath, targetPath);
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
		mode: "parameter",
		label: "",
		lane: DEFAULT_LANE,
		dryRun: false,
		help: false,
		applyBest: false,
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
		jobFile: "",
		outputJson: "",
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
		} else if (arg.startsWith("--job-file=")) {
			args.jobFile = path.resolve(arg.slice("--job-file=".length));
		} else if (arg.startsWith("--output-json=")) {
			args.outputJson = path.resolve(arg.slice("--output-json=".length));
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
		`--parallel-workers=${options.parallelWorkers ?? args.parallelWorkers}`,
		`--revalidate-topk=${options.revalidateTopK ?? args.revalidateTopK}`,
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
		`--lane=${args.lane}`,
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

function evaluateCandidateInWorktree(job) {
	const worktreePath = createWorktreeAtRef(job.ref, job.jobLabel);
	try {
		syncWorktreeBenchmarkAssets(worktreePath);
		for (const sourcePath of job.syncFiles) {
			syncSourcePathToWorktree(worktreePath, sourcePath);
		}
		const worktreeParameterFile = resolvePathWithinWorktree(
			worktreePath,
			job.parameterFile,
		);
		const syncedSource = readParameterFile(worktreeParameterFile);
		const patchedSource = patchTuningValues(syncedSource, job.candidate);
		fs.writeFileSync(worktreeParameterFile, patchedSource, "utf8");
		const benchmarkRun = runBenchmark(worktreePath, job.benchmarkArgs);
		return {
			ok: true,
			candidate: job.candidate,
			run: benchmarkRun,
			jobLabel: job.jobLabel,
		};
	} catch (error) {
		return {
			ok: false,
			candidate: job.candidate,
			jobLabel: job.jobLabel,
			error: {
				name: error?.name ?? "Error",
				message: error?.message ?? String(error),
			},
		};
	} finally {
		removeWorktree(worktreePath);
	}
}

function writeJson(filePath, value) {
	ensureParentDir(filePath);
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function spawnWorkerProcess(jobFile, outputJson) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				path.resolve(process.cwd(), "scripts/lexical-optimizer/run.mjs"),
				"--mode=parameter-worker",
				`--job-file=${jobFile}`,
				`--output-json=${outputJson}`,
			],
			{
				cwd: process.cwd(),
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(
					new Error(
						[
							`worker exited with code ${code}`,
							stdout.trim(),
							stderr.trim(),
						]
							.filter(Boolean)
							.join("\n\n"),
					),
				);
				return;
			}
			resolve({
				outputJson,
				stdout,
				stderr,
			});
		});
	});
}

async function runParallelCandidateScreen(args, repoState, candidates) {
	const runLabel = `${sanitizeLabel(args.label || args.lane, args.lane)}-${Date.now()}`;
	const runDir = buildParallelRunDir(runLabel);
	const jobsDir = path.join(runDir, "jobs");
	fs.mkdirSync(jobsDir, { recursive: true });

	const jobs = candidates.map((candidate, index) => {
		const candidateLabel = sanitizeLabel(candidate.label, `candidate-${index + 1}`);
		const jobDir = path.join(jobsDir, `${String(index + 1).padStart(3, "0")}-${candidateLabel}`);
		fs.mkdirSync(jobDir, { recursive: true });
		const jobFile = path.join(jobDir, "job.json");
		const outputJson = path.join(jobDir, "result.json");
		writeJson(jobFile, {
			candidate,
			ref: repoState.head,
			jobLabel: `${args.lane}-${candidateLabel}`,
			parameterFile: args.parameterFile,
			benchmarkArgs: args.benchmarkArgs,
			syncFiles: args.syncFiles,
		});
		return {
			candidate,
			jobFile,
			outputJson,
		};
	});

	const workerCount = Math.max(1, Math.min(args.parallelWorkers, jobs.length));
	const results = [];
	let nextIndex = 0;

	async function runNext() {
		if (nextIndex >= jobs.length) {
			return;
		}
		const job = jobs[nextIndex++];
		const workerResult = await spawnWorkerProcess(job.jobFile, job.outputJson);
		results.push({
			...readJson(workerResult.outputJson),
			stdout: workerResult.stdout,
			stderr: workerResult.stderr,
		});
		await runNext();
	}

	await Promise.all(
		Array.from({ length: workerCount }, () => runNext()),
	);

	return {
		runDir,
		results,
	};
}

function shortlistParallelResults(results, topK) {
	return results
		.filter((entry) => entry.ok && entry.run?.backend)
		.sort((left, right) => compareBackends(left.run.backend, right.run.backend))
		.slice(0, Math.max(1, topK));
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
		`parallelWorkers=${args.parallelWorkers}`,
		`revalidateTopK=${args.revalidateTopK}`,
		`baselineProfile=${JSON.stringify(baselineProfile)}`,
	]);
	const label = args.label || (args.dryRun ? "parameter-dry-run" : "parameter");

	if (args.dryRun) {
		return createDryRunRecord(
			"parameter",
			label,
			candidates.length > 0
				? `would evaluate ${candidates.length} tuning candidates via stage1 parallel coarse screen and stage2 serial revalidation`
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

	let coarseResults = [];
	let parallelRunDir = "";
	if (args.parallelWorkers > 1 && candidates.length > 1 && repoState.available) {
		try {
			const parallelScreen = await runParallelCandidateScreen(args, repoState, candidates);
			parallelRunDir = parallelScreen.runDir;
			coarseResults = parallelScreen.results;
			console.log(
				`stage1: parallel coarse screen completed lane=${args.lane} workers=${Math.min(args.parallelWorkers, candidates.length)} runDir=${parallelRunDir}`,
			);
		} catch (error) {
			notes.push(
				`parallel coarse screen fallback=${error?.message ?? String(error)}`,
			);
		}
	}

	const shortlistedCandidates =
		coarseResults.length > 0
			? shortlistParallelResults(coarseResults, args.revalidateTopK).map(
					(entry) => entry.candidate,
				)
			: candidates;
	console.log(
		`stage2: serial revalidation candidates=${shortlistedCandidates.length} shortlistedFrom=${coarseResults.length || candidates.length}`,
	);

	let best = {
		run: baselineRun,
		decision: "baseline",
		reason: "baseline",
		candidateMeta: baselineProfile,
	};
	const revalidated = [];

	for (const candidate of shortlistedCandidates) {
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
		args.applyBest &&
		best.candidateMeta &&
		JSON.stringify(best.candidateMeta) !== JSON.stringify(baselineProfile);
	if (shouldApplyBest) {
		fs.writeFileSync(
			args.parameterFile,
			patchTuningValues(originalSource, best.candidateMeta),
			"utf8",
		);
	} else {
		fs.writeFileSync(args.parameterFile, originalSource, "utf8");
	}

	const finalNotes = [
		...notes,
		`stage1ParallelCandidates=${coarseResults.length}`,
		`stage2SerialRevalidated=${revalidated.length}`,
		parallelRunDir ? `parallelRunDir=${parallelRunDir}` : "parallelRunDir=none",
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
	const record = createFinalRecord(
		{
			mode: "mechanism",
			label,
			lane: args.lane,
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

function runParameterWorkerMode(args) {
	if (!args.jobFile || !args.outputJson) {
		throw new Error("parameter-worker mode requires --job-file and --output-json");
	}
	const job = readJson(args.jobFile);
	const result = evaluateCandidateInWorktree(job);
	writeJson(args.outputJson, result);
}

function printHelp() {
	console.log(
		[
			"Lexical Optimizer",
			"",
			"Usage:",
			"  node scripts/lexical-optimizer/run.mjs --mode=parameter [--lane=mechanism-a] [--candidate-file=...] [--parallel-workers=2] [--revalidate-topk=3] [--apply-best]",
			"  node scripts/lexical-optimizer/run.mjs --mode=mechanism [--lane=mechanism-a] [--baseline-ref=HEAD]",
			"",
			"Lane conventions:",
			"  - each lane gets its own candidate manifest and output files",
			"  - default lane files live under .codex-bench/lexical-optimizer/lanes/<lane>/...",
			"  - stage1 uses parallel worktree coarse screen",
			"  - stage2 serially revalidates top K winners in the current workspace",
			"",
			"Recommended local workflow:",
			"  1. Prepare a lane-specific manifest",
			`     ${formatPathForCommand(buildLaneCandidateFile("mechanism-a"))}`,
			"  2. Dry-run the lane:",
			`     ${buildParameterCommand(parseArgs(["node", "run", "--lane=mechanism-a"]), { dryRun: true })}`,
			"  3. Run stage1+stage2:",
			`     ${buildParameterCommand(parseArgs(["node", "run", "--lane=mechanism-a"]))}`,
			"  4. If the report says keep, apply the winning candidate:",
			`     ${buildParameterCommand(parseArgs(["node", "run", "--lane=mechanism-a"]), { applyBest: true })}`,
			"  5. Compare the whole current workspace against the baseline worktree:",
			`     ${buildMechanismCommand(parseArgs(["node", "run", "--lane=mechanism-a"]))}`,
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
		if (args.mode === "parameter-worker") {
			runParameterWorkerMode(args);
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
