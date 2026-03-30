# Direct Subitems V2

This folder hosts the parallel replacement for native `directSubItems`.

## Goal

- Keep the legacy implementation running during migration.
- Rebuild snippet recall directly from snapshot text.
- Guarantee recall for:
  - Han single characters
  - contiguous non-Han symbol/number/character runs from the query
- Enforce a strict snippet ranking comparator:
  - `coverage > exact > prefix > fuzzy > distance penalty`

## Status

- Planning and contracts only.
- No runtime integration yet.
- Old implementation remains the active path.

## Intended Modules

- `contracts.ts`
  - shared runtime types and score tuple contract
- `PLAN.md`
  - phased migration plan
- future modules
  - `query-terms.ts`
  - `raw-occurrences.ts`
  - `candidate-spans.ts`
  - `span-stats.ts`
  - `span-ranker.ts`
  - `snippet-renderer.ts`
  - `builder.ts`
