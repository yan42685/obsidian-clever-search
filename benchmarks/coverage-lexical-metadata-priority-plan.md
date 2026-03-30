# Coverage Lexical Metadata Priority Plan

## Goal

Align `coverage-lexical` file ordering with a count-first metadata-aware ranking rule:

1. compare `totalMatchedFamilyCount`
2. if tied, compare metadata distribution first
3. metadata field priority is `basename > aliases > folder > headings > tags`
4. only then compare `bodyMatchedFamilyCount`
5. only after count-level tie, compare detail signals such as exact/prefix/fuzzy, local window, phrase bridge, char, and tail weights

## Constraints

- keep the existing indexing, tokenizer, planner, and recall lane structure for the first pass
- do not overwrite the user's in-progress planner work
- keep benchmark and regression validation as a hard gate
- if benchmark regresses, decide whether the benchmark is incomplete or the change is wrong based on explicit evidence

## Phase 0: Baseline Anchor

- run the coverage lexical benchmark before any implementation change
- run the key coverage lexical regression tests before any implementation change
- record:
  - benchmark command
  - date
  - branch / worktree note
  - key summary metrics
  - representative ranking outputs
- create a human-readable baseline artifact under `benchmarks/`

## Phase 1: Ranking Structure Prep

- add a count-summary layer to `CoverageLexicalFamilySignal`
- keep naming aligned with runtime metadata field names:
  - `basenameMatchedFamilyCount`
  - `aliasesMatchedFamilyCount`
  - `folderMatchedFamilyCount`
  - `headingsMatchedFamilyCount`
  - `tagsMatchedFamilyCount`
- add aggregate counters:
  - `totalMatchedFamilyCount`
  - `metadataMatchedFamilyCount`
  - `bodyMatchedFamilyCount`
- add a single helper for metadata field ownership resolution with fixed priority:
  - `basename > aliases > folder > headings > tags`
- do not change ranking behavior yet

## Phase 2: Build Signal Data

- populate the new count summary inside `buildCoverageSignal(...)`
- count only family-backed matches in the summary
- count rules:
  - family matched in body or metadata counts toward `totalMatchedFamilyCount`
  - family matched in any metadata field counts toward `metadataMatchedFamilyCount`
  - family matched in body counts toward `bodyMatchedFamilyCount`
  - a family can contribute to at most one metadata field counter
- keep phrase / char / tag fallback detail signals outside the count summary unless they map to an explicit family match

## Phase 3: Comparator Tests

- add focused tests that construct signals directly and verify ordering
- cover:
  - metadata beats body details when total count ties
  - metadata field priority ordering
  - body count breaks ties only after metadata count is exhausted
  - exact/prefix/fuzzy and local window only matter after count-level ties
- add regression-style tests for:
  - basename-heavy file lookup queries
  - folder-heavy file lookup queries
  - content-memory queries where strong local body evidence should still win once count-level signals tie

## Phase 4: Final Ranker Switch

- split final result comparison into:
  - global shared count-first prefix comparator
  - route-specific detail comparator
  - fallback score/path tie-breaks
- shared count-first prefix order:
  - `totalMatchedFamilyCount`
  - `metadataMatchedFamilyCount`
  - `basenameMatchedFamilyCount`
  - `aliasesMatchedFamilyCount`
  - `folderMatchedFamilyCount`
  - `headingsMatchedFamilyCount`
  - `tagsMatchedFamilyCount`
  - `bodyMatchedFamilyCount`
- keep route-specific detail comparison only after the shared prefix fully ties

## Phase 5: Coarse Ranking Alignment

- reuse the same shared count-first prefix comparator in the coarse ranking path
- keep local-window budget logic intact for the first pass
- make sure coarse and final ranking share the same top-level ordering worldview

## Phase 6: Regression Validation

- rerun:
  - coverage lexical ranking tests
  - coverage lexical recall suite
  - search-service bootstrap tests
  - coverage lexical benchmark
- inspect representative query outputs and compare with the baseline artifact

## Benchmark Regression Triage

If benchmark worsens after the change:

1. classify the failures by query type
2. determine whether the target file was lost in recall or only demoted in ranking
3. compare benchmark movement against real-query regression tests
4. treat the benchmark as incomplete only if:
   - benchmark regresses mainly on query classes outside the intended product target, and
   - real-query file-lookup regressions clearly improve, and
   - the new comparator tests pass cleanly
5. treat the implementation as faulty if:
   - benchmark and real-query regressions both worsen, or
   - file-lookup queries regress, or
   - count ownership behaves inconsistently, or
   - coarse/final ranking disagree in a way that changes top candidates unexpectedly

## Deliverables

- baseline benchmark artifact
- count-summary signal implementation
- metadata ownership helper
- comparator tests
- final ranker update
- coarse ranking alignment
- post-change benchmark assessment
