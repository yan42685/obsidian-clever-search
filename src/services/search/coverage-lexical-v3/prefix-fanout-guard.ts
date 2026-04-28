import type {
	V3CandidateBodyBlockRecall,
	V3CandidateDocRecall,
	V3HanRouteGateStats,
} from "./recall/types";

export const MIN_BODY_BLOCK_GUARD = 160;
export const TOTAL_BODY_BLOCK_GUARD = 256;
export const BODY_BLOCK_GUARD_MULTIPLIER = 4;
export const DEFAULT_GUARD_MAX_ITEM_RESULTS = 30;
export const ANCHORED_SOFT_BLOCK_BUDGET = computeAnchoredSoftBlockBudget(
	TOTAL_BODY_BLOCK_GUARD,
);

export type PrefixFanoutGuardStats = Readonly<{
	guardApplied: boolean;
	preCandidateDocCount: number;
	postCandidateDocCount: number;
	preTotalShortlistedBodyBlockCount: number;
	postTotalShortlistedBodyBlockCount: number;
	anchoredDocCount: number;
	unanchoredDocCount: number;
	anchoredKeptBlockCount: number;
	unanchoredKeptBlockCount: number;
	removedUnanchoredDocCount: number;
}>;

type GuardedDoc = Readonly<{
	candidateRecall: V3CandidateDocRecall;
	prioritizedBlocks: readonly V3CandidateBodyBlockRecall[];
	prioritizedCoreBlocks: readonly V3CandidateBodyBlockRecall[];
	prioritizedPrefixOnlyBlocks: readonly V3CandidateBodyBlockRecall[];
	protectedBlockCount: number;
	coreBlockCount: number;
	weakPrefixOnlyBlockCount: number;
	hasHanMetadataGate: boolean;
}>;

export function isStrongHanGate(stats: V3HanRouteGateStats): boolean {
	return (
		stats.bigramCoverageRatio >= 0.999 ||
		stats.longestContiguousBigramChain >= 2 ||
		(stats.matchedBigramCount >= 2 && stats.bigramCoverageRatio >= 0.5)
	);
}

export function hasMetadataAnchor(candidateRecall: V3CandidateDocRecall): boolean {
	return (
		candidateRecall.matchedIdentityUnitIndices.length > 0 ||
		candidateRecall.matchedRouteUnitIndices.length > 0 ||
		candidateRecall.matchedHeadingUnitIndices.length > 0 ||
		candidateRecall.hasQuerySingletonHanMetadataSupport ||
		hasHanMetadataGate(candidateRecall)
	);
}

export function computeBodyBlockGuard(maxItemResults: number): number {
	const safeMaxItemResults = Math.max(1, Math.floor(maxItemResults));
	return Math.min(
		TOTAL_BODY_BLOCK_GUARD,
		Math.max(MIN_BODY_BLOCK_GUARD, safeMaxItemResults * BODY_BLOCK_GUARD_MULTIPLIER),
	);
}

export function computeAnchoredSoftBlockBudget(totalBodyBlockGuard: number): number {
	return Math.floor(totalBodyBlockGuard * 0.7);
}

