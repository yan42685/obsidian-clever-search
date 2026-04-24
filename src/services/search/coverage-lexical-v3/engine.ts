import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBaseArtifacts } from "./build";
import {
	EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
	readResidentBodyFamilySupportSidecar,
	setResidentBodyFamilySupportSidecar,
} from "./layout/body-blocks";
import {
	EMPTY_RESIDENT_EXACT_TAPE_SIDECAR,
	buildResidentExactTapeSidecar,
	setResidentExactTapeSidecar,
} from "./layout/exact-tapes";
import {
	EMPTY_RESIDENT_HAN_WITNESS_SIDECAR,
	buildResidentHanWitnessSidecar,
	setResidentHanWitnessSidecar,
} from "./layout/han-route";
import {
	logCoverageLexicalV3Debug,
	nowDebugMs,
	shouldLogCoverageLexicalV3Debug,
} from "./debug";
import type {
	ResidentBase,
	ResidentFuzzyRescueSidecar,
	ResidentBodyFamilySupportSidecar,
	ResidentExactTapeSidecar,
	ResidentBaseMetrics,
	ResidentBaseSummary,
	ResidentHanWitnessSidecar,
} from "./layout/types";
import { EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR } from "./layout/fuzzy-rescue";
import { describeResidentBase } from "./metrics";
import { analyzeQuery } from "./query";
import type { V3DocumentTokenizer } from "./query";
import { applyPrefixFanoutGuard } from "./prefix-fanout-guard";
import {
	recallCandidateDocs,
	lookupQueryUnitFamilies,
	type V3QueryUnitFamilyMatches,
	type V3RecallState,
} from "./recall";
import {
	buildPackingProfile,
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
	hydrateCandidateEvidenceBatch,
	type CandidateEvidencePackage,
	type EvidencePackingProfile,
} from "./ranking";

export type CoverageLexicalV3SearchResult = Readonly<{
	recallState: V3RecallState;
	rankedCandidates: readonly EvidencePackingProfile[];
}>;

export type CoverageLexicalV3PreparedSearch = Readonly<{
	queryText: string;
	queryTerms: readonly string[];
	queryAnalysis: V3RecallState["queryAnalysis"];
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[];
	guardedCandidateDocs: readonly V3RecallState["candidateDocs"][number][];
}>;

export type CoverageLexicalV3SearchOptions = Readonly<{
	allowPrefixMatch?: boolean;
	allowFuzzyMatch?: boolean;
	maxItemResults?: number;
}>;

export class CoverageLexicalV3Engine {
	private residentBase: ResidentBase | null = null;
	private fuzzyRescueSidecar: ResidentFuzzyRescueSidecar =
		EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR;
	private bodyFamilySupportSidecar: ResidentBodyFamilySupportSidecar =
		EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR;
	private exactTapeSidecar: ResidentExactTapeSidecar =
		EMPTY_RESIDENT_EXACT_TAPE_SIDECAR;
	private hanWitnessSidecar: ResidentHanWitnessSidecar =
		EMPTY_RESIDENT_HAN_WITNESS_SIDECAR;

	buildResidentBase(
		documents: readonly IndexedDocument[],
		tokenizeDocumentText?: V3DocumentTokenizer,
	): ResidentBase {
		const artifacts = buildResidentBaseArtifacts(documents, tokenizeDocumentText);
		this.residentBase = artifacts.base;
		this.fuzzyRescueSidecar = artifacts.fuzzyRescueSidecar;
		this.bodyFamilySupportSidecar = artifacts.bodyFamilySupportSidecar;
		this.exactTapeSidecar = artifacts.exactTapeSidecar;
		this.hanWitnessSidecar = artifacts.hanWitnessSidecar;
		setResidentExactTapeSidecar(
			artifacts.base.exactTapes,
			artifacts.exactTapeSidecar,
		);
		setResidentBodyFamilySupportSidecar(
			artifacts.base.bodyBlocks,
			artifacts.bodyFamilySupportSidecar,
		);
		setResidentHanWitnessSidecar(
			artifacts.base.hanRoute,
			artifacts.hanWitnessSidecar,
		);
		return artifacts.base;
	}

