export const HYBRID_LEXICAL_LANE_FILE_SHORTLIST = 8;
export const HYBRID_LEXICAL_LANE_MAX_BLOCKS_PER_FILE = 8;
export const HYBRID_LEXICAL_LANE_GLOBAL_POOL_MAX = 48;
export const HYBRID_LEXICAL_LANE_RERANK_TOP_K = 16;
export const HYBRID_LEXICAL_LANE_DISPLAY_TOP_K = 8;

export type HybridLexicalLaneRankerWeights = {
	filePrior: number;
	localCoverage: number;
	lexicalRefine: number;
	structure: number;
};

export const DEFAULT_HYBRID_LEXICAL_LANE_WEIGHTS: HybridLexicalLaneRankerWeights =
	{
		filePrior: 0.32,
		localCoverage: 0.42,
		lexicalRefine: 0.16,
		structure: 0.1,
	};
