import { OuterSetting } from 'src/globals/plugin-setting';
import { Database } from 'src/services/database/database';
import { MyNotice } from 'src/services/obsidian/transformed-api';
import { estimateTokenCount } from 'src/services/search/hybrid/chunker';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import { throttle } from 'throttle-debounce';
import { EMBED_DIM, type StoredVector, type VectorPrecision } from './hybrid-types';
import {
	NoApiKeyError,
	WeeklyTokenLimitExceededError,
} from './provider-error';
import {
	profileHybridStage,
	recordHybridProfileMetric,
} from './hybrid-profiler';
import { AsyncRateGate, retryAsync } from './runtime-control';

const DEFAULT_DASHSCOPE_DOMAIN = 'dashscope.aliyuncs.com';
const EMBED_MODEL = 'text-embedding-v4';
const BATCH_SIZE = 10;
const CACHE_MAX = 50;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const REQUEST_TIMEOUT_MS = 45_000;
const REQUEST_MAX_RETRIES = 4;
const REQUEST_MIN_SPACING_MS = 250;
const REQUEST_RETRY_BASE_MS = 1_200;
const TOKEN_SAVINGS_TOTAL_KEY = 'all';
let inFlightEstimatedTokens = 0;
let lastKnownCurrentWeekTokenUsage: { weekKey: string; tokens: number } | null = null;

type EmbedBatchOptions = {
	maxAttempts?: number;
};

export { NoApiKeyError, WeeklyTokenLimitExceededError } from './provider-error';

export class HybridDisabledError extends Error {
	constructor() {
		super('Hybrid search disabled');
		this.name = 'HybridDisabledError';
	}
}

type ProviderEmbeddingResponse = {
	data?: Array<{ index?: number; embedding?: number[] }>;
	usage?: { total_tokens?: number; input_tokens?: number };
};

export type WeeklyTokenReservation = {
	release: () => void;
};

type CacheEntry = {
	vector: StoredVector;
	ts: number;
};

const noticeWeeklyLimitReached = throttle(
	5000,
	(text: string) => new MyNotice(text, 5000),
);