	loadResidentBase(residentBase: ResidentBase): void {
		this.residentBase = residentBase;
		this.fuzzyRescueSidecar =
			residentBase.fuzzyRescue ?? EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR;
		this.exactTapeSidecar = buildResidentExactTapeSidecar(
			residentBase.exactTapes,
		);
		this.bodyFamilySupportSidecar = readResidentBodyFamilySupportSidecar(
			residentBase.bodyBlocks,
		);
		this.hanWitnessSidecar = buildResidentHanWitnessSidecar(
			residentBase.hanRoute,
		);
	}

	getResidentBase(): ResidentBase | null {
		return this.residentBase;
	}

	getFuzzyRescueSidecar(): ResidentFuzzyRescueSidecar {
		return this.fuzzyRescueSidecar;
	}

	setFuzzyRescueSidecar(sidecar: ResidentFuzzyRescueSidecar): void {
		this.fuzzyRescueSidecar = sidecar;
	}

	clearFuzzyRescueSidecar(): void {
		this.fuzzyRescueSidecar = EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR;
	}

	getExactTapeSidecar(): ResidentExactTapeSidecar {
		return this.exactTapeSidecar;
	}

	setExactTapeSidecar(sidecar: ResidentExactTapeSidecar): void {
		this.exactTapeSidecar = sidecar;
		if (this.residentBase != null) {
			setResidentExactTapeSidecar(this.residentBase.exactTapes, sidecar);
		}
	}

	clearExactTapeSidecar(): void {
		this.setExactTapeSidecar(EMPTY_RESIDENT_EXACT_TAPE_SIDECAR);
	}

	getBodyFamilySupportSidecar(): ResidentBodyFamilySupportSidecar {
		return this.bodyFamilySupportSidecar;
	}

	setBodyFamilySupportSidecar(
		sidecar: ResidentBodyFamilySupportSidecar,
	): void {
		this.bodyFamilySupportSidecar = sidecar;
		if (this.residentBase != null) {
			setResidentBodyFamilySupportSidecar(
				this.residentBase.bodyBlocks,
				sidecar,
			);
		}
	}

	clearBodyFamilySupportSidecar(): void {
		this.setBodyFamilySupportSidecar(
			EMPTY_RESIDENT_BODY_FAMILY_SUPPORT_SIDECAR,
		);
	}

	getHanWitnessSidecar(): ResidentHanWitnessSidecar {
		return this.hanWitnessSidecar;
	}

	setHanWitnessSidecar(sidecar: ResidentHanWitnessSidecar): void {
		this.hanWitnessSidecar = sidecar;
		if (this.residentBase != null) {
			setResidentHanWitnessSidecar(this.residentBase.hanRoute, sidecar);
		}
	}

	clearHanWitnessSidecar(): void {
		this.setHanWitnessSidecar(EMPTY_RESIDENT_HAN_WITNESS_SIDECAR);
	}

	getResidentBaseMetrics(): ResidentBaseMetrics | null {
		return this.residentBase?.metrics ?? null;
	}

	describeResidentBase(): ResidentBaseSummary | null {
		if (this.residentBase == null) {
			return null;
		}
		return describeResidentBase(this.residentBase);
	}

	prepareSearch(
		queryText: string,
		queryTerms: readonly string[] = [],
		options: CoverageLexicalV3SearchOptions = {},
		fuzzyRescueSidecar: ResidentFuzzyRescueSidecar = this.fuzzyRescueSidecar,
	): CoverageLexicalV3PreparedSearch {
		if (this.residentBase == null) {
			throw new Error("CoverageLexicalV3Engine.search requires a resident base");
		}
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		const unitFamilyMatches = lookupQueryUnitFamilies(
			this.residentBase,
			queryAnalysis,
			options,
			fuzzyRescueSidecar,
		);
		const candidateDocs = recallCandidateDocs(
			this.residentBase,
			queryAnalysis,
			unitFamilyMatches,
		);
		const guardResult = applyPrefixFanoutGuard(
			candidateDocs,
			options.maxItemResults,
		);
		return {
			queryText,
			queryTerms,
			queryAnalysis,
			unitFamilyMatches,
			guardedCandidateDocs: guardResult.candidateDocs,
		};
	}

