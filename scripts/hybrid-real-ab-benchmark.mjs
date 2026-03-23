import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let cutForSearch = null;
try {
	({ cut_for_search: cutForSearch } = require("jieba-wasm"));
} catch (_error) {
	cutForSearch = null;
}

const DEFAULT_CASE_LIMIT = 14;
const DEFAULT_TARGET_TOKENS = 300;
const DEFAULT_MAX_FILES_PER_QUERY = 12;
const DEFAULT_MAX_QUERIES_PER_DOC = 2;
const DEFAULT_CONTEXT_MAX_DEPTH = 4;
const DEFAULT_CONTEXT_VARIANTS = "14,15,16,18,20,22,24,25,26,28,30,32,33,35,40,adaptive";
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "scripts", "hybrid-real-ab-benchmark.output.json");
const DEFAULT_SOURCE_CUTOFFS = "6,8,10,12,14,16,18,20,24,28,30";
const DEFAULT_BM25_CUTOFFS = "6,8,10,12,14,16,18,20";
const DEFAULT_DENSE_CUTOFFS = "6,8,10,12,14,16,18,20,24,28,30";
const DEFAULT_FULL_BM25_CUTOFF = 20;
const DEFAULT_FULL_DENSE_CUTOFF = 30;
const DEFAULT_RERANK_TOP_N = 5;
const DEFAULT_MAX_CASES_PER_STYLE = 4;
const DEFAULT_MAX_QUERY_TOKENS = 12;
const DEFAULT_MAX_QUERY_COUNT = 12;

const ADAPTIVE_LABEL = "adaptive";
const BASE_BUDGET = 18;
const TOTAL_BUDGET = 30;
const FILE_MIN_BUDGET = 4;
const FILE_MAX_BUDGET = 6;
const CHINESE_REGEX = /[\u4e00-\u9fa5]/u;
const SEGMENT_REGEX = /[\[\]{}()<>\s]+/u;
const SEPERATOR_REGEX =
	/[\^=#%\/\*,\.`:;\?@\s\u00A0\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u1680\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2000-\u200A\u2010-\u2029\u202F-\u2043\u2045-\u2051\u2053-\u205F\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u3000-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/u;
const HYPHEN_AND_CAMEL_CASE_REGEX = /[-_]|([a-z](?=[A-Z]))/g;

const LOW_SIGNAL = new Set([
	"welcome", "task", "tasks", "todo", "daily", "weekly", "monthly", "yearly",
	"journal", "log", "logs", "note", "notes", "record", "records", "idea",
	"ideas", "summary", "summaries", "记录", "想法", "笔记", "任务", "待办",
	"欢迎", "总结", "随想", "杂记", "日志", "日记", "周记", "月记", "年记",
]);
const STOP = new Set([
	"the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "by", "with",
	"from", "welcome", "daily", "weekly", "monthly", "yearly", "journal", "log",
	"logs", "task", "tasks", "todo", "note", "notes", "record", "records",
	"idea", "ideas", "summary", "summaries",
]);

function stripFrontmatter(text) {
	const source = String(text);
	if (!source.startsWith("---")) return source;
	const end = source.indexOf("\n---", 3);
	if (end < 0) return source;
	return source.slice(end + 4).replace(/^\r?\n/, "");
}

function shouldSkipQueryLine(line) {
	const trimmed = compact(line);
	if (!trimmed) return true;
	if (/^(```|~~~)/.test(trimmed)) return true;
	if (/^#{1,6}\s+/.test(trimmed)) return true;
	if (/^https?:\/\//i.test(trimmed)) return true;
	if (/^!\[/.test(trimmed)) return true;
	if (/^\[!/.test(trimmed)) return true;
	if (/^[>|-]/.test(trimmed)) return true;
	if (/^(title|aliases|created at|modified at|created|modified|tags|tag|date|updated|source)\s*:/i.test(trimmed)) {
		return true;
	}
	if (/^[A-Za-z0-9 _-]{1,24}:\s+\S/.test(trimmed)) {
		return true;
	}
	return false;
}

function extractQueryBodyText(text) {
	const source = stripFrontmatter(text);
	return source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => !shouldSkipQueryLine(line))
		.slice(0, 80)
		.join("\n");
}

function pickContentPhrases(text, limit = 6) {
	const lines = extractQueryBodyText(text)
		.split(/\r?\n/)
		.map((line) => compact(line))
		.filter(Boolean);
	const phrases = [];
	for (const line of lines) {
		const words = line
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/[*_`~!]/g, " ")
			.replace(/[()[\]{}<>|]/g, " ")
			.split(/\s+/)
			.filter(Boolean)
			.filter((word) => !STOP.has(word.toLowerCase()))
			.slice(0, 4);
		const phrase = compact(words.join(" "));
		if (!phrase) continue;
		if (/^[0-9:/\-. ]+$/.test(phrase)) continue;
		if (phrases.includes(phrase)) continue;
		phrases.push(phrase);
		if (phrases.length >= limit) break;
	}
	return phrases;
}

function isLowSignalBasename(text) {
	const value = compact(text).toLowerCase();
	if (!value) return true;
	if (/^\d{4}[-_./]?\d{2}[-_./]?\d{2}$/.test(value)) return true;
	if (/^\d{6,}$/.test(value)) return true;
	if (value === "today" || value === "welcome") return true;
	return false;
}

function parseArgs(argv) {
	const args = {
		mode: "api-ab",
		vaultRoot: "",
		caseLimit: DEFAULT_CASE_LIMIT,
		targetTokens: DEFAULT_TARGET_TOKENS,
		maxFilesPerQuery: DEFAULT_MAX_FILES_PER_QUERY,
		maxQueriesPerDoc: DEFAULT_MAX_QUERIES_PER_DOC,
		contextMaxDepth: DEFAULT_CONTEXT_MAX_DEPTH,
		contextVariants: DEFAULT_CONTEXT_VARIANTS.split(","),
		sourceCutoffs: DEFAULT_SOURCE_CUTOFFS.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0),
		bm25Cutoffs: DEFAULT_BM25_CUTOFFS.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0),
		denseCutoffs: DEFAULT_DENSE_CUTOFFS.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0),
		fullBm25Cutoff: DEFAULT_FULL_BM25_CUTOFF,
		fullDenseCutoff: DEFAULT_FULL_DENSE_CUTOFF,
		rerankTopN: DEFAULT_RERANK_TOP_N,
		maxCasesPerStyle: DEFAULT_MAX_CASES_PER_STYLE,
		maxQueryTokens: DEFAULT_MAX_QUERY_TOKENS,
		maxQueryCount: DEFAULT_MAX_QUERY_COUNT,
		entryPathFilter: "",
		styleFilter: "",
		queryFile: "",
		minDifficulty: 0.05,
		minCandidateCount: 12,
		minUniqueFiles: 3,
		caseStart: 0,
		caseCount: 0,
		output: DEFAULT_OUTPUT_PATH,
		dryRun: false,
		seed: 7,
	};
	for (const arg of argv.slice(2)) {
		if (arg === "--dry-run") args.dryRun = true;
		else if (arg.startsWith("--mode=")) args.mode = arg.slice(7);
		else if (arg.startsWith("--vault-root=")) args.vaultRoot = path.resolve(process.cwd(), arg.slice(13));
		else if (arg.startsWith("--case-limit=")) args.caseLimit = Number(arg.slice(13)) || DEFAULT_CASE_LIMIT;
		else if (arg.startsWith("--target-tokens=")) args.targetTokens = Number(arg.slice(16)) || DEFAULT_TARGET_TOKENS;
		else if (arg.startsWith("--max-files-per-query=")) args.maxFilesPerQuery = Number(arg.slice(22)) || DEFAULT_MAX_FILES_PER_QUERY;
		else if (arg.startsWith("--max-queries-per-doc=")) args.maxQueriesPerDoc = Number(arg.slice(22)) || DEFAULT_MAX_QUERIES_PER_DOC;
		else if (arg.startsWith("--context-max-depth=")) args.contextMaxDepth = Number(arg.slice(20)) || DEFAULT_CONTEXT_MAX_DEPTH;
		else if (arg.startsWith("--context-budgets=")) args.contextVariants = arg.slice(18).split(",").map((v) => v.trim()).filter(Boolean);
		else if (arg.startsWith("--source-cutoffs=")) args.sourceCutoffs = arg.slice(17).split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
		else if (arg.startsWith("--bm25-cutoffs=")) args.bm25Cutoffs = arg.slice(15).split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
		else if (arg.startsWith("--dense-cutoffs=")) args.denseCutoffs = arg.slice(16).split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
		else if (arg.startsWith("--full-bm25-cutoff=")) args.fullBm25Cutoff = Number(arg.slice(19)) || DEFAULT_FULL_BM25_CUTOFF;
		else if (arg.startsWith("--full-dense-cutoff=")) args.fullDenseCutoff = Number(arg.slice(20)) || DEFAULT_FULL_DENSE_CUTOFF;
		else if (arg.startsWith("--rerank-top-n=")) args.rerankTopN = Number(arg.slice(16)) || DEFAULT_RERANK_TOP_N;
		else if (arg.startsWith("--max-cases-per-style=")) args.maxCasesPerStyle = Number(arg.slice(22)) || DEFAULT_MAX_CASES_PER_STYLE;
		else if (arg.startsWith("--max-query-tokens=")) args.maxQueryTokens = Number(arg.slice(19)) || DEFAULT_MAX_QUERY_TOKENS;
		else if (arg.startsWith("--max-query-count=")) args.maxQueryCount = Number(arg.slice(18)) || DEFAULT_MAX_QUERY_COUNT;
		else if (arg.startsWith("--entry-path=")) args.entryPathFilter = arg.slice(13).trim();
		else if (arg.startsWith("--style-filter=")) args.styleFilter = arg.slice(15).trim();
		else if (arg.startsWith("--query-file=")) args.queryFile = path.resolve(process.cwd(), arg.slice(13));
		else if (arg.startsWith("--min-difficulty=")) args.minDifficulty = Number(arg.slice(17));
		else if (arg.startsWith("--min-candidate-count=")) args.minCandidateCount = Number(arg.slice(22));
		else if (arg.startsWith("--min-unique-files=")) args.minUniqueFiles = Number(arg.slice(19));
		else if (arg.startsWith("--case-start=")) args.caseStart = Math.max(0, Number(arg.slice(13)) || 0);
		else if (arg.startsWith("--case-count=")) args.caseCount = Math.max(0, Number(arg.slice(13)) || 0);
		else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice(7)) || 7;
		else if (arg.startsWith("--output=")) args.output = path.resolve(process.cwd(), arg.slice(9));
	}
	args.vaultRoot = args.vaultRoot || detectVaultRoot(process.cwd());
	args.sourceCutoffs = Array.from(new Set(args.sourceCutoffs)).sort((a, b) => a - b);
	args.bm25Cutoffs = Array.from(new Set([...args.bm25Cutoffs, args.fullBm25Cutoff])).sort((a, b) => a - b);
	args.denseCutoffs = Array.from(new Set([...args.denseCutoffs, args.fullDenseCutoff])).sort((a, b) => a - b);
	args.minDifficulty = Number.isFinite(args.minDifficulty) ? args.minDifficulty : 0.05;
	args.minCandidateCount = Number.isFinite(args.minCandidateCount) ? Math.max(0, args.minCandidateCount) : 12;
	args.minUniqueFiles = Number.isFinite(args.minUniqueFiles) ? Math.max(0, args.minUniqueFiles) : 3;
	return args;
}

