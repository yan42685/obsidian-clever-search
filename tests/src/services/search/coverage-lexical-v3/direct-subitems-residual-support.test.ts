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

describe("coverage lexical v3 direct subitems residual support", () => {
	test("adds bridge residual support highlights within the local body scope", () => {
		const queryAnalysis = analyzeQuery("涓婇潰杩欑瑪璁?, ["涓婇潰", "绗旇"]);
		const result = buildV3DirectSubitems({
			snapshotText: "涔熸槸涓婇潰杩欎綅寮€鍙戠殑锛屾煡鐪嬬瑪璁板叧绯汇€?,
			queryAnalysis,
			candidate: createCandidate({ path: "bridge.md" }),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const highlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlights).toContain("涓婇潰杩?);
		expect(highlights).toContain("绗旇");
		expect(highlights).not.toContain("涓婇潰杩欑瑪璁?);
		expect(result.candidates[0]?.completedHanSurfaceGroupCount).toBe(0);
	});

	test("same-scope full surface suppresses residual support highlights", () => {
		const queryAnalysis = analyzeQuery("涓婇潰杩欑瑪璁?, ["涓婇潰", "绗旇"]);
		const result = buildV3DirectSubitems({
			snapshotText: "涓婇潰杩欑瑪璁板氨鍦ㄨ繖閲屻€?,
			queryAnalysis,
			candidate: createCandidate({
				path: "full-body.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: "涓婇潰杩欑瑪璁?, tier: "body_window" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 2,
				strongestHanSurfaceCompletionTier: "body_window",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const highlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlights).toContain("涓婇潰杩欑瑪璁?);
		expect(highlights).not.toContain("涓婇潰杩?);
	});

	test("metadata completion does not globally suppress body residual support", () => {
		const queryAnalysis = analyzeQuery("涓婇潰杩欑瑪璁?, ["涓婇潰", "绗旇"]);
		const result = buildV3DirectSubitems({
			snapshotText: "涔熸槸涓婇潰杩欎綅寮€鍙戠殑锛屾煡鐪嬬瑪璁板叧绯汇€?,
			queryAnalysis,
			candidate: createCandidate({
				path: "identity-body.md",
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: "涓婇潰杩欑瑪璁?, tier: "identity" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 4,
				strongestHanSurfaceCompletionTier: "identity",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const highlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlights).toContain("涓婇潰杩?);
		expect(highlights).toContain("绗旇");
		expect(highlights).not.toContain("涓婇潰杩欑瑪璁?);
	});
});
