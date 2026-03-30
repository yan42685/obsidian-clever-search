# Passage File Search Harvest

Date: March 23, 2026

This document is the structured harvest package for the current experimental lexical milestone.

It exists to preserve the highest-value outcomes of this phase so future work can build from them instead of rediscovering them through repeated benchmark churn.

Related files:

- benchmark checkpoint: `benchmarks/passage-file-search-baseline.md`
- architectural source of truth: `src/services/search/hybrid/DESIGN.md`
- experimental backend: `src/services/search/passage-lexical/passage-file-search-engine.ts`

## 1. Stage Overview

Current scope:

- the stable lexical engines remain available and are not replaced
- the experimental backend lives separately under `src/services/search/passage-lexical/`
- the benchmark snapshot uses `60` notes and `267` queries
- the user target is now body-first lexical retrieval, with path / filename / title / heading treated mainly as disambiguating anchors

Current checkpoint:

- `PassageBM25`: `top1=0.760`, `top5=0.936`, `zeroRate=0.052`, `avg=8.462ms`, `p95=26.268ms`
- `MiniSearch`: `top1=0.678`, `top5=0.854`, `zeroRate=0.146`
- `CustomBM25`: `top1=0.655`, `top5=0.869`, `zeroRate=0.124`

What the phase has already delivered:

- a passage-first lexical engine that clearly beats both baselines on the current body-first target
- a benchmark structure that now includes adversarial duplicate, template, local-passage, partial-memory, contradiction, and bilingual mirror cases
- a stable enough latency profile to keep iterating on higher-ceiling mechanisms without reverting to a simpler baseline

## 2. Verified Assets

These are the assets already validated by code and benchmark evidence and should be treated as reusable mechanisms, not temporary experiments.

### Query-Conditioned Local Window Competition

- local evidence is now allowed to compete inside a file instead of relying only on one coarse sparse score
- this is the main reason same-title siblings, template contamination, and compact-vs-dispersed body queries improved

### Route-Aware File Fusion

- the engine no longer forces one scoring recipe to serve every query class
- `metadata_exact`, `path_anchor`, `mixed_anchor`, and `body_local` now have more explicit routing behavior

### Top-K Passage Evidence At File Stage

- final file ranking can distinguish decisive local support from diffuse multi-passage overlap
- this is a strong mechanism gain over file-only BM25 variants

### Query-Scoped Reuse

- local-window and passage-position work is reused across locality scoring, verifier scoring, and file aggregation
- this keeps the stronger mechanism inside an interactive latency budget

### Lightweight Verifier Exact-Phrase Path

- the exact-phrase check now starts only from feasible candidate starts and falls back to raw passage text instead of rebuilding a joined token string
- this is a small but durable verifier optimization worth keeping

## 3. Weakness Ranking

The list below is ordered by expected product value, not just by the size of a metric gap.

### Tier P0

#### `content_noisy`

- current state: `0.438`
- why it matters: this is the closest benchmark proxy for the real user memory pattern of “remember some body words, plus a few wrong or noisy words”
- theoretical upside: very high
- suggested path: structured query decomposition and better noise handling before local competition

#### `tech-zh`

- current state: `top1=0.569`
- why it matters: mixed-script and Chinese technical notes are where tokenization and lexical structure mismatch show up most clearly
- theoretical upside: high
- suggested path: mixed-script bridge lane, selective CJK-local order signals, and stronger bilingual duplicate disambiguation

### Tier P1

#### `title_prefix`

- current state: `0.690`, still behind `custom-bm25` at `0.759`
- why it matters: it is visible and user-facing, but it is not the main body-first target for the experimental backend
- theoretical upside: medium
- suggested path: tighten metadata exact-prefix lane, but do not let it dominate body-local work

#### `bilingual_mirror`

- current state: covered but not discriminative
- why it matters: benchmark coverage exists, but it is not yet a reliable separator between engines
- theoretical upside: medium to high, but only once a stronger mixed-script mechanism exists
- suggested path: keep the family small until duplicate / bilingual disambiguation becomes a real mechanism objective

### Tier P2

#### Index Size

- current state: experimental index is far larger than both baselines
- why it matters: it affects promotion readiness, but it is not the most important limiter while the architecture is still proving its quality ceiling
- theoretical upside: medium
- suggested path: defer storage optimization until another mechanism jump lands

## 4. Guardrails

These are the quality and architectural guardrails that should remain in force unless there is an explicit re-baselining decision.

### Quality Guardrails

- keep `PassageBM25 top1 >= 0.75`
- keep `PassageBM25 top5 >= 0.93`
- keep `PassageBM25 adversarial top1 >= 0.74`
- keep `PassageBM25 zeroRate <= 0.06`

### Latency Guardrails

- keep `PassageBM25 avgMsPerQuery <= 10`
- keep `PassageBM25 p95 <= 30ms`
- keep benchmark runtime practical enough for routine local regression use

### Architectural Guardrails

- do not replace the stable lexical backends with the experimental backend yet
- do not re-collapse the route-aware design back into one generic score blend
- do not trade body-local `top1-5` gains for small metadata-only wins
- do not promote naive verifier frontier clipping just because it sounds cheaper

## 5. Lessons Already Earned

These lessons should be treated as harvested value, not as temporary opinions.

### Worth Keeping

- stronger local competition is a real quality lever
- route-specific fusion is more valuable than more generic global coefficient tuning
- caching and reuse are enough to make stronger local reasoning interactive

### Not Worth Repeating

- broad coefficient tuning alone is not a path to a visible gap over MiniSearch
- benchmark expansion without sharper failure modes creates maintenance cost faster than insight
- naive verifier early termination that simply clips frontier work is risky; it can cost quality without buying enough latency

## 6. Next-Phase Roadmap

This roadmap is ordered by expected ceiling, not by implementation convenience.

### Priority A: Structured Query Decomposition

Goal:

- split queries into metadata anchors, body evidence terms, and likely-noise terms before scoring

Why first:

- it is the clearest path to improving `content_noisy`, partial-memory queries, and mixed body-plus-anchor searches

Success signal:

- visible gains on `content_noisy`, `partial_memory`, and mixed-anchor families without hurting current `body_path_anchor` wins

### Priority B: Bilingual Duplicate Disambiguation

Goal:

- distinguish bilingual or mixed-script mirror notes that share Latin anchors but differ in the decisive local explanation

Why second:

- this is the cleanest way to turn `bilingual_mirror` from “covered” into “diagnostic”

Success signal:

- `tech-zh` rises materially and the bilingual mirror family starts separating engines

### Priority C: Lightweight Phrase-Signature Admission Channel

Goal:

- add a selective ordered-pair or phrase-signature sparse channel for high-signal local admission

Why third:

- this has high theoretical upside for body-local `top1` without requiring a heavy full positional index

Success signal:

- stronger local precision on sentence-fragment and compact-passage queries with controlled latency

### Priority D: Upper-Bound-Backed Verifier Early Termination

Goal:

- revisit verifier cost only after a better decision boundary exists

Why later:

- a naive clipping approach already looks too risky for the current quality envelope

Success signal:

- lower verifier cost without regression on `body_path_anchor`, `adversarial top1`, or exact local wins

## 7. Promotion Criteria For The Next Milestone

Do not call the next phase a true breakthrough unless it satisfies most of the following:

- extends the current overall lead over both baselines
- clearly improves one of the real weak zones: `content_noisy`, `tech-zh`, or `title_prefix`
- keeps all current guardrails intact
- corresponds to a stronger retrieval mechanism, not just a more elaborate tuning surface
