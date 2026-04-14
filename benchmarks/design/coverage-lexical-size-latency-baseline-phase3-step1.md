# Coverage Lexical Size And Latency Baseline After Phase 3 Step 1 DocId Ownership

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after introducing stable `docId` ownership and before migrating postings away from `Set<string path>`
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-legacy-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `872fc5f` (`Freeze coverage lexical phase 2 baseline`)
- included Phase 3 step:
  - stable `docId` ownership for indexed files
  - same-path reindex preserves `docId`
  - true delete releases ownership
  - `clearIndex()` resets ownership state
  - size accounting now reports the explicit `documentIdentity` bucket
- timing anchor rule:
  - use `CoverageLexical / MiniSearch` latency ratios as the primary timing anchor
  - keep absolute milliseconds as a secondary reference only, because battery vs power mode changes local CPU behavior
- index-size anchor rule:
  - use the structural in-memory estimate from `CoverageLexicalFileSearchEngine.estimateIndexBytes()`
  - treat this as a benchmark-facing storage estimate, not a V8 heap snapshot

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
  - `MiniSearch`: avg 4.434 ms/query, p50 3.990 ms, p100 12.475 ms
  - `CoverageLexical`: avg 41.321 ms/query, p50 34.551 ms, p100 126.501 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 9.319`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 8.659`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 10.141`

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 286.910 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 4.945`

## Identity Cost Anchor

- `estimatedBytes.documentIdentity.total`: 2,936 bytes
- additional document-store `docIds` slot cost: 584 bytes
- total Phase 3 Step 1 overhead vs Phase 2 anchor: 3,520 bytes
- interpretation:
  - this step intentionally adds a small amount of memory so later numeric postings and binary-friendly layout work have a stable ownership layer
  - this is acceptable only because quality stayed unchanged and the next Phase 3 steps should reclaim far more than this by removing repeated path strings from postings

## Delta Vs Phase 2 Anchor

- baseline reference file:
  - `benchmarks/design/coverage-lexical-size-latency-baseline-phase2.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio moved from `10.05` to `9.319`
  - p50 ratio moved from `9.073` to `8.659`
  - p100 ratio moved from `10.409` to `10.141`
  - interpret these as benchmark-clean and slightly better, not as a claimed optimization from `docId` ownership itself
- size:
  - estimated bytes moved from `290,276` to `293,796`
  - estimated index size ratio moved from `4.886` to `4.945`
  - this is the expected temporary tax for introducing explicit document identity before numeric postings compression lands


