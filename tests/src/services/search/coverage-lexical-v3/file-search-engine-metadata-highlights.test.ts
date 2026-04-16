jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type {
	BodyWindowContainer,
	EvidencePackingProfile,
} from "src/services/search/coverage-lexical-v3/ranking/types";
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

function createBodyWindowContainer(blockIds: readonly number[]): BodyWindowContainer {
	return {
		tier: "bodyWindow",
		blockIds,
		boundaryCrossingCount: Math.max(0, blockIds.length - 1),
		coveredUnitIndices: [0],
		coveredDistinctUnitCount: 1,
		containerCompactness: 260,
		exactUnitCount: 1,
		windowWidth: 1,
		gapCount: 0,
		density: 1,
		headingCorroboration: {
			coveredUnitIndices: [],
			unitCount: 0,
		},
	};
}

function createPackingProfile(
	overrides: Partial<EvidencePackingProfile> &
		Pick<EvidencePackingProfile, "docId" | "path">,
): EvidencePackingProfile {
	return {
		docId: overrides.docId,
		path: overrides.path,
		stableKey: overrides.stableKey ?? overrides.path,
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "h",
		realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
		coverageGate: overrides.coverageGate ?? {
			realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
			fullySatisfiedSurfaceGroupCount: 1,
			startedSurfaceGroupCount: 1,
			crossScriptSatisfiedGroupCount: 1,
		},
		exactUnitCount: overrides.exactUnitCount ?? 1,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 1,
		hanSurfaceCompletionTierScoreTotal:
			overrides.hanSurfaceCompletionTierScoreTotal ?? 1,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "body_residue",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [
			{
				surfaceGroupIndex: 0,
				surfaceText: "lifeforce",
				tier: "body_residue",
			},
		],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		realizedFamilies: overrides.realizedFamilies ?? [
			{
				queryUnitIndex: 0,
				queryUnitText: "life",
				familyId: 0,
				familyText: "life",
				matchKind: "exact",
				inIdentity: false,
				inRoute: false,
				inHeading: false,
				inBestBodyWindow: true,
				inBodyResidue: false,
			},
		],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? createBodyWindowContainer([0]),
		strongestContainer: overrides.strongestContainer ?? createBodyWindowContainer([0]),
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				activeContainerCount: 1,
			},
	};
}

function sliceHighlights(
	text: string,
	ranges: readonly { start: number; end: number }[] | undefined,
): string[] {
	return (ranges ?? []).map((range) => text.slice(range.start, range.end));
}

function installTokenizer(): void {
	container.registerInstance(Tokenizer, {
		tokenizeSequence: (text: string) =>
			text
				.split(/\s+/u)
				.map((token) => token.trim())
				.filter((token) => token.length > 0),
	} as unknown as Tokenizer);
}

