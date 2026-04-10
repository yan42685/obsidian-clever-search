# Coverage Lexical Minimum Binary Schema Draft

Date: 2026-04-01

## Goal

- define the smallest persisted binary contract that can support:
  - fast startup hydration
  - future storage compression
  - later self-heal
- avoid over-designing the first format around every current in-memory detail

## Design Principles

- the schema should mirror the binary-friendly live layout closely
- the first schema should optimize for:
  - direct restore
  - stable ids
  - section boundaries
  - forward compatibility
- the first schema should not yet optimize every byte if doing so would obscure correctness or incremental repair

## Version 1 Scope

Version 1 should persist enough state to restore the current engine without rebuilding semantic meaning from source documents:

- document identity
- string pool
- lexicon terms referenced by postings
- postings directories and posting payloads
- per-document token references needed by query-time body evidence and passage admission
- tag-value references needed by tag fallback

Version 1 should not try to solve everything:

- no cross-version backward-compatibility promise beyond explicit schema version checks
- no aggressive entropy coding
- no partial-section patching yet
- no deduplicated phrase automata or advanced suffix structures yet

## Top-Level File Layout

Recommended section order:

1. file header
2. section directory
3. string pool
4. document table
5. lexicon table
6. postings directory
7. postings payload arena
8. document token arena
9. document tag arena
10. optional checksum trailer

## Header

Fixed-size header fields:

- magic:
  - `CLXS`
- schemaVersion:
  - `1`
- endianness marker
- feature flags
- plugin build compatibility hash
- section count
- root checksum or trailer offset

Purpose:

- reject incompatible snapshots cheaply before allocating large buffers

## Section Directory

Each section entry should include:

- section kind
- byte offset
- byte length
- element count
- encoding flags

Minimum section kinds:

- `string_pool`
- `doc_table`
- `lexicon`
- `postings_directory`
- `postings_payload`
- `doc_tokens`
- `doc_tags`

## String Pool

Store all repeated strings once and refer to them by `stringId`.

Initial contents:

- document paths
- metadata strings that remain materialized
- lexicon terms
- tag values

Recommended shape:

- one UTF-8 byte arena
- one offset table
- one length table

Why this matters:

- removes repeated path and term storage from both snapshot and restored live layout
- makes future compression and checksumming simpler

## Document Table

One row per `docId`.

Minimum fields:

- `docId`
- `pathStringId`
- `bodyTokenStart`
- `bodyTokenCount`
- `tagValueStart`
- `tagValueCount`
- document state flags

Optional later fields:

- document fingerprint
- last indexed revision marker
- delete tombstone bit

## Lexicon Table

One row per term family entry referenced by postings.

Minimum fields:

- `termId`
- `stringId`
- term class flags:
  - body
  - metadata
  - phrase
  - char
  - tag
- postings directory start index
- postings directory count

## Postings Directory

One row per postings bucket.

Minimum fields:

- bucket kind
- `termId` or `familyId`
- payload offset
- payload byte length
- posting count
- encoding kind

Typical bucket kinds:

- body exact
- body phrase
- metadata exact
- metadata field exact
- tag exact
- char postings

## Postings Payload Arena

This is the main compression target after schema freeze.

Version 1 recommended encoding:

- sorted `docId` lists
- delta-coded integers
- varint encoding

Why start here:

- high-cardinality postings dominate footprint
- the encoding remains sequential and easy to hydrate

## Document Token Arena

Persist per-document body token references needed for:

- body evidence tracing
- passage admission
- local-window reranking

Recommended representation:

- per-doc token stream as `termId` sequence where possible
- fall back to string ids only where raw token surfaces are still needed

Migration rule:

- if a token representation is needed only because the live layout is still string-heavy, prefer fixing the live layout rather than baking that inefficiency into the schema

## Document Tag Arena

Persist per-document tag values required for tag fallback and metadata ranking.

Recommended representation:

- `stringId` sequence per document

## Trust And Invalidation Inputs

The snapshot should carry enough metadata to choose between:

- trust and hydrate
- hydrate then self-heal
- reject and rebuild

Minimum trust inputs:

- schema version
- plugin build compatibility hash
- vault fingerprint mode identifier
- vault fingerprint value

Recommended initial fingerprint mode:

- aggregate cheap vault fingerprint over indexed files:
  - path
  - mtime or revision marker
  - size

## Why Not Compress Everything First

Because there are two different questions:

1. what is the persisted shape?
2. how densely is that shape encoded?

If we try to answer question 2 before freezing question 1, we risk:

- compressing the wrong live layout
- adding translation code that will be deleted later
- paying migration cost twice

The right sequence is:

1. make the live layout sufficiently numeric and section-friendly
2. freeze a small binary schema contract
3. compress inside that contract

## Immediate Implementation Plan

1. add a `CoverageLexicalSnapshotV1` writer and reader behind a feature flag
2. persist only the minimum sections listed above
3. validate round-trip integrity on a small corpus
4. benchmark:
   - snapshot write
   - snapshot hydrate
   - rebuild-only startup
5. only after that:
   - delta-tune postings payload encoding
   - compress token and tag arenas further
