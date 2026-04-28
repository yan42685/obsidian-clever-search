# Coverage Lexical Startup And Snapshot Pre-Binary Anchor

Date: 2026-04-01

## Purpose

- freeze a dedicated startup and persisted-index anchor before more live-layout changes land
- keep startup interpretation separate from the query benchmark so query-speed noise does not hide hydration or rebuild wins
- define the exact benchmark contract now, while live-memory slimming and startup restore work proceed in parallel
- current priority:
  - reduce live in-memory index size
  - reduce time from loading an old index to search-ready
  - do not treat persisted snapshot bytes as a promotion target by themselves

## Relationship To The Active Query Anchor

- active query anchor:
  - `benchmarks/design/coverage-lexical-size-latency-baseline-live-memory-bodytext-offload.md`
- this file is not a replacement for the query anchor
- use both anchors together:
  - query anchor for quality, query-time latency, and structural in-memory size
  - startup anchor for hydrate time, ready-to-search time, rebuild time, and repair time
  - snapshot bytes remain a diagnostic field only

## Current Pre-Snapshot State

- startup mode today:
  - rebuild-only
- persisted snapshot mode today:
  - none
- self-heal mode today:
  - none
- interpretation:
  - the current startup path pays full rebuild cost before search can benefit from the whole index
  - any future snapshot work should compare first against this rebuild-only baseline, not against a moving informal memory of startup behavior

## Corpus Anchor

- keep the same corpus contract as the active query anchor until an explicit startup-benchmark redesign is approved
- current corpus reference:
  - noteCount: 73
  - queryCount: 176
  - docsWithHan: 40
  - docsWithLatinAndHan: 40

## Structural Baseline

- current in-memory structural estimate:
  - `CoverageLexical`: 172.151 KB
- current size ratio reference:
  - `CoverageLexical / MiniSearch`: `2.967`
- current relevant structure reference points:
  - `documentIdentity.total`: 23,868 bytes
  - `bodyTokensById.total`: 19,816 bytes
  - `bodyHanSegmentsById.total`: 1,060 bytes
  - `tagValuesById.total`: 928 bytes
  - `postings.body`: 25,436 bytes
  - `postings.bodyPhrase`: 48,796 bytes
  - `postings.metadata`: 4,696 bytes
- interpretation:
  - this is not the future snapshot size
  - this is the structural live-memory reference for judging whether document-store slimming and later startup work are removing real resident weight
  - snapshot size may move, but live-memory and ready-to-search time are the decision anchors

## Startup Metrics Contract

Every future startup benchmark capture should record the same fields:

- `snapshotBytes`
- `snapshotWriteMs`
- `hydrateMs`
- `readyToSearchMs`
- `fallbackRebuildMs`
- `selfHealRepairMs`
- `repairChangedDocCount`
- `schemaVersion`
- `vaultFingerprintMode`

Recommended reporting shape:

- absolute measurements:
  - hydrate ms
  - ready-to-search ms
  - rebuild ms
  - repair ms
  - write ms
  - snapshot bytes
- relative measurements:
  - `hydrate / rebuild`
  - `readyToSearch / rebuild`
  - `repair / rebuild`
  - `snapshotBytes / estimatedIndexBytes`

Interpretation rule:

- `hydrate / rebuild` and `readyToSearch / rebuild` are primary
- `snapshotBytes / estimatedIndexBytes` is only a sanity check that persistence is not accidentally exploding
- if live-memory drops and hydrate stays fast, we do not block on snapshot-byte micro-optimization

## Benchmark Modes

The startup benchmark should run three distinct modes once binary persistence exists:

1. full rebuild baseline
   - delete or ignore any snapshot
   - measure rebuild-only startup
2. clean snapshot hydrate
   - load a schema-compatible snapshot with a matching vault fingerprint
   - measure hydrate and ready-to-search time
3. stale snapshot self-heal
   - load a snapshot with a small controlled set of changed docs
   - measure ready-to-search time plus background repair time

## Acceptance Gates

