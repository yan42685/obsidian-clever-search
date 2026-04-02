import {
	HYBRID_LEXICAL_LANE_DISPLAY_MAX_CHARS,
	HYBRID_LEXICAL_LANE_FILE_SHORTLIST,
	HYBRID_LEXICAL_LANE_DISPLAY_TOP_K,
	HYBRID_LEXICAL_LANE_GLOBAL_POOL_MAX,
	HYBRID_LEXICAL_LANE_MAX_BLOCKS_PER_FILE,
	HYBRID_LEXICAL_LANE_RERANK_TOP_K,
} from "./config";
import { buildHybridLexicalLaneDisplayCandidates } from "./display-window";
import { buildHybridLexicalLaneFileItems } from "./result-mapper";
import { mergeHybridLexicalLaneDisplayCandidates, mergeHybridLexicalLaneRankedBlocks } from "./result-merge";
import { rankHybridLexicalLaneBlockCandidates } from "./block-ranker";
import { buildHybridLexicalLaneFileShortlist } from "./file-shortlist";
import { buildHybridLexicalLaneLocalBlockCandidates } from "./local-block-recall";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneDisplayCandidate,
} from "./contracts";

export * from "./contracts";
export * from "./config";
export * from "./file-shortlist";
export * from "./local-block-recall";
export * from "./block-ranker";
export * from "./display-window";
export * from "./result-merge";
export * from "./result-mapper";

export function runHybridLexicalLaneCandidatePipeline(params: {
	blockCandidates: readonly HybridLexicalLaneBlockCandidate[];
	snapshotTextByPath: ReadonlyMap<string, string>;
	rerankTopK?: number;
	displayTopK?: number;
	displayMaxChars?: number;
	globalPoolMax?: number;
}): HybridLexicalLaneDisplayCandidate[] {
	const pool = params.blockCandidates.slice(
		0,
		params.globalPoolMax ?? HYBRID_LEXICAL_LANE_GLOBAL_POOL_MAX,
	);
	const ranked = rankHybridLexicalLaneBlockCandidates(pool);
	const mergedBlocks = mergeHybridLexicalLaneRankedBlocks(
		ranked,
		params.rerankTopK ?? HYBRID_LEXICAL_LANE_RERANK_TOP_K,
	);
	const displayCandidates = buildHybridLexicalLaneDisplayCandidates({
		candidates: mergedBlocks,
		snapshotTextByPath: params.snapshotTextByPath,
		maxChars: params.displayMaxChars ?? HYBRID_LEXICAL_LANE_DISPLAY_MAX_CHARS,
	});
	return mergeHybridLexicalLaneDisplayCandidates(
		displayCandidates.sort((left, right) => right.score - left.score),
		params.displayTopK ?? HYBRID_LEXICAL_LANE_DISPLAY_TOP_K,
	);
}

export function runHybridLexicalLaneFileItemPipeline(params: {
	queryText: string;
	blockCandidates: readonly HybridLexicalLaneBlockCandidate[];
	snapshotTextByPath: ReadonlyMap<string, string>;
	rerankTopK?: number;
	displayTopK?: number;
	displayMaxChars?: number;
	globalPoolMax?: number;
}) {
	return buildHybridLexicalLaneFileItems(
		params.queryText,
		runHybridLexicalLaneCandidatePipeline(params),
	);
}

export async function runHybridLexicalLaneSearch(params: {
	queryText: string;
	fileShortlist?: number;
	maxBlocksPerFile?: number;
	rerankTopK?: number;
	displayTopK?: number;
	displayMaxChars?: number;
	globalPoolMax?: number;
}) {
	const files = await buildHybridLexicalLaneFileShortlist({
		queryText: params.queryText,
		limit: params.fileShortlist ?? HYBRID_LEXICAL_LANE_FILE_SHORTLIST,
	});
	const { blockCandidates, snapshotTextByPath } =
		await buildHybridLexicalLaneLocalBlockCandidates({
			queryText: params.queryText,
			files,
			maxBlocksPerFile:
				params.maxBlocksPerFile ?? HYBRID_LEXICAL_LANE_MAX_BLOCKS_PER_FILE,
		});
	return runHybridLexicalLaneFileItemPipeline({
		queryText: params.queryText,
		blockCandidates,
		snapshotTextByPath,
		rerankTopK: params.rerankTopK,
		displayTopK: params.displayTopK,
		displayMaxChars: params.displayMaxChars,
		globalPoolMax: params.globalPoolMax,
	});
}
