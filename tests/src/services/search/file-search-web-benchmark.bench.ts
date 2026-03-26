import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

type MatchedFile = {
	path: string;
	score?: number;
};

type CorpusBucket = "pkm-en" | "tech-en" | "general-zh" | "tech-zh";
type QueryType =
	| "title_exact"
	| "title_prefix"
	| "prefix_family"
	| "content_dense"
	| "content_noisy"
	| "topic_collision"
	| "unordered_terms"
	| "mixed_anchor"
	| "body_path_anchor"
	| "body_title_anchor"
	| "duplicate_conflict"
	| "template_collision"
	| "passage_competition"
	| "partial_memory"
	| "anchor_contradiction"
	| "bilingual_mirror";
type BenchmarkSuite = "core" | "adversarial" | "messy_pkm";
type BenchmarkMetric = {
	top1: number;
	top5: number;
	zeroRate: number;
	count: number;
};

type CorpusManifestRow = {
	bucket: CorpusBucket;
	localPath: string;
	repo: string;
	sha: string;
	sourcePath: string;
};

type CorpusNote = {
	path: string;
	bucket: CorpusBucket;
	title: string;
	headings: string[];
	content: string;
	doc: IndexedDocument;
	titleTokens: string[];
	contentTokens: string[];
	tfMap: Map<string, number>;
	hasChinese: boolean;
	hasLatin: boolean;
};

type QueryCase = {
	query: string;
	relevantPath: string;
	bucket: CorpusBucket;
	type: QueryType;
	suite: BenchmarkSuite;
};

type BenchmarkSummary = {
	name: string;
	top1: number;
	top5: number;
	zeroRate: number;
	mrr: number;
	avgMsPerQuery: number;
	p50Ms: number;
	p100Ms: number;
	estimatedIndexBytes: number;
	byBucket: Record<
		CorpusBucket,
		{ top1: number; top5: number; zeroRate: number; count: number }
	>;
	byType: Record<
		QueryType,
		{ top1: number; top5: number; zeroRate: number; count: number }
	>;
	bySuite: Record<
		BenchmarkSuite,
		{ top1: number; top5: number; zeroRate: number; count: number }
	>;
};

type QueryOutcome = {
	query: string;
	relevantPath: string;
	bucket: CorpusBucket;
	type: QueryType;
	suite: BenchmarkSuite;
	hitTop1: boolean;
	hitTop5: boolean;
	rank: number;
	results: string[];
};

type BenchmarkDocument = IndexedDocument & {
	bucket: CorpusBucket;
};

type EngineLike = {
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	searchFiles(request: {
		queryText: string;
		isPrefixMatch: boolean;
		isFuzzy: boolean;
		maxItemResults: number;
	}): Promise<MatchedFile[]>;
	serialize(): unknown;
};

const LATIN_STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"from",
	"this",
	"into",
	"about",
	"your",
	"their",
	"have",
	"will",
	"not",
	"are",
	"was",
	"were",
	"use",
	"using",
	"you",
	"but",
	"can",
	"via",
	"docs",
	"doc",
	"note",
	"notes",
	"guide",
	"introduction",
	"overview",
	"kubernetes",
	"obsidian",
	"github",
	"actions",
]);

const HAN_REGEX = /\p{Script=Han}/u;
const LATIN_SEGMENT_REGEX = /[a-z0-9][a-z0-9_-]*/g;
const MIXED_SEGMENT_REGEX = /[\p{Script=Han}]+|[a-z0-9][a-z0-9_-]*/gu;
const FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const HEADING_REGEX = /^#{1,6}\s+(.+)$/gm;
const CORPUS_BUCKETS: readonly CorpusBucket[] = [
	"pkm-en",
	"tech-en",
	"general-zh",
	"tech-zh",
];
const QUERY_TYPES: readonly QueryType[] = [
	"title_exact",
	"title_prefix",
	"prefix_family",
	"content_dense",
	"content_noisy",
	"topic_collision",
	"unordered_terms",
	"mixed_anchor",
	"body_path_anchor",
	"body_title_anchor",
	"duplicate_conflict",
	"template_collision",
	"passage_competition",
	"partial_memory",
	"anchor_contradiction",
	"bilingual_mirror",
];
const BENCHMARK_SUITES: readonly BenchmarkSuite[] = [
	"core",
	"adversarial",
	"messy_pkm",
];

function createMockTokenizer(): MockTokenizer {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}

	function tokenizeChineseSegment(segment: string): string[] {
		const compact = segment.replace(/\s+/g, "");
		if (compact.length < 2) {
			return [];
		}

		const tokens = new Set<string>();
		if (compact.length <= 4) {
			tokens.add(compact);
		}
		for (let i = 0; i < compact.length - 1; i++) {
			tokens.add(compact.slice(i, i + 2));
		}
		return Array.from(tokens);
	}

	function tokenizeLatinSegment(segment: string): string[] {
		const tokens: string[] = [];
		for (const word of segment.match(LATIN_SEGMENT_REGEX) ?? []) {
			if (word.length < 2 || LATIN_STOPWORDS.has(word)) {
				continue;
			}
			tokens.push(word);
			if (word.length > 3) {
				for (const subword of word
					.replace(/[-_]|([a-z](?=[A-Z]))/g, "$1 ")
					.split(/\s+/g)) {
					if (subword.length > 1 && !LATIN_STOPWORDS.has(subword)) {
						tokens.push(subword);
					}
				}
			}
		}
		return tokens;
	}

	return {
		tokenize(text: string): string[] {
			return Array.from(new Set(this.tokenizeSequence(text)));
		},
		tokenizeSequence(text: string): string[] {
			const normalized = normalize(text);
			const out: string[] = [];
			for (const segment of normalized.match(MIXED_SEGMENT_REGEX) ?? []) {
				if (HAN_REGEX.test(segment)) {
					out.push(...tokenizeChineseSegment(segment));
				} else {
					out.push(...tokenizeLatinSegment(segment));
				}
			}
			return out.filter((token) => token.length >= 2 && token.length < 30);
		},
	};
}

function stripFrontmatter(raw: string): string {
	return raw.replace(FRONTMATTER_REGEX, "");
}

function extractHeadings(raw: string): string[] {
	return Array.from(stripFrontmatter(raw).matchAll(HEADING_REGEX), (match) =>
		match[1].trim(),
	);
}

