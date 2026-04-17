import type { ResidentBase } from "../layout/types";
import { encodeHanBigramId } from "../query";
import type { V3QueryAnalysis } from "../query/analysis";
import {
	collectBodyFamilyPostingBlockIds,
	collectHanBodyBlockIds,
	collectHanMetadataDocIds,
	collectPostingDocIds,
} from "./access";
import { planHanSurfaceGroupRecalls } from "./han-surface-groups";
import type {
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
				getOrCreateRecallBucket(recallByDocId, docId).bodyBlocks.add(blockId);
			}
		}
	}

	const resolvedHanSurfaceGroups = planHanSurfaceGroupRecalls(queryAnalysis);
	routeHanRescueGroupsToRecallBuckets(base, resolvedHanSurfaceGroups, recallByDocId);

	return [...recallByDocId.entries()]
		.map<V3CandidateDocRecall>(([docId, bucket]) => ({
			docId,
			matchedIdentityUnitIndices: [...bucket.identity].sort((left, right) => left - right),
			matchedRouteUnitIndices: [...bucket.route].sort((left, right) => left - right),
			matchedHeadingUnitIndices: [...bucket.heading].sort((left, right) => left - right),
			shortlistedBodyBlockIds: [...bucket.bodyBlocks].sort((left, right) => left - right),
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
		}))
		.sort((left, right) => left.docId - right.docId);
}

type RecallBucket = {
	identity: Set<number>;
	route: Set<number>;
	heading: Set<number>;
	bodyBlocks: Set<number>;
	hanMetadataGateStats: V3HanRouteGateStats | null;
	hanBodyBlockGateStatsByBlockId: Map<number, V3HanRouteGateStats>;
	hanSurfaceGroups: Map<number, RecallHanSurfaceGroupBucket>;
};

type RecallHanSurfaceGroupBucket = {
	surfaceGroupIndex: number;
	metadataGateStats: V3HanRouteGateStats | null;
	bodySeedBlocks: Set<number>;
	bodySeedBlockGateStatsByBlockId: Map<number, V3HanRouteGateStats>;
};

type MatchedHanPositionsByKeyAndGroup = Map<number, Map<number, Set<number>>>;

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
		bodyBlocks: new Set<number>(),
		hanMetadataGateStats: null,
		hanBodyBlockGateStatsByBlockId: new Map<number, V3HanRouteGateStats>(),
		hanSurfaceGroups: new Map<number, RecallHanSurfaceGroupBucket>(),
	};
	recallByDocId.set(docId, created);
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
		bucket.bodyBlocks.add(blockId);
		for (const [surfaceGroupIndex, matchedPositions] of matchedPositionsByGroup.entries()) {
			const totalBigramCount = totalBigramCountByGroupIndex.get(surfaceGroupIndex) ?? 0;
			if (totalBigramCount <= 0) {
				continue;
			}
			const stats = buildHanGateStats(totalBigramCount, matchedPositions);
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