import { OuterSetting } from 'src/globals/plugin-setting';
import { Database } from 'src/services/database/database';
import { MyNotice } from 'src/services/obsidian/transformed-api';
import { estimateTokenCount } from 'src/services/search/hybrid/chunker';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import { throttle } from 'throttle-debounce';
import { EMBED_DIM, type StoredVector, type VectorPrecision } from './hybrid-types';

const DEFAULT_DASHSCOPE_DOMAIN = 'dashscope.aliyuncs.com';
const EMBED_MODEL = 'text-embedding-v4';
const BATCH_SIZE = 10;
const CACHE_MAX = 50;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export class NoApiKeyError extends Error {
	constructor() {
		super('No Qwen API key configured; falling back to BM25-only search');
		this.name = 'NoApiKeyError';
	}
}

export class WeeklyTokenLimitExceededError extends Error {
	readonly limit: number;
	readonly used: number;
	readonly estimated: number;

	constructor(limit: number, used: number, estimated: number) {
		super('Weekly token limit exceeded before sending provider request');
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
	vector: StoredVector;
	ts: number;
};

const noticeWeeklyLimitReached = throttle(
	5000,
	(text: string) => new MyNotice(text, 5000),
);

function l2Normalize(v: number[]): void {
	let norm = 0;
	for (const x of v) norm += x * x;
	norm = Math.sqrt(norm);
	if (norm < 1e-10) return;
	for (let i = 0; i < v.length; i++) v[i] /= norm;
}

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
		return (sign << 15) | 0x7c00 | (frac ? 0x200 : 0);
	}
	const newExp = exp - 127 + 15;
	if (newExp >= 31) return (sign << 15) | 0x7c00;
	if (newExp <= 0) {
		const shift = 14 - newExp;
		return (sign << 15) | ((frac | 0x800000) >> shift);
	}
	return (sign << 15) | (newExp << 10) | (frac >> 13);
}

export class Embedder {
	private readonly setting = getInstance(OuterSetting);
	private readonly cache = new Map<string, CacheEntry>();

	private get apiKey(): string {
		return this.setting.hybrid?.apiKey?.trim() ?? '';
	}

	private get apiDomain(): string {
		return buildDashScopeApiUrl(this.setting.hybrid?.apiDomain, 'embedding');
	}

	async embedQuery(
		text: string,
		precision: VectorPrecision = 'int8',
		filePath = '',
	): Promise<StoredVector> {
		const cached = this.getCache(text, precision);
		if (cached) return cached;

		const [result] = await this.embedBatch([text], precision, filePath);
		this.setCache(text, precision, result);
		return result;
	}

	async embedBatch(
		texts: string[],
		precision: VectorPrecision = 'int8',
		filePath = '',
	): Promise<StoredVector[]> {
		if (!this.setting.hybrid?.enabled) throw new HybridDisabledError();
		if (!this.apiKey) throw new NoApiKeyError();

		const results: StoredVector[] = [];
		const batchStart = Date.now();
		logger.debug(
			`embedBatch start: file=${filePath || '<query>'}, chunks=${texts.length}, precision=${precision}`,
		);

		for (let i = 0; i < texts.length; i += BATCH_SIZE) {
			const batch = texts.slice(i, i + BATCH_SIZE);
			const requestStart = Date.now();
			await ensureWeeklyTokenBudget(estimateTextsTokenUsage(batch));
			const { embeddings: floats, tokensUsed } = await this.fetchEmbeddings(batch);
			logger.debug(
				`embedBatch request: file=${filePath || '<query>'}, batch=${Math.floor(i / BATCH_SIZE) + 1}, size=${batch.length}, tokens=${tokensUsed}, elapsed=${Date.now() - requestStart} ms`,
			);
			if (tokensUsed > 0) {
				await recordTokenUsage(filePath, tokensUsed);
			}
			for (const f of floats) {
				l2Normalize(f);
				if (precision === 'float16') {
					results.push({
						precision: 'float16',
						vector: quantizeFloat16(f),
					});
					continue;
				}
				const { vec, scale } = quantizeInt8(f);
				results.push({
					precision: 'int8',
					vector: vec,
					scale,
				});
			}
		}

		logger.debug(
			`embedBatch finished: file=${filePath || '<query>'}, chunks=${texts.length}, elapsed=${Date.now() - batchStart} ms`,
		);

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
			logger.error(
				`Qwen embedding request failed: status=${resp.status}, url=${this.apiDomain}, body=${body}`,
			);
			throw new Error(`Qwen embedding API error ${resp.status}: ${body}`);
		}

