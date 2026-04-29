import type { IndexedDocument } from "src/globals/search-types";
import type {
	LexicalHanBodyEvidenceRow,
	LexicalHanDocEvidenceRow,
} from "src/services/database/database";
import {
	buildResidentHotBaseArtifacts,
	residentIndexViewFromBase,
} from "./build";
import {
	logCoverageLexicalV3Debug,
	nowDebugMs,
	shouldLogCoverageLexicalV3Debug,
} from "./debug";
import type {
	ResidentBase,
	ResidentIndexView,
	ResidentIndexViewSummary,
	ResidentFuzzyRescueIndex,
} from "./layout/types";
import {
	buildShardInvalidationKey,
	buildShardInvalidationSet,
	filterInvalidatedCandidates,
	type ShardInvalidationEntry,
} from "./invalidation";
import { EMPTY_RESIDENT_FUZZY_RESCUE_INDEX } from "./layout/fuzzy-rescue";
import { describeResidentIndexView } from "./metrics";
import { analyzeQuery } from "./query";
import type { V3DocumentTokenizer } from "./query";
import { applyPrefixFanoutGuard } from "./prefix-fanout-guard";
import {
	recallCandidateDocs,
	lookupQueryUnitFamilies,
	type V3QueryUnitFamilyMatches,
	type V3CandidateDocRecall,
	type V3RecallState,
} from "./recall";
import {
	getLiveDocGeneration,
	getLiveDocRef,
	getLiveDocSlotForBlockId,
} from "./recall/access";
import {
	buildCandidateHydrationKey,
	buildPackingProfile,
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
	hydrateCandidateEvidenceBatch,
	preparePackingProfileQueryContext,
	type CandidateEvidenceHydrationSource,
	type CandidateEvidencePackage,
	type EvidencePackingProfile,
	type PackingProfileQueryContext,
} from "./ranking";
import {
	buildLexicalBlockEvidenceRowId,
	buildLexicalDocEvidenceRowId,
	type LexicalBodyEvidencePublishRow,
	type LexicalBodyEvidenceSnapshot,
	type LexicalHanBodyEvidenceSnapshot,
	type LexicalHanDocEvidenceSnapshot,
} from "../shared/file-snapshot-store";

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

export type CoverageLexicalV3BenchmarkPhaseEntry = Readonly<{
	phase: string;
	durationMs: number;
	unitCount: number;
}>;

export type CoverageLexicalV3BenchmarkPhaseBreakdown = Readonly<{
	prepareSubphases: readonly CoverageLexicalV3BenchmarkPhaseEntry[];
	rankSubphases: readonly CoverageLexicalV3BenchmarkPhaseEntry[];
}>;

type ResidentColdEvidenceRows = Readonly<{
	bodyEvidenceByRowId: ReadonlyMap<string, LexicalBodyEvidenceSnapshot>;
	hanDocEvidenceByRowId: ReadonlyMap<string, LexicalHanDocEvidenceSnapshot>;
	hanBodyEvidenceByRowId: ReadonlyMap<string, LexicalHanBodyEvidenceSnapshot>;
}>;

type PackingContextForShard = Readonly<{
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[];
	queryContext: PackingProfileQueryContext;
}>;

export class CoverageLexicalV3Engine {
	private residentIndexView: ResidentIndexView | null = null;
	private fuzzyRescueIndex: ResidentFuzzyRescueIndex =
		EMPTY_RESIDENT_FUZZY_RESCUE_INDEX;
	private residentColdEvidenceRows: ResidentColdEvidenceRows | null = null;
	private benchmarkPhaseTrackingEnabled = false;
	private lastBenchmarkPrepareSubphases: readonly CoverageLexicalV3BenchmarkPhaseEntry[] =
		[];
	private lastBenchmarkRankSubphases: readonly CoverageLexicalV3BenchmarkPhaseEntry[] =
		[];
	private residentBaseByShardKey = new Map<string, ResidentBase>();
	private invalidatedCandidateKeys: ReadonlySet<string> = new Set();

	buildResidentIndexView(
		documents: readonly IndexedDocument[],
		tokenizeDocumentText?: V3DocumentTokenizer,
	): ResidentIndexView {
		const canonicalDocuments = documents.map((document, documentIndex) => ({
			...document,
			docRef: document.docRef ?? documentIndex + 1,
			generation: document.generation ?? 1,
		}));
		const artifacts = buildResidentHotBaseArtifacts(
			canonicalDocuments,
			tokenizeDocumentText,
		);
		const indexView = residentIndexViewFromBase({
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		});
		this.loadResidentIndexView(indexView);
		this.residentColdEvidenceRows = materializeResidentColdEvidenceRows(
			artifacts.bodyEvidenceRows,
			artifacts.hanDocEvidenceRows,
			artifacts.hanBodyEvidenceRows,
		);
		return indexView;
	}

	loadResidentIndexView(indexView: ResidentIndexView): void {
		if (indexView.shards.length === 0) {
			throw new Error("CoverageLexicalV3Engine.loadResidentIndexView requires a shard");
		}
		this.residentIndexView = indexView;
		this.residentBaseByShardKey = buildResidentBaseByShardKey(indexView);
		this.fuzzyRescueIndex = buildMergedFuzzyRescueIndex(indexView);
		this.residentColdEvidenceRows = null;
	}

