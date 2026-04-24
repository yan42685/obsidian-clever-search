import { buildLineOffsets, offsetToLine } from "../hybrid/chunker";
import {
  extractHanChars,
  normalizeText,
} from "./query/text";

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

const QUERY_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9._/-]+/giu;
const WORD_CONTEXT_CHARS = /[\p{L}\p{N}_/-]/u;
const MAX_BRIDGE_SPANS = 12;
const BRIDGE_CONTEXT_CHARS = 120;

export function buildCoverageLexicalV3HybridLexicalSubitems(params: {
  queryText: string;
  filePath: string;
  snapshotText: string;
}): CoverageLexicalV3HybridLexicalSubitemsResult {
  const queryTerms = buildBridgeQueryTerms(params.queryText);
  if (queryTerms.length === 0 || params.snapshotText.trim().length === 0) {
    return {
      queryTerms,
      candidateSpans: [],
      renderPayloads: [],
    };
  }

  const normalizedSnapshotText = normalizeText(params.snapshotText);
  const occurrences = collectBridgeOccurrences(normalizedSnapshotText, queryTerms);
  const candidateSpans = buildBridgeCandidateSpans(
    params.snapshotText,
    queryTerms,
    occurrences,
  );
  const lineOffsets = buildLineOffsets(params.snapshotText);
  const renderPayloads = candidateSpans.map((span) => ({
    row: offsetToLine(lineOffsets, span.score.anchorOffset),
    col:
      span.score.anchorOffset -
      (lineOffsets[offsetToLine(lineOffsets, span.score.anchorOffset)] ?? 0),
  }));
  return {
    queryTerms,
    candidateSpans,
    renderPayloads,
  };
}

