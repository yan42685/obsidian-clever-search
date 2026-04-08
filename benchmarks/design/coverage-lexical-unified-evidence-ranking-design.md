# Coverage Lexical Unified Evidence Ranking Design

Date: 2026-04-08
Status: Draft

## Goal

Replace the current count-first ranking worldview with a unified evidence algebra that:

1. preserves the hard product constraints:
   - `coverage first`
   - `exact > prefix > fuzzy`
   - recall and ranking quality are the keep-or-revert gate
2. fixes the current body-versus-metadata asymmetry for short Chinese queries
3. keeps recall, coarse ranking, fine ranking, and display on one shared semantic model
4. avoids obvious search-speed regressions and validates the result with the coverage benchmark

## Problem Statement

The current implementation has a structural mismatch:

- token-level body matches can contribute directly to `familyCountSummary`
- token-level metadata matches can contribute directly to `familyCountSummary`
- char fallback matches are stored separately in `bodyChar` / `metadataChar`
- char fallback does not participate in the same family-level ownership model

This creates a visible asymmetry:

- a short Han fragment can count as a full body family
- the analogous metadata evidence may only appear as `metadataChar`
- the ranker compares `totalMatchedFamilyCount` before the char signals

For short Chinese file-lookup queries, this can produce unintuitive outcomes:

- a body document with one extra weak fragment outranks a stronger basename match
- metadata char evidence highlights correctly in the UI but does not receive equivalent family-level treatment
- planner routing can drift toward `metadata_only_anchored` or away from it based on raw token counts that do not reflect human intuition

## Hard Invariants

The new design must satisfy all of the following:

1. coverage first:
   - broader coverage of meaningful query families beats narrower coverage
2. exact before prefix before fuzzy:
   - once meaningful coverage ties, stronger lexical evidence wins
3. weak evidence may help, but cannot easily overturn strong evidence:
   - char bridge, Han single-character fragments, and fuzzy evidence are supportive, not dominant
4. metadata and body must obey one family-level promotion rule:
   - no more "body counts as a family, metadata does not" asymmetry for the same effective evidence class
5. coarse and fine ranking must share one ordering worldview:
   - coarse ranking may use an upper bound, but must not use a different semantic objective
6. display score must be derived from the same evidence model:
   - the UI score may be normalized, but it must not contradict the real ranking semantics

## Non-Goals

This design does not introduce:

- new semantic or embedding-based ranking
- new recall lanes
- full-vault substring scans in the hot path
- new resident unigram indexes solely for Han single-character matching
- a single opaque scalar score as the primary ranking source of truth

## Core Idea

The current system treats too many query families as equivalent "1 vote".

The replacement model uses:

- family-level information weight
- family tiering:
  - `decisive`
  - `support`
  - `weak`
- evidence class:
  - `exact`
  - `prefix`
  - `fuzzy`
  - `witness`
  - `weakBridge`
- evidence channel:
  - `identity`
  - `body`

The ranker then compares a lexicographic tuple of weighted masses instead of a raw count summary.

This preserves `coverage first`, preserves `exact > prefix > fuzzy`, and prevents weak Han fragments from overpowering stronger file-identity evidence.

## Family Descriptor

Every query family gets a query-local descriptor:

- `familyWeight`
- `familyTier`
- `scriptClass`
- `combinedExactDocCount`
- `bodyExactDocCount`
- `metadataExactDocCount`
- `weaknessFlags`

This descriptor is computed once per query and reused by recall, coarse ranking, fine ranking, and display scoring.

### Script Class

Each family is classified into one of:

- `han`
- `latin`
- `mixed`
- `other`

`mixed` uses the stronger of the Han and Latin length curves so mixed-script anchors are not penalized just because their scripts differ.

## Family Weight Formula

### 1. Script-Aware Length Weight

Chinese and English should not share one linear length rule.

Use a script-aware saturating curve:

```text
hanLenMass(f) =
  1 - exp(-0.90 * max(hanCharCount(f) - 1, 0))

latinLenMass(f) =
  1 - exp(-0.28 * max(latinCharCount(f) - 2, 0))

lengthMass(f) =
  if scriptClass(f) == han:
    hanLenMass(f)
  else if scriptClass(f) == latin:
    latinLenMass(f)
  else:
    max(hanLenMass(f), latinLenMass(f))

lengthWeight(f) =
  0.35 + 0.65 * lengthMass(f)
```

Interpretation:

- Han two-character words already carry meaningful weight
- Han single characters are intentionally weak
- short English words are weaker unless rarity rescues them
- long English tokens saturate rather than growing linearly forever

### 2. Rarity Weight

Use a query-local rarity term derived from the current exact postings:

```text
rarityWeight(f) =
  clamp(
    0.85 + 0.25 * log2((N + 8) / (combinedExactDocCount(f) + 8)),
    0.80,
    1.25
  )
```

Where:

- `N` is document count
- `combinedExactDocCount` is the approximate union of body and metadata exact document frequency

This rewards terms that are more discriminative without turning rarity into a runaway multiplier.

### 3. Weak Token Penalty

Use a hard penalty for token shapes that humans do not usually experience as standalone intent anchors:

```text
weakTokenPenalty(f) =
  if hanCharCount(f) == 1:
    0.35
  else if scriptClass(f) == latin and latinCharCount(f) <= 2:
    0.55
  else if isStructuralOrExplicitlyWeak(f):
    0.45
  else:
    1.00
```

### 4. Final Family Weight

```text
familyWeight(f) =
  clamp(
    lengthWeight(f) * rarityWeight(f) * weakTokenPenalty(f),
    0.18,
    1.35
  )
```

## Family Tiering

The family tier is used to enforce `coverage first` without letting weak tokens dominate.

Initial thresholds:

```text
if hanCharCount(f) == 1:
  familyTier = weak
else if familyWeight(f) >= 0.72:
  familyTier = decisive
else if familyWeight(f) >= 0.45:
  familyTier = support
else:
  familyTier = weak
```

Notes:

- Han single characters never become `decisive`
- a short but meaningful Han bigram can still become `decisive`
- most short English helper words remain `support` or `weak`

## Evidence Classes

For each document and each family, keep the best realized evidence class:

- `exactIdentity`
- `exactBody`
- `prefixIdentity`
- `prefixBody`
- `fuzzyIdentity`
- `fuzzyBody`
- `witness`
- `weakBridge`
- `none`

### Identity Field Confidence

Identity evidence is not all equal. Use stable field confidence multipliers:

```text
basename = 1.00
aliases  = 0.95
headings = 0.88
folder   = 0.80
tags     = 0.70
```

These multipliers are only used inside the corresponding identity mass bucket. They do not replace the higher-level lexicographic ordering.

### Weak Bridge Rules

`weakBridge` covers:

- metadata char fallback
- body char fallback
- any optional future bounded substring bridge for top coarse candidates

Weak bridge does not count as full family coverage by default.

### Family Promotion Symmetry

Metadata and body must follow the same promotion rules:

1. Han single characters never promote above `weakBridge`
2. char-backed evidence may promote from `weakBridge` to `support` only if:
   - the family is not a Han single character, and
   - char segment coverage ratio is high enough, and
   - the evidence is corroborated by another signal:
     - identity field preference, or
     - phrase witness, or
     - local-window witness
3. the promotion rule is channel-symmetric:
   - body and metadata use the same family-level promotion thresholds
   - channel only changes field confidence, not promotion eligibility

This removes the current bug-shaped asymmetry where body can effectively count as a family while analogous metadata evidence cannot.

## Unified Evidence Algebra

Do not rank by one blended scalar. Rank by a lexicographic tuple.

### Realized Ranking Tuple

```text
R(d) = (
  decisiveCoveredMass,
  decisiveExactIdentityMass,
  decisiveExactBodyMass,
  decisivePrefixIdentityMass,
  decisivePrefixBodyMass,
  decisiveFuzzyIdentityMass,
  decisiveFuzzyBodyMass,
  supportCoveredMass,
  supportExactIdentityMass,
  supportExactBodyMass,
  supportPrefixIdentityMass,
  supportPrefixBodyMass,
  supportFuzzyIdentityMass,
  supportFuzzyBodyMass,
  witnessMass,
  weakBridgeMass
)
```

Where:

- `coveredMass` includes only family-backed `exact/prefix/fuzzy` evidence
- `witnessMass` includes phrase and local-window corroboration that improves confidence but does not invent new family coverage on its own
- `weakBridgeMass` includes char-backed and similar weak evidence

Mass accumulation:

```text
mass contribution = familyWeight(f) * fieldConfidence * confidenceModifier
```

`confidenceModifier` is:

- `1.00` for exact family-backed matches
- `0.92` for prefix family-backed matches
- `0.72` for fuzzy family-backed matches
- `0.60 .. 0.95` for witness depending on witness quality
- `0.20 .. 0.45` for weakBridge depending on bridge confidence

The exact numeric range is secondary. The primary ordering guarantee comes from tuple position, not from fine-grained multiplier tuning.

### Why This Preserves The Product Constraints

- `coverage first`
  - because `decisiveCoveredMass` and `supportCoveredMass` are compared before their quality refinements
- `exact > prefix > fuzzy`
  - because exact buckets are compared before prefix buckets, and prefix before fuzzy
- "weak evidence can help but not dominate"
  - because `witnessMass` and `weakBridgeMass` are compared only after the family-backed buckets

## Recall, Coarse Ranking, Fine Ranking, And Display

All four layers should share the same evidence algebra, but not the same computation cost.

### Recall

Recall should use the same family descriptor and promotion semantics, but only a cheap potential view:

- exact postings
- prefix expansion postings
- fuzzy expansion postings
- char bridge candidates
- phrase candidate markers
- unresolved witness flags

Recall does not compute the full realized tuple.

Recall outputs:

- candidate set
- cheap family-backed evidence
- unresolved upgrade potential

### Coarse Ranking

Coarse ranking must not use a different objective from fine ranking.

It should compute:

- `realizedLowerBound(d)`
- `potentialUpperBound(d)`

The coarse ordering key is:

```text
C(d) = (
  realizedLowerBound(d),
  potentialUpperBound(d)
)
```

In practice:

- sort primarily by `realizedLowerBound`
- break close groups by `potentialUpperBound`
- keep unresolved body witness and char bridge potential visible

### Fine Ranking

Fine ranking computes the full realized tuple `R(d)` after:

- local window
- phrase witness
- final bridge confidence
- exact/prefix surface refinement

The user-visible top results must come from fine ranking, not from pure coarse output.

### Hydration Rule

Do not hydrate only strict ties.

Hydrate every candidate whose upper bound can still beat the current visible cutoff:

```text
hydrate(d) if potentialUpperBound(d) >= visibleCutoffLowerBound
```

This is intentionally quality-first:

- it reduces coarse-stage false eliminations
- it accepts a modest latency cost if necessary

### Display Layer

Display should use the same evidence model, but present a stable normalized score:

```text
displayRaw(d) =
  decisiveExactIdentityMass
  + decisiveExactBodyMass
  + 0.85 * decisivePrefixIdentityMass
  + 0.82 * decisivePrefixBodyMass
  + 0.55 * decisiveFuzzyIdentityMass
  + 0.50 * decisiveFuzzyBodyMass
  + supportExactIdentityMass
  + supportExactBodyMass
  + 0.80 * supportPrefixIdentityMass
  + 0.76 * supportPrefixBodyMass
  + 0.45 * supportFuzzyIdentityMass
  + 0.40 * supportFuzzyBodyMass
  + 0.35 * witnessMass
  + 0.18 * weakBridgeMass

displayScore(d) =
  displayRaw(d) / idealQueryDisplayMass
```

Notes:

- the display score is derived from the same evidence algebra
- the display score is not the source of truth for ranking order
- dev mode may optionally show the bucket breakdown for explainability

## Planner Alignment

Planner routing should use the weighted family descriptor, not raw family count pressure.

Required changes:

- `metadata_only_anchored` must depend on weighted anchor mass, not only raw anchor count
- Han single-character families must not single-handedly push a query toward metadata dominance
- mixed-script queries should use the same family descriptor and route thresholds

Suggested route anchors:

- `weightedAnchorMass`
- `weightedBodyMass`
- `decisiveAnchorMass`
- `supportAnchorMass`

This keeps planner, recall, and ranker on one shared worldview.

## Benchmark Strategy

Do not rewrite the benchmark wholesale.

### Rule 1: Add Before Editing Expectations

First:

- preserve the existing benchmark corpus as a control
- add new targeted cases that expose the current bug class

Only after the new cases exist should we modify old expectations that were implicitly rewarding the old count-first bias.

### Minimal High-Value New Cases

Add a small, high-quality set of difficult cases:

- `zh_short_identity`
  - short Chinese file lookup
  - target wins on basename or alias identity
  - distractor wins only through broad body fragments
- `zh_short_char_bridge`
  - metadata char bridge exists
  - it should help but not dominate
- `zh_single_han_noise`
  - Han single-character evidence exists widely
  - it must not behave like full family coverage
