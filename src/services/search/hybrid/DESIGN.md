# Hybrid Search Design

## Summary

This hybrid search pipeline combines:

- BM25 lexical recall
- dense HNSW recall
- Qwen reranking

The current implementation uses small chunks only.

This document is also the source of truth for the current dual-track search program:

- stable lexical search keeps the current file-level engines (`minisearch` and `custom-bm25`)
- a separate experimental lexical backend, `passage-bm25`, lives under `src/services/search/passage-lexical/` and plugs into the existing UI/backend selector without replacing the stable path
- hybrid search is a reranker-fed chunk pipeline where HNSW provides semantic lift and BM25 provides lexical anchors plus BM25-only fallback quality
- for the experimental lexical backend, interactive latency on a few-hundred-megabyte vault is now a harder constraint than index size

## Product Intent

This hybrid system serves two real user entry paths:

1. Users usually search with `lexicalengine` first for fast exact-term matching.
2. If lexical search fails or is unsatisfying, users switch to hybrid search.
3. Some users also open hybrid search directly.

This means hybrid search is not meant to replace `lexicalengine`.

It also means the new lexical passage-first work should not replace the current file-level engines until it proves itself.

Instead, hybrid search has two jobs:

- provide semantic recovery when lexical search misses
- remain stable enough for direct hybrid queries that still contain strong lexical anchors
- keep BM25-only fallback useful when embedding or rerank is unavailable

Because of that:

- HNSW is expected to provide most of the net-new value
- hybrid BM25 must still be good enough, but it does not need to chase broad standalone recall if that does not improve reranked or fallback `top10`
- reranker is the final decision-maker, so first-stage retrieval should optimize the candidate set that most affects `top10`

## Lexical Query Distribution

The lexical product target is now explicitly body-first.

Expected real query distribution:

- most lexical queries are mainly searching note body content
- a smaller but important share are body content plus a path or filename anchor
- another important share are body content plus a partial title or heading anchor
- pure filename, pure path, or pure title lookup still matters, but it is no longer the main optimization target for the new experimental backend

Practical interpretation:

- the engine should treat body-local evidence as the main ranking signal
- path, filename, title, and heading should usually act as disambiguating priors or anchors
- metadata should help the engine find the right body passage faster, not replace body evidence as the main objective
- if a design choice improves pure metadata lookup a little but hurts body-local `top1-5`, reject it for the experimental path

## Primary Optimization Goal

The active optimization target is now split by track.

stable lexical primary goals:

1. `top1`
2. `mrr@5`
3. `ndcg@5`
4. acceptable zero-result rate without sacrificing file-level precision

experimental lexical primary goals:

1. `span-hit@1`
2. `span-hit@5`
3. `mrr@5`
4. interactive `p50` / `p95` on a few-hundred-megabyte vault
5. better body-local `top1-5` than the stable file-level engines
6. strong handling of `body + path/filename` and `body + partial title/heading` mixed queries

hybrid primary goals:

1. reranked `hit@10`
2. reranked `ndcg@10`
3. BM25-only fallback `hit@10`
4. lexical-anchor admission into the reranker candidate set
5. candidate noise control inside the fixed reranker budget

In other words:

- winning broad file recall is not enough; lexical search must win where users stop looking: `top1-5`
- body-local quality matters more than pure metadata-only ranking gains for the experimental path
- maximizing hybrid `top25` is not the main goal
- getting the right lexical and semantic chunks into the reranker frontier, and keeping fallback `top10` useful, is the main goal
- the same BM25 policy does not need to satisfy both tracks

## Benchmarking Policy

Offline benchmark is a guardrail, not the optimization target itself.

The real target is broad real-vault search quality across unknown note collections.

Because of that:

- do not optimize for a single synthetic score in isolation
- prefer changes that improve retrieval mechanisms, not changes that only fit known benchmark cases
- treat benchmark improvements as evidence, not proof
- always measure storage growth together with retrieval quality

The regression program is split by track first:

- `lexical-set`: file-level queries for filename, path, tag, heading, code token, typo, and prefix behavior
- `hybrid-set`: chunk-level queries for lexical-anchor admission, mixed lexical+semantic queries, and BM25-only fallback quality

Each track still uses three tiers:

- `core`: stable representative cases for day-to-day regression
- `adversarial`: harder public cases that create stronger `top1-5` or `top10` pressure
- `holdout`: hidden-style evaluation cases that are excluded from normal tuning

Practical rule:

- daily tuning should use `core + adversarial`
- holdout should only be used for periodic validation or before promoting a new default
- if a change wins on public suites but loses on holdout, treat that as likely overfitting
- if a change improves retrieval but violates the storage budget, do not promote it by default

Benchmark design priorities:

- make `top1-5` and `top10` meaningfully harder without exploding runtime
- prefer more realistic query ambiguity over simply inflating corpus size
- add small numbers of high-value adversarial queries instead of large volumes of synthetic noise

## Retrieval Flow

For each query:

1. BM25 returns a limited lexical-anchor chunk set
2. HNSW returns top 30 chunks
3. The two lists are deduplicated by chunk id
4. Deduplicated chunks are sent to `qwen3-rerank`
5. The reranker output count is controlled by plugin settings
6. Returned chunks are grouped by file for UI display

The UI groups by file, but the result limit is applied to chunks, not files.

Practical rule:

- online tuning should focus on the first `10` reranked chunks even if larger UI windows remain configurable
- candidate-budget changes should be justified by better reranked `top10` or better BM25-only fallback `top10`, not by wider recall metrics alone

## Candidate Budget Status

Current online default:

- BM25 top 10
- HNSW top 30
- hybrid BM25 candidate recall uses plain BM25 scoring without proximity bonus

Current status:

- query-aware recall routing was removed after real-vault validation showed the complexity was not worth the token savings
- online runtime now uses one fixed recall budget for all hybrid queries
- current product intent is no longer "maximize wide top25 admission"; it is "keep reranked and fallback `top10` strong"

Latest offline evidence after adding `daily + holdout + size-sweep`:

- query-aware budgets are not consistently better than fixed `20/30`
- on larger logical corpora, fixed `20/30` with plain BM25 is often as good as or better than entry-aware variants
- the strongest consistent signal is that hybrid first-stage recall should prefer plain BM25 over proximity-boosted BM25

Current practical conclusion:

- do not rush query-aware recall budgets online yet
- optimize lexical-anchor admission and fallback quality before broadening candidate budgets
- do not increase BM25 width simply to improve wide recall metrics if reranked and fallback `top10` do not improve
- first verify whether leaner BM25 storage and simpler lexical-anchor heuristics improve online `top10` without harming direct hybrid lexical queries

## Semantic Rewrite Query Policy

Semantic rewrite and multi-variant query expansion are currently not part of the main online direction.

Reason:

- offline evidence did not show stable gains
- the extra complexity is not justified by the observed improvement
- strong lexical-anchor queries are easy to hurt
- reranker cannot recover chunks that never enter the candidate set that matters for `top10`

Current rule:

- keep the original user query as the main retrieval input
- do not prioritize semantic rewrite work unless new evidence shows a clear `top10` gain
- spend optimization effort on better dense recall and better chunk representation instead

Status:

- rejected for the current mainline
- may only be revisited if future real-vault evidence shows stable top-25 recall gains

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

This binary layout now sits under a hard storage-growth rule:

- no default storage change should grow the relevant index by more than `50%` versus the current baseline without explicit re-budgeting
- positional data is optional, not a guaranteed default requirement
- storage that does not move `lexical top1-5` or hybrid `top10` should be removed before new storage is added

## BM25 Role Inside Hybrid

Hybrid BM25 should not try to replace `lexicalengine`.

Its role is:

- provide lexical anchors for reranking
- keep direct hybrid queries stable on entity-like or keyword-like queries
- provide fallback when embedding or semantic retrieval is weak
- keep BM25-only fallback useful within `top10`
- complement HNSW instead of duplicating the entire lexical stack

That means BM25 should be:

- reliable
- top10-oriented
- storage-aware
- good enough

But not necessarily:

- a broad high-recall standalone engine
- a fully separate best-in-class lexical search engine

## Boundary With Lexical Engine

This boundary is intentional and should be preserved:

- `lexicalengine` remains the default fast lexical entry point
- hybrid-specific normalization must not degrade `lexicalengine`
- hybrid BM25 experimentation must stay isolated from lexical search behavior

Practical rule:

- any token normalization, expansion, typo handling, or query rewriting for hybrid should stay inside `src/services/search/hybrid/*`
- do not change `lexicalengine` behavior as a side effect of hybrid `top10` tuning
- lightweight case-folding / prefix / typo expansion is acceptable inside hybrid BM25 as long as it does not increase rerank candidate count

## Search Output Semantics

- rerank input size is fixed by candidate limits
- rerank output size is controlled by settings
- if rerank returns `N` chunks, the UI displays `N` chunks total
- files are only grouping containers in the UI
- dense recall is currently single-query in runtime; lightweight query variants are benchmark-only until they show clear recall gains
- current default tuning attention should remain on `top10` even if larger UI windows exist

## Passage-First Direction

For body-first search quality, the main architectural choice is not "BM25 versus not BM25".
The main choice is the primary retrieval unit and whether latency is controlled by execution strategy or by hard coarse filtering.

Current practical conclusion:

- file-level retrieval is too coarse when users care most about local body hits
- line-level retrieval is too formatting-sensitive to serve as the primary index unit
- hard section-first gating is too risky when the product goal is very high local `top1-5`
- the recommended experimental lexical path is passage-first retrieval with soft priors and a narrow verifier frontier

Preferred direction:

- stable lexical backends remain file-level and continue to serve as the conservative path
- the new experimental backend should live separately under `src/services/search/passage-lexical/`
- hybrid should continue to use its current chunking path for semantic retrieval and reranking
- the lexical passage unit does not need to equal the hybrid embedding chunk unit

## Recommended Lexical Architecture

The recommended experimental lexical architecture for high local-body-hit quality and near-real-time interaction is:

1. passage-first sparse recall
2. query-gated multi-channel lexical scoring
3. narrow local verifier reranking
4. file aggregation only as the last step

This means the system should rank local passages first, then derive file-level presentation from the best passages.

### Why This Is Preferred

- it aligns the primary ranking unit with what users actually care about: the best local body match
- it avoids file-level false positives where one small relevant paragraph is drowned inside a weak file-level score
- it avoids hard section-level misses that a later verifier cannot recover from
- it keeps latency under control by shrinking the expensive verifier frontier instead of relying on coarse recall gates

### Recommended Units

Passage:

- dynamic local body unit
- target size around `80-140` estimated tokens
- overlap around `35%-50%`
- should prefer sentence and paragraph boundaries instead of only fixed offsets

Verifier window:

- built only for a narrow frontier, not persisted at full scale
- used for exact phrase, ordered hit, local density, and rare-term checks

Metadata prior:

- file basename, folder, tags, and headings remain useful
- these signals should act as soft boosts or routing hints, not hard recall gates
- these signals are especially valuable for mixed queries such as `body + filename/path` and `body + partial title`

### Recommended Representation

The experimental passage path should use a primary sparse channel plus narrowly-scoped support channels:

- word or subword channel as the main recall path
- lightweight CJK char-bigram channel for mixed-script robustness
- optional ordered-pair or phrase-signature channel if it improves verifier admission

The character channel should stay controlled:

- enable or emphasize it only when the query suggests CJK or mixed-script need
- do not turn the whole engine into a broad full-text `n`-gram index

## Integration Boundary

The experimental lexical engine is intentionally not a rewrite of the current stack in place.

Practical rule:

- keep `minisearch` and `custom-bm25` intact as the stable backends
- add the experimental engine as a third backend option through the existing lexical UI
- isolate new implementation work inside `src/services/search/passage-lexical/`
- allow the new backend to reuse the existing search result UI contract so A/B comparison stays easy
- optimize the experimental backend first for body-dominant mixed queries, not for metadata-only queries in isolation

## Candidate Architectures

### A. File-Level Index Plus LineMatcher

Strengths:

- smallest storage
- easiest migration path
- strongest metadata usage

Weaknesses:

- local body evidence enters too late
- long files can dominate even when only one small passage is relevant
- `top1-5` local-hit quality is capped by file-level coarse recall

This remains the stable baseline, not the target for the experimental path.

### B. Hard Hierarchical Section-Then-Window Index

Strengths:

- lower global passage fan-out
- can reduce index reads on cold paths

Weaknesses:

- section-level misses are unrecoverable
- more tuning complexity in the coarse stage
- not the best theoretical fit for maximum local `top1-5`

This is no longer the preferred experimental mainline.

### C. Flat Passage BM25 Plus Verifier

Strengths:

- strongest direct alignment with local-body search
- simplest mental model for debugging relevance
- best single-path starting point for `top1-5`

Weaknesses:

- can become expensive if every query uses every channel
- needs strong frontier control to stay interactive

This is the preferred base architecture.

### D. Accelerated Passage Sparse Plus Soft Priors

Strengths:

- keeps the advantages of passage-first retrieval
- uses query gating, soft metadata priors, and frontier control to protect latency
- avoids hard coarse recall failures

Weaknesses:

- more engineering complexity than plain flat passage BM25
- requires careful execution-layer tuning

This is the recommended target architecture for the experimental backend.

## Recommended Data Structures

The experimental passage path should be built from compact sparse structures with most expensive logic deferred to a narrow query-time frontier.

Suggested persisted structures:

- `passageRefs`
  - `passageId`
  - `filePath`
  - `startOffset`
  - `endOffset`
  - `startLine`
  - `endLine`
  - `passageLength`

- `passageWordIndex`
  - main sparse postings over passage units
  - optional block-max or similar upper-bound metadata for early termination

- `passageCharIndex`
  - constrained CJK char-bigram postings
  - query-gated rather than universal first-choice scoring

- `fileMetadataIndex`
  - basename, folder, tags, headings
  - used as soft priors and metadata-first fallback

- `passageStats`
  - compact length and coverage stats
  - enough to normalize scores and trim frontiers

Suggested query-time only structures:

- top passage frontier
- verifier windows
- exact phrase checks
- ordered term checks
- local density checks
- rare-term coverage checks

Practical rule:

- if a signal can be computed on the top `16-32` passages at query time, do not persist it globally by default

## Storage Budget Model

The experimental backend is now opt-in, so storage is no longer the main promotion gate by itself.

Current practical conclusion:

- some index growth is acceptable if it buys clearly better local `top1-5`
- storage still needs to be measured, but interactive latency is the harder requirement
- because the new backend is not replacing the stable path yet, larger on-disk cost is acceptable during experimentation

## Latency Model

The expected latency tradeoff should be evaluated end-to-end, not just on first-stage posting lookup.

Current practical expectation on a few-hundred-megabyte vault:

- file-level lexical lookup is light, but end-to-end latency rises because local evidence is collected too late
- naive flat passage scoring can get expensive if every query expands every channel
- accelerated passage-first retrieval should keep the passage unit while controlling cost with query gating, early termination, and a narrow verifier frontier

Warm-cache target:

- `p50` roughly in the `30-80 ms` range
- `p95` roughly in the `80-180 ms` range

Cold-cache target:

- keep `p95` within a range that still feels interactive, roughly `200-400 ms`

Practical rule:

- optimize end-to-end `p50` and `p95` query latency, not only inverted-index lookup latency
- do not accept a local-hit gain if normal typing interaction stops feeling real-time

## Experimental Benchmark Program

