import type {
	BaseIndexedFileRef,
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { OuterSetting } from "src/globals/plugin-setting";
import { buildV3DirectSubitems } from "./direct-subitems";
import {
	logCoverageLexicalV3Debug,
	nowDebugMs,
	shouldLogCoverageLexicalV3Debug,
} from "./debug";
import { Tokenizer } from "src/services/search/tokenizer";
import {
	buildLexicalBlockEvidenceRowId,
	buildLexicalDocEvidenceRowId,
	FileSnapshotStore,
	type LexicalBlockEvidenceLocator,
	type LexicalDocEvidenceLocator,
} from "src/services/search/shared/file-snapshot-store";
import { Database } from "src/services/database/database";
import { buildResidentHotBaseArtifactsStreaming } from "./build";
import {
	DEFAULT_RESIDENT_SHARD_GENERATION,
	DEFAULT_RESIDENT_SHARD_ID,
} from "./build/builder";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	PersistentFileIndexRecoveryChanges,
	PersistentFileIndexRecoveryPlan,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactStore,
} from "./artifact-loader";
import { bootstrapCoverageLexicalV3Engine } from "./bootstrap";
import {
	buildOverlayResidentArtifacts,
	createAtomicDexieActiveOverlayJournalStore,
	type ActiveOverlayJournalStore,
} from "./active-overlay-journal";
import { writeActiveOverlayChanges } from "./active-overlay-writer";
import type { ExistingShardDocVersion } from "./append-planner";
import {
	DexieCompactJobManifestStore,
	DexieCompactTempArtifactStore,
	type CompactJobManifestStore,
	type CompactTempArtifactStore,
} from "./compact";
import {
	runCoverageLexicalV3StorageGc,
	type CoverageLexicalV3StorageGcResult,
	type CoverageLexicalV3StorageGcTables,
} from "./gc";
import {
	runCoverageLexicalV3Maintenance,
	type CoverageLexicalV3MaintenanceResult,
} from "./maintenance";
import { buildV3MetadataFieldHighlightRanges } from "./metadata-highlights";
import {
	CoverageLexicalV3Engine,
	type CoverageLexicalV3BenchmarkPhaseBreakdown,
	type CoverageLexicalV3PreparedSearch,
	type CoverageLexicalV3SearchResult,
} from "./engine";
import type {
	ResidentBase,
	ResidentBaseMetrics,
	ResidentBaseSummary,
	ResidentIndexViewSummary,
	ResidentShard,
} from "./layout/types";
import {
	getLiveDocGeneration,
	getDocPath,
	getLiveDocPath,
	getLiveDocRef,
	getLiveDocSlot,
	getLiveDocSlotForBlockId,
	getLiveDocStableKey,
	type V3CandidateDocRecall,
} from "./recall";
import {
	buildFuzzyLookupKeys,
	EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
	FUZZY_RESCUE_MIN_QUERY_LENGTH,
} from "./layout/fuzzy-rescue";
import {
	buildCandidateHydrationKey,
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
	type CandidateEvidenceHydrationSource,
	type CandidateEvidencePackage,
	type EvidencePackingProfile,
	type HanSurfaceCompletionGroupResult,
	type HanSurfaceCompletionTier,
} from "./ranking";
import { analyzeQuery } from "./query";
import type { ResidentFuzzyRescueIndex } from "./layout/types";
import { describeResidentBase } from "./metrics";
import {
	createDexieCoverageLexicalV3ProductionStores,
	type CoverageLexicalV3ProductionStores,
} from "./stores";
import {
	createDexieCoverageLexicalV3SnapshotStore,
	healCoverageLexicalV3SnapshotState,
	type CoverageLexicalV3SnapshotStore,
	writeCoverageLexicalV3Snapshot,
} from "./snapshot";
import {
	buildDefaultShardDescriptor,
	isReadableShardState,
	type ResidentShardDescriptor,
} from "./shards";

export type CoverageLexicalV3RuntimeMemoryBreakdown = Readonly<{
	__backend: "coverage-lexical-v3";
	metrics: ResidentBaseMetrics;
	summary: ResidentBaseSummary;
	indexSummary: ResidentIndexViewSummary;
}>;

type BodyHanCompletionTier = Extract<HanSurfaceCompletionTier, "body_window" | "body_residue">;

type HanCompletionSummary = Readonly<{
	completedGroupCount: number;
	tierScoreTotal: number;
	strongestTier: HanSurfaceCompletionTier;
}>;

type HanSurfaceDominanceProfile = Readonly<{
	completedGroupCount: number;
	tierScoreTotal: number;
}>;

type IndexedDocumentView = Readonly<{
	docRef?: IndexedDocument["docRef"];
	path: string;
	generation?: number;
	size?: number;
	basename: string;
	folder: string;
}>;

type CurrentDocumentVersion = ExistingShardDocVersion & Readonly<{ path: string }>;

type PendingDocumentContent = Readonly<{
	generation?: number;
	text: string;
}>;

type PendingDocumentMetadata = Readonly<{
	generation?: number;
	aliasesText: string;
	tagsText: string;
	headingsText: string;
}>;

type CoverageLexicalV3PersistentStores = Readonly<{
	productionStores: CoverageLexicalV3ProductionStores;
	artifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	overlayJournalStore: ActiveOverlayJournalStore;
	snapshotStore: CoverageLexicalV3SnapshotStore;
	compactJobStore?: CompactJobManifestStore;
	compactTempArtifactStore?: CompactTempArtifactStore;
	storageGcTables?: CoverageLexicalV3StorageGcTables;
}>;

export type CoverageLexicalV3LastRebuildStats = Readonly<{
	coldEvidenceFlushCount: number;
	maxColdEvidenceChunkSize: number;
	batchMaxRawTextBytes: number;
	pass1Ms: number;
	pass2Ms: number;
	mergeMs: number;
}>;

export type CoverageLexicalV3LastMaintenanceStats =
	CoverageLexicalV3MaintenanceResult &
	Pick<CoverageLexicalV3StorageGcResult, "snapshotManifestsRemoved" | "coldEvidenceRowsRemoved">;

type HydratedRankingEvidence = Readonly<{
	hydratedEvidenceByCandidateKey: ReadonlyMap<string, CandidateEvidencePackage>;
}>;

type CoverageLexicalV3BenchmarkPhaseTimingEntry = Readonly<{
	phase: string;
	totalMs: number;
	maxMs: number;
	count: number;
	unitCount: number;
	avgMsPerCall: number;
	avgMsPerUnit: number;
	shareOfMeasuredMs: number;
	shareOfQueryTime: number;
	shareOfParentMs?: number;
}>;

type CoverageLexicalV3BenchmarkPhaseTimingSummary = Readonly<{
	queryCount: number;
	queryTotalMs: number;
	totalMeasuredMs: number;
	phases: readonly CoverageLexicalV3BenchmarkPhaseTimingEntry[];
	prepareSubphases: readonly CoverageLexicalV3BenchmarkPhaseTimingEntry[];
	rankSubphases: readonly CoverageLexicalV3BenchmarkPhaseTimingEntry[];
}>;

type CoverageLexicalV3BenchmarkPhaseAggregate = {
	totalMs: number;
	maxMs: number;
	count: number;
	unitCount: number;
};

type CoverageLexicalV3BenchmarkPhaseTimingState = {
	queryCount: number;
	queryTotalMs: number;
	phases: Map<string, CoverageLexicalV3BenchmarkPhaseAggregate>;
	prepareSubphases: Map<string, CoverageLexicalV3BenchmarkPhaseAggregate>;
	rankSubphases: Map<string, CoverageLexicalV3BenchmarkPhaseAggregate>;
};

type CoverageLexicalV3BenchmarkPhaseSample = Readonly<{
	phase: string;
	durationMs: number;
	unitCount: number;
}>;

type PersistedLexicalBodyEvidenceRow = Readonly<{
	id: string;
	shardId: string;
	shardGeneration: number;
	docRef: number;
	generation: number;
	blockOrdinal: number;
	exactShardLocalFamilySlots: readonly number[];
	exactTokenPositions: readonly number[];
	supportShardLocalFamilySlots: readonly number[];
	familySupportMaskByEntry: readonly number[];
}>;

type PersistedLexicalHanDocEvidenceRow = Readonly<{
	id: string;
	shardId: string;
	shardGeneration: number;
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
}>;

type PersistedLexicalHanBodyEvidenceRow = Readonly<{
	id: string;
	shardId: string;
	shardGeneration: number;
	docRef: number;
	generation: number;
	blockOrdinal: number;
	bodyWitnessMatchKeys: readonly number[];
	bodyWitnessTexts: readonly string[];
	bodyWitnessStartOffsets: readonly number[];
}>;

type CachedLexicalDocEvidenceLocatorEntry = Readonly<{
	shardId: string;
	shardGeneration: number;
	locator: LexicalDocEvidenceLocator;
	rowId: string;
}>;

type CachedLexicalBlockEvidenceLocatorEntry = Readonly<{
	shardId: string;
	shardGeneration: number;
	locator: LexicalBlockEvidenceLocator;
	rowId: string;
}>;

type CollectedLexicalDocEvidenceRequest = Readonly<{
	shardId: string;
	shardGeneration: number;
	liveDocSlot: number;
	locator: LexicalDocEvidenceLocator;
	rowId: string;
}>;

type CollectedLexicalBlockEvidenceRequest = Readonly<{
	shardId: string;
	shardGeneration: number;
	blockId: number;
	locator: LexicalBlockEvidenceLocator;
	rowId: string;
}>;

const DOC_EVIDENCE_LOCATOR_CACHE = new WeakMap<
	ResidentBase,
	Map<number, CachedLexicalDocEvidenceLocatorEntry | null>
>();
const BLOCK_EVIDENCE_LOCATOR_CACHE = new WeakMap<
	ResidentBase,
	Map<number, CachedLexicalBlockEvidenceLocatorEntry | null>
>();

