# File Search Web Baseline

Date: March 23, 2026

This file records the current checkpoint for the experimental lexical backend so later iterations can compare against a stable, human-readable baseline instead of scrolling old test logs.

Scope:

- benchmark command: `node node_modules/jest/bin/jest.js --config jest.file-search-web-benchmark.config.js --runInBand tests/src/services/search/file-search-web-benchmark.bench.ts`
- corpus: `web-notes-v2` plus the synthetic adversarial / messy PKM cases
- corpus size at this checkpoint: `60` notes
- query count at this checkpoint: `267`
- experimental backend under evaluation: `src/services/search/passage-lexical/`

## Summary Snapshot

| Engine | top1 | top5 | zeroRate | avgMs/query | p50 | p95 | estimatedIndexKB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PassageBM25 | 0.760 | 0.936 | 0.052 | 8.462 | 4.085 | 26.268 | 9228.873 |
| MiniSearch | 0.678 | 0.854 | 0.146 | 54.983 | 54.760 | 121.711 | 642.151 |
| CustomBM25 | 0.655 | 0.869 | 0.124 | 0.509 | 0.190 | 0.754 | 181.524 |

## What This Milestone Proves

- the experimental backend now beats both baselines on the overall benchmark, not just on a single adversarial family
- the strongest lift is still on body-first retrieval rather than metadata-first short lookup
- local-window competition and route-aware file fusion produce a real top1 gain while staying interactive
- the current implementation is fast enough to continue evolving without reverting to a simpler baseline
- the latest verifier pass confirms that lightweight exact-phrase optimization is worth keeping, while naive verifier frontier clipping is not yet justified

## High-Signal Wins

- `adversarial top1`: `0.753` for `PassageBM25` vs `0.639` for `MiniSearch` vs `0.620` for `CustomBM25`
- `content_noisy`: `0.438` vs `0.063` vs `0.000`
- `mixed_anchor`: `0.875` vs `0.813` vs `0.813`
- `body_path_anchor`: `0.857` vs `0.800` vs `0.686`
- `partial_memory`: `0.667` vs `0.000` vs `0.667`
- `anchor_contradiction`: `1.000` vs `0.333` vs `1.000`

## Current Weak Spots

- `title_prefix` is still below `CustomBM25` (`0.690` vs `0.759`)
- `tech-zh top1` is still only `0.569`
- `content_noisy` improved a lot, but `0.438` still leaves large headroom
- `bilingual_mirror` is covered, but it does not yet separate engines strongly enough to count as a solved mechanism test
- the experimental index is much larger than both baselines, so future quality gains should continue to justify storage cost

## Guardrails

Treat the following as checkpoint guardrails unless there is a deliberate re-baselining decision:

- keep `PassageBM25 top1 >= 0.75`
- keep `PassageBM25 top5 >= 0.93`
- keep `PassageBM25 adversarial top1 >= 0.74`
- keep `PassageBM25 zeroRate <= 0.06`
- keep `PassageBM25 avgMsPerQuery <= 10`
- keep `PassageBM25 p95 <= 30ms`

## Recommended Next Step

- focus next on a new mechanism jump rather than more broad coefficient tuning
- the best next candidates are structured query decomposition, bilingual duplicate disambiguation, and a lightweight phrase-signature admission channel
- if verifier early termination returns, it should be upper-bound-backed or feature-local; naive frontier clipping has not yet earned promotion
