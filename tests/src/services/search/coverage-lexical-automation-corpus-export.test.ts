import fs from "node:fs";
import path from "node:path";

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

type BenchmarkSuite = "core" | "coverage_invariants" | "adversarial" | "messy_pkm";
type QueryType =
	| "coverage_guardrail"
	| "quality_guardrail"
	| "tail_guardrail"
	| "locality_guardrail"
	| "title_exact"
	| "title_prefix"
	| "content_dense"
	| "prefix_metadata"
	| "prefix_body"
	| "body_path_anchor"
	| "body_title_anchor"
	| "duplicate_conflict"
	| "mixed_anchor"
	| "template_collision"
	| "mixed_script_anchor"
	| "zh_short_identity"
	| "zh_short_body_vs_basename"
	| "ambiguous_intent"
	| "partial_memory";

type QueryCase = {
	query: string;
	relevantPath: string;
	type: QueryType;
	suite: BenchmarkSuite;
};

const originalDescribe = global.describe;
(global as typeof global & { describe: typeof describe }).describe = ((_: string, __: () => void) =>
	undefined) as typeof describe;
const fixtureModule = require("./coverage-lexical-legacy-automation-benchmark.bench") as {
	createAutomationCorpus(): {
		documents: IndexedDocument[];
		queryCases: QueryCase[];
	};
};
(global as typeof global & { describe: typeof describe }).describe = originalDescribe;

function ensureWithinRepo(repoRoot: string, targetPath: string): void {
	const resolvedRepoRoot = path.resolve(repoRoot);
	const resolvedTargetPath = path.resolve(targetPath);
	if (
		resolvedTargetPath !== resolvedRepoRoot &&
		!resolvedTargetPath.startsWith(`${resolvedRepoRoot}${path.sep}`)
	) {
		throw new Error(`Refusing to write outside repo root: ${resolvedTargetPath}`);
	}
}

function yamlScalar(value: string): string {
	return JSON.stringify(value);
}

function buildMarkdownDocument(document: IndexedDocument): string {
	const lines = [
		"---",
		`benchmark_path: ${yamlScalar(document.path)}`,
		`benchmark_basename: ${yamlScalar(document.basename)}`,
		`benchmark_folder: ${yamlScalar(document.folder)}`,
		`benchmark_headings: ${yamlScalar(document.headings ?? "")}`,
		`benchmark_aliases: ${yamlScalar(document.aliases ?? "")}`,
		`benchmark_tags: ${yamlScalar(document.tags ?? "")}`,
		"---",
		"",
		`# ${document.basename}`,
	];
	if ((document.headings ?? "").trim().length > 0) {
		lines.push("", `## ${document.headings?.trim()}`);
	}
	if ((document.content ?? "").trim().length > 0) {
		lines.push("", document.content?.trim() ?? "");
	}
	lines.push("");
	return lines.join("\n");
}

describe("coverage lexical automation corpus export", () => {
	test("materializes the benchmark corpus for reproducible local runs", () => {
		const repoRoot = process.cwd();
		const defaultOutputRoot = path.join(
			repoRoot,
			".codex-bench",
			"corpora",
			"coverage-lexical-automation-v1",
		);
		const outputRoot = path.resolve(
			process.env.COVERAGE_LEXICAL_EXPORT_ROOT ?? defaultOutputRoot,
		);
		const vaultRoot = path.join(outputRoot, "vault");
		const documentsPath = path.join(outputRoot, "documents.json");
		const queryCasesPath = path.join(outputRoot, "query-cases.json");
		const manifestPath = path.join(outputRoot, "manifest.json");
		const { documents, queryCases } = fixtureModule.createAutomationCorpus();

		ensureWithinRepo(repoRoot, outputRoot);
		fs.rmSync(outputRoot, { recursive: true, force: true });
		fs.mkdirSync(vaultRoot, { recursive: true });

		for (const document of documents) {
			const notePath = path.join(vaultRoot, ...document.path.split("/"));
			ensureWithinRepo(repoRoot, notePath);
			fs.mkdirSync(path.dirname(notePath), { recursive: true });
			fs.writeFileSync(notePath, buildMarkdownDocument(document), "utf8");
		}
		for (const queryCase of queryCases) {
			const notePath = path.join(vaultRoot, ...queryCase.relevantPath.split("/"));
			expect(fs.existsSync(notePath)).toBe(true);
		}

		const manifest = {
			name: "coverage-lexical-automation-v1",
			description:
				"Materialized synthetic corpus used by coverage-lexical-automation-benchmark.",
			generatedAt: new Date().toISOString(),
			sourceModule:
				"tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts#createAutomationCorpus",
			outputRoot: path.relative(repoRoot, outputRoot).replaceAll("\\", "/"),
			layout: {
				vaultRoot: "vault",
				documentsJson: "documents.json",
				queryCasesJson: "query-cases.json",
				manifestJson: "manifest.json",
			},
			documentCount: documents.length,
			queryCount: queryCases.length,
			suites: queryCases.reduce<Record<BenchmarkSuite, number>>(
				(acc, queryCase) => {
					acc[queryCase.suite] += 1;
					return acc;
				},
				{
					core: 0,
					coverage_invariants: 0,
					adversarial: 0,
					messy_pkm: 0,
				},
			),
			queryTypes: queryCases.reduce<Record<QueryType, number>>(
				(acc, queryCase) => {
					acc[queryCase.type] += 1;
					return acc;
				},
				{
					coverage_guardrail: 0,
					quality_guardrail: 0,
					tail_guardrail: 0,
					locality_guardrail: 0,
					title_exact: 0,
					title_prefix: 0,
					content_dense: 0,
					prefix_metadata: 0,
					prefix_body: 0,
					body_path_anchor: 0,
					body_title_anchor: 0,
					duplicate_conflict: 0,
					mixed_anchor: 0,
					template_collision: 0,
					mixed_script_anchor: 0,
					zh_short_identity: 0,
					zh_short_body_vs_basename: 0,
					ambiguous_intent: 0,
					partial_memory: 0,
				},
			),
		};

		fs.writeFileSync(documentsPath, JSON.stringify(documents, null, 2), "utf8");
		fs.writeFileSync(queryCasesPath, JSON.stringify(queryCases, null, 2), "utf8");
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

		expect(fs.existsSync(manifestPath)).toBe(true);
		expect(fs.existsSync(documentsPath)).toBe(true);
		expect(fs.existsSync(queryCasesPath)).toBe(true);
		expect(documents.length).toBeGreaterThanOrEqual(70);
		expect(queryCases.length).toBeGreaterThanOrEqual(145);
	});
});