function extractTitle(raw: string, fallback: string): string {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const titleMatch = frontmatter?.[1].match(/^title:\s*(.+)$/m);
	if (titleMatch?.[1]) {
		return titleMatch[1].trim().replace(/^["']|["']$/g, "");
	}
	const firstHeading = extractHeadings(raw)[0];
	return firstHeading || fallback;
}

function readManifest(): CorpusManifestRow[] {
	const manifestPath = path.join(
		process.cwd(),
		"benchmarks",
		"corpora",
		"web-notes-v2",
		"manifest.json",
	);
	const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
		notes: CorpusManifestRow[];
	};
	return parsed.notes;
}

function createCorpusNotes(tokenizer: MockTokenizer): CorpusNote[] {
	const root = path.join(process.cwd(), "benchmarks", "corpora", "web-notes-v2");
	return readManifest().map((entry) => {
		const absolutePath = path.join(root, entry.localPath);
		const raw = fs.readFileSync(absolutePath, "utf8");
		const sourceFallback = path.basename(entry.sourcePath, path.extname(entry.sourcePath));
		const title = extractTitle(raw, sourceFallback);
		const headings = extractHeadings(raw);
		const content = stripFrontmatter(raw);
		const titleTokens = tokenizer.tokenizeSequence(title);
		const contentTokens = tokenizer.tokenizeSequence(content);
		const tfMap = new Map<string, number>();
		for (const token of contentTokens) {
			tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
		}
		return {
			path: entry.localPath.replace(/\\/g, "/"),
			bucket: entry.bucket,
			title,
			headings,
			content,
			doc: {
				path: entry.localPath.replace(/\\/g, "/"),
				basename: title,
				folder: path.posix.dirname(entry.localPath.replace(/\\/g, "/")),
				headings: headings.join(" "),
				content,
				aliases: "",
				tags: "",
			},
			titleTokens,
			contentTokens,
			tfMap,
			hasChinese: HAN_REGEX.test(content),
			hasLatin: /[a-z]/i.test(content),
		};
	});
}

function computeDocumentFrequency(notes: CorpusNote[]): Map<string, number> {
	const df = new Map<string, number>();
	for (const note of notes) {
		const seen = new Set(note.contentTokens);
		for (const token of seen) {
			df.set(token, (df.get(token) ?? 0) + 1);
		}
	}
	return df;
}

function sortBySalience(
	note: CorpusNote,
	df: Map<string, number>,
	excludedTokens: Set<string>,
): string[] {
	const docCount = Math.max(1, df.size);
	return Array.from(note.tfMap.entries())
		.filter(([token]) => !excludedTokens.has(token))
		.sort((a, b) => {
			const aDf = df.get(a[0]) ?? 1;
			const bDf = df.get(b[0]) ?? 1;
			const aScore = a[1] * Math.log((docCount + 1) / aDf);
			const bScore = b[1] * Math.log((docCount + 1) / bDf);
			if (bScore !== aScore) {
				return bScore - aScore;
			}
			return b[0].length - a[0].length;
		})
		.map(([token]) => token);
}

function buildTitlePrefixQuery(note: CorpusNote): string | null {
	if (HAN_REGEX.test(note.title)) {
		const compact = note.title.replace(/\s+/g, "");
		return compact.length >= 3 ? compact.slice(0, compact.length - 1) : null;
	}

	const words = note.title
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((word) => word.length >= 2 && !LATIN_STOPWORDS.has(word));
	if (words.length === 0) {
		return null;
	}
	if (words.length === 1) {
		return words[0].length >= 4 ? words[0].slice(0, words[0].length - 1) : null;
	}
	const last = words[words.length - 1];
	if (last.length < 4) {
		return words.join(" ");
	}
	return [...words.slice(0, -1), last.slice(0, last.length - 1)].join(" ");
}

function buildMixedAnchorQuery(note: CorpusNote, salientTokens: string[]): string | null {
	const latinToken = salientTokens.find((token) => /[a-z]/i.test(token));
	const hanToken = salientTokens.find((token) => HAN_REGEX.test(token));
	if (!latinToken || !hanToken) {
		return null;
	}
	return `${latinToken} ${hanToken}`;
}

function buildBodyPathAnchorQuery(
	note: CorpusNote,
	salientTokens: string[],
	tokenizer: MockTokenizer,
): string | null {
	const pathTokens = tokenizer
		.tokenizeSequence(`${note.path} ${note.doc.folder}`)
		.filter((token) => !note.tfMap.has(token) || note.titleTokens.includes(token));
	const anchor = pathTokens.find((token) => token.length >= 2);
	if (!anchor || salientTokens.length < 2) {
		return null;
	}
	return `${anchor} ${salientTokens[0]} ${salientTokens[1]}`;
}

function buildBodyTitleAnchorQuery(
	note: CorpusNote,
	salientTokens: string[],
	tokenizer: MockTokenizer,
): string | null {
	const titleAnchors = tokenizer
		.tokenizeSequence(`${note.title} ${note.headings.join(" ")}`)
		.filter((token) => token.length >= 2);
	const anchor = titleAnchors.find((token) => !LATIN_STOPWORDS.has(token));
	if (!anchor || salientTokens.length < 2) {
		return null;
	}
	return `${anchor} ${salientTokens[0]} ${salientTokens[1]}`;
}

function getDefaultSuiteForType(type: QueryType): BenchmarkSuite {
	switch (type) {
		case "title_exact":
		case "title_prefix":
		case "content_dense":
			return "core";
		case "prefix_family":
		case "unordered_terms":
		case "content_noisy":
		case "topic_collision":
		case "mixed_anchor":
		case "body_path_anchor":
		case "body_title_anchor":
		case "duplicate_conflict":
		case "template_collision":
		case "passage_competition":
		case "partial_memory":
		case "anchor_contradiction":
		case "bilingual_mirror":
			return "adversarial";
	}
}

function buildQueryCases(notes: CorpusNote[], tokenizer: MockTokenizer): QueryCase[] {
	const df = computeDocumentFrequency(notes);
	const cases: Array<Omit<QueryCase, "suite">> = [];

	for (const note of notes) {
		const titleQuery = note.title.trim();
		if (titleQuery.length > 0) {
			cases.push({
				query: titleQuery,
				relevantPath: note.path,
				bucket: note.bucket,
				type: "title_exact",
			});
		}

		const titlePrefix = buildTitlePrefixQuery(note);
		if (titlePrefix) {
			cases.push({
				query: titlePrefix,
				relevantPath: note.path,
				bucket: note.bucket,
				type: "title_prefix",
			});
		}

		const excluded = new Set(note.titleTokens);
		const salientTokens = sortBySalience(note, df, excluded);
		if (salientTokens.length >= 3) {
			cases.push({
				query: salientTokens.slice(0, 3).join(" "),
				relevantPath: note.path,
				bucket: note.bucket,
				type: "content_dense",
			});
			cases.push({
				query: [...salientTokens.slice(0, 3)].reverse().join(" "),
				relevantPath: note.path,
				bucket: note.bucket,
				type: "unordered_terms",
			});
		}

		if (salientTokens.length >= 2) {
			const distractor = notes
				.filter((candidate) => candidate.path !== note.path)
				.map((candidate) =>
					sortBySalience(candidate, df, new Set(candidate.titleTokens))[0],
				)
				.find((token) => token && !note.tfMap.has(token));
			if (distractor) {
				cases.push({
					query: `${salientTokens[0]} ${salientTokens[1]} ${distractor}`,
					relevantPath: note.path,
					bucket: note.bucket,
					type: "content_noisy",
				});
			}
		}

		const mixedAnchor = buildMixedAnchorQuery(note, salientTokens);
		if (mixedAnchor) {
			cases.push({
				query: mixedAnchor,
				relevantPath: note.path,
				bucket: note.bucket,
				type: "mixed_anchor",
			});
		}

		const bodyPathAnchor = buildBodyPathAnchorQuery(
			note,
			salientTokens,
			tokenizer,
		);
		if (bodyPathAnchor) {
			cases.push({
				query: bodyPathAnchor,
				relevantPath: note.path,
				bucket: note.bucket,
				type: "body_path_anchor",
			});
		}

		const bodyTitleAnchor = buildBodyTitleAnchorQuery(
			note,
			salientTokens,
			tokenizer,
		);
		if (bodyTitleAnchor) {
			cases.push({
				query: bodyTitleAnchor,
				relevantPath: note.path,
				bucket: note.bucket,
				type: "body_title_anchor",
			});
		}
	}

	const deduped = new Map<string, Omit<QueryCase, "suite">>();
	for (const queryCase of cases) {
		const key = `${queryCase.relevantPath}::${queryCase.type}::${queryCase.query}`;
		deduped.set(key, queryCase);
	}
	return Array.from(deduped.values())
		.filter((queryCase) => tokenizer.tokenize(queryCase.query).length > 0)
		.map((queryCase) => ({
			...queryCase,
			suite: getDefaultSuiteForType(queryCase.type),
		}));
}

function createManualBenchmarkCorpus(
	tokenizer: MockTokenizer,
): { documents: BenchmarkDocument[]; queryCases: QueryCase[] } {
	const documents: BenchmarkDocument[] = [
		{
			bucket: "tech-en",
			path: "adversarial/tech-en/configmaps-rollout-en.md",
			basename: "ConfigMaps rollout guide",
			folder: "adversarial/tech-en",
			headings: "Apply order Restart checks",
			content: [
				"Keep rollout notes short.",
				"Applying namespace defaults before mounting env files avoids stale data during restart.",
				"This guide explains why ConfigMaps rollout order matters for stable recovery.",
			].join("\n\n"),
		},
		{
			bucket: "tech-zh",
			path: "adversarial/tech-zh/configmaps-rollout-zh.md",
			basename: "ConfigMap 发布指南",
			folder: "adversarial/tech-zh",
			headings: "Apply order Restart checks",
			content: [
				"ConfigMaps rollout 需要先应用命名空间默认值，再挂载环境文件，否则会出现陈旧数据。",
				"这份笔记主要记录发布顺序和重启后的校验步骤。",
			].join("\n\n"),
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/projects/sdk/vector-cache.md",
			basename: "Vector cache playbook",
			folder: "adversarial/pkm-en/projects/sdk",
			headings: "Eviction restore",
			content:
				"vector cache eviction keeps sdk search warm after shard checkpoint restore",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/archive/vector-cache.md",
			basename: "Vector cache playbook",
			folder: "adversarial/pkm-en/archive",
			headings: "Eviction restore",
			content:
				"vector cache eviction keeps archive search warm after shard checkpoint restore",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/notes/aliases-deep-dive.md",
			basename: "Aliases deep dive",
			folder: "adversarial/pkm-en/notes",
			headings: "Create a link example",
			content:
				"aliases let one note answer to multiple names when link text drifts across old projects",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/notes/internal-links-playbook.md",
			basename: "Internal links playbook",
			folder: "adversarial/pkm-en/notes",
			headings: "Create a link example",
			content:
				"internal links use wikilinks to connect notes and blocks across a vault",
		},
		{
			bucket: "tech-en",
			path: "core/tech-en/reference/configmap.md",
			basename: "ConfigMap",
			folder: "core/tech-en/reference",
			headings: "Definition",
			content:
				"configmap stores non-secret configuration for pods and workloads",
		},
		{
			bucket: "tech-en",
			path: "core/tech-en/guides/configmaps-rollout.md",
			basename: "ConfigMaps rollout guide",
			folder: "core/tech-en/guides",
			headings: "Restart order",
			content:
				"configmaps rollout guidance explains restart order and configmap refresh during staged deployment",
		},
		{
			bucket: "tech-en",
			path: "core/tech-en/reference/secret.md",
			basename: "Secret",
			folder: "core/tech-en/reference",
			headings: "Definition",
			content: "secret stores sensitive values for workloads and cluster access",
		},
		{
			bucket: "tech-en",
			path: "core/tech-en/guides/secrets-rotation.md",
			basename: "Secrets rotation guide",
			folder: "core/tech-en/guides",
			headings: "Rotation steps",
			content:
				"secret rotation guidance covers staged rollout audit checks and repeated secret updates",
		},
		{
			bucket: "tech-en",
			path: "core/tech-en/reference/ingress.md",
			basename: "Ingress",
			folder: "core/tech-en/reference",
			headings: "Definition",
			content:
				"ingress exposes http routes and host rules for services inside a cluster",
		},
		{
			bucket: "tech-en",
			path: "core/tech-en/guides/ingress-controller-tuning.md",
			basename: "Ingress controller tuning",
			folder: "core/tech-en/guides",
			headings: "Controller tips",
			content:
				"ingress controller tuning discusses retries load balancer sync and repeated ingress updates",
		},
		{
			bucket: "pkm-en",
			path: "core/pkm-en/reference/create-a-link.md",
			basename: "Create a link",
			folder: "core/pkm-en/reference",
			headings: "Basic syntax",
			content:
				"create a link explains the basic wikilink syntax for connecting notes",
		},
		{
			bucket: "pkm-en",
			path: "core/pkm-en/guides/linking-patterns.md",
			basename: "Linking patterns",
			folder: "core/pkm-en/guides",
			headings: "Create a link example",
			content:
				"linking patterns show how to create a link across headings blocks and project pages",
		},
		{
			bucket: "pkm-en",
			path: "messy-pkm/en/journal/2026-03-22.md",
			basename: "Daily log",
			folder: "messy-pkm/en/journal",
			aliases: "search drift incident",
			tags: "daily worklog",
			headings: "Tasks Notes Next steps Links",
			content: [
				"- [ ] inbox zero",
				"- [ ] update dashboard",
				"## Notes",
				"Copied template lines stay here every day.",
				"stale checkpoint replay brought back vector cache drift during warm start after the reboot.",
				"## Links",
				"- [[Search]]",
			].join("\n"),
		},
		{
			bucket: "pkm-en",
			path: "messy-pkm/en/templates/daily-log.md",
			basename: "Daily log",
			folder: "messy-pkm/en/templates",
			tags: "template",
			headings: "Tasks Notes Next steps Links",
			content: [
				"- [ ] inbox zero",
				"- [ ] plan tomorrow",
				"## Notes",
				"This template keeps daily notes uniform for reviews and team links.",
				"## Next steps",
				"Write a short summary before the warm start review.",
			].join("\n"),
		},
		{
			bucket: "general-zh",
			path: "messy-pkm/zh/weekly/2026-w12.md",
			basename: "周报",
			folder: "messy-pkm/zh/weekly",
			aliases: "检索 漂移 事故",
			tags: "周报 日志",
			headings: "任务 记录 决定",
			content: [
				"本周排查发现检索抖动来自陈旧分段检查点回放，重启后缓存漂移再次出现。",
				"最终决定先缩小窗口，再补 verifier。",
			].join("\n"),
		},
		{
			bucket: "general-zh",
			path: "messy-pkm/zh/templates/weekly-template.md",
			basename: "周报",
			folder: "messy-pkm/zh/templates",
			tags: "模板",
			headings: "任务 记录 决定",
			content: [
				"本模板用于记录任务、决定和下周计划。",
				"如无特殊情况，请保持段落顺序一致。",
			].join("\n"),
		},
		{
			bucket: "pkm-en",
			path: "messy-pkm/en/archive/zx-14.md",
			basename: "Search stabilization retrospective",
			folder: "messy-pkm/en/archive",
			aliases: "checkpoint replay incident",
			headings: "Warm start Recovery",
			content:
				"the zx-14 incident showed stale checkpoint replay can outrank fresh passages after restart",
		},
		{
			bucket: "pkm-en",
			path: "messy-pkm/en/runbooks/checkpoint-replay.md",
			basename: "Checkpoint replay runbook",
			folder: "messy-pkm/en/runbooks",
			headings: "Recovery",
			content:
				"checkpoint replay protects recovery when shard checkpoints are valid and segments are fresh",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/incidents/incident-review.md",
			basename: "Incident review",
			folder: "adversarial/pkm-en/incidents",
			tags: "incident review",
			headings: "Symptoms Root cause Follow-ups",
			content:
				"this incident review explains how checkpoint replay amplified rerank drift when a stale warm-start passage survived verifier frontier pruning during recovery",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/templates/incident-review.md",
			basename: "Incident review",
			folder: "adversarial/pkm-en/templates",
			tags: "template incident",
			headings: "Symptoms Root cause Follow-ups",
			content:
				"this incident review template is for writing owner summary timeline and follow-up actions",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/projects/retrieval/search-latency.md",
			basename: "Search latency notes",
			folder: "adversarial/pkm-en/projects/retrieval",
			headings: "Verifier frontier",
			content:
				"search latency notes explain why verifier frontier narrowing keeps rerank latency predictable during interactive retrieval",
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/archive/search-latency.md",
			basename: "Search latency notes",
			folder: "adversarial/pkm-en/archive",
			headings: "Verifier frontier",
			content:
				"search latency notes summarize an archive migration and historical rerank rules without active frontier tuning",
		},
		{
			bucket: "general-zh",
			path: "adversarial/general-zh/retrieval-frontier-zh.md",
			basename: "检索前沿排查",
			folder: "adversarial/general-zh",
			aliases: "retrieval frontier",
			headings: "warm start",
			content: [
				"检索前沿排查记录了 warm start 期间 verifier frontier 因旧 checkpoint 而出现 rerank drift。",
				"真正的问题不是 latency budgeting，而是 local window 证据被旧缓存放大。",
			].join("\n\n"),
		},
		{
			bucket: "pkm-en",
			path: "adversarial/pkm-en/projects/retrieval-frontier-en.md",
			basename: "Retrieval frontier notes",
			folder: "adversarial/pkm-en/projects",
			aliases: "检索前沿",
			headings: "warm start",
			content: [
				"retrieval frontier notes describe warm start checkpoint trimming and latency budgeting for interactive search.",
				"this note does not discuss rerank drift; it focuses on predictable frontier cost.",
			].join("\n\n"),
		},
		{
			bucket: "tech-en",
			path: "adversarial/tech-en/runbooks/rollout-cache-diagnosis.md",
			basename: "Rollout cache diagnosis",
			folder: "adversarial/tech-en/runbooks",
			headings: "Restart window",
			content: [
				"configmap rollout cache invalidation can reuse a stale mount state inside one restart window during recovery.",
				"this runbook keeps the decisive explanation inside a single compact passage for operators.",
			].join("\n\n"),
		},
		{
			bucket: "tech-en",
			path: "adversarial/tech-en/notes/rollout-cache-diagnosis.md",
			basename: "Rollout cache diagnosis",
			folder: "adversarial/tech-en/notes",
			headings: "Restart window Appendix",
			content: [
				"configmap defaults are listed here.",
				"cache invalidation appears in a separate checklist.",
				"restart window reminders live in a copied appendix.",
				"stale mount state was mentioned in an unrelated migration note.",
			].join("\n\n"),
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/ordered-prefix-family.md",
			basename: "Ordered prefix family note",
			folder: "adversarial/prefix-lab/en",
			headings: "Family scoring",
			content:
				"alphaone betatwo gammathree keeps ordered family evidence compact for prefix retrieval",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/shuffled-prefix-family.md",
			basename: "Shuffled prefix family note",
			folder: "adversarial/prefix-lab/en",
			headings: "Family scoring",
			content:
				"betatwo gammathree alphaone keeps the same family evidence in a noisier shuffled order",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/exact-prefix-family.md",
			basename: "Exact prefix family note",
			folder: "adversarial/prefix-lab/en",
			headings: "Compact witness",
			content:
				"config data rollout keeps exact family evidence in one compact passage",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/expanded-prefix-family.md",
			basename: "Expanded prefix family note",
			folder: "adversarial/prefix-lab/en",
			headings: "Compact witness",
			content:
				"configmap datastore rollout keeps expanded family evidence in one compact passage",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/connection-policy-timeout.md",
			basename: "Connection policy timeout",
			folder: "adversarial/prefix-lab/en",
			headings: "Compact witness",
			content:
				"connection policy timeout keeps one compact control path stable during service recovery and retry",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/config-container-timer-noise.md",
			basename: "Config container timer noise",
			folder: "adversarial/prefix-lab/en",
			headings: "Noisy witness",
			content:
				"config configmap container connector timers and topic fragments create many short prefix collisions without the real policy timeout explanation",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/unordered-full-family.md",
			basename: "Unordered full family note",
			folder: "adversarial/prefix-lab/en",
			headings: "Coverage witness",
			content:
				"betatwo deltafour alphaone gammathree keeps all four family witnesses inside one compact passage",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/ordered-partial-family.md",
			basename: "Ordered partial family note",
			folder: "adversarial/prefix-lab/en",
			headings: "Coverage witness",
			content:
				"gammathree alphaone deltafour keeps an ordered trio but lacks the betatwo family witness",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/unordered-prefix-noise.md",
			basename: "Unordered prefix noise note",
			folder: "adversarial/prefix-lab/en",
			headings: "Coverage witness",
			content:
				"deltaforce alphabet gossip and connector fragments look similar to multiple prefix families but never provide full compact coverage",
		},
		{
			bucket: "tech-en",
			path: "adversarial/prefix-lab/en/exact-prefix-noise.md",
			basename: "Exact prefix noise note",
			folder: "adversarial/prefix-lab/en",
			headings: "Compact witness",
			content:
				"configmap dashboard rollout keeper repeats expanded family fragments without the exact config data rollout witness",
		},
		{
			bucket: "tech-zh",
			path: "adversarial/prefix-lab/zh/hybrid-prefix-family.md",
			basename: "混合 prefix family",
			folder: "adversarial/prefix-lab/zh",
			headings: "局部顺序",
			content:
				"混合检索 prefix family scoring keeps ordered evidence compact across scripts",
		},
		{
			bucket: "tech-zh",
			path: "adversarial/prefix-lab/zh/hybrid-prefix-noise.md",
			basename: "混合 prefix noise",
			folder: "adversarial/prefix-lab/zh",
			headings: "局部顺序",
			content:
				"prefix guide for mixed scripts keeps family scoring noisy and reversed 检索混合",
		},
		{
			bucket: "tech-zh",
			path: "adversarial/prefix-lab/zh/hybrid-prefix-quad.md",
			basename: "混合 prefix quad",
			folder: "adversarial/prefix-lab/zh",
			headings: "局部顺序",
			content:
				"混合检索 prefix family scoring keeps compact evidence across scripts and retry windows",
		},
	];

	const queryCases: QueryCase[] = [
		{
			query: "configmaps rollout stale data",
			relevantPath: "adversarial/tech-en/configmaps-rollout-en.md",
			bucket: "tech-en",
			type: "body_title_anchor",
			suite: "adversarial",
		},
		{
			query: "configmaps 发布 陈旧 数据",
			relevantPath: "adversarial/tech-zh/configmaps-rollout-zh.md",
			bucket: "tech-zh",
			type: "body_title_anchor",
			suite: "adversarial",
		},
		{
			query: "sdk vector cache eviction",
			relevantPath: "adversarial/pkm-en/projects/sdk/vector-cache.md",
			bucket: "pkm-en",
			type: "body_path_anchor",
			suite: "adversarial",
		},
		{
			query: "archive vector cache eviction",
			relevantPath: "adversarial/pkm-en/archive/vector-cache.md",
			bucket: "pkm-en",
			type: "body_path_anchor",
			suite: "adversarial",
		},
		{
			query: "aliases create link drifts",
			relevantPath: "adversarial/pkm-en/notes/aliases-deep-dive.md",
			bucket: "pkm-en",
			type: "body_title_anchor",
			suite: "adversarial",
		},
		{
			query: "internal links create blocks",
			relevantPath: "adversarial/pkm-en/notes/internal-links-playbook.md",
			bucket: "pkm-en",
			type: "body_title_anchor",
			suite: "adversarial",
		},
		{
			query: "configmap",
			relevantPath: "core/tech-en/reference/configmap.md",
			bucket: "tech-en",
			type: "title_exact",
			suite: "core",
		},
		{
			query: "secret",
			relevantPath: "core/tech-en/reference/secret.md",
			bucket: "tech-en",
			type: "title_exact",
			suite: "core",
		},
		{
			query: "ingres",
			relevantPath: "core/tech-en/reference/ingress.md",
			bucket: "tech-en",
			type: "title_prefix",
			suite: "core",
		},
		{
			query: "create lin",
			relevantPath: "core/pkm-en/reference/create-a-link.md",
			bucket: "pkm-en",
			type: "title_prefix",
			suite: "core",
		},
		{
			query: "search drift warm start checkpoint",
			relevantPath: "messy-pkm/en/journal/2026-03-22.md",
			bucket: "pkm-en",
			type: "content_dense",
			suite: "messy_pkm",
		},
		{
			query: "search drift incident checkpoint",
			relevantPath: "messy-pkm/en/journal/2026-03-22.md",
			bucket: "pkm-en",
			type: "body_title_anchor",
			suite: "messy_pkm",
		},
		{
			query: "检索 抖动 检查点 回放",
			relevantPath: "messy-pkm/zh/weekly/2026-w12.md",
			bucket: "general-zh",
			type: "content_dense",
			suite: "messy_pkm",
		},
		{
			query: "漂移 事故 回放",
			relevantPath: "messy-pkm/zh/weekly/2026-w12.md",
			bucket: "general-zh",
			type: "body_title_anchor",
			suite: "messy_pkm",
		},
		{
			query: "zx-14 stale checkpoint replay",
			relevantPath: "messy-pkm/en/archive/zx-14.md",
			bucket: "pkm-en",
			type: "body_path_anchor",
			suite: "messy_pkm",
		},
		{
			query: "checkpoint replay fresh passages restart",
			relevantPath: "messy-pkm/en/archive/zx-14.md",
			bucket: "pkm-en",
			type: "content_dense",
			suite: "messy_pkm",
		},
		{
			query: "incident review checkpoint replay rerank drift",
			relevantPath: "adversarial/pkm-en/incidents/incident-review.md",
			bucket: "pkm-en",
			type: "template_collision",
			suite: "adversarial",
		},
		{
			query: "incident review stale warm-start passage",
			relevantPath: "adversarial/pkm-en/incidents/incident-review.md",
			bucket: "pkm-en",
			type: "template_collision",
			suite: "adversarial",
		},
		{
			query: "template incident review follow-up actions",
			relevantPath: "adversarial/pkm-en/templates/incident-review.md",
			bucket: "pkm-en",
			type: "template_collision",
			suite: "adversarial",
		},
		{
			query: "retrieval search latency verifier frontier",
			relevantPath: "adversarial/pkm-en/projects/retrieval/search-latency.md",
			bucket: "pkm-en",
			type: "duplicate_conflict",
			suite: "adversarial",
		},
		{
			query: "archive search latency migration rerank rules",
			relevantPath: "adversarial/pkm-en/archive/search-latency.md",
			bucket: "pkm-en",
			type: "duplicate_conflict",
			suite: "adversarial",
		},
		{
			query: "restart window cache invalidation configmap rollout",
			relevantPath: "adversarial/tech-en/runbooks/rollout-cache-diagnosis.md",
			bucket: "tech-en",
			type: "passage_competition",
			suite: "adversarial",
		},
		{
			query: "stale mount state recovery runbook",
			relevantPath: "adversarial/tech-en/runbooks/rollout-cache-diagnosis.md",
			bucket: "tech-en",
			type: "passage_competition",
			suite: "adversarial",
		},
		{
			query: "appendix copied restart window note",
			relevantPath: "adversarial/tech-en/notes/rollout-cache-diagnosis.md",
			bucket: "tech-en",
			type: "duplicate_conflict",
			suite: "adversarial",
		},
		{
			query: "restart window stale mount appendix",
			relevantPath: "adversarial/tech-en/runbooks/rollout-cache-diagnosis.md",
			bucket: "tech-en",
			type: "partial_memory",
			suite: "adversarial",
		},
		{
			query: "search latency migration predictable frontier",
			relevantPath: "adversarial/pkm-en/projects/retrieval/search-latency.md",
			bucket: "pkm-en",
			type: "partial_memory",
			suite: "adversarial",
		},
		{
			query: "interactive archive frontier latency",
			relevantPath: "adversarial/pkm-en/projects/retrieval/search-latency.md",
			bucket: "pkm-en",
			type: "partial_memory",
			suite: "adversarial",
		},
		{
			query: "notes restart window operators stale mount",
			relevantPath: "adversarial/tech-en/runbooks/rollout-cache-diagnosis.md",
			bucket: "tech-en",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "template incident review checkpoint drift",
			relevantPath: "adversarial/pkm-en/incidents/incident-review.md",
			bucket: "pkm-en",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "template incident warm-start recovery",
			relevantPath: "adversarial/pkm-en/incidents/incident-review.md",
			bucket: "pkm-en",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "检索 frontier rerank drift",
			relevantPath: "adversarial/general-zh/retrieval-frontier-zh.md",
			bucket: "general-zh",
			type: "bilingual_mirror",
			suite: "adversarial",
		},
		{
			query: "retrieval 前沿 checkpoint trimming",
			relevantPath: "adversarial/pkm-en/projects/retrieval-frontier-en.md",
			bucket: "pkm-en",
			type: "bilingual_mirror",
			suite: "adversarial",
		},
		{
			query: "configmap pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
			bucket: "tech-en",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "secret pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/secret.md",
			bucket: "tech-en",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "ingressclass service",
			relevantPath: "tech-en/content/en/docs/concepts/services-networking/ingress.md",
			bucket: "tech-en",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "service pod traffic",
			relevantPath: "tech-en/content/en/docs/concepts/services-networking/service.md",
			bucket: "tech-en",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "deployment pod rollout",
			relevantPath:
				"tech-en/content/en/docs/concepts/workloads/controllers/deployment.md",
			bucket: "tech-en",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "namespace pod object",
			relevantPath:
				"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
			bucket: "tech-en",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "tech-zh pod data",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			bucket: "tech-zh",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "tech-zh secret pod data",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			bucket: "tech-zh",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "tech-zh ingress service to",
			relevantPath:
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			bucket: "tech-zh",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "tech-zh service pod traffic",
			relevantPath:
				"tech-zh/content/zh-cn/docs/concepts/services-networking/service.md",
			bucket: "tech-zh",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "tech-zh deployment pod rollout",
			relevantPath:
				"tech-zh/content/zh-cn/docs/concepts/workloads/controllers/deployment.md",
			bucket: "tech-zh",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "tech-zh namespace pod object",
			relevantPath:
				"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
			bucket: "tech-zh",
			type: "topic_collision",
			suite: "adversarial",
		},
		{
			query: "concepts configuration pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
			bucket: "tech-en",
			type: "body_path_anchor",
			suite: "adversarial",
		},
		{
			query: "concepts ingressclass service",
			relevantPath: "tech-en/content/en/docs/concepts/services-networking/ingress.md",
			bucket: "tech-en",
			type: "body_path_anchor",
			suite: "adversarial",
		},
		{
			query: "tech-zh concepts pod data",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			bucket: "tech-zh",
			type: "body_path_anchor",
			suite: "adversarial",
		},
		{
			query: "tech-zh concepts ingress service",
			relevantPath:
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			bucket: "tech-zh",
			type: "body_path_anchor",
			suite: "adversarial",
		},
		{
			query: "configuration sensitive pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/secret.md",
			bucket: "tech-en",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "configuration mounted files pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
			bucket: "tech-en",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "tech-zh configuration pod sensitive data",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
			bucket: "tech-zh",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "tech-zh configuration mounted pod data",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			bucket: "tech-zh",
			type: "anchor_contradiction",
			suite: "adversarial",
		},
		{
			query: "tech-en configmap pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
			bucket: "tech-en",
			type: "bilingual_mirror",
			suite: "adversarial",
		},
		{
			query: "tech-en ingress service",
			relevantPath: "tech-en/content/en/docs/concepts/services-networking/ingress.md",
			bucket: "tech-en",
			type: "bilingual_mirror",
			suite: "adversarial",
		},
		{
			query: "tech-zh configmap pod data",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
			bucket: "tech-zh",
			type: "bilingual_mirror",
			suite: "adversarial",
		},
		{
			query: "tech-zh ingress service",
			relevantPath:
				"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			bucket: "tech-zh",
			type: "bilingual_mirror",
			suite: "adversarial",
		},
		{
			query: "alp bet gam",
			relevantPath: "adversarial/prefix-lab/en/ordered-prefix-family.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "gam alp del bet",
			relevantPath: "adversarial/prefix-lab/en/unordered-full-family.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "del bet alp gam",
			relevantPath: "adversarial/prefix-lab/en/unordered-full-family.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "config da ro",
			relevantPath: "adversarial/prefix-lab/en/exact-prefix-family.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "config da ro keep",
			relevantPath: "adversarial/prefix-lab/en/exact-prefix-family.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "config data ro pas",
			relevantPath: "adversarial/prefix-lab/en/exact-prefix-family.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "con pol tim",
			relevantPath: "adversarial/prefix-lab/en/connection-policy-timeout.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "con pol tim rec",
			relevantPath: "adversarial/prefix-lab/en/connection-policy-timeout.md",
			bucket: "tech-en",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "混合 pre fam",
			relevantPath: "adversarial/prefix-lab/zh/hybrid-prefix-family.md",
			bucket: "tech-zh",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "混合 检 pre fam",
			relevantPath: "adversarial/prefix-lab/zh/hybrid-prefix-family.md",
			bucket: "tech-zh",
			type: "prefix_family",
			suite: "adversarial",
		},
		{
			query: "混合 检 pre fam ret",
			relevantPath: "adversarial/prefix-lab/zh/hybrid-prefix-quad.md",
			bucket: "tech-zh",
			type: "prefix_family",
			suite: "adversarial",
		},
	];

	return {
		documents,
		queryCases: queryCases.filter(
			(queryCase) => tokenizer.tokenize(queryCase.query).length > 0,
		),
	};
}

function createEngineHarness(
	EngineCtor: new () => EngineLike,
	tokenizer: MockTokenizer,
	backend: "minisearch" | "custom-bm25" | "passage-bm25",
): EngineLike {
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting");
	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.fileSearchBackend = backend;
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = false;
	setting.enableStopWordsEn = false;
	setting.enableStopWordsZh = false;

	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, {
		useValue: tokenizer,
	});

	return new EngineCtor();
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
	return sorted[index];
}

