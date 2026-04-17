jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type { EvidencePackingProfile } from "src/services/search/coverage-lexical-v3/ranking/types";
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
		generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function createPackingProfile(
	overrides: Partial<EvidencePackingProfile> & Pick<EvidencePackingProfile, "docId" | "path">,
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
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 0,
		hanSurfaceCompletionTierScoreTotal:
			overrides.hanSurfaceCompletionTierScoreTotal ?? 0,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "none",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		fuzzyUnitCount: overrides.fuzzyUnitCount ?? 0,
		fuzzyEditDistanceTotal: overrides.fuzzyEditDistanceTotal ?? 0,
		metadataPackingSignature: overrides.metadataPackingSignature ?? {
			basenameUnitCount: 0,
			aliasUnitCount: 0,
			routeUnitCount: 0,
			sortedBuckets: [],
		},
		realizedFamilies: overrides.realizedFamilies ?? [],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? null,
		strongestContainer: overrides.strongestContainer ?? null,
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 0,
			},
	};
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

function sliceHighlights(
	text: string,
	ranges: readonly { start: number; end: number }[] | undefined,
): string[] {
	return (ranges ?? []).map((range) => text.slice(range.start, range.end));
}

function createMockEngineResult(
	queryAnalysis: CoverageLexicalV3SearchResult["recallState"]["queryAnalysis"],
	candidate: EvidencePackingProfile,
): CoverageLexicalV3SearchResult {
	return {
		recallState: {
			queryAnalysis,
			unitFamilyMatches: [],
			candidateDocs: [],
		},
		rankedCandidates: [candidate],
	};
}

