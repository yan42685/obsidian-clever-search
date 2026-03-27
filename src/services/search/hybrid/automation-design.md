# Automation Design For The Next Lexical Backend

This file holds the detailed automation-facing meta rules for the next experimental lexical backend.

Automation should read this file before starting a new exploration cycle.

If any short prompt summary conflicts with this file, this file wins.

## Architecture Direction

1. The next lexical engine must be fully independent from legacy `passage-bm25` code and storage.

- the designated implementation target for the next lexical engine is `src/services/search/coverage-lexical/coverage-lexical-engine.ts`
- the next engine may still choose a passage-first or local-window evidence model, but that model must be implemented inside the new backend rather than imported from the old passage path
- future replacement should be able to swap ranking, verifier, and recall layers through neutral interfaces without forcing a rewrite of unrelated layers
- automated tuning should primarily target the new backend modules, not legacy passage ranker files
- default tuning surface should be `coverage-lexical` planner / ranker / verifier / recall modules, not `src/services/search/passage-lexical/passage-lexical-ranker.ts`
- low-level posting or storage changes are still allowed, but only when the benchmark shows they materially help speed or size without hurting the ranking guardrails
- the next lexical engine must be code-wise independent from `src/services/search/passage-lexical/passage-file-search-engine.ts`
- do not evolve the old engine in place and relabel it as the new backend
- do not reuse the old `passage-bm25` index format, recall path, scorer, verifier, comparator, or tuning tables as hidden dependencies of the new backend
- do not import old scorer / verifier / comparator helpers into the new backend
- shared infrastructure is allowed only for neutral utilities such as tokenizer, benchmark harness, or generic interfaces, not ranking logic

2. Automation must be mechanism-first, not coefficient-first.

- the purpose is to discover a clearly better lexical backend, not to keep shaving decimals on the legacy `passage-bm25` path
- repeated no-lift coefficient tuning on the old engine counts as failure mode, not progress
- when benchmark movement stalls, the next cycle should bias toward a structural hypothesis inside `src/services/search/coverage-lexical/coverage-lexical-engine.ts`: new verifier, new planner path, new family scorer, new retrieval/ranking split, or a new coverage-first backend structure
- old passage files may be consulted as historical reference only; retained mechanism work must land in the isolated `coverage-lexical` backend

3. The controller must not own the search space.

- automation should decide which candidates to try in each cycle
- candidate generation belongs to Codex / the automation prompt, not to a fixed hard-coded grid in the runner
- the benchmark runner should only evaluate, compare, report, and help keep or rollback

4. Research should be lane-based, not one giant mixed thread.

- `mechanism-a`: coverage comparator + family scorer
- `mechanism-b`: local verifier + compactness/order/local window
- `mechanism-c`: planner / route selection / metadata-body split
- `benchmark`: benchmark expansion and harder guardrail construction
- `regression`: validation and reporting only
- each lane should own its own candidate manifest and output files under `.codex-bench/lexical-optimizer/lanes/<lane>/...`
- lanes may run in parallel, but final merge and keep/rollback is still serial

## Ranking Invariants

1. The primary unit of evidence is a `query family`, not raw hit count.

- a family groups the exact query term, case-folded equivalent, prefix expansions, and fuzzy expansions that represent the same remembered concept
- one family can only count as matched once
- expansion must never inflate family coverage

2. Ranking must first compare `core body family coverage`.

- in the default body-first path, more matched core body families must always beat fewer matched core body families
- no proximity, metadata, or bonus term is allowed to overturn this ordering

3. When family coverage ties, match quality must respect:

- `exact > prefix > fuzzy`
- family quality is decided by the best match type within that family

4. Query tail importance is real but subordinate.

- later query families should carry significantly more decision weight than earlier ones
- this tail bias may only act after coverage and family match quality comparisons are already satisfied

5. Proximity is local-window evidence, not a primary recall rule.

- compare candidates using the best local evidence window rather than a loose whole-document span
- the local window should reward compact coverage, natural order, and tighter span
- local compactness must never beat a candidate with stronger family coverage

6. Metadata is anchor evidence by default, not the main route.

- default route is `body-first`
- metadata evidence should mainly help with anchoring and tie-breaking
- only clearly metadata-dominant queries may flip into `metadata-first`

## Family Classification Rules

Family classification should be explicit and stable enough for automation to tune around without breaking the ranking invariants.

1. Default to `core`; demote only clear weak families to `soft`.

2. A family should be treated as `soft` when any of the following holds:

- pure numbers, dates, version-like ids, or weak serial tokens
- ASCII length `<= 2`
- a single CJK character
- known connector / stopword-like weak term
- globally high-frequency and low-discrimination term
- pure structural token or path separator residue

3. Short-query override:

- when total family count is `<= 2`, every non-structural family should be treated as temporary core evidence

4. Tail-sensitive override:

- the last query family may be promoted out of `soft` when it is not an obvious weak term and appears decisive for remembered intent

5. Metadata capability is a separate label, not a replacement for `core` / `soft`.

- a family may be both `core` and `metadata-capable`
- metadata capability should be assigned when the raw query or preprobe strongly suggests basename, title, heading, or path intent

## Query Planner Rules

The planner should classify each query before final scoring so the engine does not force one blend recipe to serve every query shape.

1. Planner outputs:

- family decomposition
- `core` vs `soft`
- `body` vs `metadata-capable`
- short-query flag
- prefix-like flag
- typo-like flag
- route selection

2. The route set should remain small and explicit:

- `body-first`
- `body-with-anchor`
- `metadata-first`
- `short-query overlay` as an overlay rather than a fully separate main route

3. Route selection defaults:

