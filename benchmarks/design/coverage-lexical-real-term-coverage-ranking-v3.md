# Coverage Lexical Query-Unit Ranking V3

Date: 2026-04-14
Status: In Progress
Supersedes: `coverage-lexical-real-term-coverage-ranking-v2.md`

## Purpose

This document defines the next lexical-only final ranking worldview for
`coverage-lexical`.

V3 keeps the lexical-only boundary from V2, but changes what lexical final
ranking tries to optimize.

The guiding principle is:

> within the same realized lexical coverage band, prefer the candidate whose
> matched query units are explained by fewer, stronger, clearer evidence
> containers

This is still a lexical worldview. It is not semantic intent inference.

V3 therefore optimizes for:

- stable query-unit realization
- explicit lexical coverage of visible query units
- strong evidence packing instead of flat field-count accumulation
- explicit distinction between main evidence containers and corroboration
- local body density instead of same-field-as-proxy aggregation
- exact as a late tie-break, not an early dominance rule

V3 intentionally moves `coverage-lexical` away from:

- reusing `surfaceCoverageShape` as a same-coverage final comparator
- treating same-field presence as equivalent to local evidence cohesion
- allowing one query unit to inflate ranking through multiple prefix
  expansions
- using `heading` as an independent metadata ranking tier
- letting exact outrank prefix too early in the comparator
- count-first global score accumulation

## Why V2 Is No Longer Sufficient

V2 established the correct lexical boundary, but its final comparator still
contains three worldview mismatches.

### 1. `surfaceCoverageShape` still reaches too far

`surfaceCoverageShape` is useful as a guardrail for visible grouping and
cross-script completeness, but it should not continue deciding winners inside a
same-coverage tie-band.

Once candidates are already in the same realized coverage band, V3 treats
surface-shape preservation as admission or banding logic, not as the central
ordering signal.

### 2. `cheapSharedFieldCoverage` over-approximates aggregation

V2 still rewards same-field clustering through a cheap approximation,
especially for `body`. That approximation is too coarse because:

- being in the same field does not mean being in the same local evidence block
- two scattered body hits should not automatically behave like a strong body
  cluster
- same-field body aggregation can suppress stronger identity or better-packed
  candidates

V3 therefore promotes confirmed local body windows into a first-class container
model and demotes same-field aggregation to, at most, a transitional signal.

### 3. `primaryUnitMatchQuality` gives exact too much early power

V2 still lets exact/prefix quality shape the final ordering too early.

V3 keeps `exact` and `prefix` in the same realized-coverage class by default.
The comparator should first decide which candidate has the better packed
evidence explanation. Only when those layers remain tied should exact count
break the tie.

## V3 Ranking Worldview

### Lexical Boundary

V3 remains lexical-only.

Lexical final ranking is responsible for:

- realized query units
- explicit coverage of visible query units
- explicit evidence container construction
- compact local body evidence
- bounded corroboration from document structure
- stable deterministic lexical ordering

Lexical final ranking is not responsible for:

- semantic intent reconstruction
- semantic requiredness
- topic inference
- route philosophy labels
- a global weighted score that blends unrelated evidence types into one number

### Two-Stage Final Ordering

V3 splits final ordering into two stages.

#### 1. Coverage Gate

This stage is responsible for deciding whether two candidates are even in the
same comparison band.

It may still use:

- visible grouping preservation
- cross-script preservation
- high-level realized coverage completeness

This is the correct home for `surfaceCoverageShape`.

`surfaceCoverageShape` is therefore retained only as a **coverage gate**
guardrail. It must not keep deciding order inside a same-coverage packing band.

#### 2. Packing Comparator

Once candidates are already in the same realized coverage band, V3 compares
them by the structure of their evidence:

- strongest main container
- second strongest main container
- fragmentation and residue
- late exact tie-break
- stable deterministic fallback

The packing comparator does **not** compare `surfaceCoverageShape`.

## Realized Family Invariants

### One Query Unit, One Best Realized Family

For each candidate, a query unit may bind to only one best realized target
family.

For example:

- query unit `pre`
- candidate terms `present`, `prefer`, `preload`

V3 allows only one chosen realization, such as `pre -> present`.

The candidate may not accumulate parallel ranking gain from:

- `pre -> present`
- `pre -> prefer`
- `pre -> preload`

