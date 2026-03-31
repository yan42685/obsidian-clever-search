# Coverage Lexical Size And Latency Baseline After Recall Query-Local Caching

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after the first high-ROI recall-side caching step so later recall and ranking work compares against the latest measured latency win rather than against the earlier query-hotpath-flattening anchor
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `27b1f23` (`Share coverage lexical body evidence tracing`) plus recall-side query-local caching in `coverage-lexical-recall.ts`
- included hot-path changes in this anchor:
  - lane evaluation now reuses one query-local body-evidence trace per `docId`
  - passage admission signal is memoized per `docId` plus phrase-witness shape rather than rebuilt repeatedly across lanes
  - tag fallback memoization remains in place from the earlier Phase 1 work
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
  - `MiniSearch`: avg 4.478 ms/query, p50 4.233 ms, p100 10.772 ms
  - `CoverageLexical`: avg 22.129 ms/query, p50 19.797 ms, p100 59.316 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 4.941`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 4.677`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 5.507`
- interpretation:
  - this is the first retained change after query-hotpath flattening that clearly and repeatably improves the main latency ratios, not just absolute time
  - the big gain came from removing repeated per-lane document analysis during recall admission, not from changing the live index layout
  - `p100` is still noisier than `avg` and `p50`, but it remains materially better than the previous active anchor and no longer blocks promotion

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
  - the value of this step is query-time reuse of document-derived evidence, not in-memory storage compression

## Delta Vs Query Hot-Path Flattening Anchor

- baseline reference file:
  - `benchmarks/coverage-lexical-size-latency-baseline-query-hotpath-flattening.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio moved from `9.458` to `4.941`
  - p50 ratio moved from `8.931` to `4.677`
  - p100 ratio moved from `10.839` to `5.507`
  - absolute `CoverageLexical` avg moved from `47.232` ms/query to `22.129` ms/query
- size:
  - estimated bytes stayed at `293,504`
  - estimated index size ratio stayed at `4.94`
  - treat this as flat in practice, not as a size story
- execution takeaway:
  - promote this file as the new active anchor
  - next latency work should focus on recall-side signal construction churn, especially repeated group-signal assembly and bridge/body merge work inside lane prefiltering and evaluation
