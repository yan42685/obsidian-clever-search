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

The purpose is cheap doc routing only.

V3 should not keep separate Han bigram routing lanes for all five original
metadata fields if the routing worldview only needs the two higher-level
tiers above.

#### 2. `bodyHanBlockPostings`

Body Han bigrams should route directly to **V3 body blocks**, not to whole
documents.

The required resident structure is:

- `bigramId -> bodyBlockId list`

This is the correct minimum now that Han body confirmation is block-native and
witness-backed.

V3 should not keep a separate body Han doc-level bigram posting graph or an
intermediate logical-block route layer if block-native witness confirmation is
the only live exactness path.

#### 3. `bodyHanExactTapeArena`

A separate non-resident body Han exact sidecar is no longer required for the V3
body-Han backstop path.

Han bigrams only decide what to inspect next; block-native Han witness text and
later indexed-text refinement decide what is actually realized.

### Build-Time Rule

During build:

- each body block may temporarily collect its unique Han bigram ids
- those bigram ids are used to build the global `bigramId -> bodyBlockId list`
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
3. use body-block bigram postings to collect cheap body candidates
4. run block-native Han witness confirmation on the admitted body blocks
5. convert only confirmed Han evidence into realized evidence consumed by the
   final packing comparator

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
- the V3 regression baseline now includes `缁崵绮烘禒锝囨倞`, `婵柨鎲抽梹绺? and zero-real-term
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
- the V3 regression baseline now verifies `閻㈢喎鎳￠崝?> 閻㈢喎鎳 while keeping `婵柨鎲砢
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
- when generation-aligned indexed text is unavailable, the main V3 ranking/refine path
  now cleanly falls back to the weak witness result without touching
  `readCurrentTexts` or requiring a new resident text arena
- the V3 regression baseline now verifies coverage-gate ordering and wrapper-level Han
  raw-span refinement / fallback behavior

### Phase 12

Status: Completed on 2026-04-15

The current implementation now aligns V3 direct-subitem snippet selection and
highlight rendering with the Han surface-completion worldview already used by
late ranking:

- V3 direct-subitems now resolve Han display dominance at the snippet producer
  layer instead of allowing shorter tokenizer-real Han terms to co-dominate the
  final highlight set when a full Han surface occurrence is present in the same
  candidate range
- snippet representative occurrences and window geometry are now derived from
  dominance-resolved display occurrences, so the selected snippet span and its
  final highlight payload follow the same local surface-completion explanation
- direct-subitems still prefer generation-aligned indexed snapshots, but when that
  display-only text source is unavailable they now fall back to
  `FileSnapshotStore.readCurrentTexts(...)` and resolve snippets against a
  whole-document range instead of dropping to legacy line highlighting
- local direct-subitem candidate growth is now bounded by a weighted inter-term
  gap budget (`Han = 0.65`, other characters = `0.25`, stop after `15`), so
  dispersed terms no longer inflate into one oversized snippet cluster
- display-window line growth now alternates up/down by current expansion balance,
  matching the legacy renderer behavior when there is still room to grow on
  both sides
- V3 direct-subitems now apply a stricter V1-style post-rank dedupe using
  realized-term signatures plus strong overlap, which collapses display-equivalent
  duplicates while preserving genuinely distant same-signature snippets
- `coveredRealPrimaryCount` remains the first snippet-ranking signal; full Han
  surface completion only lifts snippet spans within the same real-coverage band
  and does not add new coverage credit
- producer-side `snippetText + highlightRanges` invariants remain explicit, and
  the UI-side range clamp stays only as a defensive boundary check rather than a
  Han-specific semantic repair path
- the V3 regression baseline now verifies that `閻㈢喎鎳￠崝娌?snippets highlight the
  full surface instead of only `閻㈢喎鎳, while preserving `婵柨鎲抽梹绺?bridge fallback
  behavior and keeping higher real-coverage mixed-query snippets ahead of
  lower-coverage full-surface spans