at the same time.

This invariant applies to:

- packing
- corroboration
- field-level support
- exact/prefix accounting

### Corroboration Is Allowed Only Within The Chosen Family

Once a best realized family is chosen, the same target family may be witnessed
in multiple fields.

For example:

- chosen family: `pre -> present`
- witnesses in `basename`, `heading`, and `body`

This is allowed and should strengthen the chosen family. What is disallowed is
cross-family accumulation from different prefix expansions for the same query
unit.

### Exact And Prefix Are Peers By Default

Both `exact` and `prefix` count as realized primary coverage.

V3 explicitly rejects the worldview that exact should dominate prefix early in
the comparator.

Instead:

- exact and prefix both contribute to realized coverage
- exact only becomes decisive after coverage, packing, and fragmentation still
  remain tied

## Evidence Container Model

V3 recognizes exactly three main evidence containers.

### 1. `IdentityContainer`

Sources:

- `basename`
- `alias`

Meaning:

- file identity anchor

This is the strongest default container tier.

### 2. `RouteContainer`

Sources:

- `tag`
- `folder`

Meaning:

- route or classification anchor

This is weaker than identity, but still stronger than body as a default tier.

### 3. `BodyWindowContainer`

Source:

- confirmed best local body window

Meaning:

- compact local body evidence block

This is the only body main container in V3.

### `heading` Is Not A Main Container

`heading` is no longer a standalone metadata tier in V3.

It exists only as a corroboration channel.

The first V3 baseline binds heading corroboration only to
`BodyWindowContainer`.

The intended logic is:

- once a candidate forms a strong `BodyWindowContainer`
- verify whether the file heading also contains query units covered by that
  body window
- the more overlap exists, the more the body window looks like a document-level
  named topic instead of accidental local proximity

### `bodyResidue` Is Not A Main Container

Body matches that do not belong to the confirmed best local window do not form
a fourth container.

They are treated as residue and later counted toward fragmentation.

## Body Window Definition

V3 explicitly rejects the idea that body coherence must require preserved query
order.

A valid `BodyWindowContainer` is defined by confirmed local compactness, not by
strict sequence preservation.

Its core properties are:

- multiple covered distinct realized query units
- confirmed evidence rather than cheap same-field approximation
- sufficiently narrow window width
- high local density
- bounded gap behavior

`preservesSurfaceOrder` may still exist as a weak tie-break, but it is not a
hard requirement for body-window validity.

Likewise, "all in body" must not be treated as equivalent to "one coherent body
evidence block".

## Han Bigram Minimal Strategy

V3 keeps Han bigram support, but only as a **Han backstop routing system**.

Han bigrams are not primary ranking evidence, not evidence containers, and not
direct final-comparator inputs.

Their sole responsibility is to cheaply narrow the search space before Han
exact confirmation.

### Han Bigram Role

Han bigrams exist only to answer this question:

> which documents or body blocks are cheap enough to inspect next for Han exact
> confirmation

They do **not** answer:

- which candidate has the better final packing profile
- which Han candidate should outrank another after exact confirmation
- how many primary units a candidate finally realized

The final lexical worldview remains exact-confirmed evidence only.

### Query-Side Rule

V3 should continue deriving Han bigrams only from `hanBackstopGroups`.

That means:

- Han bigrams are created for fragile or residual Han backstop routing
- Han primary units remain the main lexical units
- Han bigrams are not promoted into standalone primary ranking units

This keeps Han bigram generation bounded and prevents V3 from turning every Han
query into a broad bigram-first ranking problem.

### Resident Structures

The minimum V3 resident Han-bigram structures are:

1. `metadataBigramPostingsByTier`
2. `bodyHanBlockPostings`
3. `bodyHanExactTapeArena`

No larger Han-bigram resident structure is required for the first V3 baseline.

#### 1. `metadataBigramPostingsByTier`

Metadata Han bigram postings should be stored by V3 tier, not by every original
field.

The required tiers are:

- `identity = basename + alias`
- `route = tag + folder`
- `heading`

The purpose is cheap doc routing only.

V3 should not keep separate Han bigram routing lanes for all five original
metadata fields if the routing worldview only needs the three higher-level
tiers above.

#### 2. `bodyHanBlockPostings`

