# Hybrid BM25 Retirement Boundary

## Current benchmark anchor

Source:
- `tests/src/services/search/hybrid-bm25.test.ts`
- query set: automation corpus shared by the lexical lane vs hybrid chunk BM25 comparison

Current baseline snapshot:

| lane | top1 | top3 | top5 | zeroRate | avgMsPerQuery | p50Ms | p100Ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BM25 baseline | 0.801 | 0.960 | 0.983 | 0.000 | 0.204 | 0.062 | 6.109 |
| lexical lane current | 0.807 | 0.983 | 1.000 | 0.000 | 41.846 | 38.598 | 89.594 |
| lexical lane trim-overlap experiment | 0.795 | 0.983 | 1.000 | 0.000 | 40.322 | 35.779 | 87.861 |

Trim-overlap experiment delta vs current lexical lane:
- `top1`: `-0.012`
- `top3`: `0.000`
- `top5`: `0.000`
- `zeroRate`: `0.000`
- `avgMsPerQuery`: `-1.524`
- `p100Ms`: `-1.733`

Interpretation:
- the experimental overlap trimming is promising for latency and tail latency
- it is not yet safe to promote because current `top1` regresses slightly
- keep the experiment benchmark-only until the ranking loss is explained or recovered

## Trim-overlap regression family

Current benchmark diagnostics show that the `top1` loss is narrow rather than broad.

- affected `type`: `partial_memory`
- affected `suite`: `messy_pkm`
- currently observed regressions: 2 queries
  - `cache warm start mitigation`
  - `frontmatter alias 提过 cache warm start mitigation`

What stayed stable in both regressions:
- `fileMatchRank = 1`
- `shortlistRank = 1`
- `shortlistSize = 8`

What changed:
- the relevant file was still shortlisted correctly
- the regression happened after shortlist construction, inside the display-candidate merge and global `displayTopK` budget
- the relevant file lost one surviving subitem in the final display pool
  - `4 -> 3` in one query
  - `3 -> 2` in one query
- a competing file (`pkm-zh/incidents/缓存预热事故.md`) gained enough aggregate advantage to overtake the English target file

Why this matters:
- this benchmark does not rerank and does not recompute lexical scores after trimming
- the observed `top1` loss is therefore not caused by file-shortlist recall failure
- it is also not caused by the trim path making a surviving candidate's score numerically weaker
- the loss is caused by candidate-retention side effects: trimming keeps more overlapping windows alive, and with a fixed global `displayTopK`, that can crowd out later relevant subitems and change file-level aggregate ranking

Practical conclusion:
- overlap control is useful only if duplicate snippet suppression becomes a quality or latency problem
- it is not necessary to ship right now
- if we revisit it, the safer direction is not "trim more aggressively"
- the safer direction is "trim only with per-file budget awareness" or "normalize aggregate scoring so rescued overlap windows do not steal the global topK budget from the true winner"

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

## First migratable runtime layer

The first removable runtime dependency is not the `hybridBm25Index` blob itself. The first layer to migrate is the `bm25_only` serve-query state boundary.

Today:
- the runtime query path already serves hybrid recall from lexical-lane shortlist plus file snapshots
- `HybridEngine.search()` no longer calls `bm25.search()`
- but `HybridEngine.canServeQuery()` still gates availability on `!this.isEmpty()`, and `isEmpty()` is still defined by `bm25.docCount`
- `DataManager.isHybridSearchUnavailable()` and bootstrap availability both trust that gate
- `normalizeHybridIndexedFileState()` still defaults missing non-vector files to `bm25_only`

This means `bm25_only` is currently a runtime capability flag, not just a storage label.

The first safe migration slice is:
1. split "hybrid can answer queries" from "BM25 artifact exists"
2. introduce a lexical-lane-backed fallback state for no-vector files
   - likely `structure_only` or `lexical_only`
3. move `canServeQuery()` to a lexical readiness check
   - for example: lexical/file-snapshot availability plus at least one searchable stored path
4. update `normalizeHybridIndexedFileState()`, DataManager health summary, and UI copy to report that new state instead of `bm25_only`

Only after that boundary moves can we safely decide whether `indexFileWithoutEmbedding()` still needs to write BM25 runtime artifacts for no-vector files.

## Suggested retirement order

1. keep the current BM25-vs-lexical benchmark as the regression anchor
2. improve the overlap experiment until it no longer regresses `top1`
3. remove runtime dependence on `bm25_only`
4. remove `hybridBm25Index` persistence and schema
5. delete remaining BM25 fallback UI strings and health-summary labels
6. replace BM25 comparison benchmarks only after a new anchor is accepted
