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
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
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
	getDocHeadingHanWitnessStringIds,
	getDocIdentityHanWitnessSourceMasks,
	getDocIdentityHanWitnessStringIds,
	getDocRouteHanWitnessSourceMasks,
	getDocRouteHanWitnessStringIds,
	getLiveDocGeneration,
	getLiveDocSlot,
	type V3CandidateDocRecall,
} from "./recall";
import { FUZZY_RESCUE_MIN_QUERY_LENGTH } from "./layout/fuzzy-rescue";
import {
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
	hydrateCandidateEvidenceBatch,
	type CandidateEvidencePackage,
	type EvidencePackingProfile,
	type HanSurfaceCompletionGroupResult,
	type HanSurfaceCompletionTier,
} from "./ranking";

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
	hydratedEvidenceByDocId: ReadonlyMap<number, CandidateEvidencePackage>;
}>;

type PersistedLexicalBodyEvidenceRow = Readonly<{
	blockId: number;
	exactFamilyIds: readonly number[];
	exactTokenPositions: readonly number[];
	familySupportFamilyIds: readonly number[];
	familySupportMaskByEntry: readonly number[];
}>;

type PersistedLexicalHanDocEvidenceRow = Readonly<{
	docId: number;
	identityWitnessStringIds: readonly number[];
	identityWitnessSourceMaskByDocEntry: readonly number[];
	routeWitnessStringIds: readonly number[];
	routeWitnessSourceMaskByDocEntry: readonly number[];
	headingWitnessStringIds: readonly number[];
}>;

