// @ts-nocheck
jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import { OuterSetting } from "src/globals/plugin-setting";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import { EMPTY_RESIDENT_FUZZY_RESCUE_INDEX } from "src/services/search/coverage-lexical-v3/layout/fuzzy-rescue";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { buildBlockPositionLane } from "src/services/search/coverage-lexical-v3/layout/position-lanes";
import { buildResidentHotBaseArtifacts, buildStableWitnessMatchKey } from "src/services/search/coverage-lexical-v3/build";
import { createDexieCoverageLexicalV3ResidentShardArtifactStore } from "src/services/search/coverage-lexical-v3/artifact-loader";
import { MemoryActiveOverlayJournalStore } from "src/services/search/coverage-lexical-v3/active-overlay-journal";
import {
	MemoryCompactJobManifestStore,
	MemoryCompactTempArtifactStore,
} from "src/services/search/coverage-lexical-v3/compact";
import { MemoryCoverageLexicalV3SnapshotStore } from "src/services/search/coverage-lexical-v3/snapshot";
import { createMemoryCoverageLexicalV3ProductionStores } from "src/services/search/coverage-lexical-v3/stores";
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
import { planHanSurfaceGroupRecallsAfterFamilyLookup } from "src/services/search/coverage-lexical-v3/recall/han-surface-groups";
import type { HanRescueAssessment } from "src/services/search/coverage-lexical-v3/han-rescue";
import {
	buildIndexedSnapshotRequestKey,
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

const UNUSED_LEGACY_EVIDENCE_PAYLOAD = {} as never;

class FakeArtifactTable {
	rows = new Map<string, unknown>();

	constructor(private readonly keyOf: (row: any) => string) {}

	async get(key: string) {
		return this.rows.get(key);
	}

	async put(row: any) {
		this.rows.set(this.keyOf(row), row);
	}

	async delete(key: string) {
		this.rows.delete(key);
	}
}

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
		shardId: overrides.shardId ?? "test-shard",
		shardGeneration: overrides.shardGeneration ?? 1,
		docId: overrides.docId,
		liveDocSlot: overrides.liveDocSlot ?? overrides.docId,
		path: overrides.path,
		stableKey: overrides.stableKey ?? overrides.path,
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "h",
		realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
		coverageGate: overrides.coverageGate ?? {
			realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
			visibilityCoverageCount: overrides.realizedCoverageCount ?? 1,
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
			exactShardLocalFamilySlots: readonly number[];
			exactTokenPositions: readonly number[];
			supportShardLocalFamilySlots: readonly number[];
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
					exactShardLocalFamilySlots: row.exactShardLocalFamilySlots,
					exactTokenPositions: row.exactTokenPositions,
					supportEntriesByShardLocalFamilySlot:
						Array.from(
							row.supportShardLocalFamilySlots,
							(shardLocalFamilySlot, index) => ({
							shardLocalFamilySlot,
							supportMask: row.familySupportMaskByEntry[index] ?? 0,
							}),
						),
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
			identityWitnessMatchKeys: readonly number[];
			identityWitnessTexts: readonly string[];
			identityWitnessSourceMaskByDocEntry: readonly number[];
			routeWitnessMatchKeys: readonly number[];
			routeWitnessTexts: readonly string[];
			routeWitnessSourceMaskByDocEntry: readonly number[];
			headingWitnessMatchKeys: readonly number[];
			headingWitnessTexts: readonly string[];
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
					identityWitnessMatchKeys: row.identityWitnessMatchKeys,
					identityWitnessTexts: row.identityWitnessTexts,
					identityWitnessSourceMasks:
						row.identityWitnessSourceMaskByDocEntry,
					routeWitnessMatchKeys: row.routeWitnessMatchKeys,
					routeWitnessTexts: row.routeWitnessTexts,
					routeWitnessSourceMasks: row.routeWitnessSourceMaskByDocEntry,
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
	residentBase?: ResidentBase,
) {
	return createMapFromEntries(
		locators.map((locator) => {
			const row = persistedHanBodyEvidence.get(
				buildLexicalBlockEvidenceRowId(locator),
			);
			if (row == null) {
				return null;
			}
			const bodyWitnessTexts =
				row.bodyWitnessTexts ??
				(row.bodyWitnessStringIds ?? []).map((stringId) =>
					residentBase == null ? "" : readTestResidentString(residentBase, stringId),
				);
			return [
				row.id,
				{
					bodyWitnessMatchKeys:
						row.bodyWitnessMatchKeys ?? bodyWitnessTexts.map(buildStableWitnessMatchKey),
					bodyWitnessTexts,
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
		shardId: overrides.shardId ?? "test-shard",
		shardGeneration: overrides.shardGeneration ?? 1,
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

function createHanBigramRescueAssessment(
	overrides: Partial<HanRescueAssessment> = {},
): HanRescueAssessment {
	return {
		surfaceGroupIndex: overrides.surfaceGroupIndex ?? 0,
		context: overrides.context ?? "body",
		rescueMode: overrides.rescueMode ?? "whole_group_when_real_miss",
		strength: overrides.strength ?? "weak",
		matchedBigramCount: overrides.matchedBigramCount ?? 1,
		matchedRealAnchorCount: overrides.matchedRealAnchorCount ?? 0,
		coversStartAnchor: overrides.coversStartAnchor ?? true,
		coversEndAnchor: overrides.coversEndAnchor ?? true,
		coversEndpoints: overrides.coversEndpoints ?? true,
		preservesSurfaceOrder: overrides.preservesSurfaceOrder ?? true,
		rankingScore: overrides.rankingScore ?? 1,
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
			familySupportShardLocalFamilySlots: new Uint32Array(),
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
			identityWitnessTextIds: new Uint32Array(),
			identityWitnessSourceMaskByDocEntry: new Uint8Array(),
			routeWitnessStartByDocId: new Uint32Array(),
			routeWitnessStartByLiveDocSlot: new Uint32Array(),
			routeWitnessTextIds: new Uint32Array(),
			routeWitnessSourceMaskByDocEntry: new Uint8Array(),
			headingWitnessStartByDocId: new Uint32Array(),
			headingWitnessStartByLiveDocSlot: new Uint32Array(),
			headingWitnessTextIds: new Uint32Array(),
			bodyWitnessOccurrenceStartByBlockId: new Uint32Array(),
			bodyWitnessOccurrenceTextIds: new Uint32Array(),
			bodyWitnessPositionEncodingByBlockId: new Uint8Array(),
			bodyWitnessPositionStartByBlockId: new Uint32Array(),
			bodyWitnessPositionDeltaU8Tape: new Uint8Array(),
			bodyWitnessPositionDeltaU16Tape: new Uint16Array(),
			bodyWitnessPositionDeltaU32Tape: new Uint32Array(),
		},
		metrics: createZeroResidentMetrics(),
		fuzzyRescue: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
	};
}

function createResidentBaseForBlockCounts(
	blockCountsByDoc: readonly number[],
	paths: readonly string[] = [],
): ResidentBase {
	const base = createResidentBase();
	const stringArena = createStringArena(paths);
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
		stringArena: paths.length > 0 ? stringArena : base.stringArena,
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
			pathStringIds: new Uint32Array(blockCountsByDoc.map((_, index) => index)),
			pathStringIdsByLiveDocSlot: new Uint32Array(blockCountsByDoc.map((_, index) => index)),
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
			familySupportShardLocalFamilySlots: new Uint32Array(),
			familySupportMaskByEntry: new Uint8Array(),
		},
	};
}

function createStringArena(texts: readonly string[]): ResidentBase["stringArena"] {
	let text = "";
	const offsets: number[] = [];
	const lengths: number[] = [];
	for (const value of texts) {
		offsets.push(text.length);
		lengths.push(value.length);
		text += value;
	}
	return {
		text,
		offsets: new Uint32Array(offsets),
		lengths: new Uint32Array(lengths),
		count: texts.length,
	};
}

function withBodyWitnessTexts(
	base: ResidentBase,
	bodyWitnessTextsByBlock: ReadonlyArray<readonly string[]>,
): ResidentBase {
	const orderedStrings = Array.from({ length: base.stringArena.count }, (_, stringId) =>
		readTestResidentString(base, stringId),
	);
	if (orderedStrings.length === 0) {
		orderedStrings.push("");
	}
	const uniqueStrings = new Map<string, number>(
		orderedStrings.map((text, stringId) => [text, stringId]),
	);
	const bodyWitnessOccurrenceStartByBlockId: number[] = [];
	const bodyWitnessOccurrenceTextIds: number[] = [];
	const bodyWitnessStartOffsetsByBlock = bodyWitnessTextsByBlock.map((texts) =>
		texts.map((_, index) => index),
	);
	for (let blockId = 0; blockId < base.bodyBlocks.blockCount; blockId += 1) {
		bodyWitnessOccurrenceStartByBlockId.push(bodyWitnessOccurrenceTextIds.length);
		for (const text of bodyWitnessTextsByBlock[blockId] ?? []) {
			let stringId = uniqueStrings.get(text);
			if (stringId == null) {
				stringId = orderedStrings.length;
				uniqueStrings.set(text, stringId);
				orderedStrings.push(text);
			}
			bodyWitnessOccurrenceTextIds.push(stringId);
		}
	}
	bodyWitnessOccurrenceStartByBlockId.push(bodyWitnessOccurrenceTextIds.length);
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
			bodyWitnessOccurrenceTextIds: new Uint32Array(bodyWitnessOccurrenceTextIds),
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
				getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
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
			hydratedEvidenceByCandidateKey: ReadonlyMap<string, unknown>,
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
		residentBase.hanRoute.bodyWitnessOccurrenceTextIds.slice(start, end),
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
		hydrateCandidateEvidenceByShard: (
			candidateDocs: readonly V3CandidateDocRecall[],
		) => hydrateCandidateEvidenceBatch(residentBase, candidateDocs, {}),
		getResidentIndexView: () => ({
			shards: [{ shardId: "test-shard", generation: 1, base: residentBase }],
		}),
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
					async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
				),
				publishLexicalExactTapes: jest.fn(async () => undefined),
				readLexicalExactTapes: jest.fn(async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD),
				publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
				readLexicalBodyFamilySupport: jest.fn(
					async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
				),
				publishLexicalBodyEvidence: jest.fn(async () => undefined),
				readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
				publishLexicalHanDocEvidence: jest.fn(async () => undefined),
				readLexicalHanDocEvidenceForDocs: jest.fn(async () => new Map()),
				publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
				readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => new Map()),
				publishLexicalHanWitnesses: jest.fn(async () => undefined),
				readLexicalHanWitnesses: jest.fn(
					async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
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

	test("ignores stale resident rebuild completion after a newer rebuild starts", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let resolveOldRebuild: (documents: IndexedDocument[]) => void = () => undefined;
		const oldRebuildDocuments = new Promise<IndexedDocument[]>((resolve) => {
			resolveOldRebuild = resolve;
		});
		let materializeCallCount = 0;
		(engine as any).materializeIndexedDocuments = jest.fn(async () => {
			materializeCallCount += 1;
			if (materializeCallCount === 1) {
				return await oldRebuildDocuments;
			}
			return [
				createDocument({
					docRef: 2,
					path: "new.md",
					basename: "new",
					folder: "",
					content: "newtarget",
				}),
			];
		});

		const oldRebuild = (engine as any).rebuildResidentBase();
		await Promise.resolve();
		const newRebuild = (engine as any).rebuildResidentBase();
		await newRebuild;
		resolveOldRebuild([
			createDocument({
				docRef: 1,
				path: "old.md",
				basename: "old",
				folder: "",
				content: "oldtarget",
			}),
		]);
		await oldRebuild;

		const indexView = (engine as any).engine.getResidentIndexView();
		expect(Array.from(indexView.shards[0].base.docTable.docRefsByDocId)).toEqual([2]);
	});

	test("persists resident artifact and restores it without rebuilding documents", async () => {
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable((row) => row.id),
		);
		const overlayJournalStore = new MemoryActiveOverlayJournalStore();
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore();
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore,
			snapshotStore,
		};
		const sourceEngine = new CoverageLexicalV3FileSearchEngine();
		(sourceEngine as any).getPersistentStores = () => persistentStores;
		await sourceEngine.reIndexAll([
			createDocument({
				docRef: 7,
				path: "notes/restored.md",
				basename: "restored",
				folder: "notes",
				content: "snapshot restore target",
				generation: 11,
			}),
		]);

		await sourceEngine.persistFileIndexArtifact();

		const restoredEngine = new CoverageLexicalV3FileSearchEngine();
		(restoredEngine as any).getPersistentStores = () => persistentStores;
		const restored = await restoredEngine.restorePersistedFileIndex();

		expect(restored).toBe(true);
		expect(restoredEngine.getIndexedDocumentCount()).toBe(1);
		const results = await restoredEngine.searchFiles({
			queryText: "snapshot restore target",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(results[0]?.path).toBe("notes/restored.md");
		expect(results[0]?.snapshotGeneration).toBe(11);
		await expect(
			restoredEngine.planPersistentRecovery([
				{ docRef: 7, path: "notes/restored.md", generation: 11 },
			]),
		).resolves.toMatchObject({ status: "up_to_date" });
		await expect(
			restoredEngine.planPersistentRecovery([
				{ docRef: 7, path: "notes/restored.md", generation: 12 },
			]),
		).resolves.toMatchObject({
			status: "needs_heal",
			docsToUpdate: ["notes/restored.md"],
		});
	});

	test("clears all persisted V3 bootstrap and maintenance stores on reset", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const tableNames = [
			"coverageLexicalV3ShardRegistry",
			"coverageLexicalV3Invalidations",
			"coverageLexicalV3ResidentShardArtifacts",
			"coverageLexicalV3ActiveOverlayJournal",
			"coverageLexicalV3SnapshotManifests",
			"coverageLexicalV3CompactJobs",
			"coverageLexicalV3CompactTempArtifacts",
			"lexicalBodyEvidence",
			"lexicalHanDocEvidence",
			"lexicalHanBodyEvidence",
		];
		const tables = Object.fromEntries(
			tableNames.map((tableName) => [tableName, { clear: jest.fn(async () => {}) }]),
		);
		const transaction = jest.fn(
			async (_mode: "rw", ...args: [...unknown[], () => Promise<void>]) => {
				const callback = args[args.length - 1] as () => Promise<void>;
				await callback();
			},
		);
		(engine as any).getDatabase = () => ({ db: { ...tables, transaction } });

		await engine.clearPersistedFileIndexArtifact();

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(transaction.mock.calls[0]?.length).toBe(tableNames.length + 2);
		for (const tableName of tableNames) {
			expect(tables[tableName].clear).toHaveBeenCalledTimes(1);
		}
	});

	test("preserves restored shard artifact owners when persisting snapshot artifacts", async () => {
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactTable = new FakeArtifactTable((row) => row.id);
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			artifactTable,
		);
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore(),
		};
		const engine = new CoverageLexicalV3FileSearchEngine();
		(engine as any).getPersistentStores = () => persistentStores;
		const residentArtifacts = buildResidentHotBaseArtifacts([
			createDocument({
				docRef: 37,
				path: "notes/custom-owner.md",
				basename: "custom-owner",
				folder: "notes",
				content: "custom owner target",
				generation: 2,
			}),
		]);
		(engine as any).engine.loadResidentIndexView({
			version: 1,
			shards: [
				{
					shardId: "active-1",
					generation: 2,
					base: {
						...residentArtifacts.base,
						fuzzyRescue: residentArtifacts.fuzzyRescueIndex,
					},
				},
			],
			shardRegistry: [
				{
					shardId: "active-1",
					generation: 2,
					state: "active",
					sourceBytes: 123,
					docCount: 1,
					staleDocCount: 1,
					staleSourceBytes: 50,
					createdOrder: 9,
					artifactOwner: "custom-owner",
				},
			],
		});

		await engine.persistFileIndexArtifact();

		expect(artifactTable.rows.has("custom-owner@2")).toBe(true);
		expect(artifactTable.rows.has("active-1@2")).toBe(false);
		await expect(productionStores.shardRegistry.loadRegistry()).resolves.toEqual([
			expect.objectContaining({
				shardId: "active-1",
				generation: 2,
				state: "active",
				sourceBytes: 123,
				staleDocCount: 1,
				staleSourceBytes: 50,
				createdOrder: 9,
				artifactOwner: "custom-owner",
			}),
		]);
	});

	test("applies persistent recovery updates through V3 overlay without resident rebuild", async () => {
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable((row) => row.id),
		);
		const overlayJournalStore = new MemoryActiveOverlayJournalStore();
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore();
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore,
			snapshotStore,
		};
		const engine = new CoverageLexicalV3FileSearchEngine();
		(engine as any).getPersistentStores = () => persistentStores;
		const persistedBodyEvidence = new Map<string, any>();
		const persistedHanDocEvidence = new Map<string, any>();
		const persistedHanBodyEvidence = new Map<string, any>();
		const evidenceSnapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalBodyEvidence: jest.fn(async (rows: readonly any[]) => {
				for (const row of rows) {
					persistedBodyEvidence.set(row.id, row);
				}
			}),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => persistedBodyEvidence),
			publishLexicalHanDocEvidence: jest.fn(async (rows: readonly any[]) => {
				for (const row of rows) {
					persistedHanDocEvidence.set(row.id, row);
				}
			}),
			readLexicalHanDocEvidenceForDocs: jest.fn(async () => persistedHanDocEvidence),
			publishLexicalHanBodyEvidence: jest.fn(async (rows: readonly any[]) => {
				for (const row of rows) {
					persistedHanBodyEvidence.set(row.id, row);
				}
			}),
			readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => persistedHanBodyEvidence),
			readLexicalFuzzyRescue: jest.fn(async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX),
		};
		(engine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await engine.reIndexAll([
			createDocument({
				docRef: 17,
				path: "notes/healed.md",
				basename: "healed",
				folder: "notes",
				content: "ancientresidentonly",
				generation: 1,
			}),
		]);
		(engine as any).rebuildResidentBase = jest.fn(async () => {
			throw new Error("persistent recovery should not rebuild resident base");
		});

		await expect(
			engine.applyPersistentRecoveryChanges({
				deletePaths: [],
				upsertDocuments: [
					createDocument({
						docRef: 17,
						path: "notes/healed.md",
						basename: "healed",
						folder: "notes",
						content: "brandnewoverlayonly",
						generation: 2,
					}),
				],
			}),
		).resolves.toBe(true);

		expect((engine as any).rebuildResidentBase).not.toHaveBeenCalled();
		await expect(productionStores.invalidations.loadInvalidations()).resolves.toEqual([
			expect.objectContaining({
				shardId: "base-0",
				shardGeneration: 1,
				docRef: 17,
				docGeneration: 1,
			}),
		]);
		await expect(
			overlayJournalStore.loadActiveOverlayEntries({
				activeShardId: "base-0",
				activeShardGeneration: 1,
			}),
		).resolves.toHaveLength(1);
		const oldResults = await engine.searchFiles({
			queryText: "ancientresidentonly",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(oldResults.map((result) => result.path)).not.toContain("notes/healed.md");
		const newResults = await engine.searchFiles({
			queryText: "brandnewoverlayonly",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(newResults[0]?.path).toBe("notes/healed.md");
		expect(newResults[0]?.snapshotGeneration).toBe(2);

		await engine.persistFileIndexArtifact();
		const restoredEngine = new CoverageLexicalV3FileSearchEngine();
		(restoredEngine as any).getPersistentStores = () => persistentStores;
		(restoredEngine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await expect(restoredEngine.restorePersistedFileIndex()).resolves.toBe(true);
		const restoredResults = await restoredEngine.searchFiles({
			queryText: "brandnewoverlayonly",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(restoredResults[0]?.path).toBe("notes/healed.md");
		await expect(
			restoredEngine.planPersistentRecovery([
				{ docRef: 17, path: "notes/healed.md", generation: 2 },
			]),
		).resolves.toMatchObject({ status: "up_to_date" });
	});

	test("restored overlay deletes do not reappear in persistent recovery", async () => {
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable((row) => row.id),
		);
		const overlayJournalStore = new MemoryActiveOverlayJournalStore();
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore();
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore,
			snapshotStore,
		};
		const evidenceSnapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalBodyEvidence: jest.fn(async () => undefined),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalHanDocEvidence: jest.fn(async () => undefined),
			readLexicalHanDocEvidenceForDocs: jest.fn(async () => new Map()),
			publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
			readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX),
			readLexicalFuzzyRescueForLookupKeys: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
		};
		const engine = new CoverageLexicalV3FileSearchEngine();
		(engine as any).getPersistentStores = () => persistentStores;
		(engine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await engine.reIndexAll([
			createDocument({
				docRef: 31,
				path: "notes/keep.md",
				basename: "keep",
				folder: "notes",
				content: "keep target",
				generation: 1,
			}),
			createDocument({
				docRef: 32,
				path: "notes/deleted.md",
				basename: "deleted",
				folder: "notes",
				content: "deleted target",
				generation: 1,
			}),
		]);

		await expect(
			engine.applyPersistentRecoveryChanges({
				deletePaths: ["notes/deleted.md"],
				upsertDocuments: [],
			}),
		).resolves.toBe(true);
		expect(engine.getIndexedDocumentCount()).toBe(1);
		await engine.persistFileIndexArtifact();

		const restoredEngine = new CoverageLexicalV3FileSearchEngine();
		(restoredEngine as any).getPersistentStores = () => persistentStores;
		(restoredEngine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await expect(restoredEngine.restorePersistedFileIndex()).resolves.toBe(true);

		expect(restoredEngine.getIndexedDocumentCount()).toBe(1);
		await expect(
			restoredEngine.planPersistentRecovery([
				{ docRef: 31, path: "notes/keep.md", generation: 1 },
			]),
		).resolves.toMatchObject({
			status: "up_to_date",
			docsToDelete: [],
		});
	});

	test("serializes overlay recovery writes so concurrent heals keep distinct journal sequences", async () => {
		class RaceyOverlayJournalStore extends MemoryActiveOverlayJournalStore {
			private capturedEmptyLoads = 0;

			async loadActiveOverlayEntries(params: {
				activeShardId: string;
				activeShardGeneration: number;
			}) {
				const entries = await super.loadActiveOverlayEntries(params);
				if (this.capturedEmptyLoads >= 2 || entries.length > 0) {
					return entries;
				}
				this.capturedEmptyLoads += 1;
				if (this.capturedEmptyLoads === 1) {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
				return entries;
			}
		}
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable((row) => row.id),
		);
		const overlayJournalStore = new RaceyOverlayJournalStore();
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore,
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore(),
		};
		const evidenceSnapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalBodyEvidence: jest.fn(async () => undefined),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalHanDocEvidence: jest.fn(async () => undefined),
			readLexicalHanDocEvidenceForDocs: jest.fn(async () => new Map()),
			publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
			readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX),
			readLexicalFuzzyRescueForLookupKeys: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
		};
		const engine = new CoverageLexicalV3FileSearchEngine();
		(engine as any).getPersistentStores = () => persistentStores;
		(engine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await engine.reIndexAll([
			createDocument({
				docRef: 40,
				path: "notes/base.md",
				basename: "base",
				folder: "notes",
				content: "base content",
				generation: 1,
			}),
		]);

		await Promise.all([
			engine.applyPersistentRecoveryChanges({
				deletePaths: [],
				upsertDocuments: [
					createDocument({
						docRef: 41,
						path: "notes/first.md",
						basename: "first",
						folder: "notes",
						content: "first recovered content",
						generation: 1,
					}),
				],
			}),
			engine.applyPersistentRecoveryChanges({
				deletePaths: [],
				upsertDocuments: [
					createDocument({
						docRef: 42,
						path: "notes/second.md",
						basename: "second",
						folder: "notes",
						content: "second recovered content",
						generation: 1,
					}),
				],
			}),
		]);

		await expect(
			overlayJournalStore.loadActiveOverlayEntries({
				activeShardId: "base-0",
				activeShardGeneration: 1,
			}),
		).resolves.toEqual([
			expect.objectContaining({
				sequence: 1,
				document: expect.objectContaining({ path: "notes/first.md" }),
			}),
			expect.objectContaining({
				sequence: 2,
				document: expect.objectContaining({ path: "notes/second.md" }),
			}),
		]);
	});

	test("persist waits for pending overlay recovery before snapshotting the overlay tail", async () => {
		class SlowAppendOverlayJournalStore extends MemoryActiveOverlayJournalStore {
			async appendOverlayEntries(entries: readonly any[]) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				await super.appendOverlayEntries(entries);
			}
		}
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable((row) => row.id),
		);
		const overlayJournalStore = new SlowAppendOverlayJournalStore();
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore();
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore,
			snapshotStore,
		};
		const evidenceSnapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalBodyEvidence: jest.fn(async () => undefined),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalHanDocEvidence: jest.fn(async () => undefined),
			readLexicalHanDocEvidenceForDocs: jest.fn(async () => new Map()),
			publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
			readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX),
			readLexicalFuzzyRescueForLookupKeys: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
		};
		const engine = new CoverageLexicalV3FileSearchEngine();
		(engine as any).getPersistentStores = () => persistentStores;
		(engine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await engine.reIndexAll([
			createDocument({
				docRef: 50,
				path: "notes/base.md",
				basename: "base",
				folder: "notes",
				content: "base content",
				generation: 1,
			}),
		]);

		const recovery = engine.applyPersistentRecoveryChanges({
			deletePaths: [],
			upsertDocuments: [
				createDocument({
					docRef: 51,
					path: "notes/recovered.md",
					basename: "recovered",
					folder: "notes",
					content: "recovered content",
					generation: 1,
				}),
			],
		});
		await engine.persistFileIndexArtifact();
		await recovery;

		const manifest = await snapshotStore.loadLatestCommittedManifest();
		expect(manifest?.overlayJournalRefs).toEqual([
			expect.objectContaining({
				entryId: "base-0@1:1",
				activeShardId: "base-0",
				activeShardGeneration: 1,
				sequence: 1,
			}),
		]);
	});

	test("reloads runtime after maintenance fold so the next persist cannot roll registry back", async () => {
		const productionStores = createMemoryCoverageLexicalV3ProductionStores();
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable((row) => row.id),
		);
		const overlayJournalStore = new MemoryActiveOverlayJournalStore();
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore();
		const persistentStores = {
			productionStores,
			artifactStore,
			overlayJournalStore,
			snapshotStore,
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
		};
		const engine = new CoverageLexicalV3FileSearchEngine();
		(engine as any).getPersistentStores = () => persistentStores;
		const indexedTextSnapshots = new Map<string, { text: string }>();
		const indexedMetadataSnapshots = new Map<string, any>();
		const evidenceSnapshotStore = {
			readIndexedTextSnapshots: jest.fn(async (requests: readonly any[]) => {
				return new Map(
					requests.flatMap((request) => {
						const key = buildIndexedSnapshotRequestKey(request);
						const snapshot = indexedTextSnapshots.get(key);
						return snapshot == null ? [] : [[key, snapshot]];
					}),
				);
			}),
			readIndexedTexts: jest.fn(async (requests: readonly any[]) => {
				return new Map(
					requests.flatMap((request) => {
						const key = buildIndexedSnapshotRequestKey(request);
						const snapshot = indexedTextSnapshots.get(key);
						return snapshot == null ? [] : [[request.path, snapshot.text]];
					}),
				);
			}),
			readIndexedMetadata: jest.fn(async (requests: readonly any[]) => {
				return new Map(
					requests.flatMap((request) => {
						const key = buildIndexedSnapshotRequestKey(request);
						const snapshot = indexedMetadataSnapshots.get(key);
						return snapshot == null ? [] : [[key, snapshot]];
					}),
				);
			}),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalBodyEvidence: jest.fn(async () => {}),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalHanDocEvidence: jest.fn(async () => {}),
			readLexicalHanDocEvidenceForDocs: jest.fn(async () => new Map()),
			publishLexicalHanBodyEvidence: jest.fn(async () => {}),
			readLexicalHanBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalFuzzyRescue: jest.fn(async () => {}),
			readLexicalFuzzyRescue: jest.fn(async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX),
			readLexicalFuzzyRescueForLookupKeys: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
		};
		(engine as any).getFileSnapshotStore = () => evidenceSnapshotStore;
		await engine.reIndexAll([
			createDocument({
				docRef: 100,
				path: "notes/base.md",
				basename: "base",
				folder: "notes",
				content: "stable base content",
				generation: 1,
			}),
		]);
		indexedTextSnapshots.set(
			buildIndexedSnapshotRequestKey({ path: "notes/base.md", generation: 1 }),
			{ text: "stable base content" },
		);
		await engine.persistFileIndexArtifact();
		const overlayDocuments = Array.from({ length: 64 }, (_, index) =>
			createDocument({
				docRef: 200 + index,
				path: `notes/folded-${index}.md`,
				basename: `folded-${index}`,
				folder: "notes",
				content: `folded maintenance target ${index}`,
				generation: 1,
			}),
		);

		await engine.applyPersistentRecoveryChanges({
			deletePaths: [],
			upsertDocuments: overlayDocuments,
		});
		await expect(
			overlayJournalStore.loadActiveOverlayEntries({
				activeShardId: "base-0",
				activeShardGeneration: 1,
			}),
		).resolves.toHaveLength(64);

		await engine.persistFileIndexArtifact();
		await expect(
			overlayJournalStore.loadActiveOverlayEntries({
				activeShardId: "base-0",
				activeShardGeneration: 1,
			}),
		).resolves.toHaveLength(0);
		await expect(productionStores.shardRegistry.loadRegistry()).resolves.toEqual([
			expect.objectContaining({
				shardId: "base-0",
				generation: 2,
				state: "active",
				docCount: 65,
			}),
		]);

		await engine.persistFileIndexArtifact();
		await expect(productionStores.shardRegistry.loadRegistry()).resolves.toEqual([
			expect.objectContaining({
				shardId: "base-0",
				generation: 2,
				state: "active",
				docCount: 65,
			}),
		]);
		const results = await engine.searchFiles({
			queryText: "folded maintenance target 63",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});
		expect(results[0]?.path).toBe("notes/folded-63.md");
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

test("offloads fuzzy rescue payload and reloads matching fuzzy lookup keys for fuzzy search", async () => {
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
			publishLexicalFuzzyRescue: jest.fn(async (fuzzyRescueIndex) => {
				persistedFuzzyRescue = fuzzyRescueIndex;
			}),
			readLexicalFuzzyRescueForLookupKeys: jest.fn(async (fuzzyLookupKeys: readonly string[]) => {
				if (persistedFuzzyRescue == null) {
					throw new Error("missing fuzzy rescue payload");
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
					engine: { getFuzzyRescueIndex: () => { fuzzyLookupKeyCount: number } };
				}
			).engine.getFuzzyRescueIndex().fuzzyLookupKeyCount,
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
					engine: { getFuzzyRescueIndex: () => { fuzzyLookupKeyCount: number } };
				}
			).engine.getFuzzyRescueIndex().fuzzyLookupKeyCount,
		).toBe(0);
	});

	test("does not publish or read legacy whole body-family support payload rows during search rebuilds", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedBodyFamilySupport: { entryCount: number } | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalBodyFamilySupport: jest.fn(async (payload) => {
				persistedBodyFamilySupport = payload;
			}),
			readLexicalBodyFamilySupport: jest.fn(async () => {
				if (persistedBodyFamilySupport == null) {
					throw new Error("missing legacy body family support rows");
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

	test("does not publish or read legacy whole exact-payload rows during search rebuilds", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedExactTapes: { entryCount: number } | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalExactTapes: jest.fn(async (payload) => {
				persistedExactTapes = payload;
			}),
			readLexicalExactTapes: jest.fn(async () => {
				if (persistedExactTapes == null) {
					throw new Error("missing legacy exact tape rows");
				}
				return persistedExactTapes;
			}),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
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

test("skips body cold-evidence reads when ranking does not shortlist body blocks", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
			),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
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

	test("does not read legacy whole exact/body/han rows for non-Han ranking queries", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				exactShardLocalFamilySlots: readonly number[];
				exactTokenPositions: readonly number[];
				supportShardLocalFamilySlots: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}
		>();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
			),
			publishLexicalBodyEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						blockOrdinal: number;
						exactShardLocalFamilySlots: readonly number[];
						exactTokenPositions: readonly number[];
						supportShardLocalFamilySlots: readonly number[];
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
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
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
				exactShardLocalFamilySlots: readonly number[];
				exactTokenPositions: readonly number[];
				supportShardLocalFamilySlots: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}
		>();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalBodyEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						blockOrdinal: number;
						exactShardLocalFamilySlots: readonly number[];
						exactTokenPositions: readonly number[];
						supportShardLocalFamilySlots: readonly number[];
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
				throw new Error("legacy exact tape rows should not be read");
			}),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(async () => {
				throw new Error("legacy body family support rows should not be read");
			}),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
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

	test("hydrates body evidence for shortlist plus same-doc adjacent blocks", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedBodyEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
				blockOrdinal: number;
				exactShardLocalFamilySlots: readonly number[];
				exactTokenPositions: readonly number[];
				supportShardLocalFamilySlots: readonly number[];
				familySupportMaskByEntry: readonly number[];
			}
		>();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalBodyEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
						blockOrdinal: number;
						exactShardLocalFamilySlots: readonly number[];
						exactTokenPositions: readonly number[];
						supportShardLocalFamilySlots: readonly number[];
						familySupportMaskByEntry: readonly number[];
					}>,
				) => {
					persistedBodyEvidence = new Map(rows.map((row) => [row.id, row]));
				},
			),
			readLexicalBodyEvidenceForBlocks: jest.fn(
				async (locators: readonly LexicalBlockEvidenceLocator[]) =>
					createPersistedBodyEvidenceMap(locators, persistedBodyEvidence),
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => {
				throw new Error("legacy exact tape rows should not be read");
			}),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(async () => {
				throw new Error("legacy body family support rows should not be read");
			}),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
			),
		};
		(
			engine as unknown as {
				getFileSnapshotStore: () => typeof snapshotStore;
			}
		).getFileSnapshotStore = () => snapshotStore;

		await engine.reIndexAll([
			createDocument({
				docRef: 103,
				path: "infra/adjacent-body.md",
				basename: "adjacent body",
				folder: "infra/kubernetes",
				content: `projected token ${"filler ".repeat(420)}`,
			}),
		]);

		await engine.searchFiles({
			queryText: "projected token",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(snapshotStore.readLexicalBodyEvidenceForBlocks).toHaveBeenCalledTimes(1);
		const requestedLocators =
			snapshotStore.readLexicalBodyEvidenceForBlocks.mock.calls[0]?.[0] ?? [];
		expect(requestedLocators).toHaveLength(2);
		expect(
			requestedLocators.map((locator: LexicalBlockEvidenceLocator) => locator.blockOrdinal),
		).toEqual([0, 1]);
	});

