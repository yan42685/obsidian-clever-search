jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import { OuterSetting } from "src/globals/plugin-setting";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import { EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR } from "src/services/search/coverage-lexical-v3/layout/body-blocks";
import { EMPTY_RESIDENT_EXACT_TAPE_SIDECAR } from "src/services/search/coverage-lexical-v3/layout/exact-tapes";
import { EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR } from "src/services/search/coverage-lexical-v3/layout/fuzzy-rescue";
import { EMPTY_RESIDENT_HAN_WITNESS_SIDECAR } from "src/services/search/coverage-lexical-v3/layout/han-route";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { buildBlockPositionLane } from "src/services/search/coverage-lexical-v3/layout/position-lanes";
import { buildStableWitnessMatchKey } from "src/services/search/coverage-lexical-v3/build";
import { hydrateCandidateEvidenceBatch } from "src/services/search/coverage-lexical-v3/ranking";
import type {
	BodyWindowContainer,
	EvidencePackingProfile,
	RealizedQueryUnitFamily,
} from "src/services/search/coverage-lexical-v3/ranking/types";
import type {
	V3CandidateBodyBlockRecall,
	V3CandidateDocRecall,
} from "src/services/search/coverage-lexical-v3/recall";
import {
	buildLexicalBlockEvidenceRowId,
	buildLexicalDocEvidenceRowId,
	FileSnapshotStore,
	type LexicalBlockEvidenceLocator,
	type LexicalDocEvidenceLocator,
} from "src/services/search/shared/file-snapshot-store";
import { container } from "tsyringe";

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		docRef: overrides.docRef,
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
		hanStrongRescueGroupCount: overrides.hanStrongRescueGroupCount ?? 0,
		hanWeakRescueGroupCount: overrides.hanWeakRescueGroupCount ?? 0,
		hanRescueSupportWeightTotal: overrides.hanRescueSupportWeightTotal ?? 0,
		hasOnlyWeakHanRescue: overrides.hasOnlyWeakHanRescue ?? false,
		hasAnyHanRescueAssessment: overrides.hasAnyHanRescueAssessment ?? false,
		hanRescueAssessments: overrides.hanRescueAssessments ?? [],
		singletonHanCompletion: overrides.singletonHanCompletion ?? {
			singletonHanChar: null,
			singletonHanCharIndex: null,
			singletonHanSurfaceGroupIndex: null,
			matched: false,
			matchSource: 'none',
			bestAnchorKind: 'none',
			bestAnchorDistance: null,
			sameBlockAsAnchor: false,
			sameBlockAsBestBodyWindow: false,
			tier: 'none',
		},
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
		realizedFamilies: overrides.realizedFamilies ?? [
			{
				queryUnitIndex: 0,
				queryUnitText: "life",
				querySurfaceGroupIndex: 0,
				familyId: 0,
				shardLocalFamilySlot: 0,
				familyText: "life",
				matchKind: "exact",
				editDistance: 0,
				identityMetadataSource: "none",
				routeMetadataSource: "none",
				metadataPackingSource: "none",
				bodyPrefixSupportKind: "none",
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
				explanatoryContainerCount: 1,
			},
	};
}

function createHanSurfaceGroup(index: number, text: string) {
	const chars = Array.from(text);
	const hanBigramTexts = chars.slice(0, -1).map((_, charIndex) => {
		return chars[charIndex] + chars[charIndex + 1];
	});
	return {
		index,
		text,
		kind: "han" as const,
		hanBigramTexts,
		coveredCharMask: Array.from({ length: chars.length }, () => false),
		queryResidualUniqueBigrams: hanBigramTexts,
		hasQueryResidualHanCoverage: hanBigramTexts.length > 0,
	};
}

function createLatinSurfaceGroup(index: number, text: string) {
	return {
		index,
		text,
		kind: "latin" as const,
		hanBigramTexts: [],
		coveredCharMask: [],
		queryResidualUniqueBigrams: [],
		hasQueryResidualHanCoverage: false,
	};
}

