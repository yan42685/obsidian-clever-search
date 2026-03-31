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
  - `benchmarks/coverage-lexical-size-latency-baseline-body-evidence-matcher-precompute.md`
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
  - `CoverageLexical`: 286.625 KB
- current size ratio reference:
  - `CoverageLexical / MiniSearch`: `4.94`
- current relevant structure reference points:
  - `documentIdentity.total`: 2,644 bytes
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

## Immediate Next Step

- slim `CoverageLexicalDocument` first:
  - keep only raw source fields needed for direct subitems and delete-time rebuild
  - keep query-hot token and tag arrays in maintained doc-id side storage
  - remove query-cold derived per-document sets from live resident memory
- validate the first cut with:
  - coverage benchmark
  - startup snapshot benchmark
  - index breakdown
- do not optimize persisted encoding density aggressively before the live document layout settles