Body Han bigrams should route to **logical blocks**, not directly to whole
documents.

The required resident structure is:

- `bigramId -> blockId list`

This is the correct minimum because Han body exact confirmation is block-local.

V3 should not keep a separate body Han doc-level bigram posting graph in
addition to block postings.

#### 3. `bodyHanExactTapeArena`

Han bigram routing must end in Han exact confirmation.

V3 therefore requires a resident exact tape arena for Han body blocks so that
candidate blocks can be confirmed without a second persistent sidecar system.

This exact tape arena is the final Han evidence source.

Han bigrams only decide what to inspect next; the exact tape decides what is
actually realized.

### Build-Time Rule

During build:

- each Han logical block may temporarily collect its unique Han bigram ids
- those bigram ids are used to build the global `bigramId -> blockId list`
- after the postings are built, per-block duplicate bigram lists should not be
  kept as an additional resident mirror unless another live query path
  absolutely requires them

This rule is important because V3 is targeting the smallest high-performance
resident layout, not the most convenient debug layout.

### Bigram Id Encoding

V3 should continue using a compact numeric Han bigram id instead of retaining
bigram strings in resident query structures.

The preferred first baseline is:

- encode each two-Han-character bigram into a 32-bit numeric id
- use that numeric id directly as the posting key
- avoid resident bigram string dictionaries in the hot path

If collision handling is needed, it should be treated as a rare fallback path,
not as a reason to widen the default representation for all bigrams.

### Search-Time Flow

Han bigram flow in V3 should be fixed as:

1. build `hanBackstopGroups`
2. use metadata bigram postings to collect cheap doc candidates
3. use body block bigram postings to collect cheap block candidates
4. intersect and cap those candidates under Han backstop budgets
5. run Han exact confirmation on the remaining blocks
6. convert only exact-confirmed Han evidence into realized evidence consumed by
   the final packing comparator

This flow preserves the V3 rule that final ranking should compare confirmed
evidence packing rather than route-time approximations.

### Han Bigram Gate Signals

V3 may continue using cheap Han bigram gate signals during routing, such as:

- matched bigram count
- longest contiguous bigram chain
- bigram coverage ratio

These are acceptable only for:

- deciding whether a metadata or block candidate is promising enough to inspect
- ranking or capping Han backstop routing candidates before exact confirmation

These signals must not survive as final ranking signals after exact evidence is
available.

### Explicit Han Bigram Rejections

V3 explicitly rejects the following Han-bigram directions:

- treating Han bigrams as final primary ranking units
- placing Han bigrams directly inside `IdentityContainer`,
  `RouteContainer`, or `BodyWindowContainer`
- keeping both body doc-level and body block-level Han bigram postings
- keeping a resident per-block Han bigram mirror after the global block
  postings are already built, unless a separately justified live query path
  needs it
- allowing Han bigram counts to continue deciding the final comparator after
  exact confirmation exists

## Final Comparator Layers

Within the same realized coverage band, V3 compares candidates in this order:

1. strongest container
2. second strongest container
3. fragmentation and residue
4. exact count as a late tie-break
5. stable deterministic fallback

### Container Comparison Dimensions

For strongest and second strongest container comparison, the primary dimensions
are:

1. `coveredDistinctUnitCount`
2. `containerTier`
3. `containerCompactness`
4. `headingCorroboratedUnitCount`
5. `exactUnitCount`

The default tier order is:

- `identity > route > bodyWindow`

However, this is a **tie-only tier**, not an unconditional hard override.

That means:

- first compare coverage and packing quality
- only when those are near-equal should `route` outrank `bodyWindow`
- a clearly stronger `bodyWindow` must not be mechanically suppressed by a much
  weaker `route` container

### Fragmentation

If strongest and second strongest container still do not decide the ranking,
V3 compares fragmentation.

The fragmentation worldview is:

- fewer leftover scattered matches is better
- fewer weak residue-only realizations is better
- a candidate that explains the same realized units through fewer strong
  containers is better

This is where `bodyResidue` matters.

### Exact As Late Tie-Break

Only after:

- same realized coverage band
- comparable main-container structure
- comparable fragmentation

should exact count break the tie.

This rule replaces the V2 worldview in which `primaryUnitMatchQuality` gives
exact early dominance.

