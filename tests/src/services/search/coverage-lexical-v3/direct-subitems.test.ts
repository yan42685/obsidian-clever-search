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
			generationByDocId: new Uint32Array(blockCountsByDoc.map((_, index) => 100 + index)),
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
		bodySummary: {
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
			bodySummaryBytes: 0,
			bodySummaryFamilyIdsBytes: 0,
			bodySummaryFamilyPostingStartsBytes: 0,
			bodySummaryDocIdsBytes: 0,
			bodySummaryDocPostingStartsBytes: 0,
			bodySummaryBlockOrdinalsBytes: 0,
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
		realizedFamilies: overrides.realizedFamilies ?? [],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? {
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
		strongestContainer: overrides.strongestContainer ?? overrides.bodyWindowContainer ?? {
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
			activeContainerCount: 1,
		},
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
	};
}

describe("coverage lexical v3 direct subitems", () => {
	test("prefers a full Han surface snippet over a shorter real term", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "生命力",
			normalizedQueryText: "生命力",
			surfaceGroups: [{ index: 0, text: "生命力", kind: "han" }],
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
		};
		const result = buildV3DirectSubitems({
			snapshotText: "生命力十足\n\n这里先只谈生命现象。",
			queryAnalysis,
			candidate: createCandidate({
				path: "life.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: "生命力", tier: "body_window" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 2,
				strongestHanSurfaceCompletionTier: "body_window",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.completedHanSurfaceGroupCount).toBe(1);
		expect(result.candidates[0]?.coveredRealPrimaryCount).toBe(1);
		const topHighlight = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(topHighlight).toContain("生命力");
	});

	test("prefers an adjacent full Han surface span over an earlier partial span at the same coverage", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "生命力",
			normalizedQueryText: "生命力",
			surfaceGroups: [{ index: 0, text: "生命力", kind: "han" }],
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
		};
		const result = buildV3DirectSubitems({
			snapshotText: "这里先只谈生命现象\n\n后来说生命力十足",
			queryAnalysis,
			candidate: createCandidate({
				path: "life-neighbor.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: "生命力", tier: "body_residue" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 1,
				strongestHanSurfaceCompletionTier: "body_residue",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		const topHighlight = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(topHighlight).toContain("生命力");
		expect(topHighlight).not.toContain("生命");
	});

	test("does not fabricate Han surface completion from dispersed bridge evidence", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "委员长",
			normalizedQueryText: "委员长",
			surfaceGroups: [{ index: 0, text: "委员长", kind: "han" }],
			primaryUnits: [
				{
					index: 0,
					text: "委员",
					source: "han_tokenizer_real",
					surfaceGroupIndex: 0,
				},
			],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "h",
		};
		const result = buildV3DirectSubitems({
			snapshotText: "委员正在讨论\n\n后来长大成人",
			queryAnalysis,
			candidate: createCandidate({ path: "chair.md" }),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.completedHanSurfaceGroupCount).toBe(0);
		const topHighlight = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(topHighlight).toContain("委员");
		expect(topHighlight).not.toContain("委员长");
	});

	test("keeps higher real coverage ahead of a full Han surface snippet", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "abc 生命力",
			normalizedQueryText: "abc 生命力",
			surfaceGroups: [
				{ index: 0, text: "abc", kind: "latin" },
				{ index: 1, text: "生命力", kind: "han" },
			],
			primaryUnits: [
				{ index: 0, text: "abc", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 1 },
			],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "lh",
		};
		const result = buildV3DirectSubitems({
			snapshotText: "生命力十足\n\nabc 与生命分开出现",
			queryAnalysis,
			candidate: createCandidate({
				path: "mixed-coverage.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 1, surfaceText: "生命力", tier: "body_residue" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 1,
				strongestHanSurfaceCompletionTier: "body_residue",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates[0]?.coveredRealPrimaryCount).toBe(2);
		const topHighlight = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(topHighlight).toContain("abc");
		expect(topHighlight).toEqual(
			expect.arrayContaining(["abc", expect.stringMatching(/^生命/)]),
		);
	});

	test("keeps non-Han exact highlights alongside Han surface dominance", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "abc 生命力",
			normalizedQueryText: "abc 生命力",
			surfaceGroups: [
				{ index: 0, text: "abc", kind: "latin" },
				{ index: 1, text: "生命力", kind: "han" },
			],
			primaryUnits: [
				{ index: 0, text: "abc", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "生命", source: "han_tokenizer_real", surfaceGroupIndex: 1 },
			],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "lh",
		};
		const result = buildV3DirectSubitems({
			snapshotText: "abc 生命力在这里",
			queryAnalysis,
			candidate: createCandidate({ path: "mixed.md" }),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const topHighlight = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(topHighlight).toContain("abc");
		expect(topHighlight).toContain("生命力");
	});

	test("splits distant latin evidence when the weighted gap exceeds the local budget", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "alpha beta",
			normalizedQueryText: "alpha beta",
			surfaceGroups: [
				{ index: 0, text: "alpha", kind: "latin" },
				{ index: 1, text: "beta", kind: "latin" },
			],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "beta", source: "surface", surfaceGroupIndex: 1 },
			],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "ll",
		};
		const result = buildV3DirectSubitems({
			snapshotText: `alpha${"x".repeat(70)}beta`,
			queryAnalysis,
			candidate: createCandidate({
				path: "far-gap.md",
				bodyWindowContainer: {
					tier: "bodyWindow",
					blockIds: [0],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 1,
					gapCount: 0,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
				strongestContainer: {
					tier: "bodyWindow",
					blockIds: [0],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 1,
					gapCount: 0,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates).toHaveLength(2);
		expect(result.candidates.every((candidate) => candidate.coveredRealPrimaryCount === 1)).toBe(
			true,
		);
		expect(result.subItems[0]?.snippetText).toContain("alpha");
		expect(result.subItems[1]?.snippetText).toContain("beta");
	});

	test("keeps nearby latin evidence in one snippet when the weighted gap stays within budget", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "alpha beta",
			normalizedQueryText: "alpha beta",
			surfaceGroups: [
				{ index: 0, text: "alpha", kind: "latin" },
				{ index: 1, text: "beta", kind: "latin" },
			],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
				{ index: 1, text: "beta", source: "surface", surfaceGroupIndex: 1 },
			],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "ll",
		};
		const result = buildV3DirectSubitems({
			snapshotText: `alpha${"x".repeat(40)}beta`,
			queryAnalysis,
			candidate: createCandidate({
				path: "near-gap.md",
				bodyWindowContainer: {
					tier: "bodyWindow",
					blockIds: [0],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 1,
					gapCount: 0,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
				strongestContainer: {
					tier: "bodyWindow",
					blockIds: [0],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [0, 1],
					coveredDistinctUnitCount: 2,
					containerCompactness: 100,
					exactUnitCount: 2,
					windowWidth: 1,
					gapCount: 0,
					density: 1,
					headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
				},
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		expect(result.candidates[0]?.coveredRealPrimaryCount).toBe(2);
		const highlighted = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlighted).toEqual(expect.arrayContaining(["alpha", "beta"]));
	});

	test("dedupes equivalent candidates emitted from merged and single-block ranges", () => {
		const queryAnalysis: V3QueryAnalysis = {
			queryText: "alpha",
			normalizedQueryText: "alpha",
			surfaceGroups: [{ index: 0, text: "alpha", kind: "latin" }],
			primaryUnits: [
				{ index: 0, text: "alpha", source: "surface", surfaceGroupIndex: 0 },
			],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "l",
		};
		const result = buildV3DirectSubitems({
			snapshotText: "alpha block\n\ncontext block",
			queryAnalysis,
			candidate: createCandidate({
				path: "dedupe.md",
				bodyWindowContainer: {
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
				strongestContainer: {
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
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0, 1] }),
			residentBase: createResidentBaseForBlockCounts([2]),
		});

		expect(result.candidates).toHaveLength(1);
		expect(result.subItems[0]?.snippetText).toContain("alpha");
	});
});









