# Benchmark Corpora

This directory stores small, fixed public corpora for repeatable local benchmarks.

## Current corpora

### `corpora/web-notes-v1`

- 36 markdown files
- English only
- three technical buckets:
  - Obsidian help
  - GitHub Actions docs
  - Kubernetes docs

Use `web-notes-v1` when you want a compact, stable technical corpus that is close to note-taking and engineering workflows.

### `corpora/web-notes-v2`

- 32 markdown files
- bilingual: English + Chinese
- four buckets:
  - `pkm-en`: English PKM / note-taking docs
  - `tech-en`: English engineering / infrastructure docs
  - `general-zh`: Chinese general writing / documentation notes
  - `tech-zh`: Chinese engineering / infrastructure docs

Use `web-notes-v2` when you want a more general mixed-language corpus that better approximates a real Obsidian vault with different note styles and domains.

## Design intent

These corpora are not meant to be "the truth" for retrieval quality.

They are meant to be:

- fixed enough for A/B comparison
- small enough for routine local runs
- varied enough to catch obvious overfitting to a single domain

Practical rule:

- use `web-notes-v1` for quick technical regression checks
- use `web-notes-v2` before promoting ranking or tokenization changes
- use `benchmarks/file-search-web-baseline.md` as the current human-readable checkpoint for the experimental lexical benchmark
- use `benchmarks/file-search-web-harvest.md` as the structured harvest package for milestone summary, weakness ranking, guardrails, and roadmap

## Maintenance

- keep corpus membership fixed unless there is a strong reason to change it
- if you change membership, create a new version directory instead of mutating an old one
- store source repo + commit sha + original path in a manifest file when possible
- prefer public markdown sources with clear provenance