The new benchmark program should compare at least these lexical architectures:

1. current stable `lexicalengine`
2. experimental `passage-bm25`
3. optional later accelerated variants on top of the same passage base

The benchmark should be split into:

- Chinese local-body queries
- English local-body queries
- mixed Chinese and English local-body queries
- `body + path/filename` mixed queries
- `body + partial title/heading` mixed queries
- code and technical-token queries

Each query should label:

- best span or best local window
- acceptable top-3 spans
- best file

Primary metrics:

- `span-hit@1`
- `span-hit@3`
- `span-hit@5`
- `file-hit@1`
- `mrr@5`
- `p50` and `p95` latency
- index bytes

Promotion gates:

- the experimental backend should improve `span-hit@1` or `mrr@5`
- it should keep end-to-end latency inside an interactive range on a few-hundred-megabyte vault
- it should be materially better on mixed CJK and Latin local-body cases, not only on metadata cases
- it should stay strong when the query includes a body intent plus one metadata anchor

## Hybrid Comparison Policy

The experimental lexical passage-first work should not be judged against hybrid by using one blended score.

Practical rule:

- compare the experimental lexical backend against the stable lexical backends
- compare hybrid tuning against the current hybrid stack
- only compare lexical versus hybrid when the user-facing question is specifically about entry-path behavior

This avoids a common failure mode:

- a body-first lexical architecture can be objectively better for local text search while still being the wrong replacement target for hybrid semantic retrieval

## Passage-First Execution Plan

The recommended implementation order is phased, not one giant in-place rewrite.

### Phase 0: Stable Baseline

Before changing defaults:

- keep the current stable file-level engines intact
- record current lexical warm and cold latency
- freeze a representative local-body benchmark suite
- add benchmark labels for best span, acceptable spans, and best file

Exit criteria:

- the stable baseline is measurable and remains available for A/B comparison

### Phase 1: Separate Experimental Backend

Build the new passage-first engine as a separate backend inside `src/services/search/passage-lexical/`.

Targets:

- plug into the existing file-search backend selector
- keep the existing search result UI contract
- avoid changing stable backend behavior as a side effect

Exit criteria:

- users can switch between stable and experimental lexical engines without leaving the current UI

### Phase 2: Passage BM25 Baseline

Build the simplest useful passage-first baseline first.

Targets:

- passage-level sparse recall
- file metadata soft boosts
- file aggregation from best passages
- correct handling of `body + metadata-anchor` mixed queries

Exit criteria:

- the team has a measurable quality baseline for local passage retrieval

### Phase 3: Latency-Safe Accuracy Work

Add only the pieces that improve local `top1-5` without breaking interactivity.

Priority order:

1. verifier
2. CJK char channel
3. metadata-anchor mixing for `body + path/title` queries
4. early termination
5. query gating
6. optional phrase-signature channel

Practical rule:

- do not add another global channel unless it improves `span-hit` enough to justify its runtime cost

Exit criteria:

- the experimental backend wins on local-body benchmarks and still feels real-time

### Phase 4: Default Decision

Only consider promoting the new lexical default when all of the following are true:

- body-first `top1-5` is clearly better than the current stable path
- interactive latency remains acceptable on a few-hundred-megabyte vault
- rebuild and migration behavior are stable enough for normal users
- the old stable backends remain available as rollback paths

## Rejected Or Deferred Directions

These directions are intentionally not part of the current mainline.

### Rejected For Now

- semantic rewrite / multi-variant query expansion in runtime
- query-aware online BM25/HNSW recall budgets
- over-optimizing first-stage internal ordering beyond `top10` admission impact
- adding chunk-position storage by default when it does not clearly improve reranked or fallback `top10`

Reason:

- offline and local evidence has not shown stable enough gains
- reranker already lowers the product value of more complex first-stage ordering tricks
- these directions increase runtime and maintenance complexity faster than they improve real user value

### Deferred Until Stronger Evidence

- conservative runtime slowdown mode during rebuild
- merging lexicalengine and hybrid BM25 into one shared runtime stack
- further hybrid BM25 compression work beyond low-risk binary improvements

Reason:

- these may still be valuable later, but they are not currently justified without stronger runtime pain or clearer product upside
- stability validation and complexity control are currently higher priority

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

### Unified Snapshot Storage Draft

The next storage simplification should explicitly move to one shared snapshot system for both lexical and hybrid paths.

Primary goals:

- keep only one persisted plain-text snapshot per indexed file
- keep only one in-memory plain-text cache per file
- let `passage-bm25` restore from the shared snapshot path instead of embedding full document text inside its serialized index snapshot
- make generation semantics unambiguous so cache hits stay safe

Practical rules:

- `fileSnapshots` is the shared file-snapshot store for both hybrid and `passage-bm25`
- `FileSnapshotStore` should keep only one memory cache:
  - `currentFileCache[path] = { text, generation }`
- `indexedSnapshotCache` should be removed rather than maintained in parallel
- `passage-bm25` serialized state should store structural index data only, not full `documents[].content`
- if `passage-bm25` needs full text during restore, snippet building, or local verification, it should read through `FileSnapshotStore`

Generation semantics:

- `generation` means source file version, not indexing completion time
- within one file-update pipeline, `generation` must be sampled once from the source file state and propagated through all writes
- the recommended value is the flushed file's `file.stat.mtime`
- `indexedAt` may still exist, but only as an observability timestamp and never as the cache-alignment key

This distinction is mandatory:

- `generation = source version`
- `indexedAt = index completion time`

They should never be merged into one field.

Read rules:

- read latest text:
  - prefer `currentFileCache`
  - if missing, read disk via vault, normalize, and backfill `currentFileCache`
- read indexed-aligned text for lexical or hybrid:
  - if `currentFileCache[path].generation === expectedGeneration`, use the current cache directly
  - otherwise fall back to the persisted file snapshot row

Write rules for runtime updates:

1. watcher debounce flush resolves the current `TFile`
2. sample `sourceGeneration = file.stat.mtime` once
3. read normalized latest text once
4. write `currentFileCache[path] = { text, generation: sourceGeneration }`
5. run lexical / hybrid incremental update using the same `sourceGeneration`
6. after a successful index write, persist the same text into the shared file snapshot store with `generation = sourceGeneration`
7. each index record that needs alignment should also store `generation = sourceGeneration`

Safety rule for races:

- if a newer edit arrives while an older indexing task is still finishing, the older task must not overwrite `currentFileCache` with stale text
- it may still commit its own persisted snapshot and index state under its own `generation`
- later indexed-text reads must then miss the current cache and safely fall back to the persisted snapshot for that older generation

Why this is the preferred simplification:

- it removes duplicate persisted full text between hybrid snapshots and `passage-bm25`
- it removes duplicate in-memory full-text caches with different meanings
- it keeps the "latest file text" and "indexed baseline text" model explicit without requiring two hot caches
- it preserves safe mixed-generation behavior instead of relying on lucky timing

Implementation boundary for this draft:

- do not redesign chunk rows or vector storage in this phase
- do not try to eliminate persisted snapshots entirely
- do not let `passage-bm25` fall back to storing full text inside MiniSearch JSON again
- treat snapshot unification as a storage / consistency refactor, not a retrieval-quality project

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

Non-goals inside this phase:

- do not re-open semantic rewrite or multi-query runtime expansion without new evidence
- do not move query-aware recall-budget logic online just because it benchmarks well in a narrow setup
- do not add complexity whose only benefit is better rank precision inside an already-reranked top-25

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

Current experimental lexical evidence:

- `passage-bm25` already shows useful gains on `body + path/filename` queries and some body-local cases
- the most persistent remaining weakness is `body + title/heading` versus near-duplicate bilingual or template-like documents
- benchmark evidence so far says blind file-level constant tuning is not the right next lever

