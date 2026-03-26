import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = process.cwd();
const corpusRoot = path.join(
	repoRoot,
	".codex-bench",
	"corpora",
	"big-vault-mixed-v1",
);
const manifestPath = path.join(corpusRoot, "manifest.json");
const preloadBudgetsMb = [2, 4, 8, 16, 32, 64];

function percentile(sorted, ratio) {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function buildStats(label, samples, totalChars) {
	const sorted = [...samples].sort((left, right) => left - right);
	const avg = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
	return {
		label,
		iterations: samples.length,
		avgMs: Number(avg.toFixed(3)),
		p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
		p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
		totalChars,
	};
}

function formatBytes(bytes) {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function printSection(title, value) {
	console.log(`\n[benchmark-big-vault-read] ${title}`);
	console.log(JSON.stringify(value, null, 2));
}

function loadManifest() {
	if (!fs.existsSync(manifestPath)) {
		throw new Error(
			`Corpus manifest not found at ${manifestPath}. Run: node scripts/sync-big-vault-corpus.mjs`,
		);
	}
	return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

async function readAll(filePaths) {
	let totalChars = 0;
	for (const filePath of filePaths) {
		totalChars += (await fs.promises.readFile(filePath, "utf8")).length;
	}
	return totalChars;
}

function readAllFromMemory(cache, filePaths) {
	let totalChars = 0;
	for (const filePath of filePaths) {
		totalChars += cache.get(filePath)?.length ?? 0;
	}
	return totalChars;
}

function buildBudgetSummary(files) {
	const sorted = [...files].sort((left, right) => right.bytes - left.bytes);
	const totalBytes = sorted.reduce((sum, file) => sum + file.bytes, 0);
	return preloadBudgetsMb.map((budgetMb) => {
		const budgetBytes = budgetMb * 1024 * 1024;
		let cachedBytes = 0;
		let fileCount = 0;
		for (const file of sorted) {
			if (fileCount > 0 && cachedBytes + file.bytes > budgetBytes) {
				break;
			}
			cachedBytes += file.bytes;
			fileCount += 1;
		}
		return {
			preloadBudget: `${budgetMb} MB`,
			fileCount,
			cachedBytes: formatBytes(cachedBytes),
			coverage: `${((cachedBytes / Math.max(1, totalBytes)) * 100).toFixed(1)}%`,
		};
	});
}

async function main() {
	const manifest = loadManifest();
	const files = manifest.files.map((file) => ({
		...file,
		absolutePath: path.join(corpusRoot, file.path),
	}));
	const filePaths = files.map((file) => file.absolutePath);

	const firstStartedAt = performance.now();
	const firstPassChars = await readAll(filePaths);
	const firstPassMs = performance.now() - firstStartedAt;

	const warmSamples = [];
	let warmChars = 0;
	for (let index = 0; index < 4; index += 1) {
		const startedAt = performance.now();
		warmChars = await readAll(filePaths);
		warmSamples.push(performance.now() - startedAt);
	}

	const memoryCache = new Map();
	for (const filePath of filePaths) {
		memoryCache.set(filePath, await fs.promises.readFile(filePath, "utf8"));
	}
	const memorySamples = [];
	let memoryChars = 0;
	for (let index = 0; index < 200; index += 1) {
		const startedAt = performance.now();
		memoryChars = readAllFromMemory(memoryCache, filePaths);
		memorySamples.push(performance.now() - startedAt);
	}

	const rows = [
		{
			label: "fs.readFile (first pass)",
			iterations: 1,
			avgMs: Number(firstPassMs.toFixed(3)),
			p50Ms: Number(firstPassMs.toFixed(3)),
			p95Ms: Number(firstPassMs.toFixed(3)),
			totalChars: firstPassChars,
		},
		buildStats("fs.readFile (warm)", warmSamples, warmChars),
		buildStats("Map.get (memory)", memorySamples, memoryChars),
	];

	printSection("corpus summary", {
		fileCount: manifest.fileCount,
		totalBytes: formatBytes(manifest.totalBytes),
		totalMiB: manifest.totalMiB,
		root: corpusRoot,
	});
	printSection("read timings", rows);
	printSection("preload budget coverage", buildBudgetSummary(files));
	printSection(
		"largest files",
		[...files]
			.sort((left, right) => right.bytes - left.bytes)
			.slice(0, 12)
			.map((file) => ({
				path: file.path,
				size: formatBytes(file.bytes),
			})),
	);
}

main().catch((error) => {
	console.error("[benchmark-big-vault-read] failed", error);
	process.exitCode = 1;
});