describe("coverage lexical v3 file search engine metadata highlights", () => {
	beforeEach(() => {
		installTokenizer();
	});

	test("searchFiles highlights basename exact matches and folder prefix matches by realized family text", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "infra/runtime/runtime-note.md",
				basename: "runtime note",
				folder: "infra/runtime/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn(() =>
			createMockEngineResult(
				{
					queryText: "runtime",
					normalizedQueryText: "runtime",
					surfaceGroups: [
						{
							index: 0,
							text: "runtime",
							kind: "latin",
							hanBigramTexts: [],
							coveredCharMask: [],
							queryResidualUniqueBigrams: [],
							hasQueryResidualHanCoverage: false,
						},
					],
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
				createPackingProfile({
					docId: 0,
					path: "infra/runtime/runtime-note.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: "runtime",
							querySurfaceGroupIndex: 0,
							familyId: 1,
							familyText: "runtime",
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "basename",
							routeMetadataSource: "folder",
							metadataPackingSource: "basename",
							inIdentity: true,
							inRoute: true,
							inHeading: false,
							inBestBodyWindow: false,
							inBodyResidue: false,
						},
					],
				}),
			),
		);
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
		expect(sliceHighlights("infra/runtime/", matchedFiles[0]?.folderHighlightRanges)).toEqual([
			"runtime",
		]);
	});

	test("searchFiles highlights fuzzy metadata matches as weak ranges", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "notes/runtime-obsidian.md",
				basename: "obsidian runtime guide",
				folder: "notes/runtime/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn(() =>
			createMockEngineResult(
				{
					queryText: "obsidan runtime",
					normalizedQueryText: "obsidan runtime",
					surfaceGroups: [
						{
							index: 0,
							text: "obsidan",
							kind: "latin",
							hanBigramTexts: [],
							coveredCharMask: [],
							queryResidualUniqueBigrams: [],
							hasQueryResidualHanCoverage: false,
						},
						{
							index: 1,
							text: "runtime",
							kind: "latin",
							hanBigramTexts: [],
							coveredCharMask: [],
							queryResidualUniqueBigrams: [],
							hasQueryResidualHanCoverage: false,
						},
					],
					primaryUnits: [
						{ index: 0, text: "obsidan", source: "surface", surfaceGroupIndex: 0 },
						{ index: 1, text: "runtime", source: "surface", surfaceGroupIndex: 1 },
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "ll",
				},
				createPackingProfile({
					docId: 0,
					path: "notes/runtime-obsidian.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: "obsidan",
							querySurfaceGroupIndex: 0,
							familyId: 1,
							familyText: "obsidian",
							matchKind: "fuzzy",
							editDistance: 1,
							identityMetadataSource: "basename",
							routeMetadataSource: "none",
							metadataPackingSource: "basename",
							inIdentity: true,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: false,
							inBodyResidue: false,
						},
						{
							queryUnitIndex: 1,
							queryUnitText: "runtime",
							querySurfaceGroupIndex: 1,
							familyId: 2,
							familyText: "runtime",
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "basename",
							routeMetadataSource: "folder",
							metadataPackingSource: "basename",
							inIdentity: true,
							inRoute: true,
							inHeading: false,
							inBestBodyWindow: false,
							inBodyResidue: false,
						},
					],
				}),
			),
		);
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
			queryText: "obsidan runtime",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(
			sliceHighlights(
				"obsidian runtime guide",
				matchedFiles[0]?.basenameWeakHighlightRanges,
			),
		).toContain("obsidian");
		expect(
			sliceHighlights(
				"obsidian runtime guide",
				matchedFiles[0]?.basenameHighlightRanges,
			),
		).toContain("runtime");
	});

	test("searchFiles prefers a full Han surface over the shorter covered real term in basename", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "zh/cache-guide.md",
				basename: "生命力档案",
				folder: "zh/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn(() =>
			createMockEngineResult(
				{
					queryText: "生命力",
					normalizedQueryText: "生命力",
					surfaceGroups: [
						{
							index: 0,
							text: "生命力",
							kind: "han",
							hanBigramTexts: ["生命", "命力"],
							coveredCharMask: [true, true, false],
							queryResidualUniqueBigrams: ["命力"],
							hasQueryResidualHanCoverage: true,
						},
					],
					primaryUnits: [
						{
							index: 0,
							text: "生命",
							source: "han_tokenizer_real",
							surfaceGroupIndex: 0,
						},
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				createPackingProfile({
					docId: 0,
					path: "zh/cache-guide.md",
					realizedFamilies: [
						{
							queryUnitIndex: 0,
							queryUnitText: "生命",
							querySurfaceGroupIndex: 0,
							familyId: 1,
							familyText: "生命",
							matchKind: "exact",
							editDistance: 0,
							identityMetadataSource: "basename",
							routeMetadataSource: "none",
							metadataPackingSource: "basename",
							inIdentity: true,
							inRoute: false,
							inHeading: false,
							inBestBodyWindow: false,
							inBodyResidue: false,
						},
					],
				}),
			),
		);
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
			queryText: "生命力",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		const highlights = sliceHighlights("生命力档案", matchedFiles[0]?.basenameHighlightRanges);
		expect(highlights).toContain("生命力");
		expect(highlights).not.toContain("生命");
	});

	test("searchFiles keeps Han opaque bigram highlights inside the best single witness", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "资料/命力/生命.md",
				basename: "生命",
				folder: "资料/命力/",
				content: "placeholder",
			}),
		]);
		const search = jest.fn(() =>
			createMockEngineResult(
				{
					queryText: "生命力",
					normalizedQueryText: "生命力",
					surfaceGroups: [
						{
							index: 0,
							text: "生命力",
							kind: "han",
							hanBigramTexts: ["生命", "命力"],
							coveredCharMask: [false, false, false],
							queryResidualUniqueBigrams: ["生命", "命力"],
							hasQueryResidualHanCoverage: true,
						},
					],
					primaryUnits: [],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				createPackingProfile({
					docId: 0,
					path: "资料/命力/生命.md",
				}),
			),
		);
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
			queryText: "生命力",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(sliceHighlights("生命", matchedFiles[0]?.basenameHighlightRanges)).toEqual(["生命"]);
		expect(sliceHighlights("资料/命力/", matchedFiles[0]?.folderHighlightRanges)).toEqual([]);
	});
});
