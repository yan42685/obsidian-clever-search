
# Coverage Lexical Query-Unit Ranking V2

Date: 2026-04-10
Status: In Progress
Supersedes: `legacy-coverage-lexical-ranking-intent-realignment-plan.md`

## Purpose

This document defines the next lexical-only ranking worldview for
`coverage-lexical`.

The guiding principle is:

> lexical should only do what lexical can do extremely well

This means the lexical stack should optimize for:

- stable query-surface interpretation
- explicit coverage of query units
- explicit field placement of those query units
- explicit lexical match quality
- explicit local proximity only for a very small top tie-band

This document intentionally moves `coverage-lexical` away from:

- count-first ranking
- route-shaped ranking philosophies
- heavy planner-centric pre-judgment
- evidence-mass-as-final-score
- display-layer rescue logic
- semantic intent inference that belongs in hybrid search

## Migration Strategy

V2 should be implemented as a **strangler-style internal rewrite** while
keeping `coverage-lexical` as the only backend boundary.

Key decisions:

- keep `coverage-lexical` as the sole public/runtime backend
- do not introduce a parallel replacement backend
- introduce an explicit independent internal `coverage-lexical-v2/` subtree
  behind the existing `coverage-lexical` backend boundary
- migrate layer by layer
- after each migrated layer is proven, delete or hard-deprecate the
  corresponding old active logic

This strategy is preferred because the current backend is already deeply wired
into:

- runtime search flow
- tests and regression suites
- benchmark harnesses
- snapshot/data-manager paths
- hybrid fallback paths

Creating a second backend would duplicate integration cost and encourage
long-lived dual maintenance.

### Planned Internal Layout

The intended internal structure is:

- `coverage-lexical-v2/query/`
- `coverage-lexical-v2/comparator/`
- `coverage-lexical-v2/display/`
- `coverage-lexical-v2/explain/`
- `coverage-lexical-v2/candidate-cascade/`

During migration, the existing large files remain as orchestration shells:

- `coverage-lexical-engine.ts`
- `coverage-lexical-ranker.ts`
- `coverage-lexical-recall.ts`

These files should gradually stop owning core decisions and instead delegate to
V2 modules.

### Migration Defaults

- migration style: layered replacement
- module organization: explicit `coverage-lexical-v2/` subtree plus thin
  adapters from `coverage-lexical/`
- no new backend name
- no second engine class
- no change to the external backend selection contract

### Migration Discipline

The V2 migration must not become a permanent dual-worldview system.

For every completed migration layer:

- new logic becomes the only active logic for that responsibility
- old logic is deleted or hard-deprecated
- old files may remain only as thin adapters or orchestration shells

Explicitly disallowed end states:

- old and new final comparators both remain reachable
- display rescue remains callable after V2 display policy is live
- evidence-mass tie-breakers stay reachable from lexical final ranking
- fallback or derived units remain able to rank as if they were primary units

## Lexical Boundary

`coverage-lexical` should not try to solve the full ranking problem for all
search intents. It should solve the lexical part extremely well and stop there.

Lexical is responsible for:

- query-surface units
- thin query analysis derived from surface structure
- lexical coverage completeness
- field placement of matched units
- exact/prefix/fuzzy lexical quality where allowed
- local proximity of matched units in a very small tie-band

Hybrid or later semantic systems are responsible for:

- deeper intent weighting
- semantic importance estimation
- paraphrase and topic-level relevance
- partial-memory semantic reconstruction
- deciding that one lexical unit is conceptually more important than another
  when that importance is not visible from query surface structure

V2 therefore does **not** use a lexical equivalent of semantic
`requiredTermCount`. If a distinction depends on semantic intent rather than
lexical surface structure, it should be handled outside lexical final ranking.

## Query Analysis Instead Of A Heavy Planner

V2 should not keep the current planner as a central worldview object.

Instead, lexical should use a **thin query analysis layer** that only produces
surface-level lexical structure needed by the ranking pipeline.

This layer is responsible for:

- building query units
- classifying query-unit provenance tiers
- describing visible query surface shape
- exposing minimal budget hints where needed
- exposing explain/debug data for lexical decisions

This layer is **not** responsible for:

- semantic requiredness inference
- route-style worldview selection
- metadata-first/body-first query philosophy labels
- deciding semantic importance among visible units

In implementation terms, the planner should be shrunk into:

- a `query-unit builder`
- a `query-shape analyzer`
- an optional lightweight `budget-hint builder`

and should stop acting as a heavyweight pre-judgment system.
## Locked Decision Register

This section records the currently locked implementation decisions. These are
the decisions that subsequent code work should treat as the active baseline
unless explicitly revised by a later design update.

### Query Units And Query Analysis

#### 1. Short Han query primary units

Decision: `A`

- short Han surface segments may become `primary`
- tokenizer-produced finer units may also become `primary` only when they are
  high confidence
- raw bigrams remain `fallback`

#### 2. Mixed-script primary units

Decision: `A`

- Latin tokens and Han surface units may both become `primary`
- script-side information remains explicit

#### 3. Intact Han segment when tokenizer boundaries are unstable

Decision: `A`

- intact Han segments may act as one source of `primary` units
- they must be conservatively merged with tokenizer-driven units
- they are not unconditional double-counted primary units

#### 4. Query analysis final shape

Decision: `A`

- replace heavy planner worldview with:
  - `query-unit builder`
  - `query-shape analyzer`
  - optional lightweight `budget-hint builder`

#### 5. `surfaceCoverageShape`

Decision: `A`

- this is **query surface grouping**
- it is **not** semantic requiredness
- it answers whether visible surface groups or script sides are structurally
  covered

#### 6. `matchedPrimaryUnitFieldProfile` counting

Decision: `B*`

- each matched primary unit gets strongest-field contribution `1.0`
- if the same unit is corroborated in a weaker secondary field, add only a
  bounded corroboration bonus
- default corroboration bonus is `0.1`
- this is not full double-counting

#### 7. Metadata field priority

Decision: locked custom order

- `basename > aliases > headings > folder > tag`

### Match Quality

#### 8. Latin / ASCII match quality

Decision: `A`

- `exact > prefix > fuzzy`

#### 9. Han match quality

Decision: custom locked policy

- Han final ranking is **exact only**
- Han prefix does not participate in final ranking
- Han fuzzy does not participate in final ranking

#### 10. Mixed-script match quality aggregation

Decision: `A`

- compute quality per primary unit
- then aggregate without collapsing everything into one opaque global score

### Proximity And Query Order

#### 11. `primaryUnitProximityScore` trigger

Decision: `A`

- compute it only for top 2 candidates whose first four layers are fully tied

#### 12. `primaryUnitProximityScore` minimal formula

Decision: `A`

- use only:
  - primary-unit coverage count inside best window
  - window width
  - mean distance
  - whether visible order is preserved

#### 13. Query order in lexical final ranking

Decision: `A`

- query order is not a core lexical ranking rule
- it may only weakly influence the tiny tie-band proximity resolver

### Fallback

#### 14. Incomplete-candidate coarse behavior

Decision: `A`

- once primary coverage is confirmed insufficient, the candidate is immediately
  downgraded

