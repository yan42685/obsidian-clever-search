# Lexical Optimizer Automation Entry

Read these files before every cycle, in this order:

1. `src/services/search/hybrid/automation-design.md`
2. `src/services/search/coverage-lexical/automation.md`

If this file conflicts with either of them, those files win.

## Targets

- mechanism target: `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- parameter target: `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- do not reintroduce removed legacy backends as hidden dependencies or comparison baselines

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
2. Default to a mechanism-level cycle against `coverage-lexical`; use parameter mode only for small numeric tuning on the same engine.
3. Keep one main hypothesis per cycle and one lane per cycle.
4. Generate candidates instead of relying on a fixed built-in grid.
5. Evaluate candidates serially in the current workspace.
6. Multi-lane orchestration should evaluate lanes without mutating baseline first, then auto-commit only the final retained winner.
7. Automation benchmark focus: compare `CoverageLexical` against `MiniSearch`, and keep one full run under `20s`.

## Workspace Setup

- run candidate evaluation serially in the primary workspace
- treat shared dependencies and shared benchmark corpora as execution infrastructure; do not count this reuse as part of the optimization diff

## Keep Rule

- keep only if the primary objective improves, or quality is effectively preserved while speed or size materially improves
- rollback low-yield complexity
- if coefficient-only tuning stalls, switch to a mechanism hypothesis

## Commands

- help: `node scripts/lexical-optimizer/run.mjs --help`
- compare current workspace against baseline: `node scripts/lexical-optimizer/run.mjs --mode=mechanism --lane=mechanism-a --baseline-ref=HEAD`
- generate one lane: `node scripts/lexical-optimizer/candidate-generator.mjs --lane=mechanism-a`
- dry-run one parameter lane: `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --dry-run`
- evaluate one parameter lane without committing: `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --no-auto-commit`
- evaluate one parameter lane and auto-commit the retained winner: `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a`
- orchestrate multiple lanes: `node scripts/lexical-optimizer/orchestrate.mjs --lanes=mechanism-a,mechanism-b,mechanism-c`
- keep temporary scratch resources only when debugging: add `--no-cleanup`