test("hydrates Han ranking evidence from doc/block rows without loading full Han payload", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedHanDocEvidence = new Map<
			string,
			{
				id: string;
				docRef: number;
				generation: number;
		identityWitnessTextIds: readonly number[];
				identityWitnessSourceMaskByDocEntry: readonly number[];
		routeWitnessTextIds: readonly number[];
				routeWitnessSourceMaskByDocEntry: readonly number[];
		headingWitnessTextIds: readonly number[];
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
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalBodyEvidence: jest.fn(async () => undefined),
			readLexicalBodyEvidenceForBlocks: jest.fn(async () => new Map()),
			publishLexicalHanDocEvidence: jest.fn(
				async (
					rows: ReadonlyArray<{
						id: string;
						docRef: number;
						generation: number;
		identityWitnessTextIds: readonly number[];
						identityWitnessSourceMaskByDocEntry: readonly number[];
		routeWitnessTextIds: readonly number[];
						routeWitnessSourceMaskByDocEntry: readonly number[];
		headingWitnessTextIds: readonly number[];
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
						(
							engine as unknown as {
								engine: { getResidentIndexView: () => { shards: [{ base: ResidentBase }] } };
							}
						).engine.getResidentIndexView().shards[0].base,
					),
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
			),
			publishLexicalHanWitnesses: jest.fn(async () => undefined),
			readLexicalHanWitnesses: jest.fn(async () => {
				throw new Error("legacy whole Han witness payload rows should not be read");
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
		).engine.prepareSearch("\u7f13\u5b58\u6062\u590d\u8bf4\u660e", ["\u7f13\u5b58\u6062\u590d", "\u8bf4\u660e"], {
			allowPrefixMatch: true,
			allowFuzzyMatch: false,
			maxItemResults: 5,
		});
		const hydrationResult = await (
			engine as unknown as {
				hydrateRankingEvidenceForCandidates: (
					preparedSearch: unknown,
				) => Promise<{
					hydratedEvidenceByCandidateKey: ReadonlyMap<string, unknown>;
				}>;
			}
		).hydrateRankingEvidenceForCandidates(preparedSearch);

		expect(hydrationResult.hydratedEvidenceByCandidateKey.size).toBeGreaterThan(0);
		expect(snapshotStore.publishLexicalHanDocEvidence).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalHanDocEvidenceForDocs).toHaveBeenCalledTimes(1);
		expect(snapshotStore.publishLexicalHanBodyEvidence).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalHanBodyEvidenceForBlocks).toHaveBeenCalledTimes(1);
		expect(snapshotStore.readLexicalHanWitnesses).not.toHaveBeenCalled();
	});

	test("does not publish or read legacy whole Han witness payload rows during search rebuilds", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		let persistedHanWitness: { bodyWitnessEntryCount: number } | null = null;
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			readLexicalFuzzyRescue: jest.fn(
				async () => EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
			),
			publishLexicalExactTapes: jest.fn(async () => undefined),
			readLexicalExactTapes: jest.fn(async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD),
			publishLexicalBodyFamilySupport: jest.fn(async () => undefined),
			readLexicalBodyFamilySupport: jest.fn(
				async () => UNUSED_LEGACY_EVIDENCE_PAYLOAD,
			),
			publishLexicalHanWitnesses: jest.fn(async (payload) => {
				persistedHanWitness = payload;
			}),
			readLexicalHanWitnesses: jest.fn(async () => {
				if (persistedHanWitness == null) {
					throw new Error("missing legacy Han witness rows");
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
					stableKey: "docref:1",
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([2], ["notes/lifeforce.md"]),
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
					stableKey: "docref:1",
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([2], ["notes/life-force.md"]),
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
					stableKey: "docref:1",
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([1], ["notes/body-dominant.md"]),
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
					stableKey: "docref:1",
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: typeof readCurrentTexts;
				};
			}
		).engine = createMockSearchRuntime(
			search,
			createResidentBaseForBlockCounts([1], ["notes/missing-snapshot.md"]),
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

	test("getDirectSubItems reads indexed snapshots by candidate liveDocSlot generation", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		await engine.reIndexAll([
			createDocument({
				path: "notes/live-slot-target.md",
				basename: "note",
				folder: "notes",
				generation: 101,
				content: "placeholder",
			}),
		]);
		const residentBase = createResidentBaseForBlockCounts(
			[1, 1],
			["notes/other.md", "notes/live-slot-target.md"],
		);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, fullSurface),
				unitFamilyMatches: [],
				candidateDocs: [
					createCandidateDocRecall(0, {
						liveDocSlot: 1,
						shortlistedBodyBlocks: [createCandidateBodyBlockRecall(1)],
					}),
				],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					liveDocSlot: 1,
					path: "notes/live-slot-target.md",
					stableKey: "docref:2",
					bodyWindowContainer: createBodyWindowContainer([1]),
					strongestContainer: createBodyWindowContainer([1]),
				}),
			],
		}));
		const readIndexedTexts = jest.fn(async () =>
			new Map([["notes/live-slot-target.md", fullSurface]]),
		);
		(
			engine as unknown as {
				engine: {
					search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
				};
				getFileSnapshotStore: () => {
					readIndexedTexts: typeof readIndexedTexts;
					readCurrentTexts: jest.Mock;
				};
			}
		).engine = createMockSearchRuntime(search, residentBase);
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

		await engine.getDirectSubItems(fullSurface, "notes/live-slot-target.md", 3);

		expect(readIndexedTexts).toHaveBeenCalledWith([
			{
				path: "notes/live-slot-target.md",
				generation: 101,
			},
		]);
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
				};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentIndexView: () => null,
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
				};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentIndexView: () => null,
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
				};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentIndexView: () => null,
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
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
					getResidentIndexView: () => { shards: [{ base: ResidentBase }] };
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
		const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		const result: CoverageLexicalV3SearchResult = {
			recallState: createRefineSearchResult().recallState,
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "b-residue.md",
					stableKey: "docref:1",
					bodyWindowContainer: createBodyWindowContainer([1]),
					strongestContainer: createBodyWindowContainer([1]),
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
					],
				}),
				createPackingProfile({
					docId: 1,
					path: "a-window.md",
					stableKey: "docref:2",
					bodyWindowContainer: createBodyWindowContainer([2]),
					strongestContainer: createBodyWindowContainer([2]),
					hanSurfaceCompletionGroups: [
						{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
					],
				}),
			],
		};
		const residentBase = withBodyWitnessTexts(createResidentBaseForBlockCounts([2, 1], [
			"b-residue.md",
			"a-window.md",
		]), [
			["\u7f13\u5b58\u6062\u590d\u6b65\u9aa4"],
			[],
			["\u7f13\u5b58\u6062\u590d\u6b65\u9aa4"],
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

	test("resident Han witness refine keeps same-slot candidates scoped by shard", async () => {
		const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		const sealedBase = withBodyWitnessTexts(
			createResidentBaseForBlockCounts([1], ["same.md"]),
			[[fullSurface]],
		);
		const activeBase = withBodyWitnessTexts(
			createResidentBaseForBlockCounts([1], ["same.md"]),
			[["unrelated body text"]],
		);
		const sealedRecall = createCandidateDocRecall(0, {
			shardId: "sealed-0",
			shardGeneration: 1,
			liveDocSlot: 0,
			shortlistedBodyBlocks: [createCandidateBodyBlockRecall(0)],
		});
		const activeRecall = createCandidateDocRecall(0, {
			shardId: "active-1",
			shardGeneration: 1,
			liveDocSlot: 0,
			shortlistedBodyBlocks: [createCandidateBodyBlockRecall(0)],
		});
		const sealedCandidate = createPackingProfile({
			shardId: "sealed-0",
			shardGeneration: 1,
			docId: 0,
			liveDocSlot: 0,
			path: "same.md",
			stableKey: "docref:1",
			bodyWindowContainer: createBodyWindowContainer([0]),
			strongestContainer: createBodyWindowContainer([0]),
			hanSurfaceCompletionGroups: [
				{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
			],
		});
		const activeCandidate = createPackingProfile({
			shardId: "active-1",
			shardGeneration: 1,
			docId: 0,
			liveDocSlot: 0,
			path: "same.md",
			stableKey: "docref:1",
			bodyWindowContainer: createBodyWindowContainer([0]),
			strongestContainer: createBodyWindowContainer([0]),
			hanSurfaceCompletionGroups: [
				{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
			],
		});
		const result: CoverageLexicalV3SearchResult = {
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, "\u7f13\u5b58\u6062\u590d"),
				unitFamilyMatches: [],
				candidateDocs: [sealedRecall, activeRecall],
			},
			rankedCandidates: [sealedCandidate, activeCandidate],
		};
		const hydratedEvidenceByCandidateKey = new Map([
			...hydrateCandidateEvidenceBatch(sealedBase, [sealedRecall], {
				bodyHanEvidenceByBlockId: createResidentBodyHanEvidenceByBlockId(
					sealedBase,
					[sealedRecall],
				),
			}),
			...hydrateCandidateEvidenceBatch(activeBase, [activeRecall], {
				bodyHanEvidenceByBlockId: createResidentBodyHanEvidenceByBlockId(
					activeBase,
					[activeRecall],
				),
			}),
		]);
		const engine = new CoverageLexicalV3FileSearchEngine();
		(
			engine as unknown as {
				engine: {
					getResidentIndexView: () => {
						shards: Array<{
							shardId: string;
							generation: number;
							base: ResidentBase;
						}>;
					};
				};
			}
		).engine = {
			getResidentIndexView: () => ({
				shards: [
					{ shardId: "sealed-0", generation: 1, base: sealedBase },
					{ shardId: "active-1", generation: 1, base: activeBase },
				],
			}),
		};

		const refined = await (engine as unknown as {
			refineHanSurfaceCompletion: (
				searchResult: CoverageLexicalV3SearchResult,
				hydratedEvidenceByCandidateKey: ReadonlyMap<string, CandidateEvidencePackage>,
			) => Promise<readonly EvidencePackingProfile[]>;
		}).refineHanSurfaceCompletion(result, hydratedEvidenceByCandidateKey);

		expect(refined.map((candidate) => [
			candidate.shardId,
			candidate.strongestHanSurfaceCompletionTier,
		])).toEqual([
			["sealed-0", "body_window"],
			["active-1", "body_residue"],
		]);
	});

	test("resident Han witness refine checks all shortlisted blocks without raw query budget caps", async () => {
		const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		const blockCounts = [100, 100, 100, 100, 100] as const;
		const paths = blockCounts.map((_, docId) => String.fromCharCode(97 + docId) + ".md");
		const residentBaseWithoutWitness = createResidentBaseForBlockCounts(blockCounts, paths);
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
				path: paths[docId],
				stableKey: `docref:${docId + 1}`,
				bodyWindowContainer: createBodyWindowContainer([
					residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId],
				]),
				strongestContainer: createBodyWindowContainer([
					residentBaseWithoutWitness.docTable.bodyBlockStartByDocId[docId],
				]),
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: fullSurface, tier: "body_residue" },
				],
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
					return blockOrdinal === 0 ? ["\u7f13\u5b58\u6062\u590d\u6b65\u9aa4"] : [];
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

	test("plans whole-surface bigram rescue when any Han tokenizer real term misses family lookup", () => {
		const fullSurface = "\u91ce\u602a";
		const queryAnalysis = createHanQueryAnalysis(fullSurface, fullSurface);
		const resolvedGroups = planHanSurfaceGroupRecallsAfterFamilyLookup(
			queryAnalysis,
			[],
		);

		expect(resolvedGroups).toEqual([
			expect.objectContaining({
				surfaceGroupIndex: 0,
				rescueMode: "residual_only",
				rescueBigrams: [fullSurface],
			}),
		]);
	});

	test("keeps whole-surface bigram rescue available even when another candidate has a real-term match", () => {
		const fullSurface = "\u91ce\u602a";
		const queryAnalysis = createHanQueryAnalysis(fullSurface, fullSurface);
		const resolvedGroups = planHanSurfaceGroupRecallsAfterFamilyLookup(
			queryAnalysis,
			[
				{
					queryUnitIndex: 0,
					queryUnitText: fullSurface,
					queryUnitSource: "han_tokenizer_real",
					querySurfaceGroupIndex: 0,
					matches: [
						{
							familyId: 1,
							shardLocalFamilySlot: 1,
							familyText: fullSurface,
							matchKind: "exact",
							editDistance: 0,
						},
					],
				},
			],
		);

		expect(resolvedGroups).toEqual([
			expect.objectContaining({
				surfaceGroupIndex: 0,
				matchedRealUnitIndices: [0],
				rescueMode: "whole_group_when_real_miss",
				rescueBigrams: [fullSurface],
			}),
		]);
	});

	test("keeps weak Han bigram rescue candidates visible when weak results are hidden", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "fleeting.md",
				basename: "Fleeting thoughts",
				folder: "notes",
				content: "\u6211\u7684\u806a\u660e\u624d\u667a\u600e\u4e48\u80fd\u6d6a\u8d39\u5728\u91ce\u602a\u4e0a",
			}),
		]);
		const fullSurface = "\u91ce\u602a";
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, fullSurface),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "fleeting.md",
					realizedCoverageCount: 0,
					coverageGate: {
						realizedCoverageCount: 0,
						visibilityCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					exactUnitCount: 0,
					realizedFamilies: [
						createRealizedFamily({
							queryUnitIndex: 500000,
							queryUnitText: fullSurface,
							querySurfaceGroupIndex: 0,
							familyId: -500001,
							familyText: fullSurface,
							matchKind: "opaque_exact",
							inBodyResidue: true,
						}),
					],
					hasOnlyWeakHanRescue: true,
					hasAnyHanRescueAssessment: true,
					hanRescueAssessments: [
						createHanBigramRescueAssessment({ strength: "weak" }),
					],
					hanWeakRescueGroupCount: 1,
					hanStrongRescueGroupCount: 0,
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
			};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1])),
			getResidentIndexView: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual(["fleeting.md"]);
		expect(visible[0]?.score).toBe(0);
	});

	test("preserves exact ranking semantics while allowing opaque bigram rescue visibility", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "exact.md",
				basename: "exact",
				folder: "notes",
				content: "\u91ce\u602a",
			}),
			createDocument({
				path: "bigram.md",
				basename: "bigram",
				folder: "notes",
				content: "\u5728\u91ce\u602a\u4e0a",
			}),
		]);
		const fullSurface = "\u91ce\u602a";
		const exactFamily = createRealizedFamily({
			queryUnitIndex: 0,
			queryUnitText: fullSurface,
			querySurfaceGroupIndex: 0,
			familyId: 1,
			familyText: fullSurface,
			matchKind: "exact",
		});
		const opaqueFamily = createRealizedFamily({
			queryUnitIndex: 500000,
			queryUnitText: fullSurface,
			querySurfaceGroupIndex: 0,
			familyId: -500001,
			familyText: fullSurface,
			matchKind: "opaque_exact",
			inBodyResidue: true,
		});
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, fullSurface),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "exact.md",
					realizedFamilies: [exactFamily],
					exactUnitCount: 1,
					realizedCoverageCount: 1,
				}),
				createPackingProfile({
					docId: 1,
					path: "bigram.md",
					realizedFamilies: [opaqueFamily],
					exactUnitCount: 0,
					realizedCoverageCount: 0,
					coverageGate: {
						realizedCoverageCount: 0,
						visibilityCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hasOnlyWeakHanRescue: true,
					hasAnyHanRescueAssessment: true,
					hanRescueAssessments: [
						createHanBigramRescueAssessment({ strength: "weak" }),
					],
					hanWeakRescueGroupCount: 1,
					hanStrongRescueGroupCount: 0,
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
			};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1, 1])),
			getResidentIndexView: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual(["exact.md", "bigram.md"]);
		expect(visible.map((file) => file.score)).toEqual([1, 0]);
		expect(opaqueFamily.matchKind).toBe("opaque_exact");
	});

	test("hides opaque bigram rescue below a stronger visibility coverage gate", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "strong.md",
				basename: "strong",
				folder: "notes",
				content: "\u91ce\u602a\u7b56\u7565",
			}),
			createDocument({
				path: "bigram.md",
				basename: "bigram",
				folder: "notes",
				content: "\u5728\u91ce\u602a\u4e0a",
			}),
		]);
		const fullSurface = "\u91ce\u602a";
		const exactFamily = createRealizedFamily({
			queryUnitIndex: 0,
			queryUnitText: fullSurface,
			querySurfaceGroupIndex: 0,
			familyId: 1,
			familyText: fullSurface,
			matchKind: "exact",
		});
		const opaqueFamily = createRealizedFamily({
			queryUnitIndex: 500000,
			queryUnitText: fullSurface,
			querySurfaceGroupIndex: 0,
			familyId: -500001,
			familyText: fullSurface,
			matchKind: "opaque_exact",
			inBodyResidue: true,
		});
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, fullSurface),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "strong.md",
					realizedFamilies: [exactFamily],
					exactUnitCount: 2,
					realizedCoverageCount: 2,
					coverageGate: {
						realizedCoverageCount: 2,
						visibilityCoverageCount: 2,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
				}),
				createPackingProfile({
					docId: 1,
					path: "bigram.md",
					realizedFamilies: [opaqueFamily],
					exactUnitCount: 0,
					realizedCoverageCount: 0,
					coverageGate: {
						realizedCoverageCount: 0,
						visibilityCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hasOnlyWeakHanRescue: true,
					hasAnyHanRescueAssessment: true,
					hanRescueAssessments: [
						createHanBigramRescueAssessment({ strength: "weak" }),
					],
					hanWeakRescueGroupCount: 1,
					hanStrongRescueGroupCount: 0,
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
			};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1, 1])),
			getResidentIndexView: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual(["strong.md"]);
	});

	test("keeps candidates that trade one exact coverage for one bigram visibility span", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "two-exact.md",
				basename: "two exact",
				folder: "notes",
				content: "\u91ce\u602a\u7b56\u7565",
			}),
			createDocument({
				path: "exact-plus-bigram.md",
				basename: "exact plus bigram",
				folder: "notes",
				content: "\u91ce\u602a\u7b56\u7565",
			}),
		]);
		const fullSurface = "\u91ce\u602a\u7b56\u7565";
		const exactFamily = createRealizedFamily({
			queryUnitIndex: 0,
			queryUnitText: "\u91ce\u602a",
			querySurfaceGroupIndex: 0,
			familyId: 1,
			familyText: "\u91ce\u602a",
			matchKind: "exact",
		});
		const secondExactFamily = createRealizedFamily({
			queryUnitIndex: 1,
			queryUnitText: "\u7b56\u7565",
			querySurfaceGroupIndex: 0,
			familyId: 2,
			familyText: "\u7b56\u7565",
			matchKind: "exact",
		});
		const opaqueFamily = createRealizedFamily({
			queryUnitIndex: 500000,
			queryUnitText: "\u7b56\u7565",
			querySurfaceGroupIndex: 0,
			familyId: -500001,
			familyText: "\u7b56\u7565",
			matchKind: "opaque_exact",
			inBodyResidue: true,
		});
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, fullSurface),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "two-exact.md",
					realizedFamilies: [exactFamily, secondExactFamily],
					exactUnitCount: 2,
					realizedCoverageCount: 2,
					coverageGate: {
						realizedCoverageCount: 2,
						visibilityCoverageCount: 2,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
				}),
				createPackingProfile({
					docId: 1,
					path: "exact-plus-bigram.md",
					realizedFamilies: [exactFamily, opaqueFamily],
					exactUnitCount: 1,
					realizedCoverageCount: 1,
					coverageGate: {
						realizedCoverageCount: 1,
						visibilityCoverageCount: 2,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hasAnyHanRescueAssessment: true,
					hanRescueAssessments: [
						createHanBigramRescueAssessment({ strength: "weak" }),
					],
					hanWeakRescueGroupCount: 1,
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
			};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1, 1])),
			getResidentIndexView: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toEqual([
			"two-exact.md",
			"exact-plus-bigram.md",
		]);
	});

	test("keeps candidates whose bigram visibility coverage exceeds the top real coverage gate", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "exact.md",
				basename: "exact",
				folder: "notes",
				content: "\u91ce\u602a",
			}),
			createDocument({
				path: "overlap-bigram.md",
				basename: "overlap",
				folder: "notes",
				content: "\u91ce\u602a\u7b14\u8bb0",
			}),
		]);
		const fullSurface = "\u91ce\u602a";
		const exactFamily = createRealizedFamily({
			queryUnitIndex: 0,
			queryUnitText: fullSurface,
			querySurfaceGroupIndex: 0,
			familyId: 1,
			familyText: fullSurface,
			matchKind: "exact",
		});
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createHanQueryAnalysis(fullSurface, fullSurface),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [
				createPackingProfile({
					docId: 0,
					path: "exact.md",
					realizedFamilies: [exactFamily],
					exactUnitCount: 1,
					realizedCoverageCount: 1,
					coverageGate: {
						realizedCoverageCount: 1,
						visibilityCoverageCount: 1,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
				}),
				createPackingProfile({
					docId: 1,
					path: "overlap-bigram.md",
					realizedFamilies: [exactFamily],
					exactUnitCount: 1,
					realizedCoverageCount: 1,
					coverageGate: {
						realizedCoverageCount: 1,
						visibilityCoverageCount: 1.3,
						fullySatisfiedSurfaceGroupCount: 1,
						startedSurfaceGroupCount: 1,
						crossScriptSatisfiedGroupCount: 1,
					},
					hasAnyHanRescueAssessment: true,
					hanRescueAssessments: [
						createHanBigramRescueAssessment({ strength: "weak" }),
					],
					hanWeakRescueGroupCount: 1,
				}),
			],
		}));
		(engine as unknown as {
			engine: {
				search: (...args: unknown[]) => CoverageLexicalV3SearchResult;
				getResidentIndexView: () => { shards: [{ base: ResidentBase }] } | null;
			};
		}).engine = {
			...createMockSearchRuntime(search, createResidentBaseForBlockCounts([1, 1])),
			getResidentIndexView: () => null,
		};

		const visible = await engine.searchFiles({
			queryText: fullSurface,
			isPrefixMatch: true,
			isFuzzy: false,
			hideWeaklyRelatedResults: true,
			maxItemResults: 5,
		});

		expect(visible.map((file) => file.path)).toContain("overlap-bigram.md");
	});
});
