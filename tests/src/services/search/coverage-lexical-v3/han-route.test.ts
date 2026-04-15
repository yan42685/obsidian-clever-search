import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
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

function createHanSequence(length: number, startCodePoint = 0x4e00): string {
	return Array.from({ length }, (_, index) => String.fromCodePoint(startCodePoint + index)).join(
		"",
	);
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

	test("metadata han route stores union doc postings across identity and route only", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "zh/union.md",
				basename: "\u7f13\u5b58\u6062\u590d",
				folder: "zh",
				headings: "\u5173\u4e8e\u7f13\u5b58\u6062\u590d\u7684\u8865\u5145",
				content: "\u666e\u901a\u8bb0\u5f55",
			}),
		]);

		expect(residentBase.hanRoute.bigramIds.length).toBeGreaterThan(0);
		expect(residentBase.hanRoute.metadataPostingStarts.length).toBe(
			residentBase.hanRoute.bigramIds.length + 1,
		);
		for (let index = 0; index < residentBase.hanRoute.bigramIds.length; index += 1) {
			const start = residentBase.hanRoute.metadataPostingStarts[index] ?? 0;
			const end = residentBase.hanRoute.metadataPostingStarts[index + 1] ?? start;
			const docIds = Array.from(residentBase.hanRoute.metadataDocIds.slice(start, end));
			expect(new Set(docIds).size).toBe(docIds.length);
		}
	});

	test("heading-only Han route no longer admits docs through metadata gate", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "zh/heading-only.md",
				basename: "\u666e\u901a\u7b14\u8bb0",
				folder: "zh",
				headings: "\u7f13\u5b58\u6062\u590d",
				content: "\u666e\u901a\u8bb0\u5f55",
			}),
		]);

		const result = engine.search("\u7f13\u5b58\u6062\u590d");

		expect(result.recallState.candidateDocs).toHaveLength(0);
		expect(result.rankedCandidates).toHaveLength(0);
	});

	test("heading Han can still be admitted through body route when the content contains the heading text", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "zh/heading-in-body.md",
				basename: "\u666e\u901a\u7b14\u8bb0",
				folder: "zh",
				headings: "\u7f13\u5b58\u6062\u590d",
				content: "# \u7f13\u5b58\u6062\u590d\n\n\u666e\u901a\u8bb0\u5f55",
			}),
		]);

		const result = engine.search("\u7f13\u5b58\u6062\u590d");

		expect(result.recallState.candidateDocs).toHaveLength(1);
		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/heading-in-body.md");
	});

	test("logical block route does not shortlist blocks when the exact Han surface is split across separate segments", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "zh/split-segments.md",
				basename: "\u666e\u901a\u7b14\u8bb0",
				folder: "zh",
				content: "\u7f13\u5b58\u6062\u590d abc \u6269\u5bb9\u8bb0\u5f55",
			}),
		]);

		const result = engine.search("\u6062\u590d\u6269\u5bb9");

		expect(result.recallState.candidateDocs).toHaveLength(0);
		expect(result.rankedCandidates).toHaveLength(0);
	});

	test("body Han route stores direct body block postings", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "zh/logical-span.md",
				basename: "\u666e\u901a\u7b14\u8bb0",
				folder: "zh",
				content: "\u7f13\u5b58\u6062\u590d\n\n\u6269\u5bb9\u8bb0\u5f55",
			}),
		]);

		expect(residentBase.hanRoute.bodyBigramIds.length).toBeGreaterThan(0);
		expect(residentBase.hanRoute.bodyPostingStarts.length).toBe(
			residentBase.hanRoute.bodyBigramIds.length + 1,
		);
		expect(residentBase.hanRoute.bodyBlockIds.length).toBeGreaterThan(0);
	});

	test("body Han route keeps a sparse body-only bigram vocabulary", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "zh/sparse-body-route.md",
				basename: "\u8def\u7531\u89c4\u5212",
				folder: "zh",
				content: "\u7f13\u5b58\u6062\u590d",
			}),
		]);

		expect(Array.from(residentBase.hanRoute.bigramIds)).not.toEqual(
			Array.from(residentBase.hanRoute.bodyBigramIds),
		);
		expect(residentBase.hanRoute.metadataPostingStarts.length).toBe(
			residentBase.hanRoute.bigramIds.length + 1,
		);
		expect(residentBase.hanRoute.bodyPostingStarts.length).toBe(
			residentBase.hanRoute.bodyBigramIds.length + 1,
		);
	});

	test("oversized Han segments still admit cross-chunk surfaces through chunk route and full-segment confirm", () => {
		const longHan = createHanSequence(1100);
		const querySurface = Array.from(longHan).slice(1021, 1027).join("");
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "zh/oversized-segment.md",
				basename: "\u666e\u901a\u7b14\u8bb0",
				folder: "zh",
				content: longHan,
			}),
		]);

		const result = engine.search(querySurface);

		expect(result.recallState.candidateDocs).toHaveLength(1);
		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/oversized-segment.md");
		expect(
			result.recallState.candidateDocs[0]?.shortlistedBodyBlockIds.length,
		).toBeGreaterThan(0);
	});
});