describe("coverage lexical v3 file search engine metadata highlights", () => {
	test("searchFiles highlights basename and folder exact matches for metadata fields", async () => {
		installTokenizer();
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "infra/runtime/runtime-note.md",
				basename: "runtime note",
				folder: "infra/runtime/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: "runtime",
					normalizedQueryText: "runtime",
					surfaceGroups: [{ index: 0, text: "runtime", kind: "latin" }],
					primaryUnits: [
						{
							index: 0,
							text: "runtime",
							source: "surface",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "l",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "infra/runtime/runtime-note.md",
					hanSurfaceCompletionGroups: [],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: "runtime",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(sliceHighlights("runtime note", matchedFiles[0]?.basenameHighlightRanges)).toEqual([
			"runtime",
		]);
		expect(
			sliceHighlights("infra/runtime/", matchedFiles[0]?.folderHighlightRanges),
		).toEqual(["runtime"]);
	});

	test("searchFiles highlights a full Han basename surface instead of the shorter real term", async () => {
		installTokenizer();
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "zh/cache-guide.md",
				basename: "缓存恢复步骤说明",
				folder: "zh/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "zh/cache-guide.md",
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "identity" },
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 4,
					strongestHanSurfaceCompletionTier: "identity",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		const highlights = sliceHighlights(
			"缓存恢复步骤说明",
			matchedFiles[0]?.basenameHighlightRanges,
		);
		expect(highlights).toContain(fullSurface);
		expect(highlights).not.toContain(shorterTerm);
	});

	test("searchFiles adds display-only residual support for basename Han highlights", async () => {
		installTokenizer();
		const engine = new CoverageLexicalV3FileSearchEngine();
		const fullSurface = "上面这笔记";
		await engine.reIndexAll([
			createDocument({
				path: "zh/bridge.md",
				basename: "上面这位笔记",
				folder: "zh/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: "上面",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
						{
							index: 1,
							text: "笔记",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [
						{
							surfaceGroupIndex: 0,
							normalizedText: "这",
							bigrams: ["面这", "这笔"],
							charLength: 1,
							triggerKind: "bridge_bigram",
						},
					],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "zh/bridge.md",
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		const highlights = sliceHighlights(
			"上面这位笔记",
			matchedFiles[0]?.basenameHighlightRanges,
		);
		expect(highlights).toContain("上面这");
		expect(highlights).toContain("笔记");
		expect(highlights).not.toContain(fullSurface);
	});

	test("searchFiles keeps folder residual support inside a single path segment", async () => {
		installTokenizer();
		const engine = new CoverageLexicalV3FileSearchEngine();
		const fullSurface = "上面这笔记";
		await engine.reIndexAll([
			createDocument({
				path: "项目/上面/笔记/bridge.md",
				basename: "bridge",
				folder: "项目/上面/笔记/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: "上面",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
						{
							index: 1,
							text: "笔记",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [
						{
							surfaceGroupIndex: 0,
							normalizedText: "这",
							bigrams: ["面这", "这笔"],
							charLength: 1,
							triggerKind: "bridge_bigram",
						},
					],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "项目/上面/笔记/bridge.md",
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		const highlights = sliceHighlights(
			"项目/上面/笔记/",
			matchedFiles[0]?.folderHighlightRanges,
		);
		expect(highlights).toContain("上面");
		expect(highlights).toContain("笔记");
		expect(highlights).not.toContain("上面这");
		expect(highlights).not.toContain(fullSurface);
	});

	test("searchFiles highlights a full Han surface inside a single folder segment", async () => {
		installTokenizer();
		const engine = new CoverageLexicalV3FileSearchEngine();
		const shorterTerm = "缓存恢复";
		const fullSurface = "缓存恢复步骤";
		await engine.reIndexAll([
			createDocument({
				path: "资料/缓存恢复步骤/guide.md",
				basename: "guide",
				folder: "资料/缓存恢复步骤/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: shorterTerm,
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "资料/缓存恢复步骤/guide.md",
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "route" },
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 3,
					strongestHanSurfaceCompletionTier: "route",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		const highlights = sliceHighlights(
			"资料/缓存恢复步骤/",
			matchedFiles[0]?.folderHighlightRanges,
		);
		expect(highlights).toContain(fullSurface);
		expect(highlights).not.toContain(shorterTerm);
	});

	test("searchFiles does not share Han residual evidence across basename and folder", async () => {
		installTokenizer();
		const engine = new CoverageLexicalV3FileSearchEngine();
		const fullSurface = "上面这笔记";
		await engine.reIndexAll([
			createDocument({
				path: "资料/笔记/上面.md",
				basename: "上面",
				folder: "资料/笔记/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: fullSurface,
					normalizedQueryText: fullSurface,
					surfaceGroups: [{ index: 0, text: fullSurface, kind: "han" }],
					primaryUnits: [
						{
							index: 0,
							text: "上面",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
						{
							index: 1,
							text: "笔记",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [
						{
							surfaceGroupIndex: 0,
							normalizedText: "这",
							bigrams: ["面这", "这笔"],
							charLength: 1,
							triggerKind: "bridge_bigram",
						},
					],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "资料/笔记/上面.md",
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(sliceHighlights("上面", matchedFiles[0]?.basenameHighlightRanges)).toEqual([
			"上面",
		]);
		expect(sliceHighlights("资料/笔记/", matchedFiles[0]?.folderHighlightRanges)).toEqual([
			"笔记",
		]);
	});
});
