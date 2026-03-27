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

type BenchmarkSuite = "core" | "coverage_invariants" | "adversarial" | "messy_pkm";
type QueryType =
	| "coverage_guardrail"
	| "quality_guardrail"
	| "tail_guardrail"
	| "locality_guardrail"
	| "title_exact"
	| "title_prefix"
	| "content_dense"
	| "prefix_metadata"
	| "prefix_body"
	| "body_path_anchor"
	| "body_title_anchor"
	| "duplicate_conflict"
	| "mixed_anchor"
	| "template_collision"
	| "bilingual_mirror"
	| "partial_memory";

type QueryCase = {
	query: string;
	relevantPath: string;
	type: QueryType;
	suite: BenchmarkSuite;
};

type BenchmarkMetric = {
	top1: number;
	top3: number;
	top5: number;
	zeroRate: number;
	count: number;
};

type BenchmarkSummary = {
	name: string;
	objective: number;
	top1: number;
	top3: number;
	top5: number;
	zeroRate: number;
	mrr: number;
	avgMsPerQuery: number;
	p50Ms: number;
	p100Ms: number;
	estimatedIndexBytes: number;
	bySuite: Record<BenchmarkSuite, BenchmarkMetric>;
	byType: Record<QueryType, BenchmarkMetric>;
};

type QueryOutcome = {
	query: string;
	relevantPath: string;
	type: QueryType;
	suite: BenchmarkSuite;
	hitTop1: boolean;
	hitTop5: boolean;
	rank: number;
	results: string[];
};

type RecallContractType =
	| QueryType
	| "basename_partial_body"
	| "path_partial_body";

type RecallContractCase = {
	query: string;
	relevantPath: string;
	type: RecallContractType;
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

const QUERY_TYPES: readonly QueryType[] = [
	"coverage_guardrail",
	"quality_guardrail",
	"tail_guardrail",
	"locality_guardrail",
	"title_exact",
	"title_prefix",
	"content_dense",
	"prefix_metadata",
	"prefix_body",
	"body_path_anchor",
	"body_title_anchor",
	"duplicate_conflict",
	"mixed_anchor",
	"template_collision",
	"bilingual_mirror",
	"partial_memory",
];

const BENCHMARK_SUITES: readonly BenchmarkSuite[] = [
	"core",
	"coverage_invariants",
	"adversarial",
	"messy_pkm",
];

function createMockTokenizer(): MockTokenizer {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}

	function tokenizeSegment(segment: string): string[] {
		const compact = normalize(segment);
		if (compact.trim().length === 0) {
			return [];
		}
		const parts = compact.match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
		const tokens: string[] = [];

		for (const part of parts) {
			if (/^[a-z0-9_-]+$/.test(part)) {
				tokens.push(part);
				continue;
			}

			tokens.push(part);
			if (part.length <= 2) {
				continue;
			}
			for (let index = 0; index < part.length - 1; index++) {
				tokens.push(part.slice(index, index + 2));
			}
		}

		return Array.from(new Set(tokens));
	}

	return {
		tokenize(text: string): string[] {
			return tokenizeSegment(text);
		},
		tokenizeSequence(text: string): string[] {
			return tokenizeSegment(text);
		},
	};
}