### Phase 13

Status: Completed on 2026-04-15

The current implementation now aligns V3 body chunking, `bestWindow` locality,
and direct-subitem tail dedupe around one consistent local-evidence worldview:

- body blocks no longer rely on blank-line paragraphs alone; V3 now chunks body
  text with a hybrid-style, non-overlapping approximate token budget
  (`target = 300`, `max overflow = 15%`) and prefers newline / sentence-ending
  boundaries before hard cutting
- direct-subitem raw block resolution now uses the same body chunking policy for
  snapshot-side ordinal alignment, so resident-locality candidate ranges do not
  drift away from file-level body block ordering
- `bestWindow` still enumerates only single-block and adjacent-block candidates,
  but body locality is now measured with resident-side approximate original-text
  start/end positions derived from family / witness string lengths rather than
  pure ordinal token positions
- block boundaries remain lightweight (`boundary penalty = 2`) because the new
  body chunks are treated as flat retrieval units rather than strong semantic
  segments
- `bestWindow` admission now keeps the old ordinal compactness screen as its
  first layer, then applies a second approximate-locality gate requiring
  `single gap <= 15` and `head-tail <= 160`
- windows that fail the new approximate locality gate simply fall back to
  `bodyResidue`, allowing `identity` / `route` evidence to outrank them through
  the existing packing comparator without any special compensation rule
- direct-subitems still do post-rank structural dedupe first, but now also apply
  a render-time weak dedupe that only suppresses tail snippets whose display
  windows overlap by at least `0.9` and whose rebased highlight signatures are
  identical; top1 is always retained and genuinely distant repeats are preserved
- the regression baseline now includes hybrid-style body chunk splitting and
  render-time weak-dedupe coverage for display-equivalent tail snippets

### Phase 14

Status: Completed on 2026-04-16

The current implementation now refines V3 local-body ranking and snippet reuse
around a lightweight `block shortlist sketch` hot-path worldview instead of
sharing a heavier full-cluster object:

- `bestWindow` no longer relies on ordinal width / adjacent-gap admission; body
  locality is now admitted entirely in approximate original-text space using
  `coveredDistinctUnitCount >= 2`, `boundaryCrossingCount <= 1`,
  `approxMaxAdjacentGap <= 15`, and `approxHeadTailSpan <= 160`
- `bestWindow` comparison is now approximate-first as well, preferring more
  covered units, preserved query order, smaller approximate span, smaller
  approximate max gap, and lower approximate gap mass before deterministic
  tie-breaks
- query-time body-window selection keeps its single-block / adjacent-block
  search scope, but now streams toward Top1 instead of collecting and sorting a
  larger candidate list; at the same time it retains only a tiny top-ranked
  `block shortlist sketch` for downstream snippet work
- the shortlist sketch records only the most promising block or adjacent-block
  scopes, including their representative matches and approximate locality
  geometry, and is attached internally to the file-level ranking result without
  changing the public V3 search result shape
- V3 direct-subitems now consume that shortlist sketch when available and only
  scan the highest-priority shortlisted block scopes instead of re-walking the
  full recalled body-block set for the file
- when no shortlist sketch is present, direct-subitems keep a conservative
  block-prioritization fallback rather than regressing to an exhaustive
  whole-body local search
- the regression baseline now verifies that compact evidence separated by many
  short tokens still survives under approximate locality, and that
  direct-subitems obey an attached shortlist by rendering only from the
  shortlisted block range

### Phase 15

Status: Completed on 2026-04-16

The current implementation now completes the hot-path body-window and
direct-subitem alignment work from this phase:

- cross-block chaining now treats body blocks as fully flat retrieval units;
  the old virtual boundary tax has been removed (`boundary penalty = 0`)
- `bestWindow` now uses a two-layer hot path: it first builds a very cheap
  block/pair prefilter keyed by covered unit count, approximate span, and query
  order, then only runs the full window summarizer on a tiny number of scopes
  retained per distinct-unit bucket
