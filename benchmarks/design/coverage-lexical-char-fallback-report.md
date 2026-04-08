# Coverage Lexical Char Fallback Report

This report records the current working-tree benchmark anchor before and after
adding the Han bigram fallback channel, the simplified tag fallback, and the
char-aware direct-subitem highlighting path.

## Benchmark

- command:
  `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- corpus:
  `73` docs, `176` queries
- anchor date:
  `2026-03-29`

## CoverageLexical Summary

| metric | baseline | after | delta |
| --- | ---: | ---: | ---: |
| top1 | 0.790 | 0.790 | 0.000 |
| top3 | 0.960 | 0.960 | 0.000 |
| top5 | 1.000 | 1.000 | 0.000 |
| zeroRate | 0.000 | 0.000 | 0.000 |
| mrr | 0.878 | 0.877 | -0.001 |
| avgMsPerQuery | 57.859 | 62.002 | +4.143 |
| p50Ms | 50.494 | 54.032 | +3.538 |
| p100Ms | 151.863 | 160.454 | +8.591 |
| estimatedIndexKB | 1009.617 | 1017.938 | +8.321 |
| totalElapsedMs | 11670.950 | 13272.610 | +1601.660 |

## Index Breakdown Delta

- `bodyCharTermCount`: `0 -> 58`
- `metadataAliasCharTermCount`: `0 -> 13`
- `metadataBasenameCharTermCount`: `0 -> 23`
- `metadataFolderCharTermCount`: `0 -> 0`
- `metadataHeadingCharTermCount`: `0 -> 12`
- `metadataTagCharTermCount`: `0 -> 10`
- `metadataTagFullTermCount`: `0 -> 47`

## Interpretation

- The automation corpus did not improve on `top1/top3/top5/zeroRate`.
- This is expected because the benchmark mock tokenizer already injects Han
  bigrams, so the corpus was already close to the new mechanism.
- The new mechanism is still valuable because it now exists in the real
  `coverage-lexical` runtime path instead of only in benchmark mocks.
- The measured cost on this corpus is modest but real:
  roughly `+7.2%` average query latency and `+0.8%` estimated index size.

## Guardrail Tests Added

- `tests/src/services/search/coverage-lexical-char-fallback.test.ts`
  verifies Han body fallback and simplified tag fallback.
- `tests/src/services/search/coverage-lexical-direct-subitems.test.ts`
  verifies char-level snippet highlighting fallback.
