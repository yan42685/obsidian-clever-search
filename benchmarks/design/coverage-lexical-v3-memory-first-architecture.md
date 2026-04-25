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

- `metadataBigramDocPostings`
  - `bigramId -> doc postings`
- `bodyHanBlockPostings`
  - `bigramId -> blockId postings`
- hooks from block ids into Han exact tapes

Han bigrams should never become final primary ranking evidence.

Tier semantics such as `identity > route > heading` should remain in metadata
families, Han witness families, and final packing/completion. They do not need
to survive as separate resident Han metadata bigram posting tiers.

### 7. Metrics Arena

Resident memory accounting must be first-class from the start.

At minimum, V3 should report:

- `docArenaBytes`
- `stringArenaBytes`
- `familyLexiconBytes`
- `metadataContainerBytes`
- `headingBytes`
- `bodySummaryBytes`
- `bodyBlockBytes`
- `exactTapeBytes`
- `hanRouteBytes`
- `hanRouteMetadataHanPostingsBytes`
- `hanRouteBodyHanPostingsBytes`
- `hanRouteMetadataWitnessBytes`
- `hanRouteBodyWitnessBytes`
- `scaffoldBytes`
- `countBytes`
- `idPayloadBytes`
- `stringPayloadBytes`
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
- allow the resident base to union metadata-tier Han doc postings when the gate
  only needs candidate admission semantics
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

### Phase 4

Status: Completed on 2026-04-15

The following Phase 4 resident-memory baseline is now implemented:

- resident postings now use width-adaptive integer arrays instead of assuming a
  fixed `Uint32Array` contract
- metadata postings, body-summary postings, and Han route postings now use
  sentinel-start layouts instead of `starts + counts + ids`
- metadata Han route postings are now stored as union doc postings:
  - `bigramId -> doc postings`
  - no tier-split resident metadata Han posting sets remain
- family-lexicon metadata flags are now packed into a single byte per family
- resident doc table no longer stores unused basename/folder string id arrays
- resident metrics and runtime breakdown now expose:
  - `bodySummaryBytes`
  - Han route sub-buckets
  - scaffold/count/id/string payload splits
- resident summary now exposes section-level width/encoding descriptors to keep
  the live layout compatible with future width-aware snapshot sections

Validation completed for this phase:

- build typecheck passes
- Coverage V3 resident-base, family-lookup, Han-route, engine, size-anchor,
  direct-subitems, and file-search-engine tests pass
- V3 search semantics remain unchanged across the targeted regression suite

### Phase 5

Status: Completed on 2026-04-15

The following Phase 5 validation-and-schema tail is now implemented:

- V3 now has dedicated lifecycle regression coverage for rebuild-safe resident
  width changes across:
  - `reIndexAll`
  - `addDocuments`
  - `deleteDocuments`
  - `moveDocument`
  - `beginBatchReindex` / `finishBatchReindex`
- V3 now has dedicated ranking-stability regression coverage that compares the
  same query corpus across compact and width-stressed resident layouts
- the binary schema draft now explicitly records:
  - width-aware section metadata
  - sentinel-start section encoding
  - per-section encoding flags
  - future overlay sections being allowed to use different integer widths than
    the base snapshot

Real-vault baseline captured for the post-Phase-4 resident layout:

- resident total: `2.65 MB`
- docs: `185`
- families: `45055`
- bodyBlocks: `3937`
- exactTapeValues: `108675`
- resident groups:
  - `stringArena 872 KB`
  - `hanRoute 847 KB`
  - `bodySummary 344 KB`
  - `exactTapes 212 KB`
  - `metadataContainers 179 KB`
  - `familyLexicon 132 KB`
  - `heading 94.7 KB`
  - `bodyBlocks 34.6 KB`
  - `docArena 3.61 KB`
- Han route groups:
  - `metadataHanPostings 316 KB`
  - `bodyHanPostings 463 KB`
  - `metadataWitness 2.85 KB`
  - `bodyWitness 65.6 KB`
- payload split:
  - `scaffold 1009 KB`
  - `counts 8.77 KB`
  - `ids 1.03 MB`
  - `strings 651 KB`

This baseline confirms that the Phase 4 resident slimming was effective, but
also makes the remaining structural pressure clear:

- witness-only Han text was still inflating `familyCount`
- `bodySummary` was still paying a family-driven scaffold cost
- `stringArena` and body Han postings remained the next major targets, but were
  intentionally left for later work

