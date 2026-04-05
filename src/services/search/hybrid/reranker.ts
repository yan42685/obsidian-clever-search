import { OuterSetting } from 'src/globals/plugin-setting';
import {
	buildDashScopeApiUrl,
	estimateTextsTokenUsage,
	recordTokenUsage,
	reserveWeeklyTokenBudget,
} from './embedder';
import { getInstance } from 'src/utils/my-lib';
import {
	buildHybridProviderErrorDetails,
	type HybridProviderFailureKind,
	isNetworkFailureMessage,
	NoApiKeyError,
	WeeklyTokenLimitExceededError,
} from './provider-error';

const RERANK_MODEL = 'qwen3-rerank';
const RERANK_TIMEOUT_MS = 2_800;
export const SEARCH_RERANK_TOKEN_KEY = '[search] qwen3-rerank';
export const SEARCH_EMBED_TOKEN_KEY = '[search] embedding';

export type HybridRerankFailureKind = HybridProviderFailureKind;

export class HybridRerankError extends Error {
	readonly kind: HybridRerankFailureKind;
	readonly status?: number;
	readonly providerCode?: string | null;
	readonly providerType?: string | null;
	readonly providerMessage?: string | null;
	readonly requestId?: string | null;
	readonly retryAfterHeader?: string | null;

	constructor(
		message: string,
		options: {
			kind?: HybridRerankFailureKind;
			status?: number;
			providerCode?: string | null;
			providerType?: string | null;
			providerMessage?: string | null;
			requestId?: string | null;
			retryAfterHeader?: string | null;
		} = {},
	) {
		super(message);
		this.name = 'HybridRerankError';
		this.kind = options.kind ?? 'unknown';
		this.status = options.status;
		this.providerCode = options.providerCode;
		this.providerType = options.providerType;
		this.providerMessage = options.providerMessage;
		this.requestId = options.requestId;
		this.retryAfterHeader = options.retryAfterHeader;
	}
}