## V3 Signal And Type Draft

V3 should use new terms instead of trying to reinterpret V2 names as if they
already matched the new worldview.

The intended signal vocabulary is:

- `RealizedQueryUnitFamily`
- `EvidenceContainer`
- `IdentityContainer`
- `RouteContainer`
- `BodyWindowContainer`
- `HeadingCorroboration`
- `EvidencePackingProfile`
- `FragmentationPenalty`

The first implementation does not need to finalize every TypeScript shape, but
the document baseline should lock the following semantics.

### `RealizedQueryUnitFamily`

Must describe:

- the query unit identity
- the chosen realized target family
- whether the realization is exact or prefix
- all corroborating witnesses that belong to the same chosen family

### `EvidenceContainer`

Must describe:

- which main container tier it belongs to
- how many distinct realized query units it covers
- how much of that coverage is exact
- the compactness signal used for this container

### `BodyWindowContainer`

Must describe at least:

- covered distinct realized unit count
- confirmed local window width
- density or equivalent compactness measure
- gap behavior
- heading corroboration count

### `FragmentationPenalty`

Must describe:

- body residue
- leftover weak realizations outside the strongest containers
- why a more fragmented candidate should lose to a better packed one under the
  same realized coverage

## Migration Notes

The intended migration from V2 to V3 is conceptually simple even if the code
will be incremental.

V3 explicitly repositions existing V2 layers as follows:

- `surfaceCoverageShape`
  - remains available only for coverage gate logic
  - must be removed from same-coverage final packing comparison
- `cheapSharedFieldCoverage`
  - no longer acts as the main aggregation worldview
  - may remain only as a transitional or cheap pre-signal
- `matchedPrimaryUnitFieldProfile`
  - no longer defines the final worldview
  - at most serves as a compatibility or migration helper
- `primaryUnitMatchQuality`
  - must stop giving exact early dominance
  - exact must move to a late tie-break role
- `bestWindow`
  - must be promoted from a narrow proximity helper into core infrastructure
    for `BodyWindowContainer`

V3 should not be implemented as another long-lived dual worldview. Once the V3
packing comparator is proven, it should become the only active final lexical
worldview for that responsibility.

Implementation boundary:

- V3 ranking and query-unit helpers may reuse proven V2 logic only by copying
  and adapting it into the V3 subtree
- V3 should not depend on direct imports from active V2 comparator, candidate
  cascade, or query-analysis runtime modules

## Explicit Rejections

To keep later implementation work from drifting, V3 explicitly rejects the
following directions:

- returning to count-first weighted global scoring
- restoring `heading` as an independent main metadata tier
- letting one query unit accumulate gain from multiple prefix expansions
- treating "same field" as equivalent to "same local evidence block"
- using `surfaceCoverageShape` to keep ranking inside same-coverage packing
  ties
- requiring `preservesSurfaceOrder` for body-window validity

## Acceptance Benchmarks

The V3 document baseline must remain compatible with current benchmark quality
expectations.

At minimum, later implementation work must preserve:

- comparator tests for one-unit-one-family
- comparator tests for exact/prefix late tie-break
- comparator tests for heading-as-corroboration
- comparator tests for order-insensitive body windows
- benchmark behavior that does not regress from the current
  `CoverageLexical(V2).zeroRate = 0` baseline

Historical `rank=0` failures that were already eliminated by late-prune
correction and default-lenient behavior must not be reintroduced by a V3
comparator rewrite.

## Design Self-Check Cases

The following cases are part of the V3 worldview and should remain true in both
design discussion and later tests.

### Case 1

`3 identity + 3 bodyWindow` should outrank `2 identity + 2 route + 2 residue`.

Reason:

- the former explains the same total realized coverage through two stronger and
  clearer containers
- the latter is more fragmented

### Case 2

Between `3 route` and `3 bodyWindow`, route should win only when packing
quality is otherwise close enough that tier can legitimately break the tie.

Reason:

- `route > bodyWindow` is tie-only tier, not a hard override

### Case 3

A body window with high local density but imperfect query order may still form
a valid `BodyWindowContainer`.

Reason:

- local compactness matters more than preserved order

### Case 4

`heading` strengthens `BodyWindowContainer` but does not become a standalone
container.

Reason:

- heading is corroboration, not a fourth main evidence worldview