function createAutomationCorpus(): {
	documents: IndexedDocument[];
	queryCases: QueryCase[];
} {
	const documents: IndexedDocument[] = [];
	const queryCases: QueryCase[] = [];
	const addDocument = (
		path: string,
		basename: string,
		headings: string,
		content: string,
		extra: Partial<Pick<IndexedDocument, "aliases" | "tags">> = {},
	): void => {
		documents.push({
			path,
			basename,
			folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
			headings,
			content,
			...extra,
		});
	};
	const addQuery = (
		query: string,
		relevantPath: string,
		type: QueryType,
		suite: BenchmarkSuite,
	): void => {
		queryCases.push({
			query,
			relevantPath,
			type,
			suite,
		});
	};

	addDocument(
		"adversarial/ranker-lab/en/coverage-full.md",
		"Coverage full",
		"Coverage witness",
		"alphaone betatwo gammathree deltafour keeps all four family witnesses together in one compact explanation",
	);
	addDocument(
		"adversarial/ranker-lab/en/coverage-noise.md",
		"Coverage noise",
		"Coverage witness",
		"alphaone alphaone betatwo repeats early family noise without the gammathree deltafour witness",
	);
	addDocument(
		"adversarial/ranker-lab/en/coverage-full-loose.md",
		"Coverage full loose",
		"Coverage witness",
		"alphaone opens the note, several filler transitions hide the body, betatwo returns later, more filler appears, gammathree arrives much later, and deltafour only lands in the trailing sentence",
	);
	addDocument(
		"adversarial/ranker-lab/en/coverage-prefix-family.md",
		"Coverage prefix family",
		"Coverage witness",
		"alphaone betatwo gammafield deltaform keeps family shaped terms but not the exact target witnesses",
	);
	addDocument(
		"adversarial/ranker-lab/en/exact-quality-witness.md",
		"Exact quality witness",
		"Quality witness",
		"config data rollout keeps exact family evidence together in one compact note",
	);
	addDocument(
		"adversarial/ranker-lab/en/exact-quality-loose.md",
		"Exact quality loose",
		"Quality witness",
		"config arrives early, long filler paragraphs separate the note, data comes back much later, and rollout only appears after more narrative drift",
	);
	addDocument(
		"adversarial/ranker-lab/en/expanded-quality-noise.md",
		"Expanded quality noise",
		"Quality witness",
		"configmap datastore rollout keeps only expanded family evidence nearby",
	);
	addDocument(
		"adversarial/ranker-lab/en/fuzzy-quality-noise.md",
		"Fuzzy quality noise",
		"Quality witness",
		"konfig darta rollot keeps typo heavy family fragments without the exact witness",
	);
	addDocument(
		"adversarial/ranker-lab/en/earlier-tail.md",
		"Earlier tail witness",
		"Tail witness",
		"connection policy timeout keeps the earlier exact family stable during rollout",
	);
	addDocument(
		"adversarial/ranker-lab/en/middle-tail.md",
		"Middle tail witness",
		"Tail witness",
		"connection timeout policy keeps the middle exact family stable during rollout",
	);
	addDocument(
		"adversarial/ranker-lab/en/later-tail.md",
		"Later tail witness",
		"Tail witness",
		"connection timeout recovery keeps the later exact family stable during rollout",
	);
	addDocument(
		"adversarial/ranker-lab/en/locality-compact.md",
		"Locality compact witness",
		"Locality witness",
		"stale mount restart window stays together in one compact sentence",
	);
	addDocument(
		"adversarial/ranker-lab/en/locality-loose.md",
		"Locality loose witness",
		"Locality witness",
		"stale filler filler mount filler filler restart filler filler window drifts across a loose sentence",
	);

	addDocument(
		"docs/plugins/better-plugins-page.md",
		"better plugins page",
		"Plugin index",
		"directory landing page for plugin browsing without the answer paragraph users actually want",
	);
	addDocument(
		"docs/plugins/better-plugins-catalog.md",
		"better plugins catalog",
		"Plugin catalog",
		"catalog overview for plugin listings with many repeated plugin names and no compact answer",
	);
	addDocument(
		"docs/plugins/better-plugins-roadmap.md",
		"better plugins roadmap",
		"Plugin roadmap",
		"roadmap page for better plugins workstreams, milestones, and backlog notes",
	);
	addDocument(
		"docs/plugins/beta-compatibility-index.md",
		"beta compatibility index",
		"Compatibility index",
		"index page for beta plugin compatibility and release bookkeeping without the direct answer paragraph",
	);
	addDocument(
		"notes/body-noise.md",
		"release notes",
		"Plugin experiments",
		"beta plugin experiments mention one item and unrelated notes without a strong metadata completion signal",
	);
	addDocument(
		"docs/body-target.md",
		"release notes",
		"Compatibility",
		"beta compatibility plugin answer stays compact in the body and directly explains the release constraint",
	);
	addDocument(
		"docs/releases/plugin-beta-compatibility.md",
		"plugin beta compatibility",
		"Release checklist",
		"plugin beta compatibility guidance exists here but the explanation is spread across longer rollout prose and checklist items",
	);
	addDocument(
		"docs/releases/beta-compatibility-rollout.md",
		"beta compatibility rollout",
		"Release rollout",
		"beta compatibility rollout notes describe the staged rollout, migration timing, and communication plan",
	);

	addDocument(
		"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
		"Namespaces",
		"Names resources",
		"namespace pod object resources stay together in this concept guide for cluster scoping",
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
		"Namespaces",
		"Names resources",
		"namespace pod object resources stay together in the mirrored zh concept guide",
	);
	addDocument(
		"tech-en/content/en/docs/concepts/configuration/configmap.md",
		"ConfigMap",
		"Pod data",
		"configmap pod data guidance explains how pods read mounted configuration data safely",
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
		"ConfigMap",
		"Pod data",
		"configmap pod data guidance explains how pods read mounted configuration data safely in the zh mirror",
	);
	addDocument(
		"tech-en/content/en/docs/concepts/configuration/secret.md",
		"Secret",
		"Pod data",
		"secret pod data guidance explains sensitive credentials and mounted secret files",
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
		"Secret",
		"Pod data",
		"secret pod data guidance explains sensitive credentials in the zh mirror",
	);
	addDocument(
		"tech-en/content/en/docs/concepts/services-networking/ingress.md",
		"Ingress",
		"Service routing",
		"ingress service routing sends traffic to services through cluster rules",
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
		"Ingress",
		"Service routing",
		"ingress service routing sends traffic to services through the zh mirror guide",
	);
	addDocument(
		"tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
		"Configure service account",
		"Service account token",
		"service account token setup explains how pods mount projected credentials for runtime access",
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/configure-service-account.md",
		"Configure service account",
		"Service account token",
		"service account token setup explains how pods mount projected credentials in the zh mirror guide",
	);

	addDocument(
		"pkm-en/projects/sdk/vector-cache.md",
		"Vector cache playbook",
		"Eviction restore",
		"vector cache eviction keeps sdk search warm after shard checkpoint restore",
		{ aliases: "sdk cache restore;vector cache restore note", tags: "sdk cache" },
	);
	addDocument(
		"pkm-en/archive/vector-cache.md",
		"Vector cache playbook",
		"Eviction restore",
		"vector cache eviction keeps archive search warm after shard checkpoint restore",
		{ aliases: "archive cache restore", tags: "archive cache" },
	);
	addDocument(
		"pkm-en/guides/shard-checkpoint-guide.md",
		"Shard checkpoint guide",
		"Restore flow",
		"shard checkpoint restore notes explain warm cache recovery and replay order",
		{ aliases: "checkpoint restore guide;checkpoint guide", tags: "guide restore" },
	);
	addDocument(
		"pkm-en/ops/shard-checkpoint-runbook.md",
		"Shard checkpoint runbook",
		"Restore flow",
		"ops runbook for shard checkpoint restore, rollback handling, and operator escalation steps",
		{ aliases: "ops shard checkpoint", tags: "ops runbook" },
	);
	addDocument(
		"pkm-en/retros/shard-checkpoint-retrospective.md",
		"Shard checkpoint retrospective",
		"Restore flow",
		"retrospective for shard checkpoint restore with timeline analysis, lessons, and drift commentary",
	);
	addDocument(
		"pkm-en/notes/linking/aliases-deep-dive.md",
		"Aliases deep dive",
		"Link example",
		"aliases let one note answer to multiple names when link text drifts across old projects",
		{ aliases: "alias drift;old project aliases", tags: "links aliases" },
	);
	addDocument(
		"pkm-en/notes/linking/internal-links-playbook.md",
		"Internal links playbook",
		"Link example",
		"internal link examples explain how one note references another with stable wikilinks",
	);
	addDocument(
		"pkm-en/notes/linking/wikilink-drift.md",
		"Wikilink drift",
		"Link example",
		"wikilink drift notes explain how old project names linger while aliases keep links stable",
		{ aliases: "old project wikilink drift", tags: "links drift" },
	);
	addDocument(
		"pkm-en/templates/incident-review.md",
		"Incident review",
		"Warm start template",
		"template incident review placeholder with warm start checklist and empty recovery notes",
		{ aliases: "incident review template", tags: "template" },
	);
	addDocument(
		"pkm-en/incidents/incident-review.md",
		"Incident review",
		"Warm start recovery",
		"incident review documents warm start recovery, checkpoint drift, and the final mitigation notes",
		{ aliases: "checkpoint drift review;warm start review", tags: "incident review" },
	);
	addDocument(
		"pkm-en/incidents/cache-warm-start.md",
		"Cache warm start",
		"Mitigation",
		"cache warm start incident note explains outage recovery, mitigation steps, and restart sequencing",
		{ aliases: "incident mitigation warm start", tags: "incident cache" },
	);
	addDocument(
		"pkm-en/archive/checkpoint-drift-log.md",
		"Checkpoint drift log",
		"Recovery log",
		"checkpoint drift recovery log captures terse notes, timestamps, and replay checkpoints from the incident",
		{ aliases: "drift log recovery note", tags: "archive drift" },
	);
	addDocument(
		"pkm-en/archive/incident-review-2024.md",
		"Incident review 2024",
		"Warm start archive",
		"older archived incident review for a separate warm start issue with incomplete mitigation notes",
	);
	addDocument(
		"pkm-en/inbox/restart-cache-after-outage.md",
		"restart cache after outage",
		"Inbox note",
		"remember to restart cache after outage, restore vector cache shards, and verify checkpoint replay",
		{ aliases: "vector cache crash note", tags: "inbox outage" },
	);
	addDocument(
		"pkm-en/daily/2026-02-14-shard-restore-note.md",
		"2026-02-14 shard restore note",
		"Daily note",
		"forgot note about shard restore, replay after crash, and cache warmup following the checkpoint repair",
		{ aliases: "forgot note about shard restore", tags: "daily restore" },
	);
	addDocument(
		"pkm-en/daily/2026-02-17-alias-cleanup.md",
		"2026-02-17 alias cleanup",
		"Daily note",
		"alias cleanup old wiki links and retired project names after the migration landed",
		{ aliases: "alias cleanup old wiki links", tags: "daily aliases" },
	);
	addDocument(
		"pkm-en/scratch/vector-cache-migration.md",
		"Vector cache migration",
		"Scratch note",
		"scratch thoughts about vector cache migration, hotfixes, and unstable warm restart ideas",
	);
	addDocument(
		"pkm-en/ops/vector-cache-hotfix.md",
		"Vector cache hotfix",
		"Ops note",
		"ops hotfix for vector cache crash handling after outage with follow up verification steps",
	);
	addDocument(
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"Cache restore checklist",
		"Recovery checklist",
		"sdk cache restore checklist after outage covers checkpoint replay, shard verification, and warmup",
		{ aliases: "cache restore after outage", tags: "sdk restore checklist" },
	);
	addDocument(
		"pkm-en/ops/cache-replay-runbook.md",
		"Cache replay runbook",
		"Replay verification",
		"cache replay runbook explains checkpoint verification, replay order, and operator steps after outage recovery",
		{ aliases: "checkpoint replay verification", tags: "ops replay runbook" },
	);
	addDocument(
		"pkm-en/incidents/vector-cache-postmortem.md",
		"Vector cache postmortem",
		"Outage analysis",
		"vector cache outage postmortem covers warm restart, replay gaps, mitigation, and follow up actions",
		{ aliases: "vector cache outage follow up", tags: "incident postmortem" },
	);
	addDocument(
		"pkm-en/daily/2026-02-19-cache-replay-followup.md",
		"2026-02-19 cache replay followup",
		"Daily note",
		"followup on cache replay after outage, checkpoint verification, and sdk restore checks",
		{ aliases: "cache replay followup note", tags: "daily replay followup" },
	);
	addDocument(
		"pkm-en/notes/sdk-cache-rollback.md",
		"SDK cache rollback",
		"Rollback plan",
		"sdk cache rollback plan covers replay issues, restart sequencing, checkpoint fallback, and operator notes",
		{ aliases: "sdk cache rollback replay issue", tags: "sdk rollback" },
	);
	addDocument(
		"pkm-en/incidents/recovery-checklist.md",
		"Recovery checklist",
		"Warm start steps",
		"incident recovery checklist for warm start, cache restart, and checkpoint replay validation",
		{ aliases: "warm start recovery checklist", tags: "incident checklist" },
	);
	addDocument(
		"pkm-en/notes/cache-restart-verification.md",
		"Cache restart verification",
		"Verification note",
		"verification note for cache restart after outage with replay checks, shard health, and warmup confirmation",
		{ aliases: "vector cache restart verification", tags: "cache verification" },
	);
	addDocument(
		"docs/releases/plugin-compatibility-faq.md",
		"plugin compatibility faq",
		"FAQ",
		"faq about beta plugin compatibility, release channels, migration timing, and fallback expectations",
		{ aliases: "plugin compatibility release channels", tags: "plugin faq" },
	);
	addDocument(
		"docs/releases/plugin-beta-release-notes.md",
		"plugin beta release notes",
		"Release notes",
		"beta plugin release notes explain migration timing, compatibility caveats, and rollout messaging",
		{ aliases: "beta plugin release migration timing", tags: "plugin release notes" },
	);
	addDocument(
		"docs/plugins/plugin-compatibility-matrix.md",
		"plugin compatibility matrix",
		"Matrix",
		"matrix for plugin compatibility across release channels, supported versions, and upgrade readiness",
		{ aliases: "plugin compatibility matrix upgrade", tags: "plugin matrix" },
	);
	addDocument(
		"docs/plugins/plugin-upgrade-guide.md",
		"plugin upgrade guide",
		"Upgrade guide",
		"guide for plugin upgrades, compatibility checks, migration sequencing, and release preparation",
		{ aliases: "plugin upgrade compatibility guide", tags: "plugin upgrade" },
	);
	addDocument(
		"tech-en/content/en/docs/concepts/storage/projected-volumes.md",
		"Projected volumes",
		"Projected data",
		"projected volumes combine service account token, configmap, and secret sources for pods",
		{ aliases: "projected volume service account secret", tags: "projected volume" },
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/concepts/storage/projected-volumes.md",
		"Projected volumes",
		"Projected data",
		"projected volumes combine service account token, configmap, and secret sources for pods in the zh mirror",
		{ aliases: "zh projected volume service account", tags: "zh projected volume" },
	);
	addDocument(
		"tech-en/content/en/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"Projected service account token",
		"Projected token",
		"projected service account token setup shows how a pod mounts projected credentials for runtime access",
		{ aliases: "projected service account token pod", tags: "projected token" },
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"Projected service account token",
		"Projected token",
		"projected service account token setup shows how a pod mounts projected credentials in the zh mirror guide",
		{ aliases: "zh projected service account token", tags: "zh projected token" },
	);
	addDocument(
		"pkm-en/notes/linking/project-rename-map.md",
		"Project rename map",
		"Rename map",
		"map of old project names to new canonical names with aliases used for link migration",
		{ aliases: "old project rename aliases map", tags: "rename aliases" },
	);
	addDocument(
		"pkm-en/archive/alias-migration-log.md",
		"Alias migration log",
		"Migration log",
		"log of alias migration work, retired names, and cleanup steps across old project links",
		{ aliases: "alias migration log project names", tags: "alias migration" },
	);
	addDocument(
		"pkm-en/notes/linking/old-project-index.md",
		"Old project index",
		"Legacy index",
		"index of old project names, wiki link aliases, and landing pages kept during migration",
		{ aliases: "old project link aliases index", tags: "legacy aliases" },
	);
	addDocument(
		"pkm-zh/ops/缓存恢复清单.md",
		"缓存恢复清单",
		"恢复步骤",
		`- 故障恢复
  - restart cache
  - 校验 checkpoint replay
  - warmup shards
- 收尾
  - 更新 incident review
  - 记录 replay validation`,
		{ aliases: "缓存 恢复 checkpoint replay 清单", tags: "缓存 恢复 清单" },
	);
	addDocument(
		"pkm-zh/daily/缓存回放记录.md",
		"缓存回放记录",
		"Daily note",
		`- 今天处理 cache replay
  - replay 后校验 shard 状态
  - warm start 后补写 daily note
- followup
  - 记录 restore verification`,
		{ aliases: "daily replay note 校验", tags: "回放 daily replay" },
	);
	addDocument(
		"pkm-zh/incidents/缓存预热事故.md",
		"缓存预热事故",
		"事故摘要",
		`- 事故摘要
  - cache warm start 失败
  - mitigation: replay checkpoint
  - final note: restart verification
- 行动项
  - 补写 incident review`,
		{ aliases: "cache warm start 失败 mitigation", tags: "事故 预热 replay" },
	);
	addDocument(
		"pkm-zh/links/项目别名迁移.md",
		"项目别名迁移",
		"迁移记录",
		`- 链接迁移
  - 旧项目名 -> new canonical name
  - 保留 alias 和 [[wikilink]]
- 清理
  - retired names
  - old project links`,
		{ aliases: "project alias 迁移 旧名称", tags: "别名 迁移 wikilink" },
	);
	addDocument(
		"docs/zh/plugins/插件兼容问答.md",
		"插件兼容问答",
		"FAQ",
		`- 插件兼容 FAQ
  - beta release channel
  - migration timing
  - fallback plugin upgrade
- 补充
  - release notes
  - compatibility matrix`,
		{ aliases: "插件 beta 兼容 发布 问答", tags: "插件 兼容 faq" },
	);
	addDocument(
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-volume-checklist.md",
		"Projected volume checklist",
		"Pod 凭证清单",
		`- pod 凭证
  - projected token
  - configmap
  - secret
- checklist
  - runtime access
  - mounted sources`,
		{ aliases: "pod 凭证 projected token secret", tags: "projected volume checklist" },
	);

	addQuery(
		"alphaone betatwo gammathree deltafour",
		"adversarial/ranker-lab/en/coverage-full.md",
		"coverage_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"alphaone betatwo gammathree delta",
		"adversarial/ranker-lab/en/coverage-full.md",
		"coverage_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"alphaone betatwo betatwo gammathree deltafour",
		"adversarial/ranker-lab/en/coverage-full.md",
		"coverage_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"config data rollout",
		"adversarial/ranker-lab/en/exact-quality-witness.md",
		"quality_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"config data roll",
		"adversarial/ranker-lab/en/exact-quality-witness.md",
		"quality_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"connection policy timeout recovery",
		"adversarial/ranker-lab/en/later-tail.md",
		"tail_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"connection timeout recovery",
		"adversarial/ranker-lab/en/later-tail.md",
		"tail_guardrail",
		"coverage_invariants",
	);
	addQuery(
		"stale mount restart window",
		"adversarial/ranker-lab/en/locality-compact.md",
		"locality_guardrail",
		"coverage_invariants",
	);

	addQuery(
		"guide for replay order after restore",
		"pkm-en/guides/shard-checkpoint-guide.md",
		"title_exact",
		"core",
	);
	addQuery(
		"playbook for cache eviction restore",
		"pkm-en/projects/sdk/vector-cache.md",
		"title_exact",
		"core",
	);
	addQuery(
		"shard checkpoint",
		"pkm-en/guides/shard-checkpoint-guide.md",
		"title_prefix",
		"core",
	);
	addQuery(
		"vector cache",
		"pkm-en/projects/sdk/vector-cache.md",
		"title_prefix",
		"core",
	);
	addQuery(
		"restore notes about replay order",
		"pkm-en/guides/shard-checkpoint-guide.md",
		"content_dense",
		"core",
	);
	addQuery(
		"notes about aliases when links drift",
		"pkm-en/notes/linking/aliases-deep-dive.md",
		"content_dense",
		"core",
	);

	addQuery(
		"better plu",
		"docs/plugins/better-plugins-page.md",
		"prefix_metadata",
		"adversarial",
	);
	addQuery(
		"better plugin road",
		"docs/plugins/better-plugins-roadmap.md",
		"prefix_metadata",
		"adversarial",
	);
	addQuery(
		"bet comp",
		"docs/body-target.md",
		"prefix_body",
		"adversarial",
	);
	addQuery(
		"beta compatibility rollout",
		"docs/releases/beta-compatibility-rollout.md",
		"prefix_body",
		"adversarial",
	);
	addQuery(
		"guide to cluster object scope and namespaces",
		"tech-en/content/en/docs/concepts/overview/working-with-objects/namespaces.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"tech-en secret pod data",
		"tech-en/content/en/docs/concepts/configuration/secret.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"tech-en service account token",
		"tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"tech-zh namespace pod object",
		"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"tech-zh ingress service",
		"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"tech-zh service account token",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/configure-service-account.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"mounted configuration data for pods",
		"tech-en/content/en/docs/concepts/configuration/configmap.md",
		"body_title_anchor",
		"adversarial",
	);
	addQuery(
		"tech-zh configmap pod data",
		"tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
		"body_title_anchor",
		"adversarial",
	);
	addQuery(
		"mounted sensitive data for pods",
		"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
		"body_title_anchor",
		"adversarial",
	);
	addQuery(
		"sdk vector cache",
		"pkm-en/projects/sdk/vector-cache.md",
		"duplicate_conflict",
		"adversarial",
	);
	addQuery(
		"archive vector cache",
		"pkm-en/archive/vector-cache.md",
		"duplicate_conflict",
		"adversarial",
	);
	addQuery(
		"ops shard checkpoint",
		"pkm-en/ops/shard-checkpoint-runbook.md",
		"duplicate_conflict",
		"adversarial",
	);
	addQuery(
		"old names still resolve through aliases",
		"pkm-en/notes/linking/aliases-deep-dive.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"legacy wiki links after project rename",
		"pkm-en/notes/linking/wikilink-drift.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"template incident warm-start recovery",
		"pkm-en/incidents/incident-review.md",
		"template_collision",
		"adversarial",
	);
	addQuery(
		"incident review template",
		"pkm-en/templates/incident-review.md",
		"template_collision",
		"adversarial",
	);
	addQuery(
		"checkpoint drift review",
		"pkm-en/incidents/incident-review.md",
		"template_collision",
		"adversarial",
	);

	addQuery(
		"warm-start checkpoint drift",
		"pkm-en/incidents/incident-review.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"sdk cache restore note",
		"pkm-en/projects/sdk/vector-cache.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"aliases drift old projects",
		"pkm-en/notes/linking/aliases-deep-dive.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"outage cache warm restore",
		"pkm-en/incidents/cache-warm-start.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"checkpoint replay after crash",
		"pkm-en/daily/2026-02-14-shard-restore-note.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"alias cleanup old wiki links",
		"pkm-en/daily/2026-02-17-alias-cleanup.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"vector cache crash note",
		"pkm-en/inbox/restart-cache-after-outage.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"incident mitigation warm start",
		"pkm-en/incidents/cache-warm-start.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"drift log recovery note",
		"pkm-en/archive/checkpoint-drift-log.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"forgot note about shard restore",
		"pkm-en/daily/2026-02-14-shard-restore-note.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"cache restore after outage replay steps",
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"checkpoint replay verification after outage",
		"pkm-en/ops/cache-replay-runbook.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"vector cache outage follow up",
		"pkm-en/incidents/vector-cache-postmortem.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"cache replay followup note outage",
		"pkm-en/daily/2026-02-19-cache-replay-followup.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"sdk cache rollback replay issue",
		"pkm-en/notes/sdk-cache-rollback.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"warm start recovery checklist replay",
		"pkm-en/incidents/recovery-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"vector cache restart verification",
		"pkm-en/notes/cache-restart-verification.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"beta plugin compatibility faq release",
		"docs/releases/plugin-compatibility-faq.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"plugin compatibility release channels",
		"docs/releases/plugin-compatibility-faq.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"beta plugin release migration timing",
		"docs/releases/plugin-beta-release-notes.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"supported versions before plugin upgrade",
		"docs/plugins/plugin-compatibility-matrix.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"steps before upgrading incompatible plugins",
		"docs/plugins/plugin-upgrade-guide.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"release checklist beta compatibility plugin",
		"docs/releases/plugin-beta-compatibility.md",
		"template_collision",
		"adversarial",
	);
	addQuery(
		"projected service account token pod",
		"tech-en/content/en/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"body_title_anchor",
		"adversarial",
	);
	addQuery(
		"projected volume service account secret",
		"tech-en/content/en/docs/concepts/storage/projected-volumes.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"zh projected service account token",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"zh projected volume service account",
		"tech-zh/content/zh-cn/docs/concepts/storage/projected-volumes.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"old project rename aliases map",
		"pkm-en/notes/linking/project-rename-map.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"alias migration log project names",
		"pkm-en/archive/alias-migration-log.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"old project link aliases index",
		"pkm-en/notes/linking/old-project-index.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"checkpoint restore timeline lessons",
		"pkm-en/retros/shard-checkpoint-retrospective.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"checkpoint rollback operator steps",
		"pkm-en/ops/shard-checkpoint-runbook.md",
		"duplicate_conflict",
		"adversarial",
	);
	addQuery(
		"warm start incident archive review",
		"pkm-en/archive/incident-review-2024.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"after outage replay validation checklist",
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"restore verification after replay issue",
		"pkm-en/ops/cache-replay-runbook.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"follow up actions after vector cache outage",
		"pkm-en/incidents/vector-cache-postmortem.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"daily note about cache replay checks",
		"pkm-en/daily/2026-02-19-cache-replay-followup.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"fallback plan when replay fails",
		"pkm-en/notes/sdk-cache-rollback.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"warm start restart checklist after incident",
		"pkm-en/incidents/recovery-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"note confirming cache restart checks",
		"pkm-en/notes/cache-restart-verification.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"release questions about compatibility channels",
		"docs/releases/plugin-compatibility-faq.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"when beta plugin migration happens",
		"docs/releases/plugin-beta-release-notes.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"preparing plugin upgrade compatibility checks",
		"docs/plugins/plugin-upgrade-guide.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"release compatibility checklist for beta plugins",
		"docs/releases/plugin-beta-compatibility.md",
		"template_collision",
		"adversarial",
	);
	addQuery(
		"landing page for browsing better plugins",
		"docs/plugins/better-plugins-page.md",
		"prefix_metadata",
		"adversarial",
	);
	addQuery(
		"roadmap for better plugins work",
		"docs/plugins/better-plugins-roadmap.md",
		"prefix_metadata",
		"adversarial",
	);
	addQuery(
		"pod credentials mounted at runtime",
		"tech-en/content/en/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"body_title_anchor",
		"adversarial",
	);
	addQuery(
		"pod gets configmap and secret together",
		"tech-en/content/en/docs/concepts/storage/projected-volumes.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"chinese guide for projected token in pod",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"chinese guide for projected volume sources",
		"tech-zh/content/zh-cn/docs/concepts/storage/projected-volumes.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"canonical names for renamed projects",
		"pkm-en/notes/linking/project-rename-map.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"cleanup log for retired project names",
		"pkm-en/archive/alias-migration-log.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"legacy project names kept during migration",
		"pkm-en/notes/linking/old-project-index.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"review with final mitigation after warm start",
		"pkm-en/incidents/incident-review.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"archived review for older warm start issue",
		"pkm-en/archive/incident-review-2024.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"timeline lessons after checkpoint restore",
		"pkm-en/retros/shard-checkpoint-retrospective.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"operator steps for rollback during restore",
		"pkm-en/ops/shard-checkpoint-runbook.md",
		"duplicate_conflict",
		"adversarial",
	);
	addQuery(
		"daily note after shard replay repair",
		"pkm-en/daily/2026-02-14-shard-restore-note.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"note about restart cache after outage",
		"pkm-en/inbox/restart-cache-after-outage.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"where we wrote replay order after the outage",
		"pkm-en/guides/shard-checkpoint-guide.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"note about restoring cache after warmup failed",
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"review of checkpoint drift and mitigation",
		"pkm-en/incidents/incident-review.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"template used for warm start incidents",
		"pkm-en/templates/incident-review.md",
		"template_collision",
		"adversarial",
	);
	addQuery(
		"projected secrets and tokens in a pod",
		"tech-en/content/en/docs/concepts/storage/projected-volumes.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"secret data mounted in chinese docs",
		"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"page listing better plugins",
		"docs/plugins/better-plugins-page.md",
		"prefix_metadata",
		"adversarial",
	);
	addQuery(
		"what changes during beta compatibility rollout",
		"docs/releases/beta-compatibility-rollout.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"archive log of alias cleanup",
		"pkm-en/archive/alias-migration-log.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"old project names index during migration",
		"pkm-en/notes/linking/old-project-index.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"followup note after outage replay",
		"pkm-en/daily/2026-02-19-cache-replay-followup.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"operator note for cache hotfix after crash",
		"pkm-en/ops/vector-cache-hotfix.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"vector cache incident notes after outage",
		"pkm-en/incidents/vector-cache-postmortem.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"checkpoint repair note from daily log",
		"pkm-en/daily/2026-02-14-shard-restore-note.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"restore checklist with shard verification",
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"runbook for replay order and verification",
		"pkm-en/ops/cache-replay-runbook.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"review note with final mitigation details",
		"pkm-en/incidents/incident-review.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"guide for projected token runtime access in chinese",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"page for supported plugin versions before upgrade",
		"docs/plugins/plugin-compatibility-matrix.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"warm start checklist after cache incident",
		"pkm-en/incidents/recovery-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"缓存 恢复 checkpoint replay 清单",
		"pkm-zh/ops/缓存恢复清单.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"replay 后 校验 shard 状态",
		"pkm-zh/daily/缓存回放记录.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"cache warm start 失败 mitigation",
		"pkm-zh/incidents/缓存预热事故.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"旧项目名 canonical alias wikilink",
		"pkm-zh/links/项目别名迁移.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"插件 beta 兼容 发布 问答",
		"docs/zh/plugins/插件兼容问答.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"pod 凭证 projected token secret",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-volume-checklist.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"缓存 warmup 后 更新复盘",
		"pkm-zh/ops/缓存恢复清单.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"project alias 迁移 旧名称",
		"pkm-zh/links/项目别名迁移.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"beta compatibility fallback 问答",
		"docs/zh/plugins/插件兼容问答.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"projected volume 清单 token configmap secret",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-volume-checklist.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"事故 预热 失败 replay 校验",
		"pkm-zh/incidents/缓存预热事故.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"daily replay note 校验",
		"pkm-zh/daily/缓存回放记录.md",
		"partial_memory",
		"messy_pkm",
	);

	addQuery(
		"where did we note replay order for restore",
		"pkm-en/guides/shard-checkpoint-guide.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"what still needs warmup after cache restore",
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"which incident note covered the cache outage",
		"pkm-en/incidents/vector-cache-postmortem.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"zh token runtime access guide",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"bilingual_mirror",
		"adversarial",
	);
	addQuery(
		"pod mounts token and secret together",
		"tech-en/content/en/docs/concepts/storage/projected-volumes.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"which compatibility page to check before upgrade",
		"docs/plugins/plugin-compatibility-matrix.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"how old wiki links stayed compatible after rename",
		"pkm-en/notes/linking/wikilink-drift.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"warm start review with final mitigation",
		"pkm-en/incidents/incident-review.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"did we log replay repair in a daily note",
		"pkm-en/daily/2026-02-14-shard-restore-note.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"what changed during beta compatibility rollout",
		"docs/releases/beta-compatibility-rollout.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"operator hotfix note after cache crash",
		"pkm-en/ops/vector-cache-hotfix.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"zh plugin faq for compatibility fallback",
		"docs/zh/plugins/鎻掍欢鍏煎闂瓟.md",
		"content_dense",
		"adversarial",
	);

	function buildMixedMarkdownTail(document: IndexedDocument): string {
		const pathHint = document.path.split("/").slice(-2).join("/");
		if (document.path.includes("docs/")) {
			return `- 中文补充\n  - 场景：发布 / 兼容 / 升级\n  - path hint: ${pathHint}\n  - mixed terms: compatibility rollout migration`;
		}
		if (document.path.includes("tech-")) {
			return `- 中文补充\n  - 场景：技术文档 / pod / 配置 / 凭证\n  - path hint: ${pathHint}\n  - mixed terms: pod configmap secret token`;
		}
		if (document.path.includes("links/")) {
			return `- 中文补充\n  - 场景：旧名称、alias、wikilink 迁移\n  - path hint: ${pathHint}\n  - mixed terms: alias migration old-project`;
		}
		if (document.path.includes("incident") || document.path.includes("retro")) {
			return `- 中文补充\n  - 场景：事故、复盘、mitigation\n  - path hint: ${pathHint}\n  - mixed terms: incident replay recovery`;
		}
		if (document.path.includes("cache") || document.path.includes("checkpoint")) {
			return `- 中文补充\n  - 场景：缓存恢复、checkpoint、warmup\n  - path hint: ${pathHint}\n  - mixed terms: cache replay restore`;
		}
		return `- 中文补充\n  - 场景：混合笔记\n  - path hint: ${pathHint}\n  - mixed terms: note context summary`;
	}

	function buildMarkdownSyntaxTail(document: IndexedDocument): string {
		const pathHint = document.path.split("/").slice(-2).join("/");
		const aliasHint = document.aliases ?? document.basename;
		const tagHint = document.tags ?? "note";
		const headingHint = document.headings ?? "heading";
		return [
			"---",
			`title: "${document.basename}"`,
			`aliases: ["${aliasHint}"]`,
			`tags: ["${tagHint}"]`,
			"---",
			"",
			`# ${document.basename}`,
			"",
			"> [!note]",
			`> path hint: \`${pathHint}\``,
			`> heading hint: **${headingHint}**`,
			"",
			"- overview",
			`  - [[${document.basename}]]`,
			`  - [ref](${pathHint.replace(/ /g, "-")}.md)`,
			`  - inline code: \`${headingHint}\``,
			"  - tasks",
			"    - [ ] revisit ranking note",
			"    - [x] keep markdown noise in corpus",
			"",
			"1. capture note",
			"2. compare aliases",
			"3. check nested bullets",
			"",
			"| field | value |",
			"| --- | --- |",
			`| path | ${pathHint} |`,
			`| alias | ${aliasHint} |`,
			"",
			"```md",
			`- nested bullet for ${pathHint}`,
			`  - alias: ${aliasHint}`,
			`  - tag: ${tagHint}`,
			"```",
			"",
			"Text with **bold**, _italic_, ~~strike~~, and `inline-code` markers.",
		].join("\n");
	}

	for (let index = 0; index < documents.length; index++) {
		const document = documents[index];
		const syntaxTail = buildMarkdownSyntaxTail(document);
		if (index % 2 !== 0) {
			document.content = `${document.content ?? ""}\n${syntaxTail}`;
			continue;
		}
		document.content = `${document.content ?? ""}\n${buildMixedMarkdownTail(document)}\n${syntaxTail}`;
	}

	const rebalancedQueryCases = rebalanceQueryLanguageMix(queryCases);

	return {
		documents,
		queryCases: rebalancedQueryCases,
	};
}

