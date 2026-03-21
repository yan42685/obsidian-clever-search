# Hybrid Search Design

## Summary

This hybrid search pipeline combines:

- BM25 lexical recall
- dense HNSW recall
- Qwen reranking

The current implementation uses small chunks only.

## Product Intent

This hybrid system serves two real user entry paths:

1. Users usually search with `lexicalengine` first for fast exact-term matching.
2. If lexical search fails or is unsatisfying, users switch to hybrid search.
3. Some users also open hybrid search directly.

This means hybrid search is not meant to replace `lexicalengine`.

Instead, hybrid search has two jobs:

- provide semantic recovery when lexical search misses
- remain stable enough for direct hybrid queries that still contain strong lexical anchors

Because of that:

- HNSW is expected to provide most of the net-new value
- hybrid BM25 must still be good enough, but it does not need to be as aggressive as `lexicalengine`
- reranker is the final decision-maker, so first-stage retrieval should optimize candidate coverage first

## Primary Optimization Goal

The main optimization target is no longer first-stage ranking precision.

Because reranking exists, the first stage should optimize:

1. `hybrid-hits@25`
2. `hnsw-only gain@25`
3. candidate noise control

Secondary goals:

4. keep `bm25-hits@25` good enough for direct hybrid queries
5. improve BM25/HNSW complementarity
6. only care about internal candidate ordering when it affects the top-25 cutoff, fallback quality, or noise

In other words:

- rank-inside-top25 is not the main goal
- getting the right chunk into top25 is the main goal

## Benchmarking Policy

Offline benchmark is a guardrail, not the optimization target itself.

The real target is broad real-vault search quality across unknown note collections.

Because of that:

- do not optimize for a single synthetic score in isolation
- prefer changes that improve retrieval mechanisms, not changes that only fit known benchmark cases
- treat benchmark improvements as evidence, not proof

The regression dataset is split into three tiers:

- `core`: stable representative cases for day-to-day regression
- `adversarial`: harder public cases that create stronger `top25` pressure
- `holdout`: hidden-style evaluation cases that are excluded from normal tuning

Practical rule:

- daily tuning should use `core + adversarial`
- holdout should only be used for periodic validation or before promoting a new default
- if a change wins on public suites but loses on holdout, treat that as likely overfitting

Benchmark design priorities:

- make `hits@25` meaningfully harder without exploding runtime
- prefer more realistic query ambiguity over simply inflating corpus size
- add small numbers of high-value adversarial queries instead of large volumes of synthetic noise

## Retrieval Flow

For each query:

1. BM25 returns top 20 chunks
2. HNSW returns top 30 chunks
3. The two lists are deduplicated by chunk id
4. Deduplicated chunks are sent to `qwen3-rerank`
5. The reranker output count is controlled by plugin settings
6. Returned chunks are grouped by file for UI display

The UI groups by file, but the result limit is applied to chunks, not files.

## Recall Budget Status

Current online default:

- BM25 top 20
- HNSW top 30
- hybrid BM25 candidate recall uses plain BM25 scoring without proximity bonus

Current offline benchmark recommendation:

- `direct_hybrid`: BM25 25 + HNSW 25
- `lexical_fallback_like`: BM25 15 + HNSW 35
- `mixed_entry`: BM25 20 + HNSW 30

Why this is promising:

- it preserves the same top-line `union hits@25` as fixed `20/30`
- it slightly lowers candidate noise
- it aligns better with the product intent that fallback-like hybrid queries should lean more on dense recall

Current status:

- this entry-aware budget is benchmark-only for now
- it should not be moved online until real-vault validation confirms the gain is worth the added runtime complexity

Latest offline evidence after adding `daily + holdout + size-sweep`:

- query-aware budgets are not consistently better than fixed `20/30`
- on larger logical corpora, fixed `20/30` with plain BM25 is often as good as or better than entry-aware variants
- the strongest consistent signal is that hybrid first-stage recall should prefer plain BM25 over proximity-boosted BM25

Current practical conclusion:

- do not rush query-aware recall budgets online yet
- first verify whether disabling BM25 proximity inside hybrid improves large-corpus `hits@25` without harming direct hybrid lexical queries

## Semantic Rewrite Query Policy

Semantic rewrite and multi-variant query expansion are currently not part of the main online direction.

Reason:

- offline evidence did not show stable gains
- the extra complexity is not justified by the observed improvement
- strong lexical-anchor queries are easy to hurt
- reranker cannot recover chunks that never enter top25

Current rule:

- keep the original user query as the main retrieval input
- do not prioritize semantic rewrite work unless new evidence shows a clear `hits@25` gain
- spend optimization effort on better dense recall and better chunk representation instead

## Chunk Storage

`hybridChunks` stores only document-facing data:

- `id`
- `filePath`
- `chunkIndex`
- `text`
- `startLine`
- `startCol`
- `endLine`

Chunk rows do not store vectors.

## Vector Storage

Vectors are stored in a separate table: `hybridChunkVectors`.

Each file owns one vector shard row with:

- `filePath`
- `precision`
- `dim`
- `chunkCount`
- `chunkIds`
- `vectorData`
- `scaleData` for `int8` only

This is a practical continuous-buffer design for IndexedDB:

- one row per file instead of one row per chunk
- vectors are stored as contiguous typed-array blobs
- startup can batch-load vectors efficiently

## Embedding Input Strategy

Hybrid embedding input is allowed to be richer than stored chunk text.

Current direction:

- persist and display the original small chunk text
- build embedding input only at indexing time
- prepend lightweight structure hints such as:
  - file basename
  - nearest heading path, capped by a small token budget instead of a fixed heading count
- heading path should prefer Obsidian `metadataCache.headings` as the primary source
- lightweight markdown parsing remains only as a fallback when heading metadata is unavailable

Current online context policy:

- total context budget is fixed at about `22` tokens
- file basename gets a reserved share first, typically around `4-6` tokens
- remaining budget is filled by heading titles starting from the nearest heading and walking upward
- at most the last `4` heading levels are considered
- clearly generic headings such as `记录 / 想法 / welcome / tasks` are skipped when better headings exist

Why:

- improves semantic identity of chunks whose local text is underspecified
- preserves document identity even when nearby headings are too generic
- does not require storing extra text in IndexedDB
- does not change HNSW graph size, chunk row size, or query-time search flow

Tradeoff:

- indexing-time embedding token usage increases slightly
- query latency and on-disk index size stay almost unchanged

Guardrails:

- this enrichment is hybrid-only
- it must not change lexical search behavior
- context should stay short and structural, not become large section-prefix text
- Obsidian-specific metadata access should stay above the chunker layer; chunker should consume a plain heading outline instead

## Quantization Modes

Only one vector precision is stored at a time.

### Int8

- stores `Int8Array` vectors
- stores one `Float32` scale per chunk
- smaller on disk
- faster to search
- usually good enough

### Float16

- stores `Uint16Array` float16 vectors
- does not store int8 side data
- larger on disk
- slower to search
- usually more stable on purely semantic matches

Switching quantization requires rebuilding the hybrid index.

## HNSW Persistence

`hybridHnswSmall` stores graph structure only:

- `entryPoint`
- `maxLevel`
- `precision`
- `nodes`
- `deletedSet`

Vectors are not persisted inside the HNSW blob.

At startup:

1. load HNSW graph
2. load vector shards
3. hydrate in-memory vectors

This keeps the HNSW blob much smaller while preserving query speed.

## BM25 Persistence

BM25 is persisted as a binary blob in `hybridBm25Index`.

It keeps:

- term dictionary
- posting lists
- document lengths
- bucketed positional information for approximate proximity bonus

The current BM25 blob uses a compact binary layout:

- front-coded sorted term text
- implicit sequential term ids
- `docId` deltas stored as varints
- positional deltas stored as varints
- `tfNorm` quantized to 1 byte

The current blob version is `CSB4`.

This binary layout is intentionally tuned for storage efficiency, but storage is now a secondary concern after recall quality.

## BM25 Role Inside Hybrid

Hybrid BM25 should not try to replace `lexicalengine`.

Its role is:

- provide lexical anchors for reranking
- keep direct hybrid queries stable on entity-like or keyword-like queries
- provide fallback when embedding or semantic retrieval is weak
- complement HNSW instead of duplicating the entire lexical stack

That means BM25 should be:

- reliable
- recall-aware
- good enough

But not necessarily:

- a fully separate best-in-class lexical search engine

## Boundary With Lexical Engine

This boundary is intentional and should be preserved:

- `lexicalengine` remains the default fast lexical entry point
- hybrid-specific normalization must not degrade `lexicalengine`
- hybrid BM25 experimentation must stay isolated from lexical search behavior

Practical rule:

- any token normalization, expansion, typo handling, or query rewriting for hybrid should stay inside `src/services/search/hybrid/*`
- do not change `lexicalengine` behavior as a side effect of hybrid recall work
- lightweight case-folding / prefix / typo expansion is acceptable inside hybrid BM25 as long as it does not increase rerank candidate count

## Search Output Semantics

- rerank input size is fixed by recall limits
- rerank output size is controlled by settings
- if rerank returns `N` chunks, the UI displays `N` chunks total
- files are only grouping containers in the UI
- dense recall is currently single-query in runtime; lightweight query variants are benchmark-only until they show clear recall gains

## Fallback Behavior