- the body-window search scope remains limited to single blocks and adjacent
  block pairs, but the expensive nested window evaluation is now avoided for
  obviously weaker scopes
- V3 direct-subitems consume an attached shortlist sketch when available, and
  the no-shortlist path now builds a lightweight current-file fallback from the
  local raw block ranges instead of falling back to the older
  resident-locality ordering heuristic
- the no-shortlist fallback now keeps Han surface completion conservative: a
  raw-text Han surface can dominate display only when the file-level candidate
  already corroborates that surface group or when the local snippet window also
  carries real evidence from another surface group
- the regression baseline now verifies attached-shortlist consumption,
  adjacent-block body-window formation under zero cross-block penalty, and the
  repaired no-shortlist Han snippet-selection behavior
### Phase 16

Status: Completed on 2026-04-16

The current implementation now completes the display-only Han residual-support
follow-up for direct subitems without changing the file-level completion model:

- `surface completeness` remains the only full Han completion truth; residual
  spans and bridge bigrams do not contribute to
  `completedHanSurfaceGroupCount`, `realizedCoverageCount`, or the main
  ranking comparators
- direct-subitems now recognize a weaker `residual_support` evidence kind when
  a Han surface group already has local real-term skeleton evidence inside the
  current snippet scope, allowing display-only highlight completion for
  residual spans and bridge characters
- the residual-support path is container-local on the snippet side: it is only
  constructed from the current body-window or body-residue shortlist scope and
  never stitched across unrelated file regions
- same-group full Han surface completion short-circuits residual-support
  display within the same local body scope, so a real full-surface confirmation
  continues to dominate snippet rendering
- metadata or route-level Han completion no longer globally suppresses body
  residual highlights in direct-subitems; only same-scope body completion
  blocks the weaker residual display path
- the regression baseline now covers both the new `上面这...笔记` style
  residual highlight behavior and the existing conservative Han completion
  protections against fabricated full-surface display

### Phase 17

Status: Completed on 2026-04-16

The current implementation now completes V3 FileItem metadata highlighting for
the filename and folder path fields without changing file-level ranking:

- `searchFiles(...)` now populates `basenameHighlightRanges` and
  `folderHighlightRanges` for V3 results, so the FileItem title column uses the
  same display contract that already existed in the UI
- basename highlighting now supports `real_exact`, full Han
  `surface_completion`, and display-only Han `residual_support`, while still
  keeping full-surface dominance over same-group shorter Han real terms
- folder highlighting now supports `real_exact`, full Han
  `surface_completion`, and a more conservative residual-support path that is
  restricted to a single folder-path segment and never stitched across `/`
- basename and folder are treated as separate display fields, so Han bridge or
  residual evidence cannot be shared across the two fields
- the metadata highlight path remains display-only: it does not change
  `realizedCoverageCount`, `completedHanSurfaceGroupCount`, or the main packing
  comparator
- the regression baseline now covers exact basename/folder highlights, Han
  full-surface dominance in basename and folder segments, basename residual
  support, single-segment folder residual support, and basename/folder field
  isolation

### Phase 18

Status: Completed on 2026-04-16

The current implementation now completes a V3 hot-path static-evidence caching
pass for whole-corpus fanout queries without changing the file-level ranking
worldview:

- packing-profile construction now memoizes doc-local resident slices per
  `ResidentBase + docId`, including metadata family ids and Han witness ids/text
- packing-profile construction now memoizes body-block resident slices per
  `ResidentBase + blockId`, including exact positioned occurrences, witness
  positioned occurrences, witness text, and the cached approximate/ordinal span
  used by body-window scope formation
- the cached data is strictly resident-derived and query-invariant; V3 still
  computes query-local realization, body-window choice, coverage gating, and
  final comparator inputs from the same exact evidence shape as before
