import type {
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { buildDirectSubitemsExactFileSubItems } from "src/services/search/coverage-lexical/direct-subitems";
import { Tokenizer } from "src/services/search/tokenizer";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import {
	CoverageLexicalV3Engine,
	type CoverageLexicalV3SearchResult,
} from "./engine";
import type {
	ResidentBase,
	ResidentBaseMetrics,
	ResidentBaseSummary,
} from "./layout/types";
import { splitBodyBlocksWithDocumentTokenizer } from "./query";
import type { V3CandidateDocRecall } from "./recall";
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

const MAX_HAN_RAW_REFINE_BLOCKS_PER_DOC = 96;
const MAX_HAN_RAW_REFINE_BLOCKS_PER_QUERY = 384;

@singleton()
export class CoverageLexicalV3FileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private engine = new CoverageLexicalV3Engine();
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
		const searchTerms = this.getQueryTerms(queryText);
		const result = this.engine.search(queryText, searchTerms);
		const refinedCandidates = await this.refineHanSurfaceCompletion(result);
		const visibleCandidates = request.hideWeaklyRelatedResults
			? filterToTopCoverageGateBand(refinedCandidates)
			: refinedCandidates;
		const queryTerms = result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text);
		return visibleCandidates.slice(0, request.maxItemResults).map((candidate) => ({
			path: candidate.path,
			queryTerms,
			matchedTerms: buildMatchedTerms(candidate, result),
			score: candidate.realizedCoverageCount,
			directSubItems: [],
			nativeSubItemsReady: false,
		}));
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
		const snapshotText = (
			await this.getFileSnapshotStore().readCurrentTexts([path])
		).get(path);
		if (!snapshotText) {
			return null;
		}
		return buildDirectSubitemsExactFileSubItems({
			queryText,
			snapshotText,
			options: {
				maxChars: 220,
				mergeGap: 32,
				contextLeft: 24,
				contextRight: 40,
				boundaryLookaround: 24,
			},
		}).slice(0, maxSubItemResults);
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
		const scheduledCandidates: EvidencePackingProfile[] = [];
		let projectedQueryBlockBudget = 0;
		for (let candidateIndex = 0; candidateIndex < result.rankedCandidates.length; candidateIndex += 1) {
			const candidate = result.rankedCandidates[candidateIndex];
			const candidateRecall = candidateRecallByDocId.get(candidate.docId);
			if (candidateRecall == null || !hasBodyTierHanCompletion(candidate)) {
				continue;
			}
			if (!hasHanRawRefineNearTieRisk(result.rankedCandidates, candidateIndex)) {
				continue;
			}
			const projectedDocBlocks = Math.min(
				MAX_HAN_RAW_REFINE_BLOCKS_PER_DOC,
				candidateRecall.shortlistedBodyBlockIds.length,
			);
			if (projectedDocBlocks <= 0) {
				continue;
			}
			if (projectedQueryBlockBudget >= MAX_HAN_RAW_REFINE_BLOCKS_PER_QUERY) {
				break;
			}
			scheduledCandidates.push(candidate);
			projectedQueryBlockBudget += Math.min(
				projectedDocBlocks,
				MAX_HAN_RAW_REFINE_BLOCKS_PER_QUERY - projectedQueryBlockBudget,
			);
		}
		if (scheduledCandidates.length === 0) {
			return result.rankedCandidates;
		}
		const indexedTexts = await this.getFileSnapshotStore().readIndexedTexts(
			scheduledCandidates.map((candidate) => ({
				path: candidate.path,
				generation: residentBase.docTable.generationByDocId[candidate.docId],
			})),
		);
		const refinedCandidates = new Map<number, EvidencePackingProfile>();
		let remainingQueryBlockBudget = MAX_HAN_RAW_REFINE_BLOCKS_PER_QUERY;
		for (const candidate of scheduledCandidates) {
			if (remainingQueryBlockBudget <= 0) {
				break;
			}
			const indexedText = indexedTexts.get(candidate.path);
			const candidateRecall = candidateRecallByDocId.get(candidate.docId);
			if (indexedText == null || candidateRecall == null) {
				continue;
			}
			const prioritizedBlockIds = prioritizeShortlistedBlockIds(
				residentBase,
				candidate,
				candidateRecall,
			);
			const inspectBlockIds = prioritizedBlockIds.slice(
				0,
				Math.min(MAX_HAN_RAW_REFINE_BLOCKS_PER_DOC, remainingQueryBlockBudget),
			);
			remainingQueryBlockBudget -= inspectBlockIds.length;
			if (inspectBlockIds.length === 0) {
				continue;
			}
			const runtimeBlocks = splitBodyBlocksWithDocumentTokenizer(
				indexedText,
				(text) => this.getDocumentTerms(text),
			);
			const confirmedTierByGroupIndex = new Map<number, BodyHanCompletionTier>();
			const bestBodyWindowBlockIds = new Set(candidate.bodyWindowContainer?.blockIds ?? []);
			for (const blockId of inspectBlockIds) {
				const blockOrdinal = residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId;
				const runtimeBlock = runtimeBlocks[blockOrdinal];
				if (runtimeBlock == null) {
					continue;
				}
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
					if (!runtimeBlock.normalizedText.includes(group.surfaceText)) {
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

function hasHanRawRefineNearTieRisk(
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
