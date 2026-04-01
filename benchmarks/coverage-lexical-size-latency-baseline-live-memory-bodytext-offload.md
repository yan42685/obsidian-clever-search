## Coverage Lexical Live-Memory BodyText Offload Anchor

Date: 2026-04-01

## Context

- purpose: freeze the first retained live-memory reduction after removing resident `bodyText` from `CoverageLexicalDocument` and shifting direct-subitems body reads to `FileSnapshotStore`
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- benchmark capture state:
  - working tree after:
    - live documents stop storing `bodyText`
    - direct subitems fetch source body text on demand from `FileSnapshotStore`
    - delete and rebuild continue to rely on doc-id side arrays:
      - `documentBodyTokensById`
      - `documentBodyHanSegmentsById`
      - `documentTagValuesById`
- timing anchor rule:
  - use `CoverageLexical / MiniSearch` latency ratios as the primary timing anchor
  - keep absolute milliseconds as a secondary reference only
- size anchor rule:
  - use `CoverageLexicalFileSearchEngine.estimateIndexBytes()`
  - judge this step on live resident structure, not persisted snapshot bytes

## Corpus Anchor

- noteCount: 73
- queryCount: 176
- docsWithHan: 40
- docsWithLatinAndHan: 40

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

- run 1 absolute reference:
  - `MiniSearch`: avg 3.297 ms/query, p50 3.117 ms, p100 7.134 ms
  - `CoverageLexical`: avg 10.446 ms/query, p50 8.759 ms, p100 27.746 ms
  - ratios: avg `3.168`, p50 `2.809`, p100 `3.889`
- run 2 absolute reference:
  - `MiniSearch`: avg 4.662 ms/query, p50 4.428 ms, p100 11.627 ms
  - `CoverageLexical`: avg 10.728 ms/query, p50 8.302 ms, p100 30.264 ms
  - ratios: avg `2.301`, p50 `1.875`, p100 `2.603`
- run 3 absolute reference:
  - `MiniSearch`: avg 3.987 ms/query, p50 3.701 ms, p100 10.377 ms
  - `CoverageLexical`: avg 12.164 ms/query, p50 10.218 ms, p100 33.559 ms
  - ratios: avg `3.051`, p50 `2.761`, p100 `3.234`
- three-run relative center:
  - avg latency ratio center: `2.840`
  - p50 latency ratio center: `2.482`
  - p100 latency ratio center: `3.242`
- interpretation:
  - quality stayed unchanged on the anchored corpus
  - this retained step materially improved the relative latency band versus the previous active query anchor
  - the gain came from lowering resident document weight and keeping source body text off the live hot layout rather than from another recall-path micro-optimization

## Size Anchor

- absolute reference:
  - `MiniSearch`: 58.018 KB
  - `CoverageLexical`: 172.151 KB
- primary relative anchor:
  - estimated index size ratio: `CoverageLexical / MiniSearch = 2.967`

## Storage Shape Anchor

- `documents.total`: 2,924 bytes
- `documentIdentity.total`: 23,868 bytes
  - `bodyTokensById.total`: 19,816 bytes
  - `bodyHanSegmentsById.total`: 1,060 bytes
  - `tagValuesById.total`: 928 bytes
- hottest posting buckets remain:
  - `postings.body`: 25,436 bytes
  - `postings.bodyPhrase`: 48,796 bytes
  - `postings.metadata`: 4,696 bytes
- interpretation:
  - the live document store no longer pays resident `bodyText` cost
  - doc-id side ownership is now the dominant retained document-identity cost, which is acceptable because it is directly reused by query, delete, and restore paths

## Delta Vs Previous Active Query Anchor

- baseline reference file:
  - `benchmarks/coverage-lexical-size-latency-baseline-body-evidence-matcher-precompute.md`
- quality:
  - unchanged on the automation corpus
- timing:
  - previous three-run ratio center:
    - avg `3.982`
    - p50 `3.852`
    - p100 `3.627`
  - new three-run ratio center:
    - avg `2.840`
    - p50 `2.482`
    - p100 `3.242`
- size:
  - estimated bytes moved from `293,504` to `176,283`
  - estimated size ratio moved from `4.94` to `2.967`
- execution takeaway:
  - promote this file as the new active query anchor for the live-memory slimming track
  - next work should keep targeting resident document weight and binary-friendly ownership layout, not speculative persisted-byte compression