Validation completed for this phase:

- build typecheck passes
- resident-base, family-lookup, Han-route, engine, size-anchor, lifecycle, and
  ranking-stability tests pass

### Phase 6

Status: Completed on 2026-04-15

The following Phase 6 structural resident shrink is now implemented:

- witness-only Han surfaces no longer participate in the main `familyLexicon`
  id space
- resident Han witness slices now store witness `stringId` values instead of
  main `familyId` values
- ranking completion reads witness text directly from the shared `stringArena`
  rather than routing witness completion through `getFamilyText(...)`
- `opaque_han_confirmed` match realization now uses witness-backed synthetic
  match ids only inside ranking scratch state, so final ranking semantics stay
  unchanged while the resident base stops paying lexicon-wide family costs for
  witness-only text
- `bodySummary` is now sparse:
  - only families that actually appear in block summaries materialize a row
  - the arena now stores `familyIds + postingStarts + blockIds`
  - absent families return empty shortlists by binary lookup instead of forcing
    dense `familyCount`-sized scaffolds

Implementation note:

- after this phase, `familyCount` now means lexical families that participate
  in exact, prefix, metadata, and body-summary evidence
- witness-only Han surface text still lives in the shared `stringArena`, but it
  no longer inflates the main lexical-family universe

Validation completed for this phase:

- build typecheck passes
- witness-split and sparse-body-summary regression tests pass
- existing resident-base, family-lookup, Han-route, engine, and size-anchor
  suites continue to pass

### Phase 7

Status: Completed on 2026-04-16

The following Han-route structural shrink is now implemented:

- metadata Han resident gate is now restricted to `identity + route`
  only:
  - `basename`
  - `aliases`
  - `folder`
  - `tags`
- `heading` Han bigrams no longer participate in resident metadata Han
  postings
- heading corroboration semantics remain unchanged:
  - heading families are still materialized
  - heading witness strings are still materialized
  - `BodyWindowContainer.headingCorroboration` still reads heading-backed
    evidence during ranking
- body Han resident postings now route directly to V3 body blocks instead of
  routing through document-local Han logical blocks
- query-time body Han admission now works in two steps:
  - route cheap Han backstop bigram hits to body blocks
  - confirm the requested Han surface against block-native Han witness text
    before admitting the block into the shortlist
- oversized Han segments no longer need a separate logical-block chunk layer:
  route uses body-block bigrams, while witness confirmation still checks the
  full block-native Han surface text
- body Han no longer reuses the shared metadata Han bigram vocabulary:
  - metadata Han keeps a small shared `identity + route` key space
  - body Han now owns a dedicated sparse `bodyBigramIds -> bodyPostingStarts -> bodyBlockIds`
    route

Implementation note:

- this phase keeps the existing `u32` Han bigram hash
- metadata Han is still treated as a cheap admission gate, not as exact
  evidence
- resident body witness strings remain block-native because ranking and Han
  completion still consume block-level witness text
- resident body Han postings now use a V3-local adaptive codec copied from the
  proven V2 shape, with separate `singleton`, `pair`, `small`, and `delta`
  lanes instead of a single `bodyPostingStarts + bodyBlockIds` scaffold
- query-time body Han recall decodes those adaptive lanes back into the same
  block-id candidate sets, so admission semantics stay unchanged while resident
  scaffold pressure shifts toward per-lane compact encodings
- the earlier logical-block/cold-sidecar version was removed after witness-only
  confirmation proved sufficient; the active body-Han path is now direct
  `bigram -> bodyBlockId -> witness confirm`

Validation completed for this phase:

- Han-route regression coverage now asserts:
  - heading-only Han no longer admits docs through metadata Han gate
  - heading text can still be admitted through body Han when it appears in body
  - body Han route stores direct body-block postings
  - body Han route keeps a body-only sparse bigram vocabulary distinct from the
    metadata/shared Han key space
  - split Han segments do not get falsely confirmed into body shortlist
  - oversized Han segments still admit long-surface queries without false
    negatives
- resident-base, engine, size-anchor, file-search-engine, family-lookup,
  ranking-stability, and reindex-width-transition suites pass

### Runtime Auxiliary Note

Status: Updated on 2026-04-16

The current runtime implementation now includes a resident-only
`fuzzyRescue` auxiliary sidecar for metadata fuzzy fallback:

- it is built alongside the resident base and rebuilt on reindex
- it is not yet part of the snapshot / restore schema
- its current role is strictly query-time fuzzy candidate admission after
  `exact` and `prefix` miss
- its current resident scope is intentionally metadata-only:
  `basename` / `alias` / `folder` / `tag`
- `heading`-only and `body`-only families are excluded from the global fuzzy
  sidecar in the current pass to cut auxiliary resident fanout without changing
  the agreed metadata fuzzy recall boundary

Implementation note:

- the runtime sidecar exists and is accounted under `auxiliaryBytes`, but its
  current footprint is still above the intended first-pass resident-memory
  budget even after the metadata-only pruning pass
- the automation size anchor improved from `auxiliaryBytes = 214,619` to
  `43,007`, which is directionally much better but still around
  `0.49x rawMarkdownUtf8Bytes` and therefore not yet memory-settled
- further compression / packing work is therefore still required before this
  auxiliary structure should be treated as architecturally settled
- repo-wide `npm run typecheck:build` passes again as of 2026-04-16, so this
  phase is now fully validated at the code level

### Runtime Decoupling Milestone

Status: Completed on 2026-04-16

The following runtime-decoupling milestone is now implemented:

- the formal runtime paths under `src/services/` now converge on
  `coverage-lexical-v3` for active lexical runtime integration
- hybrid lexical-lane local block recall no longer imports legacy
  `coverage-lexical/` or `coverage-lexical-v2/` direct-subitems runtime helpers
- `coverage-lexical-v3` now exposes a dedicated hybrid lexical-subitems bridge
  for lexical-lane integration
- the first version of that bridge is intentionally a placeholder that throws a
  stable `V3 hybrid lexical subitems not implemented` error so runtime imports
  are detached before feature parity is completed
- active `DataManager`, `LexicalEngine`, `FileSearchEngine`, and live database
  schema paths no longer register or depend on legacy cold-store / Han sidecar /
  V2 index-store runtime persistence
- the live Dexie schema now upgrades directly by clearing search data and
  letting the current runtime rebuild, instead of preserving a compatibility
  path for legacy lexical persistence
- `coverage-lexical/` and `coverage-lexical-v2/` source directories are still
  retained in-tree as reference assets only; they are no longer intended to be
  part of the formal runtime dependency graph

Implementation note:

- `runtime detached` does not mean `hybrid lexical subitems implemented`
- hybrid lexical-lane prepare is now wired through the V3 bridge, but the bridge
  currently throws by design, so lexical-lane local block recall remains
  intentionally incomplete until a later milestone fills in the V3-backed
  subitems implementation
- database upgrade compatibility was intentionally not preserved in this pass;
  upgrading clears existing search state and relies on rebuild under the active
  V3-centered runtime


### Runtime Singleton Han Route Note

Status: Updated on 2026-04-19

The resident Han-route layout now also carries route-only singleton-char lanes
for the singleton-Han recall path:

- metadata singleton route stores deduped `charId -> docId` postings derived
  only from `basename`, `alias`, `folder`, and `tag`
- body singleton route stores deduped `charId -> blockId` postings derived only
  from block-native Han witness text
- `charId` is the Han Unicode code point stored as `u32`, reusing the Han route
  resident-posting style instead of entering the main family lexicon or exact
  tape world-view
- no extra resident per-doc or per-block singleton-char mirror is retained once
  the postings are built
- `heading` singleton recall remains intentionally unsupported in resident
  layout; heading witness strings still exist only for corroboration / display
  reading paths
- resident metrics now account for the extra singleton-char route lanes, and
  access helpers expose `collectHanMetadataDocIdsByChar(...)` plus
  `collectHanBodyBlockIdsByChar(...)`

### Runtime Live-Doc Slot Convergence Note

Status: Updated on 2026-04-23

The current runtime implementation now closes the main remaining query-hot-path
slot convergence gaps:

- resident body blocks now carry `liveDocSlotByBlockId` as first-class block
  ownership data alongside canonical `docId`
- V3 query scratch state touched in candidate admission and ranking now
  converges on resident-local slots:
  - doc-scoped scratch maps use `liveDocSlot`
  - fuzzy metadata candidate postings use `shardLocalFamilySlot`
- this applies to recall candidate buckets, prefix-fanout guard state, hydrated
  evidence caches, Han rescue metadata/body scoping, and file-search-engine Han
  refine scratch maps
