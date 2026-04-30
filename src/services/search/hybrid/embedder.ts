import { OuterSetting, type HybridEmbeddingProvider } from 'src/globals/plugin-setting';
import { Database } from 'src/services/database/database';
import { MyNotice } from 'src/services/obsidian/transformed-api';
import { estimateTokenCount } from 'src/services/search/hybrid/chunker';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';
import { throttle } from 'throttle-debounce';
import { EMBED_DIM, type StoredVector, type VectorPrecision } from './hybrid-types';
import {
	buildHybridProviderErrorDetails,
	NoApiKeyError,
	WeeklyTokenLimitExceededError,
} from './provider-error';
import {
	profileHybridStage,
	recordHybridProfileMetric,
} from './hybrid-profiler';
import { AsyncRateGate, retryAsync } from './runtime-control';

const DEFAULT_DASHSCOPE_DOMAIN = 'dashscope.aliyuncs.com';
const DEFAULT_OPENAI_DOMAIN = 'api.openai.com';
const QWEN_EMBED_MODEL = 'text-embedding-v4';
const OPENAI_EMBED_MODEL = 'text-embedding-3-large';
const CACHE_MAX = 50;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const REQUEST_TIMEOUT_MS = 45_000;
const REQUEST_MAX_RETRIES = 4;
const REQUEST_RETRY_BASE_MS = 1_200;
const TOKEN_SAVINGS_TOTAL_KEY = 'all';
let inFlightEstimatedTokens = 0;
let lastKnownCurrentWeekTokenUsage: { weekKey: string; tokens: number } | null = null;

type EmbedBatchOptions = {
	maxAttempts?: number;
	interactive?: boolean;
	provider?: HybridEmbeddingProvider;
};

type EmbeddingRequestProfile = Readonly<{
	maxBatchSize: number;
	minSpacingMs: number;
	flushDelayMs: number;
	concurrency: 1;
}>;

export type EmbeddingProviderSpec = Readonly<{
	id: HybridEmbeddingProvider;
	label: string;
	embeddingModel: string;
	rerankModel: string;
	defaultDomain: string;
}>;