#### 15. Bigram fallback role

Decision: locked custom policy

- raw fallback bigrams do not count as primary coverage in final ranking
- if a short or contiguous Han surface segment should behave like a true
  lexical unit, that decision must be made during query analysis by explicit,
  deterministic surface rules
- V2 does not allow later dynamic fallback promotion to create new primary
  units during recall, coarse, or final ranking

#### 16. Han unigram fallback

Decision: custom locked policy

- file-layer Han unigram fallback is disabled in the V2 baseline
- file-layer Han unigram fallback may exist as an **optional experimental
  switch**, but it stays off by default
- any such optional file-layer switch must remain tightly bounded and must not
  require always-resident unigram posting expansion
- preferred support path is subitem-level lazy per-file unigram assistance

#### 17. Fallback promotion

Decision: locked with item 15

- fallback units are not dynamically promoted later in the pipeline
- if something should be a primary unit, query analysis must decide so up
  front from visible surface structure
- final ranking does not treat strong fallback as weak primary

#### 18. Fallback ceilings

Decision: `A`

- enforce all four ceilings from the start:
  - query-time expansion ceiling
  - candidate-source ceiling
  - per-document contribution ceiling
  - stage-gating ceiling

### Recall, Coarse, Display

#### 19. Recall target shape

Decision: locked custom policy

- long-term target is **source-based recall**
- temporary adapters are allowed during migration
- lane identity is not part of the target architecture

#### 20. Coarse / hydration attitude toward incomplete candidates

Decision: `A`

- once fuller primary coverage candidates exist, incomplete candidates are
  downgraded and no longer receive normal expensive-work priority

#### 21. Display front suppression

Decision: custom removal

- front suppression is not a permanent display responsibility
- if front-level suppression is needed during migration, it should be treated
  as upstream debt
- target display layer does not own this behavior

#### 22. Display tail trimming

Decision: `A`

- display ultimately keeps only simple tail trimming over upstream ranking
- display does not perform rescue or semantic reranking

### Explain, Normalization, Gates, Cleanup

#### 23. Explain / debug timing

Decision: `A`

- explain/debug must ship with early V2 phases, not as a late afterthought

#### 24. Normalization policy

Decision: `A`

- normalization must be explicit and stable
- includes:
  - Unicode normalization
  - ASCII lowercase policy
  - ASCII/Han boundary behavior
  - mixed-script segmentation
  - intact-segment policy when tokenizer boundaries are unstable

#### 25. Minimum real-query gate set

Decision: `B`

- `AI 省锟斤拷`
- `锟斤拷锟斤拷锟斤拷锟斤拷`
- mixed-script two-sided queries
- tokenizer-boundary-mismatch queries
- `steam password`
- `password steam`

#### 26. Old-code deletion discipline

Decision: `A`

- once a migration phase is stable, delete or hard-deprecate the corresponding
  old active logic
- do not wait until all of V2 is complete
- do not rely on long-lived flag-based coexistence

## Core Object: Query Units

V2 no longer treats tokenizer output as the ground truth of lexical intent.
Tokenizer output is useful, but it is not the lexical worldview.

Instead, lexical ranking operates on `query units`.

### Query Unit Tiers

#### 1. Primary Query Units

Primary units are the only units that are allowed to drive lexical final
ranking.

They are derived from stable query-surface structure, for example:

- stable ASCII or Latin tokens such as `AI`, `steam`, `token`
- high-confidence Han segments
- short intact Han surface segments when tokenizer boundaries are not reliable
- explicit mixed-script surface segments

Primary units should be chosen conservatively. The goal is not maximum recall
at this layer. The goal is stable, interpretable ranking.

Locked V2 decision:

- if a short or contiguous Han surface segment should behave like a primary
  lexical unit, it must be recognized as such during query analysis
- V2 does not allow raw fallback bigrams to be dynamically promoted into
  primary units later in the ranking pipeline

#### 2. Fallback Query Units

Fallback units exist to support lexical robustness when primary segmentation is
uncertain.

Examples:

- Han bigrams
- optional very weak support units outside final file ranking

Fallback units may support:

- recall admission
- bounded coarse/source expansion
- weak lexical coverage hints

Fallback units must **not** be treated as equal to primary units in final
lexical ranking.

#### 3. Derived Units

Derived units are not literal query-surface units. They are generated from
secondary lexical structures.

Examples:

- phrase signatures
- bridge signatures
- derived cross-script linkage hints

Derived units may support:

- late lexical detail checks
- very small tie-band refinement

Derived units must **not** count toward core lexical coverage in final ranking.

## Fallback Boundary And Budget Policy

Fallback units are necessary for lexical robustness, but they are also the
easiest way to reintroduce noise, latency, and hidden total-score behavior.

V2 therefore treats fallback as a bounded support mechanism, not as an
alternative main ranking layer.

### Purpose Of Fallback

Fallback units may be used only for:

- candidate discovery
- weak lexical support when primary segmentation is uncertain

Fallback units must not be used to:

- replace primary-unit coverage in final ranking
- independently justify lexical winner promotion
- act as a hidden second scoring system

### Bigram Fallback

Han bigrams are the primary fallback mechanism.

They are appropriate when:

- Han segmentation is uncertain
- a short Han query does not yield stable primary units
- a short surface segment needs bounded lexical expansion

Bigram fallback may help:

- recall candidate discovery
- bounded coarse candidate expansion
- weak support for incomplete cheap coverage

But it must not become equivalent to primary units in final lexical ranking.

Locked V2 decision:

- raw bigram fallback does not participate in final-ranking primary coverage
- if a specific short Han unit is judged lexical enough to matter as a primary
  unit, that judgment must happen in query analysis from visible surface
  structure, not as a later fallback promotion step

#### Practical interpretation of item 15 and item 17

- lexical is not expected to infer hidden semantics better than tokenizer
- lexical is expected to preserve **visible surface structure** better than a
  tokenizer-only worldview
- therefore, V2 prefers:
  - explicit short Han surface segments
  - intact visible contiguous fragments
  - script-aware surface grouping
- and rejects:
  - runtime dynamic promotion because many fallback bigram hits looked useful

### Unigram Fallback

V2 baseline disables unigram fallback at the file-ranking layer.

File-layer Han unigram support may exist only as a bounded optional switch for
measurement or experiments, but:

- it remains off by default
- it must not require always-resident unigram posting expansion
- it must not become part of the normal final file-ranking path

Unigram support, if retained at all, is preferred at a more local and
lazy-evaluated subitem layer where:

- a single file is already being examined
- units can be derived on demand
- unigram signals do not require globally persistent posting expansion

This keeps file-level lexical ranking cleaner and reduces the need for
always-resident unigram postings.

### Budget Ceilings

Fallback cost must be limited at four levels.

#### 1. Query-Time Expansion Ceiling

The number of fallback units generated per query must be explicitly capped.

Examples of intended policy:

- short Han segments may generate a bounded number of bigrams
- mixed-script queries must not allow one side to explode fallback expansion

#### 2. Candidate-Source Ceiling

Fallback-generated candidates must have bounded influence on recall union size
and upgrade queues.

Fallback sources should therefore have:

