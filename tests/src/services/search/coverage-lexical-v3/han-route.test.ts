import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import {
	buildHanRouteArena,
	decodeBodyHanPosting,
} from "src/services/search/coverage-lexical-v3/layout/han-route";
import {
	encodeHanBigramId,
	type V3DocumentTokenizer,
} from "src/services/search/coverage-lexical-v3/query";
import { collectHanBodyBlockIds } from "src/services/search/coverage-lexical-v3/recall/access";

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
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(expect.arrayContaining(["\u7f13\u5b58", "\u5b58\u6062", "\u6062\u590d"]));
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
		expect(result.rankedCandidates).toHaveLength(2);
		expect(result.rankedCandidates[0].path).toBe("zh/opaque-exact.md");
		expect(result.rankedCandidates[1].path).toBe("zh/partial-route.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(3);
		expect(result.rankedCandidates[0].exactUnitCount).toBe(0);
		expect(result.rankedCandidates[0].realizedFamilies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					queryUnitText: "\u661f\u7a79",
					matchKind: "opaque_exact",
				}),
				expect.objectContaining({
					queryUnitText: "\u7a79\u63a5",
					matchKind: "opaque_exact",
				}),
				expect.objectContaining({
					queryUnitText: "\u63a5\u53e3",
					matchKind: "opaque_exact",
				}),
			]),
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

		expect(result.recallState.candidateDocs).toHaveLength(1);
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

		const postings = residentBase.hanRoute.bodyAdaptivePostings;

		expect(
			postings.singletonTermIds.length +
				postings.pairTermIds.length +
				postings.smallTermIds.length +
				postings.deltaTermIds.length,
		).toBeGreaterThan(0);
		expect(
			collectHanBodyBlockIds(residentBase, encodeHanBigramId("\u7f13\u5b58")),
		).toEqual([0]);
		expect(
			collectHanBodyBlockIds(residentBase, encodeHanBigramId("\u6269\u5bb9")),
		).toHaveLength(1);
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

		const postings = residentBase.hanRoute.bodyAdaptivePostings;

		expect(residentBase.hanRoute.metadataPostingStarts.length).toBe(
			residentBase.hanRoute.bigramIds.length + 1,
		);
		expect(postings.smallValueStarts.length).toBe(postings.smallTermIds.length);
		expect(postings.deltaTapeStarts.length).toBe(postings.deltaTermIds.length);
		expect(residentBase.metrics.hanRouteBodyBigramIdsBytes).toBeGreaterThan(0);
	});

	test("body Han adaptive codec splits singleton pair small and delta lanes", () => {
		const arena = buildHanRouteArena({
			bigramIds: [],
			metadataDocIdsByBigram: [],
			bodyPostingsByBigramId: new Map([
				[11, [3]],
				[12, [1, 4]],
				[13, [0, 2, 5]],
				[14, [0, 1, 2, 3, 4, 5, 6, 7, 8]],
			]),
			identityWitnessStringIdsByDoc: [],
			identityWitnessSourceMasksByDoc: [],
			routeWitnessStringIdsByDoc: [],
			routeWitnessSourceMasksByDoc: [],
			headingWitnessStringIdsByDoc: [],
			bodyWitnessStringIdsByBlock: [],
		});

		expect(Array.from(arena.bodyAdaptivePostings.singletonTermIds)).toEqual([11]);
		expect(Array.from(arena.bodyAdaptivePostings.pairTermIds)).toEqual([12]);
		expect(Array.from(arena.bodyAdaptivePostings.smallTermIds)).toEqual([13]);
		expect(Array.from(arena.bodyAdaptivePostings.deltaTermIds)).toEqual([14]);
		expect(decodeBodyHanPosting(arena, 11)).toEqual([3]);
		expect(decodeBodyHanPosting(arena, 12)).toEqual([1, 4]);
		expect(decodeBodyHanPosting(arena, 13)).toEqual([0, 2, 5]);
		expect(decodeBodyHanPosting(arena, 14)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
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