@singleton()
export class CoverageLexicalV3FileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private engine = new CoverageLexicalV3Engine();
	private readonly outerSetting = getInstance(OuterSetting);
	private readonly documentViewsByPath = new Map<string, IndexedDocumentView>();
	private readonly pendingDocumentContentsByPath = new Map<string, PendingDocumentContent>();
	private readonly pendingDocumentMetadataByPath = new Map<string, PendingDocumentMetadata>();
	private batchReindexing = false;
	private pendingResidentRebuild: Promise<void> | null = null;
	private lastRebuildStats: CoverageLexicalV3LastRebuildStats | null = null;
	private lastMaintenanceStats: CoverageLexicalV3LastMaintenanceStats | null = null;
	private benchmarkPhaseTimingState: CoverageLexicalV3BenchmarkPhaseTimingState | null =
		null;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			this.clearIndex();
			return false;
		}
		this.documentViewsByPath.clear();
		this.pendingDocumentContentsByPath.clear();
		this.pendingDocumentMetadataByPath.clear();
		for (const document of data) {
			this.storeIndexedDocument(document);
		}
		await this.rebuildResidentBase();
		return true;
	}

	clearIndex(): void {
		this.documentViewsByPath.clear();
		this.pendingDocumentContentsByPath.clear();
		this.pendingDocumentMetadataByPath.clear();
		this.pendingResidentRebuild = null;
		this.lastRebuildStats = null;
		this.lastMaintenanceStats = null;
		this.engine = new CoverageLexicalV3Engine();
		if (this.benchmarkPhaseTimingState != null) {
			this.engine.setBenchmarkPhaseTrackingEnabled(true);
		}
	}

	resetBenchmarkPhaseTiming(): void {
		this.benchmarkPhaseTimingState = createBenchmarkPhaseTimingState();
		this.engine.setBenchmarkPhaseTrackingEnabled(true);
		this.engine.clearLastBenchmarkPhaseBreakdown();
	}

	getBenchmarkPhaseTimingSummary(): CoverageLexicalV3BenchmarkPhaseTimingSummary | null {
		if (this.benchmarkPhaseTimingState == null) {
			return null;
		}
		return summarizeBenchmarkPhaseTimingState(this.benchmarkPhaseTimingState);
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.storeIndexedDocument(document);
		}
		if (!this.batchReindexing) {
			await this.rebuildResidentBase();
		}
	}

	deleteDocuments(paths: string[]): void {
		let changed = false;
		for (const path of paths) {
			this.pendingDocumentContentsByPath.delete(path);
			this.pendingDocumentMetadataByPath.delete(path);
			changed = this.documentViewsByPath.delete(path) || changed;
		}
		if (changed && !this.batchReindexing) {
			void this.rebuildResidentBase();
		}
	}

	async moveDocument(
		oldPath: string,
		document: IndexedDocument,
	): Promise<boolean> {
		const overlayApplied = await this.applyOverlayRecoveryChanges({
			deletePaths: [oldPath],
			upsertDocuments: [document],
		});
		if (overlayApplied) {
			this.pendingDocumentContentsByPath.delete(oldPath);
			this.pendingDocumentMetadataByPath.delete(oldPath);
			this.documentViewsByPath.delete(oldPath);
			this.storeIndexedDocument(document);
			return true;
		}
		if (oldPath !== document.path) {
			this.documentViewsByPath.delete(oldPath);
			this.pendingDocumentContentsByPath.delete(oldPath);
			this.pendingDocumentMetadataByPath.delete(oldPath);
		}
		this.storeIndexedDocument(document);
		if (!this.batchReindexing) {
			await this.rebuildResidentBase();
		}
		return true;
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		await this.awaitPendingResidentRebuild();
		if (this.documentViewsByPath.size === 0) {
			return [];
		}
		const queryText = request.queryText.trim();
		if (queryText.length === 0) {
			return [];
		}
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(queryText);
		const shouldMeasureTiming =
			shouldLogDebug || this.benchmarkPhaseTimingState != null;
		const startedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const tokenizeStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const searchTerms = this.getQueryTerms(queryText);
		const tokenizeMs = shouldMeasureTiming ? nowDebugMs() - tokenizeStartedAtMs : 0;
		const fuzzyRescueStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const fuzzyRescueIndex = await this.hydrateFuzzyRescueForQuery(
			queryText,
			searchTerms,
			request.isFuzzy !== false,
		);
		const fuzzyRescueMs = shouldMeasureTiming
			? nowDebugMs() - fuzzyRescueStartedAtMs
			: 0;
		const prepareStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const preparedSearch = this.engine.prepareSearch(queryText, searchTerms, {
			allowPrefixMatch: request.isPrefixMatch,
			allowFuzzyMatch: request.isFuzzy,
			maxItemResults: request.maxItemResults,
		}, fuzzyRescueIndex);
		const prepareMs = shouldMeasureTiming ? nowDebugMs() - prepareStartedAtMs : 0;
		const hydrateStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const { hydratedEvidenceByCandidateKey } =
			await this.hydrateRankingEvidenceForCandidates(preparedSearch);
		const hydrateMs = shouldMeasureTiming ? nowDebugMs() - hydrateStartedAtMs : 0;
		const rankStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const result = this.engine.rankPreparedSearch(
			preparedSearch,
			hydratedEvidenceByCandidateKey,
		);
		const rankMs = shouldMeasureTiming ? nowDebugMs() - rankStartedAtMs : 0;
		const shouldRefineHan = shouldRunHanSurfaceRefine(result);
		const refineStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const refinedCandidates = shouldRefineHan
			? await this.refineHanSurfaceCompletion(result, hydratedEvidenceByCandidateKey)
			: result.rankedCandidates;
		const refineMs = shouldMeasureTiming ? nowDebugMs() - refineStartedAtMs : 0;
		const visibilityFilteredCandidates =
			request.hideWeaklyRelatedResults === true
				? refinedCandidates.filter(
						(candidate) =>
							!candidate.hasOnlyWeakHanRescue ||
							candidate.singletonHanCompletion.matched ||
							hasHanBigramRescueSupport(candidate),
					)
				: refinedCandidates;
		const pruneStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const weaklyPrunedCandidates = request.hideWeaklyRelatedResults
			? filterToTopCoverageGateBand(visibilityFilteredCandidates)
			: visibilityFilteredCandidates;
		const pruneMs = shouldMeasureTiming ? nowDebugMs() - pruneStartedAtMs : 0;
		const visibleStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const visibleCandidates = applyHanSurfaceCompletionDominance(
			result,
			weaklyPrunedCandidates,
			request.hideWeaklyRelatedResults === true,
		);
		const visibleMs = shouldMeasureTiming ? nowDebugMs() - visibleStartedAtMs : 0;
		const materializeStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const queryTerms = result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text);
		const matchedFiles = visibleCandidates.slice(0, request.maxItemResults).map((candidate) => {
			const documentView = this.documentViewsByPath.get(candidate.path);
			const basenameText = documentView?.basename ?? "";
			const folderText = documentView?.folder ?? "";
			const metadataHighlights = buildV3MetadataFieldHighlightRanges({
				queryAnalysis: result.recallState.queryAnalysis,
				candidate,
				basenameText,
				folderText,
			});
			return {
				path: candidate.path,
				snapshotGeneration: documentView?.generation,
				snapshotSource: "live" as const,
				freshnessState: "fresh" as const,
				freshnessReason: "none" as const,
				queryTerms,
				matchedTerms: buildMatchedTerms(candidate, result),
				score: candidate.realizedCoverageCount,
				directSubItems: [],
				nativeSubItemsReady: false,
				basenameHighlightRanges: metadataHighlights.basenameHighlightRanges,
				basenameWeakHighlightRanges:
					metadataHighlights.basenameWeakHighlightRanges,
				folderHighlightRanges: metadataHighlights.folderHighlightRanges,
				folderWeakHighlightRanges: metadataHighlights.folderWeakHighlightRanges,
			};
		});
		const materializeMs = shouldMeasureTiming ? nowDebugMs() - materializeStartedAtMs : 0;
		const totalMs = shouldMeasureTiming ? nowDebugMs() - startedAtMs : 0;
		if (this.benchmarkPhaseTimingState != null) {
			recordBenchmarkPhaseTiming(this.benchmarkPhaseTimingState, totalMs, [
				{ phase: "tokenize", durationMs: tokenizeMs, unitCount: Math.max(searchTerms.length, 1) },
				{ phase: "fuzzyRescueHydrate", durationMs: fuzzyRescueMs, unitCount: Math.max(searchTerms.length, 1) },
				{ phase: "prepare", durationMs: prepareMs, unitCount: Math.max(preparedSearch.guardedCandidateDocs.length, 1) },
				{ phase: "evidenceHydrate", durationMs: hydrateMs, unitCount: Math.max(preparedSearch.guardedCandidateDocs.length, 1) },
				{ phase: "rank", durationMs: rankMs, unitCount: Math.max(preparedSearch.guardedCandidateDocs.length, 1) },
				{ phase: "hanRefine", durationMs: refineMs, unitCount: Math.max(result.rankedCandidates.length, 1) },
				{ phase: "prune", durationMs: pruneMs, unitCount: Math.max(visibilityFilteredCandidates.length, 1) },
				{ phase: "visible", durationMs: visibleMs, unitCount: Math.max(weaklyPrunedCandidates.length, 1) },
				{ phase: "materialize", durationMs: materializeMs, unitCount: Math.max(matchedFiles.length, 1) },
			], this.engine.getLastBenchmarkPhaseBreakdown());
		}
		if (shouldLogDebug) {
			logCoverageLexicalV3Debug("file-search-engine.searchFiles", {
				queryText,
				searchTerms,
				searchTermCount: searchTerms.length,
				queryPrimaryUnits: result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
					index: unit.index,
					text: unit.text,
					source: unit.source,
					surfaceGroupIndex: unit.surfaceGroupIndex,
				})),
				querySurfaceGroups: result.recallState.queryAnalysis.surfaceGroups.map((group) => ({
					index: group.index,
					text: group.text,
					kind: group.kind,
					hanBigramTexts: group.hanBigramTexts,
					queryResidualUniqueBigrams: group.queryResidualUniqueBigrams,
				})),
				hideWeaklyRelatedResults: request.hideWeaklyRelatedResults === true,
				maxItemResults: request.maxItemResults,
				candidateDocCount: result.recallState.candidateDocs.length,
				refinedCandidateCount: refinedCandidates.length,
				visibilityFilteredCandidateCount: visibilityFilteredCandidates.length,
				weaklyPrunedCandidateCount: weaklyPrunedCandidates.length,
				visibleCandidateCount: visibleCandidates.length,
				returnedCandidateCount: matchedFiles.length,
				refinedCandidateDetails: summarizeFileSearchDebugCandidates(refinedCandidates),
				visibilityFilteredOutPaths: collectFilteredCandidatePaths(
					refinedCandidates,
					visibilityFilteredCandidates,
				),
				weaklyPrunedOutPaths: collectFilteredCandidatePaths(
					visibilityFilteredCandidates,
					weaklyPrunedCandidates,
				),
				visibleCandidateDetails: summarizeFileSearchDebugCandidates(visibleCandidates),
				returnedPaths: matchedFiles.map((file) => file.path),
				phaseMs: {
					tokenize: roundDebugMs(tokenizeMs),
					prepare: roundDebugMs(prepareMs),
					evidenceHydrate: roundDebugMs(hydrateMs),
					rank: roundDebugMs(rankMs),
					hanRefine: roundDebugMs(refineMs),
					prune: roundDebugMs(pruneMs),
					visible: roundDebugMs(visibleMs),
					materialize: roundDebugMs(materializeMs),
					total: roundDebugMs(nowDebugMs() - startedAtMs),
				},
			});
		}
		return matchedFiles;
	}

	getIndexedDocumentCount(): number {
		return this.documentViewsByPath.size;
	}

	async getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemResults: number,
	): Promise<FileSubItem[] | null> {
		await this.awaitPendingResidentRebuild();
		if (!this.documentViewsByPath.has(path)) {
			return null;
		}
		const trimmedQuery = queryText.trim();
		if (trimmedQuery.length === 0) {
			return null;
		}
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(trimmedQuery);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const tokenizeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const searchTerms = this.getQueryTerms(trimmedQuery);
		const tokenizeMs = shouldLogDebug ? nowDebugMs() - tokenizeStartedAtMs : 0;
		const fuzzyRescueIndex = await this.hydrateFuzzyRescueForQuery(
			trimmedQuery,
			searchTerms,
			true,
		);
		const prepareStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const preparedSearch = this.engine.prepareSearch(trimmedQuery, searchTerms, {
			maxItemResults: this.outerSetting.ui.maxItemResults,
		}, fuzzyRescueIndex);
		const prepareMs = shouldLogDebug ? nowDebugMs() - prepareStartedAtMs : 0;
		const hydrateStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const { hydratedEvidenceByCandidateKey } =
			await this.hydrateRankingEvidenceForCandidates(preparedSearch);
		const hydrateMs = shouldLogDebug ? nowDebugMs() - hydrateStartedAtMs : 0;
		const rankStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const result = this.engine.rankPreparedSearch(
			preparedSearch,
			hydratedEvidenceByCandidateKey,
		);
		const rankMs = shouldLogDebug ? nowDebugMs() - rankStartedAtMs : 0;
		const shouldRefineHan = shouldRunHanSurfaceRefine(result);
		const refineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const refinedCandidates = shouldRefineHan
			? await this.refineHanSurfaceCompletion(result, hydratedEvidenceByCandidateKey)
			: result.rankedCandidates;
		const refineMs = shouldLogDebug ? nowDebugMs() - refineStartedAtMs : 0;
		const candidate = refinedCandidates.find((item) => item.path === path);
		if (candidate == null) {
			if (shouldLogDebug) {
				logCoverageLexicalV3Debug("file-search-engine.getDirectSubItems", {
					queryText: trimmedQuery,
					path,
					searchTerms,
					maxSubItemResults,
					foundCandidate: false,
					phaseMs: {
						tokenize: roundDebugMs(tokenizeMs),
						prepare: roundDebugMs(prepareMs),
						evidenceHydrate: roundDebugMs(hydrateMs),
						rank: roundDebugMs(rankMs),
						hanRefine: roundDebugMs(refineMs),
						total: roundDebugMs(nowDebugMs() - startedAtMs),
					},
				});
			}
			return null;
		}
		const candidateKeyByProfileKey = buildCandidateKeyByProfileKey(
			this.engine.getResidentIndexView()?.shards ?? [],
			result.recallState.candidateDocs,
		);
		const candidateRecallByCandidateKey = new Map<string, V3CandidateDocRecall>(
			result.recallState.candidateDocs.map((item) => [
				buildCandidateHydrationKey(item),
				item,
			]),
		);
		const candidateRecall = candidateRecallByCandidateKey.get(
			findCandidateKeyForProfile(candidateKeyByProfileKey, candidate),
		);
		if (candidateRecall == null) {
			if (shouldLogDebug) {
				logCoverageLexicalV3Debug("file-search-engine.getDirectSubItems", {
					queryText: trimmedQuery,
					path,
					searchTerms,
					maxSubItemResults,
					foundCandidate: true,
					foundCandidateRecall: false,
					phaseMs: {
						tokenize: roundDebugMs(tokenizeMs),
						prepare: roundDebugMs(prepareMs),
						evidenceHydrate: roundDebugMs(hydrateMs),
						rank: roundDebugMs(rankMs),
						hanRefine: roundDebugMs(refineMs),
						total: roundDebugMs(nowDebugMs() - startedAtMs),
					},
				});
			}
			return null;
		}
		const residentBase = findResidentBaseForCandidate(
			this.engine.getResidentIndexView()?.shards ?? [],
			candidateRecall,
		);
		if (residentBase == null) {
			return null;
		}
		const snapshotStore = this.getFileSnapshotStore();
		const snapshotReadStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const expectedGeneration = getLiveDocGeneration(
			residentBase,
			getLiveDocSlot(residentBase, candidate.docId),
		);
		let snapshotText = (
			await this.getFileSnapshotStore().readIndexedTexts([
				{
					path,
					generation: expectedGeneration,
				},
			])
		).get(path);
		const snapshotAvailability = shouldLogDebug
			? await snapshotStore.inspectIndexedTextAvailability(path, expectedGeneration)
			: null;
		let candidateRangeMode: "resident_locality" | "whole_document" =
			"resident_locality";
		if (snapshotText == null) {
			snapshotText = (await snapshotStore.readCurrentTexts([path])).get(path);
			candidateRangeMode = "whole_document";
		}
		const snapshotReadMs = shouldLogDebug ? nowDebugMs() - snapshotReadStartedAtMs : 0;
		if (snapshotText == null) {
			if (shouldLogDebug) {
				logCoverageLexicalV3Debug("file-search-engine.getDirectSubItems", {
					queryText: trimmedQuery,
					path,
					searchTerms,
					maxSubItemResults,
					foundCandidate: true,
					foundCandidateRecall: true,
					snapshotReady: false,
					snapshotAvailability,
					phaseMs: {
						tokenize: roundDebugMs(tokenizeMs),
						prepare: roundDebugMs(prepareMs),
						evidenceHydrate: roundDebugMs(hydrateMs),
						rank: roundDebugMs(rankMs),
						hanRefine: roundDebugMs(refineMs),
						snapshotRead: roundDebugMs(snapshotReadMs),
						total: roundDebugMs(nowDebugMs() - startedAtMs),
					},
				});
			}
			return null;
		}
		const buildStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const subItems = buildV3DirectSubitems({
			snapshotText,
			queryAnalysis: result.recallState.queryAnalysis,
			candidate,
			candidateRecall,
			residentBase,
			maxSubItemResults,
			candidateRangeMode,
			hideWeaklyRelatedResults: this.outerSetting.hideWeaklyRelatedResults,
		}).subItems.slice(0, maxSubItemResults);
		const buildMs = shouldLogDebug ? nowDebugMs() - buildStartedAtMs : 0;
		if (shouldLogDebug) {
			logCoverageLexicalV3Debug("file-search-engine.getDirectSubItems", {
				queryText: trimmedQuery,
				path,
				searchTerms,
				maxSubItemResults,
				foundCandidate: true,
				foundCandidateRecall: true,
				snapshotReady: true,
				candidateRangeMode,
				snapshotAvailability,
					subItemCount: subItems.length,
					phaseMs: {
						tokenize: roundDebugMs(tokenizeMs),
						prepare: roundDebugMs(prepareMs),
						evidenceHydrate: roundDebugMs(hydrateMs),
						rank: roundDebugMs(rankMs),
						hanRefine: roundDebugMs(refineMs),
						snapshotRead: roundDebugMs(snapshotReadMs),
						build: roundDebugMs(buildMs),
					total: roundDebugMs(nowDebugMs() - startedAtMs),
				},
			});
		}
		return subItems;
	}

	serialize(): SerializedFileSearchIndex | null {
		return null;
	}

	estimateIndexBytes(): number {
		return (
			this.engine
				.getResidentIndexView()
				?.shards.reduce((sum, shard) => sum + shard.base.metrics.residentBytes, 0) ?? 0
		);
	}

	getIndexBreakdown(): CoverageLexicalV3RuntimeMemoryBreakdown | null {
		const indexSummary = this.engine.describeResidentIndexView();
		const largestShard = this.engine
			.getResidentIndexView()
			?.shards.reduce<ResidentShard | null>(
				(largest, shard) =>
					largest == null || shard.base.metrics.residentBytes > largest.base.metrics.residentBytes
						? shard
						: largest,
				null,
			);
		if (largestShard == null || indexSummary == null) {
			return null;
		}
		return {
			__backend: "coverage-lexical-v3",
			metrics: {
				...largestShard.base.metrics,
				residentBytes: indexSummary.residentBytes,
			},
			summary: describeResidentBase(largestShard.base),
			indexSummary,
		};
	}

	getLastRebuildStats(): CoverageLexicalV3LastRebuildStats | null {
		return this.lastRebuildStats;
	}

	getLastMaintenanceStats(): CoverageLexicalV3LastMaintenanceStats | null {
		return this.lastMaintenanceStats;
	}

	supportsPersistentFileIndex(): boolean {
		return true;
	}

	async restorePersistedFileIndex(): Promise<boolean> {
		const persistentStores = this.getPersistentStores();
		const restoredEngine = new CoverageLexicalV3Engine();
		if (this.benchmarkPhaseTimingState != null) {
			restoredEngine.setBenchmarkPhaseTrackingEnabled(true);
		}
		const result = await bootstrapCoverageLexicalV3Engine({
			engine: restoredEngine,
			stores: persistentStores.productionStores,
			residentShardArtifactLoader: persistentStores.artifactStore,
			snapshotStore: persistentStores.snapshotStore,
			overlayJournalStore: persistentStores.overlayJournalStore,
			tokenizeDocumentText: (text) => this.getDocumentTerms(text),
		});
		if (!result.loaded) {
			return false;
		}
		this.engine = restoredEngine;
		this.documentViewsByPath.clear();
		this.pendingDocumentContentsByPath.clear();
		this.pendingDocumentMetadataByPath.clear();
		this.loadDocumentViewsFromResidentIndex();
		const activeShard = this.getActiveBaseShardDescriptor();
		if (activeShard != null) {
			await this.reloadOverlayRuntimeState(persistentStores, activeShard);
		}
		return this.documentViewsByPath.size > 0;
	}

	async planPersistentRecovery(
		currentIndexedRefs: readonly BaseIndexedFileRef[],
	): Promise<PersistentFileIndexRecoveryPlan> {
		if (this.engine.getResidentIndexView() == null) {
			return emptyPersistentRecoveryPlan("needs_full_rebuild", "missing_snapshot");
		}
		const restoredByPath = new Map(this.documentViewsByPath);
		const restoredByDocRef = new Map<number, IndexedDocumentView>();
		for (const view of restoredByPath.values()) {
			if (view.docRef !== undefined) {
				restoredByDocRef.set(view.docRef, view);
			}
		}
		const currentByPath = new Map(currentIndexedRefs.map((ref) => [ref.path, ref]));
		const currentPathSet = new Set(currentByPath.keys());
		const docsToAdd: string[] = [];
		const docsToUpdate: string[] = [];
		const docsToMove: Array<{ oldPath: string; newPath: string }> = [];
		const movedOldPaths = new Set<string>();

		for (const current of currentIndexedRefs) {
			const restored = restoredByPath.get(current.path);
			if (restored != null) {
				if (
					restored.generation !== current.generation ||
					(restored.docRef !== undefined &&
						current.docRef !== undefined &&
						restored.docRef !== current.docRef)
				) {
					docsToUpdate.push(current.path);
				}
				continue;
			}
			const movedFrom =
				current.docRef === undefined ? undefined : restoredByDocRef.get(current.docRef);
			if (movedFrom != null && movedFrom.path !== current.path) {
				docsToMove.push({ oldPath: movedFrom.path, newPath: current.path });
				movedOldPaths.add(movedFrom.path);
				continue;
			}
			docsToAdd.push(current.path);
		}

		const docsToDelete = [...restoredByPath.keys()].filter(
			(path) => !currentPathSet.has(path) && !movedOldPaths.has(path),
		);
		const hasChanges =
			docsToAdd.length > 0 ||
			docsToUpdate.length > 0 ||
			docsToMove.length > 0 ||
			docsToDelete.length > 0;
		return {
			status: hasChanges ? "needs_heal" : "up_to_date",
			reason: hasChanges ? "vault_drift" : "up_to_date",
			docsToDelete,
			docsToAdd,
			docsToUpdate,
			docsToMove,
		};
	}

	async applyPersistentRecoveryChanges(
		changes: PersistentFileIndexRecoveryChanges,
	): Promise<boolean> {
		if (
			changes.deletePaths.length === 0 &&
			changes.upsertDocuments.length === 0
		) {
			return true;
		}
		const applied = await this.applyOverlayRecoveryChanges(changes);
		if (!applied) {
			for (const path of changes.deletePaths) {
				this.pendingDocumentContentsByPath.delete(path);
				this.pendingDocumentMetadataByPath.delete(path);
				this.documentViewsByPath.delete(path);
			}
			for (const document of changes.upsertDocuments) {
				this.storeIndexedDocument(document);
			}
			await this.rebuildResidentBase();
		}
		return true;
	}

	private async applyOverlayRecoveryChanges(
		changes: PersistentFileIndexRecoveryChanges,
	): Promise<boolean> {
		const activeShard = this.getActiveBaseShardDescriptor();
		if (activeShard == null) {
			return false;
		}
		const previousVersionByPath = this.collectCurrentDocumentVersionsByPath();
		const overlayChanges = [
			...changes.deletePaths.flatMap((path) => {
				const previousVersion = previousVersionByPath.get(path);
				return previousVersion == null
					? []
					: [
							{
								document: {
									path,
									basename: basenameOfPath(path),
									folder: folderOfPath(path),
									docRef: previousVersion.docRef,
									generation: previousVersion.docGeneration,
								},
								deleted: true,
								previousVersion,
							},
					  ];
			}),
			...changes.upsertDocuments.map((document) => {
				const previousVersion =
					previousVersionByPath.get(document.path) ??
					(document.docRef == null
						? null
						: this.findCurrentDocumentVersionByDocRef(document.docRef));
				return {
					document,
					previousVersion,
				};
			}),
		];
		if (overlayChanges.length === 0) {
			return true;
		}
		const persistentStores = this.getPersistentStores();
		const sequenceStart =
			(await this.getNextOverlaySequence(persistentStores.overlayJournalStore, activeShard));
		await writeActiveOverlayChanges({
			stores: persistentStores.productionStores,
			overlayJournalStore: persistentStores.overlayJournalStore,
			activeShard,
			changes: overlayChanges,
			sequenceStart,
		});
		await this.reloadOverlayRuntimeState(persistentStores, activeShard);
		for (const path of changes.deletePaths) {
			this.pendingDocumentContentsByPath.delete(path);
			this.pendingDocumentMetadataByPath.delete(path);
			this.documentViewsByPath.delete(path);
		}
		for (const document of changes.upsertDocuments) {
			this.storeIndexedDocument(document);
		}
		return true;
	}

	private async getNextOverlaySequence(
		overlayJournalStore: ActiveOverlayJournalStore,
		activeShard: ResidentShardDescriptor,
	): Promise<number> {
		const entries = await overlayJournalStore.loadActiveOverlayEntries({
			activeShardId: activeShard.shardId,
			activeShardGeneration: activeShard.generation,
		});
		return entries.reduce((max, entry) => Math.max(max, entry.sequence), 0) + 1;
	}

	private async reloadOverlayRuntimeState(
		persistentStores: CoverageLexicalV3PersistentStores,
		activeShard: ResidentShardDescriptor,
	): Promise<void> {
		this.engine.loadShardInvalidations(
			await persistentStores.productionStores.invalidations.loadInvalidations(),
		);
		const entries = await persistentStores.overlayJournalStore.loadActiveOverlayEntries({
			activeShardId: activeShard.shardId,
			activeShardGeneration: activeShard.generation,
		});
		const overlayArtifacts = buildOverlayResidentArtifacts({
			activeShardId: activeShard.shardId,
			activeShardGeneration: activeShard.generation,
			entries,
			tokenizeDocumentText: (text) => this.getDocumentTerms(text),
		});
		const snapshotStore = this.getFileSnapshotStore();
		await Promise.all([
			overlayArtifacts.bodyEvidenceRows.length > 0
				? snapshotStore.publishLexicalBodyEvidence?.(
						overlayArtifacts.bodyEvidenceRows,
					) ?? Promise.resolve()
				: Promise.resolve(),
			overlayArtifacts.hanDocEvidenceRows.length > 0
				? snapshotStore.publishLexicalHanDocEvidence?.(
						overlayArtifacts.hanDocEvidenceRows,
					) ?? Promise.resolve()
				: Promise.resolve(),
			overlayArtifacts.hanBodyEvidenceRows.length > 0
				? snapshotStore.publishLexicalHanBodyEvidence?.(
						overlayArtifacts.hanBodyEvidenceRows,
					) ?? Promise.resolve()
				: Promise.resolve(),
		]);
		this.engine.loadOverlayResidentShard(overlayArtifacts.shard);
	}

	private getActiveBaseShardDescriptor(): ResidentShardDescriptor | null {
		const indexView = this.engine.getResidentIndexView();
		if (indexView == null) {
			return null;
		}
		const registryActive = indexView.shardRegistry
			?.filter((descriptor) => isReadableShardState(descriptor.state))
			.find((descriptor) => descriptor.state === "active");
		if (registryActive != null) {
			return registryActive;
		}
		const baseShards = indexView.shards.filter(
			(shard) => !shard.shardId.endsWith(":overlay"),
		);
		const activeShard = baseShards[baseShards.length - 1];
		if (activeShard == null) {
			return null;
		}
		const descriptors = buildShardDescriptorsForIndexView(baseShards);
		return (
			descriptors.find((descriptor) => descriptor.shardId === activeShard.shardId) ??
			null
		);
	}

	private collectCurrentDocumentVersionsByPath(): Map<string, CurrentDocumentVersion> {
		const indexView = this.engine.getResidentIndexView();
		const versionsByPath = new Map<string, CurrentDocumentVersion>();
		if (indexView == null) {
			return versionsByPath;
		}
		for (const shard of indexView.shards) {
			const shardKey = {
				shardId: shard.shardId,
				shardGeneration: shard.generation,
			};
			for (let docId = 0; docId < shard.base.docTable.docCount; docId += 1) {
				const path = getDocPath(shard.base, docId);
				if (path.length === 0) {
					continue;
				}
				const docRef = shard.base.docTable.docRefsByDocId[docId];
				const docGeneration = shard.base.docTable.generationByDocId[docId];
				if (!Number.isFinite(docRef) || docRef <= 0) {
					continue;
				}
				versionsByPath.set(path, {
					...shardKey,
					path,
					docRef,
					docGeneration: Number.isFinite(docGeneration) ? docGeneration : 0,
				});
			}
		}
		return versionsByPath;
	}

	private findCurrentDocumentVersionByDocRef(
		docRef: number,
	): CurrentDocumentVersion | null {
		for (const version of this.collectCurrentDocumentVersionsByPath().values()) {
			if (version.docRef === docRef) {
				return version;
			}
		}
		return null;
	}

	async persistFileIndexArtifact(): Promise<void> {
		const indexView = this.engine.getResidentIndexView();
		if (indexView == null || indexView.shards.length === 0) {
			await this.clearPersistedFileIndexArtifact();
			return;
		}
		const persistentStores = this.getPersistentStores();
		const descriptors = buildShardDescriptorsForIndexView(
			indexView.shards,
			indexView.shardRegistry,
		);
		for (const shard of indexView.shards.filter((item) => !item.shardId.endsWith(":overlay"))) {
			const descriptor = descriptors.find(
				(item) => item.shardId === shard.shardId && item.generation === shard.generation,
			);
			if (descriptor == null) {
				continue;
			}
			await persistentStores.artifactStore.publishResidentShardArtifact({
				descriptor,
				shard,
				createdAt: Date.now(),
			});
		}
		await persistentStores.productionStores.shardRegistry.saveRegistry(descriptors);
		await writeCoverageLexicalV3Snapshot({
			snapshotStore: persistentStores.snapshotStore,
			stores: persistentStores.productionStores,
			overlayJournalStore: persistentStores.overlayJournalStore,
		});
		await healCoverageLexicalV3SnapshotState({
			snapshotStore: persistentStores.snapshotStore,
		});
		await this.runPostSnapshotMaintenance(persistentStores);
	}

	private async runPostSnapshotMaintenance(
		persistentStores: CoverageLexicalV3PersistentStores,
	): Promise<void> {
		if (
			persistentStores.storageGcTables == null &&
			persistentStores.compactJobStore == null &&
			persistentStores.compactTempArtifactStore == null
		) {
			this.lastMaintenanceStats = {
				stateChanged: false,
				gcMs: 0,
				orphanArtifactRowsRemoved: 0,
				overlayEntriesRemoved: 0,
				invalidationsRemoved: 0,
				compactTempArtifactsRemoved: 0,
				foldMs: 0,
				compactMs: 0,
				compactJobsHealed: 0,
				compactJobsStarted: 0,
				snapshotManifestsRemoved: 0,
				coldEvidenceRowsRemoved: 0,
			};
			return;
		}
		const coldEvidencePublisher = this.getColdEvidencePublisher();
		const maintenanceResult = await runCoverageLexicalV3Maintenance({
			stores: persistentStores.productionStores,
			residentShardArtifactStore: persistentStores.artifactStore,
			overlayJournalStore: persistentStores.overlayJournalStore,
			compactJobStore: persistentStores.compactJobStore,
			compactTempArtifactStore: persistentStores.compactTempArtifactStore,
			indexedSnapshotReader: this.getFileSnapshotStore(),
			coldEvidencePublisher,
			tokenizeDocumentText: (text) => this.getDocumentTerms(text),
		});
		let snapshotManifestsRemoved = 0;
		let coldEvidenceRowsRemoved = 0;
		let gcResult: CoverageLexicalV3StorageGcResult | null = null;
		if (maintenanceResult.stateChanged) {
			await writeCoverageLexicalV3Snapshot({
				snapshotStore: persistentStores.snapshotStore,
				stores: persistentStores.productionStores,
				overlayJournalStore: persistentStores.overlayJournalStore,
			});
			await healCoverageLexicalV3SnapshotState({
				snapshotStore: persistentStores.snapshotStore,
			});
		}
		if (persistentStores.storageGcTables != null) {
			gcResult = await runCoverageLexicalV3StorageGc({
				tables: persistentStores.storageGcTables,
				maxRowsToDelete: 256,
			});
			snapshotManifestsRemoved = gcResult.snapshotManifestsRemoved;
			coldEvidenceRowsRemoved = gcResult.coldEvidenceRowsRemoved;
		}
		this.lastMaintenanceStats = {
			...maintenanceResult,
			gcMs: gcResult?.gcMs ?? maintenanceResult.gcMs,
			orphanArtifactRowsRemoved:
				gcResult?.orphanArtifactRowsRemoved ??
				maintenanceResult.orphanArtifactRowsRemoved,
			overlayEntriesRemoved:
				gcResult?.overlayEntriesRemoved ?? maintenanceResult.overlayEntriesRemoved,
			invalidationsRemoved:
				gcResult?.invalidationsRemoved ?? maintenanceResult.invalidationsRemoved,
			compactTempArtifactsRemoved:
				gcResult?.compactTempArtifactsRemoved ??
				maintenanceResult.compactTempArtifactsRemoved,
			snapshotManifestsRemoved,
			coldEvidenceRowsRemoved,
		};
	}

	private getColdEvidencePublisher() {
		const snapshotStore = this.getFileSnapshotStore();
		return {
			publishBodyEvidence: async (rows) => {
				await snapshotStore.publishLexicalBodyEvidence?.(rows);
			},
			publishHanDocEvidence: async (rows) => {
				await snapshotStore.publishLexicalHanDocEvidence?.(rows);
			},
			publishHanBodyEvidence: async (rows) => {
				await snapshotStore.publishLexicalHanBodyEvidence?.(rows);
			},
		} satisfies NonNullable<
			Parameters<typeof runCoverageLexicalV3Maintenance>[0]["coldEvidencePublisher"]
		>;
	}

	async clearPersistedFileIndexArtifact(): Promise<void> {
		const database = this.getDatabase();
		await Promise.all([
			database.db.coverageLexicalV3ShardRegistry.clear(),
			database.db.coverageLexicalV3Invalidations.clear(),
			database.db.coverageLexicalV3ResidentShardArtifacts.clear(),
			database.db.coverageLexicalV3ActiveOverlayJournal.clear(),
			database.db.coverageLexicalV3SnapshotManifests.clear(),
			database.db.coverageLexicalV3CompactJobs.clear(),
			database.db.coverageLexicalV3CompactTempArtifacts.clear(),
		]);
	}

	beginBatchReindex(): void {
		this.batchReindexing = true;
	}

	async finishBatchReindex(): Promise<void> {
		this.batchReindexing = false;
		await this.rebuildResidentBase();
	}

	abortBatchReindex(): void {
		this.batchReindexing = false;
	}

	notifyIndexedTextsCommitted(
		files: ReadonlyArray<{
			path: string;
			generation?: number;
		}>,
	): void {
		for (const file of files) {
			const pendingContent = this.pendingDocumentContentsByPath.get(file.path);
			if (!pendingContent) {
				continue;
			}
			if (
				file.generation === undefined ||
				pendingContent.generation === undefined ||
				pendingContent.generation === file.generation
			) {
				this.pendingDocumentContentsByPath.delete(file.path);
			}
			const pendingMetadata = this.pendingDocumentMetadataByPath.get(file.path);
			if (
				pendingMetadata &&
				(file.generation === undefined ||
					pendingMetadata.generation === undefined ||
					pendingMetadata.generation === file.generation)
			) {
				this.pendingDocumentMetadataByPath.delete(file.path);
			}
		}
	}

	private async rebuildResidentBase(): Promise<void> {
		const rebuildPromise = this.rebuildResidentBaseInternal();
		this.pendingResidentRebuild = rebuildPromise;
		try {
			await rebuildPromise;
		} finally {
			if (this.pendingResidentRebuild === rebuildPromise) {
				this.pendingResidentRebuild = null;
			}
		}
	}

	private async rebuildResidentBaseInternal(): Promise<void> {
		const documents = await this.materializeIndexedDocuments();
		this.engine = new CoverageLexicalV3Engine();
		const snapshotStore = this.getFileSnapshotStore();
		const artifacts = await buildResidentHotBaseArtifactsStreaming(
			documents,
			(text) => this.getDocumentTerms(text),
			{
				publishBodyEvidence: async (rows) => {
					await snapshotStore.publishLexicalBodyEvidence?.(rows);
				},
				publishHanDocEvidence: async (rows) => {
					await snapshotStore.publishLexicalHanDocEvidence?.(rows);
				},
				publishHanBodyEvidence: async (rows) => {
					await snapshotStore.publishLexicalHanBodyEvidence?.(rows);
				},
			},
		);
		this.lastRebuildStats = {
			coldEvidenceFlushCount: artifacts.coldEvidenceFlushCount,
			maxColdEvidenceChunkSize: artifacts.maxColdEvidenceChunkSize,
			batchMaxRawTextBytes: artifacts.batchMaxRawTextBytes,
			pass1Ms: artifacts.pass1Ms,
			pass2Ms: artifacts.pass2Ms,
			mergeMs: artifacts.mergeMs,
		};
		const shard = {
			shardId: DEFAULT_RESIDENT_SHARD_ID,
			generation: DEFAULT_RESIDENT_SHARD_GENERATION,
			base: artifacts.base,
		};
		const shardRegistry = buildShardDescriptorsForIndexView([shard]);
		this.engine.loadResidentIndexView({
			version: 1,
			shards: [shard],
			shardRegistry,
		});
		this.engine.setFuzzyRescueIndex(artifacts.fuzzyRescueIndex);
		await snapshotStore.publishLexicalFuzzyRescue?.(
			artifacts.fuzzyRescueIndex,
		);
		this.engine.clearFuzzyRescueIndex();
	}

	private async hydrateRankingEvidenceForCandidates(
		preparedSearch: CoverageLexicalV3PreparedSearch,
	): Promise<HydratedRankingEvidence> {
		const residentShards = this.engine.getResidentIndexView()?.shards ?? [];
		if (residentShards.length === 0 || preparedSearch.guardedCandidateDocs.length === 0) {
			return {
				hydratedEvidenceByCandidateKey: new Map(),
			};
		}
		const needsBodyRankingEvidence = preparedSearch.guardedCandidateDocs.some(
			(candidateRecall) => candidateRecall.shortlistedBodyBlockIds.length > 0,
		);
		const needsHanRankingEvidence = shouldHydrateHanRankingEvidence(
			preparedSearch,
		);
		if (!needsBodyRankingEvidence && !needsHanRankingEvidence) {
			return {
				hydratedEvidenceByCandidateKey: new Map(),
			};
		}
		const snapshotStore = this.getFileSnapshotStore();
		const candidatesByShardKey = groupCandidateRecallsByShardKey(
			preparedSearch.guardedCandidateDocs,
		);
		const sourcesByShardKey = new Map<string, CandidateEvidenceHydrationSource | null>();
		for (const residentShard of residentShards) {
			const shardKey = buildResidentShardKey(
				residentShard.shardId,
				residentShard.generation,
			);
			const shardCandidates = candidatesByShardKey.get(shardKey) ?? [];
			if (shardCandidates.length === 0) {
				continue;
			}
			const residentBase = residentShard.base;
			const shortlistedBodyBlockIds = needsBodyRankingEvidence
				? collectCandidateHydrationBlockIds(residentBase, shardCandidates)
				: [];
			const shortlistedBodyEvidenceLocators = needsBodyRankingEvidence
				? collectShortlistedBodyEvidenceLocators(
						residentBase,
						residentShard,
						shortlistedBodyBlockIds,
					)
				: [];
			const hanDocCandidateRecalls = needsHanRankingEvidence
				? shardCandidates.filter(needsHanDocEvidenceForCandidate)
				: [];
			const hanBodyCandidateRecalls = needsHanRankingEvidence
				? shardCandidates.filter(needsHanBodyEvidenceForCandidate)
				: [];
			const hanShortlistedBodyBlockIds =
				needsHanRankingEvidence && hanBodyCandidateRecalls.length > 0
					? collectCandidateHydrationBlockIds(
							residentBase,
							hanBodyCandidateRecalls,
						)
					: [];
			const hanShortlistedBodyEvidenceLocators =
				needsHanRankingEvidence && hanShortlistedBodyBlockIds.length > 0
					? collectShortlistedBodyEvidenceLocators(
							residentBase,
							residentShard,
							hanShortlistedBodyBlockIds,
						)
					: [];
			const candidateDocEvidenceLocators =
				needsHanRankingEvidence && hanDocCandidateRecalls.length > 0
					? collectCandidateDocEvidenceLocators(
							residentBase,
							residentShard,
							hanDocCandidateRecalls,
						)
					: [];
		const bodyEvidenceReadPromise =
			needsBodyRankingEvidence && shortlistedBodyEvidenceLocators.length > 0
				? snapshotStore.readLexicalBodyEvidenceForBlocks?.(
						shortlistedBodyEvidenceLocators.map((request) => request.locator),
					) ?? Promise.resolve(null)
				: Promise.resolve(null);
		const docHanEvidenceReadPromise =
			candidateDocEvidenceLocators.length > 0
				? snapshotStore.readLexicalHanDocEvidenceForDocs?.(
						candidateDocEvidenceLocators.map((request) => request.locator),
					) ?? Promise.resolve(null)
				: Promise.resolve(null);
		const bodyHanEvidenceReadPromise =
			hanShortlistedBodyEvidenceLocators.length > 0
				? snapshotStore.readLexicalHanBodyEvidenceForBlocks?.(
						hanShortlistedBodyEvidenceLocators.map((request) => request.locator),
					) ?? Promise.resolve(null)
				: Promise.resolve(null);
		const [
			persistedBodyEvidenceByRowId,
			persistedDocHanEvidenceByRowId,
			persistedBodyHanEvidenceByRowId,
		] = await Promise.all([
			bodyEvidenceReadPromise,
			docHanEvidenceReadPromise,
			bodyHanEvidenceReadPromise,
		]);
		const bodyEvidenceByBlockId =
			materializePersistedBlockEvidenceByBlockId(
				shortlistedBodyEvidenceLocators,
				persistedBodyEvidenceByRowId,
			);
		const docHanEvidenceByCandidateKey =
			materializePersistedDocEvidenceByCandidateKey(
				candidateDocEvidenceLocators,
				persistedDocHanEvidenceByRowId,
			);
		const bodyHanEvidenceByBlockId =
			materializePersistedBlockEvidenceByBlockId(
				hanShortlistedBodyEvidenceLocators,
				persistedBodyHanEvidenceByRowId,
			);
			sourcesByShardKey.set(shardKey, {
				bodyEvidenceByBlockId,
				docHanEvidenceByCandidateKey,
				bodyHanEvidenceByBlockId,
			});
		}
		return {
			hydratedEvidenceByCandidateKey: this.engine.hydrateCandidateEvidenceByShard(
				preparedSearch.guardedCandidateDocs,
				sourcesByShardKey,
			),
		};
	}

	private async awaitPendingResidentRebuild(): Promise<void> {
		await this.pendingResidentRebuild;
	}

	private async hydrateFuzzyRescueForQuery(
		queryText: string,
		queryTerms: readonly string[],
		allowFuzzyMatch: boolean,
	): Promise<ResidentFuzzyRescueIndex> {
		if (!allowFuzzyMatch || !shouldPotentiallyNeedFuzzyRescue(queryText)) {
			return EMPTY_RESIDENT_FUZZY_RESCUE_INDEX;
		}
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		const fuzzyLookupKeys = Array.from(
			new Set(
				queryAnalysis.primaryUnits.flatMap((queryUnit) =>
					queryUnit.text.length >= FUZZY_RESCUE_MIN_QUERY_LENGTH
						? buildFuzzyLookupKeys(queryUnit.text)
						: [],
				),
			),
		);
		if (fuzzyLookupKeys.length === 0) {
			return EMPTY_RESIDENT_FUZZY_RESCUE_INDEX;
		}
		const snapshotStore = this.getFileSnapshotStore();
		if (typeof snapshotStore.readLexicalFuzzyRescueForLookupKeys === "function") {
			return (
				(await snapshotStore.readLexicalFuzzyRescueForLookupKeys(
					fuzzyLookupKeys,
				)) ?? EMPTY_RESIDENT_FUZZY_RESCUE_INDEX
			);
		}
		return (
			(await snapshotStore.readLexicalFuzzyRescue?.()) ??
			EMPTY_RESIDENT_FUZZY_RESCUE_INDEX
		);
	}

	private async materializeIndexedDocuments(): Promise<IndexedDocument[]> {
		const views = [...this.documentViewsByPath.values()];
		if (views.length === 0) {
			return [];
		}
		const viewsNeedingSnapshot = views.filter(
			(view) => this.getPendingContentForView(view) === undefined,
		);
		const viewsNeedingMetadata = views.filter(
			(view) => this.getPendingMetadataForView(view) === undefined,
		);
		const snapshotTexts =
			viewsNeedingSnapshot.length === 0
				? new Map<string, string>()
				: await this.getFileSnapshotStore().readIndexedTexts(
						viewsNeedingSnapshot.map((view) => ({
							path: view.path,
							generation: view.generation,
						})),
					);
		const snapshotMetadata =
			viewsNeedingMetadata.length === 0
				? new Map<string, { aliasesText?: string; tagsText?: string; headingsText?: string }>()
				: await this.getFileSnapshotStore().readIndexedMetadata(
						viewsNeedingMetadata.map((view) => ({
							path: view.path,
							generation: view.generation,
						})),
					);
		return views.map((view) => {
			const snapshotText = snapshotTexts.get(view.path);
			if (snapshotText !== undefined) {
				const pendingContent = this.pendingDocumentContentsByPath.get(view.path);
				if (
					pendingContent &&
					(view.generation === undefined ||
						pendingContent.generation === undefined ||
						pendingContent.generation === view.generation)
				) {
					this.pendingDocumentContentsByPath.delete(view.path);
				}
			}
			const pendingMetadata = this.getPendingMetadataForView(view);
			const metadata =
				pendingMetadata ??
				snapshotMetadata.get(view.path) ?? {
					aliasesText: undefined,
					tagsText: undefined,
					headingsText: undefined,
				};
			if (snapshotMetadata.has(view.path) && pendingMetadata === undefined) {
				this.pendingDocumentMetadataByPath.delete(view.path);
			}
			return materializeIndexedDocument(
				view,
				snapshotText ??
					this.getPendingContentForView(view)?.text,
				metadata,
			);
		});
	}

	private getPendingContentForView(
		view: IndexedDocumentView,
	): PendingDocumentContent | undefined {
		const pendingContent = this.pendingDocumentContentsByPath.get(view.path);
		if (!pendingContent) {
			return undefined;
		}
		if (
			view.generation !== undefined &&
			pendingContent.generation !== undefined &&
			pendingContent.generation !== view.generation
		) {
			return undefined;
		}
		return pendingContent;
	}

	private getPendingMetadataForView(
		view: IndexedDocumentView,
	): PendingDocumentMetadata | undefined {
		const pendingMetadata = this.pendingDocumentMetadataByPath.get(view.path);
		if (!pendingMetadata) {
			return undefined;
		}
		if (
			view.generation !== undefined &&
			pendingMetadata.generation !== undefined &&
			pendingMetadata.generation !== view.generation
		) {
			return undefined;
		}
		return pendingMetadata;
	}

	private getFileSnapshotStore(): FileSnapshotStore {
		return container.resolve(FileSnapshotStore);
	}

	private getDatabase(): Database {
		return container.resolve(Database);
	}

	private getPersistentStores(): CoverageLexicalV3PersistentStores {
		const database = this.getDatabase();
		return {
			productionStores: createDexieCoverageLexicalV3ProductionStores({
				shardRegistry: database.db.coverageLexicalV3ShardRegistry,
				invalidations: database.db.coverageLexicalV3Invalidations,
			}),
			artifactStore: createDexieCoverageLexicalV3ResidentShardArtifactStore(
				database.db.coverageLexicalV3ResidentShardArtifacts,
			),
			overlayJournalStore: createAtomicDexieActiveOverlayJournalStore({
				overlayTable: database.db.coverageLexicalV3ActiveOverlayJournal,
				invalidationTable: database.db.coverageLexicalV3Invalidations,
				transactionScope: database.db as unknown as Parameters<
					typeof createAtomicDexieActiveOverlayJournalStore
				>[0]["transactionScope"],
			}),
			snapshotStore: createDexieCoverageLexicalV3SnapshotStore(
				database.db.coverageLexicalV3SnapshotManifests,
			),
			compactJobStore: new DexieCompactJobManifestStore(
				database.db.coverageLexicalV3CompactJobs,
			),
			compactTempArtifactStore: new DexieCompactTempArtifactStore(
				database.db.coverageLexicalV3CompactTempArtifacts,
			),
			storageGcTables: {
				residentShardArtifacts: database.db.coverageLexicalV3ResidentShardArtifacts,
				snapshotManifests: database.db.coverageLexicalV3SnapshotManifests,
				shardRegistry: database.db.coverageLexicalV3ShardRegistry,
				activeOverlayJournal: database.db.coverageLexicalV3ActiveOverlayJournal,
				invalidations: database.db.coverageLexicalV3Invalidations,
				compactJobs: database.db.coverageLexicalV3CompactJobs,
				compactTempArtifacts: database.db.coverageLexicalV3CompactTempArtifacts,
				lexicalBodyEvidence: database.db.lexicalBodyEvidence,
				lexicalHanDocEvidence: database.db.lexicalHanDocEvidence,
				lexicalHanBodyEvidence: database.db.lexicalHanBodyEvidence,
			},
		};
	}

	private loadDocumentViewsFromResidentIndex(): void {
		const indexView = this.engine.getResidentIndexView();
		if (indexView == null) {
			return;
		}
		for (const shard of indexView.shards) {
			const base = shard.base;
			for (let docId = 0; docId < base.docTable.docCount; docId += 1) {
				const path = getDocPath(base, docId);
				if (path.length === 0) {
					continue;
				}
				const docRef = base.docTable.docRefsByDocId[docId];
				const generation = base.docTable.generationByDocId[docId];
				this.documentViewsByPath.set(path, {
					docRef: Number.isFinite(docRef) && docRef > 0 ? docRef : undefined,
					path,
					generation: Number.isFinite(generation) && generation > 0 ? generation : undefined,
					basename: basenameOfPath(path),
					folder: folderOfPath(path),
				});
			}
		}
	}

	private getQueryTerms(queryText: string): string[] {
		return getInstance(Tokenizer).tokenizeSequence(queryText, "search");
	}

	private getDocumentTerms(text: string): string[] {
		return getInstance(Tokenizer).tokenizeSequence(text, "index");
	}

	private storeIndexedDocument(document: IndexedDocument): void {
		this.documentViewsByPath.set(document.path, toIndexedDocumentView(document));
		this.pendingDocumentMetadataByPath.set(document.path, {
			generation: document.generation,
			aliasesText: document.aliases ?? "",
			tagsText: document.tags ?? "",
			headingsText: document.headings ?? "",
		});
		if (typeof document.content === "string") {
			this.pendingDocumentContentsByPath.set(document.path, {
				generation: document.generation,
				text: document.content,
			});
			return;
		}
		this.pendingDocumentContentsByPath.delete(document.path);
	}

	private async refineHanSurfaceCompletion(
		result: CoverageLexicalV3SearchResult,
		hydratedEvidenceByCandidateKey: ReadonlyMap<string, CandidateEvidencePackage>,
	): Promise<readonly EvidencePackingProfile[]> {
		const candidateRecallByCandidateKey = new Map<string, V3CandidateDocRecall>(
			result.recallState.candidateDocs.map((candidate) => {
				const candidateKey = buildCandidateHydrationKey(candidate);
				return [candidateKey, candidate] as const;
			}),
		);
		const candidateKeyByProfileKey = buildCandidateKeyByProfileKey(
			this.engine.getResidentIndexView()?.shards ?? [],
			result.recallState.candidateDocs,
		);
		const refinedCandidates = new Map<string, EvidencePackingProfile>();
		for (let candidateIndex = 0; candidateIndex < result.rankedCandidates.length; candidateIndex += 1) {
			const candidate = result.rankedCandidates[candidateIndex];
			const candidateKey = findCandidateKeyForProfile(
				candidateKeyByProfileKey,
				candidate,
			);
			const candidateRecall = candidateRecallByCandidateKey.get(candidateKey);
			if (candidateRecall == null || !hasBodyTierHanCompletion(candidate)) {
				continue;
			}
			const candidateEvidence = hydratedEvidenceByCandidateKey.get(candidateKey);
			if (candidateEvidence == null) {
				continue;
			}
			if (!hasHanSurfaceRefineNearTieRisk(result.rankedCandidates, candidateIndex)) {
				continue;
			}
			const residentBase = findResidentBaseForCandidate(
				this.engine.getResidentIndexView()?.shards ?? [],
				candidateRecall,
			);
			if (residentBase == null) {
				continue;
			}
			const inspectBlockIds = prioritizeShortlistedBlockIds(
				residentBase,
				candidate,
				candidateRecall,
			);
			if (inspectBlockIds.length === 0) {
				continue;
			}
			const confirmedTierByGroupIndex = new Map<number, BodyHanCompletionTier>();
			const bestBodyWindowBlockIds = new Set(candidate.bodyWindowContainer?.blockIds ?? []);
			for (const blockId of inspectBlockIds) {
				const completionTier: BodyHanCompletionTier = bestBodyWindowBlockIds.has(blockId)
					? "body_window"
					: "body_residue";
				for (const group of candidate.hanSurfaceCompletionGroups) {
					if (!isBodyHanCompletionTier(group.tier)) {
						continue;
					}
					if (confirmedTierByGroupIndex.get(group.surfaceGroupIndex) === "body_window") {
						continue;
					}
					if (
						!confirmHanBodyBlockSurfaceFromEvidence(
							candidateEvidence,
							blockId,
							group.surfaceText,
						)
					) {
						continue;
					}
					confirmedTierByGroupIndex.set(group.surfaceGroupIndex, completionTier);
				}
			}
			if (confirmedTierByGroupIndex.size === 0) {
				continue;
			}
			const nextGroups = candidate.hanSurfaceCompletionGroups.map((group) => {
				const confirmedTier = confirmedTierByGroupIndex.get(group.surfaceGroupIndex);
				if (confirmedTier == null || !isBodyHanCompletionTier(group.tier)) {
					return group;
				}
				return {
					...group,
					tier: confirmedTier,
				};
			});
			if (!didHanCompletionGroupsChange(candidate.hanSurfaceCompletionGroups, nextGroups)) {
				continue;
			}
			const nextSummary = summarizeHanSurfaceCompletionGroups(nextGroups);
			refinedCandidates.set(candidateKey, {
				...candidate,
				completedHanSurfaceGroupCount: nextSummary.completedGroupCount,
				hanSurfaceCompletionTierScoreTotal: nextSummary.tierScoreTotal,
				strongestHanSurfaceCompletionTier: nextSummary.strongestTier,
				hanSurfaceCompletionGroups: nextGroups,
			});
		}
		return result.rankedCandidates
			.map(
				(candidate) =>
					refinedCandidates.get(
						findCandidateKeyForProfile(candidateKeyByProfileKey, candidate),
					) ??
					candidate,
			)
			.sort(comparePackingProfiles);
	}
}

