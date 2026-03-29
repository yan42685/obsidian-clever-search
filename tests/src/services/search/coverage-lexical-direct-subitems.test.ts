import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

function createMockTokenizer() {
	return {
		tokenizeSequenceWithOffsets(text: string) {
			const matches = text.matchAll(/[\p{Script=Han}]+|[a-z0-9_-]+/giu);
			const out: Array<{ token: string; start: number; end: number }> = [];
			for (const match of matches) {
				const token = match[0];
				const start = match.index ?? 0;
				out.push({
					token: token.toLowerCase(),
					start,
					end: start + token.length,
				});
			}
			return out;
		},
	};
}

function createFamily(
	index: number,
	normalizedTerm: string,
): {
	index: number;
	rawTerm: string;
	normalizedTerm: string;
	strength: "core";
	role: "body";
	isMetadataCapable: false;
	allowPrefix: true;
	allowFuzzy: false;
} {
	return {
		index,
		rawTerm: normalizedTerm,
		normalizedTerm,
		strength: "core",
		role: "body",
		isMetadataCapable: false,
		allowPrefix: true,
		allowFuzzy: false,
	};
}

describe("coverage lexical direct subitems", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		container.registerInstance(Tokenizer, createMockTokenizer());
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("rebuilds snippet and highlight from local text even when token indices drift", async () => {
		const { CoverageLexicalDirectSubItemBuilder } = require(
			"src/services/search/coverage-lexical/coverage-lexical-direct-subitems",
		) as {
			CoverageLexicalDirectSubItemBuilder: new () => {
				build(params: {
					path: string;
					bodyTextFallback: string;
					bodyTokenSequence: string[];
					families: Array<ReturnType<typeof createFamily>>;
					pairSignatures: [];
					maxSubItemCount: number;
				}): Promise<
					Array<{
						text: string;
						row: number;
						col: number;
						highlightRanges?: Array<{ start: number; end: number }>;
					}>
				>;
			};
		};

		const text =
			"Overview line.\nTiny intro.\nThe Better Plugins catalog lives here for fast lookup.";
		const bodyTokenSequence = [
			"overview",
			"tiny",
			"intro",
			"misc1",
			"misc2",
			"misc3",
			"misc4",
			"misc5",
			"misc6",
			"misc7",
			"misc8",
			"misc9",
			"misc10",
			"misc11",
			"better",
			"plugins",
			"catalog",
			"lookup",
		];
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/better-plugins.md",
			bodyTextFallback: text,
			bodyTokenSequence,
			families: [createFamily(0, "bet"), createFamily(1, "plu")],
			pairSignatures: [],
			maxSubItemCount: 3,
		});

		expect(subItems.length).toBeGreaterThan(0);
		const first = subItems[0];
		expect(first.text).toContain("Better Plugins");
		expect(first.row).toBe(2);
		expect(first.col).toBe(text.split("\n")[2].indexOf("Better"));
		const highlighted = (first.highlightRanges ?? [])
			.map((range) => first.text.slice(range.start, range.end).toLowerCase());
		expect(highlighted.some((segment) => segment.includes("bet"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("plu"))).toBe(true);
	});

	test("falls back to Han bigram highlighting when tokenizer offsets do not expose the query term", async () => {
		const { CoverageLexicalDirectSubItemBuilder } = require(
			"src/services/search/coverage-lexical/coverage-lexical-direct-subitems",
		) as {
			CoverageLexicalDirectSubItemBuilder: new () => {
				build(params: {
					path: string;
					bodyTextFallback: string;
					bodyTokenSequence: string[];
					families: Array<ReturnType<typeof createFamily>>;
					pairSignatures: [];
					maxSubItemCount: number;
					charQueryTerms?: string[];
					charQuerySegments?: string[];
					displayWindows?: Array<{
						startTokenIndex: number;
						endTokenIndex: number;
						signal: {
							start: number;
							end: number;
							score: number;
							matchedExactCoreFamilyIndices: number[];
							matchedPrefixCoreFamilyIndices: number[];
							matchedFuzzyCoreFamilyIndices: number[];
							matchedAnchorFamilyIndices: number[];
							matchedSoftFamilyIndices: number[];
						};
						matchedFamilyIndices: number[];
						kind: "primary";
						rank: number;
					}>;
				}): Promise<
					Array<{
						text: string;
						highlightRanges?: Array<{ start: number; end: number }>;
					}>
				>;
			};
		};

		const text = "\u5f15\u8a00\u3002\n\u914d\u7f6e\u4e2d\u5fc3\u5316\u65b9\u6848\u5728\u8fd9\u91cc\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/zh-char.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u5f15\u8a00", "\u914d\u7f6e\u4e2d\u5fc3\u5316\u65b9\u6848\u5728\u8fd9\u91cc"],
			families: [createFamily(0, "\u914d\u7f6e\u4e2d\u5fc3")],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u914d\u7f6e", "\u7f6e\u4e2d", "\u4e2d\u5fc3"],
			charQuerySegments: ["\u914d\u7f6e\u4e2d\u5fc3"],
		});

		expect(subItems.length).toBeGreaterThan(0);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("\u914d\u7f6e"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("\u4e2d\u5fc3"))).toBe(true);
	});

	test("merges Han substring and char-bigram highlights into one rendered span", async () => {
		const { CoverageLexicalDirectSubItemBuilder } = require(
			"src/services/search/coverage-lexical/coverage-lexical-direct-subitems",
		) as {
			CoverageLexicalDirectSubItemBuilder: new () => {
				build(params: {
					path: string;
					bodyTextFallback: string;
					bodyTokenSequence: string[];
					families: Array<ReturnType<typeof createFamily>>;
					pairSignatures: [];
					maxSubItemCount: number;
					charQueryTerms?: string[];
					charQuerySegments?: string[];
				}): Promise<
					Array<{
						text: string;
						highlightRanges?: Array<{ start: number; end: number }>;
					}>
				>;
			};
		};

		const text = "\u524d\u6587\u63d0\u5230\u4e0a\u9762\u8fd9\u6bb5\u8bdd\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/han-merge.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u524d\u6587\u63d0\u5230\u4e0a\u9762\u8fd9\u6bb5\u8bdd"],
			families: [createFamily(0, "\u4e0a\u9762")],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 0,
					signal: {
						start: 0,
						end: 0,
						score: 1,
						matchedExactCoreFamilyIndices: [0],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0],
					kind: "primary",
					rank: 0,
				},
			],
		});

		expect(subItems.length).toBeGreaterThan(0);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted).toContain("\u4e0a\u9762\u8fd9");
	});

	test("ranks the subitem containing the full Han query segment ahead of weaker windows", async () => {
		const { CoverageLexicalDirectSubItemBuilder } = require(
			"src/services/search/coverage-lexical/coverage-lexical-direct-subitems",
		) as {
			CoverageLexicalDirectSubItemBuilder: new () => {
				build(params: {
					path: string;
					bodyTextFallback: string;
					bodyTokenSequence: string[];
					families: Array<ReturnType<typeof createFamily>>;
					pairSignatures: [];
					maxSubItemCount: number;
					charQueryTerms?: string[];
					charQuerySegments?: string[];
					displayWindows?: Array<{
						startTokenIndex: number;
						endTokenIndex: number;
						signal: {
							start: number;
							end: number;
							score: number;
							matchedExactCoreFamilyIndices: number[];
							matchedPrefixCoreFamilyIndices: number[];
							matchedFuzzyCoreFamilyIndices: number[];
							matchedAnchorFamilyIndices: number[];
							matchedSoftFamilyIndices: number[];
						};
						matchedFamilyIndices: number[];
						kind: "primary" | "support";
						rank: number;
					}>;
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text =
			"\u7b2c\u4e00\u6bb5\u53ea\u6709\u4e0a\u9762\u3002\n\u7b2c\u4e8c\u6bb5\u6709\u5b8c\u6574\u7684\u4e0a\u9762\u8fd9\u53e5\u8bdd\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/subitem-rank-han.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u7b2c\u4e00\u6bb5\u53ea\u6709\u4e0a\u9762", "\u7b2c\u4e8c\u6bb5\u6709\u5b8c\u6574\u7684\u4e0a\u9762\u8fd9\u53e5\u8bdd"],
			families: [createFamily(0, "\u4e0a\u9762")],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 0,
					signal: {
						start: 0,
						end: 0,
						score: 1,
						matchedExactCoreFamilyIndices: [0],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0],
					kind: "support",
					rank: 1,
				},
				{
					startTokenIndex: 1,
					endTokenIndex: 1,
					signal: {
						start: 1,
						end: 1,
						score: 1,
						matchedExactCoreFamilyIndices: [0],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0],
					kind: "primary",
					rank: 0,
				},
			],
		});

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
	});

	test("dedupes near-identical snippets from overlapping windows on the same row", async () => {
		const { CoverageLexicalDirectSubItemBuilder } = require(
			"src/services/search/coverage-lexical/coverage-lexical-direct-subitems",
		) as {
			CoverageLexicalDirectSubItemBuilder: new () => {
				build(params: {
					path: string;
					bodyTextFallback: string;
					bodyTokenSequence: string[];
					families: Array<ReturnType<typeof createFamily>>;
					pairSignatures: [];
					maxSubItemCount: number;
					charQueryTerms?: string[];
					charQuerySegments?: string[];
					displayWindows?: Array<{
						startTokenIndex: number;
						endTokenIndex: number;
						signal: {
							start: number;
							end: number;
							score: number;
							matchedExactCoreFamilyIndices: number[];
							matchedPrefixCoreFamilyIndices: number[];
							matchedFuzzyCoreFamilyIndices: number[];
							matchedAnchorFamilyIndices: number[];
							matchedSoftFamilyIndices: number[];
						};
						matchedFamilyIndices: number[];
						kind: "primary" | "support";
						rank: number;
					}>;
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text =
			"\u7b2c\u4e00\u6bb5\u53ea\u6709\u4e0a\u9762\u3002\n\u7b2c\u4e8c\u6bb5\u6709\u5b8c\u6574\u7684\u4e0a\u9762\u8fd9\u53e5\u8bdd\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/subitem-dedupe-han.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u7b2c\u4e00\u6bb5\u53ea\u6709\u4e0a\u9762", "\u7b2c\u4e8c\u6bb5\u6709\u5b8c\u6574\u7684\u4e0a\u9762\u8fd9\u53e5\u8bdd"],
			families: [createFamily(0, "\u4e0a\u9762")],
			pairSignatures: [],
			maxSubItemCount: 3,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 1,
					signal: {
						start: 0,
						end: 1,
						score: 1,
						matchedExactCoreFamilyIndices: [0],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0],
					kind: "support",
					rank: 1,
				},
				{
					startTokenIndex: 1,
					endTokenIndex: 1,
					signal: {
						start: 1,
						end: 1,
						score: 1,
						matchedExactCoreFamilyIndices: [0],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0],
					kind: "primary",
					rank: 0,
				},
			],
		});

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
	});

	test("does not fabricate one continuous Han highlight from separated words", async () => {
		const { CoverageLexicalDirectSubItemBuilder } = require(
			"src/services/search/coverage-lexical/coverage-lexical-direct-subitems",
		) as {
			CoverageLexicalDirectSubItemBuilder: new () => {
				build(params: {
					path: string;
					bodyTextFallback: string;
					bodyTokenSequence: string[];
					families: Array<ReturnType<typeof createFamily>>;
					pairSignatures: [];
					maxSubItemCount: number;
					charQueryTerms?: string[];
					charQuerySegments?: string[];
					displayWindows?: Array<{
						startTokenIndex: number;
						endTokenIndex: number;
						signal: {
							start: number;
							end: number;
							score: number;
							matchedExactCoreFamilyIndices: number[];
							matchedPrefixCoreFamilyIndices: number[];
							matchedFuzzyCoreFamilyIndices: number[];
							matchedAnchorFamilyIndices: number[];
							matchedSoftFamilyIndices: number[];
						};
						matchedFamilyIndices: number[];
						kind: "primary";
						rank: number;
					}>;
				}): Promise<
					Array<{
						text: string;
						highlightRanges?: Array<{ start: number; end: number }>;
					}>
				>;
			};
		};

		const text =
			"\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u7684\u4e00\u6b3e\u63d2\u4ef6\uff0c\u611f\u89c9\u8fd8\u4e0d\u9519\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/discrete-han.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u7684\u4e00\u6b3e\u63d2\u4ef6\u611f\u89c9\u8fd8\u4e0d\u9519"],
			families: [createFamily(0, "\u7b14\u8bb0"), createFamily(1, "\u63d2\u4ef6")],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u7b14\u8bb0", "\u8bb0\u63d2", "\u63d2\u4ef6"],
			charQuerySegments: ["\u7b14\u8bb0\u63d2\u4ef6"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 0,
					signal: {
						start: 0,
						end: 0,
						score: 1,
						matchedExactCoreFamilyIndices: [0, 1],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0, 1],
					kind: "primary",
					rank: 0,
				},
			],
		});

		expect(subItems.length).toBeGreaterThan(0);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted).not.toContain("\u7b14\u8bb0\u95f4\u5173\u7cfb\u7684\u4e00\u6b3e\u63d2\u4ef6");
		expect(highlighted.some((segment) => segment.includes("\u7b14\u8bb0"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("\u63d2\u4ef6"))).toBe(true);
	});
});