type QueryLanguageBucket = "zh" | "mixed" | "en";

function detectQueryLanguageBucket(query: string): QueryLanguageBucket {
	const hasHan = /[\u4e00-\u9fff]/.test(query);
	const hasLatin = /[A-Za-z]/.test(query);
	if (hasHan && hasLatin) {
		return "mixed";
	}
	if (hasHan) {
		return "zh";
	}
	return "en";
}

function queryDifficultyWeight(queryCase: QueryCase): number {
	const typeWeight: Record<QueryType, number> = {
		coverage_guardrail: 20,
		quality_guardrail: 22,
		tail_guardrail: 24,
		locality_guardrail: 20,
		title_exact: 35,
		title_prefix: 40,
		content_dense: 65,
		prefix_metadata: 55,
		prefix_body: 70,
		body_path_anchor: 72,
		body_title_anchor: 60,
		duplicate_conflict: 62,
		mixed_anchor: 78,
		template_collision: 74,
		bilingual_mirror: 80,
		partial_memory: 90,
	};
	const suiteWeight: Record<BenchmarkSuite, number> = {
		core: 5,
		coverage_invariants: 0,
		adversarial: 10,
		messy_pkm: 15,
	};
	return typeWeight[queryCase.type] + suiteWeight[queryCase.suite];
}

