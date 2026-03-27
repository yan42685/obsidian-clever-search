# Lexical Optimizer Reusable Template

Use this template when you want to port the current automation loop to another lexical backend or repository.

## Required Contract

1. Provide one explicit tuning surface file.

- keep segmentation and ranker weights in one small file
- let automation patch that file directly
- avoid patching the full engine when only tuning is needed
- if the goal is a replacement backend, keep its ranking logic code-wise independent from the legacy engine rather than evolving the old engine in place

2. Provide one explicit implementation target file for mechanism work.

- for this repository, that file is `src/services/search/passage-lexical/coverage-lexical-engine.ts`
- keep new backend mechanism work there rather than inside the legacy engine
- use the tuning surface only for smaller orchestration and numeric tuning

3. Provide one benchmark entrypoint.

- it must print a machine-readable summary marker
- it must include `hits@1`, `hits@3`, `hits@5`, average latency, tail latency, and persisted index size

4. Provide one candidate manifest file.

- format: JSON array or `{ "candidates": [...] }`
- each candidate should contain a `label` and numeric `values`

## Default Files

- tuning surface: `src/services/search/passage-lexical/passage-lexical-ranker.ts`
- implementation target: `src/services/search/passage-lexical/coverage-lexical-engine.ts`
- candidate manifest: `.codex-bench/lexical-optimizer/candidates.json`
- example manifest: `scripts/lexical-optimizer/candidate-manifest.example.json`
- operator prompt: `scripts/lexical-optimizer/automation-prompt.md`

## Command Loop

1. `node scripts/lexical-optimizer/run.mjs --help`
2. `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json --dry-run`
3. `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json`
4. `node scripts/lexical-optimizer/run.mjs --mode=parameter --candidate-file=.codex-bench/lexical-optimizer/candidates.json --apply-best`
5. `node scripts/lexical-optimizer/run.mjs --mode=mechanism --baseline-ref=HEAD`

## Keep Rules

- keep only if the objective improves
- or keep if quality is effectively flat and speed or size materially improves
- rollback if `hits@1` clearly regresses
- rollback if the change only helps a tiny slice and weakens the guardrails
- if repeated coefficient-only edits do not move the benchmark, switch to a mechanism-level hypothesis instead of continuing local patching
