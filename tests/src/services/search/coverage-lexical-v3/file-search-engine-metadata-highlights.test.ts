jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import type {
	CoverageLexicalV3PreparedSearch,
	CoverageLexicalV3SearchResult,
} from "src/services/search/coverage-lexical-v3/engine";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type {
	V3QueryAnalysis,
	V3QuerySurfaceGroup,
} from "src/services/search/coverage-lexical-v3/query/analysis";
import type {
	EvidencePackingProfile,
	RealizedQueryUnitFamily,
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
		generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function createLatinSurfaceGroup(index: number, text: string): V3QuerySurfaceGroup {
	return {
		index,
		text,
		kind: "latin",
		hanBigramTexts: [],
		coveredCharMask: [],
		queryResidualUniqueBigrams: [],
		hasQueryResidualHanCoverage: false,
	};
}

function createHanSurfaceGroup(
	index: number,
	text: string,
	overrides: Partial<Pick<V3QuerySurfaceGroup, "coveredCharMask" | "queryResidualUniqueBigrams">> = {},
): V3QuerySurfaceGroup {
	const chars = Array.from(text);
	const hanBigramTexts = chars.slice(0, -1).map((_, charIndex) => {
		return chars[charIndex] + chars[charIndex + 1];
	});
	const queryResidualUniqueBigrams = overrides.queryResidualUniqueBigrams ?? hanBigramTexts;
	return {
		index,
		text,
		kind: "han",
		hanBigramTexts,
		coveredCharMask:
			overrides.coveredCharMask ?? Array.from({ length: chars.length }, () => false),
		queryResidualUniqueBigrams,
		hasQueryResidualHanCoverage: queryResidualUniqueBigrams.length > 0,
	};
}

function createLatinQueryAnalysis(queryText: string, terms: readonly string[]): V3QueryAnalysis {
	return {
		queryText,
		normalizedQueryText: queryText,
		querySingletonHanChar: null,
		querySingletonHanCodePoint: null,
		querySingletonHanRecallEligible: false,
		surfaceGroups: terms.map((term, index) => createLatinSurfaceGroup(index, term)),
		primaryUnits: terms.map((term, index) => ({
			index,
			text: term,
			source: "surface" as const,
			surfaceGroupIndex: index,
		})),
		hanBackstopGroups: [],
		surfaceCoverageShapeKey:
			terms.length === 0 ? "" : Array.from({ length: terms.length }, () => "l").join(""),
	};
}

function createHanQueryAnalysis(
	queryText: string,
	surfaceGroup: V3QuerySurfaceGroup,
	primaryUnitText: string | null,
): V3QueryAnalysis {
	return {
		queryText,
		normalizedQueryText: queryText,
		querySingletonHanChar: null,
		querySingletonHanCodePoint: null,
		querySingletonHanRecallEligible: false,
		surfaceGroups: [surfaceGroup],
		primaryUnits:
			primaryUnitText == null
				? []
				: [
					{
						index: 0,
						text: primaryUnitText,
						source: "han_tokenizer_real" as const,
						surfaceGroupIndex: surfaceGroup.index,
					},
				],
		hanBackstopGroups: [],
		surfaceCoverageShapeKey: "h",
	};
}

function createRealizedFamily(
	overrides: Partial<RealizedQueryUnitFamily> &
		Pick<
			RealizedQueryUnitFamily,
			"queryUnitIndex" | "queryUnitText" | "familyId" | "familyText"
		>,
): RealizedQueryUnitFamily {
	return {
		queryUnitIndex: overrides.queryUnitIndex,
		queryUnitText: overrides.queryUnitText,
		querySurfaceGroupIndex: overrides.querySurfaceGroupIndex ?? null,
		familyId: overrides.familyId,
		shardLocalFamilySlot: overrides.shardLocalFamilySlot ?? overrides.familyId,
		familyText: overrides.familyText,
		matchKind: overrides.matchKind ?? "exact",
		editDistance: overrides.editDistance ?? 0,
		identityMetadataSource: overrides.identityMetadataSource ?? "none",
		routeMetadataSource: overrides.routeMetadataSource ?? "none",
		metadataPackingSource: overrides.metadataPackingSource ?? "none",
		bodyPrefixSupportKind: overrides.bodyPrefixSupportKind ?? "none",
		inIdentity: overrides.inIdentity ?? false,
		inRoute: overrides.inRoute ?? false,
		inHeading: overrides.inHeading ?? false,
		inBestBodyWindow: overrides.inBestBodyWindow ?? false,
		inBodyResidue: overrides.inBodyResidue ?? false,
	};
}

function createPackingProfile(
	overrides: Partial<EvidencePackingProfile> & Pick<EvidencePackingProfile, "docId" | "path">,
): EvidencePackingProfile {
	return {
		docId: overrides.docId,
		liveDocSlot: overrides.liveDocSlot ?? overrides.docId,
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
		exactOrPrefixUnitCount:
			overrides.exactOrPrefixUnitCount ?? overrides.exactUnitCount ?? 1,
		exactUnitCount: overrides.exactUnitCount ?? 1,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 0,
		hanSurfaceCompletionTierScoreTotal:
			overrides.hanSurfaceCompletionTierScoreTotal ?? 0,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "none",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [],
		singletonHanCompletion: overrides.singletonHanCompletion ?? {
			singletonHanChar: null,
			singletonHanCharIndex: null,
			singletonHanSurfaceGroupIndex: null,
			matched: false,
			matchSource: "none",
			bestAnchorKind: "none",
			bestAnchorDistance: null,
			sameBlockAsAnchor: false,
			sameBlockAsBestBodyWindow: false,
			tier: "none",
		},
		hanStrongRescueGroupCount: overrides.hanStrongRescueGroupCount ?? 0,
		hanWeakRescueGroupCount: overrides.hanWeakRescueGroupCount ?? 0,
		hanRescueSupportWeightTotal: overrides.hanRescueSupportWeightTotal ?? 0,
		hasOnlyWeakHanRescue: overrides.hasOnlyWeakHanRescue ?? false,
		hasAnyHanRescueAssessment: overrides.hasAnyHanRescueAssessment ?? false,
		hanRescueAssessments: overrides.hanRescueAssessments ?? [],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundBackedPrefixCount: overrides.compoundBackedPrefixCount ?? 0,
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
	container.registerInstance(
		Tokenizer,
		{
			tokenizeSequence: (text: string) =>
				text
					.split(/\s+/u)
					.map((token) => token.trim())
					.filter((token) => token.length > 0),
		} as unknown as InstanceType<typeof Tokenizer>,
	);
}

function createSnapshotStoreStub() {
	return {
		readIndexedTexts: jest.fn(async () => new Map<string, string>()),
		readIndexedMetadata: jest.fn(async () => new Map()),
		readCurrentTexts: jest.fn(async () => new Map<string, string>()),
		publishIndexedTexts: jest.fn(async () => undefined),
		publishLexicalIndexedMetadata: jest.fn(async () => undefined),
		publishLexicalFuzzyRescue: jest.fn(async () => undefined),
		publishLexicalBodyEvidence: jest.fn(async () => undefined),
		publishLexicalHanDocEvidence: jest.fn(async () => undefined),
		publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
	};
}

function attachMockSearchPipeline(
	engine: CoverageLexicalV3FileSearchEngine,
	result: CoverageLexicalV3SearchResult,
): void {
	const preparedSearch: CoverageLexicalV3PreparedSearch = {
		queryText: result.recallState.queryAnalysis.queryText,
		queryTerms: result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text),
		queryAnalysis: result.recallState.queryAnalysis,
		unitFamilyMatches: [],
		guardedCandidateDocs: [],
	};
	const prepareSearch = jest.fn(() => preparedSearch);
	const hydrateRankingEvidenceForCandidates = jest.fn(async () => ({
		hydratedEvidenceByCandidateKey: new Map<string, unknown>(),
	}));
	const rankPreparedSearch = jest.fn(() => result);
	(engine as unknown as {
		engine: {
			prepareSearch: typeof prepareSearch;
			rankPreparedSearch: typeof rankPreparedSearch;
			getResidentBase: () => ResidentBase | null;
		};
		hydrateRankingEvidenceForCandidates: typeof hydrateRankingEvidenceForCandidates;
	}).engine = {
		prepareSearch,
		rankPreparedSearch,
		getResidentBase: () => null,
	};
	(engine as unknown as {
		hydrateRankingEvidenceForCandidates: typeof hydrateRankingEvidenceForCandidates;
	}).hydrateRankingEvidenceForCandidates = hydrateRankingEvidenceForCandidates;
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
		const snapshotStore = createSnapshotStoreStub();
		(engine as unknown as { getFileSnapshotStore: () => typeof snapshotStore }).getFileSnapshotStore = () => snapshotStore;
		await engine.reIndexAll([
			createDocument({
				path: "infra/runtime/runtime-note.md",
				basename: "runtime note",
				folder: "infra/runtime/",
				content: "placeholder",
			}),
		]);
		attachMockSearchPipeline(
			engine,
			createMockEngineResult(
				createLatinQueryAnalysis("runtime", ["runtime"]),
				createPackingProfile({
					docId: 0,
					path: "infra/runtime/runtime-note.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: "runtime",
							querySurfaceGroupIndex: 0,
							familyId: 1,
							familyText: "runtime",
							identityMetadataSource: "basename",
							routeMetadataSource: "folder",
							metadataPackingSource: "basename",
							inIdentity: true,
							inRoute: true,
						}),
					],
				}),
			),
		);

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
		const snapshotStore = createSnapshotStoreStub();
		(engine as unknown as { getFileSnapshotStore: () => typeof snapshotStore }).getFileSnapshotStore = () => snapshotStore;
		await engine.reIndexAll([
			createDocument({
				path: "notes/runtime-obsidian.md",
				basename: "obsidian runtime guide",
				folder: "notes/runtime/",
				content: "placeholder",
			}),
		]);
		attachMockSearchPipeline(
			engine,
			createMockEngineResult(
				createLatinQueryAnalysis("obsidan runtime", ["obsidan", "runtime"]),
				createPackingProfile({
					docId: 0,
					path: "notes/runtime-obsidian.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: "obsidan",
							querySurfaceGroupIndex: 0,
							familyId: 1,
							familyText: "obsidian",
							matchKind: "fuzzy",
							editDistance: 1,
							identityMetadataSource: "basename",
							metadataPackingSource: "basename",
							inIdentity: true,
						}),
						createRealizedFamily({
							queryUnitIndex: 1,
							queryUnitText: "runtime",
							querySurfaceGroupIndex: 1,
							familyId: 2,
							familyText: "runtime",
							identityMetadataSource: "basename",
							routeMetadataSource: "folder",
							metadataPackingSource: "basename",
							inIdentity: true,
							inRoute: true,
						}),
					],
				}),
			),
		);

		const matchedFiles = await engine.searchFiles({
			queryText: "obsidan runtime",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(sliceHighlights("obsidian runtime guide", matchedFiles[0]?.basenameWeakHighlightRanges)).toContain("obsidian");
		expect(sliceHighlights("obsidian runtime guide", matchedFiles[0]?.basenameHighlightRanges)).toContain("runtime");
	});

	test("searchFiles prefers a full Han surface over the shorter covered real term in basename", async () => {
		const fullSurface = "\u751f\u547d\u529b";
		const shorterTerm = "\u751f\u547d";
		const basename = "\u751f\u547d\u529b\u624b\u518c";
		const engine = new CoverageLexicalV3FileSearchEngine();
		const snapshotStore = createSnapshotStoreStub();
		(engine as unknown as { getFileSnapshotStore: () => typeof snapshotStore }).getFileSnapshotStore = () => snapshotStore;
		await engine.reIndexAll([
			createDocument({
				path: "zh/cache-guide.md",
				basename,
				folder: "zh/",
				content: "placeholder",
			}),
		]);
		attachMockSearchPipeline(
			engine,
			createMockEngineResult(
				createHanQueryAnalysis(
					fullSurface,
					createHanSurfaceGroup(0, fullSurface, {
						coveredCharMask: [true, true, false],
						queryResidualUniqueBigrams: ["\u547d\u529b"],
					}),
					shorterTerm,
				),
				createPackingProfile({
					docId: 0,
					path: "zh/cache-guide.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 1,
							familyText: shorterTerm,
							identityMetadataSource: "basename",
							metadataPackingSource: "basename",
							inIdentity: true,
						}),
					],
				}),
			),
		);

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		const highlights = sliceHighlights(basename, matchedFiles[0]?.basenameHighlightRanges);
		expect(highlights).toContain(fullSurface);
		expect(highlights).not.toContain(shorterTerm);
	});

	test("searchFiles keeps Han opaque bigram highlights inside the best single witness", async () => {
		const fullSurface = "\u751f\u547d\u529b";
		const basename = "\u751f\u547d";
		const folder = "\u8d44\u6599/\u547d\u529b/";
		const path = folder + basename + ".md";
		const engine = new CoverageLexicalV3FileSearchEngine();
		const snapshotStore = createSnapshotStoreStub();
		(engine as unknown as { getFileSnapshotStore: () => typeof snapshotStore }).getFileSnapshotStore = () => snapshotStore;
		await engine.reIndexAll([
			createDocument({
				path,
				basename,
				folder,
				content: "placeholder",
			}),
		]);
		attachMockSearchPipeline(
			engine,
			createMockEngineResult(
				createHanQueryAnalysis(fullSurface, createHanSurfaceGroup(0, fullSurface), null),
				createPackingProfile({
					docId: 0,
					path,
				}),
			),
		);

		const matchedFiles = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(sliceHighlights(basename, matchedFiles[0]?.basenameHighlightRanges)).toEqual([
			basename,
		]);
		expect(sliceHighlights(folder, matchedFiles[0]?.folderHighlightRanges)).toEqual([]);
	});
});
