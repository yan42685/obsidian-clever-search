# Coverage Lexical Metadata Priority Baseline

Date: 2026-03-30

## Context

- purpose: anchor benchmark and regression behavior before introducing metadata-priority count-first ranking
- command:
  - `node node_modules/jest/bin/jest.js --runInBand tests/src/services/search/coverage-lexical-ranking.test.ts tests/src/services/search/coverage-lexical-recall-suite.test.ts tests/src/services/search/coverage-lexical-planner.test.ts tests/src/services/obsidian/search-service-bootstrap.test.ts`
  - `node node_modules/jest/bin/jest.js --config jest.coverage-lexical-legacy-benchmark.config.js --runInBand tests/src/services/search/coverage-lexical-legacy-automation-benchmark.bench.ts`
- worktree note:
  - existing unrelated local modifications are present in `src/services/search/coverage-lexical/coverage-lexical-planner.ts`
  - existing unrelated local modifications are present in `tests/src/services/search/coverage-lexical-planner.test.ts`

## Regression Suite Anchor

- coverage lexical ranking tests: pass
- coverage lexical recall suite: pass
- coverage lexical planner tests: pass
- search-service bootstrap tests: pass

## Benchmark Corpus

- noteCount: 73
- queryCount: 176
- docsWithHan: 40
- docsWithLatinAndHan: 40
- bySuite:
  - core: 6
  - coverage_invariants: 8
  - adversarial: 63
  - messy_pkm: 99

## CoverageLexical Summary

- objective: 0.874
- top1: 0.79
- top3: 0.96
- top5: 1
- zeroRate: 0
- mrr: 0.877
- avgMsPerQuery: 39.512
- p50Ms: 34.729
- p100Ms: 117.167
- estimatedIndexKB: 1017.938

## CoverageLexical By Suite

- core: top1 0.667, top3 1, top5 1, zeroRate 0
- coverage_invariants: top1 1, top3 1, top5 1, zeroRate 0
- adversarial: top1 0.746, top3 0.937, top5 1, zeroRate 0
- messy_pkm: top1 0.808, top3 0.97, top5 1, zeroRate 0

## CoverageLexical By Type Highlights

- prefix_metadata: top1 0.6, top3 1, top5 1, zeroRate 0
- body_path_anchor: top1 0.429, top3 1, top5 1, zeroRate 0
- body_title_anchor: top1 0.8, top3 1, top5 1, zeroRate 0
- mixed_anchor: top1 0.727, top3 0.909, top5 1, zeroRate 0
- mixed_script_anchor: top1 0.667, top3 0.75, top5 1, zeroRate 0
- partial_memory: top1 0.808, top3 0.97, top5 1, zeroRate 0

## Recall Contract Anchor

- unionHitRate: 1
- zeroRate: 0
- laneHitCounts:
  - strict_metadata_lane: 13
  - strict_hybrid_lane: 10
  - relaxed_hybrid_lane: 10
  - local_body_lane: 12
  - bridge_lane: 14

## Representative CoverageLexical Misses

- `frontmatter alias 提过 note about restoring cache after warmup failed`
  - relevant: `pkm-en/projects/sdk/cache-restore-checklist.md`
  - rank: 5
- `legacy wiki links after project rename`
  - relevant: `pkm-en/notes/linking/wikilink-drift.md`
  - rank: 5
- `tech-zh projected token pod runtime access`
  - relevant: `tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md`
  - rank: 4
- `vector cache incident notes after outage`
  - relevant: `pkm-en/incidents/vector-cache-postmortem.md`
  - rank: 4
- `cache restore after outage replay steps`
  - relevant: `pkm-en/projects/sdk/cache-restore-checklist.md`
  - rank: 3

## CoverageLexical vs MiniSearch

- leftTop1WinCount: 71
- rightTop1WinCount: 2
- leftTop1WinsBySuite:
  - coverage_invariants: 6
  - core: 3
  - adversarial: 12
  - messy_pkm: 50
- rightTop1WinsBySuite:
  - messy_pkm: 2

## Interpretation Anchor

- current `coverage-lexical` already dominates `MiniSearch` on this corpus
- known weakness clusters before this change are still concentrated in:
  - mixed anchor disambiguation
  - mixed-script anchor disambiguation
  - a small tail of partial-memory ranking misses
- any post-change benchmark movement should be judged against these existing weak spots rather than against a perfect baseline

