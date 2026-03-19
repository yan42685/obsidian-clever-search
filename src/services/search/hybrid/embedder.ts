import { OuterSetting } from 'src/globals/plugin-setting';
import { getInstance } from 'src/utils/my-lib';
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

type CacheEntry = {
	vec: Int8Array;
	scale: number;
	vecF16?: Uint16Array;
	ts: number;
};

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

	private get apiKey(): string {
		return this.setting.apiProvider1?.key ?? '';
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
	): Promise<Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }>> {
		if (!this.apiKey) throw new NoApiKeyError();

		const results: Array<{ vec: Int8Array; scale: number; vecF16?: Uint16Array }> = [];

		for (let i = 0; i < texts.length; i += BATCH_SIZE) {
			const batch = texts.slice(i, i + BATCH_SIZE);
			const floats = await this.fetchEmbeddings(batch);
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

	private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
		const resp = await fetch(OPENAI_EMBED_URL, {
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
		return data.map(d => d.embedding);
	}

	// ─── LRU cache ───────────────────────────────────────────────────────────

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
