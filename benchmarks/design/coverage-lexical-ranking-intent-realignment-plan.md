# Coverage Lexical Ranking Intent Realignment Plan

Date: 2026-04-09
Status: Draft

## Why This Document Exists

The current `coverage-lexical` ranking stack has accumulated two different kinds
of constraints:

1. product-facing intents that match human search expectations
2. implementation-shaped rules that mainly preserve the current route/count
   comparator structure

These have started to drift apart.

Recent discussion exposed a concrete symptom:

- short Chinese and mixed-script queries can surface files that strongly match
  only one side of the query
- the current ranking and display stack can let partial evidence overperform
  because completeness is not modeled as a first-class ranking concept

At the same time, not every "incomplete" result is wrong. Some result classes
must survive even if they do not look like perfect token-by-token coverage:

- basename- and alias-heavy file lookup
- exact local body witnesses
- partial-memory queries
- strong display witnesses that are locally precise

This document defines a new planning baseline:

- keep product intents that feel correct to users
- remove or rewrite constraints that only encode the current implementation
- move toward a unified evidence model where coverage completeness is a
  first-class feature, but not a blunt hard filter

## Relationship To Earlier Documents

This document does not replace:

- `coverage-lexical-unified-evidence-ranking-design.md`
- `coverage-lexical-metadata-priority-plan.md`
- `coverage-lexical-quality-witness-refinement-plan.md`

Instead it narrows the product target before further implementation work.

In particular:

- the `metadata-priority` iteration proved that count-first ordering alone is
  too blunt and can regress `quality_guardrail` and `mixed_anchor`
- the `unified evidence` draft already points in the right direction, but still
  needs a cleaner statement of which user-facing intents are mandatory and which
  historical constraints may be removed

## Primary Decision

Future ranking work should optimize for user-perceived file relevance, not for
preserving the current route-specific count comparator.

Concretely:

- keep or strengthen constraints that protect intuitive result selection
- downgrade or rewrite constraints that only preserve the current
  `body-first` / `body-with-anchor` / `metadata-first` ordering mechanics
- treat "coverage completeness" as a first-class ranking feature inside the
  unified evidence model
- do not turn completeness into a universal hard filter

## Product Intents To Preserve

These are the result-selection behaviors that should remain protected even if
the internal ranking structure changes substantially.

### 1. File Lookup Identity Must Remain Strong

If the user is effectively looking for a file by basename, alias, or path-like
identity, the matching identity note should not be demoted just because another
document has richer body wording.

Representative protected examples:

- `cache restore checklist` should prefer
  `pkm-en/projects/sdk/cache-restore-checklist.md`
  over a body-richer note with weaker file identity evidence
- `old names still resolve through aliases` should still be able to select the
  alias-oriented note rather than a broader rename index

### 2. Exact Local Body Witness Must Beat Broad Topic Pages

When one document contains a compact, exact, high-quality local explanation
window and the competing documents are broader topic pages with looser keyword
coverage, the exact witness page should win.

Representative protected example:

- `config data rollout` should prefer the exact witness note over broader pages
  such as `configmap`, `secret`, or `projected-volumes`

### 3. Partial-Memory Queries Must Remain Solvable

Users often search with fuzzy remembered wording rather than a complete,
well-formed lexical query. The ranking system must not punish these queries for
failing a strict completeness test that the user never intended to satisfy.

Representative protected example:

- `note about restoring cache after warmup failed`

### 4. Strong Local Witnesses Must Survive Display Pruning

Low-count results with strong local evidence should not be removed solely
because they lose a coarse family-count comparison.

Examples of acceptable rescue evidence:

- compact exact local window
- ordered pair evidence
- phrase witness corroboration
- strong display coverage derived from the same evidence model

### 5. Mixed-Script Queries Must Prefer Balanced Relevance

