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
				}): Promise<
					Array<{
						text: string;
						highlightRanges?: Array<{ start: number; end: number }>;
					}>
				>;
			};
		};

		const text = "引言。\n配置中心化方案在这里。";
		const builder = new CoverageLexicalDirectSubItemBuilder();
		const subItems = await builder.build({
			path: "notes/zh-char.md",
			bodyTextFallback: text,
			bodyTokenSequence: ["引言", "配置中心化方案在这里"],
			families: [createFamily(0, "配置中心")],
			pairSignatures: [],
			maxSubItemCount: 2,
			charQueryTerms: ["配置", "置中", "中心"],
		});

		expect(subItems.length).toBeGreaterThan(0);
		const first = subItems[0];
		const highlighted = (first.highlightRanges ?? []).map((range) =>
			first.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("配置"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("中心"))).toBe(true);
	});
});
