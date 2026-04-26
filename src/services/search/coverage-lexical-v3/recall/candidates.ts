import type { ResidentBase } from "../layout/types";
import {
	DEFAULT_RESIDENT_SHARD_GENERATION,
	DEFAULT_RESIDENT_SHARD_ID,
} from "../build/builder";
import { isStrongHanGate } from "../prefix-fanout-guard";
import { encodeHanBigramId, encodeHanCharId, isSingletonHanStopChar } from "../query";
import { collectCandidateResidualSingletonHanTarget } from "../singleton-han";
import type { V3QueryAnalysis } from "../query/analysis";
import {
	collectBodyFamilyPostingBlockIdsForShardLocalFamilySlot,
	collectHanBodyBlockIdsByChar,
	collectHanBodyBlockIds,
	collectHanMetadataDocIdsByChar,
	collectHanMetadataDocIds,
	collectPostingDocIdsForShardLocalFamilySlot,
	getDocIdForLiveDocSlot,
	getLiveDocSlot,
	getLiveDocSlotForBlockId,
} from "./access";
import { planHanSurfaceGroupRecallsAfterFamilyLookup } from "./han-surface-groups";
import type {
	V3CandidateBodyBlockRecall,
	V3CandidateDocRecall,
	V3HanBodyBlockGate,
	V3CandidateHanSurfaceGroupRecall,
	V3HanRouteGateStats,
	V3QueryUnitFamilyMatches,
	V3ResolvedHanSurfaceGroup,
} from "./types";