Mixed Chinese-English queries should not reward a document that is strong on
only one script side while effectively ignoring the other. However, this must
be implemented as a balanced coverage preference, not as a simplistic "all
tokens must match" rule.

## Constraints That May Be Removed Or Rewritten

These constraints are not sacred product truths. They mainly preserve the shape
of the current implementation and may be changed if a more intuitive ranking
model replaces them.

### 1. Route-Specific Count Prefix Rules

The following ideas are implementation-shaped and may be rewritten:

- `body-first routes keep body count ahead of metadata distribution`
- `metadata-first routes do not let body witness outrank strong basename and alias evidence`
- `body-with-anchor routes let dominant body witness beat broad metadata pressure`

These rules were useful to stabilize the current comparator, but they should no
longer define the product target by themselves.

### 2. Exact Lane Provenance Requirements

Tests that require the correct candidate to be rescued by a specific late lane
are not product requirements. What matters is:

- the candidate survives into the final relevant set
- the final user-visible ordering is intuitive

The exact lane that rescued it is an implementation detail.

### 3. Family Count As A Primary Source Of Truth

`familyCountSummary` is still useful, but raw count-based prefixes should no
longer be treated as the ranking worldview.

Counts are acceptable as:

- supporting diagnostics
- cheap lower-bound features
- one feature among several in coarse ranking

Counts are not acceptable as the dominant semantic objective.

## Existing Tests: What They Really Protect

This section classifies the most important current tests by intent.

### Keep As Product-Level Guardrails

- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `prefers stronger metadata identity evidence for mixed-anchor queries`
  - protects identity-note selection in mixed-anchor queries
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `prefers exact body witness over broader metadata topic pages`
  - protects exact local witness pages from being buried by broader topic docs
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `uses best local explanation window for partial-memory ties`
  - protects partial-memory query handling
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `prefers basename-heavy file lookup evidence over richer body wording`
  - protects file-lookup identity intent
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `display prune rescues low-count results when strong witness and display coverage stay strong`
  - protects witness-based display survival

### Downgrade To Implementation-Level Regression Tests

- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `body-with-anchor routes let dominant body witness beat broad metadata pressure`
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `metadata-first routes do not let body witness outrank strong basename and alias evidence`
- `tests/src/services/search/coverage-lexical-ranking.test.ts`
  - `body-first routes keep body count ahead of metadata distribution after total-count ties`

These should remain useful during migration, but they should not define the new
ranking objective.

### Keep, But Reframe As Candidate-Survival Tests

- `tests/src/services/search/coverage-lexical-recall-suite.test.ts`
  - `ambiguous anchored queries can still enter later body lanes`
- `tests/src/services/search/coverage-lexical-recall-suite.test.ts`
  - `final union trims weak admitted tail while keeping strong ambiguous candidate`

These are important, but they should be understood as:

- candidate-survival behavior
- union/pruning behavior

rather than final semantic ranking truth.

## New Ranking Objective

The ranking objective should be:

1. prefer results that cover the main query intent more completely
2. among similarly complete results, prefer stronger exact evidence
3. among similarly exact results, prefer stronger local witness quality
4. preserve file-identity intent and partial-memory intent without forcing them
   through a rigid full-coverage requirement

This implies a new design stance:

- completeness must be explicit
- completeness must be weighted by query intent and family importance
- completeness must allow controlled rescue for legitimate cases

## Completeness Should Be Modeled, Not Hard-Coded

The new design should not use a single rule such as:

- "all query terms must match"
- "at least two terms must match"
- "both Chinese and English sides must match exactly once"

Those rules are too blunt.

Instead, each query should derive a `coverageProfile` from query-local family
descriptors.

Suggested components:

- `decisiveCoveredMass`
- `supportCoveredMass`
- `missingDecisiveFamilyCount`
- `missingSupportFamilyCount`
- `crossScriptSatisfied`
- `identityCoverageStrength`
- `bodyWitnessStrength`
- `witnessRescueLevel`
- `weakBridgeOnly`

