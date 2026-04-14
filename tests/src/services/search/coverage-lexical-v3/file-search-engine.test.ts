jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import { container } from "tsyringe";

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation,
		size: overrides.size,
	};
}

describe("coverage lexical v3 file search engine", () => {
	beforeEach(() => {
		container.registerInstance(
			Tokenizer,
			{
				tokenizeSequence: (text: string) =>
					text
						.toLowerCase()
						.split(/\s+/u)
						.map((token) => token.trim())
						.filter((token) => token.length > 0),
			} as unknown as Tokenizer,
		);
	});

	test("reIndexAll builds a searchable runtime index", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
			createDocument({
				path: "infra/other.md",
				basename: "runtime note",
				folder: "infra",
				content: "misc runtime note",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token runtime access",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
		expect(matchedFiles[0]?.queryTerms).toEqual([
			"projected",
			"token",
			"runtime",
			"access",
		]);
		expect(matchedFiles[0]?.matchedTerms).toContain("projected");
	});

	test("getDirectSubItems reuses legacy direct-subitems builder by path", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readCurrentTexts: (paths: string[]) => Promise<Map<string, string>>;
				};
			}
		).getFileSnapshotStore = () => ({
			readCurrentTexts: async (paths: string[]) =>
				new Map([
					[
						paths[0],
						"The system proxy fallback is documented here.\n\nThis note explains the proxy setup.",
					],
				]),
		});
		await engine.reIndexAll([
			createDocument({
				path: "notes/system-proxy.md",
				basename: "system note",
				folder: "notes",
				content: "placeholder",
			}),
		]);

		const subItems = await engine.getDirectSubItems(
			"system proxy",
			"notes/system-proxy.md",
			3,
		);

		expect(subItems).not.toBeNull();
		expect(subItems?.length).toBeGreaterThan(0);
		expect(subItems?.[0]?.snippet ?? subItems?.[0]?.text).toContain("proxy");
	});

	test("searchFiles passes tokenizer query terms into the v3 Han query analysis", async () => {
		const tokenizeSequence = jest.fn((text: string, mode?: "index" | "search") => {
			if (text === "系统代理" && mode === "search") {
				return ["系统", "代理"];
			}
			return text
				.toLowerCase()
				.split(/\s+/u)
				.map((token) => token.trim())
				.filter((token) => token.length > 0);
		});
		container.registerInstance(
			Tokenizer,
			{ tokenizeSequence } as unknown as Tokenizer,
		);
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "zh/split-hit.md",
				basename: "系统",
				folder: "zh",
				content: "代理",
			}),
			createDocument({
				path: "zh/opaque-body.md",
				basename: "普通笔记",
				folder: "zh",
				content: "系统代理",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "系统代理",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(tokenizeSequence).toHaveBeenCalledWith("系统代理", "search");
		expect(matchedFiles[0]?.path).toBe("zh/split-hit.md");
		expect(matchedFiles[0]?.queryTerms).toEqual(["系统", "代理"]);
		expect(matchedFiles[0]?.matchedTerms).toEqual(["系统", "代理"]);
	});

	test("index breakdown exposes resident v3 metrics", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "han/token.md",
				basename: "han token",
				folder: "han",
				content: "han route exact tape",
			}),
		]);

		const breakdown = engine.getIndexBreakdown();

		expect(breakdown?.__backend).toBe("coverage-lexical-v3");
		expect(breakdown?.metrics.residentBytes).toBeGreaterThan(0);
		expect(breakdown?.summary.documentCount).toBe(1);
	});
});