export function recallCandidateDocs(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	shardOwner: Readonly<{ shardId: string; shardGeneration: number }> = {
		shardId: DEFAULT_RESIDENT_SHARD_ID,
		shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
	},
): V3CandidateDocRecall[] {
	const recallByLiveDocSlot = new Map<number, RecallBucket>();
	for (const unitMatches of unitFamilyMatches) {
		for (const match of unitMatches.matches) {
			for (const docId of collectPostingDocIdsForShardLocalFamilySlot(
				base,
				base.metadataContainers.identityPostings.postingStarts,
				base.metadataContainers.identityPostings.docIds,
				match.shardLocalFamilySlot,
			)) {
				const liveDocSlot = getLiveDocSlot(base, docId);
				getOrCreateRecallBucket(recallByLiveDocSlot, docId, liveDocSlot).identity.add(
					unitMatches.queryUnitIndex,
				);
			}
			for (const docId of collectPostingDocIdsForShardLocalFamilySlot(
				base,
				base.metadataContainers.routePostings.postingStarts,
				base.metadataContainers.routePostings.docIds,
				match.shardLocalFamilySlot,
			)) {
				const liveDocSlot = getLiveDocSlot(base, docId);
				getOrCreateRecallBucket(recallByLiveDocSlot, docId, liveDocSlot).route.add(
					unitMatches.queryUnitIndex,
				);
			}
			for (const docId of collectPostingDocIdsForShardLocalFamilySlot(
				base,
				base.metadataContainers.headingPostings.postingStarts,
				base.metadataContainers.headingPostings.docIds,
				match.shardLocalFamilySlot,
			)) {
				const liveDocSlot = getLiveDocSlot(base, docId);
				getOrCreateRecallBucket(recallByLiveDocSlot, docId, liveDocSlot).heading.add(
					unitMatches.queryUnitIndex,
				);
			}
		}
	}

	for (const unitMatches of unitFamilyMatches) {
		for (const match of unitMatches.matches) {
			for (const blockId of collectBodyFamilyPostingBlockIdsForShardLocalFamilySlot(
				base,
				match.shardLocalFamilySlot,
			)) {
				const liveDocSlot = getLiveDocSlotForBlockId(base, blockId);
				if (liveDocSlot < 0) {
					continue;
				}
				const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
				const recallBucket = getOrCreateRecallBucket(
					recallByLiveDocSlot,
					docId,
					liveDocSlot,
				);
				const bodyBlock = getOrCreateRecallBodyBlockBucket(recallBucket, blockId);
				if (match.matchKind === "exact") {
					bodyBlock.hasExactSupport = true;
				}
				if (match.matchKind === "prefix") {
					bodyBlock.hasPrefixSupport = true;
				}
			}
		}
	}

	const resolvedHanSurfaceGroups = planHanSurfaceGroupRecallsAfterFamilyLookup(
		queryAnalysis,
		unitFamilyMatches,
	);
	routeHanRescueGroupsToRecallBuckets(base, resolvedHanSurfaceGroups, recallByLiveDocSlot);
	routeSingletonHanToRecallBuckets(base, queryAnalysis, recallByLiveDocSlot);
	routeGlobalResidualSingletonRescueToRecallBuckets(
		base,
		queryAnalysis,
		unitFamilyMatches,
		recallByLiveDocSlot,
	);

	return [...recallByLiveDocSlot.values()]
		.map<V3CandidateDocRecall>((bucket) => {
			const shortlistedBodyBlocks = [...bucket.bodyBlocks.values()]
				.map<V3CandidateBodyBlockRecall>((bodyBlock) => ({
					blockId: bodyBlock.blockId,
					hasExactSupport: bodyBlock.hasExactSupport,
					hasPrefixSupport: bodyBlock.hasPrefixSupport,
					hasStrongHanSupport: bodyBlock.hasStrongHanSupport,
					hasSingletonHanSupport: bodyBlock.hasSingletonHanSupport,
					hasScopedSingletonHanSupport: bodyBlock.hasScopedSingletonHanSupport,
				}))
				.sort((left, right) => left.blockId - right.blockId);
			return {
				shardId: shardOwner.shardId,
				shardGeneration: shardOwner.shardGeneration,
				docId: bucket.docId,
				liveDocSlot: bucket.liveDocSlot,
				matchedIdentityUnitIndices: [...bucket.identity].sort((left, right) => left - right),
				matchedRouteUnitIndices: [...bucket.route].sort((left, right) => left - right),
				matchedHeadingUnitIndices: [...bucket.heading].sort((left, right) => left - right),
				hasQuerySingletonHanMetadataSupport: bucket.hasQuerySingletonHanMetadataSupport,
				hasScopedSingletonHanMetadataSupport:
					bucket.hasScopedSingletonHanMetadataSupport,
				shortlistedBodyBlocks,
				shortlistedBodyBlockIds: shortlistedBodyBlocks.map((bodyBlock) => bodyBlock.blockId),
				hanMetadataGateStats: bucket.hanMetadataGateStats,
				hanBodyBlockGateStats: [...bucket.hanBodyBlockGateStatsByBlockId.entries()]
					.map<V3HanBodyBlockGate>(([blockId, stats]) => ({
						blockId,
						stats,
					}))
					.sort((left, right) => left.blockId - right.blockId),
				hanSurfaceGroupRecalls: [...bucket.hanSurfaceGroups.values()]
					.map<V3CandidateHanSurfaceGroupRecall>((group) => ({
						surfaceGroupIndex: group.surfaceGroupIndex,
						metadataGateStats: group.metadataGateStats,
						bodySeedBlockIds: [...group.bodySeedBlocks].sort((left, right) => left - right),
						bodySeedBlockGates: [...group.bodySeedBlockGateStatsByBlockId.entries()]
							.map<V3HanBodyBlockGate>(([blockId, stats]) => ({
								blockId,
								stats,
							}))
							.sort((left, right) => left.blockId - right.blockId),
				}))
				.sort((left, right) => left.surfaceGroupIndex - right.surfaceGroupIndex),
			};
		})
		.sort((left, right) => left.liveDocSlot - right.liveDocSlot);
}

type RecallBucket = {
	docId: number;
	liveDocSlot: number;
	identity: Set<number>;
	route: Set<number>;
	heading: Set<number>;
	hasQuerySingletonHanMetadataSupport: boolean;
	hasScopedSingletonHanMetadataSupport: boolean;
	bodyBlocks: Map<number, RecallBodyBlockBucket>;
	hanMetadataGateStats: V3HanRouteGateStats | null;
	hanBodyBlockGateStatsByBlockId: Map<number, V3HanRouteGateStats>;
	hanSurfaceGroups: Map<number, RecallHanSurfaceGroupBucket>;
};

type RecallBodyBlockBucket = {
	blockId: number;
	hasExactSupport: boolean;
	hasPrefixSupport: boolean;
	hasStrongHanSupport: boolean;
	hasSingletonHanSupport: boolean;
	hasScopedSingletonHanSupport: boolean;
};