	rankPreparedSearch(
		preparedSearch: CoverageLexicalV3PreparedSearch,
		hydratedEvidenceByLiveDocSlot?: ReadonlyMap<number, CandidateEvidencePackage> | null,
	): CoverageLexicalV3SearchResult {
		if (this.residentBase == null) {
			throw new Error("CoverageLexicalV3Engine.search requires a resident base");
		}
		const { queryAnalysis, unitFamilyMatches, guardedCandidateDocs } =
			preparedSearch;
		const effectiveHydratedEvidenceByLiveDocSlot =
			hydratedEvidenceByLiveDocSlot ??
			hydrateCandidateEvidenceBatch(this.residentBase, guardedCandidateDocs);
		const provisionalCandidateProfiles = guardedCandidateDocs.map((candidateRecall) =>
			buildPackingProfile(
				this.residentBase!,
				queryAnalysis,
				candidateRecall,
				unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices: null,
					hydratedEvidence:
						effectiveHydratedEvidenceByLiveDocSlot.get(
							candidateRecall.liveDocSlot,
						) ?? null,
				},
			),
		);
		const provisionalCandidates = provisionalCandidateProfiles
			.filter(
				(candidate, index) =>
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasAnyHanRescueAssessment ||
					hasBodyOpaqueRescueSeeds(guardedCandidateDocs[index]),
			);
		const allowedBodyOpaqueRescueByLiveDocSlot = buildAllowedBodyOpaqueRescueSurfaceGroups(
			this.residentBase!,
			queryAnalysis,
			guardedCandidateDocs,
			unitFamilyMatches,
			effectiveHydratedEvidenceByLiveDocSlot,
		);
		const candidateRecallByLiveDocSlot = new Map(
			guardedCandidateDocs.map((candidateRecall) => [
				candidateRecall.liveDocSlot,
				candidateRecall,
			]),
		);
		const secondPassCandidateProfiles = provisionalCandidates.map(
			(provisionalCandidate) => {
				const candidateRecall = candidateRecallByLiveDocSlot.get(
					provisionalCandidate.liveDocSlot,
				);
				if (candidateRecall == null) {
					return provisionalCandidate;
				}
				return buildPackingProfile(
					this.residentBase!,
					queryAnalysis,
					candidateRecall,
					unitFamilyMatches,
					{
						allowBodyOpaqueRescueSurfaceGroupIndices:
							allowedBodyOpaqueRescueByLiveDocSlot.get(
								candidateRecall.liveDocSlot,
							) ?? null,
						hydratedEvidence:
							effectiveHydratedEvidenceByLiveDocSlot.get(
								candidateRecall.liveDocSlot,
							) ?? null,
					},
				);
			},
		);
		const rankedCandidatesBeforeSort = secondPassCandidateProfiles.filter(
			(candidate) =>
				candidate.realizedCoverageCount > 0 ||
				candidate.singletonHanCompletion.matched ||
				candidate.hasOnlyWeakHanRescue,
		);
		const rankedCandidates = rankedCandidatesBeforeSort.sort(comparePackingProfiles);
		return {
			recallState: {
				queryAnalysis,
				unitFamilyMatches,
				candidateDocs: guardedCandidateDocs,
			},
			rankedCandidates,
		};
	}

	search(
		queryText: string,
		queryTerms: readonly string[] = [],
		options: CoverageLexicalV3SearchOptions = {},
	): CoverageLexicalV3SearchResult {
		if (this.residentBase == null) {
			throw new Error("CoverageLexicalV3Engine.search requires a resident base");
		}
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(queryText);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const analyzeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		const analyzeMs = shouldLogDebug ? nowDebugMs() - analyzeStartedAtMs : 0;
		const familyLookupStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const unitFamilyMatches = lookupQueryUnitFamilies(
			this.residentBase,
			queryAnalysis,
			options,
			this.fuzzyRescueSidecar,
		);
		const familyLookupMs = shouldLogDebug ? nowDebugMs() - familyLookupStartedAtMs : 0;
		const recallStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const candidateDocs = recallCandidateDocs(
			this.residentBase,
			queryAnalysis,
			unitFamilyMatches,
		);
		const recallMs = shouldLogDebug ? nowDebugMs() - recallStartedAtMs : 0;
		const guardStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const guardResult = applyPrefixFanoutGuard(candidateDocs, options.maxItemResults);
		const guardedCandidateDocs = guardResult.candidateDocs;
		const guardMs = shouldLogDebug ? nowDebugMs() - guardStartedAtMs : 0;
		const hydratedEvidenceByLiveDocSlot = hydrateCandidateEvidenceBatch(
			this.residentBase,
			guardedCandidateDocs,
		);
		const packingStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const provisionalCandidateProfiles = guardedCandidateDocs.map((candidateRecall) =>
			buildPackingProfile(
				this.residentBase!,
				queryAnalysis,
				candidateRecall,
				unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices: null,
					hydratedEvidence:
						hydratedEvidenceByLiveDocSlot.get(candidateRecall.liveDocSlot) ?? null,
				},
			),
		);
		const provisionalCandidates = provisionalCandidateProfiles
			.filter(
				(candidate, index) =>
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasAnyHanRescueAssessment ||
					hasBodyOpaqueRescueSeeds(guardedCandidateDocs[index]),
			);
		const allowedBodyOpaqueRescueByLiveDocSlot = buildAllowedBodyOpaqueRescueSurfaceGroups(
			this.residentBase!,
			queryAnalysis,
			guardedCandidateDocs,
			unitFamilyMatches,
			hydratedEvidenceByLiveDocSlot,
		);
		const candidateRecallByLiveDocSlot = new Map(
			guardedCandidateDocs.map((candidateRecall) => [
				candidateRecall.liveDocSlot,
				candidateRecall,
			]),
		);
		const secondPassCandidateProfiles = provisionalCandidates.map((provisionalCandidate) => {
				const candidateRecall = candidateRecallByLiveDocSlot.get(
					provisionalCandidate.liveDocSlot,
				);
				if (candidateRecall == null) {
					return provisionalCandidate;
				}
				return buildPackingProfile(
					this.residentBase!,
					queryAnalysis,
					candidateRecall,
					unitFamilyMatches,
					{
						allowBodyOpaqueRescueSurfaceGroupIndices:
							allowedBodyOpaqueRescueByLiveDocSlot.get(
								candidateRecall.liveDocSlot,
							) ?? null,
						hydratedEvidence:
							hydratedEvidenceByLiveDocSlot.get(
								candidateRecall.liveDocSlot,
							) ?? null,
					},
				);
			});
		const rankedCandidatesBeforeSort = secondPassCandidateProfiles
			.filter(
				(candidate) =>
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasOnlyWeakHanRescue,
			);
		const packingMs = shouldLogDebug ? nowDebugMs() - packingStartedAtMs : 0;
		const sortStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const rankedCandidates = rankedCandidatesBeforeSort.sort(comparePackingProfiles);
		const sortMs = shouldLogDebug ? nowDebugMs() - sortStartedAtMs : 0;
		if (shouldLogDebug) {
			logCoverageLexicalV3Debug("engine.search", {
				queryText,
				queryTerms,
				queryTermCount: queryTerms.length,
				primaryUnitCount: queryAnalysis.primaryUnits.length,
				hanBackstopGroupCount: queryAnalysis.hanBackstopGroups.length,
				guardApplied: guardResult.stats.guardApplied,
				candidateDocCount: guardedCandidateDocs.length,
				preGuardCandidateDocCount: guardResult.stats.preCandidateDocCount,
				postGuardCandidateDocCount: guardResult.stats.postCandidateDocCount,
				rankedCandidateCount: rankedCandidates.length,
				totalShortlistedBodyBlockCount: guardedCandidateDocs.reduce(
					(sum, candidateRecall) =>
						sum + candidateRecall.shortlistedBodyBlockIds.length,
					0,
				),
				preGuardTotalShortlistedBodyBlockCount:
					guardResult.stats.preTotalShortlistedBodyBlockCount,
				postGuardTotalShortlistedBodyBlockCount:
					guardResult.stats.postTotalShortlistedBodyBlockCount,
				maxShortlistedBodyBlockCount: guardedCandidateDocs.reduce(
					(max, candidateRecall) =>
						Math.max(max, candidateRecall.shortlistedBodyBlockIds.length),
					0,
				),
				anchoredDocCount: guardResult.stats.anchoredDocCount,
				unanchoredDocCount: guardResult.stats.unanchoredDocCount,
				anchoredKeptBlockCount: guardResult.stats.anchoredKeptBlockCount,
				unanchoredKeptBlockCount: guardResult.stats.unanchoredKeptBlockCount,
				removedUnanchoredDocCount: guardResult.stats.removedUnanchoredDocCount,
				unitFamilyMatchTotals: summarizeUnitFamilyMatches(unitFamilyMatches),
				queryAnalysisDetails: summarizeQueryAnalysisDetails(queryAnalysis),
				unitFamilyMatchDetails: summarizeUnitFamilyMatchDetails(unitFamilyMatches),
				candidateDocDetails: summarizeCandidateDocs(guardedCandidateDocs),
				provisionalCandidateDetails: summarizePackingProfiles(provisionalCandidateProfiles),
				bodyOpaqueRescueAllowanceDetails:
					summarizeAllowedBodyOpaqueRescueByLiveDocSlot(
						allowedBodyOpaqueRescueByLiveDocSlot,
					),
				secondPassCandidateDetails: summarizePackingProfiles(secondPassCandidateProfiles),
				topRankedCandidateDetails: summarizeTopRankedCandidates(rankedCandidates),
				phaseMs: {
					analyze: roundDebugMs(analyzeMs),
					familyLookup: roundDebugMs(familyLookupMs),
					recall: roundDebugMs(recallMs),
					guard: roundDebugMs(guardMs),
					packing: roundDebugMs(packingMs),
					sort: roundDebugMs(sortMs),
					total: roundDebugMs(nowDebugMs() - startedAtMs),
				},
			});
		}
		return {
			recallState: {
				queryAnalysis,
				unitFamilyMatches,
				candidateDocs: guardedCandidateDocs,
			},
			rankedCandidates,
		};
	}
}