function computeMrr(rank: number): number {
	return rank > 0 ? 1 / rank : 0;
}

function estimateIndexBytes(engine: EngineLike): number {
	if (
		"estimateIndexBytes" in engine &&
		typeof (engine as EngineLike & { estimateIndexBytes(): number }).estimateIndexBytes ===
			"function"
	) {
		return (engine as EngineLike & { estimateIndexBytes(): number }).estimateIndexBytes();
	}
	const serialized = engine.serialize();
	if (!serialized) {
		return 0;
	}
	if (
		typeof serialized === "object" &&
		serialized !== null &&
		"data" in serialized &&
		serialized.data instanceof ArrayBuffer
	) {
		return serialized.data.byteLength;
	}
	return Buffer.byteLength(JSON.stringify(serialized), "utf8");
}

function createEmptyMetric(): BenchmarkMetric {
	return {
		top1: 0,
		top5: 0,
		zeroRate: 0,
		count: 0,
	};
}

function incrementMetric(
	metric: BenchmarkMetric,
	hitTop1: boolean,
	hitTop5: boolean,
	missed: boolean,
) {
	metric.count += 1;
	if (hitTop1) {
		metric.top1 += 1;
	}
	if (hitTop5) {
		metric.top5 += 1;
	}
	if (missed) {
		metric.zeroRate += 1;
	}
}

