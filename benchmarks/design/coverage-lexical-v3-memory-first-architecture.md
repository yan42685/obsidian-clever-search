# Coverage Lexical V3 Memory-First Architecture

Date: 2026-04-14
Status: In Progress
Related:

- `coverage-lexical-real-term-coverage-ranking-v3.md`
- `coverage-lexical-binary-schema-draft.md`
- `coverage-lexical-startup-snapshot-anchor.md`

## Goal

Define the theoretical target architecture for a new
`coverage-lexical-v3/` subtree whose primary optimization target is:

- the smallest high-performance resident index that still supports:
  - V3 ranking worldview
  - future document add/update/delete consistency
  - binary snapshot restore
  - startup self-heal

This document is intentionally not about UI integration, runtime feature
compatibility, or incremental implementation cost. It defines the target shape
that later implementation phases should converge toward.

## Implementation Boundary

V3 is a parallel new subtree and should remain independently evolvable from the
active V2 path.

That means:

- V3 implementation files should live under `src/services/search/coverage-lexical-v3/`
- if a V2 helper or algorithm is worth reusing, copy and adapt it into the V3
  subtree instead of importing V2 runtime modules directly
- common repo-wide utilities may still be shared when they are not encoding V2
  ranking or indexing worldview

The goal is to let V3 iterate as a true successor architecture rather than as a
thin wrapper over V2 internals.

## Core Position

V3 should not be designed as:

- a mutable object graph with later binary persistence bolted on
- a query-time reconstruction system that derives its worldview from flat field
  postings on every request
- a pure one-shot in-memory experiment that later needs a second architecture
  for consistency and restore

V3 should instead be designed as:

> a minimal resident base index plus a small mutable overlay, where snapshot
> format closely mirrors the resident base, and startup heal repairs only the
> delta from current vault state

This gives one architectural center for:

- live search
- future consistency
- future persistence
- future restore
- future repair

## Design Principles

- resident memory is the primary optimization target
- snapshot bytes are secondary and should follow naturally from a binary-friendly
  resident layout
- exact-confirmed evidence is what final ranking trusts
- route-time approximations must stay separate from final packing evidence
- one query unit must resolve to one best realized family per candidate
- body locality must be block-native, not whole-document scan-native
- Han bigram must remain a Han backstop route only
- document-level consistency should be the smallest mutation unit
- query scratch state must stay out of the resident snapshot contract

## Top-Level Architecture

V3 should have four cooperating layers:

1. resident base
2. resident overlay
3. persisted snapshot
4. persisted journal plus startup heal

The intended relationship is:

- resident base is the main read-optimized engine
- resident overlay captures recent document mutations without rewriting the base
- snapshot persists the resident base in a restore-friendly binary layout
- journal captures document-level changes after the last snapshot
- startup heal restores the last clean base, then reapplies or rebuilds only the
  changed documents

## Resident Base

Resident base should be read-only once loaded.

It should contain only the minimum structures required for:

- routing candidates
- confirming exact evidence
- constructing V3 containers
- producing final packing comparisons

The base should be organized into these arenas.

### 1. Doc Arena

The doc arena is the central registry.

Each doc row should contain only:

- `docId`
- `pathStringId`
- `generation`
- `contentFingerprint`
- `identitySummaryOffset`
- `routeSummaryOffset`
- `headingSummaryOffset`
- `bodyBlockStart`
- `bodyBlockCount`

It should not keep:

- resident `bodyText`
- per-field JS collections
- repeated metadata strings
- query-time derived evidence

### 2. Family Lexicon Arena

This is the core lexical identity layer.

It must represent realized families rather than a loose term bag.

The family lexicon is responsible for:

- stable `familyId`
- prefix-expandable family lookup
- exact/prefix family identity
- script and family-class flags
- supporting one-query-unit-one-family decisions

The resident form should be numeric and binary-friendly:

- UTF-8 string arena
- offset and length tables
- family metadata arrays
- prefix range or trie index

This is where V3 avoids repeatedly rebuilding lexical identity from strings at
query time.

### 3. Metadata Container Arena