function summarizeUnitFamilyMatches(
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
): Readonly<{
	totalMatchCount: number;
	exactMatchCount: number;
	prefixMatchCount: number;
	fuzzyMatchCount: number;
	topUnitsByMatchCount: ReadonlyArray<{
		unitText: string;
		total: number;
		exact: number;
		prefix: number;
		fuzzy: number;
	}>;
}> {
	const unitSummaries = unitFamilyMatches
		.map((unitMatches) => {
			const exact = unitMatches.matches.filter((match) => match.matchKind === "exact").length;
			const prefix = unitMatches.matches.filter(
				(match) => match.matchKind === "prefix",
			).length;
			const fuzzy = unitMatches.matches.filter((match) => match.matchKind === "fuzzy").length;
			return {
				unitText: unitMatches.queryUnitText,
				total: unitMatches.matches.length,
				exact,
				prefix,
				fuzzy,
			};
		})
		.filter((unitSummary) => unitSummary.total > 0);
	const topUnitsByMatchCount = [...unitSummaries]
		.sort((left, right) => {
			return (
				right.total - left.total ||
				right.prefix - left.prefix ||
				left.unitText.localeCompare(right.unitText)
			);
		})
		.slice(0, 8);
	return {
		totalMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.total, 0),
		exactMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.exact, 0),
		prefixMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.prefix, 0),
		fuzzyMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.fuzzy, 0),
		topUnitsByMatchCount,
	};
}