This allows the system to say:

- "this result is complete enough"
- "this result misses one support family but has strong corroboration"
- "this result only matches one side of a mixed-script query"
- "this result is mostly weak-bridge evidence and should rank lower"

## Layered Architecture Plan

### Planner

Planner should continue building query-local families, but future work should
extend each family descriptor with:

- information weight
- script class
- intent role
- whether the family is decisive, support, or weak

Planner should stop treating raw family count pressure as the main routing
signal.

### Recall

Recall should stay permissive enough to avoid obvious false negatives.

Recall should not become the main place where completeness is enforced.

Recall outputs should instead preserve:

- realized cheap evidence
- unresolved witness potential
- unresolved cross-script rescue potential

### Coarse Ranking

Coarse ranking should share the same worldview as fine ranking:

- lower bound on realized relevance
- upper bound on recoverable relevance after hydration

Candidates should be hydrated if they can still beat the visible cutoff under
the same unified evidence worldview.

### Fine Ranking

Fine ranking should compare a lexicographic tuple that starts with completeness
and only then resolves ties with exactness and witness quality.

Suggested ordering prefix:

1. intent completeness class
2. cross-script satisfaction
3. missing decisive family count
4. decisive covered mass
5. missing support family count
6. support covered mass
7. exact identity/body evidence
8. prefix/fuzzy refinements
9. witness quality
10. weak bridge detail

### Display Prune

Display prune should remain a tail-trimming layer.

It should not be the primary semantic filter for deciding whether a result is
conceptually relevant.

Display prune may still:

- hide weak tail results
- rescue strong witness results

but it should consume the unified evidence outputs rather than invent its own
ranking worldview.

## Benchmark And Test Plan

### 1. Keep The Current Benchmark, But Stop Treating It As The Only Target

The existing automation benchmark remains valuable for continuity and A/B
comparison, but it reflects the old intent mix and old mock-tokenizer
assumptions.

It should become:

- a legacy continuity benchmark
- not the sole gate for the new ranking objective

### 2. Preserve Existing High-Value Query Types

These query types remain aligned with the new product target:

- `coverage_guardrail`
- `quality_guardrail`
- `mixed_anchor`
- `mixed_script_anchor`
- `zh_short_identity`
- `zh_short_body_vs_basename`

### 3. Reframe `partial_memory`

`partial_memory` should remain in benchmark coverage, but it should not
implicitly define the general completeness policy.

It should be treated as:

- an explicit exception-aware query family
- a product requirement for memory-like search
- not a reason to keep permissive ranking everywhere else

### 4. Add New Benchmark Cases

Add explicit adversarial cases for:

- mixed-script query where one candidate is strong only on the English side
- mixed-script query where one candidate is strong only on the Chinese side
- bilingual query where the winning result covers both sides coherently
- short Chinese query where one candidate matches only one real word while
  another covers both real words
- basename-heavy lookup vs body-rich distractor
- partial-memory query where the winner is justified by the best local witness

### 5. Split Benchmark Evaluation Into At Least Two Gates

Recommended gates:

- `intent_guardrail_gate`
  - product-critical result-selection cases
- `legacy_continuity_gate`
  - existing broad benchmark continuity

This prevents implementation-shaped continuity cases from overpowering the
intended product behavior.

### 6. Use Real-Chinese Tokenization Coverage In Addition To Mock Coverage

The automation benchmark currently uses a mock tokenizer that already injects
Han bigram behavior. That is useful, but insufficient for validating
real-world short Chinese ranking behavior.

Add a smaller real-tokenizer regression suite for:

- short Chinese file lookup
- Chinese multi-word queries
- mixed Chinese-English queries

## Migration Plan

### Phase 0: Intent Cleanup

- classify existing ranking and recall tests into:
  - product guardrails
  - implementation regressions
  - candidate-survival tests
- stop using implementation regressions as design invariants