		const json = await resp.json() as {
			data?: Array<{ index: number; embedding: number[] }>;
			usage?: { total_tokens?: number; input_tokens?: number };
		};
		const data: Array<{ index: number; embedding: number[] }> = Array.isArray(json.data)
			? json.data
			: [];
		data.sort((a, b) => a.index - b.index);
		const tokensUsed = json.usage?.total_tokens ?? json.usage?.input_tokens ?? 0;
		return { embeddings: data.map((item) => item.embedding), tokensUsed };
	}

	private getCache(text: string, precision: VectorPrecision): StoredVector | null {
		const entry = this.cache.get(this.buildCacheKey(text, precision));
		if (!entry) return null;
		if (Date.now() - entry.ts > CACHE_TTL_MS) {
			this.cache.delete(this.buildCacheKey(text, precision));
			return null;
		}
		return entry.vector;
	}

	private setCache(text: string, precision: VectorPrecision, vector: StoredVector): void {
		if (this.cache.size >= CACHE_MAX) {
			let oldestKey = '';
			let oldestTs = Infinity;
			for (const [k, v] of this.cache) {
				if (v.ts < oldestTs) {
					oldestTs = v.ts;
					oldestKey = k;
				}
			}
			if (oldestKey) this.cache.delete(oldestKey);
		}
		this.cache.set(this.buildCacheKey(text, precision), { vector, ts: Date.now() });
	}

	private buildCacheKey(text: string, precision: VectorPrecision): string {
		return `${precision}:${text}`;
	}
}

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
		const key = todayKey();
		const existing = await db.hybridTokenStats
			.where('[filePath+dateKey]')
			.equals([filePath, key])
			.first();
		if (existing?.id !== undefined) {
			await db.hybridTokenStats.update(existing.id, { tokens: existing.tokens + tokens });
		} else {
			await db.hybridTokenStats.add({ filePath, dateKey: key, tokens });
		}
	} catch {
		// non-critical
	}
}

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

export function normalizeApiDomain(domain?: string): string {
	const raw = domain?.trim();
	if (!raw) {
		return DEFAULT_DASHSCOPE_DOMAIN;
	}

	const withoutProtocol = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
	const compatibleIndex = withoutProtocol.search(/\/compatible-(mode|api)\b/i);
	const hostAndMaybePath =
		compatibleIndex >= 0
			? withoutProtocol.slice(0, compatibleIndex)
			: withoutProtocol;

	return hostAndMaybePath.split('/')[0] || DEFAULT_DASHSCOPE_DOMAIN;
}

export function buildDashScopeApiUrl(
	domain: string | undefined,
	apiType: 'embedding' | 'rerank',
): string {
	const host = normalizeApiDomain(domain);
	const path =
		apiType === 'embedding'
			? '/compatible-mode/v1/embeddings'
			: '/compatible-api/v1/reranks';
	return `https://${host}${path}`;
}

export function estimateTextTokenUsage(text: string): number {
	return Math.max(1, Math.ceil(estimateTokenCount(text)));
}

export function estimateTextsTokenUsage(texts: string[]): number {
	return texts.reduce((sum, text) => sum + estimateTextTokenUsage(text), 0);
}

export async function ensureWeeklyTokenBudget(estimatedTokens: number): Promise<void> {
	const limit = getInstance(OuterSetting).hybrid?.weeklyTokenLimit ?? 0;
	if (limit <= 0 || estimatedTokens <= 0) {
		return;
	}

	const used = await getCurrentWeekTokenUsage();
	if (used < limit && used + estimatedTokens <= limit) {
		return;
	}

	noticeWeeklyLimitReached(
		`Weekly token limit reached: used ${used}, limit ${limit}, remaining quota 0`,
	);
	throw new WeeklyTokenLimitExceededError(limit, used, estimatedTokens);
}