### Case 5

If query unit `pre` can expand to `present` and `prefer`, only one best family
may be chosen for that candidate.

Reason:

- V3 forbids multi-expansion inflation for the same query unit

### Case 6

If two candidates are already in the same realized coverage band, a residual
difference in `surfaceCoverageShape` must not keep deciding the final order
inside the packing comparator.

Reason:

- shape belongs to coverage gating, not same-band packing comparison

## Open Questions

The following items remain deliberately open for implementation refinement, but
they do not change the locked V3 worldview:

- the exact compactness formula for `BodyWindowContainer`
- whether later versions should allow heading corroboration for identity or
  route containers in a weaker form
- whether fragmentation should be modeled as one object or as a small tuple of
  residue signals

## Implementation Status

### Phase 2

Status: Completed on 2026-04-14

The current V3 experimental implementation now includes:

- local V3 query analysis under `coverage-lexical-v3/query/`
- local V3 recall path under `coverage-lexical-v3/recall/`
- local V3 container and packing comparator implementation under
  `coverage-lexical-v3/ranking/`

The implemented comparator/test baseline currently verifies:

- `3 identity + 3 bodyWindow > 2 identity + 2 route + 2 residue`
- `route > bodyWindow` only when packing is close
- heading strengthens `BodyWindowContainer` without becoming a standalone tier
- exact acts as a late tie-break
- `surfaceCoverageShape` does not participate in same-band final ordering
- one query unit binds to one best realized family per candidate

This implementation is still experimental and not yet the formal runtime V3
backend, but it now provides a concrete executable baseline for later recall,
Han, overlay, and snapshot work.

### Phase 3

Status: Completed on 2026-04-14

The current implementation now validates the Han Bigram Minimal Strategy in
code:

- query-side Han bigrams come only from `hanBackstopGroups`
- Han route works through metadata and body-block postings
- Han route gate stats are exposed only for recall-time inspection
- final realized Han evidence is produced only after exact confirmation
- Han bigram gate stats do not participate in the final packing comparator

### Phase 4

Status: Completed on 2026-04-14

The current implementation now applies the tightened Han query-unit worldview
for V3 query analysis and realization:

- Han surface groups no longer auto-enter primary coverage as whole-surface
  units
- Han primary units now come only from tokenizer-real Han query terms with
  length >= 2
- tokenizer-real Han terms do not preserve the full Han surface group as an
  implicit fallback primary
- uncovered residual Han spans now produce residual-span backstop bigrams
- uncovered single-Han residuals now produce only adjacent bridge bigrams
- whole-group Han backstop now activates only for zero-real-term Han groups
- zero-real-term Han groups can realize coverage only through opaque exact
  confirmation, never through bigram counts themselves
- the V3 regression baseline now includes `系统代理`, `委员长`, and zero-real-term
  Han exact-confirm cases

### Phase 5

Status: Completed on 2026-04-14

The current implementation now aligns document-side Han indexing with the V3
real-term worldview:

- Han metadata ranking evidence now uses tokenizer-real Han terms instead of
  treating Han surface groups as metadata families
- Han body exact evidence now uses tokenizer-real Han term sequences, preserving
  order for body-window comparison
- heading Han terms remain corroboration-only and no longer create standalone
  realized coverage
- Han prefix expansion remains disabled for V3 family lookup
- zero-real-term Han groups keep a minimal per-tier/per-block Han surface
  witness path for opaque confirmation without restoring Han surface ranking
- the V3 regression baseline now verifies
  `metadata dual hit > body dual hit > split hit`

### Phase 6

Status: Completed on 2026-04-14

The current implementation now moves V3 body recall and body-window ranking
closer to the intended local-window worldview:

- ordinary body shortlist no longer scans every document block; it now uses
  `summary family -> blockIds` postings as a recall-first gate
- Han body route postings still join the shortlist through the same block-level
  candidate set
- the old per-block pseudo-window calculation has been replaced by a
  chain-aware local window resolver over shortlisted blocks
- body windows are now admitted only when they satisfy explicit locality
  constraints on covered units, width, and adjacent-gap spread
- adjacent paragraph blocks can form a weaker body window, while dispersed body
  hits no longer inflate into a false `bodyWindow(2)`