function buildBridgeQueryTerms(
  queryText: string,
): CoverageLexicalV3HybridLexicalSubitemsQueryTerm[] {
  const normalizedQueryText = normalizeText(queryText);
  const queryTerms: CoverageLexicalV3HybridLexicalSubitemsQueryTerm[] = [];
  const seen = new Set<string>();
  for (const match of normalizedQueryText.matchAll(QUERY_SEGMENT_REGEX)) {
    const rawText = match[0] ?? "";
    const normalizedText = rawText.trim();
    if (normalizedText.length === 0) {
      continue;
    }
    const kind = classifyBridgeQueryTerm(normalizedText);
    const terms = kind === "han_bigram" ? buildHanBridgeTerms(normalizedText) : [normalizedText];
    for (const term of terms) {
      const dedupeKey = `${kind}:${term}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      queryTerms.push({
        termId: `q${queryTerms.length}`,
        rawText: term,
        normalizedText: term,
        kind: kind === "han_bigram" && extractHanChars(term).length === 1 ? "han_char" : kind,
      });
    }
  }
  return queryTerms;
}

function classifyBridgeQueryTerm(
  normalizedText: string,
): CoverageLexicalV3HybridLexicalSubitemsQueryTermKind {
  const hanChars = extractHanChars(normalizedText);
  if (hanChars.length === 0) {
    return "non_han_run";
  }
  return hanChars.length === 1 ? "han_char" : "han_bigram";
}

function buildHanBridgeTerms(normalizedText: string): string[] {
  const chars = extractHanChars(normalizedText);
  if (chars.length <= 1) {
    return chars;
  }
  const terms: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    terms.push(chars[index] + chars[index + 1]);
  }
  return terms;
}

function collectBridgeOccurrences(
  normalizedSnapshotText: string,
  queryTerms: readonly CoverageLexicalV3HybridLexicalSubitemsQueryTerm[],
): CoverageLexicalV3HybridLexicalSubitemsOccurrence[] {
  const occurrences: CoverageLexicalV3HybridLexicalSubitemsOccurrence[] = [];
  for (const queryTerm of queryTerms) {
    for (const occurrence of collectExactBridgeOccurrences(normalizedSnapshotText, queryTerm)) {
      occurrences.push(occurrence);
    }
  }
  return occurrences.sort((left, right) => left.start - right.start || left.end - right.end);
}

function collectExactBridgeOccurrences(
  normalizedSnapshotText: string,
  queryTerm: CoverageLexicalV3HybridLexicalSubitemsQueryTerm,
): CoverageLexicalV3HybridLexicalSubitemsOccurrence[] {
  const occurrences: CoverageLexicalV3HybridLexicalSubitemsOccurrence[] = [];
  let searchFrom = 0;
  while (searchFrom < normalizedSnapshotText.length) {
    const start = normalizedSnapshotText.indexOf(queryTerm.normalizedText, searchFrom);
    if (start < 0) {
      break;
    }
    const end = start + queryTerm.normalizedText.length;
    searchFrom = Math.max(start + 1, end);
    if (queryTerm.kind === "non_han_run" && !isWordBoundaryMatch(normalizedSnapshotText, start, end)) {
      continue;
    }
    occurrences.push({
      termId: queryTerm.termId,
      tier: "exact",
      start,
      end,
      distancePenalty: 0,
    });
  }
  return occurrences;
}

function isWordBoundaryMatch(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return !WORD_CONTEXT_CHARS.test(before) && !WORD_CONTEXT_CHARS.test(after);
}

function buildBridgeCandidateSpans(
  snapshotText: string,
  queryTerms: readonly CoverageLexicalV3HybridLexicalSubitemsQueryTerm[],
  occurrences: readonly CoverageLexicalV3HybridLexicalSubitemsOccurrence[],
): CoverageLexicalV3HybridLexicalSubitemsCandidateSpan[] {
  const spans = occurrences.map((anchorOccurrence) => {
    const nearbyOccurrences = occurrences.filter(
      (occurrence) =>
        occurrence.start <= anchorOccurrence.end + BRIDGE_CONTEXT_CHARS &&
        occurrence.end >= anchorOccurrence.start - BRIDGE_CONTEXT_CHARS,
    );
    const start = Math.max(
      0,
      Math.min(...nearbyOccurrences.map((occurrence) => occurrence.start)) - BRIDGE_CONTEXT_CHARS / 2,
    );
    const end = Math.min(
      snapshotText.length,
      Math.max(...nearbyOccurrences.map((occurrence) => occurrence.end)) + BRIDGE_CONTEXT_CHARS / 2,
    );
    return buildBridgeCandidateSpan(start, end, anchorOccurrence.start, queryTerms, nearbyOccurrences);
  });
  return dedupeBridgeSpans(spans)
    .sort(compareBridgeCandidateSpans)
    .slice(0, MAX_BRIDGE_SPANS);
}

function buildBridgeCandidateSpan(
  start: number,
  end: number,
  anchorOffset: number,
  queryTerms: readonly CoverageLexicalV3HybridLexicalSubitemsQueryTerm[],
  occurrences: readonly CoverageLexicalV3HybridLexicalSubitemsOccurrence[],
): CoverageLexicalV3HybridLexicalSubitemsCandidateSpan {
  const termStats = queryTerms.map((queryTerm) => {
    const termOccurrences = occurrences.filter(
      (occurrence) => occurrence.termId === queryTerm.termId,
    );
    return {
      termId: queryTerm.termId,
      bestTier: termOccurrences.length > 0 ? "exact" : "miss",
      bestDistancePenalty: termOccurrences.length > 0 ? 0 : Number.POSITIVE_INFINITY,
    } satisfies CoverageLexicalV3HybridLexicalSubitemsTermStat;
  });
  const exactCount = termStats.filter((termStat) => termStat.bestTier === "exact").length;
  return {
    start: Math.floor(start),
    end: Math.ceil(end),
    score: {
      coverageCount: exactCount,
      exactCount,
      prefixCount: 0,
      fuzzyCount: 0,
      distancePenaltyTotal: 0,
      distancePenaltyMax: 0,
      spanLength: Math.max(0, end - start),
      anchorOffset,
    },
    termStats,
    occurrences,
  };
}

function dedupeBridgeSpans(
  spans: readonly CoverageLexicalV3HybridLexicalSubitemsCandidateSpan[],
): CoverageLexicalV3HybridLexicalSubitemsCandidateSpan[] {
  const deduped = new Map<string, CoverageLexicalV3HybridLexicalSubitemsCandidateSpan>();
  for (const span of spans) {
    const key = `${span.start}:${span.end}`;
    const existing = deduped.get(key);
    if (!existing || compareBridgeCandidateSpans(span, existing) < 0) {
      deduped.set(key, span);
    }
  }
  return [...deduped.values()];
}

function compareBridgeCandidateSpans(
  left: CoverageLexicalV3HybridLexicalSubitemsCandidateSpan,
  right: CoverageLexicalV3HybridLexicalSubitemsCandidateSpan,
): number {
  return (
    right.score.coverageCount - left.score.coverageCount ||
    right.score.exactCount - left.score.exactCount ||
    left.score.spanLength - right.score.spanLength ||
    left.score.anchorOffset - right.score.anchorOffset
  );
}
