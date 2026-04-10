# Coverage Lexical Size And Latency Baseline After Body Evidence Family Matcher Precompute

Date: 2026-03-31

## Context

- purpose: freeze `coverage-lexical` after flattening the shared body-evidence matcher path so future latency work compares against the first retained post-engine-cache win in the document scan itself
- benchmark command:
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- benchmark capture commit:
  - working tree after `f66fa47` (`Cache coverage lexical engine rank signals`) plus the retained body-evidence matcher precompute in `coverage-lexical-body-evidence.ts`
- included hot-path changes in this anchor:
  - shared body-evidence tracing now precomputes one matcher record per active family containing:
    - normalized term length
    - first character
    - prefix eligibility
    - admission fuzzy threshold
    - window fuzzy threshold
    - maximum fuzzy bound
  - token matching now reuses that precomputed matcher state instead of recomputing fuzzy thresholds inside `classifyTokenMatchKinds` for every `token x family` comparison
  - the retained version keeps the original flat scan shape and does not keep the more aggressive exact-bucket or per-token cache experiment because that version benchmarked worse and was reverted
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

- run 1 absolute reference:
  - `MiniSearch`: avg 4.828 ms/query, p50 4.552 ms, p100 14.790 ms
  - `CoverageLexical`: avg 17.748 ms/query, p50 15.820 ms, p100 42.406 ms
  - ratios: avg `3.676`, p50 `3.476`, p100 `2.867`
- run 2 absolute reference:
  - `MiniSearch`: avg 3.584 ms/query, p50 3.367 ms, p100 9.478 ms
  - `CoverageLexical`: avg 16.083 ms/query, p50 14.697 ms, p100 39.959 ms
  - ratios: avg `4.487`, p50 `4.365`, p100 `4.216`
- run 3 absolute reference:
  - `MiniSearch`: avg 4.159 ms/query, p50 3.817 ms, p100 11.087 ms
  - `CoverageLexical`: avg 15.730 ms/query, p50 14.175 ms, p100 42.101 ms
  - ratios: avg `3.783`, p50 `3.714`, p100 `3.797`
- three-run relative center:
  - avg latency ratio center: `3.982`
  - p50 latency ratio center: `3.852`
  - p100 latency ratio center: `3.627`
- interpretation:
  - quality stayed unchanged across all retained runs
  - size stayed unchanged
  - compared with the previous active anchor, the three-run center improved on avg, p50, and p100 ratios
  - single-run noise still exists, but this step held a better overall band than the previous active anchor rather than winning by only one lucky sample
  - the gain came from removing repeated per-family threshold work inside the shared document scan while avoiding the extra map/cache overhead that hurt the more aggressive experiment

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
  - the value of this step is lower shared document-scan cost, not storage compression

## Delta Vs Engine Query Cache Anchor

- baseline reference file:
  - `benchmarks/design/coverage-lexical-size-latency-baseline-engine-query-cache.md`
- quality:
  - unchanged on the active corpus
- timing:
  - previous active anchor ratios:
    - run A: avg `3.838`, p50 `3.694`, p100 `3.383`
    - run B: avg `4.507`, p50 `4.475`, p100 `4.768`
  - new retained anchor ratios:
    - run 1: avg `3.676`, p50 `3.476`, p100 `2.867`
    - run 2: avg `4.487`, p50 `4.365`, p100 `4.216`
    - run 3: avg `3.783`, p50 `3.714`, p100 `3.797`
  - three-run center vs previous two-run center:
    - avg ratio moved from `4.173` to `3.982`
    - p50 ratio moved from `4.085` to `3.852`
    - p100 ratio moved from `4.076` to `3.627`
  - absolute `CoverageLexical` avg moved within a better band while quality stayed flat
- size:
  - estimated bytes stayed at `293,504`
  - estimated index size ratio stayed at `4.94`
  - treat this as flat in practice, not as a size story
- execution takeaway:
  - promote this file as the new active anchor
  - next latency work should keep targeting shared downstream consumers of body-evidence and other repeated per-family scans, not broad token-bucket caching unless a benchmark clearly proves it

