export const V3_HYBRID_LEXICAL_SUBITEMS_NOT_IMPLEMENTED_ERROR =
  "V3 hybrid lexical subitems not implemented";

export type CoverageLexicalV3HybridLexicalSubitemsMatchTier =
  | "exact"
  | "prefix"
  | "fuzzy";

export type CoverageLexicalV3HybridLexicalSubitemsSpanTermTier =
  | CoverageLexicalV3HybridLexicalSubitemsMatchTier
  | "miss";

export type CoverageLexicalV3HybridLexicalSubitemsQueryTermKind =
  | "non_han_run"
  | "han_bigram"
  | "han_char";

export type CoverageLexicalV3HybridLexicalSubitemsQueryTerm = {
  termId: string;
  rawText: string;
  normalizedText: string;
  kind: CoverageLexicalV3HybridLexicalSubitemsQueryTermKind;
};

export type CoverageLexicalV3HybridLexicalSubitemsOccurrence = {
  termId: string;
  tier: CoverageLexicalV3HybridLexicalSubitemsMatchTier;
  start: number;
  end: number;
  distancePenalty: number;
};

export type CoverageLexicalV3HybridLexicalSubitemsTermStat = {
  termId: string;
  bestTier: CoverageLexicalV3HybridLexicalSubitemsSpanTermTier;
  bestDistancePenalty: number;
};

export type CoverageLexicalV3HybridLexicalSubitemsCandidateSpan = {
  start: number;
  end: number;
  score: {
    coverageCount: number;
    exactCount: number;
    prefixCount: number;
    fuzzyCount: number;
    distancePenaltyTotal: number;
    distancePenaltyMax: number;
    spanLength: number;
    anchorOffset: number;
  };
  termStats: readonly CoverageLexicalV3HybridLexicalSubitemsTermStat[];
  occurrences: readonly CoverageLexicalV3HybridLexicalSubitemsOccurrence[];
};

export type CoverageLexicalV3HybridLexicalSubitemsRenderPayload = {
  row: number;
  col: number;
};

export type CoverageLexicalV3HybridLexicalSubitemsResult = {
  queryTerms: readonly CoverageLexicalV3HybridLexicalSubitemsQueryTerm[];
  candidateSpans: readonly CoverageLexicalV3HybridLexicalSubitemsCandidateSpan[];
  renderPayloads: readonly CoverageLexicalV3HybridLexicalSubitemsRenderPayload[];
};

export function buildCoverageLexicalV3HybridLexicalSubitems(_params: {
  queryText: string;
  filePath: string;
  snapshotText: string;
}): CoverageLexicalV3HybridLexicalSubitemsResult {
  throw new Error(V3_HYBRID_LEXICAL_SUBITEMS_NOT_IMPLEMENTED_ERROR);
}