- tail-latency diagnosis for the V3 automation benchmark now points at
  `engine.search(...)` fanout rather than raw Han refine:
  - the slowest `partial_memory` / mixed-anchor queries were repeatedly
    ranking `89 / 89` candidate docs
  - `refineHanSurfaceCompletion(...)` stayed sub-millisecond on those cases and
    was not the dominant tail source

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/file-search-engine.test.ts`
  passes, including the raw-Han-refine regression coverage
- the V3 automation benchmark rerun on 2026-04-16 improved the latency anchor
  from approximately:
  - `avgMsPerQuery 25.923 -> 18.982`
  - `p50Ms 20.553 -> 13.108`
  - `p100Ms 159.878 -> 135.524`
- the benchmark still shows whole-corpus candidate fanout on some
  `partial_memory` and mixed-anchor queries, so candidate-count reduction
  remains a follow-up tail-latency target

### Phase 19

Status: Completed on 2026-04-16

The current implementation now completes a V3 metadata-source packing tie-break
for late same-band ordering without changing recall structure or the main
container worldview:

- resident metadata containers now retain doc-local source masks for metadata
  family entries:
  - identity entries preserve `basename` / `alias` provenance
  - route entries preserve `tag` / `folder` provenance
- V3 still keeps the existing aggregate metadata tables and postings:
  - no source-specific recall tables were added
  - recall still routes through the same `identity` / `route` lanes as before
- packing-profile realization now carries per-unit metadata source information
  and derives a best-source-only packing signature:
  - `basename > alias > route`
  - route-internal source is retained for provenance but `tag = folder` for
    tiering
  - a realized unit never counts toward multiple primary packing buckets
- the final comparator now inserts metadata packing immediately after
  `exactUnitCount` and before Han-surface completion, so canonical metadata
  identity can break exact-count ties before the ranking falls through to later
  lexical or path fallback
- this tie-break is strictly late-stage:
  - it does not alter coverage gating
  - it does not change strongest/second container formation
  - it does not change the new route-corroboration rule where route only enters
    the main explanation when it adds novel coverage

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/comparator.test.ts` passes,
  including the new basename-vs-alias, alias-vs-route, route-equality, and
  best-source-only packing regressions
- `tests/src/services/search/coverage-lexical-v3/resident-base.test.ts` passes,
  including the new doc-local metadata-source mask regression
- `tests/src/services/search/coverage-lexical-v3/engine.test.ts` passes,
  including:
  - the existing route-corroboration regression
  - the `vector cache` canonical-playbook top-5 regression
  - a new basename-exact vs alias-exact tie regression
  - a new mixed-source best-source-only regression
- `tests/src/services/search/coverage-lexical-v3/file-search-engine.test.ts`
  and
  `tests/src/services/search/coverage-lexical-v3/file-search-engine-metadata-highlights.test.ts`
  still pass, confirming old packing-profile fixtures remain compatible with the
  new late tie-break
- `npm run benchmark:coverage-lexical` passes on 2026-04-16 with
  `CoverageLexical(V3)` still at:
  - `top5 = 1`
  - `zeroRate = 0`
  - `objective = 0.878`

### Phase 20

Status: In Progress on 2026-04-16

The current implementation now lands the core V3 non-Han fuzzy-rescue path as
a runtime-resident lexical fallback without promoting fuzzy into the normal
hot-path worldview:

- V3 resident build now materializes a runtime-only `fuzzyRescue` auxiliary
  sidecar for eligible metadata families with
  `length >= 6`
  - the current boundary is intentionally metadata-only:
    `basename` / `alias` / `folder` / `tag`
  - `heading`-only and `body`-only families are no longer indexed into the
    global fuzzy sidecar
- query-unit family lookup now runs fuzzy only as a rescue lane:
  - only for `surface` non-Han units
  - only after both `exact` and `prefix` miss
  - only at `editDistance <= 1`
  - with bounded per-unit candidate verification and a query-wide soft time
    budget
  - without adding new recall-changing gates such as longest-unit-only rescue,
    hot-key stoplists, or anchor-character filters in this pass