- a bounded candidate count
- a bounded share of union slots
- a bounded share of expensive-verification slots

#### 3. Per-Document Contribution Ceiling

Multiple fallback hits on the same document must not stack into pseudo-primary
coverage.

Fallback contribution per document should be capped so that:

- many bigram hits do not imitate broad primary coverage
- repeated fallback support does not become a hidden total-score surrogate

#### 4. Stage-Gating Ceiling

Fallback influence must shrink as the pipeline progresses.

Intended stage policy:

- recall: fallback may help candidate discovery
- coarse/hydration: fallback may influence bounded candidate expansion only
- final ranking: fallback is not a primary ranking feature
- display: fallback has no independent justification role

### Relationship Between Primary And Fallback Units

The governing rule is:

> fallback may help discover primary-like coverage, but it must not replace
> primary coverage in final lexical ranking

This means:

- fallback can support broader candidate discovery
- fallback cannot justify "this is the lexical winner"

### Operational Consequence

If a query-surface unit is not stably represented by tokenizer output, the
system should:

- preserve a primary-oriented surface interpretation when possible
- use fallback units only to support discovery and bounded upstream expansion
- avoid letting fallback become a second main comparator

This keeps lexical robust without sacrificing purity of final ranking.

## Why Query Units Instead Of Tokenizer Words

The lexical system must handle cases where user-perceived lexical units do not
line up with tokenizer output.

Examples:

- a short Han query where the tokenizer does not split at the user-expected
  boundary
- a query where the user-perceived lexical unit is shorter than what tokenizer
  produces
- mixed-script queries where one side is tokenized and the other is segmented
  differently

V2 therefore defines lexical coverage over query units with provenance, not
over tokenizer output alone.
## Core Ranking Worldview

Lexical final ranking should use the following ordered comparator layers.

### 1. `distinctMatchedPrimaryQueryUnitCount`

Compare how many distinct **primary** query units were matched.

This is the hardest lexical priority.

Examples:

- a result matching both `AI` and `省锟斤拷` should outrank one matching only `省锟斤拷`
- a result matching both `锟斤拷锟斤拷` and `锟斤拷锟斤拷` should outrank one matching only one
  of them
- a result matching both the Latin and Han sides of
  `projected token 锟斤拷锟斤拷时锟斤拷锟斤拷` should outrank a one-sided result

### 2. `surfaceCoverageShape`

Compare whether the result preserves the visible surface structure of the query.

This is intentionally not a semantic requiredness layer. It is a lexical
surface-completeness layer built from **query surface grouping**.

Examples:

- `AI 省锟斤拷`
  both visible groups should be covered
- `锟斤拷锟斤拷锟斤拷锟斤拷`
  both visible groups should be covered
- `projected token 锟斤拷锟斤拷时锟斤拷锟斤拷`
  both visible script sides should be covered

This layer exists because two candidates may sometimes have similar raw unit
counts but very different surface completeness.

This layer must **not** be replaced by heuristics such as "later query terms
are more important." Query order should remain mostly neutral in lexical final
ranking.

Locked V2 decision:

- `surfaceCoverageShape` is about visible query-surface groups and script sides
- it is not a semantic requiredness layer
- it should answer whether the visible query grouping is preserved, not whether
  the system inferred a deeper semantic intent

### 3. `matchedPrimaryUnitFieldProfile`

Compare where the matched primary query units were found.

This replaces vague field coverage thinking with an explicit field distribution
over matched primary query units.

The intended field order is:

1. metadata identity
2. metadata support
3. body

Definitions:

- `metadata identity`
  basename, aliases, headings
- `metadata support`
  folder, tag
- `body`
  body lexical matches

Locked V2 decision:

- metadata field order is:
  1. `basename`
  2. `aliases`
  3. `headings`
  4. `folder`
  5. `tag`
- each matched primary unit is counted through its strongest matched field with
  base contribution `1.0`
- if the same primary unit is also corroborated by a weaker secondary field,
  it receives only a bounded corroboration bonus, default `0.1`
- this is strongest-field accounting with weak corroboration, not double
  counting

Examples:

- matching `AI` in basename and `省锟斤拷` in body should outrank matching both only
  in body
- matching the same units in metadata identity should outrank matching them
  only through weaker metadata support

### 4. `primaryUnitMatchQuality`

Compare lexical match quality for matched **primary** query units.

Baseline policy:

- Latin / ASCII units:
  - `exact`
  - `prefix`
  - `fuzzy`
- Han units:
  - `exact` only

The baseline rule is:

> Latin / ASCII: exact > prefix > fuzzy  
> Han: exact only

This layer only applies after unit coverage and field placement are already
equivalent.

This layer must compare match quality for primary query units themselves, not
for arbitrary expansions, fallback bigrams, or derived lexical artifacts.

Locked V2 decision:

- Han prefix does not participate in final lexical ranking
- Han fuzzy does not participate in final lexical ranking

### 5. `primaryUnitProximityScore`

This is a tiny tie-band resolver, not a general-purpose ranking layer.

It should only run for a **very small top tie-band** after the first four
layers are equal or effectively equal.

It should score the best local window that contains the matched primary query
units, using a deliberately small and interpretable proximity model such as:

- how many primary units co-occur in the best window
- how narrow the best window is
- average pairwise distance
- whether surface order is preserved

This score exists to refine otherwise indistinguishable leaders. It must not be
allowed to overturn higher lexical priorities.

### 6. Stable Deterministic Fallback

If all lexical layers are still tied, use a deterministic fallback such as:

- normalized path order
- doc id
- stable insertion order

The goal is reproducibility, not hidden semantics.

## Monotonicity Rules

V2 should explicitly preserve the following lexical invariants.

### Coverage Monotonicity

A result that matches more distinct primary query units must not lose to a
result that matches fewer primary query units.

### Field Monotonicity

Given equivalent primary-unit coverage, a result with stronger field placement
must not lose to a weaker-field result.

### Match-Quality Monotonicity

Given equivalent primary-unit coverage and field placement:

- Latin/ASCII `exact` must not lose to `prefix`
- Latin/ASCII `prefix` must not lose to `fuzzy`
- Han exact matches must not be inverted by weaker late detail

### Detail Non-Inversion

Proximity or other late lexical detail must not overturn the decisions made by
coverage, surface shape, field placement, or match quality.

### Query-Order Neutrality

Lexical final ranking should remain mostly neutral to raw query token order.
Order may influence the very small tie-band proximity resolver, but it must not
become a primary semantic rule.

## Explicit Exclusions

### No Evidence Mass In Lexical Final Ranking

`evidence mass` should not be a final lexical ranking feature in V2.

Reasons:

- it collapses heterogeneous evidence into a pseudo-total-score worldview
- it can reintroduce single-term overpromotion
- it is harder to explain than explicit lexical layers

Evidence mass may still remain useful for:

- diagnostics
- budget hints
- coarse-stage telemetry
- debug/explain support

But it must not decide lexical final winner order.

### No Rescue As A Ranking Concept

The term `rescue` should be removed from lexical ranking language.

V2 also does not preserve a named lexical replacement concept for keeping weak
or incomplete candidates alive.

