# Coverage Lexical Evolution Roadmap

Date: 2026-03-31

## Purpose

This roadmap fixes the execution order for `coverage-lexical` so work does not drift between unrelated tuning, premature serialization work, and benchmark churn.

The program has three co-equal optimization targets:

- search quality
- query latency
- index footprint and startup restore cost

Quality remains the keep-or-revert gate. Time and size are optimization objectives only when quality is preserved or improved.

## Global Metrics

Every retained change should be evaluated against the same four anchors:

- quality:
  - objective
  - top1
  - top3
  - top5
  - zeroRate
  - mrr
- query latency:
  - absolute: avg / p50 / p100
  - primary anchor: `CoverageLexical / MiniSearch` avg, p50, and p100 ratios
- size:
  - absolute: `estimatedIndexBytes`
  - primary anchor: `CoverageLexical / MiniSearch` estimated index size ratio
- startup:
  - snapshot bytes
  - hydrate ms
  - fallback rebuild ms
  - self-heal repair ms

## Current Status

- `Phase 0` is complete:
  - the original pre-compression anchor remains preserved in `benchmarks/coverage-lexical-size-latency-baseline.md`
  - the previous active anchor is `benchmarks/coverage-lexical-size-latency-baseline-phase3-step3.md`
  - the current active anchor is `benchmarks/coverage-lexical-size-latency-baseline-query-hotpath-flattening.md`
  - benchmark logs now report `CoverageLexical / MiniSearch` latency and size ratios directly
- `Phase 1` is the current active optimization slice:
  - maintained query-time document caches landed
  - coarse-result reuse landed
  - lane prefilter guardrail logging landed
  - family and phrase candidate state was flattened
  - char and tag candidate state was flattened
  - signal accumulator construction was flattened
  - local window scoring and candidate dedupe were flattened
  - shared body-evidence tracing now lets passage admission and local window evaluation reuse the same document scan:
    - one pass now builds both admission-side and window-side match traces
    - admission window dedupe is numeric rather than string-keyed
  - latest interpretation for that step:
    - quality stayed clean
    - absolute `CoverageLexical` query time moved down materially
    - `CoverageLexical / MiniSearch` latency ratios were directionally promising but not stable enough across reruns to replace the current active anchor yet
    - keep the code, but do not promote a new benchmark anchor from this step alone
  - the current active anchor shows a material latency improvement while quality remains unchanged
- `Phase 2` has materially advanced:
  - aggregate metadata phrase storage was removed
  - canonical phrase storage landed
  - quality stayed benchmark-clean while the size ratio moved much closer to `MiniSearch`
- `Phase 3` has established the structural foundation:
  - stable `docId` ownership landed
  - same-path reindex now preserves identity while true delete releases ownership
  - size accounting now reports explicit `documentIdentity` bytes so future numeric-postings work can be judged honestly
  - hottest recall buckets now store `docId[]` instead of `Set<string path>`:
    - `bodyPostings`
    - `bodyPhrasePostings`
    - `metadataPostings`
  - the reverse lookup for numeric postings is now array-backed rather than map-backed
  - recall candidate collection now stays canonical-keyed internally and projects back to paths only at the API boundary
  - additional numeric-first posting migration has landed after the Step 3 anchor:
    - field-specific metadata exact postings
    - exact tag postings
    - char bigram postings
  - current benchmark interpretation:
    - quality is unchanged
    - size is still effectively unchanged
    - the latest retained latency gains came from query-time hot-path flattening, not from additional numeric-first posting migration by itself
    - continue numeric migration when it removes a measured hot-path bridge or clearly improves the binary-friendly live layout, not as a latency story by default
- immediate rule:
  - continue from the active roadmap below and keep the benchmark anchor aligned with what actually moved latency or size, not just with structural ambition
  - when an optimization produces structurally cleaner code and lower absolute time but unstable ratio evidence, it may be retained without immediately replacing the active anchor

## Validation Strategy

Use three validation layers, not one oversized benchmark:

1. repo benchmark:
   - keep the existing automation benchmark as the primary quality and ratio anchor
   - this must stay practical for routine development
2. theory-first tuning:
   - for lane budget and prefilter design, prefer theoretical review and conservative rules before adding new stress machinery
   - do not introduce a large synthetic benchmark just to speculate about a future risk
3. local stress verification:
   - only add a large fanout stress harness when changing prefilter budgets, cheap comparators, or lane admission logic materially
   - if such a harness is needed, keep it in a gitignored local directory rather than the main benchmark path

