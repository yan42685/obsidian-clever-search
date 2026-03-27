# Coverage Lexical Design

This file defines the canonical theory, architecture, and execution plan for the
next `coverage-lexical` backend.

It replaces the older planning role previously carried by
`coverage-lexical-engine-design.md`.

It is the implementation design companion to:

- [`automation.md`](./automation.md)
- [`../hybrid/automation-design.md`](../hybrid/automation-design.md)

If any shorter planning note conflicts with this file, this file wins for all
`coverage-lexical` implementation work.

## Document Status

`coverage-lexical-design.md` is the primary design document.

`coverage-lexical-engine-design.md` is retained only as a compatibility
entrypoint for older references.

If the two files ever disagree:

- `coverage-lexical-design.md` wins
- implementation work should follow `coverage-lexical-design.md`

## Core Position

The new backend should be:

- `coverage-first` at the final comparator layer
- `passage-first` at the body evidence layer
- `recall-contract-first` at the admission layer
- fully independent from legacy `passage-bm25` code, storage, scorer, verifier,
  and tuning tables

The most important correction to the current direction is:

- `zeroRate` is primarily a recall problem, not a ranking problem
- `top1` and `MRR` are primarily ranking problems after recall succeeds

This means the backend must be designed in two explicit stages:

1. `admission / recall`
2. `structured ranking`

The system should no longer rely on one blended scoring path to do both jobs.

## Product Priority

For user experience, `zeroRate` is a first-class quality target.

A user usually tolerates:

- the right file appearing at rank `3`
- the right file appearing at rank `5`

A user usually does not tolerate:

- the right passage clearly existing in the vault but not being surfaced at all

So the optimization order should be:

1. drive `zeroRate` toward zero
2. preserve ranking invariants
3. improve `top1`
4. improve latency and size within reason

## Main Diagnosis

The current `coverage-lexical` ceiling is not mainly caused by bad constants.

The deeper problem is that the backend still lacks a complete theory for:

- query decomposition
- recall guarantees
- evidence-type-specific admission
- lexicographic ranking stages

Observed consequences:

- `partial_memory` can improve because body recall sometimes reaches the right file
- `title_exact`, `title_prefix`, `prefix_metadata`, `body_path_anchor`, and
  `body_title_anchor` stay weak because the right file often does not enter the
  candidate set through a dedicated lane

The backend therefore needs a stronger theory than "add another hint" or
"improve metadata phrase scoring".

## Design Goals

1. Obey the ranking invariants exactly.

- more matched core body families must always beat fewer matched core body families
- when core coverage ties, `exact > prefix > fuzzy`
- later query families should matter more than earlier query families
- local compactness and order are tie-break evidence, not coverage overrides
- metadata is anchor evidence by default, not the main scoring lane

2. Drive `zeroRate` close to zero.

- relevant files should enter the top candidate pool through at least one stable
  admission lane whenever the query contains enough real evidence

3. Raise the quality ceiling on hard lexical search.

- `partial_memory`
- `mixed_anchor`
- `bilingual_mirror`
- markdown-heavy long-note clutter
- same-title / template / archive-vs-live collisions

4. Keep the architecture replaceable.

- planner, recall, local evidence, and fusion should be separable modules
- the backend must be swappable without depending on legacy `passage-bm25`
  implementation details

5. Keep benchmark iteration practical.

- benchmark under `20s`
- no uncontrolled persisted index growth
- no hot-path heuristic sprawl that prevents automated exploration

## Non-Goals

- recreating full legacy `passage-bm25`
- importing old scorer / verifier / comparator helpers
- adopting a large generic additive score soup
- treating BM25 constant tuning as the main optimization lane
- using lane-specific hacks without a planner and recall contract behind them

## Formal Search Model

The backend should be defined as a two-stage decision system.

### Stage A: Admission / Recall

Input:

- raw query text
- tokenized query families

Output:

- candidate file set `C(q)`

Goal:

- make it highly likely that every relevant file enters `C(q)`

Primary metric:

- `zeroRate`

### Stage B: Structured Ranking

Input:

- candidate file set `C(q)`
- file-level evidence
- local passage / window evidence

Output:

- ordered result list

Goal:

- rank the best explanation first without violating invariants

Primary metrics:

- `top1`
- `MRR`
- `top3`
- `top5`

## Evidence Theory

The backend should treat relevance as a comparison over structured evidence,
not as a single blended score.

Relevant evidence types:

1. `body coverage evidence`
2. `body match quality evidence`
3. `tail-weighted evidence`
4. `metadata anchor evidence`
5. `local explanation evidence`
6. `bridge evidence`

The architectural rule is:

- recall may use any evidence type that safely admits candidates
- final ranking must still obey the body-family invariants first

## Query Theory

The planner should not classify queries by superficial text shape alone.

It should classify queries by the evidence required to prove relevance.

### Query Evidence Classes

#### `metadata_only_anchored`

The relevant file can be admitted mostly by metadata evidence.

Examples:

- title-like queries
- basename / alias lookups
- short prefix metadata queries