function summarizeQueryAnalysisDetails(
	queryAnalysis: V3RecallState["queryAnalysis"],
): Readonly<{
	surfaceGroups: ReadonlyArray<{
		index: number;
		text: string;
		kind: string;
		hanBigramTexts: readonly string[];
		queryResidualUniqueBigrams: readonly string[];
	}>;
	primaryUnits: ReadonlyArray<{
		index: number;
		text: string;
		source: string;
		surfaceGroupIndex: number | null;
	}>;
	hanBackstopGroups: ReadonlyArray<{
		surfaceGroupIndex: number;
		normalizedText: string;
		bigrams: readonly string[];
		triggerKind: string;
	}>;
}> {
	return {
		surfaceGroups: queryAnalysis.surfaceGroups.map((group) => ({
			index: group.index,
			text: group.text,
			kind: group.kind,
			hanBigramTexts: group.hanBigramTexts,
			queryResidualUniqueBigrams: group.queryResidualUniqueBigrams,
		})),
		primaryUnits: queryAnalysis.primaryUnits.map((unit) => ({
			index: unit.index,
			text: unit.text,
			source: unit.source,
			surfaceGroupIndex: unit.surfaceGroupIndex,
		})),
		hanBackstopGroups: queryAnalysis.hanBackstopGroups.map((group) => ({
			surfaceGroupIndex: group.surfaceGroupIndex,
			normalizedText: group.normalizedText,
			bigrams: group.bigrams,
			triggerKind: group.triggerKind,
		})),
	};
}