- `zh_short_body_vs_basename`
  - body has multiple support fragments
  - target has one strong identity family
- `zh_coarse_to_fine_rescue`
  - coarse evidence is ambiguous
  - fine witness should recover the correct file
- `zh_mixed_script_identity`
  - mixed Chinese and ASCII lookup
  - must remain stable
- `en_short_prefix_guardrail`
  - protect English short-query behavior from collateral damage

Target size:

- add 8 to 12 new benchmark cases
- add a smaller set of direct regression tests for the same semantics

### New Benchmark Slices

Report at least:

- by script bucket:
  - `han_short`
  - `han_mixed`
  - `latin_short`
- by intent bucket:
  - `identity_lookup`
  - `body_memory`
  - `char_bridge`
- by stage:
  - `coarseTopKRecall`
  - `fineTop1`
  - `coarse_to_fine_miss_rate`

This prevents overall benchmark averages from hiding regressions in the exact problem area we are trying to fix.

## Quality And Performance Policy

Quality is the hard gate. Speed is second.

Retention rule:

1. if recall or ranking quality regresses on the target cases, reject the change
2. if quality clearly improves and latency cost is modest, keep the semantic fix and optimize afterward
3. only reject on speed alone if the latency cost is disproportionate

Initial implementation targets:

- no recall regression in the recall suite
- no unexplained regression in `coverage_invariants`
- improved or equal behavior on the new Chinese short-query slices
- stage-time target:
  - `planning + coarseSignal + coarseSort + finalRank` average increase should ideally stay within `+5%`
- whole benchmark target:
  - average latency ideally within `+8%`
  - p100 ideally within `+12%`

If the quality fix exceeds the target but remains clearly beneficial, retain the semantics and open a follow-up performance pass instead of reverting immediately.

## Rollout Plan

### Phase 0: Baseline And Benchmark Hardening

- freeze a benchmark baseline before implementation
- add the new targeted benchmark cases
- add direct regression tests for:
  - short Chinese identity lookup
  - Han single-character noise
  - metadata char bridge symmetry
  - coarse-to-fine recovery

### Phase 1: Family Descriptor And Symmetry Repair

- extend `CoverageLexicalFamilyProbe`
- add family descriptor construction
- add shared body/metadata weak-bridge promotion rules
- ensure Han single-character behavior is symmetric across body and metadata

### Phase 2: Signal Accumulator Upgrade

- keep the existing signal objects for compatibility
- add the new weighted mass buckets
- keep `familyCountSummary` as a diagnostic field, not the main comparator input

### Phase 3: Coarse Ranking Alignment

- compute lower and upper bound tuples
- change hydration from tie lookahead to upper-bound cutoff admission
- verify no coarse-stage false eliminations on the new difficult cases

### Phase 4: Fine Ranking Switch

- replace the old count-first prefix comparator with the realized tuple comparator
- preserve existing local-window and phrase witness logic, but feed them into the new bucket model

### Phase 5: Planner And Display Alignment

- use weighted anchor/body mass in planner routing
- replace the old display score with normalized display scoring
- optionally expose bucket breakdown in dev mode

### Phase 6: Benchmark Validation And Assessment

- rerun:
  - coverage lexical ranking tests
  - coverage lexical recall suite
  - search-service bootstrap tests
  - coverage lexical benchmark
- write a benchmark assessment artifact under `benchmarks/`

## Files Likely Involved

- `src/services/search/coverage-lexical/coverage-lexical-types.ts`
- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `src/services/search/coverage-lexical/coverage-lexical-ranker.ts`
- `src/services/search/coverage-lexical/coverage-lexical-planner.ts`
- `src/services/search/coverage-lexical/coverage-lexical-recall.ts`
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
- `tests/src/services/search/coverage-lexical-planner.test.ts`
- `tests/src/services/search/coverage-lexical-real-tokenizer.test.ts`
- `tests/src/services/search/coverage-lexical-recall-suite.test.ts`
- `tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`

## Acceptance Checklist

- one shared evidence algebra exists across recall, coarse ranking, fine ranking, and display
- the system preserves `coverage first`
- the system preserves `exact > prefix > fuzzy`
- Han single-character evidence no longer behaves like a dominant family
- body and metadata weak evidence follow one promotion rule
- coarse ranking and fine ranking share one objective and do not drift semantically
- the coverage benchmark includes targeted Chinese short-query hard cases
- quality is improved or preserved without an obvious latency cliff
