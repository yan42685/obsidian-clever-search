import type {
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
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
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
} from "./layout/types";
import {
	getBodyBlockExactFamilyIds,
	getBodyBlockExactTokenPositions,
	getBodyBlockFamilySupportEntries,
	getBodyBlockHanWitnessStartOffsets,
	getBodyBlockHanWitnessStringIds,
	getDocIdForLiveDocSlot,
	getDocHeadingHanWitnessStringIds,
	getDocIdentityHanWitnessSourceMasks,
	getDocIdentityHanWitnessStringIds,
	getDocRouteHanWitnessSourceMasks,
	getDocRouteHanWitnessStringIds,
	getLiveDocGeneration,
	getLiveDocRef,
	getLiveDocSlot,
	getLiveDocSlotForBlockId,
	type V3CandidateDocRecall,
} from "./recall";
import {
	buildFuzzyLookupKeys,
	EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR,
	FUZZY_RESCUE_MIN_QUERY_LENGTH,
} from "./layout/fuzzy-rescue";
import {
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
	hydrateCandidateEvidenceBatch,
	type CandidateEvidencePackage,
	type EvidencePackingProfile,
	type HanSurfaceCompletionGroupResult,
	type HanSurfaceCompletionTier,
} from "./ranking";
import { analyzeQuery } from "./query";
import type { ResidentFuzzyRescueSidecar } from "./layout/types";

