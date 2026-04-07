export type HybridLexicalLaneMatchTier = "exact" | "prefix" | "fuzzy";
export type HybridLexicalLaneSpanTermTier =
	| HybridLexicalLaneMatchTier
	| "miss";

export type HybridLexicalLaneMatchOccurrence = {
	termId: string;
	tier: HybridLexicalLaneMatchTier;
	start: number;
	end: number;
	distancePenalty: number;
};

export type HybridLexicalLaneTermStat = {
	termId: string;
	bestTier: HybridLexicalLaneSpanTermTier;
	bestDistancePenalty: number;
};

export type HybridLexicalLaneMetadataSignals = {
	basenameExact: boolean;
	basenamePrefix: boolean;
	basenameContainedInQuery: boolean;
	basenameTokenCoverageCount: number;
	pathExact: boolean;
	pathPrefix: boolean;
	pathTokenCoverageCount: number;
	pathAnchorCoverageCount: number;
	pathRootAnchorCoverageCount: number;
	pathRootAnchorExact: boolean;
	folderHintCount: number;
	templateFolderHit: boolean;
	archivePenaltyEligible: boolean;
	headingMetaHit: boolean;
	headingExactCount: number;
	headingPrefixCount: number;
	headingContainedInQueryCount: number;
	headingTokenCoverageCount: number;
	aliasHit: boolean;
	aliasExactCount: number;
	aliasPrefixCount: number;
	aliasContainedInQueryCount: number;
	aliasTokenCoverageCount: number;
};

export type HybridLexicalLaneMetadataValues = {
	aliases: string[];
	headings: string[];
};

export type HybridLexicalLaneFileCandidate = {
	filePath: string;
	fileScore: number;
	fileRank: number;
	basename: string;
	metadataSignals: HybridLexicalLaneMetadataSignals;
	metadataValues: HybridLexicalLaneMetadataValues;
};

export type HybridLexicalLaneLocalSignals = {
	coverageCount: number;
	exactCount: number;
	prefixCount: number;
	fuzzyCount: number;
	queryTermCount: number;
	missCount: number;
	occurrenceCount: number;
	occurrenceSpread: number;
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
	parentMetadataSignals: HybridLexicalLaneMetadataSignals;
	localScore: number;
	localSignals: HybridLexicalLaneLocalSignals;
	termStats: HybridLexicalLaneTermStat[];
	matchOccurrences: HybridLexicalLaneMatchOccurrence[];
	bridgePreviewText?: string;
	bridgePreviewRanges?: Array<{ start: number; end: number }>;
	bridgePreviewSegmentText?: string;
};

export type HybridLexicalLaneScoreBreakdown = {
	filePriorScore: number;
	localCoverageScore: number;
	lexicalRefineScore: number;
	structureScore: number;
	evidenceDiversityBonus: number;
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
	headerText: string;
	bodyText: string;
	highlightRanges: Array<{ start: number; end: number }>;
	bodyHighlightRanges: Array<{ start: number; end: number }>;
	coreStart: number;
	coreEnd: number;
	displayStart: number;
	displayEnd: number;
	bodyStart: number;
	bodyEnd: number;
	anchorOffset: number;
};