function pathIncludesAny(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => path.includes(pattern));
}

function variantTail(seed: string, mode: Exclude<QueryLanguageBucket, "en">): string {
	const hash = Array.from(seed).reduce(
		(sum, char, index) => sum + char.charCodeAt(0) * (index + 1),
		0,
	);
	if (mode === "zh") {
		const options = [
			"写在哪个提示块或列表里",
			"具体是哪条标题下的记录",
			"是在那份表格说明里",
			"元数据别名里怎么写",
		];
		return options[hash % options.length];
	}
	const options = [
		"写在哪个 callout 或 note 里",
		"具体是哪份 guide 的 nested list",
		"是在那个 checklist table 里",
		"对应哪页 docs frontmatter",
	];
	return options[hash % options.length];
}

function buildLocalizedQueryVariant(
	queryCase: QueryCase,
	mode: Exclude<QueryLanguageBucket, "en">,
): string {
	const path = queryCase.relevantPath.toLowerCase();
	const type = queryCase.type;
	const withTail = (base: string): string => `${base} ${variantTail(queryCase.query, mode)}`;

	if (pathIncludesAny(path, ["cache-restore-checklist", "cache-replay-runbook"])) {
		if (mode === "zh") {
			return withTail(type === "partial_memory"
				? "缓存恢复清单里还要核对哪些回放步骤"
				: "回放说明里还有哪些恢复校验");
		}
		return withTail(type === "partial_memory"
			? "cache 恢复清单里还要核对哪些 replay 步骤"
			: "replay 说明里还有哪些 restore 校验");
	}

	if (pathIncludesAny(path, ["vector-cache-postmortem", "cache-warm-start", "incident-review", "recovery-checklist"])) {
		if (mode === "zh") {
			return withTail(type === "template_collision"
				? "热启动事故用的复盘模板"
				: "事故复盘里写了哪些缓解和恢复动作");
		}
		return withTail(type === "template_collision"
			? "warm start 事故用的 review 模板"
			: "incident 复盘里写了哪些 mitigation 和 recovery 动作");
	}

	if (pathIncludesAny(path, ["daily/2026-02-14", "daily/2026-02-19", "restart-cache-after-outage", "cache-restart-verification", "vector-cache-hotfix", "sdk-cache-rollback"])) {
		if (mode === "zh") {
			return withTail("日报和操作笔记里记的回放修复与重启校验");
		}
		return withTail("daily 和 ops 笔记里记的 replay 修复与 restart 校验");
	}

	if (pathIncludesAny(path, ["vector-cache.md", "checkpoint", "retro", "drift-log"])) {
		if (mode === "zh") {
			return withTail(type === "duplicate_conflict"
				? "归档和项目里的缓存恢复记录"
				: "检查点恢复里写的回放顺序和经验");
		}
		return withTail(type === "duplicate_conflict"
			? "archive 和 project 里的 cache 恢复记录"
			: "checkpoint 恢复里写的 replay 顺序和 lessons");
	}

	if (pathIncludesAny(path, ["aliases", "wikilink", "rename-map", "old-project", "alias-migration"])) {
		if (mode === "zh") {
			return withTail(type === "partial_memory"
				? "旧项目名和别名迁移的清理记录"
				: "项目改名后维基链接和别名怎么兼容");
		}
		return withTail(type === "partial_memory"
			? "old project 名和 alias 迁移的 cleanup 记录"
			: "项目改名后 wiki link 和 alias 怎么兼容");
	}

	if (pathIncludesAny(path, ["plugin", "compatibility", "release", "better-plugins", "upgrade"])) {
		if (mode === "zh") {
			if (type === "prefix_metadata") {
				return withTail("浏览插件的总览页面和路线图");
			}
			if (type === "template_collision") {
				return withTail("测试版插件发布兼容清单");
			}
			return withTail("插件升级前要看的兼容说明和发布时间");
		}
		if (type === "prefix_metadata") {
			return withTail("浏览 plugin 的 overview 页面和 roadmap");
		}
		if (type === "template_collision") {
			return withTail("beta plugin 发布 compatibility checklist");
		}
		return withTail("plugin 升级前要看的 compatibility 说明和 release 时间");
	}

	if (pathIncludesAny(path, ["projected", "service-account", "configmap", "secret", "namespace", "ingress"])) {
		if (mode === "zh") {
			if (type === "bilingual_mirror") {
				return withTail("中文技术文档里的容器凭证和投射卷说明");
			}
			if (type === "body_path_anchor") {
				return withTail("容器里一起挂载令牌密钥和配置映射的说明");
			}
			return withTail("容器挂载配置和凭证的技术说明");
		}
		if (type === "bilingual_mirror") {
			return withTail("中文 tech 文档里 pod 凭证和 projected volume 说明");
		}
		if (type === "body_path_anchor") {
			return withTail("pod 里一起挂载 token secret configmap 的 tech 说明");
		}
		return withTail("pod 挂载 config 和 credential 的 tech 说明");
	}

	if (mode === "zh") {
		return withTail("笔记里写的关键信息和后续动作");
	}
	return withTail("笔记里写的关键 note 和 follow up");
}