function createEmbedAbortError(): Error {
	const error = new Error('Hybrid embedding request aborted');
	error.name = 'AbortError';
	return error;
}

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
	private static requestGate = new AsyncRateGate(REQUEST_MIN_SPACING_MS);

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
		signal?: AbortSignal,
	): Promise<StoredVector> {
		const cached = this.getCache(text, precision);
		if (cached) return cached;

		const [result] = await this.embedBatch(
			[text],
			precision,
			filePath,
			signal,
			{ maxAttempts: 1 },
		);
		this.setCache(text, precision, result);
		return result;
	}

	async embedBatch(
		texts: string[],
		precision: VectorPrecision = 'int8',
		filePath = '',
		signal?: AbortSignal,
		options: EmbedBatchOptions = {},
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
			const estimatedTokens = estimateTextsTokenUsage(batch);
			const reservation = await profileHybridStage(
				'embed.ensure_weekly_budget',
				async () => await reserveWeeklyTokenBudget(estimatedTokens),
			);
			try {
				const { embeddings: floats, tokensUsed } = await profileHybridStage(
					'embed.fetch_embeddings',
					async () =>
						await this.fetchEmbeddings(batch, signal, {
							maxAttempts: options.maxAttempts,
						}),
				);
				logger.debug(
					`embedBatch request: file=${filePath || '<query>'}, batch=${Math.floor(i / BATCH_SIZE) + 1}, size=${batch.length}, tokens=${tokensUsed}, elapsed=${Date.now() - requestStart} ms`,
				);
				if (tokensUsed > 0) {
					recordHybridProfileMetric('provider_tokens', tokensUsed);
					await recordTokenUsage(filePath, tokensUsed);
				}
				await profileHybridStage('embed.quantize_vectors', async () => {
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
					return;
				});
			} finally {
				reservation.release();
			}
		}

		logger.debug(
			`embedBatch finished: file=${filePath || '<query>'}, chunks=${texts.length}, elapsed=${Date.now() - batchStart} ms`,
		);

		return results;
	}

	private async fetchEmbeddings(
		texts: string[],
		externalSignal?: AbortSignal,
		options: EmbedBatchOptions = {},
	): Promise<{ embeddings: number[][]; tokensUsed: number }> {
		const maxAttempts = Math.max(1, options.maxAttempts ?? REQUEST_MAX_RETRIES);
		return retryAsync(
			async (attempt) => {
				const controller = new AbortController();
				const forwardAbort = () => controller.abort();
				if (externalSignal) {
					if (externalSignal.aborted) {
						controller.abort();
					} else {
						externalSignal.addEventListener('abort', forwardAbort, { once: true });
					}
				}
				const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
				try {
					if (externalSignal?.aborted) {
						throw createEmbedAbortError();
					}
					await Embedder.requestGate.wait();
					if (externalSignal?.aborted) {
						throw createEmbedAbortError();
					}
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
						signal: controller.signal,
					});

					if (!resp.ok) {
						const body = await resp.text();
						logger.error(
							`Qwen embedding request failed: status=${resp.status}, url=${this.apiDomain}, body=${body}`,
						);
						if (this.isRetryableStatus(resp.status)) {
							const error = new Error(`Qwen embedding API error ${resp.status}: ${body}`);
							(error as Error & { retryAfterHeader?: string | null }).retryAfterHeader =
								resp.headers.get('retry-after');
							throw error;
						}
						throw new Error(`Qwen embedding API error ${resp.status}: ${body}`);
					}

					const body = await resp.text();
					const json = parseEmbeddingJsonResponse({
						body,
						contentType: resp.headers.get('content-type'),
						status: resp.status,
						url: this.apiDomain,
					});
					const tokensUsed = json.usage?.total_tokens ?? json.usage?.input_tokens ?? 0;
					return {
						embeddings: this.validateEmbeddingResponse(texts, json),
						tokensUsed,
					};
				} finally {
					clearTimeout(timeoutId);
					if (externalSignal) {
						externalSignal.removeEventListener('abort', forwardAbort);
					}
				}
			},
			{
				maxAttempts,
				shouldRetry: (error) =>
					maxAttempts > 1 &&
					!externalSignal?.aborted &&
					this.isRetryableError(error),
				getDelayMs: (error, attempt) =>
					this.getRetryDelayMs(
						attempt,
						(error as Error & { retryAfterHeader?: string | null }).retryAfterHeader,
					),
				onRetry: (error, attempt, delayMs) => {
					logger.warn(
						`Qwen embedding request retrying: attempt=${attempt}/${maxAttempts}, delay=${delayMs} ms`,
						error,
					);
				},
			},
		);
	}

	private validateEmbeddingResponse(
		texts: string[],
		json: ProviderEmbeddingResponse,
	): number[][] {
		if (!Array.isArray(json.data)) {
			throw new Error('Qwen embedding response missing data array');
		}
		if (json.data.length !== texts.length) {
			throw new Error(
				`Qwen embedding response count mismatch: expected ${texts.length}, received ${json.data.length}`,
			);
		}

		const embeddings = new Array<number[]>(texts.length);
		const seenIndexes = new Set<number>();
		for (const item of json.data) {
			const rawIndex = item?.index;
			if (
				typeof rawIndex !== 'number' ||
				!Number.isInteger(rawIndex) ||
				rawIndex < 0 ||
				rawIndex >= texts.length
			) {
				throw new Error(`Qwen embedding response index out of range: ${String(rawIndex)}`);
			}
			const index = rawIndex;
			if (seenIndexes.has(index)) {
				throw new Error(`Qwen embedding response repeated index: ${index}`);
			}
			seenIndexes.add(index);

			const embedding = item?.embedding;
			if (!Array.isArray(embedding)) {
				throw new Error(`Qwen embedding response missing embedding array at index ${index}`);
			}
			if (embedding.length !== EMBED_DIM) {
				throw new Error(
					`Qwen embedding response dimension mismatch at index ${index}: expected ${EMBED_DIM}, received ${embedding.length}`,
				);
			}
			for (let valueIndex = 0; valueIndex < embedding.length; valueIndex++) {
				if (!Number.isFinite(embedding[valueIndex])) {
					throw new Error(
						`Qwen embedding response contains non-finite value at index ${index}, offset ${valueIndex}`,
					);
				}
			}
			embeddings[index] = embedding;
		}

		for (let index = 0; index < embeddings.length; index++) {
			if (!embeddings[index]) {
				throw new Error(`Qwen embedding response missing item for index ${index}`);
			}
		}

		return embeddings;
	}

	private getRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
		const retryAfterSeconds = Number(retryAfterHeader ?? '');
		if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
			return Math.round(retryAfterSeconds * 1000);
		}
		const jitter = Math.round(Math.random() * 250);
		return REQUEST_RETRY_BASE_MS * attempt * attempt + jitter;
	}

	private isRetryableStatus(status: number): boolean {
		return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
	}

	private isRetryableError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}
		if (error.name === 'AbortError' || error.name === 'TypeError') {
			return true;
		}
		const message = `${error.name}: ${error.message}`.toLowerCase();
		return (
			message.includes('failed to fetch') ||
			message.includes('network') ||
			message.includes('timeout') ||
			message.includes('econn') ||
			message.includes('socket')
		);
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