type RecallHanSurfaceGroupBucket = {
	surfaceGroupIndex: number;
	metadataGateStats: V3HanRouteGateStats | null;
	bodySeedBlocks: Set<number>;
	bodySeedBlockGateStatsByBlockId: Map<number, V3HanRouteGateStats>;
};

type MatchedHanPositionsByKeyAndGroup = Map<number, Map<number, Set<number>>>;

type GlobalSingletonRecallScope = {
	matchedFamilyUnitIndices: Set<number>;
	matchedHanBigramTexts: Set<string>;
	hasMetadataFamilyAnchor: boolean;
	hasMetadataBigramAnchor: boolean;
	bodyFamilyAnchorBlockIds: Set<number>;
	bodyBigramAnchorBlockIds: Set<number>;
};

function getOrCreateRecallBucket(
	recallByLiveDocSlot: Map<number, RecallBucket>,
	docId: number,
	liveDocSlot: number,
): RecallBucket {
	const existing = recallByLiveDocSlot.get(liveDocSlot);
	if (existing != null) {
		return existing;
	}
	const created: RecallBucket = {
		docId,
		liveDocSlot,
		identity: new Set<number>(),
		route: new Set<number>(),
		heading: new Set<number>(),
		hasQuerySingletonHanMetadataSupport: false,
		hasScopedSingletonHanMetadataSupport: false,
		bodyBlocks: new Map<number, RecallBodyBlockBucket>(),
		hanMetadataGateStats: null,
		hanBodyBlockGateStatsByBlockId: new Map<number, V3HanRouteGateStats>(),
		hanSurfaceGroups: new Map<number, RecallHanSurfaceGroupBucket>(),
	};
	recallByLiveDocSlot.set(liveDocSlot, created);
	return created;
}

function getOrCreateRecallBodyBlockBucket(
	recallBucket: RecallBucket,
	blockId: number,
): RecallBodyBlockBucket {
	const existing = recallBucket.bodyBlocks.get(blockId);
	if (existing != null) {
		return existing;
	}
	const created: RecallBodyBlockBucket = {
		blockId,
		hasExactSupport: false,
		hasPrefixSupport: false,
		hasStrongHanSupport: false,
		hasSingletonHanSupport: false,
		hasScopedSingletonHanSupport: false,
	};
	recallBucket.bodyBlocks.set(blockId, created);
	return created;
}

function getOrCreateRecallHanSurfaceGroupBucket(
	recallBucket: RecallBucket,
	surfaceGroupIndex: number,
): RecallHanSurfaceGroupBucket {
	const existing = recallBucket.hanSurfaceGroups.get(surfaceGroupIndex);
	if (existing != null) {
		return existing;
	}
	const created: RecallHanSurfaceGroupBucket = {
		surfaceGroupIndex,
		metadataGateStats: null,
		bodySeedBlocks: new Set<number>(),
		bodySeedBlockGateStatsByBlockId: new Map<number, V3HanRouteGateStats>(),
	};
	recallBucket.hanSurfaceGroups.set(surfaceGroupIndex, created);
	return created;
}

function addMatchedBigramPosition(
	target: Map<number, Set<number>>,
	key: number,
	position: number,
): void {
	const existing = target.get(key);
	if (existing != null) {
		existing.add(position);
		return;
	}
	target.set(key, new Set<number>([position]));
}

function addMatchedGroupBigramPosition(
	target: MatchedHanPositionsByKeyAndGroup,
	key: number,
	surfaceGroupIndex: number,
	position: number,
): void {
	let positionsByGroup = target.get(key);
	if (positionsByGroup == null) {
		positionsByGroup = new Map<number, Set<number>>();
		target.set(key, positionsByGroup);
	}
	addMatchedBigramPosition(positionsByGroup, surfaceGroupIndex, position);
}