- first binary snapshot milestone is only promoted if:
  - query quality remains anchored by the query benchmark
  - startup benchmark shows hydrate is materially faster than rebuild
  - live-memory breakdown shows the intended resident structure actually shrank
  - snapshot bytes are not obviously larger than the equivalent structural estimate without a written reason
- self-heal is only promoted if:
  - startup remains usable before full repair completes
  - the repair path is measurably cheaper than a full rebuild for small vault drift

## Current Anchor State

- Coverage V3 startup/rebuild update:
  - V3 restore dirty tracking now preserves the ready marker for persistent V3 snapshots when runtime file changes mark the snapshot dirty.
  - production V3 rebuild now uses a two-pass segmented streaming builder instead of retaining a full-vault `PreparedDocument[]` in the streaming path.
  - pass 1 collects only global family/source-mask state; pass 2 prepares documents in byte-capped batches and flushes cold evidence chunks.
  - build-scope memoization is bounded and rebuild-local for tokenizer output, Han bigram ids, Han char ids, and witness match keys.
  - adaptive posting build now skips defensive value sorting when posting values are already ascending.
  - startup benchmarks now report rebuild phase timings, batch max raw bytes, diagnostics time, and heap/rss samples.
  - synthetic large-corpus startup benchmark was added for configurable `COVERAGE_LEXICAL_V3_SYNTHETIC_MB` runs.
  - pass1 now uses a family/source-mask-only scanner instead of constructing full body block drafts.
  - pass2 now builds body-block Han witness/bigram/char analysis from one normalized block scan.
  - build-scope memoization now also caches short family occurrence surfaces.
  - pass1 body scan now uses a family-text-only query helper, avoiding exact offsets/support-mask allocation on the lexicon/source-mask pass.
  - startup commit dev diagnostics now run in the background after searchable state is marked, so expensive memory breakdown no longer blocks the commit path.
- latest TestVault V3 startup anchor after segmented rebuild compression:
  - note count: `185`
  - markdown bytes: `851,255`
  - snapshot write ms: `1.386`
  - hydrate ms: `1.625`
  - ready-to-search ms: `1.625`
  - fallback rebuild ms: `2,835.162`
  - rebuild pass1 ms: `952.110`
  - rebuild pass2 ms: `1,610.002`
  - rebuild merge ms: `222.695`
  - diagnostics ms: `141.559`
  - batch max raw text bytes: `859,435`
  - resident index bytes: `1,381,041`
  - persisted V3 bytes: `3,882,176`
  - `hydrate / rebuild`: `0.001`
  - `readyToSearch / rebuild`: `0.001`
  - resident index bytes / markdown bytes: `1.622`
  - persisted V3 bytes / markdown bytes: `4.561`
- first live-memory slimming cut is now landed:
  - `CoverageLexicalDocument` no longer stores resident `bodyText`
  - `getDirectSubItems()` reads body text on demand from `FileSnapshotStore`
  - delete and rebuild keep using doc-id side ownership:
    - `documentBodyTokensById`
    - `documentBodyHanSegmentsById`
    - `documentTagValuesById`
- current startup anchor from three benchmark runs:
  - snapshot bytes: `87,026`
  - snapshot write ms center: `57.866`
  - hydrate ms center: `11.034`
  - rebuild ms center: `40.978`
  - `hydrate / rebuild` center: `0.271`
  - `readyToSearch / rebuild` center: `0.271`
  - `snapshotBytes / estimatedIndexBytes`: `0.494`

## Immediate Next Step

- continue slimming remaining query-cold resident metadata without regressing:
  - coverage benchmark quality
  - query-time ratio anchor
  - startup hydrate ratio
- keep persisted binary encoding work secondary until the live resident layout stabilizes again

## Storage Baseline Diagnostic Update

Updated on 2026-04-24:

- V3 size-anchor output now includes a diagnostic `storageBaseline` payload with:
  - raw markdown bytes
  - resident bytes
  - auxiliary bytes
  - cold-evidence bytes
  - snapshot bytes, currently represented by resident bytes until binary
    snapshot persistence is promoted
  - resident/raw, auxiliary/resident, cold-evidence/resident, and
    snapshot/resident ratios
