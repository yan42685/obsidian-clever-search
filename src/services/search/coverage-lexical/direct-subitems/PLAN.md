# Direct Subitems V2

## Goal

Replace the old snippet-selection path with a native runtime pipeline that:

- recalls exact source-text evidence directly from the snapshot text
- splits query terms as:
  - Han bigrams for multi-character Han segments
  - literal single Han characters only when the query segment itself is one character
  - contiguous non-Han runs
- ranks snippets strictly by:
  - `coverage > exact > prefix > fuzzy > distance penalty`

## What is already done

- The implementation lives under `src/services/search/coverage-lexical/direct-subitems/`.
- It is wired directly into `coverage-lexical-engine`.
- The old direct-subitems implementation has been removed.
- The old snippet aligner and display-window handoff have been removed.

## Current module layout

### `contracts.ts`

Shared runtime types:

- query terms
- occurrences
- candidate spans
- per-term span stats
- score tuple
- render payloads

### `query-terms.ts`

Responsibilities:

- split raw query text into stable terms
- emit Han bigrams for multi-character Han segments
- keep literal single-character Han queries as single-char terms
- emit contiguous non-Han runs
- keep stable `termId`

### `raw-occurrences.ts`

Responsibilities:

- collect every exact occurrence from snapshot text
- collect prefix / fuzzy support occurrences in a second pass

Rules:

- exact recall stays complete
- support tiers never suppress exact hits

### `candidate-spans.ts`

Responsibilities:

- cluster nearby anchor occurrences into candidate spans
- keep distant evidence islands separate
- run a fallback pass to cover any exact occurrence missing from the current span set

Rules:

- candidate generation is exact-anchor first
- support occurrences may improve a span, but they do not replace exact recall
- distant exact clusters must become separate candidates instead of being silently merged

### `span-ranker.ts`

Responsibilities:

- expose the authoritative lexicographic comparator
- rank before dedupe
- keep only display-equivalent duplicates out

Comparator order:

1. `coverageCount` descending
2. `exactCount` descending
3. `prefixCount` descending
4. `fuzzyCount` descending
5. `distancePenaltyTotal` ascending
6. `distancePenaltyMax` ascending
7. `spanLength` ascending
8. `anchorOffset` ascending

### `snippet-renderer.ts`

Responsibilities:

- render final snippet text
- compute `row` / `col`
- derive highlight ranges from chosen occurrences

### `builder.ts`

Responsibilities:

- orchestrate the full runtime pipeline
- produce final `FileSubItem[]`

## Invariants

- Every exact occurrence found in snapshot text must be available to the span builder.
- Ranking is tuple-based, not weighted-sum-based.
- Distance only breaks ties after `coverage / exact / prefix / fuzzy`.
- Dedupe happens after ranking.
- Dedupe uses realized evidence, not only textual overlap.
- Distant same-signature spans may coexist.
- Rendered highlights come from chosen occurrence offsets.

## Current regression coverage

Covered by focused tests:

- Han bigram splitting
- contiguous non-Han run splitting
- exact occurrence recall from snapshot text
- nearby evidence collapsing into one span
- distant evidence splitting into multiple spans
- strict tuple ordering
- exact > prefix > fuzzy
- row / col and highlight stability
- no fabricated continuous highlight across separated hits
- coverage-complete fallback recovering an uncovered exact occurrence
- distant same-signature spans surviving dedupe
- dense repeated Han evidence staying local without accidental long-range merge

## Remaining work

Not required for correctness, but still worth considering:

- extract span-stat computation into a dedicated `span-stats.ts` module if we want a cleaner separation between span generation and scoring
- add more engine-level regression cases around very dense symbol-heavy lines
- tune runtime cost if benchmark latency becomes a priority