V3 should store metadata search structure by container tier, not by every
legacy field worldview.

Required resident tiers:

- `identity = basename + alias`
- `route = tag + folder`
- `heading`

The resident structure should support:

- `familyId -> identity doc postings`
- `familyId -> route doc postings`
- either:
  - `familyId -> heading doc postings`
  - or doc-local heading family summaries if that proves smaller overall

Fine-grained field corroboration inside a tier should remain thin:

- basename versus alias
- tag versus folder

This corroboration should not require a second heavyweight field-postings system.

### 4. Body Block Arena

Body evidence must be block-native.

The body block arena should be the resident source for:

- block boundaries
- doc-to-block ownership
- block summaries
- exact-tape offsets

Each block should have only minimal resident metadata:

- `blockId`
- `docId`
- `blockOrdinal`
- `familySummaryOffset`
- `tokenCount`
- `spanLength`
- `exactTapeOffset`
- `hanExactTapeOffset`

Block summaries exist to let V3 shortlist good body-window candidates before
opening exact tapes.

### 5. Exact Tape Arena

The exact tape arena is the final evidence source for body and Han exact
confirmation.

It should contain:

- body family exact tapes for Latin and mixed-script exact confirmation
- Han symbol exact tapes for Han exact confirmation

Exact tapes should be numeric and contiguous:

- no per-token objects
- no repeated strings
- no route-time statistics embedded into the tape

The tape is where V3 confirms final realized evidence before constructing
`BodyWindowContainer`.

### 6. Han Route Arena

Han bigram support belongs in its own route arena.

It must remain separate from:

- family lexicon
- main container construction
- final comparator evidence

The minimum resident Han route structures are:

- `metadataBigramPostingsByTier`
  - `bigramId -> identity doc postings`
  - `bigramId -> route doc postings`
  - `bigramId -> heading doc postings`
- `bodyHanBlockPostings`
  - `bigramId -> blockId postings`
- hooks from block ids into Han exact tapes

Han bigrams should never become final primary ranking evidence.

### 7. Metrics Arena

Resident memory accounting must be first-class from the start.

At minimum, V3 should report:

- `docArenaBytes`
- `stringArenaBytes`
- `familyLexiconBytes`
- `metadataContainerBytes`
- `headingBytes`
- `bodyBlockBytes`
- `exactTapeBytes`
- `hanRouteBytes`
- `overlayBytes`
- `auxiliaryBytes`
- `residentBytes`

This is required to judge whether the architecture is genuinely converging
toward the target resident size.

## Resident Overlay

The resident overlay is the mutation layer.

It exists so that add/update/delete operations do not require rewriting the
entire resident base on every change.

The overlay should contain only document-level deltas:

- added documents
- updated documents
- deleted-document tombstones
- delta family lexicon entries
- delta metadata postings
- delta body blocks
- delta exact tapes
- delta Han route postings

Query-time lookup should read:

- base first
- overlay second
- tombstones as masks over base and older overlay state

The overlay is allowed to be less compact than the base, but only within a
bounded size budget. Once it grows too large, the system should compact it into
a new base snapshot.

## Mutation Model

Document consistency should use document-level replacement, not smaller mutable
units.

### Add

When a new document is indexed, V3 should build the full minimal document unit:

- metadata container entries
- heading summary
- body blocks
- exact tapes
- Han route postings

Then write that unit into the overlay.

### Update

An update should be modeled as:

- tombstone old document version
- append new document version into overlay

The update unit is still the whole document.

This avoids partial in-place mutation of:

- block ownership
- route postings
- exact tapes
- family witnesses

### Delete

Delete should only write a tombstone into the overlay.

Physical removal should wait for compaction.

### Move Or Rename

Rename should still be treated as a document-level mutation, but later
implementations may optimize the unchanged body portion internally.

The architecture should not depend on that optimization to remain correct.

## Persisted Snapshot

The persisted snapshot should mirror the resident base closely.

It should persist:

- doc arena
- string arena
- family lexicon arena
- metadata container arena
- body block arena
- exact tape arena
- Han route arena
- snapshot metadata and checksums

It should not persist:

- query scratch state
- query-time ranking candidates
- temporary gate scores
- exact-confirmed windows for previous queries
- per-query realized-family choices

The snapshot should be the binary form of the resident base, not a second
semantic model.

## Persisted Journal

The journal should be document-level and minimal.

Each entry should be one of:

- `replace`
- `delete`
- `move`

Each journal entry should contain only what is necessary to rebuild the overlay
state for that document:

- path
- generation
- fingerprint
- timestamp
- binary payload for the rebuilt minimal document unit, or enough data to
  rebuild it deterministically

V3 should not depend on replaying a long, deeply semantic journal to become
searchable again.

The journal exists to bridge from the last snapshot to the current overlay, not
to become the primary index store forever.

## Startup Restore And Heal

Startup should work in three modes.

### 1. Clean Restore

If snapshot schema and vault fingerprint are compatible:

- restore resident base directly
- expose search immediately

### 2. Light Heal

If a compatible snapshot exists but only a small set of documents changed:

- restore resident base
- rebuild only changed documents into overlay
- expose search before full compaction

### 3. Hard Heal

If snapshot compatibility fails or drift is too large:

- discard snapshot
- rebuild a fresh base

The architecture must support all three without changing the resident data
model.

## Han Bigram Strategy Inside This Architecture

Han bigram remains a route system only.

It should be handled by these rules:

- derive bigrams only from Han backstop groups
- use metadata bigrams only for cheap doc routing
- use body bigrams only for cheap block routing
- confirm Han final evidence only through Han exact tapes
- do not store Han bigrams as final realized families
- do not let Han bigram gate signals survive into final packing comparison

To keep resident memory minimal:

- use numeric 32-bit bigram ids
- store `bigramId -> docId` or `bigramId -> blockId` postings only
- do not keep resident bigram strings in the hot path
- do not keep both body doc-level and body block-level Han bigram postings
- do not keep a resident per-block bigram mirror after global block postings are
  built unless a separately justified hot query path requires it

## Query-Time Read Path

The theoretical query flow over this architecture is:

1. build query units and Han backstop groups
2. resolve candidate families from the family lexicon
3. collect metadata candidates from identity and route postings
4. collect Han metadata and body-block route candidates from the Han route
   arena
5. shortlist body blocks from block summaries
6. open exact tapes only for top candidate docs and blocks
7. construct:
  - `IdentityContainer`
  - `RouteContainer`
  - `BodyWindowContainer`
  - `HeadingCorroboration`
  - `FragmentationPenalty`
8. apply the V3 packing comparator

The critical boundary is:

- route structures narrow the work
- exact-confirmed structures decide the final ranking

## What Counts As "Necessary Information"

Necessary resident information means:

- enough to route candidates cheaply
- enough to confirm final exact evidence
- enough to assemble V3 containers
- enough to restore the base index without rebuilding semantics from raw vault
  text
- enough to heal a small changed-doc delta

It does not mean:

- preserving every intermediate build artifact
- preserving every query-time debug structure
- preserving duplicated mirrors of the same route information
- preserving route-time approximations after exact evidence exists

## Memory Targets

V3 should be judged by resident structure, not by V8 object-count intuition.

The two primary ratios should be:

- `residentBytes / indexedSurfaceUtf8Bytes`
- `residentBytes / rawMarkdownUtf8Bytes`

Where `indexedSurfaceUtf8Bytes` includes the surfaces V3 actually indexes:

- basename
- alias
- headings
- folder or tag-derived route text
- body text used for exact evidence construction

The desired theoretical direction is:

- resident base close to raw indexed surface size
- overlay bounded and much smaller than base in the common case
- snapshot closely tracking resident base instead of inventing a second bulky
  representation

## Explicit Rejections

V3 should not evolve toward:

- a mutable all-in-one object graph with no clean base/overlay split
- storing final ranking signals directly in the snapshot
- route-time Han bigram statistics as final ranking evidence
- separate incompatible resident and persisted schemas
- per-query reconstruction of container worldview from raw flat postings when a
  compact resident container-ready layout can exist instead
- whole-document body scanning as the default body locality strategy
- mutation logic whose smallest consistent unit is smaller than a document