- unused resident fields from the previous body shortlist/body-window path have
  been removed, and resident metrics now account for the new body summary
  posting arena
- the V3 regression baseline now verifies:
  `metadata 2 > same-block bodyWindow 2 > adjacent-block bodyWindow 2 > metadata 1 + body 1 > dispersed body`

### Phase 7

Status: Completed on 2026-04-14

The current implementation now adds a late prefix-quality tie-break for V3
without changing coverage credit or resident storage:

- prefix quality is still never promoted into realized coverage counts
- candidates that are otherwise tied now prefer smaller total prefix completion
  gain before falling back to deterministic path ordering
- when completion gain ties, non-compound prefix realizations are preferred
  over compound tokens
- the V3 regression baseline now verifies
  `prefe -> prefer > preference > prefer-cache`

### Phase 8

Status: Completed on 2026-04-14

The current implementation now bounds V3 prefix expansion at query time so
prefix-heavy inputs stay loose in normal cases without turning worst-case lookup
into a full family scan:

- V3 family lookup no longer materializes and scans every family text for every
  query unit
- family lookup now uses lexicographic lower-bound lookup over the already
  sorted family lexicon to jump directly to the relevant exact/prefix range
- exact family realization is always preserved before any prefix budget applies
- prefix expansion is now a controlled query-time collection step with dynamic
  per-unit match limits and scan budgets that grow with query length
- prefix candidate ordering now stays aligned with the late comparator by
  preferring smaller completion gain and then non-compound tokens
- the V3 regression baseline now verifies that `prefe` keeps the exact family
  and caps prefix realizations to a loose bounded set

### Phase 9

Status: Completed on 2026-04-14

The current implementation now has a dedicated V3 automation benchmark while
preserving the older continuity harness as legacy:

- the former `coverage-lexical` automation benchmark file is now explicitly
  marked legacy
- the current `npm run benchmark:coverage-lexical` entry now targets a V3-only
  benchmark harness
- the V3 harness reuses the legacy automation corpus, query cases, and core
  summary metrics
- the V3 report now compares only `CoverageLexical(V3)` against `MiniSearch`
- the legacy continuity harness remains available through
  `npm run benchmark:coverage-lexical:legacy`

### Phase 10

Status: Completed on 2026-04-14

The current implementation now adds a late Han surface-completion witness tie-break
without giving Han bigrams any direct ranking credit or adding a second Han resident
index:

- Han bigrams remain recall-only and never contribute to realized coverage
- Han groups that already have tokenizer-real primary terms can now receive a very
  late completion preference when the candidate also exact-witnesses the full Han
  surface
- completion witness is resolved only from existing per-tier and per-block Han
  witness families, so this stage does not add a new resident arena
- completion witness only acts as a late tie-break after coverage, containers,
  fragmentation, and exact count
- the V3 regression baseline now verifies `生命力 > 生命` while keeping `委员`
  bridge recall from gaining completion credit

### Phase 11

Status: Completed on 2026-04-14

The current implementation now tightens the V3 late-ranking boundary around explicit
coverage gating and generation-aligned Han raw-span refinement:

- V3 packing profiles now carry an explicit `CoverageGateProfile` using
  `realizedCoverageCount`, `fullySatisfiedSurfaceGroupCount`,
  `startedSurfaceGroupCount`, and `crossScriptSatisfiedGroupCount`
- the comparator now resolves that coverage gate before it enters container packing,
  so same-coverage candidates are banded by surface-group satisfaction before late
  packing tie-breaks
- Han surface completion keeps the existing low-cost weak witness path, but body-tier
  completion can now be synchronously refined from generation-aligned indexed text via
  `FileSnapshotStore.readIndexedTexts(path + generation)`, but only for candidates that
  remain tied through the pre-Han completion comparator layers
- raw-span refinement remains wrapper-local, inspects only shortlisted blocks under the
  widened `maxBlocksPerDoc = 96` and `maxBlocksPerQuery = 384` budgets, and never
  changes recall, realized coverage, or main evidence containers
- when generation-aligned indexed text is unavailable, V3 now cleanly falls back to the
  weak witness result without touching `readCurrentTexts` or requiring a new resident
  text arena
- the V3 regression baseline now verifies coverage-gate ordering and wrapper-level Han
  raw-span refinement / fallback behavior

