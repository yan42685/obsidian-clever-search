import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
	DEFAULT_LANE_NAMES,
	DEFAULT_PARALLEL_WORKERS,
	DEFAULT_TOP_K_REVALIDATE,
	DEFAULT_RESULTS_DIR,
	buildLaneCandidateFile,
	buildLaneLatestReport,
	buildLaneResultsJsonl,
	sanitizeLaneName,
} from "./config.mjs";
import { generateLaneCandidateManifest, writeLaneCandidateManifest } from "./candidate-generator.mjs";

const DEFAULT_LANES = ["mechanism-a", "mechanism-b", "mechanism-c"];
const NON_PARAMETER_LANES = new Set(["benchmark", "regression"]);

function ensureParentDir(filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function round(value, digits = 6) {
	return Number(value.toFixed(digits));
}

function buildOrchestratorDir(runLabel) {
	return path.join(DEFAULT_RESULTS_DIR, "orchestrator", runLabel);
}

function parseArgs(argv) {
	const args = {
		lanes: DEFAULT_LANES,
		parameterFile: "",
		maxCandidates: 6,
		parallelWorkers: DEFAULT_PARALLEL_WORKERS,
		revalidateTopK: DEFAULT_TOP_K_REVALIDATE,
		laneConcurrency: 1,
		dryRun: false,
		generateOnly: false,
		autoCommitWinner: true,
		cleanupTempResources: true,
		runLabel: "",
	};
	for (const arg of argv.slice(2)) {
		if (arg.startsWith("--lanes=")) {
			args.lanes = arg
				.slice("--lanes=".length)
				.split(",")
				.map((lane) => sanitizeLaneName(lane))
				.filter(Boolean);
		} else if (arg.startsWith("--parameter-file=")) {
			args.parameterFile = path.resolve(arg.slice("--parameter-file=".length));
		} else if (arg.startsWith("--max-candidates=")) {
			args.maxCandidates = Math.max(
				1,
				Number(arg.slice("--max-candidates=".length)) || 1,
			);
		} else if (arg.startsWith("--parallel-workers=")) {
			args.parallelWorkers = Math.max(
				1,
				Number(arg.slice("--parallel-workers=".length)) || 1,
			);
		} else if (arg.startsWith("--revalidate-topk=")) {
			args.revalidateTopK = Math.max(
				1,
				Number(arg.slice("--revalidate-topk=".length)) || 1,
			);
		} else if (arg.startsWith("--lane-concurrency=")) {
			args.laneConcurrency = Math.max(
				1,
				Number(arg.slice("--lane-concurrency=".length)) || 1,
			);
		} else if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--generate-only") {
			args.generateOnly = true;
		} else if (arg === "--no-auto-commit") {
			args.autoCommitWinner = false;
		} else if (arg === "--no-cleanup") {
			args.cleanupTempResources = false;
		} else if (arg.startsWith("--label=")) {
			args.runLabel = arg.slice("--label=".length);
		}
	}
	args.lanes = args.lanes.filter((lane) => DEFAULT_LANE_NAMES.includes(lane));
	if (args.lanes.length === 0) {
		args.lanes = DEFAULT_LANES;
	}
	args.runLabel =
		args.runLabel ||
		`orchestrator-${args.lanes.join("-")}-${Date.now()}`;
	return args;
}

function readLastJsonlRecord(filePath) {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	const lines = fs
		.readFileSync(filePath, "utf8")
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return null;
	}
	return JSON.parse(lines[lines.length - 1]);
}

function spawnLaneRun({
	lane,
	parallelWorkers,
	revalidateTopK,
	dryRun,
	autoCommit,
	cleanupTempResources,
}) {
	return new Promise((resolve, reject) => {
		const args = [
			path.resolve(process.cwd(), "scripts/lexical-optimizer/run.mjs"),
			"--mode=parameter",
			`--lane=${lane}`,
			`--parallel-workers=${parallelWorkers}`,
			`--revalidate-topk=${revalidateTopK}`,
		];
		if (dryRun) {
			args.push("--dry-run");
		}
		if (!autoCommit) {
			args.push("--no-auto-commit");
		}
		if (!cleanupTempResources) {
			args.push("--no-cleanup");
		}
		const child = spawn(process.execPath, args, {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});
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
			resolve({
				lane,
				code,
				stdout,
				stderr,
			});
		});
	});
}

