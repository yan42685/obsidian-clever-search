# Coverage Lexical Size And Latency Baseline After Phase 3 Step 3 Canonical Recall Candidate Migration

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after making recall candidate collection internally canonical-keyed so numeric postings stay `docId`-native until final path projection
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-legacy-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `1da764a` (`Migrate coverage lexical hot postings to doc ids`) plus the Phase 3 Step 3 canonical recall migration
- included Phase 3 step:
  - recall candidate collection now uses canonical candidate keys internally:
    - numeric postings remain `docId`
    - path-keyed postings canonicalize to `docId` when identity is available
  - external recall API remains path-keyed at the final projection boundary
  - duplicate evidence from mixed posting shapes now merges on canonical identity instead of relying on early path restoration
  - field-specific metadata, tag, and char postings remain path-stored in this slice
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
  - `MiniSearch`: avg 5.466 ms/query, p50 4.931 ms, p100 13.256 ms
  - `CoverageLexical`: avg 57.404 ms/query, p50 48.134 ms, p100 168.383 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 10.501`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 9.762`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 12.703`
- interpretation:
  - this step should be treated as a structural correctness and migration slice, not a latency win
  - the ratio regression is plausible because many surviving field/tag/char postings are still path-keyed and now pay canonicalization lookups before they can merge into numeric-first candidates
  - the next latency-sensitive step is to migrate more remaining hot path-keyed postings into numeric storage rather than re-tuning lane parameters around this temporary mixed layout

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 285.770 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 4.926`

## Storage Shape Anchor

- `documentIdentity.total`: 1,768 bytes
- hottest posting buckets remain numeric-first:
  - `postings.body`: 25,436 bytes
  - `postings.bodyPhrase`: 48,796 bytes
  - `postings.metadata`: 4,696 bytes
- new recall-shape property:
  - mixed posting sources now converge into a canonical candidate identity before final path projection
- interpretation:
  - size is unchanged because this slice mostly changes query-time candidate handling rather than live posting representation
  - the value of this step is that future numeric migration can remove the remaining mixed-layout tax without risking candidate fragmentation between `docId` and path representations

## Delta Vs Phase 3 Step 2 Anchor

- baseline reference file:
  - `benchmarks/design/coverage-lexical-size-latency-baseline-phase3-step2.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio moved from `9.078` to `10.501`
  - p50 ratio moved from `8.669` to `9.762`
  - p100 ratio moved from `5.008` to `12.703`
  - do not read this as a reason to revert the identity merge fix by itself; read it as evidence that the mixed layout is still paying too much string-side overhead
- size:
  - estimated bytes stayed at `292,628`
  - estimated index size ratio stayed at `4.926`
- execution takeaway:
  - Phase 3 should continue by migrating the remaining field-specific metadata, tag, and char postings off path sets before evaluating whether canonical-key recall can deliver its intended latency win