- this is intentionally a measurement-only addition; persisted Dexie cold-layer
  compression remains out of scope until the live resident/on-demand boundary
  and the binary snapshot contract are stable

## Startup Console Diagnostic Update

Updated on 2026-04-24:

- plugin startup console output for V3 now reports both:
  - hot resident memory:
    - `resident-hot`
    - `auxiliary`
    - `resident-total`
  - cold persisted storage:
    - `artifacts`
    - `registry/meta`
    - `total`
    - slice hints for `snapshot`, `evidence`, `metadata`, and `fuzzy-rescue`
- startup output also now logs a separate `cold-at-query evidence` line so the
  runtime can distinguish:
  - persisted cold storage on disk
  - resident-but-query-cold evidence retained off the hot path
- this keeps the startup console aligned with the V3 size-anchor vocabulary
  instead of showing only the hot-memory half of the picture

## Cold Evidence Slice-First Update

Updated on 2026-04-24:

- V3 rebuild now separates the resident-hot base from canonical Dexie cold
  evidence slices during `buildResidentHotBaseArtifacts(...)`.
- the old full-resident `buildResidentBaseArtifacts(...)` compatibility builder
  has been removed; tests now exercise hot-base and cold-slice paths directly.
- exact tape payload, body family support payload, Han doc witness payload, Han
  body witness payload, and witness-only texts now publish through
  `lexicalBodyEvidence`, `lexicalHanDocEvidence`, and `lexicalHanBodyEvidence`
  rather than being retained as whole resident sidecars.
- startup/runtime memory interpretation should treat those three evidence tables
  as persisted cold storage plus cold-at-query hydration, not as resident-hot or
  resident-total memory.
- the startup snapshot anchor remains pre-binary: the hot resident layout is
  still the proxy for future binary snapshot shape, while the slice tables are
  the canonical persisted evidence boundary.
- persisted fuzzy-rescue rows currently retain string lookup keys matching the
  resident fuzzy lookup map; compact hashed-key persistence is not part of this
  cold evidence slice.

Validation completed for this slice:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-24.
- targeted store/build/hydration/runtime tests pass on 2026-04-24:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `coverage-lexical-v3/file-search-engine.test.ts`.
- `npm run typecheck:test -- --pretty false` remains blocked by existing
  unrelated test type debt outside the V3 cold-evidence slice.

## Chunked Cold Evidence Streaming Update

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

## Production V3 Restore Wiring Update

Status: Completed on 2026-04-28

CoverageLexical V3 now promotes the existing multi-shard snapshot primitives
into the production `CoverageLexicalV3FileSearchEngine` lifecycle:

- `supportsPersistentFileIndex()` is enabled for V3, so `DataManager` uses the
  persistent-index startup branch instead of the legacy serialized snapshot path.
- `restorePersistedFileIndex()` boots from
  `coverageLexicalV3SnapshotManifests`,
  `coverageLexicalV3ResidentShardArtifacts`,
  `coverageLexicalV3ShardRegistry`, and the active overlay journal through
  `bootstrapCoverageLexicalV3Engine(...)`.
- successful restore directly loads the resident index view and reconstructs
  lightweight document views from resident doc tables, avoiding
  `buildResidentHotBaseArtifactsStreaming(...)` on clean startup.
- rebuild persistence now publishes resident shard artifacts, saves the shard
  registry, writes a committed snapshot manifest, and garbage-collects older
  committed manifests.
- persistent recovery compares restored resident doc refs/generations with the
  current vault refs and returns `up_to_date`, `needs_heal`, or
  `needs_full_rebuild` without changing ranking semantics.

Startup benchmark anchor captured on 2026-04-28 with
`npm run benchmark:coverage-lexical:startup`:

- corpus: 89 notes, 190 queries
- snapshot bytes: `48,763`
- snapshot write ms: `2.506`
- hydrate ms: `1.321`
- ready-to-search ms: `1.321`
- fallback rebuild ms: `136.173`
- self-heal repair ms: `0`
- repair changed doc count: `0`
- schema version: `1`
- vault fingerprint mode: `docRef-generation`
- `hydrate / rebuild`: `0.010`
- `readyToSearch / rebuild`: `0.010`
- `snapshotBytes / estimatedIndexBytes`: `1.000`