function finalizeMetric(metric: BenchmarkMetric): BenchmarkMetric {
	return {
		top1: metric.top1 / Math.max(1, metric.count),
		top5: metric.top5 / Math.max(1, metric.count),
		zeroRate: metric.zeroRate / Math.max(1, metric.count),
		count: metric.count,
	};
}

function buildMetricRecord<T extends string>(
	keys: readonly T[],
	totals: ReadonlyMap<T, BenchmarkMetric>,
): Record<T, BenchmarkMetric> {
	const record = {} as Record<T, BenchmarkMetric>;
	for (const key of keys) {
		record[key] = finalizeMetric(totals.get(key) ?? createEmptyMetric());
	}
	return record;
}

async function runBenchmark(
	name: string,
	engine: EngineLike,
	documents: IndexedDocument[],
	queryCases: QueryCase[],
): Promise<{ summary: BenchmarkSummary; outcomes: QueryOutcome[] }> {
	await engine.addDocuments(documents);

	const timings: number[] = [];
	const outcomes: QueryOutcome[] = [];
	let top1Hits = 0;
	let top5Hits = 0;
	let zeroHits = 0;
	let reciprocalRank = 0;

	const bucketTotals = new Map<
		CorpusBucket,
		BenchmarkMetric
	>();
	const typeTotals = new Map<QueryType, BenchmarkMetric>();
	const suiteTotals = new Map<BenchmarkSuite, BenchmarkMetric>();

	for (const queryCase of queryCases) {
		const startedAt = performance.now();
		const results = await engine.searchFiles({
			queryText: queryCase.query,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});
		timings.push(performance.now() - startedAt);

		const paths = results.map((result) => result.path);
		const rank = paths.findIndex((item) => item === queryCase.relevantPath) + 1;
		const hitTop1 = rank === 1;
		const hitTop5 = rank > 0 && rank <= 5;
		const missed = rank === 0;

		if (hitTop1) {
			top1Hits += 1;
		}
		if (hitTop5) {
			top5Hits += 1;
		}
		if (missed) {
			zeroHits += 1;
		}
		reciprocalRank += computeMrr(rank);

		const bucketMetric =
			bucketTotals.get(queryCase.bucket) ?? createEmptyMetric();
		incrementMetric(bucketMetric, hitTop1, hitTop5, missed);
		bucketTotals.set(queryCase.bucket, bucketMetric);

		const typeMetric = typeTotals.get(queryCase.type) ?? createEmptyMetric();
		incrementMetric(typeMetric, hitTop1, hitTop5, missed);
		typeTotals.set(queryCase.type, typeMetric);

		const suiteMetric =
			suiteTotals.get(queryCase.suite) ?? createEmptyMetric();
		incrementMetric(suiteMetric, hitTop1, hitTop5, missed);
		suiteTotals.set(queryCase.suite, suiteMetric);

		outcomes.push({
			query: queryCase.query,
			relevantPath: queryCase.relevantPath,
			bucket: queryCase.bucket,
			type: queryCase.type,
			suite: queryCase.suite,
			hitTop1,
			hitTop5,
			rank,
			results: paths.slice(0, 5),
		});
	}

	const total = Math.max(1, queryCases.length);
	return {
		summary: {
			name,
			top1: top1Hits / total,
			top5: top5Hits / total,
			zeroRate: zeroHits / total,
			mrr: reciprocalRank / total,
			avgMsPerQuery: timings.reduce((sum, item) => sum + item, 0) / total,
			p50Ms: percentile(timings, 0.5),
			p100Ms: timings.length > 0 ? Math.max(...timings) : 0,
			estimatedIndexBytes: estimateIndexBytes(engine),
			byBucket: buildMetricRecord(CORPUS_BUCKETS, bucketTotals),
			byType: buildMetricRecord(QUERY_TYPES, typeTotals),
			bySuite: buildMetricRecord(BENCHMARK_SUITES, suiteTotals),
		},
		outcomes,
	};
}

