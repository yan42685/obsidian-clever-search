import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import {
	analyzeQuery,
	splitBodyBlocks,
	type V3DocumentTokenizer,
} from "src/services/search/coverage-lexical-v3/query";
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
			generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

function buildLongSentenceText(sentenceCount: number): string {
	return Array.from({ length: sentenceCount }, (_, index) =>
		`Sentence ${String(index + 1).padStart(4, "0")} ends here.`,
	).join(" ");
}

function buildAdjacentChunkBoundaryContent(): string {
	for (let charCount = 900; charCount <= 1400; charCount += 1) {
		const content = `${"x".repeat(charCount)} cache\nrestore`;
		const blocks = splitBodyBlocks(content);
		const previous = blocks[0]?.normalizedText ?? "";
		const last = blocks[1]?.normalizedText ?? "";
		if (
			blocks.length === 2 &&
			previous.endsWith("cache") &&
			last.startsWith("restore")
		) {
			return content;
		}
	}
	throw new Error("failed to construct adjacent chunk boundary content");
}

function buildAdjacentHanChunkBoundaryContent(): string {
	for (let charCount = 900; charCount <= 4000; charCount += 1) {
		const content = `${"x".repeat(charCount)}\u8d62\u5b8b\u7a84\u4f53`;
		const blocks = splitBodyBlocks(content);
		const previous = blocks[0]?.normalizedText ?? "";
		const last = blocks[1]?.normalizedText ?? "";
		if (
			blocks.length === 2 &&
			previous.endsWith("\u8d62\u5b8b") &&
			last.startsWith("\u7a84\u4f53")
		) {
			return content;
		}
	}
	throw new Error("failed to construct adjacent Han chunk boundary content");
}
function buildAdjacentSingletonHanChunkBoundaryContent(
	anchorText: string,
	singletonChar: string,
): string {
	for (let charCount = 900; charCount <= 4000; charCount += 1) {
		const content = `${"x".repeat(charCount)}${anchorText}${singletonChar}`;
		const blocks = splitBodyBlocks(content);
		const previous = blocks[0]?.normalizedText ?? "";
		const last = blocks[1]?.normalizedText ?? "";
		if (
			blocks.length === 2 &&
			previous.endsWith(anchorText) &&
			last.startsWith(singletonChar)
		) {
			return content;
		}
	}
	throw new Error("failed to construct adjacent singleton Han chunk boundary content");
}

