# Coverage Lexical Size And Latency Baseline After Query-Time Hot-Path Flattening

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after the current query-time hot-path flattening wave so future work compares against the latest measured latency win rather than the older mixed-layout structural anchor
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-legacy-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `d4b9764` (`Flatten coverage lexical window scoring hot path`) plus numeric `seenWindows` dedupe in local window scoring
- included hot-path changes in this anchor:
  - family and phrase candidate state no longer depends on per-candidate `Map` and `Set` graphs
  - char and tag candidate state now uses numeric query-local match flags instead of string-keyed `Set` membership
  - coverage signal construction now accumulates directly into counters and arrays rather than rebuilding transient `Set` and `Map` containers
  - local window scoring, fusion, and admission now keep much more of the hot path in arrays and codes
  - candidate-window dedupe now uses numeric window keys rather than `` `${start}:${end}` `` strings
- timing anchor rule:
  - use `CoverageLexical / MiniSearch` latency ratios as the primary timing anchor
  - keep absolute milliseconds as a secondary reference only, because battery vs power mode changes local CPU behavior
- index-size anchor rule:
  - use the structural in-memory estimate from `CoverageLexicalFileSearchEngine.estimateIndexBytes()`
  - treat this as a benchmark-facing structural estimate, not a V8 heap snapshot

## Corpus Anchor

- noteCount: 73
- queryCount: 176
- docsWithHan: 40
- docsWithLatinAndHan: 40
- bySuite:
  - core: 6
  - coverage_invariants: 8
  - adversarial: 63
  - messy_pkm: 99

## Quality Anchor

- `MiniSearch`
  - objective: 0.423
  - top1: 0.398
  - top3: 0.449
  - top5: 0.46
  - zeroRate: 0.534
  - mrr: 0.426
- `CoverageLexical`
  - objective: 0.87
  - top1: 0.79
  - top3: 0.949
  - top5: 0.994
  - zeroRate: 0
  - mrr: 0.876

## Timing Anchor

- absolute reference:
  - `MiniSearch`: avg 4.994 ms/query, p50 4.511 ms, p100 12.433 ms
  - `CoverageLexical`: avg 47.232 ms/query, p50 40.286 ms, p100 134.763 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 9.458`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 8.931`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 10.839`
- interpretation:
  - this is the first anchor after the recent hot-path flattening wave and should replace the older Phase 3 Step 3 anchor as the active latency comparison point
  - the gain came from reducing query-time object churn, not from making the live index materially smaller

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 286.625 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 4.94`

## Storage Shape Anchor

- `documentIdentity.total`: 2,644 bytes
- hottest posting buckets remain:
  - `postings.body`: 25,436 bytes
  - `postings.bodyPhrase`: 48,796 bytes
  - `postings.metadata`: 4,696 bytes
- interpretation:
  - size is effectively flat versus the previous anchor
  - the value of this step is lower query-time allocation and less string-heavy transient work inside candidate scoring and local window evaluation

## Delta Vs Phase 3 Step 3 Anchor

- baseline reference file:
  - `benchmarks/design/coverage-lexical-size-latency-baseline-phase3-step3.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio moved from `10.501` to `9.458`
  - p50 ratio moved from `9.762` to `8.931`
  - p100 ratio moved from `12.703` to `10.839`
  - absolute `CoverageLexical` avg moved from `57.404` ms/query to `47.232` ms/query
- size:
  - estimated bytes moved from `292,628` to `293,504`
  - estimated index size ratio moved from `4.926` to `4.94`
  - treat this as flat in practice, not as a size regression story
- execution takeaway:
  - promote this file as the new active anchor
  - continue latency work by removing the remaining query-time string and container churn in local window evaluation before expecting more benefit from additional posting migration