function round(value: number): number {
	return Number(value.toFixed(3));
}

function summarizeWins(
	leftOutcomes: QueryOutcome[],
	rightOutcomes: QueryOutcome[],
): {
	leftWins: QueryOutcome[];
	rightWins: QueryOutcome[];
	leftTop1Wins: QueryOutcome[];
	rightTop1Wins: QueryOutcome[];
	leftTop1WinsByType: Partial<Record<QueryType, number>>;
	rightTop1WinsByType: Partial<Record<QueryType, number>>;
	leftTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>>;
	rightTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>>;
} {
	const leftWins: QueryOutcome[] = [];
	const rightWins: QueryOutcome[] = [];
	const leftTop1Wins: QueryOutcome[] = [];
	const rightTop1Wins: QueryOutcome[] = [];
	const leftTop1WinsByType: Partial<Record<QueryType, number>> = {};
	const rightTop1WinsByType: Partial<Record<QueryType, number>> = {};
	const leftTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>> = {};
	const rightTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>> = {};
	for (let i = 0; i < leftOutcomes.length; i++) {
		const left = leftOutcomes[i];
		const right = rightOutcomes[i];
		if (left.hitTop5 && !right.hitTop5) {
			leftWins.push(left);
		}
		if (right.hitTop5 && !left.hitTop5) {
			rightWins.push(right);
		}
		if (left.hitTop1 && !right.hitTop1) {
			leftTop1Wins.push(left);
			leftTop1WinsByType[left.type] = (leftTop1WinsByType[left.type] ?? 0) + 1;
			leftTop1WinsBySuite[left.suite] =
				(leftTop1WinsBySuite[left.suite] ?? 0) + 1;
		}
		if (right.hitTop1 && !left.hitTop1) {
			rightTop1Wins.push(right);
			rightTop1WinsByType[right.type] =
				(rightTop1WinsByType[right.type] ?? 0) + 1;
			rightTop1WinsBySuite[right.suite] =
				(rightTop1WinsBySuite[right.suite] ?? 0) + 1;
		}
	}
	return {
		leftWins: leftWins.slice(0, 8),
		rightWins: rightWins.slice(0, 8),
		leftTop1Wins: leftTop1Wins.slice(0, 8),
		rightTop1Wins: rightTop1Wins.slice(0, 8),
		leftTop1WinsByType,
		rightTop1WinsByType,
		leftTop1WinsBySuite,
		rightTop1WinsBySuite,
	};
}

