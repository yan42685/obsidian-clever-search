# Direct Subitems V2 Plan Draft

## Why replace instead of patch

The current implementation mixes four responsibilities in one file:

1. display window selection
2. query-term matching
3. snippet expansion and highlight alignment
4. final snippet ranking and dedupe

That makes it hard to prove two requirements:

- exact recall from original snippet text
- strict ordering by `coverage > exact > prefix > fuzzy > distance penalty`

The replacement should make recall and ranking explicit, inspectable, and testable.

## Integration strategy

The implementation lives under:

- `src/services/search/coverage-lexical/direct-subitems/`

and is wired directly into `coverage-lexical-engine`.

## Non-goals for the first pass

- do not redesign file-level `coverage-lexical` ranking
- do not change recall lane planning
- do not change metadata ranking semantics
- do not add persistence for snippet offsets or payloads

## Invariants

- Every query term that occurs in the source snapshot text must be discoverable.
- Han query text is split to single-character terms for recall accounting.
- Non-Han query text is split to maximal contiguous runs.
- Ranking must be tuple-based, not weighted-sum-based.
- Distance can only break ties after `coverage/exact/prefix/fuzzy`.
- Highlight ranges must come from chosen occurrences, not secondary heuristic guessing.
- Snippet cutting must separate three stages:
  - recall all term occurrences
  - form candidate spans
  - dedupe only after strict ranking

## Snippet cutting strategy

The snippet pipeline should not start from prebuilt display windows alone.
It should start from exact source-text occurrences, then derive spans.

### Stage A: recall all occurrences

For every query term:

- collect every exact occurrence from snapshot text
- keep all char offsets
- do not collapse repeated occurrences yet

This stage guarantees "no miss".

### Stage B: build anchor groups

Turn exact occurrences into local anchor groups.

Rules:

- sort all exact occurrences by source offset
- start a new group at each exact occurrence that is not already covered by a previous group
- greedily absorb nearby exact occurrences while the span stays under a hard max window
- allow multiple occurrences of the same term inside one group, but only one best occurrence per term contributes to ranking stats

Recommended constants for the first pass:

- `SNIPPET_MAX_CHARS = 200`
- `SNIPPET_MERGE_GAP = 32`
- `SNIPPET_CONTEXT_LEFT = 24`
- `SNIPPET_CONTEXT_RIGHT = 40`

Anchor-group stop condition:

- stop expanding when adding the next occurrence would exceed max chars by too much
- or when the gap to the next occurrence is larger than `SNIPPET_MERGE_GAP`

This stage prevents unrelated distant evidence from being forced into one snippet.

### Stage C: derive candidate spans from groups

For each anchor group:

- create the minimal covering span over the grouped exact occurrences
- add left and right context
- clamp to line boundaries or punctuation boundaries when cheap and safe
- then evaluate whether nearby prefix/fuzzy occurrences improve the tuple

Important:

- prefix/fuzzy may extend a span only if they do not break the exact-anchor-first local grouping
- if a distant exact occurrence cannot fit into the span budget, it must seed another candidate span instead of being silently dropped

This is the main rule that prevents "漏 snippet".

### Stage D: rank first, dedupe second

Every candidate span gets a strict score tuple.

Only after ranking:

- remove display-equivalent spans
- keep distant spans even if they cover similar terms

Two spans are duplicates only when both are true:

- strong text/range overlap
- same per-term best-tier signature

They are not duplicates when:

- they are far apart in source text
- or one contains a different exact-anchor realization
- or one improves the strict tuple

This is the main rule that prevents "误去重".

### Stage E: coverage-complete fallback pass

After initial ranking and dedupe:

- check whether every exact occurrence belongs to at least one surviving span
- if an occurrence is uncovered, spawn a supplemental span centered on it
- rank that span normally
- dedupe it only against truly equivalent spans

This is the safety net that prevents "去重之后又漏".

## Practical no-duplicate / no-miss rules

### No miss

- every exact occurrence must belong to at least one candidate span
- every exact occurrence excluded by span budget must seed another candidate
- final output selection may truncate by `maxSubItemCount`, but internal candidate generation must still be complete

### No duplicate flood

- duplicate judgment happens after ranking
- duplicate judgment uses realized evidence signature, not only text overlap
- same-query-family but distant spans are allowed to coexist

### No accidental merge

- never join two evidence islands across a large gap only because the combined weighted score looks better
- if two islands are both good but far apart, keep them as two candidates

### No accidental split

- when adjacent exact occurrences fit under the same local budget, they should form one candidate span
- contiguous Han exact runs should stay in one span whenever possible

## Proposed module layout

### `contracts.ts`

Shared types:

- query term kinds
- raw occurrence records
- candidate span records
- span stats
- score tuple
- render payload

### `query-terms.ts`

Responsibilities:

- parse raw query text into stable ranked terms
- emit Han single-character terms
- emit non-Han contiguous runs
- keep original raw text and normalized text
- assign stable `termId`

Notes:

- do not reuse current tokenizer
- normalization rules must be explicit and local to this module

### `raw-occurrences.ts`

Responsibilities:

- scan snapshot text directly
- collect all exact term occurrences with char offsets
- optionally collect prefix/fuzzy candidates in a second pass

Rules:

- exact pass must be complete
- prefix/fuzzy pass must never suppress exact hits

### `candidate-spans.ts`

Responsibilities:

- cluster nearby exact occurrences into candidate spans
- expand spans with prefix/fuzzy support only after exact anchors exist
- keep anchor offsets deterministic

Rules:

- candidate generation should prefer local exact evidence
- distant support can extend a span only if it improves tuple stats
- one span may contain multiple semantic islands only when coverage truly improves

### `span-stats.ts`

Responsibilities:

- compute per-term best match tier inside a span
- compute coverage counts and distance penalties
- build the strict score tuple

For each term, only one best tier counts:

- `exact`
- `prefix`
- `fuzzy`
- `miss`

Primary fields:

- `coverageCount`
- `exactCount`
- `prefixCount`
- `fuzzyCount`
- `distancePenaltyTotal`
- `distancePenaltyMax`
- `spanLength`
- `anchorOffset`

### `span-ranker.ts`

Responsibilities:

- compare spans by strict lexicographic tuple
- expose one authoritative comparator
- keep dedupe after ranking, not before ranking

Required comparator order:

1. `coverageCount` descending
2. `exactCount` descending
3. `prefixCount` descending
4. `fuzzyCount` descending
5. `distancePenaltyTotal` ascending
6. `distancePenaltyMax` ascending
7. `spanLength` ascending
8. `anchorOffset` ascending

No weighted `alignmentScore` may override this order.

### `snippet-renderer.ts`

Responsibilities:

- render snippet text from chosen span
- build `row/col`
- build highlight ranges from selected occurrences
- add ellipsis only after final span is fixed

Rules:

- renderer must not change ranking
- renderer must not add unrelated highlights
- renderer may merge overlapping or adjacent highlights

### `builder.ts`

Responsibilities:

- orchestrate the modules above
- read snapshot text
- produce final `FileSubItem[]`
- remain runtime-only

## Phase plan

## Phase 0: contracts and test harness

Deliverables:

- `contracts.ts`
- new focused test file for query splitting and tuple ranking
- fixture helper for snapshot text and expected highlights

Exit criteria:

- tuple comparator is defined and unit-tested
- query-term splitting is deterministic

## Phase 1: exact recall spine

Deliverables:

- `query-terms.ts`
- `raw-occurrences.ts` exact-only pass
- `candidate-spans.ts` exact-anchor clustering
- `snippet-renderer.ts` exact highlight rendering

Exit criteria:

- Han single-character recall works
- contiguous non-Han run recall works
- highlights come from true source offsets

## Phase 2: strict ranking

Deliverables:

- `span-stats.ts`
- `span-ranker.ts`
- strict tuple comparator wired into builder

Exit criteria:

- snippets sort exactly by:
  - coverage
  - exact
  - prefix
  - fuzzy
  - distance penalty

## Phase 3: prefix and fuzzy support

Deliverables:

- second-pass prefix matching
- bounded fuzzy matching with explicit limits
- tests that exact still dominates prefix/fuzzy

Rules:

- prefix/fuzzy are support tiers only
- prefix/fuzzy can improve a span only after exact recall is preserved

Exit criteria:

- exact never loses to weaker tier under equal coverage
- prefix never loses to fuzzy under equal stronger tiers

## Phase 4: engine hardening

Deliverables:

- expand engine-level regression coverage
- remove obsolete implementation files and tests

Exit criteria:

- engine path is the only active direct-subitems implementation
- regression suite protects exact/prefix/fuzzy ordering and source-text recall

## Test plan

## Query splitting

- Han-only query becomes per-character terms
- mixed Han and symbol run is split correctly
- `foo/bar@v1.2#tag` stays one contiguous non-Han term
- whitespace separates terms but punctuation inside a run does not

## Recall

- exact Han character present in snippet must be found
- exact symbol run present in snippet must be found
- multiple exact occurrences must all be available to span builder
- exact recall must not depend on tokenizer output

## Ranking

- higher `coverageCount` always wins
- under equal coverage, more `exactCount` wins
- under equal exact, more `prefixCount` wins
- under equal prefix, more `fuzzyCount` wins
- distance penalty matters only after the above all tie

## Rendering

- highlight ranges match chosen occurrences
- no fabricated continuous highlight across separated terms
- row and col point to the chosen anchor
- dedupe removes only display-equivalent snippets

## Snippet cutting

- every exact occurrence is covered by at least one candidate span
- two distant exact clusters produce two candidate spans
- a large mixed snippet is not merged when the gap exceeds budget
- near-identical spans collapse only after ranking
- dedupe does not remove a span that covers a different exact occurrence set

## Risks to watch

- explosion in exact occurrence count for repeated Han characters
- over-merging spans in dense symbol-heavy lines
- fuzzy support accidentally outranking exact due to convenience scores
- renderer reintroducing heuristic alignment that changes chosen evidence

## Suggested first implementation order

1. `contracts.ts`
2. `query-terms.ts`
3. exact-only `raw-occurrences.ts`
4. exact-only `candidate-spans.ts`
5. exact-only `snippet-renderer.ts`
6. `span-stats.ts`
7. `span-ranker.ts`
8. `builder.ts`
9. prefix support
10. fuzzy support
11. adapter migration