function normalizeLocalizedQuery(
	query: string,
	mode: Exclude<QueryLanguageBucket, "en">,
): string {
	const collapsed = query.replace(/\s+/g, " ").trim();
	if (mode === "zh") {
		return collapsed.replace(/[A-Za-z]+/g, " ").replace(/\s+/g, " ").trim();
	}
	if (/[A-Za-z]/.test(collapsed) && /[\u4e00-\u9fff]/.test(collapsed)) {
		return collapsed;
	}
	return `${collapsed} markdown note`;
}

function buildLocalizedQueryCase(
	queryCase: QueryCase,
	mode: Exclude<QueryLanguageBucket, "en">,
	variantIndex: number,
): QueryCase {
	const markdownCueOptions =
		mode === "zh"
			? [
				"看标题下面的提示块",
				"在元数据别名和标签里提到的",
				"嵌套列表里的回滚步骤",
				"表格字段里的兼容说明",
				"代码块旁边的补充备注",
				"维基链接附近的迁移说明",
			]
			: [
				"看 frontmatter alias 和 tag",
				"在 callout 和 nested list 里",
				"table 字段里的 compatibility 说明",
				"heading 下面的 rollout note",
				"code block 旁边的 restore 备注",
				"wiki link 附近的 alias 迁移",
			];
	const baseQuery = buildLocalizedQueryVariant(queryCase, mode);
	const markdownCue = markdownCueOptions[variantIndex % markdownCueOptions.length];
	const shouldAppendCue =
		variantIndex >= markdownCueOptions.length || queryDifficultyWeight(queryCase) >= 80;
	const localizedQuery = shouldAppendCue
		? `${baseQuery} ${markdownCue}`
		: baseQuery;
	return {
		...queryCase,
		query: normalizeLocalizedQuery(localizedQuery, mode),
	};
}

