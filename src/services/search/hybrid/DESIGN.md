# Hybrid Search Design

## Summary

This hybrid search pipeline combines:

- BM25 lexical recall
- dense HNSW recall
- Qwen reranking

The current implementation uses small chunks only.

## Retrieval Flow

For each query:

1. BM25 returns top 20 chunks
2. HNSW returns top 20 chunks
3. The two lists are deduplicated by chunk id
4. Deduplicated chunks are sent to `qwen3-rerank`
5. The reranker output count is controlled by plugin settings
6. Returned chunks are grouped by file for UI display

The UI groups by file, but the result limit is applied to chunks, not files.

## Chunk Storage

`hybridChunks` stores only document-facing data:

- `id`
- `filePath`
- `chunkIndex`
- `text`
- `startLine`
- `startCol`
- `endLine`

Chunk rows no longer store vectors.

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

## Database Layout

Current hybrid-related tables:

- `hybridChunks`
- `hybridChunkVectors`
- `hybridBm25Index`
- `hybridHnswSmall`
- `hybridDocRefs`
- `hybridTokenStats`

DB version upgrades clear hybrid tables and trigger rebuilding.

## Search Output Semantics

- rerank input size is fixed by recall limits
- rerank output size is controlled by settings
- if rerank returns `N` chunks, the UI displays `N` chunks total
- files are only grouping containers in the UI

## Fallback Behavior

If query embedding fails:

- semantic recall is skipped
- BM25 results still feed rerank when possible

If rerank fails:

- results fall back to recall ordering

## Dev Storage Stats

Developer mode reports:

- total indexable vault size
- estimated plugin storage size
- current vector quantization
- table-level storage usage
- chunk text vs metadata
- vector shard ids/data/scale/metadata

## Future Improvements

Possible next steps:

- binary encoding for HNSW graph persistence
- dedicated runtime vector store abstraction
- more compact scale encoding
- lower `HNSW_M` if storage pressure is still high
