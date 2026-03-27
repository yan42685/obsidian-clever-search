# Lexical Optimizer Automation Entry

Read these files before every cycle, in this order:

1. `src/services/search/hybrid/automation-design.md`
2. `src/services/search/coverage-lexical/automation.md`

If this file conflicts with either of them, those files win.

## Targets

- mechanism target: `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- tuning surface: `src/services/search/passage-lexical/passage-lexical-ranker.ts`
- do not optimize by modifying legacy `src/services/search/passage-lexical/passage-file-search-engine.ts`
- do not copy old scorer / verifier / comparator logic into the new backend and relabel it as new

## Controller Contract

- `scripts/lexical-optimizer/run.mjs` evaluates and reports; it is not the source of truth for the search space
- automation should generate candidate manifests
- lane manifests live under `.codex-bench/lexical-optimizer/lanes/<lane>/candidates.json`
- default lanes:
  - `mechanism-a`: coverage comparator + family scorer
  - `mechanism-b`: local verifier + compactness/order/local window
  - `mechanism-c`: planner / route selection / metadata-body split
  - `benchmark`: benchmark expansion only
  - `regression`: validation/reporting only

## Workflow

1. Form one primary hypothesis from the detailed rule files.
2. Decide whether it is parameter-level or mechanism-level.
3. Keep one main hypothesis per cycle and one lane per cycle.
4. Generate candidates instead of relying on a fixed built-in grid.
5. Let stage1 do parallel coarse screening and stage2 do serial revalidation.
6. Multi-lane orchestration should evaluate lanes without mutating baseline first, then auto-commit only the final retained winner.

## Workspace Setup

- when running inside a worktree, prefer reusing the primary workspace assets instead of reinstalling or redownloading per worktree
- if the main workspace already has `node_modules`, point the worktree `node_modules` at it with a junction/symlink rather than running a fresh install
- if the main workspace already has `benchmarks/corpora/web-notes-v2`, point the worktree corpus directory at it with a junction/symlink rather than copying or downloading again
- treat shared dependencies and shared benchmark corpora as execution infrastructure; do not count this reuse as part of the optimization diff

## Keep Rule

- keep only if the primary objective improves, or quality is effectively preserved while speed or size materially improves
- rollback low-yield complexity
- if coefficient-only tuning stalls, switch to a mechanism hypothesis

## Commands

- help: `node scripts/lexical-optimizer/run.mjs --help`
- generate one lane: `node scripts/lexical-optimizer/candidate-generator.mjs --lane=mechanism-a`
- dry-run one lane: `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --dry-run`
- evaluate one lane without committing: `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --no-auto-commit`
- evaluate one lane and auto-commit the retained winner: `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a`
- orchestrate multiple lanes: `node scripts/lexical-optimizer/orchestrate.mjs --lanes=mechanism-a,mechanism-b,mechanism-c`
- compare current workspace against baseline: `node scripts/lexical-optimizer/run.mjs --mode=mechanism --lane=mechanism-a --baseline-ref=HEAD`
- keep temporary scratch resources only when debugging: add `--no-cleanup`
