# Coverage Lexical Engine Design

This file defines the intended architecture for the next `coverage-lexical` backend.

It is the implementation design companion to:

- [`automation.md`](./automation.md)
- [`../hybrid/automation-design.md`](../hybrid/automation-design.md)

If a shorter planning note conflicts with this file, this file wins for `coverage-lexical` implementation work.

## Core Position

The new backend should be `passage-first` from the beginning, but not by reusing legacy `passage-bm25`.

The target architecture is:

- `coverage-first` at the comparator level
- `passage / local-window-first` at the body evidence level
- fully independent from legacy `passage-bm25` code, storage, scorer, verifier, and tuning tables

This means:

- do not build another pure file-level family-coverage engine and plan to bolt local evidence on later
- do not revive `passage-file-search-engine.ts` and rename it as the new backend
- do build a new backend where file recall, local passage evidence, and final file fusion are all owned by `coverage-lexical`

## Design Goals

1. Obey the ranking invariants exactly.

- more matched core body families must always beat fewer matched core body families
- when core coverage ties, `exact > prefix > fuzzy`
- tail weight matters only after coverage and family quality ties
- local compactness and order are tie-break evidence, not coverage overrides
- metadata is anchor evidence by default, not the main scoring lane

2. Raise the quality ceiling on hard lexical search.

- `partial_memory`
- `mixed_anchor`
- `bilingual_mirror`
- markdown-heavy long-note clutter
- same-title / template / archive-vs-live collisions

3. Keep the architecture replaceable.

- planner, recall, local evidence, and fusion should be separable modules
- the backend must be swappable without depending on legacy `passage-bm25` implementation details

4. Keep benchmark iteration practical.

- benchmark under `20s`
- no uncontrolled persisted index growth
- no hot-path heuristic sprawl that prevents automated exploration

## Non-Goals

- recreating full legacy `passage-bm25`
- importing old scorer / verifier / comparator helpers
- adopting a large generic score soup
- treating BM25 constant tuning as the main optimization lane

## Evidence Hierarchy

The engine should rank in this conceptual order:

1. `core body family coverage`
2. family match quality (`exact > prefix > fuzzy`)
3. tail-weighted core family quality
4. best local body explanation
5. soft body support
6. route-specific metadata anchor support

The key architectural consequence is:

- file-level recall may be cheap and approximate
- final ranking must depend on local body explanations, not whole-file term presence alone

## Layered Architecture

### Layer 1: Query Planner

Responsible for producing a stable query contract before recall and ranking.

Planner outputs:

- family decomposition
- `core` vs `soft`
- `body` vs `metadata-capable`
- `anchor` vs `body` vs `noise`
- short-query overlay flag
- prefix-like flag
- typo-like flag
- route selection

Default route behavior:

- `body-first` unless metadata intent is clearly dominant
- `body-with-anchor` when body evidence and metadata anchors both matter
- `metadata-first` only when metadata dominance is clear

Implementation note:

- `core / soft` and `anchor / body / noise` should be designed together as one planner contract
- do not implement them as unrelated heuristics scattered across recall and ranker

### Layer 2: Recall

Recall exists to admit plausible files, not to decide the final order.

Required behavior:

- family-scoped exact recall first
- prefix fallback only when exact family evidence is insufficient
- fuzzy fallback only when exact and prefix remain insufficient
- no family may gain artificial coverage credit from multiple expansions

Near-term default:

- use a lightweight file-level family recall path to keep latency low

Longer-term expectation:

- if file-level admission becomes the quality bottleneck, add a compact passage-admission sketch
- do this inside `coverage-lexical`, not by importing `passage-bm25`

### Layer 3: Local Passage / Window Evidence

This is the default body evidence layer from the start.

Each candidate file should produce a small set of query-conditioned local explanations:

- lightweight passages
- or dynamic local windows around decisive query families

Each file should keep only its best `2-3` explanation candidates.

Signals that belong here:

- compactness
- natural order
- anchor agreement
- decisive-family concentration
- support-family corroboration
- template penalty
- duplicate-family penalty

Hard rule:

- these signals can break ties after family coverage and quality
- they must never overturn stronger core body family coverage

### Layer 4: File Fusion

File fusion converts local explanations and file-level family evidence into the final order.

Responsibilities:

- enforce the ranking invariants
- choose the best explanation per file
- reward corroborated multi-window support without letting diffuse evidence dominate compact explanation
- apply metadata anchor support only in route-appropriate ways

The final file comparator should not be a generic additive soup.

It should compare structured signals in stages.

## Suggested Module Split

The backend should remain small but not artificially collapsed into one file.

Recommended modules:

- `coverage-lexical-engine.ts`
  - orchestrates planner -> recall -> local evidence -> fusion
- `coverage-lexical-families.ts`
  - family decomposition and expansion policy
- `coverage-lexical-planner.ts`
  - query classification and route selection
- `coverage-lexical-recall.ts`
  - file admission and expansion gating
- `coverage-lexical-windowing.ts`
  - passage segmentation or query-conditioned local windows
- `coverage-lexical-fusion.ts`
  - explanation selection and final file ordering
- `coverage-lexical-types.ts`
  - stable planner / recall / window / fusion contracts

This split is preferred over:

- embedding all local-window logic into the ranker
- embedding all route logic into the engine
- reusing old passage modules as hidden dependencies

## Passage Strategy

The backend should be `passage-first` immediately, but in a controlled form.

Phase-1 passage strategy:

- cheap file-level recall
- query-conditioned window extraction only on top-N admitted files
- small per-file explanation budget
- no heavy persisted positional index yet unless benchmark data proves it is necessary

Why this is the first step:

- it tests the right decision unit early
- it avoids locking the architecture around whole-file evidence
- it gives a clean benchmark read on whether local explanation competition is the real lift

Phase-2 passage strategy:

- add compact persisted passage evidence only if top-N admission remains the ceiling
- keep storage targeted and benchmark-justified

## Index And Storage Principles

Storage is allowed to grow only when it buys visible ranking quality.

Preferred order of escalation:

1. file-level family postings
2. lightweight local window extraction on candidate files
3. compact passage admission sketch
4. selective phrase-signature or ordered-pair channel

Avoid by default:

- heavy global positional indexes
- broad phrase indexing without query-family justification
- storage added solely to mimic legacy passage behavior

## Mixed-Script And Alias Handling

This should be treated as a first-class lane, not tokenizer luck.

Required future support:

- Chinese-English technical mixed queries
- slug / alias / acronym bridges
- joined-term variants
- narrow bilingual mirror-note disambiguation

But this should follow the passage-first local evidence layer, not precede it.

Reason:

- mixed-script bridge signals are more valuable when the engine can already compare local explanations instead of whole-file bags

## Implementation Phases

### Phase 1: Planner Contract Rewrite

Deliverables:

- `core / soft`
- `anchor / body / noise`
- route contract usable by recall and fusion

Acceptance:

- no ranking-invariant regressions
- cleaner route behavior on metadata+body queries

### Phase 2: Passage-First Local Evidence MVP

Deliverables:

- top-N file admission
- query-conditioned local windows or lightweight passages
- best `2-3` explanations per file
- structured local signals

Acceptance:

- visible `top1` lift on `partial_memory`, `mixed_anchor`, and cluttered markdown cases
- no material latency blow-up

### Phase 3: Structured File Fusion

Deliverables:

- staged comparator that combines family-first ordering with best explanation selection
- route-specific metadata anchor tie-breaks

Acceptance:

- fewer cases where the right file appears in `top5` but loses `top1` to a worse local explanation

### Phase 4: Recall Refinement

Deliverables:

- family-scoped expansion gating
- optional compact passage admission sketch if recall is still the ceiling

Acceptance:

- better admission without uncontrolled index growth

### Phase 5: Targeted High-Upside Lanes

Deliverables:

- mixed-script bridge lane
- selective phrase-signature lane

Acceptance:

- these changes must improve the hard families without turning into broad heuristic sprawl

## Keep / Revert Rules

Keep only if:

- primary objective improves
- or objective is effectively preserved while latency or persisted size materially improves

Revert if:

- `hits@1` regresses noticeably
- gains come from a tiny slice while broader hard suites regress
- code complexity rises without a clear benchmark reason
- a change weakens the ranking invariants

## Current Recommendation

The next implementation step should be:

1. rewrite the planner contract
2. add lightweight passage-first local-window evidence
3. add structured file fusion

Do not spend the next cycle on:

- coefficient tuning on the current file-level comparator
- reviving legacy `passage-bm25`
- adding large storage before the local-window MVP has been measured
