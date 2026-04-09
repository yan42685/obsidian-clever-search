# Benchmark Corpora

This directory stores benchmark corpus notes plus archived benchmark design docs for repeatable local runs.

## Layout

- `corpora/`: frozen benchmark corpora and local-only materialization targets
- `design/`: benchmark design notes, baselines, roadmaps, and archival anchors

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

### `big-vault-mixed-v1`

- local-only corpus materialized under `.codex-bench/corpora/big-vault-mixed-v1`
- target size: about 55 MB
- mixed-language by design:
  - large English web / reference docs
  - medium Chinese infrastructure docs
  - small English / Chinese PKM docs
- source buckets:
  - `mdn/content`: `files/en-us/web/`
  - `kubernetes/website`: `content/en/docs/concepts/`, `content/en/docs/tasks/`
  - `kubernetes/website`: `content/zh-cn/docs/concepts/`, `content/zh-cn/docs/tasks/`
  - `github/docs`: `content/actions/`
  - `obsidianmd/obsidian-help`: `en/`, `zh/`

Use `big-vault-mixed-v1` when you want a more realistic large-vault benchmark for file-read behavior, preload budgeting, and retrieval stress tests without committing tens of megabytes of source text into git.

## Reproducing the corpora

### `web-notes-v1`

- treat this as a frozen small snapshot for quick regression checks
- rebuild it by curating 36 markdown files from the same three source families:
  - Obsidian help
  - GitHub Actions docs
  - Kubernetes docs
- write the result to `benchmarks/corpora/web-notes-v1`
- once published, do not mutate membership in place; cut a new `web-notes-vN` directory instead

### `web-notes-v2`

- treat this as a frozen mixed-language snapshot for ranking and tokenization checks
- rebuild it by curating 32 markdown files into the same four buckets:
  - `pkm-en`
  - `tech-en`
  - `general-zh`
  - `tech-zh`
- keep the bucket intent stable:
  - English PKM / note-taking docs
  - English engineering / infrastructure docs
  - Chinese general writing / documentation notes
  - Chinese engineering / infrastructure docs
- write the result to `benchmarks/corpora/web-notes-v2`
- once published, do not mutate membership in place; cut a new `web-notes-vN` directory instead

### `big-vault-mixed-v1`

This corpus has a scripted reproduction path.

Materialize it locally with:

```bash
node scripts/sync-big-vault-corpus.mjs
```

Measure direct local read-path timings with:

```bash
node scripts/benchmark-big-vault-read.mjs
```

### `coverage-lexical-automation-v1`

This is the exact synthetic corpus used by `npm run benchmark:coverage-lexical`.

Materialize the benchmark corpus locally with:

```bash
npm run benchmark:coverage-lexical:materialize-corpus
```

The default output directory is:

```text
.codex-bench/corpora/coverage-lexical-automation-v1
```

That export contains:

- `vault/`: one materialized markdown note per benchmark document path
- `documents.json`: the exact document fields consumed by the benchmark harness
- `query-cases.json`: the exact benchmark queries and target paths
- `manifest.json`: corpus metadata, counts, and source-module provenance

If you want a different output directory, run:

```bash
node scripts/materialize-coverage-lexical-corpus.mjs --output=.codex-bench/corpora/my-coverage-corpus
```

Run the benchmark itself with:

```bash
npm run benchmark:coverage-lexical
```

The benchmark currently keeps `coverage-lexical-automation-v1` as the
continuity anchor, but the report now also splits results into intent gates:

- `product_guardrail_gate`
- `exception_aware_gate`
- `legacy_continuity_gate`

That reporting split does not change the synthetic corpus version. It only
makes it easier to tell whether a change hurt product-facing intent, exception
handling, or broad legacy continuity.

For coverage-lexical Chinese regression work, do not rely on this synthetic
benchmark alone. There are also dedicated regression suites for:

- tokenizer-side real-Chinese segmentation:
  - `npm test -- --runInBand tests/src/services/search/coverage-lexical-real-chinese-regression.test.ts`
- engine-side short-Chinese and mixed-script ranking checks:
  - `npm test -- --runInBand tests/src/services/search/coverage-lexical-real-chinese-engine-regression.test.ts`
- versioned real-tokenizer manifest gate:
  - `npm test -- --runInBand tests/src/services/search/coverage-lexical-real-tokenizer-gate.test.ts`

The dedicated real-tokenizer assets live in:

- `tests/src/services/search/coverage-lexical-real-tokenizer-manifest-v1.ts`

Those assets are the current place to protect realistic short-Chinese and
mixed-script display-front behavior with corrected Han text, including:

- `政治理论`
- `关于快乐的定义和适用范围`
- `projected token 运行时访问`
- `obsidian sync 问题`

That real-tokenizer gate is intentionally separate from the synthetic
`coverage-lexical-automation-v1` benchmark. Use it to verify:

- top1 correctness on realistic short Chinese / mixed-script queries
- display-front suppression of one-sided distractors once a balanced top result exists

Those dedicated regression suites are meant to cover realistic short Chinese
and mixed-script query shapes such as:

- `政治理论`
- `关于快乐的定义和适用范围`
- `projected token 运行时访问`
- `obsidian sync 问题`

The materialized corpus and the benchmark both come from the same generator:

- `tests/src/services/search/coverage-lexical-automation-benchmark.bench.ts#createAutomationCorpus`

## Design intent

These corpora are not meant to be "the truth" for retrieval quality.

They are meant to be:

- fixed enough for A/B comparison
- small enough for routine local runs
- varied enough to catch obvious overfitting to a single domain

Practical rule:

- use `web-notes-v1` for quick technical regression checks
- use `web-notes-v2` before promoting ranking or tokenization changes
- use `big-vault-mixed-v1` when you want a closer approximation of a real medium / large mixed-language vault
- use `benchmarks/design/` for the historical benchmark baselines, roadmaps, and design checkpoints that explain why a corpus or metric changed

## Maintenance

- keep corpus membership fixed unless there is a strong reason to change it
- if you change membership, create a new version directory instead of mutating an old one
- store source repo + commit sha + original path in a manifest file when possible
- prefer public markdown sources with clear provenance
- keep large local corpora in `.codex-bench/` unless there is a strong reason to commit them

