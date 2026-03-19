import { OuterSetting } from 'src/globals/plugin-setting';
import { Database } from 'src/services/database/database';
import { MyNotice } from 'src/services/obsidian/transformed-api';
import { getInstance } from 'src/utils/my-lib';
import { throttle } from 'throttle-debounce';
import { EMBED_DIM, type VectorPrecision } from './hybrid-types';

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;
const CACHE_MAX = 50;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export class NoApiKeyError extends Error {
	constructor() {
		super('No OpenAI API key configured — falling back to BM25-only search');
		this.name = 'NoApiKeyError';
	}
}

export class WeeklyTokenLimitExceededError extends Error {
	readonly limit: number;
	readonly used: number;
	readonly estimated: number;

	constructor(limit: number, used: number, estimated: number) {
		super('Weekly token limit exceeded before sending embedding request');
		this.name = 'WeeklyTokenLimitExceededError';
		this.limit = limit;
		this.used = used;
		this.estimated = estimated;
	}
}

export class HybridDisabledError extends Error {
	constructor() {
		super('Hybrid search disabled');
		this.name = 'HybridDisabledError';
	}
}

type CacheEntry = {
	vec: Int8Array;
	scale: number;
	vecF16?: Uint16Array;
	ts: number;
};

const noticeWeeklyLimitReached = throttle(
	5000,
	(text: string) => new MyNotice(text, 5000),
);

// ─── Quantization helpers ─────────────────────────────────────────────────────

/** L2-normalize a float32 array in-place. */
function l2Normalize(v: number[]): void {
	let norm = 0;
	for (const x of v) norm += x * x;
	norm = Math.sqrt(norm);
	if (norm < 1e-10) return;
	for (let i = 0; i < v.length; i++) v[i] /= norm;
}

/** Quantize float32[] → Int8Array + scale. */
export function quantizeInt8(v: number[]): { vec: Int8Array; scale: number } {
	let maxAbs = 0;
	for (const x of v) if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x);
	const scale = maxAbs < 1e-10 ? 1 : maxAbs;
	const vec = new Int8Array(v.length);
	for (let i = 0; i < v.length; i++) {
		vec[i] = Math.round((v[i] / scale) * 127);
	}
	return { vec, scale };
}

/** Quantize float32[] → Uint16Array (IEEE 754 half-precision). */
export function quantizeFloat16(v: number[]): Uint16Array {
	const out = new Uint16Array(v.length);
	for (let i = 0; i < v.length; i++) {
		out[i] = float32ToFloat16(v[i]);
	}
	return out;
}

function float32ToFloat16(val: number): number {
	const buf = new ArrayBuffer(4);
	new Float32Array(buf)[0] = val;
	const bits = new Uint32Array(buf)[0];
	const sign = (bits >>> 31) & 0x1;
	const exp = (bits >>> 23) & 0xff;
	const frac = bits & 0x7fffff;
	if (exp === 0xff) {
		// NaN or Inf
		return (sign << 15) | 0x7c00 | (frac ? 0x200 : 0);
	}
	const newExp = exp - 127 + 15;
	if (newExp >= 31) return (sign << 15) | 0x7c00; // overflow → Inf
	if (newExp <= 0) {
		// subnormal
		const shift = 14 - newExp;
		return (sign << 15) | ((frac | 0x800000) >> shift);
	}
	return (sign << 15) | (newExp << 10) | (frac >> 13);
}

// ─── Embedder ─────────────────────────────────────────────────────────────────

export class Embedder {
	private readonly setting = getInstance(OuterSetting);
	private readonly cache = new Map<string, CacheEntry>();
	/** Current file being indexed — set by HybridEngine before calling embedBatch */

	private get apiKey(): string {
		return this.setting.hybrid?.apiKey ?? '';
	}

	private get apiDomain(): string {
		const domain = this.setting.hybrid?.apiDomain;
		return domain ? `https://${domain.replace(/^https?:\/\//, '')}/v1/embeddings` : OPENAI_EMBED_URL;
	}

