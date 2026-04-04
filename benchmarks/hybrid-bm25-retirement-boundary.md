# Hybrid BM25 Retirement Boundary

## Current benchmark anchor

Source:
- `tests/src/services/search/hybrid-bm25.test.ts`
- query set: automation corpus shared by the lexical lane vs hybrid chunk BM25 comparison

Current baseline snapshot:

| lane | top1 | top3 | top5 | zeroRate | avgMsPerQuery | p50Ms | p100Ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BM25 baseline | 0.801 | 0.960 | 0.983 | 0.000 | 0.423 | 0.131 | 10.858 |
| lexical lane current | 0.807 | 0.983 | 1.000 | 0.000 | 46.659 | 43.832 | 105.888 |
| lexical lane trim-overlap experiment | 0.795 | 0.983 | 1.000 | 0.000 | 40.583 | 36.313 | 90.591 |

Trim-overlap experiment delta vs current lexical lane:
- `top1`: `-0.012`
- `top3`: `0.000`
- `top5`: `0.000`
- `zeroRate`: `0.000`
- `avgMsPerQuery`: `-6.076`
- `p100Ms`: `-15.297`

Interpretation:
- the experimental overlap trimming is promising for latency and tail latency
- it is not yet safe to promote because current `top1` regresses slightly
- keep the experiment benchmark-only until the ranking loss is explained or recovered

## What was already retired

These items are already gone and should not come back:
- rerank-specific BM25 fallback notice keys
- the old `searchWithBm25Baseline()` / `searchWithLexicalLane()` dead query path in `HybridEngine`
- the temporary hybrid BM25 retirement guard test that duplicated the existing BM25-vs-lexical benchmark

## Runtime-required BM25 today

These are still runtime dependencies and cannot be deleted yet.

### Storage and schema

- `src/services/database/database.ts`
  - `hybridBm25Index` is still part of the Dexie schema and upgrade path

### Engine lifecycle

- `src/services/search/hybrid/hybrid-engine.ts`
  - `loadBm25()`
  - `persistBm25()`
  - startup artifact recovery still loads BM25 blobs
  - index rebuild still persists BM25 alongside HNSW

### Fallback file state

- `src/services/search/hybrid/hybrid-store.ts`
  - `HybridDocState` still includes `bm25_only`
- `src/services/search/hybrid/hybrid-consistency.ts`
  - consistency and reuse checks still reason about `bm25_only`
- `src/services/search/hybrid/hybrid-engine.ts`
  - indexing fallback still emits and persists `bm25_only`

### Data manager and health surface

- `src/services/obsidian/user-data/data-manager.ts`
  - health summary still reports BM25-only state
  - storage accounting still counts `hybridBm25Index`
  - indexing fallback notice flow still depends on BM25-only runtime fallback
- translations:
  - `src/services/obsidian/translations/locale/en.ts`
  - `src/services/obsidian/translations/locale/zh-cn.ts`
  - `hybridNotice.indexFallbackToBm25`
  - `hybridNotice.searchFallbackToBm25`
  - `hybridModal.healthSummary.state.bm25_only`

## Benchmark-only or compat-only BM25 references

These references are not runtime-critical.

### Benchmark anchors

- `tests/src/services/search/hybrid-bm25.test.ts`
  - lexical lane vs hybrid chunk BM25 comparison anchor
- `tests/src/services/search/hybrid-bm25-parity.test.ts`
  - BM25 fresh-vs-restored parity and timing anchor

### BM25 implementation tests

- `tests/src/services/search/hybrid-bm25.test.ts`
- `tests/src/services/search/hybrid-bm25-parity.test.ts`

These should stay until formal retirement replaces them with a new anchor.

## Safe-to-delete next only after replacement

These are the next layer of candidates, but only once runtime no longer depends on BM25.

- `hybridBm25Index` table and blob migration code
- `bm25_only` state and related consistency logic
- DataManager health/storage accounting for BM25 artifacts
- BM25-only fallback notices that still describe real runtime behavior
- BM25 parity and baseline benchmarks, but only after a replacement benchmark answers the same regression questions

## Suggested retirement order

1. keep the current BM25-vs-lexical benchmark as the regression anchor
2. improve the overlap experiment until it no longer regresses `top1`
3. remove runtime dependence on `bm25_only`
4. remove `hybridBm25Index` persistence and schema
5. delete remaining BM25 fallback UI strings and health-summary labels
6. replace BM25 comparison benchmarks only after a new anchor is accepted