Immediate architectural conclusion for the experimental lexical path:

- incremental score tuning has already captured most of the low-risk wins
- the next meaningful quality jump requires separating retrieval lanes instead of blending more constants into one file score
- exact-prefix metadata retrieval, position-aware local passage evidence, and query routing are now the mainline path
- benchmark diff outputs by query type and `top1` win/loss counts remain the acceptance gate, but they are no longer the design driver by themselves

### Storage And Architecture Track

- revisit hybrid BM25 compression only after runtime correctness is stable
- keep the possibility of replacing more of the lexical stack open, but do not treat it as near-term default work
- require feature parity, acceptable recall, and acceptable runtime cost before reducing MiniSearch reliance further

## TODO

The experimental lexical backend now moves from "tune a passage-first BM25 variant" to "build a genuinely stronger multi-lane lexical architecture".

The route below is intentionally staged so quality can improve step by step without losing the current fallback path or UI integration.

### Ceiling Assessment

Current judgment:

- the experimental path is **not** yet near the absolute ceiling of the passage-first lexical architecture
- it **is** getting close to the ceiling of "keep the same fixed-passage structure and continue blending scores harder"
- future visible gains should come from mechanism upgrades, not another round of broad coefficient tuning

Interpretation:

- route-aware fusion, metadata exact lanes, and local-window reuse have already extracted most of the easy quality wins
- if further work is dominated by adding more `if` branches or retuning generic blend weights, expected gains are now small and regression risk rises
- the next meaningful gap-opening work should change the local decision structure: local window competition, decisive verifier behavior, mixed-script bridge handling, or selective phrase-signature admission

Execution rule from this point:

- prefer changes that create a stronger retrieval / decision mechanism
- treat benchmark gains as validation of the mechanism, not the mechanism itself
- do not spend a cycle on generic score tuning unless it is attached to one of the priority mechanism jumps below

### Complexity Discipline

This now becomes an explicit engineering rule for `passage-bm25` and any follow-up lexical backend work:

- when multiple fine-grained score terms are describing the same mechanism, prefer keeping the aggregate mechanism score and deleting the duplicate blend terms
- local explanation competition should be treated as the main reusable signal; do not keep extra union / anchor / compactness bonuses unless they demonstrably win a reusable hard family
- decisive local verifier should be treated as the main reusable verifier signal; exact-phrase micro bonuses should stay folded into verifier construction instead of being blended again later
- keep only the smallest effective safeguard for a known hard regression family; do not preserve a whole heuristic tree when one narrow guardrail is enough
- if a heuristic adds noticeable code and does not move benchmark families in a stable way, default action is removal, not more retuning
- new score terms should justify themselves in one of two ways only: they either own a distinct decision stage, or they produce a visible lift on a hard family without reopening old regressions

Practical rollback rule:

- if a change is best described as "another bonus or penalty inside the generic route score", assume it is low-priority unless it is the minimum effective guardrail for a live failure
- when quality is already preserved by an upstream aggregate signal, remove downstream duplicate bonuses first before adding any new term

### Meta Rules For The Next Lexical Backend

The detailed automation-facing meta rules now live in `src/services/search/hybrid/automation-design.md`.

This split is intentional:

- `DESIGN.md` stays focused on architecture, staging, and execution strategy
- `automation-design.md` becomes the single source of truth for detailed ranking invariants, family rules, planner rules, fallback rules, passage-shape tuning rules, and automated keep-or-revert protocol
- `src/services/search/passage-lexical/passage-lexical-ranker-tuning.ts` is the default tuning surface for automation; the benchmark controller should evaluate candidate manifests against that layer rather than owning a fixed grid itself
- `scripts/lexical-optimizer/automation-prompt.md` is the short operator prompt for Codex-style automation loops, while `automation-design.md` remains the higher-priority detailed rule file

Execution rule:

- any automation or agentic optimization loop for the next lexical backend must read `automation-design.md` before starting a cycle
- if a short prompt summary conflicts with the detailed file, `automation-design.md` wins

### Phase A: Metadata Exact-Prefix Lane

Status:

- active
- this is the first phase of the architectural rewrite

Goal:

- create a dedicated metadata lane for basename, alias, heading, and path-like exact-prefix retrieval
- stop relying on the general sparse scorer to also act as the short-title / path lookup engine

Implementation targets:

- independent metadata exact-prefix candidate generation
- contiguous token-sequence verification for basename / alias / heading
- composite path-like lanes such as `folder + basename`
- routing hooks so short-anchor and path-like queries can rank from this lane before generic file-score blending

Acceptance:

- `title_exact` and `title_prefix` should improve without hurting body-local benchmarks
- path-like short queries should become structurally easier to win
- the implementation should remain isolated inside `src/services/search/passage-lexical/`

### Phase B: Position-Aware Passage Lane

Status:

- active
- first-stage locality rescoring and verifier-frontier position features are in place
- matched-term variant positions now participate in locality / verifier scoring, not only raw exact query terms
- compact persisted position storage is still pending

Goal:

- upgrade the passage lane from bag-of-words BM25 plus verifier to position-aware local retrieval

Implementation targets:

- store compact term-position signals for top passage candidates
- add first-stage phrase / proximity / cover-density features
- reduce dependence on late verifier rescue for obviously local matches

Acceptance:

- clear gains on body-local `top1-5`
- fewer cases where the right file appears but the wrong local passage dominates
- interactive latency still acceptable on a few-hundred-megabyte vault

### Phase C: Query Router And Lane Fusion

Status:

- active
- route-specific fusion is now in use for `metadata_exact`, `path_anchor`, `mixed_anchor`, and `body_local`
- short-anchor specific sorting is now allowed to override the generic metadata route when strong basename-style evidence exists
- current next step is to replace the remaining coarse mixed branch behavior with more explicit title-anchor and path-anchor lane dominance

Goal:

- stop forcing one scoring recipe to satisfy every query class

Implementation targets:

- route `short_anchor`, `path_like`, `body_local`, and `mixed_anchor` queries differently
- let metadata lane and passage lane compete as peers instead of one being a bonus on top of the other
- make fusion structured: lane tier first, then lane score, then verifier evidence

Acceptance:

- stronger `top1` on both metadata-heavy and body-heavy queries
- fewer regressions from "fixing title queries broke body queries" style interactions

### Phase D: Local Verifier 2.0

Status:

- active
- ordered-span, minimum-cover-window, exact-phrase, and metadata-anchor agreement checks are already contributing
- tight ordered-pair checks and basename-vs-heading anchor agreement are now part of the verifier signal
- file-level `top-K passage` competition is now active so final ranking can distinguish decisive local evidence from diffuse multi-passage matches
- query-conditioned local-window scoring is now query-scoped and cache-backed, so the same passage is not rescored repeatedly across locality, verifier, and file aggregation
- file-stage passage-set scoring now reuses verifier/locality local-window evidence instead of eagerly recomputing it for every candidate file
- the remaining work is stronger bilingual / near-duplicate disambiguation and a more decisive final-stage verifier role

Goal:

- make the verifier a true local decision stage rather than a light additive bonus

Implementation targets:

- ordered-span checks
- minimum-cover-window and tight-span scoring
- better metadata-anchor agreement checks
- competitive `top-K passage` set scoring at the file stage
- stronger bilingual / template / near-duplicate disambiguation

Acceptance:

- better separation between near-duplicate docs sharing the same sparse anchors
- better `body + title/heading` ranking under ambiguity

### Phase E: Benchmark And Promotion Gate

Status:

- active
- web-notes-v2 plus adversarial / messy PKM synthetic cases are already part of the routine regression gate
- duplicate-title conflict, template-collision, and compact-vs-dispersed passage cases are now part of the synthetic gate
- `partial_memory` and `anchor_contradiction` families now include extra noisy-anchor variants without materially increasing runtime
- the next step is to keep hardening the synthetic cases whenever they stop discriminating between engines, while preserving benchmark speed

