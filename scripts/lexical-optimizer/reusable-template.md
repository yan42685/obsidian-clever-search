# Lexical Optimizer Reusable Template

Use this template when you want to port the current automation loop to another lexical backend or repository.

## Required Contract

1. Provide one explicit tuning surface file.

- keep segmentation and ranker weights in one small file
- let automation patch that file directly
- avoid patching the full engine when only tuning is needed
- if the goal is a replacement backend, keep its ranking logic code-wise independent from removed legacy engines instead of recreating them

2. Provide one explicit implementation target file for mechanism work.

- for this repository, that file is `src/services/search/coverage-lexical-v3/file-search-engine.ts`
- keep new backend mechanism work there rather than inside removed legacy engines
- use the tuning surface only for smaller orchestration and numeric tuning

3. Provide one benchmark entrypoint.

- it must print a machine-readable summary marker
- it must include `hits@1`, `hits@3`, `hits@5`, average latency, tail latency, and persisted index size

4. Provide one candidate manifest file.

- format: JSON array or `{ "candidates": [...] }`
- each candidate should contain a `label` and numeric `values`

## Default Files

- tuning surface: `src/services/search/coverage-lexical-v3/file-search-engine.ts`
- implementation target: `src/services/search/coverage-lexical-v3/file-search-engine.ts`
- candidate manifest: `.codex-bench/lexical-optimizer/candidates.json`
- example manifest: `scripts/lexical-optimizer/candidate-manifest.example.json`
- operator prompt: `scripts/lexical-optimizer/automation-prompt.md`
- auto candidate generator: `scripts/lexical-optimizer/candidate-generator.mjs`
- multi-lane orchestrator: `scripts/lexical-optimizer/orchestrate.mjs`

## Lane Split

- use lane-specific manifests under `.codex-bench/lexical-optimizer/lanes/<lane>/candidates.json`
- use lane-specific outputs under `.codex-bench/lexical-optimizer/lanes/<lane>/results/...`
- recommended lanes:
  - `mechanism-a`
  - `mechanism-b`
  - `mechanism-c`
  - `benchmark`
  - `regression`

## Command Loop

1. `node scripts/lexical-optimizer/run.mjs --help`
2. `node scripts/lexical-optimizer/candidate-generator.mjs --lane=mechanism-a`
3. `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --dry-run`
4. `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --revalidate-topk=3`
5. `node scripts/lexical-optimizer/orchestrate.mjs --lanes=mechanism-a,mechanism-b,mechanism-c`
6. `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a --no-auto-commit`
7. `node scripts/lexical-optimizer/run.mjs --mode=parameter --lane=mechanism-a`
8. `node scripts/lexical-optimizer/run.mjs --mode=mechanism --lane=mechanism-a --baseline-ref=HEAD`

## Automation Hygiene

- default automated runs should evaluate without mutating baseline until a retained winner is known
- after selection, automation may rerun the winning lane with automatic apply+commit enabled
- default automated runs should clean temporary scratch run directories unless debugging requires `--no-cleanup`

## Keep Rules

- keep only if the objective improves
- or keep if quality is effectively flat and speed or size materially improves
- rollback if `hits@1` clearly regresses
- rollback if the change only helps a tiny slice and weakens the guardrails
- if repeated coefficient-only edits do not move the benchmark, switch to a mechanism-level hypothesis instead of continuing local patching

## Evaluation Protocol

- candidate evaluation should run serially in the current workspace
- final keep/rollback decisions should use those serial benchmark results directly