- canonical `docId` / `familyId` identity is still retained where it belongs:
  resident tables, persisted rows, and final result materialization; the change
  here is specifically that query-local hot loops no longer use those canonical
  ids as the primary scratch key space in the affected runtime path

Implementation note:

- the runtime is still intentionally not claiming that every resident structure
  has been renamed away from `docId` / `familyId`
- this milestone is specifically about hot-path convergence and removal of the
  remaining runtime slot-translation tax in the affected V3 query path
- direct `buildResidentBase(...)` construction now also restores the fuzzy
  rescue sidecar onto the returned resident object so direct in-memory builds
  behave like the offloaded runtime path for fuzzy admission

### Cold Evidence Stable-Identity Note

Status: Updated on 2026-04-23

The current implementation also now makes the hot/cold boundary explicit for
the V3 lexical ranking evidence rows:

- resident query-time working sets remain slot-native (`liveDocSlot`,
  `shardLocalFamilySlot`)
- persisted cold evidence is not slot-native; `lexicalBodyEvidence`,
  `lexicalHanDocEvidence`, and `lexicalHanBodyEvidence` now persist and reload
  by `docRef + generation` and `docRef + generation + blockOrdinal`
- `FileSnapshotStore` exposes stable evidence locators at this boundary, while
  `file-search-engine` performs the runtime translation from resident slots and
  block ids into those stable cold identifiers before hydration
- this removes the remaining `docId` / `blockId` dependence from the current
  batch lexical evidence hydrate path without changing the resident slot-native
  hot-loop contract

### Hybrid Bridge And Auxiliary Packing Note

Status: Updated on 2026-04-24

The next runtime usability slice is now implemented through the first unified
hybrid freshness contract:

- the V3 hybrid lexical-subitems bridge no longer throws the placeholder
  `V3 hybrid lexical subitems not implemented` error for non-empty snapshots
- hybrid lexical-lane local block recall can now receive V3 bridge spans for
  exact local lexical evidence without importing legacy `coverage-lexical/` or
  `coverage-lexical-v2/` runtime helpers
- hybrid lexical-lane result materialization now caps the display surface to the
  top `3` files with at most `2` subitems each after global block/display
  ranking, so the UI gets at most six lexical-lane subitems while still allowing
  cross-file block competition before file grouping
- hybrid `FileItem` materialization now marks native subitems ready and carries
  snapshot generation/source through to the item-level freshness fields; shadow
  sources materialize as `stale_grace`, live/indexed sources as `fresh`
- final hybrid result decoration now uses a shared resolver for `fresh`,
  `stale_grace`, and `lexical_only`; dense/rerank fallback results are marked
  `lexical_only` with no per-file stale banner, while `stale_grace` keeps the
  existing embedding-update banner keys
- the bridge remains intentionally conservative: it uses generation-selected
  snapshot text supplied by the caller and only emits local exact spans that can
  be rendered into block candidates
- `fuzzyRescue` postings are now width-adaptive (`Uint16Array` when all
  shard-local family slots fit, otherwise `Uint32Array`) and de-duplicated per
  lookup key before being retained or persisted
- `fuzzyRescue` lookup keys are now retained as stable 32-bit hash keys instead
  of full resident strings; fuzzy lookup still verifies candidates against the
  original family text, so hash collisions can add candidates but do not produce
  unverified fuzzy matches
- V3 size-anchor output now includes a read-only `storageBaseline` section for
  raw markdown, resident, auxiliary, cold-evidence, and snapshot-size ratios;
  this is diagnostic only and does not start persisted-byte compression work

Implementation note:

- local block recall now reads through `FileSnapshotStore.readIndexedTextSnapshots(...)`
  so generation-aligned live, persisted indexed, and matching dirty shadow
  snapshots can be distinguished before V3 bridge rendering; the bridge still
  consumes the snapshot text it is handed and does not independently choose
  among snapshot sources
- dense display candidates now also read snapshot text through
  `FileSnapshotStore.readIndexedTextSnapshots(...)`, so rerank preserves the
  candidate's `snapshotGeneration` and `snapshotSource` instead of treating
  dense snippets as source-less text
- stale-grace subitem hydration now refuses to silently fall back to live text;
  if the requested generation-aligned shadow/indexed snapshot is missing, the
  item is downgraded to `lexical_only`
