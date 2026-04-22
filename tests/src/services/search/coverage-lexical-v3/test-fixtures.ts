import type { ResidentBase, ResidentBaseMetrics } from "src/services/search/coverage-lexical-v3/layout/types";
import { createEmptyAdaptivePostingField } from "src/services/search/coverage-lexical-v3/layout/adaptive-postings";
import { EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR } from "src/services/search/coverage-lexical-v3/layout/fuzzy-rescue";
import { analyzeQuery, type V3QueryAnalysis } from "src/services/search/coverage-lexical-v3/query/analysis";
import type {
	V3CandidateBodyBlockRecall,
	V3CandidateDocRecall,
} from "src/services/search/coverage-lexical-v3/recall";
import type {
	EvidencePackingProfile,
	RealizedQueryUnitFamily,
} from "src/services/search/coverage-lexical-v3/ranking";

export function createMinimalResidentBaseForBlockCounts(
	blockCountsByDoc: readonly number[],
): ResidentBase {
	let blockStart = 0;
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	const docIdByBlockId: number[] = [];
	const blockOrdinalByBlockId: number[] = [];
	for (let docId = 0; docId < blockCountsByDoc.length; docId += 1) {
		bodyBlockStartByDocId.push(blockStart);
		bodyBlockCountByDocId.push(blockCountsByDoc[docId] ?? 0);
		for (let ordinal = 0; ordinal < (blockCountsByDoc[docId] ?? 0); ordinal += 1) {
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
			liveDocCount: blockCountsByDoc.length,
			docRefsByDocId: new Float64Array(blockCountsByDoc.map((_, index) => index + 1)),
			docRefsByLiveDocSlot: new Float64Array(
				blockCountsByDoc.map((_, index) => index + 1),
			),
			liveDocSlotByDocId: new Uint32Array(blockCountsByDoc.map((_, index) => index)),
			docIdByLiveDocSlot: new Uint32Array(blockCountsByDoc.map((_, index) => index)),
			pathStringIds: new Uint32Array(blockCountsByDoc.map(() => 0)),
			pathStringIdsByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			generationByDocId: new Float64Array(blockCountsByDoc.map((_, index) => 100 + index)),
			generationByLiveDocSlot: new Float64Array(
				blockCountsByDoc.map((_, index) => 100 + index),
			),
			identityStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			identityCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			identityStartByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			identityCountByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeStartByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			routeCountByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingStartByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingCountByDocId: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingStartByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			headingCountByLiveDocSlot: new Uint32Array(blockCountsByDoc.map(() => 0)),
			bodyBlockStartByDocId: new Uint32Array(bodyBlockStartByDocId),
			bodyBlockCountByDocId: new Uint32Array(bodyBlockCountByDocId),
			bodyBlockStartByLiveDocSlot: new Uint32Array(bodyBlockStartByDocId),
			bodyBlockCountByLiveDocSlot: new Uint32Array(bodyBlockCountByDocId),
		},
		familyLexicon: {
			familyCount: 0,
			shardLocalFamilyCount: 0,
			familyStringIds: new Uint32Array(),
			shardLocalFamilySlotByFamilyId: new Uint32Array(),
			familyIdByShardLocalFamilySlot: new Uint32Array(),
			familyFlagsByFamilyId: new Uint8Array(),
		},
		metadataContainers: {
			identityFamiliesByDoc: new Uint32Array(),
			identitySourceMaskByDocEntry: new Uint8Array(),
			routeFamiliesByDoc: new Uint32Array(),
			routeSourceMaskByDocEntry: new Uint8Array(),
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
		bodyFamilyPosting: createEmptyAdaptivePostingField(),
		bodyBlocks: {
			blockCount: blockStart,
			docIdByBlockId: new Uint32Array(docIdByBlockId),
			blockOrdinalByBlockId: new Uint32Array(blockOrdinalByBlockId),
			exactTapeStartByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			exactTapeCountByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			familySupportStartByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			familySupportFamilyIds: new Uint32Array(),
			familySupportMaskByEntry: new Uint8Array(),
		},
		exactTapes: {
			familyIds: new Uint32Array(),
			positionEncodingByBlockId: new Uint8Array(),
			positionStartByBlockId: new Uint32Array(),
			positionDeltaU8Tape: new Uint8Array(),
			positionDeltaU16Tape: new Uint16Array(),
			positionDeltaU32Tape: new Uint32Array(),
		},
		hanRoute: {
			bigramIds: new Uint32Array(),
			metadataPostingStarts: new Uint32Array(),
			metadataDocIds: new Uint32Array(),
			bodyAdaptivePostings: createEmptyAdaptivePostingField(),
			metadataCharIds: new Uint32Array(),
			metadataCharPostingStarts: new Uint32Array(),
			metadataCharDocIds: new Uint32Array(),
			bodyCharAdaptivePostings: createEmptyAdaptivePostingField(),
			identityWitnessStartByDocId: new Uint32Array(),
			identityWitnessStartByLiveDocSlot: new Uint32Array(),
			identityWitnessStringIds: new Uint32Array(),
			identityWitnessSourceMaskByDocEntry: new Uint8Array(),
			routeWitnessStartByDocId: new Uint32Array(),
			routeWitnessStartByLiveDocSlot: new Uint32Array(),
			routeWitnessStringIds: new Uint32Array(),
			routeWitnessSourceMaskByDocEntry: new Uint8Array(),
			headingWitnessStartByDocId: new Uint32Array(),
			headingWitnessStartByLiveDocSlot: new Uint32Array(),
			headingWitnessStringIds: new Uint32Array(),
			bodyWitnessOccurrenceStartByBlockId: new Uint32Array(),
			bodyWitnessOccurrenceStringIds: new Uint32Array(),
			bodyWitnessPositionEncodingByBlockId: new Uint8Array(),
			bodyWitnessPositionStartByBlockId: new Uint32Array(),
			bodyWitnessPositionDeltaU8Tape: new Uint8Array(),
			bodyWitnessPositionDeltaU16Tape: new Uint16Array(),
			bodyWitnessPositionDeltaU32Tape: new Uint32Array(),
		},
		fuzzyRescue: EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
		metrics: {} as ResidentBaseMetrics,
	};
}

export function createRealizedFamily(
	overrides: Partial<RealizedQueryUnitFamily> &
		Pick<
			RealizedQueryUnitFamily,
			"queryUnitIndex" | "queryUnitText" | "familyId" | "familyText"
		>,
): RealizedQueryUnitFamily {
	return {
		queryUnitIndex: overrides.queryUnitIndex,
		queryUnitText: overrides.queryUnitText,
		querySurfaceGroupIndex: overrides.querySurfaceGroupIndex ?? 0,
		familyId: overrides.familyId,
		shardLocalFamilySlot: overrides.shardLocalFamilySlot ?? overrides.familyId,
		familyText: overrides.familyText,
		matchKind: overrides.matchKind ?? "exact",
		editDistance: overrides.editDistance ?? 0,
		identityMetadataSource: overrides.identityMetadataSource ?? "none",
		routeMetadataSource: overrides.routeMetadataSource ?? "none",
		metadataPackingSource: overrides.metadataPackingSource ?? "route",
		bodyPrefixSupportKind: overrides.bodyPrefixSupportKind ?? "none",
		inIdentity: overrides.inIdentity ?? false,
		inRoute: overrides.inRoute ?? false,
		inHeading: overrides.inHeading ?? false,
		inBestBodyWindow: overrides.inBestBodyWindow ?? true,
		inBodyResidue: overrides.inBodyResidue ?? false,
	};
}

export function createMinimalCandidate(
	overrides: Partial<EvidencePackingProfile> = {},
): EvidencePackingProfile {
	return {
		docId: overrides.docId ?? 0,
		path: overrides.path ?? "doc.md",
		stableKey: overrides.stableKey ?? overrides.path ?? "doc.md",
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "l",
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
		realizedFamilies:
			overrides.realizedFamilies ??
			[
				createRealizedFamily({
					queryUnitIndex: 0,
					queryUnitText: "target",
					familyId: 0,
					familyText: "target",
				}),
			],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? null,
		strongestContainer: overrides.strongestContainer ?? null,
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty: overrides.fragmentationPenalty ?? {
			bodyResidueUnitCount: 0,
			uncoveredByTopTwoCount: 0,
			explanatoryContainerCount: 0,
		},
	};
}

export function createMinimalCandidateRecall(
	shortlistedBodyBlockIds: readonly number[],
	overrides: Partial<V3CandidateDocRecall> = {},
): V3CandidateDocRecall {
	const shortlistedBodyBlocks: V3CandidateBodyBlockRecall[] = shortlistedBodyBlockIds.map((blockId) => ({
		blockId,
		hasExactSupport: false,
		hasPrefixSupport: false,
		hasStrongHanSupport: false,
		hasSingletonHanSupport: false,
		hasScopedSingletonHanSupport: false,
	}));
	return {
		docId: overrides.docId ?? 0,
		liveDocSlot: overrides.liveDocSlot ?? (overrides.docId ?? 0),
		matchedIdentityUnitIndices: overrides.matchedIdentityUnitIndices ?? [],
		matchedRouteUnitIndices: overrides.matchedRouteUnitIndices ?? [],
		matchedHeadingUnitIndices: overrides.matchedHeadingUnitIndices ?? [],
		hasQuerySingletonHanMetadataSupport:
			overrides.hasQuerySingletonHanMetadataSupport ?? false,
		hasScopedSingletonHanMetadataSupport:
			overrides.hasScopedSingletonHanMetadataSupport ?? false,
		shortlistedBodyBlocks: overrides.shortlistedBodyBlocks ?? shortlistedBodyBlocks,
		shortlistedBodyBlockIds:
			overrides.shortlistedBodyBlockIds ?? shortlistedBodyBlockIds,
		hanMetadataGateStats: overrides.hanMetadataGateStats ?? null,
		hanBodyBlockGateStats: overrides.hanBodyBlockGateStats ?? [],
		hanSurfaceGroupRecalls: overrides.hanSurfaceGroupRecalls ?? [],
	};
}

export function createLatinQueryAnalysis(queryText: string): V3QueryAnalysis {
	return analyzeQuery(queryText, [queryText]);
}
