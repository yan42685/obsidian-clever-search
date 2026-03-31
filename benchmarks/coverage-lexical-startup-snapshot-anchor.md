# Coverage Lexical Startup And Snapshot Pre-Binary Anchor

Date: 2026-04-01

## Purpose

- freeze a dedicated startup and persisted-index anchor before the first binary snapshot implementation lands
- keep startup interpretation separate from the query benchmark so query-speed noise does not hide hydration or rebuild wins
- define the exact benchmark contract now, before schema and self-heal work start diverging

## Relationship To The Active Query Anchor

- active query anchor:
  - `benchmarks/coverage-lexical-size-latency-baseline-body-evidence-matcher-precompute.md`
- this file is not a replacement for the query anchor
- use both anchors together:
  - query anchor for quality, query-time latency, and structural in-memory size
  - startup anchor for snapshot bytes, hydrate time, rebuild time, and repair time

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
  - this is the last clean pre-snapshot structural reference for judging whether binary persistence is actually getting denser or just adding another layer

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
  - write ms
  - hydrate ms
  - ready-to-search ms
  - rebuild ms
  - repair ms
  - snapshot bytes
- relative measurements:
  - `hydrate / rebuild`
  - `readyToSearch / rebuild`
  - `repair / rebuild`
  - `snapshotBytes / estimatedIndexBytes`

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
  - snapshot bytes are not obviously larger than the equivalent structural estimate without a written reason
- self-heal is only promoted if:
  - startup remains usable before full repair completes
  - the repair path is measurably cheaper than a full rebuild for small vault drift

## Immediate Next Step

- implement a minimum binary schema and a benchmark harness that can record:
  - rebuild-only startup
  - snapshot write
  - snapshot read
- do not optimize encoding density aggressively before those three numbers exist
