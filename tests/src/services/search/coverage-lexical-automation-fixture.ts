// @ts-nocheck
import { performance } from "perf_hooks";
import { container } from "tsyringe";
import { Tokenizer } from "src/services/search/tokenizer";

type CandidateCascadeTrace = Record<string, unknown> & {
	usedFuzzySalvage?: boolean;
	usedHanFallbackSalvage?: boolean;
	verificationSkippedReason?: string;
	verificationBucketDocCount?: number;
	verificationBodyDocCount?: number;
	verificationEstimatedBodyTokenSum?: number;
	verificationBodyAvailability?: {
		resident: number;
		hotCache: number;
		coldOrSnapshot: number;
		missing: number;
	};
};


type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	generation: number;
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
	| "mixed_script_anchor"
	| "zh_short_identity"
	| "zh_short_body_vs_basename"
	| "ambiguous_intent"
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
	byGate: Record<BenchmarkGate, BenchmarkGateMetric>;
};

type BenchmarkGate =
	| "product_guardrail_gate"
	| "exception_aware_gate"
	| "legacy_continuity_gate";

type BenchmarkGateMetric = BenchmarkMetric & {
	objective: number;
	types: QueryType[];
};

type PhaseTimingSummary = {
	queryCount: number;
	queryTotalMs: number;
	totalMeasuredMs: number;
	phases: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfMeasuredMs: number;
		shareOfQueryTime: number;
	}>;
	recallSubphases?: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfRecallMs: number;
		shareOfQueryTime: number;
	}>;
	laneEvaluateSubphases?: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfLaneEvaluateMs: number;
		shareOfQueryTime: number;
	}>;
};

type IndexTimingSummary = {
	batchCount: number;
	documentCount: number;
	bodyTokenCount: number;
	exactTermCount: number;
	metadataHanBigramCount: number;
	bodyHanSegmentCount: number;
	bodyHanLogicalBlockCount: number;
	totalMeasuredMs: number;
	phases: Array<{
		phase: string;
		totalMs: number;
		maxMs: number;
		count: number;
		unitCount: number;
		avgMsPerCall: number;
		avgMsPerUnit: number;
		shareOfMeasuredMs: number;
	}>;
};

type CoverageLexicalBenchmarkDiagnostic =
	| "index"
	| "timing"
	| "recall"
	| "lane-study"
	| "offload"
	| "cascade"
	| "wins"
	| "disagreements"
	| "misses"
	| "prune";

type CoverageLexicalBenchmarkOffloadDocDebug = {
	docId: number;
	path: string | null;
	cheapCoarseRank: number | null;
	finalRank: number | null;
	hydratedAtCoarse: boolean;
	selectedForLocalWindow: boolean;
	hasResidentBodyTokens: boolean;
	bodyMatchCount: number;
	phraseMatchCount: number;
	hasBodyPrefixWitness: boolean;
	bodyCharMatchCount: number;
	unresolvedBodyEvidence: {
		needsPassageSignal: boolean;
		hasUnverifiedPhraseWitness: boolean;
		hasUnresolvedPrefixSurface: boolean;
		hasUnresolvedBodyCharVerification: boolean;
		unresolvedFamilyCount: number;
		unresolvedWeightUpperBound: number;
	};
};

type CoverageLexicalBenchmarkOffloadSearchDebug = {
	queryText: string;
	offloadEnabled: boolean;
	stagedHydration: boolean;
	candidateCount: number;
	cheapCoarseTopDocIds: number[];
	coarseHydrationDocIds: number[];
	localWindowDocIds: number[];
	rankedTopDocIds: number[];
	returnedTopDocIds: number[];
	docs: CoverageLexicalBenchmarkOffloadDocDebug[];
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
	offloadDebug?: CoverageLexicalBenchmarkOffloadSearchDebug | null;
	candidateCascadeDebug?: CandidateCascadeTrace | null;
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

type RelaxedHybridByQueryKindMetric = {
	queryCount: number;
	laneRanCount: number;
	relevantCandidateHits: number;
	relevantPrefilterHits: number;
	relevantAdmittedHits: number;
	overlapCandidateWithStrictHybrid: number;
	overlapCandidateWithLocalBody: number;
	overlapAdmittedWithStrictHybrid: number;
	overlapAdmittedWithLocalBody: number;
	exclusiveCandidateHits: number;
	exclusiveAdmittedHits: number;
};

type RelaxedHybridAnalysis = {
	byQueryKind: Record<string, RelaxedHybridByQueryKindMetric>;
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
	estimateIndexBytes?(): number | null;
	getIndexBreakdown?(): Record<string, unknown> | null;
	resetBenchmarkIndexTiming?(): void;
	getBenchmarkIndexTimingSummary?(): IndexTimingSummary | null;
	resetBenchmarkPhaseTiming?(): void;
	getBenchmarkPhaseTimingSummary?(): PhaseTimingSummary | null;
	getLastBenchmarkOffloadSearchDebug?():
		| CoverageLexicalBenchmarkOffloadSearchDebug
		| null;
	getLastBenchmarkV2CandidateCascadeDebug?():
		| CandidateCascadeTrace
		| null;
};

const benchmarkTextEncoder = new TextEncoder();

function estimateBenchmarkValueBytes(
	value: unknown,
	visited = new WeakSet<object>(),
): number {
	if (value === null || value === undefined) {
		return 0;
	}
	if (typeof value === "string") {
		return benchmarkTextEncoder.encode(value).length;
	}
	if (typeof value === "number") {
		return 8;
	}
	if (typeof value === "boolean") {
		return 4;
	}
	if (typeof value === "bigint") {
		return benchmarkTextEncoder.encode(value.toString()).length;
	}
	if (value instanceof Blob) {
		return value.size;
	}
	if (value instanceof Date) {
		return benchmarkTextEncoder.encode(value.toISOString()).length;
	}
	if (value instanceof ArrayBuffer) {
		return value.byteLength;
	}
	if (ArrayBuffer.isView(value)) {
		return value.byteLength;
	}
	if (Array.isArray(value)) {
		return value.reduce(
			(sum, item) => sum + estimateBenchmarkValueBytes(item, visited),
			0,
		);
	}
	if (typeof value === "object") {
		if (visited.has(value)) {
			return 0;
		}
		visited.add(value);
		return Object.entries(value).reduce((sum, [key, childValue]) => {
			return (
				sum +
				benchmarkTextEncoder.encode(key).length +
				estimateBenchmarkValueBytes(childValue, visited)
			);
		}, 0);
	}
	return benchmarkTextEncoder.encode(String(value)).length;
}

function getBenchmarkPersistedLexicalBytes(): number {
	try {
		const { FileSnapshotStore } = require(
			"src/services/search/shared/file-snapshot-store",
		) as {
			FileSnapshotStore: new () => unknown;
		};
		const snapshotStore = container.resolve(FileSnapshotStore) as {
			getBenchmarkPersistedLexicalBytes?: () => number;
		};
		const persistedBytes = snapshotStore.getBenchmarkPersistedLexicalBytes?.();
		return typeof persistedBytes === "number" && Number.isFinite(persistedBytes) && persistedBytes > 0 ? persistedBytes : 0;
	} catch {
		return 0;
	}
}

/**
 * Stage 1 benchmark classification note:
 * - Product guardrails: coverage_guardrail, quality_guardrail, mixed_anchor,
 *   mixed_script_anchor, zh_short_identity, zh_short_body_vs_basename.
 * - Exception-aware product queries: partial_memory.
 * - Remaining query types currently serve continuity, adversarial, or legacy
 *   implementation-shape coverage.
 *
 * Stage 6 now reports these groups as separate benchmark intent gates while
 * keeping the same synthetic query corpus as the continuity anchor.
 */
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
	"mixed_script_anchor",
	"zh_short_identity",
	"zh_short_body_vs_basename",
	"ambiguous_intent",
	"partial_memory",
];

const PRODUCT_GUARDRAIL_QUERY_TYPES: readonly QueryType[] = [
	"coverage_guardrail",
	"quality_guardrail",
	"tail_guardrail",
	"locality_guardrail",
	"mixed_anchor",
	"mixed_script_anchor",
	"zh_short_identity",
	"zh_short_body_vs_basename",
];

const EXCEPTION_AWARE_QUERY_TYPES: readonly QueryType[] = ["partial_memory"];

const LEGACY_CONTINUITY_QUERY_TYPES: readonly QueryType[] = QUERY_TYPES.filter(
	(type) =>
		!PRODUCT_GUARDRAIL_QUERY_TYPES.includes(type) &&
		!EXCEPTION_AWARE_QUERY_TYPES.includes(type),
);

const BENCHMARK_GATES: readonly BenchmarkGate[] = [
	"product_guardrail_gate",
	"exception_aware_gate",
	"legacy_continuity_gate",
];

const BENCHMARK_GATE_QUERY_TYPES: Record<BenchmarkGate, readonly QueryType[]> = {
	product_guardrail_gate: PRODUCT_GUARDRAIL_QUERY_TYPES,
	exception_aware_gate: EXCEPTION_AWARE_QUERY_TYPES,
	legacy_continuity_gate: LEGACY_CONTINUITY_QUERY_TYPES,
};

/**
 * Lexical benchmark policy:
 * - Every passing case must be solvable from shared lexical anchors in query/path/title/alias/body.
 * - Do not add cases that require synonym, near-synonym, semantic inference, or translation.
 * - Translation- or semantics-dependent cases belong in semantic / hybrid benchmarks, not here.
 */

const BENCHMARK_SUITES: readonly BenchmarkSuite[] = [
	"core",
	"coverage_invariants",
	"adversarial",
	"messy_pkm",
];

