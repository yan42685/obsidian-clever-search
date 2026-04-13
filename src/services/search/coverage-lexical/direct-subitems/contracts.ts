export type DirectSubitemsQueryTermKind =
	| "han_bigram"
	| "han_char"
	| "non_han_run";

export type DirectSubitemsMatchTier =
	| "exact"
	| "prefix"
	| "fuzzy"
	| "miss";

export type DirectSubitemsQueryTerm = {
	termId: string;
	kind: DirectSubitemsQueryTermKind;
	rawText: string;
	normalizedText: string;
	queryStart: number;
	queryEnd: number;
};

export type DirectSubitemsOccurrence = {
	termId: string;
	tier: Exclude<DirectSubitemsMatchTier, "miss">;
	start: number;
	end: number;
	distancePenalty: number;
};

export type DirectSubitemsSpanTermStat = {
	termId: string;
	bestTier: DirectSubitemsMatchTier;
	bestDistancePenalty: number;
};

export type DirectSubitemsScoreTuple = {
	coverageCount: number;
	exactCount: number;
	rawPhraseExactCount?: number;
	phraseExactPairCount?: number;
	orderedExactPairCount?: number;
	prefixCount: number;
	fuzzyCount: number;
	distancePenaltyTotal: number;
	distancePenaltyMax: number;
	spanLength: number;
	anchorOffset: number;
};

export type DirectSubitemsCandidateSpan = {
	start: number;
	end: number;
	anchorOffset: number;
	occurrences: DirectSubitemsOccurrence[];
	termStats: DirectSubitemsSpanTermStat[];
	termSignature: string;
	score: DirectSubitemsScoreTuple;
};

export type DirectSubitemsRenderPayload = {
	text: string;
	html: string;
	snippetText: string;
	row: number;
	col: number;
	coreStart: number;
	coreEnd: number;
	displayStart: number;
	displayEnd: number;
	anchorOffset: number;
	highlightRanges: Array<{ start: number; end: number }>;
};
