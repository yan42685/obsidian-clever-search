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

describe("Passage BM25 pruning regression", () => {
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
		const { FileSnapshotStore } = require(
			"src/services/search/shared/file-snapshot-store",
		);
		const { Vault } = require("obsidian");

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
		container.register(Vault, { useValue: {} });
		container.register(FileSnapshotStore, {
			useValue: {
				setCurrentFileText: jest.fn(),
				peekCurrentFileText: jest.fn(() => ""),
				getIndexedSnapshotTexts: jest.fn(async () => new Map()),
				invalidateCurrentFile: jest.fn(),
			},
		});

		return new PassageFileSearchEngine() as InstanceType<
			typeof PassageFileSearchEngine
		>;
	}

	test("keeps a rare exact content term searchable instead of falling back to a fuzzy neighbor", async () => {
		const engine = createEngine();
		const longNoiseTerms = Array.from(
			{ length: 92 },
			(_, index) => `hyperexpansiontoken${String(index).padStart(2, "0")}`,
		);
		await engine.addDocuments([
			{
				path: "notes/exact-pruned.md",
				basename: "exact pruned note",
				folder: "notes",
				content: [...longNoiseTerms, "vran"].join(" "),
			},
			{
				path: "notes/fuzzy-neighbor.md",
				basename: "fuzzy neighbor note",
				folder: "notes",
				content: "van van nearby token for the fuzzy fallback path",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "vran",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});

		expect(results[0]?.path).toBe("notes/exact-pruned.md");
		expect(results[0]?.matchedTerms).toContain("vran");
		expect(results[0]?.matchedTerms).not.toContain("van");
	});
});