export const EMBEDDING_PROVIDER_SPECS: Record<HybridEmbeddingProvider, EmbeddingProviderSpec> = {
	qwen: {
		id: 'qwen',
		label: 'Qwen text-embedding-v4',
		embeddingModel: QWEN_EMBED_MODEL,
		rerankModel: 'qwen3-rerank',
		defaultDomain: DEFAULT_DASHSCOPE_DOMAIN,
	},
	openai: {
		id: 'openai',
		label: 'OpenAI text-embedding-3-large',
		embeddingModel: OPENAI_EMBED_MODEL,
		rerankModel: 'gpt-5.4-nano',
		defaultDomain: DEFAULT_OPENAI_DOMAIN,
	},
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

type EmbeddingQueueItem = {
	id: number;
	owner: Embedder;
	provider: HybridEmbeddingProvider;
	text: string;
	precision: VectorPrecision;
	filePath: string;
	estimatedTokens: number;
	maxAttempts: number;
	interactive: boolean;
	signal?: AbortSignal;
	state: 'pending' | 'in-flight' | 'settled';
	resolve: (vector: StoredVector) => void;
	reject: (error: unknown) => void;
	abortHandler?: () => void;
};

type EmbeddingQueueEnqueueItem = Omit<
	EmbeddingQueueItem,
	'id' | 'state' | 'resolve' | 'reject' | 'abortHandler'
>;

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

export function getEmbeddingRequestProfile(
	provider: unknown,
): EmbeddingRequestProfile {
	const normalizedProvider = normalizeEmbeddingProvider(provider);
	if (normalizedProvider === 'openai') {
		return {
			maxBatchSize: 100,
			minSpacingMs: 0,
			flushDelayMs: 50,
			concurrency: 1,
		};
	}
	return {
		maxBatchSize: 10,
		minSpacingMs: 250,
		flushDelayMs: 50,
		concurrency: 1,
	};
}

class EmbeddingQueue {
	private pending: EmbeddingQueueItem[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushing = false;
	private nextItemId = 1;

	constructor(
		private readonly provider: HybridEmbeddingProvider,
		private readonly profile: EmbeddingRequestProfile,
	) {}

	enqueue(input: EmbeddingQueueEnqueueItem): Promise<StoredVector> {
		return new Promise<StoredVector>((resolve, reject) => {
			const item: EmbeddingQueueItem = {
				...input,
				id: this.nextItemId++,
				state: 'pending',
				resolve,
				reject,
			};

			const abortHandler = () => {
				if (item.state === 'settled') {
					return;
				}
				if (item.state === 'pending') {
					this.removePending(item);
				}
				this.settleItem(item, 'reject', createEmbedAbortError());
			};

			if (item.signal?.aborted) {
				reject(createEmbedAbortError());
				return;
			}
			if (item.signal) {
				item.abortHandler = abortHandler;
				item.signal.addEventListener('abort', abortHandler, { once: true });
			}

			this.pending.push(item);
			if (item.interactive || this.pending.length >= this.profile.maxBatchSize) {
				this.scheduleFlush(0);
				return;
			}
			this.scheduleFlush(this.profile.flushDelayMs);
		});
	}

	private scheduleFlush(delayMs: number): void {
		if (this.flushTimer) {
			if (delayMs > 0) {
				return;
			}
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, Math.max(0, delayMs));
	}

	private async flush(): Promise<void> {
		if (this.flushing) {
			if (this.pending.length > 0) {
				this.scheduleFlush(this.profile.flushDelayMs);
			}
			return;
		}
		this.flushing = true;
		try {
			while (this.pending.length > 0) {
				const batch = this.takeNextBatch();
				if (batch.length === 0) {
					break;
				}
				await this.processBatch(batch);
			}
		} finally {
			this.flushing = false;
			if (this.pending.length > 0) {
				this.scheduleFlush(this.profile.flushDelayMs);
			}
		}
	}

	private takeNextBatch(): EmbeddingQueueItem[] {
		const prioritized = this.pending
			.map((item, order) => ({ item, order }))
			.sort((a, b) => {
				if (a.item.interactive !== b.item.interactive) {
					return a.item.interactive ? -1 : 1;
				}
				return a.order - b.order;
			})
			.slice(0, this.profile.maxBatchSize)
			.map(({ item }) => item);
		const selected = new Set(prioritized.map((item) => item.id));
		this.pending = this.pending.filter((item) => !selected.has(item.id));
		for (const item of prioritized) {
			item.state = 'in-flight';
		}
		return prioritized;
	}

	private async processBatch(batch: EmbeddingQueueItem[]): Promise<void> {
		const liveBatch = batch.filter((item) => item.state !== 'settled');
		if (liveBatch.length === 0) {
			return;
		}

		const requestStart = Date.now();
		const estimatedTokens = liveBatch.reduce(
			(sum, item) => sum + item.estimatedTokens,
			0,
		);
		const maxAttempts = Math.min(...liveBatch.map((item) => item.maxAttempts));
		let reservation: WeeklyTokenReservation | null = null;
		try {
			reservation = await profileHybridStage(
				'embed.ensure_weekly_budget',
				async () => await reserveWeeklyTokenBudget(estimatedTokens),
			);
			const { embeddings: floats, tokensUsed } = await profileHybridStage(
				'embed.fetch_embeddings',
				async () =>
					await liveBatch[0].owner.fetchQueuedEmbeddings(
						liveBatch.map((item) => item.text),
						this.provider,
						maxAttempts,
					),
			);
			logger.debug(
				`embed queue request: provider=${this.provider}, size=${liveBatch.length}, tokens=${tokensUsed}, elapsed=${Date.now() - requestStart} ms`,
			);
			if (tokensUsed > 0) {
				recordHybridProfileMetric('provider_tokens', tokensUsed);
				await this.recordTokenUsageForBatch(liveBatch, tokensUsed, estimatedTokens);
			}
			const vectors = await profileHybridStage(
				'embed.quantize_vectors',
				async () => this.quantizeBatch(liveBatch, floats),
			);
			for (let i = 0; i < liveBatch.length; i++) {
				this.settleItem(liveBatch[i], 'resolve', vectors[i]);
			}
		} catch (error) {
			for (const item of liveBatch) {
				this.settleItem(item, 'reject', error);
			}
		} finally {
			reservation?.release();
		}
	}

	private async recordTokenUsageForBatch(
		batch: EmbeddingQueueItem[],
		tokensUsed: number,
		estimatedTokens: number,
	): Promise<void> {
		if (estimatedTokens <= 0) {
			return;
		}
		const tokensByFilePath = new Map<string, number>();
		let assignedTokens = 0;
		for (let i = 0; i < batch.length; i++) {
			const item = batch[i];
			if (!item.filePath) {
				continue;
			}
			const isLast = i === batch.length - 1;
			const proportionalTokens = isLast
				? Math.max(0, tokensUsed - assignedTokens)
				: Math.max(
					0,
					Math.round((tokensUsed * item.estimatedTokens) / estimatedTokens),
				);
			assignedTokens += proportionalTokens;
			tokensByFilePath.set(
				item.filePath,
				(tokensByFilePath.get(item.filePath) ?? 0) + proportionalTokens,
			);
		}
		await Promise.all(
			Array.from(tokensByFilePath, ([filePath, tokens]) =>
				recordTokenUsage(filePath, tokens),
			),
		);
	}

	private quantizeBatch(
		batch: EmbeddingQueueItem[],
		floats: number[][],
	): StoredVector[] {
		if (floats.length !== batch.length) {
			throw new Error(
				`Embedding queue batch size mismatch: expected ${batch.length}, received ${floats.length}`,
			);
		}
		return floats.map((floatVector, index) => {
			l2Normalize(floatVector);
			if (batch[index].precision === 'float16') {
				return {
					precision: 'float16',
					vector: quantizeFloat16(floatVector),
				};
			}
			const { vec, scale } = quantizeInt8(floatVector);
			return {
				precision: 'int8',
				vector: vec,
				scale,
			};
		});
	}

	private removePending(item: EmbeddingQueueItem): void {
		this.pending = this.pending.filter((pendingItem) => pendingItem.id !== item.id);
	}

	private settleItem(
		item: EmbeddingQueueItem,
		mode: 'resolve',
		value: StoredVector,
	): void;
	private settleItem(item: EmbeddingQueueItem, mode: 'reject', value: unknown): void;
	private settleItem(
		item: EmbeddingQueueItem,
		mode: 'resolve' | 'reject',
		value: StoredVector | unknown,
	): void {
		if (item.state === 'settled') {
			return;
		}
		item.state = 'settled';
		if (item.abortHandler && item.signal) {
			item.signal.removeEventListener('abort', item.abortHandler);
		}
		if (mode === 'resolve') {
			item.resolve(value as StoredVector);
			return;
		}
		item.reject(value);
	}
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
	private static readonly requestGates = new Map<string, AsyncRateGate>();
	private static readonly queues = new Map<string, EmbeddingQueue>();

	private get apiKey(): string {
		return this.setting.hybrid?.apiKey?.trim() ?? '';
	}

	private get provider(): HybridEmbeddingProvider {
		return normalizeEmbeddingProvider(this.setting.hybrid?.embeddingProvider);
	}

	private get apiUrl(): string {
		return buildEmbeddingApiUrl(
			this.provider,
			this.setting.hybrid?.apiDomain,
		);
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
			{ maxAttempts: 1, interactive: true },
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

		results.push(
			...(await Promise.all(
				texts.map((text) =>
					this.enqueueEmbedding(text, precision, filePath, signal, options),
				),
			)),
		);

		logger.debug(
			`embedBatch finished: file=${filePath || '<query>'}, chunks=${texts.length}, elapsed=${Date.now() - batchStart} ms`,
		);

		return results;
	}

	private enqueueEmbedding(
		text: string,
		precision: VectorPrecision,
		filePath: string,
		signal: AbortSignal | undefined,
		options: EmbedBatchOptions,
	): Promise<StoredVector> {
		const provider = this.provider;
		const queue = Embedder.getQueue(provider);
		return queue.enqueue({
			owner: this,
			provider,
			text,
			precision,
			filePath,
			estimatedTokens: estimateTextTokenUsage(text),
			maxAttempts: Math.max(1, options.maxAttempts ?? REQUEST_MAX_RETRIES),
			interactive: options.interactive === true,
			signal,
		});
	}

	private static getQueue(provider: HybridEmbeddingProvider): EmbeddingQueue {
		const profile = getEmbeddingRequestProfile(provider);
		const key = provider;
		let queue = this.queues.get(key);
		if (!queue) {
			queue = new EmbeddingQueue(provider, profile);
			this.queues.set(key, queue);
		}
		return queue;
	}

	private static getRequestGate(provider: HybridEmbeddingProvider): AsyncRateGate {
		const profile = getEmbeddingRequestProfile(provider);
		const key = `${provider}:${profile.minSpacingMs}`;
		let gate = this.requestGates.get(key);
		if (!gate) {
			gate = new AsyncRateGate(profile.minSpacingMs);
			this.requestGates.set(key, gate);
		}
		return gate;
	}

	async fetchQueuedEmbeddings(
		texts: string[],
		provider: HybridEmbeddingProvider,
		maxAttempts: number,
	): Promise<{ embeddings: number[][]; tokensUsed: number }> {
		return await this.fetchEmbeddings(texts, undefined, {
			maxAttempts,
			provider,
		});
	}

	private async fetchEmbeddings(
		texts: string[],
		externalSignal?: AbortSignal,
		options: EmbedBatchOptions = {},
	): Promise<{ embeddings: number[][]; tokensUsed: number }> {
		const maxAttempts = Math.max(1, options.maxAttempts ?? REQUEST_MAX_RETRIES);
		const providerOverride = options.provider;
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
					const provider = providerOverride ?? this.provider;
					await Embedder.getRequestGate(provider).wait();
					if (externalSignal?.aborted) {
						throw createEmbedAbortError();
					}
					const apiUrl = buildEmbeddingApiUrl(
						provider,
						this.setting.hybrid?.apiDomain,
					);
					const resp = await fetch(apiUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${this.apiKey}`,
						},
						body: JSON.stringify(buildEmbeddingRequestBody(provider, texts)),
						signal: controller.signal,
					});

					if (!resp.ok) {
						const body = await resp.text();
						const details = buildHybridProviderErrorDetails({
							provider,
							status: resp.status,
							body,
							retryAfterHeader: resp.headers.get('retry-after'),
							requestIdHeader:
								resp.headers.get('x-request-id') ??
								resp.headers.get('request-id'),
						});
						logger.error(
							`${getEmbeddingProviderSpec(provider).label} embedding request failed: status=${resp.status}, url=${apiUrl}, body=${body}`,
						);
						const detail = details.providerMessage || body.trim() || `status ${resp.status}`;
						const requestSuffix = details.requestId
							? ` (request_id: ${details.requestId})`
							: '';
						const error = new Error(
							`${getEmbeddingProviderSpec(provider).label} embedding API error ${resp.status}: ${detail}${requestSuffix}`,
						);
						Object.assign(error, details);
						if (this.isRetryableStatus(resp.status)) {
							(error as Error & { retryAfterHeader?: string | null }).retryAfterHeader =
								resp.headers.get('retry-after');
							throw error;
						}
						throw error;
					}

					const body = await resp.text();
					const json = parseEmbeddingJsonResponse({
						body,
						contentType: resp.headers.get('content-type'),
						status: resp.status,
						url: apiUrl,
						providerLabel: getEmbeddingProviderSpec(provider).label,
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
						`${getEmbeddingProviderSpec(this.provider).label} embedding request retrying: attempt=${attempt}/${maxAttempts}, delay=${delayMs} ms`,
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
			throw new Error('Embedding response missing data array');
		}
		if (json.data.length !== texts.length) {
			throw new Error(
				`Embedding response count mismatch: expected ${texts.length}, received ${json.data.length}`,
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
				throw new Error(`Embedding response index out of range: ${String(rawIndex)}`);
			}
			const index = rawIndex;
			if (seenIndexes.has(index)) {
				throw new Error(`Embedding response repeated index: ${index}`);
			}
			seenIndexes.add(index);

			const embedding = item?.embedding;
			if (!Array.isArray(embedding)) {
				throw new Error(`Embedding response missing embedding array at index ${index}`);
			}
			if (embedding.length !== EMBED_DIM) {
				throw new Error(
					`Embedding response dimension mismatch at index ${index}: expected ${EMBED_DIM}, received ${embedding.length}`,
				);
			}
			for (let valueIndex = 0; valueIndex < embedding.length; valueIndex++) {
				if (!Number.isFinite(embedding[valueIndex])) {
					throw new Error(
						`Embedding response contains non-finite value at index ${index}, offset ${valueIndex}`,
					);
				}
			}
			embeddings[index] = embedding;
		}

		for (let index = 0; index < embeddings.length; index++) {
			if (!embeddings[index]) {
				throw new Error(`Embedding response missing item for index ${index}`);
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

export function normalizeEmbeddingProvider(
	provider: unknown,
): HybridEmbeddingProvider {
	return provider === 'openai' ? 'openai' : 'qwen';
}

export function getEmbeddingProviderSpec(
	provider: unknown,
): EmbeddingProviderSpec {
	return EMBEDDING_PROVIDER_SPECS[normalizeEmbeddingProvider(provider)];
}

export function normalizeApiDomain(domain?: string): string {
	return normalizeProviderApiDomain('qwen', domain);
}

export function normalizeProviderApiDomain(
	provider: unknown,
	domain?: string,
): string {
	const spec = getEmbeddingProviderSpec(provider);
	const raw = domain?.trim();
	if (!raw) {
		return spec.defaultDomain;
	}

	const withoutProtocol = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
	const compatibleIndex = withoutProtocol.search(/\/compatible-(mode|api)\b/i);
	const openAiV1Index = withoutProtocol.search(/\/v1\b/i);
	const hostAndMaybePath =
		compatibleIndex >= 0
			? withoutProtocol.slice(0, compatibleIndex)
			: openAiV1Index >= 0
				? withoutProtocol.slice(0, openAiV1Index)
			: withoutProtocol;

	return hostAndMaybePath.split('/')[0] || spec.defaultDomain;
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

export function buildEmbeddingApiUrl(
	provider: unknown,
	domain: string | undefined,
): string {
	const normalizedProvider = normalizeEmbeddingProvider(provider);
	if (normalizedProvider === 'openai') {
		const host = normalizeProviderApiDomain('openai', domain);
		return `https://${host}/v1/embeddings`;
	}
	return buildDashScopeApiUrl(domain, 'embedding');
}

export function buildProviderApiUrl(
	provider: unknown,
	domain: string | undefined,
	apiType: 'embedding' | 'rerank',
): string {
	const normalizedProvider = normalizeEmbeddingProvider(provider);
	if (apiType === 'embedding') {
		return buildEmbeddingApiUrl(normalizedProvider, domain);
	}
	if (normalizedProvider === 'openai') {
		const host = normalizeProviderApiDomain('openai', domain);
		return `https://${host}/v1/responses`;
	}
	return buildDashScopeApiUrl(domain, 'rerank');
}

export function buildEmbeddingRequestBody(
	provider: unknown,
	texts: string[],
): {
	model: string;
	input: string[];
	dimensions: number;
	encoding_format: 'float';
} {
	return {
		model: getEmbeddingProviderSpec(provider).embeddingModel,
		input: texts,
		dimensions: EMBED_DIM,
		encoding_format: 'float',
	};
}

function parseEmbeddingJsonResponse(params: Readonly<{
	body: string;
	contentType: string | null;
	status: number;
	url: string;
	providerLabel: string;
}>): ProviderEmbeddingResponse {
	const { body, contentType, status, url, providerLabel } = params;
	const trimmed = body.trim();
	if (!trimmed) {
		throw new Error(
			`${providerLabel} embedding API returned an empty response: status=${status}, url=${url}, contentType=${contentType ?? '<missing>'}`,
		);
	}
	try {
		return JSON.parse(trimmed) as ProviderEmbeddingResponse;
	} catch (error) {
		const preview = trimmed.slice(0, 240).replace(/\s+/g, ' ');
		throw new Error(
			`${providerLabel} embedding API returned non-JSON response: status=${status}, url=${url}, contentType=${contentType ?? '<missing>'}, bodyPreview=${preview}`,
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
