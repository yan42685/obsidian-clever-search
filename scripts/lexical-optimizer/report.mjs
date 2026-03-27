import fs from "fs";
import path from "path";
import {
	DEFAULT_LATEST_REPORT,
	DEFAULT_RESULTS_JSONL,
} from "./config.mjs";

function ensureParentDir(filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function formatDelta(delta) {
	const sign = delta >= 0 ? "+" : "";
	return `${sign}${delta.toFixed(4)}`;
}

export function appendJsonl(record, outputFile = DEFAULT_RESULTS_JSONL) {
	ensureParentDir(outputFile);
	fs.appendFileSync(outputFile, `${JSON.stringify(record)}\n`, "utf8");
}

export function writeLatestReport(record, outputFile = DEFAULT_LATEST_REPORT) {
	ensureParentDir(outputFile);
	const baseline = record.baseline?.backend ?? null;
	const candidate = record.candidate?.backend ?? null;

	const lines = [
		"# Lexical Optimizer Report",
		"",
		`- time: ${record.time}`,
		`- mode: ${record.mode}`,
		`- lane: ${record.lane ?? "default"}`,
		`- label: ${record.label}`,
		`- decision: ${record.decision}`,
		`- reason: ${record.reason}`,
		"",
		"## Baseline",
		"",
		baseline
			? `- objective=${baseline.objective.toFixed(4)} hits1=${baseline.hits1.toFixed(4)} hits3=${baseline.hits3.toFixed(4)} hits5=${baseline.hits5.toFixed(4)} avg=${baseline.avgLatencyMs.toFixed(3)}ms p100=${baseline.p100LatencyMs.toFixed(3)}ms size=${baseline.persistedIndexBytes}B`
			: "- unavailable",
		"",
		"## Candidate",
		"",
		candidate
			? `- objective=${candidate.objective.toFixed(4)} hits1=${candidate.hits1.toFixed(4)} hits3=${candidate.hits3.toFixed(4)} hits5=${candidate.hits5.toFixed(4)} avg=${candidate.avgLatencyMs.toFixed(3)}ms p100=${candidate.p100LatencyMs.toFixed(3)}ms size=${candidate.persistedIndexBytes}B`
			: "- unavailable",
		"",
	];

	if (record.candidateMeta) {
		lines.push("## Candidate Meta", "");
		lines.push(`- ${JSON.stringify(record.candidateMeta)}`);
		lines.push("");
	}

	if (baseline && candidate) {
		lines.push("## Delta", "");
		lines.push(`- objective=${formatDelta(candidate.objective - baseline.objective)}`);
		lines.push(`- hits1=${formatDelta(candidate.hits1 - baseline.hits1)}`);
		lines.push(`- hits3=${formatDelta(candidate.hits3 - baseline.hits3)}`);
		lines.push(`- hits5=${formatDelta(candidate.hits5 - baseline.hits5)}`);
		lines.push(
			`- avgLatencyMs=${formatDelta(candidate.avgLatencyMs - baseline.avgLatencyMs)}`,
		);
		lines.push(
			`- p100LatencyMs=${formatDelta(candidate.p100LatencyMs - baseline.p100LatencyMs)}`,
		);
		lines.push(
			`- persistedIndexBytes=${candidate.persistedIndexBytes - baseline.persistedIndexBytes >= 0 ? "+" : ""}${candidate.persistedIndexBytes - baseline.persistedIndexBytes}`,
		);
		lines.push("");
	}

	if (record.notes?.length) {
		lines.push("## Notes", "");
		for (const note of record.notes) {
			lines.push(`- ${note}`);
		}
		lines.push("");
	}

	if (record.recommendedCommands?.length) {
		lines.push("## Recommended Commands", "");
		for (const command of record.recommendedCommands) {
			lines.push(`- \`${command}\``);
		}
		lines.push("");
	}

	fs.writeFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}
