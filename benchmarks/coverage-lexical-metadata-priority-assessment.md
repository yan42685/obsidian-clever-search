# Coverage Lexical Metadata Priority Assessment

Date: 2026-03-30

## What Changed

- added a detailed staged execution plan in `benchmarks/coverage-lexical-metadata-priority-plan.md`
- added a pre-change benchmark anchor in `benchmarks/coverage-lexical-metadata-priority-baseline.md`
- introduced a `familyCountSummary` layer on `CoverageLexicalFamilySignal`
- added metadata ownership resolution with field priority:
  - `basename > aliases > folder > headings > tags`
- switched final ranking to use a count-first prefix before route-specific detail comparison
- added focused comparator tests plus basename/folder-oriented regression tests

## Files Changed

- `src/services/search/coverage-lexical/coverage-lexical-types.ts`
- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `src/services/search/coverage-lexical/coverage-lexical-ranker.ts`
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
- `benchmarks/coverage-lexical-metadata-priority-plan.md`
- `benchmarks/coverage-lexical-metadata-priority-baseline.md`

## Regression Status

- coverage lexical ranking tests: pass
- coverage lexical recall suite: pass
- coverage lexical planner tests: pass
- search-service bootstrap tests: pass

## Benchmark Delta Vs Baseline

Baseline summary:

- objective: 0.874
- top1: 0.79
- top3: 0.96
- top5: 1
- zeroRate: 0
- mrr: 0.877

Current summary:

- objective: 0.867
- top1: 0.784
- top3: 0.949
- top5: 0.994
- zeroRate: 0
- mrr: 0.873

Delta:

- objective: -0.007
- top1: -0.006
- top3: -0.011
- top5: -0.006
- zeroRate: unchanged
- mrr: -0.004

## Notable Improvements

- `title_exact` rose from top1 `0.5` to `1`
- `prefix_metadata` rose from top1 `0.6` to `0.8`
- `messy_pkm` top3 rose from `0.97` to `0.99`
- focused basename/folder ranking regressions now have explicit tests

## Notable Regressions

- `coverage_invariants` fell from top1 `1` to `0.75`
- `quality_guardrail` fell from top1 `1` to `0`
- `adversarial` top3 fell from `0.937` to `0.905`
- `mixed_anchor` top3 fell from `0.909` to `0.818`
- `body_path_anchor` top3 fell from `1` to `0.857`

Representative misses after the change:

- `config data roll`
  - relevant: `adversarial/ranker-lab/en/exact-quality-witness.md`
  - rank: 4
- `config data rollout`
  - relevant: `adversarial/ranker-lab/en/exact-quality-witness.md`
  - rank: 4
- `legacy wiki links after project rename`
  - relevant: `pkm-en/notes/linking/wikilink-drift.md`
  - rank: 6

## Triage Decision

This currently looks more like a real implementation issue than a benchmark-coverage issue.

Why:

- the regressions are not confined to out-of-scope query classes
- `quality_guardrail` is explicitly a guardrail family and regressed sharply
- overall benchmark movement is modest, but the dropped guardrail cases indicate the current metadata-priority prefix is still too blunt in some ranking situations
- recall contract stayed perfect, so the issue is in ranking semantics rather than recall loss

## Recommended Next Iteration

- keep the new count-summary scaffolding and tests
- revisit the count-prefix ordering so metadata field priority does not overpower exact-quality witnesses
- likely focus areas:
  - how count-prefix interacts with `quality_guardrail` and mixed-anchor queries
  - whether metadata field priority should be conditional on stronger structured-anchor evidence
  - whether body exact-quality evidence needs to intervene earlier in some tie classes

## Current Conclusion

The staged execution plan has been implemented through ranking/test/benchmark validation, but the new ranking behavior is not yet benchmark-clean enough to call finished. The structural groundwork is in place; the next step should be a refinement pass rather than a rollback to ad hoc tuning.