function toIndexedDocumentView(document: IndexedDocument): IndexedDocumentView {
	return {
		docRef: document.docRef,
		path: document.path,
		generation: document.generation,
		size: document.size,
		basename: document.basename,
		folder: document.folder,
	};
}

function basenameOfPath(path: string): string {
	const fileName = path.split("/").pop() ?? path;
	return fileName.replace(/\.md$/iu, "");
}

function folderOfPath(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash <= 0 ? "" : path.slice(0, lastSlash);
}

function emptyPersistentRecoveryPlan(
	status: PersistentFileIndexRecoveryPlan["status"],
	reason: PersistentFileIndexRecoveryPlan["reason"],
): PersistentFileIndexRecoveryPlan {
	return {
		status,
		reason,
		docsToDelete: [],
		docsToAdd: [],
		docsToUpdate: [],
		docsToMove: [],
	};
}

function buildShardDescriptorsForIndexView(
	shards: readonly ResidentShard[],
	existingRegistry: readonly ResidentShardDescriptor[] = [],
): ResidentShardDescriptor[] {
	const baseShards = shards.filter((shard) => !shard.shardId.endsWith(":overlay"));
	return baseShards.map((shard, index) =>
		mergeExistingShardDescriptor(
			buildDefaultShardDescriptor({
				shardId: shard.shardId,
				generation: shard.generation,
				state: index === baseShards.length - 1 ? "active" : "sealed",
				sourceBytes: estimateResidentShardSourceBytes(shard.base),
				docCount: shard.base.docTable.docCount,
				createdOrder: index,
				artifactOwner: shard.shardId,
			}),
			existingRegistry,
		),
	);
}

