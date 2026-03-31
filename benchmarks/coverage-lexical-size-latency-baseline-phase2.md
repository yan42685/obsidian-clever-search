# Coverage Lexical Size And Latency Baseline After Phase 2 Compression

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after the first successful phrase-storage compression wave and before Phase 3 live-layout redesign
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- benchmark capture commit:
  - `fc1b7d9` (`Canonicalize coverage lexical phrase storage`)
- included compression steps:
  - `5ad1473` removed aggregate `metadataPhrasePostings` / `metadataPhraseTerms`
  - `fc1b7d9` canonicalized stored phrase keys while keeping multi-variant query probes
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
  - `MiniSearch`: avg 5.588 ms/query, p50 5.166 ms, p100 16.749 ms
  - `CoverageLexical`: avg 56.163 ms/query, p50 46.868 ms, p100 174.344 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 10.05`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 9.073`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 10.409`

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 283.473 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 4.886`

## Phase 2 Delta Vs Original Anchor

- baseline reference file:
  - `benchmarks/coverage-lexical-size-latency-baseline.md`
- quality:
  - unchanged on the active corpus
- timing:
  - avg ratio improved from `11.579` to `10.05`
  - p50 ratio improved from `10.61` to `9.073`
  - p100 ratio improved from `12.558` to `10.409`
- size:
  - estimated bytes dropped from `817,838` to `290,276`
  - estimated KB dropped from `798.67` to `283.473`
  - relative size ratio improved from `13.766` to `4.886`

## CoverageLexical In-Memory Breakdown

- total estimated bytes: 290,276
- stringPool: 114,396
- documents: 75,000
- postings total: 98,776
- lexicon references: 2,104

## Largest CoverageLexical Cost Centers

- postings:
  - `bodyPhrase`: 48,796 bytes
  - `body`: 25,436 bytes
  - `metadataAliasPhrase`: 3,188 bytes
  - `metadataBasenamePhrase`: 2,972 bytes
  - `metadata`: 4,696 bytes
- document-side references:
  - `bodyPhraseTerms`: 25,476 bytes
  - `bodyTokenSequence`: 19,228 bytes
  - `bodyTerms`: 19,228 bytes
  - `metadataTerms`: 2,424 bytes

## Current Shape Notes

- the first phrase-compression wave succeeded without changing benchmark quality
- aggregate `metadataPhrasePostings` and document-side `metadataPhraseTerms` are no longer present
- phrase storage is now dominated by canonicalized body phrase keys rather than connector-expanded duplicates
- `bodyPhrasePostings` remains the largest single posting bucket, but it is much smaller than in the original anchor
- current Han segment posting buckets are still present in the engine surface but empty in this benchmark capture
- the next large storage and startup gains should come from Phase 3 numeric-first live layout work rather than more ad hoc phrase surgery

## Guardrail Interpretation

- quality remains the primary product constraint
- time and size work should be judged against the relative anchors above, not only absolute milliseconds
- later benchmark writeups should report:
  - quality delta vs this Phase 2 anchor
  - latency ratio delta vs this Phase 2 anchor
  - estimated index size ratio delta vs this Phase 2 anchor