Interpretation rule:

- total vault size is not the primary risk axis
- the primary risk axis is query-time lane fanout:
  - how many similar candidates enter a lane
  - whether the relevant document depends on expensive-only signals to survive

## Phase 0: Freeze The Benchmark Anchor

Goal:

- make later performance and storage work comparable across power modes and local machine drift

Required work:

- keep a single explicitly named active anchor file
- preserve older anchor files when major optimization waves finish
- keep the automation benchmark command stable unless there is an explicit benchmark redesign
- record timing ratios in benchmark output, not just absolute milliseconds
- preserve benchmark corpus size and suite counts unless a benchmark-hardening change is intentional and documented
- when benchmark coverage changes, create a new baseline file instead of silently overwriting the interpretation context

Acceptance:

- one full local benchmark run remains practical for routine development
- relative latency ratios are available directly from benchmark logs
- all future optimization writeups cite the active anchor file

## Phase 1: Remove Query-Time Waste

Goal:

- reduce `CoverageLexical` latency without changing the indexing model yet

Required work:

- move `documentBodyTokensByPath` and `documentTagValuesByPath` out of query-time reconstruction and into maintained engine state
- split lane admission into cheap pruning first, expensive evaluation second
- memoize path-level expensive query-local computations where reused:
  - passage admission signal
  - tag fallback signal
  - any repeated path-level verifier inputs
- avoid double full-signal construction where coarse ranking can use a lighter representation
- keep ranking behavior stable unless a specific bug fix is intentional and benchmark-verified

Files likely involved:

- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `src/services/search/coverage-lexical/coverage-lexical-recall.ts`
- `src/services/search/coverage-lexical/coverage-lexical-admission.ts`

Acceptance:

- no material quality regression against the active anchor
- benchmark total run time decreases
- `CoverageLexical / MiniSearch` avg latency ratio improves materially

Executable checklist:

1. query-time cache hardening
   - keep `documentBodyTokensByPath` and `documentTagValuesByPath` as maintained engine state
   - expand query-local memoization only for repeated expensive path-level work
   - avoid rebuilding document-derived maps inside search paths
   - done when no obvious per-query object-graph reconstruction remains in the hot path
2. cheap-first, expensive-second lane flow
   - preserve the current split between cheap prefiltering and expensive lane evaluation
   - keep debug visibility for:
     - candidate paths
     - prefiltered paths
     - admitted paths
   - do not reduce lane budgets aggressively in this subphase
   - done when every lane still exposes enough debug state to explain recall failures
3. safe reuse of coarse ranking work
   - reuse coarse results for candidates that do not require local window amplification
   - keep expensive re-evaluation only for paths that truly need higher-resolution scoring
   - done when the rerank path does not rebuild full signals for obviously coarse-stable candidates
4. theory-only safety rules before parameter tightening
   - treat `strict_metadata_lane` and `bridge_lane` as lower-risk lanes
   - treat `strict_hybrid_lane`, `relaxed_hybrid_lane`, and `local_body_lane` as higher-risk lanes
   - do not shrink budgets or widen cheap filtering until protective rules exist for high-risk lanes
   - done when future tuning has a written risk split by lane
5. optional local-only stress verification
   - only if future tuning changes budgets or cheap comparators materially
   - if needed, put the harness in a gitignored local directory
   - target lane fanout, not total vault size
   - representative fanout checkpoints:
     - first pressure point: 240 similar candidates
     - medium pressure point: 700 similar candidates
     - high pressure point: 2400 similar candidates
   - done when a proposed budget change has local evidence that relevant paths are not systematically lost before expensive evaluation

## Phase 2: Compress Phrase-Heavy In-Memory Storage

Goal:

- shrink the largest current size buckets while preserving the quality advantage

Required work:

- canonicalize phrase keys so semantically equivalent variants do not expand into unnecessary duplicate storage
- review and likely remove or reduce aggregate `metadataPhrasePostings`
- keep field-specific phrase buckets only when they clearly protect ranking quality
- reduce `bodyPhrasePostings` dependence:
  - prefer using phrase logic as a candidate-strengthening or verifier mechanism
  - avoid paying full index-storage cost for phrase variants that do not move benchmark outcomes
- reduce document-side duplication for phrase references:
  - `bodyPhraseTerms`
  - `metadataPhraseTerms`

Files likely involved:

- `src/services/search/coverage-lexical/coverage-lexical-bridge.ts`
- `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- `src/services/search/coverage-lexical/coverage-lexical-recall.ts`

Acceptance:

- `estimatedIndexBytes` decreases materially vs the active anchor
- `CoverageLexical / MiniSearch` size ratio improves materially
- quality remains benchmark-clean on mixed anchor, mixed-script, and partial-memory slices

Executable checklist:

1. remove duplicate phrase surface area before deleting signal classes
   - canonicalize phrase keys and phrase-signature variants
   - collapse semantically equivalent phrase storage where it does not protect ranking
   - done when duplicate phrase inflation is reduced without changing recall intent
2. shrink aggregate phrase buckets cautiously
   - review aggregate `metadataPhrasePostings` first
   - keep field-specific phrase buckets only when they clearly defend ranking quality
   - done when aggregate phrase storage has a documented reason for each surviving bucket
3. demote phrase storage from broad recall primitive to targeted verifier where possible
   - prefer phrase logic as a strengthening or validation mechanism instead of a wide storage multiplier
   - keep phrase-heavy structures only where benchmark slices show real quality protection
   - done when phrase-heavy buckets have explicit owners and justification
4. reduce document-side duplication
   - review `bodyPhraseTerms`, `metadataPhraseTerms`, and repeated token-held references
   - prefer shared or derived representations over storing equivalent per-document lists twice
   - done when document-side duplication is no longer a top cost center without explanation
5. preserve quality-first slices during compression
   - treat mixed-anchor, mixed-script, and partial-memory behavior as protected slices
   - revert compression that wins bytes but weakens those slices materially
   - done when size wins come without erasing the current quality advantage

## Phase 3: Make The Index Binary-Friendly

Goal:

- redesign the live index layout so the same structure can support fast querying, compact storage, and fast hydration

Required work:

- introduce stable numeric `docId` ownership for indexed files
- replace `Set<string path>` postings with doc-id oriented storage
- migrate high-cardinality postings toward compact arrays or typed-array-backed arenas
- reduce repeated string retention across:
  - document caches
  - postings
  - lexicon references
- unify offsets and posting metadata so serialization does not need a separate object-graph translation layer

Non-goals:

- do not optimize snapshot format first while keeping an overly string-heavy live layout
- do not retain duplicate legacy structures in parallel longer than necessary

Acceptance:

- live index structure can be serialized without rebuilding semantic meaning from scratch
- snapshot bytes and hydrate cost are projected to improve from structure alone
- query behavior remains compatible with the benchmark contract

Executable checklist:

1. assign stable numeric ownership
   - introduce stable `docId` identity for indexed files
   - define the lifecycle for insertion, deletion, and reuse clearly before migrating postings
   - status: complete for the ownership layer
   - done when reindex, delete, and clear all have explicit identity semantics even if postings remain path-keyed temporarily
2. move postings off `Set<string path>`
   - migrate high-cardinality posting buckets toward doc-id arrays or typed-array-backed storage
   - keep lookup semantics stable while changing representation
   - status: partially complete
   - landed first:
     - `bodyPostings`
     - `bodyPhrasePostings`
     - `metadataPostings`
   - landed next:
     - recall-side canonical candidate merging for mixed posting shapes
     - field-specific metadata exact postings
     - exact tag postings
     - char bigram postings
   - still pending:
     - han-segment postings if they become query-relevant
     - phrase-heavy path-keyed buckets that still impose path-side overhead
   - done when the hottest posting buckets are numeric-first rather than string-first and recall no longer needs to bridge two high-cardinality identity representations in the hot path
3. centralize strings
   - create a shared representation for path, basename, folder, tag, and term strings
   - avoid retaining the same strings in multiple high-cardinality structures
   - done when string retention is visibly reduced in the size breakdown
4. avoid dual-layout drift
   - do not keep an old string-heavy graph and a new numeric graph in parallel longer than necessary
   - migrate consumers lane by lane or structure by structure with clear cutovers
   - done when serialization no longer depends on translating two competing layouts
5. keep serialization as an outcome, not the driver
   - structure the live index so it is naturally serializable
   - do not design the snapshot format around today's `Map<string, Set<string>>` graph
   - done when a compact persisted form becomes a direct extension of the live layout

## Phase 4: Snapshot, Hydration, And Startup Self-Heal

Goal:

- make startup fast by loading a persisted index first, then repairing drift in the background

Required work:

- define snapshot versioning and backend compatibility rules
- persist the active `coverage-lexical` index in a binary format
- load the snapshot on startup before attempting a full rebuild
- validate snapshot freshness with a cheap vault fingerprint
- if the snapshot is clean:
  - mark search ready immediately
- if the snapshot is partially stale:
  - allow search with the snapshot
  - queue background self-heal and incremental repair
- if the snapshot is invalid or incompatible:
  - fall back to rebuild safely

Why binary is the intended target:

- avoids JSON parse overhead
- avoids repeated field-name and string inflation in the persisted format
- better matches doc-id and typed-array-based live structures
- reduces startup CPU and GC pressure when restoring the index

Acceptance:

- startup can hydrate from snapshot without requiring a full rebuild in the common case
- snapshot restore is observably faster than rebuilding from source documents
- self-heal can repair drift without breaking search readiness

Executable checklist:

1. define snapshot compatibility up front
   - version the format
   - define invalidation rules
   - define what vault fingerprint is sufficient for trust vs repair
   - done when startup code can reject incompatible snapshots deterministically
2. prefer binary snapshotting
   - persist the binary-friendly live layout directly
   - avoid JSON as the primary long-term restore format
   - done when restore avoids repeated parse and object inflation costs
3. split startup into ready-path and repair-path
   - if snapshot is valid, search becomes ready immediately
   - if snapshot is slightly stale, search stays available while self-heal runs
   - if snapshot is invalid, fall back safely to rebuild
   - done when startup behavior is predictable in all three states
4. make self-heal incremental
   - repair only changed or suspect regions first
   - keep full rebuild as fallback, not default
   - done when common-case vault drift does not force a full rebuild
5. measure startup independently from query benchmark
   - snapshot bytes, hydrate ms, rebuild ms, and repair ms are separate anchors
   - do not fold startup interpretation into the query benchmark alone
   - done when startup performance has its own stable reporting path

## Prefilter Design Rules

These rules should guide all future prefilter tuning, even before local stress verification exists:

1. optimize lane fanout, not total vault size
   - the main risk is large sets of similar lane candidates, not raw file count
2. keep cheap and expensive ranking directionally aligned
   - cheap comparators should mostly rely on signals that the expensive scorer also respects:
     - hard anchor coverage
     - decisive body coverage
     - phrase witness strength
   - avoid over-weighting signals that the expensive scorer may overturn later
3. treat high-risk lanes conservatively
   - `strict_hybrid_lane`
   - `relaxed_hybrid_lane`
   - `local_body_lane`
   - these lanes are the most likely to need wider prefilter buffers because expensive local evidence matters more
4. add protection near the cutoff
   - prefer tie expansion or similar protection when the prefilter cutoff sits inside a dense score band
   - do not hard-cut a large same-score cluster without a safety reason
5. keep strong witnesses above the floor
   - documents with strong exact or near-exact hard-anchor evidence should not be easy victims of cheap truncation
6. only tighten budgets after explicit justification
   - a smaller prefilter budget is not a goal by itself
   - tighten only when:
     - latency benefit is real
     - quality is preserved on the active anchor
     - high-fanout risk has at least theoretical review and, when warranted, local stress verification

## Promotion Rules

Keep a change only if at least one of these is true:

- quality improves
- quality is preserved and latency ratio improves materially
- quality is preserved and size ratio improves materially
- quality is preserved and startup restore cost improves materially

Revert or redesign when:

- a change improves one synthetic family but regresses broader benchmark behavior
- complexity grows while all primary anchors stay flat
- a structural migration is being justified as a latency win even though the measured ratios stayed flat and the real gain came from a different hot path
- a snapshot optimization depends on an inefficient live memory layout staying in place

## Immediate Execution Order

1. maintain the current baseline and keep future benchmark captures comparable
2. treat the query-hotpath-flattening anchor as the active comparison point for future work
3. continue `Phase 1` by removing the remaining measured query-time waste in local window evaluation and verification before expecting more latency benefit from additional posting migration
4. continue `Phase 3` when it directly removes a proven hot-path bridge or makes the live layout more compact and binary-friendly for snapshotting
5. build binary snapshot + startup self-heal on top of the settled Phase 3 live layout
6. only return to prefilter stress verification if a future lane-budget change needs stronger validation

## Working Rule

Do not treat serialization as a separate side project.

The best serialization outcome will come from first making the live index layout compact, numeric, and stable. Once that is true, binary snapshotting becomes a natural extension of the engine instead of an additional translation layer.