function detectVaultRoot(fromDir) {
	let current = fromDir;
	for (let i = 0; i < 8; i++) {
		if (fs.existsSync(path.join(current, ".obsidian"))) return current;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return path.resolve(fromDir, "../../..");
}

function compact(text) { return String(text ?? "").replace(/\s+/g, " ").trim(); }
function countTokens(text) {
	const latin = (String(text).match(/[A-Za-z0-9_]+/g) || []).length;
	const cjk = (String(text).match(/[\u4e00-\u9fff]/gu) || []).length;
	return Math.max(1, Math.ceil(latin * 0.8 + cjk * 0.65));
}
function truncateTokens(text, budget) {
	const source = compact(text);
	if (!source || budget <= 0 || countTokens(source) <= budget) return source;
	let lo = 0, hi = source.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (countTokens(source.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1;
	}
	return source.slice(0, lo).trim();
}
function normalizeBenchmarkToken(text) {
	const value = compact(text);
	if (!value || value.length >= 30) return "";
	return /[A-Za-z]/.test(value) ? value.toLowerCase() : value;
}

function tokenizeSequence(text) {
	const tokens = [];
	const segments = String(text ?? "")
		.replace(/https?:\/\/\S+/g, " ")
		.split(SEGMENT_REGEX);

	for (const segment of segments) {
		if (!segment) continue;
		if (cutForSearch && CHINESE_REGEX.test(segment)) {
			for (const raw of cutForSearch(segment, true)) {
				const token = normalizeBenchmarkToken(raw);
				if (!token || STOP.has(token)) continue;
				if (token.length < 2 && !CHINESE_REGEX.test(token)) continue;
				tokens.push(token);
			}
			continue;
		}

		for (const word of segment.split(SEPERATOR_REGEX)) {
			const token = normalizeBenchmarkToken(word);
			if (!token || token.length < 2 || STOP.has(token)) continue;
			tokens.push(token);

			if (token.length > 3) {
				for (const rawSubword of token.replace(HYPHEN_AND_CAMEL_CASE_REGEX, "$1 ").split(" ")) {
					const subword = normalizeBenchmarkToken(rawSubword);
					if (!subword || subword.length < 2 || STOP.has(subword)) continue;
					tokens.push(subword);
				}
			}
		}
	}

	return tokens.filter((token) => token.length <= 24 && !/^\d{3,}$/.test(token));
}

function terms(text) {
	return Array.from(new Set(tokenizeSequence(text)));
}
function uniqTerms(text) { return terms(text); }
function overlap(a, b) {
	if (!a.length || !b.length) return 0;
	const setB = new Set(b);
	let hits = 0;
	for (const term of a) if (setB.has(term)) hits += 1;
	return hits / Math.max(1, Math.min(a.length, b.length));
}
function isLowSignalHeading(text) {
	const normalized = compact(text).toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
	if (!normalized) return true;
	const squashed = normalized.replace(/\s+/g, "");
	if (LOW_SIGNAL.has(squashed)) return true;
	const split = normalized.split(" ").filter(Boolean);
	return split.length > 0 && split.every((part) => LOW_SIGNAL.has(part));
}
function headingScore(title, basename) {
	if (!title || isLowSignalHeading(title)) return 0;
	const titleTerms = uniqTerms(title);
	if (!titleTerms.length) return 0.25;
	const baseTerms = new Set(uniqTerms(basename));
	const unique = Array.from(new Set(titleTerms));
	let score = Math.min(3, unique.length) * 0.65;
	score += Math.min(2, unique.filter((t) => !baseTerms.has(t)).length) * 0.45;
	if (/[A-Z]{2,}/.test(title) || /[A-Z][a-z]+[A-Z]/.test(title)) score += 0.35;
	if (/[A-Za-z]/.test(title) && /[\u4e00-\u9fff]/u.test(title)) score += 0.25;
	if (/[\u4e00-\u9fff]{2,}/u.test(title)) score += 0.35;
	if (/[0-9]/.test(title) && /[A-Za-z\u4e00-\u9fff]/u.test(title)) score += 0.2;
	if (countTokens(title) >= 4) score += 0.25;
	return score;
}

function walkMarkdown(rootDir) {
	const out = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".obsidian" || entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(full);
		}
	};
	walk(rootDir);
	return out;
}

function parseDoc(rootDir, fullPath) {
	const raw = fs.readFileSync(fullPath, "utf8");
	const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
	const basename = path.basename(relPath, ".md");
	const lines = raw.split(/\r?\n/);
	const headings = [];
	const sections = [];
	let stack = [];
	let current = { path: [], lines: [], startLine: 0 };
	let inFence = false;
	const flush = (lineIndex) => {
		const text = current.lines.join("\n").trim();
		if (text) sections.push({ path: [...current.path], text, startLine: current.startLine });
		current = { path: [...stack], lines: [], startLine: lineIndex };
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; current.lines.push(line); continue; }
		if (!inFence) {
			const match = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
			if (match) {
				flush(i);
				const level = match[1].length;
				const title = compact(match[2]);
				while (stack.length >= level) stack.pop();
				stack.push(title);
				headings.push(title);
				current.path = [...stack];
				continue;
			}
		}
		current.lines.push(line);
	}
	flush(lines.length);
	return { path: relPath, basename, headings, content: raw, queryContent: extractQueryBodyText(raw), sections };
}

function chunkText(text, targetTokens) {
	const parts = String(text).split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
	if (!parts.length) return [];
	const out = [];
	let current = [], currentTokens = 0;
	for (const part of parts) {
		const cost = countTokens(part);
		if (current.length && currentTokens + cost > targetTokens) {
			out.push(current.join("\n\n"));
			current = [];
			currentTokens = 0;
		}
		current.push(part);
		currentTokens += cost;
	}
	if (current.length) out.push(current.join("\n\n"));
	return out;
}

function buildChunks(doc, targetTokens) {
	const chunks = [];
	let index = 0;
	for (const section of doc.sections) {
		for (const text of chunkText(section.text, targetTokens)) {
			chunks.push({ id: `${doc.path}#${index++}`, filePath: doc.path, basename: doc.basename, sectionPath: section.path.slice(-4), text });
		}
	}
	if (!chunks.length) chunks.push({ id: `${doc.path}#0`, filePath: doc.path, basename: doc.basename, sectionPath: [], text: doc.content.slice(0, 500) });
	return chunks;
}