## Intended Directory Shape

The target `coverage-lexical-v3/` subtree should eventually organize around
this architecture:

- `query/`
- `layout/`
- `segments/`
- `overlay/`
- `snapshot/`
- `journal/`
- `heal/`
- `recall/`
- `ranking/`
- `metrics/`
- `engine.ts`
- `index.ts`

The point of this split is to make the architecture explicit:

- `layout/` defines resident structures
- `segments/` defines immutable base pieces
- `overlay/` defines mutable delta semantics
- `snapshot/` defines binary persistence
- `journal/` defines replayable document mutations
- `heal/` defines restore and repair policy

## Open Questions

These do not change the architectural target, but remain open for later
implementation refinement:

- whether heading corroboration is cheaper as doc-local family sets or as
  tiered postings
- whether body exact tapes should store family ids directly or use a two-step
  local lexicon projection per block
- what overlay size threshold should trigger compaction
- whether journal entries should embed rebuilt binary document payloads or store
  a thinner rebuild recipe
- whether the final binary snapshot should store one monolithic base image or a
  sectioned segment set with per-section checksums

## Implementation Status

### Phase 1

Status: Completed on 2026-04-14

The following Phase 1 baseline is now implemented:

- `coverage-lexical-v3/` resident-base subtree exists with `query/`, `layout/`,
  `build/`, `metrics/`, `engine.ts`, and `index.ts`
- resident base skeleton is buildable from `IndexedDocument[]`
- bytes contract exists and reports:
  - `docArenaBytes`
  - `stringArenaBytes`
  - `familyLexiconBytes`
  - `metadataContainerBytes`
  - `headingBytes`
  - `bodyBlockBytes`
  - `exactTapeBytes`
  - `hanRouteBytes`
  - `auxiliaryBytes`
  - `residentBytes`
  - `indexedSurfaceUtf8Bytes`
  - `rawMarkdownUtf8Bytes`
  - `residentBytes / indexedSurfaceUtf8Bytes`
  - `residentBytes / rawMarkdownUtf8Bytes`
- Phase 1 tests cover empty, Latin, Han, and mixed metadata/body builder cases
- a V3 size-anchor test harness can build the automation corpus and print stable
  resident breakdown output
- Han route remains a resident shell only in this phase; no live Han route read
  path is active yet

Implementation note:

- V3 currently reuses proven V2 ideas only by local copy/adaptation inside the
  V3 subtree, preserving V3 implementation independence from active V2 runtime
  modules

### Phase 2

Status: Completed on 2026-04-14

The following Phase 2 baseline is now implemented:

- `recall/` exists and provides:
  - resident string and posting accessors
  - query-unit family lookup
  - metadata candidate recall
  - body block shortlist recall
- `ranking/` exists and provides:
  - V3 container types
  - V3 packing profile construction
  - late packing comparator
- `engine.ts` now exposes an experimental searchable V3 resident read path for:
  - query analysis
  - family lookup
  - metadata container recall
  - body block shortlist
  - exact tape confirmation
  - final packing comparator ordering
- this read path remains test and experimental only; V3 is still not the
  formal runtime backend

Validation completed for this phase:

- V3 comparator tests pass
- V3 engine smoke tests pass
- Phase 1 resident-base tests and size-anchor tests continue to pass

### Phase 3

Status: Completed on 2026-04-14

The following Phase 3 baseline is now implemented:

- resident `hanRoute` is no longer an empty shell
- V3 query analysis now emits `hanBackstopGroups`
- V3 build now materializes:
  - `metadataBigramPostingsByTier`
  - `bodyHanBlockPostings`
  - body Han exact-tape connection offsets
- V3 recall now uses Han bigram route data to:
  - collect metadata Han doc candidates
  - collect body Han block candidates
  - expose Han gate stats for route-only inspection
- V3 final realized evidence still comes only from confirmed metadata/body
  family text and exact-tape-backed body confirmation

Validation completed for this phase:

- Han route tests pass
- `hanRouteBytes` is now visible in the resident bytes contract
- Han route stats remain outside the final packing comparator world