function mergeExistingShardDescriptor(
	descriptor: ResidentShardDescriptor,
	existingRegistry: readonly ResidentShardDescriptor[],
): ResidentShardDescriptor {
	const existing = existingRegistry.find(
		(candidate) =>
			candidate.shardId === descriptor.shardId &&
			candidate.generation === descriptor.generation,
	);
	if (existing == null) {
		return descriptor;
	}
	return {
		...descriptor,
		state: existing.state,
		createdOrder: existing.createdOrder,
		artifactOwner: existing.artifactOwner,
	};
}

function estimateResidentShardSourceBytes(base: ResidentBase): number {
	let total = 0;
	for (let docId = 0; docId < base.docTable.docCount; docId += 1) {
		const path = getDocPath(base, docId);
		total += path.length;
	}
	return total;
}

function materializeIndexedDocument(
	documentView: IndexedDocumentView,
	content?: string,
	metadata?: {
		aliasesText?: string;
		tagsText?: string;
		headingsText?: string;
	},
): IndexedDocument {
	return {
		docRef: documentView.docRef,
		path: documentView.path,
		generation: documentView.generation,
		size: documentView.size,
		basename: documentView.basename,
		folder: documentView.folder,
		aliases: metadata?.aliasesText,
		tags: metadata?.tagsText,
		headings: metadata?.headingsText,
		content,
	};
}

