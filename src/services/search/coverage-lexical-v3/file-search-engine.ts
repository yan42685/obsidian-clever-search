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
	type CoverageLexicalV3SearchResult,
} from "./engine";
import type {
	ResidentBase,
	ResidentBaseMetrics,
	ResidentBaseSummary,
} from "./layout/types";
import {
	confirmHanBodyBlockSurface,
	type V3CandidateDocRecall,
} from "./recall";
import {
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
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

@singleton()
export class CoverageLexicalV3FileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private engine = new CoverageLexicalV3Engine();
	private readonly outerSetting = getInstance(OuterSetting);
	private readonly documentsByPath = new Map<string, IndexedDocument>();
	private batchReindexing = false;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			this.clearIndex();
			return false;
		}
		this.documentsByPath.clear();
		for (const document of data) {
			this.documentsByPath.set(document.path, cloneIndexedDocument(document));
		}
		this.rebuildResidentBase();
		return true;
	}

	clearIndex(): void {
		this.documentsByPath.clear();
		this.rebuildResidentBase();
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.documentsByPath.set(document.path, cloneIndexedDocument(document));
		}
		if (!this.batchReindexing) {
			this.rebuildResidentBase();
		}
	}

	deleteDocuments(paths: string[]): void {
		let changed = false;
		for (const path of paths) {
			changed = this.documentsByPath.delete(path) || changed;
		}
		if (changed && !this.batchReindexing) {
			this.rebuildResidentBase();
		}
	}

	async moveDocument(
		oldPath: string,
		document: IndexedDocument,
	): Promise<boolean> {
		if (oldPath !== document.path) {
			this.documentsByPath.delete(oldPath);
		}
		this.documentsByPath.set(document.path, cloneIndexedDocument(document));
		if (!this.batchReindexing) {
			this.rebuildResidentBase();
		}
		return true;
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		if (this.documentsByPath.size === 0) {
			return [];
		}
		const queryText = request.queryText.trim();
		if (queryText.length === 0) {
			return [];
		}
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(queryText);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const tokenizeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const searchTerms = this.getQueryTerms(queryText);
		const tokenizeMs = shouldLogDebug ? nowDebugMs() - tokenizeStartedAtMs : 0;
		const engineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const result = this.engine.search(queryText, searchTerms, {
			allowPrefixMatch: request.isPrefixMatch,
			allowFuzzyMatch: request.isFuzzy,
		});
		const engineMs = shouldLogDebug ? nowDebugMs() - engineStartedAtMs : 0;
		const refineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const refinedCandidates = await this.refineHanSurfaceCompletion(result);
		const refineMs = shouldLogDebug ? nowDebugMs() - refineStartedAtMs : 0;
		const visibilityFilteredCandidates =
			request.hideWeaklyRelatedResults === true
				? refinedCandidates.filter((candidate) => !candidate.hasOnlyWeakHanRescue)
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
			const document = this.documentsByPath.get(candidate.path);
			const basenameText = document?.basename ?? "";
			const folderText = document?.folder ?? "";
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
				hideWeaklyRelatedResults: request.hideWeaklyRelatedResults === true,
				maxItemResults: request.maxItemResults,
				candidateDocCount: result.recallState.candidateDocs.length,
				refinedCandidateCount: refinedCandidates.length,
				visibilityFilteredCandidateCount: visibilityFilteredCandidates.length,
				weaklyPrunedCandidateCount: weaklyPrunedCandidates.length,
				visibleCandidateCount: visibleCandidates.length,
				returnedCandidateCount: matchedFiles.length,
				phaseMs: {
					tokenize: roundDebugMs(tokenizeMs),
					engine: roundDebugMs(engineMs),
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
		return this.documentsByPath.size;
	}

	async getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemResults: number,
	): Promise<FileSubItem[] | null> {
		if (!this.documentsByPath.has(path)) {
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
		const engineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const result = this.engine.search(trimmedQuery, searchTerms);
		const engineMs = shouldLogDebug ? nowDebugMs() - engineStartedAtMs : 0;
		const refineStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const refinedCandidates = await this.refineHanSurfaceCompletion(result);
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
						engine: roundDebugMs(engineMs),
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
						engine: roundDebugMs(engineMs),
						hanRefine: roundDebugMs(refineMs),
						total: roundDebugMs(nowDebugMs() - startedAtMs),
					},
				});
			}
			return null;
		}
		const snapshotStore = this.getFileSnapshotStore();
		const snapshotReadStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const expectedGeneration =
			residentBase.docTable.generationByDocId[candidate.docId];
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
						engine: roundDebugMs(engineMs),
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
					engine: roundDebugMs(engineMs),
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

	finishBatchReindex(): void {
		this.batchReindexing = false;
		this.rebuildResidentBase();
	}

	abortBatchReindex(): void {
		this.batchReindexing = false;
	}

	private rebuildResidentBase(): void {
		this.engine = new CoverageLexicalV3Engine();
		this.engine.buildResidentBase(
			[...this.documentsByPath.values()],
			(text) => this.getDocumentTerms(text),
		);
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

	private async refineHanSurfaceCompletion(
		result: CoverageLexicalV3SearchResult,
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
			if (candidateRecall == null || !hasBodyTierHanCompletion(candidate)) {
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
					if (!confirmHanBodyBlockSurface(residentBase, blockId, group.surfaceText)) {
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

function cloneIndexedDocument(document: IndexedDocument): IndexedDocument {
	return {
		path: document.path,
		generation: document.generation,
		size: document.size,
		basename: document.basename,
		folder: document.folder,
		content: document.content,
		aliases: document.aliases,
		tags: document.tags,
		headings: document.headings,
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