Goal:

- prevent local overfitting while proving the architecture is actually better

Implementation targets:

- extend benchmark coverage for short title, path-like, body-local, mixed-anchor, bilingual duplicate, and messy PKM layouts
- keep a small but high-signal synthetic set for duplicate siblings, template notes, and passage competition
- keep default benchmark runtime reasonable
- expose per-query diff outputs for the new lanes

Promotion gate:

- the experimental backend should beat `custom-bm25` on the body-first target, not just tie overall average
- `core` and `adversarial` both need to improve, especially `top1`
- if the new architecture wins only by benchmark fitting and not by mechanism, do not promote it

### Priority Roadmap From Here

This roadmap is ordered by expected product value, not by implementation convenience.

### Active reset: March 23, 2026

The previous experimental branch tried to push quality further through more aggressive
`decisiveBody` / `contentNoise` late scoring on top of the current passage stack.

What happened:

- that branch did not produce a stable benchmark lift
- it also introduced a concrete regression on the `tech-zh pod data` full-concept-set case
- repeated local coefficient tightening did not remove the regression cleanly

Decision:

- do not continue that branch
- keep the current stable passage backend as the working baseline
- the next quality push must come from a new decision mechanism, not from another round of generic late-score blending
- treat this as a local ceiling signal for the current fixed-passage blending shape, not as evidence that the broader passage-first direction has run out of room

Immediate execution rule:

- no more broad coefficient sweeps unless attached to a narrow mechanism with its own benchmark slice
- the next implementation should start with candidate-structure changes that can open a real gap over `MiniSearch`
- benchmark work should be expanded only where it improves diagnosis, not just corpus size
- do not reintroduce a broad `basename/title coverage` gate in mixed sorting; local experiments showed that it reopens `namespace vs pod-lifecycle` and `secret/configmap` regressions without lifting the full benchmark

What now counts as a high-quality fruit:

- it improves a concrete hard family that currently matters to real use, especially `topic_collision`, `body_path_anchor`, `partial_memory`, or mixed-script technical search
- it changes the decision structure or candidate structure rather than adding another generic blend term
- it preserves or improves the current global guardrails instead of borrowing wins from already-strong families
- it is explainable in product terms: "why this note should beat its sibling" must be clearer after the mechanism lands

What does **not** count as a high-quality fruit anymore:

- another broad coefficient sweep over `bodyCore`, verifier, metadata, or mixed bonuses
- a benchmark-only heuristic that wins one synthetic query family without a reusable decision rule
- a larger or slower mechanism that cannot show a visible `top1` lift on the hard families

Active execution order from here:

1. strengthen route-specific candidate decision for `body + metadata-anchor` mixed queries
2. add decisive local winner selection on close candidates instead of more additive scoring
3. only then revisit selective topic corroboration, and only as a narrow decision lane
4. keep benchmark additions small and diagnostic so iteration speed stays high

#### Immediate mechanism track A: Document-Topic Corroboration

Current status:

- paused as a generic late-score path
- the broad version did not produce a stable lift and introduced regression risk

Why it still matters:

- several remaining misses are not caused by missing lexical recall; they fail because multiple files share the same surface terms, but only one file has the correct dominant topic neighborhood
- the problem is real, but the last attempted attachment point was too generic
- it is especially relevant for `content_noisy`, concept-family collisions, and "query terms appear everywhere but only one note is really about that thing" failures

Mechanism idea:

- derive a lightweight per-file topic sketch from the existing sparse index rather than adding a heavy new embedding path
- separate `topic terms` from `incidental local terms`
- reward files whose strongest local windows are corroborated by the file-level topic sketch, and penalize files that only have one lucky local hit against an off-topic document body

Design shape:

- build a compact document-topic signature from rare/body-skewed terms and selective ordered pairs
- keep the signature small and query-agnostic; it should be a corroboration channel, not a second full index
- if revisited, use it only in a narrow late candidate decision stage after candidate narrowing, not as another broad score bonus
- do not let topic corroboration override truly exact metadata-first lookups

Primary targets:

- `content_noisy`
- same-family concept collisions like `configmap` vs `secret`
- long notes where one paragraph matches but the note is mostly about something else

Acceptance:

- visible `top1` lift on `content_noisy`
- fewer "one lucky paragraph beats the actually-about-this-topic file" cases
- no material regression on `title_exact`, `title_prefix`, or obvious metadata-first queries

Promotion rule:

- do not resume this track unless a narrow decision-stage version clearly outperforms the current stable baseline on `topic_collision`-style cases without reopening `tech-zh pod data`

#### Immediate mechanism track B: Body-Path-Anchor Candidate Decision

Current status:

- active
- this is now the highest-priority implementation track

Why this is now first:

- the current planner correctly recognizes many path/body mixed queries, but the late decision is still too dependent on generic blended scores
- `body_path_anchor` is already a relative strength; making it decisive is a high-value way to open a wider gap over `MiniSearch`
- the failed `tech-zh pod data` experiment showed that this should not be solved by more generic body boosts
- this same decision family also covers a large part of `topic_collision`: one candidate has the right anchor neighborhood, but another sibling has tempting broad body overlap

Mechanism idea:

- treat `bridge/path-like metadata + decisive body evidence` as its own decision family
- require an explicit two-part win:
  - a metadata/path anchor that places the file in the right neighborhood
  - a compact local body explanation that actually says the target thing

Design shape:

- keep candidate generation permissive enough to retain recall
- perform a dedicated late candidate decision over only the narrow path/body frontier
- use route-specific evidence such as:
  - bridge-term satisfaction
  - path/folder/basename agreement
  - compact body corroboration around the non-metadata terms
  - anti-drift penalties when only the path matches but the body topic is wrong
- avoid sharing this decision logic blindly with pure `path_like` or pure `body_local` queries

Implementation rule:

- favor explicit close-candidate winner selection over more additive route score terms
- when two candidates are close, prefer the one whose metadata anchor and compact body explanation support the same interpretation
- penalize candidates whose metadata/path anchor is attractive but whose best local body explanation resolves to a different topic

Primary targets:

- `body_path_anchor`
- mixed Chinese-English technical queries like `tech-zh pod data`
- `path/folder +正文` and `标题部分词 +正文` combinations

Acceptance:

- `body_path_anchor` benchmark family moves up materially in `top1`
- `tech-zh` family gains come from route-specific decisions, not from global weight inflation
- full-concept-set adversarial cases stop flipping to sibling documents with the wrong dominant topic
- `topic_collision` should improve when the intended winner has a better anchor-supported local explanation, even if a sibling has broader generic body overlap

#### Immediate benchmark track: Harder But Bounded

Goal:

- make benchmark failure modes more diagnostic without letting routine runtime drift too far upward

Principles:

- prefer harder queries over simply more queries
- add small, mechanism-targeted families rather than another large generic corpus
- every added family must correspond to a concrete failure mode or product scenario

Next benchmark families to add:

1. topic-collision hard set

- same folder / same concept family / overlapping vocabulary
- examples: `configmap` vs `secret`, `service` vs `ingress`, `deployment` vs `pod`
- target: test whether the winner is the file actually about the query topic

2. body-path-anchor hard set

- path/folder clue plus partial body memory
- include both clean and adversarial siblings
- explicitly include mixed-script and locale-marker variants such as `tech-zh`

3. partial-memory noisy set

- only part of the true phrase is remembered
- add common connector noise and broad domain terms
- target: distinguish genuine topic corroboration from accidental dense term overlap

4. metadata-body contradiction set

- a file wins metadata/path evidence but loses body-topic evidence
- a sibling wins body-topic evidence but has weaker or missing metadata agreement
- target: validate the new route-specific decision boundary

5. bilingual mirror discrimination set