function buildMatchedTerms(
	candidate: CoverageLexicalV3SearchResult["rankedCandidates"][number],
	result: CoverageLexicalV3SearchResult,
): string[] {
	const realizedFamilies = candidate.realizedFamilies.map((family) => family.familyText);
	if (realizedFamilies.length > 0) {
		return dedupePreservingOrder(realizedFamilies);
	}
	return dedupePreservingOrder(
		result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text),
	);
}

function hasHanSurfaceRefineNearTieRisk(
	rankedCandidates: readonly EvidencePackingProfile[],
	candidateIndex: number,
): boolean {
	const candidate = rankedCandidates[candidateIndex];
	if (candidate == null) {
		return false;
	}
	for (const adjacentIndex of [candidateIndex - 1, candidateIndex + 1]) {
		const adjacentCandidate = rankedCandidates[adjacentIndex];
		if (adjacentCandidate == null) {
			continue;
		}
		if (
			comparePackingProfilesBeforeHanSurfaceCompletion(candidate, adjacentCandidate) === 0
		) {
			return true;
		}
	}
	return false;
}

function hasBodyTierHanCompletion(candidate: EvidencePackingProfile): boolean {
	return candidate.hanSurfaceCompletionGroups.some((group) => isBodyHanCompletionTier(group.tier));
}

