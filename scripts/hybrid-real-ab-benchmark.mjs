import fs from "fs";
import path from "path";

const DEFAULT_CASE_LIMIT = 14;
const DEFAULT_TARGET_TOKENS = 260;
const DEFAULT_MAX_FILES_PER_QUERY = 12;
const DEFAULT_MAX_QUERIES_PER_DOC = 2;
const DEFAULT_CONTEXT_MAX_DEPTH = 4;
const DEFAULT_CONTEXT_VARIANTS = "14,15,16,18,20,22,24,25,26,28,30,32,33,35,40,adaptive";
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "scripts", "hybrid-real-ab-benchmark.output.json");

const ADAPTIVE_LABEL = "adaptive";
const BASE_BUDGET = 18;
const TOTAL_BUDGET = 30;
const FILE_MIN_BUDGET = 4;
const FILE_MAX_BUDGET = 6;

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
		else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice(7)) || 7;
		else if (arg.startsWith("--output=")) args.output = path.resolve(process.cwd(), arg.slice(9));
	}
	args.vaultRoot = args.vaultRoot || detectVaultRoot(process.cwd());
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
function terms(text) {
	return compact(String(text).toLowerCase())
		.replace(/https?:\/\/\S+/g, " ")
		.split(/[^a-z0-9\u4e00-\u9fff]+/u)
		.map((t) => t.trim())
		.filter((t) => t.length >= 2 && t.length <= 24 && !STOP.has(t) && !/^\d{3,}$/.test(t));
}
function uniqTerms(text) { return Array.from(new Set(terms(text))); }
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
	return [
		anchored && { query: anchored, targetPath: doc.path, style: "anchored" },
		fallback && fallback !== anchored && { query: fallback, targetPath: doc.path, style: "fallback" },
		weak && weak !== anchored && weak !== fallback && { query: weak, targetPath: doc.path, style: "weak_anchor" },
	].filter(Boolean);
}
function finalize(parts) {
	return Array.from(new Set(parts.map((p) => compact(p)).filter(Boolean)))
		.map((p) => /[\u4e00-\u9fff]/u.test(p) ? p.slice(0, 18) : p.split(/\s+/).slice(0, 4).join(" "))
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
	const plan = buildPlan(args);
	printDryRun(plan);
	if (args.dryRun) {
		fs.writeFileSync(args.output, `${JSON.stringify({ mode: "dry-run", ...plan, candidateDocsByCase: undefined, chunksByFile: undefined, allChunks: undefined }, null, 2)}\n`, "utf8");
		return;
	}
	if (args.mode === "local-budget-sweep") {
		const payload = runLocalBudgetSweep(plan, args);
		fs.writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		printSweep(plan, payload);
		return;
	}
	throw new Error("api-ab non-dry-run is intentionally disabled in this local benchmark script");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