export function applyPrefixFanoutGuard(
	candidateDocs: readonly V3CandidateDocRecall[],
	maxItemResults = DEFAULT_GUARD_MAX_ITEM_RESULTS,
): Readonly<{
	candidateDocs: readonly V3CandidateDocRecall[];
	stats: PrefixFanoutGuardStats;
}> {
	const totalBodyBlockGuard = computeBodyBlockGuard(maxItemResults);
	const anchoredSoftBlockBudget = computeAnchoredSoftBlockBudget(totalBodyBlockGuard);
	const preCandidateDocCount = candidateDocs.length;
	const preTotalShortlistedBodyBlockCount = countTotalShortlistedBodyBlocks(candidateDocs);
	const anchored = candidateDocs
		.filter(hasMetadataAnchor)
		.map(buildGuardedDoc)
		.sort(compareAnchoredDocs);
	const unanchored = candidateDocs
		.filter((candidateRecall) => !hasMetadataAnchor(candidateRecall))
		.map(buildGuardedDoc)
		.sort(compareUnanchoredDocs);
	const anchoredDocCount = anchored.length;
	const unanchoredDocCount = unanchored.length;
	if (preTotalShortlistedBodyBlockCount <= totalBodyBlockGuard) {
		return {
			candidateDocs,
			stats: {
				guardApplied: false,
				preCandidateDocCount,
				postCandidateDocCount: preCandidateDocCount,
				preTotalShortlistedBodyBlockCount,
				postTotalShortlistedBodyBlockCount: preTotalShortlistedBodyBlockCount,
				anchoredDocCount,
				unanchoredDocCount,
				anchoredKeptBlockCount: anchored.reduce(
					(sum, doc) => sum + doc.prioritizedBlocks.length,
					0,
				),
				unanchoredKeptBlockCount: unanchored.reduce(
					(sum, doc) => sum + doc.prioritizedBlocks.length,
					0,
				),
				removedUnanchoredDocCount: 0,
			},
		};
	}

	const keptBlockIdsByCandidateKey = new Map<string, Set<number>>();
	const anchoredKeptBlockCount = allocateBlocksForDocs(
		anchored,
		anchoredSoftBlockBudget,
		keptBlockIdsByCandidateKey,
	);
	const unanchoredKeptBlockCount = allocateBlocksForDocs(
		unanchored,
		Math.max(0, totalBodyBlockGuard - anchoredKeptBlockCount),
		keptBlockIdsByCandidateKey,
	);

	const guardedCandidateDocs: V3CandidateDocRecall[] = [];
	let removedUnanchoredDocCount = 0;
	for (const candidateRecall of candidateDocs) {
		const keptBlockIds =
			keptBlockIdsByCandidateKey.get(buildCandidateGuardKey(candidateRecall)) ??
			EMPTY_BLOCK_SET;
		const guardedCandidateRecall = buildGuardedCandidateRecall(
			candidateRecall,
			keptBlockIds,
		);
		const anchoredDoc = hasMetadataAnchor(candidateRecall);
		if (anchoredDoc || guardedCandidateRecall.shortlistedBodyBlocks.length > 0) {
			guardedCandidateDocs.push(guardedCandidateRecall);
			continue;
		}
		removedUnanchoredDocCount += 1;
	}

	return {
		candidateDocs: guardedCandidateDocs,
		stats: {
			guardApplied: true,
			preCandidateDocCount,
			postCandidateDocCount: guardedCandidateDocs.length,
			preTotalShortlistedBodyBlockCount,
			postTotalShortlistedBodyBlockCount:
				countTotalShortlistedBodyBlocks(guardedCandidateDocs),
			anchoredDocCount,
			unanchoredDocCount,
			anchoredKeptBlockCount,
			unanchoredKeptBlockCount,
			removedUnanchoredDocCount,
		},
	};
}

const EMPTY_BLOCK_SET = new Set<number>();

function countTotalShortlistedBodyBlocks(
	candidateDocs: readonly V3CandidateDocRecall[],
): number {
	return candidateDocs.reduce(
		(sum, candidateRecall) => sum + candidateRecall.shortlistedBodyBlockIds.length,
		0,
	);
}

function buildGuardedDoc(candidateRecall: V3CandidateDocRecall): GuardedDoc {
	const prioritizedBlocks = [...candidateRecall.shortlistedBodyBlocks].sort(
		compareCandidateBodyBlocks,
	);
	const prioritizedCoreBlocks = prioritizedBlocks.filter(
		(block) => !isWeakPrefixOnlyBlock(block),
	);
	const prioritizedPrefixOnlyBlocks = prioritizedBlocks.filter((block) =>
		isWeakPrefixOnlyBlock(block),
	);
	return {
		candidateRecall,
		prioritizedBlocks,
		prioritizedCoreBlocks,
		prioritizedPrefixOnlyBlocks,
		protectedBlockCount: prioritizedBlocks.filter(
			(block) =>
				block.hasExactSupport ||
				block.hasStrongHanSupport ||
				block.hasSingletonHanSupport ||
				block.hasScopedSingletonHanSupport,
		).length,
		coreBlockCount: prioritizedCoreBlocks.length,
		weakPrefixOnlyBlockCount: prioritizedPrefixOnlyBlocks.length,
		hasHanMetadataGate: hasHanMetadataGate(candidateRecall),
	};
}

function compareCandidateBodyBlocks(
	left: V3CandidateBodyBlockRecall,
	right: V3CandidateBodyBlockRecall,
): number {
	return (
		Number(right.hasExactSupport) - Number(left.hasExactSupport) ||
		Number(right.hasStrongHanSupport) - Number(left.hasStrongHanSupport) ||
		Number(right.hasSingletonHanSupport) - Number(left.hasSingletonHanSupport) ||
		Number(right.hasScopedSingletonHanSupport) -
			Number(left.hasScopedSingletonHanSupport) ||
		Number(left.hasPrefixSupport) - Number(right.hasPrefixSupport) ||
		left.blockId - right.blockId
	);
}

function compareAnchoredDocs(left: GuardedDoc, right: GuardedDoc): number {
	return (
		right.candidateRecall.matchedIdentityUnitIndices.length -
			left.candidateRecall.matchedIdentityUnitIndices.length ||
		right.candidateRecall.matchedRouteUnitIndices.length -
			left.candidateRecall.matchedRouteUnitIndices.length ||
		right.candidateRecall.matchedHeadingUnitIndices.length -
			left.candidateRecall.matchedHeadingUnitIndices.length ||
		Number(right.hasHanMetadataGate) - Number(left.hasHanMetadataGate) ||
		right.protectedBlockCount - left.protectedBlockCount ||
		right.coreBlockCount - left.coreBlockCount ||
		compareCandidateGuardKeys(left.candidateRecall, right.candidateRecall)
	);
}