Quality anchor in the same run remained stable:

- `CoverageLexical(V3)`: objective `0.925`, top1 `0.863`, top3 `1.000`,
  top5 `1.000`, zeroRate `0.000`, mrr `0.923`
- timing anchor: avg `16.512` ms/query, p50 `13.367` ms, p100 `49.493` ms,
  estimated index `736.436` KB

Validation completed for this update:

- `npm test -- --runInBand tests/src/services/search/coverage-lexical-v3/file-search-engine.test.ts` passes on 2026-04-28
- `npx tsc -p tsconfig.build.json --noEmit --pretty false` passes on 2026-04-28
- `npm run benchmark:coverage-lexical` passes on 2026-04-28
- `npm run benchmark:coverage-lexical:startup` passes on 2026-04-28
- `npm run benchmark:coverage-lexical:startup:vault` passes on 2026-04-28
- startup benchmark is isolated in
  `tests/src/services/search/coverage-lexical-v3-startup-benchmark.bench.ts`
  and uses `jest.coverage-lexical-startup-benchmark.config.js`, so query
  benchmark runs remain quality/ranking-only.

Local TestVault startup/index benchmark anchor captured on 2026-04-28 with
`npm run benchmark:coverage-lexical:startup:vault`:

- corpus: 185 Markdown notes from `C:\Users\alex\Documents\Test-Vault`
- total Markdown bytes: `851,243`
- average Markdown bytes: `4,601.314`
- p50 Markdown bytes: `959`
- p95 Markdown bytes: `15,213`
- max Markdown bytes: `93,451`
- tokenizer profile: `production-tokenizer-chinese-patch-jieba-wasm`
- lexical resident runtime:
  - estimated resident index bytes: `1,380,984`
  - docs: `185`
  - families: `24,376`
  - body blocks: `680`
  - shards: `1`
  - top resident groups: hanRoute `560,873`, stringArena `325,552`,
    familyPosting `185,990`, familyLexicon `170,632`
- lexical persisted V3 artifact/cold evidence:
  - total estimated bytes: `3,881,681`
  - resident shard artifact bytes: `1,385,897`
  - snapshot manifest bytes: `418`
  - shard registry bytes: `145`
  - invalidation bytes: `0`
  - cold evidence bytes: `2,478,046`
  - fuzzy rescue bytes: `17,175`
  - body / Han-doc / Han-body evidence rows: `680` / `185` / `680`
- hybrid persisted/runtime state: not included; this benchmark is lexical-only
- snapshot write ms: `3.535`
- hydrate ms: `5.603`
- ready-to-search ms: `5.603`
- fallback rebuild ms: `2,484.709`
- self-heal repair ms: `0`
- repair changed doc count: `0`
- schema version: `1`
- vault fingerprint mode: `docRef-generation`
- `hydrate / rebuild`: `0.002`
- `readyToSearch / rebuild`: `0.002`
- `snapshotWrite / rebuild`: `0.001`
- `residentIndexBytes / markdownBytes`: `1.622`
- `persistedV3Bytes / markdownBytes`: `4.560`

This local vault benchmark is intentionally separate from the fixture startup
anchor. The fixture benchmark remains the stable smoke/regression gate, while
the TestVault benchmark is the local product-performance anchor for restore and
index rebuild speed. It reads local Markdown source text only, excludes plugin
implementation directories and transient worktree/cache directories, and does
not run query quality/ranking assertions. The benchmark now reports lexical
resident runtime, lexical persisted V3 artifact/cold evidence, and hybrid
state as separate sections; hybrid is explicitly marked as not included rather
than folded into the lexical resident estimate. Both startup benchmarks use the
production `Tokenizer` with `ChinesePatch` enabled and the real `jieba-wasm`
node runtime through benchmark-only Jest wiring.

Runtime dev diagnostics now mirrors the same separation for startup logs:

- lexical resident runtime remains the in-memory Coverage V3 resident estimate.
- lexical persisted V3 artifact/cold evidence is reported separately from the
  legacy serialized snapshot field.
- hybrid persisted/runtime state is reported as its own group, with persisted
  table slices and runtime vector/graph estimates when hybrid is enabled.
- the three startup diagnostics groups are emitted even when a persisted group
  is `0 B`, so missing artifacts are visible instead of being silently hidden.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted resident-base and file-search-engine tests pass with chunked cold
  evidence writes on 2026-04-25.

## Canonical Cold Evidence Cleanup Update

Updated on 2026-04-25:

- startup persistence now treats `lexicalBodyEvidence`,
  `lexicalHanDocEvidence`, and `lexicalHanBodyEvidence` as the only canonical
  V3 evidence stores; legacy whole-sidecar Dexie stores have been dropped in
  schema version `28.8`.
- startup/runtime hydration no longer expects Han doc/body witness string-id
  fallback rows or whole-sidecar readers; canonical cold rows now carry only
  stable witness match keys, row-local texts, and compare-domain-ready
  shard-local support/exact slots.
- shard-readiness reporting now names body-family posting terms as
  `shardLocalSlot` semantics so the future snapshot boundary matches the current
  shard-local recall/ranking boundary more explicitly.

Validation completed for this cleanup:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted startup/store/runtime tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/file-search-engine.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `data-manager-lexical-startup-reconcile.test.ts`.

## Slice-Local Cold Storage Compression Update

Status: Updated on 2026-04-25

- persisted cold evidence compression is now in scope only for slice-local binary
  lanes that preserve the existing `docRef + generation` and
  `docRef + generation + blockOrdinal` replacement model.
- `lexicalBodyEvidence`, `lexicalHanDocEvidence`, and `lexicalHanBodyEvidence`
  now persist numeric lanes as typed arrays and skip empty evidence rows.
- this intentionally avoids global cold string pooling or cross-row compression,
  so shard-local merge identity, row-local witness text ownership, and
  incremental rebuild friendliness remain unchanged.
- schema version `28.6` rebuilds V3 cold evidence rows to avoid compatibility
  reads for the older `number[]` storage shape.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted store/hydration/build/runtime tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `coverage-lexical-v3/file-search-engine.test.ts`.

## Cold Evidence Storage Breakdown Update

Status: Updated on 2026-04-25

- startup lexical memory output now reports V3 cold evidence table bytes for
  body, Han-doc, and Han-body slices.
- it also reports payload bytes grouped by exact slots, exact positions, support
  slots, witness keys, witness texts, masks, and offsets.
- this is measurement-only: it keeps the existing typed-array slice rows,
  row-local witness texts, and doc/block replacement keys intact.
- the purpose is to decide whether any later Dexie compact phase should target
  body exact/support lanes, Han witness text, or row overhead, without violating
  shard-local merge constraints.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted startup/store/build/runtime tests pass on 2026-04-25.

## Body Evidence Packed Payload Update

Status: Completed on 2026-04-25

- `lexicalBodyEvidence` now stores exact/support numeric cold evidence as a
  row-local `bodyEvidencePayload` instead of separate Dexie fields.
- the payload uses adaptive unsigned lane widths and remains keyed by
  `docRef + generation + blockOrdinal`, preserving incremental block-slice
  replacement.
- startup cold evidence breakdown continues to report exact slots, exact
  positions, support slots, masks, and offsets by decoding the packed payload
  metadata for diagnostics.
- schema version `28.7` rebuilds V3 cold evidence rows for the packed body
  evidence format.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- targeted store/build/runtime/startup tests pass on 2026-04-25.

### 2026-04-25 Update: Snapshot Boundary Uses ResidentIndexView

- The startup snapshot boundary is now aligned with a multi-shard resident index view instead of a single global resident base object.
- The first runtime shard remains `base-0`, but snapshot-facing metrics and engine state use `ResidentIndexView`/`ResidentShard` so later multi-shard builder, overlay, and compact work can extend the schema without replacing the top-level contract.
- Cold evidence slices remain outside the hot snapshot boundary and continue to be addressed by `docRef + generation` / block slice locators.

