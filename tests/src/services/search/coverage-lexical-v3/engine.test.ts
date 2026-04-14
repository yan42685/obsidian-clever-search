import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { V3DocumentTokenizer } from "src/services/search/coverage-lexical-v3/query";

function createDocument(
	overrides: Partial<IndexedDocument> & Pick<IndexedDocument, "path" | "basename" | "folder">,
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

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

describe("coverage lexical v3 engine", () => {
	test("search read path builds candidates and ranks the stronger packed document first", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				tags: "#k8s #runtime",
				headings: "Projected token runtime access",
				content:
					"Projected token runtime access in pod.\n\nPod mounts token and secret together.",
			}),
			createDocument({
				path: "infra/scattered-note.md",
				basename: "runtime note",
				folder: "infra",
				tags: "#misc",
				headings: "pod",
				content:
					"Projected details.\n\nRuntime reminder.\n\nToken facts.\n\nAccess notes.",
			}),
		]);

		const result = engine.search("projected token runtime access");

		expect(result.rankedCandidates).toHaveLength(2);
		expect(result.rankedCandidates[0].path).toBe("infra/projected-token.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBeGreaterThanOrEqual(3);
	});

	test("one query unit binds to one best realized family per candidate", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "notes/pre-note.md",
				basename: "pre note",
				folder: "notes",
				content: "present prefer preload",
			}),
		]);

		const result = engine.search("pre");
		const candidate = result.rankedCandidates[0];

		expect(candidate.realizedCoverageCount).toBe(1);
		expect(candidate.realizedFamilies).toHaveLength(1);
	});

	test("han tokenizer real terms become the only primary units for ranking", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf": ["\u7cfb\u7edf"],
			"\u4ee3\u7406": ["\u4ee3\u7406"],
			"\u7cfb\u7edf\u4ee3\u7406": ["\u7cfb\u7edf\u4ee3\u7406"],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/split-hit.md",
					basename: "\u7cfb\u7edf",
					folder: "zh",
					content: "\u4ee3\u7406",
				}),
				createDocument({
					path: "zh/opaque-body.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u7cfb\u7edf\u4ee3\u7406",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u7cfb\u7edf\u4ee3\u7406",
			["\u7cfb\u7edf", "\u4ee3\u7406"],
		);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u7cfb\u7edf", source: "han_tokenizer_real" },
			{ text: "\u4ee3\u7406", source: "han_tokenizer_real" },
		]);
		expect(result.recallState.queryAnalysis.hanBackstopGroups).toHaveLength(0);
		expect(result.rankedCandidates[0].path).toBe("zh/split-hit.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(2);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u7cfb\u7edf", "\u4ee3\u7406"]);
	});

	test("bridge bigrams can recall han candidates without inflating realized coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u59d4\u5458": ["\u59d4\u5458"],
			"\u957f\u5927": ["\u957f\u5927"],
			"\u5458\u957f": ["\u5458\u957f"],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/committee.md",
					basename: "\u59d4\u5458",
					folder: "zh",
					content: "\u957f\u5927",
				}),
				createDocument({
					path: "zh/bridge-only.md",
					basename: "\u5458\u957f",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u59d4\u5458\u957f", ["\u59d4\u5458"]);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text),
		).toEqual(["\u59d4\u5458"]);
		expect(result.recallState.queryAnalysis.hanBackstopGroups).toEqual([
			expect.objectContaining({
				triggerKind: "bridge_bigram",
				normalizedText: "\u957f",
				bigrams: ["\u5458\u957f"],
			}),
		]);
		expect(result.recallState.candidateDocs).toHaveLength(2);
		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/committee.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(1);
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(0);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u59d4\u5458"]);
	});

	test("completed Han surface witness in body outranks a partial real-term hit", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u751f\u547d\u529b": ["\u751f\u547d"],
			"\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d\u529b\u8bad\u7ec3": ["\u8fd9\u91cc", "\u8bb0\u5f55", "\u751f\u547d", "\u8bad\u7ec3"],
			"\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d": ["\u8fd9\u91cc", "\u8bb0\u5f55", "\u751f\u547d"],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/life-force.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d\u529b\u8bad\u7ec3",
				}),
				createDocument({
					path: "zh/life-only.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u751f\u547d\u529b", ["\u751f\u547d"]);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/life-force.md",
			"zh/life-only.md",
		]);
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(1);
		expect(result.rankedCandidates[0].strongestHanSurfaceCompletionTier).toBe(
			"body_residue",
		);
		expect(result.rankedCandidates[1].completedHanSurfaceGroupCount).toBe(0);
	});

	test("metadata dual real-term coverage outranks body dual coverage which outranks split coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf\u7684\u4ee3\u7406": ["\u7cfb\u7edf", "\u4ee3\u7406"],
			"\u7cfb\u7edf": ["\u7cfb\u7edf"],
			"\u4ee3\u7406": ["\u4ee3\u7406"],
			"\u8fd9\u91cc\u8bb0\u5f55\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b": [
				"\u8fd9\u91cc",
				"\u8bb0\u5f55",
				"\u7cfb\u7edf",
				"\u4ee3\u7406",
				"\u6d41\u7a0b",
			],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/metadata-strong.md",
					basename: "\u7cfb\u7edf\u7684\u4ee3\u7406",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/body-strong.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8fd9\u91cc\u8bb0\u5f55\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b",
				}),
				createDocument({
					path: "zh/split-weak.md",
					basename: "\u7cfb\u7edf",
					folder: "zh",
					content: "\u4ee3\u7406",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u7cfb\u7edf\u4ee3\u7406",
			["\u7cfb\u7edf", "\u4ee3\u7406"],
		);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/metadata-strong.md",
			"zh/body-strong.md",
			"zh/split-weak.md",
		]);
		expect(result.rankedCandidates[0].identityContainer?.coveredDistinctUnitCount).toBe(2);
		expect(result.rankedCandidates[1].bodyWindowContainer?.coveredDistinctUnitCount).toBe(2);
		expect(result.rankedCandidates[2].identityContainer?.coveredDistinctUnitCount).toBe(1);
		expect(result.rankedCandidates[2].bodyWindowContainer).toBeNull();
	});

	test("heading han real terms corroborate body but do not form standalone realized coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf\u4ee3\u7406": ["\u7cfb\u7edf", "\u4ee3\u7406"],
			"\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b": [
				"\u7cfb\u7edf",
				"\u4ee3\u7406",
				"\u6d41\u7a0b",
			],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/heading-only.md",
					basename: "\u666e\u901a\u8bb0\u5f55",
					folder: "zh",
					headings: "\u7cfb\u7edf\u4ee3\u7406",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/body-with-heading.md",
					basename: "\u666e\u901a\u8bb0\u5f55",
					folder: "zh",
					headings: "\u7cfb\u7edf\u4ee3\u7406",
					content: "\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u7cfb\u7edf\u4ee3\u7406",
			["\u7cfb\u7edf", "\u4ee3\u7406"],
		);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/body-with-heading.md",
		]);
		expect(result.rankedCandidates[0].bodyWindowContainer).not.toBeNull();
		expect(
			result.rankedCandidates[0].bodyWindowContainer?.headingCorroboration.unitCount,
		).toBeGreaterThan(0);
	});

	test("metadata split hit outranks dispersed same-block body hits that fail bodyWindow admission", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/split.md",
				basename: "cache",
				folder: "latin",
				content: "restore",
			}),
			createDocument({
				path: "latin/dispersed-body.md",
				basename: "notes",
				folder: "latin",
				content: "cache one two three four five six restore",
			}),
		]);

		const result = engine.search("cache restore");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/split.md",
			"latin/dispersed-body.md",
		]);
		expect(result.rankedCandidates[0].identityContainer?.coveredDistinctUnitCount).toBe(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).toBeNull();
		expect(result.rankedCandidates[1].bodyWindowContainer).toBeNull();
	});

	test("adjacent blocks can form a weaker chain bodyWindow", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/same-block.md",
				basename: "notes",
				folder: "latin",
				content: "cache restore",
			}),
			createDocument({
				path: "latin/adjacent-blocks.md",
				basename: "notes",
				folder: "latin",
				content: "cache\n\nrestore",
			}),
		]);

		const result = engine.search("cache restore");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/same-block.md",
			"latin/adjacent-blocks.md",
		]);
		expect(result.rankedCandidates[0].bodyWindowContainer?.blockIds).toEqual([2]);
		expect(result.rankedCandidates[1].bodyWindowContainer?.blockIds).toEqual([0, 1]);
		expect(
			(result.rankedCandidates[0].bodyWindowContainer?.containerCompactness ?? 0) >
				(result.rankedCandidates[1].bodyWindowContainer?.containerCompactness ?? 0),
		).toBe(true);
	});

	test("prefix-only body hits prefer smaller completion gain and then non-compound tokens", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/preference.md",
				basename: "notes",
				folder: "latin",
				content: "preference",
			}),
			createDocument({
				path: "latin/prefer.md",
				basename: "notes",
				folder: "latin",
				content: "prefer",
			}),
			createDocument({
				path: "latin/prefer-compound.md",
				basename: "notes",
				folder: "latin",
				content: "prefer-cache",
			}),
		]);

		const result = engine.search("prefe");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/prefer.md",
			"latin/preference.md",
			"latin/prefer-compound.md",
		]);
		expect(result.rankedCandidates[0].prefixCompletionGainTotal).toBe(1);
		expect(result.rankedCandidates[1].prefixCompletionGainTotal).toBe(5);
		expect(result.rankedCandidates[2].compoundPrefixCount).toBe(1);
	});
});
