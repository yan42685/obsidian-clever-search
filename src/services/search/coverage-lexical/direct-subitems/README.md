# Direct Subitems

This folder hosts the native `coverage-lexical` direct subitem pipeline.

## Goal

- Keep the legacy implementation running during migration.
- Rebuild snippet recall directly from snapshot text.
- Guarantee recall for:
  - Han single characters
  - contiguous non-Han symbol/number/character runs from the query
- Enforce a strict snippet ranking comparator:
  - `coverage > exact > prefix > fuzzy > distance penalty`

## Status

- Integrated into `coverage-lexical-engine`.
- Uses direct source-text recall and strict tuple ranking.

## Modules

- `contracts.ts`
  - shared runtime types and score tuple contract
- `PLAN.md`
  - design and migration notes
- `query-terms.ts`
- `raw-occurrences.ts`
- `candidate-spans.ts`
- `span-ranker.ts`
- `snippet-renderer.ts`
- `builder.ts`