function routeHanRescueGroupsToRecallBuckets(
	base: ResidentBase,
	resolvedHanSurfaceGroups: readonly V3ResolvedHanSurfaceGroup[],
	recallByLiveDocSlot: Map<number, RecallBucket>,
): void {
	const rescueGroups = resolvedHanSurfaceGroups.filter(
		(group) => group.rescueBigrams.length > 0,
	);
	if (rescueGroups.length === 0) {
		return;
	}
	const totalBigramCountByGroupIndex = new Map<number, number>();
	const routingRefsByBigramId = new Map<
		number,
		Array<{ surfaceGroupIndex: number; position: number }>
	>();
	for (const group of rescueGroups) {
		totalBigramCountByGroupIndex.set(group.surfaceGroupIndex, group.rescueBigrams.length);
		for (let position = 0; position < group.rescueBigrams.length; position += 1) {
			const bigramId = encodeHanBigramId(group.rescueBigrams[position]);
			const existing = routingRefsByBigramId.get(bigramId);
			const ref = {
				surfaceGroupIndex: group.surfaceGroupIndex,
				position,
			};
			if (existing != null) {
				existing.push(ref);
				continue;
			}
			routingRefsByBigramId.set(bigramId, [ref]);
		}
	}
	const matchedMetadataPositionsByDocAndGroup: MatchedHanPositionsByKeyAndGroup = new Map();
	const matchedBodyPositionsByBlockAndGroup: MatchedHanPositionsByKeyAndGroup = new Map();
	for (const [bigramId, refs] of routingRefsByBigramId.entries()) {
		for (const docId of collectHanMetadataDocIds(base, bigramId)) {
			for (const ref of refs) {
				addMatchedGroupBigramPosition(
					matchedMetadataPositionsByDocAndGroup,
					docId,
					ref.surfaceGroupIndex,
					ref.position,
				);
			}
		}
		for (const blockId of collectHanBodyBlockIds(base, bigramId)) {
			for (const ref of refs) {
				addMatchedGroupBigramPosition(
					matchedBodyPositionsByBlockAndGroup,
					blockId,
					ref.surfaceGroupIndex,
					ref.position,
				);
			}
		}
	}
	for (const [docId, matchedPositionsByGroup] of matchedMetadataPositionsByDocAndGroup.entries()) {
		const liveDocSlot = getLiveDocSlot(base, docId);
		const bucket = getOrCreateRecallBucket(recallByLiveDocSlot, docId, liveDocSlot);
		for (const [surfaceGroupIndex, matchedPositions] of matchedPositionsByGroup.entries()) {
			const totalBigramCount = totalBigramCountByGroupIndex.get(surfaceGroupIndex) ?? 0;
			if (totalBigramCount <= 0) {
				continue;
			}
			const stats = buildHanGateStats(totalBigramCount, matchedPositions);
			bucket.hanMetadataGateStats = chooseBetterHanGateStats(bucket.hanMetadataGateStats, stats);
			const groupBucket = getOrCreateRecallHanSurfaceGroupBucket(bucket, surfaceGroupIndex);
			groupBucket.metadataGateStats = chooseBetterHanGateStats(
				groupBucket.metadataGateStats,
				stats,
			);
		}
	}
	for (const [blockId, matchedPositionsByGroup] of matchedBodyPositionsByBlockAndGroup.entries()) {
		const liveDocSlot = getLiveDocSlotForBlockId(base, blockId);
		if (liveDocSlot < 0) {
			continue;
		}
		const docId = getDocIdForLiveDocSlot(base, liveDocSlot);
		const bucket = getOrCreateRecallBucket(recallByLiveDocSlot, docId, liveDocSlot);
		const bodyBlock = getOrCreateRecallBodyBlockBucket(bucket, blockId);
		for (const [surfaceGroupIndex, matchedPositions] of matchedPositionsByGroup.entries()) {
			const totalBigramCount = totalBigramCountByGroupIndex.get(surfaceGroupIndex) ?? 0;
			if (totalBigramCount <= 0) {
				continue;
			}
			const stats = buildHanGateStats(totalBigramCount, matchedPositions);
			if (isStrongHanGate(stats)) {
				bodyBlock.hasStrongHanSupport = true;
			}
			const existing = bucket.hanBodyBlockGateStatsByBlockId.get(blockId) ?? null;
			bucket.hanBodyBlockGateStatsByBlockId.set(
				blockId,
				chooseBetterHanGateStats(existing, stats) ?? stats,
			);
			const groupBucket = getOrCreateRecallHanSurfaceGroupBucket(bucket, surfaceGroupIndex);
			groupBucket.bodySeedBlocks.add(blockId);
			const existingGroupStats =
				groupBucket.bodySeedBlockGateStatsByBlockId.get(blockId) ?? null;
			groupBucket.bodySeedBlockGateStatsByBlockId.set(
				blockId,
				chooseBetterHanGateStats(existingGroupStats, stats) ?? stats,
			);
		}
	}
}