describe("coverage lexical v3 engine", () => {
	test("search read path builds candidates and ranks the stronger packed document first", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
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
		engine.buildResidentIndexView([
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

	test("short exact latin units do not prevent fuzzy rescue for a neighboring typo", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "all_notes/unsorted/focus.md",
				basename: "Focus on working IN Obsidian, not ON Obsidian",
				folder: "all_notes/unsorted",
				content:
					"# Focus on working IN Obsidian, not ON Obsidian\n\nObsidian, not ON Obsidian.",
			}),
		]);

		const prepared = engine.prepareSearch(
			"focus on workig in",
			["focus", "workig"],
			{ allowFuzzyMatch: true, allowPrefixMatch: true },
		);
		expect(prepared.queryAnalysis.primaryUnits.map((unit) => unit.text)).toEqual([
			"focus",
			"workig",
		]);
		const workigMatches = prepared.unitFamilyMatches.find(
			(unitMatches) => unitMatches.queryUnitText === "workig",
		);

		expect(workigMatches?.matches).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					familyText: "working",
					matchKind: "fuzzy",
					editDistance: 1,
				}),
			]),
		);
	});

	test("han tokenizer real terms become the only primary units for ranking", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf": ["\u7cfb\u7edf"],
			"\u4ee3\u7406": ["\u4ee3\u7406"],
			"\u7cfb\u7edf\u4ee3\u7406": ["\u7cfb\u7edf\u4ee3\u7406"],
		});
		engine.buildResidentIndexView(
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

	test("whole-surface Han tokenizer terms still participate as real primary units", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u4e0a\u9762": ["\u4e0a\u9762"],
			"\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684": [
				"\u4e5f\u662f",
				"\u4e0a\u9762",
				"\u8fd9\u4f4d",
				"\u5f00\u53d1",
			],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/above-note.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u4e5f\u662f\u4e0a\u9762\u8fd9\u4f4d\u5f00\u53d1\u7684",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u4e0a\u9762", ["\u4e0a\u9762"]);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u4e0a\u9762", source: "han_tokenizer_real" },
		]);
		expect(result.recallState.queryAnalysis.hanBackstopGroups).toHaveLength(0);
		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/above-note.md",
		]);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u4e0a\u9762"]);
	});

	test("stable Han query cover lets split real terms match a longer basename surface", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u8d62\u5b8b\u7a84\u4f53\u5b8b": ["\u8d62\u5b8b", "\u7a84\u4f53"],
			"\u8d62\u5b8b": ["\u8d62\u5b8b"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/winsong-narrow.md",
					basename: "\u8d62\u5b8b\u7a84\u4f53\u5b8b",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/winsong-only.md",
					basename: "\u8d62\u5b8b",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u8d62\u5b8b\u7a84\u4f53",
			["\u8d62\u5b8b\u7a84\u4f53", "\u8d62\u5b8b", "\u7a84\u4f53"],
		);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u8d62\u5b8b", source: "han_tokenizer_real" },
			{ text: "\u7a84\u4f53", source: "han_tokenizer_real" },
		]);
		expect(result.rankedCandidates[0].path).toBe("zh/winsong-narrow.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(2);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u8d62\u5b8b", "\u7a84\u4f53"]);
	});

	test("family-verified Han recall planning falls back to whole-group bigrams when query segmentation drifts", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u8d62\u5b8b\u7a84\u4f53\u5b8b": ["\u8d62\u5b8b", "\u7a84\u4f53"],
			"\u8d62\u5b8b": ["\u8d62\u5b8b"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/winsong-narrow-body.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8d62\u5b8b\u7a84\u4f53\u5b8b",
				}),
				createDocument({
					path: "zh/winsong-only.md",
					basename: "\u8d62\u5b8b",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u8d62\u5b8b\u7a84\u4f53",
			["\u8d62", "\u5b8b\u7a84\u4f53"],
		);

		expect(result.recallState.queryAnalysis.surfaceGroups[0]?.queryResidualUniqueBigrams).toEqual([
			"\u8d62\u5b8b",
		]);
		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u5b8b\u7a84\u4f53", source: "han_tokenizer_real" },
		]);
		expect(result.recallState.unitFamilyMatches[0]?.matches).toEqual([]);
		expect(result.recallState.candidateDocs).toHaveLength(2);
		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/winsong-narrow-body.md",
			"zh/winsong-only.md",
		]);
		expect(result.rankedCandidates[0]?.completedHanSurfaceGroupCount).toBe(1);
		expect(result.rankedCandidates[1]?.completedHanSurfaceGroupCount).toBe(0);
	});

	test("fully covered Han real terms can still rescue through metadata when family lookup misses", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u8d62\u5b8b\u4f53": ["\u8d62\u5b8b\u4f53"],
			"\u666e\u901a": ["\u666e\u901a"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/fallback-hit.md",
					basename: "\u8d62\u5b8b\u4f53",
					folder: "zh",
					content: "\u666e\u901a",
				}),
				createDocument({
					path: "zh/distractor.md",
					basename: "\u666e\u901a",
					folder: "zh",
					content: "\u666e\u901a",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u8d62\u5b8b", ["\u8d62\u5b8b"]);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u8d62\u5b8b", source: "han_tokenizer_real" },
		]);
		expect(result.recallState.unitFamilyMatches[0]?.matches).toEqual([]);
		expect(result.recallState.queryAnalysis.surfaceGroups[0]?.queryResidualUniqueBigrams).toEqual([]);
		expect(result.recallState.candidateDocs).toHaveLength(1);
		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/fallback-hit.md",
		]);
		expect(result.rankedCandidates[0]?.realizedFamilies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					queryUnitText: "\u8d62\u5b8b",
					familyText: "\u8d62\u5b8b",
					matchKind: "opaque_exact",
				}),
			]),
		);
		expect(result.rankedCandidates[0]?.exactUnitCount).toBe(0);
	});

	test("body-only Han rescue activates when a fully covered real-term group has no family matches", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u8d62\u5b8b\u4f53": ["\u8d62\u5b8b\u4f53"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/body-fallback.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8d62\u5b8b\u4f53",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u8d62\u5b8b", ["\u8d62\u5b8b"]);

		expect(result.recallState.unitFamilyMatches[0]?.matches).toEqual([]);
		expect(result.recallState.queryAnalysis.surfaceGroups[0]?.queryResidualUniqueBigrams).toEqual([]);
		expect(result.recallState.candidateDocs).toHaveLength(1);
		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/body-fallback.md",
		]);
		expect(result.rankedCandidates[0]?.realizedFamilies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					queryUnitText: "\u8d62\u5b8b",
					familyText: "\u8d62\u5b8b",
					matchKind: "opaque_exact",
					inBestBodyWindow: true,
				}),
			]),
		);
	});

	test("global Han family ranks exact matches ahead of same-group opaque metadata docs", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u8d62\u5b8b": ["\u8d62\u5b8b"],
			"\u8d62\u5b8b\u4f53": ["\u8d62\u5b8b\u4f53"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/exact.md",
					basename: "\u8d62\u5b8b",
					folder: "zh",
					content: "\u666e\u901a",
				}),
				createDocument({
					path: "zh/fallback.md",
					basename: "\u8d62\u5b8b\u4f53",
					folder: "zh",
					content: "\u666e\u901a",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u8d62\u5b8b", ["\u8d62\u5b8b"]);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/exact.md",
			"zh/fallback.md",
		]);
		expect(result.rankedCandidates[0].realizedFamilies[0]).toEqual(
			expect.objectContaining({
				queryUnitText: "\u8d62\u5b8b",
				matchKind: "exact",
				inIdentity: true,
			}),
		);
		expect(result.rankedCandidates[1]).toEqual(
			expect.objectContaining({
				exactUnitCount: 0,
				strongestHanSurfaceCompletionTier: "identity",
			}),
		);
		expect(result.rankedCandidates[1].realizedFamilies[0]).toEqual(
			expect.objectContaining({
				queryUnitText: "\u8d62\u5b8b",
				matchKind: "opaque_exact",
				inIdentity: true,
			}),
		);
	});

	test("multiple Han surface groups resolve rescue independently even when they share a bigram", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u65e7\u8d62\u5b8b\u4f53": ["\u65e7\u8d62\u5b8b\u4f53"],
			"\u8d62\u5b8b\u4f53": ["\u8d62\u5b8b\u4f53"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/shared-bigram.md",
					basename: "\u65e7\u8d62\u5b8b\u4f53",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/second-group-only.md",
					basename: "\u8d62\u5b8b\u4f53",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u65e7\u8d62 abc \u8d62\u5b8b\u4f53",
			["\u65e7\u8d62", "\u8d62\u5b8b", "\u5b8b\u4f53"],
		);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/shared-bigram.md",
			"zh/second-group-only.md",
		]);
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(2);
		expect(result.rankedCandidates[1].completedHanSurfaceGroupCount).toBe(1);
		expect(result.rankedCandidates[0].realizedFamilies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					querySurfaceGroupIndex: 0,
					familyText: "\u65e7\u8d62",
					matchKind: "opaque_exact",
				}),
				expect.objectContaining({
					querySurfaceGroupIndex: 1,
					familyText: "\u8d62\u5b8b",
					matchKind: "opaque_exact",
				}),
				]
			),
		);
	});

	test("bridge bigrams can recall han candidates without inflating realized coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u59d4\u5458": ["\u59d4\u5458"],
			"\u957f\u5927": ["\u957f\u5927"],
			"\u5458\u957f": ["\u5458\u957f"],
		});
		engine.buildResidentIndexView(
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
		expect(result.rankedCandidates).toHaveLength(2);
		expect(result.rankedCandidates[0].path).toBe("zh/committee.md");
		expect(result.rankedCandidates[1].path).toBe("zh/bridge-only.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(1);
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(0);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u59d4\u5458"]);
	});

	test("mixed latin plus Han core ranking keeps the refine candidate and completion signal", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u751f\u547d\u529b": ["\u751f\u547d"],
			"abc \u4e0e\u751f\u547d\u5728\u8fd9\u91cc": ["abc", "\u751f\u547d", "\u8fd9\u91cc"],
			"\u751f\u547d\u529b\u5728\u8fd9\u91cc": ["\u751f\u547d", "\u8fd9\u91cc"],
			"\u53ea\u8c08\u751f\u547d": ["\u751f\u547d"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/abc-life.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "abc \u4e0e\u751f\u547d\u5728\u8fd9\u91cc",
				}),
				createDocument({
					path: "zh/life-force.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u751f\u547d\u529b\u5728\u8fd9\u91cc",
				}),
				createDocument({
					path: "zh/life-only.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u53ea\u8c08\u751f\u547d",
				}),
			],
			tokenizer,
		);

		const result = engine.search("abc \u751f\u547d\u529b", ["abc", "\u751f\u547d"]);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/life-force.md",
			"zh/abc-life.md",
			"zh/life-only.md",
		]);
		expect(
			result.rankedCandidates.find(
				(candidate) => candidate.path === "zh/life-force.md",
			)?.completedHanSurfaceGroupCount,
		).toBe(1);
		expect(
			result.rankedCandidates.find(
				(candidate) => candidate.path === "zh/abc-life.md",
			)?.completedHanSurfaceGroupCount,
		).toBe(0);
		expect(
			result.rankedCandidates.find(
				(candidate) => candidate.path === "zh/life-only.md",
			)?.completedHanSurfaceGroupCount,
		).toBe(0);
	});

	test("metadata opaque rescue uses the best single witness without cross-witness aggregation", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u661f\u7a79\u63a5\u53e3": [],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/single-witness.md",
					basename: "\u661f\u7a79\u63a5\u53e3",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/split-witness.md",
					basename: "\u661f\u7a79",
					folder: "zh",
					aliases: "\u63a5\u53e3",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u661f\u7a79\u63a5\u53e3");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/single-witness.md",
			"zh/split-witness.md",
		]);
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(3);
		expect(result.rankedCandidates[1].realizedCoverageCount).toBe(0);
		expect(result.rankedCandidates[1].hanStrongRescueGroupCount).toBe(0);
		expect(result.rankedCandidates[1].hanWeakRescueGroupCount).toBe(1);
		expect(result.rankedCandidates[1].hasOnlyWeakHanRescue).toBe(true);
	});

	test("adjacent Han chunk boundary evidence can rescue unresolved bigrams through continuous body locality", () => {
		const engine = new CoverageLexicalV3Engine();
		const adjacentHanChunkContent = buildAdjacentHanChunkBoundaryContent();
		const tokenizer = createDocumentTokenizer({
			"\u8d62\u5b8b\u7a84\u4f53": ["\u8d62\u5b8b"],
			"\u8d62\u5b8b": ["\u8d62\u5b8b"],
			"\u7a84\u4f53": ["\u7a84\u4f53"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/adjacent-han-chunks.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: adjacentHanChunkContent,
				}),
				createDocument({
					path: "zh/only-prefix.md",
					basename: "\u8d62\u5b8b",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u8d62\u5b8b\u7a84\u4f53", ["\u8d62\u5b8b"]);

		expect(result.rankedCandidates[0]?.path).toBe("zh/adjacent-han-chunks.md");
		expect(result.rankedCandidates[0]?.realizedFamilies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					queryUnitText: "\u8d62\u5b8b",
					matchKind: "exact",
				}),
				expect.objectContaining({
					queryUnitText: "\u8d62\u5b8b\u7a84\u4f53",
					matchKind: "opaque_exact",
					inBestBodyWindow: true,
				}),
			]),
		);
	});

	test("adjacent singleton Han completion can stay tight across a chunk boundary", () => {
		const engine = new CoverageLexicalV3Engine();
		const adjacentContent = buildAdjacentSingletonHanChunkBoundaryContent(
			"\u751f\u547d",
			"\u529b",
		);
		const tokenizer = createDocumentTokenizer({
			"\u751f\u547d\u529b": ["\u751f\u547d"],
			[adjacentContent]: ["\u751f\u547d"],
			"\u751f\u547d": ["\u751f\u547d"],
		});
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/life-force-adjacent.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: adjacentContent,
				}),
				createDocument({
					path: "zh/life-only.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u751f\u547d",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u751f\u547d\u529b", ["\u751f\u547d"]);

		expect(result.rankedCandidates[0]?.path).toBe("zh/life-force-adjacent.md");
		expect(result.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: true,
				matchSource: "body_adjacent_block",
				tier: "tight",
				bestAnchorKind: "exact",
				bestAnchorDistance: 0,
			}),
		);
		expect(result.rankedCandidates[1]?.singletonHanCompletion.matched).toBe(false);
	});

	test("rescue bigram does not satisfy singleton completion with its own overlapping char", () => {
		const engine = new CoverageLexicalV3Engine();
		const filler = "\u9694\u5f00\u5f88\u8fdc\u7684\u8bf4\u660e\u6587\u5b57".repeat(12);
		const rescueOnlyContent = `\u524d\u9762\u5148\u5199\u751f\u547d${filler}\u6700\u540e\u53ea\u7528\u547d\u529b\u6765\u6536\u5c3e\u3002`;
		const tokenizer: V3DocumentTokenizer = (text) =>
			text.includes("\u751f\u547d") ? ["\u751f\u547d"] : [];
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/rescue-only-overlap.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: rescueOnlyContent,
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u751f\u547d\u529b", ["\u751f\u547d"]);

		expect(result.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: false,
				matchSource: "none",
				tier: "none",
			}),
		);
	});

	test("matched bigram coverage removes singleton rescue when the query Han mask is fully covered", () => {
		const engine = new CoverageLexicalV3Engine();
		const filler = "\u9694\u5f00\u5f88\u8fdc\u7684\u8bf4\u660e\u6587\u5b57".repeat(12);
		const rescueBigramContent = `\u524d\u9762\u5148\u5199\u751f\u547d${filler}\u6700\u540e\u7528\u547d\u529b\u529b\u6765\u6536\u5c3e\u3002`;
		const exactOnlyContent = `\u524d\u9762\u5148\u5199\u751f\u547d${filler}\u6700\u540e\u53ea\u653e\u4e00\u4e2a\u529b\u5b57\u3002`;
		const tokenizer: V3DocumentTokenizer = (text) =>
			text.includes("\u751f\u547d") ? ["\u751f\u547d"] : [];
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/rescue-bigram-singleton.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: rescueBigramContent,
				}),
				createDocument({
					path: "zh/exact-only-singleton.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: exactOnlyContent,
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u751f\u547d\u529b", ["\u751f\u547d"]);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/rescue-bigram-singleton.md",
			"zh/exact-only-singleton.md",
		]);
		expect(result.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: false,
				matchSource: "none",
				tier: "none",
			}),
		);
		expect(result.rankedCandidates[1]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: false,
				matchSource: "none",
				tier: "none",
				bestAnchorKind: "none",
			}),
		);
	});

	test("any matched query bigram can seed residual singleton completion", () => {
		const engine = new CoverageLexicalV3Engine();
		const bigramAndSingletonContent = "\u524d\u9762\u5148\u5199\u8d62\u5b8ba\u529f\uff0c\u540e\u9762\u518d\u8865\u4e00\u4e9b\u8bf4\u660e\u3002";
		const bigramOnlyContent = "\u524d\u9762\u53ea\u5199\u8d62\u5b8ba\u5b57\uff0c\u540e\u9762\u4e0d\u518d\u51fa\u73b0\u5176\u4ed6\u76f8\u5173\u6c49\u5b57\u3002";
		const tokenizer: V3DocumentTokenizer = () => [];
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/win-song-gong.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: bigramAndSingletonContent,
				}),
				createDocument({
					path: "zh/win-song-only.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: bigramOnlyContent,
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u8d62\u5b8b\u529f");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/win-song-gong.md",
			"zh/win-song-only.md",
		]);
		expect(result.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: true,
				matchSource: "body_same_block",
				tier: "tight",
				bestAnchorKind: "bigram",
				singletonHanChar: "\u529f",
			}),
		);
		expect(result.rankedCandidates[1]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: false,
				matchSource: "none",
				tier: "none",
			}),
		);
	});

	test("residual singleton completion only uses anchors from its own Han surface group", () => {
		const engine = new CoverageLexicalV3Engine();
		const farFiller = "\u9694\u5f00\u5f88\u8fdc\u7684\u8bf4\u660e\u6587\u5b57".repeat(8);
		const tokenizer: V3DocumentTokenizer = () => [];
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/cross-group-singleton-anchor.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: `\u5b87\u5b99${farFiller}\u5929\u5730\u529b`,
				}),
			],
			tokenizer,
		);

		const query = "\u5b87\u5b99\u529b x \u5929\u5730";
		expect(analyzeQuery(query).surfaceGroups.map((group) => group.text)).toEqual([
			"\u5b87\u5b99\u529b",
			"x",
			"\u5929\u5730",
		]);

		const result = engine.search(query);

		expect(result.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: false,
				matchSource: "none",
				tier: "none",
			}),
		);
	});

	test("global residual singleton recall rescue admits both prefix-side and suffix-side singleton Han around a matched bigram", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer: V3DocumentTokenizer = () => [];
		engine.buildResidentIndexView(
			[
				createDocument({
					path: "zh/function-origin-winsong.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u529f\u80fd\u8bcd\u6e90\u8d62\u5b8b",
				}),
				createDocument({
					path: "zh/winsong-only.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u53ea\u5199\u8d62\u5b8b",
				}),
			],
			tokenizer,
		);

		const prefixSingletonResult = engine.search("\u529f\u8d62\u5b8b");
		expect(prefixSingletonResult.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/function-origin-winsong.md",
			"zh/winsong-only.md",
		]);
		expect(prefixSingletonResult.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: true,
				bestAnchorKind: "bigram",
				singletonHanChar: "\u529f",
			}),
		);

		const suffixSingletonResult = engine.search("\u8d62\u5b8b\u529f");
		expect(suffixSingletonResult.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/function-origin-winsong.md",
			"zh/winsong-only.md",
		]);
		expect(suffixSingletonResult.rankedCandidates[0]?.singletonHanCompletion).toEqual(
			expect.objectContaining({
				matched: true,
				bestAnchorKind: "bigram",
				singletonHanChar: "\u529f",
			}),
		);
	});

	test("core ranking keeps the completed Han surface witness candidate ahead before refine tier promotion", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u751f\u547d\u529b": ["\u751f\u547d"],
			"\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d\u529b\u8bad\u7ec3": ["\u8fd9\u91cc", "\u8bb0\u5f55", "\u751f\u547d", "\u8bad\u7ec3"],
			"\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d": ["\u8fd9\u91cc", "\u8bb0\u5f55", "\u751f\u547d"],
		});
		engine.buildResidentIndexView(
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
			"body_window",
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
		engine.buildResidentIndexView(
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
		engine.buildResidentIndexView(
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

	test("metadata split hit outranks same-block body hits that fail the approximate gap gate", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/split.md",
				basename: "cache",
				folder: "latin",
				content: "restore",
			}),
			createDocument({
				path: "latin/long-gap-body.md",
				basename: "notes",
				folder: "latin",
				content: `cache ${"a".repeat(170)} restore`,
			}),
		]);

		const result = engine.search("cache restore");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/split.md",
			"latin/long-gap-body.md",
		]);
		expect(result.rankedCandidates[0].identityContainer?.coveredDistinctUnitCount).toBe(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).toBeNull();
		expect(result.rankedCandidates[1].bodyWindowContainer).toBeNull();
	});

	test("adjacent chunk evidence can still form a bodyWindow with zero cross-block penalty", () => {
		const engine = new CoverageLexicalV3Engine();
		const adjacentChunkContent = buildAdjacentChunkBoundaryContent();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/same-block.md",
				basename: "notes",
				folder: "latin",
				content: "cache restore",
			}),
			createDocument({
				path: "latin/adjacent-chunks.md",
				basename: "notes",
				folder: "latin",
				content: adjacentChunkContent,
			}),
		]);

		const result = engine.search("cache restore");

		const sameBlockCandidate = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/same-block.md",
		);
		const adjacentChunkCandidate = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/adjacent-chunks.md",
		);

		expect(sameBlockCandidate?.bodyWindowContainer?.boundaryCrossingCount).toBe(0);
		expect(adjacentChunkCandidate?.bodyWindowContainer?.boundaryCrossingCount).toBe(1);
		expect(adjacentChunkCandidate?.bodyWindowContainer?.blockIds).toHaveLength(2);
	});

	test("same-block chain drift fails bodyWindow when head-tail span exceeds the approximate budget", () => {
		const engine = new CoverageLexicalV3Engine();
		const leftTerm = `left${"a".repeat(80)}`;
		const rightTerm = `right${"b".repeat(80)}`;
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/head-tail-span.md",
				basename: "notes",
				folder: "latin",
				content: `${leftTerm} ${rightTerm}`,
			}),
		]);

		const result = engine.search(`${leftTerm} ${rightTerm}`);

		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).toBeNull();
	});

	test("compact body evidence survives many short intervening tokens under approximate locality", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/compact-many-tokens.md",
				basename: "notes",
				folder: "latin",
				content: "alpha a a a a a omega",
			}),
		]);

		const result = engine.search("alpha omega");

		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).not.toBeNull();
		expect(result.rankedCandidates[0].bodyWindowContainer?.coveredDistinctUnitCount).toBe(2);
	});

	test("route stays corroborative when identity and body already explain the query, but becomes main evidence when it adds a missing unit", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/redundant-route.md",
				basename: "vector cache",
				folder: "latin",
				tags: "sdk cache",
				content: "vector cache restore note",
			}),
			createDocument({
				path: "latin/novel-route.md",
				basename: "cache note",
				folder: "latin",
				tags: "vector",
				content: "cache note",
			}),
		]);

		const result = engine.search("vector cache");
		const redundantRoute = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/redundant-route.md",
		);
		const novelRoute = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/novel-route.md",
		);

		expect(redundantRoute?.routeContainer).not.toBeNull();
		expect(redundantRoute?.strongestContainer?.tier).toBe("identity");
		expect(redundantRoute?.secondStrongestContainer?.tier).toBe("bodyWindow");
		expect(redundantRoute?.fragmentationPenalty.explanatoryContainerCount).toBe(2);
		expect(novelRoute?.routeContainer).not.toBeNull();
		expect(novelRoute?.strongestContainer?.tier).toBe("identity");
		expect(novelRoute?.secondStrongestContainer?.tier).toBe("route");
		expect(novelRoute?.fragmentationPenalty.explanatoryContainerCount).toBe(2);
	});

	test("vector cache canonical playbook stays in the top five when route support is only corroborative", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "pkm-en/projects/sdk/vector-cache.md",
				basename: "Vector cache playbook",
				folder: "pkm-en/projects/sdk",
				headings: "Eviction restore",
				aliases: "sdk cache restore;vector cache restore note",
				tags: "sdk cache",
				content:
					"vector cache eviction keeps sdk search warm after shard checkpoint restore",
			}),
			createDocument({
				path: "pkm-en/archive/vector-cache.md",
				basename: "Vector cache playbook",
				folder: "pkm-en/archive",
				headings: "Eviction restore",
				aliases: "archive cache restore",
				tags: "archive cache",
				content:
					"vector cache eviction keeps archive search warm after shard checkpoint restore",
			}),
			createDocument({
				path: "pkm-en/inbox/restart-cache-after-outage.md",
				basename: "Restart cache after outage",
				folder: "pkm-en/inbox",
				headings: "Restart checklist",
				aliases: "vector cache crash note",
				tags: "inbox outage",
				content:
					"remember to restart cache after outage, restore vector cache shards, and verify checkpoint replay",
			}),
			createDocument({
				path: "pkm-en/scratch/vector-cache-migration.md",
				basename: "Vector cache migration",
				folder: "pkm-en/scratch",
				headings: "Migration scratch",
				content:
					"scratch thoughts about vector cache migration, hotfixes, and unstable warm restart ideas",
			}),
			createDocument({
				path: "pkm-en/ops/vector-cache-hotfix.md",
				basename: "Vector cache hotfix",
				folder: "pkm-en/ops",
				headings: "Hotfix steps",
				content:
					"ops hotfix for vector cache crash handling after outage with follow up verification steps",
			}),
			createDocument({
				path: "pkm-en/incidents/vector-cache-postmortem.md",
				basename: "Vector cache postmortem",
				folder: "pkm-en/incidents",
				headings: "Postmortem notes",
				aliases: "vector cache outage follow up",
				tags: "incident postmortem",
				content:
					"vector cache outage postmortem covers warm restart, replay gaps, mitigation, and follow up actions",
			}),
		]);

		const result = engine.search("vector cache");
		const targetIndex = result.rankedCandidates.findIndex(
			(candidate) => candidate.path === "pkm-en/projects/sdk/vector-cache.md",
		);
		const aliasBackedIndex = result.rankedCandidates.findIndex(
			(candidate) => candidate.path === "pkm-en/inbox/restart-cache-after-outage.md",
		);
		const target = result.rankedCandidates[targetIndex];

		expect(targetIndex).toBeGreaterThanOrEqual(0);
		expect(targetIndex).toBeLessThan(5);
		expect(aliasBackedIndex).toBeGreaterThan(targetIndex);
		expect(target?.routeContainer).not.toBeNull();
		expect(target?.strongestContainer?.tier).toBe("identity");
		expect(target?.secondStrongestContainer?.tier).toBe("bodyWindow");
		expect(target?.fragmentationPenalty.explanatoryContainerCount).toBe(2);
		expect(target?.metadataPackingSignature.basenameUnitCount).toBeGreaterThan(0);
	});

	test("basename exact beats alias exact when exact counts tie", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/canonical-vector-cache.md",
				basename: "vector cache",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "latin/alias-vector-cache.md",
				basename: "restart note",
				folder: "latin",
				aliases: "vector cache",
				content: "plain note",
			}),
		]);

		const result = engine.search("vector cache");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/canonical-vector-cache.md",
			"latin/alias-vector-cache.md",
		]);
		expect(result.rankedCandidates[0].exactUnitCount).toBe(
			result.rankedCandidates[1].exactUnitCount,
		);
		expect(result.rankedCandidates[0].metadataPackingSignature.basenameUnitCount).toBe(2);
		expect(result.rankedCandidates[1].metadataPackingSignature.aliasUnitCount).toBe(2);
	});

	test("mixed basename and alias hits use best-source-only metadata packing", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/mixed-source.md",
				basename: "vector cache",
				folder: "latin",
				aliases: "vector cache crash note",
				content: "plain note",
			}),
		]);

		const result = engine.search("vector cache");
		const candidate = result.rankedCandidates[0];

		expect(candidate.metadataPackingSignature.basenameUnitCount).toBe(2);
		expect(candidate.metadataPackingSignature.aliasUnitCount).toBe(0);
		expect(candidate.realizedFamilies.every((family) => family.metadataPackingSource === "basename")).toBe(
			true,
		);
	});

	test("prefix-only body hits prefer smaller completion gain and then non-compound tokens", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
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

	test("mixed standalone and compound support does not count as compound-only backing", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/preference.md",
				basename: "notes",
				folder: "latin",
				content: "preference",
			}),
			createDocument({
				path: "latin/prefer-mixed.md",
				basename: "notes",
				folder: "latin",
				content: "prefer prefer-cache",
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
			"latin/prefer-mixed.md",
			"latin/preference.md",
			"latin/prefer-compound.md",
		]);
		expect(result.rankedCandidates[0].compoundBackedPrefixCount).toBe(0);
		expect(result.rankedCandidates[0].compoundPrefixCount).toBe(0);
		expect(result.rankedCandidates[2].compoundBackedPrefixCount).toBe(1);
	});

	test("fuzzy rescue can recover realized coverage without outranking exact peers", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentIndexView([
			createDocument({
				path: "latin/exact-obsidian.md",
				basename: "obsidian",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "latin/fuzzy-obsidian.md",
				basename: "notes",
				folder: "latin",
				aliases: "obsidian",
				content: "plain note",
			}),
		]);

		const typoResult = engine.search("obsidan");
		expect(
			typoResult.rankedCandidates.some((candidate) => candidate.fuzzyUnitCount === 1),
		).toBe(true);
		expect(
			typoResult.rankedCandidates.some((candidate) =>
				candidate.realizedFamilies.some((family) => family.matchKind === "fuzzy"),
			),
		).toBe(true);

		const exactResult = engine.search("obsidian");
		expect(exactResult.rankedCandidates[0].path).toBe("latin/exact-obsidian.md");
		expect(exactResult.rankedCandidates[0].strongestContainer?.tier).toBe("identity");
	});
});
