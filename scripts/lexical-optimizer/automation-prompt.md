# Lexical Optimizer Automation Prompt

Read `src/services/search/hybrid/automation-design.md` before every cycle.

## Ownership

- treat `src/services/search/coverage-lexical/coverage-lexical-engine.ts` as the designated implementation target for the new lexical engine
- treat `src/services/search/passage-lexical/passage-lexical-ranker.ts` as the smaller tuning / orchestration surface around that engine
- the new lexical engine must be code-wise independent from the legacy `passage-bm25` implementation
- do not modify or reuse `src/services/search/passage-lexical/passage-file-search-engine.ts` as the optimization target
- do not copy old scorer, verifier, comparator, or route logic into the new backend and call it a new engine
- do not treat the controller's old fixed parameter grid as the source of truth
- `scripts/lexical-optimizer/run.mjs` is only an evaluator and report writer
- automation should generate candidate manifests; the controller should not invent the search space

## Mechanism Bias

- prefer mechanism-level gains over coefficient-only tuning
- if a hypothesis needs a new verifier lane, planner path, scoring structure, or backend module, implement it in new backend code instead of only nudging numeric weights
- do not spend repeated cycles on tiny constant changes unless the previous cycle already proved a clear benchmark lift
- mechanism-level work should land in `src/services/search/coverage-lexical/coverage-lexical-engine.ts` unless there is a very strong reason to split additional new-backend modules beside it
- when the legacy `passage-bm25` hot path seems to be the bottleneck, build or extend the replacement engine without depending on old engine internals
- the goal is a new lexical stack that can clearly outperform the current baseline, not a long tail of low-yield patching

## What To Optimize

- maximize `0.55 * hits@1 + 0.25 * hits@3 + 0.20 * hits@5`
- especially improve:
  - body-first top1/top3 correctness
  - coverage-first ranking invariants
  - `exact > prefix > fuzzy`
  - tail-sensitive but coverage-safe ranking
  - local-window tie-break quality
- keep average latency, `p100` latency, and persisted index size under control

## Default Workflow

1. Form one primary hypothesis from `automation-design.md`.
2. Decide whether that hypothesis is `parameter-level` or `mechanism-level`; prefer `mechanism-level` when the expected gain is structural.
3. Place the work in one explicit lane:
   - `mechanism-a`: coverage comparator + family scorer
   - `mechanism-b`: local verifier + compactness/order/local window
   - `mechanism-c`: planner / route selection / metadata-body split
   - `benchmark`: benchmark expansion only
   - `regression`: validation and reporting only
4. Land mechanism-level backend work in `src/services/search/coverage-lexical/coverage-lexical-engine.ts`.
5. Use `src/services/search/passage-lexical/passage-lexical-ranker.ts` only as the smaller tuning / orchestration surface around that backend.
6. If extra backend modules are required, keep them clearly within the new coverage backend rather than borrowing legacy engine code.
7. If the change is only numeric, keep it small and reversible.
8. Write lane-specific candidate manifests under `.codex-bench/lexical-optimizer/lanes/<lane>/candidates.json`.
9. Prefer generating candidates automatically with `node scripts/lexical-optimizer/candidate-generator.mjs --lane=<lane>`.
10. For multi-lane research, prefer `node scripts/lexical-optimizer/orchestrate.mjs --lanes=mechanism-a,mechanism-b,mechanism-c`.
11. `run.mjs --mode=parameter --lane=<lane>` remains the per-lane evaluator.
12. Let stage1 do parallel coarse screen and stage2 do serial revalidation of top K winners.
13. Default automation behavior should auto-commit only retained winners; use `--no-auto-commit` when you only want evaluation.
14. Default automation behavior should clean temporary worktrees and per-run scratch resources; use `--no-cleanup` only when you explicitly need to inspect them.
15. Keep only changes that satisfy the keep rules.
16. Revert low-value complexity.

## Local Loop Commands

- inspect the built-in workflow help with `node scripts/lexical-optimizer/run.mjs --help`
- auto-generate a lane manifest with `node scripts/lexical-optimizer/candidate-generator.mjs --lane=mechanism-a`
- orchestrate the default research lanes with `node scripts/lexical-optimizer/orchestrate.mjs --lanes=mechanism-a,mechanism-b,mechanism-c`
- preview a lane with `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --dry-run`
- evaluate a lane without mutating the workspace with `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --no-auto-commit`
- evaluate and auto-commit the retained winner with `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a`
- tune worker count with `--parallel-workers=<n>` and serial revalidation breadth with `--revalidate-topk=<k>`
- disable temp cleanup for debugging with `--no-cleanup`
- compare the current workspace against the baseline worktree with `node scripts/lexical-optimizer/run.mjs --mode=mechanism --lane=mechanism-a --baseline-ref=HEAD`

## Benchmark Discipline

- use the full benchmark mix, not one cherry-picked slice
- prefer adding harder rule-targeted adversarial cases over adding many easy cases
- benchmark should reward the intended invariants, not legacy implementation details
- do not keep changes that only rescue one query while weakening the broader guardrail set
- if repeated coefficient-only edits fail to move the benchmark, switch the next cycle to a mechanism hypothesis instead of continuing local patching
