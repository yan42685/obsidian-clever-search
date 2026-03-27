import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
	extractCurrentTuningProfile,
	patchTuningValues,
} from "./lexical-optimizer/search-space.mjs";

const DEFAULT_SOURCE_FILE = path.resolve(
	process.cwd(),
	"src/services/search/passage-lexical/passage-lexical-ranker.ts",
);
const DEFAULT_HISTORY_FILE = path.resolve(
	process.cwd(),
	".codex-bench/passage-lexical-ranker-autotune-history.json",
);
const DEFAULT_BENCHMARK_ARGS = [
	"node_modules/jest/bin/jest.js",
	"--config",
	"jest.file-search-web-benchmark.config.js",
	"--runInBand",
];
const DEFAULT_MUTATION_FACTORS = [0.88, 0.94, 1.06, 1.12];
const DEFAULT_MUTATION_COUNTS = [1, 1, 1, 2];
const FLOAT_PRECISION = 6;

const DEFAULT_TUNABLES = [
	{ name: "targetTokens", min: 72, max: 192 },
	{ name: "minTokens", min: 32, max: 96 },
	{ name: "overlapTokens", min: 16, max: 96 },
	{ name: "fileMetadataPrior", min: 0.12, max: 0.45 },
	{ name: "fileCoverageBonus", min: 0.8, max: 1.5 },
	{ name: "fileMetadataAnchorBlend", min: 0.45, max: 1.2 },
	{ name: "fileMixedQueryBodyMetadataBonus", min: 0.35, max: 1.1 },
	{ name: "passageLocalityCoverageWeight", min: 0.25, max: 0.9 },
	{ name: "passageLocalityOrderWeight", min: 0.15, max: 0.75 },
	{ name: "passageLocalityCompactnessWeight", min: 0.3, max: 1.2 },
	{ name: "passageLocalityTightWindowBonus", min: 0.1, max: 0.6 },
	{ name: "verifierCoverageWeight", min: 0.5, max: 1.4 },
	{ name: "verifierOrderWeight", min: 0.35, max: 1.2 },
	{ name: "verifierCompactnessWeight", min: 0.55, max: 1.7 },
	{ name: "verifierExactPhraseBonus", min: 1.2, max: 3.2 },
	{ name: "verifierTightWindowBonus", min: 0.2, max: 0.9 },
	{ name: "verifierLocalWindowWeight", min: 0.35, max: 1.15 },
	{ name: "passageLocalityLocalWindowWeight", min: 0.15, max: 0.75 },
	{ name: "localWindowCoverageWeight", min: 0.75, max: 1.6 },
	{ name: "localWindowAnchorWeight", min: 0.2, max: 0.9 },
	{ name: "localWindowCompactnessWeight", min: 0.45, max: 1.4 },
	{ name: "localWindowOrderWeight", min: 0.1, max: 0.7 },
	{ name: "prefixFamilyVerifierCoverageBonus", min: 0.1, max: 0.9 },
	{ name: "prefixFamilyLocalityCoverageBonus", min: 0.08, max: 0.6 },
	{ name: "prefixFamilyOrderScale", min: 0.18, max: 0.85 },
];

function parseArgs(argv) {
	const args = {
		sourceFile: DEFAULT_SOURCE_FILE,
		historyFile: DEFAULT_HISTORY_FILE,
		rounds: 0,
		neighbors: 6,
		seed: 42,
		applyBest: false,
		speedTolerance: 1.35,
		sizeTolerance: 1.03,
		benchmarkArgs: DEFAULT_BENCHMARK_ARGS,
	};
	for (const arg of argv.slice(2)) {
		if (arg.startsWith("--source=")) {
			args.sourceFile = path.resolve(arg.slice("--source=".length));
		} else if (arg.startsWith("--history=")) {
			args.historyFile = path.resolve(arg.slice("--history=".length));
		} else if (arg.startsWith("--rounds=")) {
			args.rounds = Number(arg.slice("--rounds=".length)) || 0;
		} else if (arg.startsWith("--neighbors=")) {
			args.neighbors = Number(arg.slice("--neighbors=".length)) || 1;
		} else if (arg.startsWith("--seed=")) {
			args.seed = Number(arg.slice("--seed=".length)) || 42;
		} else if (arg === "--apply-best") {
			args.applyBest = true;
		} else if (arg.startsWith("--speed-tolerance=")) {
			args.speedTolerance = Number(arg.slice("--speed-tolerance=".length)) || 1.35;
		} else if (arg.startsWith("--size-tolerance=")) {
			args.sizeTolerance = Number(arg.slice("--size-tolerance=".length)) || 1.03;
		}
	}
	return args;
}

