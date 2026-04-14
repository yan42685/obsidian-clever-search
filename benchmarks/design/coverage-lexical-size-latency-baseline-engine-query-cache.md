# Coverage Lexical Size And Latency Baseline After Engine Query-Local Result Reuse

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after the engine-side query-local reuse step so future latency work compares against the first retained post-recall-cache win from the ranking pipeline itself
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-legacy-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `7dd9475` (`Reuse coverage lexical recall lane signals`) plus engine-side query-local base-result reuse and base-signal flattening in `coverage-lexical-engine.ts`
- included hot-path changes in this anchor:
  - coarse ranking now caches one query-local per-document entry containing:
    - body evidence trace
    - passage admission signal
    - base coverage signal without local window evidence
    - coarse rankable result
  - rerank now reuses the cached base result and only computes `localEvidence`
  - base signal construction no longer repeatedly rescans metadata field arrays or repeatedly decodes numeric match codes for the same family
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
  - `MiniSearch`: avg 4.981 ms/query, p50 4.576 ms, p100 15.252 ms
  - `CoverageLexical`: avg 19.120 ms/query, p50 16.904 ms, p100 51.596 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 3.838`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 3.694`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 3.383`
- confirmation rerun:
  - `MiniSearch`: avg 3.904 ms/query, p50 3.518 ms, p100 9.858 ms
  - `CoverageLexical`: avg 17.596 ms/query, p50 15.745 ms, p100 47.001 ms
  - confirmation ratios: avg `4.507`, p50 `4.475`, p100 `4.768`
- interpretation:
  - the gain survives rerun noise and remains meaningfully better than the previous active anchor on avg, p50, and p100
  - unlike the earlier recall signal-churn cleanup, this step improves both `CoverageLexical` absolute time and the main latency ratios in a way that is strong enough to promote
  - the gain came from eliminating coarse-to-rerank duplicate document work and flattening the hottest per-family metadata scan path inside engine-side signal construction

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
  - size is unchanged versus the previous active anchor
  - the value of this step is ranking-path reuse and lower per-candidate query-time work, not storage compression

## Delta Vs Recall Query Cache Anchor

- baseline reference file:
  - `benchmarks/design/coverage-lexical-size-latency-baseline-recall-query-cache.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio moved from `4.941` to `3.838`
  - p50 ratio moved from `4.677` to `3.694`
  - p100 ratio moved from `5.507` to `3.383`
  - absolute `CoverageLexical` avg moved from `22.129` ms/query to `19.120` ms/query
- size:
  - estimated bytes stayed at `293,504`
  - estimated index size ratio stayed at `4.94`
  - treat this as flat in practice, not as a size story
- execution takeaway:
  - promote this file as the new active anchor
  - next latency work should keep targeting duplicated query-time document work or per-candidate full-family scans, not additional numeric migration by itself