function summarizeUnitFamilyMatchDetails(
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
): ReadonlyArray<{
	queryUnitIndex: number;
	queryUnitText: string;
	queryUnitSource: string;
	querySurfaceGroupIndex: number | null;
	matches: ReadonlyArray<{
		familyId: number;
		familyText: string;
		matchKind: string;
		editDistance: 0 | 1;
	}>;
}> {
	return unitFamilyMatches.map((unitMatches) => ({
		queryUnitIndex: unitMatches.queryUnitIndex,
		queryUnitText: unitMatches.queryUnitText,
		queryUnitSource: unitMatches.queryUnitSource,
		querySurfaceGroupIndex: unitMatches.querySurfaceGroupIndex,
		matches: unitMatches.matches.map((match) => ({
			familyId: match.familyId,
			familyText: match.familyText,
			matchKind: match.matchKind,
			editDistance: match.editDistance,
		})),
	}));
}

function summarizeCandidateDocs(
	candidateDocs: V3RecallState["candidateDocs"],
): ReadonlyArray<{
	docId: number;
	matchedIdentityUnitIndices: readonly number[];
	matchedRouteUnitIndices: readonly number[];
	matchedHeadingUnitIndices: readonly number[];
	hasQuerySingletonHanMetadataSupport: boolean;
	hasScopedSingletonHanMetadataSupport: boolean;
	shortlistedBodyBlocks: ReadonlyArray<{
		blockId: number;
		hasExactSupport: boolean;
		hasPrefixSupport: boolean;
		hasStrongHanSupport: boolean;
		hasSingletonHanSupport: boolean;
		hasScopedSingletonHanSupport: boolean;
	}>;
	hanMetadataGateStats: V3RecallState["candidateDocs"][number]["hanMetadataGateStats"];
	hanSurfaceGroupRecalls: ReadonlyArray<{
		surfaceGroupIndex: number;
		metadataGateStats: V3RecallState["candidateDocs"][number]["hanSurfaceGroupRecalls"][number]["metadataGateStats"];
		bodySeedBlockIds: readonly number[];
		bodySeedBlockGateBlockIds: readonly number[];
	}>;
}> {
	return candidateDocs.map((candidateDoc) => ({
		docId: candidateDoc.docId,
		matchedIdentityUnitIndices: candidateDoc.matchedIdentityUnitIndices,
		matchedRouteUnitIndices: candidateDoc.matchedRouteUnitIndices,
		matchedHeadingUnitIndices: candidateDoc.matchedHeadingUnitIndices,
		hasQuerySingletonHanMetadataSupport:
			candidateDoc.hasQuerySingletonHanMetadataSupport,
		hasScopedSingletonHanMetadataSupport:
			candidateDoc.hasScopedSingletonHanMetadataSupport,
		shortlistedBodyBlocks: candidateDoc.shortlistedBodyBlocks.map((block) => ({
			blockId: block.blockId,
			hasExactSupport: block.hasExactSupport,
			hasPrefixSupport: block.hasPrefixSupport,
			hasStrongHanSupport: block.hasStrongHanSupport,
			hasSingletonHanSupport: block.hasSingletonHanSupport,
			hasScopedSingletonHanSupport: block.hasScopedSingletonHanSupport,
		})),
		hanMetadataGateStats: candidateDoc.hanMetadataGateStats,
		hanSurfaceGroupRecalls: candidateDoc.hanSurfaceGroupRecalls.map((groupRecall) => ({
			surfaceGroupIndex: groupRecall.surfaceGroupIndex,
			metadataGateStats: groupRecall.metadataGateStats,
			bodySeedBlockIds: groupRecall.bodySeedBlockIds,
			bodySeedBlockGateBlockIds: groupRecall.bodySeedBlockGates.map((gate) => gate.blockId),
		})),
	}));
}

function summarizeTopRankedCandidates(
	rankedCandidates: readonly EvidencePackingProfile[],
): ReadonlyArray<{
	docId: number;
	path: string;
	realizedCoverageCount: number;
	realizedFamilyTexts: readonly string[];
	matchedSurfaceGroupIndices: readonly number[];
}> {
	return rankedCandidates.slice(0, 8).map((candidate) => ({
		docId: candidate.docId,
		path: candidate.path,
		realizedCoverageCount: candidate.realizedCoverageCount,
		realizedFamilyTexts: candidate.realizedFamilies.map((family) => family.familyText),
		matchedSurfaceGroupIndices: candidate.hanSurfaceCompletionGroups.map(
			(group) => group.surfaceGroupIndex,
		),
	}));
}

