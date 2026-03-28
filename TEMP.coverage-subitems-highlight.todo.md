# Coverage SubItems + Highlight TODO

## Goal

- Let `coverage-lexical` export native `directSubItems`.
- Generate snippet/highlight from snapshot text plus lazy offsets.
- Keep file-level ranking logic stable.
- Avoid persisting `bodyText`, `lineOffsets`, or `tokenOffsets`.

## Constraints

- Do not rewrite `coverage` planner/ranker main logic.
- Do not reuse ranking-layer raw windows as a required warm start.
- Preserve current `maxSubItemCount` behavior instead of hard-coding `3-4`.
- Keep fallback behavior safe for non-Obsidian benchmark/test environments.

## Phase 1: Runtime Structures + Native Coverage DirectSubItems

- Add runtime-only types for coverage display windows and snippet highlight ranges.
- Add a display-grade coverage window extractor that is independent from file ranking.
- Add diversity-aware ordering:
  - strong dedupe for high-overlap near-duplicate windows
  - keep distant windows even if they explain the same query families
- Build native `directSubItems` inside `coverage-lexical` for top displayed files only.
- Respect a dedicated subitem limit from the lexical request path.
- Prefer snapshot text from `FileSnapshotStore`; use in-memory indexed text only as a safe fallback in tests or non-Obsidian contexts.

## Phase 2: Snapshot + Lazy Offsets Highlighter

- Add a helper to:
  - read snapshot text
  - compute `lineOffsets`
  - compute token-to-char offsets compatible with the lexical tokenizer
  - cache offsets by `(path, generation)`
- Build snippet payload from token windows:
  - `text`
  - `row`
  - `col`
  - `score`
  - highlight ranges
- Keep the highlight payload runtime-only.

## Phase 3: UI Integration + Validation

- Extend `FileSubItem` so structured snippet payload can be carried without breaking existing call sites.
- Update mounted modal subitem rendering:
  - prefer structured highlight rendering when available
  - fall back to existing snippet HTML/plain text behavior otherwise
- Ensure `coverage` results no longer need secondary line matching when native subitems exist.
- Run `tsc` and production build.

## Validation Checklist

- Coverage search returns native `directSubItems`.
- Distant repeated target windows are preserved.
- Near-duplicate windows do not flood the list.
- Jump target `row/col` remains correct.
- Highlight aligns with snippet tokens.
- Existing hybrid/passage subitem rendering still works.
