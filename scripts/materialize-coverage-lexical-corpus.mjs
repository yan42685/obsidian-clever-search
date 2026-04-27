import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function parseOutputArg(argv) {
	for (const arg of argv) {
		if (!arg.startsWith("--output=")) {
			continue;
		}
		const rawValue = arg.slice("--output=".length).trim();
		if (rawValue.length === 0) {
			throw new Error("Expected a non-empty value for --output");
		}
		return path.resolve(repoRoot, rawValue);
	}
	return path.join(
		repoRoot,
		".codex-bench",
		"corpora",
		"coverage-lexical-v3-automation-corpus",
	);
}

const outputRoot = parseOutputArg(process.argv.slice(2));
const jestBin = path.join(repoRoot, "node_modules", "jest", "bin", "jest.js");
const exportTestPath = path.join(
	"tests",
	"src",
	"services",
	"search",
	"coverage-lexical-automation-corpus-export.test.ts",
);

const result = spawnSync(
	process.execPath,
	[
		jestBin,
		"--config",
		"jest.config.js",
		"--runInBand",
		"--runTestsByPath",
		exportTestPath,
	],
	{
		cwd: repoRoot,
		stdio: "inherit",
		env: {
			...process.env,
			COVERAGE_LEXICAL_EXPORT_ROOT: outputRoot,
		},
	},
);

if (result.status !== 0) {
	throw new Error(
		`materializing coverage lexical corpus failed with exit code ${result.status ?? "unknown"}`,
	);
}

console.log(
	`[materialize-coverage-lexical-corpus] ready at ${path.relative(repoRoot, outputRoot).replaceAll("\\", "/")}`,
);
