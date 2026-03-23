import fs from "fs";
import path from "path";

const DEFAULT_FILES_PER_CONCEPT = 14;
const DEFAULT_TOP_K = 10;
const DEFAULT_RECALL_LIMIT = 20;
const DEFAULT_RUNS = 1;
const DEFAULT_TARGET_LIBRARY_MB = 200;
const DEFAULT_DIFFICULTY = "normal";
const DEFAULT_SUITE_PROFILE = "daily";
const DEFAULT_DENSE_BACKEND = "hnsw";
const DEFAULT_SIZE_SWEEP_MBS = [50, 120, 300];
const OVERLAP_CUTOFFS = [5, 10, 15];
const RERANK_OVERLAP_TOP_K = 5;
const DEFAULT_BUDGET_COMPARE_NAMES = [
	"current-20x30-prox",
	"current-20x30-plain",
	"current-25x25-plain",
	"current-25x25-plain-variants",
	"entry-aware-fallback-dense-current-plain",
	"entry-aware-dense-max-current-plain",
	"entry-aware-direct-balanced-current-plain",
];
const VECTOR_DIM = 48;
const RRF_K = 60;
const MIN_SCORE_SPREAD = 0.05;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const BM25_POSITION_BUCKET_SIZE = 4;
const BM25_MAX_POSITIONS_PER_TERM = 8;
const BM25_PROXIMITY_MAX_SCORE_RATIO = 0.22;
const BM25_PROXIMITY_SPAN_WEIGHT = 0.11;
const BM25_PROXIMITY_ORDER_WEIGHT = 0.05;
const BM25_PROXIMITY_ADJACENT_WEIGHT = 0.04;
const BM25_PROXIMITY_COMPACT_WEIGHT = 0.02;
const BENCH_HNSW_M = 16;
const BENCH_HNSW_EF_CONSTRUCTION = 100;
const BENCH_HNSW_EF = 40;

const stopWords = new Set([
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
	"how",
	"when",
	"what",
	"where",
	"which",
	"tool",
	"plugin",
	"note",
	"notes",
	"obsidian",
]);

const ROLE_SEQUENCE = ["exact", "semantic", "mixed", "distractor"];
const SHARED_TOKENS = [
	"workflow",
	"plugin",
	"vault",
	"system",
	"notes",
	"project",
	"process",
	"review",
	"setup",
	"guide",
	"method",
	"workspace",
	"index",
	"organize",
	"capture",
	"search",
];
const NOISE_TOPICS = [
	["daily", "weekly", "journal", "planner", "habit", "routine"],
	["research", "paper", "draft", "summary", "reading", "source"],
	["task", "project", "milestone", "backlog", "status", "priority"],
	["diagram", "visual", "canvas", "graph", "cards", "layout"],
	["metadata", "properties", "field", "query", "filter", "table"],
	["sync", "backup", "history", "version", "repository", "change"],
];

const DIFFICULTY_PROFILES = {
	normal: {
		name: "normal",
		negativeTargetLexicalLeak: 0,
		negativeTargetSemanticLeak: 0,
		negativeSharedBoost: 0,
		negativeVectorTargetHints: 0,
		adversarialFilesPerConcept: 0,
		adversarialLexicalRepeat: 0,
		adversarialSemanticRepeat: 0,
		adversarialSharedRepeat: 0,
	},
	hard: {
		name: "hard",
		negativeTargetLexicalLeak: 6,
		negativeTargetSemanticLeak: 8,
		negativeSharedBoost: 8,
		negativeVectorTargetHints: 2,
		adversarialFilesPerConcept: 12,
		adversarialLexicalRepeat: 20,
		adversarialSemanticRepeat: 24,
		adversarialSharedRepeat: 14,
	},
};

const concepts = [
	{
		id: "calendar",
		title: "Full Calendar",
		folder: "planning",
		lexical: ["calendar", "event", "events", "meeting", "schedule", "agenda"],
		semantic: ["planning", "timeline", "booking", "monthly", "weekly", "appointments"],
		queries: [
			{ text: "full calendar event schedule", family: "lexical" },
			{ text: "calendar monthly planning board", family: "phrase" },
			{
				text: "tool for planning meetings on a monthly board",
				family: "semantic",
				semanticHints: ["calendar"],
			},
			{
				text: "agenda booking timeline for notes",
				family: "mixed",
				semanticHints: ["calendar"],
			},
		],
	},
	{
		id: "dataview",
		title: "Dataview",
		folder: "querying",
		lexical: ["dataview", "query", "table", "field", "frontmatter", "inline"],
		semantic: ["metadata", "database", "rows", "properties", "filter", "render"],
		queries: [
			{ text: "dataview query table metadata", family: "lexical" },
			{
				text: "table query over note properties",
				family: "phrase",
				semanticHints: ["dataview"],
			},
			{
				text: "show notes as rows filtered by metadata",
				family: "semantic",
				semanticHints: ["dataview"],
			},
			{
				text: "frontmatter field database view",
				family: "mixed",
				semanticHints: ["dataview"],
			},
		],
	},
	{
		id: "kanban",
		title: "Kanban",
		folder: "tasks",
		lexical: ["kanban", "board", "task", "tasks", "lane", "workflow"],
		semantic: ["pipeline", "backlog", "progress", "columns", "cards", "project"],
		queries: [
			{ text: "kanban task board workflow", family: "lexical" },
			{
				text: "board with backlog doing done lanes",
				family: "phrase",
				semanticHints: ["kanban"],
			},
			{
				text: "visual pipeline for moving project cards across columns",
				family: "semantic",
				semanticHints: ["kanban"],
			},
			{
				text: "task cards progress board",
				family: "mixed",
				semanticHints: ["kanban"],
			},
		],
	},
	{
		id: "zotero",
		title: "Zotero Integration",
		folder: "research",
		lexical: ["zotero", "citation", "citations", "reference", "references", "bibliography"],
		semantic: ["paper", "library", "scholar", "pdf", "highlight", "reading"],
		queries: [
			{ text: "zotero citation bibliography notes", family: "lexical" },
			{
				text: "reference manager pdf highlight workflow",
				family: "phrase",
				semanticHints: ["zotero"],
			},
			{
				text: "sync paper highlights and references into notes",
				family: "semantic",
				semanticHints: ["zotero"],
			},
			{
				text: "academic library citations for markdown notes",
				family: "mixed",
				semanticHints: ["zotero"],
			},
		],
	},
	{
		id: "canvas",
		title: "Canvas",
		folder: "visual",
		lexical: ["canvas", "board", "card", "cards", "edge", "edges"],
		semantic: ["whiteboard", "spatial", "diagram", "connections", "visual", "arrange"],
		queries: [
			{ text: "canvas cards and edges", family: "lexical" },
			{
				text: "visual board with connected cards",
				family: "phrase",
				semanticHints: ["canvas"],
			},
			{
				text: "whiteboard style space for arranging ideas visually",
				family: "semantic",
				semanticHints: ["canvas"],
			},
			{
				text: "spatial diagram of linked notes",
				family: "mixed",
				semanticHints: ["canvas"],
			},
		],
	},
	{
		id: "git",
		title: "Obsidian Git",
		folder: "sync",
		lexical: ["git", "commit", "push", "pull", "branch", "history"],
		semantic: ["version", "backup", "repository", "sync", "changes", "snapshot"],
		queries: [
			{ text: "git commit push backup", family: "lexical" },
			{
				text: "version history sync for vault",
				family: "phrase",
				semanticHints: ["git"],
			},
			{
				text: "save note changes to a repository and restore history",
				family: "semantic",
				semanticHints: ["git"],
			},
			{
				text: "branch based backup workflow",
				family: "mixed",
				semanticHints: ["git"],
			},
		],
	},
	{
		id: "flashcards",
		title: "Spaced Repetition",
		folder: "learning",
		lexical: ["flashcard", "flashcards", "anki", "review", "reviews", "spaced"],
		semantic: ["memory", "recall", "study", "retention", "interval", "quiz"],
		queries: [
			{ text: "flashcards spaced review retention", family: "lexical" },
			{
				text: "study system that schedules recall intervals",
				family: "phrase",
				semanticHints: ["flashcards"],
			},
			{
				text: "tool for memorization with repeated quiz timing",
				family: "semantic",
				semanticHints: ["flashcards"],
			},
			{
				text: "anki style memory review in notes",
				family: "mixed",
				semanticHints: ["flashcards"],
			},
		],
	},
	{
		id: "templates",
		title: "Templater",
		folder: "automation",
		lexical: ["template", "templates", "templater", "snippet", "insert", "boilerplate"],
		semantic: ["automation", "command", "macro", "generate", "prefill", "capture"],
		queries: [
			{ text: "templater template snippet insert", family: "lexical" },
			{
				text: "generate note boilerplate with commands",
				family: "phrase",
				semanticHints: ["templates"],
			},
			{
				text: "automatically prefill note sections when capturing ideas",
				family: "semantic",
				semanticHints: ["templates"],
			},
			{
				text: "macro for new note scaffolding",
				family: "mixed",
				semanticHints: ["templates"],
			},
		],
	},
];

function parseArgs(argv) {
	let hasExplicitTargetLibraryMb = false;
	let hasExplicitDifficulty = false;
	const args = {
		mode: "benchmark",
		filesPerConcept: DEFAULT_FILES_PER_CONCEPT,
		topK: DEFAULT_TOP_K,
		recallLimit: DEFAULT_RECALL_LIMIT,
		runs: DEFAULT_RUNS,
		targetLibraryMb: DEFAULT_TARGET_LIBRARY_MB,
		difficulty: DEFAULT_DIFFICULTY,
		denseBackend: DEFAULT_DENSE_BACKEND,
		queries: "",
		suite: "",
		suiteProfile: DEFAULT_SUITE_PROFILE,
		sizes: DEFAULT_SIZE_SWEEP_MBS,
		seed: 7,
	};
	for (const arg of argv.slice(2)) {
		if (arg.startsWith("--mode=")) {
			args.mode = arg.slice("--mode=".length);
		} else if (arg.startsWith("--files-per-concept=")) {
			args.filesPerConcept =
				Number(arg.slice("--files-per-concept=".length)) || DEFAULT_FILES_PER_CONCEPT;
		} else if (arg.startsWith("--top-k=")) {
			args.topK = Number(arg.slice("--top-k=".length)) || DEFAULT_TOP_K;
		} else if (arg.startsWith("--recall-limit=")) {
			args.recallLimit =
				Number(arg.slice("--recall-limit=".length)) || DEFAULT_RECALL_LIMIT;
		} else if (arg.startsWith("--runs=")) {
			args.runs = Number(arg.slice("--runs=".length)) || DEFAULT_RUNS;
		} else if (arg.startsWith("--target-library-mb=")) {
			hasExplicitTargetLibraryMb = true;
			args.targetLibraryMb =
				Number(arg.slice("--target-library-mb=".length)) || DEFAULT_TARGET_LIBRARY_MB;
		} else if (arg.startsWith("--difficulty=")) {
			hasExplicitDifficulty = true;
			args.difficulty = arg.slice("--difficulty=".length) || DEFAULT_DIFFICULTY;
		} else if (arg.startsWith("--dense-backend=")) {
			const backend = arg.slice("--dense-backend=".length).trim();
			args.denseBackend = backend === "exact" ? "exact" : DEFAULT_DENSE_BACKEND;
		} else if (arg.startsWith("--queries=")) {
			args.queries = arg.slice("--queries=".length);
		} else if (arg.startsWith("--suite=")) {
			args.suite = arg.slice("--suite=".length);
		} else if (arg.startsWith("--suite-profile=")) {
			args.suiteProfile = arg.slice("--suite-profile=".length) || DEFAULT_SUITE_PROFILE;
		} else if (arg.startsWith("--sizes=")) {
			const parsed = arg
				.slice("--sizes=".length)
				.split(",")
				.map((value) => Number(value.trim()))
				.filter((value) => Number.isFinite(value) && value > 0);
			args.sizes = parsed.length > 0 ? parsed : DEFAULT_SIZE_SWEEP_MBS;
		} else if (arg.startsWith("--seed=")) {
			args.seed = Number(arg.slice("--seed=".length)) || 7;
		}
	}
	if (
		!hasExplicitTargetLibraryMb &&
		(args.mode === "regression" ||
			args.mode === "tune-regression" ||
			args.mode === "rerank-source-overlap" ||
			args.mode === "bm25-size")
	) {
		args.targetLibraryMb = 40;
	}
	if (
		!hasExplicitDifficulty &&
		(args.mode === "regression" ||
			args.mode === "tune-regression" ||
			args.mode === "rerank-source-overlap" ||
			args.mode === "budget-compare" ||
			args.mode === "size-sweep")
	) {
		args.difficulty = "hard";
	}
	return args;
}

function resolveDifficultyProfile(name) {
	return DIFFICULTY_PROFILES[name] ?? DIFFICULTY_PROFILES.normal;
}

function resolveSuiteProfile(name) {
	switch (name) {
		case "core":
		case "adversarial":
		case "holdout":
		case "full":
		case "daily":
			return name;
		default:
			return DEFAULT_SUITE_PROFILE;
	}
}

function suiteMatchesProfile(suite, suiteProfile) {
	const tier = suite.tier ?? "core";
	switch (suiteProfile) {
		case "core":
			return tier === "core";
		case "adversarial":
			return tier === "adversarial";
		case "holdout":
			return tier === "holdout";
		case "full":
			return true;
		case "daily":
		default:
			return tier === "core" || tier === "adversarial";
	}
}

