export type HybridLexicalLaneMatchTier = "exact" | "prefix" | "fuzzy";

export type HybridLexicalLaneMatchOccurrence = {
	termId: string;
	tier: HybridLexicalLaneMatchTier;
	start: number;
	end: number;
	distancePenalty: number;
};

export type HybridLexicalLaneMetadataSignals = {
	basenameExact: boolean;
	basenamePrefix: boolean;
	pathExact: boolean;
	pathPrefix: boolean;
	headingMetaHit: boolean;
	aliasHit: boolean;
};

export type HybridLexicalLaneFileCandidate = {
	filePath: string;
	fileScore: number;
	fileRank: number;
	basename: string;
	metadataSignals: HybridLexicalLaneMetadataSignals;
};

export type HybridLexicalLaneLocalSignals = {
	coverageCount: number;
	exactCount: number;
	prefixCount: number;
	fuzzyCount: number;
	distancePenaltyTotal: number;
	distancePenaltyMax: number;
	spanLength: number;
	anchorOffset: number;
};

export type HybridLexicalLaneBlockCandidate = {
	filePath: string;
	blockId: string;
	startOffset: number;
	endOffset: number;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	text: string;
	headingChain: string[];
	parentFileScore: number;
	parentFileRank: number;
	localScore: number;
	localSignals: HybridLexicalLaneLocalSignals;
	matchOccurrences: HybridLexicalLaneMatchOccurrence[];
};

export type HybridLexicalLaneScoreBreakdown = {
	filePriorScore: number;
	localCoverageScore: number;
	lexicalRefineScore: number;
	structureScore: number;
	overlapPenalty: number;
	totalScore: number;
};

export type HybridLexicalLaneRankedBlockCandidate =
	HybridLexicalLaneBlockCandidate & {
		scoreBreakdown: HybridLexicalLaneScoreBreakdown;
	};

export type HybridLexicalLaneDisplayCandidate = {
	filePath: string;
	basename: string;
	headingChain: string[];
	segmentText: string;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	score: number;
	snippetText: string;
	snippetHtml: string;
	highlightRanges: Array<{ start: number; end: number }>;
	coreStart: number;
	coreEnd: number;
	displayStart: number;
	displayEnd: number;
	anchorOffset: number;
};
