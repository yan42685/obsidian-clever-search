
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
- introduce an explicit internal `v2/` subtree under `coverage-lexical/`
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

- `v2/query-units/`
- `v2/ranking/`
- `v2/coarse/`
- `v2/display/`
- `v2/explain/`

During migration, the existing large files remain as orchestration shells:

- `coverage-lexical-engine.ts`
- `coverage-lexical-ranker.ts`
- `coverage-lexical-recall.ts`

These files should gradually stop owning core decisions and instead delegate to
V2 modules.

### Migration Defaults

- migration style: layered replacement
- module organization: explicit `coverage-lexical/v2/` subtree
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

- `AI 省考`
- `政治理论`
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

- a result matching both `AI` and `省考` should outrank one matching only `省考`
- a result matching both `政治` and `理论` should outrank one matching only one
  of them
- a result matching both the Latin and Han sides of
  `projected token 运行时访问` should outrank a one-sided result

### 2. `surfaceCoverageShape`

Compare whether the result preserves the visible surface structure of the query.

This is intentionally not a semantic requiredness layer. It is a lexical
surface-completeness layer built from **query surface grouping**.

Examples:

- `AI 省考`
  both visible groups should be covered
- `政治理论`
  both visible groups should be covered
- `projected token 运行时访问`
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

- matching `AI` in basename and `省考` in body should outrank matching both only
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

### `AI 省考`

Preferred lexical order:

1. result matching `AI` in metadata identity and `省考` in body
2. result matching both `AI` and `省考` in body
3. result matching only `省考`

### `政治理论`

Preferred lexical order:

1. result matching both `政治` and `理论`
2. weaker results still matching both units
3. results matching only one unit

### `projected token 运行时访问`

Preferred lexical order:

1. result covering both Latin and Han sides
2. weaker two-sided results
3. one-sided distractors

## Implementation Status

- Phase 1. Query Analysis And Query Unit Model: completed
  - independent `v2/query-units/` modules now build primary, fallback, and derived query-unit outputs
  - query analysis now exposes visible surface groups plus `surfaceCoverageShape`
  - standalone tests now cover Latin-only, Han-only/short-Han, mixed-script, and tokenizer-boundary-mismatch query shapes
- Phase 2. Ranking Signal Model: completed
  - independent `v2/ranking/` signal types now encode:
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
  - an independent V2 ranking-signal builder now converts query analysis plus matched-unit evidence into comparator-ready candidate signals
  - an independent V2 ranking runner now executes query analysis, signal building, comparator ordering, top tie-band selection, and structured explain output end to end
  - the independent runtime V2 engine now projects exact metadata-phrase, heading-local, and body-local best-window evidence into `primaryUnitProximityScore` without changing the earlier lexical layers
  - the V2 runtime path now independently derives Latin `exact > prefix > fuzzy` evidence for `primaryUnitMatchQuality`, while Han remains exact-only
  - the independent `coverage-lexical-v2/` engine now owns query-side analysis from raw query text instead of depending on legacy query-term helpers
  - runtime regression coverage now explicitly guards `exact > prefix > fuzzy` ordering on tied lexical coverage through the independent V2 engine path
- Phase 4. Coarse/Hydration Alignment: completed
  - the independent `coverage-lexical-v2/` runtime now owns candidate collection and coarse budgeting behind a thin storage adapter boundary
  - fuller visible-coverage candidates continue to receive expensive verification priority while incomplete candidates are downgraded without reintroducing deferred-verification ranking semantics
  - the active runtime no longer depends on migration-path flags to choose between coarse worldviews
- Phase 5. Display Simplification: completed
  - the active V2 display policy is now pure top-slice presentation with no rescue or protected-minimum keep behavior
  - active runtime display behavior is exercised only through the independent V2 engine/runtime path

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
  - `AI 省考`
  - `政治理论`
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
  - `AI 省考`
  - `政治理论`
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

### Phase 6. Recall Narrowing And Lane Retirement

Goal:

- make recall compatible with V2 without a big-bang rewrite
- keep V1 available as a comparison/debug reference while V2 recall behavior is
  still being tightened

Expected work:

- use temporary source adapters as needed
- move toward source-based candidate collection plus merged doc-state
  comparison
- increasingly reason in terms of query units and explicit source evidence
- avoid semantic promotion for weak coverage
- remove lane identity as a semantic concept from final recall design
- prefer improving V2 correctness and real-query behavior over deleting old
  reference code early

Non-goals for this phase:

- no full lane-model rewrite up front
- no architecture-purity work that increases code volume without visible gain
- no premature deletion of V1 reference code while V2 still needs comparison
  and stabilization help

Acceptance criteria:

- recall suite continues to pass
- exception-aware and partial-memory cases do not regress materially
- display rescue is not reintroduced to compensate for recall/coarse defects

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
  even if it is no longer the active runtime path
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
- `AI 省考` style short ASCII + Han queries
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

- `AI 省考`
- `政治理论`
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
- continue improving the independent V2 runtime and recall path first
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
- the automation benchmark now reports `MiniSearch` and `CoverageLexical(V2)` as the default comparison pair, using the independent V2 runtime directly
- do not keep V1 lexical ranking as the default benchmark peer once V2
  benchmarking is in place
- V1 may still be used as a temporary migration reference when investigating
  regressions or validating continuity during rollout
- benchmark continuity is important, but it must not be used as a reason to
  preserve old worldview logic



