- use `body-first` unless metadata intent is clearly dominant
- use `body-with-anchor` when both body evidence and metadata anchors matter
- use `metadata-first` only when metadata preprobe is clearly stronger than body preprobe or raw query form strongly implies path / title / basename lookup

4. Ranking order by route:

- `body-first`: core body coverage -> family quality -> tail-weighted core quality -> best local body window -> soft body coverage -> metadata anchor support
- `body-with-anchor`: core body coverage -> family quality -> metadata anchor coverage -> tail-weighted core quality -> best local body window
- `metadata-first`: metadata exact coverage -> metadata quality -> core body coverage -> core body quality -> best local body window
- `short-query overlay`: raise exact and local-window decision power, reduce soft-family influence, and keep fuzzy conservative

## Prefix And Fuzzy Expansion Rules

Expansion is fallback infrastructure, not the primary scoring path.

1. Prefix defaults:

- enable by default only for ASCII or mixed Latin-digit families
- require family length `>= 3`
- keep family-level expansion capped and family-scored

2. Fuzzy defaults:

- enable by default only for ASCII or mixed Latin-digit families
- require family length `>= 5`
- prefer edit distance `1`; treat `2` as exceptional and tightly gated

3. Expansion routing:

- run exact first
- open prefix only when exact confidence or family coverage is insufficient
- open fuzzy only after exact and prefix remain insufficient

## Passage Shape Tuning Rules

Automated exploration is allowed to tune the passage structure itself when doing so stays inside the same ranking invariants.

1. Passage target token size is tunable.

- use the existing tokenizer and existing token-counting path for all tuning and evaluation
- do not introduce a second independent token estimator for this optimization loop

2. Passage overlap ratio is tunable.

- overlap may be explored as a ratio rather than a fixed count
- changes must be evaluated together with latency and persisted index size, not only quality

3. Passage tuning is still subordinate to ranking quality.

- a different passage size or overlap is only worth keeping if it improves the primary objective or keeps quality flat while materially improving speed or size

## Automated Exploration Protocol

Automation should be allowed to explore implementation details aggressively, but only inside a strict keep-or-revert loop.

1. Primary optimization target:

- maximize `0.55 * hits@1 + 0.25 * hits@3 + 0.20 * hits@5`

2. Mandatory evaluation metrics on every cycle:

- `hits@1`
- `hits@3`
- `hits@5`
- average latency
- `p99` or `p100` latency
- persisted index size

3. Allowed optimization directions:

- comparator and route-specific decision logic
- `core` / `soft` thresholds
- planner thresholds and route gating
- prefix / fuzzy fallback gating
- local verifier and local-window shape
- replacement scorer or replacement backend modules that still plug into the same benchmark loop
- postings / positions / dictionary compression
- early termination and partial top-k selection
- passage token target and overlap ratio using the existing tokenizer

4. One-direction-per-cycle rule:

- each automated cycle should have one primary hypothesis
- tightly coupled edits that are required by that one hypothesis are allowed
- avoid multi-axis "blend everything and hope" iterations
- the primary hypothesis should stay inside one lane

5. Keep conditions:

- retain a change only if the primary objective improves
- or if the primary objective is effectively preserved and speed or size materially improves

6. Automatic rollback conditions:

- noticeable `hits@1` regression
- overall objective flat while code complexity, size, or latency worsens
- visible gain only on one tiny family with poor generalization
- any violation of the ranking invariants above

7. Anti-overfitting guardrail:

- no change may be kept based on one benchmark slice alone
- all retained changes must clear the full benchmark mix: body-first, difficult mixed-script, metadata+body, prefix/fuzzy interference, and harder collision-style sets

8. Scope discipline:

- keep the experimental backend isolated
- keep core production code small and hard, not heuristic-heavy
- treat benchmark and verification tooling as separate support code rather than an excuse to bloat the hot path
- if two or more consecutive cycles only tweak constants without a meaningful benchmark lift, stop local tuning and move to a mechanism-level change

9. Serial evaluation is the default.

- evaluate candidates serially in the current workspace
- use those serial benchmark results directly for final keep/rollback decisions
- shared dependencies and benchmark corpora are execution infrastructure; avoid reinstalling or redownloading them unless they are missing or known-bad

## Benchmark Design Rules

Benchmark should be optimized for the intended search behavior, not for protecting legacy implementation quirks.

1. The benchmark should explicitly stress the ranking invariants.

- more matched core families must beat fewer matched core families
- when coverage ties, `exact > prefix > fuzzy`
- tail-weight can decide ties but must not overturn stronger coverage
- compact local evidence may break ties but must not outrank stronger family coverage

2. Prefer harder adversarial cases over larger easy sets.

- add difficult body-only memory queries
- add metadata-plus-body conflict cases
- add same-title / same-folder / same-prefix collisions
- add mixed-script and mirror-language confusion cases
- add compact-vs-diffuse locality ties

3. Remove useless benchmark constraints.

- do not preserve a fixed candidate grid in the runner
- do not preserve easy synthetic cases just because they are historical
- do not require changes to preserve legacy heuristics that are not part of the ranking invariants
- do not treat code size as a primary benchmark metric when ranking quality and interactive latency clearly improve
- benchmark reporting for `coverage-lexical` should compare against `MiniSearch` as the external baseline; avoid carrying unrelated legacy backend comparisons in the default automation loop unless a regression lane explicitly asks for them

4. Keep the automation benchmark focused and fast.

- compare `CoverageLexical` against `MiniSearch` only
- do not spend automation benchmark budget on `custom-bm25` or `passage-bm25`
- target one full benchmark run under `20s` on a normal development machine
- if runtime drifts above budget, reduce redundant cases before weakening core invariant coverage