## Shard-Owned Cold Evidence Update

Updated on 2026-04-25:

- startup persistence now treats V3 cold evidence as shard-owned state rather
  than globally doc-owned state: doc/block locators, row ids, and persisted
  rows all carry `shardId` plus `shardGeneration`.
- the current runtime still emits only shard `base-0`, but startup-facing
  publish/read/hydrate contracts now match the future multi-shard snapshot and
  compact worldview instead of assuming `docRef` is globally unique.
- candidate identity is now shard-aware all the way through shortlist evidence
  collection; `V3CandidateDocRecall` carries owner metadata even though query
  execution still fans into only one active shard.
- the transient hydrated-evidence handoff between startup/runtime hydration and
  ranking/refine is now keyed by shard-aware candidate identity rather than a
  bare `liveDocSlot`, so later multi-shard fan-out does not need another map-key
  migration.
- ranking scratch state now matches that same contract: Han refine candidate
  lookup and opaque-rescue comparison gates also use shard-aware candidate keys
  instead of bare `liveDocSlot` cross-stage identities.
- the last layout-level whole-sidecar compatibility helpers were removed from
  body-block, exact-tape, and Han-route modules, so the startup boundary no
  longer has a second internal naming surface that contradicts the slice-first
  canonical path.
- the standalone `CoverageLexicalV3Engine` path now also keeps shard-owned
  in-memory cold-evidence rows when it builds a resident index view, so
  production/unit search no longer needs test-local hydration shims to exercise
  canonical cold-evidence assembly.
- the production `engine.ts` search/rank path again applies the
  `c0d42bf4` opaque-rescue second pass directly; this behavior is no longer
  patched back in only from `engine.test.ts`.
- the fuzzy fallback hot helper is now named as resident index data rather than
  a sidecar (`ResidentFuzzyRescueIndex` / `fuzzyRescueIndex`), keeping the
  startup hot boundary terminology aligned with the shard-native resident view.
- schema version `28.9` rebuilds the V3 cold evidence tables with shard-aware
  indexes so restore/self-heal stays rebuild-first and does not reintroduce a
  compatibility read path.

Validation completed for this update:

- `npm run typecheck:build -- --pretty false` passes on 2026-04-25.
- additional shard-aware key cleanup validation passes on 2026-04-25:
  `coverage-lexical-v3/file-search-engine-metadata-highlights.test.ts` and
  `coverage-lexical-v3/file-search-engine-request-flags.test.ts`.
- targeted startup/store/hydration/runtime tests pass on 2026-04-25:
  `file-snapshot-store.test.ts`, `coverage-lexical-v3/evidence-hydration.test.ts`,
  `coverage-lexical-v3/engine.test.ts`,
  `coverage-lexical-v3/file-search-engine.test.ts`,
  `coverage-lexical-v3/resident-base.test.ts`, and
  `data-manager-lexical-startup-reconcile.test.ts`.
  not startup/store ownership or hydration key shape.

## Shard-Native Terminology Update

Updated on 2026-04-26:

- startup and snapshot wording now align to the same shard-native ownership
  contract used by the runtime:
  - `Shard` = ownership, lifecycle, compact, and replace unit
  - `liveDocSlot` / `shardLocalFamilySlot` = shard-local integer identities
  - `Slice` = shard-owned cold evidence chunk
  - `Row` = storage implementation of a slice
- the active startup/runtime execution model is still single-shard (`base-0`);
  this terminology update does not promote multi-shard recall or ranking
  fan-out by itself
- cold evidence stays outside the hot snapshot boundary as shard-owned slices,
  while row ids remain only the persisted keys used to hydrate those locators
- snapshot and self-heal planning should therefore treat shard replacement as
  the future compact unit, not individual slices
- terminology cleanup is intentionally decoupled from query-benchmark scoring:
  this phase stabilizes ownership language and identity boundaries without
  changing ranking gates, opaque rescue, or Han refine behavior