### Phase 1: Signal Expansion

- add completeness-oriented fields to ranking signals
- keep current fields for compatibility during migration
- do not remove existing evidence fields yet

### Phase 2: Comparator Rewrite

- replace the current count-first worldview with a completeness-first unified
  tuple
- preserve route-aware diagnostics, but do not let route-specific count rules
  define the top-level semantics

### Phase 3: Coarse/Fine Alignment

- align coarse ranking with the new objective
- ensure hydration uses unified lower/upper bounds

### Phase 4: Display Alignment

- update display prune to consume the new unified evidence outputs
- keep rescue behavior for strong witness results

### Phase 5: Benchmark Refresh

- create a refreshed benchmark/query set version rather than mutating old
  assumptions in place
- keep historical comparison artifacts

## Implementation Plan

This section translates the migration strategy into an execution order that is
safe for the existing `coverage-lexical` codebase.

### Stage 1: Test And Constraint Reclassification

Goal:

- stop treating historical implementation details as product truth

Actions:

- annotate or rewrite ranking tests so they are clearly grouped into:
  - product guardrails
  - implementation regressions
  - candidate-survival / pruning behavior
- keep current tests temporarily, but mark route/count-shape tests as
  implementation-level protection rather than design invariants
- add a short design note near the tests or benchmark harness explaining which
  cases define product behavior

Primary files:

- `tests/src/services/search/coverage-lexical-ranking.test.ts`
- `tests/src/services/search/coverage-lexical-recall-suite.test.ts`
- `tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`

Exit criteria:

- the test suite clearly distinguishes user-facing intent from implementation
  shape
- future refactors can remove count-first route rules without looking like
  product regressions by default

### Stage 2: Signal Inventory And Coverage Profile Introduction

Goal:

- introduce completeness-aware ranking features without deleting existing
  signals yet

Actions:

- add a new signal payload, tentatively `coverageProfile`, to the
  `CoverageLexicalFamilySignal` build path
- compute query-local completeness-oriented values such as:
  - decisive covered mass
  - support covered mass
  - missing decisive family count
  - missing support family count
  - cross-script satisfaction
  - identity coverage strength
  - body witness strength
  - weak-bridge-only flags
- keep `familyCountSummary` and existing evidence fields for compatibility
  during migration

Primary files:

- `src/services/search/coverage-lexical/coverage-lexical-types.ts`
- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `src/services/search/coverage-lexical/coverage-lexical-evidence.ts`
- `src/services/search/coverage-lexical/coverage-lexical-families.ts`
- `src/services/search/coverage-lexical/coverage-lexical-planner.ts`

Exit criteria:

- every ranked result exposes both old-style evidence and the new completeness
  profile
- no ranking semantics have to change yet for this stage to land

### Stage 3: Comparator Rewrite Under Compatibility Cover

Goal:

- switch final result ordering from count-first to completeness-first

Actions:

- rewrite the top-level rank comparator to prefer:
  - intent completeness class
  - cross-script satisfaction
  - decisive coverage
  - support coverage
  - exact identity/body evidence
  - witness quality
  - weak bridge detail
- keep route-aware diagnostics if useful, but remove route/count prefixes as the
  main semantic source of truth
- update ranking tests to assert intuitive outcomes instead of count-prefix
  internals

Primary files:

- `src/services/search/coverage-lexical/coverage-lexical-ranker.ts`
- `tests/src/services/search/coverage-lexical-ranking.test.ts`

Exit criteria:

- product guardrail tests pass
- route/count-specific tests that no longer match the new worldview are either
  rewritten or downgraded

### Stage 4: Coarse/Fine Alignment

Goal:

- ensure coarse ranking and hydration do not contradict final ranking semantics

Actions:

- move coarse ordering toward the same completeness-aware objective used by the
  final comparator
- express hydration in terms of unified lower/upper bounds rather than old
  count-centric heuristics