- persisted fuzzy-rescue rows now use the compact 32-bit hash-key shape directly;
  no legacy string-key restore compatibility is retained in this workstream
- the current storage baseline treats the resident layout as the snapshot proxy
  until a concrete binary snapshot contract is promoted

Validation completed for this slice:

- `npm run typecheck:build` passes on 2026-04-24
- targeted V3 bridge, hybrid local-block-recall, resident-base, and size-anchor
  tests pass on 2026-04-24
- targeted hybrid result-mapper and Han hydration tests pass after aligning the
  Han test with the current doc-evidence-only candidate shape
- targeted local block recall coverage now verifies generation-aligned indexed
  and shadow snapshots propagate `snapshotGeneration` and `snapshotSource` into
  block candidates
- targeted resident-base fuzzy-rescue coverage verifies hash-key lookup and the
  compact key-byte accounting contract
- targeted hybrid freshness, rerank fallback, result-mapper, snapshot ownership,
  local-block-recall, and SearchService shadow-subitem tests pass on 2026-04-24

### Cold Evidence Slice-First Runtime Note

Status: Updated on 2026-04-24

The V3 runtime path now implements the first canonical cold-evidence slice cut
for the memory-compression workstream:

- `CoverageLexicalV3FileSearchEngine` rebuild now calls
  `buildResidentHotBaseArtifacts(...)` instead of publishing whole exact/body
  support/Han witness sidecars out of a full resident base.
- the runtime resident base keeps the recall-hot skeletons: doc table, family
  lexicon, metadata containers, body recall postings, body block ownership, Han
  route postings, and fuzzy rescue only while publishing its auxiliary slice.
- `lexicalBodyEvidence` is now the canonical exact/body-support cold slice for
  ranking hydration; rows carry `exactShardLocalFamilySlots`, token positions,
  `supportShardLocalFamilySlots`, and support masks keyed by
  `docRef + generation + blockOrdinal`.
- `lexicalHanDocEvidence` and `lexicalHanBodyEvidence` are now the canonical Han
  witness slices; rows carry stable witness match keys plus row-local witness
  texts so witness-only strings no longer need to live in the resident string
  arena.
- shortlist hydration reads only requested doc/block locators from the slice
  tables, and the steady-state search path no longer calls whole
  `lexicalExactTapes`, `lexicalBodyFamilySupport`, or `lexicalHanWitness`
  readers.
- the old full-resident `buildResidentBaseArtifacts(...)` compatibility builder
  has been removed; tests now build either the hot resident base or explicit
  cold evidence rows, so whole-sidecar materialization is no longer preserved
  just for fixtures.
- the cold slice identity domain is shard-local for real family evidence and a
  stable witness match key for witness-only evidence, preserving the shard-local
  merge worldview without hydrate-time global remapping.

Validation completed for this slice:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-24.
- targeted store/build/hydration/runtime tests pass on 2026-04-24:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `coverage-lexical-v3/file-search-engine.test.ts`.
- `npm run typecheck:test -- --pretty false` still reports pre-existing unrelated
  test-suite type debt outside this slice, including V2 cold-store Dexie table
  declarations and older hybrid/file-snapshot test typing issues.

### Chunked Cold Evidence Streaming Update

Status: Updated on 2026-04-25

The cold evidence builder is now runtime-streaming instead of only slice-first:

- `buildResidentHotBaseArtifactsStreaming(...)` is the plugin rebuild path and
  accepts a cold evidence sink for body evidence, Han doc evidence, and Han body
  evidence.
- runtime rebuild now flushes cold evidence rows through that sink in bounded
  chunks, defaulting to `128` rows per flush, instead of returning complete
  `bodyEvidenceRows`, `hanDocEvidenceRows`, and `hanBodyEvidenceRows` arrays to
  `FileSearchEngine.rebuildResidentBaseInternal()`.
- the synchronous `buildResidentHotBaseArtifacts(...)` remains for direct unit
  construction and explicit cold-row assertions, while the runtime path is the
  streaming path.
- targeted tests now assert both the builder-level streaming contract and the
  `reIndexAll(...)` runtime chunking behavior, including that whole sidecar
  publishers remain unused.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted resident-base and file-search-engine tests pass with chunked cold
  evidence writes on 2026-04-25.

### Slice-Local Cold Storage Compression Update

Status: Updated on 2026-04-25

