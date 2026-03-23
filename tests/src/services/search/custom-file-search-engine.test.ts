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

describe("CustomFileSearchEngine lexical planning", () => {
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
		const { CustomFileSearchEngine } = require("src/services/search/file-search-engine");
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");

		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.fileSearchBackend = "custom-bm25";
		setting.isCaseSensitive = false;

		container.register(OuterSetting, { useValue: setting });
		container.register(Tokenizer, {
			useValue: createMockTokenizer(),
		});

		return new CustomFileSearchEngine() as InstanceType<typeof CustomFileSearchEngine>;
	}

	test("relaxes a long query when one term has no lexical match", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/project-roadmap.md",
				basename: "project roadmap",
				folder: "notes",
				headings: "architecture milestones",
				content: "migration architecture decisions and milestones",
			},
			{
				path: "notes/roadmap-draft.md",
				basename: "roadmap draft",
				folder: "notes",
				headings: "",
				content: "roadmap milestones only",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "project roadmap missingterm",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results.map((item: { path: string }) => item.path)).toEqual([
			"notes/project-roadmap.md",
		]);
	});

	test("keeps short precise queries strict instead of broadening them", async () => {
		const engine = createEngine();
		await engine.addDocuments([
			{
				path: "notes/project-roadmap.md",
				basename: "project roadmap",
				folder: "notes",
				headings: "architecture milestones",
				content: "migration architecture decisions and milestones",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "project missingterm",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results).toEqual([]);
	});

	test("keeps path-like queries biased toward metadata matches", async () => {
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
				headings: "",
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
});