function buildQueries(doc) {
	const basename = isLowSignalBasename(doc.basename) ? "" : compact(doc.basename);
	const headings = doc.headings
		.map((h) => compact(h))
		.filter(Boolean)
		.filter((heading) => !isLowSignalHeading(heading));
	const contentPhrases = pickContentPhrases(doc.queryContent, 6);
	const bodyTerms = uniqTerms(doc.queryContent).slice(0, 6).join(" ");
	const anchored = finalize([
		basename || headings[0] || "",
		headings[0] || contentPhrases[0] || "",
		headings[1] || "",
	]);
	const fallback = finalize([
		headings[1] || headings[0] || "",
		contentPhrases[0] || bodyTerms,
		contentPhrases[1] || "",
	]);
	const weak = finalize([
		headings[2] || headings[1] || "",
		contentPhrases[1] || contentPhrases[0] || "",
		contentPhrases[2] || bodyTerms,
	]);
	const directQueries = buildDirectHybridQueries(doc, { basename, headings, contentPhrases });
	return [
		anchored && { query: anchored, targetPath: doc.path, style: "anchored" },
		fallback && fallback !== anchored && { query: fallback, targetPath: doc.path, style: "fallback" },
		weak && weak !== anchored && weak !== fallback && { query: weak, targetPath: doc.path, style: "weak_anchor" },
		...directQueries.map((query) => ({ query, targetPath: doc.path, style: "direct_probe" })),
	].filter(Boolean);
}