function isBodyHanCompletionTier(
	tier: HanSurfaceCompletionTier,
): tier is BodyHanCompletionTier {
	return tier === "body_window" || tier === "body_residue";
}

function summarizeHanSurfaceCompletionGroups(
	groups: readonly HanSurfaceCompletionGroupResult[],
): HanCompletionSummary {
	let completedGroupCount = 0;
	let tierScoreTotal = 0;
	let strongestTier: HanSurfaceCompletionTier = "none";
	for (const group of groups) {
		const tierScore = getHanSurfaceCompletionTierScore(group.tier);
		if (tierScore <= 0) {
			continue;
		}
		completedGroupCount += 1;
		tierScoreTotal += tierScore;
		if (tierScore > getHanSurfaceCompletionTierScore(strongestTier)) {
			strongestTier = group.tier;
		}
	}
	return {
		completedGroupCount,
		tierScoreTotal,
		strongestTier,
	};
}

function getHanSurfaceCompletionTierScore(tier: HanSurfaceCompletionTier): number {
	switch (tier) {
		case "identity":
			return 4;
		case "route":
			return 3;
		case "body_window":
			return 2;
		case "body_residue":
			return 1;
		default:
			return 0;
	}
}

function didHanCompletionGroupsChange(
	left: readonly HanSurfaceCompletionGroupResult[],
	right: readonly HanSurfaceCompletionGroupResult[],
): boolean {
	if (left.length !== right.length) {
		return true;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index].tier !== right[index].tier) {
			return true;
		}
	}
	return false;
}

function prioritizeShortlistedBlockIds(
	residentBase: ResidentBase,
	candidate: EvidencePackingProfile,
	candidateRecall: V3CandidateDocRecall,
): number[] {
	const shortlistedBlockIds = [...candidateRecall.shortlistedBodyBlockIds].sort((left, right) =>
		compareBlockOrder(residentBase, left, right),
	);
	const bestBodyWindowBlockIds = new Set(candidate.bodyWindowContainer?.blockIds ?? []);
	const bestBodyWindowOrdinals = new Set<number>(
		[...bestBodyWindowBlockIds].map(
			(blockId) => residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId,
		),
	);
	const adjacentChainBlockIds = new Set<number>(
		shortlistedBlockIds.filter((blockId) => {
			if (bestBodyWindowBlockIds.has(blockId)) {
				return false;
			}
			const blockOrdinal = residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId;
			return (
				bestBodyWindowOrdinals.has(blockOrdinal - 1) ||
				bestBodyWindowOrdinals.has(blockOrdinal + 1)
			);
		}),
	);
	const hanRouteBlockIds = new Set<number>(
		candidateRecall.hanBodyBlockGateStats.map((blockGate) => blockGate.blockId),
	);
	const prioritized: number[] = [];
	const seen = new Set<number>();
	for (const bucket of [bestBodyWindowBlockIds, adjacentChainBlockIds, hanRouteBlockIds]) {
		for (const blockId of shortlistedBlockIds) {
			if (!bucket.has(blockId) || seen.has(blockId)) {
				continue;
			}
			seen.add(blockId);
			prioritized.push(blockId);
		}
	}
	for (const blockId of shortlistedBlockIds) {
		if (seen.has(blockId)) {
			continue;
		}
		seen.add(blockId);
		prioritized.push(blockId);
	}
	return prioritized;
}