If an implementation later schedules more expensive checks, that should be
modeled as plain execution scheduling, not as a ranking or worldview concept.

### No Semantic Required-Term Inference In Lexical Final Ranking
Lexical should not try to infer hidden semantic importance among query units.

If the system needs to decide that one surface unit is conceptually "the real
intent" and another is not, that decision belongs in hybrid search or another
semantic layer.

## Pipeline Guidance

### Recall

Recall should remain broad and inexpensive, but it must stop using
single-term strength as a substitute for full lexical coverage.

Guidance:

- near-term adapters may remain only as migration-time engineering scaffolding
- long-term recall should move to a **source-based** model:
  - candidate sources produce doc-local lexical evidence
  - candidates are merged into doc states
  - source and budget policy decide which candidates remain active
- recall admission should increasingly reason in terms of:
  - primary query-unit coverage
  - surface coverage shape
  - field-aware cheap evidence
- fallback units may help candidate discovery
- derived units may help late lexical detail checks
- neither fallback nor derived units should act like final lexical winners
- lane identity must not remain a semantic ranking concept once migration is
  complete

### Coarse Ranking And Hydration

Coarse and hydration are where cost control and lexical worldview should meet.

Guidance:

- prioritize expensive work for candidates that already satisfy the primary
  lexical worldview
- incomplete candidates should be downgraded once fuller coverage candidates
  exist
- strong one-unit spikes should not consume upgrade budget ahead of fuller
  primary-unit coverage
- fallback units may broaden upstream candidate discovery, but not direct final
  lexical promotion

### Final Ranking

Final lexical ranking should use:

1. `distinctMatchedPrimaryQueryUnitCount`
2. `surfaceCoverageShape`
3. `matchedPrimaryUnitFieldProfile`
4. `primaryUnitMatchQuality`
5. `primaryUnitProximityScore`
6. stable deterministic fallback

No evidence mass.

No rescue.

No semantic required-term weighting.

### Display

Display should become purely a presentation policy layer.

Responsibilities:

- `tail trimming`

Display should not:

- rescue results
- reorder based on hidden semantic logic
- compensate for upstream ranking mistakes
- permanently own front-level semantic suppression

If a result deserves to be shown near the front, the ranking pipeline itself
should already have justified that.

Locked V2 decision:

- long-term display keeps only `tail trimming`
- any front-level suppression still needed during migration should be treated
  as transitional upstream-ranking debt, not as a permanent display
  responsibility

## Explainability Requirements

Top lexical results should be explainable in terms of the core worldview.

For each leading result, the system should be able to say:

- which primary query units were matched
- whether surface coverage shape was satisfied
- where those units were matched
- what their lexical match quality was
- if a top tie-band resolver was used, why that local window won

In particular, top-result explanations must be able to say whether a result
won because of:

- `distinctMatchedPrimaryQueryUnitCount`
- `surfaceCoverageShape`
- `matchedPrimaryUnitFieldProfile`
- `primaryUnitMatchQuality`
- `primaryUnitProximityScore`

If a leading result cannot be explained in these terms, the lexical worldview
is likely drifting away from its intended design.

## Examples

### `AI 省锟斤拷`

Preferred lexical order:

1. result matching `AI` in metadata identity and `省锟斤拷` in body
2. result matching both `AI` and `省锟斤拷` in body
3. result matching only `省锟斤拷`

### `锟斤拷锟斤拷锟斤拷锟斤拷`

Preferred lexical order:

1. result matching both `锟斤拷锟斤拷` and `锟斤拷锟斤拷`
2. weaker results still matching both units
3. results matching only one unit

### `projected token 锟斤拷锟斤拷时锟斤拷锟斤拷`

Preferred lexical order:

1. result covering both Latin and Han sides
2. weaker two-sided results
3. one-sided distractors

## Implementation Status

- Phase 1. Query Analysis And Query Unit Model: completed
  - independent `v2/query/` modules now build primary, fallback, and derived query-unit outputs
  - query analysis now exposes visible surface groups plus `surfaceCoverageShape`
  - standalone tests now cover Latin-only, Han-only/short-Han, mixed-script, and tokenizer-boundary-mismatch query shapes
- Phase 2. Ranking Signal Model: completed
  - independent `v2/comparator/` signal types now encode:
    - `distinctMatchedPrimaryQueryUnitCount`
    - `surfaceCoverageShape`
    - `matchedPrimaryUnitFieldProfile`
    - `primaryUnitMatchQuality`
    - `primaryUnitProximityScore`
  - independent ranking explain output now attributes pairwise decisions to explicit V2 layers
  - a standalone `v2/explain` payload builder now exposes query analysis, candidate evidence, ranking signals, and pairwise decisions in one structured explain object
  - standalone regression tests now cover representative mixed queries, field-profile ordering, and top tie-band proximity behavior
- Phase 3. Final Comparator Rewrite: completed
  - the independent V2 comparator module exists and is tested
  - an independent V2 comparator-signal builder now converts query analysis plus matched-unit evidence into comparator-ready candidate signals
  - an independent V2 comparator runner now executes query analysis, signal building, comparator ordering, top tie-band selection, and structured explain output end to end
  - the independent V2 lexical engine now projects exact metadata-phrase, heading-local, and body-local best-window evidence into `primaryUnitProximityScore` without changing the earlier lexical layers
  - the V2 candidate-cascade path now independently derives Latin `exact > prefix > fuzzy` evidence for `primaryUnitMatchQuality`, while Han remains exact-only
  - the independent `coverage-lexical-v2/` engine now owns query-side analysis from raw query text instead of depending on legacy query-term helpers
  - pipeline regression coverage now explicitly guards `exact > prefix > fuzzy` ordering on tied lexical coverage through the independent V2 engine path
- Phase 4. Coarse/Hydration Alignment: completed
  - the independent `coverage-lexical-v2/` candidate-cascade now owns candidate collection and verification budgeting behind a thin storage adapter boundary
  - fuller visible-coverage candidates continue to receive expensive verification priority while incomplete candidates are downgraded without reintroducing deferred-verification ranking semantics
  - the active candidate-cascade no longer depends on migration-path flags to choose between coarse worldviews
- Phase 5. Display Simplification: completed
  - the active V2 display policy is now pure top-slice presentation with no rescue or protected-minimum keep behavior
  - active display behavior is exercised only through the independent V2 engine/candidate-cascade path
- Phase 6. Candidate Sourcing Consolidation: completed
  - the active V2 candidate-cascade now uses a strict layered cascade:
    candidate sourcing -> layer-1 frontier planning -> layer-2/3/4 complete-bucket narrowing -> highest-unresolved-bucket verification -> top-bucket proximity resolution -> display
  - cheap comparator signals are now cached once per candidate and reused through layer-2/3/4 narrowing; verification only patches proximity on the resolved top bucket
  - bounded fallback remains discovery-only in normal ranking, while a narrow Han salvage path is available only when normal layer-1 coverage and fuzzy salvage are both globally absent
