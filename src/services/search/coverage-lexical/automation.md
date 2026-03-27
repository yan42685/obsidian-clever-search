# Coverage Lexical Automation MVP

This file defines the intended MVP architecture for the isolated `coverage-lexical` backend.

It exists so automation work does not drift back into `passage-file-search-engine` or generic score blending.

## Core Rule

`coverage-lexical` should be designed around the ranking invariants in [`../hybrid/automation-design.md`](../hybrid/automation-design.md), not around legacy file-engine heuristics.

## MVP Architecture

1. `recall` and `coverage-first ranking` must stay separate.

- the isolated backend should own its own recall contract and storage decisions
- passage-first or local-window evidence is allowed, but it must be implemented natively inside `coverage-lexical`
- do not depend on `passage-bm25` code paths, snapshot formats, or scorer/verifier helpers as the hidden recall layer
- the isolated backend should own its own `planner`, `family decomposition`, and `comparator`

2. Keep the MVP surface intentionally small.

- `coverage-lexical-engine.ts`: orchestrates recall + plan + rank
- `coverage-lexical-families.ts`: family decomposition and core/soft classification
- `coverage-lexical-planner.ts`: route selection and query-shape flags
- `coverage-lexical-ranker.ts`: family-first comparator only
- `coverage-lexical-windowing.ts`: query-conditioned passage / local-window evidence
- `coverage-lexical-fusion.ts`: file-level fusion of family-first and local evidence

3. Avoid copying passage-local machinery into the MVP.

- no passage verifier migration in the MVP
- no metadata lane score soup
- no heuristic blend copied from `passage-bm25`
- no legacy `passage-file-search-engine` dependency disguised as shared infrastructure

## MVP Ranking Contract

The comparator should implement this order directly:

1. core body family coverage
2. family match quality (`exact > prefix > fuzzy`)
3. tail-weighted core quality
4. route-specific metadata anchor support

The MVP should include lightweight local-window evidence from the start.

- do not stop at a pure file-level family comparator
- use passage-first or query-conditioned local-window evidence as the default body evidence unit
- richer verifier layers may still be staged later if the lightweight local-window layer proves insufficient

## Benchmark Direction

Benchmark work should serve `coverage-lexical` directly.

1. Add explicit `CoverageLexical` reporting as a first-class system.
2. Compare `CoverageLexical` against `MiniSearch` only inside the automation benchmark loop.
3. Keep one full benchmark run under `20s` on a normal development machine.
4. Keep `coverage_invariants` as an explicit benchmark suite rather than burying family-first rules in a generic adversarial pool.
- this suite should own the ranking guardrails: coverage, exact-prefix-fuzzy ordering, subordinate tail bias, and tie-only locality
5. Keep a separate broader adversarial pool for mixed-script, metadata+body, collision, and messy-note stress.
6. Benchmark output should report the primary objective directly:
- `0.55 * hits@1 + 0.25 * hits@3 + 0.20 * hits@5`
7. Prefer adversarial sets that stress:
- coverage beats repeated noise
- exact beats prefix beats fuzzy on tied coverage
- tail decides only after coverage and quality tie
- metadata helps only when route says it should
8. Keep existing broad corpus coverage, but do not let legacy expectations dictate the new comparator.

## Exploration Order

1. stabilize MVP architecture
2. stabilize benchmark around ranking invariants
3. explore one mechanism at a time inside `coverage-lexical`

## Keep / Revert Discipline

Keep only if:

- objective improves
- or objective is preserved while latency or size materially improves

Revert if:

- `hits@1` regresses noticeably
- a gain comes from a narrow family while broader adversarial sets regress
- complexity grows without benchmark justification