export function createMockTokenizer(): MockTokenizer {
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

export function createAutomationCorpus(): {
	documents: IndexedDocument[];
	queryCases: QueryCase[];
} {
	const documents: IndexedDocument[] = [];
	const queryCases: QueryCase[] = [];
	const benchmarkGenerationBase = 1_700_000_000_000;
	const zhElectronicsIntroPath = "pkm-zh/books/电子技术入门.md";
	const zhAliasMigrationNotePath = "pkm-zh/notes/别名迁移说明.md";
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
			generation: benchmarkGenerationBase + documents.length,
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
		{ aliases: "tech-zh projected volume service account note", tags: "zh projected volume" },
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
		{ aliases: "tech-zh projected service account token note", tags: "zh projected token" },
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
		"general-zh/notes/政治理论笔记.md",
		"政治理论笔记",
		"政治理论",
		"政治理论 笔记 讨论 国家 制度 意识形态 与 政治 理论 的核心概念",
		{ aliases: "政治理论 学习笔记", tags: "政治理论" },
	);
	addDocument(
		"general-zh/notes/理论学习方法.md",
		"理论学习方法",
		"理论方法",
		"理论 理论 学习 方法 侧重 抽象 理论 框架 与 复习 节奏",
		{ aliases: "理论 学习 方法", tags: "理论 学习" },
	);
	addDocument(
		"general-zh/notes/政治观察摘要.md",
		"政治观察摘要",
		"政治观察",
		"政治 政治 观察 摘要 记录 现实 政治 事件 与 新闻 讨论",
		{ aliases: "政治 观察 记录", tags: "政治 观察" },
	);
	addDocument(
		"general-zh/notes/快乐定义笔记.md",
		"快乐定义笔记",
		"快乐定义",
		"快乐 定义 讨论 概念 边界 心理学 语境 与 快乐 的适用范围",
		{ aliases: "快乐定义 心理学笔记", tags: "快乐 定义" },
	);
	addDocument(
		"general-zh/notes/快乐习惯清单.md",
		"快乐习惯清单",
		"快乐习惯",
		"快乐 快乐 习惯 清单 记录 睡眠 运动 感恩 与 每日 练习",
		{ aliases: "快乐 练习 清单", tags: "快乐 习惯" },
	);
	addDocument(
		"general-zh/notes/定义适用范围说明.md",
		"定义适用范围说明",
		"定义范围",
		"定义 适用范围 说明 讨论 抽象概念 的 使用边界 与 语义限定",
		{ aliases: "定义 适用范围 说明", tags: "定义 适用范围" },
	);
	addDocument(
		"mixed/notes/projected-token-runtime-access-note.md",
		"projected token runtime access note",
		"运行时访问",
		"projected token runtime access note explains pod credential reads and 运行时访问 flow",
		{ aliases: "projected token 运行时访问", tags: "projected token 运行时访问" },
	);
	addDocument(
		"mixed/notes/projected-token-overview.md",
		"projected token overview",
		"Projected token",
		"projected token projected token projected token pod credential rotation overview",
		{ aliases: "projected token pod credentials", tags: "projected token" },
	);
	addDocument(
		"mixed/notes/运行时访问说明.md",
		"运行时访问说明",
		"运行时访问",
		"运行时访问 说明 介绍 容器 凭证 读取 与 访问 流程",
		{ aliases: "运行时访问 pod 凭证", tags: "运行时 访问" },
	);
	addDocument(
		"mixed/notes/obsidian-sync-常见问题.md",
		"obsidian sync 常见问题",
		"obsidian sync 问题",
		"obsidian sync 常见问题 说明 同步冲突 限额 报错 与 排查步骤",
		{ aliases: "obsidian sync 问题", tags: "obsidian sync 问题" },
	);
	addDocument(
		"mixed/notes/obsidian-sync-overview.md",
		"obsidian sync overview",
		"obsidian sync",
		"obsidian sync overview introduces setup limits pricing and vault restore guidance",
		{ aliases: "obsidian sync", tags: "obsidian sync" },
	);
	addDocument(
		"mixed/notes/同步问题排查.md",
		"同步问题排查",
		"同步问题排查",
		"同步 问题 排查 记录 常见报错 网络波动 与 重试步骤",
		{ aliases: "问题 排查", tags: "同步 问题 排查" },
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
	addDocument(
		"pkm-zh/books/电子技术入门.md",
		"电子技术入门",
		"电子技术入门",
		"电子技术入门讲基础电路、常见元件、信号路径和实验安全，不是游戏设计技巧摘录。",
		{ aliases: "电子技术 电路 入门", tags: "电子技术 电路 入门" },
	);
	addDocument(
		"pkm-zh/books/游戏设计技巧摘录.md",
		"游戏设计技巧摘录",
		"游戏设计技巧",
		"这页主要摘录电子游戏设计技巧、关卡技巧、玩家技能反馈和战斗技巧，不是电子技术教材。",
		{ aliases: "游戏设计 技巧 摘录", tags: "游戏设计 技巧" },
	);
	addDocument(
		"pkm-zh/notes/别名迁移说明.md",
		"别名迁移说明",
		"别名迁移说明",
		"记录旧名兼容、别名映射、链接迁移和历史名称回收规则，专门回答旧名与别名如何兼容。",
		{ aliases: "旧名 别名 兼容", tags: "别名 迁移 旧名" },
	);
	addDocument(
		"pkm-zh/notes/旧项目整理.md",
		"旧项目整理",
		"旧项目整理",
		"这页整理旧项目背景、历史命名和零散兼容备注，但不专门讲别名迁移规则。",
		{ aliases: "旧项目 历史", tags: "旧项目 整理" },
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
		"政治理论",
		"general-zh/notes/政治理论笔记.md",
		"zh_short_body_vs_basename",
		"coverage_invariants",
	);
	addQuery(
		"政治理论 学习笔记",
		"general-zh/notes/政治理论笔记.md",
		"zh_short_identity",
		"adversarial",
	);
	addQuery(
		"快乐定义",
		"general-zh/notes/快乐定义笔记.md",
		"zh_short_body_vs_basename",
		"coverage_invariants",
	);
	addQuery(
		"快乐定义 心理学笔记",
		"general-zh/notes/快乐定义笔记.md",
		"zh_short_identity",
		"adversarial",
	);
	addQuery(
		"projected token 运行时访问",
		"mixed/notes/projected-token-runtime-access-note.md",
		"mixed_script_anchor",
		"coverage_invariants",
	);
	addQuery(
		"projected token 运行时访问 pod",
		"mixed/notes/projected-token-runtime-access-note.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"obsidian sync 问题",
		"mixed/notes/obsidian-sync-常见问题.md",
		"mixed_script_anchor",
		"coverage_invariants",
	);
	addQuery(
		"obsidian sync 问题 排查",
		"mixed/notes/obsidian-sync-常见问题.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"电子技",
		"pkm-zh/books/电子技术入门.md",
		"zh_short_body_vs_basename",
		"coverage_invariants",
	);
	addQuery(
		"旧名别名",
		"pkm-zh/notes/别名迁移说明.md",
		"zh_short_identity",
		"coverage_invariants",
	);

	addQuery(
		"guide for replay order after restore",
		"pkm-en/guides/shard-checkpoint-guide.md",
		"title_exact",
		"core",
	);
	addQuery(
		"政治理论",
		"general-zh/notes/政治理论笔记.md",
		"zh_short_body_vs_basename",
		"coverage_invariants",
	);
	addQuery(
		"政治理论 学习笔记",
		"general-zh/notes/政治理论笔记.md",
		"zh_short_identity",
		"adversarial",
	);
	addQuery(
		"projected token 运行时访问",
		"mixed/notes/projected-token-runtime-access-note.md",
		"mixed_script_anchor",
		"coverage_invariants",
	);
	addQuery(
		"projected token 运行时访问 pod",
		"mixed/notes/projected-token-runtime-access-note.md",
		"mixed_script_anchor",
		"adversarial",
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
		"电子技术入门",
		"pkm-zh/books/电子技术入门.md",
		"zh_short_identity",
		"adversarial",
	);
	addQuery(
		"别名兼容说明",
		"pkm-zh/notes/别名迁移说明.md",
		"zh_short_identity",
		"messy_pkm",
	);
	addQuery(
		"incident review warm start notes",
		"pkm-en/incidents/incident-review.md",
		"ambiguous_intent",
		"adversarial",
	);
	addQuery(
		"\u65e7\u540d\u522b\u540d\u8fc1\u79fb",
		zhAliasMigrationNotePath,
		"zh_short_identity",
		"coverage_invariants",
	);
	addQuery(
		"\u7535\u5b50\u6280\u672f \u5165\u95e8 \u7535\u8def",
		zhElectronicsIntroPath,
		"zh_short_identity",
		"messy_pkm",
	);
	addQuery(
		"cache restore playbook note",
		"pkm-en/projects/sdk/vector-cache.md",
		"ambiguous_intent",
		"messy_pkm",
	);
	addQuery(
		"aliases note for old project names",
		"pkm-en/notes/linking/aliases-deep-dive.md",
		"ambiguous_intent",
		"messy_pkm",
	);
	addQuery(
		"\u7535\u5b50\u6280\u672f \u57fa\u7840\u7535\u8def \u7b14\u8bb0",
		"pkm-zh/books/电子技术入门.md",
		"ambiguous_intent",
		"adversarial",
	);

	addQuery(
		"better plu",
		"docs/plugins/better-plugins-page.md",
		"prefix_metadata",
		"adversarial",
	);
	addQuery(
		"projected token runtime access guide",
		"tech-en/content/en/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"ambiguous_intent",
		"adversarial",
	);
	addQuery(
		"plugin compatibility migration guide",
		"docs/plugins/plugin-upgrade-guide.md",
		"ambiguous_intent",
		"adversarial",
	);
	addQuery(
		"old project aliases map",
		"pkm-en/notes/linking/project-rename-map.md",
		"ambiguous_intent",
		"messy_pkm",
	);
	addQuery(
		"\u65e7\u540d\u522b\u540d \u8fc1\u79fb \u89c4\u5219",
		zhAliasMigrationNotePath,
		"ambiguous_intent",
		"messy_pkm",
	);
	addQuery(
		"\u7535\u5b50\u6280\u672f \u5165\u95e8 \u7535\u8def \u6280\u5de7",
		zhElectronicsIntroPath,
		"ambiguous_intent",
		"adversarial",
	);
	addQuery(
		"better plugin road",
		"docs/plugins/better-plugins-roadmap.md",
		"prefix_metadata",
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
		"tech-zh namespace pod object note",
		"tech-zh/content/zh-cn/docs/concepts/overview/working-with-objects/namespaces.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"tech-zh ingress service guide",
		"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"tech-zh service account token note",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/configure-service-account.md",
		"mixed_script_anchor",
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
		"secret pod data credentials",
		"tech-en/content/en/docs/concepts/configuration/secret.md",
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
		"cache warm start mitigation",
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
		"plugin upgrade guide migration sequencing",
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
		"tech-zh projected service account token note",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"tech-zh projected volume service account note",
		"tech-zh/content/zh-cn/docs/concepts/storage/projected-volumes.md",
		"mixed_script_anchor",
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
		"tech-zh projected volume service account sources",
		"tech-zh/content/zh-cn/docs/concepts/storage/projected-volumes.md",
		"mixed_script_anchor",
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
		"shard checkpoint replay order guide",
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
		"tech-zh secret pod data note",
		"tech-zh/content/zh-cn/docs/concepts/configuration/secret.md",
		"mixed_script_anchor",
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
		"vector cache restore",
		"pkm-en/projects/sdk/vector-cache.md",
		"duplicate_conflict",
		"adversarial",
	);
	addQuery(
		"remember vector cache restore note",
		"pkm-en/projects/sdk/vector-cache.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"looking for sdk cache replay runbook",
		"pkm-en/ops/cache-replay-runbook.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"cache restore checklist after outage note",
		"pkm-en/projects/sdk/cache-restore-checklist.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"project alias canonical wikilink note",
		"pkm-en/notes/linking/project-rename-map.md",
		"mixed_anchor",
		"adversarial",
	);
	addQuery(
		"plugin faq compatibility fallback",
		"docs/releases/plugin-compatibility-faq.md",
		"content_dense",
		"adversarial",
	);
	addQuery(
		"tech-zh projected volume checklist token configmap secret",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-volume-checklist.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"restore flow replay order checkpoint",
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
		"cache outage postmortem follow up",
		"pkm-en/incidents/vector-cache-postmortem.md",
		"partial_memory",
		"messy_pkm",
	);
	addQuery(
		"tech-zh projected token runtime guide",
		"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/projected-service-account-token.md",
		"mixed_script_anchor",
		"adversarial",
	);
	addQuery(
		"pod mounts token and secret together",
		"tech-en/content/en/docs/concepts/storage/projected-volumes.md",
		"body_path_anchor",
		"adversarial",
	);
	addQuery(
		"plugin compatibility matrix supported versions",
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
		"release faq compatibility fallback",
		"docs/releases/plugin-compatibility-faq.md",
		"content_dense",
		"adversarial",
	);

	function buildMixedMarkdownTail(document: IndexedDocument): string {
	const pathHint = document.path.split("/").slice(-2).join("/");
	if (document.path.includes("docs/")) {
		return `- \u4e2d\u6587\u8865\u5145\n  - \u573a\u666f: release / compatibility / upgrade\n  - path hint: ${pathHint}\n  - shared anchors: plugin compatibility rollout migration`;
	}
	if (document.path.includes("tech-")) {
		return `- \u4e2d\u6587\u8865\u5145\n  - \u573a\u666f: tech docs / pod / config / credentials\n  - path hint: ${pathHint}\n  - shared anchors: pod configmap secret token`;
	}
	if (document.path.includes("links/")) {
		return `- \u4e2d\u6587\u8865\u5145\n  - \u573a\u666f: old names / alias / wikilink migration\n  - path hint: ${pathHint}\n  - shared anchors: alias migration old-project`;
	}
	if (document.path.includes("incident") || document.path.includes("retro")) {
		return `- \u4e2d\u6587\u8865\u5145\n  - \u573a\u666f: incident / retrospective / mitigation\n  - path hint: ${pathHint}\n  - shared anchors: incident replay recovery`;
	}
	if (document.path.includes("cache") || document.path.includes("checkpoint")) {
		return `- \u4e2d\u6587\u8865\u5145\n  - \u573a\u666f: cache restore / checkpoint / warmup\n  - path hint: ${pathHint}\n  - shared anchors: cache replay restore`;
	}
	return `- \u4e2d\u6587\u8865\u5145\n  - \u573a\u666f: general notes\n  - path hint: ${pathHint}\n  - shared anchors: note context summary`;
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

	const rebalancedQueryCases = buildAnchoredLexicalVariants(queryCases);
	validateAutomationCorpusPaths(documents, rebalancedQueryCases);

	return {
		documents,
		queryCases: rebalancedQueryCases,
	};
}

function validateAutomationCorpusPaths(
	documents: readonly IndexedDocument[],
	queryCases: readonly QueryCase[],
): void {
	const documentPathCounts = new Map<string, number>();
	for (const document of documents) {
		documentPathCounts.set(
			document.path,
			(documentPathCounts.get(document.path) ?? 0) + 1,
		);
	}
	const duplicateDocumentPaths = [...documentPathCounts.entries()]
		.filter(([, count]) => count > 1)
		.map(([path]) => path);
	const knownDocumentPaths = new Set(documentPathCounts.keys());
	const missingRelevantPaths = queryCases.filter(
		(queryCase) => !knownDocumentPaths.has(queryCase.relevantPath),
	);
	if (
		duplicateDocumentPaths.length === 0 &&
		missingRelevantPaths.length === 0
	) {
		return;
	}
	const issues: string[] = [];
	if (duplicateDocumentPaths.length > 0) {
		issues.push(
			`duplicate document paths: ${duplicateDocumentPaths.join(", ")}`,
		);
	}
	if (missingRelevantPaths.length > 0) {
		issues.push(
			`query relevantPath values missing from documents: ${missingRelevantPaths
				.map(
					(queryCase) =>
						`${queryCase.relevantPath} <- query "${queryCase.query}" (${queryCase.type}/${queryCase.suite})`,
				)
				.join("; ")}`,
		);
	}
	throw new Error(`[coverage-lexical-automation-corpus] ${issues.join(" | ")}`);
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
		mixed_script_anchor: 80,
		zh_short_identity: 82,
		zh_short_body_vs_basename: 86,
		ambiguous_intent: 88,
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

function buildAnchoredLexicalVariants(seedCases: QueryCase[]): QueryCase[] {
	const invariants = seedCases.filter(
		(queryCase) => queryCase.suite === "coverage_invariants",
	);
	// This variant generator still follows the legacy benchmark shape and should
	// not be read as the final product-intent classification from the 2026-04-09
	// redesign plan.
	const others = seedCases.filter(
		(queryCase) => queryCase.suite !== "coverage_invariants",
	);
	const candidatePool = others.filter(
		(queryCase) =>
			detectQueryLanguageBucket(queryCase.query) === "en" &&
			queryCase.type !== "coverage_guardrail" &&
			queryCase.type !== "quality_guardrail" &&
			queryCase.type !== "tail_guardrail" &&
			queryCase.type !== "locality_guardrail",
	);
	const templates = [
		(query: string) => `\u6211\u8bb0\u5f97 ${query} \u90a3\u7bc7`,
		(query: string) => `\u60f3\u627e ${query} \u90a3\u9875`,
		(query: string) => `${query} \u5728\u54ea\u4e2a note \u91cc`,
		(query: string) => `${query} \u90a3\u4e2a markdown checklist`,
		(query: string) => `frontmatter alias \u63d0\u8fc7 ${query}`,
		(query: string) => `nested list \u91cc\u5199\u7684 ${query}`,
	];
	const prioritized = [...candidatePool].sort((left, right) => {
		const difficultyGap =
			queryDifficultyWeight(right) - queryDifficultyWeight(left);
		if (difficultyGap !== 0) {
			return difficultyGap;
		}
		return left.query.localeCompare(right.query);
	});
	const variants = prioritized.slice(0, 42).map((queryCase, index) => ({
		...queryCase,
		query: templates[index % templates.length](queryCase.query),
	}));

	return [...invariants, ...others, ...variants];
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
			type: "mixed_script_anchor",
			query: "tech-zh configmap pod data note",
			relevantPath: "tech-zh/content/zh-cn/docs/concepts/configuration/configmap.md",
		},
		{
			type: "mixed_script_anchor",
			query: "remember better plu page",
			relevantPath: "docs/plugins/better-plugins-page.md",
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

export function createEngineHarness(
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

function registerBenchmarkFileSnapshotStore(
	documents: readonly IndexedDocument[],
): void {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const currentTexts = new Map<string, string>();
	const indexedTexts = new Map<
		string,
		{
			generation?: number;
			text?: string;
		}
	>();
	const indexedMetadata = new Map<
		string,
		{
			generation?: number;
			aliasesText?: string;
			tagsText?: string;
			headingsText?: string;
		}
	>();
	const lexicalBodyEvidence = new Map<string, unknown>();
	const lexicalHanDocEvidence = new Map<string, unknown>();
	const lexicalHanBodyEvidence = new Map<string, unknown>();
	let lexicalFuzzyRescue: unknown = null;
	let benchmarkPersistedLexicalBytes = 0;

	const buildBenchmarkLexicalDocEvidenceRowId = (locator: {
		shardId?: string;
		shardGeneration?: number;
		docRef: number;
		generation: number;
	}): string => {
		if (locator.shardId != null && locator.shardGeneration != null) {
			return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}`;
		}
		return `${locator.docRef}:${locator.generation}`;
	};

	const buildBenchmarkLexicalBlockEvidenceRowId = (locator: {
		shardId?: string;
		shardGeneration?: number;
		docRef: number;
		generation: number;
		blockOrdinal: number;
	}): string => {
		if (locator.shardId != null && locator.shardGeneration != null) {
			return `${locator.shardId}:${locator.shardGeneration}:${locator.docRef}:${locator.generation}:${locator.blockOrdinal}`;
		}
		return `${locator.docRef}:${locator.generation}:${locator.blockOrdinal}`;
	};

	const recomputePersistedLexicalBytes = () => {
		benchmarkPersistedLexicalBytes =
			estimateBenchmarkValueBytes(
				[...indexedTexts.entries()].map(([path, row]) => ({
					path,
					generation: row.generation,
					text: row.text,
				})),
			) +
			estimateBenchmarkValueBytes(
				[...indexedMetadata.entries()].map(([path, row]) => ({
					path,
					generation: row.generation,
					aliasesText: row.aliasesText,
					tagsText: row.tagsText,
					headingsText: row.headingsText,
				})),
			) +
			estimateBenchmarkValueBytes(lexicalFuzzyRescue) +
			estimateBenchmarkValueBytes([...lexicalBodyEvidence.values()]) +
			estimateBenchmarkValueBytes([...lexicalHanDocEvidence.values()]) +
			estimateBenchmarkValueBytes([...lexicalHanBodyEvidence.values()]);
	};

	for (const document of documents) {
		currentTexts.set(document.path, document.content ?? "");
	}
	container.registerInstance(FileSnapshotStore, {
		readCurrentTexts: async (
			fileOrPaths: ReadonlyArray<string | { path: string }>,
		) => {
			const result = new Map<string, string>();
			for (const fileOrPath of fileOrPaths) {
				const path =
					typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
				const text = currentTexts.get(path);
				if (text !== undefined) {
					result.set(path, text);
				}
			}
			return result;
		},
		publishIndexedTexts: async (
			files: ReadonlyArray<{
				path: string;
				generation?: number;
				text?: string;
			}>,
		) => {
			for (const file of files) {
				indexedTexts.set(file.path, {
					generation: file.generation,
					text: file.text,
				});
			}
			recomputePersistedLexicalBytes();
		},
		readIndexedTexts: async (
			requests: ReadonlyArray<{
				path: string;
				generation?: number;
			}>,
		) => {
			const result = new Map<string, string>();
			for (const request of requests) {
				const row = indexedTexts.get(request.path);
				if (!row) {
					continue;
				}
				if (
					request.generation !== undefined &&
					row.generation !== undefined &&
					row.generation !== request.generation
				) {
					continue;
				}
				if (typeof row.text === "string") {
					result.set(request.path, row.text);
				}
			}
			return result;
		},
		publishIndexedMetadata: async (
			files: ReadonlyArray<{
				path: string;
				generation?: number;
				aliasesText?: string;
				tagsText?: string;
				headingsText?: string;
			}>,
		) => {
			for (const file of files) {
				indexedMetadata.set(file.path, {
					generation: file.generation,
					aliasesText: file.aliasesText,
					tagsText: file.tagsText,
					headingsText: file.headingsText,
				});
			}
			recomputePersistedLexicalBytes();
		},
		readIndexedMetadata: async (
			requests: ReadonlyArray<{
				path: string;
				generation?: number;
			}>,
		) => {
			const result = new Map<
				string,
				{
					aliasesText?: string;
					tagsText?: string;
					headingsText?: string;
				}
			>();
			for (const request of requests) {
				const row = indexedMetadata.get(request.path);
				if (!row) {
					continue;
				}
				if (
					request.generation !== undefined &&
					row.generation !== undefined &&
					row.generation !== request.generation
				) {
					continue;
				}
				result.set(request.path, {
					aliasesText: row.aliasesText,
					tagsText: row.tagsText,
					headingsText: row.headingsText,
				});
			}
			return result;
		},
		publishLexicalFuzzyRescue: async (sidecar: unknown) => {
			lexicalFuzzyRescue = sidecar;
			recomputePersistedLexicalBytes();
		},
		readLexicalFuzzyRescueForLookupKeys: async (
			fuzzyLookupKeys: readonly string[],
		) => {
			const sidecar = lexicalFuzzyRescue as
				| {
						candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey?: ReadonlyMap<
							string,
							unknown
						>;
						fuzzyLookupKeyCount?: number;
				  }
				| null;
			if (sidecar == null) {
				return null;
			}
			const candidates =
				sidecar.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey ??
				new Map<string, unknown>();
			return {
				...sidecar,
				candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: new Map(
					fuzzyLookupKeys.flatMap((fuzzyLookupKey) => {
						const familyIds = candidates.get(fuzzyLookupKey);
						return familyIds == null ? [] : [[fuzzyLookupKey, familyIds] as const];
					}),
				),
				fuzzyLookupKeyCount: fuzzyLookupKeys.filter((fuzzyLookupKey) =>
					candidates.has(fuzzyLookupKey),
				).length,
			};
		},
		readLexicalFuzzyRescue: async () => lexicalFuzzyRescue,
		publishLexicalBodyEvidence: async (
			rows: ReadonlyArray<
				Record<string, unknown> & {
					id: string;
					docRef: number;
					generation: number;
					blockOrdinal: number;
					exactShardLocalFamilySlots?: readonly number[];
					exactTokenPositions?: readonly number[];
					supportShardLocalFamilySlots?: readonly number[];
					familySupportMaskByEntry?: readonly number[];
				}
			>,
		) => {
			for (const row of rows) {
				lexicalBodyEvidence.set(row.id, {
					id: row.id,
					docRef: row.docRef,
					generation: row.generation,
					blockOrdinal: row.blockOrdinal,
					exactShardLocalFamilySlots: [
						...(row.exactShardLocalFamilySlots ?? []),
					],
					exactTokenPositions: [...(row.exactTokenPositions ?? [])],
					supportEntriesByShardLocalFamilySlot: Array.from(
						row.supportShardLocalFamilySlots ?? [],
						(shardLocalFamilySlot, index) => ({
							shardLocalFamilySlot,
							supportMask: row.familySupportMaskByEntry?.[index] ?? 0,
						}),
					),
				});
			}
			recomputePersistedLexicalBytes();
		},
		readLexicalBodyEvidenceForBlocks: async (
			locators: ReadonlyArray<{
				shardId?: string;
				shardGeneration?: number;
				docRef: number;
				generation: number;
				blockOrdinal: number;
			}>,
		) => {
			const result = new Map<string, unknown>();
			for (const locator of locators) {
				const key = buildBenchmarkLexicalBlockEvidenceRowId(locator);
				const row = lexicalBodyEvidence.get(key);
				if (row !== undefined) {
					result.set(key, row);
				}
			}
			return result;
		},
		publishLexicalHanDocEvidence: async (
			rows: ReadonlyArray<
				Record<string, unknown> & {
					id: string;
					docRef: number;
					generation: number;
					identityWitnessMatchKeys?: readonly number[];
					identityWitnessTexts?: readonly string[];
					identityWitnessSourceMaskByDocEntry?: readonly number[];
					routeWitnessMatchKeys?: readonly number[];
					routeWitnessTexts?: readonly string[];
					routeWitnessSourceMaskByDocEntry?: readonly number[];
					headingWitnessMatchKeys?: readonly number[];
					headingWitnessTexts?: readonly string[];
				}
			>,
		) => {
			for (const row of rows) {
				lexicalHanDocEvidence.set(row.id, {
					id: row.id,
					docRef: row.docRef,
					generation: row.generation,
					identityWitnessMatchKeys: [
						...(row.identityWitnessMatchKeys ?? []),
					],
					identityWitnessTexts: [...(row.identityWitnessTexts ?? [])],
					identityWitnessSourceMasks: [
						...(row.identityWitnessSourceMaskByDocEntry ?? []),
					],
					routeWitnessMatchKeys: [...(row.routeWitnessMatchKeys ?? [])],
					routeWitnessTexts: [...(row.routeWitnessTexts ?? [])],
					routeWitnessSourceMasks: [
						...(row.routeWitnessSourceMaskByDocEntry ?? []),
					],
					headingWitnessMatchKeys: [...(row.headingWitnessMatchKeys ?? [])],
					headingWitnessTexts: [...(row.headingWitnessTexts ?? [])],
				});
			}
			recomputePersistedLexicalBytes();
		},
		readLexicalHanDocEvidenceForDocs: async (
			locators: ReadonlyArray<{
				shardId?: string;
				shardGeneration?: number;
				docRef: number;
				generation: number;
			}>,
		) => {
			const result = new Map<string, unknown>();
			for (const locator of locators) {
				const key = buildBenchmarkLexicalDocEvidenceRowId(locator);
				const row = lexicalHanDocEvidence.get(key);
				if (row !== undefined) {
					result.set(key, row);
				}
			}
			return result;
		},
		publishLexicalHanBodyEvidence: async (
			rows: ReadonlyArray<
				Record<string, unknown> & {
					id: string;
					docRef: number;
					generation: number;
					blockOrdinal: number;
					bodyWitnessMatchKeys?: readonly number[];
					bodyWitnessTexts?: readonly string[];
					bodyWitnessStartOffsets?: readonly number[];
				}
			>,
		) => {
			for (const row of rows) {
				lexicalHanBodyEvidence.set(row.id, {
					id: row.id,
					docRef: row.docRef,
					generation: row.generation,
					blockOrdinal: row.blockOrdinal,
					bodyWitnessMatchKeys: [...(row.bodyWitnessMatchKeys ?? [])],
					bodyWitnessTexts: [...(row.bodyWitnessTexts ?? [])],
					bodyWitnessStartOffsets: [
						...(row.bodyWitnessStartOffsets ?? []),
					],
				});
			}
			recomputePersistedLexicalBytes();
		},
		readLexicalHanBodyEvidenceForBlocks: async (
			locators: ReadonlyArray<{
				shardId?: string;
				shardGeneration?: number;
				docRef: number;
				generation: number;
				blockOrdinal: number;
			}>,
		) => {
			const result = new Map<string, unknown>();
			for (const locator of locators) {
				const key = buildBenchmarkLexicalBlockEvidenceRowId(locator);
				const row = lexicalHanBodyEvidence.get(key);
				if (row !== undefined) {
					result.set(key, row);
				}
			}
			return result;
		},
		getBenchmarkPersistedLexicalBytes: () => benchmarkPersistedLexicalBytes,
	} as any);
}

async function withCoverageBodyTokenOffloadEnv<T>(
	enabled: boolean,
	action: () => Promise<T>,
): Promise<T> {
	const previous = process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
	process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = enabled
		? "1"
		: "0";
	try {
		return await action();
	} finally {
		if (previous === undefined) {
			delete process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
		} else {
			process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = previous;
		}
	}
}

type CoverageDisplayPruneExperimentConfig = {
	enabled: boolean;
	tailRatio: number;
	bodyCharWeight: number;
	metadataCharWeight: number;
	tagExactWeight: number;
	tagCharWeight: number;
};

type CoverageSoftEarlyGateExperimentConfig = {
	enabled: boolean;
	ratio: number;
};

const COVERAGE_SOFT_EARLY_GATE_ENV_KEYS = [
	"COVERAGE_LEXICAL_SOFT_EARLY_GATE_ENABLED",
	"COVERAGE_LEXICAL_SOFT_EARLY_GATE_RATIO",
] as const;

const COVERAGE_DISPLAY_PRUNE_ENV_KEYS = [
	"COVERAGE_LEXICAL_DISPLAY_PRUNE_ENABLED",
	"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAIL_RATIO",
	"COVERAGE_LEXICAL_DISPLAY_PRUNE_BODY_CHAR_WEIGHT",
	"COVERAGE_LEXICAL_DISPLAY_PRUNE_METADATA_CHAR_WEIGHT",
	"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_EXACT_WEIGHT",
	"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_CHAR_WEIGHT",
] as const;

function readNumberEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveCoverageDisplayPruneExperimentConfig(): CoverageDisplayPruneExperimentConfig {
	return {
		enabled: true,
		tailRatio: readNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAIL_RATIO",
			readNumberEnv(
				"COVERAGE_LEXICAL_DISPLAY_PRUNE_TOP5_PLUS_RATIO",
				0.8,
			),
		),
		bodyCharWeight: readNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_BODY_CHAR_WEIGHT",
			0.5,
		),
		metadataCharWeight: readNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_METADATA_CHAR_WEIGHT",
			0.5,
		),
		tagExactWeight: readNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_EXACT_WEIGHT",
			0.75,
		),
		tagCharWeight: readNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_CHAR_WEIGHT",
			0.5,
		),
	};
}

function resolveCoverageSoftEarlyGateExperimentConfig(): CoverageSoftEarlyGateExperimentConfig {
	return {
		enabled: true,
		ratio: readNumberEnv("COVERAGE_LEXICAL_SOFT_EARLY_GATE_RATIO", 0.8),
	};
}

async function withCoverageSoftEarlyGateEnv<T>(
	config: CoverageSoftEarlyGateExperimentConfig,
	action: () => Promise<T>,
): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const key of COVERAGE_SOFT_EARLY_GATE_ENV_KEYS) {
		previous.set(key, process.env[key]);
	}
	process.env.COVERAGE_LEXICAL_SOFT_EARLY_GATE_ENABLED = config.enabled
		? "1"
		: "0";
	process.env.COVERAGE_LEXICAL_SOFT_EARLY_GATE_RATIO = String(config.ratio);
	try {
		return await action();
	} finally {
		for (const key of COVERAGE_SOFT_EARLY_GATE_ENV_KEYS) {
			const value = previous.get(key);
			if (value === undefined) {
				delete process.env[key];
				continue;
			}
			process.env[key] = value;
		}
	}
}

async function withCoverageDisplayPruneEnv<T>(
	config: CoverageDisplayPruneExperimentConfig,
	action: () => Promise<T>,
): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const key of COVERAGE_DISPLAY_PRUNE_ENV_KEYS) {
		previous.set(key, process.env[key]);
	}
	process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_ENABLED = config.enabled
		? "1"
		: "0";
	process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_TAIL_RATIO = String(
		config.tailRatio,
	);
	process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_BODY_CHAR_WEIGHT = String(
		config.bodyCharWeight,
	);
	process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_METADATA_CHAR_WEIGHT = String(
		config.metadataCharWeight,
	);
	process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_EXACT_WEIGHT = String(
		config.tagExactWeight,
	);
	process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_CHAR_WEIGHT = String(
		config.tagCharWeight,
	);
	try {
		return await action();
	} finally {
		for (const key of COVERAGE_DISPLAY_PRUNE_ENV_KEYS) {
			const value = previous.get(key);
			if (value === undefined) {
				delete process.env[key];
				continue;
			}
			process.env[key] = value;
		}
	}
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

function buildBenchmarkGateRecord(
	source: Map<QueryType, BenchmarkMetric>,
): Record<BenchmarkGate, BenchmarkGateMetric> {
	const result = {} as Record<BenchmarkGate, BenchmarkGateMetric>;
	for (const gate of BENCHMARK_GATES) {
		const aggregate = createEmptyMetric();
		for (const type of BENCHMARK_GATE_QUERY_TYPES[gate]) {
			const metric = source.get(type) ?? createEmptyMetric();
			aggregate.top1 += metric.top1;
			aggregate.top3 += metric.top3;
			aggregate.top5 += metric.top5;
			aggregate.zeroRate += metric.zeroRate;
			aggregate.count += metric.count;
		}
		const finalized = finalizeMetric(aggregate);
		result[gate] = {
			...finalized,
			objective: computePrimaryObjective(
				finalized.top1,
				finalized.top3,
				finalized.top5,
			),
			types: [...BENCHMARK_GATE_QUERY_TYPES[gate]],
		};
	}
	return result;
}

function estimateIndexBytes(engine: EngineLike): number {
	const benchmarkPersistedLexicalBytes = getBenchmarkPersistedLexicalBytes();
	if (typeof engine.estimateIndexBytes === "function") {
		const estimated = engine.estimateIndexBytes();
		if (typeof estimated === "number" && Number.isFinite(estimated) && estimated > 0) {
			return estimated + benchmarkPersistedLexicalBytes;
		}
	}
	const snapshot = engine.serialize();
	if (!snapshot) {
		return benchmarkPersistedLexicalBytes;
	}
	try {
		return Buffer.byteLength(JSON.stringify(snapshot)) + benchmarkPersistedLexicalBytes;
	} catch {
		return benchmarkPersistedLexicalBytes;
	}
}

export function computeRelativeRatio(
	numerator: number,
	denominator: number,
): number | null {
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		denominator <= 0
	) {
		return null;
	}
	return numerator / denominator;
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

export function computeLanguageMix(documents: IndexedDocument[]): {
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

export function computeQueryLanguageMix(
	queryCases: QueryCase[],
): Record<QueryLanguageBucket, number> {
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

export async function runBenchmark(
	name: string,
	engine: EngineLike,
	documents: IndexedDocument[],
	queryCases: QueryCase[],
	options: {
		includeOffloadDiagnostics?: boolean;
		includeCandidateCascadeDiagnostics?: boolean;
	} = {},
): Promise<{
	summary: BenchmarkSummary;
	outcomes: QueryOutcome[];
	indexTiming: IndexTimingSummary | null;
	phaseTiming: PhaseTimingSummary | null;
}> {
	registerBenchmarkFileSnapshotStore(documents);
	engine.resetBenchmarkIndexTiming?.();
	await engine.addDocuments(documents);
	const indexTiming = engine.getBenchmarkIndexTimingSummary?.() ?? null;
	engine.resetBenchmarkPhaseTiming?.();

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
			offloadDebug: options.includeOffloadDiagnostics
				? (engine.getLastBenchmarkOffloadSearchDebug?.() ?? null)
				: undefined,
			candidateCascadeDebug: options.includeCandidateCascadeDiagnostics
				? (engine.getLastBenchmarkV2CandidateCascadeDebug?.() ?? null)
				: undefined,
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
			byGate: buildBenchmarkGateRecord(typeTotals),
		},
		outcomes,
		indexTiming,
		phaseTiming: engine.getBenchmarkPhaseTimingSummary?.() ?? null,
	};
}

function createCoverageRecallIndex(engine: any) {
	return {
		bodyPostings: engine.bodyPostings,
		bodyCharPostings: engine.bodyCharPostings,
		metadataAliasCharPostings: engine.metadataAliasCharPostings,
		metadataAliasPhrasePostings: engine.metadataAliasPhrasePostings,
		metadataAliasPostings: engine.metadataAliasPostings,
		metadataBasenameCharPostings: engine.metadataBasenameCharPostings,
		metadataBasenamePhrasePostings: engine.metadataBasenamePhrasePostings,
		metadataBasenamePostings: engine.metadataBasenamePostings,
		metadataFolderCharPostings: engine.metadataFolderCharPostings,
		metadataFolderPhrasePostings: engine.metadataFolderPhrasePostings,
		metadataFolderPostings: engine.metadataFolderPostings,
		metadataHeadingPhrasePostings: engine.metadataHeadingPhrasePostings,
		metadataHeadingPostings: engine.metadataHeadingPostings,
		metadataTagCharPostings: engine.metadataTagCharPostings,
		metadataTagFullPostings: engine.metadataTagFullPostings,
		metadataTagPhrasePostings: engine.metadataTagPhrasePostings,
		metadataTagPostings: engine.metadataTagPostings,
		sortedLexicon: engine.sortedLexicon,
		documentIdByPath: engine.documentIdByPath,
		documentPathById: engine.documentPathById,
		getDocumentBodyTokens: (docId: number) =>
			engine.getDocumentBodyTokens(docId) ?? [],
		documentBodyHanSegmentsById: engine.documentBodyHanSegmentsById,
		documentTagValuesById: engine.documentTagValuesById,
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
	laneCandidateHitCounts: Record<string, number>;
	laneHitCounts: Record<string, number>;
	lanePrefilterHitCounts: Record<string, number>;
	lanePrefilterDropCounts: Record<string, number>;
	laneAdmitDropCounts: Record<string, number>;
	queryKindCounts: Record<string, number>;
	queryKindAverageLaneCount: Record<string, number>;
	relaxedHybridAnalysis: RelaxedHybridAnalysis;
	misses: Array<{
		query: string;
		type: RecallContractType;
		relevantPath: string;
		queryKind: string;
		hardAnchors: string[];
		decisiveBodies: string[];
		lanes: Array<{
			laneName: string;
			candidateCount: number;
			prefilterCount: number;
			admittedCount: number;
			relevantCandidate: boolean;
			relevantInPrefilter: boolean;
			relevantAdmitted: boolean;
		}>;
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
	const laneCandidateHitCounts: Record<string, number> = {};
	const laneHitCounts: Record<string, number> = {};
	const lanePrefilterHitCounts: Record<string, number> = {};
	const lanePrefilterDropCounts: Record<string, number> = {};
	const laneAdmitDropCounts: Record<string, number> = {};
	const queryKindCounts: Record<string, number> = {};
	const queryKindLaneTotals: Record<string, number> = {};
	const relaxedHybridByQueryKind: Record<
		string,
		RelaxedHybridByQueryKindMetric
	> = {};
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
		lanes: Array<{
			laneName: string;
			candidateCount: number;
			prefilterCount: number;
			admittedCount: number;
			relevantCandidate: boolean;
			relevantInPrefilter: boolean;
			relevantAdmitted: boolean;
		}>;
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
		const explainedQueryKind = plan.explain.queryKind;
		queryKindCounts[explainedQueryKind] =
			(queryKindCounts[explainedQueryKind] ?? 0) + 1;
		queryKindLaneTotals[explainedQueryKind] =
			(queryKindLaneTotals[explainedQueryKind] ?? 0) + debug.lanes.length;
		const relaxedStats =
			relaxedHybridByQueryKind[explainedQueryKind] ??
			(relaxedHybridByQueryKind[explainedQueryKind] = {
				queryCount: 0,
				laneRanCount: 0,
				relevantCandidateHits: 0,
				relevantPrefilterHits: 0,
				relevantAdmittedHits: 0,
				overlapCandidateWithStrictHybrid: 0,
				overlapCandidateWithLocalBody: 0,
				overlapAdmittedWithStrictHybrid: 0,
				overlapAdmittedWithLocalBody: 0,
				exclusiveCandidateHits: 0,
				exclusiveAdmittedHits: 0,
			});
		relaxedStats.queryCount += 1;
		const laneByName = new Map(
			debug.lanes.map((lane) => [lane.laneName, lane] as const),
		);
		const relaxedLane = laneByName.get("relaxed_hybrid_lane");
		const strictHybridLane = laneByName.get("strict_hybrid_lane");
		const localBodyLane = laneByName.get("local_body_lane");
		if (relaxedLane) {
			relaxedStats.laneRanCount += 1;
			const relaxedRelevantCandidate = relaxedLane.candidatePaths.includes(
				queryCase.relevantPath,
			);
			const relaxedRelevantPrefilter = relaxedLane.prefilteredPaths.includes(
				queryCase.relevantPath,
			);
			const relaxedRelevantAdmitted = relaxedLane.admittedPaths.includes(
				queryCase.relevantPath,
			);
			const strictRelevantCandidate =
				strictHybridLane?.candidatePaths.includes(queryCase.relevantPath) ?? false;
			const strictRelevantAdmitted =
				strictHybridLane?.admittedPaths.includes(queryCase.relevantPath) ?? false;
			const localRelevantCandidate =
				localBodyLane?.candidatePaths.includes(queryCase.relevantPath) ?? false;
			const localRelevantAdmitted =
				localBodyLane?.admittedPaths.includes(queryCase.relevantPath) ?? false;
			if (relaxedRelevantCandidate) {
				relaxedStats.relevantCandidateHits += 1;
				if (strictRelevantCandidate) {
					relaxedStats.overlapCandidateWithStrictHybrid += 1;
				}
				if (localRelevantCandidate) {
					relaxedStats.overlapCandidateWithLocalBody += 1;
				}
				if (!strictRelevantCandidate && !localRelevantCandidate) {
					relaxedStats.exclusiveCandidateHits += 1;
				}
			}
			if (relaxedRelevantPrefilter) {
				relaxedStats.relevantPrefilterHits += 1;
			}
			if (relaxedRelevantAdmitted) {
				relaxedStats.relevantAdmittedHits += 1;
				if (strictRelevantAdmitted) {
					relaxedStats.overlapAdmittedWithStrictHybrid += 1;
				}
				if (localRelevantAdmitted) {
					relaxedStats.overlapAdmittedWithLocalBody += 1;
				}
				if (!strictRelevantAdmitted && !localRelevantAdmitted) {
					relaxedStats.exclusiveAdmittedHits += 1;
				}
			}
		}
		const hit = candidates.has(queryCase.relevantPath);
		if (hit) {
			unionHits += 1;
		}
		for (const lane of debug.lanes) {
			const relevantCandidate = lane.candidatePaths.includes(queryCase.relevantPath);
			const relevantInPrefilter = lane.prefilteredPaths.includes(
				queryCase.relevantPath,
			);
			const relevantAdmitted = lane.admittedPaths.includes(queryCase.relevantPath);
			if (relevantCandidate) {
				laneCandidateHitCounts[lane.laneName] =
					(laneCandidateHitCounts[lane.laneName] ?? 0) + 1;
			}
			if (relevantInPrefilter) {
				lanePrefilterHitCounts[lane.laneName] =
					(lanePrefilterHitCounts[lane.laneName] ?? 0) + 1;
			}
			if (relevantCandidate && !relevantInPrefilter) {
				lanePrefilterDropCounts[lane.laneName] =
					(lanePrefilterDropCounts[lane.laneName] ?? 0) + 1;
			}
			if (relevantAdmitted) {
				laneHitCounts[lane.laneName] = (laneHitCounts[lane.laneName] ?? 0) + 1;
			}
			if (relevantInPrefilter && !relevantAdmitted) {
				laneAdmitDropCounts[lane.laneName] =
					(laneAdmitDropCounts[lane.laneName] ?? 0) + 1;
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
				queryKind: plan.explain.queryKind,
				hardAnchors: plan.hardAnchorFamilies.map((family: { normalizedTerm: string }) => family.normalizedTerm),
				decisiveBodies: plan.decisiveBodyFamilies.map((family: { normalizedTerm: string }) => family.normalizedTerm),
				lanes: debug.lanes.map((lane: {
					laneName: string;
					candidateCount: number;
					candidatePaths: string[];
					prefilterCount: number;
					admittedCount: number;
					prefilteredPaths: string[];
					admittedPaths: string[];
				}) => ({
					laneName: lane.laneName,
					candidateCount: lane.candidateCount,
					prefilterCount: lane.prefilterCount,
					admittedCount: lane.admittedCount,
					relevantCandidate: lane.candidatePaths.includes(
						queryCase.relevantPath,
					),
					relevantInPrefilter: lane.prefilteredPaths.includes(
						queryCase.relevantPath,
					),
					relevantAdmitted: lane.admittedPaths.includes(
						queryCase.relevantPath,
					),
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
		laneCandidateHitCounts,
		laneHitCounts,
		lanePrefilterHitCounts,
		lanePrefilterDropCounts,
		laneAdmitDropCounts,
		queryKindCounts,
		queryKindAverageLaneCount: Object.fromEntries(
			Object.entries(queryKindCounts).map(([queryKind, count]) => [
				queryKind,
				round((queryKindLaneTotals[queryKind] ?? 0) / Math.max(1, count)),
			]),
		),
		relaxedHybridAnalysis: {
			byQueryKind: relaxedHybridByQueryKind,
		},
		misses,
	};
}

async function runCoverageLaneStudy(
	engine: any,
	tokenizer: MockTokenizer,
	queryCases: QueryCase[],
): Promise<{
	queryKindCounts: Record<string, number>;
	queryKindAverageLaneCount: Record<string, number>;
	relaxedHybridAnalysis: RelaxedHybridAnalysis;
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
	const queryKindCounts: Record<string, number> = {};
	const queryKindLaneTotals: Record<string, number> = {};
	const relaxedHybridByQueryKind: Record<
		string,
		RelaxedHybridByQueryKindMetric
	> = {};

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
		const { debug } = collectCoverageLexicalCandidateStatesWithDebug(
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
		const explainedQueryKind = plan.explain.queryKind;
		queryKindCounts[explainedQueryKind] =
			(queryKindCounts[explainedQueryKind] ?? 0) + 1;
		queryKindLaneTotals[explainedQueryKind] =
			(queryKindLaneTotals[explainedQueryKind] ?? 0) + debug.lanes.length;
		const relaxedStats =
			relaxedHybridByQueryKind[explainedQueryKind] ??
			(relaxedHybridByQueryKind[explainedQueryKind] = {
				queryCount: 0,
				laneRanCount: 0,
				relevantCandidateHits: 0,
				relevantPrefilterHits: 0,
				relevantAdmittedHits: 0,
				overlapCandidateWithStrictHybrid: 0,
				overlapCandidateWithLocalBody: 0,
				overlapAdmittedWithStrictHybrid: 0,
				overlapAdmittedWithLocalBody: 0,
				exclusiveCandidateHits: 0,
				exclusiveAdmittedHits: 0,
			});
		relaxedStats.queryCount += 1;
		const laneByName = new Map(
			debug.lanes.map((lane) => [lane.laneName, lane] as const),
		);
		const relaxedLane = laneByName.get("relaxed_hybrid_lane");
		const strictHybridLane = laneByName.get("strict_hybrid_lane");
		const localBodyLane = laneByName.get("local_body_lane");
		if (!relaxedLane) {
			continue;
		}
		relaxedStats.laneRanCount += 1;
		const relaxedRelevantCandidate = relaxedLane.candidatePaths.includes(
			queryCase.relevantPath,
		);
		const relaxedRelevantPrefilter = relaxedLane.prefilteredPaths.includes(
			queryCase.relevantPath,
		);
		const relaxedRelevantAdmitted = relaxedLane.admittedPaths.includes(
			queryCase.relevantPath,
		);
		const strictRelevantCandidate =
			strictHybridLane?.candidatePaths.includes(queryCase.relevantPath) ?? false;
		const strictRelevantAdmitted =
			strictHybridLane?.admittedPaths.includes(queryCase.relevantPath) ?? false;
		const localRelevantCandidate =
			localBodyLane?.candidatePaths.includes(queryCase.relevantPath) ?? false;
		const localRelevantAdmitted =
			localBodyLane?.admittedPaths.includes(queryCase.relevantPath) ?? false;
		if (relaxedRelevantCandidate) {
			relaxedStats.relevantCandidateHits += 1;
			if (strictRelevantCandidate) {
				relaxedStats.overlapCandidateWithStrictHybrid += 1;
			}
			if (localRelevantCandidate) {
				relaxedStats.overlapCandidateWithLocalBody += 1;
			}
			if (!strictRelevantCandidate && !localRelevantCandidate) {
				relaxedStats.exclusiveCandidateHits += 1;
			}
		}
		if (relaxedRelevantPrefilter) {
			relaxedStats.relevantPrefilterHits += 1;
		}
		if (relaxedRelevantAdmitted) {
			relaxedStats.relevantAdmittedHits += 1;
			if (strictRelevantAdmitted) {
				relaxedStats.overlapAdmittedWithStrictHybrid += 1;
			}
			if (localRelevantAdmitted) {
				relaxedStats.overlapAdmittedWithLocalBody += 1;
			}
			if (!strictRelevantAdmitted && !localRelevantAdmitted) {
				relaxedStats.exclusiveAdmittedHits += 1;
			}
		}
	}

	return {
		queryKindCounts,
		queryKindAverageLaneCount: Object.fromEntries(
			Object.entries(queryKindCounts).map(([queryKind, count]) => [
				queryKind,
				round((queryKindLaneTotals[queryKind] ?? 0) / Math.max(1, count)),
			]),
		),
		relaxedHybridAnalysis: {
			byQueryKind: relaxedHybridByQueryKind,
		},
	};
}

function summarizeLaneGuardrails(recallContract: {
	laneCandidateHitCounts: Record<string, number>;
	lanePrefilterHitCounts: Record<string, number>;
	laneHitCounts: Record<string, number>;
	lanePrefilterDropCounts: Record<string, number>;
	laneAdmitDropCounts: Record<string, number>;
}) {
	const laneNames = new Set([
		...Object.keys(recallContract.laneCandidateHitCounts),
		...Object.keys(recallContract.lanePrefilterHitCounts),
		...Object.keys(recallContract.laneHitCounts),
		...Object.keys(recallContract.lanePrefilterDropCounts),
		...Object.keys(recallContract.laneAdmitDropCounts),
	]);
	return Object.fromEntries(
		Array.from(laneNames)
			.sort((left, right) => left.localeCompare(right))
			.map((laneName) => {
				const candidateHits = recallContract.laneCandidateHitCounts[laneName] ?? 0;
				const prefilterHits = recallContract.lanePrefilterHitCounts[laneName] ?? 0;
				const admittedHits = recallContract.laneHitCounts[laneName] ?? 0;
				const droppedBeforePrefilter =
					recallContract.lanePrefilterDropCounts[laneName] ?? 0;
				const droppedAfterPrefilter =
					recallContract.laneAdmitDropCounts[laneName] ?? 0;
				return [
					laneName,
					{
						relevantCandidateHits: candidateHits,
						relevantPrefilterHits: prefilterHits,
						relevantAdmittedHits: admittedHits,
						candidateToPrefilterSurvivalRate: round(
							candidateHits === 0 ? 1 : prefilterHits / candidateHits,
						),
						prefilterToAdmitSurvivalRate: round(
							prefilterHits === 0 ? 1 : admittedHits / prefilterHits,
						),
						droppedBeforePrefilter,
						droppedAfterPrefilter,
					},
				] as const;
			}),
	);
}

function summarizeRelaxedHybridAnalysis(recallContract: {
	relaxedHybridAnalysis: {
		byQueryKind: Record<
			string,
			{
				queryCount: number;
				laneRanCount: number;
				relevantCandidateHits: number;
				relevantPrefilterHits: number;
				relevantAdmittedHits: number;
				overlapCandidateWithStrictHybrid: number;
				overlapCandidateWithLocalBody: number;
				overlapAdmittedWithStrictHybrid: number;
				overlapAdmittedWithLocalBody: number;
				exclusiveCandidateHits: number;
				exclusiveAdmittedHits: number;
			}
		>;
	};
}) {
	return Object.fromEntries(
		Object.entries(recallContract.relaxedHybridAnalysis.byQueryKind)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([queryKind, metric]) => [
				queryKind,
				{
					queryCount: metric.queryCount,
					laneRanCount: metric.laneRanCount,
					laneRunRate: round(
						metric.laneRanCount / Math.max(1, metric.queryCount),
					),
					relevantCandidateHits: metric.relevantCandidateHits,
					relevantPrefilterHits: metric.relevantPrefilterHits,
					relevantAdmittedHits: metric.relevantAdmittedHits,
					candidateHitRateWhenLaneRuns: round(
						metric.relevantCandidateHits / Math.max(1, metric.laneRanCount),
					),
					admittedHitRateWhenLaneRuns: round(
						metric.relevantAdmittedHits / Math.max(1, metric.laneRanCount),
					),
					overlapCandidateWithStrictHybrid:
						metric.overlapCandidateWithStrictHybrid,
					overlapCandidateWithLocalBody: metric.overlapCandidateWithLocalBody,
					overlapAdmittedWithStrictHybrid:
						metric.overlapAdmittedWithStrictHybrid,
					overlapAdmittedWithLocalBody:
						metric.overlapAdmittedWithLocalBody,
					exclusiveCandidateHits: metric.exclusiveCandidateHits,
					exclusiveAdmittedHits: metric.exclusiveAdmittedHits,
				},
			]),
	);
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

function summarizeOffloadDiagnostics(
	outcomes: QueryOutcome[],
	limit = 12,
): Array<{
	query: string;
	type: QueryType;
	relevantPath: string;
	rank: number;
	top5: string[];
	offload: {
		candidateCount: number;
		stagedHydration: boolean;
		relevantDoc: CoverageLexicalBenchmarkOffloadDocDebug | null;
		hydratedDocCount: number;
		localWindowDocCount: number;
		unresolvedDocCount: number;
		cheapCoarseTopPaths: string[];
		finalTopPaths: string[];
	};
}> {
	return outcomes
		.map((outcome) => {
			const debug = outcome.offloadDebug;
			if (!debug) {
				return null;
			}
			const relevantDoc =
				debug.docs.find((doc) => doc.path === outcome.relevantPath) ?? null;
			const unresolvedDocCount = debug.docs.filter(
				(doc) =>
					doc.unresolvedBodyEvidence.needsPassageSignal ||
					doc.unresolvedBodyEvidence.hasUnverifiedPhraseWitness ||
					doc.unresolvedBodyEvidence.hasUnresolvedPrefixSurface ||
					doc.unresolvedBodyEvidence.hasUnresolvedBodyCharVerification ||
					doc.unresolvedBodyEvidence.unresolvedFamilyCount > 0 ||
					doc.unresolvedBodyEvidence.unresolvedWeightUpperBound > 0,
			).length;
			const shouldInclude =
				outcome.rank !== 1 ||
				(relevantDoc !== null &&
					(relevantDoc.unresolvedBodyEvidence.needsPassageSignal ||
						relevantDoc.unresolvedBodyEvidence.hasUnverifiedPhraseWitness ||
						relevantDoc.unresolvedBodyEvidence.hasUnresolvedPrefixSurface ||
						relevantDoc.unresolvedBodyEvidence.hasUnresolvedBodyCharVerification ||
						!relevantDoc.hydratedAtCoarse));
			if (!shouldInclude) {
				return null;
			}
			const docPathById = new Map(
				debug.docs
					.filter((doc) => doc.path !== null)
					.map((doc) => [doc.docId, doc.path!] as const),
			);
			return {
				query: outcome.query,
				type: outcome.type,
				relevantPath: outcome.relevantPath,
				rank: outcome.rank,
				top5: outcome.results,
				offload: {
					candidateCount: debug.candidateCount,
					stagedHydration: debug.stagedHydration,
					relevantDoc,
					hydratedDocCount: debug.coarseHydrationDocIds.length,
					localWindowDocCount: debug.localWindowDocIds.length,
					unresolvedDocCount,
					cheapCoarseTopPaths: debug.cheapCoarseTopDocIds
						.map((docId) => docPathById.get(docId) ?? `#${docId}`)
						.slice(0, 5),
					rankedTopPaths: debug.rankedTopDocIds
						.map((docId) => docPathById.get(docId) ?? `#${docId}`)
						.slice(0, 5),
					returnedTopPaths: debug.returnedTopDocIds
						.map((docId) => docPathById.get(docId) ?? `#${docId}`)
						.slice(0, 5),
				},
			};
		})
		.filter(
			(item): item is {
				query: string;
				type: QueryType;
				relevantPath: string;
				rank: number;
				top5: string[];
				offload: {
					candidateCount: number;
					stagedHydration: boolean;
					relevantDoc: CoverageLexicalBenchmarkOffloadDocDebug | null;
					hydratedDocCount: number;
					localWindowDocCount: number;
					unresolvedDocCount: number;
					cheapCoarseTopPaths: string[];
					finalTopPaths: string[];
				};
			} => item !== null,
		)
		.sort((left, right) => {
			const leftRank = left.rank === 0 ? Number.POSITIVE_INFINITY : left.rank;
			const rightRank = right.rank === 0 ? Number.POSITIVE_INFINITY : right.rank;
			return rightRank === leftRank
				? left.query.localeCompare(right.query)
				: rightRank - leftRank;
		})
		.slice(0, limit);
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

function summarizeResultListDifferences(
	leftOutcomes: QueryOutcome[],
	rightOutcomes: QueryOutcome[],
	limit = 12,
): {
	changedQueryCount: number;
	rankChangedQueryCount: number;
	top1ChangedQueryCount: number;
	onlyTailChangedQueryCount: number;
	byType: Partial<Record<QueryType, number>>;
	bySuite: Partial<Record<BenchmarkSuite, number>>;
	topChanges: Array<{
		query: string;
		type: QueryType;
		suite: BenchmarkSuite;
		relevantPath: string;
		leftRank: number;
		rightRank: number;
		leftTop5: string[];
		rightTop5: string[];
	}>;
} {
	const changes: Array<{
		query: string;
		type: QueryType;
		suite: BenchmarkSuite;
		relevantPath: string;
		leftRank: number;
		rightRank: number;
		leftTop5: string[];
		rightTop5: string[];
	}> = [];
	const byType = new Map<QueryType, number>();
	const bySuite = new Map<BenchmarkSuite, number>();
	let rankChangedQueryCount = 0;
	let top1ChangedQueryCount = 0;
	let onlyTailChangedQueryCount = 0;

	for (let index = 0; index < leftOutcomes.length; index += 1) {
		const left = leftOutcomes[index];
		const right = rightOutcomes[index];
		if (
			left.rank === right.rank &&
			left.results.length === right.results.length &&
			left.results.every((item, resultIndex) => item === right.results[resultIndex])
		) {
			continue;
		}
		changes.push({
			query: left.query,
			type: left.type,
			suite: left.suite,
			relevantPath: left.relevantPath,
			leftRank: left.rank,
			rightRank: right.rank,
			leftTop5: left.results,
			rightTop5: right.results,
		});
		byType.set(left.type, (byType.get(left.type) ?? 0) + 1);
		bySuite.set(left.suite, (bySuite.get(left.suite) ?? 0) + 1);
		if (left.rank !== right.rank) {
			rankChangedQueryCount += 1;
		}
		if (left.hitTop1 !== right.hitTop1) {
			top1ChangedQueryCount += 1;
		}
		if (left.rank === right.rank) {
			onlyTailChangedQueryCount += 1;
		}
	}

	return {
		changedQueryCount: changes.length,
		rankChangedQueryCount,
		top1ChangedQueryCount,
		onlyTailChangedQueryCount,
		byType: Object.fromEntries(
			[...byType.entries()].sort((left, right) =>
				right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1],
			),
		),
		bySuite: Object.fromEntries(
			[...bySuite.entries()].sort((left, right) =>
				right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1],
			),
		),
		topChanges: changes
			.sort((left, right) => {
				const leftRankGap = Math.abs(left.leftRank - left.rightRank);
				const rightRankGap = Math.abs(right.leftRank - right.rightRank);
				if (rightRankGap !== leftRankGap) {
					return rightRankGap - leftRankGap;
				}
				const leftTop5Gap = countTop5Differences(left.leftTop5, left.rightTop5);
				const rightTop5Gap = countTop5Differences(right.leftTop5, right.rightTop5);
				return rightTop5Gap === leftTop5Gap
					? left.query.localeCompare(right.query)
					: rightTop5Gap - leftTop5Gap;
			})
			.slice(0, limit),
	};
}

function countTop5Differences(left: readonly string[], right: readonly string[]): number {
	const maxLength = Math.max(left.length, right.length);
	let differenceCount = 0;
	for (let index = 0; index < maxLength; index += 1) {
		if (left[index] !== right[index]) {
			differenceCount += 1;
		}
	}
	return differenceCount;
}

function summarizePhaseTiming(phaseTiming: PhaseTimingSummary | null) {
	if (!phaseTiming) {
		return null;
	}
	const topHotPhases = phaseTiming.phases.slice(0, 6).map((phase) => ({
		phase: phase.phase,
		totalMs: round(phase.totalMs),
		avgMsPerCall: round(phase.avgMsPerCall),
		avgMsPerUnit: round(phase.avgMsPerUnit),
		maxMs: round(phase.maxMs),
		count: phase.count,
		unitCount: phase.unitCount,
		shareOfMeasuredMs: round(phase.shareOfMeasuredMs),
		shareOfQueryTime: round(phase.shareOfQueryTime),
	}));
	const admission = phaseTiming.phases.find((phase) => phase.phase === "admission");
	const localWindow = phaseTiming.phases.find(
		(phase) => phase.phase === "localWindow",
	);
	const topRecallSubphases = (phaseTiming.recallSubphases ?? [])
		.slice(0, 6)
		.map((phase) => ({
			phase: phase.phase,
			totalMs: round(phase.totalMs),
			avgMsPerCall: round(phase.avgMsPerCall),
			avgMsPerUnit: round(phase.avgMsPerUnit),
			maxMs: round(phase.maxMs),
			count: phase.count,
			unitCount: phase.unitCount,
			shareOfRecallMs: round(phase.shareOfRecallMs),
			shareOfQueryTime: round(phase.shareOfQueryTime),
		}));
	const laneCollectTotal =
		phaseTiming.recallSubphases?.find((phase) => phase.phase === "laneCollect")
			?.totalMs ?? 0;
	const laneCollectBreakdown = (phaseTiming.recallSubphases ?? [])
		.filter((phase) => phase.phase.startsWith("laneCollect:"))
		.slice(0, 8)
		.map((phase) => ({
			phase: phase.phase,
			totalMs: round(phase.totalMs),
			avgMsPerCall: round(phase.avgMsPerCall),
			avgMsPerUnit: round(phase.avgMsPerUnit),
			count: phase.count,
			unitCount: phase.unitCount,
			shareOfLaneCollectMs: round(
				laneCollectTotal <= 0 ? 0 : phase.totalMs / laneCollectTotal,
			),
			shareOfRecallMs: round(phase.shareOfRecallMs),
		}));
	const topLaneEvaluateSubphases = (phaseTiming.laneEvaluateSubphases ?? [])
		.slice(0, 6)
		.map((phase) => ({
			phase: phase.phase,
			totalMs: round(phase.totalMs),
			avgMsPerCall: round(phase.avgMsPerCall),
			avgMsPerUnit: round(phase.avgMsPerUnit),
			maxMs: round(phase.maxMs),
			count: phase.count,
			unitCount: phase.unitCount,
			shareOfLaneEvaluateMs: round(phase.shareOfLaneEvaluateMs),
			shareOfQueryTime: round(phase.shareOfQueryTime),
		}));
	return {
		queryCount: phaseTiming.queryCount,
		queryTotalMs: round(phaseTiming.queryTotalMs),
		totalMeasuredMs: round(phaseTiming.totalMeasuredMs),
		topHotPhases,
		topRecallSubphases,
		laneCollectBreakdown,
		topLaneEvaluateSubphases,
		admissionVsLocalWindow: {
			admissionTotalMs: round(admission?.totalMs ?? 0),
			localWindowTotalMs: round(localWindow?.totalMs ?? 0),
			hotterPhase:
				(admission?.totalMs ?? 0) > (localWindow?.totalMs ?? 0)
					? "admission"
					: (localWindow?.totalMs ?? 0) > (admission?.totalMs ?? 0)
						? "localWindow"
						: "tie",
		},
	};
}

function summarizeIndexTiming(indexTiming: IndexTimingSummary | null) {
	if (!indexTiming) {
		return null;
	}
	return {
		batchCount: indexTiming.batchCount,
		documentCount: indexTiming.documentCount,
		totalMeasuredMs: round(indexTiming.totalMeasuredMs),
		perDocumentMs:
			indexTiming.documentCount > 0
				? round(indexTiming.totalMeasuredMs / indexTiming.documentCount)
				: 0,
		workload: {
			bodyTokenCount: indexTiming.bodyTokenCount,
			exactTermCount: indexTiming.exactTermCount,
			metadataHanBigramCount: indexTiming.metadataHanBigramCount,
			bodyHanSegmentCount: indexTiming.bodyHanSegmentCount,
			bodyHanLogicalBlockCount: indexTiming.bodyHanLogicalBlockCount,
		},
		topHotPhases: indexTiming.phases.slice(0, 6).map((phase) => ({
			phase: phase.phase,
			totalMs: round(phase.totalMs),
			avgMsPerCall: round(phase.avgMsPerCall),
			avgMsPerUnit: round(phase.avgMsPerUnit),
			maxMs: round(phase.maxMs),
			count: phase.count,
			unitCount: phase.unitCount,
			shareOfMeasuredMs: round(phase.shareOfMeasuredMs),
		})),
	};
}

export function round(value: number): number {
	return Number(value.toFixed(3));
}

const COVERAGE_LEXICAL_BENCHMARK_DIAGNOSTIC_NAMES: readonly CoverageLexicalBenchmarkDiagnostic[] =
	[
		"index",
		"timing",
		"recall",
		"lane-study",
		"offload",
		"cascade",
		"wins",
		"disagreements",
		"misses",
		"prune",
	];

function summarizeCoverageLexicalCandidateCascadeDiagnostics(outcomes: QueryOutcome[]): {
	queryCount: number;
	usedFuzzySalvageCount: number;
	usedHanFallbackSalvageCount: number;
	verificationSkippedReasonCounts: Record<string, number>;
	verificationBucketDocCount: { avg: number; p50: number; p100: number; max: number };
	verificationBodyDocCount: { avg: number; p50: number; p100: number; max: number };
	verificationEstimatedBodyTokenSum: { avg: number; p50: number; p100: number; max: number };
	verificationBodyAvailabilityTotals: {
		resident: number;
		hotCache: number;
		coldOrSnapshot: number;
		missing: number;
	};
	topQueriesByEstimatedBodyTokenSum: Array<{
		query: string;
		type: QueryType;
		rank: number;
		verificationBucketDocCount: number;
		verificationBodyDocCount: number;
		verificationEstimatedBodyTokenSum: number;
		verificationSkippedReason: string;
	}>;
} {
	const entries = outcomes
		.map((outcome) => {
			const debug = outcome.candidateCascadeDebug;
			if (!debug) {
				return null;
			}
			return {
				query: outcome.query,
				type: outcome.type,
				rank: outcome.rank,
				usedFuzzySalvage: debug.usedFuzzySalvage,
				usedHanFallbackSalvage: debug.usedHanFallbackSalvage,
				verificationSkippedReason: debug.verificationSkippedReason,
				verificationBucketDocCount: debug.verificationBucketDocCount,
				verificationBodyDocCount: debug.verificationBodyDocCount,
				verificationEstimatedBodyTokenSum:
					debug.verificationEstimatedBodyTokenSum,
				verificationBodyAvailability: debug.verificationBodyAvailability,
			};
		})
		.filter(
			(entry): entry is NonNullable<typeof entry> => entry !== null,
		);
	const summarizeNumericSeries = (values: readonly number[]) => ({
		avg:
			values.length > 0
				? values.reduce((sum, value) => sum + value, 0) / values.length
				: 0,
		p50: values.length > 0 ? percentile([...values], 0.5) : 0,
		p100: values.length > 0 ? Math.max(...values) : 0,
		max: values.length > 0 ? Math.max(...values) : 0,
	});
	return {
		queryCount: entries.length,
		usedFuzzySalvageCount: entries.filter((entry) => entry.usedFuzzySalvage).length,
		usedHanFallbackSalvageCount: entries.filter((entry) => entry.usedHanFallbackSalvage).length,
		verificationSkippedReasonCounts: entries.reduce<Record<string, number>>((counts, entry) => {
			counts[entry.verificationSkippedReason] =
				(counts[entry.verificationSkippedReason] ?? 0) + 1;
			return counts;
		}, {}),
		verificationBucketDocCount: summarizeNumericSeries(
			entries.map((entry) => entry.verificationBucketDocCount),
		),
		verificationBodyDocCount: summarizeNumericSeries(
			entries.map((entry) => entry.verificationBodyDocCount),
		),
		verificationEstimatedBodyTokenSum: summarizeNumericSeries(
			entries.map((entry) => entry.verificationEstimatedBodyTokenSum),
		),
		verificationBodyAvailabilityTotals: entries.reduce(
			(summary, entry) => {
				summary.resident += entry.verificationBodyAvailability.resident;
				summary.hotCache += entry.verificationBodyAvailability.hotCache;
				summary.coldOrSnapshot += entry.verificationBodyAvailability.coldOrSnapshot;
				summary.missing += entry.verificationBodyAvailability.missing;
				return summary;
			},
			{ resident: 0, hotCache: 0, coldOrSnapshot: 0, missing: 0 },
		),
		topQueriesByEstimatedBodyTokenSum: [...entries]
			.sort(
				(left, right) =>
					right.verificationEstimatedBodyTokenSum - left.verificationEstimatedBodyTokenSum ||
					right.verificationBodyDocCount - left.verificationBodyDocCount ||
					left.query.localeCompare(right.query),
			)
			.slice(0, 10)
			.map((entry) => ({
				query: entry.query,
				type: entry.type,
				rank: entry.rank,
				verificationBucketDocCount: entry.verificationBucketDocCount,
				verificationBodyDocCount: entry.verificationBodyDocCount,
				verificationEstimatedBodyTokenSum: entry.verificationEstimatedBodyTokenSum,
				verificationSkippedReason: entry.verificationSkippedReason,
			})),
	};
}

function resolveCoverageLexicalBenchmarkDiagnostics(): ReadonlySet<CoverageLexicalBenchmarkDiagnostic> {
	const raw = process.env.COVERAGE_LEXICAL_BENCH_DIAGNOSTICS?.trim();
	if (!raw || raw.length === 0) {
		return new Set();
	}
	const parts = raw
		.split(/[\s,]+/u)
		.map((part) => part.trim().toLowerCase())
		.filter((part) => part.length > 0);
	const selected = new Set<CoverageLexicalBenchmarkDiagnostic>();
	for (const part of parts) {
		if (part === "default") {
			continue;
		}
		if (part === "none") {
			selected.clear();
			continue;
		}
		if (part === "all") {
			for (const name of COVERAGE_LEXICAL_BENCHMARK_DIAGNOSTIC_NAMES) {
				selected.add(name);
			}
			continue;
		}
		if (
			COVERAGE_LEXICAL_BENCHMARK_DIAGNOSTIC_NAMES.includes(
				part as CoverageLexicalBenchmarkDiagnostic,
			)
		) {
			selected.add(part as CoverageLexicalBenchmarkDiagnostic);
		}
	}
	return selected;
}

function shouldPrintCoverageLexicalBenchmarkDiagnostic(
	selected: ReadonlySet<CoverageLexicalBenchmarkDiagnostic>,
	diagnostic: CoverageLexicalBenchmarkDiagnostic,
): boolean {
	return selected.has(diagnostic);
}