- realized-family selection and final ranking now admit `matchKind = fuzzy`,
  but keep fuzzy strictly late and de-noised:
  - `exact > prefix > fuzzy` family preference
  - fuzzy does not contribute to `exactUnitCount`
  - fuzzy is only penalized in very-late tie-breaks via
    `fuzzyUnitCount` / `fuzzyEditDistanceTotal`
- basename/folder/snippet display now distinguishes strong and weak lexical
  evidence:
  - exact/prefix/Han surface-completion render as strong character-only
    emphasis
  - fuzzy render as weak emphasis with a lighter dotted-underline treatment
  - the main search UI no longer relies on `<mark>` background highlighting

Validation completed for the implemented portion of this phase:

- targeted V3 family-lookup, engine, comparator, ranking-stability,
  metadata-highlight, direct-subitems, and UI highlight regression suites pass
- `npm run typecheck:build` passes as of 2026-04-16
- the automation size anchor now shows the metadata-only sidecar materially
  reduces resident auxiliary size:
  - `auxiliaryBytes: 214,619 -> 43,007`
  - still above the intended first target
    (`43,007 / 88,066 ~= 0.49x rawMarkdownUtf8Bytes`)

Open follow-up still remaining in this phase:

- the current runtime sidecar footprint is still above the intended first
  resident-memory target even after the metadata-only pruning pass
  (`auxiliaryBytes = 43,007` vs `rawMarkdownUtf8Bytes = 88,066` on the
  automation size anchor)
- fuzzy sidecar persistence / snapshot schema work is intentionally deferred;
  the current implementation is runtime-resident only

### Phase 21

Status: Completed on 2026-04-16

The current implementation now completes a strict-equivalent body-window
enumeration hot-path optimization for V3 packing-profile construction without
changing recall structure, admission rules, or final ranking semantics:

- `buildBodyWindowCandidateFromVirtualOccurrences(...)` no longer rebuilds each
  candidate window via `slice(...) + summarizeWindowCandidate(...)`
- body-window enumeration now keeps a per-start incremental
  `representativeByUnit` state and updates it only when the newly appended
  occurrence actually becomes the best representative for its query unit
- windows whose appended occurrence does not change any unit representative are
  skipped entirely because they would produce the same admitted shortlist state
  as the previous end boundary
- admitted-window comparison still uses the same exact signals and order:
  - `coveredDistinctUnitCount`
  - `preservesQueryOrder`
  - `approxHeadTailSpan`
  - `approxMaxAdjacentGap`
  - `approxTotalGapMass`
  - stable block/start/representative fallback
