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

describe("coverage lexical v3 han route", () => {
	test("metadata han route can recall a candidate before han exact confirmation", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "zh/cache-guide.md",
				basename: "\u5173\u4e8e\u7f13\u5b58\u6062\u590d\u8bf4\u660e",
				folder: "zh",
				content: "\u666e\u901a\u8bf4\u660e",
			}),
			createDocument({
				path: "zh/other.md",
				basename: "\u5173\u4e8e\u7f13\u5b58\u6269\u5bb9\u8bf4\u660e",
				folder: "zh",
				content: "\u522b\u7684\u8bf4\u660e",
			}),
		]);

		const result = engine.search("\u7f13\u5b58\u6062\u590d");
		const recalled = result.recallState.candidateDocs.find(
			(candidate) => candidate.docId === result.rankedCandidates[0].docId,
		);

		expect(result.recallState.queryAnalysis.hanBackstopGroups).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/cache-guide.md");
		expect(recalled?.hanMetadataGateStats).not.toBeNull();
		expect(recalled?.hanMetadataGateStats?.matchedBigramCount).toBeGreaterThan(0);
		expect(result.rankedCandidates[0].realizedFamilies[0].familyText).toContain(
			"\u7f13\u5b58\u6062\u590d",
		);
	});

	test("body han route can shortlist blocks and exact confirm into body evidence", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u5173\u4e8e\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u4e0e\u70ed\u542f\u52a8\u8bb0\u5f55": [
				"\u5173\u4e8e",
				"\u7f13\u5b58",
				"\u6062\u590d",
				"\u6b65\u9aa4",
				"\u70ed\u542f\u52a8",
				"\u8bb0\u5f55",
			],
			"\u5173\u4e8e\u7f13\u5b58\u6269\u5bb9\u6b65\u9aa4\u4e0e\u70ed\u542f\u52a8\u8bb0\u5f55": [
				"\u5173\u4e8e",
				"\u7f13\u5b58",
				"\u6269\u5bb9",
				"\u6b65\u9aa4",
				"\u70ed\u542f\u52a8",
				"\u8bb0\u5f55",
			],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/body-hit.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content:
						"\u5173\u4e8e\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u4e0e\u70ed\u542f\u52a8\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/distractor.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content:
						"\u5173\u4e8e\u7f13\u5b58\u6269\u5bb9\u6b65\u9aa4\u4e0e\u70ed\u542f\u52a8\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u7f13\u5b58\u6062\u590d", ["\u7f13\u5b58", "\u6062\u590d"]);
		const topCandidate = result.rankedCandidates[0];
		const recalled = result.recallState.candidateDocs.find(
			(candidate) => candidate.docId === topCandidate.docId,
		);

		expect(topCandidate.path).toBe("zh/body-hit.md");
		expect(recalled?.shortlistedBodyBlockIds.length).toBeGreaterThan(0);
		expect(topCandidate.bodyWindowContainer).not.toBeNull();
		expect(topCandidate.realizedFamilies.map((family) => family.familyText)).toEqual([
			"\u7f13\u5b58",
			"\u6062\u590d",
		]);
	});

	test("han bigram gate stats do not enter final ordering once exact evidence exists", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7f13\u5b58\u6062\u590d": ["\u7f13\u5b58", "\u6062\u590d"],
			"\u5173\u4e8e\u7f13\u5b58\u6062\u590d\u8bf4\u660e": [
				"\u5173\u4e8e",
				"\u7f13\u5b58",
				"\u6062\u590d",
				"\u8bf4\u660e",
			],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/a.md",
					basename: "\u7f13\u5b58\u6062\u590d",
					folder: "zh",
					content: "\u666e\u901a\u5185\u5bb9",
				}),
				createDocument({
					path: "zh/z.md",
					basename: "\u7f13\u5b58\u6062\u590d",
					folder: "zh",
					headings: "\u5173\u4e8e\u7f13\u5b58\u6062\u590d\u8bf4\u660e",
					content: "\u666e\u901a\u5185\u5bb9",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u7f13\u5b58\u6062\u590d", ["\u7f13\u5b58", "\u6062\u590d"]);
		const secondCandidateRecall = result.recallState.candidateDocs.find(
			(candidate) =>
				result.rankedCandidates.some(
					(ranked) => ranked.docId === candidate.docId && ranked.path === "zh/z.md",
				),
		);

		expect(secondCandidateRecall).not.toBeUndefined();
		expect(result.rankedCandidates[0].path).toBe("zh/a.md");
		expect(result.rankedCandidates[1].path).toBe("zh/z.md");
	});

	test("zero-real-term han groups only gain coverage through opaque exact confirmation", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u661f\u7a79\u63a5\u53e3": [],
			"\u661f\u7a79\u63a5\u70b9": [],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/opaque-exact.md",
					basename: "\u661f\u7a79\u63a5\u53e3",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/partial-route.md",
					basename: "\u661f\u7a79\u63a5\u70b9",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u661f\u7a79\u63a5\u53e3", []);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u661f\u7a79\u63a5\u53e3", source: "opaque_han_confirmed" },
		]);
		expect(result.recallState.queryAnalysis.hanBackstopGroups).toEqual([
			expect.objectContaining({
				triggerKind: "whole_group_backstop",
				normalizedText: "\u661f\u7a79\u63a5\u53e3",
				bigrams: ["\u661f\u7a79", "\u7a79\u63a5", "\u63a5\u53e3"],
			}),
		]);
		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/opaque-exact.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(1);
		expect(result.rankedCandidates[0].exactUnitCount).toBe(0);
		expect(result.rankedCandidates[0].realizedFamilies[0]).toEqual(
			expect.objectContaining({
				queryUnitText: "\u661f\u7a79\u63a5\u53e3",
				matchKind: "opaque_exact",
			}),
		);
	});
});