function summarizePackingProfiles(
	profiles: readonly EvidencePackingProfile[],
): ReadonlyArray<{
	docId: number;
	path: string;
	realizedCoverageCount: number;
	coverageGate: EvidencePackingProfile["coverageGate"];
	exactUnitCount: number;
	completedHanSurfaceGroupCount: number;
	strongestHanSurfaceCompletionTier: EvidencePackingProfile["strongestHanSurfaceCompletionTier"];
	realizedFamilies: ReadonlyArray<{
		queryUnitIndex: number;
		queryUnitText: string;
		querySurfaceGroupIndex: number | null;
		familyText: string;
		matchKind: string;
		inIdentity: boolean;
		inRoute: boolean;
		inHeading: boolean;
		inBestBodyWindow: boolean;
		inBodyResidue: boolean;
	}>;
	bodyWindowBlockIds: readonly number[];
	hasOnlyWeakHanRescue: boolean;
	singletonHanCompletion: {
		matched: boolean;
		char: string | null;
		charIndex: number | null;
		surfaceGroupIndex: number | null;
		matchSource: EvidencePackingProfile["singletonHanCompletion"]["matchSource"];
		bestAnchorKind: EvidencePackingProfile["singletonHanCompletion"]["bestAnchorKind"];
		bestAnchorDistance: number | null;
		tier: EvidencePackingProfile["singletonHanCompletion"]["tier"];
	};
}> {
	return profiles.map((profile) => ({
		docId: profile.docId,
		path: profile.path,
		realizedCoverageCount: profile.realizedCoverageCount,
		coverageGate: profile.coverageGate,
		exactUnitCount: profile.exactUnitCount,
		completedHanSurfaceGroupCount: profile.completedHanSurfaceGroupCount,
		strongestHanSurfaceCompletionTier: profile.strongestHanSurfaceCompletionTier,
		realizedFamilies: profile.realizedFamilies.map((family) => ({
			queryUnitIndex: family.queryUnitIndex,
			queryUnitText: family.queryUnitText,
			querySurfaceGroupIndex: family.querySurfaceGroupIndex,
			familyText: family.familyText,
			matchKind: family.matchKind,
			inIdentity: family.inIdentity,
			inRoute: family.inRoute,
			inHeading: family.inHeading,
			inBestBodyWindow: family.inBestBodyWindow,
				inBodyResidue: family.inBodyResidue,
			})),
		bodyWindowBlockIds: profile.bodyWindowContainer?.blockIds ?? [],
		hasOnlyWeakHanRescue: profile.hasOnlyWeakHanRescue,
		singletonHanCompletion: {
			matched: profile.singletonHanCompletion.matched,
			char: profile.singletonHanCompletion.singletonHanChar,
			charIndex: profile.singletonHanCompletion.singletonHanCharIndex,
			surfaceGroupIndex:
				profile.singletonHanCompletion.singletonHanSurfaceGroupIndex,
			matchSource: profile.singletonHanCompletion.matchSource,
			bestAnchorKind: profile.singletonHanCompletion.bestAnchorKind,
			bestAnchorDistance: profile.singletonHanCompletion.bestAnchorDistance,
			tier: profile.singletonHanCompletion.tier,
		},
	}));
}

function summarizeAllowedBodyOpaqueRescueByLiveDocSlot(
	allowedBodyOpaqueRescueByLiveDocSlot: ReadonlyMap<number, ReadonlySet<number>>,
): ReadonlyArray<{
	liveDocSlot: number;
	allowedSurfaceGroupIndices: readonly number[];
}> {
	return [...allowedBodyOpaqueRescueByLiveDocSlot.entries()]
		.map(([liveDocSlot, surfaceGroupIndices]) => ({
			liveDocSlot,
			allowedSurfaceGroupIndices: [...surfaceGroupIndices].sort(
				(left, right) => left - right,
			),
		}))
		.sort((left, right) => left.liveDocSlot - right.liveDocSlot);
}

function hasBodyOpaqueRescueSeeds(candidateRecall: V3RecallState["candidateDocs"][number]): boolean {
	return candidateRecall.hanSurfaceGroupRecalls.some(
		(groupRecall) => groupRecall.bodySeedBlockIds.length > 0,
	);
}