	loadOverlayResidentShard(overlayShard: ResidentIndexView["shards"][number] | null): void {
		if (this.residentIndexView == null) {
			throw new Error("CoverageLexicalV3Engine.loadOverlayResidentShard requires a resident index view");
		}
		const baseShards = this.residentIndexView.shards.filter(
			(shard) => !shard.shardId.endsWith(":overlay"),
		);
		this.loadResidentIndexView({
			...this.residentIndexView,
			shards: overlayShard == null ? baseShards : [...baseShards, overlayShard],
		});
	}

	clearOverlayResidentShard(): void {
		this.loadOverlayResidentShard(null);
	}

	getResidentIndexView(): ResidentIndexView | null {
		return this.residentIndexView;
	}

	getFuzzyRescueIndex(): ResidentFuzzyRescueIndex {
		return this.fuzzyRescueIndex;
	}

	isResidentDocumentInvalidated(params: {
		shardId: string;
		shardGeneration: number;
		base: ResidentBase;
		docId: number;
	}): boolean {
		const docRef = params.base.docTable.docRefsByDocId[params.docId];
		if (!Number.isFinite(docRef) || docRef <= 0) {
			return false;
		}
		return this.invalidatedCandidateKeys.has(
			buildShardInvalidationKey({
				shardId: params.shardId,
				shardGeneration: params.shardGeneration,
				docRef,
				docGeneration: params.base.docTable.generationByDocId[params.docId] ?? 0,
			}),
		);
	}

	setFuzzyRescueIndex(index: ResidentFuzzyRescueIndex): void {
		this.fuzzyRescueIndex = index;
	}

	loadShardInvalidations(entries: readonly ShardInvalidationEntry[]): void {
		this.invalidatedCandidateKeys = buildShardInvalidationSet(entries);
	}

	clearShardInvalidations(): void {
		this.invalidatedCandidateKeys = new Set();
	}

	clearFuzzyRescueIndex(): void {
		this.fuzzyRescueIndex = EMPTY_RESIDENT_FUZZY_RESCUE_INDEX;
	}

	describeResidentIndexView(): ResidentIndexViewSummary | null {
		if (this.residentIndexView == null) {
			return null;
		}
		return describeResidentIndexView(this.residentIndexView);
	}

	private requireResidentShards(): ResidentIndexView["shards"] {
		const shards = this.residentIndexView?.shards;
		if (shards == null || shards.length === 0) {
			throw new Error("CoverageLexicalV3Engine.search requires a resident index view");
		}
		return shards;
	}

	private requireCandidateResidentBase(candidateRecall: V3CandidateDocRecall): ResidentBase {
		const residentBase = this.residentBaseByShardKey.get(
			buildResidentShardKey(candidateRecall.shardId, candidateRecall.shardGeneration),
		);
		if (residentBase == null) {
			throw new Error(
				`CoverageLexicalV3Engine missing resident shard ${candidateRecall.shardId}@${candidateRecall.shardGeneration}`,
			);
		}
		return residentBase;
	}

