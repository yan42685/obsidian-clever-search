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

The primary order is:

1. file-event consistency closure
2. initialization and rebuild robustness
3. state and fallback observability
4. local runtime rebuild benchmarking
5. retrieval-quality tuning
6. hybrid BM25 storage compression
7. larger lexical-stack replacement work

Reason:

- reranker already reduces the value of over-optimizing first-stage internal ordering
- hybrid quality is now good enough that engineering stability has higher product value
- a system that occasionally rate-limits, half-writes, or bloats IndexedDB is worse than a slightly less optimal recall curve
- mixed-generation storage and unclear fallback states are currently a higher product risk than another small benchmark gain

### Priority 1: File-Event Consistency Closure

This phase should ensure runtime file operations never drift into mixed-generation state.

The main targets are:

- no orphan `hybridChunks`
- no orphan `hybridChunkVectors`
- no stale `hybridDocRefs`
- no partial file replacement that leaves old and new chunks mixed together
- no rename path where the old path survives after the new path is indexed
- no modify burst where an older task overwrites a newer file version
- no long-lived `pending` file state after a crash or interrupted write

Practical rule:

- file replacement should be treated as one logical unit
- startup should detect and repair inconsistent hybrid file state
- incremental updates should prefer idempotent cleanup over assuming the previous write finished cleanly
- file events should be merged by path before indexing work is expanded
- rename should be modeled as old-path cleanup plus new-path indexing, with a deterministic final state
- per-file write serialization is acceptable because it is cheaper than reasoning about arbitrary interleavings later

### Event Reduction Model For Runtime Updates

The runtime file-event model should now bias toward current vault truth rather than trying to preserve detailed event algebra.

Primary goal:

- stop writing special reduction rules for `rename + upsert`, repeated `upsert`, or other event-sequence combinations
- let final behavior be decided by the current vault state observed at flush time

Practical rule:

- `FileWatcher` should emit raw path-level change intent, not long-lived file snapshots
- the buffer should mainly track dirty paths and stale paths within a time window
- flush should re-read the current vault state and only then expand work into executable actions
- executable actions should stay minimal: `delete(path)` and `upsert(latest file state)`
- runtime correctness is more important than preserving the exact intermediate history of transient file events

Why:

- in this plugin, the vault is a strong source of truth
- modeling path invalidation is much cheaper and safer than modeling every event composition precisely
- this keeps reducer complexity bounded even when rename and modify events interleave

### Token-Cost Control During Incremental Hybrid Updates

Hybrid correctness is not enough by itself; incremental updates must also keep embedding-token cost acceptable.

Current decision:

- do not introduce `contentHash` or `contextSignature` as part of the near-term mainline
- reason: truly no-op modify events appear infrequent enough that the extra metadata and branching are not currently worth the added complexity

Practical rule:

- the first low-risk win should be a rename fast path
- if a rename only changes folder/path while preserving the same basename, hybrid should update references without re-embedding
- rename-specific state such as `contextStale` is not part of the near-term plan
- file rename is considered much lower frequency than content modification, so the system should prefer a simple minimum full-reindex interval over adding extra rename-only state machinery
- token-saving work should target cases with high real cost first, especially large files and repeated edits

Near-term priority order:

1. stabilize the dirty-path flush model
2. add low-cost rename handling
3. add a minimum interval for full-file reindex so repeated updates do not immediately force another full embedding pass
4. keep large-file token cost under control through chunk-level incremental embedding reuse

### Priority 2: Initialization And Rebuild Robustness

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
- when hybrid is enabled, showing session token usage during initialization/rebuild is acceptable as long as it is clearly session-scoped rather than a weekly total

### Priority 3: State And Fallback Observability

This phase should make hybrid health visible enough that debugging does not require reading raw logs first.

The main targets are:

- explicit file states such as `pending`, `ready`, `bm25_only`, and `failed`
- visible fallback reason categories such as missing key, weekly limit, timeout, `429`, network failure, or provider `5xx`
- rebuild summaries that report how many files ended in full hybrid versus BM25-only fallback
- developer-facing visibility into recent abnormal files without exposing noisy low-level internals to ordinary users

Practical rule:

- prefer compact aggregated summaries over noisy per-file notices
- keep detailed state visibility in developer mode first
- do not blur together healthy BM25-only fallback and abnormal half-written state

### Priority 4: Local Runtime Rebuild Benchmarking

This phase should create a stable zero-token benchmark for the real indexing pipeline.

The main targets are:

- measure actual startup and rebuild flow instead of only offline retrieval quality
- compare commits on the same machine without needing provider access
- isolate local pipeline cost from embedding provider latency by using fixed-cost or mocked embedding work
- report per-stage timing, not only total wall-clock time

Practical rule:

- benchmark the real runtime path: chunking, context building, local quantization, BM25/HNSW updates, persistence, and hydration
- treat provider latency as a controlled constant when the goal is engineering regression detection
- keep the benchmark lightweight enough for routine use

### Priority 5: Retrieval-Quality Tuning

Retrieval tuning remains important, but it is now subordinate to the reliability roadmap above.

The retrieval planning phase should continue treating hybrid as a reranker-fed candidate generator.

The current optimization order is:

1. `hybrid-hits@25`
2. `hnsw-only gain@25`
3. candidate noise control
4. adequate `bm25-hits@25` for direct hybrid queries

Practical rule:

- optimize candidate admission before candidate ordering
- prefer improvements in dense recall and candidate complementarity over more complex first-stage ranking logic
- only optimize internal candidate ordering when it changes top-25 admission, fallback quality, or noise
- keep hybrid-specific query normalization isolated from `lexicalengine`

### Priority 6: Hybrid BM25 Size

Only after priorities 1 through 5 are stable should we return to storage compression.

Reason:

- current hybrid BM25 size is a cost issue, not the top reliability risk
- storage reductions are easier to evaluate once rebuild and consistency behavior are trustworthy
- size work should not be allowed to reintroduce rebuild fragility
- if reranker-fed candidate quality is already acceptable, aggressive compression should not outrank stability work

### Priority 7: Lexical Stack Replacement

Replacing more of the lexical stack remains a strategic option, not the current execution mainline.

The eventual target may be:

- reusing custom lexical/BM25 infrastructure more broadly
- reducing duplicate index storage
- preserving field-aware, prefix, and fuzzy lexical behavior without depending fully on MiniSearch

Practical rule:

- do not advance this work unless recall quality, feature parity, and operational stability are all acceptable
- treat this as a deliberate architecture program, not a side effect of hybrid tuning

## Next-Phase Program

The next development phase should be read as four parallel tracks with different urgency:

- stability track: priorities 1, 2, and 3
- measurement track: priority 4
- retrieval track: priority 5
- storage and architecture track: priorities 6 and 7

Practical rule:

- stability work is the default mainline
- measurement work exists to keep stability and retrieval work honest
- retrieval work should continue, but not at the cost of reopening consistency or rebuild risks
- storage and lexical replacement work should remain gated behind evidence, not intuition

### Stability Track

- close file-event consistency gaps under create, modify, rename, and delete
- keep hybrid file state explicit and recoverable
- harden large-vault rebuild behavior and quota awareness
- make fallback states observable enough that real-vault failures can be diagnosed quickly

### Measurement Track

- maintain a zero-token local runtime benchmark for rebuild and startup
- maintain offline retrieval guardrails for `hits@25`, `hnsw-only gain@25`, and candidate noise
- compare versions under the same fixed embedding-cost assumption when the goal is engineering regression detection

### Retrieval Track

- keep current runtime candidate budget simple unless new evidence clearly beats it
- improve HNSW as the main semantic value source
- keep hybrid BM25 good enough for direct hybrid queries and fallback behavior
- explore query-aware budgets only after stability work lands and only if holdout-style evidence remains positive

### Storage And Architecture Track

- revisit hybrid BM25 compression only after runtime correctness is stable
- keep the possibility of replacing more of the lexical stack open, but do not treat it as near-term default work
- require feature parity, acceptable recall, and acceptable runtime cost before reducing MiniSearch reliance further

## Future Improvements

Possible next steps:

- finish file-event consistency closure under rename and repeated modify bursts
- complete rebuild preflight, throttling, and quota guardrails
- make hybrid state and fallback reasons visible in developer mode summaries
- add a real runtime local rebuild benchmark with fixed-cost embedding mocks
- benchmark query-aware BM25/HNSW budget strategies only after stability work lands
- improve HNSW recall on lexical-failure-like queries
- add hybrid-only normalization that is strictly isolated from `lexicalengine`
- reconsider positional encoding only if it improves `hits@25` or cutoff behavior
- revisit storage compression only after stability and consistency goals are stable
- treat larger lexical-stack replacement as a separate architecture phase, not a quick optimization pass

Priority follow-up object:

- chunk-level incremental embedding reuse should be treated as the main future lever for reducing hybrid token cost on large, frequently edited files
- compared with rename-specific stale-context machinery, this is expected to deliver meaningfully higher token savings for roughly the same or better product value
