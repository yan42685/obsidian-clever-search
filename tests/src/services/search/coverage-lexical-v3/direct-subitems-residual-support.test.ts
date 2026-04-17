import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query/analysis";
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
				generationByDocId: new Float64Array(
				blockCountsByDoc.map((_, index) => 100 + index),
			),
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
			exactTapeStartByBlockId: new Uint32Array(
				Array.from({ length: blockStart }, () => 0),
			),
			exactTapeCountByBlockId: new Uint32Array(
				Array.from({ length: blockStart }, () => 0),
			),
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

function createCandidate(
	overrides: Partial<EvidencePackingProfile>,
): EvidencePackingProfile {
	const coveredUnitIndices =
		overrides.bodyWindowContainer?.coveredUnitIndices ??
		overrides.strongestContainer?.coveredUnitIndices ??
		[0];
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
		completedHanSurfaceGroupCount:
			overrides.completedHanSurfaceGroupCount ?? 0,
		hanSurfaceCompletionTierScoreTotal:
			overrides.hanSurfaceCompletionTierScoreTotal ?? 0,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "none",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		realizedFamilies:
			overrides.realizedFamilies ??
			coveredUnitIndices.map((queryUnitIndex) => ({
				queryUnitIndex,
				queryUnitText: `unit-${queryUnitIndex}`,
				familyId: queryUnitIndex,
				familyText: `unit-${queryUnitIndex}`,
				matchKind: "exact",
				editDistance: 0,
				identityMetadataSource: "none",
				routeMetadataSource: "none",
				metadataPackingSource: "route",
				inIdentity: false,
				inRoute: false,
				inHeading: false,
				inBestBodyWindow: true,
				inBodyResidue: false,
			})),
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
		strongestContainer: overrides.strongestContainer ??
			overrides.bodyWindowContainer ?? {
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

function createCandidateRecall(
	overrides: Partial<V3CandidateDocRecall>,
): V3CandidateDocRecall {
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

describe("coverage lexical v3 direct subitems residual support", () => {
	test("adds bridge residual support highlights within the local body scope", () => {
		const queryText = "\u751f\u547d\u529b";
		const queryAnalysis = analyzeQuery(queryText, ["\u751f\u547d"]);
		const result = buildV3DirectSubitems({
			snapshotText: "\u524d\u7f00\u751f\u547d\u529b\u540e\u7f00",
			queryAnalysis,
			candidate: createCandidate({ path: "bridge.md" }),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		const weakHighlights = result.subItems[0]?.weakHighlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(strongHighlights).toContain("\u751f\u547d");
		expect(weakHighlights).toContain("\u529b");
		expect(result.candidates[0]?.completedHanSurfaceGroupCount).toBe(0);
	});

	test("same-scope full surface suppresses residual support highlights", () => {
		const queryText = "\u751f\u547d\u529b";
		const queryAnalysis = analyzeQuery(queryText, ["\u751f\u547d"]);
		const result = buildV3DirectSubitems({
			snapshotText: "\u524d\u7f00\u751f\u547d\u529b\u540e\u7f00",
			queryAnalysis,
			candidate: createCandidate({
				path: "full-body.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: queryText, tier: "body_window" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 2,
				strongestHanSurfaceCompletionTier: "body_window",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(strongHighlights).toContain(queryText);
		expect(result.subItems[0]?.weakHighlightRanges ?? []).toHaveLength(0);
	});

	test("metadata completion does not globally suppress body residual support", () => {
		const queryText = "\u751f\u547d\u4e4b\u529b";
		const queryAnalysis = analyzeQuery(queryText, ["\u751f\u547d"]);
		const result = buildV3DirectSubitems({
			snapshotText:
				"\u524d\u7f00\u751f\u547d\uff0c\u7136\u540e\u662f\u4e4b\u529b\uff0c\u540e\u7f00",
			queryAnalysis,
			candidate: createCandidate({
				path: "identity-body.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: queryText, tier: "identity" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 4,
				strongestHanSurfaceCompletionTier: "identity",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		const weakHighlights = result.subItems[0]?.weakHighlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(strongHighlights).toContain("\u751f\u547d");
		expect(weakHighlights).toContain("\u4e4b\u529b");
		expect(strongHighlights).not.toContain(queryText);
	});
});