- multi-block adjacent scopes still route through the same scope prefilter and
  the same shortlist comparator; only the internal per-scope enumeration
  strategy changed

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/body-window-selection.test.ts`
  now compares the incremental selector against a duplicated exhaustive
  selector on:
  - repeated exact single-block windows
  - mixed exact/prefix single-block windows
  - adjacent two-block windows
- `tests/src/services/search/coverage-lexical-v3/engine.test.ts` passes after
  the optimization, confirming existing packing/regression behavior remains
  stable
- `tests/src/services/search/coverage-lexical-v3/ranking-stability.test.ts`
  passes after the optimization
- `npm run typecheck:build` passes on 2026-04-16
- `npm run benchmark:coverage-lexical` passes on 2026-04-16 with
  `CoverageLexical(V3)` still at:
  - `top1 = 0.808`
  - `zeroRate = 0`
  - `top5 = 1`
  - `objective = 0.879`
  while the same benchmark rerun dropped the latency anchor to approximately:
  - `avgMsPerQuery = 6.239`
  - `p50Ms = 4.355`
  - `p100Ms = 46.619`

### Phase 22

Status: Completed on 2026-04-16

The current implementation now completes a second strict-equivalent body-window
hot-path refinement for V3 packing-profile construction without changing
enumeration scope, admission rules, comparator order, or final ranking
semantics:

- `buildBodyWindowCandidateFromVirtualOccurrences(...)` now maintains a richer
  per-start incremental shortlist state instead of rebuilding full
  `BodyWindowCandidate` objects for every admitted representative change
- the hot path now tracks the shortlist comparator inputs directly:
  - representatives in virtual order
  - covered unit order
  - approximate head-tail span
  - approximate gap mass and max gap
  - query-order preservation
  - block boundary state
- body-window admission now runs directly on that lightweight shortlist state,
  preserving the same `coveredDistinctUnitCount`, boundary, and approximate-gap
  semantics as before
- scope-best comparison also runs on the same strict-equivalent shortlist
  signals and deterministic representative fallback, so the winning window is
  unchanged even though the inner loop no longer materializes a full candidate
  on every admitted state change
- a full `BodyWindowCandidate` is now materialized only when the current
  shortlist state actually becomes the new scope best, keeping exact-count,
  density, ordinal-gap, and heading-corroboration derivation on the cold path
- the query-analysis Han primary-term fix remains compatible with this body
  window refinement: whole-surface tokenizer-real Han terms can still realize
  normal primary coverage instead of being dropped into the backstop-only lane

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/body-window-selection.test.ts`
  now compares the live selector against an exhaustive shortlist baseline on:
  - repeated exact single-block windows
  - exact-versus-prefix replacement for the same unit
  - order-flip and later-order-recovery windows
  - adjacent-block gap and boundary tie-break behavior
- `tests/src/services/search/coverage-lexical-v3/ranking-stability.test.ts`
  passes after the shortlist-state refactor
- `tests/src/services/search/coverage-lexical-v3/engine.test.ts` passes,
  including the whole-surface tokenizer-real Han primary-term regression
- `npm run typecheck:build` passes on 2026-04-16
- `npm run benchmark:coverage-lexical` passes on 2026-04-16 with
  `CoverageLexical(V3)` still at:
  - `top1 = 0.808`
  - `zeroRate = 0`
  - `top5 = 1`
  - `objective = 0.879`
  while the same rerun improved the latency anchor to approximately:
  - `avgMsPerQuery = 5.688`
  - `p50Ms = 4.586`
  - `p100Ms = 30.975`

### Phase 23

Status: Completed on 2026-04-16

The current implementation now adds a bounded Han real-term fallback that can
reuse the existing bigram posting route without turning V3 into bigram-first
ranking:

- whole-surface `han_tokenizer_real` query units may now use the existing Han
  bigram route as a candidate-admission backstop even when the normal family
  lexicon does not provide the best candidate-specific explanation
- that route still does not grant any direct bigram coverage credit; it only
  widens candidate recall and then requires witness-backed `opaque_exact`
  confirmation before the unit can realize coverage
- candidate-specific confirmation remains bounded to whole-surface Han real
  units, so multi-unit Han queries such as split real-term surfaces do not
  inherit broad opaque coverage from one larger witness string
- when a normal exact family exists for the same unit, it continues to outrank
  the fallback because the fallback path contributes `opaque_exact` coverage
  without adding `exactUnitCount`
