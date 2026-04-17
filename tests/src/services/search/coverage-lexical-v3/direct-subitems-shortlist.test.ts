import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";
import { splitBodyBlocks } from "src/services/search/coverage-lexical-v3/query";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import type { V3QueryAnalysis } from "src/services/search/coverage-lexical-v3/query/analysis";
import type { V3CandidateDocRecall } from "src/services/search/coverage-lexical-v3/recall";
import type { EvidencePackingProfile } from "src/services/search/coverage-lexical-v3/ranking";

function createResidentBaseForBlockCount(blockCount: number): ResidentBase {
	return {
		version: 1,
		stringArena: {
			text: "",
			offsets: new Uint32Array(),
			lengths: new Uint32Array(),
			count: 0,
		},
		docTable: {
			docCount: 1,
			pathStringIds: new Uint32Array([0]),
				generationByDocId: new Float64Array([1]),
			identityStartByDocId: new Uint32Array([0]),
			identityCountByDocId: new Uint32Array([0]),
			routeStartByDocId: new Uint32Array([0]),
			routeCountByDocId: new Uint32Array([0]),
			headingStartByDocId: new Uint32Array([0]),
			headingCountByDocId: new Uint32Array([0]),
			bodyBlockStartByDocId: new Uint32Array([0]),
			bodyBlockCountByDocId: new Uint32Array([blockCount]),
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
			identityPostings: { postingStarts: new Uint32Array(), docIds: new Uint32Array() },
			routePostings: { postingStarts: new Uint32Array(), docIds: new Uint32Array() },
			headingPostings: { postingStarts: new Uint32Array(), docIds: new Uint32Array() },
		},
		bodyFamilyPosting: {
			familyIds: new Uint32Array(),
			postingStarts: new Uint32Array(),
			docIds: new Uint32Array(),
			docPostingStarts: new Uint32Array(),
			blockIds: new Uint32Array(),
		},
		bodyBlocks: {
			blockCount,
			docIdByBlockId: new Uint32Array(Array.from({ length: blockCount }, () => 0)),
			blockOrdinalByBlockId: new Uint32Array(
				Array.from({ length: blockCount }, (_, ordinal) => ordinal),
			),
			exactTapeStartByBlockId: new Uint32Array(Array.from({ length: blockCount }, () => 0)),
			exactTapeCountByBlockId: new Uint32Array(Array.from({ length: blockCount }, () => 0)),
		},
		exactTapes: {
			familyIds: new Uint32Array(),
		},
		hanRoute: {
			bigramIds: new Uint32Array(),
			metadataPostingStarts: new Uint32Array(),
			metadataDocIds: new Uint32Array(),
			bodyAdaptivePostings: {
				singletonTermIds: new Uint32Array(),
				singletonValueIds: new Uint32Array(),
				pairTermIds: new Uint32Array(),
				pairFirstValueIds: new Uint32Array(),
				pairSecondValueIds: new Uint32Array(),
				smallTermIds: new Uint32Array(),
				smallValueStarts: new Uint32Array(),
				smallValueIds: new Uint32Array(),
				deltaTermIds: new Uint32Array(),
				deltaTapeStarts: new Uint32Array(),
				postingTape: new Uint8Array(),
			},
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
			hanRouteMetadataHanPostingsBytes: 0,
			hanRouteSharedBigramIdsBytes: 0,
				hanRouteMetadataHanPostingStartsBytes: 0,
				hanRouteMetadataHanDocIdsBytes: 0,
				hanRouteMetadataHanPostingsBytes: 0,
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
	} as unknown as ResidentBase;
}

function createCandidate(): EvidencePackingProfile {
	return {
		docId: 0,
		path: "doc.md",
		stableKey: "doc.md",
		surfaceCoverageShapeKey: "l",
		realizedCoverageCount: 1,
		coverageGate: {
			realizedCoverageCount: 1,
			fullySatisfiedSurfaceGroupCount: 1,
			startedSurfaceGroupCount: 1,
			crossScriptSatisfiedGroupCount: 1,
		},
		exactUnitCount: 1,
		completedHanSurfaceGroupCount: 0,
		hanSurfaceCompletionTierScoreTotal: 0,
		strongestHanSurfaceCompletionTier: "none",
		hanSurfaceCompletionGroups: [],
		hanStrongRescueGroupCount: 0,
		hanWeakRescueGroupCount: 0,
		hanRescueSupportWeightTotal: 0,
		hasOnlyWeakHanRescue: false,
		hasAnyHanRescueAssessment: false,
		hanRescueAssessments: [],
		prefixCompletionGainTotal: 0,
		compoundPrefixCount: 0,
		realizedFamilies: [
			{
				queryUnitIndex: 0,
				queryUnitText: "target",
				familyId: 0,
				familyText: "target",
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
			},
		],
		identityContainer: null,
		routeContainer: null,
		bodyWindowContainer: null,
		strongestContainer: null,
		secondStrongestContainer: null,
		fragmentationPenalty: {
			bodyResidueUnitCount: 0,
			uncoveredByTopTwoCount: 0,
			activeContainerCount: 0,
		},
	};
}

function createCandidateRecall(blockCount: number): V3CandidateDocRecall {
	return {
		docId: 0,
		matchedIdentityUnitIndices: [],
		matchedRouteUnitIndices: [],
		matchedHeadingUnitIndices: [],
		shortlistedBodyBlockIds: Array.from({ length: blockCount }, (_, blockId) => blockId),
		hanMetadataGateStats: null,
		hanBodyBlockGateStats: [],
		hanSurfaceGroupRecalls: [],
	};
}

function createQueryAnalysis(): V3QueryAnalysis {
	return {
		queryText: "target",
		normalizedQueryText: "target",
		surfaceGroups: [{ index: 0, text: "target", kind: "latin" }],
		primaryUnits: [{ index: 0, text: "target", source: "surface", surfaceGroupIndex: 0 }],
		hanBackstopGroups: [],
		surfaceCoverageShapeKey: "l",
	};
}

function buildTripleBlockSnapshot(): string {
	for (let fillerLength = 1200; fillerLength <= 1800; fillerLength += 25) {
		const snapshotText = [
			`first target ${"a".repeat(fillerLength)}.`,
			`middle target ${"b".repeat(fillerLength)}.`,
			`last target ${"c".repeat(fillerLength)}.`,
		].join("\n");
		const blocks = splitBodyBlocks(snapshotText);
		if (
			blocks.length === 3 &&
			blocks[0]?.normalizedText.includes("first target") &&
			blocks[1]?.normalizedText.includes("middle target") &&
			blocks[2]?.normalizedText.includes("last target")
		) {
			return snapshotText;
		}
	}
	throw new Error("failed to construct a triple-block snapshot");
}

describe("coverage lexical v3 direct subitems shortlist", () => {
	test("uses candidate-local shortlisted body blocks to limit body scanning to selected blocks", () => {
		const snapshotText = buildTripleBlockSnapshot();
		const candidate = createCandidate();

		const result = buildV3DirectSubitems({
			snapshotText,
			queryAnalysis: createQueryAnalysis(),
			candidate,
			candidateRecall: {
				...createCandidateRecall(3),
				shortlistedBodyBlockIds: [1],
			},
			residentBase: createResidentBaseForBlockCount(3),
		});

		expect(result.candidates).toHaveLength(1);
		expect(result.subItems).toHaveLength(1);
		expect(result.subItems[0]?.snippetText).toContain("middle target");
		expect(result.subItems[0]?.snippetText).not.toContain("first target");
		expect(result.subItems[0]?.snippetText).not.toContain("last target");
	});
});