function routeSingletonHanToRecallBuckets(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	recallByLiveDocSlot: Map<number, RecallBucket>,
): void {
	if (
		!queryAnalysis.querySingletonHanRecallEligible ||
		queryAnalysis.querySingletonHanChar == null
	) {
		return;
	}
	const charId = encodeHanCharId(queryAnalysis.querySingletonHanChar);
	const existingLiveDocSlotsInOrder = [...recallByLiveDocSlot.keys()];
	const existingBlockIdsInOrder = collectExistingBodyBlockIdsInOrder(recallByLiveDocSlot);
	const metadataSingletonLiveDocSlots = [
		...new Set(
			collectHanMetadataDocIdsByChar(base, charId).map((docId) =>
				getLiveDocSlot(base, docId),
			),
		),
	];
	const bodySingletonBlockIds = collectHanBodyBlockIdsByChar(base, charId);
	const metadataSingletonLiveDocSlotSet = new Set<number>(metadataSingletonLiveDocSlots);
	const bodySingletonBlockIdSet = new Set<number>(bodySingletonBlockIds);
	const finalMetadataLiveDocSlots = [
		...existingLiveDocSlotsInOrder.filter((liveDocSlot) =>
			metadataSingletonLiveDocSlotSet.has(liveDocSlot),
		),
		...metadataSingletonLiveDocSlots.filter(
			(liveDocSlot) => !recallByLiveDocSlot.has(liveDocSlot),
		),
	].slice(0, 100);
	const finalBodyBlockIds = [
		...existingBlockIdsInOrder.filter((blockId) => bodySingletonBlockIdSet.has(blockId)),
		...bodySingletonBlockIds
			.filter((blockId) => !existingBlockIdsInOrder.includes(blockId))
			.sort((left, right) => left - right),
	].slice(0, 100);
	for (const liveDocSlot of finalMetadataLiveDocSlots) {
		getOrCreateRecallBucket(
			recallByLiveDocSlot,
			getDocIdForLiveDocSlot(base, liveDocSlot),
			liveDocSlot,
		).hasQuerySingletonHanMetadataSupport = true;
	}
	for (const blockId of finalBodyBlockIds) {
		const liveDocSlot = getLiveDocSlotForBlockId(base, blockId);
		if (liveDocSlot < 0) {
			continue;
		}
		const recallBucket = getOrCreateRecallBucket(
			recallByLiveDocSlot,
			getDocIdForLiveDocSlot(base, liveDocSlot),
			liveDocSlot,
		);
		getOrCreateRecallBodyBlockBucket(recallBucket, blockId).hasSingletonHanSupport = true;
	}
}