function buildLaneSummary(lane, manifest, runResult, record) {
	const candidate = record?.candidate?.backend ?? null;
	const baseline = record?.baseline?.backend ?? null;
	return {
		lane,
		candidateFile: buildLaneCandidateFile(lane),
		resultsJsonl: buildLaneResultsJsonl(lane),
		latestReport: buildLaneLatestReport(lane),
		generatedCandidates: manifest.candidates.length,
		runCode: runResult?.code ?? null,
		decision:
			record?.decision ??
			runResult?.decision ??
			(runResult ? "unknown" : "generated-only"),
		reason: record?.reason ?? runResult?.reason ?? "",
		objectiveDelta:
			candidate && baseline ? round(candidate.objective - baseline.objective) : null,
		hits1Delta: candidate && baseline ? round(candidate.hits1 - baseline.hits1) : null,
		avgLatencyDelta:
			candidate && baseline
				? round(candidate.avgLatencyMs - baseline.avgLatencyMs)
				: null,
		candidateMeta: record?.candidateMeta ?? null,
	};
}

function compareLaneRecords(left, right) {
	const leftBackend = left?.candidate?.backend ?? null;
	const rightBackend = right?.candidate?.backend ?? null;
	if (!leftBackend && !rightBackend) {
		return 0;
	}
	if (!leftBackend) {
		return 1;
	}
	if (!rightBackend) {
		return -1;
	}
	if (leftBackend.objective !== rightBackend.objective) {
		return rightBackend.objective - leftBackend.objective;
	}
	if (leftBackend.hits1 !== rightBackend.hits1) {
		return rightBackend.hits1 - leftBackend.hits1;
	}
	if (leftBackend.hits3 !== rightBackend.hits3) {
		return rightBackend.hits3 - leftBackend.hits3;
	}
	if (leftBackend.avgLatencyMs !== rightBackend.avgLatencyMs) {
		return leftBackend.avgLatencyMs - rightBackend.avgLatencyMs;
	}
	return leftBackend.persistedIndexBytes - rightBackend.persistedIndexBytes;
}

function pickWinningLane(laneArtifacts) {
	return [...laneArtifacts]
		.filter(
			(entry) =>
				!NON_PARAMETER_LANES.has(entry.manifest.lane) &&
				entry.record?.decision === "keep" &&
				entry.record?.candidate?.backend,
		)
		.sort((left, right) => compareLaneRecords(left.record, right.record))[0] ?? null;
}

function writeSummaryFiles(outputDir, summary) {
	const jsonPath = path.join(outputDir, "summary.json");
	const mdPath = path.join(outputDir, "summary.md");
	ensureParentDir(jsonPath);
	fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

	const lines = [
		"# Lexical Orchestrator Summary",
		"",
		`- time: ${summary.time}`,
		`- label: ${summary.label}`,
		`- dryRun: ${summary.dryRun}`,
		`- generateOnly: ${summary.generateOnly}`,
		`- lanes: ${summary.lanes.join(", ")}`,
		`- execution: ${summary.execution}`,
		`- parallelWorkers: ${summary.parallelWorkers}`,
		`- revalidateTopK: ${summary.revalidateTopK}`,
		`- laneConcurrency: ${summary.laneConcurrency}`,
		"",
		"## Lane Results",
		"",
	];
	for (const lane of summary.laneResults) {
		lines.push(
			`- ${lane.lane}: decision=${lane.decision} generated=${lane.generatedCandidates} objectiveDelta=${lane.objectiveDelta ?? "n/a"} hits1Delta=${lane.hits1Delta ?? "n/a"} avgDelta=${lane.avgLatencyDelta ?? "n/a"}`,
		);
	}
	lines.push("");
	fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
	return { jsonPath, mdPath };
}

