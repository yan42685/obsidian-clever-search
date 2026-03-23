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

		const results = await engine.searchFiles({
			queryText: "incident summary checkpoint replay verifier frontier",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/projects/incident-summary.md");
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

		const results = await engine.searchFiles({
			queryText: "restart window stale cache configmap",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/projects/restart-window.md");
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