export class HybridRerankTimeoutError extends HybridRerankError {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Qwen rerank request timed out after ${timeoutMs} ms`, {
			kind: 'timeout',
		});
		this.name = 'HybridRerankTimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

export type RerankCandidate = {
	id: number;
	filePath: string;
	text: string;
	startLine: number;
	startCol: number;
	endLine: number;
	recallScore: number;
};

export type RerankResult = {
	id: number;
	score: number;
};

function createRerankAbortError(): Error {
	const error = new Error('Hybrid rerank aborted');
	error.name = 'AbortError';
	return error;
}

export class HybridReranker {
	private readonly setting = getInstance(OuterSetting);

	private get apiKey(): string {
		return this.setting.hybrid?.apiKey?.trim() ?? '';
	}

	private get apiUrl(): string {
		return buildDashScopeApiUrl(this.setting.hybrid?.apiDomain, 'rerank');
	}

	async rerank(
		query: string,
		candidates: RerankCandidate[],
		topK: number,
		signal?: AbortSignal,
	): Promise<RerankResult[]> {
		if (candidates.length === 0 || topK <= 0) {
			return candidates.slice(0, topK).map((candidate) => ({
				id: candidate.id,
				score: candidate.recallScore,
			}));
		}
		if (!this.apiKey) {
			throw new NoApiKeyError();
		}

		const documents = candidates.map((candidate) => candidate.text);
		const estimatedTokens = estimateTextsTokenUsage([
			query,
			...documents,
		]);
		const reservation = await reserveWeeklyTokenBudget(estimatedTokens);
		try {
			const resp = await this.fetchRerankResponse(query, documents, topK, signal);

			if (!resp.ok) {
				const body = await resp.text();
				const error = this.buildHttpError(
					resp.status,
					body,
					resp.headers.get('retry-after'),
				);
				throw error;
			}

			const json = await resp.json() as {
				results?: Array<{ index: number; relevance_score?: number; score?: number }>;
				data?: Array<{ index: number; relevance_score?: number; score?: number }>;
				output?: {
					results?: Array<{ index: number; relevance_score?: number; score?: number }>;
				};
				usage?: { total_tokens?: number; input_tokens?: number };
			};
			const tokensUsed = json.usage?.total_tokens ?? json.usage?.input_tokens ?? 0;
			if (tokensUsed > 0) {
				await recordTokenUsage(SEARCH_RERANK_TOKEN_KEY, tokensUsed);
			}

			const ranked = this.extractRankedItems(json)
				.map((item) => {
					const candidate = candidates[item.index];
					if (!candidate) {
						return null;
					}
					return {
						id: candidate.id,
						score: item.score,
					} as RerankResult;
				})
				.filter((item): item is RerankResult => item !== null);

			if (ranked.length === 0) {
				throw new HybridRerankError('Qwen rerank returned no ranked items');
			}

			return ranked.slice(0, topK);
		} finally {
			reservation.release();
		}
	}

	private async fetchRerankResponse(
		query: string,
		documents: string[],
		topK: number,
		externalSignal?: AbortSignal,
	): Promise<Response> {
		const controller = new AbortController();
		const forwardAbort = () => controller.abort();
		if (externalSignal) {
			if (externalSignal.aborted) {
				controller.abort();
			} else {
				externalSignal.addEventListener('abort', forwardAbort, { once: true });
			}
		}
		const timeoutId = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
		try {
			return await fetch(this.apiUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: RERANK_MODEL,
					query,
					documents,
					top_n: Math.min(documents.length, topK),
					instruct: 'Retrieve semantically similar text.',
				}),
				signal: controller.signal,
			});
		} catch (error) {
			if (error instanceof WeeklyTokenLimitExceededError) {
				throw error;
			}
			if (this.isAbortError(error)) {
				if (externalSignal?.aborted) {
					throw createRerankAbortError();
				}
				throw new HybridRerankTimeoutError(RERANK_TIMEOUT_MS);
			}
			throw this.buildTransportError(error);
		} finally {
			clearTimeout(timeoutId);
			if (externalSignal) {
				externalSignal.removeEventListener('abort', forwardAbort);
			}
		}
	}

	private extractRankedItems(json: {
		results?: Array<{ index: number; relevance_score?: number; score?: number }>;
		data?: Array<{ index: number; relevance_score?: number; score?: number }>;
		output?: {
			results?: Array<{ index: number; relevance_score?: number; score?: number }>;
		};
	}): Array<{ index: number; score: number }> {
		const outputResults = json.output?.results;
		const rawItems = Array.isArray(json.results)
			? json.results
			: Array.isArray(json.data)
				? json.data
				: Array.isArray(outputResults)
					? outputResults
					: [];
		return rawItems
			.map((item) => ({
				index: item.index,
				score: item.relevance_score ?? item.score ?? 0,
			}))
			.filter((item) => Number.isFinite(item.index) && Number.isFinite(item.score))
			.sort((a, b) => b.score - a.score);
	}

	private isAbortError(error: unknown): boolean {
		return Boolean(
			error &&
			typeof error === 'object' &&
			'name' in error &&
			error.name === 'AbortError',
		);
	}

	private buildHttpError(
		status: number,
		body: string,
		retryAfterHeader?: string | null,
	): HybridRerankError {
		const details = buildHybridProviderErrorDetails(
			status,
			body,
			retryAfterHeader,
		);
		const detail =
			details.providerMessage || body.trim() || `status ${status}`;
		const requestSuffix = details.requestId
			? ` (request_id: ${details.requestId})`
			: '';
		return new HybridRerankError(
			`Qwen rerank API error ${status}: ${detail}${requestSuffix}`,
			details,
		);
	}

	private buildTransportError(error: unknown): HybridRerankError {
		if (error instanceof HybridRerankError) {
			return error;
		}
		if (!(error instanceof Error)) {
			return new HybridRerankError('Qwen rerank request failed', {
				kind: 'unknown',
			});
		}

		const message = `${error.name}: ${error.message}`.toLowerCase();
		const kind = this.classifyTransportFailureKind(message);
		return new HybridRerankError(`Qwen rerank request failed: ${error.message}`, {
			kind,
		});
	}

	private classifyTransportFailureKind(message: string): HybridRerankFailureKind {
		if (isNetworkFailureMessage(message)) {
			return 'network';
		}
		if (message.includes('timeout')) {
			return 'timeout';
		}
		return 'unknown';
	}
}