	/** Embed a single query string (cached). */
	async embedQuery(
		text: string,
		precision: VectorPrecision = 'int8',
	): Promise<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }> {
		const cached = this.getCache(text);
		if (cached) return cached;

		const [result] = await this.embedBatch([text], precision);
		this.setCache(text, result);
		return result;
	}

	/**
	 * Embed a batch of texts.
	 * Automatically splits into chunks of BATCH_SIZE.
	 */
	async embedBatch(
		texts: string[],
		precision: VectorPrecision = 'int8',
		filePath = '',
	): Promise<Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }>> {
		if (!this.setting.hybrid?.enabled) throw new HybridDisabledError();
		if (!this.apiKey) throw new NoApiKeyError();

		const results: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }> = [];

		for (let i = 0; i < texts.length; i += BATCH_SIZE) {
			const batch = texts.slice(i, i + BATCH_SIZE);
			await this.ensureWeeklyLimitAllows(batch);
			const { embeddings: floats, tokensUsed } = await this.fetchEmbeddings(batch);
			if (tokensUsed > 0) {
				await recordTokenUsage(filePath, tokensUsed);
			}
			for (const f of floats) {
				l2Normalize(f);
				const { vec, scale } = quantizeInt8(f);
				const entry: { vec: Int8Array; scale: number; vecF16?: Uint16Array } = { vec, scale };
				if (precision === 'float16') {
					entry.vecF16 = quantizeFloat16(f);
				}
				results.push(entry);
			}
		}

		return results;
	}

	private async fetchEmbeddings(texts: string[]): Promise<{ embeddings: number[][]; tokensUsed: number }> {
		const resp = await fetch(this.apiDomain, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: EMBED_MODEL,
				input: texts,
				dimensions: EMBED_DIM,
				encoding_format: 'float',
			}),
		});

		if (!resp.ok) {
			const body = await resp.text();
			throw new Error(`OpenAI embedding API error ${resp.status}: ${body}`);
		}

		const json = await resp.json();
		// Sort by index to preserve order (OpenAI may reorder)
		const data: Array<{ index: number; embedding: number[] }> = json.data;
		data.sort((a, b) => a.index - b.index);
		const tokensUsed: number = json.usage?.total_tokens ?? 0;
		return { embeddings: data.map(d => d.embedding), tokensUsed };
	}

	// ─── LRU cache ───────────────────────────────────────────────────────────

	private async ensureWeeklyLimitAllows(texts: string[]): Promise<void> {
		const limit = this.setting.hybrid?.weeklyTokenLimit ?? 0;
		if (limit <= 0) return;

		const used = await getCurrentWeekTokenUsage();
		const estimated = estimateBatchTokens(texts);
		if (used < limit && used + estimated <= limit) return;

		noticeWeeklyLimitReached(
			`Weekly token limit reached: used ${used}, limit ${limit}, remaining quota 0`,
		);
		throw new WeeklyTokenLimitExceededError(limit, used, estimated);
	}

	private getCache(text: string): CacheEntry | null {
		const entry = this.cache.get(text);
		if (!entry) return null;
		if (Date.now() - entry.ts > CACHE_TTL_MS) {
			this.cache.delete(text);
			return null;
		}
		return entry;
	}

	private setCache(text: string, entry: Omit<CacheEntry, 'ts'>): void {
		if (this.cache.size >= CACHE_MAX) {
			// Evict oldest
			let oldestKey = '';
			let oldestTs = Infinity;
			for (const [k, v] of this.cache) {
				if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
			}
			if (oldestKey) this.cache.delete(oldestKey);
		}
		this.cache.set(text, { ...entry, ts: Date.now() });
	}
}

// ─── Token usage tracking ─────────────────────────────────────────────────────

function todayKey(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getCurrentWeekDateRange(now = new Date()): { fromDate: string; toDate: string } {
	const current = new Date(now);
	current.setHours(0, 0, 0, 0);

	const start = new Date(current);
	const day = start.getDay();
	const diffToMonday = day === 0 ? 6 : day - 1;
	start.setDate(start.getDate() - diffToMonday);

	const end = new Date(start);
	end.setDate(start.getDate() + 6);

	return {
		fromDate: dateKey(start),
		toDate: dateKey(end),
	};
}

export async function getCurrentWeekTokenUsage(): Promise<number> {
	const { fromDate, toDate } = getCurrentWeekDateRange();
	return getTotalTokens(fromDate, toDate);
}

export async function recordTokenUsage(filePath: string, tokens: number): Promise<void> {
	if (!filePath || tokens <= 0) return;
	try {
		const db = getInstance(Database).db;
		const dateKey = todayKey();
		const existing = await db.hybridTokenStats
			.where('[filePath+dateKey]')
			.equals([filePath, dateKey])
			.first();
		if (existing?.id !== undefined) {
			await db.hybridTokenStats.update(existing.id, { tokens: existing.tokens + tokens });
		} else {
			await db.hybridTokenStats.add({ filePath, dateKey, tokens });
		}
	} catch {
		// non-critical — ignore errors
	}
}

/** Returns top-N files by total tokens within the given date range (inclusive). */
export async function getTopTokenFiles(
	fromDate: string,
	toDate: string,
	topN = 20,
): Promise<Array<{ filePath: string; tokens: number }>> {
	try {
		const db = getInstance(Database).db;
		const records = await db.hybridTokenStats
			.where('dateKey')
			.between(fromDate, toDate, true, true)
			.toArray();
		const totals = new Map<string, number>();
		for (const r of records) {
			totals.set(r.filePath, (totals.get(r.filePath) ?? 0) + r.tokens);
		}
		return Array.from(totals.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, topN)
			.map(([filePath, tokens]) => ({ filePath, tokens }));
	} catch {
		return [];
	}
}

/** Returns total tokens consumed within the given date range. */
export async function getTotalTokens(fromDate: string, toDate: string): Promise<number> {
	try {
		const db = getInstance(Database).db;
		const records = await db.hybridTokenStats
			.where('dateKey')
			.between(fromDate, toDate, true, true)
			.toArray();
		return records.reduce((sum, r) => sum + r.tokens, 0);
	} catch {
		return 0;
	}
}

function estimateBatchTokens(texts: string[]): number {
	return texts.reduce((sum, text) => sum + estimateTextTokens(text), 0);
}

function estimateTextTokens(text: string): number {
	let asciiChars = 0;
	let nonAsciiChars = 0;
	for (const char of text) {
		if (char.charCodeAt(0) <= 0x7f) {
			asciiChars++;
		} else {
			nonAsciiChars++;
		}
	}
	return Math.max(1, Math.ceil(nonAsciiChars + asciiChars / 4));
}