async function main() {
	const args = parseArgs(process.argv);
	const outputDir = buildOrchestratorDir(args.runLabel);
	fs.mkdirSync(outputDir, { recursive: true });

	const manifests = args.lanes.map((lane) => {
		const manifest = generateLaneCandidateManifest({
			lane,
			parameterFile: args.parameterFile || undefined,
			maxCandidates: args.maxCandidates,
		});
		writeLaneCandidateManifest(manifest, buildLaneCandidateFile(lane));
		return manifest;
	});

	let laneRuns = [];
	if (!args.generateOnly) {
		if (args.dryRun) {
			laneRuns = manifests.map((manifest) =>
				NON_PARAMETER_LANES.has(manifest.lane)
					? {
							lane: manifest.lane,
							code: 0,
							decision: "manual",
							reason: "non-parameter lane is generation/report only",
							stdout: "",
							stderr: "",
						}
					: {
							lane: manifest.lane,
							code: 0,
							decision: "dry-run",
							reason: "orchestrator dry-run skipped child lane execution",
							stdout: "",
							stderr: "",
						},
			);
		} else {
			laneRuns = [];
			for (const manifest of manifests) {
				if (NON_PARAMETER_LANES.has(manifest.lane)) {
					continue;
				}
				try {
					laneRuns.push(
						await spawnLaneRun({
							lane: manifest.lane,
							parallelWorkers: args.parallelWorkers,
							revalidateTopK: args.revalidateTopK,
							dryRun: false,
							autoCommit: false,
							cleanupTempResources: args.cleanupTempResources,
						}),
					);
				} catch (error) {
					laneRuns.push({
						lane: manifest.lane,
						code: -1,
						decision: "blocked",
						reason: error?.message ?? String(error),
						stdout: "",
						stderr: "",
					});
				}
			}
			for (const manifest of manifests) {
				if (!NON_PARAMETER_LANES.has(manifest.lane)) {
					continue;
				}
				laneRuns.push({
					lane: manifest.lane,
					code: 0,
					decision: "manual",
					reason: "non-parameter lane is generation/report only",
					stdout: "",
					stderr: "",
				});
			}
		}
	}

	const laneArtifacts = manifests.map((manifest) => {
		const runResult = laneRuns.find((entry) => entry.lane === manifest.lane) ?? null;
		const record =
			args.dryRun || args.generateOnly
				? null
				: readLastJsonlRecord(buildLaneResultsJsonl(manifest.lane));
		return {
			manifest,
			runResult,
			record,
		};
	});

	let committedLane = null;
	if (!args.dryRun && !args.generateOnly && args.autoCommitWinner) {
		const winner = pickWinningLane(laneArtifacts);
		if (winner) {
			const rerunResult = await spawnLaneRun({
				lane: winner.manifest.lane,
				parallelWorkers: args.parallelWorkers,
				revalidateTopK: args.revalidateTopK,
				dryRun: false,
				autoCommit: true,
				cleanupTempResources: args.cleanupTempResources,
			});
			winner.runResult = rerunResult;
			winner.record = readLastJsonlRecord(
				buildLaneResultsJsonl(winner.manifest.lane),
			);
			committedLane = winner.manifest.lane;
		}
	}

	const laneResults = laneArtifacts.map(({ manifest, runResult, record }) =>
		buildLaneSummary(manifest.lane, manifest, runResult, record),
	);

	const summary = {
		time: new Date().toISOString(),
		label: args.runLabel,
		dryRun: args.dryRun,
		generateOnly: args.generateOnly,
		lanes: manifests.map((manifest) => manifest.lane),
		execution: "serial",
		parallelWorkers: `${args.parallelWorkers} (compat-only)`,
		revalidateTopK: args.revalidateTopK,
		laneConcurrency: `${args.laneConcurrency} (compat-only)`,
		autoCommitWinner: args.autoCommitWinner,
		cleanupTempResources: args.cleanupTempResources,
		committedLane,
		laneResults,
	};
	const files = writeSummaryFiles(outputDir, summary);
	console.log(
		JSON.stringify(
			{
				outputDir,
				...files,
				lanes: summary.lanes,
			},
			null,
			2,
		),
	);
}

await main();
