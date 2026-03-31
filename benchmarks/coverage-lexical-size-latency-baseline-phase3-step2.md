# Coverage Lexical Size And Latency Baseline After Phase 3 Step 2 Hot Posting Migration

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after migrating the hottest posting buckets from `Set<string path>` to `docId`-oriented storage
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `2fdda12` (`Introduce coverage lexical doc id ownership`)
- included Phase 3 step:
  - `bodyPostings` now store `docId[]`
  - `bodyPhrasePostings` now store `docId[]`
  - `metadataPostings` now store `docId[]`
  - recall resolves numeric postings through an array-backed `docId -> path` table
  - field-specific metadata, tag, and char postings remain path-keyed in this slice
- timing anchor rule:
  - use `CoverageLexical / MiniSearch` latency ratios as the primary timing anchor
  - keep absolute milliseconds as a secondary reference only, because battery vs power mode changes local CPU behavior
- index-size anchor rule:
  - use the structural in-memory estimate from `CoverageLexicalFileSearchEngine.estimateIndexBytes()`
  - numeric posting slots are counted as compact `docId` cells rather than repeated path references
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
  - `MiniSearch`: avg 6.425 ms/query, p50 5.801 ms, p100 39.003 ms
  - `CoverageLexical`: avg 58.328 ms/query, p50 50.284 ms, p100 195.311 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 9.078`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 8.669`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 5.008`
- interpretation:
  - avg and p50 are the useful directional anchors from this run
  - p100 should be treated cautiously because `MiniSearch` had an unusually tall tail in this capture

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 285.770 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 4.926`

## Storage Shape Anchor

- `documentIdentity.total`: 1,768 bytes
- hottest posting buckets now numeric-first:
  - `postings.body`: 25,436 bytes
  - `postings.bodyPhrase`: 48,796 bytes
  - `postings.metadata`: 4,696 bytes
- interpretation:
  - this slice does not yet win large bytes by itself because the estimator had already modeled repeated posting paths as lightweight references
  - the real benefit of this step is that the hottest recall buckets are now aligned with future typed-array storage, denser serialization, and deeper docId-native query paths

## Delta Vs Phase 3 Step 1 Anchor

- baseline reference file:
  - `benchmarks/coverage-lexical-size-latency-baseline-phase3-step1.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio moved from `9.319` to `9.078`
  - p50 ratio moved from `8.659` to `8.669`
  - p100 ratio moved from `10.141` to `5.008`
  - treat avg and p50 as the stable comparison; do not over-read the p100 win from this single run
- size:
  - estimated bytes moved from `293,796` to `292,628`
  - estimated index size ratio moved from `4.945` to `4.926`
  - the byte win is modest, which is expected before field-specific postings and document-side strings are also migrated