function confirmHanBodyBlockSurfaceFromEvidence(
	candidateEvidence: CandidateEvidencePackage,
	blockId: number,
	surfaceText: string,
): boolean {
	const blockEvidence = candidateEvidence.bodyBlockEvidenceByBlockId.get(blockId);
	if (blockEvidence == null) {
		return false;
	}
	return blockEvidence.witnessTexts.some((text) => text.includes(surfaceText));
}

function compareBlockOrder(
	residentBase: ResidentBase,
	left: number,
	right: number,
): number {
	const leftOrdinal = residentBase.bodyBlocks.blockOrdinalByBlockId[left] ?? left;
	const rightOrdinal = residentBase.bodyBlocks.blockOrdinalByBlockId[right] ?? right;
	return leftOrdinal - rightOrdinal || left - right;
}

function dedupePreservingOrder(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) {
			continue;
		}
		seen.add(value);
		output.push(value);
	}
	return output;
}

function roundDebugMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function summarizeFileSearchDebugCandidates(
	candidates: readonly EvidencePackingProfile[],
): ReadonlyArray<{
	docId: number;
	path: string;
	realizedCoverageCount: number;
	coverageGate: EvidencePackingProfile["coverageGate"];
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
	return candidates.slice(0, 12).map((candidate) => ({
		docId: candidate.docId,
		path: candidate.path,
		realizedCoverageCount: candidate.realizedCoverageCount,
		coverageGate: candidate.coverageGate,
		hasOnlyWeakHanRescue: candidate.hasOnlyWeakHanRescue,
		singletonHanCompletion: {
			matched: candidate.singletonHanCompletion.matched,
			char: candidate.singletonHanCompletion.singletonHanChar,
			charIndex: candidate.singletonHanCompletion.singletonHanCharIndex,
			surfaceGroupIndex:
				candidate.singletonHanCompletion.singletonHanSurfaceGroupIndex,
			matchSource: candidate.singletonHanCompletion.matchSource,
			bestAnchorKind: candidate.singletonHanCompletion.bestAnchorKind,
			bestAnchorDistance: candidate.singletonHanCompletion.bestAnchorDistance,
			tier: candidate.singletonHanCompletion.tier,
		},
	}));
}

function collectFilteredCandidatePaths(
	before: readonly EvidencePackingProfile[],
	after: readonly EvidencePackingProfile[],
): string[] {
	const retainedLiveDocSlots = new Set(
		after.map((candidate) => candidate.liveDocSlot),
	);
	return before
		.filter((candidate) => !retainedLiveDocSlots.has(candidate.liveDocSlot))
		.map((candidate) => candidate.path);
}

function hasHanBigramRescueSupport(candidate: EvidencePackingProfile): boolean {
	return candidate.hanRescueAssessments.some(
		(assessment) =>
			assessment.matchedBigramCount > 0 && assessment.strength !== "none",
	);
}

function filterToTopCoverageGateBand(
	candidates: readonly EvidencePackingProfile[],
): readonly EvidencePackingProfile[] {
	const strongestCoverageGate = candidates[0]?.coverageGate;
	if (strongestCoverageGate == null) {
		return candidates;
	}
	return candidates.filter((candidate) =>
		hasSameCoverageGate(candidate.coverageGate, strongestCoverageGate) ||
		hasHanBigramRescueSupport(candidate),
	);
}

function hasSameCoverageGate(
	left: EvidencePackingProfile["coverageGate"],
	right: EvidencePackingProfile["coverageGate"],
): boolean {
	return (
		left.realizedCoverageCount === right.realizedCoverageCount &&
		left.fullySatisfiedSurfaceGroupCount ===
			right.fullySatisfiedSurfaceGroupCount &&
		left.startedSurfaceGroupCount === right.startedSurfaceGroupCount &&
		left.crossScriptSatisfiedGroupCount ===
			right.crossScriptSatisfiedGroupCount
	);
}

function applyHanSurfaceCompletionDominance(
	result: CoverageLexicalV3SearchResult,
	candidates: readonly EvidencePackingProfile[],
	hideWeaklyRelatedResults: boolean,
): readonly EvidencePackingProfile[] {
	const topBand = collectLeadingCoverageGateBand(candidates);
	if (topBand.length <= 1) {
		return candidates;
	}
	const eligibleSurfaceGroupIndices = collectEligibleHanSurfaceDominanceGroupIndices(
		result,
	);
	if (eligibleSurfaceGroupIndices.length === 0) {
		return candidates;
	}
	const dominanceProfiles = new Map<number, HanSurfaceDominanceProfile>(
		topBand.map((candidate) => [
			candidate.liveDocSlot,
			buildHanSurfaceDominanceProfile(candidate, eligibleSurfaceGroupIndices),
		]),
	);
	const sortedTopBand = [...topBand].sort((left, right) => {
		const dominanceComparison = compareHanSurfaceDominanceProfiles(
			dominanceProfiles.get(left.liveDocSlot) ??
				EMPTY_HAN_SURFACE_DOMINANCE_PROFILE,
			dominanceProfiles.get(right.liveDocSlot) ??
				EMPTY_HAN_SURFACE_DOMINANCE_PROFILE,
		);
		if (dominanceComparison !== 0) {
			return dominanceComparison;
		}
		return comparePackingProfiles(left, right);
	});
	const strongestProfile =
		dominanceProfiles.get(sortedTopBand[0].liveDocSlot) ??
		EMPTY_HAN_SURFACE_DOMINANCE_PROFILE;
	const filteredTopBand =
		hideWeaklyRelatedResults && strongestProfile.completedGroupCount > 0
			? sortedTopBand.filter((candidate) =>
				(dominanceProfiles.get(candidate.liveDocSlot) ??
					EMPTY_HAN_SURFACE_DOMINANCE_PROFILE)
					.completedGroupCount > 0,
			)
			: sortedTopBand;
	if (filteredTopBand.length === topBand.length && filteredTopBand.every((candidate, index) => candidate === candidates[index])) {
		return candidates;
	}
	return [...filteredTopBand, ...candidates.slice(topBand.length)];
}

const EMPTY_HAN_SURFACE_DOMINANCE_PROFILE: HanSurfaceDominanceProfile = {
	completedGroupCount: 0,
	tierScoreTotal: 0,
};

function collectLeadingCoverageGateBand(
	candidates: readonly EvidencePackingProfile[],
): readonly EvidencePackingProfile[] {
	const strongestCoverageGate = candidates[0]?.coverageGate;
	if (strongestCoverageGate == null) {
		return [];
	}
	const topBand: EvidencePackingProfile[] = [];
	for (const candidate of candidates) {
		if (!hasSameCoverageGate(candidate.coverageGate, strongestCoverageGate)) {
			break;
		}
		topBand.push(candidate);
	}
	return topBand;
}

function collectEligibleHanSurfaceDominanceGroupIndices(
	result: CoverageLexicalV3SearchResult,
): number[] {
	const primaryUnitsBySurfaceGroupIndex = new Map<number, string[]>();
	for (const unit of result.recallState.queryAnalysis.primaryUnits) {
		if (unit.source !== "han_tokenizer_real" || unit.surfaceGroupIndex == null) {
			continue;
		}
		const existing = primaryUnitsBySurfaceGroupIndex.get(unit.surfaceGroupIndex) ?? [];
		existing.push(unit.text);
		primaryUnitsBySurfaceGroupIndex.set(unit.surfaceGroupIndex, existing);
	}
	return result.recallState.queryAnalysis.surfaceGroups
		.filter((group) => group.kind === "han")
		.filter((group) => {
			const realHanTerms = primaryUnitsBySurfaceGroupIndex.get(group.index) ?? [];
			return realHanTerms.length === 1 && Array.from(group.text).length > Array.from(realHanTerms[0]).length;
		})
		.map((group) => group.index);
}

function buildHanSurfaceDominanceProfile(
	candidate: EvidencePackingProfile,
	eligibleSurfaceGroupIndices: readonly number[],
): HanSurfaceDominanceProfile {
	const tierBySurfaceGroupIndex = new Map<number, HanSurfaceCompletionTier>(
		candidate.hanSurfaceCompletionGroups.map((group) => [group.surfaceGroupIndex, group.tier]),
	);
	let completedGroupCount = 0;
	let tierScoreTotal = 0;
	for (const surfaceGroupIndex of eligibleSurfaceGroupIndices) {
		const tier = tierBySurfaceGroupIndex.get(surfaceGroupIndex) ?? "none";
		const tierScore = getHanSurfaceCompletionTierScore(tier);
		if (tierScore <= 0) {
			continue;
		}
		completedGroupCount += 1;
		tierScoreTotal += tierScore;
	}
	return {
		completedGroupCount,
		tierScoreTotal,
	};
}

function compareHanSurfaceDominanceProfiles(
	left: HanSurfaceDominanceProfile,
	right: HanSurfaceDominanceProfile,
): number {
	if (left.completedGroupCount !== right.completedGroupCount) {
		return right.completedGroupCount - left.completedGroupCount;
	}
	if (left.tierScoreTotal !== right.tierScoreTotal) {
		return right.tierScoreTotal - left.tierScoreTotal;
	}
	return 0;
}

function shouldPotentiallyNeedFuzzyRescue(queryText: string): boolean {
	return queryText.length >= FUZZY_RESCUE_MIN_QUERY_LENGTH;
}

function shouldHydrateHanRankingEvidence(
	preparedSearch: CoverageLexicalV3PreparedSearch,
): boolean {
	const { queryAnalysis } = preparedSearch;
	return (
		queryAnalysis.querySingletonHanRecallEligible ||
		queryAnalysis.surfaceGroups.some((group) => group.kind === "han")
	);
}

function needsHanDocEvidenceForCandidate(
	candidateRecall: V3CandidateDocRecall,
): boolean {
	return (
		candidateRecall.matchedIdentityUnitIndices.length > 0 ||
		candidateRecall.matchedRouteUnitIndices.length > 0 ||
		candidateRecall.matchedHeadingUnitIndices.length > 0 ||
		candidateRecall.hasQuerySingletonHanMetadataSupport ||
		candidateRecall.hasScopedSingletonHanMetadataSupport ||
		candidateRecall.hanMetadataGateStats != null ||
		candidateRecall.hanSurfaceGroupRecalls.some(
			(groupRecall) => groupRecall.metadataGateStats != null,
		)
	);
}

function needsHanBodyEvidenceForCandidate(
	candidateRecall: V3CandidateDocRecall,
): boolean {
	return (
		candidateRecall.hanSurfaceGroupRecalls.length > 0 ||
		candidateRecall.shortlistedBodyBlocks.some(
			(bodyBlock) =>
				bodyBlock.hasStrongHanSupport ||
				bodyBlock.hasSingletonHanSupport ||
				bodyBlock.hasScopedSingletonHanSupport,
		)
	);
}

function collectCandidateHydrationBlockIds(
	residentBase: ResidentBase,
	candidateRecalls: readonly V3CandidateDocRecall[],
): number[] {
	const seen = new Set<number>();
	const blockIds: number[] = [];
	for (const candidateRecall of candidateRecalls) {
		for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
			for (const scopedBlockId of [blockId - 1, blockId, blockId + 1]) {
				if (
					scopedBlockId < 0 ||
					getLiveDocSlotForBlockId(residentBase, scopedBlockId) !==
						candidateRecall.liveDocSlot ||
					seen.has(scopedBlockId)
				) {
					continue;
				}
				seen.add(scopedBlockId);
				blockIds.push(scopedBlockId);
			}
		}
	}
	return blockIds;
}

function buildResidentShardKey(shardId: string, generation: number): string {
	return `${shardId}@${generation}`;
}

function findResidentBaseForCandidate(
	residentShards: readonly ResidentShard[],
	candidateRecall: Pick<V3CandidateDocRecall, "shardId" | "shardGeneration">,
): ResidentBase | null {
	return (
		residentShards.find(
			(shard) =>
				shard.shardId === candidateRecall.shardId &&
				shard.generation === candidateRecall.shardGeneration,
		)?.base ?? null
	);
}

function groupCandidateRecallsByShardKey(
	candidateRecalls: readonly V3CandidateDocRecall[],
): Map<string, V3CandidateDocRecall[]> {
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
	return candidateRecallsByShardKey;
}