- zh/en mirrors, slug anchors, locale markers, and body clues
- target: force the backend to choose the intended locale/file, not just any mirror sibling

Runtime guardrail for the expanded benchmark:

- keep the default benchmark under roughly the current day-to-day comfort range
- if a harder family is expensive, gate it behind a dedicated mode rather than bloating the default suite
- prefer adding `20-60` sharp queries over adding another broad corpus snapshot

#### Priority 1: Query-Conditioned Local Window Competition

Status:

- active
- first implementation slice is now in place: query-scoped `top-K` local explanation extraction and file-stage local explanation competition are wired into the passage backend
- the next remaining step is to make those explanations more decisive in the final verifier / late-stage decision, not merely another additive score source

Why this is first:

- the current fixed-passage unit still leaves quality on the table when only one very small local region is actually decisive
- this is the most promising route for opening a visible gap over `MiniSearch` on long-note clutter, duplicate siblings, template contamination, and "all terms exist but only one place actually says the thing" queries

Implementation targets:

- generate short local windows around rare terms, anchor terms, and high-signal ordered pairs
- let each file compete with its best `2-3` local explanations, not only one aggregated passage score
- compute local-window evidence only on the narrow locality / verifier frontier and reuse it downstream

Current implementation note:

- the backend now caches distinct local explanations per passage on the locality / verifier frontier instead of only the single best window
- file-stage ranking can now reuse those cached explanations and reward the best `2-3` local windows with novelty-aware aggregation
- remaining work should focus on making the verifier choose among competing explanations more decisively and validating the lift on broader hard benchmarks

Acceptance:

- higher `top1` on body-local and mixed-anchor hard queries
- fewer cases where the right file is in `top5` but the wrong local explanation wins `top1`
- latency remains within the current interactive guardrails

#### Priority 2: Decisive Local Verifier

Status:

- active
- first implementation slice is now in place: verifier signals are cached structurally, file-stage ranking reuses them, and duplicate-family path penalties are wired into late body/mixed decisions
- current verifier is still not the final decision-maker yet, but it is no longer only a flat additive bonus

Why this is second:

- the next large quality jump depends on making the verifier choose among competing local explanations rather than merely add proximity points
- this is the most promising route for archive-vs-live siblings, template-vs-real-note separation, and duplicate-family disambiguation

Implementation targets:

- make final ranking depend more directly on the best supported local explanation
- add support-span logic, stronger duplicate-family disambiguation, and more explicit anchor-agreement checks
- let verifier evidence dominate late decisions when the candidate set is already narrow

Current implementation note:

- verifier now emits structured per-passage signals instead of only a scalar bonus
- file-stage scoring reuses support-span and verifier-local agreement signals for late ranking
- template / archive / draft-style duplicate families now receive a narrow penalty only on body-local and mixed-anchor routes
- verifier activation is now qualified more narrowly, so weak local hints do not automatically become file-level decisive evidence
- body-local scoring now penalizes verifier overreach when it is not corroborated by compact local-explanation competition, which helps same-title archive/live siblings
- path-dominant mixed routes now use a much weaker verifier contribution so body-path queries are less likely to be distorted by unrelated local verifier spikes
- remaining work should focus on making the verifier choose among rival local explanations even more explicitly, rather than only pushing the late score

Acceptance:

- cleaner separation on near-duplicate, template, and heading-collision families
- higher `top1` on partial-memory and mixed-anchor ambiguity cases

#### Priority 3: Mixed-Script And Alias Bridge Lane

Status:

- high-value unresolved gap
- should be treated as a first-class lexical problem, not a tokenizer side effect

Why this is third:

- `tech-zh` remains one of the clearest remaining weak zones
- mixed Chinese-English technical search quality is a strong user-facing differentiator and a place where `MiniSearch` is structurally weak

Implementation targets:

- bridge `slug`, locale marker, alias, acronym, and joined-term variants explicitly
- add selective mixed-script local-order features where they improve local-body ranking
- keep bilingual mirror-note disambiguation narrow and query-conditioned

Acceptance:

- `tech-zh` `top1` moves materially upward
- bilingual / mixed-script mirror-note queries become more discriminative without widening the index indiscriminately

#### Priority 4: Selective Phrase-Signature Admission

Status:

- valuable but should follow the two decision-structure upgrades above
- the first query-time trial was rejected: computing selective ordered-pair signals inside local-window, locality, and verifier stages did not improve the benchmark and materially hurt latency
- do not revive that three-stage query-time form; if this track returns, it should come back only as a much narrower admission / decision-stage mechanism or as a compact indexed sparse channel

Why this is fourth:

- selective ordered-pair / phrase-signature signals can improve body-local `top1` without paying the full cost of a heavy positional index
- this is a strong complement to local windows and verifier competition

Implementation targets:

- index only high-signal ordered pairs / phrase signatures
- use them for admission and local competition, not generic global score dumping
- never recompute them broadly across local-window, locality, and verifier on the hot path
- keep storage growth controlled and mechanism-specific

Acceptance:

- better top1 on sentence-fragment and compact local evidence queries
- no material latency regression and no uncontrolled index blow-up
- must beat the stable baseline on `topic_collision`-style cases without reopening `tech-zh pod data`

#### Priority 5: Metadata Exact-Prefix Dominance Completion

Status:

- still important, but no longer the main gap-opening route

Why this is fifth:

- it matters for replacement readiness, especially `title_prefix`
- but it is less likely than the routes above to create a large visible gap over `MiniSearch` on body-first search quality

Implementation targets:

- finish independent metadata exact-prefix candidate generation
- strengthen `basename / alias / heading / folder-basename` dominance for short metadata-first queries
- preserve isolation inside `src/services/search/passage-lexical/`

Acceptance:

- `title_exact` and `title_prefix` no longer lag the stable lexical backend
- metadata-first short lookups improve without sacrificing body-local wins

#### Priority 6: Harder Benchmark Families

Status:

- always-on guardrail work
- should validate mechanism upgrades rather than replace them

Execution rule:

- only add benchmark families that expose a real retrieval failure mode
- keep the hard set small, sharp, and diagnostic
- preserve routine runtime for day-to-day use

### Stage Checkpoint: March 23, 2026

This checkpoint exists so future work does not dissolve the current gains back into generic score tweaking.

Scope of this checkpoint:

- only the experimental backend in `src/services/search/passage-lexical/`
- current benchmark command: `node node_modules/jest/bin/jest.js --config jest.file-search-web-benchmark.config.js --runInBand tests/src/services/search/file-search-web-benchmark.bench.ts`
- current corpus snapshot: `60` notes and `267` queries on `web-notes-v2` plus the synthetic adversarial / messy PKM set

Current headline metrics:

- `PassageBM25`: `top1=0.757`, `top5=0.940`, `zeroRate=0.052`, `avg=7.653ms`, `p95=23.973ms`
- `MiniSearch`: `top1=0.678`, `top5=0.854`, `zeroRate=0.146`, `avg=54.983ms`, `p95=121.711ms`
- `CustomBM25`: `top1=0.652`, `top5=0.865`, `zeroRate=0.127`, `avg=0.558ms`, `p95=0.795ms`

What this milestone has already proven:

- the experimental path now clearly beats both baselines on the body-first target, not just on one cherry-picked family
- `adversarial` quality is materially above both baselines, which is the strongest signal that the architecture is doing more than weight tuning
- query-conditioned local-window competition plus route-aware file fusion is a real mechanism lift, not a cosmetic rescoring trick
- latency is back in the interactive range after query-scoped caching and frontier reuse, so the new mechanism is no longer obviously too expensive to iterate on
- a lightweight verifier exact-phrase path optimization can be promoted without changing ranking behavior or hurting benchmark stability

Current differentiators worth protecting:

- `content_noisy`: `0.375` vs `0.063` for `MiniSearch` and `0.000` for `custom-bm25`
- `mixed_anchor`: `0.875` vs `0.813` for both baselines
- `body_path_anchor`: `0.829` vs `0.800` for `MiniSearch` and `0.657` for `custom-bm25`
- `partial_memory`: `0.667` vs `0.000` for `MiniSearch`
- `anchor_contradiction`: `1.000` vs `0.333` for `MiniSearch`

Known weak spots at this checkpoint:

- `title_prefix` is still weaker than `custom-bm25`, so metadata-first short lookups are not yet dominated end to end
- `tech-zh` `top1` remains only `0.492`, so mixed-script / Chinese technical retrieval still has headroom
- `content_noisy` improved sharply but is still only `0.375`, which means noisy body-memory queries remain a major frontier
- the experimental index is much larger than both baselines, so quality work should continue to justify its storage cost
- `bilingual_mirror` is now covered but not yet discriminative, so it should stay small until a stronger mixed-script mechanism lands

Do-not-lose guardrails for future work:

- keep `PassageBM25 top1 >= 0.75`
- keep `PassageBM25 top5 >= 0.93`
- keep `PassageBM25 adversarial top1 >= 0.74`
- keep `PassageBM25 zeroRate <= 0.06`
- keep `PassageBM25 avgMsPerQuery <= 10`
- keep `PassageBM25 p95 <= 30ms`

Recommended interpretation:

- this is the right moment to extract and preserve the current milestone
- next work should aim at another mechanism jump such as query-conditioned local windows, a more decisive verifier, mixed-script bridge handling, or phrase-signature admission
- do not go back to broad coefficient tuning unless it is attached to one of those stronger mechanisms
- see `benchmarks/file-search-web-harvest.md` for the structured harvest package: milestone summary, weakness ranking, guardrails, and staged roadmap

Current ceiling interpretation:

- the project is near the ceiling of generic fixed-passage score blending
- it is not near the ceiling of the broader passage-first architecture
- the remaining large gains should come from changing the decision unit and decision stage, not from another coefficient sweep

### Gap-Opening Routes Against MiniSearch

This section is intentionally about ceiling, not local polish.

If the goal is to visibly beat MiniSearch in felt search quality, the next work should favor mechanisms that MiniSearch does not natively have, instead of further generic sparse weight tuning.

Highest-upside paths:

1. query-conditioned local window competition

- stop treating fixed passages as the only local unit
- build short candidate windows around rare terms, anchor terms, and tight ordered pairs
- let each file compete with its best 2-3 local windows, not just a single aggregated sparse score
- current implementation note: local-window evidence should be computed only on the narrow locality / verifier frontier and then reused downstream, otherwise latency expands too quickly
- this is the most promising path for same-title siblings, long-note clutter, template contamination, and "all terms exist but only one place actually says the thing" queries

2. structured query decomposition before scoring

- explicitly split a query into metadata anchors, body evidence terms, and likely-noise terms
- mixed queries should not be scored like pure body queries or pure title queries
- anchor-compatible local evidence should outrank stronger global term frequency when the body span and anchor agree
- this is the most promising path for `body + title`, `body + path`, and partial-memory queries

3. stronger local decision stage instead of additive verifier bonus

- the verifier should choose among competing local explanations, not merely add a few proximity points
- file ranking should increasingly depend on the best supported explanation: decisive span, support span, duplicate-family disambiguation, and anchor agreement
- this is the most promising path for near-duplicate notes, archive-vs-live siblings, and template-vs-real-note separation

4. lightweight phrase-signature or ordered-pair sparse channel

- index only a selective set of high-signal ordered pairs / phrase signatures instead of a full heavy positional index
- use that channel for admission and local competition, not as a generic score dump
- this is the most promising path for top1 gains on body-local and sentence-fragment queries without exploding latency

5. mixed-script and alias bridge lane

- treat mixed Chinese-English retrieval as a first-class lexical problem, not a side effect of general tokenization
- include bridge features such as acronym / slug / joined-term variants, plus selective CJK-local order features
- this is the most promising path for bilingual PKM and mixed terminology queries where MiniSearch tends to flatten evidence

Deprioritized paths:

- more global BM25 constant tuning
- more generic file-level blend coefficients
- widening prefix/fuzzy expansion without changing the decision structure
- adding benchmark-only heuristics that do not correspond to a stronger retrieval mechanism

### Benchmark Hardening Next

The benchmark should now get harder in ways that mirror real search failure modes, not just by adding more easy synthetic cases.

Next hard-query families:

- duplicate siblings with nearly identical title, headings, and folder structure, where only one has a decisive local body span
- real note versus template, where the template has stronger metadata exactness but weaker semantic body evidence
- bilingual mirror notes, where both files share major Latin tokens and the query mixes Han plus Latin anchors
- compact local passage versus dispersed bag-of-words distractor inside long files
- mixed-anchor contradiction queries, where one title/path anchor is tempting but the body evidence points elsewhere
- partial-memory natural queries, where the user remembers one correct anchor, two body clues, and one noisy or slightly wrong term
- heading-collision families, where multiple notes reuse the same heading but only one local span actually resolves the intent

Benchmark design rules:

- prefer fewer but sharper hard negatives over a large volume of weak synthetic cases
- a hard query should usually be incomplete, mixed-intent, or slightly noisy rather than an exact title lookup
- keep per-family examples small but representative so runtime stays practical
- track win/loss by hard family, not only global averages

Promotion gate for harder benchmark batches:

- the experimental backend should beat MiniSearch on `top1` for the new hard families, not just tie overall average
- if a new hard family does not separate engines, either harden it further or remove it
- benchmark additions should remain diagnostic: they should explain failure modes, not just raise the total query count

Immediate next steps after the current pass:

- improve partial-memory families with one correct anchor, two decisive body clues, and one intentionally misleading metadata token
- strengthen bilingual duplicate / mirror-note hard cases only if they remain diagnostic at small query counts
- if verifier early termination is revisited, require an upper-bound-backed or feature-local design; naive frontier clipping should not be promoted

### Current execution reset: March 23, 2026 (fruit 1 + fruit 2)

The next implementation phase should focus on only two mechanism-level fruits:

1. decisive core witness lane
2. contrastive sibling topic discriminator

Reason for this narrowed scope:

- the current backend is already near the ceiling of adding more blended score terms
- the remaining benchmark gap is no longer mainly a retrieval-recall gap
- the high-value misses now mostly come from choosing the wrong local explanation or the wrong sibling document after recall already succeeded
- these two fruits attack the current weak zones directly: `content_noisy`, `partial_memory`, and `topic_collision`

#### Fruit 1: Decisive Core Witness Lane

Goal:

- make ranking depend on whether a candidate contains a compact local witness span for the decisive remembered body clues, not just broad body overlap

Problem it solves:

- today the query decomposition is still too coarse: `anchor / body / noise`
- that shape is enough to improve mixed queries, but not enough to distinguish decisive remembered clues from generic support words
- as a result, `content_noisy` and `partial_memory` queries can still be hijacked by files with broad overlap and one lucky span

Design shape:

- upgrade decomposition from `anchor / body / noise` into a stronger decision-oriented split:
  - metadata-anchor
  - locale-anchor
  - decisive-body-core
  - support-body
  - suspect-noise
- compute a compact `core witness` score only from local spans that satisfy enough decisive body core
- require support terms to help, but do not let them replace missing decisive body core
- reward files whose best local explanation contains a witness span rather than only broad file-level co-occurrence
- keep this lane narrow and local; do not turn it into another global additive score dump

Implementation slices:

1. stronger query-term role assignment

- detect the rarest / most body-skewed query terms and mark them as `decisive-body-core`
- demote broad connector-like or metadata-dominant terms into `suspect-noise`
- keep path / basename / locale markers outside the body-core set even when they are rare

2. local witness extraction