describe("file search benchmark on web-notes-v2", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("compare current custom bm25 against minisearch on web-notes-v2", async () => {
		const tokenizer = createMockTokenizer();
		const webNotes = createCorpusNotes(tokenizer);
		const manualCorpus = createManualBenchmarkCorpus(tokenizer);
		const queryCases = [
			...buildQueryCases(webNotes, tokenizer),
			...manualCorpus.queryCases,
		];
		const documents = [
			...webNotes.map((note) => note.doc),
			...manualCorpus.documents.map(({ bucket: _bucket, ...document }) => document),
		];
		const noteBuckets = [
			...webNotes.map((note) => note.bucket),
			...manualCorpus.documents.map((document) => document.bucket),
		];
		const { MiniSearchFileEngine, CustomFileSearchEngine } = require(
			"src/services/search/file-search-engine",
		);
		const { PassageFileSearchEngine } = require(
			"src/services/search/passage-lexical/passage-file-search-engine",
		);

		const mini = createEngineHarness(MiniSearchFileEngine, tokenizer, "minisearch");
		const custom = createEngineHarness(CustomFileSearchEngine, tokenizer, "custom-bm25");
		const passage = createEngineHarness(
			PassageFileSearchEngine,
			tokenizer,
			"passage-bm25",
		);

		const miniResult = await runBenchmark("MiniSearch", mini, documents, queryCases);

		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};

		const customResult = await runBenchmark("CustomBM25", custom, documents, queryCases);
		const customVsMini = summarizeWins(customResult.outcomes, miniResult.outcomes);

		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};

		const passageResult = await runBenchmark(
			"PassageBM25",
			passage,
			documents,
			queryCases,
		);
		const passageVsCustom = summarizeWins(
			passageResult.outcomes,
			customResult.outcomes,
		);

		console.log(
			"[file-search-web-benchmark] corpus",
			JSON.stringify(
				{
					webNoteCount: webNotes.length,
					syntheticNoteCount: manualCorpus.documents.length,
					noteCount: documents.length,
					queryCount: queryCases.length,
					byBucket: noteBuckets.reduce<Record<CorpusBucket, number>>(
						(acc, bucket) => {
							acc[bucket] += 1;
							return acc;
						},
						{
							"pkm-en": 0,
							"tech-en": 0,
							"general-zh": 0,
							"tech-zh": 0,
						},
					),
					byType: queryCases.reduce<Record<QueryType, number>>(
						(acc, queryCase) => {
							acc[queryCase.type] += 1;
							return acc;
						},
						QUERY_TYPES.reduce(
							(acc, type) => {
								acc[type] = 0;
								return acc;
							},
							{} as Record<QueryType, number>,
						),
					),
					bySuite: queryCases.reduce<Record<BenchmarkSuite, number>>(
						(acc, queryCase) => {
							acc[queryCase.suite] += 1;
							return acc;
						},
						{
							core: 0,
							adversarial: 0,
							messy_pkm: 0,
						},
					),
				},
				null,
				2,
			),
		);

		console.log(
			"[file-search-web-benchmark] summary",
			JSON.stringify(
				[miniResult.summary, customResult.summary, passageResult.summary].map((summary) => ({
					name: summary.name,
					top1: round(summary.top1),
					top5: round(summary.top5),
					zeroRate: round(summary.zeroRate),
					mrr: round(summary.mrr),
					avgMsPerQuery: round(summary.avgMsPerQuery),
					p50Ms: round(summary.p50Ms),
					p100Ms: round(summary.p100Ms),
					estimatedIndexKB: round(summary.estimatedIndexBytes / 1024),
					byBucket: Object.fromEntries(
						Object.entries(summary.byBucket).map(([bucket, stats]) => [
							bucket,
							{
								top1: round(stats.top1),
								top5: round(stats.top5),
								zeroRate: round(stats.zeroRate),
								count: stats.count,
							},
						]),
					),
					byType: Object.fromEntries(
						Object.entries(summary.byType).map(([type, stats]) => [
							type,
							{
								top1: round(stats.top1),
								top5: round(stats.top5),
								zeroRate: round(stats.zeroRate),
								count: stats.count,
							},
						]),
					),
					bySuite: Object.fromEntries(
						Object.entries(summary.bySuite).map(([suite, stats]) => [
							suite,
							{
								top1: round(stats.top1),
								top5: round(stats.top5),
								zeroRate: round(stats.zeroRate),
								count: stats.count,
							},
						]),
					),
				})),
				null,
				2,
			),
		);

		console.log(
			"[file-search-web-benchmark] sample-diffs",
			JSON.stringify(
				{
					customVsMini,
					passageVsCustom,
				},
				null,
				2,
			),
		);

		expect(webNotes.length).toBe(32);
		expect(documents.length).toBeGreaterThanOrEqual(40);
		expect(queryCases.length).toBeGreaterThanOrEqual(200);
		expect(queryCases.some((queryCase) => queryCase.suite === "messy_pkm")).toBe(
			true,
		);
	});
});
