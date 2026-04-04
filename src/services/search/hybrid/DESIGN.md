# Hybrid Search Design

## Scope

This document describes the current hybrid runtime that ships in the plugin.

It does not describe historical BM25 runtime paths. Chunk BM25 is no longer part
of runtime retrieval, persistence, fallback state, or schema. The only remaining
BM25 role is a benchmark anchor used to compare lexical-lane quality and latency
against the retired chunk BM25 baseline.

## Runtime Architecture

The current hybrid runtime has three stages:

1. Dense retrieval produces semantic candidates.
2. Lexical lane produces lexical candidates from the coverage shortlist plus
   file-local block recall.
3. The reranker consumes the merged candidate set and produces final ranking.

Lexical lane is the runtime replacement for the old hybrid chunk BM25 lane.

## Lexical Lane Responsibilities

The lexical lane has two separate jobs:

1. File-level shortlist
   Coverage lexical search provides the file shortlist and metadata reweighting.
2. Local block recall
   Local block recall seeds evidence spans inside shortlisted files and converts
   them into shared snippets for rerank and display.

Key constraints for this path:

- Dense lane remains unchanged.
- Coverage lexical remains the file-level engine.
- Shared snippets are the single text field used by display and rerank.
- Coverage engine display behavior is not a tuning target for lexical-lane work.

## Fallback Semantics

When rerank is unavailable or fails, hybrid should fall back to coverage-engine
native results. BM25 is not a runtime fallback path anymore.

## Benchmark Anchor

Chunk BM25 remains in the repository only as an evaluation anchor.

Current anchor test:

- `tests/src/services/search/hybrid-benchmark-anchor.test.ts`
- `npm run test:hybrid-benchmark-anchor`

This comparison exists to answer one question: whether lexical lane continues to
replace the old chunk BM25 lane without regressing the agreed quality and latency
metrics.

The benchmark output should be read as:

- `bm25Baseline`: retired chunk BM25 anchor
- `lexicalLane`: current runtime-equivalent lexical lane path

Benchmark anchor should now be treated as frozen unless the team explicitly
re-baselines it. The fixed evaluation fields are:

- `top1`
- `top3`
- `top5`
- `zeroRate`
- `avgMsPerQuery`
- `p100Ms`

Current frozen anchor, measured on April 4, 2026 with
`npm run test:hybrid-benchmark-anchor`:

- `lexicalLane.top1 = 0.818`
- `lexicalLane.top3 = 0.983`
- `lexicalLane.top5 = 1`
- `lexicalLane.zeroRate = 0`
- `lexicalLane.avgMsPerQuery = 43.497`
- `lexicalLane.p100Ms = 126.392`

## Metrics To Watch

The benchmark anchor is not just about recall. The current required metrics are:

- `top1`
- `top3`
- `top5`
- `zeroRate`
- `avgMsPerQuery`
- `p100Ms`

`avgMsPerQuery` and `p100Ms` should track the runtime-equivalent lexical lane
path, not an inflated benchmark-only pipeline.

## Non-Goals

The following are out of scope for current runtime design:

- Reintroducing chunk BM25 as runtime retrieval
- Keeping BM25 runtime compatibility code
- Maintaining BM25-specific persistence or schema state
- Optimizing coverage-engine display behavior as part of lexical-lane work

## Source Of Truth

For current behavior, the code is the source of truth:

- `src/services/search/hybrid/hybrid-engine.ts`
- `src/services/search/hybrid/lexical-lane/`
- `src/services/search/coverage-lexical/`
- `tests/src/services/search/hybrid-benchmark-anchor.test.ts`