type PersistedLexicalHanBodyEvidenceRow = Readonly<{
	blockId: number;
	bodyWitnessStringIds: readonly number[];
	bodyWitnessStartOffsets: readonly number[];
}>;

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
	private fuzzyRescueLeaseCount = 0;

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
		this.fuzzyRescueLeaseCount = 0;
		this.engine = new CoverageLexicalV3Engine();
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
		const releaseFuzzyRescue = await this.acquireFuzzyRescueLeaseIfNeeded(
			queryText,
			request.isFuzzy !== false,
		);
		try {
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(queryText);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const tokenizeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const searchTerms = this.getQueryTerms(queryText);
		const tokenizeMs = shouldLogDebug ? nowDebugMs() - tokenizeStartedAtMs : 0;
		const prepareStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const preparedSearch = this.engine.prepareSearch(queryText, searchTerms, {
			allowPrefixMatch: request.isPrefixMatch,
			allowFuzzyMatch: request.isFuzzy,
			maxItemResults: request.maxItemResults,
		});
		const prepareMs = shouldLogDebug ? nowDebugMs() - prepareStartedAtMs : 0;
		const hydrateStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const { hydratedEvidenceByDocId } =
			await this.hydrateRankingEvidenceForCandidates(preparedSearch);
		const hydrateMs = shouldLogDebug ? nowDebugMs() - hydrateStartedAtMs : 0;
		const rankStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const result = this.engine.rankPreparedSearch(
			preparedSearch,
			hydratedEvidenceByDocId,
		);
		const rankMs = shouldLogDebug ? nowDebugMs() - rankStartedAtMs : 0;
		const shouldRefineHan = shouldRunHanSurfaceRefine(result);
		const refineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const refinedCandidates = shouldRefineHan
			? await this.refineHanSurfaceCompletion(result, hydratedEvidenceByDocId)
			: result.rankedCandidates;
		const refineMs = shouldLogDebug ? nowDebugMs() - refineStartedAtMs : 0;
		const visibilityFilteredCandidates =
			request.hideWeaklyRelatedResults === true
				? refinedCandidates.filter(
						(candidate) =>
							!candidate.hasOnlyWeakHanRescue ||
							candidate.singletonHanCompletion.matched,
					)
				: refinedCandidates;
		const pruneStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const weaklyPrunedCandidates = request.hideWeaklyRelatedResults
			? filterToTopCoverageGateBand(visibilityFilteredCandidates)
			: visibilityFilteredCandidates;
		const pruneMs = shouldLogDebug ? nowDebugMs() - pruneStartedAtMs : 0;
		const visibleStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const visibleCandidates = applyHanSurfaceCompletionDominance(
			result,
			weaklyPrunedCandidates,
			request.hideWeaklyRelatedResults === true,
		);
		const visibleMs = shouldLogDebug ? nowDebugMs() - visibleStartedAtMs : 0;
		const materializeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
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
		const materializeMs = shouldLogDebug ? nowDebugMs() - materializeStartedAtMs : 0;
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
		} finally {
			releaseFuzzyRescue?.();
		}
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
		const releaseFuzzyRescue = await this.acquireFuzzyRescueLeaseIfNeeded(
			trimmedQuery,
			true,
		);
		try {
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(trimmedQuery);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const tokenizeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const searchTerms = this.getQueryTerms(trimmedQuery);
		const tokenizeMs = shouldLogDebug ? nowDebugMs() - tokenizeStartedAtMs : 0;
		const prepareStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const preparedSearch = this.engine.prepareSearch(trimmedQuery, searchTerms, {
			maxItemResults: this.outerSetting.ui.maxItemResults,
		});
		const prepareMs = shouldLogDebug ? nowDebugMs() - prepareStartedAtMs : 0;
		const hydrateStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const { hydratedEvidenceByDocId } =
			await this.hydrateRankingEvidenceForCandidates(preparedSearch);
		const hydrateMs = shouldLogDebug ? nowDebugMs() - hydrateStartedAtMs : 0;
		const rankStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const result = this.engine.rankPreparedSearch(
			preparedSearch,
			hydratedEvidenceByDocId,
		);
		const rankMs = shouldLogDebug ? nowDebugMs() - rankStartedAtMs : 0;
		const shouldRefineHan = shouldRunHanSurfaceRefine(result);
		const refineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const refinedCandidates = shouldRefineHan
			? await this.refineHanSurfaceCompletion(result, hydratedEvidenceByDocId)
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
			(item) => item.docId === candidate.docId,
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
		} finally {
			releaseFuzzyRescue?.();
		}
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
				hydratedEvidenceByDocId: new Map(),
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
				hydratedEvidenceByDocId: new Map(),
			};
		}
		const snapshotStore = this.getFileSnapshotStore();
		const shortlistedBodyBlockIds = needsBodyRankingEvidence
			? collectShortlistedBodyBlockIds(preparedSearch.guardedCandidateDocs)
			: [];
		const candidateDocIds = needsHanRankingEvidence
			? preparedSearch.guardedCandidateDocs.map(
					(candidateRecall) => candidateRecall.docId,
				)
			: [];
		const bodyEvidenceByBlockId =
			needsBodyRankingEvidence
				? ((await snapshotStore.readLexicalBodyEvidenceForBlocks?.(
						shortlistedBodyBlockIds,
					)) ?? null)
				: null;
		const docHanEvidenceByDocId =
			needsHanRankingEvidence
				? ((await snapshotStore.readLexicalHanDocEvidenceForDocs?.(
						candidateDocIds,
					)) ?? null)
				: null;
		const docHanEvidenceByLiveDocSlot =
			docHanEvidenceByDocId == null
				? null
				: new Map(
						preparedSearch.guardedCandidateDocs.flatMap((candidateRecall) => {
							const evidence = docHanEvidenceByDocId.get(candidateRecall.docId);
							return evidence == null
								? []
								: [[candidateRecall.liveDocSlot, evidence] as const];
						}),
					);
		const bodyHanEvidenceByBlockId =
			needsHanRankingEvidence && shortlistedBodyBlockIds.length > 0
				? ((await snapshotStore.readLexicalHanBodyEvidenceForBlocks?.(
						shortlistedBodyBlockIds,
					)) ?? null)
				: null;
		return {
			hydratedEvidenceByDocId: hydrateCandidateEvidenceBatch(
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

	private async acquireFuzzyRescueLeaseIfNeeded(
		queryText: string,
		allowFuzzyMatch: boolean,
	): Promise<(() => void) | null> {
		if (!allowFuzzyMatch || !shouldPotentiallyNeedFuzzyRescue(queryText)) {
			return null;
		}
		if (this.fuzzyRescueLeaseCount === 0) {
			const sidecar = await this.getFileSnapshotStore().readLexicalFuzzyRescue?.();
			if (sidecar != null) {
				this.engine.setFuzzyRescueSidecar?.(sidecar);
			}
		}
		this.fuzzyRescueLeaseCount += 1;
		return () => {
			this.fuzzyRescueLeaseCount = Math.max(0, this.fuzzyRescueLeaseCount - 1);
			if (this.fuzzyRescueLeaseCount === 0) {
				this.engine.clearFuzzyRescueSidecar?.();
			}
		};
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
		hydratedEvidenceByDocId: ReadonlyMap<number, CandidateEvidencePackage>,
	): Promise<readonly EvidencePackingProfile[]> {
		const residentBase = this.engine.getResidentBase();
		if (residentBase == null) {
			return result.rankedCandidates;
		}
		const candidateRecallByDocId = new Map<number, V3CandidateDocRecall>(
			result.recallState.candidateDocs.map((candidate) => [candidate.docId, candidate]),
		);
		const refinedCandidates = new Map<number, EvidencePackingProfile>();
		for (let candidateIndex = 0; candidateIndex < result.rankedCandidates.length; candidateIndex += 1) {
			const candidate = result.rankedCandidates[candidateIndex];
			const candidateRecall = candidateRecallByDocId.get(candidate.docId);
			const candidateEvidence = hydratedEvidenceByDocId.get(candidate.docId);
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
			refinedCandidates.set(candidate.docId, {
				...candidate,
				completedHanSurfaceGroupCount: nextSummary.completedGroupCount,
				hanSurfaceCompletionTierScoreTotal: nextSummary.tierScoreTotal,
				strongestHanSurfaceCompletionTier: nextSummary.strongestTier,
				hanSurfaceCompletionGroups: nextGroups,
			});
		}
		return result.rankedCandidates
			.map((candidate) => refinedCandidates.get(candidate.docId) ?? candidate)
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
	const retainedDocIds = new Set(after.map((candidate) => candidate.docId));
	return before
		.filter((candidate) => !retainedDocIds.has(candidate.docId))
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
			candidate.docId,
			buildHanSurfaceDominanceProfile(candidate, eligibleSurfaceGroupIndices),
		]),
	);
	const sortedTopBand = [...topBand].sort((left, right) => {
		const dominanceComparison = compareHanSurfaceDominanceProfiles(
			dominanceProfiles.get(left.docId) ?? EMPTY_HAN_SURFACE_DOMINANCE_PROFILE,
			dominanceProfiles.get(right.docId) ?? EMPTY_HAN_SURFACE_DOMINANCE_PROFILE,
		);
		if (dominanceComparison !== 0) {
			return dominanceComparison;
		}
		return comparePackingProfiles(left, right);
	});
	const strongestProfile = dominanceProfiles.get(sortedTopBand[0].docId) ?? EMPTY_HAN_SURFACE_DOMINANCE_PROFILE;
	const filteredTopBand =
		hideWeaklyRelatedResults && strongestProfile.completedGroupCount > 0
			? sortedTopBand.filter((candidate) =>
				(dominanceProfiles.get(candidate.docId) ?? EMPTY_HAN_SURFACE_DOMINANCE_PROFILE)
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

function collectShortlistedBodyBlockIds(
	candidateRecalls: readonly V3CandidateDocRecall[],
): number[] {
	return Array.from(
		new Set(
			candidateRecalls.flatMap(
				(candidateRecall) => candidateRecall.shortlistedBodyBlockIds,
			),
		),
	).sort((left, right) => left - right);
}

function buildLexicalBodyEvidenceRows(
	residentBase: ResidentBase,
): PersistedLexicalBodyEvidenceRow[] {
	return Array.from(
		{ length: residentBase.bodyBlocks.blockCount },
		(_, blockId) => {
			const familySupportEntries = getBodyBlockFamilySupportEntries(
				residentBase,
				blockId,
			);
			return {
				blockId,
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
			};
		},
	);
}

function buildLexicalHanDocEvidenceRows(
	residentBase: ResidentBase,
): PersistedLexicalHanDocEvidenceRow[] {
	return Array.from({ length: residentBase.docTable.docCount }, (_, docId) => ({
		docId,
		identityWitnessStringIds: getDocIdentityHanWitnessStringIds(
			residentBase,
			docId,
		),
		identityWitnessSourceMaskByDocEntry: getDocIdentityHanWitnessSourceMasks(
			residentBase,
			docId,
		),
		routeWitnessStringIds: getDocRouteHanWitnessStringIds(residentBase, docId),
		routeWitnessSourceMaskByDocEntry: getDocRouteHanWitnessSourceMasks(
			residentBase,
			docId,
		),
		headingWitnessStringIds: getDocHeadingHanWitnessStringIds(
			residentBase,
			docId,
		),
	}));
}

function buildLexicalHanBodyEvidenceRows(
	residentBase: ResidentBase,
): PersistedLexicalHanBodyEvidenceRow[] {
	return Array.from({ length: residentBase.bodyBlocks.blockCount }, (_, blockId) => ({
		blockId,
		bodyWitnessStringIds: getBodyBlockHanWitnessStringIds(residentBase, blockId),
		bodyWitnessStartOffsets: getBodyBlockHanWitnessStartOffsets(
			residentBase,
			blockId,
		),
	}));
}

function shouldRunHanSurfaceRefine(
	result: CoverageLexicalV3SearchResult,
): boolean {
	return result.rankedCandidates.some(hasBodyTierHanCompletion);
}