function buildAllowedBodyOpaqueRescueSurfaceGroups(
	base: ResidentBase,
	queryAnalysis: V3RecallState["queryAnalysis"],
	candidateDocs: V3RecallState["candidateDocs"],
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	hydratedEvidenceByLiveDocSlot?: ReadonlyMap<number, CandidateEvidencePackage> | null,
): ReadonlyMap<number, ReadonlySet<number>> {
	const comparisonProfileByLiveDocSlotAndSurfaceGroup = new Map<
		string,
		EvidencePackingProfile
	>();
	const bestBySurfaceGroupIndex = new Map<number, EvidencePackingProfile>();
	const hasOtherFamilyEvidenceBySurfaceGroup = new Map<number, boolean>();
	for (const candidateRecall of candidateDocs) {
		for (const groupRecall of candidateRecall.hanSurfaceGroupRecalls) {
			if (groupRecall.bodySeedBlockIds.length === 0) {
				continue;
			}
			const comparisonProfile = buildPackingProfile(
				base,
				queryAnalysis,
				candidateRecall,
				unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices: null,
					excludeSurfaceGroupIndices: new Set<number>([groupRecall.surfaceGroupIndex]),
					hydratedEvidence:
						hydratedEvidenceByLiveDocSlot?.get(candidateRecall.liveDocSlot) ?? null,
				},
			);
			comparisonProfileByLiveDocSlotAndSurfaceGroup.set(
				buildBodyOpaqueRescueGateKey(
					candidateRecall.liveDocSlot,
					groupRecall.surfaceGroupIndex,
				),
				comparisonProfile,
			);
			if (comparisonProfile.realizedCoverageCount > 0) {
				hasOtherFamilyEvidenceBySurfaceGroup.set(groupRecall.surfaceGroupIndex, true);
			}
			const currentBest = bestBySurfaceGroupIndex.get(groupRecall.surfaceGroupIndex);
			if (
				currentBest == null ||
				comparePackingProfilesBeforeHanSurfaceCompletion(
					comparisonProfile,
					currentBest,
				) < 0
			) {
				bestBySurfaceGroupIndex.set(groupRecall.surfaceGroupIndex, comparisonProfile);
			}
		}
	}
	const allowedByLiveDocSlot = new Map<number, Set<number>>();
	for (const candidateRecall of candidateDocs) {
		for (const groupRecall of candidateRecall.hanSurfaceGroupRecalls) {
			if (groupRecall.bodySeedBlockIds.length === 0) {
				continue;
			}
			if (!hasOtherFamilyEvidenceBySurfaceGroup.get(groupRecall.surfaceGroupIndex)) {
				pushAllowedBodyOpaqueRescueSurfaceGroup(
					allowedByLiveDocSlot,
					candidateRecall.liveDocSlot,
					groupRecall.surfaceGroupIndex,
				);
				continue;
			}
			const comparisonProfile = comparisonProfileByLiveDocSlotAndSurfaceGroup.get(
				buildBodyOpaqueRescueGateKey(
					candidateRecall.liveDocSlot,
					groupRecall.surfaceGroupIndex,
				),
			);
			if (comparisonProfile == null || comparisonProfile.realizedCoverageCount === 0) {
				continue;
			}
			const best = bestBySurfaceGroupIndex.get(groupRecall.surfaceGroupIndex);
			if (
				best == null ||
				comparePackingProfilesBeforeHanSurfaceCompletion(comparisonProfile, best) !== 0
			) {
				continue;
			}
			pushAllowedBodyOpaqueRescueSurfaceGroup(
				allowedByLiveDocSlot,
				candidateRecall.liveDocSlot,
				groupRecall.surfaceGroupIndex,
			);
		}
	}
	return allowedByLiveDocSlot;
}

function buildBodyOpaqueRescueGateKey(
	liveDocSlot: number,
	surfaceGroupIndex: number,
): string {
	return `${liveDocSlot}:${surfaceGroupIndex}`;
}

function pushAllowedBodyOpaqueRescueSurfaceGroup(
	target: Map<number, Set<number>>,
	liveDocSlot: number,
	surfaceGroupIndex: number,
): void {
	const existing = target.get(liveDocSlot);
	if (existing != null) {
		existing.add(surfaceGroupIndex);
		return;
	}
	target.set(liveDocSlot, new Set<number>([surfaceGroupIndex]));
}

function roundDebugMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}