- Independent V2 index-store / persistence completion pass: completed
  - active runtime now uses the standalone `coverage-lexical-v2/index-store/` path for resident store, journal/snapshot persistence, and body-token cold sidecar ownership
  - the resident store now exposes a V2-only reader boundary over `document_view`, exact postings, metadata Han gate postings, resident `bodyHanSegments`, and cold body-token fetch/prefetch
  - live updates now run through manifest-backed replace semantics, and lexical move events can reuse the same docId through a V2 move fast-path instead of always degrading to delete+add
  - startup restore now has a V2-owned persistent recovery planner that compares current vault refs, persisted refs, store refs, and cold-sidecar consistency before choosing heal vs full rebuild
  - canonical term ownership now lives in a V2 UTF-8 byte arena, while body-token cold storage uses a V2-owned term-id tape block format instead of the old string-dictionary block layout
  - canonical term pool V2 is now active: persisted state no longer stores `termByteLengths`, term lengths are derived from adjacent packed offsets, the runtime offset table now uses narrow typed-array storage that widens only when the arena outgrows `Uint16`, and canonical lookup now uses a numeric packed hash directory instead of `Map<number, number[]>`
  - runtime manifests now keep only compact id/range metadata for exact/meta ownership and body Han verification; the active runtime no longer depends on per-doc exact/meta string mirrors for restore/refcount accounting
  - exact incidence is now doc-major single-source in the active runtime: `manifest.exactTermIdsByField` is the only exact truth, resident exact segments are derived adaptive numeric shared-tape indexes, and the exact overlay is a numeric term-id memtable rather than a string-keyed posting mirror
  - metadata exact postings now share the same adaptive numeric resident segment shape as body exact, with redundant per-term adaptive metadata removed from the hot exact path
  - resident memory accounting now treats the canonical term arena as shared lexicon ownership instead of charging it to `postings.exactIncidence`; after the canonical term pool V2 compaction pass the automation-corpus size gate still passes at `exactIncidenceBytes = 16,227`, while `canonicalTermLexiconBytes` drops from `16,568` to `7,202` and `residentBytes` drops to `61,498`
  - a focused resident-hot compaction follow-up is now also active in the runtime:
    resident exact segments use packed numeric arrays for `termId/docId/start` ownership, Latin expansion resident accounting now charges only the sorted `termId` cache instead of duplicating canonical term bytes, and metadata Han resident segments now share the same adaptive packed sparse layout as exact postings
  - on the automation-corpus size gate, that resident-hot follow-up now reduces `residentBytes` further from `61,498` to `41,821`, with `exactIncidenceBytes = 9,296`, `latinExpansionLexiconBytes = 1,852`, and `metadataHanGateBytes = 770`
  - benchmark verification for the resident-hot compaction follow-up was run stepwise against MiniSearch after each sub-change rather than only at the end:
    exact packed resident postings improved the acceptance resident footprint materially while keeping the relative MiniSearch timing anchor in the same band (`avg/p50/p100 ratio ~= 2.444 / 2.367 / 1.833`);
    Latin-expansion ownership correction then reduced resident lexicon accounting again without changing lexical quality (`avg/p50/p100 ratio ~= 2.061 / 2.186 / 1.785`);
    metadata Han adaptive packing produced the last large resident drop, while the final benchmark still stayed within the normal timing-noise envelope for this corpus (`avg/p50/p100 ratio ~= 2.653 / 2.442 / 2.849`)
  - completion proof now includes build typecheck, focused V2 index-store/runtime/cold-sidecar tests, resident-vs-cold size acceptance, and the automation benchmark sanity run with the active V2 quality gate intact
- `verificationTarget` no longer drives late verification; the active candidate-cascade now verifies only the highest unresolved post-layer-4 bucket and skips proximity entirely when that bucket exceeds the configured overflow cap
- the abandoned `witness / phrase_signature` direction is no longer part of the active V2 worldview; Han recall now uses a symmetric Han backstop path:
  real-token lanes first, then residual/fragile Han bigram gating, then bounded cold HanSegment exact verification before synthetic Han exact evidence is admitted
- `metadata` and `body` now share the same Han backstop trigger and verification semantics; field priority differences remain only in the final comparator
- body Han resident ownership is now recall-first gate metadata only: hot runtime keeps doc-level Han bigram gate stats in a V2-owned lightweight Bloom-style Han-bigram sketch rather than the shared canonical term arena, while exact HanSegment payload is owned by a cold sidecar plus tiny exact cache
- Memory-First Phase 2 is now implemented in the active path:
  - metadata Han recovery now enters a `pending Han frontier` and must pass a pre-layer-1 promotion batch before it can contribute synthetic exact Han evidence
  - body Han recovery no longer uses hot `bodyChar` postings or resident exact `bodyHanSegments` narrow scan ownership; it now runs hot Han bigram gate -> bounded cold HanSegment exact prefetch -> exact-only promotion
  - unpromoted Han pending candidates do not enter layer 1, matched-field accounting, or display ranking
  - active live-index accounting no longer includes `postings.bodyChar`; on the automation corpus the active V2 benchmark now reports `estimatedIndexKB ~= 99.1` with the same `objective 0.885 / top1 0.818 / top3 0.939 / zeroRate 0` quality gate
  - active trace/debug now records pending-frontier volume, Han promotions, metadata verification promotions, body Han gate workload, and cold exact budget/fetch/degrade outcomes
  - architecture-neutral analysis tooling for required V2 information primitives now lives at `scripts/coverage-lexical-v2-information-analysis.mjs`

### Locked Decision Implementation Snapshot (2026-04-11)

Implemented in the active independent V2 path:

- items 1-10:
  short-Han primary handling, mixed-script primary handling, intact Han
  preservation, thin query analysis, `surfaceCoverageShape`, bounded field
  corroboration, locked metadata field order, and Latin/Han match-quality
  policies are all implemented inside `coverage-lexical-v2/`
- items 12-17 and 20-25:
  minimal proximity formula, near-order-neutral lexical ranking, incomplete
  candidate downgrading, no fallback promotion, baseline no-unigram final path,
  pure tail trimming, explain/debug availability, explicit normalization, and
  the minimum real-query gate set are all represented in code and tests

Implemented with important caveats:

- item 11 (`primaryUnitProximityScore` trigger):
  the active comparator only consults proximity after the first four lexical
  layers tie, but the score is still computed more broadly than the strict
  "top two only" target wording
- item 19 (recall target shape):
  the active independent V2 lexical engine now uses a layered source-based cascade
  rather than a legacy lane-shaped recall path; the remaining gap is to keep
  tightening candidate-sourcing budgets, fallback boundaries, and V2-only test
  contracts around that cascade; the active Han recall path is now the
  residual/fragile Han backstop rather than the earlier witness experiment
- item 26 (old-code deletion discipline):
  active candidate-cascade flags and old active comparator/display paths have been
  removed, but legacy V1 reference code is intentionally retained for ongoing
  comparison and debugging while V2 continues to stabilize

Still not fully realized:

- future verification budgeting:
  the active candidate-cascade now uses a strict count-only overflow guard for proximity,
  but a future dual-threshold model would still need a cheap
  `estimatedBodyTokenCount`-style candidate-cascade signal before token-budget gating can
  be added safely

Current validation snapshot:

- automation benchmark continues to compare `MiniSearch` vs
  `CoverageLexical(V2)` by default
