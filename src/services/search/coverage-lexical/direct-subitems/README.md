# Direct Subitems

This folder hosts the native `coverage-lexical` direct-subitems pipeline.

## Status

- Wired directly into `coverage-lexical-engine`
- Old direct-subitems implementation removed
- Legacy snippet aligner / display-window handoff removed

## Current guarantees

- Exact source-text occurrences are collected directly from the snapshot text.
- Han query text is split into single-character recall terms.
- Non-Han query text is split into contiguous runs.
- Snippet ranking follows a strict tuple comparator:
  - `coverage > exact > prefix > fuzzy > distance penalty`
- Dedupe happens after ranking.
- Far-apart evidence islands are allowed to survive together even when they realize the same term signature.
- Final snippets render highlights from chosen occurrence offsets, not from secondary alignment heuristics.

## Pipeline

1. `query-terms.ts`
   - splits the raw query into stable recall terms
2. `raw-occurrences.ts`
   - collects exact occurrences
   - collects prefix / fuzzy support occurrences in a second pass
3. `candidate-spans.ts`
   - groups nearby anchor occurrences into candidate spans
   - adds a coverage-complete fallback pass for uncovered exact occurrences
4. `span-ranker.ts`
   - ranks spans with the authoritative lexicographic comparator
   - dedupes only display-equivalent spans after ranking
5. `snippet-renderer.ts`
   - renders final snippet text, row / col, and highlight ranges
6. `builder.ts`
   - orchestrates the runtime pipeline and emits `FileSubItem` payloads

## Current regression focus

- exact occurrence coverage remains complete
- exact beats prefix, prefix beats fuzzy
- distant same-signature spans are not dropped
- dense repeated Han occurrences do not collapse unrelated clusters into one snippet