function routeGlobalResidualSingletonRescueToRecallBuckets(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	recallByLiveDocSlot: Map<number, RecallBucket>,
): void {
	if (recallByLiveDocSlot.size === 0) {
		return;
	}
	const queryBigramTexts = collectAllQueryHanBigramTexts(queryAnalysis);
	if (queryBigramTexts.length === 0) {
		return;
	}
	const singletonScopesByLiveDocSlot = new Map<number, GlobalSingletonRecallScope>();
	for (const liveDocSlot of recallByLiveDocSlot.keys()) {
		singletonScopesByLiveDocSlot.set(liveDocSlot, createGlobalSingletonRecallScope());
	}
	for (const unitMatches of unitFamilyMatches) {
		if (unitMatches.matches.length === 0) {
			continue;
		}
		for (const match of unitMatches.matches) {
			for (const docId of collectPostingDocIdsForShardLocalFamilySlot(
				base,
				base.metadataContainers.identityPostings.postingStarts,
				base.metadataContainers.identityPostings.docIds,
				match.shardLocalFamilySlot,
			)) {
				const scope = singletonScopesByLiveDocSlot.get(getLiveDocSlot(base, docId));
				if (scope == null) {
					continue;
				}
				scope.matchedFamilyUnitIndices.add(unitMatches.queryUnitIndex);
				scope.hasMetadataFamilyAnchor = true;
			}
			for (const docId of collectPostingDocIdsForShardLocalFamilySlot(
				base,
				base.metadataContainers.routePostings.postingStarts,
				base.metadataContainers.routePostings.docIds,
				match.shardLocalFamilySlot,
			)) {
				const scope = singletonScopesByLiveDocSlot.get(getLiveDocSlot(base, docId));
				if (scope == null) {
					continue;
				}
				scope.matchedFamilyUnitIndices.add(unitMatches.queryUnitIndex);
				scope.hasMetadataFamilyAnchor = true;
			}
			for (const blockId of collectBodyFamilyPostingBlockIdsForShardLocalFamilySlot(
				base,
				match.shardLocalFamilySlot,
			)) {
				const scope = singletonScopesByLiveDocSlot.get(
					getLiveDocSlotForBlockId(base, blockId),
				);
				if (scope == null) {
					continue;
				}
				scope.matchedFamilyUnitIndices.add(unitMatches.queryUnitIndex);
				scope.bodyFamilyAnchorBlockIds.add(blockId);
			}
		}
	}
	for (const bigramText of queryBigramTexts) {
		const bigramId = encodeHanBigramId(bigramText);
		for (const docId of collectHanMetadataDocIds(base, bigramId)) {
			const scope = singletonScopesByLiveDocSlot.get(getLiveDocSlot(base, docId));
			if (scope == null) {
				continue;
			}
			scope.matchedHanBigramTexts.add(bigramText);
			scope.hasMetadataBigramAnchor = true;
		}
		for (const blockId of collectHanBodyBlockIds(base, bigramId)) {
			const scope = singletonScopesByLiveDocSlot.get(
				getLiveDocSlotForBlockId(base, blockId),
			);
			if (scope == null) {
				continue;
			}
			scope.matchedHanBigramTexts.add(bigramText);
			scope.bodyBigramAnchorBlockIds.add(blockId);
		}
	}
	const singletonCharRouteCache = new Map<
		number,
		{ metadataLiveDocSlots: Set<number>; bodyBlockIds: Set<number> }
	>();
	for (const [liveDocSlot, scope] of singletonScopesByLiveDocSlot.entries()) {
		if (
			scope.matchedFamilyUnitIndices.size === 0 &&
			scope.matchedHanBigramTexts.size === 0
		) {
			continue;
		}
		const residualTarget = collectCandidateResidualSingletonHanTarget(
			queryAnalysis,
			[...scope.matchedFamilyUnitIndices]
				.map((queryUnitIndex) => queryAnalysis.primaryUnits[queryUnitIndex] ?? null)
				.filter((unit): unit is NonNullable<typeof unit> => unit != null)
				.map((unit) => ({
					querySurfaceGroupIndex: unit.surfaceGroupIndex,
					queryUnitText: unit.text,
					familyText: unit.text,
					matchKind: "exact",
				})),
			[...scope.matchedHanBigramTexts]
				.sort((left, right) => left.localeCompare(right))
				.map((bigramText) => ({
					bigramText,
					surfaceGroupIndex: null,
				})),
		);
		if (
			residualTarget == null ||
			residualTarget.singletonHanChar.length === 0 ||
			isSingletonHanStopChar(residualTarget.singletonHanChar)
		) {
			continue;
		}
		const charId = encodeHanCharId(residualTarget.singletonHanChar);
		let singletonCharRoute = singletonCharRouteCache.get(charId);
		if (singletonCharRoute == null) {
			singletonCharRoute = {
				metadataLiveDocSlots: new Set(
					collectHanMetadataDocIdsByChar(base, charId).map((docId) =>
						getLiveDocSlot(base, docId),
					),
				),
				bodyBlockIds: new Set(collectHanBodyBlockIdsByChar(base, charId)),
			};
			singletonCharRouteCache.set(charId, singletonCharRoute);
		}
		const recallBucket = recallByLiveDocSlot.get(liveDocSlot);
		if (recallBucket == null) {
			continue;
		}
		if (
			singletonCharRoute.metadataLiveDocSlots.has(liveDocSlot) &&
			(scope.hasMetadataFamilyAnchor || scope.hasMetadataBigramAnchor)
		) {
			recallBucket.hasScopedSingletonHanMetadataSupport = true;
		}
		const anchorBlockIds = new Set<number>([
			...scope.bodyFamilyAnchorBlockIds,
			...scope.bodyBigramAnchorBlockIds,
		]);
		if (anchorBlockIds.size === 0) {
			continue;
		}
		const scopedBlockIds = collectScopedSingletonAnchorNeighborhoodBlockIds(
			base,
			liveDocSlot,
			anchorBlockIds,
		);
		const matchedSingletonBodyBlockIds = scopedBlockIds.filter((blockId) =>
			singletonCharRoute?.bodyBlockIds.has(blockId),
		);
		if (matchedSingletonBodyBlockIds.length === 0) {
			continue;
		}
		for (const blockId of anchorBlockIds) {
			getOrCreateRecallBodyBlockBucket(recallBucket, blockId).hasScopedSingletonHanSupport =
				true;
		}
	}
}

