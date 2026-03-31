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

## Phase 0: Freeze The Benchmark Anchor

Goal:

- make later performance and storage work comparable across power modes and local machine drift

Required work:

- keep `benchmarks/coverage-lexical-size-latency-baseline.md` as the active anchor
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

## Promotion Rules

Keep a change only if at least one of these is true:

- quality improves
- quality is preserved and latency ratio improves materially
- quality is preserved and size ratio improves materially
- quality is preserved and startup restore cost improves materially

Revert or redesign when:

- a change improves one synthetic family but regresses broader benchmark behavior
- complexity grows while all primary anchors stay flat
- a snapshot optimization depends on an inefficient live memory layout staying in place

## Immediate Execution Order

1. maintain the current baseline and keep future benchmark captures comparable
2. complete Phase 1 query-time waste removal
3. attack Phase 2 phrase-heavy storage inflation
4. design and implement the Phase 3 binary-friendly live layout
5. build Phase 4 snapshot + startup self-heal on top of that layout

## Working Rule

Do not treat serialization as a separate side project.

The best serialization outcome will come from first making the live index layout compact, numeric, and stable. Once that is true, binary snapshotting becomes a natural extension of the engine instead of an additional translation layer.
