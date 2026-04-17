import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type { V3QueryAnalysis } from "src/services/search/coverage-lexical-v3/query/analysis";
import type { V3CandidateDocRecall } from "src/services/search/coverage-lexical-v3/recall";
import type { EvidencePackingProfile } from "src/services/search/coverage-lexical-v3/ranking";
import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";

function createResidentBaseForBlockCounts(
	blockCountsByDoc: readonly number[],
): ResidentBase {
	let blockStart = 0;
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	const docIdByBlockId: number[] = [];
	const blockOrdinalByBlockId: number[] = [];
	for (let docId = 0; docId < blockCountsByDoc.length; docId += 1) {
		bodyBlockStartByDocId.push(blockStart);
		bodyBlockCountByDocId.push(blockCountsByDoc[docId]);
		for (let ordinal = 0; ordinal < blockCountsByDoc[docId]; ordinal += 1) {
			docIdByBlockId.push(docId);
			blockOrdinalByBlockId.push(ordinal);
			blockStart += 1;
		}
	}
	return {
		version: 1,
		stringArena: {
			text: "",
			offsets: new Uint32Array(),
			lengths: new Uint32Array(),
			count: 0,
		},
		docTable: {
			docCount: blockCountsByDoc.length,
			pathStringIds: new Uint32Array(blockCountsByDoc.map(() => 0)),
			generationByDocId: new Float64Array(blockCountsByDoc.map((_, index) => 100 + index)),
			identityStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			identityCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			bodyBlockStartByDocId: new Uint32Array(bodyBlockStartByDocId),
			bodyBlockCountByDocId: new Uint32Array(bodyBlockCountByDocId),
		},
		familyLexicon: {
			familyCount: 0,
			familyStringIds: new Uint32Array(),
			familyFlagsByFamilyId: new Uint8Array(),
		},
		metadataContainers: {
			identityFamiliesByDoc: new Uint32Array(),
			routeFamiliesByDoc: new Uint32Array(),
			headingFamiliesByDoc: new Uint32Array(),
			identityPostings: {
				postingStarts: new Uint32Array(),
				docIds: new Uint32Array(),
			},
			routePostings: {
				postingStarts: new Uint32Array(),
				docIds: new Uint32Array(),
			},
			headingPostings: {
				postingStarts: new Uint32Array(),
				docIds: new Uint32Array(),
			},
		},
		bodyFamilyPosting: {
			familyIds: new Uint32Array(),
			postingStarts: new Uint32Array(),
			docIds: new Uint32Array(),
			docPostingStarts: new Uint32Array(),
			blockIds: new Uint32Array(),
		},
		bodyBlocks: {
			blockCount: blockStart,
			docIdByBlockId: new Uint32Array(docIdByBlockId),
			blockOrdinalByBlockId: new Uint32Array(blockOrdinalByBlockId),
			exactTapeStartByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			exactTapeCountByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
		},
		exactTapes: {
			familyIds: new Uint32Array(),
		},
		hanRoute: {
			bigramIds: new Uint32Array(),
			bodyBigramIds: new Uint32Array(),
			metadataPostingStarts: new Uint32Array(),
			metadataDocIds: new Uint32Array(),
			bodyPostingStarts: new Uint32Array(),
			bodyBlockIds: new Uint32Array(),
			identityWitnessStartByDocId: new Uint32Array(),
			identityWitnessStringIds: new Uint32Array(),
			routeWitnessStartByDocId: new Uint32Array(),
			routeWitnessStringIds: new Uint32Array(),
			headingWitnessStartByDocId: new Uint32Array(),
			headingWitnessStringIds: new Uint32Array(),
			bodyWitnessStartByBlockId: new Uint32Array(),
			bodyWitnessStringIds: new Uint32Array(),
		},
		metrics: {
			docArenaBytes: 0,
			stringArenaBytes: 0,
			stringArenaPathBytes: 0,
			stringArenaFamilyBytes: 0,
			stringArenaIdentityWitnessBytes: 0,
			stringArenaRouteWitnessBytes: 0,
			stringArenaHeadingWitnessBytes: 0,
			stringArenaBodyWitnessBytes: 0,
			stringArenaMultiSourceBytes: 0,
			stringArenaUnattributedBytes: 0,
			familyLexiconBytes: 0,
			metadataContainerBytes: 0,
			headingBytes: 0,
			familyPostingBytes: 0,
			familyPostingTermIdsBytes: 0,
			familyPostingPostingStartsBytes: 0,
			familyPostingBlockIdsBytes: 0,
			familyPostingSingletonTermIdsBytes: 0,
			familyPostingSingletonBlockIdsBytes: 0,
			familyPostingPairTermIdsBytes: 0,
			familyPostingPairFirstBlockIdsBytes: 0,
			familyPostingPairSecondBlockIdsBytes: 0,
			familyPostingSmallTermIdsBytes: 0,
			familyPostingSmallPostingStartsBytes: 0,
			familyPostingSmallBlockIdsBytes: 0,
			familyPostingDeltaTermIdsBytes: 0,
			familyPostingDeltaTapeStartsBytes: 0,
			familyPostingDeltaPostingTapeBytes: 0,
			bodyBlockBytes: 0,
			exactTapeBytes: 0,
			hanRouteBytes: 0,
			hanRouteSharedBigramIdsBytes: 0,
			hanRouteMetadataHanPostingsBytes: 0,
			hanRouteMetadataHanPostingStartsBytes: 0,
			hanRouteMetadataHanDocIdsBytes: 0,
			hanRouteBodyHanPostingsBytes: 0,
			hanRouteBodyBigramIdsBytes: 0,
			hanRouteBodyHanPostingStartsBytes: 0,
			hanRouteBodyHanBodyBlockIdsBytes: 0,
			hanRouteMetadataWitnessBytes: 0,
			hanRouteBodyWitnessBytes: 0,
			scaffoldBytes: 0,
			countBytes: 0,
			idPayloadBytes: 0,
			stringPayloadBytes: 0,
			auxiliaryBytes: 0,
			residentBytes: 0,
			indexedSurfaceUtf8Bytes: 0,
			rawMarkdownUtf8Bytes: 0,
			"residentBytes / indexedSurfaceUtf8Bytes": 0,
			"residentBytes / rawMarkdownUtf8Bytes": 0,
		},
	};
}