If query embedding fails:

- semantic recall is skipped
- BM25 results still feed rerank when possible

If rerank fails:

- results fall back to recall ordering

## Database Layout

Current hybrid-related tables:

- `hybridChunks`
- `hybridChunkVectors`
- `hybridBm25Index`
- `hybridHnswSmall`
- `hybridDocRefs`
- `hybridTokenStats`

DB version upgrades clear hybrid tables and trigger rebuilding when needed.
BM25 blob versions are migrated forward locally when possible.

## Dev Storage Stats

Developer mode reports:

- total indexable vault size
- estimated plugin storage size
- current vector quantization
- table-level storage usage
- chunk text vs metadata
- vector shard ids/data/scale/metadata
- BM25 blob segment breakdown

These dev storage stats are local-only:

- no embedding API
- no rerank API
- no token usage

## Reliability Roadmap

The next implementation priority is no longer pure retrieval tuning.

The order is:

1. initialization and rebuild robustness
2. index consistency under file add/delete/modify
3. hybrid BM25 storage compression

Reason:

- reranker already reduces the value of over-optimizing first-stage internal ordering
- hybrid quality is now good enough that engineering stability has higher product value
- a system that occasionally rate-limits, half-writes, or bloats IndexedDB is worse than a slightly less optimal recall curve

### Priority 1: Initialization And Rebuild Robustness

This phase should harden:

- large vault startup and full rebuild behavior
- very large file handling
- long-running rebuild memory peaks
- batch throttling to reduce provider bursts
- request retry and backoff behavior
- local index-size estimation before or during rebuild
- IndexedDB quota awareness and early warning

Practical rule:

- prefer graceful slowdown over aggressive concurrency
- prefer local preflight estimates over blind rebuilds
- prefer request-level retry/backoff before file-level full retry
- use a shared runtime-control layer for retry, rate-gating, and weighted scheduling
- schedule files by in-flight byte budget, not only by file-count concurrency
- index large files in chunk batches so one file does not hold the full embedding input list in memory
- hydrate vector shards in small startup batches instead of loading all shard blobs at once
- surface rebuild progress using processed source-file bytes, not estimated index bytes
- run startup self-healing before incremental diffing so orphan rows do not pollute reindex decisions

### Priority 2: Index Consistency

This phase should ensure hybrid storage never drifts into a mixed-generation state.

The main targets are:

- no orphan `hybridChunks`
- no orphan `hybridChunkVectors`
- no stale `hybridDocRefs`
- no partial file replacement that leaves old and new chunks mixed together
- no crash window where persisted rows and in-memory BM25/HNSW state disagree for long

Practical rule:

- file replacement should be treated as one logical unit
- startup should detect and repair inconsistent hybrid file state
- incremental updates should prefer idempotent cleanup over assuming the previous write finished cleanly

### Priority 3: Hybrid BM25 Size

Only after phases 1 and 2 are in place should we return to storage compression.

Reason:

- current hybrid BM25 size is a cost issue, not the top reliability risk
- storage reductions are easier to evaluate once rebuild and consistency behavior are trustworthy
- size work should not be allowed to reintroduce rebuild fragility

## Planning Direction

Retrieval tuning remains important, but it is now subordinate to the reliability roadmap above.

The retrieval planning phase should continue treating hybrid as a reranker-fed candidate generator.

### Phase 1

- redefine benchmark priorities around `hits@25`
- add explicit reporting for:
  - `bm25-hits@25`
  - `hnsw-hits@25`
  - `hybrid-hits@25`
  - `hnsw-only gain@25`
  - `bm25-only anchor gain@25`
  - candidate noise rate
- current runtime default uses a fixed plain candidate budget: `BM25 20 + HNSW 30`
- current offline results do not justify switching runtime to `25/25`, and they also do not justify paying extra query-embedding cost for dense query variants

### Phase 2

- study query-aware recall budgets instead of assuming one global BM25/HNSW ratio
- treat these query families separately:
  - keyword/entity/path-like queries
  - semantic rewrite queries
  - mixed queries

### Phase 3

- optimize HNSW first as the primary semantic gain source
- optimize hybrid BM25 second as a stable lexical anchor source
- only optimize internal candidate ordering when it changes top-25 admission, fallback quality, or noise

## Future Improvements

Possible next steps:

- complete rebuild preflight, throttling, and quota guardrails
- add hybrid startup self-healing for inconsistent file state
- benchmark query-aware BM25/HNSW budget strategies only after stability work lands
- improve HNSW recall on lexical-failure-like queries
- add hybrid-only normalization that is strictly isolated from `lexicalengine`
- reconsider positional encoding only if it improves `hits@25` or cutoff behavior
- revisit storage compression only after stability and consistency goals are stable
