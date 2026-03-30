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

	test("highlights the full Han segment when the final snippet contains it exactly", async () => {
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

		const text = "\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u611f\u89c9\u8fd8\u4e0d\u9519\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/exact-segment-highlight.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\u611f\u89c9\u8fd8\u4e0d\u9519"],
			families: [createFamily(0, "\u4e0a\u9762")],
			pairSignatures: [],
			maxSubItemCount: 1,
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

		expect(subItems.length).toBe(1);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted).toContain("\u4e0a\u9762\u8fd9");
	});

	test("highlights a local Han subspan when the full Han query segment is not contiguous in the snippet", async () => {
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

		const text = "\u4e8c\u5206\u6cd5\u6392\u67e5\u63d2\u4ef6\uff0c\u4f46\u597d\u50cf\u6709\u70b9\u4e0d\u7a33\u5b9a\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/local-han-subspan.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u4e8c\u5206\u6cd5\u6392\u67e5\u63d2\u4ef6 \u4f46\u597d\u50cf\u6709\u70b9\u4e0d\u7a33\u5b9a"],
			families: [createFamily(0, "\u4e8c\u5206")],
			pairSignatures: [],
			maxSubItemCount: 1,
			charQueryTerms: ["\u4e8c\u5206", "\u5206\u4e0d", "\u4e0d\u7a33"],
			charQuerySegments: ["\u4e8c\u5206\u4e0d\u7a33"],
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

		expect(subItems.length).toBe(1);
		const highlighted = (subItems[0].highlightRanges ?? []).map((range) =>
			subItems[0].text.slice(range.start, range.end),
		);
		expect(highlighted).toContain("\u4e8c\u5206");
		expect(highlighted).toContain("\u4e0d\u7a33");
	});

	test("highlights the boundary Han character when a short Han query only partially matches contiguously", async () => {
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

		const text = "\u4e8c\u5206\u6cd5\u6392\u67e5\u63d2\u4ef6\uff0c\u4f46\u597d\u50cf\u6709\u70b9\u4e0d\u7a33\u5b9a\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/local-han-boundary-char.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u4e8c\u5206\u6cd5\u6392\u67e5\u63d2\u4ef6 \u4f46\u597d\u50cf\u6709\u70b9\u4e0d\u7a33\u5b9a"],
			families: [createFamily(0, "\u4e8c\u5206")],
			pairSignatures: [],
			maxSubItemCount: 1,
			charQueryTerms: ["\u4e8c\u5206", "\u5206\u4e0d"],
			charQuerySegments: ["\u4e8c\u5206\u4e0d"],
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

		expect(subItems.length).toBe(1);
		const highlighted = (subItems[0].highlightRanges ?? []).map((range) =>
			subItems[0].text.slice(range.start, range.end),
		);
		expect(highlighted).toContain("\u4e8c\u5206");
		expect(highlighted).toContain("\u4e0d");
	});

	test("builds a char-only local subitem when no display windows are available", async () => {
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
					displayWindows?: [];
				}): Promise<Array<{ text: string }>>;
			};
		};

		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/char-only-subitem.md",
			bodyTextFallback:
				"\u8fd9\u91cc\u8bb0\u4e86\u4e00\u4e0b\u756a\u8304\u949f\u7684\u4f7f\u7528\u4f53\u9a8c\u3002",
			bodyTokenSequence: [],
			families: [],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u65f6\u95f4", "\u95f4\u756a", "\u756a\u8304", "\u8304\u949f"],
			charQuerySegments: ["\u65f6\u95f4\u756a\u8304\u949f"],
			displayWindows: [],
		});

		expect(subItems.length).toBeGreaterThan(0);
		expect(subItems.some((item) => item.text.includes("\u756a\u8304\u949f"))).toBe(true);
	});

	test("keeps Han char fallback offsets aligned even when earlier text changes length under NFKC", async () => {
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
					displayWindows?: [];
				}): Promise<Array<{ text: string }>>;
			};
		};

		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/nfkc-offsets.md",
			bodyTextFallback:
				"\u2163\u2163\u2163 compatibility prefix\n\u8fd9\u91cc\u6709\u4e00\u6bb5\u756a\u8304\u949f\u8bb0\u5f55\u3002",
			bodyTokenSequence: [],
			families: [],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u65f6\u95f4", "\u95f4\u756a", "\u756a\u8304", "\u8304\u949f"],
			charQuerySegments: ["\u65f6\u95f4\u756a\u8304\u949f"],
			displayWindows: [],
		});

		expect(subItems.length).toBeGreaterThan(0);
		expect(subItems.some((item) => item.text.includes("\u756a\u8304\u949f"))).toBe(true);
		expect(subItems.some((item) => item.text.includes("compatibility prefix"))).toBe(false);
	});

	test("keeps char highlight when a Han query segment is matched across multiple local clusters in one snippet", async () => {
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

		const text = "\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/split-segment-highlight.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb"],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u7b14\u8bb0")],
			pairSignatures: [],
			maxSubItemCount: 1,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9", "\u7b14\u8bb0"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9\u7b14\u8bb0"],
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

		expect(subItems.length).toBe(1);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("\u4e0a\u9762\u8fd9"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("\u7b14\u8bb0"))).toBe(true);
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

	test("keeps one secondary snippet from a different region when budget allows", async () => {
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

		const text = [
			"\u914d\u5408\u4e0a\u9762\u7684 banners\uff0c\u5feb\u901f\u63d2\u5165\u56fe\u7247\u3002",
			"\u4e2d\u95f4\u7684\u5176\u4ed6\u8bb0\u5f55\u3002",
			"\u4e2d\u95f4\u7684\u5176\u4ed6\u8bb0\u5f55\u4e8c\u3002",
			"\u4e2d\u95f4\u7684\u5176\u4ed6\u8bb0\u5f55\u4e09\u3002",
			"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u3002",
		].join("\n");
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/secondary-region.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"\u914d\u5408\u4e0a\u9762\u7684 banners \u5feb\u901f\u63d2\u5165\u56fe\u7247",
				"\u4e2d\u95f4\u7684\u5176\u4ed6\u8bb0\u5f55",
				"\u4e2d\u95f4\u7684\u5176\u4ed6\u8bb0\u5f55\u4e8c",
				"\u4e2d\u95f4\u7684\u5176\u4ed6\u8bb0\u5f55\u4e09",
				"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u7b14\u8bb0")],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9"],
			debugQueryText: "\u4e0a\u9762\u8fd9\u4f4d\u7b14\u8bb0",
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
					startTokenIndex: 4,
					endTokenIndex: 4,
					signal: {
						start: 4,
						end: 4,
						score: 2,
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

		expect(subItems.length).toBe(2);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
		expect(subItems[1].text).toContain("\u4e0a\u9762\u7684 banners");
	});

	test("expands the snippet to include nearby missing query evidence within the token budget", async () => {
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
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text =
			"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\uff0c\u611f\u89c9\u8fd8\u4e0d\u9519\uff0c\u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/query-aware-expansion.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb \u611f\u89c9\u8fd8\u4e0d\u9519 \u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u5feb\u901f")],
			pairSignatures: [],
			maxSubItemCount: 1,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9", "\u5feb\u901f"],
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

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
		expect(subItems[0].text).toContain("\u5feb\u901f");
	});

	test("render span includes a nearby supporting query term when it adds coverage", async () => {
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
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text = [
			"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u3002",
			"JumpToDate\uff1a\u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f\u3002",
		].join("\n");
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/render-support.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb",
				"jumptodate \u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u5feb\u901f")],
			pairSignatures: [],
			maxSubItemCount: 1,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9", "\u5feb\u901f"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 1,
					signal: {
						start: 0,
						end: 1,
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

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
		expect(subItems[0].text).toContain("\u5feb\u901f");
	});

	test("ranks the snippet with stronger final query coverage ahead of a weaker local hit", async () => {
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

		const text = [
			"Image Inserter\uff1a\u914d\u5408\u4e0a\u9762\u7684 Banners\uff0c\u5feb\u901f\u4ece\u7f51\u4e0a\u68c0\u7d22\u5e76\u63d2\u5165\u56fe\u7247\u3002",
			"Strange New Worlds\uff1a\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u7684\u4e00\u6b3e\u63d2\u4ef6\uff0c\u611f\u89c9\u8fd8\u4e0d\u9519\uff1f",
			"JumpToDate\uff1a\u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f\u3002",
		].join("\n");
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/rank-final-coverage.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"image inserter \u914d\u5408\u4e0a\u9762\u7684 banners \u5feb\u901f\u4ece\u7f51\u4e0a\u68c0\u7d22\u5e76\u63d2\u5165\u56fe\u7247",
				"strange new worlds \u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u7684\u4e00\u6b3e\u63d2\u4ef6 \u611f\u89c9\u8fd8\u4e0d\u9519",
				"jumptodate \u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u5feb\u901f")],
			pairSignatures: [],
			maxSubItemCount: 1,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9", "\u8fd9\u5feb", "\u5feb\u901f"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9\u5feb\u901f"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 0,
					signal: {
						start: 0,
						end: 0,
						score: 2,
						matchedExactCoreFamilyIndices: [0, 1],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0, 1],
					kind: "support",
					rank: 1,
				},
				{
					startTokenIndex: 1,
					endTokenIndex: 2,
					signal: {
						start: 1,
						end: 2,
						score: 2,
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

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
		expect(subItems[0].text).toContain("\u5feb\u901f");
	});

	test("keeps multiple semantic islands from the same broad window instead of collapsing them into one summary snippet", async () => {
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
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text = [
			"\u4e0a\u9762\u7684 banners \u5c06\u7528\u4e8e\u56fe\u7247\u5de5\u4f5c\u6d41\u3002",
			"\u65e0\u5173\u63cf\u8ff0\u4e00\u3002",
			"\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 strange new worlds \u5f88\u6709\u610f\u601d\u3002",
			"\u65e0\u5173\u63cf\u8ff0\u4e8c\u3002",
			"\u7b14\u8bb0\u95f4\u5173\u7cfb\u4e5f\u503c\u5f97\u770b\u770b\u3002",
		].join("\n");
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/all-clusters.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"\u4e0a\u9762\u7684 banners \u5c06\u7528\u4e8e\u56fe\u7247\u5de5\u4f5c\u6d41",
				"\u65e0\u5173\u63cf\u8ff0\u4e00",
				"\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 strange new worlds \u5f88\u6709\u610f\u601d",
				"\u65e0\u5173\u63cf\u8ff0\u4e8c",
				"\u7b14\u8bb0\u95f4\u5173\u7cfb\u4e5f\u503c\u5f97\u770b\u770b",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u7b14\u8bb0")],
			pairSignatures: [],
			maxSubItemCount: 3,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9", "\u7b14\u8bb0"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9", "\u7b14\u8bb0"],
			displayWindows: [
				{
					startTokenIndex: 0,
					endTokenIndex: 4,
					signal: {
						start: 0,
						end: 4,
						score: 3,
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

		expect(subItems.length).toBe(2);
		expect(subItems.some((item) => item.text.includes("\u4e0a\u9762\u8fd9\u4f4d"))).toBe(true);
		expect(subItems.some((item) => item.text.includes("\u7b14\u8bb0"))).toBe(true);
	});

	test("dedupes near-identical snippets created after query-aware expansion", async () => {
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
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text =
			"\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\uff0c\u611f\u89c9\u8fd8\u4e0d\u9519\uff0c\u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/final-dedupe.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb \u611f\u89c9\u8fd8\u4e0d\u9519 \u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u5feb\u901f")],
			pairSignatures: [],
			maxSubItemCount: 3,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9", "\u5feb\u901f"],
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
				{
					startTokenIndex: 0,
					endTokenIndex: 0,
					signal: {
						start: 0,
						end: 0,
						score: 0.9,
						matchedExactCoreFamilyIndices: [0, 1],
						matchedPrefixCoreFamilyIndices: [],
						matchedFuzzyCoreFamilyIndices: [],
						matchedAnchorFamilyIndices: [],
						matchedSoftFamilyIndices: [],
					},
					matchedFamilyIndices: [0, 1],
					kind: "primary",
					rank: 1,
				},
			],
		});

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u4e0a\u9762\u8fd9");
		expect(subItems[0].text).toContain("\u5feb\u901f");
	});

	test("dedupes display-equivalent snippets even when their rows differ", async () => {
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
				}): Promise<Array<{ text: string }>>;
			};
		};

		const text =
			"\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\uff0c\u611f\u89c9\u8fd8\u4e0d\u9519\uff0c\u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/equivalent-final-snippets.md",
			bodyTextFallback: text,
			bodyTokenSequence: [
				"\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb \u611f\u89c9\u8fd8\u4e0d\u9519 \u5feb\u901f\u8df3\u5230\u6307\u5b9a\u65e5\u671f",
			],
			families: [createFamily(0, "\u4e0a\u9762"), createFamily(1, "\u5feb\u901f")],
			pairSignatures: [],
			maxSubItemCount: 3,
			charQueryTerms: ["\u4e0a\u9762", "\u9762\u8fd9"],
			charQuerySegments: ["\u4e0a\u9762\u8fd9", "\u5feb\u901f"],
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
					rank: 1,
				},
			],
		});

		expect(subItems.length).toBe(1);
		expect(subItems[0].text).toContain("\u5feb\u901f");
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

	test("does not highlight unrelated evidence from the same snippet region", async () => {
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
			"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684\uff0c\u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb\u3002";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/highlight-scope.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684 \u67e5\u770b\u7b14\u8bb0\u95f4\u5173\u7cfb"],
			families: [createFamily(0, "\u4e0a\u9762")],
			pairSignatures: [],
			maxSubItemCount: 1,
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

		expect(subItems.length).toBe(1);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("\u4e0a\u9762\u8fd9"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("\u5173\u7cfb"))).toBe(false);
	});
});