function buildLocalizedBatch(
	source: QueryCase[],
	mode: Exclude<QueryLanguageBucket, "en">,
	targetCount: number,
	startOffset = 0,
): QueryCase[] {
	if (source.length === 0 || targetCount <= 0) {
		return [];
	}
	return Array.from({ length: targetCount }, (_, index) =>
		buildLocalizedQueryCase(
			source[(startOffset + index) % source.length],
			mode,
			index,
		),
	);
}

function buildLocalizedRecallContractCases(): RecallContractCase[] {
	const baseCases: QueryCase[] = buildRecallContractCases().map((queryCase) => ({
		query: queryCase.query,
		relevantPath: queryCase.relevantPath,
		type:
			queryCase.type === "basename_partial_body" ||
			queryCase.type === "path_partial_body"
				? "body_path_anchor"
				: (queryCase.type as QueryType),
		suite: "adversarial",
	}));
	const localized = [
		...baseCases.slice(0, 5).map((queryCase, index) =>
			buildLocalizedQueryCase(queryCase, "mixed", index),
		),
		...baseCases.slice(5).map((queryCase, index) =>
			buildLocalizedQueryCase(queryCase, "zh", index),
		),
	];
	return localized.map((queryCase, index) => ({
		query: queryCase.query,
		relevantPath: queryCase.relevantPath,
		type:
			index === localized.length - 2
				? "basename_partial_body"
				: index === localized.length - 1
					? "path_partial_body"
					: (queryCase.type as RecallContractType),
	}));
}

function rebalanceQueryLanguageMix(seedCases: QueryCase[]): QueryCase[] {
	const invariants = seedCases.filter(
		(queryCase) => queryCase.suite === "coverage_invariants",
	);
	const others = seedCases.filter(
		(queryCase) => queryCase.suite !== "coverage_invariants",
	);
	const sortedOthers = [...others].sort((left, right) => {
		const difficultyGap =
			queryDifficultyWeight(right) - queryDifficultyWeight(left);
		if (difficultyGap !== 0) {
			return difficultyGap;
		}
		return left.query.localeCompare(right.query);
	});

	const targetCounts: Record<QueryLanguageBucket, number> = {
		en: 45,
		mixed: 45,
		zh: 60,
	};
	const invariantCounts = computeQueryLanguageMix(invariants);
	const englishPool = sortedOthers.filter(
		(queryCase) => detectQueryLanguageBucket(queryCase.query) === "en",
	);
	const englishOthersNeeded = Math.max(
		0,
		targetCounts.en - invariantCounts.en,
	);
	const englishOthers = englishPool.slice(0, englishOthersNeeded);
	const selectedEnglishQueries = new Set(englishOthers);
	const transformPool = sortedOthers.filter(
		(queryCase) => !selectedEnglishQueries.has(queryCase),
	);
	const localizedMixed = buildLocalizedBatch(
		transformPool,
		"mixed",
		Math.max(0, targetCounts.mixed - invariantCounts.mixed),
		0,
	);
	const localizedZh = buildLocalizedBatch(
		transformPool,
		"zh",
		Math.max(0, targetCounts.zh - invariantCounts.zh),
		localizedMixed.length,
	);

	return [...invariants, ...englishOthers, ...localizedMixed, ...localizedZh];
}

function buildRecallContractCases(): RecallContractCase[] {
	return [
		{
			type: "title_exact",
			query: "guide for replay order after restore",
			relevantPath: "pkm-en/guides/shard-checkpoint-guide.md",
		},
		{
			type: "title_exact",
			query: "playbook for cache eviction restore",
			relevantPath: "pkm-en/projects/sdk/vector-cache.md",
		},
		{
			type: "title_prefix",
			query: "shard checkpoint",
			relevantPath: "pkm-en/guides/shard-checkpoint-guide.md",
		},
		{
			type: "title_prefix",
			query: "vector cache",
			relevantPath: "pkm-en/projects/sdk/vector-cache.md",
		},
		{
			type: "prefix_metadata",
			query: "better plu",
			relevantPath: "docs/plugins/better-plugins-page.md",
		},
		{
			type: "prefix_metadata",
			query: "better plugin road",
			relevantPath: "docs/plugins/better-plugins-roadmap.md",
		},
		{
			type: "body_path_anchor",
			query: "tech-en service account token",
			relevantPath:
				"tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
		},
		{
			type: "body_path_anchor",
			query: "tech-en configmap pod data",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
		},
		{
			type: "body_title_anchor",
			query: "mounted configuration data for pods",
			relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
		},
		{
			type: "body_title_anchor",
			query: "mounted projected credentials for runtime access",
			relevantPath:
				"tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
		},
		{
			type: "basename_partial_body",
			query: "vector cache restore",
			relevantPath: "pkm-en/projects/sdk/vector-cache.md",
		},
		{
			type: "path_partial_body",
			query: "sdk cache restore",
			relevantPath: "pkm-en/projects/sdk/vector-cache.md",
		},
	];
}

function createEngineHarness(
	EngineCtor: new () => EngineLike,
	tokenizer: MockTokenizer,
	backend: "minisearch" | "coverage-lexical",
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
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor((sorted.length - 1) * p)),
	);
	return sorted[index];
}

function computePrimaryObjective(top1: number, top3: number, top5: number): number {
	return 0.55 * top1 + 0.25 * top3 + 0.2 * top5;
}

function computeMrr(rank: number): number {
	return rank > 0 ? 1 / rank : 0;
}

function createEmptyMetric(): BenchmarkMetric {
	return {
		top1: 0,
		top3: 0,
		top5: 0,
		zeroRate: 0,
		count: 0,
	};
}

function incrementMetric(
	metric: BenchmarkMetric,
	hitTop1: boolean,
	hitTop3: boolean,
	hitTop5: boolean,
	missed: boolean,
): void {
	metric.count += 1;
	if (hitTop1) {
		metric.top1 += 1;
	}
	if (hitTop3) {
		metric.top3 += 1;
	}
	if (hitTop5) {
		metric.top5 += 1;
	}
	if (missed) {
		metric.zeroRate += 1;
	}
}

function finalizeMetric(metric: BenchmarkMetric): BenchmarkMetric {
	if (metric.count === 0) {
		return metric;
	}
	return {
		top1: metric.top1 / metric.count,
		top3: metric.top3 / metric.count,
		top5: metric.top5 / metric.count,
		zeroRate: metric.zeroRate / metric.count,
		count: metric.count,
	};
}

function buildMetricRecord<T extends string>(
	keys: readonly T[],
	source: Map<T, BenchmarkMetric>,
): Record<T, BenchmarkMetric> {
	const result = {} as Record<T, BenchmarkMetric>;
	for (const key of keys) {
		result[key] = finalizeMetric(source.get(key) ?? createEmptyMetric());
	}
	return result;
}

function estimateIndexBytes(engine: EngineLike): number {
	const snapshot = engine.serialize();
	if (!snapshot) {
		return 0;
	}
	try {
		return Buffer.byteLength(JSON.stringify(snapshot));
	} catch {
		return 0;
	}
}

function documentText(document: IndexedDocument): string {
	return [
		document.path,
		document.basename,
		document.folder,
		document.aliases ?? "",
		document.tags ?? "",
		document.headings ?? "",
		document.content ?? "",
	].join("\n");
}

function computeLanguageMix(documents: IndexedDocument[]): {
	docsWithHan: number;
	docsWithLatinAndHan: number;
	hanRatio: number;
	mixedRatio: number;
} {
	let docsWithHan = 0;
	let docsWithLatinAndHan = 0;
	for (const document of documents) {
		const text = documentText(document);
		const hasHan = /[\u4e00-\u9fff]/.test(text);
		const hasLatin = /[A-Za-z]/.test(text);
		if (hasHan) {
			docsWithHan += 1;
		}
		if (hasHan && hasLatin) {
			docsWithLatinAndHan += 1;
		}
	}
	const total = Math.max(1, documents.length);
	return {
		docsWithHan,
		docsWithLatinAndHan,
		hanRatio: docsWithHan / total,
		mixedRatio: docsWithLatinAndHan / total,
	};
}

