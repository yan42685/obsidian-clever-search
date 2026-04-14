# Coverage Lexical Size And Latency Baseline

Date: 2026-03-31

## Context

- purpose: anchor `coverage-lexical` before query-time and index-layout compression work
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-legacy-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
- benchmark capture commit:
  - `59050ae` (`Fix coverage lexical index size accounting`)
- worktree note:
  - baseline metrics below were refreshed after adding relative-anchor benchmark logging in `tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
  - that logging change does not change search behavior; it only records ratio-oriented timing anchors
- timing anchor rule:
  - use `CoverageLexical / MiniSearch` latency ratios as the primary timing anchor
  - keep absolute milliseconds as a secondary reference only, because battery vs power mode changes local CPU behavior
- index-size anchor rule:
  - use the corrected structural in-memory estimate from `CoverageLexicalFileSearchEngine.estimateIndexBytes()`
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
  - `MiniSearch`: avg 4.781 ms/query, p50 4.536 ms, p100 13.285 ms
  - `CoverageLexical`: avg 55.363 ms/query, p50 48.126 ms, p100 166.843 ms
- primary relative anchor:
  - avg latency ratio: `CoverageLexical / MiniSearch = 11.579`
  - p50 latency ratio: `CoverageLexical / MiniSearch = 10.61`
  - p100 latency ratio: `CoverageLexical / MiniSearch = 12.558`

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 798.67 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 13.766`

## CoverageLexical In-Memory Breakdown

- total estimated bytes: 817,838
- stringPool: 263,610
- documents: 194,128
- postings total: 357,996
- lexicon references: 2,104

## Largest CoverageLexical Cost Centers

- postings:
  - `bodyPhrase`: 221,196 bytes
  - `metadataPhrase`: 58,724 bytes
  - `body`: 25,436 bytes
  - `metadataAliasPhrase`: 13,940 bytes
  - `metadataBasenamePhrase`: 11,964 bytes
- document-side references:
  - `bodyPhraseTerms`: 117,716 bytes
  - `bodyTokenSequence`: 19,228 bytes
  - `bodyTerms`: 19,228 bytes
  - `metadataPhraseTerms`: 18,040 bytes

## Current Shape Notes

- phrase-heavy storage is the dominant size driver in both postings and document-held caches
- `bodyPhrasePostings` is the single largest posting bucket by a wide margin
- aggregate `metadataPhrasePostings` is materially larger than any field-specific metadata phrase bucket
- current Han segment posting buckets are present in the engine surface but empty in this benchmark capture
- current benchmark still shows strong quality advantage for `CoverageLexical`; the compression program should preserve that advantage rather than optimize for raw size alone

## Guardrail Interpretation

- quality must remain the primary product constraint
- time and size work should be judged against the relative anchors above, not only absolute milliseconds
- any later benchmark should report:
  - quality delta vs this anchor
  - latency ratio delta vs this anchor
  - estimated index size ratio delta vs this anchor