function collectExistingBodyBlockIdsInOrder(
	recallByLiveDocSlot: ReadonlyMap<number, RecallBucket>,
): number[] {
	const out: number[] = [];
	for (const bucket of recallByLiveDocSlot.values()) {
		for (const blockId of bucket.bodyBlocks.keys()) {
			out.push(blockId);
		}
	}
	return out;
}

function createGlobalSingletonRecallScope(): GlobalSingletonRecallScope {
	return {
		matchedFamilyUnitIndices: new Set<number>(),
		matchedHanBigramTexts: new Set<string>(),
		hasMetadataFamilyAnchor: false,
		hasMetadataBigramAnchor: false,
		bodyFamilyAnchorBlockIds: new Set<number>(),
		bodyBigramAnchorBlockIds: new Set<number>(),
	};
}

function collectAllQueryHanBigramTexts(
	queryAnalysis: V3QueryAnalysis,
): readonly string[] {
	return [
		...new Set(
			queryAnalysis.surfaceGroups.flatMap((group) =>
				group.kind === "han" ? group.hanBigramTexts : [],
			),
		),
	].sort((left, right) => left.localeCompare(right));
}

function collectScopedSingletonAnchorNeighborhoodBlockIds(
	base: ResidentBase,
	liveDocSlot: number,
	anchorBlockIds: ReadonlySet<number>,
): number[] {
	const out = new Set<number>();
	for (const anchorBlockId of anchorBlockIds) {
		for (const candidateBlockId of [anchorBlockId - 1, anchorBlockId, anchorBlockId + 1]) {
			if (getLiveDocSlotForBlockId(base, candidateBlockId) !== liveDocSlot) {
				continue;
			}
			out.add(candidateBlockId);
		}
	}
	return [...out].sort((left, right) => left - right);
}

function buildHanGateStats(
	totalBigramCount: number,
	matchedPositions: ReadonlySet<number>,
): V3HanRouteGateStats {
	const matchedBigramCount = matchedPositions.size;
	let longestContiguousBigramChain = 0;
	let currentChain = 0;
	for (let index = 0; index < totalBigramCount; index += 1) {
		if (matchedPositions.has(index)) {
			currentChain += 1;
			longestContiguousBigramChain = Math.max(
				longestContiguousBigramChain,
				currentChain,
			);
			continue;
		}
		currentChain = 0;
	}
	return {
		matchedBigramCount,
		longestContiguousBigramChain,
		bigramCoverageRatio:
			totalBigramCount > 0 ? matchedBigramCount / totalBigramCount : 0,
	};
}

function chooseBetterHanGateStats(
	left: V3HanRouteGateStats | null,
	right: V3HanRouteGateStats | null,
): V3HanRouteGateStats | null {
	if (left == null) {
		return right;
	}
	if (right == null) {
		return left;
	}
	if (left.matchedBigramCount !== right.matchedBigramCount) {
		return left.matchedBigramCount > right.matchedBigramCount ? left : right;
	}
	if (
		left.longestContiguousBigramChain !== right.longestContiguousBigramChain
	) {
		return left.longestContiguousBigramChain > right.longestContiguousBigramChain
			? left
			: right;
	}
	if (left.bigramCoverageRatio !== right.bigramCoverageRatio) {
		return left.bigramCoverageRatio > right.bigramCoverageRatio ? left : right;
	}
	return left;
}