function computeQueryLanguageMix(queryCases: QueryCase[]): Record<QueryLanguageBucket, number> {
	return queryCases.reduce<Record<QueryLanguageBucket, number>>(
		(acc, queryCase) => {
			acc[detectQueryLanguageBucket(queryCase.query)] += 1;
			return acc;
		},
		{
			zh: 0,
			mixed: 0,
			en: 0,
		},
	);
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
	let top3Hits = 0;
	let top5Hits = 0;
	let zeroHits = 0;
	let reciprocalRank = 0;

	const suiteTotals = new Map<BenchmarkSuite, BenchmarkMetric>();
	const typeTotals = new Map<QueryType, BenchmarkMetric>();

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
		const hitTop3 = rank > 0 && rank <= 3;
		const hitTop5 = rank > 0 && rank <= 5;
		const missed = rank === 0;

		if (hitTop1) {
			top1Hits += 1;
		}
		if (hitTop3) {
			top3Hits += 1;
		}
		if (hitTop5) {
			top5Hits += 1;
		}
		if (missed) {
			zeroHits += 1;
		}
		reciprocalRank += computeMrr(rank);

		const suiteMetric =
			suiteTotals.get(queryCase.suite) ?? createEmptyMetric();
		incrementMetric(suiteMetric, hitTop1, hitTop3, hitTop5, missed);
		suiteTotals.set(queryCase.suite, suiteMetric);

		const typeMetric = typeTotals.get(queryCase.type) ?? createEmptyMetric();
		incrementMetric(typeMetric, hitTop1, hitTop3, hitTop5, missed);
		typeTotals.set(queryCase.type, typeMetric);

		outcomes.push({
			query: queryCase.query,
			relevantPath: queryCase.relevantPath,
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
			objective: computePrimaryObjective(
				top1Hits / total,
				top3Hits / total,
				top5Hits / total,
			),
			top1: top1Hits / total,
			top3: top3Hits / total,
			top5: top5Hits / total,
			zeroRate: zeroHits / total,
			mrr: reciprocalRank / total,
			avgMsPerQuery: timings.reduce((sum, item) => sum + item, 0) / total,
			p50Ms: percentile(timings, 0.5),
			p100Ms: timings.length > 0 ? Math.max(...timings) : 0,
			estimatedIndexBytes: estimateIndexBytes(engine),
			bySuite: buildMetricRecord(BENCHMARK_SUITES, suiteTotals),
			byType: buildMetricRecord(QUERY_TYPES, typeTotals),
		},
		outcomes,
	};
}

function createCoverageRecallIndex(engine: any) {
	return {
		bodyPostings: engine.bodyPostings,
		metadataAliasPhrasePostings: engine.metadataAliasPhrasePostings,
		metadataAliasPostings: engine.metadataAliasPostings,
		metadataBasenamePhrasePostings: engine.metadataBasenamePhrasePostings,
		metadataBasenamePostings: engine.metadataBasenamePostings,
		metadataFolderPhrasePostings: engine.metadataFolderPhrasePostings,
		metadataFolderPostings: engine.metadataFolderPostings,
		metadataHeadingPhrasePostings: engine.metadataHeadingPhrasePostings,
		metadataHeadingPostings: engine.metadataHeadingPostings,
		metadataPostings: engine.metadataPostings,
		bodyPhrasePostings: engine.bodyPhrasePostings,
		metadataPhrasePostings: engine.metadataPhrasePostings,
		metadataTagPhrasePostings: engine.metadataTagPhrasePostings,
		metadataTagPostings: engine.metadataTagPostings,
		sortedLexicon: engine.sortedLexicon,
		documentBodyTokensByPath: new Map(
			Array.from(engine.documents.entries()).map(
				([docPath, document]: [string, { bodyTokenSequence: string[] }]) => [
					docPath,
					document.bodyTokenSequence,
				],
			),
		),
	};
}

async function runCoverageRecallContract(
	engine: any,
	tokenizer: MockTokenizer,
	queryCases: RecallContractCase[],
): Promise<{
	unionHitRate: number;
	zeroRate: number;
	byType: Record<
		RecallContractType,
		{ unionHitRate: number; zeroRate: number; count: number }
	>;
	laneHitCounts: Record<string, number>;
	misses: Array<{
		query: string;
		type: RecallContractType;
		relevantPath: string;
		queryKind: string;
		hardAnchors: string[];
		decisiveBodies: string[];
		lanes: Array<{ laneName: string; admittedCount: number }>;
	}>;
}> {
	const { buildCoverageLexicalPlan } = require(
		"src/services/search/coverage-lexical/coverage-lexical-planner",
	);
	const {
		buildCoverageLexicalPhraseSignatures,
		buildCoverageLexicalStructuredMetadataSignatures,
	} = require("src/services/search/coverage-lexical/coverage-lexical-bridge");
	const {
		collectCoverageLexicalCandidateStatesWithDebug,
	} = require("src/services/search/coverage-lexical/coverage-lexical-recall");

	const index = createCoverageRecallIndex(engine);
	let unionHits = 0;
	const laneHitCounts: Record<string, number> = {};
	const typeTotals = new Map<
		RecallContractType,
		{ unionHits: number; misses: number; count: number }
	>();
	const misses: Array<{
		query: string;
		type: RecallContractType;
		relevantPath: string;
		queryKind: string;
		hardAnchors: string[];
		decisiveBodies: string[];
		lanes: Array<{ laneName: string; admittedCount: number }>;
	}> = [];

	for (const queryCase of queryCases) {
		const queryTerms = tokenizer
			.tokenizeSequence(queryCase.query, "search")
			.map((term) => term.toLowerCase());
		const probes = engine.buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(queryCase.query, queryTerms, probes);
		const phraseSignatures = [
			...buildCoverageLexicalPhraseSignatures(plan.families),
			...buildCoverageLexicalStructuredMetadataSignatures(
				queryCase.query,
				plan.families,
			),
		];
		const { candidates, debug } = collectCoverageLexicalCandidateStatesWithDebug(
			index,
			plan,
			phraseSignatures,
			{
				queryText: queryCase.query,
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 10,
			},
		);
		const hit = candidates.has(queryCase.relevantPath);
		if (hit) {
			unionHits += 1;
		}
		for (const lane of debug.lanes) {
			if (lane.admittedPaths.includes(queryCase.relevantPath)) {
				laneHitCounts[lane.laneName] = (laneHitCounts[lane.laneName] ?? 0) + 1;
			}
		}
		const total =
			typeTotals.get(queryCase.type) ?? { unionHits: 0, misses: 0, count: 0 };
		total.count += 1;
		if (hit) {
			total.unionHits += 1;
		} else {
			total.misses += 1;
			misses.push({
				query: queryCase.query,
				type: queryCase.type,
				relevantPath: queryCase.relevantPath,
				queryKind: plan.queryKind,
				hardAnchors: plan.hardAnchorFamilies.map((family: { normalizedTerm: string }) => family.normalizedTerm),
				decisiveBodies: plan.decisiveBodyFamilies.map((family: { normalizedTerm: string }) => family.normalizedTerm),
				lanes: debug.lanes.map((lane: { laneName: string; admittedCount: number }) => ({
					laneName: lane.laneName,
					admittedCount: lane.admittedCount,
				})),
			});
		}
		typeTotals.set(queryCase.type, total);
	}

	const byType = {} as Record<
		RecallContractType,
		{ unionHitRate: number; zeroRate: number; count: number }
	>;
	for (const queryCase of queryCases) {
		const total = typeTotals.get(queryCase.type);
		if (!total || byType[queryCase.type]) {
			continue;
		}
		byType[queryCase.type] = {
			unionHitRate: total.unionHits / Math.max(1, total.count),
			zeroRate: total.misses / Math.max(1, total.count),
			count: total.count,
		};
	}

	return {
		unionHitRate: unionHits / Math.max(1, queryCases.length),
		zeroRate: 1 - unionHits / Math.max(1, queryCases.length),
		byType,
		laneHitCounts,
		misses,
	};
}

function summarizeWins(
	leftOutcomes: QueryOutcome[],
	rightOutcomes: QueryOutcome[],
): {
	leftTop1WinCount: number;
	rightTop1WinCount: number;
	leftTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>>;
	rightTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>>;
	leftTop1WinsByType: Partial<Record<QueryType, number>>;
	rightTop1WinsByType: Partial<Record<QueryType, number>>;
} {
	let leftTop1WinCount = 0;
	let rightTop1WinCount = 0;
	const leftTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>> = {};
	const rightTop1WinsBySuite: Partial<Record<BenchmarkSuite, number>> = {};
	const leftTop1WinsByType: Partial<Record<QueryType, number>> = {};
	const rightTop1WinsByType: Partial<Record<QueryType, number>> = {};

	for (let index = 0; index < leftOutcomes.length; index++) {
		const left = leftOutcomes[index];
		const right = rightOutcomes[index];
		if (left.hitTop1 && !right.hitTop1) {
			leftTop1WinCount += 1;
			leftTop1WinsBySuite[left.suite] =
				(leftTop1WinsBySuite[left.suite] ?? 0) + 1;
			leftTop1WinsByType[left.type] =
				(leftTop1WinsByType[left.type] ?? 0) + 1;
		}
		if (right.hitTop1 && !left.hitTop1) {
			rightTop1WinCount += 1;
			rightTop1WinsBySuite[right.suite] =
				(rightTop1WinsBySuite[right.suite] ?? 0) + 1;
			rightTop1WinsByType[right.type] =
				(rightTop1WinsByType[right.type] ?? 0) + 1;
		}
	}

	return {
		leftTop1WinCount,
		rightTop1WinCount,
		leftTop1WinsBySuite,
		rightTop1WinsBySuite,
		leftTop1WinsByType,
		rightTop1WinsByType,
	};
}