function compareUnanchoredDocs(left: GuardedDoc, right: GuardedDoc): number {
	return (
		right.protectedBlockCount - left.protectedBlockCount ||
		right.coreBlockCount - left.coreBlockCount ||
		left.weakPrefixOnlyBlockCount - right.weakPrefixOnlyBlockCount ||
		compareCandidateGuardKeys(left.candidateRecall, right.candidateRecall)
	);
}

function allocateBlocksForDocs(
	docs: readonly GuardedDoc[],
	budget: number,
	keptBlockIdsByCandidateKey: Map<string, Set<number>>,
): number {
	let remainingBudget = budget;
	remainingBudget = allocateBlocksForDocPass(
		docs,
		remainingBudget,
		keptBlockIdsByCandidateKey,
		(doc) => doc.prioritizedCoreBlocks,
	);
	remainingBudget = allocateBlocksForDocPass(
		docs,
		remainingBudget,
		keptBlockIdsByCandidateKey,
		(doc) => doc.prioritizedPrefixOnlyBlocks,
	);
	return budget - remainingBudget;
}

function allocateBlocksForDocPass(
	docs: readonly GuardedDoc[],
	remainingBudget: number,
	keptBlockIdsByCandidateKey: Map<string, Set<number>>,
	selectBlocks: (doc: GuardedDoc) => readonly V3CandidateBodyBlockRecall[],
): number {
	for (const doc of docs) {
		if (remainingBudget <= 0) {
			break;
		}
		const candidateKey = buildCandidateGuardKey(doc.candidateRecall);
		const blockIds =
			keptBlockIdsByCandidateKey.get(candidateKey) ?? new Set<number>();
		const availableBlocks = selectBlocks(doc).filter((block) => !blockIds.has(block.blockId));
		const keptBlocks = availableBlocks.slice(0, remainingBudget);
		if (keptBlocks.length === 0) {
			continue;
		}
		if (!keptBlockIdsByCandidateKey.has(candidateKey)) {
			keptBlockIdsByCandidateKey.set(candidateKey, blockIds);
		}
		for (const block of keptBlocks) {
			blockIds.add(block.blockId);
		}
		remainingBudget -= keptBlocks.length;
	}
	return remainingBudget;
}

function buildCandidateGuardKey(
	candidateRecall: Pick<
		V3CandidateDocRecall,
		"shardId" | "shardGeneration" | "liveDocSlot"
	>,
): string {
	return `${candidateRecall.shardId}:${candidateRecall.shardGeneration}:${candidateRecall.liveDocSlot}`;
}

function compareCandidateGuardKeys(
	left: Pick<V3CandidateDocRecall, "shardId" | "shardGeneration" | "liveDocSlot">,
	right: Pick<V3CandidateDocRecall, "shardId" | "shardGeneration" | "liveDocSlot">,
): number {
	return (
		left.shardId.localeCompare(right.shardId) ||
		left.shardGeneration - right.shardGeneration ||
		left.liveDocSlot - right.liveDocSlot
	);
}

function isWeakPrefixOnlyBlock(block: V3CandidateBodyBlockRecall): boolean {
	return (
		block.hasPrefixSupport &&
		!block.hasExactSupport &&
		!block.hasStrongHanSupport &&
		!block.hasSingletonHanSupport &&
		!block.hasScopedSingletonHanSupport
	);
}

function buildGuardedCandidateRecall(
	candidateRecall: V3CandidateDocRecall,
	keptBlockIds: ReadonlySet<number>,
): V3CandidateDocRecall {
	const shortlistedBodyBlocks = candidateRecall.shortlistedBodyBlocks.filter((block) =>
		keptBlockIds.has(block.blockId),
	);
	const shortlistedBodyBlockIds = shortlistedBodyBlocks.map((block) => block.blockId);
	return {
		...candidateRecall,
		shortlistedBodyBlocks,
		shortlistedBodyBlockIds,
		hanBodyBlockGateStats: candidateRecall.hanBodyBlockGateStats.filter((gate) =>
			keptBlockIds.has(gate.blockId),
		),
		hanSurfaceGroupRecalls: candidateRecall.hanSurfaceGroupRecalls.map((groupRecall) => ({
			...groupRecall,
			bodySeedBlockIds: groupRecall.bodySeedBlockIds.filter((blockId) =>
				keptBlockIds.has(blockId),
			),
			bodySeedBlockGates: groupRecall.bodySeedBlockGates.filter((gate) =>
				keptBlockIds.has(gate.blockId),
			),
		})),
	};
}

function hasHanMetadataGate(candidateRecall: V3CandidateDocRecall): boolean {
	return (
		candidateRecall.hanMetadataGateStats != null ||
		candidateRecall.hanSurfaceGroupRecalls.some(
			(groupRecall) => groupRecall.metadataGateStats != null,
		)
	);
}