function directKeyword(text) {
	const normalized = compact(text).replace(/#/g, " ").replace(/\s+/g, " ").trim();
	if (!normalized || isLowSignalHeading(normalized) || isLowSignalBasename(normalized)) {
		return "";
	}
	if (/[\u4e00-\u9fff]/u.test(normalized)) {
		return compact(normalized.slice(0, 12));
	}
	if (/[\\/._#:-]/.test(normalized)) {
		return compact(normalized.slice(0, 24));
	}
	return compact(normalized.split(/\s+/).slice(0, 2).join(" "));
}

function buildDirectHybridQueries(doc, context) {
	const candidates = [
		context.basename,
		...(context.headings ?? []).slice(0, 6),
	];
	return Array.from(new Set(candidates.map((value) => directKeyword(value)).filter(Boolean)))
		.filter((query) => query.length > 0 && !/^[0-9:/\-. ]+$/.test(query))
		.slice(0, 6);
}

function finalize(parts) {
	return Array.from(new Set(
		parts
			.map((p) => compact(p).replace(/#/g, " ").replace(/\s+/g, " ").trim())
			.filter(Boolean)
			.map((p) => /[\u4e00-\u9fff]/u.test(p) ? p.slice(0, 18) : p.split(/\s+/).slice(0, 4).join(" "))
			.map((p) => compact(p))
			.filter(Boolean),
	))
		.filter((p) => p && !/^[0-9:/\-. ]+$/.test(p))
		.slice(0, 3)
		.join(" ")
		.trim();
}

function pickCases(docs, limit, seed, maxQueriesPerDoc) {
	const rng = (() => { let t = seed >>> 0; return () => ((t = (t * 1664525 + 1013904223) >>> 0) / 4294967296); })();
	const pool = docs
		.filter((doc) => doc.content.trim().length > 200 && doc.headings.length > 0)
		.map((doc) => ({ doc, cases: buildQueries(doc).slice(0, maxQueriesPerDoc + 1), score: Math.min(8, countTokens(doc.content) / 120 + doc.headings.length) }))
		.filter((item) => item.cases.length > 0)
		.sort((a, b) => b.score - a.score || rng() - 0.5);
	const out = [];
	for (const item of pool) {
		for (const row of item.cases) {
			if (out.length >= limit) return out.map((v, i) => ({ id: `case-${i + 1}`, ...v }));
			out.push(row);
		}
	}
	return out.map((v, i) => ({ id: `case-${i + 1}`, ...v }));
}

function lexicalScore(query, doc) {
	const q = uniqTerms(query);
	const fields = [
		{ text: doc.basename, weight: 2.6 },
		{ text: doc.headings.join(" "), weight: 1.8 },
		{ text: doc.content.slice(0, 1000), weight: 1.0 },
	];
	let score = 0;
	for (const field of fields) {
		const fieldTerms = new Set(uniqTerms(field.text));
		for (const term of q) if (fieldTerms.has(term)) score += field.weight;
	}
	return score;
}
function confusionScore(targetDoc, query, doc) {
	if (doc.path === targetDoc.path) return Number.NEGATIVE_INFINITY;
	const q = uniqTerms(query);
	return lexicalScore(query, doc) * 0.55 + overlap(uniqTerms(targetDoc.content).slice(0, 14), uniqTerms(doc.content).slice(0, 14)) * 2.5 + overlap(q, uniqTerms(doc.headings.join(" ")).concat(uniqTerms(doc.content))) * 2.8;
}
function selectDocs(allDocs, targetPath, query, limit) {
	const ranked = allDocs.map((doc) => ({ doc, score: lexicalScore(query, doc) })).sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
	const target = allDocs.find((doc) => doc.path === targetPath);
	const confusing = target ? allDocs.map((doc) => ({ doc, score: confusionScore(target, query, doc) })).filter((row) => Number.isFinite(row.score)).sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path)) : [];
	const out = [], seen = new Set();
	if (target) { out.push(target); seen.add(target.path); }
	for (const row of confusing) { if (out.length >= Math.max(5, Math.ceil(limit * 0.45))) break; if (!seen.has(row.doc.path)) { out.push(row.doc); seen.add(row.doc.path); } }
	for (const row of ranked) { if (out.length >= limit) break; if (!seen.has(row.doc.path)) { out.push(row.doc); seen.add(row.doc.path); } }
	return out;
}

function parseVariant(raw) {
	const value = String(raw ?? "").trim().toLowerCase();
	if (!value) return null;
	if (value === ADAPTIVE_LABEL) return { label: ADAPTIVE_LABEL, kind: ADAPTIVE_LABEL, sortValue: TOTAL_BUDGET + 0.5 };
	const budget = Number(value);
	if (!Number.isFinite(budget) || budget <= 0) return null;
	return { label: String(Math.round(budget)), kind: "fixed", budget: Math.round(budget), sortValue: Math.round(budget) };
}

function buildContext(chunk, variant, maxDepth) {
	if (!variant) return "";
	const basename = compact(chunk.basename ?? "");
	const headings = (chunk.sectionPath ?? []).map((v) => compact(v)).filter(Boolean).slice(-Math.max(1, maxDepth));
	if (variant.kind === "fixed") {
		const lines = [];
		let remaining = variant.budget;
		if (basename) {
			const budget = Math.max(4, Math.min(10, Math.ceil(variant.budget * 0.28), remaining));
			const value = truncateTokens(basename, budget);
			if (value) { const line = `File: ${value}`; lines.push(line); remaining = Math.max(0, remaining - countTokens(line)); }
		}
		const chosen = [];
		for (let i = headings.length - 1; i >= 0; i--) {
			const next = [headings[i], ...chosen];
			if (countTokens(`Section: ${next.join(" > ")}`) <= remaining) chosen.unshift(headings[i]);
		}
		if (chosen.length) lines.push(`Section: ${chosen.join(" > ")}`);
		return lines.join("\n");
	}
	const lines = [];
	let remaining = TOTAL_BUDGET;
	if (basename) {
		const budget = Math.min(remaining, Math.max(FILE_MIN_BUDGET, Math.min(FILE_MAX_BUDGET, Math.ceil(countTokens(basename)))));
		const value = truncateTokens(basename, budget);
		if (value) { const line = `File: ${value}`; lines.push(line); remaining = Math.max(0, remaining - countTokens(line)); }
	}
	const filtered = headings.filter((title) => !isLowSignalHeading(title));
	const fallback = filtered.length ? filtered : headings;
	const base = Math.min(remaining, BASE_BUDGET);
	const selected = [];
	for (let i = fallback.length - 1; i >= 0; i--) {
		const next = [fallback[i], ...selected];
		if (countTokens(`Section: ${next.join(" > ")}`) <= base) selected.unshift(fallback[i]);
	}
	const selectedSet = new Set(selected);
	const overflow = fallback
		.map((title, index) => ({ title, index, score: headingScore(title, basename) }))
		.filter((row) => !selectedSet.has(row.title) && row.score >= 1.55)
		.sort((a, b) => b.index - a.index);
	for (const row of overflow) {
		const next = [row.title, ...selected];
		if (countTokens(`Section: ${next.join(" > ")}`) <= remaining) selected.unshift(row.title);
	}
	if (selected.length) lines.push(`Section: ${selected.join(" > ")}`);
	return lines.join("\n");
}

function buildInput(chunk, variant, maxDepth) {
	if (!variant) return chunk.text;
	const context = buildContext(chunk, variant, maxDepth);
	return context ? `${context}\n\n${chunk.text}` : chunk.text;
}

const RUNTIME_CONTEXT_TOTAL_BUDGET = 22;
const RUNTIME_CONTEXT_FILE_MIN_BUDGET = 4;
const RUNTIME_CONTEXT_FILE_MAX_BUDGET = 6;

function buildRuntimeContext(chunk, maxDepth) {
	const basename = compact(chunk.basename ?? "");
	const headings = (chunk.sectionPath ?? [])
		.map((value) => compact(value))
		.filter(Boolean)
		.slice(-Math.max(1, maxDepth));
	const lines = [];
	let remaining = RUNTIME_CONTEXT_TOTAL_BUDGET;

	if (basename) {
		const budget = Math.min(
			remaining,
			Math.max(
				RUNTIME_CONTEXT_FILE_MIN_BUDGET,
				Math.min(
					RUNTIME_CONTEXT_FILE_MAX_BUDGET,
					Math.ceil(countTokens(basename)),
				),
			),
		);
		const value = truncateTokens(basename, budget);
		if (value) {
			const line = `File: ${value}`;
			lines.push(line);
			remaining = Math.max(0, remaining - countTokens(line));
		}
	}

	if (remaining <= countTokens("Section:")) {
		return lines.join("\n");
	}

	const filtered = headings.filter((title) => !isLowSignalHeading(title));
	const fallback = filtered.length > 0 ? filtered : headings;
	const selected = [];
	for (let index = fallback.length - 1; index >= 0; index--) {
		const next = [fallback[index], ...selected];
		const line = `Section: ${next.join(" > ")}`;
		if (countTokens(line) <= remaining) {
			selected.unshift(fallback[index]);
		}
	}

	if (selected.length > 0) {
		lines.push(`Section: ${selected.join(" > ")}`);
		return lines.join("\n");
	}

	const nearest = fallback[fallback.length - 1];
	if (!nearest) {
		return lines.join("\n");
	}

	const nearestBudget = Math.max(1, remaining - countTokens("Section:"));
	const value = truncateTokens(nearest, nearestBudget);
	if (value) {
		lines.push(`Section: ${value}`);
	}
	return lines.join("\n");
}

function buildRuntimeInput(chunk, maxDepth) {
	const context = buildRuntimeContext(chunk, maxDepth);
	return context ? `${context}\n\n${chunk.text}` : chunk.text;
}

function inferRuntimeEntryPath(query, queryTokenCount, hasLexicalHits) {
	const trimmed = compact(query);
	const looksPathLike = /[\\/._#:-]/.test(trimmed);
	const shortKeywordQuery =
		hasLexicalHits &&
		(looksPathLike || queryTokenCount <= 2 || trimmed.length <= 8);

	if (shortKeywordQuery) {
		return "direct_hybrid";
	}

	if (!hasLexicalHits && queryTokenCount >= 3) {
		return "lexical_fallback_like";
	}

	return "mixed_entry";
}

function isLowSignalQuery(query) {
	const normalized = compact(query);
	if (!normalized) return true;
	const value = normalized.toLowerCase();
	const looksPathLike = /[\\/._#:-]/.test(normalized);
	if (isLowSignalBasename(value)) return true;
	if (/:::[a-z0-9_-]+/i.test(normalized)) return true;
	if (/[`~]{2,}/.test(normalized)) return true;
	const queryTerms = uniqTerms(normalized);
	if (queryTerms.length === 0) return true;
	if (queryTerms.length === 1) {
		const [term] = queryTerms;
		if (!term) return true;
		if (LOW_SIGNAL.has(term) || STOP.has(term)) return true;
		if (/^[0-9:/\-_. ]+$/.test(normalized)) return true;
		if (looksPathLike) return false;
		if (CHINESE_REGEX.test(term)) return term.length < 2;
		return term.length < 4;
	}
	if (queryTerms.every((term) => LOW_SIGNAL.has(term))) return true;
	if (/^[0-9:/\-_. ]+$/.test(normalized)) return true;
	return false;
}

function shouldSkipBenchmarkDoc(doc) {
	const normalizedPath = doc.path.toLowerCase();
	const basename = doc.basename.toLowerCase();
	if (normalizedPath.startsWith("meta_files/templates/")) return true;
	if (basename === "welcome" || basename === "aabb") return true;
	if (/^untitled(?: \d+)?$/.test(basename)) return true;
	if (/^test\d*$/.test(basename)) return true;
	return false;
}

function loadManualQueries(queryFile) {
	if (!queryFile) return [];
	const raw = JSON.parse(fs.readFileSync(queryFile, "utf8"));
	if (!Array.isArray(raw)) {
		throw new Error(`query file must be a JSON array: ${queryFile}`);
	}
	return raw.map((item, index) => ({
		query: compact(item?.query ?? ""),
		targetPath: compact(item?.targetPath ?? ""),
		style: compact(item?.style ?? "") || "manual",
		id: compact(item?.id ?? "") || `manual-${index + 1}`,
		allowLowSignal: item?.allowLowSignal === true,
	})).filter((item) => item.query && item.targetPath);
}

function truncateForLog(text, maxLength = 72) {
	const source = compact(text);
	if (source.length <= maxLength) return source;
	return `${source.slice(0, Math.max(0, maxLength - 3))}...`;
}

function features(text) {
	const map = new Map();
	for (const term of terms(text)) {
		map.set(`t:${term}`, (map.get(`t:${term}`) ?? 0) + 1);
		if (/^[a-z0-9]+$/i.test(term) && term.length >= 4) for (let i = 0; i <= term.length - 3; i++) map.set(`g:${term.slice(i, i + 3)}`, (map.get(`g:${term.slice(i, i + 3)}`) ?? 0) + 0.32);
		if (/[\u4e00-\u9fff]/u.test(term) && term.length >= 2) for (let i = 0; i <= term.length - 2; i++) map.set(`c:${term.slice(i, i + 2)}`, (map.get(`c:${term.slice(i, i + 2)}`) ?? 0) + 0.28);
	}
	return map;
}
function buildIdf(texts) {
	const df = new Map();
	for (const text of texts) for (const key of features(text).keys()) df.set(key, (df.get(key) ?? 0) + 1);
	const total = Math.max(1, texts.length);
	const idf = new Map();
	for (const [key, value] of df.entries()) idf.set(key, Math.log(1 + (total - value + 0.5) / (value + 0.5)) + 1);
	return idf;
}
function vector(text, idf) {
	const raw = features(text);
	const out = new Map();
	let norm = 0;
	for (const [key, value] of raw.entries()) {
		const weight = Math.sqrt(value) * (idf.get(key) ?? 1);
		out.set(key, weight);
		norm += weight * weight;
	}
	norm = Math.sqrt(norm) || 1;
	for (const [key, value] of out.entries()) out.set(key, value / norm);
	return out;
}

function lexicalFeatures(text) {
	const map = new Map();
	for (const term of terms(text)) {
		map.set(`t:${term}`, (map.get(`t:${term}`) ?? 0) + 1);
		if (/^[a-z0-9]+$/i.test(term) && term.length >= 4) {
			for (let i = 0; i <= term.length - 3; i++) {
				const key = `g:${term.slice(i, i + 3)}`;
				map.set(key, (map.get(key) ?? 0) + 0.12);
			}
		}
		if (/[\u4e00-\u9fff]/u.test(term) && term.length >= 2) {
			for (let i = 0; i <= term.length - 2; i++) {
				const key = `c:${term.slice(i, i + 2)}`;
				map.set(key, (map.get(key) ?? 0) + 0.08);
			}
		}
	}
	return map;
}

function buildIdfWith(texts, featureBuilder) {
	const df = new Map();
	for (const text of texts) {
		for (const key of featureBuilder(text).keys()) {
			df.set(key, (df.get(key) ?? 0) + 1);
		}
	}
	const total = Math.max(1, texts.length);
	const idf = new Map();
	for (const [key, value] of df.entries()) {
		idf.set(key, Math.log(1 + (total - value + 0.5) / (value + 0.5)) + 1);
	}
	return idf;
}

function vectorWith(text, idf, featureBuilder) {
	const raw = featureBuilder(text);
	const out = new Map();
	let norm = 0;
	for (const [key, value] of raw.entries()) {
		const weight = Math.sqrt(value) * (idf.get(key) ?? 1);
		out.set(key, weight);
		norm += weight * weight;
	}
	norm = Math.sqrt(norm) || 1;
	for (const [key, value] of out.entries()) {
		out.set(key, value / norm);
	}
	return out;
}

function cosine(a, b) {
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	let dot = 0;
	for (const [key, value] of small.entries()) dot += value * (large.get(key) ?? 0);
	return dot;
}
function rr(targets, ranked) { const set = new Set(targets); for (let i = 0; i < ranked.length; i++) if (set.has(ranked[i].id)) return 1 / (i + 1); return 0; }
function first(targets, ranked) { const set = new Set(targets); for (let i = 0; i < ranked.length; i++) if (set.has(ranked[i].id)) return i + 1; return Infinity; }
function hit25(targets, ranked) { const set = new Set(targets); for (let i = 0; i < Math.min(25, ranked.length); i++) if (set.has(ranked[i].id)) return 1; return 0; }

function buildPlan(args) {
	const docs = walkMarkdown(args.vaultRoot).map((fullPath) => parseDoc(args.vaultRoot, fullPath));
	const cases = pickCases(docs, args.caseLimit, args.seed, args.maxQueriesPerDoc);
	const candidateDocsByCase = new Map();
	const chunksByFile = new Map();
	const allChunks = [];
	for (const row of cases) {
		const candidateDocs = selectDocs(docs, row.targetPath, row.query, args.maxFilesPerQuery);
		candidateDocsByCase.set(row.id, candidateDocs);
		for (const doc of candidateDocs) {
			if (chunksByFile.has(doc.path)) continue;
			const chunks = buildChunks(doc, args.targetTokens);
			chunksByFile.set(doc.path, chunks);
			allChunks.push(...chunks);
		}
	}
	return { vaultRoot: args.vaultRoot, docCount: docs.length, cases, candidateDocsByCase, chunksByFile, allChunks, uniqueCandidateFiles: chunksByFile.size, uniqueChunks: allChunks.length };
}

function printDryRun(plan) {
	console.log("");
	console.log("Hybrid Real A/B Benchmark Dry Run");
	console.log("=================================");
	console.log(`vaultRoot=${plan.vaultRoot}`);
	console.log(`docs=${plan.docCount}, selectedCases=${plan.cases.length}`);
	console.log(`uniqueCandidateFiles=${plan.uniqueCandidateFiles}, uniqueChunks=${plan.uniqueChunks}`);
	console.log("");
	console.log("Generated Queries");
	console.log("-----------------");
	for (const row of plan.cases) console.log(`${row.id}  [${row.style}]  ${row.query}  ->  ${row.targetPath}`);
}

function buildSemanticQueryVariants(query, limit) {
	const trimmed = compact(query);
	const queryTerms = uniqTerms(trimmed);
	const variants = [];
	const seen = new Set();
	const addVariant = (text, weight) => {
		const normalized = compact(text);
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		variants.push({ text: normalized, weight });
	};
	addVariant(trimmed, 1);
	if (limit <= 1 || queryTerms.length <= 2) {
		return variants.slice(0, limit);
	}
	addVariant(queryTerms.slice(0, Math.min(queryTerms.length, 10)).join(" "), 0.9);
	if (limit <= 2 || queryTerms.length <= 5) {
		return variants.slice(0, limit);
	}
	addVariant(
		[...queryTerms.slice(0, 4), ...queryTerms.slice(-3)].join(" "),
		0.78,
	);
	return variants.slice(0, limit);
}

function denseVariantLimitForCase(query, style) {
	const tokenCount = uniqTerms(query).length;
	if (style === "anchored") return 1;
	if (style === "fallback" && tokenCount >= 3) return 3;
	if (style === "weak_anchor" && tokenCount >= 3) return 3;
	return tokenCount >= 4 ? 2 : 1;
}

function dedupeRanking(rankings) {
	const out = [];
	const seen = new Set();
	for (const ranking of rankings) {
		for (const item of ranking) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			out.push(item);
		}
	}
	return out;
}

function uniqueFileCount(items) {
	return new Set(items.map((item) => item.filePath)).size;
}

function findFirstFileRank(filePath, ranking) {
	for (let index = 0; index < ranking.length; index++) {
		if (ranking[index].filePath === filePath) return index + 1;
	}
	return Infinity;
}

function buildApiSourceOverlapPlan(args) {
	const docs = walkMarkdown(args.vaultRoot).map((fullPath) => parseDoc(args.vaultRoot, fullPath));
	const docByPath = new Map(docs.map((doc) => [doc.path, doc]));
	const chunks = [];
	for (const doc of docs) {
		chunks.push(...buildChunks(doc, args.targetTokens));
	}
	const runtimeInputs = chunks.map((chunk) => buildRuntimeInput(chunk, args.contextMaxDepth));
	const lexicalIdf = buildIdfWith(chunks.map((chunk) => chunk.text), lexicalFeatures);
	const semanticIdf = buildIdfWith(runtimeInputs, features);
	const lexicalVecById = new Map();
	const semanticVecById = new Map();
	const runtimeInputById = new Map();
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index];
		const runtimeInput = runtimeInputs[index];
		lexicalVecById.set(chunk.id, vectorWith(chunk.text, lexicalIdf, lexicalFeatures));
		semanticVecById.set(chunk.id, vectorWith(runtimeInput, semanticIdf, features));
		runtimeInputById.set(chunk.id, runtimeInput);
	}
	const cases = selectApiBenchmarkCases({
		docs,
		docByPath,
		chunks,
		runtimeInputById,
		lexicalIdf,
		semanticIdf,
		lexicalVecById,
		semanticVecById,
	}, args);
	return {
		vaultRoot: args.vaultRoot,
		docCount: docs.length,
		chunkCount: chunks.length,
		docs,
		docByPath,
		chunks,
		runtimeInputById,
		lexicalIdf,
		semanticIdf,
		lexicalVecById,
		semanticVecById,
		cases,
	};
}

function scoreBm25Candidates(query, plan, limit) {
	const queryVec = vectorWith(query, plan.lexicalIdf, lexicalFeatures);
	return plan.chunks
		.map((chunk) => ({
			id: chunk.id,
			filePath: chunk.filePath,
			score: cosine(queryVec, plan.lexicalVecById.get(chunk.id)),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
		.slice(0, limit);
}

function scoreDenseCandidates(query, style, plan, limit) {
	const variants = buildSemanticQueryVariants(query, denseVariantLimitForCase(query, style));
	const variantVecs = variants.map((variant) => ({
		weight: variant.weight,
		vec: vectorWith(variant.text, plan.semanticIdf, features),
	}));
	return plan.chunks
		.map((chunk) => {
			let score = 0;
			const chunkVec = plan.semanticVecById.get(chunk.id);
			for (const variant of variantVecs) {
				score = Math.max(score, cosine(variant.vec, chunkVec) * variant.weight);
			}
			return {
				id: chunk.id,
				filePath: chunk.filePath,
				score,
			};
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
		.slice(0, limit);
}

function buildCaseRecord(rawCase, plan, args) {
	const targetDoc = plan.docByPath.get(rawCase.targetPath);
	if (!targetDoc) return null;
	if (!rawCase.allowLowSignal && isLowSignalQuery(rawCase.query)) return null;
	if (countTokens(rawCase.query) > args.maxQueryTokens) return null;
	const bm25Ranking = scoreBm25Candidates(rawCase.query, plan, args.fullBm25Cutoff);
	const denseRanking = scoreDenseCandidates(rawCase.query, rawCase.style, plan, args.fullDenseCutoff);
	const fullUnion = dedupeRanking([bm25Ranking, denseRanking])
		.map((item) => ({
			...item,
			chunk: plan.chunks.find((chunk) => chunk.id === item.id),
		}))
		.filter((item) => item.chunk)
		.map((item) => ({
			id: item.id,
			filePath: item.filePath,
			score: item.score,
			text: item.chunk.text,
			rerankText: plan.runtimeInputById.get(item.id) ?? item.chunk.text,
		}));
	const targetUnionRank = findFirstFileRank(rawCase.targetPath, fullUnion);
	if (!Number.isFinite(targetUnionRank)) return null;
	const targetBm25Rank = findFirstFileRank(rawCase.targetPath, bm25Ranking);
	const targetDenseRank = findFirstFileRank(rawCase.targetPath, denseRanking);
	const queryTerms = uniqTerms(rawCase.query);
	const entryPath = inferRuntimeEntryPath(
		rawCase.query,
		queryTerms.length,
		bm25Ranking.length > 0,
	);
	const anchorTerms = uniqTerms(`${targetDoc.basename} ${targetDoc.headings.join(" ")}`);
	const anchorOverlap = overlap(queryTerms, anchorTerms);
	const unionDifficulty = Math.min(1, (targetUnionRank - 1) / Math.max(1, fullUnion.length - 1));
	const bm25Difficulty = Number.isFinite(targetBm25Rank)
		? Math.min(1, (targetBm25Rank - 1) / Math.max(1, bm25Ranking.length - 1))
		: 1;
	const denseDifficulty = Number.isFinite(targetDenseRank)
		? Math.min(1, (targetDenseRank - 1) / Math.max(1, denseRanking.length - 1))
		: 1;
	const styleBoost =
		rawCase.style === "fallback" ? 0.28 : rawCase.style === "weak_anchor" ? 0.42 : 0;
	const difficultyScore =
		unionDifficulty * 1.15 +
		Math.max(bm25Difficulty, denseDifficulty) * 0.55 +
		Math.abs(bm25Difficulty - denseDifficulty) * 0.25 +
		(1 - anchorOverlap) * 0.2 +
		styleBoost;
	return {
		...rawCase,
		entryPath,
		difficultyScore,
		targetUnionRank,
		targetBm25Rank,
		targetDenseRank,
		candidateCount: fullUnion.length,
		uniqueFiles: uniqueFileCount(fullUnion),
		bm25Ranking,
		denseRanking,
		fullUnion,
	};
}

function selectApiBenchmarkCases(plan, args) {
	const manualQueries = loadManualQueries(args.queryFile);
	const rawCases = manualQueries.length > 0 ? manualQueries : [];
	const entryPathFilters = new Set(
		String(args.entryPathFilter ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	const styleFilters = new Set(
		String(args.styleFilter ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	if (manualQueries.length === 0) {
		for (const doc of plan.docs) {
			if (shouldSkipBenchmarkDoc(doc)) continue;
			const queries = buildQueries(doc);
			for (const row of queries) {
				rawCases.push(row);
			}
		}
	}
	const scored = rawCases
		.map((row) => buildCaseRecord(row, plan, args))
		.filter(Boolean)
		.filter((row) => styleFilters.size === 0 || styleFilters.has(row.style))
		.filter((row) => entryPathFilters.size === 0 || entryPathFilters.has(row.entryPath))
		.filter((row) => row.candidateCount >= args.minCandidateCount)
		.filter((row) => row.uniqueFiles >= args.minUniqueFiles)
		.filter((row) => row.difficultyScore >= args.minDifficulty)
		.sort((a, b) => b.difficultyScore - a.difficultyScore || a.targetPath.localeCompare(b.targetPath));
	if (entryPathFilters.size > 0 || manualQueries.length > 0) {
		const selected = [];
		const selectedKeys = new Set();
		const selectedPaths = new Set();
		for (const enforceUniquePath of [true, false]) {
			for (const row of scored) {
				if (selected.length >= args.maxQueryCount) break;
				const key = `${row.targetPath}::${row.style}::${row.query}`;
				if (selectedKeys.has(key)) continue;
				if (enforceUniquePath && selectedPaths.has(row.targetPath)) continue;
				selected.push({
					id: `case-${selected.length + 1}`,
					...row,
				});
				selectedKeys.add(key);
				selectedPaths.add(row.targetPath);
			}
			if (selected.length >= args.maxQueryCount) break;
		}
		if (args.caseCount > 0) {
			return selected.slice(args.caseStart, args.caseStart + args.caseCount);
		}
		return selected.slice(args.caseStart);
	}
	const byStyle = new Map();
	for (const row of scored) {
		const bucket = byStyle.get(row.style) ?? [];
		bucket.push(row);
		byStyle.set(row.style, bucket);
	}
	const selected = [];
	const selectedKeys = new Set();
	const selectedPaths = new Set();
	const styleCounts = new Map();
	const styles = ["anchored", "fallback", "weak_anchor"];
	for (const enforceUniquePath of [true, false]) {
		let progress = true;
		while (progress && selected.length < args.maxQueryCount) {
			progress = false;
			for (const style of styles) {
				const rows = byStyle.get(style) ?? [];
				if ((styleCounts.get(style) ?? 0) >= args.maxCasesPerStyle) continue;
				const next = rows.find((row) => {
					const key = `${row.targetPath}::${row.style}::${row.query}`;
					if (selectedKeys.has(key)) return false;
					if (enforceUniquePath && selectedPaths.has(row.targetPath)) return false;
					return true;
				});
				if (!next) continue;
				const key = `${next.targetPath}::${next.style}::${next.query}`;
				selected.push({
					id: `case-${selected.length + 1}`,
					...next,
				});
				selectedKeys.add(key);
				selectedPaths.add(next.targetPath);
				styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1);
				progress = true;
				if (selected.length >= args.maxQueryCount) break;
			}
		}
	}
	if (args.caseCount > 0) {
		return selected.slice(args.caseStart, args.caseStart + args.caseCount);
	}
	return selected.slice(args.caseStart);
}

function estimateApiSourceOverlapBudget(plan) {
	const queryTokens = plan.cases.reduce((sum, row) => sum + countTokens(row.query), 0);
	const documentTokens = plan.cases.reduce(
		(sum, row) => sum + row.fullUnion.reduce((acc, candidate) => acc + countTokens(candidate.rerankText), 0),
		0,
	);
	const candidateCount = plan.cases.reduce((sum, row) => sum + row.fullUnion.length, 0);
	return {
		queryTokens,
		documentTokens,
		totalTokens: queryTokens + documentTokens,
		candidateCount,
		avgCandidatesPerQuery: plan.cases.length ? candidateCount / plan.cases.length : 0,
	};
}

function normalizeApiDomain(domain) {
	const raw = domain?.trim();
	if (!raw) {
		return "dashscope.aliyuncs.com";
	}
	const withoutProtocol = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
	const compatibleIndex = withoutProtocol.search(/\/compatible-(mode|api)\b/i);
	const hostAndMaybePath =
		compatibleIndex >= 0
			? withoutProtocol.slice(0, compatibleIndex)
			: withoutProtocol;
	return hostAndMaybePath.split("/")[0] || "dashscope.aliyuncs.com";
}

function buildDashScopeApiUrl(domain) {
	const host = normalizeApiDomain(domain);
	return `https://${host}/compatible-api/v1/reranks`;
}

function loadProviderConfig(fromDir) {
	const dataPath = path.resolve(fromDir, "data.json");
	const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
	const apiKey = raw?.hybrid?.apiKey?.trim?.() ?? "";
	const apiDomain = raw?.hybrid?.apiDomain;
	if (!apiKey) {
		throw new Error("Missing hybrid.apiKey in data.json");
	}
	return {
		apiUrl: buildDashScopeApiUrl(apiDomain),
		apiKey,
	};
}

async function rerankWithProvider(query, documents, topN, provider) {
	const resp = await fetch(provider.apiUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${provider.apiKey}`,
		},
		body: JSON.stringify({
			model: "qwen3-rerank",
			query,
			documents,
			top_n: Math.min(topN, documents.length),
			instruct: "Retrieve semantically similar text.",
		}),
	});
	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`Qwen rerank API error ${resp.status}: ${body}`);
	}
	const json = await resp.json();
	const rawItems = Array.isArray(json.results)
		? json.results
		: Array.isArray(json.data)
			? json.data
			: Array.isArray(json.output?.results)
				? json.output.results
				: [];
	const ranked = rawItems
		.map((item) => ({
			index: item.index,
			score: item.relevance_score ?? item.score ?? 0,
		}))
		.filter((item) => Number.isFinite(item.index) && Number.isFinite(item.score))
		.sort((a, b) => b.score - a.score);
	return {
		ranked,
		inputTokens: json.usage?.input_tokens ?? json.usage?.total_tokens ?? 0,
		totalTokens: json.usage?.total_tokens ?? json.usage?.input_tokens ?? 0,
	};
}

function buildOverlapGrid(caseRow, args, rerankTopIds) {
	const bm25Cutoffs = args.bm25Cutoffs.filter((value) => value > 0);
	const denseCutoffs = args.denseCutoffs.filter((value) => value > 0);
	const bm25ByCutoff = new Map(
		bm25Cutoffs.map((cutoff) => [cutoff, new Set(caseRow.bm25Ranking.slice(0, cutoff).map((item) => item.id))]),
	);
	const denseByCutoff = new Map(
		denseCutoffs.map((cutoff) => [cutoff, new Set(caseRow.denseRanking.slice(0, cutoff).map((item) => item.id))]),
	);
	const pairs = [];
	for (const bm25Cutoff of bm25Cutoffs) {
		const bm25Slice = caseRow.bm25Ranking.slice(0, bm25Cutoff);
		for (const denseCutoff of denseCutoffs) {
			const denseSlice = caseRow.denseRanking.slice(0, denseCutoff);
			const union = dedupeRanking([bm25Slice, denseSlice]);
			const unionSet = new Set(union.map((item) => item.id));
			let overlapCount = 0;
			for (const id of rerankTopIds) {
				if (unionSet.has(id)) overlapCount += 1;
			}
			pairs.push({
				key: `${bm25Cutoff}x${denseCutoff}`,
				bm25Cutoff,
				denseCutoff,
				overlapCount,
				candidateCount: union.length,
			});
		}
	}
	return {
		pairs,
		bm25Marginal: bm25Cutoffs.map((cutoff) => ({
			cutoff,
			overlapCount: rerankTopIds.filter((id) => bm25ByCutoff.get(cutoff).has(id)).length,
		})),
		denseMarginal: denseCutoffs.map((cutoff) => ({
			cutoff,
			overlapCount: rerankTopIds.filter((id) => denseByCutoff.get(cutoff).has(id)).length,
		})),
	};
}

function summarizePairRows(results) {
	const acc = new Map();
	for (const row of results) {
		for (const pair of row.grid.pairs) {
			const entry = acc.get(pair.key) ?? {
				key: pair.key,
				bm25Cutoff: pair.bm25Cutoff,
				denseCutoff: pair.denseCutoff,
				overlapCount: 0,
				candidateCount: 0,
				fullCoverage: 0,
				queryCount: 0,
			};
			entry.overlapCount += pair.overlapCount;
			entry.candidateCount += pair.candidateCount;
			entry.fullCoverage += pair.overlapCount >= Math.min(row.rerankTop.length, 5) ? 1 : 0;
			entry.queryCount += 1;
			acc.set(pair.key, entry);
		}
	}
	return Array.from(acc.values())
		.map((row) => ({
			...row,
			avgOverlap: row.queryCount ? row.overlapCount / row.queryCount : 0,
			avgCandidates: row.queryCount ? row.candidateCount / row.queryCount : 0,
			fullCoverageRate: row.queryCount ? row.fullCoverage / row.queryCount : 0,
		}))
		.sort((a, b) =>
			b.avgOverlap - a.avgOverlap ||
			a.avgCandidates - b.avgCandidates ||
			a.key.localeCompare(b.key),
		);
}

function summarizeMarginalRows(results, key) {
	const acc = new Map();
	for (const row of results) {
		for (const item of row.grid[key]) {
			const entry = acc.get(item.cutoff) ?? { cutoff: item.cutoff, overlapCount: 0, queryCount: 0 };
			entry.overlapCount += item.overlapCount;
			entry.queryCount += 1;
			acc.set(item.cutoff, entry);
		}
	}
	return Array.from(acc.values())
		.map((row) => ({
			...row,
			avgOverlap: row.queryCount ? row.overlapCount / row.queryCount : 0,
		}))
		.sort((a, b) => a.cutoff - b.cutoff);
}

function computePairFrontier(pairRows, baselineKey) {
	const baseline = pairRows.find((row) => row.key === baselineKey) ?? pairRows[0];
	const sorted = [...pairRows].sort((a, b) =>
		a.avgCandidates - b.avgCandidates ||
		b.avgOverlap - a.avgOverlap ||
		a.key.localeCompare(b.key),
	);
	const frontier = [];
	let bestOverlap = Number.NEGATIVE_INFINITY;
	for (const row of sorted) {
		if (row.avgOverlap > bestOverlap + 1e-6) {
			frontier.push({
				...row,
				lossVsBaseline: baseline ? baseline.avgOverlap - row.avgOverlap : 0,
			});
			bestOverlap = row.avgOverlap;
		}
	}
	return frontier;
}

function summarizeApiSourceOverlap(plan, results, args) {
	const byEntryPath = new Map();
	for (const row of results) {
		const bucket = byEntryPath.get(row.entryPath) ?? [];
		bucket.push(row);
		byEntryPath.set(row.entryPath, bucket);
	}
	const overallPairs = summarizePairRows(results);
	const baselineKey = `${args.fullBm25Cutoff}x${args.fullDenseCutoff}`;
	return {
		queryCount: results.length,
		totalInputTokens: results.reduce((sum, row) => sum + row.inputTokens, 0),
		totalTokens: results.reduce((sum, row) => sum + row.totalTokens, 0),
		avgInputTokens: results.length ? results.reduce((sum, row) => sum + row.inputTokens, 0) / results.length : 0,
		avgCandidates: results.length ? results.reduce((sum, row) => sum + row.candidateCount, 0) / results.length : 0,
		avgUniqueFiles: results.length ? results.reduce((sum, row) => sum + row.uniqueFiles, 0) / results.length : 0,
		overallPairs,
		overallBm25Marginal: summarizeMarginalRows(results, "bm25Marginal"),
		overallDenseMarginal: summarizeMarginalRows(results, "denseMarginal"),
		overallFrontier: computePairFrontier(overallPairs, baselineKey),
		byEntryPath: Array.from(byEntryPath.entries()).map(([entryPath, rows]) => {
			const pairs = summarizePairRows(rows);
			return {
				entryPath,
				queryCount: rows.length,
				avgCandidates: rows.reduce((sum, row) => sum + row.candidateCount, 0) / rows.length,
				avgUniqueFiles: rows.reduce((sum, row) => sum + row.uniqueFiles, 0) / rows.length,
				pairs,
				bm25Marginal: summarizeMarginalRows(rows, "bm25Marginal"),
				denseMarginal: summarizeMarginalRows(rows, "denseMarginal"),
				frontier: computePairFrontier(pairs, baselineKey),
			};
		}).sort((a, b) => a.entryPath.localeCompare(b.entryPath)),
	};
}

function printApiSourceOverlap(plan, payload, args) {
	const baselineKey = `${args.fullBm25Cutoff}x${args.fullDenseCutoff}`;
	console.log("");
	console.log("Hybrid Real Rerank Source Overlap");
	console.log("=================================");
	console.log(`vaultRoot=${plan.vaultRoot}`);
	console.log(`docs=${plan.docCount}, chunks=${plan.chunkCount}, queries=${payload.summary.queryCount}`);
	console.log(`fullCutoff=${baselineKey}, rerankTopN=${args.rerankTopN}`);
	console.log(`actualTokens input=${payload.summary.totalInputTokens}, total=${payload.summary.totalTokens}, avgInputPerQuery=${payload.summary.avgInputTokens.toFixed(1)}`);
	console.log(`avgCandidates=${payload.summary.avgCandidates.toFixed(2)}, avgUniqueFiles=${payload.summary.avgUniqueFiles.toFixed(2)}`);

	console.log("");
	console.log("Selected Hard Cases");
	console.log("-------------------");
	for (const row of payload.results) {
		console.log(
			`${row.id.padEnd(7)} [${row.style.padEnd(11)}] diff=${row.difficultyScore.toFixed(3)} candidates=${String(row.candidateCount).padStart(2)} uniqueFiles=${String(row.uniqueFiles).padStart(2)} inputTokens=${String(row.inputTokens).padStart(5)} query=${truncateForLog(row.query)}`,
		);
	}

	console.log("");
	console.log("Overall Marginal Overlap (Real Rerank Top5)");
	console.log("-------------------------------------------");
	console.log("bm25 cutoff     avg overlap");
	for (const row of payload.summary.overallBm25Marginal) {
		console.log(`${String(row.cutoff).padStart(10)} ${row.avgOverlap.toFixed(3).padStart(14)}`);
	}
	console.log("");
	console.log("dense cutoff    avg overlap");
	for (const row of payload.summary.overallDenseMarginal) {
		console.log(`${String(row.cutoff).padStart(10)} ${row.avgOverlap.toFixed(3).padStart(14)}`);
	}

	console.log("");
	console.log("Overall Pareto Frontier");
	console.log("-----------------------");
	console.log("pair      avgOverlap  lossVs20x30  fullCover  avgCandidates");
	for (const row of payload.summary.overallFrontier.slice(0, 12)) {
		console.log(
			`${row.key.padEnd(8)} ${row.avgOverlap.toFixed(3).padStart(10)} ${row.lossVsBaseline.toFixed(3).padStart(12)} ${row.fullCoverageRate.toFixed(3).padStart(10)} ${row.avgCandidates.toFixed(2).padStart(14)}`,
		);
	}

	console.log("");
	console.log("By Entry Path");
	console.log("-------------");
	for (const group of payload.summary.byEntryPath) {
		console.log(`${group.entryPath}  queries=${group.queryCount}, avgCandidates=${group.avgCandidates.toFixed(2)}, avgUniqueFiles=${group.avgUniqueFiles.toFixed(2)}`);
		console.log("  bm25:", group.bm25Marginal.map((row) => `${row.cutoff}:${row.avgOverlap.toFixed(2)}`).join("  "));
		console.log("  dense:", group.denseMarginal.map((row) => `${row.cutoff}:${row.avgOverlap.toFixed(2)}`).join("  "));
		console.log("  frontier:", group.frontier.slice(0, 6).map((row) => `${row.key}=${row.avgOverlap.toFixed(2)}@${row.avgCandidates.toFixed(1)}`).join("  "));
	}
}

function printApiSourceOverlapDryRun(plan, args) {
	const budget = estimateApiSourceOverlapBudget(plan);
	console.log("");
	console.log("Hybrid Real Rerank Source Overlap Dry Run");
	console.log("=========================================");
	console.log(`vaultRoot=${plan.vaultRoot}`);
	console.log(`docs=${plan.docCount}, chunks=${plan.chunkCount}, queries=${plan.cases.length}`);
	console.log(`fullCutoff=${args.fullBm25Cutoff}x${args.fullDenseCutoff}, rerankTopN=${args.rerankTopN}`);
	console.log(`estimatedTokens=${budget.totalTokens}, avgCandidatesPerQuery=${budget.avgCandidatesPerQuery.toFixed(2)}`);
	console.log("");
	console.log("Selected Hard Cases");
	console.log("-------------------");
	for (const row of plan.cases) {
		console.log(
			`${row.id.padEnd(7)} [${row.style.padEnd(11)}] diff=${row.difficultyScore.toFixed(3)} unionRank=${String(row.targetUnionRank).padStart(2)} candidates=${String(row.candidateCount).padStart(2)} uniqueFiles=${String(row.uniqueFiles).padStart(2)} query=${truncateForLog(row.query)} -> ${row.targetPath}`,
		);
	}
}

async function runApiSourceOverlap(plan, args) {
	const provider = loadProviderConfig(process.cwd());
	const results = [];
	for (const caseRow of plan.cases) {
		const documents = caseRow.fullUnion.map((candidate) => candidate.rerankText);
		const rerank = await rerankWithProvider(
			caseRow.query,
			documents,
			args.rerankTopN,
			provider,
		);
		const rerankTop = rerank.ranked
			.slice(0, args.rerankTopN)
			.map((item) => {
				const candidate = caseRow.fullUnion[item.index];
				if (!candidate) return null;
				return {
					id: candidate.id,
					filePath: candidate.filePath,
					score: item.score,
				};
			})
			.filter(Boolean);
		const rerankTopIds = rerankTop.map((item) => item.id);
		results.push({
			id: caseRow.id,
			query: caseRow.query,
			style: caseRow.style,
			entryPath: caseRow.entryPath,
			targetPath: caseRow.targetPath,
			difficultyScore: caseRow.difficultyScore,
			candidateCount: caseRow.candidateCount,
			uniqueFiles: caseRow.uniqueFiles,
			inputTokens: rerank.inputTokens,
			totalTokens: rerank.totalTokens,
			rerankTop,
			grid: buildOverlapGrid(caseRow, args, rerankTopIds),
		});
	}
	const summary = summarizeApiSourceOverlap(plan, results, args);
	return {
		mode: "api-source-overlap",
		vaultRoot: plan.vaultRoot,
		docCount: plan.docCount,
		chunkCount: plan.chunkCount,
		args: {
			fullBm25Cutoff: args.fullBm25Cutoff,
			fullDenseCutoff: args.fullDenseCutoff,
			bm25Cutoffs: args.bm25Cutoffs,
			denseCutoffs: args.denseCutoffs,
			rerankTopN: args.rerankTopN,
			targetTokens: args.targetTokens,
		},
		results,
		summary,
	};
}

function estimateApiBudget(plan, args) {
	const variants = args.contextVariants
		.map(parseVariant)
		.filter(Boolean)
		.sort((a, b) => a.sortValue - b.sortValue);
	const queryTokens = plan.cases.reduce((acc, row) => acc + countTokens(row.query), 0);
	const baseChunkTokens = plan.allChunks.reduce((acc, chunk) => acc + countTokens(chunk.text), 0);
	const variantBudgets = variants.map((variant) => {
		const variantInputTokens = plan.allChunks.reduce(
			(acc, chunk) => acc + countTokens(buildInput(chunk, variant, args.contextMaxDepth)),
			0,
		);
		return {
			label: variant.label,
			chunkTokens: variantInputTokens,
			totalTokensOneShot: queryTokens + baseChunkTokens + variantInputTokens,
			extraContextTokens: variantInputTokens - baseChunkTokens,
		};
	});
	return {
		queryTokens,
		baseChunkTokens,
		variantBudgets,
		allVariantsTotalTokens:
			queryTokens + baseChunkTokens + variantBudgets.reduce((acc, row) => acc + row.chunkTokens, 0),
	};
}

function runLocalBudgetSweep(plan, args) {
	const variants = args.contextVariants.map(parseVariant).filter(Boolean).sort((a, b) => a.sortValue - b.sortValue);
	const bodyOnly = plan.allChunks.map((chunk) => chunk.text);
	const byVariant = new Map();
	for (const variant of variants) byVariant.set(variant.label, plan.allChunks.map((chunk) => buildInput(chunk, variant, args.contextMaxDepth)));
	const idf = buildIdf([...plan.cases.map((row) => row.query), ...bodyOnly, ...variants.flatMap((variant) => byVariant.get(variant.label) ?? [])]);
	const baseVecs = bodyOnly.map((text) => vector(text, idf));
	const queryVecs = plan.cases.map((row) => vector(row.query, idf));
	const baseMap = new Map(plan.allChunks.map((chunk, index) => [chunk.id, baseVecs[index]]));
	const results = [];
	for (const variant of variants) {
		const variantInputs = byVariant.get(variant.label) ?? [];
		const variantVecs = variantInputs.map((text) => vector(text, idf));
		const variantMap = new Map(plan.allChunks.map((chunk, index) => [chunk.id, variantVecs[index]]));
		const rows = [];
		for (let caseIndex = 0; caseIndex < plan.cases.length; caseIndex++) {
			const row = plan.cases[caseIndex];
			const queryVec = queryVecs[caseIndex];
			const candidateDocs = plan.candidateDocsByCase.get(row.id) ?? [];
			const candidateChunks = candidateDocs.flatMap((doc) => plan.chunksByFile.get(doc.path) ?? []);
			const targetChunks = (plan.chunksByFile.get(row.targetPath) ?? []).slice(0, 3).map((chunk) => chunk.id);
			const chunkA = candidateChunks.map((chunk) => ({ id: chunk.id, score: cosine(queryVec, baseMap.get(chunk.id)) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
			const chunkB = candidateChunks.map((chunk) => ({ id: chunk.id, score: cosine(queryVec, variantMap.get(chunk.id)) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
			const fileA = candidateDocs.map((doc) => {
				const scores = (plan.chunksByFile.get(doc.path) ?? []).map((chunk) => cosine(queryVec, baseMap.get(chunk.id))).sort((l, r) => r - l);
				return { id: doc.path, score: (scores[0] ?? 0) + (scores[1] ?? 0) * 0.35 + (scores[2] ?? 0) * 0.2 };
			}).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
			const fileB = candidateDocs.map((doc) => {
				const scores = (plan.chunksByFile.get(doc.path) ?? []).map((chunk) => cosine(queryVec, variantMap.get(chunk.id))).sort((l, r) => r - l);
				return { id: doc.path, score: (scores[0] ?? 0) + (scores[1] ?? 0) * 0.35 + (scores[2] ?? 0) * 0.2 };
			}).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
			rows.push({ armA: { mrr: rr([row.targetPath], fileA), hits25: hit25([row.targetPath], fileA), chunkMrr: rr(targetChunks, chunkA), chunkHits25: hit25(targetChunks, chunkA), firstRank: first([row.targetPath], fileA), chunkFirstRank: first(targetChunks, chunkA) }, armB: { mrr: rr([row.targetPath], fileB), hits25: hit25([row.targetPath], fileB), chunkMrr: rr(targetChunks, chunkB), chunkHits25: hit25(targetChunks, chunkB), firstRank: first([row.targetPath], fileB), chunkFirstRank: first(targetChunks, chunkB) } });
		}
		const count = rows.length || 1;
		const sum = (picker) => rows.reduce((acc, row) => acc + picker(row), 0) / count;
		const avgRank = (picker) => {
			const values = rows.map(picker).filter(Number.isFinite);
			return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Infinity;
		};
		results.push({
			label: variant.label,
			summary: {
				armB: {
					mrr: sum((row) => row.armB.mrr),
					hits25: sum((row) => row.armB.hits25),
					chunkMrr: sum((row) => row.armB.chunkMrr),
					chunkHits25: sum((row) => row.armB.chunkHits25),
					avgFirstRank: avgRank((row) => row.armB.firstRank),
					avgChunkFirstRank: avgRank((row) => row.armB.chunkFirstRank),
				},
			},
			estimatedContextTokens: variantInputs.reduce((acc, text, index) => acc + Math.max(0, countTokens(text) - countTokens(bodyOnly[index] ?? "")), 0),
		});
	}
	return { mode: "local-budget-sweep", vaultRoot: plan.vaultRoot, contextMaxDepth: args.contextMaxDepth, cases: plan.cases, uniqueCandidateFiles: plan.uniqueCandidateFiles, uniqueChunks: plan.uniqueChunks, variants: results };
}

function printSweep(plan, payload) {
	console.log("");
	console.log("Hybrid Local Context Budget Sweep");
	console.log("=================================");
	console.log(`vaultRoot=${plan.vaultRoot}`);
	console.log(`cases=${plan.cases.length}, uniqueCandidateFiles=${plan.uniqueCandidateFiles}, uniqueChunks=${plan.uniqueChunks}, contextMaxDepth=${payload.contextMaxDepth}`);
	console.log("");
	console.log("Variant Summary");
	console.log("---------------");
	for (const row of payload.variants) {
		console.log(`variant=${row.label} fileHits@25=${row.summary.armB.hits25.toFixed(3)} fileMRR=${row.summary.armB.mrr.toFixed(3)} chunkHits@25=${row.summary.armB.chunkHits25.toFixed(3)} chunkMRR=${row.summary.armB.chunkMrr.toFixed(3)} avgChunkRank=${Number.isFinite(row.summary.armB.avgChunkFirstRank) ? row.summary.armB.avgChunkFirstRank.toFixed(3) : "inf"} estContextTokens=${row.estimatedContextTokens}`);
	}
}

async function main() {
	const args = parseArgs(process.argv);
	if (args.mode === "local-budget-sweep") {
		const plan = buildPlan(args);
		const budget = estimateApiBudget(plan, args);
		printDryRun(plan);
		console.log("");
		console.log("Estimated API Budget");
		console.log("--------------------");
		console.log(`queryTokens=${budget.queryTokens}, baseChunkTokens=${budget.baseChunkTokens}`);
		for (const row of budget.variantBudgets) {
			console.log(
				`variant=${row.label} oneShotTotal=${row.totalTokensOneShot} extraContext=${row.extraContextTokens}`,
			);
		}
		console.log(`allVariantsTotal=${budget.allVariantsTotalTokens}`);
		if (args.dryRun) {
			fs.writeFileSync(
				args.output,
				`${JSON.stringify({ mode: "dry-run", ...plan, budget, candidateDocsByCase: undefined, chunksByFile: undefined, allChunks: undefined }, null, 2)}\n`,
				"utf8",
			);
			return;
		}
		const payload = runLocalBudgetSweep(plan, args);
		fs.writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		printSweep(plan, payload);
		return;
	}

	if (args.mode === "api-source-overlap" || args.mode === "api-ab") {
		const plan = buildApiSourceOverlapPlan(args);
		if (args.dryRun) {
			const budget = estimateApiSourceOverlapBudget(plan);
			printApiSourceOverlapDryRun(plan, args);
			fs.writeFileSync(
				args.output,
				`${JSON.stringify({
					mode: "api-source-overlap-dry-run",
					vaultRoot: plan.vaultRoot,
					docCount: plan.docCount,
					chunkCount: plan.chunkCount,
					cases: plan.cases,
					budget,
				}, null, 2)}\n`,
				"utf8",
			);
			return;
		}
		const payload = await runApiSourceOverlap(plan, args);
		fs.writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		printApiSourceOverlap(plan, payload, args);
		return;
	}

	throw new Error(`Unsupported mode: ${args.mode}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