- latest benchmark run keeps V2 ahead on quality:
  - objective: `0.885` vs `0.468`
  - top1: `0.818` vs `0.444`
  - top3: `0.939` vs `0.495`
  - top5: `1.000` vs `0.500`
  - zeroRate: `0.000` vs `0.500`
- latest relative anchor remains ratio-first against `MiniSearch`:
  - avg query latency ratio: `2.466x`
  - p50 ratio: `2.482x`
  - p100 ratio: `2.152x`
  - estimated index bytes ratio: `1.464x`
- direct automation-corpus resident-minimal measurement for the independent
  `index-store` now records:
  - resident bytes: `82,874`
  - cold sidecar bytes: `105,760`
  - total resident+cold bytes: `188,634`
  - recent legacy-coupled live-bytes baseline on the same automation corpus:
    `101,451`
  - this is enough to keep resident bytes below the old live in-memory
    baseline, but broader benchmark acceptance and real-vault validation are
    still open before the persistence/index-store workstream can be marked
    completed
- latest candidate-cascade diagnostics on the automation corpus confirm that
  verification remains tightly bounded:
  - `198 / 198` queries completed without verification overflow
  - verification bucket size: avg `1.07`, p50 `1`, max `4`
  - verification estimated body token sum: avg `70.9`, p50 `67`, max `276`
- latest Han-heavy candidate-cascade stress sweep keeps overflow at zero across
  hot/cold verification profiles, `12/16/20`-doc buckets, and target token
  sums from `1024` through `81920`

## Implementation Plan

### Public Interfaces And Type-Level Changes

V2 should first introduce new internal types without exposing a second public
backend.

Target internal types include:

- `CoverageLexicalQueryUnit`
- `CoverageLexicalQueryUnitTier = "primary" | "fallback" | "derived"`
- `CoverageLexicalPrimaryUnitCoverage`
- `CoverageLexicalSurfaceCoverageShape`
- `CoverageLexicalMatchedPrimaryUnitFieldProfile`
- `CoverageLexicalPrimaryUnitMatchQuality`
- `CoverageLexicalPrimaryUnitProximityScore`

Explicit non-goals at the interface level:

- no new backend name
- no second engine class
- no external backend-selection contract changes
- no public API that exposes V2 as a separate backend identity

### Phase 1. Query Analysis And Query Unit Model

Goal:

- define the true lexical comparison object before changing ranking behavior

Expected work:

- replace the current heavy planner target shape with thin query analysis
  responsibilities
- define query-unit data structures
- define how primary units are chosen from query surface structure
- define how fallback and derived units are tracked without polluting final
  ranking
- split query-side responsibilities into:
  - query-unit building
  - query-shape analysis
  - optional lightweight budget hints

Constraints:

- primary-unit selection must remain conservative, stable, and explainable
- fallback units may support discovery and bounded upstream expansion, but must
  not behave like final ranking units
- derived units must not count toward core lexical coverage
- query-side logic should be query-time first; avoid schema/index migration
  unless later measurement proves it necessary

Acceptance criteria:

- query-unit extraction tests cover:
  - Latin-only queries
  - Han-only queries
  - short Han queries
  - mixed-script queries
  - tokenizer-boundary-mismatch cases
- explain/debug output can show:
  - the produced primary units
  - the produced fallback units
  - the produced derived units
  - the surface-shape interpretation used by ranking

### Phase 2. Ranking Signal Model

Goal:

- make the V2 lexical worldview explicit as concrete ranker inputs

Expected work:

- add signal fields for:
  - `distinctMatchedPrimaryQueryUnitCount`
  - `surfaceCoverageShape`
  - `matchedPrimaryUnitFieldProfile`
  - `primaryUnitMatchQuality`
  - `primaryUnitProximityScore`
- add debug/explain support
- validate on known counterexamples

Constraints:

- signal names must map directly to explain/debug output
- signal definitions must stay lexical and surface-based
- no evidence-mass reintroduction through renamed aggregate signals

Acceptance criteria:

- ranker explain/debug can attribute a top result to:
  - `distinctMatchedPrimaryQueryUnitCount`
  - `surfaceCoverageShape`
  - `matchedPrimaryUnitFieldProfile`
  - `primaryUnitMatchQuality`
  - `primaryUnitProximityScore`
- known counterexamples have explicit regression coverage, including:
  - `AI 省锟斤拷`
  - `锟斤拷锟斤拷锟斤拷锟斤拷`
  - mixed-script one-sided distractors

### Phase 3. Final Comparator Rewrite

Goal:

- make user-visible lexical ranking follow the V2 ordering before deeper
  recall work

Expected work:

- rewrite final lexical comparator around the V2 order
- remove evidence-mass dependence from lexical final ranking
- ensure detail cannot invert earlier lexical layers
- keep deterministic fallback stable

Constraints:

- `primaryUnitProximityScore` runs only on a very small top tie-band
- proximity must only consume primary units plus a tiny interpretable local
  window model
- no semantic required-term weighting is introduced through back doors

Acceptance criteria:

- ranking tests are updated or added for:
  - `AI 省锟斤拷`
  - `锟斤拷锟斤拷锟斤拷锟斤拷`
  - mixed-script single-side distractors
  - metadata-identity-plus-body outranking body-only
  - near order-neutral behavior for `steam password` and `password steam`
- lexical final ranking no longer depends on evidence mass for winner
  selection

### Phase 4. Coarse/Hydration Alignment

Goal:

- align expensive work with the same lexical ordering worldview

Expected work:

- prioritize fuller primary-unit coverage
- downgrade incomplete candidates once fuller visible coverage candidates exist
- prevent one-unit spikes from dominating budget
- make coarse gating consume thin query analysis output rather than planner
  worldview objects

Constraints:

- incomplete coverage must not receive normal expensive-work priority once
  fuller visible coverage candidates exist
- fallback units may influence bounded source expansion, but not direct lexical
  promotion
- fallback budget must obey query/source/doc/stage ceilings

Acceptance criteria:

- ranking quality gates stay flat or improve
- benchmark latency does not regress materially
- tests show:
  - fuller primary-unit coverage gets upgrade priority
  - incomplete candidates are downgraded behind fuller candidates
  - one-unit spikes do not steal budget from fuller candidates
### Phase 5. Display Simplification

Goal:

- return display to a pure presentation-policy layer

Expected work:

- remove display rescue logic entirely
- delegate old display prune entrypoints to the simplified V2 policy

Constraints:

- display must not introduce hidden semantic reranking
- display must not compensate for upstream ranking mistakes

Acceptance criteria:

- display/regression tests cover:
  - tail trimming behavior
  - absence of rescue behavior
  - top-front results fully explainable from ranking output alone

### Phase 6. Candidate Sourcing Consolidation

Goal:

- let the independent V2 lexical engine own lexical candidate sourcing directly
- stop treating legacy V1 recall/lane identity as the target architecture
- keep V1 available only as reference material while V2 candidate sourcing is
  still being tightened

Expected work:

- consolidate active candidate collection inside the independent
  `coverage-lexical-v2/` candidate-cascade path