export type CoverageLexicalV3RuntimeMemoryBreakdown = Readonly<{
	__backend: "coverage-lexical-v3";
	metrics: ResidentBaseMetrics;
	summary: ResidentBaseSummary;
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

type HydratedRankingEvidence = Readonly<{
	hydratedEvidenceByLiveDocSlot: ReadonlyMap<number, CandidateEvidencePackage>;
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
	docRef: number;
	generation: number;
	blockOrdinal: number;
	exactFamilyIds: readonly number[];
	exactTokenPositions: readonly number[];
	familySupportFamilyIds: readonly number[];
	familySupportMaskByEntry: readonly number[];
}>;

type PersistedLexicalHanDocEvidenceRow = Readonly<{
	id: string;
	docRef: number;
	generation: number;
	identityWitnessStringIds: readonly number[];
	identityWitnessSourceMaskByDocEntry: readonly number[];
	routeWitnessStringIds: readonly number[];
	routeWitnessSourceMaskByDocEntry: readonly number[];
	headingWitnessStringIds: readonly number[];
}>;

type PersistedLexicalHanBodyEvidenceRow = Readonly<{
	id: string;
	docRef: number;
	generation: number;
	blockOrdinal: number;
	bodyWitnessStringIds: readonly number[];
	bodyWitnessStartOffsets: readonly number[];
}>;

type CachedLexicalDocEvidenceLocatorEntry = Readonly<{
	locator: LexicalDocEvidenceLocator;
	rowId: string;
}>;

type CachedLexicalBlockEvidenceLocatorEntry = Readonly<{
	locator: LexicalBlockEvidenceLocator;
	rowId: string;
}>;

type CollectedLexicalDocEvidenceRequest = Readonly<{
	liveDocSlot: number;
	locator: LexicalDocEvidenceLocator;
	rowId: string;
}>;

type CollectedLexicalBlockEvidenceRequest = Readonly<{
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
		const fuzzyRescueSidecar = await this.hydrateFuzzyRescueForQuery(
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
		}, fuzzyRescueSidecar);
		const prepareMs = shouldMeasureTiming ? nowDebugMs() - prepareStartedAtMs : 0;
		const hydrateStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const { hydratedEvidenceByLiveDocSlot } =
			await this.hydrateRankingEvidenceForCandidates(preparedSearch);
		const hydrateMs = shouldMeasureTiming ? nowDebugMs() - hydrateStartedAtMs : 0;
		const rankStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const result = this.engine.rankPreparedSearch(
			preparedSearch,
			hydratedEvidenceByLiveDocSlot,
		);
		const rankMs = shouldMeasureTiming ? nowDebugMs() - rankStartedAtMs : 0;
		const shouldRefineHan = shouldRunHanSurfaceRefine(result);
		const refineStartedAtMs = shouldMeasureTiming ? nowDebugMs() : 0;
		const refinedCandidates = shouldRefineHan
			? await this.refineHanSurfaceCompletion(result, hydratedEvidenceByLiveDocSlot)
			: result.rankedCandidates;
		const refineMs = shouldMeasureTiming ? nowDebugMs() - refineStartedAtMs : 0;
		const visibilityFilteredCandidates =
			request.hideWeaklyRelatedResults === true
				? refinedCandidates.filter(
						(candidate) =>
							!candidate.hasOnlyWeakHanRescue ||
							candidate.singletonHanCompletion.matched,
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
		const residentBase = this.engine.getResidentBase();
		if (residentBase == null) {
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
		const fuzzyRescueSidecar = await this.hydrateFuzzyRescueForQuery(
			trimmedQuery,
			searchTerms,
			true,
		);
		const prepareStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const preparedSearch = this.engine.prepareSearch(trimmedQuery, searchTerms, {
			maxItemResults: this.outerSetting.ui.maxItemResults,
		}, fuzzyRescueSidecar);
		const prepareMs = shouldLogDebug ? nowDebugMs() - prepareStartedAtMs : 0;
		const hydrateStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const { hydratedEvidenceByLiveDocSlot } =
			await this.hydrateRankingEvidenceForCandidates(preparedSearch);
		const hydrateMs = shouldLogDebug ? nowDebugMs() - hydrateStartedAtMs : 0;
		const rankStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const result = this.engine.rankPreparedSearch(
			preparedSearch,
			hydratedEvidenceByLiveDocSlot,
		);
		const rankMs = shouldLogDebug ? nowDebugMs() - rankStartedAtMs : 0;
		const shouldRefineHan = shouldRunHanSurfaceRefine(result);
		const refineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const refinedCandidates = shouldRefineHan
			? await this.refineHanSurfaceCompletion(result, hydratedEvidenceByLiveDocSlot)
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
		const candidateRecall = result.recallState.candidateDocs.find(
			(item) => item.liveDocSlot === candidate.liveDocSlot,
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
		return this.engine.getResidentBaseMetrics()?.residentBytes ?? 0;
	}

	getIndexBreakdown(): CoverageLexicalV3RuntimeMemoryBreakdown | null {
		const metrics = this.engine.getResidentBaseMetrics();
		const summary = this.engine.describeResidentBase();
		if (!metrics || !summary) {
			return null;
		}
		return {
			__backend: "coverage-lexical-v3",
			metrics,
			summary,
		};
	}

	supportsPersistentFileIndex(): boolean {
		return false;
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
		this.engine.buildResidentBase(
			documents,
			(text) => this.getDocumentTerms(text),
		);
		const residentBase = this.engine.getResidentBase();
		const lexicalBodyEvidenceRows =
			residentBase == null ? [] : buildLexicalBodyEvidenceRows(residentBase);
		const lexicalHanDocEvidenceRows =
			residentBase == null ? [] : buildLexicalHanDocEvidenceRows(residentBase);
		const lexicalHanBodyEvidenceRows =
			residentBase == null ? [] : buildLexicalHanBodyEvidenceRows(residentBase);
		await this.getFileSnapshotStore().publishLexicalFuzzyRescue?.(
			this.engine.getFuzzyRescueSidecar(),
		);
		await this.getFileSnapshotStore().publishLexicalBodyEvidence?.(
			lexicalBodyEvidenceRows,
		);
		await this.getFileSnapshotStore().publishLexicalHanDocEvidence?.(
			lexicalHanDocEvidenceRows,
		);
		await this.getFileSnapshotStore().publishLexicalHanBodyEvidence?.(
			lexicalHanBodyEvidenceRows,
		);
		this.engine.clearFuzzyRescueSidecar();
		this.engine.clearExactTapeSidecar();
		this.engine.clearBodyFamilySupportSidecar();
		this.engine.clearHanWitnessSidecar();
	}

	private async hydrateRankingEvidenceForCandidates(
		preparedSearch: CoverageLexicalV3PreparedSearch,
	): Promise<HydratedRankingEvidence> {
		const residentBase = this.engine.getResidentBase();
		if (residentBase == null || preparedSearch.guardedCandidateDocs.length === 0) {
			return {
				hydratedEvidenceByLiveDocSlot: new Map(),
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
				hydratedEvidenceByLiveDocSlot: new Map(),
			};
		}
		const snapshotStore = this.getFileSnapshotStore();
		const shortlistedBodyBlockIds = needsBodyRankingEvidence
			? collectShortlistedBodyBlockIds(preparedSearch.guardedCandidateDocs)
			: [];
		const shortlistedBodyEvidenceLocators = needsBodyRankingEvidence
			? collectShortlistedBodyEvidenceLocators(
					residentBase,
					shortlistedBodyBlockIds,
				)
			: [];
		const hanDocCandidateRecalls = needsHanRankingEvidence
			? preparedSearch.guardedCandidateDocs.filter(needsHanDocEvidenceForCandidate)
			: [];
		const hanBodyCandidateRecalls = needsHanRankingEvidence
			? preparedSearch.guardedCandidateDocs.filter(needsHanBodyEvidenceForCandidate)
			: [];
		const hanShortlistedBodyBlockIds =
			needsHanRankingEvidence && hanBodyCandidateRecalls.length > 0
				? collectShortlistedBodyBlockIds(hanBodyCandidateRecalls)
				: [];
		const hanShortlistedBodyEvidenceLocators =
			needsHanRankingEvidence && hanShortlistedBodyBlockIds.length > 0
				? collectShortlistedBodyEvidenceLocators(
						residentBase,
						hanShortlistedBodyBlockIds,
					)
				: [];
		const candidateDocEvidenceLocators =
			needsHanRankingEvidence && hanDocCandidateRecalls.length > 0
				? collectCandidateDocEvidenceLocators(
						residentBase,
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
		const docHanEvidenceByLiveDocSlot =
			materializePersistedDocEvidenceByLiveDocSlot(
				candidateDocEvidenceLocators,
				persistedDocHanEvidenceByRowId,
			);
		const bodyHanEvidenceByBlockId =
			materializePersistedBlockEvidenceByBlockId(
				hanShortlistedBodyEvidenceLocators,
				persistedBodyHanEvidenceByRowId,
			);
		return {
			hydratedEvidenceByLiveDocSlot: hydrateCandidateEvidenceBatch(
				residentBase,
				preparedSearch.guardedCandidateDocs,
				{
					bodyEvidenceByBlockId,
					docHanEvidenceByLiveDocSlot,
					bodyHanEvidenceByBlockId,
				},
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
	): Promise<ResidentFuzzyRescueSidecar> {
		if (!allowFuzzyMatch || !shouldPotentiallyNeedFuzzyRescue(queryText)) {
			return EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR;
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
			return EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR;
		}
		const snapshotStore = this.getFileSnapshotStore();
		if (typeof snapshotStore.readLexicalFuzzyRescueForLookupKeys === "function") {
			return (
				(await snapshotStore.readLexicalFuzzyRescueForLookupKeys(
					fuzzyLookupKeys,
				)) ?? EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR
			);
		}
		return (
			(await snapshotStore.readLexicalFuzzyRescue?.()) ??
			EMPTY_RESIDENT_FUZZY_RESCUE_SIDECAR
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
		hydratedEvidenceByLiveDocSlot: ReadonlyMap<number, CandidateEvidencePackage>,
	): Promise<readonly EvidencePackingProfile[]> {
		const residentBase = this.engine.getResidentBase();
		if (residentBase == null) {
			return result.rankedCandidates;
		}
		const candidateRecallByLiveDocSlot = new Map<number, V3CandidateDocRecall>(
			result.recallState.candidateDocs.map((candidate) => [
				candidate.liveDocSlot,
				candidate,
			]),
		);
		const refinedCandidates = new Map<number, EvidencePackingProfile>();
		for (let candidateIndex = 0; candidateIndex < result.rankedCandidates.length; candidateIndex += 1) {
			const candidate = result.rankedCandidates[candidateIndex];
			const candidateRecall = candidateRecallByLiveDocSlot.get(candidate.liveDocSlot);
			const candidateEvidence = hydratedEvidenceByLiveDocSlot.get(candidate.liveDocSlot);
			if (candidateRecall == null || !hasBodyTierHanCompletion(candidate)) {
				continue;
			}
			if (candidateEvidence == null) {
				continue;
			}
			if (!hasHanSurfaceRefineNearTieRisk(result.rankedCandidates, candidateIndex)) {
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
			refinedCandidates.set(candidate.liveDocSlot, {
				...candidate,
				completedHanSurfaceGroupCount: nextSummary.completedGroupCount,
				hanSurfaceCompletionTierScoreTotal: nextSummary.tierScoreTotal,
				strongestHanSurfaceCompletionTier: nextSummary.strongestTier,
				hanSurfaceCompletionGroups: nextGroups,
			});
		}
		return result.rankedCandidates
			.map((candidate) => refinedCandidates.get(candidate.liveDocSlot) ?? candidate)
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

function filterToTopCoverageGateBand(
	candidates: readonly EvidencePackingProfile[],
): readonly EvidencePackingProfile[] {
	const strongestCoverageGate = candidates[0]?.coverageGate;
	if (strongestCoverageGate == null) {
		return candidates;
	}
	return candidates.filter((candidate) =>
		hasSameCoverageGate(candidate.coverageGate, strongestCoverageGate),
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

function collectShortlistedBodyBlockIds(
	candidateRecalls: readonly V3CandidateDocRecall[],
): number[] {
	const seen = new Set<number>();
	const blockIds: number[] = [];
	for (const candidateRecall of candidateRecalls) {
		for (const blockId of candidateRecall.shortlistedBodyBlockIds) {
			if (seen.has(blockId)) {
				continue;
			}
			seen.add(blockId);
			blockIds.push(blockId);
		}
	}
	return blockIds;
}

function collectShortlistedBodyEvidenceLocators(
	residentBase: ResidentBase,
	blockIds: readonly number[],
): CollectedLexicalBlockEvidenceRequest[] {
	const requests: CollectedLexicalBlockEvidenceRequest[] = [];
	for (const blockId of blockIds) {
		const cached = getCachedLexicalBlockEvidenceLocatorEntry(
			residentBase,
			blockId,
		);
		if (cached == null) {
			continue;
		}
		requests.push({
			blockId,
			locator: cached.locator,
			rowId: cached.rowId,
		});
	}
	return requests;
}

function collectCandidateDocEvidenceLocators(
	residentBase: ResidentBase,
	candidateRecalls: readonly V3CandidateDocRecall[],
): CollectedLexicalDocEvidenceRequest[] {
	const requests: CollectedLexicalDocEvidenceRequest[] = [];
	for (const candidateRecall of candidateRecalls) {
		const cached = getCachedLexicalDocEvidenceLocatorEntry(
			residentBase,
			candidateRecall.liveDocSlot,
		);
		if (cached == null) {
			continue;
		}
		requests.push({
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

function materializePersistedDocEvidenceByLiveDocSlot<T>(
	requests: readonly CollectedLexicalDocEvidenceRequest[],
	persistedByRowId: ReadonlyMap<string, T> | null,
): ReadonlyMap<number, T> | null {
	if (persistedByRowId == null) {
		return null;
	}
	const evidenceByLiveDocSlot = new Map<number, T>();
	for (const request of requests) {
		const evidence = persistedByRowId.get(request.rowId);
		if (evidence != null) {
			evidenceByLiveDocSlot.set(request.liveDocSlot, evidence);
		}
	}
	return evidenceByLiveDocSlot;
}

function buildLexicalBodyEvidenceRows(
	residentBase: ResidentBase,
): PersistedLexicalBodyEvidenceRow[] {
	const rows: PersistedLexicalBodyEvidenceRow[] = [];
	for (let blockId = 0; blockId < residentBase.bodyBlocks.blockCount; blockId += 1) {
		const locator = buildLexicalBlockEvidenceLocatorForBlockId(
			residentBase,
			blockId,
		);
		if (locator == null) {
			continue;
		}
		const familySupportEntries = getBodyBlockFamilySupportEntries(
			residentBase,
			blockId,
		);
		rows.push({
			id: buildLexicalBlockEvidenceRowId(locator),
			docRef: locator.docRef,
			generation: locator.generation,
			blockOrdinal: locator.blockOrdinal,
			exactFamilyIds: getBodyBlockExactFamilyIds(residentBase, blockId),
			exactTokenPositions: getBodyBlockExactTokenPositions(
				residentBase,
				blockId,
			),
			familySupportFamilyIds: familySupportEntries.map(
				(entry) => entry.familyId,
			),
			familySupportMaskByEntry: familySupportEntries.map(
				(entry) => entry.supportMask,
			),
		});
	}
	return rows;
}

function buildLexicalHanDocEvidenceRows(
	residentBase: ResidentBase,
): PersistedLexicalHanDocEvidenceRow[] {
	const rows: PersistedLexicalHanDocEvidenceRow[] = [];
	for (
		let liveDocSlot = 0;
		liveDocSlot < residentBase.docTable.liveDocCount;
		liveDocSlot += 1
	) {
		const locator = buildLexicalDocEvidenceLocatorForLiveDocSlot(
			residentBase,
			liveDocSlot,
		);
		if (locator == null) {
			continue;
		}
		const docId = getDocIdForLiveDocSlot(residentBase, liveDocSlot);
		rows.push({
			id: buildLexicalDocEvidenceRowId(locator),
			docRef: locator.docRef,
			generation: locator.generation,
			identityWitnessStringIds: getDocIdentityHanWitnessStringIds(
				residentBase,
				docId,
			),
			identityWitnessSourceMaskByDocEntry: getDocIdentityHanWitnessSourceMasks(
				residentBase,
				docId,
			),
			routeWitnessStringIds: getDocRouteHanWitnessStringIds(
				residentBase,
				docId,
			),
			routeWitnessSourceMaskByDocEntry: getDocRouteHanWitnessSourceMasks(
				residentBase,
				docId,
			),
			headingWitnessStringIds: getDocHeadingHanWitnessStringIds(
				residentBase,
				docId,
			),
		});
	}
	return rows;
}

function buildLexicalHanBodyEvidenceRows(
	residentBase: ResidentBase,
): PersistedLexicalHanBodyEvidenceRow[] {
	const rows: PersistedLexicalHanBodyEvidenceRow[] = [];
	for (let blockId = 0; blockId < residentBase.bodyBlocks.blockCount; blockId += 1) {
		const locator = buildLexicalBlockEvidenceLocatorForBlockId(
			residentBase,
			blockId,
		);
		if (locator == null) {
			continue;
		}
		rows.push({
			id: buildLexicalBlockEvidenceRowId(locator),
			docRef: locator.docRef,
			generation: locator.generation,
			blockOrdinal: locator.blockOrdinal,
			bodyWitnessStringIds: getBodyBlockHanWitnessStringIds(
				residentBase,
				blockId,
			),
			bodyWitnessStartOffsets: getBodyBlockHanWitnessStartOffsets(
				residentBase,
				blockId,
			),
		});
	}
	return rows;
}

function buildLexicalDocEvidenceLocatorForLiveDocSlot(
	residentBase: ResidentBase,
	liveDocSlot: number,
): LexicalDocEvidenceLocator | null {
	const docRef = getLiveDocRef(residentBase, liveDocSlot);
	if (docRef == null) {
		return null;
	}
	return {
		docRef,
		generation: getLiveDocGeneration(residentBase, liveDocSlot),
	};
}

function getCachedLexicalDocEvidenceLocatorEntry(
	residentBase: ResidentBase,
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
		liveDocSlot,
	);
	const created =
		locator == null
			? null
			: {
					locator,
					rowId: buildLexicalDocEvidenceRowId(locator),
				};
	cache.set(liveDocSlot, created);
	return created;
}

function buildLexicalBlockEvidenceLocatorForBlockId(
	residentBase: ResidentBase,
	blockId: number,
): LexicalBlockEvidenceLocator | null {
	const liveDocSlot = getLiveDocSlotForBlockId(residentBase, blockId);
	if (liveDocSlot < 0) {
		return null;
	}
	const docLocator = buildLexicalDocEvidenceLocatorForLiveDocSlot(
		residentBase,
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
	const locator = buildLexicalBlockEvidenceLocatorForBlockId(residentBase, blockId);
	const created =
		locator == null
			? null
			: {
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


