import type { ResidentBase } from "../layout/types";
import { encodeHanBigramId, extractHanBigrams } from "../query";
import type { V3QueryAnalysis } from "../query/analysis";
import {
	collectBodyFamilyPostingBlockIds,
	collectHanBodyBlockIds,
	collectHanMetadataDocIds,
	collectPostingDocIds,
	confirmHanBodyBlockSurface,
} from "./access";
import type {
	V3CandidateDocRecall,
	V3HanBodyBlockGate,
	V3HanRouteGateStats,
	V3QueryUnitFamilyMatches,
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

	for (const unitMatches of unitFamilyMatches) {
		if (!shouldAttemptHanRealTermOpaqueFallback(queryAnalysis, unitMatches)) {
			continue;
		}
		routeHanBigramsToRecallBuckets(
			base,
			extractHanBigrams(unitMatches.queryUnitText).map(encodeHanBigramId),
			unitMatches.queryUnitText,
			recallByDocId,
		);
	}

	for (const hanBackstopGroup of queryAnalysis.hanBackstopGroups) {
		routeHanBigramsToRecallBuckets(
			base,
			hanBackstopGroup.bigrams.map(encodeHanBigramId),
			hanBackstopGroup.normalizedText,
			recallByDocId,
		);
	}

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
		bodyBlocks: new Set<number>(),
		hanMetadataGateStats: null,
		hanBodyBlockGateStatsByBlockId: new Map<number, V3HanRouteGateStats>(),
	};
	recallByDocId.set(docId, created);
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

function shouldAttemptHanRealTermOpaqueFallback(
	queryAnalysis: V3QueryAnalysis,
	unitMatches: V3QueryUnitFamilyMatches,
): boolean {
	const surfaceGroupIndex = unitMatches.querySurfaceGroupIndex;
	const surfaceText =
		surfaceGroupIndex == null
			? null
			: queryAnalysis.surfaceGroups[surfaceGroupIndex]?.text ?? null;
	return (
		unitMatches.queryUnitSource === "han_tokenizer_real" &&
		Array.from(unitMatches.queryUnitText).length >= 2 &&
		surfaceText === unitMatches.queryUnitText
	);
}

function routeHanBigramsToRecallBuckets(
	base: ResidentBase,
	bigramIds: readonly number[],
	surfaceText: string,
	recallByDocId: Map<number, RecallBucket>,
): void {
	if (bigramIds.length === 0) {
		return;
	}
	const matchedBigramPositionsByDoc = new Map<number, Set<number>>();
	const matchedBigramPositionsByBlock = new Map<number, Set<number>>();
	for (let position = 0; position < bigramIds.length; position += 1) {
		const bigramId = bigramIds[position];
		for (const docId of collectHanMetadataDocIds(base, bigramId)) {
			addMatchedBigramPosition(matchedBigramPositionsByDoc, docId, position);
		}
		for (const blockId of collectHanBodyBlockIds(base, bigramId)) {
			addMatchedBigramPosition(matchedBigramPositionsByBlock, blockId, position);
		}
	}
	for (const [docId, matchedPositions] of matchedBigramPositionsByDoc.entries()) {
		const bucket = getOrCreateRecallBucket(recallByDocId, docId);
		bucket.hanMetadataGateStats = chooseBetterHanGateStats(
			bucket.hanMetadataGateStats,
			buildHanGateStats(bigramIds.length, matchedPositions),
		);
	}
	for (const [blockId, matchedPositions] of matchedBigramPositionsByBlock.entries()) {
		const docId = base.bodyBlocks.docIdByBlockId[blockId] ?? -1;
		if (docId < 0) {
			continue;
		}
		const stats = buildHanGateStats(bigramIds.length, matchedPositions);
		if (!confirmHanBodyBlockSurface(base, blockId, surfaceText)) {
			continue;
		}
		const bucket = getOrCreateRecallBucket(recallByDocId, docId);
		bucket.bodyBlocks.add(blockId);
		const existing = bucket.hanBodyBlockGateStatsByBlockId.get(blockId) ?? null;
		bucket.hanBodyBlockGateStatsByBlockId.set(
			blockId,
			chooseBetterHanGateStats(existing, stats) ?? stats,
		);
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