	private materializeResidentColdEvidence(
		candidateRecalls: readonly V3CandidateDocRecall[],
	): CandidateEvidenceHydrationSource | null {
		const residentColdEvidenceRows = this.residentColdEvidenceRows;
		if (residentColdEvidenceRows == null) {
			return null;
		}
		const bodyEvidenceByBlockId = new Map<number, LexicalBodyEvidenceSnapshot>();
		const bodyHanEvidenceByBlockId = new Map<number, LexicalHanBodyEvidenceSnapshot>();
		const docHanEvidenceByCandidateKey = new Map<
			string,
			LexicalHanDocEvidenceSnapshot
		>();
		for (const candidateRecall of candidateRecalls) {
			const residentBase = this.requireCandidateResidentBase(candidateRecall);
			const docRef = getLiveDocRef(residentBase, candidateRecall.liveDocSlot);
			if (docRef != null) {
				const docRowId = buildLexicalDocEvidenceRowId({
					shardId: candidateRecall.shardId,
					shardGeneration: candidateRecall.shardGeneration,
					docRef,
					generation: getLiveDocGeneration(
						residentBase,
						candidateRecall.liveDocSlot,
					),
				});
				const docEvidence =
					residentColdEvidenceRows.hanDocEvidenceByRowId.get(docRowId);
				if (docEvidence != null) {
					docHanEvidenceByCandidateKey.set(
						buildCandidateHydrationKey(candidateRecall),
						docEvidence,
					);
				}
			}
			const evidenceBlockIds = new Set<number>(candidateRecall.shortlistedBodyBlockIds);
			for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
				for (const adjacentBlockId of [blockId - 1, blockId + 1]) {
					if (
						getLiveDocSlotForBlockId(residentBase, adjacentBlockId) ===
						candidateRecall.liveDocSlot
					) {
						evidenceBlockIds.add(adjacentBlockId);
					}
				}
			}
			for (const blockId of [...evidenceBlockIds].sort((left, right) => left - right)) {
				const blockLiveDocSlot = getLiveDocSlotForBlockId(residentBase, blockId);
				const blockDocRef = getLiveDocRef(residentBase, blockLiveDocSlot);
				if (blockDocRef == null) {
					continue;
				}
				const blockRowId = buildLexicalBlockEvidenceRowId({
					shardId: candidateRecall.shardId,
					shardGeneration: candidateRecall.shardGeneration,
					docRef: blockDocRef,
					generation: getLiveDocGeneration(residentBase, blockLiveDocSlot),
					blockOrdinal:
						residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId,
				});
				const bodyEvidence =
					residentColdEvidenceRows.bodyEvidenceByRowId.get(blockRowId);
				if (bodyEvidence != null) {
					bodyEvidenceByBlockId.set(blockId, bodyEvidence);
				}
				const bodyHanEvidence =
					residentColdEvidenceRows.hanBodyEvidenceByRowId.get(blockRowId);
				if (bodyHanEvidence != null) {
					bodyHanEvidenceByBlockId.set(blockId, bodyHanEvidence);
				}
			}
		}
		return {
			bodyEvidenceByBlockId,
			docHanEvidenceByCandidateKey,
			bodyHanEvidenceByBlockId,
		};
	}

	hydrateCandidateEvidenceByShard(
		candidateRecalls: readonly V3CandidateDocRecall[],
		sourceByShardKey?: ReadonlyMap<string, CandidateEvidenceHydrationSource | null>,
	): ReadonlyMap<string, CandidateEvidencePackage> {
		const hydratedByCandidateKey = new Map<string, CandidateEvidencePackage>();
		const candidateRecallsByShardKey = new Map<string, V3CandidateDocRecall[]>();
		for (const candidateRecall of candidateRecalls) {
			const shardKey = buildResidentShardKey(
				candidateRecall.shardId,
				candidateRecall.shardGeneration,
			);
			const existing = candidateRecallsByShardKey.get(shardKey);
			if (existing != null) {
				existing.push(candidateRecall);
			} else {
				candidateRecallsByShardKey.set(shardKey, [candidateRecall]);
			}
		}
		for (const shardCandidateRecalls of candidateRecallsByShardKey.values()) {
			const firstCandidateRecall = shardCandidateRecalls[0];
			if (firstCandidateRecall == null) {
				continue;
			}
			const hydratedForShard = hydrateCandidateEvidenceBatch(
				this.requireCandidateResidentBase(firstCandidateRecall),
				shardCandidateRecalls,
				sourceByShardKey?.get(
					buildResidentShardKey(
						firstCandidateRecall.shardId,
						firstCandidateRecall.shardGeneration,
					),
				) ?? this.materializeResidentColdEvidence(shardCandidateRecalls),
			);
			for (const [candidateKey, evidence] of hydratedForShard) {
				hydratedByCandidateKey.set(candidateKey, evidence);
			}
		}
		return hydratedByCandidateKey;
	}

	private filterInvalidatedCandidateDocs(
		candidateRecalls: readonly V3CandidateDocRecall[],
	): V3CandidateDocRecall[] {
		return filterInvalidatedCandidates(
			candidateRecalls,
			(candidateRecall) => this.requireCandidateResidentBase(candidateRecall),
			this.invalidatedCandidateKeys,
		);
	}

	setBenchmarkPhaseTrackingEnabled(enabled: boolean): void {
		this.benchmarkPhaseTrackingEnabled = enabled;
		if (!enabled) {
			this.clearLastBenchmarkPhaseBreakdown();
		}
	}

	clearLastBenchmarkPhaseBreakdown(): void {
		this.lastBenchmarkPrepareSubphases = [];
		this.lastBenchmarkRankSubphases = [];
	}

	getLastBenchmarkPhaseBreakdown(): CoverageLexicalV3BenchmarkPhaseBreakdown | null {
		if (
			this.lastBenchmarkPrepareSubphases.length === 0 &&
			this.lastBenchmarkRankSubphases.length === 0
		) {
			return null;
		}
		return {
			prepareSubphases: this.lastBenchmarkPrepareSubphases,
			rankSubphases: this.lastBenchmarkRankSubphases,
		};
	}

	prepareSearch(
		queryText: string,
		queryTerms: readonly string[] = [],
		options: CoverageLexicalV3SearchOptions = {},
		fuzzyRescueIndex: ResidentFuzzyRescueIndex = this.fuzzyRescueIndex,
	): CoverageLexicalV3PreparedSearch {
		const residentShards = this.requireResidentShards();
		const benchmarkPhaseEntries: CoverageLexicalV3BenchmarkPhaseEntry[] = [];
		const analyzeStartedAtMs = this.benchmarkPhaseTrackingEnabled ? nowDebugMs() : 0;
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "analyze",
				durationMs: nowDebugMs() - analyzeStartedAtMs,
				unitCount: Math.max(queryTerms.length, 1),
			});
		}
		const familyLookupStartedAtMs = this.benchmarkPhaseTrackingEnabled
			? nowDebugMs()
			: 0;
		const unitFamilyMatches = collectShardFamilyMatches(
			residentShards,
			queryAnalysis,
			options,
			fuzzyRescueIndex,
		);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "familyLookup",
				durationMs: nowDebugMs() - familyLookupStartedAtMs,
				unitCount: Math.max(queryAnalysis.primaryUnits.length, 1),
			});
		}
		const recallStartedAtMs = this.benchmarkPhaseTrackingEnabled ? nowDebugMs() : 0;
		const recalledCandidateDocs = collectShardCandidateDocs(
			residentShards,
			queryAnalysis,
			unitFamilyMatches,
		);
		const candidateDocs = this.filterInvalidatedCandidateDocs(recalledCandidateDocs);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "recall",
				durationMs: nowDebugMs() - recallStartedAtMs,
				unitCount: Math.max(candidateDocs.length, 1),
			});
		}
		const guardStartedAtMs = this.benchmarkPhaseTrackingEnabled ? nowDebugMs() : 0;
		const guardResult = applyPrefixFanoutGuard(
			candidateDocs,
			options.maxItemResults,
		);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "guard",
				durationMs: nowDebugMs() - guardStartedAtMs,
				unitCount: Math.max(candidateDocs.length, 1),
			});
			this.lastBenchmarkPrepareSubphases = benchmarkPhaseEntries;
		}
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
		hydratedEvidenceByCandidateKey?: ReadonlyMap<string, CandidateEvidencePackage> | null,
	): CoverageLexicalV3SearchResult {
		const { queryAnalysis, unitFamilyMatches, guardedCandidateDocs } =
			preparedSearch;
		const benchmarkPhaseEntries: CoverageLexicalV3BenchmarkPhaseEntry[] = [];
		const hydrateStartedAtMs = this.benchmarkPhaseTrackingEnabled ? nowDebugMs() : 0;
		const effectiveHydratedEvidenceByCandidateKey =
			hydratedEvidenceByCandidateKey ??
			this.hydrateCandidateEvidenceByShard(guardedCandidateDocs);
		if (this.benchmarkPhaseTrackingEnabled && hydratedEvidenceByCandidateKey == null) {
			benchmarkPhaseEntries.push({
				phase: "residentHydrate",
				durationMs: nowDebugMs() - hydrateStartedAtMs,
				unitCount: Math.max(guardedCandidateDocs.length, 1),
			});
		}
		const provisionalPackingStartedAtMs = this.benchmarkPhaseTrackingEnabled
			? nowDebugMs()
			: 0;
		const packingContextByShardKey = new Map<string, PackingContextForShard>();
		const getPackingContextForCandidate = (
			candidateRecall: V3CandidateDocRecall,
		) =>
			getOrCreatePackingContextForCandidate(
				packingContextByShardKey,
				queryAnalysis,
				unitFamilyMatches,
				candidateRecall,
			);
		const provisionalCandidateProfiles = guardedCandidateDocs.map((candidateRecall) => {
			const shardPackingContext = getPackingContextForCandidate(candidateRecall);
			return buildPackingProfile(
				this.requireCandidateResidentBase(candidateRecall),
				queryAnalysis,
				candidateRecall,
				shardPackingContext.unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices: null,
					hydratedEvidence:
						effectiveHydratedEvidenceByCandidateKey.get(
							buildCandidateHydrationKey(candidateRecall),
						) ?? null,
					queryContext: shardPackingContext.queryContext,
				},
			);
		});
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "provisionalPacking",
				durationMs: nowDebugMs() - provisionalPackingStartedAtMs,
				unitCount: Math.max(guardedCandidateDocs.length, 1),
			});
		}
		const provisionalFilterStartedAtMs = this.benchmarkPhaseTrackingEnabled
			? nowDebugMs()
			: 0;
		const provisionalCandidates = provisionalCandidateProfiles
			.filter(
				(candidate, index) =>
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasAnyHanRescueAssessment ||
					hasBodyOpaqueRescueSeeds(guardedCandidateDocs[index]),
			);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "provisionalFilter",
				durationMs: nowDebugMs() - provisionalFilterStartedAtMs,
				unitCount: Math.max(provisionalCandidateProfiles.length, 1),
			});
		}
		const opaqueRescueGateStartedAtMs = this.benchmarkPhaseTrackingEnabled
			? nowDebugMs()
			: 0;
		const allowedBodyOpaqueRescueSurfaceGroupsByCandidateKey =
			buildAllowedBodyOpaqueRescueSurfaceGroups(
				(candidateRecall) => this.requireCandidateResidentBase(candidateRecall),
				queryAnalysis,
				guardedCandidateDocs,
				unitFamilyMatches,
				effectiveHydratedEvidenceByCandidateKey,
			);
		const secondPassCandidateProfiles = guardedCandidateDocs.map((candidateRecall, index) => {
			const candidateKey = buildCandidateHydrationKey(candidateRecall);
			const allowBodyOpaqueRescueSurfaceGroupIndices =
				allowedBodyOpaqueRescueSurfaceGroupsByCandidateKey.get(candidateKey) ?? null;
			if (
				allowBodyOpaqueRescueSurfaceGroupIndices == null ||
				allowBodyOpaqueRescueSurfaceGroupIndices.size === 0
			) {
				return provisionalCandidateProfiles[index]!;
			}
			const shardPackingContext = getPackingContextForCandidate(candidateRecall);
			return buildPackingProfile(
				this.requireCandidateResidentBase(candidateRecall),
				queryAnalysis,
				candidateRecall,
				shardPackingContext.unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices,
					hydratedEvidence:
						effectiveHydratedEvidenceByCandidateKey.get(candidateKey) ?? null,
					queryContext: shardPackingContext.queryContext,
				},
			);
		});
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "opaqueRescueSecondPass",
				durationMs: nowDebugMs() - opaqueRescueGateStartedAtMs,
				unitCount: Math.max(countBodyOpaqueRescueSurfaceGroups(guardedCandidateDocs), 1),
			});
		}
		const finalFilterStartedAtMs = this.benchmarkPhaseTrackingEnabled
			? nowDebugMs()
			: 0;
		const rankedCandidatesBeforeSort = secondPassCandidateProfiles.filter(
			(candidate, index) =>
				(candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasOnlyWeakHanRescue) &&
				(provisionalCandidates.includes(provisionalCandidateProfiles[index]!) ||
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasOnlyWeakHanRescue),
		);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "finalFilter",
				durationMs: nowDebugMs() - finalFilterStartedAtMs,
				unitCount: Math.max(provisionalCandidates.length, 1),
			});
		}
		const sortStartedAtMs = this.benchmarkPhaseTrackingEnabled ? nowDebugMs() : 0;
		const rankedCandidates = rankedCandidatesBeforeSort.sort(comparePackingProfiles);
		if (this.benchmarkPhaseTrackingEnabled) {
			benchmarkPhaseEntries.push({
				phase: "sort",
				durationMs: nowDebugMs() - sortStartedAtMs,
				unitCount: Math.max(rankedCandidatesBeforeSort.length, 1),
			});
			this.lastBenchmarkRankSubphases = benchmarkPhaseEntries;
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

	search(
		queryText: string,
		queryTerms: readonly string[] = [],
		options: CoverageLexicalV3SearchOptions = {},
	): CoverageLexicalV3SearchResult {
		const residentShards = this.requireResidentShards();
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(queryText);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const analyzeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		const analyzeMs = shouldLogDebug ? nowDebugMs() - analyzeStartedAtMs : 0;
		const familyLookupStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const unitFamilyMatches = collectShardFamilyMatches(
			residentShards,
			queryAnalysis,
			options,
			this.fuzzyRescueIndex,
		);
		const familyLookupMs = shouldLogDebug ? nowDebugMs() - familyLookupStartedAtMs : 0;
		const recallStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const recalledCandidateDocs = collectShardCandidateDocs(
			residentShards,
			queryAnalysis,
			unitFamilyMatches,
		);
		const candidateDocs = this.filterInvalidatedCandidateDocs(recalledCandidateDocs);
		const recallMs = shouldLogDebug ? nowDebugMs() - recallStartedAtMs : 0;
		const guardStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const guardResult = applyPrefixFanoutGuard(candidateDocs, options.maxItemResults);
		const guardedCandidateDocs = guardResult.candidateDocs;
		const guardMs = shouldLogDebug ? nowDebugMs() - guardStartedAtMs : 0;
		const hydratedEvidenceByCandidateKey = this.hydrateCandidateEvidenceByShard(
			guardedCandidateDocs,
		);
		const packingStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const packingContextByShardKey = new Map<string, PackingContextForShard>();
		const getPackingContextForCandidate = (
			candidateRecall: V3CandidateDocRecall,
		) =>
			getOrCreatePackingContextForCandidate(
				packingContextByShardKey,
				queryAnalysis,
				unitFamilyMatches,
				candidateRecall,
			);
		const provisionalCandidateProfiles = guardedCandidateDocs.map((candidateRecall) => {
			const shardPackingContext = getPackingContextForCandidate(candidateRecall);
			return buildPackingProfile(
				this.requireCandidateResidentBase(candidateRecall),
				queryAnalysis,
				candidateRecall,
				shardPackingContext.unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices: null,
					hydratedEvidence:
						hydratedEvidenceByCandidateKey.get(
							buildCandidateHydrationKey(candidateRecall),
						) ?? null,
					queryContext: shardPackingContext.queryContext,
				},
			);
		});
		const provisionalCandidates = provisionalCandidateProfiles
			.filter(
				(candidate, index) =>
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasAnyHanRescueAssessment ||
					hasBodyOpaqueRescueSeeds(guardedCandidateDocs[index]),
			);
		const allowedBodyOpaqueRescueSurfaceGroupsByCandidateKey =
			buildAllowedBodyOpaqueRescueSurfaceGroups(
				(candidateRecall) => this.requireCandidateResidentBase(candidateRecall),
				queryAnalysis,
				guardedCandidateDocs,
				unitFamilyMatches,
				hydratedEvidenceByCandidateKey,
			);
		const secondPassCandidateProfiles = guardedCandidateDocs.map((candidateRecall, index) => {
			const candidateKey = buildCandidateHydrationKey(candidateRecall);
			const allowBodyOpaqueRescueSurfaceGroupIndices =
				allowedBodyOpaqueRescueSurfaceGroupsByCandidateKey.get(candidateKey) ?? null;
			if (
				allowBodyOpaqueRescueSurfaceGroupIndices == null ||
				allowBodyOpaqueRescueSurfaceGroupIndices.size === 0
			) {
				return provisionalCandidateProfiles[index]!;
			}
			const shardPackingContext = getPackingContextForCandidate(candidateRecall);
			return buildPackingProfile(
				this.requireCandidateResidentBase(candidateRecall),
				queryAnalysis,
				candidateRecall,
				shardPackingContext.unitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices,
					hydratedEvidence:
						hydratedEvidenceByCandidateKey.get(candidateKey) ?? null,
					queryContext: shardPackingContext.queryContext,
				},
			);
		});
		const rankedCandidatesBeforeSort = secondPassCandidateProfiles.filter(
			(candidate, index) =>
				(candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasOnlyWeakHanRescue) &&
				(provisionalCandidates.includes(provisionalCandidateProfiles[index]!) ||
					candidate.realizedCoverageCount > 0 ||
					candidate.singletonHanCompletion.matched ||
					candidate.hasOnlyWeakHanRescue),
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
					summarizeAllowedBodyOpaqueRescueByCandidateKey(
						allowedBodyOpaqueRescueSurfaceGroupsByCandidateKey,
					),
				secondPassCandidateDetails:
					summarizePackingProfiles(secondPassCandidateProfiles),
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

function summarizeAllowedBodyOpaqueRescueByCandidateKey(
	allowedBodyOpaqueRescueByCandidateKey: ReadonlyMap<string, ReadonlySet<number>>,
): ReadonlyArray<{
	candidateKey: string;
	allowedSurfaceGroupIndices: readonly number[];
}> {
	return [...allowedBodyOpaqueRescueByCandidateKey.entries()]
		.map(([candidateKey, surfaceGroupIndices]) => ({
			candidateKey,
			allowedSurfaceGroupIndices: [...surfaceGroupIndices].sort(
				(left, right) => left - right,
			),
		}))
		.sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));
}