The canonical Dexie cold evidence slices now use shard-local, incrementally
replaceable binary lanes without changing ranking semantics:

- numeric cold evidence payloads are persisted as typed-array lanes rather than
  JavaScript `number[]` values: `Uint32Array` for family slots and token/start
  positions, `Int32Array` for stable witness match keys, and `Uint8Array` for
  source/support masks.
- rows remain keyed by `docRef + generation` or
  `docRef + generation + blockOrdinal`, so document/block-level incremental
  replacement and shard-local merge boundaries are unchanged.
- real family evidence still stores shard-local family slots, and witness-only
  evidence still stores stable witness match keys plus row-local texts; no global
  remapping, global string pool, or cross-row compression layer was introduced.
- empty evidence rows are skipped at publish time, reducing Dexie overhead for
  blocks/docs that do not carry exact/support/Han witness payloads.
- database version `28.6` clears and rebuilds V3 cold evidence tables instead of
  attempting to read old `number[]` rows.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted store/hydration/build/runtime tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `coverage-lexical-v3/file-search-engine.test.ts`.

### Canonical Cold Evidence Cleanup Update

Status: Updated on 2026-04-25

The V3 cold-evidence path now uses a single canonical identity and storage shape
across schema, snapshot rows, and ranking hydration:

- database version `28.8` removes legacy whole-sidecar stores
  `lexicalBodyFamilySupport`, `lexicalExactTapes`, and `lexicalHanWitness`.
- `lexicalBodyEvidence` rows no longer carry legacy `exactFamilyIds` or
  `familySupportFamilyIds`; only shard-local exact/support slots plus positions
  and masks remain.
- `lexicalHanDocEvidence` and `lexicalHanBodyEvidence` rows no longer carry
  witness string-id fallback fields; cold Han evidence persists stable witness
  match keys plus row-local texts only.
- ranking hydration no longer falls back from cold rows to resident witness
  string ids or whole-sidecar readers.
- resident shard-readiness reporting now names body-family posting terms as
  `shardLocalSlot` semantics, matching the shard-local compare domain already
  used by recall/ranking.

Validation completed for this cleanup:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted runtime/store/hydration tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/file-search-engine.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `data-manager-lexical-startup-reconcile.test.ts`.

### Cold Evidence Storage Breakdown Update

Status: Updated on 2026-04-25

The runtime startup report now includes a diagnostic-only V3 cold evidence
breakdown that preserves the unified-index shard-local merge worldview:

- storage accounting is split by canonical cold slice table:
  `lexicalBodyEvidence`, `lexicalHanDocEvidence`, and
  `lexicalHanBodyEvidence`.
- field accounting reports exact family slots, exact positions, support slots,
  witness keys, witness texts, masks, and offsets without changing row layout or
  query semantics.
- the diagnostic is table/row-local and does not introduce global compaction,
  global string pooling, or cross-shard identity remapping.
- the breakdown is intended to guide future shard-local compact work: each
  candidate optimization must remain replaceable at doc/block slice granularity
  and keep real-family evidence in shard-local slot space.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted startup/store/build/runtime tests pass on 2026-04-25:
  `data-manager-lexical-startup-reconcile.test.ts`,
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/resident-base.test.ts`, and
  `coverage-lexical-v3/file-search-engine.test.ts`.

### Body Evidence Packed Payload Update

Status: Completed on 2026-04-25

V3 cold body evidence now uses row-local packed binary payloads while preserving
incremental and shard-local merge boundaries:

- `lexicalBodyEvidence` rows persist one `bodyEvidencePayload` instead of
  separate exact/support numeric fields.
- the payload is independently decodable per `docRef + generation + blockOrdinal`
  row, so block-level replacement remains local and does not require global
  compact or cross-row dictionary state.
- unsigned exact/support lanes inside the payload use adaptive row-local width
  (`u8`, `u16`, or `u32`) for family slots, token positions, support slots, and
  masks.
- hydrate decodes the payload back into the existing compare-domain-ready
  snapshot shape before ranking; query semantics and shard-local identity are
  unchanged.
- schema version `28.7` rebuilds V3 cold evidence rows for this packed body
  evidence format.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted store/build/runtime/startup tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/resident-base.test.ts`,
  `coverage-lexical-v3/file-search-engine.test.ts`, and
  `data-manager-lexical-startup-reconcile.test.ts`.

### 2026-04-25 Update: Resident Index View Boundary