- for each candidate passage / local explanation, compute whether there exists a compact span covering enough decisive body core
- record witness compactness, witness coverage, and witness-support balance
- when no witness exists, do not let broad coverage fully substitute for it on body-local or noisy-memory routes

3. route-specific late decision

- make `body_local`, `mixed_anchor`, and partial-memory-like cases depend more directly on witness presence
- keep metadata-exact and short-anchor routes mostly isolated from this mechanism

Primary targets:

- `content_noisy`
- `partial_memory`
- the body-heavy part of `body_path_anchor` / `body_title_anchor`

Acceptance:

- visible `top1` lift on `content_noisy`
- fewer partial-memory misses caused by one noisy term or broad off-topic overlap
- no regression on exact metadata-first families

#### Fruit 2: Contrastive Sibling Topic Discriminator

Goal:

- when recall already brings back multiple same-family candidates, choose the file whose local evidence matches its own dominant topic rather than the sibling that merely shares vocabulary

Problem it solves:

- current late decisions still rely too much on positive evidence inside each file independently
- in `topic_collision` cases, multiple sibling files often look individually plausible because they share folder, title fragments, and domain vocabulary
- the missing step is contrastive: the engine should ask why one sibling is more about this concept than the others

Design shape:

- build a lightweight contrastive topic sketch per file or duplicate family using already-available sparse signals
- prefer body-skewed rare terms and stable concept markers, not broad domain words
- use this sketch only on a narrow close-candidate frontier
- compare candidates against each other; do not attach the sketch as another universal global bonus

Implementation slices:

1. sibling / family grouping

- derive narrow comparison families from basename similarity, folder locality, locale mirror structure, or overlapping metadata anchors
- only activate the contrastive mechanism when candidates are genuinely close and likely confusable

2. lightweight contrastive signature

- compute a small set of topic markers from body-skewed / rare terms already present in the sparse index
- separate shared-family vocabulary from file-specific topic markers
- no heavy positional index and no new embedding path

3. contrastive late decision

- on close-candidate families, reward the file whose best local explanation is corroborated by its contrastive topic sketch
- penalize files that only win through shared family vocabulary plus one weak local hit
- keep this mechanism after candidate narrowing so latency stays interactive

Primary targets:

- `topic_collision`
- concept-family pairs such as `configmap` vs `secret`, `service` vs `ingress`, `namespace` vs `pod-lifecycle`
- mixed locale mirror / sibling collisions when both files share Latin anchors

Acceptance:

- visible `top1` lift on `topic_collision`
- fewer same-family sibling flips on full-concept-set queries
- no reopening of `tech-zh pod data`-style regressions

Execution order:

1. land fruit 1 first, because it should improve the largest real-user failure family without increasing index size
2. land fruit 2 second, because it depends on stronger local witness evidence to avoid becoming another broad topic bonus
3. only after both land, reassess whether phrase-signature admission is still worth revisiting

Non-goals during this phase:

- no broad coefficient sweeps
- no hot-path phrase-signature recomputation
- no benchmark-only heuristic that cannot be explained as a reusable decision rule

## Future Improvements

Current mainline follow-ups:

- finish file-event consistency closure under rename and repeated modify bursts
- complete rebuild preflight, quota guardrails, and large-vault stability validation
- make hybrid state and fallback reasons visible in developer mode summaries
- keep the local runtime rebuild benchmark usable for regression detection
- improve HNSW recall on lexical-failure-like queries
- add hybrid-only normalization only when it is clearly isolated from `lexicalengine`
- revisit storage compression only after stability and consistency goals are stable
- for `passage-bm25`, follow the staged rewrite in the TODO section rather than continuing generic score blending

Priority follow-up object:

- chunk-level incremental embedding reuse should be treated as the main future lever for reducing hybrid token cost on large, frequently edited files
- compared with rename-specific stale-context machinery, this is expected to deliver meaningfully higher token savings for roughly the same or better product value

## TODO: Snapshot Unification Rollout

This work should be executed as a short staged refactor rather than a large all-at-once rewrite.

### Stage 1: Lock Semantics And Persistence Shape

Goals:

- formalize `generation` vs `indexedAt`
- stop `passage-bm25` from persisting full plain text inside its serialized snapshot
- define the shared snapshot row as the only persisted full-text source of truth for indexed text

Concrete tasks:

- change the `passage-bm25` serialized snapshot format so it contains only index structure and file refs, not `documents[].content`
- update restore logic so full text is loaded via `FileSnapshotStore`
- audit hybrid indexed-file refs and snapshot writes so `generation` always means source version
- keep `indexedAt` only where it is actually useful for diagnostics

Acceptance:

- no persisted duplicate full text between `passage-bm25` snapshot data and shared file snapshots
- restore still works without forcing a full lexical rebuild
- generation semantics are documented and reflected in code comments / types

### Stage 2: Collapse FileSnapshotStore To One Memory Cache

Goals:

- remove `indexedSnapshotCache`
- keep only one memory cache with generation-aware entries

Concrete tasks:

- change `currentFileCache` to store `{ text, generation }`
- update read APIs to support both "latest text" and "indexed-aligned text"
- make indexed-aligned reads use current cache only on generation match, otherwise use persisted snapshots
- remove preload / status logic that only exists to support the second cache

Acceptance:

- one in-memory full-text cache only
- no correctness regression on rename / modify / delete flows
- high-performance mode still behaves predictably

### Stage 3: Rewire Runtime Update Flow

Goals:

- make watcher-driven updates propagate one sampled source generation through cache, index, and snapshot writes
- avoid mixed-generation cache poisoning

Concrete tasks:

- on watcher flush, read the latest text once and write `currentFileCache[path] = { text, generation: file.stat.mtime }`
- pass the same generation into lexical and hybrid incremental updates
- after successful update, persist the same text into shared snapshots
- make stale completion paths unable to overwrite newer current-cache state

Acceptance:

- repeated modify bursts do not create cache/index generation drift
- rename and delete paths still converge cleanly
- no extra full-text copies are introduced during runtime updates

Status: mostly completed on March 26, 2026

Landed:

- watcher/runtime flow now propagates a single `sourceGeneration` through current-cache priming, lexical update, hybrid repair scheduling, and shared snapshot commit
- `currentFileCache` now rejects stale writes by generation, so older completions do not overwrite newer current text
- reduced doc-operation batches preserve `sourceGeneration`
- repeated upsert / rename+modify reducer behavior is now covered by tests

Remaining gap:

- there is still no higher-level integration test that drives a realistic `DataManager` rename / modify burst end-to-end across lexical plus hybrid runtime state
- current confidence comes from targeted reducer tests, snapshot restore tests, and passage runtime tests rather than one full-stack burst test

### Stage 4: Cleanup, Migration, And Verification

Goals:

- remove dead compatibility paths
- verify size and runtime benefits

Concrete tasks:

- remove old `passage-bm25` full-document snapshot compatibility once migration is safe
- trim now-unused restore glue in data-manager and file-search-engine
- run rebuild / restore / modify-burst validation
- measure persisted size change and startup / search regression risk

Acceptance:

- smaller persisted lexical footprint
- no functional regression in lexical or hybrid search
- codebase is simpler than before the refactor, not just differently complex

Status: partially completed on March 26, 2026

Completed:

- old `passage-bm25` full-document snapshot compatibility was removed instead of being kept indefinitely
- startup restore glue that copied passage snapshot document content back into an indexed-snapshot cache was removed
- dead dual-cache code in `FileSnapshotStore` was removed together with its preload / status branches
- snapshot size and restore behavior were revalidated with the passage serialization benchmark

Still to do:

- add a more realistic rebuild / rename / modify-burst integration validation beyond the current focused tests
- do one explicit post-refactor check of persisted storage breakdown and startup restore behavior on the real plugin path, not only the passage benchmark path