function hasBodyOpaqueRescueSeeds(candidateRecall: V3RecallState["candidateDocs"][number]): boolean {
	return candidateRecall.hanSurfaceGroupRecalls.some(
		(groupRecall) => groupRecall.bodySeedBlockIds.length > 0,
	);
}

function countBodyOpaqueRescueSurfaceGroups(
	candidateDocs: readonly V3RecallState["candidateDocs"][number][],
): number {
	let count = 0;
	for (const candidateRecall of candidateDocs) {
		count += candidateRecall.hanSurfaceGroupRecalls.length;
	}
	return Math.max(count, 1);
}

function buildAllowedBodyOpaqueRescueSurfaceGroups(
	getCandidateBase: (candidateRecall: V3CandidateDocRecall) => ResidentBase,
	queryAnalysis: V3RecallState["queryAnalysis"],
	candidateDocs: V3RecallState["candidateDocs"],
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	hydratedEvidenceByCandidateKey?: ReadonlyMap<string, CandidateEvidencePackage> | null,
): ReadonlyMap<string, ReadonlySet<number>> {
	const comparisonProfileByCandidateKeyAndSurfaceGroup = new Map<
		string,
		EvidencePackingProfile
	>();
	const bestBySurfaceGroupIndex = new Map<number, EvidencePackingProfile>();
	const hasOtherFamilyEvidenceBySurfaceGroup = new Map<number, boolean>();
	for (const candidateRecall of candidateDocs) {
		const candidateBase = getCandidateBase(candidateRecall);
		const shardUnitFamilyMatches = filterUnitFamilyMatchesForCandidateShard(
			unitFamilyMatches,
			candidateRecall,
		);
		for (const groupRecall of candidateRecall.hanSurfaceGroupRecalls) {
			if (groupRecall.bodySeedBlockIds.length === 0) {
				continue;
			}
			const comparisonProfile = buildPackingProfile(
				candidateBase,
				queryAnalysis,
				candidateRecall,
				shardUnitFamilyMatches,
				{
					allowBodyOpaqueRescueSurfaceGroupIndices: null,
					excludeSurfaceGroupIndices: new Set<number>([groupRecall.surfaceGroupIndex]),
					hydratedEvidence:
						hydratedEvidenceByCandidateKey?.get(
							buildCandidateHydrationKey(candidateRecall),
						) ?? null,
				},
			);
			comparisonProfileByCandidateKeyAndSurfaceGroup.set(
				buildBodyOpaqueRescueGateKey(
					candidateRecall,
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
	const allowedByCandidateKey = new Map<string, Set<number>>();
	for (const candidateRecall of candidateDocs) {
		const candidateKey = buildCandidateHydrationKey(candidateRecall);
		for (const groupRecall of candidateRecall.hanSurfaceGroupRecalls) {
			if (groupRecall.bodySeedBlockIds.length === 0) {
				continue;
			}
			if (!hasOtherFamilyEvidenceBySurfaceGroup.get(groupRecall.surfaceGroupIndex)) {
				pushAllowedBodyOpaqueRescueSurfaceGroup(
					allowedByCandidateKey,
					candidateKey,
					groupRecall.surfaceGroupIndex,
				);
				continue;
			}
			const comparisonProfile = comparisonProfileByCandidateKeyAndSurfaceGroup.get(
				buildBodyOpaqueRescueGateKey(
					candidateRecall,
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
				allowedByCandidateKey,
				candidateKey,
				groupRecall.surfaceGroupIndex,
			);
		}
	}
	return allowedByCandidateKey;
}

function buildBodyOpaqueRescueGateKey(
	candidateRecall: Pick<
		V3CandidateDocRecall,
		"shardId" | "shardGeneration" | "liveDocSlot"
	>,
	surfaceGroupIndex: number,
): string {
	return `${buildCandidateHydrationKey(candidateRecall)}:${surfaceGroupIndex}`;
}

function pushAllowedBodyOpaqueRescueSurfaceGroup(
	target: Map<string, Set<number>>,
	candidateKey: string,
	surfaceGroupIndex: number,
): void {
	const existing = target.get(candidateKey);
	if (existing != null) {
		existing.add(surfaceGroupIndex);
		return;
	}
	target.set(candidateKey, new Set<number>([surfaceGroupIndex]));
}

function roundDebugMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function buildResidentBaseByShardKey(indexView: ResidentIndexView): Map<string, ResidentBase> {
	return new Map(
		indexView.shards.map((shard) => [
			buildResidentShardKey(shard.shardId, shard.generation),
			shard.base,
		]),
	);
}

function buildResidentShardKey(shardId: string, generation: number): string {
	return `${shardId}@${generation}`;
}

function getOrCreatePackingContextForCandidate(
	packingContextByShardKey: Map<string, PackingContextForShard>,
	queryAnalysis: V3RecallState["queryAnalysis"],
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	candidateRecall: V3CandidateDocRecall,
): PackingContextForShard {
	const shardKey = buildResidentShardKey(
		candidateRecall.shardId,
		candidateRecall.shardGeneration,
	);
	const existing = packingContextByShardKey.get(shardKey);
	if (existing != null) {
		return existing;
	}
	const shardUnitFamilyMatches = filterUnitFamilyMatchesForCandidateShard(
		unitFamilyMatches,
		candidateRecall,
	);
	const created = {
		unitFamilyMatches: shardUnitFamilyMatches,
		queryContext: preparePackingProfileQueryContext(
			queryAnalysis,
			shardUnitFamilyMatches,
		),
	};
	packingContextByShardKey.set(shardKey, created);
	return created;
}

function buildMergedFuzzyRescueIndex(indexView: ResidentIndexView): ResidentFuzzyRescueIndex {
	const mergedLookup = new Map<string, Uint32Array>();
	let indexedMetadataFamilyCount = 0;
	let bytes = 0;
	for (const shard of indexView.shards) {
		const fuzzyRescue = shard.base.fuzzyRescue;
		if (fuzzyRescue == null) {
			continue;
		}
		indexedMetadataFamilyCount += fuzzyRescue.indexedMetadataFamilyCount;
		bytes += fuzzyRescue.bytes;
		for (const [lookupKey, slots] of fuzzyRescue.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey) {
			mergedLookup.set(lookupKey, slots);
		}
	}
	return {
		candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey:
			indexView.shards.length === 1 ? mergedLookup : new Map(),
		indexedMetadataFamilyCount,
		fuzzyLookupKeyCount: indexView.shards.length === 1 ? mergedLookup.size : 0,
		bytes,
	};
}

function collectShardFamilyMatches(
	shards: ResidentIndexView["shards"],
	queryAnalysis: V3RecallState["queryAnalysis"],
	options: CoverageLexicalV3SearchOptions,
	fuzzyRescueIndex: ResidentFuzzyRescueIndex,
): readonly V3QueryUnitFamilyMatches[] {
	const matchesByQueryUnitIndex = new Map<number, V3QueryUnitFamilyMatches>();
	for (const shard of shards) {
		const shardMatches = lookupQueryUnitFamilies(
			shard.base,
			queryAnalysis,
			options,
			selectFuzzyRescueIndexForShard(shard, shards, fuzzyRescueIndex),
		);
		for (const unitMatches of shardMatches) {
			const shardOwnedUnitMatches: V3QueryUnitFamilyMatches = {
				...unitMatches,
				matches: unitMatches.matches.map((match) => ({
					...match,
					shardId: shard.shardId,
					shardGeneration: shard.generation,
				})),
			};
			const existing = matchesByQueryUnitIndex.get(unitMatches.queryUnitIndex);
			if (existing == null) {
				matchesByQueryUnitIndex.set(unitMatches.queryUnitIndex, shardOwnedUnitMatches);
				continue;
			}
			matchesByQueryUnitIndex.set(unitMatches.queryUnitIndex, {
				...existing,
				matches: [...existing.matches, ...shardOwnedUnitMatches.matches],
			});
		}
	}
	return [...matchesByQueryUnitIndex.values()].sort(
		(left, right) => left.queryUnitIndex - right.queryUnitIndex,
	);
}

function selectFuzzyRescueIndexForShard(
	shard: ResidentIndexView["shards"][number],
	shards: ResidentIndexView["shards"],
	fuzzyRescueIndex: ResidentFuzzyRescueIndex,
): ResidentFuzzyRescueIndex {
	if (
		shard.base.fuzzyRescue.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.size > 0
	) {
		return shard.base.fuzzyRescue;
	}
	if (fuzzyRescueIndex.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.size === 0) {
		return EMPTY_RESIDENT_FUZZY_RESCUE_INDEX;
	}
	const externalFuzzyTargetShards = shards.filter(
		(candidateShard) =>
			!candidateShard.shardId.endsWith(":overlay") &&
			candidateShard.base.fuzzyRescue.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.size === 0,
	);
	return externalFuzzyTargetShards.length === 1 &&
		externalFuzzyTargetShards[0] === shard
		? fuzzyRescueIndex
		: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX;
}

function collectShardCandidateDocs(
	shards: ResidentIndexView["shards"],
	queryAnalysis: V3RecallState["queryAnalysis"],
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
): V3CandidateDocRecall[] {
	const candidateDocs: V3CandidateDocRecall[] = [];
	for (const shard of shards) {
		const shardUnitFamilyMatches = filterUnitFamilyMatchesForShard(
			unitFamilyMatches,
			shard.shardId,
			shard.generation,
		);
		candidateDocs.push(
			...recallCandidateDocs(shard.base, queryAnalysis, shardUnitFamilyMatches, {
				shardId: shard.shardId,
				shardGeneration: shard.generation,
			}),
		);
	}
	return candidateDocs;
}

function filterUnitFamilyMatchesForCandidateShard(
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	candidateRecall: Pick<V3CandidateDocRecall, "shardId" | "shardGeneration">,
): readonly V3QueryUnitFamilyMatches[] {
	return filterUnitFamilyMatchesForShard(
		unitFamilyMatches,
		candidateRecall.shardId,
		candidateRecall.shardGeneration,
	);
}

function filterUnitFamilyMatchesForShard(
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	shardId: string,
	shardGeneration: number,
): readonly V3QueryUnitFamilyMatches[] {
	return unitFamilyMatches.map((unitMatches) => ({
		...unitMatches,
		matches: unitMatches.matches.filter(
			(match) =>
				(match.shardId == null || match.shardId === shardId) &&
				(match.shardGeneration == null || match.shardGeneration === shardGeneration),
		),
	}));
}

function materializeResidentColdEvidenceRows(
	bodyEvidenceRows: readonly LexicalBodyEvidencePublishRow[],
	hanDocEvidenceRows: readonly LexicalHanDocEvidenceRow[],
	hanBodyEvidenceRows: readonly LexicalHanBodyEvidenceRow[],
): ResidentColdEvidenceRows {
	return {
		bodyEvidenceByRowId: new Map(
			bodyEvidenceRows.map((row) => [
				row.id,
				{
					exactShardLocalFamilySlots: Array.from(row.exactShardLocalFamilySlots),
					exactTokenPositions: Array.from(row.exactTokenPositions),
					supportEntriesByShardLocalFamilySlot: Array.from(
						row.supportShardLocalFamilySlots,
						(shardLocalFamilySlot, supportIndex) => ({
							shardLocalFamilySlot,
							supportMask: Number(row.familySupportMaskByEntry[supportIndex] ?? 0),
						}),
					),
				} satisfies LexicalBodyEvidenceSnapshot,
			]),
		),
		hanDocEvidenceByRowId: new Map(
			hanDocEvidenceRows.map((row) => [
				row.id,
				{
					identityWitnessMatchKeys: Array.from(row.identityWitnessMatchKeys ?? []),
					identityWitnessTexts: row.identityWitnessTexts ?? [],
					identityWitnessSourceMasks: Array.from(
						row.identityWitnessSourceMaskByDocEntry,
					),
					routeWitnessMatchKeys: Array.from(row.routeWitnessMatchKeys ?? []),
					routeWitnessTexts: row.routeWitnessTexts ?? [],
					routeWitnessSourceMasks: Array.from(
						row.routeWitnessSourceMaskByDocEntry,
					),
					headingWitnessMatchKeys: Array.from(row.headingWitnessMatchKeys ?? []),
					headingWitnessTexts: row.headingWitnessTexts ?? [],
				} satisfies LexicalHanDocEvidenceSnapshot,
			]),
		),
		hanBodyEvidenceByRowId: new Map(
			hanBodyEvidenceRows.map((row) => [
				row.id,
				{
					bodyWitnessMatchKeys: Array.from(row.bodyWitnessMatchKeys ?? []),
					bodyWitnessTexts: row.bodyWitnessTexts ?? [],
					bodyWitnessStartOffsets: Array.from(row.bodyWitnessStartOffsets),
				} satisfies LexicalHanBodyEvidenceSnapshot,
			]),
		),
	};
}