- define explicit source responsibilities for:
  - metadata exact candidate sourcing
  - bounded Latin prefix/fuzzy expansion
  - body-token hydration only where needed
  - bounded fallback support only when it materially helps lexical discovery
- increasingly reason in terms of query units and explicit source evidence
  rather than lane identity
- avoid semantic promotion for weak coverage
- prefer improving V2 correctness and real-query behavior over deleting old
  reference code early

Non-goals for this phase:

- no porting of V1 lane worldview into V2 as a target design
- no full rewrite of legacy V1 recall internals merely to preserve old
  terminology
- no architecture-purity work that increases code volume without visible gain
- no premature deletion of V1 reference code while V2 still needs comparison
  and stabilization help

Acceptance criteria:

- active V2 runtime candidate sourcing is explainable without relying on lane
  identity as architecture
- real-query and benchmark gates do not regress materially
- exception-aware and partial-memory cases do not regress materially
- display rescue is not reintroduced to compensate for recall/coarse defects

  Layered Lexical Cascade implementation:

  - active V2 uses a **layered lexical cascade** instead of reviving separate
    recall/coarse worldviews
  - the active pipeline shape is now:
    - candidate sourcing
    - layer-1 frontier planning
    - layer-2/3/4 complete-bucket narrowing with defer-first re-entry
    - highest-unresolved-bucket verification for body/proximity
    - top-bucket proximity resolution
    - display
  - this is an execution model only; it does not replace the locked V2 ranking
    worldview

Mixed completeness mode:

- `exact` source is the only source class that V2 currently treats as
  exhaustive / completeness-bearing
- bounded `prefix`, `fuzzy`, and `fallback` sources are active in the V2
  candidate-cascade path, but they are best-effort and must not be described as `100%`
  recall
- benchmark and tests may therefore claim exact-candidate completeness, but not
  global completeness for prefix/fuzzy/fallback admission

Layer 1 semantics:

- layer 1 is `potentialPrimaryCoverageCount`
- Latin `exact` and Latin `prefix` count toward normal layer-1 primary
  coverage
- Latin `fuzzy` does **not** count toward normal layer-1 primary coverage
- Han remains `exact` only
- each primary unit contributes at most one unit of layer-1 coverage

Fuzzy salvage:

- when the best normal `potentialPrimaryCoverageCount` is `0` and
  `isFuzzy=true`, the active pipeline may switch to a one-shot
  `fuzzySalvageCoverageCount`
- this keeps typo-only Latin queries from dying before ranking
- any candidate with positive normal layer-1 coverage still has absolute
  priority over pure fuzzy-salvage candidates

  Defer-first frontier policy:

  - layer-1 frontier planning is bucket-based; the active frontier is filled from
    highest layer-1 buckets downward until the configured frontier target is
    covered
  - lower buckets are deferred first, not hard-dropped immediately
  - layers 2-4 also retain complete prefix-vector buckets only; if retained
    buckets do not yet cover the return target, the next deferred bucket is
    pulled back in full before the next layer continues

  Fallback role in the cascade:

  - fallback is a bounded discovery source only
  - fallback may introduce documents into the candidate pool when exact/prefix
    sourcing is too thin
  - fallback does not directly contribute layer-1 through layer-4 primary
    ranking signal
  - a pure fallback-hit document that never acquires primary evidence must not
    survive the active frontier as a lexical winner
  - the only exception is narrow Han salvage:
    if the query has Han groups and both normal layer-1 coverage and fuzzy
    salvage are globally zero, fallback-hit surface groups may be used as a
    weak last-resort ordering key
  - Han salvage is grouped by distinct touched surface groups; multiple fallback
    hits inside the same surface group do not stack

  Late verification:

  - body-token prefetch and body-window/proximity work should happen only for
    the highest unresolved post-layer-4 bucket
  - early sourcing may record body exact presence, but it should not eagerly
    hydrate all body token sequences
  - `verificationTarget` is no longer the active driver of late verification
  - the active overflow rule is
    `proximityOverflowCap = min(20, max(12, returnTarget + 2))`
  - if the highest unresolved bucket exceeds that cap, proximity is skipped for
    the whole bucket and stable deterministic fallback resolves the remaining
    ties

  Current implementation note:

- the active V2 candidate-cascade now uses a cascade candidate-state path under
  `coverage-lexical-v2/candidate-cascade/`
  - the previous V2 one-shot runtime/prototype/coarse path has been removed from
    the active V2 tree; shared candidate evidence helpers now live in active
    candidate-cascade-oriented modules rather than legacy orchestration files
  - exact candidate sourcing is exhaustive
  - layer-1 currently uses Latin `exact/prefix`, Han `exact`, plus fuzzy salvage
    when normal coverage is zero
  - Han backstop candidate sourcing is now memory-first:
    metadata uses hot Han bigram gate -> pending frontier -> pre-layer-1 promotion,
    while body uses hot Han bigram gate -> bounded cold HanSegment exact sidecar verify -> verified promotion
  - cheap comparator signals are cached once per candidate and reused through
    layer-2/3/4 complete-bucket narrowing
  - late verification is active only for the highest unresolved bucket, with an
    explicit overflow skip path
  - proximity is patched only onto the resolved top bucket; there is no longer
    a separate global rerank stage in the active architecture
  - internal candidate-cascade trace now records layer mode, retained/deferred buckets,
    verification bucket membership, resolved top-bucket membership,
    verification skip reason, salvage usage, pending-Han frontier size,
    Han promotion counts, body Han gate workload, and cold exact budget outcomes
  - the active runtime now also routes through an independent V2 `index-store/`
    implementation that owns resident postings/doc view state, body-token cold
    sidecar ownership, HanSegment exact sidecar ownership, Dexie snapshot+journal
    persistence, move-aware journal replay, and engine-owned persistent recovery
    planning
  - current store layout uses manifest-backed doc-major exact truth plus
    derived resident segments and a mutable numeric overlay; metadata Han gate
    postings still use tiny-inline / delta-varint resident segments, while
    exact postings use adaptive numeric shared-tape encoding with rich per-doc
    manifests for rollback without reconstructing old raw text
  - current validation covers build typecheck, focused V2 index-store/runtime
    tests for replace/update/delete/move semantics plus snapshot roundtrip,
    resident-vs-cold size acceptance, cold-sidecar packing coverage, and the
    automation benchmark sanity run; this persistence pass is now marked
    completed
  - a resident-hot follow-up is also now active in the runtime:
    document-view strings are pooled across documents instead of being re-owned
    per document view, so repeated folder/tag/heading/alias/path-adjacent view
    text no longer pays duplicate resident ownership
  - on the automation-corpus size gate, that document-view pooling pass reduces
    `documentViewBytes` to `15,171` and `residentBytes` to `40,207` while
    keeping `exactIncidenceBytes = 9,296`
  - the persistent restore path now force-compacts snapshot+journal replay back
    into resident segments before declaring restore complete, preventing large
    replayed journals from leaving the live runtime in a much fatter
    overlay-heavy exact/metadata posting shape

### Phase 7. Old-Code Removal And Shell Shrinkage

Goal:

- prevent permanent dual-worldview coexistence
- start old-code removal only after V2 behavior is stable enough that V1 no
  longer adds meaningful comparison value