- body-side fallback now reuses witness occurrences alongside exact occurrences
  so body-only whole-surface recoveries can realize coverage without changing
  the existing exact-first comparator order

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/engine.test.ts` now covers:
  - whole-surface Han real-term recovery through metadata bigram route plus
    `opaque_exact` confirmation
  - body-only whole-surface Han fallback confirmation
  - exact Han family matches continuing to outrank the fallback path
- `tests/src/services/search/coverage-lexical-v3/han-route.test.ts` passes
  after the fallback integration
- `npm run typecheck:build` passes on 2026-04-16

### Phase 24

Status: Completed on 2026-04-16

The current implementation now makes Han query-side real-term selection follow a
stable non-overlapping cover instead of blindly admitting every overlapping
tokenizer term:

- V3 Han query analysis now derives `primaryUnits` from the best non-overlapping
  real-term cover inside each Han surface group, rather than accepting every
  tokenizer-produced Han term that happens to be contained in the surface
- the cover prefers higher total realized Han character coverage first, then
  prefers the richer split cover when multiple non-overlapping explanations
  fully cover the same surface
- this keeps tokenizer-produced split real terms such as `赢宋 + 窄体`
  available as the main lexical explanation even when search-mode tokenization
  also emits a larger overlapping whole-surface candidate
- residual-span and bridge-bigram generation now operate against that stable
  cover, so fallback remains bounded to the truly uncovered parts of the Han
  surface instead of fighting an over-expanded primary-unit set
- V3 therefore stays in the real-term worldview while removing a query-side
  implementation mismatch that could block matches against document-side split
  Han families

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/query-analysis.test.ts`
  now verifies:
  - overlapping Han tokenizer terms collapse to a stable split cover for
    `赢宋窄体`
  - whole-surface Han real terms remain primary when no better split cover
    exists
- `tests/src/services/search/coverage-lexical-v3/engine.test.ts` now verifies
  that the stable Han query cover lets `赢宋窄体` match a longer basename surface
  through split real terms on the normal V3 path
- `tests/src/services/search/coverage-lexical-v3/han-route.test.ts` still
  passes after the query-cover change
- `npm run typecheck:build` passes on 2026-04-16

### Phase 24

Status: Completed on 2026-04-16

The current implementation now aligns V3 direct-subitem Han snippet
materialization with the candidate-level ranking worldview while keeping weak
tail hiding behind the existing `hideWeaklyRelatedResults` boolean:

- direct-subitems now admit snippets only when a local anchor exists:
  - `real_exact` / fuzzy-backed lexical anchors
  - witness-confirmed `opaque_han_confirmed` whole-group anchors
  - candidate-confirmed Han `surface_completion` anchors
- `opaque_han_confirmed` and `whole_group_backstop` candidates no longer go
  silent at snippet time when the selected file contains the corresponding Han
  surface span; the snippet builder now materializes that local anchor instead
  of requiring an unrelated local `han_tokenizer_real` hit first
- direct-subitem Han surface completion now inherits candidate-confirmed
  `hanSurfaceCompletionGroups` before falling back to local corroboration, so
  snippet rendering no longer uses a weaker "local literal only" worldview than
  the file-level comparator
- residual Han support remains display-only and anchor-attached:
  - bridge or residual Han support can now attach to confirmed opaque/surface
    anchors in addition to local real-term anchors
  - single-character residual support still renders only as weak highlight and
    cannot create a snippet, expand a window on its own, or raise coverage
- direct-subitem weak-tail hiding now uses only
  `hideWeaklyRelatedResults`:
  - `false` keeps all anchored snippets after structural dedupe
  - `true` keeps only non-overlapping snippets from the top anchor gate band
  - no new `weakFilePruneMode` split was introduced for direct subitems

Validation completed for this phase:

- `tests/src/services/search/coverage-lexical-v3/direct-subitems.test.ts`
  passes, including opaque whole-group Han anchor materialization and mixed
  Latin/Han highlight coverage
- `tests/src/services/search/coverage-lexical-v3/direct-subitems-resolver.test.ts`
  passes, including anchor-only admission and `hideWeaklyRelatedResults`
  top-gate pruning
- `tests/src/services/search/coverage-lexical-v3/direct-subitems-residual-support.test.ts`
  passes, covering bridge residual support, same-scope full-surface dominance,
  and metadata completion not globally suppressing body residual support
- `tests/src/services/search/coverage-lexical-v3/direct-subitems-shortlist.test.ts`
  passes after the Han anchor/support alignment
- `tests/src/services/search/coverage-lexical-v3/file-search-engine.test.ts`
  passes, confirming the file-level `hideWeaklyRelatedResults` path still
  drives the native direct-subitem behavior correctly
- `npm run typecheck:build` passes on 2026-04-16