- preserve quality-first hydration for candidates that still have realistic
  rescue potential

Primary files:

- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `src/services/search/coverage-lexical/coverage-lexical-recall.ts`
- `src/services/search/coverage-lexical/coverage-lexical-admission.ts`

Exit criteria:

- coarse top candidates no longer diverge systematically from final ranking
- mixed-script and short-Chinese candidates with real rescue potential still
  survive to hydration

### Stage 5: Display Prune Simplification

Goal:

- reduce display prune to a tail-management layer

Actions:

- keep pruning and rescue behavior
- stop using display prune as the main semantic backstop for relevance
- derive display coverage from the new evidence model instead of maintaining a
  separate worldview

Primary files:

- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `tests/src/services/search/coverage-lexical-ranking.test.ts`

Exit criteria:

- display prune trims weak tails
- display prune does not decide the core semantic ordering of the top results

### Stage 6: Benchmark Refresh And Gate Split

Goal:

- validate the new objective without being trapped by legacy benchmark shape

Actions:

- keep the current benchmark as a continuity anchor
- add or version a refreshed benchmark/query-case set with stronger coverage of:
  - mixed-script one-sided distractors
  - short Chinese real-word coverage conflicts
  - basename-heavy file lookup vs body-rich distractors
  - partial-memory witness selection
- report benchmark status in at least two sections:
  - product guardrail gate
  - legacy continuity gate

Primary files:

- `tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts`
- `benchmarks/README.md`
- `benchmarks/design/` follow-up assessments

Exit criteria:

- benchmark reporting makes it clear whether a change hurt product intent,
  continuity, or only implementation-specific cases

## Suggested Work Breakdown By Pull Request

Recommended PR slicing:

1. test and benchmark intent cleanup
2. signal expansion with `coverageProfile`
3. final comparator rewrite
4. coarse/fine alignment
5. display prune alignment
6. benchmark refresh and follow-up assessment

This ordering keeps each step reviewable and makes benchmark deltas easier to
interpret.

## Cleanup Strategy For Old Coverage-Engine Code

Do not start with a broad deletion pass before the new ranking path lands.

There are three different cleanup categories, and they should be handled
differently.

### Category A: Clearly Unused Or Unreferenced Code

Examples:

- dead helper functions with no call sites
- stale intermediate comparators that are no longer imported
- obsolete debug-only fragments with no runtime path

These can be removed early, but only after:

- reference checks
- test confirmation
- ensuring they are not kept intentionally for pending migration stages

### Category B: Compatibility Scaffolding Still Supporting Migration

Examples:

- old count-summary fields that remain needed while the new comparator rolls out
- route-specific diagnostics still useful for debugging
- transitional score fields consumed by tests or benchmark reporting

These should not be removed until after:

- the new comparator is live
- product guardrail tests are stable
- benchmark reporting has moved to the new worldview

### Category C: Legacy Design Shims Whose Value Is Unclear

Examples:

- old rescue heuristics that may still cover real edge cases
- fallback branches whose original motivation is no longer obvious
- compatibility branches retained during earlier ranking rewrites

These should be audited, not mass-deleted.

Recommended process:

1. inventory the symbol
2. identify call sites
3. map it to one of the preserved product intents
4. remove it only if it protects no still-valid intent

## Recommendation On Sub-Agent Use For Cleanup

A sub-agent can be useful, but not as the first step.

Recommended order:

1. finish the intent cleanup and implementation plan
2. land the new ranking signal/comparator work
3. then run a focused cleanup audit over `coverage-lexical`

Why:

- many apparently redundant helpers are only redundant relative to the current
  unfinished migration state
- deleting them too early risks removing diagnostic scaffolding needed during
  the ranking rewrite
- a cleanup pass is most effective after the new design has replaced the old
  route/count worldview

The best later use of a sub-agent would be:

- a read-heavy inventory task that classifies old helpers into:
  - safe to delete now
  - migration scaffolding
  - uncertain, needs manual review

That is a good parallel subtask once the main ranking direction is stable.

## Initial Cleanup Audit Snapshot (2026-04-09)

A focused read-only cleanup audit over `src/services/search/coverage-lexical/**`
has now been run. The result supports the original recommendation: most
old-looking logic is still active migration scaffolding, not dead code.

### Safe To Delete Now

These are the only low-risk function-level deletions identified so far:

- `compareCoverageLexicalTerms` in
  `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
  - no call sites found in `src/**` or `tests/**`
- `compareCoverageLexicalFamilyCountSummaries` in
  `src/services/search/coverage-lexical/coverage-lexical-ranker.ts`
  - export exists, but no imports or call sites found in `src/**` or `tests/**`

### Migration Scaffolding Still In Active Use

These remain live and should not be removed before the completeness-first
ranking path lands:

- `CoverageLexicalFamilyCountSummary` and the related count-first ranking chain
  in `coverage-lexical-types.ts` and `coverage-lexical-ranker.ts`
- `compareMetadataAssistCountOverride` and `compareEarlyBodyQualityGuardrails`
  in `coverage-lexical-ranker.ts`
- `pruneWeakCoverageLexicalDisplayResults` and its helper display-floor logic in
  `coverage-lexical-engine.ts`
- relaxed-lane gating helpers such as `shouldRunRelaxedHybridLane`,
  `shouldRunLocalBodyLane`, `buildLaneEvidenceProfile`, and
  `buildCheapLaneEvidenceProfile` in `coverage-lexical-recall.ts`
- `CoverageLexicalBodyTokenColdStore` in
  `coverage-lexical-body-token-cold-store.ts`

### Uncertain Manual Review

These areas look overgrown or legacy-heavy, but they still protect active
runtime behavior and need the new ranking worldview before safe removal:

- `acceptsLaneCandidate` and the lane-threshold matrix in
  `coverage-lexical-recall.ts`
- route-specific detail stages in `coverage-lexical-ranker.ts`, including
  `compareMetadataFirstDetailStages`, `compareBodyWithAnchorDetailStages`, and
  `compareBodyFirstDetailStages`
- char fallback and Han bridge logic in `coverage-lexical-cjk.ts`
- snippet-occurrence heuristics in
  `src/services/search/coverage-lexical/direct-subitems/occurrence-structure.ts`

### Practical Conclusion

There is still no whole runtime file in `coverage-lexical/**` that is clearly
safe to delete immediately.

The recommended cleanup order remains:

1. remove the two low-risk unused helpers above
2. land the completeness-first ranking rewrite
3. then simplify count-prefix, lane-pressure, and display-floor scaffolding
4. only after that, re-audit the remaining legacy heuristics

## Explicit Non-Goals

This plan does not require:

- introducing semantic embeddings into lexical ranking
- increasing recall lanes
- forcing all mixed-script results to match all scripts absolutely
- deleting partial-memory support
- preserving old route/count comparator behavior just because tests exist

## Proposed Acceptance Criteria

The new design is acceptable when all of the following are true:

1. product guardrail tests pass
2. the new comparator no longer depends on count-first route prefixes as the
   top-level worldview
3. mixed-script and short-Chinese regressions are improved or at least made
   explicitly measurable
4. partial-memory handling still works
5. display prune only trims tails and no longer acts as the main semantic
   relevance filter
6. benchmark triage clearly separates:
   - product-target regressions
   - legacy continuity regressions
   - implementation-only regressions

## Current Recommendation

Proceed with ranking redesign under this document's intent model.

Do not start with a narrow Chinese-specific filter.

Do not start with another standalone count-threshold tweak.

Start by cleaning up the design target, then migrate the ranking stack toward a
completeness-aware unified evidence model that preserves file lookup,
exact-witness, mixed-script, and partial-memory behavior simultaneously.