function mulberry32(seed) {
	return function next() {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function roundValue(value) {
	return Number(value.toFixed(FLOAT_PRECISION));
}

function readCurrentConstants(sourceText, tunables) {
	const profile = extractCurrentTuningProfile(sourceText);
	const values = {};
	for (const tunable of tunables) {
		if (!(tunable.name in profile)) {
			throw new Error(`Unable to find property ${tunable.name} in source file`);
		}
		values[tunable.name] = Number(profile[tunable.name]);
	}
	return values;
}

function applyConstantsToSource(sourceText, values) {
	return patchTuningValues(sourceText, {
		label: "autotune-candidate",
		values: Object.fromEntries(
			Object.entries(values).map(([name, value]) => [name, roundValue(value)]),
		),
	});
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
	let isEscaped = false;
	for (let index = jsonStart; index < output.length; index++) {
		const char = output[index];
		if (inString) {
			if (isEscaped) {
				isEscaped = false;
			} else if (char === "\\") {
				isEscaped = true;
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

function runBenchmark(benchmarkArgs) {
	const result =
		process.platform === "win32"
			? spawnSync(
					"powershell.exe",
					[
						"-NoProfile",
						"-Command",
						[
							`& '${process.execPath.replace(/'/g, "''")}'`,
							...benchmarkArgs.map((arg) =>
								`'${String(arg).replace(/'/g, "''")}'`,
							),
						].join(" "),
					],
					{
						cwd: process.cwd(),
						encoding: "utf8",
						maxBuffer: 1024 * 1024 * 32,
					},
				)
			: spawnSync(process.execPath, benchmarkArgs, {
					cwd: process.cwd(),
					encoding: "utf8",
					maxBuffer: 1024 * 1024 * 32,
				});
	if (result.error) {
		if (result.error.code === "EPERM") {
			throw new Error(
				[
					"Benchmark subprocess launch was blocked by the current sandbox.",
					"Run this script in a normal local terminal instead of the Codex sandbox.",
					`originalError=${result.error.message}`,
				].join(" "),
			);
		}
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			[
				"Benchmark command failed",
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
	const mini = summary.find((entry) => entry.name === "MiniSearch");
	const custom = summary.find((entry) => entry.name === "CustomBM25");
	const passage = summary.find((entry) => entry.name === "PassageBM25");
	if (!mini || !custom || !passage) {
		throw new Error("Benchmark summary did not include all three lexical backends");
	}
	return { mini, custom, passage };
}

function computeCandidateScore(passage, baseline, args) {
	const top1Gain = passage.top1 - baseline.top1;
	const top5Gain = passage.top5 - baseline.top5;
	const mrrGain = passage.mrr - baseline.mrr;
	const zeroRateGain = baseline.zeroRate - passage.zeroRate;
	const avgSpeedRatio =
		passage.avgMsPerQuery / Math.max(0.000001, baseline.avgMsPerQuery);
	const tailSpeedRatio = passage.p100Ms / Math.max(0.000001, baseline.p100Ms);
	const sizeRatio = passage.estimatedIndexKB / Math.max(0.000001, baseline.estimatedIndexKB);
	const tailPenalty =
		tailSpeedRatio > args.speedTolerance
			? (tailSpeedRatio - args.speedTolerance) * 0.7
			: Math.max(0, tailSpeedRatio - 1) * 0.08;
	const avgPenalty =
		avgSpeedRatio > args.speedTolerance
			? (avgSpeedRatio - args.speedTolerance) * 0.3
			: Math.max(0, avgSpeedRatio - 1) * 0.03;
	const sizePenalty =
		sizeRatio > args.sizeTolerance
			? (sizeRatio - args.sizeTolerance) * 0.75
			: Math.max(0, sizeRatio - 1) * 0.12;
	return (
		top1Gain * 1500 +
		mrrGain * 240 +
		top5Gain * 70 +
		zeroRateGain * 180 -
		tailPenalty * 100 -
		avgPenalty * 100 -
		sizePenalty * 100
	);
}

function summarizeDelta(passage, baseline) {
	return {
		top1: roundValue(passage.top1 - baseline.top1),
		top5: roundValue(passage.top5 - baseline.top5),
		mrr: roundValue(passage.mrr - baseline.mrr),
		zeroRate: roundValue(passage.zeroRate - baseline.zeroRate),
		avgMsPerQuery: roundValue(passage.avgMsPerQuery - baseline.avgMsPerQuery),
		estimatedIndexKB: roundValue(
			passage.estimatedIndexKB - baseline.estimatedIndexKB,
		),
	};
}

function cloneValues(values) {
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value]));
}

function pickMutationCount(random) {
	return DEFAULT_MUTATION_COUNTS[Math.floor(random() * DEFAULT_MUTATION_COUNTS.length)];
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function generateCandidate(bestValues, tunables, triedKeys, random) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const candidate = cloneValues(bestValues);
		const used = new Set();
		const mutationCount = pickMutationCount(random);
		for (let mutationIndex = 0; mutationIndex < mutationCount; mutationIndex++) {
			let tunable = null;
			for (let pickAttempt = 0; pickAttempt < 50; pickAttempt++) {
				const next = tunables[Math.floor(random() * tunables.length)];
				if (!used.has(next.name)) {
					tunable = next;
					used.add(next.name);
					break;
				}
			}
			if (!tunable) {
				break;
			}
			const factor =
				DEFAULT_MUTATION_FACTORS[
					Math.floor(random() * DEFAULT_MUTATION_FACTORS.length)
				];
			const direction = random() < 0.5 ? factor : 1 / factor;
			candidate[tunable.name] = roundValue(
				clamp(candidate[tunable.name] * direction, tunable.min, tunable.max),
			);
		}
		const key = JSON.stringify(candidate);
		if (!triedKeys.has(key)) {
			triedKeys.add(key);
			return candidate;
		}
	}
	return null;
}

function ensureParentDir(filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildSensitivityReport(history, baselinePassage) {
	const byName = new Map();
	for (const entry of history) {
		if (!Array.isArray(entry.changed)) {
			continue;
		}
		for (const name of entry.changed) {
			const bucket = byName.get(name) ?? {
				trials: 0,
				absTop1Delta: 0,
				absMrrDelta: 0,
				avgScore: 0,
			};
			bucket.trials += 1;
			bucket.absTop1Delta += Math.abs(entry.passage.top1 - baselinePassage.top1);
			bucket.absMrrDelta += Math.abs(entry.passage.mrr - baselinePassage.mrr);
			bucket.avgScore += entry.score;
			byName.set(name, bucket);
		}
	}
	return Array.from(byName.entries())
		.map(([name, bucket]) => ({
			name,
			trials: bucket.trials,
			avgAbsTop1Delta: roundValue(bucket.absTop1Delta / bucket.trials),
			avgAbsMrrDelta: roundValue(bucket.absMrrDelta / bucket.trials),
			avgScore: roundValue(bucket.avgScore / bucket.trials),
		}))
		.sort((left, right) => right.avgAbsTop1Delta - left.avgAbsTop1Delta);
}

function printPassageSummary(label, passage) {
	console.log(
		`${label}: top1=${passage.top1.toFixed(3)} top5=${passage.top5.toFixed(3)} mrr=${passage.mrr.toFixed(3)} zero=${passage.zeroRate.toFixed(3)} avgMs=${passage.avgMsPerQuery.toFixed(3)} indexKB=${passage.estimatedIndexKB.toFixed(3)}`,
	);
}

async function main() {
	const args = parseArgs(process.argv);
	const originalSource = fs.readFileSync(args.sourceFile, "utf8");
	const tunables = DEFAULT_TUNABLES;
	const baselineValues = readCurrentConstants(originalSource, tunables);
	const triedKeys = new Set([JSON.stringify(baselineValues)]);
	const random = mulberry32(args.seed);

	console.log("Passage Lexical Ranker Autotune");
	console.log("=====================");
	console.log(`source=${args.sourceFile}`);
	console.log(`rounds=${args.rounds}, neighbors=${args.neighbors}, seed=${args.seed}`);
	console.log(
		`speedTolerance=${args.speedTolerance}, sizeTolerance=${args.sizeTolerance}, applyBest=${args.applyBest}`,
	);

	let bestValues = cloneValues(baselineValues);
	let baselineRun;
	try {
		baselineRun = runBenchmark(args.benchmarkArgs);
	} finally {
		fs.writeFileSync(args.sourceFile, originalSource, "utf8");
	}
	const baselinePassage = baselineRun.passage;
	printPassageSummary("baseline", baselinePassage);

	const history = [];
	let bestPassage = baselinePassage;
	let bestScore = 0;

	for (let round = 0; round < args.rounds; round++) {
		console.log(`\nround ${round + 1}/${args.rounds}`);
		let roundBest = null;
		for (let neighborIndex = 0; neighborIndex < args.neighbors; neighborIndex++) {
			const candidateValues = generateCandidate(
				bestValues,
				tunables,
				triedKeys,
				random,
			);
			if (!candidateValues) {
				console.log("no more unique candidates in current search space");
				break;
			}
			const changed = Object.keys(candidateValues).filter(
				(name) => candidateValues[name] !== bestValues[name],
			);
			const patchedSource = applyConstantsToSource(originalSource, candidateValues);
			fs.writeFileSync(args.sourceFile, patchedSource, "utf8");
			let benchmarkRun;
			try {
				benchmarkRun = runBenchmark(args.benchmarkArgs);
			} finally {
				fs.writeFileSync(args.sourceFile, originalSource, "utf8");
			}
			const score = computeCandidateScore(
				benchmarkRun.passage,
				baselinePassage,
				args,
			);
			const record = {
				round: round + 1,
				neighbor: neighborIndex + 1,
				changed,
				values: candidateValues,
				score: roundValue(score),
				passage: benchmarkRun.passage,
				delta: summarizeDelta(benchmarkRun.passage, baselinePassage),
			};
			history.push(record);
			const verdict =
				score > bestScore + 0.01 ||
				(benchmarkRun.passage.top1 > bestPassage.top1 &&
					benchmarkRun.passage.avgMsPerQuery <=
						baselinePassage.avgMsPerQuery * args.speedTolerance &&
					benchmarkRun.passage.estimatedIndexKB <=
						baselinePassage.estimatedIndexKB * args.sizeTolerance)
					? "accept"
					: "reject";
			console.log(
				`${verdict.padEnd(6)} score=${record.score.toFixed(3).padStart(8)} top1=${benchmarkRun.passage.top1.toFixed(3)} mrr=${benchmarkRun.passage.mrr.toFixed(3)} avgMs=${benchmarkRun.passage.avgMsPerQuery.toFixed(3)} deltaTop1=${record.delta.top1 >= 0 ? "+" : ""}${record.delta.top1.toFixed(3)} changed=${changed.join(",")}`,
			);
			if (
				!roundBest ||
				score > roundBest.score ||
				(score === roundBest.score &&
					benchmarkRun.passage.top1 > roundBest.passage.top1)
			) {
				roundBest = record;
			}
			if (verdict === "accept") {
				bestValues = candidateValues;
				bestPassage = benchmarkRun.passage;
				bestScore = score;
			}
		}
		if (roundBest) {
			console.log(
				`round-best: score=${roundBest.score.toFixed(3)} top1=${roundBest.passage.top1.toFixed(3)} avgMs=${roundBest.passage.avgMsPerQuery.toFixed(3)}`,
			);
		}
	}

	const bestSource = applyConstantsToSource(originalSource, bestValues);
	if (args.applyBest) {
		fs.writeFileSync(args.sourceFile, bestSource, "utf8");
	} else {
		fs.writeFileSync(args.sourceFile, originalSource, "utf8");
	}

	const output = {
		timestamp: new Date().toISOString(),
		sourceFile: args.sourceFile,
		rounds: args.rounds,
		neighbors: args.neighbors,
		seed: args.seed,
		speedTolerance: args.speedTolerance,
		sizeTolerance: args.sizeTolerance,
		appliedBest: args.applyBest,
		baselineValues,
		bestValues,
		baseline: baselineRun,
		best: {
			passage: bestPassage,
			score: roundValue(bestScore),
			delta: summarizeDelta(bestPassage, baselinePassage),
		},
		history,
		sensitivity: buildSensitivityReport(history, baselinePassage),
	};
	ensureParentDir(args.historyFile);
	fs.writeFileSync(args.historyFile, JSON.stringify(output, null, 2), "utf8");

	console.log("\nfinal");
	printPassageSummary("best", bestPassage);
	console.log(
		`best-score=${roundValue(bestScore).toFixed(3)} appliedBest=${args.applyBest} history=${args.historyFile}`,
	);
	if (output.sensitivity.length > 0) {
		console.log("top-sensitive constants:");
		for (const row of output.sensitivity.slice(0, 8)) {
			console.log(
				`  ${row.name}: trials=${row.trials} avgAbsTop1Delta=${row.avgAbsTop1Delta.toFixed(3)} avgAbsMrrDelta=${row.avgAbsMrrDelta.toFixed(3)}`,
			);
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