function buildCandidateKeyByProfileKey(
	residentShards: readonly ResidentShard[],
	candidateRecalls: readonly V3CandidateDocRecall[],
): Map<string, string> {
	const candidateKeyByProfileKey = new Map<string, string>();
	for (const candidateRecall of candidateRecalls) {
		const residentBase = findResidentBaseForCandidate(residentShards, candidateRecall);
		if (residentBase == null) {
			continue;
		}
		const candidateKey = buildCandidateHydrationKey(candidateRecall);
		candidateKeyByProfileKey.set(
			buildCandidateProfileKey({
				path: getLiveDocPath(residentBase, candidateRecall.liveDocSlot),
				stableKey: getLiveDocStableKey(residentBase, candidateRecall.liveDocSlot),
				liveDocSlot: candidateRecall.liveDocSlot,
			}),
			candidateKey,
		);
	}
	return candidateKeyByProfileKey;
}

function findCandidateKeyForProfile(
	candidateKeyByProfileKey: ReadonlyMap<string, string>,
	candidate: Pick<EvidencePackingProfile, "liveDocSlot" | "stableKey" | "path">,
): string {
	return candidateKeyByProfileKey.get(buildCandidateProfileKey(candidate)) ?? "";
}

function buildCandidateProfileKey(
	candidate: Pick<EvidencePackingProfile, "liveDocSlot" | "stableKey" | "path">,
): string {
	return `${candidate.stableKey}\0${candidate.path}\0${candidate.liveDocSlot}`;
}

function collectShortlistedBodyEvidenceLocators(
	residentBase: ResidentBase,
	residentShard: ResidentShard,
	blockIds: readonly number[],
): CollectedLexicalBlockEvidenceRequest[] {
	const requests: CollectedLexicalBlockEvidenceRequest[] = [];
	for (const blockId of blockIds) {
		const cached = getCachedLexicalBlockEvidenceLocatorEntry(
			residentBase,
			residentShard,
			blockId,
		);
		if (cached == null) {
			continue;
		}
		requests.push({
			shardId: cached.shardId,
			shardGeneration: cached.shardGeneration,
			blockId,
			locator: cached.locator,
			rowId: cached.rowId,
		});
	}
	return requests;
}

function collectCandidateDocEvidenceLocators(
	residentBase: ResidentBase,
	residentShard: ResidentShard,
	candidateRecalls: readonly V3CandidateDocRecall[],
): CollectedLexicalDocEvidenceRequest[] {
	const requests: CollectedLexicalDocEvidenceRequest[] = [];
	for (const candidateRecall of candidateRecalls) {
		if (
			candidateRecall.shardId !== residentShard.shardId ||
			candidateRecall.shardGeneration !== residentShard.generation
		) {
			continue;
		}
		const cached = getCachedLexicalDocEvidenceLocatorEntry(
			residentBase,
			residentShard,
			candidateRecall.liveDocSlot,
		);
		if (cached == null) {
			continue;
		}
		requests.push({
			shardId: cached.shardId,
			shardGeneration: cached.shardGeneration,
			liveDocSlot: candidateRecall.liveDocSlot,
			locator: cached.locator,
			rowId: cached.rowId,
		});
	}
	return requests;
}

function materializePersistedBlockEvidenceByBlockId<T>(
	requests: readonly CollectedLexicalBlockEvidenceRequest[],
	persistedByRowId: ReadonlyMap<string, T> | null,
): ReadonlyMap<number, T> | null {
	if (persistedByRowId == null) {
		return null;
	}
	const evidenceByBlockId = new Map<number, T>();
	for (const request of requests) {
		const evidence = persistedByRowId.get(request.rowId);
		if (evidence != null) {
			evidenceByBlockId.set(request.blockId, evidence);
		}
	}
	return evidenceByBlockId;
}

function materializePersistedDocEvidenceByCandidateKey<T>(
	requests: readonly CollectedLexicalDocEvidenceRequest[],
	persistedByRowId: ReadonlyMap<string, T> | null,
): ReadonlyMap<string, T> | null {
	if (persistedByRowId == null) {
		return null;
	}
	const evidenceByCandidateKey = new Map<string, T>();
	for (const request of requests) {
		const evidence = persistedByRowId.get(request.rowId);
		if (evidence != null) {
			evidenceByCandidateKey.set(
				`${request.shardId}:${request.shardGeneration}:${request.liveDocSlot}`,
				evidence,
			);
		}
	}
	return evidenceByCandidateKey;
}

function buildLexicalDocEvidenceLocatorForLiveDocSlot(
	residentBase: ResidentBase,
	residentShard: ResidentShard,
	liveDocSlot: number,
): LexicalDocEvidenceLocator | null {
	const docRef = getLiveDocRef(residentBase, liveDocSlot);
	if (docRef == null) {
		return null;
	}
	return {
		shardId: residentShard.shardId,
		shardGeneration: residentShard.generation,
		docRef,
		generation: getLiveDocGeneration(residentBase, liveDocSlot),
	};
}

function getCachedLexicalDocEvidenceLocatorEntry(
	residentBase: ResidentBase,
	residentShard: ResidentShard,
	liveDocSlot: number,
): CachedLexicalDocEvidenceLocatorEntry | null {
	let cache = DOC_EVIDENCE_LOCATOR_CACHE.get(residentBase);
	if (cache == null) {
		cache = new Map<number, CachedLexicalDocEvidenceLocatorEntry | null>();
		DOC_EVIDENCE_LOCATOR_CACHE.set(residentBase, cache);
	}
	const existing = cache.get(liveDocSlot);
	if (existing !== undefined) {
		return existing;
	}
	const locator = buildLexicalDocEvidenceLocatorForLiveDocSlot(
		residentBase,
		residentShard,
		liveDocSlot,
	);
	const created =
		locator == null
			? null
			: {
					shardId: locator.shardId,
					shardGeneration: locator.shardGeneration,
					locator,
					rowId: buildLexicalDocEvidenceRowId(locator),
				};
	cache.set(liveDocSlot, created);
	return created;
}

function buildLexicalBlockEvidenceLocatorForBlockId(
	residentBase: ResidentBase,
	residentShard: ResidentShard,
	blockId: number,
): LexicalBlockEvidenceLocator | null {
	const liveDocSlot = getLiveDocSlotForBlockId(residentBase, blockId);
	if (liveDocSlot < 0) {
		return null;
	}
	const docLocator = buildLexicalDocEvidenceLocatorForLiveDocSlot(
		residentBase,
		residentShard,
		liveDocSlot,
	);
	if (docLocator == null) {
		return null;
	}
	return {
		...docLocator,
		blockOrdinal: residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId,
	};
}

function getCachedLexicalBlockEvidenceLocatorEntry(
	residentBase: ResidentBase,
	residentShard: ResidentShard,
	blockId: number,
): CachedLexicalBlockEvidenceLocatorEntry | null {
	let cache = BLOCK_EVIDENCE_LOCATOR_CACHE.get(residentBase);
	if (cache == null) {
		cache = new Map<number, CachedLexicalBlockEvidenceLocatorEntry | null>();
		BLOCK_EVIDENCE_LOCATOR_CACHE.set(residentBase, cache);
	}
	const existing = cache.get(blockId);
	if (existing !== undefined) {
		return existing;
	}
	const locator = buildLexicalBlockEvidenceLocatorForBlockId(
		residentBase,
		residentShard,
		blockId,
	);
	const created =
		locator == null
			? null
			: {
					shardId: locator.shardId,
					shardGeneration: locator.shardGeneration,
					locator,
					rowId: buildLexicalBlockEvidenceRowId(locator),
				};
	cache.set(blockId, created);
	return created;
}

function shouldRunHanSurfaceRefine(
	result: CoverageLexicalV3SearchResult,
): boolean {
	return result.rankedCandidates.some(hasBodyTierHanCompletion);
}

function createBenchmarkPhaseTimingState(): CoverageLexicalV3BenchmarkPhaseTimingState {
	return {
		queryCount: 0,
		queryTotalMs: 0,
		phases: new Map(),
		prepareSubphases: new Map(),
		rankSubphases: new Map(),
	};
}

function recordBenchmarkPhaseTiming(
	state: CoverageLexicalV3BenchmarkPhaseTimingState,
	queryTotalMs: number,
	phases: readonly CoverageLexicalV3BenchmarkPhaseSample[],
	breakdown: CoverageLexicalV3BenchmarkPhaseBreakdown | null,
): void {
	state.queryCount += 1;
	state.queryTotalMs += Math.max(queryTotalMs, 0);
	accumulateBenchmarkPhaseSamples(state.phases, phases);
	accumulateBenchmarkPhaseSamples(
		state.prepareSubphases,
		breakdown?.prepareSubphases ?? [],
	);
	accumulateBenchmarkPhaseSamples(
		state.rankSubphases,
		breakdown?.rankSubphases ?? [],
	);
}

function accumulateBenchmarkPhaseSamples(
	target: Map<string, CoverageLexicalV3BenchmarkPhaseAggregate>,
	samples: readonly CoverageLexicalV3BenchmarkPhaseSample[],
): void {
	for (const sample of samples) {
		const durationMs = Math.max(sample.durationMs, 0);
		const existing = target.get(sample.phase);
		if (existing != null) {
			existing.totalMs += durationMs;
			existing.maxMs = Math.max(existing.maxMs, durationMs);
			existing.count += 1;
			existing.unitCount += Math.max(sample.unitCount, 0);
			continue;
		}
		target.set(sample.phase, {
			totalMs: durationMs,
			maxMs: durationMs,
			count: 1,
			unitCount: Math.max(sample.unitCount, 0),
		});
	}
}

function summarizeBenchmarkPhaseTimingState(
	state: CoverageLexicalV3BenchmarkPhaseTimingState,
): CoverageLexicalV3BenchmarkPhaseTimingSummary | null {
	if (state.queryCount <= 0) {
		return null;
	}
	const totalMeasuredMs = sumBenchmarkPhaseAggregateTotalMs(state.phases);
	const prepareMeasuredMs = sumBenchmarkPhaseAggregateTotalMs(state.prepareSubphases);
	const rankMeasuredMs = sumBenchmarkPhaseAggregateTotalMs(state.rankSubphases);
	return {
		queryCount: state.queryCount,
		queryTotalMs: state.queryTotalMs,
		totalMeasuredMs,
		phases: summarizeBenchmarkPhaseAggregateMap(
			state.phases,
			totalMeasuredMs,
			state.queryTotalMs,
			null,
		),
		prepareSubphases: summarizeBenchmarkPhaseAggregateMap(
			state.prepareSubphases,
			totalMeasuredMs,
			state.queryTotalMs,
			prepareMeasuredMs,
		),
		rankSubphases: summarizeBenchmarkPhaseAggregateMap(
			state.rankSubphases,
			totalMeasuredMs,
			state.queryTotalMs,
			rankMeasuredMs,
		),
	};
}

function summarizeBenchmarkPhaseAggregateMap(
	target: Map<string, CoverageLexicalV3BenchmarkPhaseAggregate>,
	totalMeasuredMs: number,
	queryTotalMs: number,
	parentMeasuredMs: number | null,
): readonly CoverageLexicalV3BenchmarkPhaseTimingEntry[] {
	return [...target.entries()]
		.map(([phase, aggregate]) => ({
			phase,
			totalMs: aggregate.totalMs,
			maxMs: aggregate.maxMs,
			count: aggregate.count,
			unitCount: aggregate.unitCount,
			avgMsPerCall:
				aggregate.count <= 0 ? 0 : aggregate.totalMs / aggregate.count,
			avgMsPerUnit:
				aggregate.unitCount <= 0 ? 0 : aggregate.totalMs / aggregate.unitCount,
			shareOfMeasuredMs:
				totalMeasuredMs <= 0 ? 0 : aggregate.totalMs / totalMeasuredMs,
			shareOfQueryTime:
				queryTotalMs <= 0 ? 0 : aggregate.totalMs / queryTotalMs,
			shareOfParentMs:
				parentMeasuredMs == null || parentMeasuredMs <= 0
					? undefined
					: aggregate.totalMs / parentMeasuredMs,
		}))
		.sort((left, right) => right.totalMs - left.totalMs);
}

function sumBenchmarkPhaseAggregateTotalMs(
	target: Map<string, CoverageLexicalV3BenchmarkPhaseAggregate>,
): number {
	let total = 0;
	for (const aggregate of target.values()) {
		total += aggregate.totalMs;
	}
	return total;
}
