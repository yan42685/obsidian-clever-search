import {
	HYBRID_LEXICAL_LANE_FILE_SHORTLIST,
	HYBRID_LEXICAL_LANE_DISPLAY_TOP_K,
	HYBRID_LEXICAL_LANE_GLOBAL_POOL_MAX,
	HYBRID_LEXICAL_LANE_MAX_BLOCKS_PER_FILE,
	HYBRID_LEXICAL_LANE_RERANK_TOP_K,
} from "./config";
import { buildHybridLexicalLaneDisplayCandidates } from "./display-window";
import { buildHybridLexicalLaneFileItems } from "./result-mapper";
import {
	mergeHybridLexicalLaneDisplayCandidates,
	mergeHybridLexicalLaneRankedBlocks,
} from "./result-merge";
import { rankHybridLexicalLaneBlockCandidates } from "./block-ranker";
import { buildHybridLexicalLaneFileShortlist } from "./file-shortlist";
import { buildHybridLexicalLaneLocalBlockCandidates } from "./local-block-recall";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneDisplayCandidate,
	HybridLexicalLaneFileCandidate,
} from "./contracts";

export * from "./contracts";
export * from "./config";
export * from "./file-shortlist";
export * from "./local-block-recall";
export * from "./block-ranker";
export * from "./display-window";
export * from "./result-merge";
export * from "./result-mapper";

export async function prepareHybridLexicalLaneSearch(params: {
	queryText: string;
	files?: readonly HybridLexicalLaneFileCandidate[];
	fileShortlist?: number;
	maxBlocksPerFile?: number;
	rerankTopK?: number;
	displayTopK?: number;
	globalPoolMax?: number;
}): Promise<HybridLexicalLaneDisplayCandidate[]> {
	const files =
		params.files !== undefined
			? [...params.files]
			: await buildHybridLexicalLaneFileShortlist({
					queryText: params.queryText,
					limit: params.fileShortlist ?? HYBRID_LEXICAL_LANE_FILE_SHORTLIST,
			  });
	const { blockCandidates, snapshotTextByRequestKey } =
		await buildHybridLexicalLaneLocalBlockCandidates({
			queryText: params.queryText,
			files,
			maxBlocksPerFile:
				params.maxBlocksPerFile ?? HYBRID_LEXICAL_LANE_MAX_BLOCKS_PER_FILE,
		});
	return runHybridLexicalLaneCandidatePipeline({
		blockCandidates,
		snapshotTextByRequestKey,
		rerankTopK: params.rerankTopK,
		displayTopK: params.displayTopK,
		globalPoolMax: params.globalPoolMax,
	});
}

export function runHybridLexicalLaneCandidatePipeline(params: {
	blockCandidates: readonly HybridLexicalLaneBlockCandidate[];
	snapshotTextByRequestKey: ReadonlyMap<string, string>;
	rerankTopK?: number;
	displayTopK?: number;
	globalPoolMax?: number;
}): HybridLexicalLaneDisplayCandidate[] {
	const pool = preselectHybridLexicalLaneBlockCandidates(
		params.blockCandidates,
		params.globalPoolMax ?? HYBRID_LEXICAL_LANE_GLOBAL_POOL_MAX,
	);
	const ranked = rankHybridLexicalLaneBlockCandidates(pool);
	const mergedBlocks = mergeHybridLexicalLaneRankedBlocks(
		ranked,
		params.rerankTopK ?? HYBRID_LEXICAL_LANE_RERANK_TOP_K,
	);
	const displayCandidates = buildHybridLexicalLaneDisplayCandidates({
		candidates: mergedBlocks,
		snapshotTextByRequestKey: params.snapshotTextByRequestKey,
	});
	return mergeHybridLexicalLaneDisplayCandidates(
		displayCandidates.sort((left, right) => right.score - left.score),
		params.displayTopK ?? HYBRID_LEXICAL_LANE_DISPLAY_TOP_K,
	);
}

export function runHybridLexicalLaneFileItemPipeline(params: {
	queryText: string;
	blockCandidates: readonly HybridLexicalLaneBlockCandidate[];
	snapshotTextByRequestKey: ReadonlyMap<string, string>;
	rerankTopK?: number;
	displayTopK?: number;
	globalPoolMax?: number;
}) {
	return buildHybridLexicalLaneFileItems(
		params.queryText,
		runHybridLexicalLaneCandidatePipeline(params),
	);
}

export async function runHybridLexicalLaneSearch(params: {
	queryText: string;
	files?: readonly HybridLexicalLaneFileCandidate[];
	fileShortlist?: number;
	maxBlocksPerFile?: number;
	rerankTopK?: number;
	displayTopK?: number;
	globalPoolMax?: number;
}) {
	return buildHybridLexicalLaneFileItems(
		params.queryText,
		await prepareHybridLexicalLaneSearch(params),
	);
}

function preselectHybridLexicalLaneBlockCandidates(
	candidates: readonly HybridLexicalLaneBlockCandidate[],
	limit: number,
): HybridLexicalLaneBlockCandidate[] {
	if (candidates.length <= limit) {
		return [...candidates];
	}
	return [...candidates]
		.sort((left, right) => {
			const scoreDiff = computePoolPriorScore(right) - computePoolPriorScore(left);
			if (scoreDiff !== 0) {
				return scoreDiff;
			}
			if (left.parentFileRank !== right.parentFileRank) {
				return left.parentFileRank - right.parentFileRank;
			}
			return left.startOffset - right.startOffset;
		})
		.slice(0, limit);
}

function computePoolPriorScore(candidate: HybridLexicalLaneBlockCandidate): number {
	const metadata = candidate.parentMetadataSignals;
	return (
		candidate.localScore +
		Math.log1p(Math.max(0, candidate.parentFileScore)) * 48 +
		Math.max(0, 14 - candidate.parentFileRank) * 18 +
		candidate.localSignals.coverageCount * 22 +
		candidate.localSignals.exactCount * 18 +
		candidate.localSignals.prefixCount * 10 -
		candidate.localSignals.missCount * 20 -
		candidate.localSignals.distancePenaltyTotal * 0.8 -
		candidate.localSignals.spanLength * 0.06 +
		(metadata.basenameExact ? 180 : 0) +
		(metadata.basenamePrefix ? 96 : 0) +
		(metadata.basenameContainedInQuery ? 28 : 0) +
		metadata.basenameTokenCoverageCount * 12 +
		(metadata.pathExact ? 54 : 0) +
		(metadata.pathPrefix ? 22 : 0) +
		metadata.pathTokenCoverageCount * 4 +
		metadata.pathAnchorCoverageCount * 140 +
		metadata.pathRootAnchorCoverageCount * 120 +
		(metadata.pathRootAnchorExact ? 136 : 0) +
		metadata.folderHintCount * 20 +
		(metadata.templateFolderHit ? 170 : 0) -
		(metadata.archivePenaltyEligible ? 20 : 0) +
		(metadata.headingMetaHit ? 30 : 0) +
		metadata.headingExactCount * 84 +
		metadata.headingPrefixCount * 32 +
		metadata.headingContainedInQueryCount * 34 +
		metadata.headingTokenCoverageCount * 10 +
		(metadata.aliasHit ? 24 : 0) +
		metadata.aliasExactCount * 68 +
		metadata.aliasPrefixCount * 28 +
		metadata.aliasContainedInQueryCount * 64 +
		metadata.aliasTokenCoverageCount * 16
	);
}