function createRng(seed) {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

function sample(rng, items) {
	return items[Math.floor(rng() * items.length)];
}

function shuffle(rng, items) {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function tokenizeSequence(text) {
	const out = [];
	for (const raw of text.toLowerCase().split(/[^a-z0-9_\-]+/g)) {
		if (!raw) continue;
		const part = raw.trim();
		if (!part || part.length < 2 || stopWords.has(part)) continue;
		out.push(part);
		if (part.includes("-") || part.includes("_")) {
			for (const sub of part.split(/[-_]+/g)) {
				if (sub && sub.length > 1 && !stopWords.has(sub)) {
					out.push(sub);
				}
			}
		}
	}
	return out;
}

function tokenize(text) {
	return [...new Set(tokenizeSequence(text))];
}

class BenchmarkBM25Engine {
	constructor({ proximity = true } = {}) {
		this.proximity = proximity;
		this.termDict = new Map();
		this.docLengths = new Map();
		this.totalDocLen = 0;
		this.docCount = 0;
		this.avgDocLen = 0;
	}

	addDocument(docId, text) {
		const terms = tokenizeSequence(text);
		this.addDocumentTerms(docId, terms);
	}

	addDocumentTerms(docId, terms) {
		const dl = terms.length;
		this.docLengths.set(docId, dl);
		this.totalDocLen += dl;
		this.docCount += 1;
		this.avgDocLen = this.totalDocLen / Math.max(1, this.docCount);

		const tfMap = new Map();
		for (let pos = 0; pos < terms.length; pos++) {
			const term = terms[pos];
			const bucketPos = Math.floor(pos / BM25_POSITION_BUCKET_SIZE);
			const entry = tfMap.get(term);
			if (entry) {
				entry.tf += 1;
				if (
					entry.positions.length < BM25_MAX_POSITIONS_PER_TERM &&
					entry.positions[entry.positions.length - 1] !== bucketPos
				) {
					entry.positions.push(bucketPos);
				}
			} else {
				tfMap.set(term, { tf: 1, positions: [bucketPos] });
			}
		}

		for (const [term, { tf, positions }] of tfMap) {
			let dictEntry = this.termDict.get(term);
			if (!dictEntry) {
				dictEntry = { df: 0, postings: [] };
				this.termDict.set(term, dictEntry);
			}
			dictEntry.df += 1;
			dictEntry.postings.push({
				docId,
				tfNorm: computeTfNorm(tf, dl, this.avgDocLen),
				positions,
			});
		}
	}

	search(query, limit) {
		const queryTerms = uniqueTermsInOrder(tokenizeSequence(query));
		if (queryTerms.length === 0) return [];
		const scores = new Map();
		const docPositions = new Map();
		const N = this.docCount;
		for (const term of queryTerms) {
			const entry = this.termDict.get(term);
			if (!entry) continue;
			const idf = Math.log((N - entry.df + 0.5) / (entry.df + 0.5) + 1);
			for (const posting of entry.postings) {
				scores.set(
					posting.docId,
					(scores.get(posting.docId) ?? 0) + posting.tfNorm * idf,
				);
				if (this.proximity && queryTerms.length > 1) {
					let termPos = docPositions.get(posting.docId);
					if (!termPos) {
						termPos = new Map();
						docPositions.set(posting.docId, termPos);
					}
					termPos.set(term, posting.positions);
				}
			}
		}
		if (this.proximity && queryTerms.length > 1) {
			for (const [docId, termPos] of docPositions.entries()) {
				if (termPos.size < 2) continue;
				const baseScore = scores.get(docId) ?? 0;
				if (baseScore <= 0) continue;
				const bonus = computeProximityBonus(termPos, queryTerms, baseScore);
				if (bonus > 0) {
					scores.set(docId, baseScore + bonus);
				}
			}
		}
		return Array.from(scores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit)
			.map(([id, score]) => ({ id, score }));
	}

	serialize() {
		const sortedTerms = Array.from(this.termDict.entries()).sort((a, b) =>
			a[0].localeCompare(b[0]),
		);
		const termDict = {};
		const postings = {};
		for (let i = 0; i < sortedTerms.length; i++) {
			const [term, entry] = sortedTerms[i];
			termDict[term] = { termId: i, df: entry.df };
			postings[i] = {
				entries: entry.postings
					.slice()
					.sort((a, b) => a.docId - b.docId)
					.map((posting) => ({
						docId: posting.docId,
						tfNorm: posting.tfNorm,
						positions: encodeDelta(posting.positions),
					})),
			};
		}

		const docLengths = {};
		for (const [docId, length] of Array.from(this.docLengths.entries()).sort(
			(a, b) => a[0] - b[0],
		)) {
			docLengths[docId] = length;
		}

		return {
			termDict,
			postings,
			docCount: this.docCount,
			avgDocLen: this.avgDocLen,
			docLengths,
		};
	}
}

class BenchmarkMinHeap {
	constructor() {
		this.data = [];
	}

	get size() {
		return this.data.length;
	}

	push(item) {
		this.data.push(item);
		this.bubbleUp(this.data.length - 1);
	}

	pop() {
		const top = this.data[0];
		const last = this.data.pop();
		if (this.data.length > 0) {
			this.data[0] = last;
			this.siftDown(0);
		}
		return top;
	}

	bubbleUp(index) {
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (this.data[parent].dist <= this.data[index].dist) {
				break;
			}
			[this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
			index = parent;
		}
	}

	siftDown(index) {
		const size = this.data.length;
		while (true) {
			let smallest = index;
			const left = index * 2 + 1;
			const right = index * 2 + 2;
			if (left < size && this.data[left].dist < this.data[smallest].dist) {
				smallest = left;
			}
			if (right < size && this.data[right].dist < this.data[smallest].dist) {
				smallest = right;
			}
			if (smallest === index) {
				break;
			}
			[this.data[smallest], this.data[index]] = [this.data[index], this.data[smallest]];
			index = smallest;
		}
	}
}

class BenchmarkHnswIndex {
	constructor(rng) {
		this.rng = rng;
		this.entryPoint = null;
		this.maxLevel = 0;
		this.nodes = new Map();
		this.vectors = new Map();
	}

	insert(id, vector) {
		this.vectors.set(id, vector);
		const level = this.randomLevel();
		const node = {
			id,
			level,
			neighbors: Array.from({ length: level + 1 }, () => []),
		};
		this.nodes.set(id, node);

		if (this.entryPoint === null) {
			this.entryPoint = id;
			this.maxLevel = level;
			return;
		}

		let ep = this.entryPoint;
		const epLevel = this.nodes.get(ep).level;
		for (let layer = epLevel; layer > level; layer--) {
			ep = this.greedySearch(vector, ep, layer);
		}

		for (let layer = Math.min(level, epLevel); layer >= 0; layer--) {
			const candidates = this.searchLayer(vector, ep, BENCH_HNSW_EF_CONSTRUCTION, layer);
			const neighbors = this.selectNeighbors(id, candidates, BENCH_HNSW_M);
			node.neighbors[layer] = neighbors.map((candidate) => candidate.id);

			for (const neighbor of neighbors) {
				const neighborNode = this.nodes.get(neighbor.id);
				if (!neighborNode.neighbors[layer]) {
					neighborNode.neighbors[layer] = [];
				}
				neighborNode.neighbors[layer].push(id);
				neighborNode.neighbors[layer] = this.pruneNeighbors(
					neighbor.id,
					neighborNode.neighbors[layer],
					BENCH_HNSW_M,
				);
			}

			ep = candidates[0]?.id ?? ep;
		}

		if (level > this.maxLevel) {
			this.maxLevel = level;
			this.entryPoint = id;
		}
	}

	search(queryVector, topK, ef = BENCH_HNSW_EF) {
		if (this.entryPoint === null || topK <= 0) {
			return [];
		}

		let ep = this.entryPoint;
		const epLevel = this.nodes.get(ep).level;
		for (let layer = epLevel; layer > 0; layer--) {
			ep = this.greedySearch(queryVector, ep, layer);
		}

		return this.searchLayer(queryVector, ep, ef, 0)
			.slice(0, topK)
			.map((candidate) => ({ id: candidate.id, score: 1 - candidate.dist }));
	}

	randomLevel() {
		let level = 0;
		while (this.rng() < 1 / BENCH_HNSW_M && level < 16) {
			level += 1;
		}
		return level;
	}

	greedySearch(queryVector, entryPoint, layer) {
		let bestId = entryPoint;
		let bestDist = this.distToNode(queryVector, entryPoint);
		let changed = true;
		while (changed) {
			changed = false;
			const node = this.nodes.get(bestId);
			if (!node || !node.neighbors[layer]) {
				break;
			}
			for (const neighborId of node.neighbors[layer]) {
				const neighborDist = this.distToNode(queryVector, neighborId);
				if (neighborDist < bestDist) {
					bestDist = neighborDist;
					bestId = neighborId;
					changed = true;
				}
			}
		}
		return bestId;
	}

	searchLayer(queryVector, entryPoint, ef, layer) {
		const visited = new Set([entryPoint]);
		const queue = new BenchmarkMinHeap();
		const results = [];
		const entryDist = this.distToNode(queryVector, entryPoint);

		queue.push({ id: entryPoint, dist: entryDist });
		results.push({ id: entryPoint, dist: entryDist });

		while (queue.size > 0) {
			const current = queue.pop();
			const worst = results.reduce(
				(currentWorst, item) => (item.dist > currentWorst.dist ? item : currentWorst),
				results[0],
			);
			if (results.length >= ef && current.dist > worst.dist) {
				break;
			}

			const node = this.nodes.get(current.id);
			if (!node || !node.neighbors[layer]) {
				continue;
			}

			for (const neighborId of node.neighbors[layer]) {
				if (visited.has(neighborId)) {
					continue;
				}
				visited.add(neighborId);
				const neighborDist = this.distToNode(queryVector, neighborId);
				if (results.length < ef || neighborDist < worst.dist) {
					queue.push({ id: neighborId, dist: neighborDist });
					results.push({ id: neighborId, dist: neighborDist });
					if (results.length > ef) {
						const worstIndex = results.reduce(
							(indexWorst, item, index) =>
								item.dist > results[indexWorst].dist ? index : indexWorst,
							0,
						);
						results.splice(worstIndex, 1);
					}
				}
			}
		}

		return results.sort((left, right) => left.dist - right.dist);
	}

	selectNeighbors(nodeId, candidates, limit) {
		const deduped = [];
		const seen = new Set();
		for (const candidate of candidates) {
			if (candidate.id === nodeId || seen.has(candidate.id)) {
				continue;
			}
			seen.add(candidate.id);
			deduped.push(candidate);
		}

		const selected = [];
		for (const candidate of deduped) {
			let keep = true;
			for (const existing of selected) {
				if (this.distBetweenNodes(candidate.id, existing.id) < candidate.dist) {
					keep = false;
					break;
				}
			}
			if (!keep) {
				continue;
			}
			selected.push(candidate);
			if (selected.length >= limit) {
				return selected;
			}
		}

		for (const candidate of deduped) {
			if (selected.some((item) => item.id === candidate.id)) {
				continue;
			}
			selected.push(candidate);
			if (selected.length >= limit) {
				break;
			}
		}

		return selected;
	}

	pruneNeighbors(nodeId, neighborIds, limit) {
		const candidates = Array.from(new Set(neighborIds))
			.filter((neighborId) => neighborId !== nodeId)
			.map((neighborId) => ({
				id: neighborId,
				dist: this.distBetweenNodes(nodeId, neighborId),
			}))
			.filter((item) => Number.isFinite(item.dist))
			.sort((left, right) => left.dist - right.dist || left.id - right.id);
		return this.selectNeighbors(nodeId, candidates, limit).map((item) => item.id);
	}

	distToNode(queryVector, nodeId) {
		const vector = this.vectors.get(nodeId);
		if (!vector) {
			return Infinity;
		}
		return 1 - normalizedCosine(queryVector, vector);
	}

	distBetweenNodes(leftId, rightId) {
		const left = this.vectors.get(leftId);
		const right = this.vectors.get(rightId);
		if (!left || !right) {
			return Infinity;
		}
		return 1 - normalizedCosine(left, right);
	}
}

function computeTfNorm(tf, dl, avgDocLen) {
	const avgdl = avgDocLen || 1;
	return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
}

function encodeDelta(values) {
	const out = [];
	let prev = 0;
	for (const value of values) {
		out.push(value - prev);
		prev = value;
	}
	return out;
}

function varUintByteLength(value) {
	let n = value >>> 0;
	let bytes = 1;
	while (n >= 0x80) {
		n >>>= 7;
		bytes += 1;
	}
	return bytes;
}

function computeProximityBonus(termPos, terms, baseScore) {
	const span = minSpan(termPos, terms);
	if (span === Infinity) return 0;
	const approxTokenSpan = span * BM25_POSITION_BUCKET_SIZE;
	const spanSignal = 1 / (approxTokenSpan + 1);
	const orderedSignal = computeOrderedPairSignal(termPos, terms);
	const adjacentSignal = computeAdjacentPairSignal(termPos, terms);
	const compactSignal =
		approxTokenSpan <= Math.max(BM25_POSITION_BUCKET_SIZE, terms.length * BM25_POSITION_BUCKET_SIZE)
			? 1
			: 0;
	const proximityRatio = Math.min(
		BM25_PROXIMITY_MAX_SCORE_RATIO,
		spanSignal * BM25_PROXIMITY_SPAN_WEIGHT +
			orderedSignal * BM25_PROXIMITY_ORDER_WEIGHT +
			adjacentSignal * BM25_PROXIMITY_ADJACENT_WEIGHT +
			compactSignal * BM25_PROXIMITY_COMPACT_WEIGHT,
	);
	return baseScore * proximityRatio;
}

function minSpan(termPos, terms) {
	const events = [];
	const termList = terms.filter((term) => termPos.has(term));
	for (let ti = 0; ti < termList.length; ti++) {
		for (const pos of termPos.get(termList[ti]) ?? []) {
			events.push({ pos, termIdx: ti });
		}
	}
	events.sort((a, b) => a.pos - b.pos);
	const needed = termList.length;
	if (needed < 2 || events.length < needed) return Infinity;
	const counts = new Array(needed).fill(0);
	let have = 0;
	let left = 0;
	let minValue = Infinity;
	for (let right = 0; right < events.length; right++) {
		const termIdx = events[right].termIdx;
		if (counts[termIdx] === 0) have += 1;
		counts[termIdx] += 1;
		while (have === needed) {
			minValue = Math.min(minValue, events[right].pos - events[left].pos);
			const leftTermIdx = events[left].termIdx;
			counts[leftTermIdx] -= 1;
			if (counts[leftTermIdx] === 0) have -= 1;
			left += 1;
		}
	}
	return minValue;
}

function computeOrderedPairSignal(termPos, terms) {
	let pairCount = 0;
	let matchCount = 0;
	for (let i = 0; i < terms.length - 1; i++) {
		const left = termPos.get(terms[i]);
		const right = termPos.get(terms[i + 1]);
		if (!left || !right) continue;
		pairCount += 1;
		if (hasOrderedPair(left, right)) {
			matchCount += 1;
		}
	}
	return pairCount === 0 ? 0 : matchCount / pairCount;
}

function computeAdjacentPairSignal(termPos, terms) {
	let pairCount = 0;
	let matchCount = 0;
	for (let i = 0; i < terms.length - 1; i++) {
		const left = termPos.get(terms[i]);
		const right = termPos.get(terms[i + 1]);
		if (!left || !right) continue;
		pairCount += 1;
		if (hasAdjacentPair(left, right)) {
			matchCount += 1;
		}
	}
	return pairCount === 0 ? 0 : matchCount / pairCount;
}

function hasOrderedPair(left, right) {
	let j = 0;
	for (const a of left) {
		while (j < right.length && right[j] <= a) j += 1;
		if (j < right.length) return true;
	}
	return false;
}

function hasAdjacentPair(left, right) {
	let j = 0;
	for (const a of left) {
		while (j < right.length && right[j] < a) j += 1;
		if (j < right.length && Math.abs(right[j] - a) <= 1) {
			return true;
		}
	}
	return false;
}

function uniqueTermsInOrder(terms) {
	const seen = new Set();
	const out = [];
	for (const term of terms) {
		if (seen.has(term)) continue;
		seen.add(term);
		out.push(term);
	}
	return out;
}

function reciprocalRankScore(rank) {
	if (rank < 0) return 0;
	return 1 / (RRF_K + rank + 1);
}

function clamp01(value) {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

function sortRankedResults(items) {
	return [...items].sort((a, b) => b.score - a.score);
}

function normalizeBm25Scores(items) {
	const normalized = new Map();
	if (items.length === 0) return normalized;
	const maxScore = Math.max(items[0].score, 1e-6);
	for (const item of items) {
		normalized.set(item.id, Math.sqrt(clamp01(item.score / maxScore)));
	}
	return normalized;
}

function normalizeSemanticScores(items, minScore) {
	const normalized = new Map();
	if (items.length === 0) return normalized;
	const bestScore = items[0].score;
	const relativeDenominator = Math.max(bestScore - minScore, MIN_SCORE_SPREAD);
	const absoluteDenominator = Math.max(1 - minScore, MIN_SCORE_SPREAD);
	for (const item of items) {
		const relative = clamp01((item.score - minScore) / relativeDenominator);
		const absolute = clamp01((item.score - minScore) / absoluteDenominator);
		normalized.set(item.id, relative * 0.7 + absolute * 0.3);
	}
	return normalized;
}

function buildHybridQueryProfile(query, queryTokenCount, hasLexicalHits, tuning = {}) {
	const trimmed = query.trim();
	const looksPathLike = /[\\/._#:-]/.test(trimmed);
	const shortKeywordQuery =
		hasLexicalHits && (looksPathLike || queryTokenCount <= 2 || trimmed.length <= 8);
	let baseProfile;
	if (shortKeywordQuery) {
		baseProfile = {
			lexicalWeight: 1.35,
			vecSmallWeight: 0.45,
			vecSmallMinScore: 0.26,
			searchEf: 56,
			queryVariantLimit: 1,
		};
	} else if (!hasLexicalHits && queryTokenCount >= 3) {
		baseProfile = {
			lexicalWeight: 0.72,
			vecSmallWeight: 1.05,
			vecSmallMinScore: 0.12,
			searchEf: 96,
			queryVariantLimit: 3,
		};
	} else {
		baseProfile = {
			lexicalWeight: 1.0,
			vecSmallWeight: 0.9,
			vecSmallMinScore: 0.18,
			searchEf: 72,
			queryVariantLimit: 2,
		};
	}

	return {
		lexicalWeight:
			baseProfile.lexicalWeight * (tuning.lexicalWeightMultiplier ?? 1),
		vecSmallWeight:
			baseProfile.vecSmallWeight * (tuning.vecWeightMultiplier ?? 1),
		vecSmallMinScore: clamp01(
			baseProfile.vecSmallMinScore + (tuning.vecMinScoreDelta ?? 0),
		),
		searchEf: baseProfile.searchEf,
		queryVariantLimit: baseProfile.queryVariantLimit,
	};
}

function buildSemanticQueryVariants(query, queryTokens, limit) {
	const variants = [];
	const seen = new Set();

	const addVariant = (text, weight) => {
		const normalized = text.trim().replace(/\s+/g, " ");
		if (!normalized || seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		variants.push({ text: normalized, weight });
	};

	addVariant(query, 1);
	if (limit <= 1 || queryTokens.length <= 2) {
		return variants.slice(0, limit);
	}

	addVariant(queryTokens.slice(0, Math.min(queryTokens.length, 10)).join(" "), 0.9);
	if (limit <= 2 || queryTokens.length <= 5) {
		return variants.slice(0, limit);
	}

	addVariant(
		[...queryTokens.slice(0, 4), ...queryTokens.slice(-3)].join(" "),
		0.78,
	);
	return variants.slice(0, limit);
}

function mergeHybridRankings(bm25, vecSmall, profile, limit, tuning = {}) {
	const rankedBm25 = sortRankedResults(bm25);
	const rankedVecSmall = sortRankedResults(vecSmall);
	const bm25Map = normalizeBm25Scores(rankedBm25);
	const vecSmallMap = normalizeSemanticScores(rankedVecSmall, profile.vecSmallMinScore);
	const bm25RrfWeight = tuning.bm25RrfWeight ?? 0.14;
	const vecRrfWeight = tuning.vecRrfWeight ?? 0.08;
	const allIds = new Set([
		...rankedBm25.map((item) => item.id),
		...rankedVecSmall.map((item) => item.id),
	]);
	const merged = [];
	for (const id of allIds) {
		let score = 0;
		score += profile.lexicalWeight * (bm25Map.get(id) ?? 0);
		score += profile.vecSmallWeight * (vecSmallMap.get(id) ?? 0);
		score +=
			profile.lexicalWeight *
			bm25RrfWeight *
			reciprocalRankScore(findRank(rankedBm25, id));
		score +=
			profile.vecSmallWeight *
			vecRrfWeight *
			reciprocalRankScore(findRank(rankedVecSmall, id));
		if (score > 0) {
			merged.push({ id, score });
		}
	}
	return merged.sort((a, b) => b.score - a.score).slice(0, limit);
}

function findRank(items, id) {
	return items.findIndex((item) => item.id === id);
}

function hashString(text) {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function normalizeVector(vector) {
	let norm = 0;
	for (const value of vector) {
		norm += value * value;
	}
	norm = Math.sqrt(norm) || 1;
	const out = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i++) {
		out[i] = vector[i] / norm;
	}
	return out;
}

function unitVectorFromKey(key, dim) {
	const vector = new Float32Array(dim);
	let state = hashString(key) || 1;
	for (let i = 0; i < dim; i++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		vector[i] = ((state / 4294967295) * 2 - 1) * (i % 3 === 0 ? 1 : 0.6);
	}
	return normalizeVector(vector);
}

function mixVectors(parts, dim) {
	const mixed = new Float32Array(dim);
	for (const [vector, weight] of parts) {
		for (let i = 0; i < dim; i++) {
			mixed[i] += vector[i] * weight;
		}
	}
	return normalizeVector(mixed);
}

function createSemanticVector(text, conceptIds, semanticHints = []) {
	const tokens = Array.isArray(text) ? text : tokenize(text);
	const parts = [];
	for (const conceptId of conceptIds) {
		parts.push([unitVectorFromKey(`concept:${conceptId}`, VECTOR_DIM), 2.2]);
	}
	for (const hint of semanticHints) {
		parts.push([unitVectorFromKey(`concept:${hint}`, VECTOR_DIM), 2.6]);
	}
	for (const token of tokens) {
		parts.push([unitVectorFromKey(`token:${token}`, VECTOR_DIM), 0.24]);
	}
	if (parts.length === 0) {
		parts.push([unitVectorFromKey("empty", VECTOR_DIM), 1]);
	}
	return mixVectors(parts, VECTOR_DIM);
}

function cosineSimilarity(a, b) {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / Math.sqrt(normA * normB);
}

function normalizedCosine(a, b) {
	return clamp01((cosineSimilarity(a, b) + 1) / 2);
}

function pickMany(rng, items, count) {
	const out = [];
	for (let i = 0; i < count; i++) {
		out.push(sample(rng, items));
	}
	return out;
}

function appendTerms(target, terms, repeat = 1) {
	for (let i = 0; i < repeat; i++) {
		for (const term of terms) {
			target.push(term);
		}
	}
}

function buildBackgroundTerms(rng, concept, secondary, role, chunkType) {
	const terms = [];
	const noiseTopic = sample(rng, NOISE_TOPICS);
	const secondNoiseTopic = sample(rng, NOISE_TOPICS);
	appendTerms(terms, SHARED_TOKENS, 2);
	appendTerms(terms, pickMany(rng, noiseTopic, 18), 1);
	appendTerms(terms, pickMany(rng, secondNoiseTopic, 14), 1);
	appendTerms(terms, pickMany(rng, concept.semantic, role === "semantic" ? 22 : 14), 1);
	appendTerms(terms, pickMany(rng, concept.lexical, role === "exact" ? 18 : 10), 1);
	appendTerms(terms, pickMany(rng, secondary.semantic, chunkType === "comparison" ? 16 : 8), 1);
	appendTerms(terms, pickMany(rng, secondary.lexical, chunkType === "comparison" ? 12 : 6), 1);
	return terms;
}

function estimateLogicalBytes(terms, multiplier = 7) {
	const base = terms.reduce((sum, term) => sum + term.length + 1, 0);
	return base * multiplier;
}

function finalizeChunkDescriptor(chunk) {
	return {
		...chunk,
		logicalBytes: estimateLogicalBytes(chunk.terms),
	};
}

function buildNegativeVectorHints(concept, secondary, difficultyProfile) {
	const hints = [secondary.id];
	for (let i = 0; i < difficultyProfile.negativeVectorTargetHints; i++) {
		hints.push(concept.id);
	}
	return hints;
}

function buildAdversarialShadowChunks(rng, concept, secondary, difficultyProfile) {
	if (difficultyProfile.adversarialFilesPerConcept <= 0) {
		return [];
	}
	const targetLexical = pickMany(
		rng,
		concept.lexical,
		difficultyProfile.adversarialLexicalRepeat,
	);
	const targetSemantic = pickMany(
		rng,
		concept.semantic,
		difficultyProfile.adversarialSemanticRepeat,
	);
	const sharedTerms = pickMany(
		rng,
		SHARED_TOKENS,
		difficultyProfile.adversarialSharedRepeat,
	);
	const secondaryLexical = pickMany(rng, secondary.lexical, 12);
	const secondarySemantic = pickMany(rng, secondary.semantic, 12);
	const targetHeavyHints = [
		concept.id,
		concept.id,
		concept.id,
		concept.id,
		concept.id,
		secondary.id,
	];

	return [
		{
			terms: [
				concept.id,
				concept.lexical[0],
				concept.lexical[1],
				concept.semantic[0],
				concept.semantic[1],
				...targetLexical,
				...targetSemantic,
				...sharedTerms,
				...secondaryLexical,
				...secondarySemantic,
			],
			conceptIds: [secondary.id],
			vectorHints: targetHeavyHints,
		},
		{
			terms: [
				...targetSemantic,
				...pickMany(rng, concept.semantic, 14),
				...pickMany(rng, concept.lexical, 8),
				...sharedTerms,
				...secondarySemantic,
				...secondaryLexical,
			],
			conceptIds: [secondary.id],
			vectorHints: targetHeavyHints,
		},
		{
			terms: [
				concept.id,
				...pickMany(rng, concept.lexical, 10),
				...pickMany(rng, concept.semantic, 10),
				...pickMany(rng, secondary.lexical, 10),
				...pickMany(rng, secondary.semantic, 10),
				...sharedTerms,
				...pickMany(rng, SHARED_TOKENS, 10),
			],
			conceptIds: [],
			vectorHints: targetHeavyHints,
		},
	].map(finalizeChunkDescriptor);
}

function buildRoleChunks(
	rng,
	role,
	concept,
	secondary,
	exactLead,
	semanticLead,
	secondaryLead,
	index,
	difficultyProfile,
) {
	const exactTerms = [
		concept.id,
		...exactLead,
		...pickMany(rng, concept.lexical, 10),
		...pickMany(rng, concept.semantic, 8),
	];
	const semanticTerms = [
		...semanticLead,
		...pickMany(rng, concept.semantic, 14),
		...pickMany(rng, SHARED_TOKENS, 10),
	];
	const mixedTerms = [
		concept.id,
		...exactLead.slice(0, 3),
		...semanticLead.slice(0, 3),
		...pickMany(rng, concept.lexical, 8),
		...pickMany(rng, concept.semantic, 8),
	];
	const distractorTerms = [
		...exactLead,
		...secondaryLead,
		...pickMany(rng, secondary.lexical, 10),
		...pickMany(rng, SHARED_TOKENS, 12),
	];
	const negativeLexicalBleed =
		difficultyProfile.negativeTargetLexicalLeak > 0
			? pickMany(rng, concept.lexical, difficultyProfile.negativeTargetLexicalLeak)
			: [];
	const negativeSemanticBleed =
		difficultyProfile.negativeTargetSemanticLeak > 0
			? pickMany(rng, concept.semantic, difficultyProfile.negativeTargetSemanticLeak)
			: [];
	const extraSharedNoise =
		difficultyProfile.negativeSharedBoost > 0
			? pickMany(rng, SHARED_TOKENS, difficultyProfile.negativeSharedBoost)
			: [];
	const negativeVectorHints = buildNegativeVectorHints(
		concept,
		secondary,
		difficultyProfile,
	);

	switch (role) {
		case "exact":
			return [
				{
					terms: [
						concept.id,
						concept.lexical[0],
						concept.lexical[1],
						...exactTerms,
						...buildBackgroundTerms(rng, concept, secondary, role, "primary"),
					],
					conceptIds: [concept.id],
				},
				{
					terms: [
						concept.id,
						concept.lexical[0],
						...pickMany(rng, concept.lexical, 14),
						...pickMany(rng, concept.semantic, 10),
						...buildBackgroundTerms(rng, concept, secondary, role, "support"),
					],
					conceptIds: [concept.id],
				},
				{
					terms: [
						...secondaryLead,
						...pickMany(rng, secondary.lexical, 10),
						...pickMany(rng, concept.lexical, 4),
						...negativeLexicalBleed,
						...negativeSemanticBleed,
						...extraSharedNoise,
						...buildBackgroundTerms(rng, concept, secondary, role, "comparison"),
					],
					conceptIds: [secondary.id],
					vectorHints: negativeVectorHints,
				},
			].map(finalizeChunkDescriptor);
		case "semantic":
			return [
				{
					terms: [
						...semanticTerms,
						...pickMany(rng, concept.semantic, 16),
						...pickMany(rng, SHARED_TOKENS, 12),
						...buildBackgroundTerms(rng, concept, secondary, role, "primary"),
					],
					conceptIds: [concept.id],
				},
				{
					terms: [
						...pickMany(rng, concept.semantic, 22),
						...pickMany(rng, SHARED_TOKENS, 10),
						...pickMany(rng, concept.lexical, 3),
						...buildBackgroundTerms(rng, concept, secondary, role, "support"),
					],
					conceptIds: [concept.id],
				},
				{
					terms: [
						...secondaryLead,
						...pickMany(rng, secondary.semantic, 14),
						...pickMany(rng, concept.semantic, 5),
						...negativeLexicalBleed,
						...negativeSemanticBleed,
						...extraSharedNoise,
						...buildBackgroundTerms(rng, concept, secondary, role, "comparison"),
					],
					conceptIds: [secondary.id],
					vectorHints: negativeVectorHints,
				},
			].map(finalizeChunkDescriptor);
		case "mixed":
			return [
				{
					terms: [
						...mixedTerms,
						...pickMany(rng, concept.lexical, 10),
						...pickMany(rng, concept.semantic, 10),
						...buildBackgroundTerms(rng, concept, secondary, role, "primary"),
					],
					conceptIds: [concept.id],
				},
				{
					terms: [
						concept.id,
						...pickMany(rng, concept.lexical, 8),
						...pickMany(rng, concept.semantic, 12),
						...pickMany(rng, SHARED_TOKENS, 12),
						...buildBackgroundTerms(rng, concept, secondary, role, "support"),
					],
					conceptIds: [concept.id],
				},
				{
					terms: [
						...secondaryLead,
						...pickMany(rng, concept.lexical, 6),
						...pickMany(rng, concept.semantic, 6),
						...negativeLexicalBleed,
						...negativeSemanticBleed,
						...extraSharedNoise,
						...buildBackgroundTerms(rng, concept, secondary, role, "comparison"),
					],
					conceptIds: [secondary.id],
					vectorHints: negativeVectorHints,
				},
			].map(finalizeChunkDescriptor);
		case "distractor":
		default:
			return [
				{
					terms: [
						...distractorTerms,
						...pickMany(rng, exactLead, 8),
						...negativeLexicalBleed,
						...negativeSemanticBleed,
						...extraSharedNoise,
						...buildBackgroundTerms(rng, concept, secondary, role, "primary"),
					],
					conceptIds: [secondary.id],
					vectorHints: negativeVectorHints,
				},
				{
					terms: [
						...pickMany(rng, secondary.semantic, 14),
						...pickMany(rng, secondary.lexical, 12),
						...pickMany(rng, concept.lexical, 6),
						...negativeLexicalBleed,
						...negativeSemanticBleed,
						...extraSharedNoise,
						...pickMany(rng, SHARED_TOKENS, 14),
						...buildBackgroundTerms(rng, concept, secondary, role, "support"),
					],
					conceptIds: [secondary.id],
					vectorHints: negativeVectorHints,
				},
				{
					terms: [
						...pickMany(rng, SHARED_TOKENS, 20),
						...pickMany(rng, exactLead, 4),
						...pickMany(rng, semanticLead, 4),
						...negativeLexicalBleed,
						...negativeSemanticBleed,
						...extraSharedNoise,
						...buildBackgroundTerms(rng, concept, secondary, role, "comparison"),
					],
					conceptIds: [],
					vectorHints: negativeVectorHints,
				},
			].map(finalizeChunkDescriptor);
	}
}

function buildCorpus({ filesPerConcept, seed, targetLibraryBytes, difficulty }) {
	const rng = createRng(seed);
	const difficultyProfile = resolveDifficultyProfile(difficulty);
	const chunkById = new Map();
	const fileById = new Map();
	const filesByConceptRole = new Map(
		concepts.map((concept) => [
			concept.id,
			{
				exact: new Set(),
				semantic: new Set(),
				mixed: new Set(),
				distractor: new Set(),
			},
		]),
	);
	let fileId = 1;
	let chunkId = 1;
	let logicalBytes = 0;
	const minFilesPerConcept = Math.max(ROLE_SEQUENCE.length, filesPerConcept);
	const targetBytes = Math.max(targetLibraryBytes ?? 0, 0);
	const shouldScaleByBytes = targetBytes > 0;
	const maxLoops = shouldScaleByBytes ? 1000000 : minFilesPerConcept;
	let conceptLoop = 0;

	while (conceptLoop < maxLoops) {
		let createdInRound = 0;
		for (const concept of concepts) {
			const role = ROLE_SEQUENCE[conceptLoop % ROLE_SEQUENCE.length];
			const relatedPool = concepts.filter((entry) => entry.id !== concept.id);
			const secondary = sample(rng, relatedPool);
			const exactLead = shuffle(rng, concept.lexical).slice(0, 4);
			const semanticLead = shuffle(rng, concept.semantic).slice(0, 4);
			const secondaryLead = shuffle(rng, secondary.lexical).slice(0, 3);
			const fileIndex = Math.floor(conceptLoop / ROLE_SEQUENCE.length) + 1;
			const filePath = `${concept.folder}/${concept.id}-${String(fileIndex).padStart(5, "0")}.md`;
			const chunks = buildRoleChunks(
				rng,
				role,
				concept,
				secondary,
				exactLead,
				semanticLead,
				secondaryLead,
				fileIndex,
				difficultyProfile,
			);

			const file = {
				id: fileId,
				filePath,
				conceptId: concept.id,
				role,
				chunkIds: [],
			};
			fileById.set(fileId, file);
			filesByConceptRole.get(concept.id)[role].add(fileId);
			createdInRound += 1;

			for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
				const { terms, conceptIds, logicalBytes: chunkLogicalBytes } = chunks[chunkIndex];
				const chunk = {
					id: chunkId,
					fileId,
					filePath,
					chunkIndex,
					tokens: terms,
					conceptIds,
					vector: createSemanticVector(terms, conceptIds, chunks[chunkIndex].vectorHints ?? conceptIds),
					logicalBytes: chunkLogicalBytes,
				};
				chunkById.set(chunkId, chunk);
				file.chunkIds.push(chunkId);
				logicalBytes += chunkLogicalBytes;
				chunkId += 1;
			}

			fileId += 1;
			if (
				shouldScaleByBytes &&
				logicalBytes >= targetBytes &&
				fileById.size >= concepts.length * minFilesPerConcept
			) {
				break;
			}
		}
		if (createdInRound === 0) {
			break;
		}
		if (
			!shouldScaleByBytes &&
			fileById.size >= concepts.length * minFilesPerConcept
		) {
			break;
		}
		if (
			shouldScaleByBytes &&
			logicalBytes >= targetBytes &&
			fileById.size >= concepts.length * minFilesPerConcept
		) {
			break;
		}
		conceptLoop += 1;
	}

	if (difficultyProfile.adversarialFilesPerConcept > 0) {
		for (const concept of concepts) {
			const relatedPool = concepts.filter((entry) => entry.id !== concept.id);
			for (let i = 0; i < difficultyProfile.adversarialFilesPerConcept; i++) {
				const secondary = relatedPool[i % relatedPool.length];
				const filePath = `${concept.folder}/shadow-${concept.id}-${secondary.id}-${String(i + 1).padStart(3, "0")}.md`;
				const chunks = buildAdversarialShadowChunks(
					rng,
					concept,
					secondary,
					difficultyProfile,
				);
				const file = {
					id: fileId,
					filePath,
					conceptId: concept.id,
					role: "adversarial",
					chunkIds: [],
				};
				fileById.set(fileId, file);

				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const { terms, conceptIds, logicalBytes: chunkLogicalBytes } = chunks[chunkIndex];
					const chunk = {
						id: chunkId,
						fileId,
						filePath,
						chunkIndex,
						tokens: terms,
						conceptIds,
						vector: createSemanticVector(
							terms,
							conceptIds,
							chunks[chunkIndex].vectorHints ?? conceptIds,
						),
						logicalBytes: chunkLogicalBytes,
					};
					chunkById.set(chunkId, chunk);
					file.chunkIds.push(chunkId);
					logicalBytes += chunkLogicalBytes;
					chunkId += 1;
				}

				fileId += 1;
			}
		}
	}

	return {
		chunkById,
		fileById,
		filesByConceptRole,
		logicalBytes,
		difficulty: difficultyProfile.name,
	};
}

function buildQueries() {
	const queries = [];
	let id = 1;
	for (const concept of concepts) {
		for (const definition of concept.queries) {
			queries.push({
				id: `q${id++}`,
				text: definition.text,
				family: definition.family,
				entryPath: inferEntryPath(definition.family),
				targetConcepts: [concept.id],
				semanticHints: definition.semanticHints ?? [concept.id],
				relevantRoles:
					definition.family === "lexical"
						? ["exact", "mixed"]
						: definition.family === "phrase"
							? ["exact"]
							: definition.family === "semantic"
								? ["semantic", "mixed"]
								: ["mixed"],
				difficulty: DEFAULT_DIFFICULTY,
			});
		}
	}
	return queries;
}

function loadRegressionQueries(args) {
	const defaultPath = path.resolve(
		process.cwd(),
		"scripts",
		"hybrid-search-regression.example.json",
	);
	const queryPath = args.queries
		? path.resolve(process.cwd(), args.queries)
		: defaultPath;
	const payload = JSON.parse(fs.readFileSync(queryPath, "utf8"));
	const suites = Array.isArray(payload.suites) ? payload.suites : [];
	const suiteProfile = resolveSuiteProfile(args.suiteProfile);
	const activeSuites = args.suite
		? suites.filter((suite) => suite.name === args.suite)
		: suites.filter((suite) => suiteMatchesProfile(suite, suiteProfile));
	if (activeSuites.length === 0) {
		throw new Error(
			`No regression suites found for suite=${args.suite || "(all)"} profile=${suiteProfile} in ${queryPath}`,
		);
	}

	const queries = [];
	let id = 1;
	for (const suite of activeSuites) {
		for (const query of suite.queries ?? []) {
			queries.push({
				id: `r${id++}`,
				suite: suite.name,
				name: query.name ?? query.text,
				text: query.text,
				family: query.family ?? "mixed",
				entryPath: query.entryPath ?? inferEntryPath(query.family ?? "mixed"),
				targetConcepts: query.targetConcepts ?? [],
				semanticHints: query.semanticHints ?? query.targetConcepts ?? [],
				relevantRoles: query.relevantRoles ?? ["exact", "semantic", "mixed"],
				difficulty: args.difficulty,
			});
		}
	}

	return {
		path: queryPath,
		suiteProfile,
		suiteNames: activeSuites.map((suite) => suite.name),
		queries,
	};
}

function buildEngines(chunkById, seed, denseBackend = DEFAULT_DENSE_BACKEND) {
	const bm25NoProx = new BenchmarkBM25Engine({ proximity: false });
	const bm25Prox = new BenchmarkBM25Engine({ proximity: true });
	const hnswApprox =
		denseBackend === "hnsw" ? new BenchmarkHnswIndex(createRng(seed ^ 0x9e3779b9)) : null;
	for (const chunk of chunkById.values()) {
		bm25NoProx.addDocumentTerms(chunk.id, chunk.tokens);
		bm25Prox.addDocumentTerms(chunk.id, chunk.tokens);
		hnswApprox?.insert(chunk.id, chunk.vector);
	}
	return { bm25NoProx, bm25Prox, hnswApprox };
}

function denseSearch(query, chunkById, limit, options = {}) {
	const difficultyProfile = resolveDifficultyProfile(query.difficulty);
	const useQueryVariants = options.useQueryVariants ?? false;
	const denseBackend = options.backend ?? DEFAULT_DENSE_BACKEND;
	const hnswApprox = options.hnswApprox ?? null;
	const searchEf = options.searchEf ?? BENCH_HNSW_EF;
	const queryTokens = tokenize(query.text);
	const variants = useQueryVariants
		? buildSemanticQueryVariants(
			query.text,
			queryTokens,
			Math.max(1, options.queryVariantLimit ?? 1),
		)
		: [{ text: query.text, weight: 1 }];
	const queryVectors = variants.map((variant) => ({
		...variant,
		vector: createSemanticVector(
			variant.text,
			difficultyProfile.name === "hard" ? [] : query.semanticHints ?? [],
			query.semanticHints ?? [],
		),
	}));
	const mergedScores = new Map();
	for (const variant of queryVectors) {
		if (denseBackend === "hnsw" && hnswApprox) {
			for (const hit of hnswApprox.search(variant.vector, limit, searchEf)) {
				const score = hit.score * variant.weight;
				if (score > (mergedScores.get(hit.id) ?? Number.NEGATIVE_INFINITY)) {
					mergedScores.set(hit.id, score);
				}
			}
			continue;
		}

		for (const chunk of chunkById.values()) {
			const score = normalizedCosine(variant.vector, chunk.vector) * variant.weight;
			if (score > (mergedScores.get(chunk.id) ?? Number.NEGATIVE_INFINITY)) {
				mergedScores.set(chunk.id, score);
			}
		}
	}
	const ranking = Array.from(mergedScores.entries()).map(([id, score]) => ({ id, score }));
	return {
		queryVector: queryVectors[0]?.vector,
		results: ranking.sort((a, b) => b.score - a.score).slice(0, limit),
	};
}

function dedupeSequential(...lists) {
	const merged = [];
	const seen = new Set();
	for (const list of lists) {
		for (const item of list) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			merged.push(item);
		}
	}
	return merged;
}

function lexicalOverlapScore(queryTokens, chunkTokens) {
	if (queryTokens.length === 0 || chunkTokens.length === 0) return 0;
	const chunkSet = new Set(chunkTokens);
	let matched = 0;
	for (const token of queryTokens) {
		if (chunkSet.has(token)) matched += 1;
	}
	return matched / queryTokens.length;
}

function rerankPhraseScore(queryTokens, chunkTokens) {
	if (queryTokens.length <= 1 || chunkTokens.length === 0) return 0;
	const positions = new Map();
	for (let i = 0; i < chunkTokens.length; i++) {
		const token = chunkTokens[i];
		if (!positions.has(token)) {
			positions.set(token, []);
		}
		positions.get(token).push(i);
	}
	const span = minSpan(positions, queryTokens);
	if (span === Infinity) return 0;
	const ordered = computeOrderedPairSignal(positions, queryTokens);
	const adjacent = computeAdjacentPairSignal(positions, queryTokens);
	const spanSignal = 1 / (span + 1);
	return clamp01(spanSignal * 0.6 + ordered * 0.25 + adjacent * 0.15);
}

function rerankCandidates(query, candidates, chunkById, queryVector, limit) {
	const queryTokens = uniqueTermsInOrder(tokenizeSequence(query.text));
	const reranked = [];
	const maxRecallScore = Math.max(...candidates.map((item) => item.score), 1e-6);
	for (const candidate of candidates) {
		const chunk = chunkById.get(candidate.id);
		if (!chunk) continue;
		const lexical = lexicalOverlapScore(queryTokens, chunk.tokens);
		const phrase = rerankPhraseScore(queryTokens, chunk.tokens);
		const semantic = normalizedCosine(queryVector, chunk.vector);
		const recall = clamp01(candidate.score / maxRecallScore);
		const shortLexicalQuery = queryTokens.length <= 4;
		const lexicalWeight = shortLexicalQuery ? 0.46 : 0.24;
		const phraseWeight = shortLexicalQuery ? 0.24 : 0.14;
		const semanticWeight = shortLexicalQuery ? 0.22 : 0.54;
		let score =
			semantic * semanticWeight +
			lexical * lexicalWeight +
			phrase * phraseWeight +
			recall * 0.08;
		if (shortLexicalQuery && lexical >= 0.75) {
			score += 0.12;
		}
		if (shortLexicalQuery && lexical >= 0.95) {
			score += 0.14;
		}
		if (shortLexicalQuery && phrase >= 0.55) {
			score += 0.12;
		}
		if (!shortLexicalQuery && semantic >= 0.72) {
			score += 0.05;
		}
		reranked.push({ id: candidate.id, score });
	}
	return reranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

function takeTopIds(items, limit) {
	return new Set(items.slice(0, limit).map((item) => item.id));
}

function takeTopFileIdsFromChunks(items, chunkById, limit) {
	const fileIds = new Set();
	for (const item of items.slice(0, limit)) {
		const chunk = chunkById.get(item.id);
		if (!chunk) continue;
		fileIds.add(chunk.fileId);
	}
	return fileIds;
}

function countOverlap(items, idSet, limit) {
	let count = 0;
	for (const item of items.slice(0, limit)) {
		if (idSet.has(item.id)) {
			count += 1;
		}
	}
	return count;
}

function countFileOverlap(items, fileIdSet, chunkById, limit) {
	let count = 0;
	const seenFileIds = new Set();
	for (const item of items.slice(0, limit)) {
		const chunk = chunkById.get(item.id);
		if (!chunk || seenFileIds.has(chunk.fileId)) continue;
		seenFileIds.add(chunk.fileId);
		if (fileIdSet.has(chunk.fileId)) {
			count += 1;
		}
	}
	return count;
}

function computeCandidateFileStats(items, chunkById) {
	const countsByFile = new Map();
	for (const item of items) {
		const chunk = chunkById.get(item.id);
		if (!chunk) continue;
		countsByFile.set(chunk.fileId, (countsByFile.get(chunk.fileId) ?? 0) + 1);
	}
	let maxChunksPerFile = 0;
	for (const count of countsByFile.values()) {
		if (count > maxChunksPerFile) {
			maxChunksPerFile = count;
		}
	}
	return {
		uniqueFileCount: countsByFile.size,
		maxChunksPerFile,
	};
}

function computeRerankSourceOverlap(query, bm25Chunks, denseChunks, unionChunks, rerankChunks, chunkById) {
	const rerankTopChunks = rerankChunks.slice(0, RERANK_OVERLAP_TOP_K);
	const candidateFileStats = computeCandidateFileStats(unionChunks, chunkById);
	const rerankTopChunkFileStats = computeCandidateFileStats(rerankTopChunks, chunkById);
	const chunkOverlap = {};
	const fileOverlap = {};
	const candidateWindows = {};

	for (const cutoff of OVERLAP_CUTOFFS) {
		const bm25ChunkIds = takeTopIds(bm25Chunks, cutoff);
		const denseChunkIds = takeTopIds(denseChunks, cutoff);
		const unionChunkIds = new Set([...bm25ChunkIds, ...denseChunkIds]);
		const bm25FileIds = takeTopFileIdsFromChunks(bm25Chunks, chunkById, cutoff);
		const denseFileIds = takeTopFileIdsFromChunks(denseChunks, chunkById, cutoff);
		const unionFileIds = new Set([...bm25FileIds, ...denseFileIds]);

		chunkOverlap[`bm25_${cutoff}`] = countOverlap(rerankTopChunks, bm25ChunkIds, RERANK_OVERLAP_TOP_K);
		chunkOverlap[`dense_${cutoff}`] = countOverlap(rerankTopChunks, denseChunkIds, RERANK_OVERLAP_TOP_K);
		chunkOverlap[`union_${cutoff}`] = countOverlap(rerankTopChunks, unionChunkIds, RERANK_OVERLAP_TOP_K);

		fileOverlap[`bm25_${cutoff}`] = countFileOverlap(
			rerankTopChunks,
			bm25FileIds,
			chunkById,
			RERANK_OVERLAP_TOP_K,
		);
		fileOverlap[`dense_${cutoff}`] = countFileOverlap(
			rerankTopChunks,
			denseFileIds,
			chunkById,
			RERANK_OVERLAP_TOP_K,
		);
		fileOverlap[`union_${cutoff}`] = countFileOverlap(
			rerankTopChunks,
			unionFileIds,
			chunkById,
			RERANK_OVERLAP_TOP_K,
		);

		candidateWindows[`union_${cutoff}`] = unionChunkIds.size;
	}

	return {
		queryId: query.id,
		name: query.name ?? query.text,
		text: query.text,
		family: query.family,
		entryPath: query.entryPath,
		rerankTopChunkCount: rerankTopChunks.length,
		rerankTopUniqueFiles: rerankTopChunkFileStats.uniqueFileCount,
		candidateCount: unionChunks.length,
		candidateUniqueFiles: candidateFileStats.uniqueFileCount,
		candidateMaxChunksPerFile: candidateFileStats.maxChunksPerFile,
		chunkOverlap,
		fileOverlap,
		candidateWindows,
	};
}

function scoreFile(scores) {
	const ranked = [...scores].sort((a, b) => b - a);
	const [best = 0, second = 0, third = 0] = ranked;
	return best + second * 0.35 + third * 0.2;
}

function toFileRanking(chunkRanking, chunkById, topK, { preserveOrder = false } = {}) {
	if (preserveOrder) {
		const fileScores = new Map();
		for (let i = 0; i < chunkRanking.length; i++) {
			const chunk = chunkById.get(chunkRanking[i].id);
			if (!chunk || fileScores.has(chunk.fileId)) continue;
			fileScores.set(chunk.fileId, 1 / (i + 1));
		}
		return Array.from(fileScores.entries())
			.map(([id, score]) => ({ id, score }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);
	}

	const byFile = new Map();
	for (const item of chunkRanking) {
		const chunk = chunkById.get(item.id);
		if (!chunk) continue;
		const entry = byFile.get(chunk.fileId) ?? [];
		entry.push(item.score);
		byFile.set(chunk.fileId, entry);
	}
	return Array.from(byFile.entries())
		.map(([id, scores]) => ({ id, score: scoreFile(scores) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

function reciprocalRank(relevantSet, rankedFiles) {
	for (let i = 0; i < rankedFiles.length; i++) {
		if (relevantSet.has(rankedFiles[i].id)) {
			return 1 / (i + 1);
		}
	}
	return 0;
}

function firstRelevantRank(relevantSet, rankedFiles) {
	for (let i = 0; i < rankedFiles.length; i++) {
		if (relevantSet.has(rankedFiles[i].id)) {
			return i + 1;
		}
	}
	return Infinity;
}

function recallAtK(relevantSet, rankedFiles, k) {
	for (const item of rankedFiles.slice(0, k)) {
		if (relevantSet.has(item.id)) return 1;
	}
	return 0;
}

function averagePrecisionAtK(relevantSet, rankedItems, k) {
	let hitCount = 0;
	let precisionSum = 0;
	const limited = rankedItems.slice(0, k);
	for (let i = 0; i < limited.length; i++) {
		if (relevantSet.has(limited[i].id)) {
			hitCount += 1;
			precisionSum += hitCount / (i + 1);
		}
	}
	if (relevantSet.size === 0) {
		return 0;
	}
	return precisionSum / Math.min(relevantSet.size, k);
}

function firstHitRank(relevantSet, rankedItems) {
	for (let i = 0; i < rankedItems.length; i++) {
		if (relevantSet.has(rankedItems[i].id)) {
			return i + 1;
		}
	}
	return Infinity;
}

function inferEntryPath(family) {
	if (family === "lexical" || family === "phrase") {
		return "direct_hybrid";
	}
	if (family === "semantic") {
		return "lexical_fallback_like";
	}
	return "mixed_entry";
}

function relevantItemsWithinK(relevantSet, rankedItems, k) {
	const hits = [];
	for (const item of rankedItems.slice(0, k)) {
		if (relevantSet.has(item.id)) {
			hits.push(item.id);
		}
	}
	return hits;
}

function noiseRateAtK(relevantSet, rankedItems, k) {
	const limited = rankedItems.slice(0, k);
	if (limited.length === 0) {
		return 1;
	}
	let irrelevant = 0;
	for (const item of limited) {
		if (!relevantSet.has(item.id)) {
			irrelevant += 1;
		}
	}
	return irrelevant / limited.length;
}

function createDefaultTuningConfig(defaultRecallLimit) {
	return {
		name: "current-runtime-20x30-plain",
		bm25RecallLimit: Math.max(20, defaultRecallLimit),
		denseRecallLimit: Math.max(30, defaultRecallLimit),
		useProximity: false,
		useDenseQueryVariants: false,
		profileTuning: {
			lexicalWeightMultiplier: 1,
			vecWeightMultiplier: 1,
			vecMinScoreDelta: 0,
		},
		mergeTuning: {
			bm25RrfWeight: 0.14,
			vecRrfWeight: 0.08,
		},
	};
}

function buildEntryAwarePlan(defaultBm25RecallLimit, defaultDenseRecallLimit, entryPlans) {
	return {
		default: {
			bm25RecallLimit: defaultBm25RecallLimit,
			denseRecallLimit: defaultDenseRecallLimit,
		},
		...entryPlans,
	};
}

function describeEntryAwarePlan(entryRecallPlan) {
	if (!entryRecallPlan) return "fixed";
	const orderedKeys = ["direct_hybrid", "lexical_fallback_like", "mixed_entry", "default"];
	return orderedKeys
		.filter((key) => entryRecallPlan[key])
		.map((key) => {
			const plan = entryRecallPlan[key];
			return `${key}:${plan.bm25RecallLimit}/${plan.denseRecallLimit}`;
		})
		.join(" ");
}

function resolveRecallBudget(query, config, defaultRecallLimit) {
	const entryPlan = config.entryRecallPlan?.[query.entryPath];
	const defaultPlan = config.entryRecallPlan?.default;
	const plan = entryPlan ?? defaultPlan;
	return {
		bm25RecallLimit:
			plan?.bm25RecallLimit ?? config.bm25RecallLimit ?? defaultRecallLimit,
		denseRecallLimit:
			plan?.denseRecallLimit ?? config.denseRecallLimit ?? defaultRecallLimit,
	};
}

function buildTuningConfigs() {
	const configs = [];
	const recallPairs = [
		[20, 20],
		[25, 25],
		[30, 20],
		[20, 30],
		[30, 30],
	];
	const profiles = [
		{
			name: "current",
			profileTuning: {
				lexicalWeightMultiplier: 1,
				vecWeightMultiplier: 1,
				vecMinScoreDelta: 0,
			},
			mergeTuning: { bm25RrfWeight: 0.14, vecRrfWeight: 0.08 },
		},
		{
			name: "lexical-heavy",
			profileTuning: {
				lexicalWeightMultiplier: 1.18,
				vecWeightMultiplier: 0.82,
				vecMinScoreDelta: 0.03,
			},
			mergeTuning: { bm25RrfWeight: 0.18, vecRrfWeight: 0.06 },
		},
		{
			name: "balanced-open",
			profileTuning: {
				lexicalWeightMultiplier: 0.97,
				vecWeightMultiplier: 1.05,
				vecMinScoreDelta: -0.02,
			},
			mergeTuning: { bm25RrfWeight: 0.12, vecRrfWeight: 0.1 },
		},
	];
	const entryAwarePlans = [
		{
			name: "entry-aware-fallback-dense",
			entryRecallPlan: buildEntryAwarePlan(20, 30, {
				direct_hybrid: { bm25RecallLimit: 25, denseRecallLimit: 25 },
				lexical_fallback_like: { bm25RecallLimit: 15, denseRecallLimit: 35 },
				mixed_entry: { bm25RecallLimit: 20, denseRecallLimit: 30 },
			}),
		},
		{
			name: "entry-aware-direct-balanced",
			entryRecallPlan: buildEntryAwarePlan(20, 30, {
				direct_hybrid: { bm25RecallLimit: 30, denseRecallLimit: 20 },
				lexical_fallback_like: { bm25RecallLimit: 15, denseRecallLimit: 35 },
				mixed_entry: { bm25RecallLimit: 20, denseRecallLimit: 30 },
			}),
		},
		{
			name: "entry-aware-dense-max",
			entryRecallPlan: buildEntryAwarePlan(20, 30, {
				direct_hybrid: { bm25RecallLimit: 25, denseRecallLimit: 25 },
				lexical_fallback_like: { bm25RecallLimit: 10, denseRecallLimit: 40 },
				mixed_entry: { bm25RecallLimit: 15, denseRecallLimit: 35 },
			}),
		},
	];

	for (const [bm25RecallLimit, denseRecallLimit] of recallPairs) {
		for (const useProximity of [true, false]) {
			for (const profile of profiles) {
				for (const useDenseQueryVariants of [false, true]) {
					if (useDenseQueryVariants && !(bm25RecallLimit === 25 && denseRecallLimit === 25 && !useProximity)) {
						continue;
					}
					configs.push({
						name: `${profile.name}-${bm25RecallLimit}x${denseRecallLimit}-${useProximity ? "prox" : "plain"}${useDenseQueryVariants ? "-variants" : ""}`,
						bm25RecallLimit,
						denseRecallLimit,
						useProximity,
						useDenseQueryVariants,
						profileTuning: profile.profileTuning,
						mergeTuning: profile.mergeTuning,
					});
				}
			}
		}
	}
	for (const plan of entryAwarePlans) {
		for (const useProximity of [true, false]) {
			for (const profile of profiles) {
				configs.push({
					name: `${plan.name}-${profile.name}-${useProximity ? "prox" : "plain"}`,
					bm25RecallLimit: plan.entryRecallPlan.default.bm25RecallLimit,
					denseRecallLimit: plan.entryRecallPlan.default.denseRecallLimit,
					entryRecallPlan: plan.entryRecallPlan,
					useProximity,
					profileTuning: profile.profileTuning,
					mergeTuning: profile.mergeTuning,
				});
			}
		}
	}
	return configs;
}

function evaluateRun(args, runIndex, config = null) {
	const seed = args.seed + runIndex * 17;
	const corpus = buildCorpus({
		filesPerConcept: args.filesPerConcept,
		seed,
		targetLibraryBytes: Math.round(args.targetLibraryMb * 1024 * 1024),
		difficulty: args.difficulty,
	});
	const querySource =
		args.mode === "regression" ||
		args.mode === "tune-regression" ||
		args.mode === "rerank-source-overlap"
			? loadRegressionQueries(args)
			: {
					path: null,
					suiteNames: ["synthetic"],
					queries: buildQueries(),
				};
	const queries = querySource.queries;
	const { bm25NoProx, bm25Prox, hnswApprox } = buildEngines(
		corpus.chunkById,
		seed,
		args.denseBackend,
	);
	const activeConfig = config ?? createDefaultTuningConfig(args.recallLimit);
	const mergeUsesProximity = activeConfig.useProximity ?? true;

	const fileSystems = new Map([
		["bm25_base", []],
		["bm25_prox", []],
		["dense", []],
		["source_union", []],
		["hybrid_merge", []],
		["hybrid_rerank", []],
	]);
	const candidateSystems = new Map([
		["bm25_base", []],
		["bm25_prox", []],
		["dense", []],
		["source_union", []],
		["hybrid_merge", []],
	]);
	const complementSystems = new Map([
		["bm25_prox_vs_dense", []],
		["bm25_base_vs_dense", []],
	]);
	const rerankSourceOverlapResults = [];
	const proximityExamples = [];
	const rerankExamples = [];

	for (const query of queries) {
		const relevantFiles = new Set();
		const relevantChunks = new Set();
		for (const conceptId of query.targetConcepts) {
			const roleMap = corpus.filesByConceptRole.get(conceptId);
			for (const role of query.relevantRoles) {
				for (const fileId of roleMap?.[role] ?? []) {
					relevantFiles.add(fileId);
				}
			}
		}
		for (const fileId of relevantFiles) {
			const file = corpus.fileById.get(fileId);
			if (!file) continue;
			for (const chunkId of file.chunkIds) {
				const chunk = corpus.chunkById.get(chunkId);
				if (!chunk) continue;
				if (query.targetConcepts.some((conceptId) => chunk.conceptIds.includes(conceptId))) {
					relevantChunks.add(chunkId);
				}
			}
		}

		const { bm25RecallLimit, denseRecallLimit } = resolveRecallBudget(
			query,
			activeConfig,
			args.recallLimit,
		);
		const bm25BaseChunks = bm25NoProx.search(query.text, bm25RecallLimit);
		const bm25ProxChunks = bm25Prox.search(query.text, bm25RecallLimit);
		const activeBm25Chunks = mergeUsesProximity ? bm25ProxChunks : bm25BaseChunks;
		const profile = buildHybridQueryProfile(
			query.text,
			tokenize(query.text).length,
			activeBm25Chunks.length > 0,
			activeConfig.profileTuning,
		);
		const dense = denseSearch(query, corpus.chunkById, denseRecallLimit, {
			backend: args.denseBackend,
			hnswApprox,
			searchEf: profile.searchEf,
			useQueryVariants: activeConfig.useDenseQueryVariants ?? false,
			queryVariantLimit: profile.queryVariantLimit,
		});
		const unionChunks = dedupeSequential(activeBm25Chunks, dense.results);
		const mergeChunks = mergeHybridRankings(
			activeBm25Chunks,
			dense.results,
			profile,
			Math.max(bm25RecallLimit, denseRecallLimit),
			activeConfig.mergeTuning,
		);
		const rerankChunks = rerankCandidates(
			query,
			unionChunks,
			corpus.chunkById,
			dense.queryVector,
			args.topK,
		);
		rerankSourceOverlapResults.push(
			computeRerankSourceOverlap(
				query,
				activeBm25Chunks,
				dense.results,
				unionChunks,
				rerankChunks,
				corpus.chunkById,
			),
		);

		const rankings = {
			bm25_base: toFileRanking(bm25BaseChunks, corpus.chunkById, args.topK),
			bm25_prox: toFileRanking(bm25ProxChunks, corpus.chunkById, args.topK),
			dense: toFileRanking(dense.results, corpus.chunkById, args.topK),
			source_union: toFileRanking(unionChunks, corpus.chunkById, args.topK, {
				preserveOrder: true,
			}),
			hybrid_merge: toFileRanking(mergeChunks, corpus.chunkById, args.topK),
			hybrid_rerank: toFileRanking(rerankChunks, corpus.chunkById, args.topK),
		};

		const candidates = {
			bm25_base: bm25BaseChunks,
			bm25_prox: bm25ProxChunks,
			dense: dense.results,
			source_union: unionChunks,
			hybrid_merge: mergeChunks,
		};

		for (const [systemName, rankedChunks] of Object.entries(candidates)) {
			const firstRank = firstHitRank(relevantChunks, rankedChunks);
			candidateSystems.get(systemName).push({
				queryId: query.id,
				family: query.family,
				entryPath: query.entryPath,
				ap10: averagePrecisionAtK(relevantChunks, rankedChunks, 10),
				ap20: averagePrecisionAtK(relevantChunks, rankedChunks, 20),
				r10: recallAtK(relevantChunks, rankedChunks, 10),
				r20: recallAtK(relevantChunks, rankedChunks, 20),
				r25: recallAtK(relevantChunks, rankedChunks, 25),
				noise10: noiseRateAtK(relevantChunks, rankedChunks, 10),
				noise25: noiseRateAtK(relevantChunks, rankedChunks, 25),
				front10:
					Number.isFinite(firstRank) && firstRank < 10
						? 1 / Math.log2(firstRank + 2)
						: 0,
				firstRank,
			});
		}

		for (const [systemName, rankedFiles] of Object.entries(rankings)) {
			fileSystems.get(systemName).push({
				queryId: query.id,
				family: query.family,
				entryPath: query.entryPath,
				rr: reciprocalRank(relevantFiles, rankedFiles),
				r1: recallAtK(relevantFiles, rankedFiles, 1),
				r5: recallAtK(relevantFiles, rankedFiles, 5),
				r10: recallAtK(relevantFiles, rankedFiles, 10),
				firstRank: firstRelevantRank(relevantFiles, rankedFiles),
			});
		}

		const denseHits25 = new Set(relevantItemsWithinK(relevantChunks, dense.results, 25));
		const bm25BaseHits25 = new Set(relevantItemsWithinK(relevantChunks, bm25BaseChunks, 25));
		const bm25ProxHits25 = new Set(relevantItemsWithinK(relevantChunks, bm25ProxChunks, 25));
		const unionHits25 = new Set(relevantItemsWithinK(relevantChunks, unionChunks, 25));
		complementSystems.get("bm25_prox_vs_dense").push({
			queryId: query.id,
			family: query.family,
			entryPath: query.entryPath,
			denseOnlyGain25: setDifferenceSize(denseHits25, bm25ProxHits25) > 0 ? 1 : 0,
			bm25OnlyGain25: setDifferenceSize(bm25ProxHits25, denseHits25) > 0 ? 1 : 0,
			unionGain25:
				unionHits25.size > 0 && (bm25ProxHits25.size === 0 || denseHits25.size === 0) ? 1 : 0,
		});
		complementSystems.get("bm25_base_vs_dense").push({
			queryId: query.id,
			family: query.family,
			entryPath: query.entryPath,
			denseOnlyGain25: setDifferenceSize(denseHits25, bm25BaseHits25) > 0 ? 1 : 0,
			bm25OnlyGain25: setDifferenceSize(bm25BaseHits25, denseHits25) > 0 ? 1 : 0,
			unionGain25:
				unionHits25.size > 0 && (bm25BaseHits25.size === 0 || denseHits25.size === 0) ? 1 : 0,
		});

		const baseRank = firstRelevantRank(relevantFiles, rankings.bm25_base);
		const proxRank = firstRelevantRank(relevantFiles, rankings.bm25_prox);
		if (proxRank < baseRank) {
			proximityExamples.push({
				query: query.text,
				family: query.family,
				gain: baseRank - proxRank,
				from: baseRank,
				to: proxRank,
			});
		}

		const unionRank = firstRelevantRank(relevantFiles, rankings.source_union);
		const rerankRank = firstRelevantRank(relevantFiles, rankings.hybrid_rerank);
		if (rerankRank < unionRank) {
			rerankExamples.push({
				query: query.text,
				family: query.family,
				gain: unionRank - rerankRank,
				from: unionRank,
				to: rerankRank,
			});
		}
	}

	return {
		seed,
		queryCount: queries.length,
		chunkCount: corpus.chunkById.size,
		fileCount: corpus.fileById.size,
		logicalBytes: corpus.logicalBytes,
		querySource,
		config: activeConfig,
		fileSystems,
		candidateSystems,
		complementSystems,
		rerankSourceOverlapResults,
		proximityExamples,
		rerankExamples,
	};
}

function summarizeSystemResults(results) {
	const count = results.length || 1;
	const total = results.reduce(
		(acc, item) => {
			acc.rr += item.rr;
			acc.r1 += item.r1;
			acc.r5 += item.r5;
			acc.r10 += item.r10;
			acc.finiteRanks += Number.isFinite(item.firstRank) ? item.firstRank : 0;
			acc.hits += Number.isFinite(item.firstRank) ? 1 : 0;
			return acc;
		},
		{ rr: 0, r1: 0, r5: 0, r10: 0, finiteRanks: 0, hits: 0 },
	);
	return {
		mrr: total.rr / count,
		recall1: total.r1 / count,
		recall5: total.r5 / count,
		recall10: total.r10 / count,
		avgFirstRank: total.hits > 0 ? total.finiteRanks / total.hits : Infinity,
	};
}

function summarizeCandidateResults(results) {
	const count = results.length || 1;
	const total = results.reduce(
		(acc, item) => {
			acc.ap10 += item.ap10;
			acc.ap20 += item.ap20;
			acc.r10 += item.r10;
			acc.r20 += item.r20;
			acc.r25 += item.r25;
			acc.noise10 += item.noise10;
			acc.noise25 += item.noise25;
			acc.front10 += item.front10;
			acc.finiteRanks += Number.isFinite(item.firstRank) ? item.firstRank : 0;
			acc.hits += Number.isFinite(item.firstRank) ? 1 : 0;
			return acc;
		},
		{
			ap10: 0,
			ap20: 0,
			r10: 0,
			r20: 0,
			r25: 0,
			noise10: 0,
			noise25: 0,
			front10: 0,
			finiteRanks: 0,
			hits: 0,
		},
	);
	return {
		ap10: total.ap10 / count,
		ap20: total.ap20 / count,
		recall10: total.r10 / count,
		recall20: total.r20 / count,
		hits25: total.r25 / count,
		noise10: total.noise10 / count,
		noise25: total.noise25 / count,
		front10: total.front10 / count,
		avgFirstRank: total.hits > 0 ? total.finiteRanks / total.hits : Infinity,
	};
}

function summarizeComplementResults(results) {
	const count = results.length || 1;
	const total = results.reduce(
		(acc, item) => {
			acc.denseOnlyGain25 += item.denseOnlyGain25;
			acc.bm25OnlyGain25 += item.bm25OnlyGain25;
			acc.unionGain25 += item.unionGain25;
			return acc;
		},
		{ denseOnlyGain25: 0, bm25OnlyGain25: 0, unionGain25: 0 },
	);
	return {
		denseOnlyGain25: total.denseOnlyGain25 / count,
		bm25OnlyGain25: total.bm25OnlyGain25 / count,
		unionGain25: total.unionGain25 / count,
	};
}

function summarizeRerankSourceOverlap(results) {
	const count = results.length || 1;
	const total = {
		candidateCount: 0,
		candidateUniqueFiles: 0,
		candidateMaxChunksPerFile: 0,
		rerankTopChunkCount: 0,
		rerankTopUniqueFiles: 0,
	};
	const chunkOverlap = {};
	const fileOverlap = {};
	const candidateWindows = {};

	for (const result of results) {
		total.candidateCount += result.candidateCount;
		total.candidateUniqueFiles += result.candidateUniqueFiles;
		total.candidateMaxChunksPerFile += result.candidateMaxChunksPerFile;
		total.rerankTopChunkCount += result.rerankTopChunkCount;
		total.rerankTopUniqueFiles += result.rerankTopUniqueFiles;
		for (const [key, value] of Object.entries(result.chunkOverlap)) {
			chunkOverlap[key] = (chunkOverlap[key] ?? 0) + value;
		}
		for (const [key, value] of Object.entries(result.fileOverlap)) {
			fileOverlap[key] = (fileOverlap[key] ?? 0) + value;
		}
		for (const [key, value] of Object.entries(result.candidateWindows)) {
			candidateWindows[key] = (candidateWindows[key] ?? 0) + value;
		}
	}

	for (const key of Object.keys(chunkOverlap)) {
		chunkOverlap[key] /= count;
	}
	for (const key of Object.keys(fileOverlap)) {
		fileOverlap[key] /= count;
	}
	for (const key of Object.keys(candidateWindows)) {
		candidateWindows[key] /= count;
	}

	return {
		queryCount: results.length,
		candidateCount: total.candidateCount / count,
		candidateUniqueFiles: total.candidateUniqueFiles / count,
		candidateMaxChunksPerFile: total.candidateMaxChunksPerFile / count,
		rerankTopChunkCount: total.rerankTopChunkCount / count,
		rerankTopUniqueFiles: total.rerankTopUniqueFiles / count,
		chunkOverlap,
		fileOverlap,
		candidateWindows,
	};
}

function averageSummaries(runSummaries) {
	const out = new Map();
	for (const summary of runSummaries) {
		for (const [systemName, metrics] of summary.entries()) {
			const acc = out.get(systemName) ?? {
				mrr: 0,
				recall1: 0,
				recall5: 0,
				recall10: 0,
				avgFirstRank: 0,
			};
			acc.mrr += metrics.mrr;
			acc.recall1 += metrics.recall1;
			acc.recall5 += metrics.recall5;
			acc.recall10 += metrics.recall10;
			acc.avgFirstRank += metrics.avgFirstRank;
			out.set(systemName, acc);
		}
	}
	for (const metrics of out.values()) {
		metrics.mrr /= runSummaries.length;
		metrics.recall1 /= runSummaries.length;
		metrics.recall5 /= runSummaries.length;
		metrics.recall10 /= runSummaries.length;
		metrics.avgFirstRank /= runSummaries.length;
	}
	return out;
}

function averageCandidateSummaries(runSummaries) {
	const out = new Map();
	for (const summary of runSummaries) {
		for (const [systemName, metrics] of summary.entries()) {
			const acc = out.get(systemName) ?? {
				ap10: 0,
				ap20: 0,
				recall10: 0,
				recall20: 0,
				hits25: 0,
				noise10: 0,
				noise25: 0,
				front10: 0,
				avgFirstRank: 0,
			};
			acc.ap10 += metrics.ap10;
			acc.ap20 += metrics.ap20;
			acc.recall10 += metrics.recall10;
			acc.recall20 += metrics.recall20;
			acc.hits25 += metrics.hits25;
			acc.noise10 += metrics.noise10;
			acc.noise25 += metrics.noise25;
			acc.front10 += metrics.front10;
			acc.avgFirstRank += metrics.avgFirstRank;
			out.set(systemName, acc);
		}
	}
	for (const metrics of out.values()) {
		metrics.ap10 /= runSummaries.length;
		metrics.ap20 /= runSummaries.length;
		metrics.recall10 /= runSummaries.length;
		metrics.recall20 /= runSummaries.length;
		metrics.hits25 /= runSummaries.length;
		metrics.noise10 /= runSummaries.length;
		metrics.noise25 /= runSummaries.length;
		metrics.front10 /= runSummaries.length;
		metrics.avgFirstRank /= runSummaries.length;
	}
	return out;
}

function averageComplementSummaries(runSummaries) {
	const out = new Map();
	for (const summary of runSummaries) {
		for (const [systemName, metrics] of summary.entries()) {
			const acc = out.get(systemName) ?? {
				denseOnlyGain25: 0,
				bm25OnlyGain25: 0,
				unionGain25: 0,
			};
			acc.denseOnlyGain25 += metrics.denseOnlyGain25;
			acc.bm25OnlyGain25 += metrics.bm25OnlyGain25;
			acc.unionGain25 += metrics.unionGain25;
			out.set(systemName, acc);
		}
	}
	for (const metrics of out.values()) {
		metrics.denseOnlyGain25 /= runSummaries.length;
		metrics.bm25OnlyGain25 /= runSummaries.length;
		metrics.unionGain25 /= runSummaries.length;
	}
	return out;
}

function summarizeByFamily(run, accessor, summarizer) {
	const families = new Map();
	for (const [systemName, results] of accessor(run).entries()) {
		for (const result of results) {
			let familyMap = families.get(result.family);
			if (!familyMap) {
				familyMap = new Map();
				families.set(result.family, familyMap);
			}
			const bucket = familyMap.get(systemName) ?? [];
			bucket.push(result);
			familyMap.set(systemName, bucket);
		}
	}
	const summary = new Map();
	for (const [family, systemMap] of families.entries()) {
		const familySummary = new Map();
		for (const [systemName, results] of systemMap.entries()) {
			familySummary.set(systemName, summarizer(results));
		}
		summary.set(family, familySummary);
	}
	return summary;
}

function summarizeByEntryPath(run, accessor, summarizer) {
	const entryPaths = new Map();
	for (const [systemName, results] of accessor(run).entries()) {
		for (const result of results) {
			let entryMap = entryPaths.get(result.entryPath);
			if (!entryMap) {
				entryMap = new Map();
				entryPaths.set(result.entryPath, entryMap);
			}
			const bucket = entryMap.get(systemName) ?? [];
			bucket.push(result);
			entryMap.set(systemName, bucket);
		}
	}
	const summary = new Map();
	for (const [entryPath, systemMap] of entryPaths.entries()) {
		const entrySummary = new Map();
		for (const [systemName, results] of systemMap.entries()) {
			entrySummary.set(systemName, summarizer(results));
		}
		summary.set(entryPath, entrySummary);
	}
	return summary;
}

function setDifferenceSize(left, right) {
	let count = 0;
	for (const value of left) {
		if (!right.has(value)) {
			count += 1;
		}
	}
	return count;
}

function mergeExamples(items) {
	const merged = new Map();
	for (const item of items) {
		const key = `${item.family}|${item.query}`;
		const existing = merged.get(key);
		if (!existing || item.gain > existing.gain) {
			merged.set(key, item);
		}
	}
	return Array.from(merged.values()).sort((a, b) => b.gain - a.gain);
}

function formatMetric(value) {
	return Number.isFinite(value) ? value.toFixed(3) : "inf";
}

function formatOverlapCount(value, denom = RERANK_OVERLAP_TOP_K) {
	if (!Number.isFinite(value)) {
		return "n/a";
	}
	const share = denom > 0 ? (value / denom) * 100 : 0;
	return `${value.toFixed(2)} (${share.toFixed(0)}%)`;
}

function displayRank(rank) {
	return Number.isFinite(rank) ? String(rank) : "miss";
}

function formatMb(bytes) {
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatPercent(part, total) {
	if (total <= 0) {
		return "0.0%";
	}
	return `${((part / total) * 100).toFixed(1)}%`;
}

function sharedPrefixLength(left, right) {
	const limit = Math.min(left.length, right.length);
	let i = 0;
	while (i < limit && left.charCodeAt(i) === right.charCodeAt(i)) {
		i += 1;
	}
	return i;
}

function analyzeBm25Binary(index) {
	const termEntries = Object.entries(index.termDict).sort(
		(a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
	);
	const docLengthEntries = Object.entries(index.docLengths).sort(
		(a, b) => Number(a[0]) - Number(b[0]),
	);

	const stats = {
		headerBytes: 4 + varUintByteLength(index.docCount) + 4,
		termCountBytes: varUintByteLength(termEntries.length),
		termTextBytes: 0,
		termMetaBytes: 0,
		postingHeaderBytes: 0,
		postingDocDeltaBytes: 0,
		postingTfNormBytes: 0,
		postingPositionCountBytes: 0,
		postingPositionDeltaBytes: 0,
		docLengthDocIdBytes: 0,
		docLengthValueBytes: 0,
		termCount: termEntries.length,
		postingCount: 0,
		positionValueCount: 0,
		positionHeavyTerms: [],
	};

	let prevTerm = "";
	for (const [term, entry] of termEntries) {
		const prefixLength = sharedPrefixLength(prevTerm, term);
		const suffixBytes = Buffer.byteLength(term.slice(prefixLength), "utf8");
		stats.termMetaBytes +=
			varUintByteLength(entry.df) +
			varUintByteLength(prefixLength) +
			varUintByteLength(suffixBytes);
		stats.termTextBytes += suffixBytes;

		const list = index.postings[entry.termId];
		let listPositionBytes = 0;
		let listPositionCount = 0;
		let prevDocId = 0;
		for (const entry of list.entries) {
			stats.postingCount += 1;
			stats.postingDocDeltaBytes += varUintByteLength(entry.docId - prevDocId);
			prevDocId = entry.docId;
			stats.postingTfNormBytes += 1;
			stats.postingPositionCountBytes += varUintByteLength(entry.positions.length);
			listPositionCount += entry.positions.length;
			stats.positionValueCount += entry.positions.length;
			for (const delta of entry.positions) {
				const bytes = varUintByteLength(delta);
				stats.postingPositionDeltaBytes += bytes;
				listPositionBytes += bytes;
			}
		}
		stats.positionHeavyTerms.push({
			term,
			positionBytes: listPositionBytes + list.entries.length,
			positionCount: listPositionCount,
			df: list.entries.length,
		});
		prevTerm = term;
	}

	let prevDocId = 0;
	for (const [docId, length] of docLengthEntries) {
		const numericDocId = Number(docId);
		stats.docLengthDocIdBytes += varUintByteLength(numericDocId - prevDocId);
		prevDocId = numericDocId;
		stats.docLengthValueBytes += varUintByteLength(length);
	}

	const totalBytes =
		stats.headerBytes +
		stats.termCountBytes +
		stats.termTextBytes +
		stats.termMetaBytes +
		stats.postingHeaderBytes +
		stats.postingDocDeltaBytes +
		stats.postingTfNormBytes +
		stats.postingPositionCountBytes +
		stats.postingPositionDeltaBytes +
		stats.docLengthDocIdBytes +
		stats.docLengthValueBytes;

	const positionThresholds = [16, 32, 64, 128];
	const positionSavings = positionThresholds.map((threshold) => {
		let savedBytes = 0;
		let affectedTerms = 0;
		for (const [, entry] of termEntries) {
			const list = index.postings[entry.termId];
			if (list.entries.length <= threshold) continue;
			affectedTerms += 1;
			for (const entry of list.entries) {
				savedBytes +=
					varUintByteLength(entry.positions.length) +
					entry.positions.reduce((sum, delta) => sum + varUintByteLength(delta), 0);
			}
		}
		return { threshold, savedBytes, affectedTerms };
	});

	return {
		totalBytes,
		stats,
		positionSavings,
	};
}

function printBm25SizeReport(args, payload) {
	const bm25 = new BenchmarkBM25Engine({ proximity: true });
	for (const chunk of payload.chunkById.values()) {
		bm25.addDocumentTerms(chunk.id, chunk.tokens);
	}
	const analysis = analyzeBm25Binary(bm25.serialize());
	const { stats } = analysis;
	const total = analysis.totalBytes;

	console.log("");
	console.log("Hybrid BM25 Size Report");
	console.log("=======================");
	console.log(
		`logicalCorpus=${formatMb(payload.logicalBytes)}, files=${payload.fileCount}, chunks=${payload.chunkCount}, target=${args.targetLibraryMb}MB`,
	);
	console.log("offline-only: no API calls, no embedding requests, no rerank requests, no token usage");
	console.log("");
	console.log("Segments");
	console.log("--------");
	const rows = [
		["header", stats.headerBytes + stats.termCountBytes],
		["term-text", stats.termTextBytes],
		["term-meta", stats.termMetaBytes],
		["posting-header", stats.postingHeaderBytes],
		["posting-doc-delta", stats.postingDocDeltaBytes],
		["posting-tfNorm", stats.postingTfNormBytes],
		["posting-pos-count", stats.postingPositionCountBytes],
		["posting-pos-delta", stats.postingPositionDeltaBytes],
		["docLengths", stats.docLengthDocIdBytes + stats.docLengthValueBytes],
	];
	console.log("segment             bytes      share");
	for (const [name, bytes] of rows) {
		console.log(`${name.padEnd(18)} ${String(bytes).padStart(9)} ${formatPercent(bytes, total).padStart(9)}`);
	}

	console.log("");
	console.log("Totals");
	console.log("------");
	console.log(`bm25BlobBytes=${total}`);
	console.log(`termCount=${stats.termCount}, postingCount=${stats.postingCount}, positionValues=${stats.positionValueCount}`);
	console.log(
		`avgPositionsPerPosting=${stats.postingCount > 0 ? (stats.positionValueCount / stats.postingCount).toFixed(2) : "0.00"}`,
	);

	console.log("");
	console.log("Cheap Savings Estimates");
	console.log("----------------------");
	for (const item of analysis.positionSavings) {
		console.log(
			`drop positions when df > ${item.threshold}: save ~${item.savedBytes} bytes (${formatPercent(item.savedBytes, total)}), affectedTerms=${item.affectedTerms}`,
		);
	}

	console.log("");
	console.log("Top Position-Heavy Terms");
	console.log("------------------------");
	for (const item of stats.positionHeavyTerms
		.slice()
		.sort((a, b) => b.positionBytes - a.positionBytes)
		.slice(0, 10)) {
		console.log(
			`${item.term.padEnd(14)} df=${String(item.df).padStart(5)} posBytes=${String(item.positionBytes).padStart(8)} posCount=${String(item.positionCount).padStart(8)}`,
		);
	}
}

function runBm25SizeReport(args) {
	const corpus = buildCorpus({
		filesPerConcept: args.filesPerConcept,
		seed: args.seed,
		targetLibraryBytes: Math.round(args.targetLibraryMb * 1024 * 1024),
	});
	printBm25SizeReport(args, {
		chunkById: corpus.chunkById,
		fileCount: corpus.fileById.size,
		chunkCount: corpus.chunkById.size,
		logicalBytes: corpus.logicalBytes,
	});
}

function printSummary(args, runs) {
	const perRunFileOverall = runs.map((run) => {
		const summary = new Map();
		for (const [systemName, results] of run.fileSystems.entries()) {
			summary.set(systemName, summarizeSystemResults(results));
		}
		return summary;
	});
	const perRunCandidateOverall = runs.map((run) => {
		const summary = new Map();
		for (const [systemName, results] of run.candidateSystems.entries()) {
			summary.set(systemName, summarizeCandidateResults(results));
		}
		return summary;
	});
	const perRunComplementOverall = runs.map((run) => {
		const summary = new Map();
		for (const [systemName, results] of run.complementSystems.entries()) {
			summary.set(systemName, summarizeComplementResults(results));
		}
		return summary;
	});
	const averagedFiles = averageSummaries(perRunFileOverall);
	const averagedCandidates = averageCandidateSummaries(perRunCandidateOverall);
	const averagedComplements = averageComplementSummaries(perRunComplementOverall);
	const familyFileSummary = summarizeByFamily(
		runs[0],
		(run) => run.fileSystems,
		summarizeSystemResults,
	);
	const familyCandidateSummary = summarizeByFamily(
		runs[0],
		(run) => run.candidateSystems,
		summarizeCandidateResults,
	);
	const entryPathCandidateSummary = summarizeByEntryPath(
		runs[0],
		(run) => run.candidateSystems,
		summarizeCandidateResults,
	);

	console.log("");
	console.log("Hybrid Search Synthetic Benchmark");
	console.log("================================");
	console.log(
		`runs=${runs.length}, files=${runs[0].fileCount}, chunks=${runs[0].chunkCount}, logicalCorpus=${formatMb(runs[0].logicalBytes)}, target=${args.targetLibraryMb}MB, queries=${runs[0].queryCount}, recallLimit=${args.recallLimit}, topK=${args.topK}, difficulty=${args.difficulty}, denseBackend=${args.denseBackend}`,
	);
	console.log(
		`querySource=${runs[0].querySource.path ? runs[0].querySource.path : "built-in synthetic"}, suiteProfile=${runs[0].querySource.suiteProfile ?? "synthetic"}, suites=${runs[0].querySource.suiteNames.join(", ")}`,
	);
	console.log("offline-only: no API calls, no embedding requests, no rerank requests, no token usage");
	console.log("");
	console.log("Primary Candidate Goal (@25)");
	console.log("---------------------------");
	console.log("system          hits@25  noise@25  avg-first-hit");
	for (const systemName of [
		"bm25_prox",
		"dense",
		"source_union",
		"hybrid_merge",
	]) {
		const metrics = averagedCandidates.get(systemName);
		console.log(
			`${systemName.padEnd(14)} ${formatMetric(metrics.hits25).padStart(7)} ${formatMetric(metrics.noise25).padStart(9)} ${formatMetric(metrics.avgFirstRank).padStart(13)}`,
		);
	}

	console.log("");
	console.log("Stress Candidate Goal (@10)");
	console.log("---------------------------");
	console.log("system          r@10   noise@10  front@10");
	for (const systemName of [
		"bm25_prox",
		"dense",
		"source_union",
		"hybrid_merge",
	]) {
		const metrics = averagedCandidates.get(systemName);
		console.log(
			`${systemName.padEnd(14)} ${formatMetric(metrics.recall10).padStart(6)} ${formatMetric(metrics.noise10).padStart(9)} ${formatMetric(metrics.front10).padStart(9)}`,
		);
	}

	console.log("");
	console.log("Candidate Coverage By Entry Path (hits@25)");
	console.log("-----------------------------------------");
	console.log("entry-path            bm25_prox  dense     union     merge");
	for (const entryPath of ["direct_hybrid", "lexical_fallback_like", "mixed_entry"]) {
		const row = entryPathCandidateSummary.get(entryPath);
		if (!row) continue;
		console.log(
			`${entryPath.padEnd(21)} ${formatMetric(row.get("bm25_prox").hits25).padStart(9)} ${formatMetric(row.get("dense").hits25).padStart(9)} ${formatMetric(row.get("source_union").hits25).padStart(9)} ${formatMetric(row.get("hybrid_merge").hits25).padStart(9)}`,
		);
	}

	console.log("");
	console.log("Candidate Coverage By Family (hits@25)");
	console.log("--------------------------------------");
	console.log("family          bm25_prox  dense     union     merge");
	for (const family of ["lexical", "phrase", "semantic", "mixed"]) {
		const row = familyCandidateSummary.get(family);
		if (!row) continue;
		console.log(
			`${family.padEnd(14)} ${formatMetric(row.get("bm25_prox").hits25).padStart(9)} ${formatMetric(row.get("dense").hits25).padStart(9)} ${formatMetric(row.get("source_union").hits25).padStart(9)} ${formatMetric(row.get("hybrid_merge").hits25).padStart(9)}`,
		);
	}

	console.log("");
	console.log("Complementarity (@25)");
	console.log("--------------------");
	console.log("comparison             dense-only  bm25-only  union-gain");
	for (const systemName of ["bm25_prox_vs_dense", "bm25_base_vs_dense"]) {
		const metrics = averagedComplements.get(systemName);
		console.log(
			`${systemName.padEnd(21)} ${formatMetric(metrics.denseOnlyGain25).padStart(10)} ${formatMetric(metrics.bm25OnlyGain25).padStart(10)} ${formatMetric(metrics.unionGain25).padStart(11)}`,
		);
	}

	console.log("");
	console.log("Secondary Candidate Metrics");
	console.log("---------------------------");
	console.log("system          ap@10  ap@20  r@10   r@20");
	for (const systemName of [
		"bm25_prox",
		"dense",
		"source_union",
		"hybrid_merge",
	]) {
		const metrics = averagedCandidates.get(systemName);
		console.log(
			`${systemName.padEnd(14)} ${formatMetric(metrics.ap10).padStart(5)} ${formatMetric(metrics.ap20).padStart(6)} ${formatMetric(metrics.recall10).padStart(6)} ${formatMetric(metrics.recall20).padStart(6)}`,
		);
	}

	console.log("");
	console.log("File Ranking Quality");
	console.log("--------------------");
	console.log("system                mrr    r@1    r@5    r@10   avg-first-rank");
	for (const systemName of [
		"bm25_base",
		"bm25_prox",
		"dense",
		"source_union",
		"hybrid_merge",
		"hybrid_rerank",
	]) {
		const metrics = averagedFiles.get(systemName);
		const label =
			systemName === "hybrid_rerank" ? "hybrid_rerank*" : systemName;
		console.log(
			`${label.padEnd(20)} ${formatMetric(metrics.mrr).padStart(5)} ${formatMetric(metrics.recall1).padStart(6)} ${formatMetric(metrics.recall5).padStart(6)} ${formatMetric(metrics.recall10).padStart(6)} ${formatMetric(metrics.avgFirstRank).padStart(14)}`,
		);
	}

	console.log("");
	console.log("File Ranking By Family (MRR)");
	console.log("----------------------------");
	console.log("family          bm25_base  bm25_prox  dense     union     merge     rerank*");
	for (const family of ["lexical", "phrase", "semantic", "mixed"]) {
		const row = familyFileSummary.get(family);
		if (!row) continue;
		console.log(
			`${family.padEnd(14)} ${formatMetric(row.get("bm25_base").mrr).padStart(9)} ${formatMetric(row.get("bm25_prox").mrr).padStart(10)} ${formatMetric(row.get("dense").mrr).padStart(9)} ${formatMetric(row.get("source_union").mrr).padStart(9)} ${formatMetric(row.get("hybrid_merge").mrr).padStart(9)} ${formatMetric(row.get("hybrid_rerank").mrr).padStart(10)}`,
		);
	}

	console.log("");
	console.log("* rerank is a local surrogate only, used for pipeline sanity-checks.");
	console.log("");
	console.log("Largest Proximity Wins");
	console.log("----------------------");
	for (const example of mergeExamples(runs.flatMap((run) => run.proximityExamples)).slice(0, 5)) {
		console.log(
			`${example.query}  [${example.family}]  rank ${displayRank(example.from)} -> ${displayRank(example.to)}`,
		);
	}

	console.log("");
	console.log("Largest Surrogate Rerank Wins");
	console.log("-----------------------------");
	for (const example of mergeExamples(runs.flatMap((run) => run.rerankExamples)).slice(0, 5)) {
		console.log(
			`${example.query}  [${example.family}]  rank ${displayRank(example.from)} -> ${displayRank(example.to)}`,
		);
	}
}

function summarizeAveragedRunBundle(runs) {
	const perRunFileOverall = runs.map((run) => {
		const summary = new Map();
		for (const [systemName, results] of run.fileSystems.entries()) {
			summary.set(systemName, summarizeSystemResults(results));
		}
		return summary;
	});
	const perRunCandidateOverall = runs.map((run) => {
		const summary = new Map();
		for (const [systemName, results] of run.candidateSystems.entries()) {
			summary.set(systemName, summarizeCandidateResults(results));
		}
		return summary;
	});
	const perRunComplementOverall = runs.map((run) => {
		const summary = new Map();
		for (const [systemName, results] of run.complementSystems.entries()) {
			summary.set(systemName, summarizeComplementResults(results));
		}
		return summary;
	});
	const perRunEntryCandidate = runs.map((run) =>
		summarizeByEntryPath(run, (currentRun) => currentRun.candidateSystems, summarizeCandidateResults),
	);
	return {
		candidate: averageCandidateSummaries(perRunCandidateOverall).get("source_union"),
		merge: averageCandidateSummaries(perRunCandidateOverall).get("hybrid_merge"),
		dense: averageCandidateSummaries(perRunCandidateOverall).get("dense"),
		bm25: averageCandidateSummaries(perRunCandidateOverall).get("bm25_prox"),
		complement: averageComplementSummaries(perRunComplementOverall).get("bm25_prox_vs_dense"),
		file: averageSummaries(perRunFileOverall).get("source_union"),
		entryCandidate: averageNestedCandidateSummaries(perRunEntryCandidate),
		corpus: {
			fileCount: runs[0].fileCount,
			chunkCount: runs[0].chunkCount,
			logicalBytes: runs[0].logicalBytes,
		},
	};
}

function averageNestedCandidateSummaries(runSummaries) {
	const out = new Map();
	for (const summary of runSummaries) {
		for (const [entryPath, systemMap] of summary.entries()) {
			let entryAcc = out.get(entryPath);
			if (!entryAcc) {
				entryAcc = new Map();
				out.set(entryPath, entryAcc);
			}
			for (const [systemName, metrics] of systemMap.entries()) {
				const acc = entryAcc.get(systemName) ?? {
					ap10: 0,
					ap20: 0,
					recall10: 0,
					recall20: 0,
					hits25: 0,
					noise10: 0,
					noise25: 0,
					front10: 0,
					avgFirstRank: 0,
				};
				acc.ap10 += metrics.ap10;
				acc.ap20 += metrics.ap20;
				acc.recall10 += metrics.recall10;
				acc.recall20 += metrics.recall20;
				acc.hits25 += metrics.hits25;
				acc.noise10 += metrics.noise10;
				acc.noise25 += metrics.noise25;
				acc.front10 += metrics.front10;
				acc.avgFirstRank += metrics.avgFirstRank;
				entryAcc.set(systemName, acc);
			}
		}
	}
	for (const entryAcc of out.values()) {
		for (const metrics of entryAcc.values()) {
			metrics.ap10 /= runSummaries.length;
			metrics.ap20 /= runSummaries.length;
			metrics.recall10 /= runSummaries.length;
			metrics.recall20 /= runSummaries.length;
			metrics.hits25 /= runSummaries.length;
			metrics.noise10 /= runSummaries.length;
			metrics.noise25 /= runSummaries.length;
			metrics.front10 /= runSummaries.length;
			metrics.avgFirstRank /= runSummaries.length;
		}
	}
	return out;
}

function scoreTuningResult(summary) {
	const candidate = summary.candidate;
	const dense = summary.dense;
	const bm25 = summary.bm25;
	const complement = summary.complement;
	const file = summary.file;
	const directHybrid = summary.entryCandidate.get("direct_hybrid")?.get("source_union") ?? candidate;
	const lexicalFallback =
		summary.entryCandidate.get("lexical_fallback_like")?.get("source_union") ?? candidate;
	const mixedEntry = summary.entryCandidate.get("mixed_entry")?.get("source_union") ?? candidate;
	const directHybridBm25 =
		summary.entryCandidate.get("direct_hybrid")?.get("bm25_prox") ?? bm25;
	const lexicalFallbackDense =
		summary.entryCandidate.get("lexical_fallback_like")?.get("dense") ?? dense;
	const firstHitPenalty = Number.isFinite(candidate.avgFirstRank)
		? Math.min(0.04, candidate.avgFirstRank * 0.006)
		: 0.04;
	const firstRankPenalty = Number.isFinite(file.avgFirstRank)
		? Math.min(0.03, file.avgFirstRank * 0.004)
		: 0.03;
	return (
		lexicalFallback.hits25 * 0.24 +
		directHybrid.hits25 * 0.15 +
		mixedEntry.hits25 * 0.08 +
		candidate.hits25 * 0.14 +
		lexicalFallback.recall10 * 0.04 +
		directHybrid.recall10 * 0.03 +
		candidate.front10 * 0.04 +
		lexicalFallbackDense.hits25 * 0.1 +
		directHybridBm25.hits25 * 0.06 +
		complement.denseOnlyGain25 * 0.12 +
		complement.bm25OnlyGain25 * 0.05 +
		(1 - candidate.noise10) * 0.03 +
		(1 - candidate.noise25) * 0.03 +
		file.recall10 * 0.03 -
		firstHitPenalty -
		firstRankPenalty
	);
}

function printTuningSummary(args, rankedConfigs, corpusSummary) {
	console.log("");
	console.log("Hybrid Search Tuning Sweep");
	console.log("==========================");
	console.log(
		`configs=${rankedConfigs.length}, logicalCorpus=${formatMb(corpusSummary.logicalBytes)}, files=${corpusSummary.fileCount}, chunks=${corpusSummary.chunkCount}, runs=${args.runs}, difficulty=${args.difficulty}, denseBackend=${args.denseBackend}`,
	);
	console.log(
		`querySource=${rankedConfigs[0].runs?.[0]?.querySource?.path ?? "built-in synthetic"}, suiteProfile=${rankedConfigs[0].runs?.[0]?.querySource?.suiteProfile ?? "synthetic"}`,
	);
	console.log("offline-only: no API calls, no embedding requests, no rerank requests, no token usage");
	console.log("");
	console.log("Top Configs");
	console.log("-----------");
	console.log("rank  score  config                              union-h25  union-r10  front10  noise10");
	rankedConfigs.slice(0, 10).forEach((item, index) => {
		console.log(
			`${String(index + 1).padEnd(5)} ${formatMetric(item.score).padEnd(6)} ${item.config.name.padEnd(34)} ${formatMetric(item.summary.candidate.hits25).padStart(9)} ${formatMetric(item.summary.candidate.recall10).padStart(10)} ${formatMetric(item.summary.candidate.front10).padStart(8)} ${formatMetric(item.summary.candidate.noise10).padStart(8)}`,
		);
	});

	console.log("");
	console.log("Recommended Default");
	console.log("-------------------");
	const best = rankedConfigs[0];
	console.log(`name=${best.config.name}`);
	console.log(
		`bm25Recall=${best.config.bm25RecallLimit}, denseRecall=${best.config.denseRecallLimit}, useProximity=${best.config.useProximity}`,
	);
	if (best.config.entryRecallPlan) {
		console.log(`entryBudgets=${describeEntryAwarePlan(best.config.entryRecallPlan)}`);
	}
	console.log(
		`lexicalMul=${best.config.profileTuning.lexicalWeightMultiplier}, vecMul=${best.config.profileTuning.vecWeightMultiplier}, vecMinDelta=${best.config.profileTuning.vecMinScoreDelta}`,
	);
	console.log(
		`bm25Rrf=${best.config.mergeTuning.bm25RrfWeight}, vecRrf=${best.config.mergeTuning.vecRrfWeight}`,
	);
	console.log("");
	console.log("Why It Won");
	console.log("----------");
	console.log(
		`union hits@25=${formatMetric(best.summary.candidate.hits25)}, dense-only gain@25=${formatMetric(best.summary.complement.denseOnlyGain25)}, bm25-only gain@25=${formatMetric(best.summary.complement.bm25OnlyGain25)}, noise@25=${formatMetric(best.summary.candidate.noise25)}`,
	);
	const directHybrid = best.summary.entryCandidate.get("direct_hybrid")?.get("source_union");
	const lexicalFallback =
		best.summary.entryCandidate.get("lexical_fallback_like")?.get("source_union");
	const mixedEntry = best.summary.entryCandidate.get("mixed_entry")?.get("source_union");
	if (directHybrid || lexicalFallback || mixedEntry) {
		console.log(
			`entry union hits@25: direct=${formatMetric(directHybrid?.hits25 ?? NaN)}, fallback=${formatMetric(lexicalFallback?.hits25 ?? NaN)}, mixed=${formatMetric(mixedEntry?.hits25 ?? NaN)}`,
		);
	}
}

function runTuningSweep(args) {
	const configs = buildTuningConfigs();
	const rankedConfigs = [];
	for (const config of configs) {
		const runs = [];
		for (let i = 0; i < args.runs; i++) {
			runs.push(evaluateRun(args, i, config));
		}
		const summary = summarizeAveragedRunBundle(runs);
		rankedConfigs.push({
			config,
			runs,
			summary,
			score: scoreTuningResult(summary),
		});
	}
	rankedConfigs.sort((a, b) => b.score - a.score);
	printTuningSummary(args, rankedConfigs, rankedConfigs[0].summary.corpus);
}

function buildBudgetCompareConfigs() {
	const allConfigs = buildTuningConfigs();
	return DEFAULT_BUDGET_COMPARE_NAMES
		.map((name) => allConfigs.find((config) => config.name === name))
		.filter(Boolean);
}

function printBudgetCompareSummary(args, rows) {
	console.log("");
	console.log("Hybrid Budget Compare");
	console.log("=====================");
	console.log(
		`logicalSizes=${args.sizes.join(", ")}MB, runs=${args.runs}, difficulty=${args.difficulty}, denseBackend=${args.denseBackend}, mode=offline-in-memory`,
	);
	console.log("offline-only: no API calls, no embedding requests, no rerank requests, no token usage");
	for (const suiteProfile of ["daily", "holdout"]) {
		console.log("");
		console.log(`${suiteProfile.toUpperCase()} (@25)`);
		console.log("-".repeat(suiteProfile.length + 7));
		console.log("sizeMB  config                                union-h25  merge-h25  fallback-union  dense-g25  bm25-g25");
		for (const row of rows) {
			for (const item of row[suiteProfile]) {
				console.log(
					`${String(row.sizeMb).padEnd(7)} ${item.name.padEnd(36)} ${formatMetric(item.summary.candidate.hits25).padStart(9)} ${formatMetric(item.summary.merge.hits25).padStart(9)} ${formatMetric(item.summary.entryCandidate.get("lexical_fallback_like")?.get("source_union")?.hits25 ?? NaN).padStart(14)} ${formatMetric(item.summary.complement.denseOnlyGain25).padStart(10)} ${formatMetric(item.summary.complement.bm25OnlyGain25).padStart(9)}`,
				);
			}
		}
	}
}

function runBudgetCompare(args) {
	const configs = buildBudgetCompareConfigs();
	const rows = [];
	for (const sizeMb of args.sizes) {
		const row = {
			sizeMb,
			daily: [],
			holdout: [],
		};
		for (const suiteProfile of ["daily", "holdout"]) {
			for (const config of configs) {
				const runs = [];
				for (let i = 0; i < args.runs; i++) {
					runs.push(
						evaluateRun(
							{
								...args,
								mode: "regression",
								targetLibraryMb: sizeMb,
								suiteProfile,
							},
							i,
							config,
						),
					);
				}
				row[suiteProfile].push({
					name: config.name,
					summary: summarizeAveragedRunBundle(runs),
				});
			}
		}
		rows.push(row);
	}
	printBudgetCompareSummary(args, rows);
}

function evaluateArgsBundle(args) {
	const runs = [];
	for (let i = 0; i < args.runs; i++) {
		runs.push(evaluateRun(args, i));
	}
	return summarizeAveragedRunBundle(runs);
}

function printSizeSweepSummary(args, rows) {
	console.log("");
	console.log("Hybrid Search Size Sweep");
	console.log("========================");
	console.log(
		`logicalSizes=${args.sizes.join(", ")}MB, runs=${args.runs}, difficulty=${args.difficulty}, denseBackend=${args.denseBackend}, mode=offline-in-memory`,
	);
	console.log("offline-only: no API calls, no embedding requests, no rerank requests, no token usage");
	console.log("");
	console.log("Daily Regression (@25)");
	console.log("----------------------");
	console.log("sizeMB  files  chunks  bm25-h25  dense-h25  union-h25  merge-h25  fallback-union");
	for (const row of rows) {
		console.log(
			`${String(row.sizeMb).padEnd(7)} ${String(row.daily.corpus.fileCount).padEnd(6)} ${String(row.daily.corpus.chunkCount).padEnd(7)} ${formatMetric(row.daily.bm25.hits25).padStart(8)} ${formatMetric(row.daily.dense.hits25).padStart(9)} ${formatMetric(row.daily.candidate.hits25).padStart(9)} ${formatMetric(row.daily.merge.hits25).padStart(9)} ${formatMetric(row.daily.fallbackUnion?.hits25 ?? NaN).padStart(14)}`,
		);
	}
	console.log("");
	console.log("Holdout Regression (@25)");
	console.log("------------------------");
	console.log("sizeMB  files  chunks  bm25-h25  dense-h25  union-h25  merge-h25  fallback-union");
	for (const row of rows) {
		console.log(
			`${String(row.sizeMb).padEnd(7)} ${String(row.holdout.corpus.fileCount).padEnd(6)} ${String(row.holdout.corpus.chunkCount).padEnd(7)} ${formatMetric(row.holdout.bm25.hits25).padStart(8)} ${formatMetric(row.holdout.dense.hits25).padStart(9)} ${formatMetric(row.holdout.candidate.hits25).padStart(9)} ${formatMetric(row.holdout.merge.hits25).padStart(9)} ${formatMetric(row.holdout.fallbackUnion?.hits25 ?? NaN).padStart(14)}`,
		);
	}
	console.log("");
	console.log("Interpretation");
	console.log("--------------");
	console.log("- `union-h25` is the main first-stage coverage signal.");
	console.log("- `fallback-union` isolates the semantic-rewrite / lexical-fallback-like path.");
	console.log("- compare `daily` vs `holdout` to spot likely overfitting.");
}

function printRerankSourceOverlapSummary(args, runs) {
	const overallSummary = summarizeRerankSourceOverlap(
		runs.flatMap((run) => run.rerankSourceOverlapResults),
	);
	const entrySummary = new Map();
	for (const run of runs) {
		for (const result of run.rerankSourceOverlapResults) {
			const bucket = entrySummary.get(result.entryPath) ?? [];
			bucket.push(result);
			entrySummary.set(result.entryPath, bucket);
		}
	}

	console.log("");
	console.log("Hybrid Rerank Source Overlap");
	console.log("============================");
	console.log(
		`runs=${runs.length}, queries=${runs[0].queryCount}, recallLimit=${args.recallLimit}, topK=${args.topK}, difficulty=${args.difficulty}, denseBackend=${args.denseBackend}`,
	);
	console.log(
		`querySource=${runs[0].querySource.path ? runs[0].querySource.path : "built-in synthetic"}, suiteProfile=${runs[0].querySource.suiteProfile ?? "synthetic"}, suites=${runs[0].querySource.suiteNames.join(", ")}`,
	);
	console.log("offline-only: no API calls, no embedding requests, no rerank requests, no token usage");
	console.log("");
	console.log("Overall");
	console.log("-------");
	console.log(
		`candidateCount=${overallSummary.candidateCount.toFixed(2)}, uniqueFiles=${overallSummary.candidateUniqueFiles.toFixed(2)}, maxChunksPerFile=${overallSummary.candidateMaxChunksPerFile.toFixed(2)}, rerankTop5UniqueFiles=${overallSummary.rerankTopUniqueFiles.toFixed(2)}`,
	);

	console.log("");
	console.log("Chunk Overlap With Rerank Top5");
	console.log("------------------------------");
	console.log("entryPath              queries  union@5         union@10        union@15        bm25@5          bm25@10         bm25@15         dense@5         dense@10        dense@15");
	for (const entryPath of ["direct_hybrid", "lexical_fallback_like", "mixed_entry"]) {
		const results = entrySummary.get(entryPath);
		if (!results || results.length === 0) continue;
		const summary = summarizeRerankSourceOverlap(results);
		console.log(
			`${entryPath.padEnd(21)} ${String(summary.queryCount).padStart(6)}  ${formatOverlapCount(summary.chunkOverlap.union_5).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.union_10).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.union_15).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.bm25_5).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.bm25_10).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.bm25_15).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.dense_5).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.dense_10).padStart(13)} ${formatOverlapCount(summary.chunkOverlap.dense_15).padStart(13)}`,
		);
	}

	console.log("");
	console.log("Candidate Window Size");
	console.log("---------------------");
	console.log("entryPath              union@5-size  union@10-size  union@15-size  candidateCount  uniqueFiles");
	for (const entryPath of ["direct_hybrid", "lexical_fallback_like", "mixed_entry"]) {
		const results = entrySummary.get(entryPath);
		if (!results || results.length === 0) continue;
		const summary = summarizeRerankSourceOverlap(results);
		console.log(
			`${entryPath.padEnd(21)} ${summary.candidateWindows.union_5.toFixed(2).padStart(12)} ${summary.candidateWindows.union_10.toFixed(2).padStart(14)} ${summary.candidateWindows.union_15.toFixed(2).padStart(14)} ${summary.candidateCount.toFixed(2).padStart(14)} ${summary.candidateUniqueFiles.toFixed(2).padStart(12)}`,
		);
	}

	console.log("");
	console.log("Interpretation");
	console.log("--------------");
	console.log("- `union@N` means rerank top5 chunks already covered by the deduped union of BM25 topN and dense topN.");
	console.log("- If `union@15` is already near 5.00, cutting each source to 15 is probably low risk for rerank top5 chunk coverage.");
	console.log("- Compare `bm25@N` vs `dense@N` to see which source contributes more directly to the final rerank top5.");
}

function runSizeSweep(args) {
	const rows = [];
	for (const sizeMb of args.sizes) {
		const dailyArgs = {
			...args,
			mode: "regression",
			targetLibraryMb: sizeMb,
			suiteProfile: "daily",
		};
		const holdoutArgs = {
			...args,
			mode: "regression",
			targetLibraryMb: sizeMb,
			suiteProfile: "holdout",
		};
		const daily = evaluateArgsBundle(dailyArgs);
		const holdout = evaluateArgsBundle(holdoutArgs);
		rows.push({
			sizeMb,
			daily: {
				...daily,
				fallbackUnion: daily.entryCandidate.get("lexical_fallback_like")?.get("source_union"),
			},
			holdout: {
				...holdout,
				fallbackUnion: holdout.entryCandidate.get("lexical_fallback_like")?.get("source_union"),
			},
		});
	}
	printSizeSweepSummary(args, rows);
}

function main() {
	const args = parseArgs(process.argv);
	if (args.mode === "bm25-size") {
		runBm25SizeReport(args);
		return;
	}
	if (args.mode === "budget-compare") {
		runBudgetCompare(args);
		return;
	}
	if (args.mode === "size-sweep") {
		runSizeSweep(args);
		return;
	}
	if (args.mode === "rerank-source-overlap") {
		const runs = [];
		for (let i = 0; i < args.runs; i++) {
			runs.push(evaluateRun(args, i));
		}
		printRerankSourceOverlapSummary(args, runs);
		return;
	}
	if (args.mode === "tune" || args.mode === "tune-regression") {
		runTuningSweep(args);
		return;
	}
	const runs = [];
	for (let i = 0; i < args.runs; i++) {
		runs.push(evaluateRun(args, i));
	}
	printSummary(args, runs);
}

main();