function summarizeMisses(outcomes: QueryOutcome[], limit = 10): Array<{
	query: string;
	type: QueryType;
	suite: BenchmarkSuite;
	rank: number;
	relevantPath: string;
	top5: string[];
}> {
	return outcomes
		.filter((outcome) => !outcome.hitTop1)
		.sort((left, right) => {
			const leftRank = left.rank === 0 ? Number.POSITIVE_INFINITY : left.rank;
			const rightRank = right.rank === 0 ? Number.POSITIVE_INFINITY : right.rank;
			return rightRank === leftRank
				? left.query.localeCompare(right.query)
				: rightRank - leftRank;
		})
		.slice(0, limit)
		.map((outcome) => ({
			query: outcome.query,
			type: outcome.type,
			suite: outcome.suite,
			rank: outcome.rank,
			relevantPath: outcome.relevantPath,
			top5: outcome.results,
		}));
}

function summarizeDisagreements(
	leftOutcomes: QueryOutcome[],
	rightOutcomes: QueryOutcome[],
	limit = 12,
): Array<{
	query: string;
	type: QueryType;
	suite: BenchmarkSuite;
	relevantPath: string;
	leftRank: number;
	rightRank: number;
	leftTop5: string[];
	rightTop5: string[];
}> {
	const disagreements: Array<{
		query: string;
		type: QueryType;
		suite: BenchmarkSuite;
		relevantPath: string;
		leftRank: number;
		rightRank: number;
		leftTop5: string[];
		rightTop5: string[];
	}> = [];

	for (let index = 0; index < leftOutcomes.length; index++) {
		const left = leftOutcomes[index];
		const right = rightOutcomes[index];
		if (left.rank === right.rank && left.hitTop1 === right.hitTop1) {
			continue;
		}
		disagreements.push({
			query: left.query,
			type: left.type,
			suite: left.suite,
			relevantPath: left.relevantPath,
			leftRank: left.rank,
			rightRank: right.rank,
			leftTop5: left.results,
			rightTop5: right.results,
		});
	}

	return disagreements
		.sort((left, right) => {
			const leftGap = Math.abs(left.leftRank - left.rightRank);
			const rightGap = Math.abs(right.leftRank - right.rightRank);
			return rightGap === leftGap
				? left.query.localeCompare(right.query)
				: rightGap - leftGap;
		})
		.slice(0, limit);
}

function round(value: number): number {
	return Number(value.toFixed(3));
}

describe("coverage lexical automation benchmark", () => {
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

	test("compare coverage lexical against minisearch on automation corpus", async () => {
		const benchmarkStartedAt = performance.now();
		const tokenizer = createMockTokenizer();
		const { documents, queryCases } = createAutomationCorpus();
		const languageMix = computeLanguageMix(documents);
		const queryLanguageMix = computeQueryLanguageMix(queryCases);
		const { MiniSearchFileEngine } = require(
			"src/services/search/file-search-engine",
		);
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		);

		const mini = createEngineHarness(MiniSearchFileEngine, tokenizer, "minisearch");
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

		const coverageLexical = createEngineHarness(
			CoverageLexicalFileSearchEngine,
			tokenizer,
			"coverage-lexical",
		);
		const coverageResult = await runBenchmark(
			"CoverageLexical",
			coverageLexical,
			documents,
			queryCases,
		);
		const recallContract = await runCoverageRecallContract(
			coverageLexical as any,
			tokenizer,
			buildRecallContractCases(),
		);
		const localizedRecallContract = await runCoverageRecallContract(
			coverageLexical as any,
			tokenizer,
			buildLocalizedRecallContractCases(),
		);
		const coverageVsMini = summarizeWins(
			coverageResult.outcomes,
			miniResult.outcomes,
		);
		const coverageMisses = summarizeMisses(coverageResult.outcomes);
		const miniMisses = summarizeMisses(miniResult.outcomes);
		const disagreementDigest = summarizeDisagreements(
			coverageResult.outcomes,
			miniResult.outcomes,
		);
		const benchmarkElapsedMs = performance.now() - benchmarkStartedAt;

		console.log(
			"[coverage-lexical-automation-benchmark] corpus",
			JSON.stringify(
				{
					noteCount: documents.length,
					queryCount: queryCases.length,
					docsWithHan: languageMix.docsWithHan,
					docsWithLatinAndHan: languageMix.docsWithLatinAndHan,
					hanRatio: round(languageMix.hanRatio),
					mixedRatio: round(languageMix.mixedRatio),
					queryZhCount: queryLanguageMix.zh,
					queryMixedCount: queryLanguageMix.mixed,
					queryEnCount: queryLanguageMix.en,
					queryZhRatio: round(queryLanguageMix.zh / queryCases.length),
					queryMixedRatio: round(queryLanguageMix.mixed / queryCases.length),
					queryEnRatio: round(queryLanguageMix.en / queryCases.length),
					totalElapsedMs: round(benchmarkElapsedMs),
					bySuite: queryCases.reduce<Record<BenchmarkSuite, number>>(
						(acc, queryCase) => {
							acc[queryCase.suite] += 1;
							return acc;
						},
						{
							core: 0,
							coverage_invariants: 0,
							adversarial: 0,
							messy_pkm: 0,
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
				},
				null,
				2,
			),
		);

		console.log(
			"[coverage-lexical-automation-benchmark] summary",
			JSON.stringify(
				[miniResult.summary, coverageResult.summary].map((summary) => ({
					name: summary.name,
					objective: round(summary.objective),
					top1: round(summary.top1),
					top3: round(summary.top3),
					top5: round(summary.top5),
					zeroRate: round(summary.zeroRate),
					mrr: round(summary.mrr),
					avgMsPerQuery: round(summary.avgMsPerQuery),
					p50Ms: round(summary.p50Ms),
					p100Ms: round(summary.p100Ms),
					estimatedIndexKB: round(summary.estimatedIndexBytes / 1024),
					bySuite: Object.fromEntries(
						Object.entries(summary.bySuite).map(([suite, stats]) => [
							suite,
							{
								top1: round(stats.top1),
								top3: round(stats.top3),
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
								top3: round(stats.top3),
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
			"[coverage-lexical-automation-benchmark] recall-contract",
			JSON.stringify(
				{
					unionHitRate: round(recallContract.unionHitRate),
					zeroRate: round(recallContract.zeroRate),
					byType: Object.fromEntries(
						Object.entries(recallContract.byType).map(([type, metric]) => [
							type,
							{
								unionHitRate: round(metric.unionHitRate),
								zeroRate: round(metric.zeroRate),
								count: metric.count,
							},
						]),
					),
					laneHitCounts: recallContract.laneHitCounts,
					misses: recallContract.misses.slice(0, 10),
				},
				null,
				2,
			),
		);
		console.log(
			"[coverage-lexical-automation-benchmark] localized-recall-contract",
			JSON.stringify(
				{
					unionHitRate: round(localizedRecallContract.unionHitRate),
					zeroRate: round(localizedRecallContract.zeroRate),
					byType: Object.fromEntries(
						Object.entries(localizedRecallContract.byType).map(([type, metric]) => [
							type,
							{
								unionHitRate: round(metric.unionHitRate),
								zeroRate: round(metric.zeroRate),
								count: metric.count,
							},
						]),
					),
					laneHitCounts: localizedRecallContract.laneHitCounts,
					misses: localizedRecallContract.misses.slice(0, 10),
				},
				null,
				2,
			),
		);

		console.log(
			"[coverage-lexical-automation-benchmark] coverage-vs-mini",
			JSON.stringify(coverageVsMini, null, 2),
		);
		console.log(
			"[coverage-lexical-automation-benchmark] disagreement-digest",
			JSON.stringify(disagreementDigest, null, 2),
		);
		console.log(
			"[coverage-lexical-automation-benchmark] coverage-misses",
			JSON.stringify(coverageMisses, null, 2),
		);
		console.log(
			"[coverage-lexical-automation-benchmark] mini-misses",
			JSON.stringify(miniMisses, null, 2),
		);

		expect(documents.length).toBeGreaterThanOrEqual(70);
		expect(queryCases.length).toBeGreaterThanOrEqual(145);
		expect(languageMix.hanRatio).toBeGreaterThanOrEqual(0.4);
		expect(languageMix.hanRatio).toBeLessThanOrEqual(0.6);
		expect(languageMix.mixedRatio).toBeGreaterThanOrEqual(0.4);
		expect(queryLanguageMix.mixed / queryCases.length).toBeGreaterThanOrEqual(0.25);
		expect(queryLanguageMix.mixed / queryCases.length).toBeLessThanOrEqual(0.35);
		expect(queryLanguageMix.zh / queryCases.length).toBeGreaterThanOrEqual(0.34);
		expect(queryLanguageMix.zh / queryCases.length).toBeLessThanOrEqual(0.46);
		expect(queryLanguageMix.en / queryCases.length).toBeGreaterThanOrEqual(0.25);
		expect(queryLanguageMix.en / queryCases.length).toBeLessThanOrEqual(0.35);
		expect(
			queryCases.filter((queryCase) => queryCase.suite === "coverage_invariants"),
		).toHaveLength(8);
		expect(
			queryCases.filter((queryCase) => queryCase.suite === "messy_pkm").length,
		).toBeGreaterThanOrEqual(50);
		expect(benchmarkElapsedMs).toBeLessThan(20000);
	});
});
