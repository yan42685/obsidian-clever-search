import type { ResidentBase } from "../layout/types";
import { isStrongHanGate } from "../prefix-fanout-guard";
import { encodeHanBigramId, encodeHanCharId, isSingletonHanStopChar } from "../query";
import { collectCandidateResidualSingletonHanTarget } from "../singleton-han";
import type { V3QueryAnalysis } from "../query/analysis";
import {
	collectBodyFamilyPostingBlockIds,
	collectHanBodyBlockIdsByChar,
	collectHanBodyBlockIds,
	collectHanMetadataDocIdsByChar,
	collectHanMetadataDocIds,
	collectPostingDocIds,
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
): V3CandidateDocRecall[] {
	const recallByDocId = new Map<number, RecallBucket>();
	for (const unitMatches of unitFamilyMatches) {
		for (const match of unitMatches.matches) {
			for (const docId of collectPostingDocIds(
				base.metadataContainers.identityPostings.postingStarts,
				base.metadataContainers.identityPostings.docIds,
				match.familyId,
			)) {
				getOrCreateRecallBucket(recallByDocId, docId).identity.add(
					unitMatches.queryUnitIndex,
				);
			}
			for (const docId of collectPostingDocIds(
				base.metadataContainers.routePostings.postingStarts,
				base.metadataContainers.routePostings.docIds,
				match.familyId,
			)) {
				getOrCreateRecallBucket(recallByDocId, docId).route.add(
					unitMatches.queryUnitIndex,
				);
			}
			for (const docId of collectPostingDocIds(
				base.metadataContainers.headingPostings.postingStarts,
				base.metadataContainers.headingPostings.docIds,
				match.familyId,
			)) {
				getOrCreateRecallBucket(recallByDocId, docId).heading.add(
					unitMatches.queryUnitIndex,
				);
			}
		}
	}

	for (const unitMatches of unitFamilyMatches) {
		for (const match of unitMatches.matches) {
			for (const blockId of collectBodyFamilyPostingBlockIds(base, match.familyId)) {
				const docId = base.bodyBlocks.docIdByBlockId[blockId] ?? -1;
				if (docId < 0) {
					continue;
				}
				const recallBucket = getOrCreateRecallBucket(recallByDocId, docId);
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
	routeHanRescueGroupsToRecallBuckets(base, resolvedHanSurfaceGroups, recallByDocId);
	routeSingletonHanToRecallBuckets(base, queryAnalysis, recallByDocId);
	routeGlobalResidualSingletonRescueToRecallBuckets(
		base,
		queryAnalysis,
		unitFamilyMatches,
		recallByDocId,
	);

	return [...recallByDocId.entries()]
		.map<V3CandidateDocRecall>(([docId, bucket]) => {
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
				docId,
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
		.sort((left, right) => left.docId - right.docId);
}

type RecallBucket = {
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
	recallByDocId: Map<number, RecallBucket>,
	docId: number,
): RecallBucket {
	const existing = recallByDocId.get(docId);
	if (existing != null) {
		return existing;
	}
	const created: RecallBucket = {
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
	recallByDocId.set(docId, created);
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
	recallByDocId: Map<number, RecallBucket>,
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
		const bucket = getOrCreateRecallBucket(recallByDocId, docId);
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
		const docId = base.bodyBlocks.docIdByBlockId[blockId] ?? -1;
		if (docId < 0) {
			continue;
		}
		const bucket = getOrCreateRecallBucket(recallByDocId, docId);
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
	recallByDocId: Map<number, RecallBucket>,
): void {
	if (
		!queryAnalysis.querySingletonHanRecallEligible ||
		queryAnalysis.querySingletonHanChar == null
	) {
		return;
	}
	const charId = encodeHanCharId(queryAnalysis.querySingletonHanChar);
	const existingDocIdsInOrder = [...recallByDocId.keys()];
	const existingBlockIdsInOrder = collectExistingBodyBlockIdsInOrder(recallByDocId);
	const metadataSingletonDocIds = collectHanMetadataDocIdsByChar(base, charId);
	const bodySingletonBlockIds = collectHanBodyBlockIdsByChar(base, charId);
	const metadataSingletonDocIdSet = new Set<number>(metadataSingletonDocIds);
	const bodySingletonBlockIdSet = new Set<number>(bodySingletonBlockIds);
	const finalMetadataDocIds = [
		...existingDocIdsInOrder.filter((docId) => metadataSingletonDocIdSet.has(docId)),
		...metadataSingletonDocIds.filter((docId) => !recallByDocId.has(docId)),
	].slice(0, 100);
	const finalBodyBlockIds = [
		...existingBlockIdsInOrder.filter((blockId) => bodySingletonBlockIdSet.has(blockId)),
		...bodySingletonBlockIds
			.filter((blockId) => !existingBlockIdsInOrder.includes(blockId))
			.sort((left, right) => left - right),
	].slice(0, 100);
	for (const docId of finalMetadataDocIds) {
		getOrCreateRecallBucket(recallByDocId, docId).hasQuerySingletonHanMetadataSupport = true;
	}
	for (const blockId of finalBodyBlockIds) {
		const docId = base.bodyBlocks.docIdByBlockId[blockId] ?? -1;
		if (docId < 0) {
			continue;
		}
		const recallBucket = getOrCreateRecallBucket(recallByDocId, docId);
		getOrCreateRecallBodyBlockBucket(recallBucket, blockId).hasSingletonHanSupport = true;
	}
}

function routeGlobalResidualSingletonRescueToRecallBuckets(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
	recallByDocId: Map<number, RecallBucket>,
): void {
	if (recallByDocId.size === 0) {
		return;
	}
	const queryBigramTexts = collectAllQueryHanBigramTexts(queryAnalysis);
	if (queryBigramTexts.length === 0) {
		return;
	}
	const singletonScopesByDocId = new Map<number, GlobalSingletonRecallScope>();
	for (const docId of recallByDocId.keys()) {
		singletonScopesByDocId.set(docId, createGlobalSingletonRecallScope());
	}
	for (const unitMatches of unitFamilyMatches) {
		if (unitMatches.matches.length === 0) {
			continue;
		}
		for (const match of unitMatches.matches) {
			for (const docId of collectPostingDocIds(
				base.metadataContainers.identityPostings.postingStarts,
				base.metadataContainers.identityPostings.docIds,
				match.familyId,
			)) {
				const scope = singletonScopesByDocId.get(docId);
				if (scope == null) {
					continue;
				}
				scope.matchedFamilyUnitIndices.add(unitMatches.queryUnitIndex);
				scope.hasMetadataFamilyAnchor = true;
			}
			for (const docId of collectPostingDocIds(
				base.metadataContainers.routePostings.postingStarts,
				base.metadataContainers.routePostings.docIds,
				match.familyId,
			)) {
				const scope = singletonScopesByDocId.get(docId);
				if (scope == null) {
					continue;
				}
				scope.matchedFamilyUnitIndices.add(unitMatches.queryUnitIndex);
				scope.hasMetadataFamilyAnchor = true;
			}
			for (const blockId of collectBodyFamilyPostingBlockIds(base, match.familyId)) {
				const docId = base.bodyBlocks.docIdByBlockId[blockId] ?? -1;
				const scope = singletonScopesByDocId.get(docId);
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
			const scope = singletonScopesByDocId.get(docId);
			if (scope == null) {
				continue;
			}
			scope.matchedHanBigramTexts.add(bigramText);
			scope.hasMetadataBigramAnchor = true;
		}
		for (const blockId of collectHanBodyBlockIds(base, bigramId)) {
			const docId = base.bodyBlocks.docIdByBlockId[blockId] ?? -1;
			const scope = singletonScopesByDocId.get(docId);
			if (scope == null) {
				continue;
			}
			scope.matchedHanBigramTexts.add(bigramText);
			scope.bodyBigramAnchorBlockIds.add(blockId);
		}
	}
	const singletonCharRouteCache = new Map<
		number,
		{ metadataDocIds: Set<number>; bodyBlockIds: Set<number> }
	>();
	for (const [docId, scope] of singletonScopesByDocId.entries()) {
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
				metadataDocIds: new Set(collectHanMetadataDocIdsByChar(base, charId)),
				bodyBlockIds: new Set(collectHanBodyBlockIdsByChar(base, charId)),
			};
			singletonCharRouteCache.set(charId, singletonCharRoute);
		}
		const recallBucket = recallByDocId.get(docId);
		if (recallBucket == null) {
			continue;
		}
		if (
			singletonCharRoute.metadataDocIds.has(docId) &&
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
			docId,
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
	recallByDocId: ReadonlyMap<number, RecallBucket>,
): number[] {
	const out: number[] = [];
	for (const bucket of recallByDocId.values()) {
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
	docId: number,
	anchorBlockIds: ReadonlySet<number>,
): number[] {
	const out = new Set<number>();
	for (const anchorBlockId of anchorBlockIds) {
		for (const candidateBlockId of [anchorBlockId - 1, anchorBlockId, anchorBlockId + 1]) {
			if ((base.bodyBlocks.docIdByBlockId[candidateBlockId] ?? -1) !== docId) {
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
