# Lexical Optimizer Automation Prompt

Read `src/services/search/hybrid/automation-design.md` before every cycle.

## Ownership

- treat `src/services/search/passage-lexical/passage-lexical-ranker-tuning.ts` as the primary tuning surface
- do not treat the controller's old fixed parameter grid as the source of truth
- `scripts/lexical-optimizer/run.mjs` is only an evaluator and report writer
- automation should generate candidate manifests; the controller should not invent the search space

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
2. Edit `src/services/search/passage-lexical/passage-lexical-ranker-tuning.ts` or the ranker code needed by that hypothesis.
3. Write a candidate manifest to `.codex-bench/lexical-optimizer/candidates.json`.
4. Run `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json`.
5. Keep only changes that satisfy the keep rules.
6. Revert low-value complexity.

## Benchmark Discipline

- use the full benchmark mix, not one cherry-picked slice
- prefer adding harder rule-targeted adversarial cases over adding many easy cases
- benchmark should reward the intended invariants, not legacy implementation details
- do not keep changes that only rescue one query while weakening the broader guardrail set