function currentWeekSavingsKey(now = new Date()): string {
	return getCurrentWeekDateRange(now).fromDate;
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

async function getCurrentWeekTokenResetOffset(weekKey: string): Promise<number> {
	const db = getInstance(Database).db;
	const record = await db.hybridTokenBudgetResets
		.where('periodKey')
		.equals(weekKey)
		.first();
	return record?.tokens ?? 0;
}

async function readCurrentWeekTokenUsageStrict(): Promise<number> {
	const { fromDate, toDate } = getCurrentWeekDateRange();
	const [tokens, resetOffset] = await Promise.all([
		getTotalTokensStrict(fromDate, toDate),
		getCurrentWeekTokenResetOffset(fromDate),
	]);
	const effectiveTokens = Math.max(0, tokens - resetOffset);
	lastKnownCurrentWeekTokenUsage = {
		weekKey: fromDate,
		tokens: effectiveTokens,
	};
	return effectiveTokens;
}

export async function getCurrentWeekTokenUsage(): Promise<number> {
	try {
		return await readCurrentWeekTokenUsageStrict();
	} catch {
		const { fromDate } = getCurrentWeekDateRange();
		if (lastKnownCurrentWeekTokenUsage?.weekKey === fromDate) {
			return lastKnownCurrentWeekTokenUsage.tokens;
		}
		return 0;
	}
}

export async function resetCurrentWeekTokenUsage(): Promise<void> {
	const { fromDate, toDate } = getCurrentWeekDateRange();
	try {
		const db = getInstance(Database).db;
		const tokens = await getTotalTokensStrict(fromDate, toDate);
		await db.transaction('rw', db.hybridTokenBudgetResets, async () => {
			const existing = await db.hybridTokenBudgetResets
				.where('periodKey')
				.equals(fromDate)
				.first();
			if (existing?.id !== undefined) {
				await db.hybridTokenBudgetResets.update(existing.id, { tokens });
				return;
			}
			await db.hybridTokenBudgetResets.add({
				periodKey: fromDate,
				tokens,
			});
		});
		lastKnownCurrentWeekTokenUsage = {
			weekKey: fromDate,
			tokens: 0,
		};
	} catch (error) {
		logger.error('Failed to reset current week token usage.', error);
		throw error;
	}
}

export async function recordTokenUsage(filePath: string, tokens: number): Promise<void> {
	if (!filePath || tokens <= 0) return;
	try {
		const db = getInstance(Database).db;
		const key = todayKey();
		await db.transaction('rw', db.hybridTokenStats, async () => {
			const existingRecords = await db.hybridTokenStats
				.where('[filePath+dateKey]')
				.equals([filePath, key])
				.toArray();
			if (existingRecords.length === 0) {
				await db.hybridTokenStats.add({ filePath, dateKey: key, tokens });
				return;
			}

			const [primaryRecord, ...duplicateRecords] = existingRecords;
			if (primaryRecord?.id === undefined) {
				return;
			}

			const mergedTokens = existingRecords.reduce((sum, record) => sum + record.tokens, 0) + tokens;
			await db.hybridTokenStats.update(primaryRecord.id, { tokens: mergedTokens });

			const duplicateIds = duplicateRecords
				.map((record) => record.id)
				.filter((id): id is number => id !== undefined);
			if (duplicateIds.length > 0) {
				await db.hybridTokenStats.bulkDelete(duplicateIds);
			}
		});
	} catch {
		// non-critical
	}
}

async function accumulateTokenSavings(
	table: Database['db']['hybridTokenSavings'],
	scope: 'week' | 'total',
	periodKey: string,
	tokens: number,
): Promise<void> {
	const existing = await table
		.where('[scope+periodKey]')
		.equals([scope, periodKey])
		.first();
	if (existing?.id !== undefined) {
		await table.update(existing.id, {
			tokens: existing.tokens + tokens,
		});
		return;
	}
	await table.add({
		scope,
		periodKey,
		tokens,
	});
}

export async function recordEstimatedTokenSavings(
	tokens: number,
	now = new Date(),
): Promise<void> {
	if (tokens <= 0) {
		return;
	}
	try {
		const db = getInstance(Database).db;
		const weekKey = currentWeekSavingsKey(now);
		await db.transaction('rw', db.hybridTokenSavings, async () => {
			await accumulateTokenSavings(
				db.hybridTokenSavings,
				'week',
				weekKey,
				tokens,
			);
			await accumulateTokenSavings(
				db.hybridTokenSavings,
				'total',
				TOKEN_SAVINGS_TOTAL_KEY,
				tokens,
			);
		});
	} catch {
		// non-critical
	}
}

export async function getEstimatedTokenSavingsSummary(
	now = new Date(),
): Promise<{ week: number; total: number }> {
	try {
		const db = getInstance(Database).db;
		const weekKey = currentWeekSavingsKey(now);
		const [weekRecord, totalRecord] = await Promise.all([
			db.hybridTokenSavings
				.where('[scope+periodKey]')
				.equals(['week', weekKey])
				.first(),
			db.hybridTokenSavings
				.where('[scope+periodKey]')
				.equals(['total', TOKEN_SAVINGS_TOTAL_KEY])
				.first(),
		]);
		return {
			week: weekRecord?.tokens ?? 0,
			total: totalRecord?.tokens ?? 0,
		};
	} catch {
		return {
			week: 0,
			total: 0,
		};
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
		return await getTotalTokensStrict(fromDate, toDate);
	} catch {
		return 0;
	}
}

async function getTotalTokensStrict(fromDate: string, toDate: string): Promise<number> {
	const db = getInstance(Database).db;
	const records = await db.hybridTokenStats
		.where('dateKey')
		.between(fromDate, toDate, true, true)
		.toArray();
	return records.reduce((sum, r) => sum + r.tokens, 0);
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

function parseEmbeddingJsonResponse(params: Readonly<{
	body: string;
	contentType: string | null;
	status: number;
	url: string;
}>): ProviderEmbeddingResponse {
	const { body, contentType, status, url } = params;
	const trimmed = body.trim();
	if (!trimmed) {
		throw new Error(
			`Qwen embedding API returned an empty response: status=${status}, url=${url}, contentType=${contentType ?? '<missing>'}`,
		);
	}
	try {
		return JSON.parse(trimmed) as ProviderEmbeddingResponse;
	} catch (error) {
		const preview = trimmed.slice(0, 240).replace(/\s+/g, ' ');
		throw new Error(
			`Qwen embedding API returned non-JSON response: status=${status}, url=${url}, contentType=${contentType ?? '<missing>'}, bodyPreview=${preview}`,
		);
	}
}

export function estimateTextTokenUsage(text: string): number {
	return Math.max(1, Math.ceil(estimateTokenCount(text)));
}

export function estimateTextsTokenUsage(texts: string[]): number {
	return texts.reduce((sum, text) => sum + estimateTextTokenUsage(text), 0);
}

function releaseInFlightEstimatedTokens(tokens: number): void {
	if (tokens <= 0) {
		return;
	}
	inFlightEstimatedTokens = Math.max(0, inFlightEstimatedTokens - tokens);
}

export async function reserveWeeklyTokenBudget(
	estimatedTokens: number,
): Promise<WeeklyTokenReservation> {
	if (estimatedTokens <= 0) {
		return { release: () => undefined };
	}

	const limit = getInstance(OuterSetting).hybrid?.weeklyTokenLimit ?? 0;
	if (limit <= 0) {
		return { release: () => undefined };
	}

	let used: number;
	try {
		used = await readCurrentWeekTokenUsageStrict();
	} catch (error) {
		const { fromDate } = getCurrentWeekDateRange();
		if (lastKnownCurrentWeekTokenUsage?.weekKey === fromDate) {
			used = lastKnownCurrentWeekTokenUsage.tokens;
			logger.warn('Failed to read weekly token usage from DB; using last known current-week value.', error);
		} else {
			logger.error('Failed to verify weekly token usage; refusing provider request.', error);
			throw new Error('Unable to verify weekly token usage before sending provider request');
		}
	}
	const effectiveUsed = used + inFlightEstimatedTokens;
	if (effectiveUsed < limit && effectiveUsed + estimatedTokens <= limit) {
		inFlightEstimatedTokens += estimatedTokens;
		let released = false;
		return {
			release: () => {
				if (released) {
					return;
				}
				released = true;
				releaseInFlightEstimatedTokens(estimatedTokens);
			},
		};
	}

	noticeWeeklyLimitReached(
		`Weekly token limit reached: used ${used}, in-flight ${inFlightEstimatedTokens}, limit ${limit}, remaining quota 0`,
	);
	throw new WeeklyTokenLimitExceededError(limit, effectiveUsed, estimatedTokens);
}

export async function ensureWeeklyTokenBudget(estimatedTokens: number): Promise<void> {
	const reservation = await reserveWeeklyTokenBudget(estimatedTokens);
	reservation.release();
}