Expected work:

- after each stabilized migration layer, delete or hard-deprecate the old
  active implementation
- keep old files only as thin orchestration/adaptation shells
- remove stale helpers once no active call path remains
- update active design-doc progress/state immediately when a phase is truly
  completed

Phase-order note:

- Phase 7 should trail V2 stabilization work rather than compete with it
- while V2 is still being refined, V1 may remain in-tree as reference material
  even if it is no longer the active candidate-cascade path
- the priority order is:
  - keep the active path on independent V2
  - improve V2 against recall suites, real-query regressions, and benchmarks
  - remove V1 code only after the comparison value has materially dropped

Explicitly disallowed leftovers:

- reachable old comparator branches in lexical final ranking
- callable display rescue paths after V2 display goes live
- reachable evidence-mass tie-breaks in lexical final ranking
- fallback/derived units treated as primary in final ordering

## Test And Benchmark Plan

Primary validation set:

- `coverage-lexical-ranking.test.ts`
- `coverage-lexical-recall-suite.test.ts`
- real tokenizer / real Chinese regression suites
- `coverage-lexical` benchmark

Required scenario coverage:

- short Han queries with two visible units
- mixed-script two-sided queries
- `AI 省锟斤拷` style short ASCII + Han queries
- order-swapped query pairs
- tokenizer-boundary-mismatch queries that require fallback involvement
- metadata identity vs body-only competition
- display behavior without rescue

Benchmark policy:

- keep the current `coverage-lexical` benchmark entrypoints
- treat current benchmark outputs as continuity gates, not as justification for
  preserving old worldview logic
- when a phase changes metrics, compare both:
  - benchmark continuity
  - real-query behavior on known important cases

Real-query gates that must remain active:

- `AI 省锟斤拷`
- `锟斤拷锟斤拷锟斤拷锟斤拷`
- mixed-script two-sided cases
- tokenizer-boundary-mismatch queries
- `steam password`
- `password steam`

V2 should not be judged only by:

- whether benchmark passes
- whether the architecture looks cleaner

It should also be judged by whether these real-query failures are actually
improved and remain improved.

## Additional Critical Considerations

These concerns are important enough to affect implementation choices, even
though they are not themselves ranking rules.

### 1. Query-Time First, Index Migration Last

V2 should prefer query-time architectural change before changing binary index
or snapshot schema. Query-unit logic should first be introduced as query-side
analysis and result-side scoring. Persisted schema changes should only happen
if measurement shows they are truly required.

### 2. Fallback Budget Ceiling

Fallback units are necessary, but they are also the easiest way to reintroduce
noise and latency. Their expansion must stay explicitly bounded:

- Han bigram use must remain constrained
- fallback units must not explode local-window or hydration budgets
- query/source/doc/stage ceilings must all remain active

### 3. Explainability Must Migrate With Logic

Every major V2 migration step should ship with matching explain/debug output.
If ranking behavior moves but explainability does not, the new lexical
worldview will quickly become harder to trust and maintain.

### 4. Deterministic Normalization Policy

Query-unit generation depends on normalization behavior. Otherwise V2 ranking
may look principled but still produce unstable results.

This includes:

- Unicode normalization
- ASCII/Han boundary behavior
- mixed-script segmentation
- intact-segment policy when tokenizer boundaries are unreliable

### 5. Real-Query Gates Matter More Than Synthetic Elegance

V2 should be judged not only by internal cleanliness but by whether it fixes
known real-query failures. Real Chinese, mixed-script, and short-query
regression cases must remain a first-class migration gate alongside benchmark
continuity.

## Assumptions And Defaults

- `coverage-lexical` remains the only runtime backend boundary throughout
  migration
- V2 modules are internal implementation modules, not a new public backend
- query order is not a core lexical semantic feature; order sensitivity is
  confined to the tiny top tie-band proximity resolver
- semantic requiredness stays outside lexical final ranking
- evidence mass may remain in diagnostics, budget hints, and debug/explain, but
  must not participate in lexical final winner selection
- every completed migration phase must be written back into the active design
  docs as implementation-status progress

## Current Recommendation

Adopt this V2 as the target lexical worldview.

In particular:

- define lexical ranking over query units, not tokenizer words alone
- trust primary units in final ranking
- keep fallback and derived units upstream and subordinate
- remove evidence mass from lexical final ranking
- remove rescue language entirely from lexical ranking and execution design
- keep lexical pure, explicit, and explainable

Implementation priority right now:

- keep V1 in-tree as a reference baseline for comparison, debugging, and
  regression investigation
- continue improving the independent V2 lexical engine and candidate-sourcing cascade first
- delay broad V1 deletion until V2 quality and stability are clearly settled


## Additional Migration Boundary Notes

### V2 Index And Storage Boundary

V2 does not need to inherit the V1 ranking worldview, comparator structure, or
ranking logic.

However, index-storage interaction should remain as consistent as reasonably
possible with the existing optimized storage boundary.

Guidance:

- V2 may replace V1 ranking philosophy completely
- V2 should try to preserve compatible or near-compatible index/storage
  interaction patterns where practical
- the existing optimized index structures are a performance asset and should
  not be casually discarded
- V2 index-facing code should be implemented inside V2 modules directly rather
  than by depending on V1 ranking modules
- V2 should avoid new hard dependencies on V1 index code that would make later
  V1 removal difficult
- V2 should be implemented as an independent codepath even when it reuses the
  same storage boundary or storage interaction shape
- V2 may study or reference V1 index-interaction code as migration material,
  but the preferred outcome is a V2-owned implementation rather than a V1
  wrapper
- reference is allowed; new runtime coupling is not

In short:

- worldview may diverge
- storage interaction should stay disciplined
- V2 index code should live in V2, not as wrappers around V1 ranking logic

### V1 Retention Policy

V1 code should not be deleted merely because V2 exists.

During migration:

- keep V1 code available while V2 is still being implemented and stabilized
- use V1 as a reference point for behavior comparison, debugging, and migration
  validation
- only consider deleting V1 code after V2 stability is proven and the
  comparison value has materially dropped
- once deletion starts, remove V1 in a disciplined way rather than allowing
  indefinite dual active paths

This means:

- do not keep old and new active logic for the same responsibility indefinitely
- but do keep V1 code available as reference material until V2 stability is
  proven
- when there is a tradeoff between early cleanup and faster V2 iteration,
  prefer keeping V1 as reference and advancing V2
- Phase 7 cleanup should begin only after V2 has enough real-query and
  benchmark stability that V1 is no longer pulling its weight as a reference

### Benchmark Default Comparison Policy

V2 should be benchmarked directly.

Default benchmark comparison policy:

- compare `MiniSearch` and V2 by default
- the automation benchmark now reports `MiniSearch` and `CoverageLexical(V2)` as the default comparison pair, using the independent V2 lexical engine directly
- do not keep V1 lexical ranking as the default benchmark peer once V2
  benchmarking is in place
- V1 may still be used as a temporary migration reference when investigating
  regressions or validating continuity during rollout
- benchmark continuity is important, but it must not be used as a reason to
  preserve old worldview logic