Typical evidence:

- `basename`
- `aliases`
- `headings`
- `folder`

#### `body_only_local`

The relevant file is proved by a compact body explanation.

Typical evidence:

- decisive body families co-occurring in one local window

#### `anchor_body_hybrid`

Metadata narrows the scope and body confirms the topic.

Examples:

- locale / folder + topic
- path anchor + body content

#### `bridge_dependent`

The query depends on script bridging, aliases, joined terms, or slugs.

Examples:

- mixed Chinese-English technical queries
- renamed project queries
- `tech-zh` / `tech-en` style anchors

#### `memory_relaxed`

The query contains partial memory, narrative filler, and some real clues.

The planner must identify:

- which clues are mandatory
- which clues are supportive
- which clues can be relaxed

## Term Theory

Each query family should be assigned a role based on evidence behavior, not just
surface heuristics.

### Required Term Roles

#### `hard_anchor`

Must be satisfied for a file to be considered relevant in the intended lane.

Typical sources:

- metadata-selective title terms
- path / locale markers
- slug-like terms
- bridge-critical aliases

#### `decisive_body`

Must appear in the body explanation window for the file to be strongly relevant.

#### `support_body`

Supports the explanation but should not be required in every relaxed lane.

#### `bridge_anchor`

Provides cross-script, alias, or joined-term connection.

#### `optional_noise`

Narrative, common, or low-value terms that may be dropped in relaxed admission.

### Required Derived Statistics

The planner should reason from explicit field statistics such as:

- `df_body(term)`
- `df_metadata(term)`
- `df_title(term)` for `basename + aliases + headings`
- `df_path(term)` for `folder + basename`

These statistics should drive:

- anchor selection
- optional term selection
- query kind promotion
- route selection

## Position Theory

Query term order matters.

The backend should treat later query families as more specific evidence than
earlier families, unless a stronger anchor rule overrides that interpretation.

This means:

- tail weight should be a first-class design concept
- later terms should influence both admission prioritization and ranking

Tail weight is allowed to break ties only after:

1. core coverage
2. exactness tier
3. prefix tier
4. fuzzy tier

## Recall Contract

The backend should define explicit admission guarantees.

This is the theoretical core required to push `zeroRate` toward zero.

### Admission Principle

A relevant file should not depend on a single global candidate pool.

Instead, the backend should admit files through multiple evidence-specific
lanes, then union the strongest candidates before ranking.

### Required Admission Lanes

#### Lane 1: `strict_metadata_lane`

Purpose:

- admit title / alias / heading / basename matches

Used for:

- `metadata_only_anchored`
- short title queries
- short prefix metadata queries

Contract:

- requires `hard_anchor` satisfaction in metadata
- may use exact and prefix metadata sequence matches

#### Lane 2: `strict_hybrid_lane`

Purpose:

- admit files that satisfy both metadata anchor and body topic evidence

Used for:

- `anchor_body_hybrid`

Contract:

- all hard anchors must be satisfied
- at least one decisive body family must be satisfied

#### Lane 3: `relaxed_hybrid_lane`

Purpose:

- reduce `zeroRate` on memory-style queries

Used for:

- `memory_relaxed`

Contract:

- hard anchors must still hold
- decisive body evidence must meet a relaxed minimum
- optional / noise terms may be dropped

#### Lane 4: `local_body_lane`

Purpose:

- admit files through compact body explanations even when metadata is weak

Used for:

- `body_only_local`

Contract:

- admits by local window evidence, not whole-file body bags alone

#### Lane 5: `bridge_lane`

Purpose:

- admit mixed-script and alias-dependent matches

Used for:

- `bridge_dependent`

Contract:

- must be narrow and explicit
- must require at least one bridge anchor
- must not become a generic noisy expansion path

### Candidate Union Rule

The engine should take the union of the top candidates from each lane.

This is essential.

If one lane fails, another lane should still be able to surface the relevant file.

The backend should not rely on one monolithic candidate pool to satisfy all
query types.

## Ranking Theory

The final ranker should be lexicographic, not additive.

This is the cleanest way to satisfy the invariants exactly.

### Final Comparator Order

1. matched distinct core body family count
2. exact core quality
3. prefix core quality
4. fuzzy core quality
5. tail-weighted core quality
6. best local body explanation
7. soft body support
8. route-specific metadata anchor support

This means:

- metadata cannot overturn stronger body family coverage
- proximity cannot overturn stronger body family coverage
- later query families matter only after coverage and match quality ties

### Ranking Representation

The ranker should conceptually compare a tuple, not a scalar:

`(
	coreCoverage,
	exactCoreQuality,
	prefixCoreQuality,
	fuzzyCoreQuality,
	tailCoreQuality,
	localExplanationQuality,
	softBodySupport,
	metadataAnchorSupport
)`

This is the intended interpretation even if implementation details cache or
materialize parts of the tuple separately.

## Local Explanation Theory

Body evidence should be decided by the best local explanation, not by diffuse
whole-file term presence.

Each admitted file should keep only a small number of explanation candidates:

- best `1-3` local windows

Signals that belong in local explanation comparison:

- compactness
- natural order
- decisive-family concentration
- support-family corroboration
- anchor agreement
- template penalty
- duplicate-family penalty

Hard rule:

- local explanation quality is a tie-break after family coverage and family
  quality, not a substitute for them

## Mixed-Script And Alias Theory

Bridge logic should remain narrow.

The backend should not use mixed-script handling as a broad recall excuse.

Required support:

- Chinese-English technical mirrors
- alias / rename maps
- slug-like folder cues
- joined-term bridges

Required constraint:

- bridge lanes must require explicit bridge anchors or bridge-eligible term
  patterns

## Module Responsibilities

Recommended modules:

- `coverage-lexical-engine.ts`
  - orchestrates planner -> recall -> local evidence -> fusion
- `coverage-lexical-families.ts`
  - family building and derived statistics helpers
- `coverage-lexical-planner.ts`
  - query kind, term role decomposition, route contract
- `coverage-lexical-recall.ts`
  - lane-specific admission and candidate union
- `coverage-lexical-windowing.ts`
  - local explanation generation
- `coverage-lexical-fusion.ts`
  - explanation selection and structured fusion
- `coverage-lexical-ranker.ts`
  - lexicographic final comparator
- `coverage-lexical-types.ts`
  - planner, recall, lane, and fusion contracts

This split is preferred over:

- embedding route theory inside the engine
- embedding recall lane behavior inside the ranker
- using phrase signatures as a substitute for proper metadata lanes

## Required Planner Contract

The planner output should eventually include at least:

- `queryKind`
- `hardAnchorFamilies`
- `decisiveBodyFamilies`
- `supportBodyFamilies`
- `bridgeFamilies`
- `optionalFamilies`
- `noiseFamilies`
- `relaxedMinimumMatchCount`
- `route`

The current weaker contract is not enough if the goal is near-zero `zeroRate`.

## Required Recall Contract

The recall layer should eventually expose:

- per-lane candidate sets
- per-lane admission evidence
- union policy
- lane budgets
- lane fallback rules

This is required so zero-rate improvements can be reasoned about directly and
benchmarked by lane, not only by aggregate score.

## Metrics And Benchmark Policy

Primary recall-focused metrics:

- `zeroRate`
- `top10 recall` if added later
- win-rate vs baseline on zero-hit cases

Primary ranking-focused metrics:

- `top1`
- `MRR`
- `top3`
- `top5`

Diagnostic metrics:

- bySuite
- byType
- lane admission counts
- index size
- `avg`
- `p100`

Interpretation policy:

- a change that lowers `zeroRate` materially is high value even if `top1` moves
  modestly
- a change that improves `top1` while leaving `zeroRate` bad is incomplete
- a change that raises code complexity without reducing `zeroRate` should usually
  be reverted

## Implementation Roadmap

### Phase 1: Query Decomposition Rewrite

Deliverables:

- planner outputs real query kinds from evidence demand
- planner outputs hard anchor / decisive body / support / optional / noise roles
- tail-aware family interpretation is preserved

Acceptance:

- `title_exact`, `title_prefix`, and `prefix_metadata` stop depending on weak
  comparator hints

### Phase 2: Multi-Lane Recall Union

Deliverables:

- `strict_metadata_lane`
- `strict_hybrid_lane`
- `relaxed_hybrid_lane`
- `local_body_lane`
- `bridge_lane`
- candidate union with lane budgets

Acceptance:

- visible `zeroRate` reduction on `title_exact`, `title_prefix`,
  `prefix_metadata`, `body_path_anchor`, and `body_title_anchor`

### Phase 3: Passage-First Local Evidence

Deliverables:

- query-conditioned local explanation windows
- per-file top explanation budget
- explanation selection independent of file-level bags

Acceptance:

- `top1` and `MRR` improve without violating coverage invariants

### Phase 4: Lexicographic Fusion

Deliverables:

- explicit staged comparator
- no generic additive soup in the final decision path

Acceptance:

- comparator behavior is explainable from the invariants alone

### Phase 5: Narrow High-Upside Bridges

Deliverables:

- explicit mixed-script bridge admission
- explicit alias / joined-term bridge admission

Acceptance:

- hard bilingual and rename cases improve without broad noisy recall growth

## Keep / Revert Rules

Keep only if:

- `zeroRate` improves materially
- or `zeroRate` is preserved while `top1`, latency, or size improve materially

Revert if:

- `zeroRate` does not improve and code complexity rises
- `top1` gains come from a narrow slice while recall-heavy suites regress
- a change weakens the ranking invariants
- a change makes query behavior harder to reason about

## Immediate Recommendation

The next implementation cycle should not focus on score tuning.

It should focus on:

1. planner contract rewrite
2. multi-lane recall union
3. explicit admission guarantees for zero-rate-heavy query types

Only after that should the next cycle focus on:

4. passage-first local evidence for ranking quality

In short:

- solve `zeroRate` with theory-backed recall contracts
- solve `top1` with passage-first explanation ranking
