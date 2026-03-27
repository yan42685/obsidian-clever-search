# Lexical Optimizer Automation Prompt

Read `src/services/search/hybrid/automation-design.md` before every cycle.

## Ownership

- treat `src/services/search/passage-lexical/passage-lexical-ranker.ts` as the primary tuning surface
- treat that file as the orchestration surface for the next lexical backend, not as a license to endlessly patch the legacy `passage-bm25` engine
- do not treat the controller's old fixed parameter grid as the source of truth
- `scripts/lexical-optimizer/run.mjs` is only an evaluator and report writer
- automation should generate candidate manifests; the controller should not invent the search space

## Mechanism Bias

- prefer mechanism-level gains over coefficient-only tuning
- if a hypothesis needs a new verifier lane, planner path, scoring structure, or backend module, implement it instead of only nudging numeric weights
- do not spend repeated cycles on tiny constant changes unless the previous cycle already proved a clear benchmark lift
- when the legacy `passage-bm25` hot path seems to be the bottleneck, propose or implement a replacement module under `src/services/search/passage-lexical/` rather than adding more patch layers to the old engine
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
3. Edit `src/services/search/passage-lexical/passage-lexical-ranker.ts` and any new ranker/backend modules needed by that hypothesis.
4. If the change is only numeric, keep it small and reversible.
5. Write a candidate manifest to `.codex-bench/lexical-optimizer/candidates.json`.
6. Run `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json`.
7. Keep only changes that satisfy the keep rules.
8. Revert low-value complexity.

## Local Loop Commands

- inspect the built-in workflow help with `node scripts/lexical-optimizer/run.mjs --help`
- preview a candidate set with `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json --dry-run`
- evaluate candidates with `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json`
- apply the current best candidate with `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json --apply-best`
- compare the current workspace against the baseline worktree with `node scripts/lexical-optimizer/run.mjs --mode=mechanism --baseline-ref=HEAD`

## Benchmark Discipline

- use the full benchmark mix, not one cherry-picked slice
- prefer adding harder rule-targeted adversarial cases over adding many easy cases
- benchmark should reward the intended invariants, not legacy implementation details
- do not keep changes that only rescue one query while weakening the broader guardrail set
- if repeated coefficient-only edits fail to move the benchmark, switch the next cycle to a mechanism hypothesis instead of continuing local patching