function createLatinQueryAnalysis(
	queryText: string,
	terms: readonly string[],
) {
	return {
		queryText,
		normalizedQueryText: queryText,
		querySingletonHanChar: null,
		querySingletonHanCodePoint: null,
		querySingletonHanRecallEligible: false,
		surfaceGroups: terms.map((term, index) =>
			createLatinSurfaceGroup(index, term),
		),
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

function createMapFromEntries<K, V>(
	entries: Iterable<readonly [K, V] | null | undefined>,
): Map<K, V> {
	const result = new Map<K, V>();
	for (const entry of entries) {
		if (entry != null) {
			result.set(entry[0], entry[1]);
		}
	}
	return result;
}

function createPersistedBodyEvidenceMap(
	locators: readonly LexicalBlockEvidenceLocator[],
	persistedBodyEvidence: ReadonlyMap<
		string,
		{
			id: string;
			docRef: number;
			generation: number;
			blockOrdinal: number;
			exactFamilyIds?: readonly number[];
			exactShardLocalFamilySlots?: readonly number[];
			exactTokenPositions: readonly number[];
			familySupportFamilyIds?: readonly number[];
			supportShardLocalFamilySlots?: readonly number[];
			familySupportMaskByEntry: readonly number[];
		}
	>,
) {
	return createMapFromEntries(
		locators.map((locator) => {
			const row = persistedBodyEvidence.get(
				buildLexicalBlockEvidenceRowId(locator),
			);
			if (row == null) {
				return null;
			}
			return [
				row.id,
				{
					exactFamilyIds: row.exactFamilyIds,
					exactShardLocalFamilySlots: row.exactShardLocalFamilySlots,
					exactTokenPositions: row.exactTokenPositions,
					familySupportEntries: (row.familySupportFamilyIds ?? []).map(
						(familyId, index) => ({
							familyId,
							supportMask: row.familySupportMaskByEntry[index] ?? 0,
						}),
					),
					supportEntriesByShardLocalFamilySlot: (
						row.supportShardLocalFamilySlots ?? []
					).map((shardLocalFamilySlot, index) => ({
						shardLocalFamilySlot,
						supportMask: row.familySupportMaskByEntry[index] ?? 0,
					})),
				},
			] as const;
		}),
	);
}

function createPersistedHanDocEvidenceMap(
	locators: readonly LexicalDocEvidenceLocator[],
	persistedHanDocEvidence: ReadonlyMap<
		string,
		{
			id: string;
			docRef: number;
			generation: number;
			identityWitnessStringIds?: readonly number[];
			identityWitnessMatchKeys?: readonly number[];
			identityWitnessTexts?: readonly string[];
			identityWitnessSourceMaskByDocEntry: readonly number[];
			routeWitnessStringIds?: readonly number[];
			routeWitnessMatchKeys?: readonly number[];
			routeWitnessTexts?: readonly string[];
			routeWitnessSourceMaskByDocEntry: readonly number[];
			headingWitnessStringIds?: readonly number[];
			headingWitnessMatchKeys?: readonly number[];
			headingWitnessTexts?: readonly string[];
		}
	>,
) {
	return createMapFromEntries(
		locators.map((locator) => {
			const row = persistedHanDocEvidence.get(
				buildLexicalDocEvidenceRowId(locator),
			);
			if (row == null) {
				return null;
			}
			return [
				row.id,
				{
					identityWitnessStringIds: row.identityWitnessStringIds,
					identityWitnessMatchKeys: row.identityWitnessMatchKeys,
					identityWitnessTexts: row.identityWitnessTexts,
					identityWitnessSourceMasks:
						row.identityWitnessSourceMaskByDocEntry,
					routeWitnessStringIds: row.routeWitnessStringIds,
					routeWitnessMatchKeys: row.routeWitnessMatchKeys,
					routeWitnessTexts: row.routeWitnessTexts,
					routeWitnessSourceMasks: row.routeWitnessSourceMaskByDocEntry,
					headingWitnessStringIds: row.headingWitnessStringIds,
					headingWitnessMatchKeys: row.headingWitnessMatchKeys,
					headingWitnessTexts: row.headingWitnessTexts,
				},
			] as const;
		}),
	);
}

function createPersistedHanBodyEvidenceMap(
	locators: readonly LexicalBlockEvidenceLocator[],
	persistedHanBodyEvidence: ReadonlyMap<
		string,
		{
			id: string;
			docRef: number;
			generation: number;
			blockOrdinal: number;
			bodyWitnessStringIds?: readonly number[];
			bodyWitnessMatchKeys?: readonly number[];
			bodyWitnessTexts?: readonly string[];
			bodyWitnessStartOffsets: readonly number[];
		}
	>,
) {
	return createMapFromEntries(
		locators.map((locator) => {
			const row = persistedHanBodyEvidence.get(
				buildLexicalBlockEvidenceRowId(locator),
			);
			if (row == null) {
				return null;
			}
			return [
				row.id,
				{
					bodyWitnessStringIds: row.bodyWitnessStringIds,
					bodyWitnessMatchKeys: row.bodyWitnessMatchKeys,
					bodyWitnessTexts: row.bodyWitnessTexts,
					bodyWitnessStartOffsets: row.bodyWitnessStartOffsets,
				},
			] as const;
		}),
	);
}


function createHanQueryAnalysis(
	fullSurface: string,
	primaryUnitText: string | null = fullSurface,
) {
	return {
		queryText: fullSurface,
		normalizedQueryText: fullSurface,
		querySingletonHanChar: null,
		querySingletonHanCodePoint: null,
		querySingletonHanRecallEligible: false,
		surfaceGroups: [createHanSurfaceGroup(0, fullSurface)],
		primaryUnits:
			primaryUnitText == null
				? []
				: [
					{
						index: 0,
						text: primaryUnitText,
						source: "han_tokenizer_real" as const,
						surfaceGroupIndex: 0,
					},
				],
		hanBackstopGroups: [],
		surfaceCoverageShapeKey: "h",
	};
}

function createCandidateBodyBlockRecall(
	blockId: number,
	overrides: Partial<V3CandidateBodyBlockRecall> = {},
): V3CandidateBodyBlockRecall {
	return {
		blockId,
		hasExactSupport: overrides.hasExactSupport ?? false,
		hasPrefixSupport: overrides.hasPrefixSupport ?? false,
		hasStrongHanSupport: overrides.hasStrongHanSupport ?? false,
		hasSingletonHanSupport: overrides.hasSingletonHanSupport ?? false,
		hasScopedSingletonHanSupport:
			overrides.hasScopedSingletonHanSupport ?? false,
	};
}

function createCandidateDocRecall(
	docId: number,
	overrides: Partial<V3CandidateDocRecall> = {},
): V3CandidateDocRecall {
	const shortlistedBodyBlocks = overrides.shortlistedBodyBlocks ?? [];
	return {
		docId,
		liveDocSlot: overrides.liveDocSlot ?? docId,
		matchedIdentityUnitIndices: overrides.matchedIdentityUnitIndices ?? [],
		matchedRouteUnitIndices: overrides.matchedRouteUnitIndices ?? [],
		matchedHeadingUnitIndices: overrides.matchedHeadingUnitIndices ?? [],
		hasQuerySingletonHanMetadataSupport:
			overrides.hasQuerySingletonHanMetadataSupport ?? false,
		hasScopedSingletonHanMetadataSupport:
			overrides.hasScopedSingletonHanMetadataSupport ?? false,
		shortlistedBodyBlocks,
		shortlistedBodyBlockIds:
			overrides.shortlistedBodyBlockIds ??
			shortlistedBodyBlocks.map((block) => block.blockId),
		hanMetadataGateStats: overrides.hanMetadataGateStats ?? null,
		hanBodyBlockGateStats: overrides.hanBodyBlockGateStats ?? [],
		hanSurfaceGroupRecalls: overrides.hanSurfaceGroupRecalls ?? [],
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
		shardLocalFamilySlot:
			overrides.shardLocalFamilySlot ?? overrides.familyId,
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

function createRefineSearchResult(): CoverageLexicalV3SearchResult {
	const shorterTerm = "\u7f13\u5b58\u6062\u590d";
	const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
	const laterPath = createPackingProfile({
		docId: 0,
		path: "z-complete.md",
		bodyWindowContainer: createBodyWindowContainer([0]),
		strongestContainer: createBodyWindowContainer([0]),
	});
	const earlierPath = createPackingProfile({
		docId: 1,
		path: "a-partial.md",
		bodyWindowContainer: createBodyWindowContainer([2]),
		strongestContainer: createBodyWindowContainer([2]),
	});
	return {
		recallState: {
			queryAnalysis: createHanQueryAnalysis(fullSurface, shorterTerm),
			unitFamilyMatches: [],
			candidateDocs: [
				createCandidateDocRecall(0, {
					shortlistedBodyBlocks: [
						createCandidateBodyBlockRecall(0),
						createCandidateBodyBlockRecall(1, { hasStrongHanSupport: true }),
					],
					hanBodyBlockGateStats: [
						{
							blockId: 1,
							stats: {
								matchedBigramCount: 1,
								longestContiguousBigramChain: 1,
								bigramCoverageRatio: 1,
							},
						},
					],
					hanSurfaceGroupRecalls: [
						{
							surfaceGroupIndex: 0,
							metadataGateStats: null,
							bodySeedBlockIds: [1],
							bodySeedBlockGates: [
								{
									blockId: 1,
									stats: {
										matchedBigramCount: 1,
										longestContiguousBigramChain: 1,
										bigramCoverageRatio: 1,
									},
								},
							],
						},
					],
				}),
				createCandidateDocRecall(1, {
					shortlistedBodyBlocks: [
						createCandidateBodyBlockRecall(2, { hasStrongHanSupport: true }),
					],
					hanBodyBlockGateStats: [
						{
							blockId: 2,
							stats: {
								matchedBigramCount: 1,
								longestContiguousBigramChain: 1,
								bigramCoverageRatio: 1,
							},
						},
					],
					hanSurfaceGroupRecalls: [
						{
							surfaceGroupIndex: 0,
							metadataGateStats: null,
							bodySeedBlockIds: [2],
							bodySeedBlockGates: [
								{
									blockId: 2,
									stats: {
										matchedBigramCount: 1,
										longestContiguousBigramChain: 1,
										bigramCoverageRatio: 1,
									},
								},
							],
						},
					],
				}),
			],
		},
		rankedCandidates: [earlierPath, laterPath],
	};
}

function createResidentBase(): ResidentBase {
	return {
		version: 1,
		stringArena: {
			text: "",
			offsets: new Uint32Array(),
			lengths: new Uint32Array(),
			count: 0,
		},
		docTable: {
			docCount: 2,
			liveDocCount: 2,
			docRefsByDocId: new Float64Array([1, 2]),
			docRefsByLiveDocSlot: new Float64Array([1, 2]),
			liveDocSlotByDocId: new Uint32Array([0, 1]),
			docIdByLiveDocSlot: new Uint32Array([0, 1]),
			pathStringIds: new Uint32Array([0, 0]),
			pathStringIdsByLiveDocSlot: new Uint32Array([0, 0]),
			generationByDocId: new Float64Array([101, 202]),
			generationByLiveDocSlot: new Float64Array([101, 202]),
			identityStartByDocId: new Uint32Array([0, 0]),
			identityCountByDocId: new Uint32Array([0, 0]),
			identityStartByLiveDocSlot: new Uint32Array([0, 0]),
			identityCountByLiveDocSlot: new Uint32Array([0, 0]),
			routeStartByDocId: new Uint32Array([0, 0]),
			routeCountByDocId: new Uint32Array([0, 0]),
			routeStartByLiveDocSlot: new Uint32Array([0, 0]),
			routeCountByLiveDocSlot: new Uint32Array([0, 0]),
			headingStartByDocId: new Uint32Array([0, 0]),
			headingCountByDocId: new Uint32Array([0, 0]),
			headingStartByLiveDocSlot: new Uint32Array([0, 0]),
			headingCountByLiveDocSlot: new Uint32Array([0, 0]),
			bodyBlockStartByDocId: new Uint32Array([0, 2]),
			bodyBlockCountByDocId: new Uint32Array([2, 1]),
			bodyBlockStartByLiveDocSlot: new Uint32Array([0, 2]),
			bodyBlockCountByLiveDocSlot: new Uint32Array([2, 1]),
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
			blockCount: 3,
			docIdByBlockId: new Uint32Array([0, 0, 1]),
			liveDocSlotByBlockId: new Uint32Array([0, 0, 1]),
			blockOrdinalByBlockId: new Uint32Array([0, 1, 0]),
			exactTapeStartByBlockId: new Uint32Array([0, 0, 0]),
			exactTapeCountByBlockId: new Uint32Array([0, 0, 0]),
			familySupportStartByBlockId: new Uint32Array([0, 0, 0, 0]),
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
		metrics: createZeroResidentMetrics(),
		fuzzyRescue: EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
	};
}

function createResidentBaseForBlockCounts(
	blockCountsByDoc: readonly number[],
): ResidentBase {
	const base = createResidentBase();
	let blockStart = 0;
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	const docIdByBlockId: number[] = [];
	const liveDocSlotByBlockId: number[] = [];
	const blockOrdinalByBlockId: number[] = [];
	for (let docId = 0; docId < blockCountsByDoc.length; docId += 1) {
		bodyBlockStartByDocId.push(blockStart);
		bodyBlockCountByDocId.push(blockCountsByDoc[docId]);
		for (let ordinal = 0; ordinal < blockCountsByDoc[docId]; ordinal += 1) {
			docIdByBlockId.push(docId);
			liveDocSlotByBlockId.push(docId);
			blockOrdinalByBlockId.push(ordinal);
		}
		blockStart += blockCountsByDoc[docId];
	}
	return {
		...base,
		docTable: {
			...base.docTable,
			docCount: blockCountsByDoc.length,
			liveDocCount: blockCountsByDoc.length,
			docRefsByDocId: new Float64Array(
				blockCountsByDoc.map((_, index) => index + 1),
			),
			docRefsByLiveDocSlot: new Float64Array(
				blockCountsByDoc.map((_, index) => index + 1),
			),
			liveDocSlotByDocId: new Uint32Array(
				blockCountsByDoc.map((_, index) => index),
			),
			docIdByLiveDocSlot: new Uint32Array(
				blockCountsByDoc.map((_, index) => index),
			),
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
		bodyBlocks: {
			...base.bodyBlocks,
			blockCount: blockStart,
			docIdByBlockId: new Uint32Array(docIdByBlockId),
			liveDocSlotByBlockId: new Uint32Array(liveDocSlotByBlockId),
			blockOrdinalByBlockId: new Uint32Array(blockOrdinalByBlockId),
			exactTapeStartByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			exactTapeCountByBlockId: new Uint32Array(Array.from({ length: blockStart }, () => 0)),
			familySupportStartByBlockId: new Uint32Array(
				Array.from({ length: blockStart + 1 }, () => 0),
			),
			familySupportFamilyIds: new Uint32Array(),
			familySupportMaskByEntry: new Uint8Array(),
		},
	};
}

function withBodyWitnessTexts(
	base: ResidentBase,
	bodyWitnessTextsByBlock: ReadonlyArray<readonly string[]>,
): ResidentBase {
	const uniqueStrings = new Map<string, number>([["", 0]]);
	const orderedStrings = [""];
	const bodyWitnessOccurrenceStartByBlockId: number[] = [];
	const bodyWitnessOccurrenceStringIds: number[] = [];
	const bodyWitnessStartOffsetsByBlock = bodyWitnessTextsByBlock.map((texts) =>
		texts.map((_, index) => index),
	);
	for (let blockId = 0; blockId < base.bodyBlocks.blockCount; blockId += 1) {
		bodyWitnessOccurrenceStartByBlockId.push(bodyWitnessOccurrenceStringIds.length);
		for (const text of bodyWitnessTextsByBlock[blockId] ?? []) {
			let stringId = uniqueStrings.get(text);
			if (stringId == null) {
				stringId = orderedStrings.length;
				uniqueStrings.set(text, stringId);
				orderedStrings.push(text);
			}
			bodyWitnessOccurrenceStringIds.push(stringId);
		}
	}
	bodyWitnessOccurrenceStartByBlockId.push(bodyWitnessOccurrenceStringIds.length);
	const positionLane = buildBlockPositionLane(
		Array.from({ length: base.bodyBlocks.blockCount }, (_, blockId) =>
			bodyWitnessStartOffsetsByBlock[blockId] ?? [],
		),
	);
	const offsets: number[] = [];
	const lengths: number[] = [];
	let stringArenaText = "";
	for (const text of orderedStrings) {
		offsets.push(stringArenaText.length);
		lengths.push(text.length);
		stringArenaText += text;
	}
	return {
		...base,
		stringArena: {
			text: stringArenaText,
			offsets: new Uint32Array(offsets),
			lengths: new Uint32Array(lengths),
			count: orderedStrings.length,
		},
		hanRoute: {
			...base.hanRoute,
			bodyWitnessOccurrenceStartByBlockId: new Uint32Array(bodyWitnessOccurrenceStartByBlockId),
			bodyWitnessOccurrenceStringIds: new Uint32Array(bodyWitnessOccurrenceStringIds),
			bodyWitnessPositionEncodingByBlockId: positionLane.positionEncodingByBlockId,
			bodyWitnessPositionStartByBlockId: positionLane.positionStartByBlockId,
			bodyWitnessPositionDeltaU8Tape: positionLane.positionDeltaU8Tape,
			bodyWitnessPositionDeltaU16Tape: positionLane.positionDeltaU16Tape,
			bodyWitnessPositionDeltaU32Tape: positionLane.positionDeltaU32Tape,
		},
	};
}

async function runHanRefine(
	result: CoverageLexicalV3SearchResult,
	options: {
		indexedTexts?: Map<string, string>;
		residentBase?: ResidentBase;
	},
): Promise<readonly EvidencePackingProfile[]> {
	const engine = new CoverageLexicalV3FileSearchEngine();
	const residentBase = options.residentBase ?? createResidentBase();
	const readIndexedTexts = jest.fn(async () => options.indexedTexts ?? new Map<string, string>());
	(
		engine as unknown as {
			engine: {
				search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				prepareSearch: (...args: unknown[]) => unknown;
				rankPreparedSearch: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				getResidentBase: () => ResidentBase;
			};
			getFileSnapshotStore: () => {
				readIndexedTexts: typeof readIndexedTexts;
				readCurrentTexts: jest.Mock;
			};
		}
	).engine = createMockSearchRuntime(() => result, residentBase);
	(
		engine as unknown as {
			getFileSnapshotStore: () => {
				readIndexedTexts: typeof readIndexedTexts;
				readCurrentTexts: jest.Mock;
			};
		}
	).getFileSnapshotStore = () => ({
		readIndexedTexts,
		readCurrentTexts: jest.fn(),
	});
	return await (engine as unknown as {
		refineHanSurfaceCompletion: (
			searchResult: CoverageLexicalV3SearchResult,
			hydratedEvidenceByLiveDocSlot: ReadonlyMap<number, unknown>,
		) => Promise<readonly EvidencePackingProfile[]>;
	}).refineHanSurfaceCompletion(
		result,
		hydrateCandidateEvidenceBatch(residentBase, result.recallState.candidateDocs, {
			bodyHanEvidenceByBlockId: createResidentBodyHanEvidenceByBlockId(
				residentBase,
				result.recallState.candidateDocs,
			),
		}),
	);
}

function createResidentBodyHanEvidenceByBlockId(
	residentBase: ResidentBase,
	candidateDocs: readonly V3CandidateDocRecall[],
): ReadonlyMap<
	number,
	{
		bodyWitnessMatchKeys: readonly number[];
		bodyWitnessTexts: readonly string[];
		bodyWitnessStartOffsets: readonly number[];
	}
> {
	const out = new Map<
		number,
		{
			bodyWitnessMatchKeys: readonly number[];
			bodyWitnessTexts: readonly string[];
			bodyWitnessStartOffsets: readonly number[];
		}
	>();
	for (const candidateDoc of candidateDocs) {
		for (const bodyBlock of candidateDoc.shortlistedBodyBlocks) {
			const blockId = bodyBlock.blockId;
			const start =
				residentBase.hanRoute.bodyWitnessOccurrenceStartByBlockId[blockId] ?? 0;
			const end =
				residentBase.hanRoute.bodyWitnessOccurrenceStartByBlockId[blockId + 1] ?? start;
			const stringIds = Array.from(
				residentBase.hanRoute.bodyWitnessOccurrenceStringIds.slice(start, end),
			);
			const texts = stringIds.map((stringId) =>
				readTestResidentString(residentBase, stringId),
			);
			const starts = decodeTestBodyWitnessStarts(residentBase, blockId, end - start);
			out.set(blockId, {
				bodyWitnessMatchKeys: texts.map(buildStableWitnessMatchKey),
				bodyWitnessTexts: texts,
				bodyWitnessStartOffsets: starts,
			});
		}
	}
	return out;
}

function readTestResidentString(residentBase: ResidentBase, stringId: number): string {
	const offset = residentBase.stringArena.offsets[stringId] ?? 0;
	const length = residentBase.stringArena.lengths[stringId] ?? 0;
	return residentBase.stringArena.text.slice(offset, offset + length);
}

function decodeTestBodyWitnessStarts(
	residentBase: ResidentBase,
	blockId: number,
	count: number,
): number[] {
	const encoding = residentBase.hanRoute.bodyWitnessPositionEncodingByBlockId[blockId] ?? 0;
	const start = residentBase.hanRoute.bodyWitnessPositionStartByBlockId[blockId] ?? 0;
	if (count <= 0) {
		return [];
	}
	switch (encoding) {
		case 1:
			return Array.from(
				residentBase.hanRoute.bodyWitnessPositionDeltaU8Tape.slice(start, start + count),
			);
		case 2:
			return Array.from(
				residentBase.hanRoute.bodyWitnessPositionDeltaU16Tape.slice(start, start + count),
			);
		case 3:
			return Array.from(
				residentBase.hanRoute.bodyWitnessPositionDeltaU32Tape.slice(start, start + count),
			);
		default:
			return Array.from({ length: count }, () => 0);
	}
}

function createMockSearchRuntime(
	search: (
		queryText: string,
		queryTerms?: readonly string[],
		options?: unknown,
	) => CoverageLexicalV3SearchResult,
	residentBase: ResidentBase,
) {
	const searchMock = jest.fn(search) as unknown as typeof search;
	return {
		search: searchMock,
		prepareSearch: (
			queryText: string,
			queryTerms: readonly string[] = [],
			options?: unknown,
		) => {
			const result = searchMock(queryText, queryTerms, options);
			return {
				queryText,
				queryTerms,
				queryAnalysis: result.recallState.queryAnalysis,
				unitFamilyMatches: result.recallState.unitFamilyMatches,
				guardedCandidateDocs: result.recallState.candidateDocs,
				__result: result,
			};
		},
		rankPreparedSearch: (
			preparedSearch: {
				__result?: CoverageLexicalV3SearchResult;
				queryText: string;
				queryTerms: readonly string[];
			},
		) =>
			preparedSearch.__result ??
			searchMock(preparedSearch.queryText, preparedSearch.queryTerms),
		getResidentBase: () => residentBase,
	};
}

function createEmptyAdaptivePostingField() {
	return {
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
	};
}

function createZeroResidentMetrics(): ResidentBase["metrics"] {
	return {
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
		exactTapePositionBytes: 0,
		hanRouteBytes: 0,
		hanRouteSharedBigramIdsBytes: 0,
		hanRouteMetadataHanPostingsBytes: 0,
		hanRouteMetadataHanPostingStartsBytes: 0,
		hanRouteMetadataHanDocIdsBytes: 0,
		hanRouteHanBigramPostingBytes: 0,
		hanRouteBodyBigramIdsBytes: 0,
		hanRouteHanBigramPostingStartsBytes: 0,
		hanRouteHanBigramBlockIdsBytes: 0,
		hanRouteHanBigramSingletonTermIdsBytes: 0,
		hanRouteHanBigramSingletonBlockIdsBytes: 0,
		hanRouteHanBigramPairTermIdsBytes: 0,
		hanRouteHanBigramPairFirstBlockIdsBytes: 0,
		hanRouteHanBigramPairSecondBlockIdsBytes: 0,
		hanRouteHanBigramSmallTermIdsBytes: 0,
		hanRouteHanBigramSmallPostingStartsBytes: 0,
		hanRouteHanBigramSmallBlockIdsBytes: 0,
		hanRouteHanBigramDeltaTermIdsBytes: 0,
		hanRouteHanBigramDeltaTapeStartsBytes: 0,
		hanRouteHanBigramDeltaPostingTapeBytes: 0,
		hanRouteMetadataHanCharPostingsBytes: 0,
		hanRouteMetadataHanCharPostingStartsBytes: 0,
		hanRouteMetadataHanCharDocIdsBytes: 0,
		hanRouteHanCharPostingBytes: 0,
		hanRouteBodyCharIdsBytes: 0,
		hanRouteHanCharPostingStartsBytes: 0,
		hanRouteHanCharBlockIdsBytes: 0,
		hanRouteMetadataWitnessBytes: 0,
		hanRouteBodyWitnessBytes: 0,
		hanRouteBodyWitnessPositionBytes: 0,
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
	};
}

describe("coverage lexical v3 file search engine", () => {
	beforeEach(() => {
		container.registerInstance(
			OuterSetting,
			{
				ui: { maxItemResults: 30 },
				hideWeaklyRelatedResults: false,
			} as unknown as OuterSetting,
		);
		container.registerInstance(
			Tokenizer,
			{
				tokenizeSequence: (text: string) =>
					text
						.toLowerCase()
						.split(/\s+/u)
						.map((token) => token.trim())
						.filter((token) => token.length > 0),
			} as unknown as InstanceType<typeof Tokenizer>,
		);
		container.registerInstance(
			FileSnapshotStore,
			{
				readIndexedTexts: jest.fn(async () => new Map<string, string>()),
				readIndexedMetadata: jest.fn(async () => new Map()),
				readCurrentTexts: jest.fn(async () => new Map<string, string>()),
				publishLexicalFuzzyRescue: jest.fn(async () => undefined),
				readLexicalFuzzyRescue: jest.fn(
					async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
				),
				publishLexicalExactTapes: jest.fn(async () => undefined),
				readLexicalExactTapes: jest.fn(
					async () => EMPTY_RESIDENT_EXACT_TAPE_SIDECAR,
				),
				publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
				readLexicalBodyFamilySupport: jest.fn(
					async () => EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
				),
				publishLexicalBodyEvidence: jest.fn(async () => undefined),
				readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
				publishLexicalHanDocEvidence: jest.fn(async () => undefined),
				readLexicalHanDocEvidenceForDocs: jest.fn(async () => new Map()),
				publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
				readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => new Map()),
				publishLexicalHanWitnesses: jest.fn(async () => undefined),
				readLexicalHanWitnesses: jest.fn(
					async () => EMPTY_RESIDENT_HAN_WITNESS_SIDECAR,
				),
			} as unknown as FileSnapshotStore,
		);
	});

	test("reIndexAll builds a searchable runtime index", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
			createDocument({
				path: "infra/other.md",
				basename: "runtime note",
				folder: "infra",
				content: "misc runtime note",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token runtime access",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
		expect(matchedFiles[0]?.queryTerms).toEqual([
			"projected",
			"token",
			"runtime",
			"access",
		]);
		expect(matchedFiles[0]?.matchedTerms).toContain("projected");
	});

	test("releases pending content after indexed snapshot commit and can rebuild from snapshots", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () =>
				new Map<string, string>([
					["infra/projected-token.md", "placeholder body"],
				]),
			),
			readIndexedMetadata: jest.fn(async () =>
				new Map<string, { aliasesText?: string; tagsText?: string; headingsText?: string }>([
					[
						"infra/projected-token.md",
						{
							aliasesText: "projected token runtime access",
							tagsText: "runtime",
							headingsText: "Projected token runtime access",
						},
					],
				]),
			),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				generation: 101,
				aliases: "projected token runtime access",
				content: "placeholder body",
			}),
		]);

		expect(
			(
				engine as unknown as {
					pendingDocumentContentsByPath: Map<string, { text: string }>;
				}
			).pendingDocumentContentsByPath.get("infra/projected-token.md")?.text,
		).toBe("placeholder body");
		expect(
			(
				engine as unknown as {
					pendingDocumentMetadataByPath: Map<
						string,
						{ aliasesText: string; tagsText: string; headingsText: string }
					>;
				}
			).pendingDocumentMetadataByPath.get("infra/projected-token.md")?.aliasesText,
		).toBe("projected token runtime access");
		expect(snapshotStore.readIndexedTexts).not.toHaveBeenCalled();
		expect(snapshotStore.readIndexedMetadata).not.toHaveBeenCalled();

		engine.notifyIndexedTextsCommitted?.([
			{
				path: "infra/projected-token.md",
				generation: 101,
			},
		]);

		expect(
			(
				engine as unknown as {
					pendingDocumentContentsByPath: Map<string, { text: string }>;
				}
			).pendingDocumentContentsByPath.size,
		).toBe(0);
		expect(
			(
				engine as unknown as {
					pendingDocumentMetadataByPath: Map<string, unknown>;
				}
			).pendingDocumentMetadataByPath.size,
		).toBe(0);

		await (
			engine as unknown as {
				rebuildResidentBase: () => Promise<void>;
			}
		).rebuildResidentBase();

		expect(snapshotStore.readIndexedTexts).toHaveBeenCalledWith([
			{
				path: "infra/projected-token.md",
				generation: 101,
			},
		]);
		expect(snapshotStore.readIndexedMetadata).toHaveBeenCalledWith([
			{
				path: "infra/projected-token.md",
				generation: 101,
			},
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token runtime access",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
	});

	test("offloads fuzzy rescue sidecar and reloads matching fuzzy lookup keys for fuzzy search", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedFuzzyRescue: {
			candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: ReadonlyMap<
				string,
				Uint32Array
			>;
			fuzzyLookupKeyCount: number;
		} | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async (sidecar) => {
				persistedFuzzyRescue = sidecar;
			}),
			readLexicalFuzzyRescueForLookupKeys: jest.fn(async (fuzzyLookupKeys: readonly string[]) => {
				if (persistedFuzzyRescue == null) {
					throw new Error("missing fuzzy rescue sidecar");
				}
				return {
					...persistedFuzzyRescue,
					candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: new Map(
						fuzzyLookupKeys.flatMap((fuzzyLookupKey) => {
							const familyIds =
								persistedFuzzyRescue.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.get(
									fuzzyLookupKey,
								);
							return familyIds == null ? [] : [[fuzzyLookupKey, familyIds] as const];
						}),
					),
					fuzzyLookupKeyCount: fuzzyLookupKeys.filter((fuzzyLookupKey) =>
						persistedFuzzyRescue.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.has(
							fuzzyLookupKey,
						),
					).length,
				};
			}),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				path: "latin/obsidian.md",
				basename: "obsidian",
				folder: "latin",
				content: "plain note",
			}),
		]);

		expect(snapshotStore.publishLexicalFuzzyRescue).toHaveBeenCalledTimes(1);
		expect(
			(
				engine as unknown as {
					engine: { getFuzzyRescueSidecar: () => { fuzzyLookupKeyCount: number } };
				}
			).engine.getFuzzyRescueSidecar().fuzzyLookupKeyCount,
		).toBe(0);

		const matchedFiles = await engine.searchFiles({
			queryText: "obsidan",
			isPrefixMatch: false,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(snapshotStore.readLexicalFuzzyRescueForLookupKeys).toHaveBeenCalledTimes(1);
		expect(matchedFiles[0]?.path).toBe("latin/obsidian.md");
		expect(
			(
				engine as unknown as {
					engine: { getFuzzyRescueSidecar: () => { fuzzyLookupKeyCount: number } };
				}
			).engine.getFuzzyRescueSidecar().fuzzyLookupKeyCount,
		).toBe(0);
	});

	test("does not publish or read whole body family support sidecar during search rebuilds", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedBodyFamilySupport: { entryCount: number } | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalBodyFamilySupport: jest.fn(async (sidecar) => {
				persistedBodyFamilySupport = sidecar;
			}),
			readLexicalBodyFamilySupport: jest.fn(async () => {
				if (persistedBodyFamilySupport == null) {
					throw new Error("missing body family support sidecar");
				}
				return persistedBodyFamilySupport;
			}),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
		]);

		expect(snapshotStore.publishLexicalBodyFamilySupport).not.toHaveBeenCalled();
		expect(persistedBodyFamilySupport).toBeNull();

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(snapshotStore.readLexicalBodyFamilySupport).not.toHaveBeenCalled();
		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
	});

	test("does not publish or read whole exact tape sidecar during search rebuilds", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedExactTapes: { entryCount: number } | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalExactTapes: jest.fn(async (sidecar) => {
				persistedExactTapes = sidecar;
			}),
			readLexicalExactTapes: jest.fn(async () => {
				if (persistedExactTapes == null) {
					throw new Error("missing exact tape sidecar");
				}
				return persistedExactTapes;
			}),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
			),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
		]);

		expect(snapshotStore.publishLexicalExactTapes).not.toHaveBeenCalled();
		expect(persistedExactTapes).toBeNull();

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(snapshotStore.readLexicalExactTapes).not.toHaveBeenCalled();
		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
	});

	test("skips body sidecar reads when ranking does not shortlist body blocks", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(
				async () => EMPTY_RESIDENT_EXACT_TAPE_SIDECAR,
			),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
			),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(
				async () => EMPTY_RESIDENT_HAN_WITNESS_SIDECAR,
			),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				content: "unrelated payload for metadata-only hit",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
		expect(snapshotStore.readLexicalExactTapes).not.toHaveBeenCalled();
		expect(snapshotStore.readLexicalBodyFamilySupport).not.toHaveBeenCalled();
		expect(snapshotStore.readLexicalHanWitnesses).not.toHaveBeenCalled();
	});

	test("does not read whole exact/body/han sidecars for non-Han ranking queries", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				exactFamilyIds: readonly number[];
				exactTokenPositions: readonly number[];
				familySupportFamilyIds: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}
		>();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => EMPTY_RESIDENT_EXACT_TAPE_SIDECAR),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
			),
			publishLexicalBodyEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						blockOrdinal: number;
						exactFamilyIds: readonly number[];
						exactTokenPositions: readonly number[];
						familySupportFamilyIds: readonly number[];
						familySupportMaskByEntry: readonly number[];
					}>,
				) => {
					persistedBodyEvidence = new Map(
						rows.map((row) => [row.id, row]),
					);
				},
			),
			readLexicalBodyEvidenceForBlocks: jest.fn(
				async (locators: readonly LexicalBlockEvidenceLocator[]) =>
					createPersistedBodyEvidenceMap(locators, persistedBodyEvidence),
			),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(
				async () => EMPTY_RESIDENT_HAN_WITNESS_SIDECAR,
			),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				docRef: 101,
				path: "infra/projected-token.md",
				basename: "runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
		expect(snapshotStore.readLexicalExactTapes).not.toHaveBeenCalled();
		expect(snapshotStore.readLexicalBodyFamilySupport).not.toHaveBeenCalled();
		expect(snapshotStore.readLexicalHanWitnesses).not.toHaveBeenCalled();
	});

	test("hydrates non-Han body ranking evidence from shortlisted block rows", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				exactFamilyIds: readonly number[];
				exactTokenPositions: readonly number[];
				familySupportFamilyIds: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}
		>();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalBodyEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						blockOrdinal: number;
						exactFamilyIds: readonly number[];
						exactTokenPositions: readonly number[];
						familySupportFamilyIds: readonly number[];
						familySupportMaskByEntry: readonly number[];
					}>,
				) => {
					persistedBodyEvidence = new Map(
						rows.map((row) => [row.id, row]),
					);
				},
			),
			readLexicalBodyEvidenceForBlocks: jest.fn(
				async (locators: readonly LexicalBlockEvidenceLocator[]) =>
					createPersistedBodyEvidenceMap(locators, persistedBodyEvidence),
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => {
				throw new Error("exact tape sidecar should not be read");
			}),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(async () => {
				throw new Error("body family support sidecar should not be read");
			}),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(
				async () => EMPTY_RESIDENT_HAN_WITNESS_SIDECAR,
			),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				docRef: 102,
				path: "infra/projected-token.md",
				basename: "runtime access",
				folder: "infra/kubernetes",
				content: "Projected token runtime access in pod.",
			}),
		]);

		const matchedFiles = await engine.searchFiles({
			queryText: "projected token",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles[0]?.path).toBe("infra/projected-token.md");
		expect(snapshotStore.publishLexicalBodyEvidence).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalBodyEvidenceForBlocks).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalExactTapes).not.toHaveBeenCalled();
		expect(snapshotStore.readLexicalBodyFamilySupport).not.toHaveBeenCalled();
		expect(snapshotStore.readLexicalHanWitnesses).not.toHaveBeenCalled();
	});

	test("hydrates Han ranking evidence from doc/block rows without loading full Han sidecar", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedHanDocEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				identityWitnessStringIds: readonly number[];
				identityWitnessSourceMaskByDocEntry: readonly number[];
				routeWitnessStringIds: readonly number[];
				routeWitnessSourceMaskByDocEntry: readonly number[];
				headingWitnessStringIds: readonly number[];
			}
		>();
		let persistedHanBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				bodyWitnessStringIds: readonly number[];
				bodyWitnessStartOffsets: readonly number[];
			}
		>();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalBodyEvidence: jest.fn(async () => undefined),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalHanDocEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						identityWitnessStringIds: readonly number[];
						identityWitnessSourceMaskByDocEntry: readonly number[];
						routeWitnessStringIds: readonly number[];
						routeWitnessSourceMaskByDocEntry: readonly number[];
						headingWitnessStringIds: readonly number[];
					}>,
				) => {
					persistedHanDocEvidence = new Map(
						rows.map((row) => [row.id, row]),
					);
				},
			),
			readLexicalHanDocEvidenceForDocs: jest.fn(
				async (locators: readonly LexicalDocEvidenceLocator[]) =>
					createPersistedHanDocEvidenceMap(
						locators,
						persistedHanDocEvidence,
					),
			),
			publishLexicalHanBodyEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						blockOrdinal: number;
						bodyWitnessStringIds: readonly number[];
						bodyWitnessStartOffsets: readonly number[];
					}>,
				) => {
					persistedHanBodyEvidence = new Map(
						rows.map((row) => [row.id, row]),
					);
				},
			),
			readLexicalHanBodyEvidenceForBlocks: jest.fn(
				async (locators: readonly LexicalBlockEvidenceLocator[]) =>
					createPersistedHanBodyEvidenceMap(
						locators,
						persistedHanBodyEvidence,
					),
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => EMPTY_RESIDENT_EXACT_TAPE_SIDECAR),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
			),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(async () => {
				throw new Error("full Han witness sidecar should not be read");
			}),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				docRef: 201,
				path: "zh/cache-recovery.md",
                basename: "\u7f13\u5b58\u6062\u590d\u8bf4\u660e",
				folder: "zh",
                content: "\u7f13\u5b58\u6062\u590d\u8bf4\u660e \u6b65\u9aa4",
			}),
		]);

		const preparedSearch = (
			engine as unknown as {
				engine: {
					prepareSearch: (
						queryText: string,
						queryTerms: readonly string[],
						options?: {
							allowPrefixMatch?: boolean;
							allowFuzzyMatch?: boolean;
							maxItemResults?: number;
						},
					) => unknown;
				};
			}
        ).engine.prepareSearch("\u7f13\u5b58\u6062\u590d\u8bf4\u660e", ["\u7f13\u5b58\u6062\u590d\u8bf4\u660e"], {
			allowPrefixMatch: true,
			allowFuzzyMatch: false,
			maxItemResults: 5,
		});
		const hydrationResult = await (
			engine as unknown as {
				hydrateRankingEvidenceForCandidates: (
					preparedSearch: unknown,
				) => Promise<{
					hydratedEvidenceByLiveDocSlot: ReadonlyMap<number, unknown>;
				}>;
			}
		).hydrateRankingEvidenceForCandidates(preparedSearch);

		expect(hydrationResult.hydratedEvidenceByLiveDocSlot.size).toBeGreaterThan(0);
		expect(snapshotStore.publishLexicalHanDocEvidence).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalHanDocEvidenceForDocs).toHaveBeenCalledTimes(1);
		expect(snapshotStore.publishLexicalHanBodyEvidence).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalHanBodyEvidenceForBlocks).toHaveBeenCalledTimes(0);
		expect(snapshotStore.readLexicalHanWitnesses).not.toHaveBeenCalled();
	});

	test("does not publish or read whole han witness sidecar during search rebuilds", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedHanWitness: { bodyWitnessEntryCount: number } | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(
				async () => EMPTY_RESIDENT_EXACT_TAPE_SIDECAR,
			),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
			),
			publishLexicalHanWitnesses: jest.fn(async (sidecar) => {
				persistedHanWitness = sidecar;
			}),
			readLexicalHanWitnesses: jest.fn(async () => {
				if (persistedHanWitness == null) {
					throw new Error("missing han witness sidecar");
				}
				return persistedHanWitness;
			}),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				path: "zh/cache-recovery.md",
				basename: "\u7f13\u5b58\u6062\u590d\u8bf4\u660e",
				folder: "zh",
				content: "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u4e0e\u6062\u590d\u8bf4\u660e",
			}),
		]);

		expect(snapshotStore.publishLexicalHanWitnesses).not.toHaveBeenCalled();
		expect(persistedHanWitness).toBeNull();

		const matchedFiles = await engine.searchFiles({
			queryText: "\u7f13\u5b58\u6062\u590d\u8bf4\u660e",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(snapshotStore.readLexicalHanWitnesses).not.toHaveBeenCalled();
		expect(matchedFiles[0]?.path).toBe("zh/cache-recovery.md");
	});

	test("getDirectSubItems uses V3 query analysis with indexed snapshots", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
	const shorterTerm = "\u7f13\u5b58\u6062\u590d";
	const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		await engine.reIndexAll([
			createDocument({
				path: "notes/lifeforce.md",
				basename: "life note",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, shorterTerm),
				unitFamilyMatches: [],
				candidateDocs: [
					createCandidateDocRecall(0, {
						shortlistedBodyBlocks: [
							createCandidateBodyBlockRecall(0),
							createCandidateBodyBlockRecall(1),
						],
					}),
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/lifeforce.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: shorterTerm,
							metadataPackingSource: "route",
							inBestBodyWindow: true,
						}),
					],
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
					hanSurfaceCompletionGroups: [
						{
							surfaceGroupIndex: 0,
							surfaceText: fullSurface,
							tier: "body_window",
						},
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 2,
					strongestHanSurfaceCompletionTier: "body_window",
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([["notes/lifeforce.md", "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\n\n\u70ed\u542f\u52a8\u6062\u590d\u8bb0\u5f55\u3002"]]),
		);
		const readCurrentTexts = jest.fn();
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([2]),
		);
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts,
		});

		const subItems = await engine.getDirectSubItems(fullSurface, "notes/lifeforce.md", 3);

		expect(subItems).not.toBeNull();
		expect(subItems?.length).toBeGreaterThan(0);
		const snippet = subItems?.[0]?.snippet ?? subItems?.[0]?.text ?? "";
		expect(snippet).toContain(fullSurface);
		const highlightTexts = subItems?.[0]?.highlightRanges?.map((range) =>
			(subItems?.[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlightTexts?.length ?? 0).toBeGreaterThan(0);
		expect(readIndexedTexts).toHaveBeenCalledWith([
			{ path: "notes/lifeforce.md", generation: 100 },
		]);
		expect(readCurrentTexts).not.toHaveBeenCalled();
	});

	test("getDirectSubItems highlights a full Han surface instead of only the shorter real term", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
	const shorterTerm = "\u7f13\u5b58\u6062\u590d";
	const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		await engine.reIndexAll([
			createDocument({
				path: "notes/life-force.md",
				basename: "life force",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, shorterTerm),
				unitFamilyMatches: [],
				candidateDocs: [
					createCandidateDocRecall(0, {
						shortlistedBodyBlocks: [
							createCandidateBodyBlockRecall(0),
							createCandidateBodyBlockRecall(1),
						],
					}),
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/life-force.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: shorterTerm,
							metadataPackingSource: "route",
							inBestBodyWindow: true,
						}),
					],
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
					hanSurfaceCompletionGroups: [
						{
							surfaceGroupIndex: 0,
							surfaceText: fullSurface,
							tier: "body_residue",
						},
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 1,
					strongestHanSurfaceCompletionTier: "body_residue",
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([["notes/life-force.md", "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u8bf4\u660e\n\n\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u7528\u4e8e\u70ed\u542f\u52a8\u6062\u590d\u3002"]]),
		);
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([2]),
		);
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
		});

		const subItems = await engine.getDirectSubItems(fullSurface, "notes/life-force.md", 3);

		expect(subItems).not.toBeNull();
		const highlightTexts = subItems?.[0]?.highlightRanges?.map((range) =>
			(subItems?.[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlightTexts).toContain(fullSurface);
		expect(highlightTexts).not.toContain(shorterTerm);
	});

	test("getDirectSubItems guarantees a body witness when bodyWindow is the dominant evidence", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "notes/body-dominant.md",
				basename: "body dominant",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createLatinQueryAnalysis("runtime access", [
					"runtime",
					"access",
				]),
				unitFamilyMatches: [],
				candidateDocs: [
					createCandidateDocRecall(0, {
						shortlistedBodyBlocks: [createCandidateBodyBlockRecall(0)],
					}),
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/body-dominant.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: "runtime",
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: "runtime",
							inBestBodyWindow: true,
						}),
						createRealizedFamily({
							queryUnitIndex: 1,
							queryUnitText: "access",
							querySurfaceGroupIndex: 1,
							familyId: 1,
							familyText: "access",
							inBestBodyWindow: true,
						}),
					],
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([
				["notes/body-dominant.md", "runtime access restores the session quickly"],
			]),
		);
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([1]),
		);
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts: jest.fn(),
		});

		const subItems = await engine.getDirectSubItems(
			"runtime access",
			"notes/body-dominant.md",
			3,
		);

		expect(subItems).not.toBeNull();
		expect(subItems?.length ?? 0).toBeGreaterThan(0);
		expect(subItems?.[0]?.snippetText ?? "").toContain("runtime access");
	});

	
	test("getDirectSubItems falls back to current text when generation-aligned indexed text is unavailable", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
	const shorterTerm = "\u7f13\u5b58\u6062\u590d";
	const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		await engine.reIndexAll([
			createDocument({
				path: "notes/missing-snapshot.md",
				basename: "note",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, shorterTerm),
				unitFamilyMatches: [],
				candidateDocs: [
					createCandidateDocRecall(0, {
						shortlistedBodyBlocks: [createCandidateBodyBlockRecall(0)],
					}),
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "notes/missing-snapshot.md",
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 0,
							queryUnitText: shorterTerm,
							querySurfaceGroupIndex: 0,
							familyId: 0,
							familyText: shorterTerm,
							metadataPackingSource: "route",
							inBestBodyWindow: true,
						}),
					],
					bodyWindowContainer: createBodyWindowContainer([0]),
					strongestContainer: createBodyWindowContainer([0]),
					hanSurfaceCompletionGroups: [
						{
							surfaceGroupIndex: 0,
							surfaceText: fullSurface,
							tier: "body_residue",
						},
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 1,
					strongestHanSurfaceCompletionTier: "body_residue",
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () => new Map<string, string>());
		const readCurrentTexts = jest.fn(async () =>
			new Map([["notes/missing-snapshot.md", "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\n\n\u56de\u653e\u68c0\u67e5\u4e0e\u70ed\u542f\u52a8\u6062\u590d\u3002"]]),
		);
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([1]),
		);
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts,
		});

		const subItems = await engine.getDirectSubItems(fullSurface, "notes/missing-snapshot.md", 3);

		expect(subItems).not.toBeNull();
		expect(readCurrentTexts).toHaveBeenCalledWith(["notes/missing-snapshot.md"]);
		const highlightTexts = subItems?.[0]?.highlightRanges?.map((range) =>
			(subItems?.[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(highlightTexts).toContain(fullSurface);
		expect(highlightTexts).not.toContain(shorterTerm);
	});

	test("searchFiles passes tokenizer query terms into engine.search", async () => {
		const tokenizeSequence = jest.fn((text: string, mode?: "index" | "search") => {
			if (text === "systemproxy" && mode === "search") {
				return ["system", "proxy"];
			}
			return text
				.toLowerCase()
				.split(/\s+/u)
				.map((token) => token.trim())
				.filter((token) => token.length > 0);
		});
		container.registerInstance(
			Tokenizer,
			{ tokenizeSequence } as unknown as InstanceType<typeof Tokenizer>,
		);
		const engine = new CoverageLexicalV3FileSearchEngine();
	const shorterTerm = "\u7f13\u5b58\u6062\u590d";
	const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		await engine.reIndexAll([
			createDocument({
				path: "zh/split-hit.md",
				basename: "system",
				folder: "zh",
				content: "proxy",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, shorterTerm),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "partial.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
				createPackingProfile({
					docId: 1,
					path: "complete.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 1,
					strongestHanSurfaceCompletionTier: "body_residue",
				}),
			],
		}));
		(engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase | null;
				};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentBase: () => null,
		};

		const matchedFiles = await engine.searchFiles({
			queryText: "systemproxy",
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: false,
			maxItemResults: 5,
		});

		expect(tokenizeSequence).toHaveBeenCalledWith("systemproxy", "search");
		expect(matchedFiles.map((file) => file.path)).toEqual(["complete.md", "partial.md"]);
	});

	test("searchFiles hides same-band Han partials when weak results are hidden", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
	const shorterTerm = "\u7f13\u5b58\u6062\u590d";
	const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		await engine.reIndexAll([
			createDocument({
				path: "partial.md",
				basename: "partial",
				folder: "notes",
				content: "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4\u4e0e\u6062\u590d\u8bf4\u660e",
			}),
			createDocument({
				path: "complete.md",
				basename: "complete",
				folder: "notes",
				content: "缂撳瓨鎭㈠姝ラ缂撳瓨鎭㈠璇存槑",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, shorterTerm),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "partial.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "none" },
					],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
				createPackingProfile({
					docId: 1,
					path: "complete.md",
					coverageGate: {
						realizedCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_window" },
					],
					completedHanSurfaceGroupCount: 1,
					hanSurfaceCompletionTierScoreTotal: 2,
					strongestHanSurfaceCompletionTier: "body_window",
				}),
			],
		}));
		(engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase | null;
				};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentBase: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual(["complete.md"]);
	});

	test("searchFiles keeps singleton-completed weak Han rescue candidates when weak results are hidden", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "winsong-gong.md",
				basename: "note",
				folder: "zh",
				content: "\u529f\u80fd\u8bcd\u6e90\u8d62\u5b8b\u529f",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: "\u8d62\u5b8b\u529f",
					normalizedQueryText: "\u8d62\u5b8b\u529f",
					querySingletonHanChar: null,
					querySingletonHanCodePoint: null,
					querySingletonHanRecallEligible: false,
					surfaceGroups: [createHanSurfaceGroup(0, "\u8d62\u5b8b\u529f")],
					primaryUnits: [],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "h",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "winsong-gong.md",
					realizedCoverageCount: 0,
					coverageGate: {
						realizedCoverageCount: 0,
						fullySatisfiedSurfaceGroupCount: 0,
						startedSurfaceGroupCount: 0,
						crossScriptSatisfiedGroupCount: 0,
					},
					exactUnitCount: 0,
					realizedFamilies: [],
					hasOnlyWeakHanRescue: true,
					hasAnyHanRescueAssessment: true,
					singletonHanCompletion: {
						singletonHanChar: "\u529f",
						singletonHanCharIndex: 2,
						singletonHanSurfaceGroupIndex: 0,
						matched: true,
						matchSource: "body_same_block",
						bestAnchorKind: "bigram",
						bestAnchorDistance: 0,
						sameBlockAsAnchor: true,
						sameBlockAsBestBodyWindow: true,
						tier: "tight",
					},
					bodyWindowContainer: null,
					strongestContainer: null,
					hanSurfaceCompletionGroups: [],
					completedHanSurfaceGroupCount: 0,
					hanSurfaceCompletionTierScoreTotal: 0,
					strongestHanSurfaceCompletionTier: "none",
				}),
			],
		}));
		(engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase | null;
				};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentBase: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: "\u8d62\u5b8b\u529f",
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual(["winsong-gong.md"]);
	});

	test("searchFiles keeps weak witness order when indexed snapshots are unavailable", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "z-complete.md",
				basename: "note",
				folder: "zh",
				generation: 101,
				content: "placeholder",
			}),
			createDocument({
				path: "a-partial.md",
				basename: "note",
				folder: "zh",
				generation: 202,
				content: "placeholder",
			}),
		]);
		const readIndexedTexts = jest.fn(async () => new Map<string, string>());
		const readCurrentTexts = jest.fn();
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = createMockSearchRuntime(
			() => createRefineSearchResult(),
			createResidentBase(),
		);
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts,
		});

		const matchedFiles = await engine.searchFiles({
			queryText: "lifeforce",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(matchedFiles.map((file) => file.path)).toEqual([
			"a-partial.md",
			"z-complete.md",
		]);
		expect(readIndexedTexts).not.toHaveBeenCalled();
		expect(readCurrentTexts).not.toHaveBeenCalled();
	});
	test("searchFiles skips Han surface refine when no near-tie risk exists", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "single.md",
				basename: "note",
				folder: "zh",
				content: "placeholder",
			}),
		]);
		const readIndexedTexts = jest.fn(async () => new Map<string, string>());
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentBase: () => ResidentBase;
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).engine = createMockSearchRuntime(
			() => ({
				recallState: {
                    queryAnalysis: createHanQueryAnalysis("\u7f13\u5b58\u6062\u590d\u8bf4\u660e"),
                    unitFamilyMatches: [],
                    candidateDocs: [
                        createCandidateDocRecall(0, {
                            shortlistedBodyBlocks: [createCandidateBodyBlockRecall(0)],
                        }),
                    ],
				},
				rankedCandidates: [createPackingProfile({ docId: 0, path: "single.md" })],
			}),
			createResidentBase(),
		);
		(
			engine as unknown as {
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).getFileSnapshotStore = () => ({
			readIndexedTexts,
			readCurrentTexts: jest.fn(),
		});

		await engine.searchFiles({
			queryText: "lifeforce",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(readIndexedTexts).not.toHaveBeenCalled();
	});

	test("resident Han witness refine promotes best-window surface confirms above residue confirms", async () => {
		const result: CoverageLexicalV3SearchResult = {
			recallState: createRefineSearchResult().recallState,
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "b-residue.md",
					bodyWindowContainer: createBodyWindowContainer([1]),
					strongestContainer: createBodyWindowContainer([1]),
				}),
				createPackingProfile({
					docId: 1,
					path: "a-window.md",
					bodyWindowContainer: createBodyWindowContainer([2]),
					strongestContainer: createBodyWindowContainer([2]),
				}),
			],
		};
		const residentBase = withBodyWitnessTexts(createResidentBase(), [
			["lifeforce"],
			[],
			["lifeforce"],
		]);
		const refined = await runHanRefine(result, {
			residentBase,
		});

		expect(refined.map((candidate) => candidate.path)).toEqual([
			"a-window.md",
			"b-residue.md",
		]);
		expect(refined[0].strongestHanSurfaceCompletionTier).toBe("body_window");
		expect(refined[1].strongestHanSurfaceCompletionTier).toBe("body_residue");
	});

	test("resident Han witness refine checks all shortlisted blocks without raw query budget caps", async () => {
		const blockCounts = [100, 100, 100, 100, 100] as const;
		const residentBaseWithoutWitness = createResidentBaseForBlockCounts(blockCounts);
		const candidateDocs = blockCounts.map((blockCount, docId) =>
			createCandidateDocRecall(docId, {
				shortlistedBodyBlocks: Array.from({ length: blockCount }, (_, ordinal) =>
					createCandidateBodyBlockRecall(
						residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId] +
							ordinal,
					),
				),
			}),
		);
		const rankedCandidates = blockCounts.map((_, docId) =>
			createPackingProfile({
				docId,
				path: String.fromCharCode(97 + docId) + ".md",
				bodyWindowContainer: createBodyWindowContainer([
					residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId],
				]),
				strongestContainer: createBodyWindowContainer([
					residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId],
				]),
			}),
		);
		const result: CoverageLexicalV3SearchResult = {
			recallState: {
				...createRefineSearchResult().recallState,
				candidateDocs,
			},
			rankedCandidates,
		};
		const residentBase = withBodyWitnessTexts(
			residentBaseWithoutWitness,
			Array.from(
				{ length: residentBaseWithoutWitness.bodyBlocks.blockCount },
				(_, blockId) => {
					const blockOrdinal =
						residentBaseWithoutWitness.bodyBlocks.blockOrdinalByBlockId[blockId] ?? 0;
					return blockOrdinal === 0 ? ["lifeforce"] : [];
				},
			),
		);
		const refined = await runHanRefine(result, { residentBase });

		expect(
			refined.every(
				(candidate) => candidate.strongestHanSurfaceCompletionTier === "body_window",
			),
		).toBe(true);
	});
});