function createQueryAnalysis(params: {
	queryText: string;
	surfaceGroups: V3QueryAnalysis["surfaceGroups"];
	primaryUnits: V3QueryAnalysis["primaryUnits"];
	surfaceCoverageShapeKey?: string;
}): V3QueryAnalysis {
	return {
		queryText: params.queryText,
		normalizedQueryText: params.queryText,
		surfaceGroups: params.surfaceGroups,
		primaryUnits: params.primaryUnits,
		hanBackstopGroups: [],
		surfaceCoverageShapeKey: params.surfaceCoverageShapeKey ?? "h",
	};
}

function createCandidate(overrides: Partial<EvidencePackingProfile>): EvidencePackingProfile {
	return {
		docId: overrides.docId ?? 0,
		path: overrides.path ?? "doc.md",
		stableKey: overrides.stableKey ?? overrides.path ?? "doc.md",
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
		hanSurfaceCompletionTierScoreTotal: overrides.hanSurfaceCompletionTierScoreTotal ?? 0,
		strongestHanSurfaceCompletionTier: overrides.strongestHanSurfaceCompletionTier ?? "none",
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
		bodyWindowContainer:
			"bodyWindowContainer" in overrides
				? (overrides.bodyWindowContainer ?? null)
				: {
					tier: "bodyWindow",
					blockIds: [0],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [0],
					coveredDistinctUnitCount: 1,
					containerCompactness: 100,
					exactUnitCount: 1,
					windowWidth: 1,
					gapCount: 0,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
		strongestContainer:
			"strongestContainer" in overrides
				? (overrides.strongestContainer ?? null)
				: overrides.bodyWindowContainer ?? {
					tier: "bodyWindow",
					blockIds: [0],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [0],
					coveredDistinctUnitCount: 1,
					containerCompactness: 100,
					exactUnitCount: 1,
					windowWidth: 1,
					gapCount: 0,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty: overrides.fragmentationPenalty ?? {
			bodyResidueUnitCount: 0,
			uncoveredByTopTwoCount: 0,
			explanatoryContainerCount: 1,
		},
	};
}

function createRealizedFamily(
	queryUnitIndex: number,
	queryUnitText: string,
	familyText = queryUnitText,
	matchKind: "exact" | "prefix" | "fuzzy" | "opaque_exact" = "exact",
	querySurfaceGroupIndex: number | null = queryUnitIndex,
) {
	return {
		queryUnitIndex,
		queryUnitText,
		querySurfaceGroupIndex,
		familyId: queryUnitIndex,
		familyText,
		matchKind,
		editDistance: matchKind === "fuzzy" ? 1 : 0,
		identityMetadataSource: "none" as const,
		routeMetadataSource: "none" as const,
		metadataPackingSource: "route" as const,
		inIdentity: false,
		inRoute: false,
		inHeading: false,
		inBestBodyWindow: true,
		inBodyResidue: false,
	};
}

function createCandidateRecall(overrides: Partial<V3CandidateDocRecall>): V3CandidateDocRecall {
	return {
		docId: overrides.docId ?? 0,
		matchedIdentityUnitIndices: overrides.matchedIdentityUnitIndices ?? [],
		matchedRouteUnitIndices: overrides.matchedRouteUnitIndices ?? [],
		matchedHeadingUnitIndices: overrides.matchedHeadingUnitIndices ?? [],
		shortlistedBodyBlockIds: overrides.shortlistedBodyBlockIds ?? [0],
		hanMetadataGateStats: overrides.hanMetadataGateStats ?? null,
		hanBodyBlockGateStats: overrides.hanBodyBlockGateStats ?? [],
		hanSurfaceGroupRecalls: overrides.hanSurfaceGroupRecalls ?? [],
	};
}

function extractHighlightTexts(result: ReturnType<typeof buildV3DirectSubitems>): string[] {
	return result.subItems[0]?.highlightRanges?.map((range) =>
		(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
	) ?? [];
}

describe("coverage lexical v3 direct subitems", () => {
	test("prefers a full Han surface snippet over a shorter real term", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "生命力",
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
				{ index: 0, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "生命力十足\n\n这里只谈生命现象",
			queryAnalysis,
			candidate: createCandidate({
				path: "life.md",
				realizedFamilies: [createRealizedFamily(0, "生命", "生命", "exact", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.confirmedSurfaceGroupCount).toBe(1);
		expect(extractHighlightTexts(result)).toContain("生命力");
	});

	test("whole-group Han rescue still yields a direct subitem when query-time residual bigrams are empty", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "\u8d62\u5b8b",
			surfaceGroups: [
				{
					index: 0,
					text: "\u8d62\u5b8b",
					kind: "han",
					hanBigramTexts: ["\u8d62\u5b8b"],
					coveredCharMask: [true, true],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "\u8d62\u5b8b", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "\u8d62\u5b8b\u4f53",
			queryAnalysis,
			candidate: createCandidate({
				path: "winsong.md",
				realizedFamilies: [
					createRealizedFamily(500001, "\u8d62\u5b8b", "\u8d62\u5b8b", "opaque_exact", 0),
				],
			}),
			candidateRecall: createCandidateRecall({
				shortlistedBodyBlockIds: [0],
				hanSurfaceGroupRecalls: [
					{
						surfaceGroupIndex: 0,
						metadataGateStats: null,
						bodySeedBlockIds: [0],
						bodySeedBlockGates: [],
					},
				],
			}),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]?.anchorTier).toBe("confirmed_surface");
		expect(extractHighlightTexts(result)).toContain("\u8d62\u5b8b");
	});

	test("keeps higher real coverage ahead of a full Han surface snippet", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "abc 生命力",
			surfaceGroups: [
				{
					index: 0,
					text: "abc",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 1,
					text: "生命力",
					kind: "han",
					hanBigramTexts: ["生命", "命力"],
					coveredCharMask: [true, true, false],
					queryResidualUniqueBigrams: ["命力"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "abc", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 1 },
			],
			surfaceCoverageShapeKey: "lh",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "生命力十足\n\nabc 与生命分开出现",
			queryAnalysis,
			candidate: createCandidate({
				path: "mixed.md",
				realizedFamilies: [
					createRealizedFamily(0, "abc", "abc", "exact", 0),
					createRealizedFamily(1, "生命", "生命", "exact", 1),
				],
				bodyWindowContainer: {
					tier: "bodyWindow",
					blockIds: [0, 1],
					boundaryCrossingCount: 1,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 2,
					gapCount: 1,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
				strongestContainer: {
					tier: "bodyWindow",
					blockIds: [0, 1],
					boundaryCrossingCount: 1,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 2,
					gapCount: 1,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.coveredRealPrimaryCount).toBe(2);
		expect(extractHighlightTexts(result)).toEqual(
			expect.arrayContaining(["abc", expect.stringMatching(/^生命/)]),
		);
	});

	test("materializes a body snippet from unresolved bigrams even without a full surface span", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "生命力",
			surfaceGroups: [
				{
					index: 0,
					text: "生命力",
					kind: "han",
					hanBigramTexts: ["生命", "命力"],
					coveredCharMask: [true, false, false],
					queryResidualUniqueBigrams: ["命力"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [
				{ index: 0, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "这里先说生命，然后命力被单独提及",
			queryAnalysis,
			candidate: createCandidate({
				path: "bigram.md",
				realizedFamilies: [createRealizedFamily(0, "生命", "生命", "exact", 0)],
				bodyWindowContainer: null,
				strongestContainer: null,
			}),
			candidateRecall: createCandidateRecall({
				shortlistedBodyBlockIds: [0],
				hanSurfaceGroupRecalls: [
					{
						surfaceGroupIndex: 0,
						metadataGateStats: null,
						bodySeedBlockIds: [0],
						bodySeedBlockGates: [],
					},
				],
			}),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates[0]?.matchedOpaqueBigramCount).toBe(1);
		expect(result.subItems).toHaveLength(1);
		expect(result.subItems[0]?.snippetText).toContain("命力");
	});

	test("does not fabricate a full Han surface when only partial Han evidence exists", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "生命力",
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
				{ index: 0, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "这里只有生命，没有完整词",
			queryAnalysis,
			candidate: createCandidate({
				path: "partial.md",
				realizedFamilies: [createRealizedFamily(0, "生命", "生命", "exact", 0)],
				bodyWindowContainer: null,
				strongestContainer: null,
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates[0]?.confirmedSurfaceGroupCount).toBe(0);
		expect(extractHighlightTexts(result)).toContain("生命");
		expect(extractHighlightTexts(result)).not.toContain("生命力");
	});

	test("splits distant latin evidence when the weighted gap exceeds the local budget", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "alpha beta",
			surfaceGroups: [
				{
					index: 0,
					text: "alpha",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 1,
					text: "beta",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "beta", source: "surface", surfaceGroupIndex: 1 },
			],
			surfaceCoverageShapeKey: "ll",
		});

		const result = buildV3DirectSubitems({
			snapshotText: `alpha${"x".repeat(70)}beta`,
			queryAnalysis,
			candidate: createCandidate({
				path: "gap.md",
				realizedFamilies: [
					createRealizedFamily(0, "alpha"),
					createRealizedFamily(1, "beta"),
				],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
			maxSubItemResults: 5,
		});

		expect(result.candidates).toHaveLength(2);
		expect(result.subItems).toHaveLength(2);
	});

	test("exposes all canonical candidates before maxSubItemResults truncation", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "alpha beta gamma",
			surfaceGroups: [
				{
					index: 0,
					text: "alpha",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 1,
					text: "beta",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
				{
					index: 2,
					text: "gamma",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "beta", source: "surface", surfaceGroupIndex: 1 },
				{ index: 2, text: "gamma", source: "surface", surfaceGroupIndex: 2 },
			],
			surfaceCoverageShapeKey: "lll",
		});

		const result = buildV3DirectSubitems({
			snapshotText: `alpha${"x".repeat(70)}beta${"x".repeat(70)}gamma`,
			queryAnalysis,
			candidate: createCandidate({
				path: "complete.md",
				realizedFamilies: [
					createRealizedFamily(0, "alpha"),
					createRealizedFamily(1, "beta"),
					createRealizedFamily(2, "gamma"),
				],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
			maxSubItemResults: 2,
		});

		expect(result.candidates).toHaveLength(3);
		expect(result.subItems).toHaveLength(2);
	});

	test("anchors prefix snippets to realized family text instead of the raw short query unit", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "st",
			surfaceGroups: [
				{
					index: 0,
					text: "st",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "st", source: "surface", surfaceGroupIndex: 0 },
			],
			surfaceCoverageShapeKey: "l",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "status lines drift here\nstart strong in this paragraph",
			queryAnalysis,
			candidate: createCandidate({
				path: "prefix.md",
				bodyWindowContainer: null,
				strongestContainer: null,
				realizedFamilies: [createRealizedFamily(0, "st", "start", "prefix", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(extractHighlightTexts(result)).toContain("start");
		expect(extractHighlightTexts(result)).not.toContain("st");
	});

	test("hideWeaklyRelatedResults drops same-query weaker snippets once a confirmed full surface wins", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "生命力",
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
				{ index: 0, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 0 },
			],
		});

		const result = buildV3DirectSubitems({
			snapshotText: "先说生命\n\n后来说生命力十足",
			queryAnalysis,
			candidate: createCandidate({
				path: "hide-weak.md",
				realizedFamilies: [createRealizedFamily(0, "生命", "生命", "exact", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
			hideWeaklyRelatedResults: true,
		});

		expect(result.subItems).toHaveLength(1);
		expect(extractHighlightTexts(result)).toContain("生命力");
	});

	test("returns no body snippet when there is no legal local body evidence", () => {
		const queryAnalysis = createQueryAnalysis({
			queryText: "st",
			surfaceGroups: [
				{
					index: 0,
					text: "st",
					kind: "latin",
					hanBigramTexts: [],
					coveredCharMask: [],
					queryResidualUniqueBigrams: [],
					hasQueryResidualHanCoverage: false,
				},
			],
			primaryUnits: [
				{ index: 0, text: "st", source: "surface", surfaceGroupIndex: 0 },
			],
			surfaceCoverageShapeKey: "l",
		});

		const result = buildV3DirectSubitems({
			snapshotText: "status lines drift here\nstart strong in this paragraph",
			queryAnalysis,
			candidate: createCandidate({
				path: "no-local.md",
				bodyWindowContainer: null,
				strongestContainer: null,
				realizedFamilies: [createRealizedFamily(0, "st", "start", "prefix", 0)],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [] }),
			residentBase: createResidentBaseForBlockCounts([1]),
			candidateRangeMode: "whole_document",
		});

		expect(result.candidates).toHaveLength(0);
		expect(result.subItems).toHaveLength(0);
	});
});