- V3 hot resident ownership now has a multi-shard-native outer shape via `ResidentIndexView` and `ResidentShard`.
- Runtime still builds one shard (`base-0`) so query semantics stay unchanged, but the engine no longer keeps a parallel global resident-base state.
- `CoverageLexicalV3Engine` now loads and describes the resident index view as the canonical boundary; callers that need the current hot payload derive it from the active shard.
- Startup memory reporting now includes resident shard count, total resident bytes, largest shard bytes, and average shard bytes so future multi-shard builder work can reuse the same metrics contract.
- This does not implement overlay shards, shard fan-out merge, or compact yet; it establishes the snapshot/metrics boundary so binary snapshot work does not bind to a single global base schema.

### 2026-04-25 Update: Shard-Owned Cold Evidence and Layout Cleanup

- Canonical cold evidence is now shard-owned instead of only doc-owned:
  `LexicalDocEvidenceLocator`, `LexicalBlockEvidenceLocator`, row ids, and the
  three V3 cold evidence tables all carry `shardId` plus `shardGeneration`.
- Database version `28.9` rebuilds `lexicalBodyEvidence`,
  `lexicalHanDocEvidence`, and `lexicalHanBodyEvidence` with shard-aware row
  indexes:
  `[shardId+shardGeneration+docRef+generation]` and
  `[shardId+shardGeneration+docRef+generation+blockOrdinal]`.
- Runtime remains single-shard for now, but the full candidate/evidence path is
  multi-shard-shaped: `V3CandidateDocRecall`, shortlist hydration requests, and
  file-search-engine locator/materializer flow all carry owner
  `base-0` / generation `1`.
- The transient hydrated-evidence map is now also shard-aware instead of
  `liveDocSlot`-only: rank/refine paths address prehydrated evidence by a
  candidate key composed from `shardId + shardGeneration + liveDocSlot`.
- Remaining ranking scratch keys now follow the same owner shape: Han refine
  candidate lookup and opaque-rescue comparison gates no longer use bare
  `liveDocSlot` as the cross-stage key surface.
- The remaining whole-sidecar layout compatibility layer is removed from the
  canonical layout surface: body family support, exact tape, and Han witness
  helper sidecar builders/setters/empty constants no longer exist as separate
  layout APIs.
- `CoverageLexicalV3Engine.buildResidentIndexView(...)` now materializes a
  shard-owned in-memory cold-evidence snapshot for standalone engine usage, so
  the production engine path no longer relies on test-only hydration shims to
  reach canonical body/Han evidence assembly.
- The production `engine.ts` ranking flow now again applies the
  `c0d42bf4` opaque-rescue second-pass gate semantics directly instead of only
  inside tests.
- Internal hot resident naming is also tightened to match the shard-native
  worldview: resident body support lanes now use
  `familySupportShardLocalFamilySlots`, resident Han witness lanes use
  `*WitnessTextIds`, and startup diagnostics report
  `familyLexiconIdentitySlots`.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted startup/store/hydration/runtime tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/file-search-engine.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`,
  `coverage-lexical-v3/engine.test.ts`, and
  `data-manager-lexical-startup-reconcile.test.ts`.
- Hot resident arenas still keep the recall-hot data they truly own, but that
  data is no longer wrapped or described as a parallel whole-sidecar
  compatibility abstraction.
- The last obvious fuzzy fallback naming residue is also removed from the hot
  boundary: `ResidentFuzzyRescueSidecar` / `fuzzyRescueSidecar` are now
  `ResidentFuzzyRescueIndex` / `fuzzyRescueIndex`, matching that this data is a
  resident hot lookup structure rather than a cold compatibility wrapper.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted runtime/store/hydration/startup tests pass on 2026-04-25:
- additional shard-aware key cleanup validation passes on 2026-04-25:
  `coverage-lexical-v3/file-search-engine-metadata-highlights.test.ts` and
  `coverage-lexical-v3/file-search-engine-request-flags.test.ts`.
- targeted runtime/store/hydration/startup tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/file-search-engine.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `data-manager-lexical-startup-reconcile.test.ts`.
- `coverage-lexical-v3/engine.test.ts` still has uncovered behavior drift on
  2026-04-25 after shard-aware cold-row ownership was restored in test-only
  mocks; the remaining failures cluster around Han rescue / singleton-completion
  semantics and are no longer explained by missing cold evidence ownership.
