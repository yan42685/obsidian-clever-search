import fs from "fs";
import path from "path";
import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

function createMockTokenizer(): MockTokenizer {
	return {
		tokenize(text: string): string[] {
			return text
				.toLowerCase()
				.split(/[^a-z0-9]+/g)
				.map((term) => term.trim())
				.filter((term) => term.length > 0);
		},
		tokenizeSequence(text: string): string[] {
			return text
				.toLowerCase()
				.split(/[^a-z0-9]+/g)
				.map((term) => term.trim())
				.filter((term) => term.length > 0);
		},
	};
}

function buildFillerParagraph(seed: number): string {
	return Array.from({ length: 24 }, (_, index) => `filler${seed}_${index}`).join(" ");
}

function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function extractHeadings(raw: string): string[] {
	return Array.from(raw.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) =>
		match[1].trim(),
	);
}

function extractTitle(raw: string, fallback: string): string {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const titleMatch = frontmatter?.[1].match(/^title:\s*(.+)$/m);
	if (titleMatch?.[1]) {
		return titleMatch[1].trim().replace(/^["']|["']$/g, "");
	}
	return extractHeadings(raw)[0] ?? fallback;
}

function loadBenchmarkDocument(relativePath: string) {
	const absolutePath = path.join(
		process.cwd(),
		"benchmarks",
		"corpora",
		"web-notes-v2",
		...relativePath.split("/"),
	);
	const raw = fs.readFileSync(absolutePath, "utf8");
	return {
		path: relativePath,
		basename: extractTitle(raw, path.basename(relativePath, path.extname(relativePath))),
		folder: path.posix.dirname(relativePath),
		headings: extractHeadings(raw).join(" "),
		content: stripFrontmatter(raw),
	};
}

describe("PassageFileSearchEngine", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	function createEngine() {
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const { PassageFileSearchEngine } = require(
			"src/services/search/passage-lexical/passage-file-search-engine",
		);

		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.fileSearchBackend = "passage-bm25";
		setting.isCaseSensitive = false;
		setting.enableChinesePatch = false;
		setting.enableStopWordsEn = false;
		setting.enableStopWordsZh = false;

		container.register(OuterSetting, { useValue: setting });
		container.register(Tokenizer, {
			useValue: createMockTokenizer(),
		});

		return new PassageFileSearchEngine() as InstanceType<
			typeof PassageFileSearchEngine
		>;
	}

	test("prefers a concentrated local passage over dispersed file-level evidence", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/dispersed.md",
				basename: "dispersed note",
				folder: "notes",
				content: [
					"alpha anchor insight",
					buildFillerParagraph(1),
					buildFillerParagraph(2),
					buildFillerParagraph(3),
					buildFillerParagraph(4),
					buildFillerParagraph(5),
					buildFillerParagraph(6),
					"beta anchor insight",
				].join("\n\n"),
			},
			{
				path: "notes/local.md",
				basename: "local note",
				folder: "notes",
				content:
					"alpha beta integration details live in one compact paragraph for passage ranking",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "alpha beta",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/local.md");
	});

	test("lets a file win with multiple decisive local explanations instead of one noisy hit", async () => {
		const engine = createEngine();
		const longGap = Array.from({ length: 6 }, (_, index) =>
			buildFillerParagraph(300 + index),
		).join("\n\n");
		await engine.addDocuments([
			{
				path: "docs/concepts/secret-rollout.md",
				basename: "secret rollout",
				folder: "docs concepts",
				content: [
					"secret stores sensitive data for pods and workloads",
					longGap,
					"after a secret update restart the pod so the new data is loaded",
					longGap,
					"mount secret data into the pod filesystem for runtime configuration",
				].join("\n\n"),
			},
			{
				path: "docs/troubleshooting/pod-restart-checklist.md",
				basename: "pod restart checklist",
				folder: "docs troubleshooting",
				content: [
					"pod restart troubleshooting notes list secret references and data paths for operators",
					"the checklist mentions restart order secret metadata and pod event history in one noisy paragraph",
					"another restart checklist keeps repeating pod and data reminders without the core secret rollout explanation",
				].join("\n\n"),
			},
			{
				path: "docs/reference/secret.md",
				basename: "secret reference",
				folder: "docs reference",
				content:
					"secret reference notes describe data keys for a pod filesystem but do not explain restart flow",
			},
		]);

		const results = (await engine.searchFiles({
			queryText: "secret data pod restart filesystem",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		})) as Array<any>;

		expect(results.length).toBeGreaterThanOrEqual(2);
		expect(results[0]?.path).toBe("docs/concepts/secret-rollout.md");
		expect(results[0]?.localExplanationCompetitionScore).toBeGreaterThan(
			results[1]?.localExplanationCompetitionScore ?? 0,
		);
	});

	test("keeps path-like metadata queries viable", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "docs/sdk/api-client.md",
				basename: "api client",
				folder: "docs sdk",
				headings: "client setup",
				content: "introduction and examples",
			},
			{
				path: "notes/content-only.md",
				basename: "notes",
				folder: "archive",
				content: "docs api client docs api client usage details",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "docs/api client",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("docs/sdk/api-client.md");
	});

	test("prefers body hits that also satisfy a path anchor", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "docs/sdk/vector-cache.md",
				basename: "vector cache",
				folder: "docs sdk",
				content:
					"vector cache eviction keeps body-first retrieval stable during interactive search",
			},
			{
				path: "notes/archive/vector-cache.md",
				basename: "vector cache",
				folder: "notes archive",
				content:
					"vector cache eviction keeps body-first retrieval stable during interactive search",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "sdk vector cache eviction",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("docs/sdk/vector-cache.md");
	});

	test("verifier prefers an exact local phrase over a loose bag-of-words match", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/exact.md",
				basename: "exact phrase",
				folder: "notes",
				content:
					"the verifier should reward a vector cache eviction phrase when the terms appear together in order",
			},
			{
				path: "notes/loose.md",
				basename: "loose phrase",
				folder: "notes",
				content:
					"cache warmup is helpful. unrelated filler sits here. vector systems sometimes discuss delayed eviction in a different clause",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "vector cache eviction",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/exact.md");
	});

	test("prefers body hits that also satisfy a title or heading anchor", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/cache-playbook.md",
				basename: "vector cache playbook",
				folder: "notes",
				headings: "eviction policy",
				content:
					"eviction policy tuning keeps vector cache latency stable during interactive retrieval",
			},
			{
				path: "notes/latency-playbook.md",
				basename: "latency playbook",
				folder: "notes",
				headings: "eviction policy",
				content:
					"eviction policy tuning keeps vector cache latency stable during interactive retrieval",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "playbook vector cache latency",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/cache-playbook.md");
	});

	test("keeps a title-anchor mixed query ahead of a stronger body-only distractor", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/link-notes.md",
				basename: "link notes",
				folder: "notes",
				headings: "create examples",
				content:
					"link notes explain how to create links between related notes and headings in one place",
			},
			{
				path: "notes/create-notes.md",
				basename: "create notes",
				folder: "notes",
				content:
					"create notes create notes create notes links between related notes and headings appear repeatedly in the body",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "create link notes",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/link-notes.md");
	});

	test("prefers a basename anchor over a heading-only anchor for mixed body queries", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/create-note.md",
				basename: "create note",
				folder: "notes",
				content:
					"text blocks are easy to edit and to reorganize when a note is still small",
			},
			{
				path: "notes/formatting-guide.md",
				basename: "formatting guide",
				folder: "notes",
				headings: "create text",
				content:
					"text blocks are easy to edit and to reorganize when a guide is still small",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "create text to",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/create-note.md");
	});

	test("prefers a real note over a template sharing the same title and headings", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/projects/incident-summary.md",
				basename: "incident summary",
				folder: "notes projects",
				headings: "symptoms root cause fix",
				content:
					"checkpoint replay pushed a stale warm-start passage into the verifier frontier and caused rerank drift during recovery",
			},
			{
				path: "notes/templates/incident-summary.md",
				basename: "incident summary",
				folder: "notes templates",
				headings: "symptoms root cause fix",
				content:
					"template text for writing an incident summary with owner review timeline and follow-up actions",
			},
		]);

		const results = (await engine.searchFiles({
			queryText: "incident summary checkpoint replay verifier frontier",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		})) as Array<any>;

		expect(results[0]?.path).toBe("notes/projects/incident-summary.md");
	});

	test("uses decisive verifier on title plus heading anchors against a template sibling", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/projects/incident-summary.md",
				basename: "incident summary",
				folder: "notes projects",
				headings: "symptoms root cause fix",
				content:
					"checkpoint replay pushed a stale warm-start passage into the verifier frontier and caused rerank drift during recovery",
			},
			{
				path: "notes/templates/incident-summary.md",
				basename: "incident summary",
				folder: "notes templates",
				headings: "symptoms root cause fix",
				content:
					"template text for writing an incident summary with owner review timeline and follow-up actions",
			},
		]);

		const results = (await engine.searchFiles({
			queryText: "incident summary symptoms checkpoint replay",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		})) as Array<any>;

		expect(results[0]?.path).toBe("notes/projects/incident-summary.md");
		expect(results[0]?.queryRouteScore).toBeGreaterThan(
			results[1]?.queryRouteScore ?? 0,
		);
	});

	test("prefers the same-title sibling with a compact local passage over dispersed evidence", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/projects/restart-window.md",
				basename: "restart window tuning",
				folder: "notes projects",
				content: [
					"configmap rollout restart window tuning avoids stale cache during a warm path recovery",
					"the same verifier budget keeps this restart window stable in production",
				].join("\n\n"),
			},
			{
				path: "notes/archive/restart-window.md",
				basename: "restart window tuning",
				folder: "notes archive",
				content: [
					"configmap defaults are documented here",
					buildFillerParagraph(7),
					buildFillerParagraph(8),
					"restart window notes were copied from an old retrospective",
					buildFillerParagraph(9),
					buildFillerParagraph(10),
					"stale cache showed up in a different incident long after the warm path test",
				].join("\n\n"),
			},
		]);

		const results = (await engine.searchFiles({
			queryText: "restart window stale cache configmap",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		})) as Array<any>;

		expect(results[0]?.path).toBe("notes/projects/restart-window.md");
		expect(results[0]?.localExplanationCompetitionScore).toBeGreaterThan(
			results[1]?.localExplanationCompetitionScore ?? 0,
		);
	});

	test("prefers decisive body evidence over a misleading metadata-style anchor", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/runbooks/restart-window.md",
				basename: "restart window guide",
				folder: "notes runbooks",
				headings: "operators",
				content:
					"operators traced the stale mount state to one compact restart window during recovery",
			},
			{
				path: "notes/notes/restart-window.md",
				basename: "restart window notes",
				folder: "notes notes",
				headings: "appendix",
				content:
					"restart window notes mention appendix reminders and copied checklist fragments without the decisive recovery explanation",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "notes restart window operators stale mount",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/runbooks/restart-window.md");
	});

	test("uses a short-title fast path for exact title-like queries", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/link-notes.md",
				basename: "create a link",
				folder: "notes",
				content: "short title lookup should stay strong even with passage-first ranking",
			},
			{
				path: "notes/link-body.md",
				basename: "search notes",
				folder: "notes",
				content:
					"create a link between related notes using body text that mentions the same words",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "create link",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/link-notes.md");
	});

	test("keeps a short basename query ahead of a heading-only exact match", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/configmap.md",
				basename: "configmap",
				folder: "notes",
				content: "the exact named note should stay first for short title lookups",
			},
			{
				path: "notes/rollout.md",
				basename: "rollout guide",
				folder: "notes",
				headings: "configmap",
				content: "rollout notes also mention configmap repeatedly in the body",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "configmap",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/configmap.md");
	});

	test("uses a short-title fast path for title prefix queries", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/configmap.md",
				basename: "configmap",
				folder: "notes",
				content: "title prefix queries should still resolve to the exact named note",
			},
			{
				path: "notes/configmaps-rollout.md",
				basename: "configmaps rollout",
				folder: "notes",
				content:
					"configmaps rollout details mention configmap behavior in the body many times",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "configm",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/configmap.md");
	});

	test("uses a metadata lane across folder and basename for path-like queries", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "docs/sdk/api-client.md",
				basename: "api client",
				folder: "docs sdk",
				content: "small metadata-oriented note",
			},
			{
				path: "notes/archive/api-client.md",
				basename: "api client",
				folder: "notes archive",
				content:
					"docs sdk api client docs sdk api client repeated in body to tempt generic sparse ranking",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "docs/sdk api client",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("docs/sdk/api-client.md");
	});

	test("keeps experimental metadata routing stable even if legacy metadata weights change", async () => {
		const { innerSetting } = require("src/globals/plugin-setting");
		const snapshot = { ...innerSetting.search };
		innerSetting.search.weightFilename = 0.05;
		innerSetting.search.weightFolder = 8;
		innerSetting.search.weightTagText = 6;
		innerSetting.search.weightHeading = 0.05;

		try {
			const engine = createEngine();
			await engine.addDocuments([
				{
					path: "docs/sdk/api-client.md",
					basename: "api client",
					folder: "docs sdk",
					content: "small metadata-oriented note",
				},
				{
					path: "notes/archive/api-client.md",
					basename: "api client",
					folder: "notes archive",
					tags: "docs sdk",
					content:
						"docs sdk api client docs sdk api client repeated in body to tempt generic sparse ranking",
				},
			]);

			const results = await engine.searchFiles({
				queryText: "docs/sdk api client",
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 10,
			});

			expect(results[0]?.path).toBe("docs/sdk/api-client.md");
		} finally {
			Object.assign(innerSetting.search, snapshot);
		}
	});

	test("routes short single-term queries to an exact basename over body frequency", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/secret.md",
				basename: "secret",
				folder: "notes",
				content: "exact note name should stay preferred for short anchor lookups",
			},
			{
				path: "notes/security-review.md",
				basename: "security review",
				folder: "notes",
				content:
					"secret handling notes mention secret rotation secret storage and secret sync across many paragraphs",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "secret",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/secret.md");
	});

	test("prefers same-script title matches for short anchor queries", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/en/configmap.md",
				basename: "configmap",
				folder: "notes en",
				content: "configmap stores configuration for pods and workloads",
			},
			{
				path: "notes/zh/configmap.md",
				basename: "configmap",
				folder: "notes zh",
				content: "配置 映射 用于 工作负载 和 集群 服务",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "configmap",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/en/configmap.md");
	});

	test("uses body corroboration to break same-basename short-anchor ties", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "docs/content/configmap.md",
				basename: "configmap",
				folder: "docs content",
				content: [
					"configmap stores non secret configuration data for pods and configmap keys can be injected into containers",
					buildFillerParagraph(20),
					"another configmap example shows configmap data mounted into a pod volume for application startup",
					buildFillerParagraph(21),
					"configmap updates can refresh pod environment values during a staged rollout",
				].join("\n\n"),
			},
			{
				path: "docs/reference/configmap.md",
				basename: "configmap",
				folder: "docs reference",
				content: "configmap definition and overview",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "configmap",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("docs/content/configmap.md");
	});

	test("prefers the richer configmap concept note over same-family stubs", async () => {
		const engine = createEngine();
		const configmapContent = fs.readFileSync(
			path.join(
				process.cwd(),
				"benchmarks",
				"corpora",
				"web-notes-v2",
				"tech-en",
				"content",
				"en",
				"docs",
				"concepts",
				"configuration",
				"configmap.md",
			),
			"utf8",
		);
		await engine.addDocuments([
			{
				path: "tech-en/content/en/docs/concepts/configuration/configmap.md",
				basename: "ConfigMaps",
				folder: "tech en content en docs concepts configuration",
				content: configmapContent,
			},
			{
				path: "core/tech-en/guides/configmaps-rollout.md",
				basename: "ConfigMaps rollout guide",
				folder: "core tech en guides",
				headings: "Restart order",
				content:
					"configmaps rollout guidance explains restart order and configmap refresh during staged deployment",
			},
			{
				path: "adversarial/tech-en/configmaps-rollout-en.md",
				basename: "ConfigMaps rollout guide",
				folder: "adversarial tech en",
				headings: "Apply order Restart checks",
				content: [
					"Keep rollout notes short.",
					"Applying namespace defaults before mounting env files avoids stale data during restart.",
					"This guide explains why ConfigMaps rollout order matters for stable recovery.",
				].join("\n\n"),
			},
			{
				path: "core/tech-en/reference/configmap.md",
				basename: "ConfigMap",
				folder: "core tech en reference",
				headings: "Definition",
				content:
					"configmap stores non-secret configuration for pods and workloads",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "configmap",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/configuration/configmap.md",
		);
	});

	test("prefers exact title plus decisive body evidence for unordered terms", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "docs/concepts/secret.md",
				basename: "secret",
				folder: "docs concepts",
				content:
					"secret stores sensitive data for workloads and secret data can be mounted into pods as files",
			},
			{
				path: "docs/guides/secrets-rotation.md",
				basename: "secrets rotation guide",
				folder: "docs guides",
				content:
					"secret rotation guide focuses on secret rollout audit checks and secret update timing",
			},
			{
				path: "docs/storage/persistent-volumes.md",
				basename: "persistent volumes",
				folder: "docs storage",
				content:
					"persistent volumes keep data durable for workloads and stateful services",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "data to secret",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("docs/concepts/secret.md");
	});

	test("keeps a body-plus-folder anchor query on the file that joins both clues", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "tech-zh/configuration/configmap.md",
				basename: "configmap",
				folder: "tech zh configuration",
				content:
					"configmap can provide pod data through environment variables and mounted files in one configuration flow",
			},
			{
				path: "tech-zh/configuration/secret.md",
				basename: "secret",
				folder: "tech zh configuration",
				content:
					"secret stores sensitive data for workloads and cluster access controls",
			},
			{
				path: "tech-zh/workloads/pod-lifecycle.md",
				basename: "pod lifecycle",
				folder: "tech zh workloads",
				content:
					"pod lifecycle explains restarts scheduling phases and graceful termination behavior",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "tech zh pod data",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("tech-zh/configuration/configmap.md");
	});

	test("keeps secret first for the benchmark query data to secret", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/configmap.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "data to secret",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/configuration/secret.md",
		);
	});

	test("keeps ingress first for the benchmark query ingressclass to service", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/service.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "ingressclass to service",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/services-networking/ingress.md",
		);
	});

	test("keeps ingress first for the benchmark query ingress service to", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/secret.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "ingress service to",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/services-networking/ingress.md",
		);
	});

	test("keeps namespaces first for the benchmark query namespace pod object", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "namespace pod object",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
		);
	});

	test("keeps configmap first for the benchmark query tech-zh pod data", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "tech-zh pod data",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
		);
	});

	test("keeps configmap first for tech-zh pod data across the full concept set", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/workloads/controllers/deployment.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
			{
				path: "adversarial/tech-zh/configmaps-rollout-zh.md",
				basename: "ConfigMap 发布指南",
				folder: "adversarial/tech-zh",
				headings: "Apply order Restart checks",
				content: [
					"ConfigMaps rollout 需要先应用命名空间默认值，再挂载环境文件，否则会出现陈旧数据。",
					"这份笔记主要记录发布顺序和重启后的校验步骤。",
				].join("\n\n"),
			},
		]);

		const results = await engine.searchFiles({
			queryText: "tech-zh pod data",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
		);
	});

	test("keeps configmap first for the body-title query configmap pod data", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/secret.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "configmap pod data",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
		);
	});

	test("keeps secret first for secret pod data across the full concept set", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/workloads/controllers/deployment.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "secret pod data",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/configuration/secret.md",
		);
	});

	test("keeps ingress first for ingressclass service across the full concept set", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/workloads/controllers/deployment.md",
			),
			loadBenchmarkDocument(
				"tech-en/content/en/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "ingressclass service",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-en/content/en/docs/concepts/services-networking/ingress.md",
		);
	});

	test("keeps zh ingress first for tech-zh ingress service to across the full concept set", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/services-networking/service.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/storage/persistent-volumes.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/workloads/controllers/deployment.md",
			),
			loadBenchmarkDocument(
				"tech-zh/content/zh-cn/docs/concepts/workloads/pods/pod-lifecycle.md",
			),
		]);

		const results = await engine.searchFiles({
			queryText: "tech-zh ingress service to",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe(
			"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
		);
	});

	test("prefers a title-anchor body match over a sibling with broader body overlap", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/playbooks/internal-links.md",
				basename: "internal links playbook",
				folder: "notes playbooks",
				content:
					"internal links create blocks that keep note navigation stable during editing and large refactors",
			},
			{
				path: "notes/drifts/aliases.md",
				basename: "aliases drift notes",
				folder: "notes drifts",
				content:
					"aliases create blocks and aliases create links repeatedly in body notes, but the page is mainly about drift cleanup",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "internal links create blocks",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/playbooks/internal-links.md");
	});

	test("uses the char channel when the tokenizer provides no Han tokens", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/zh.md",
				basename: "zh note",
				folder: "notes",
				content: "混合搜索重排序需要更稳定的局部命中。",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "重排",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/zh.md");
		expect(results[0]?.matchedTerms).toContain("重排");
	});

	test("factory can expose the passage backend without changing the UI contract", () => {
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const { FileSearchEngineFactory } = require(
			"src/services/search/file-search-engine",
		);

		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.fileSearchBackend = "passage-bm25";
		container.register(OuterSetting, { useValue: setting });
		container.register(Tokenizer, {
			useValue: createMockTokenizer(),
		});

		const factory = new FileSearchEngineFactory() as InstanceType<
			typeof FileSearchEngineFactory
		>;

		expect(factory.getActiveEngine().backend).toBe("passage-bm25");
	});
});
