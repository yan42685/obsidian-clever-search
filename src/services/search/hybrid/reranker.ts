import { OuterSetting } from 'src/globals/plugin-setting';
import {
	buildProviderApiUrl,
	estimateTextsTokenUsage,
	getEmbeddingProviderSpec,
	normalizeEmbeddingProvider,
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

const RERANK_TIMEOUT_MS = 5_000;
export const SEARCH_QWEN_RERANK_TOKEN_KEY = '[search] qwen3-rerank';
export const SEARCH_OPENAI_RERANK_TOKEN_KEY = '[search] gpt-5.4-nano';
export const SEARCH_RERANK_TOKEN_KEY = SEARCH_QWEN_RERANK_TOKEN_KEY;
export const SEARCH_RERANK_TOKEN_KEYS = [
	SEARCH_QWEN_RERANK_TOKEN_KEY,
	SEARCH_OPENAI_RERANK_TOKEN_KEY,
] as const;
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

	private get provider(): 'qwen' | 'openai' {
		return normalizeEmbeddingProvider(this.setting.hybrid?.embeddingProvider);
	}

	private get apiUrl(): string {
		return buildProviderApiUrl(
			this.provider,
			this.setting.hybrid?.apiDomain,
			'rerank',
		);
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
			const provider = this.provider;
			const resp = await this.fetchRerankResponse(provider, query, documents, topK, signal);

			if (!resp.ok) {
				const body = await resp.text();
				const error = this.buildHttpError(
					provider,
					resp.status,
					body,
					resp.headers.get('retry-after'),
					resp.headers.get('x-request-id') ?? resp.headers.get('request-id'),
				);
				throw error;
			}

			const json = await resp.json() as {
				results?: Array<{ index: number; relevance_score?: number; score?: number }>;
				data?: Array<{ index: number; relevance_score?: number; score?: number }>;
				output?: {
					results?: Array<{ index: number; relevance_score?: number; score?: number }>;
					content?: Array<{ type?: string; text?: string }>;
				};
				output_text?: string;
				usage?: { total_tokens?: number; input_tokens?: number };
			};
			const tokensUsed = json.usage?.total_tokens ?? json.usage?.input_tokens ?? 0;
			if (tokensUsed > 0) {
				await recordTokenUsage(getSearchRerankTokenKey(provider), tokensUsed);
			}

			const ranked = this.extractRankedItems(json, provider)
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
				throw new HybridRerankError(`${getEmbeddingProviderSpec(provider).label} rerank returned no ranked items`);
			}

			return ranked.slice(0, topK);
		} finally {
			reservation.release();
		}
	}

	private async fetchRerankResponse(
		provider: 'qwen' | 'openai',
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
			const apiUrl = buildProviderApiUrl(
				provider,
				this.setting.hybrid?.apiDomain,
				'rerank',
			);
			return await fetch(apiUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(
					provider === 'openai'
						? this.buildOpenAIRerankRequest(query, documents, topK)
						: this.buildQwenRerankRequest(query, documents, topK),
				),
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
					content?: Array<{ type?: string; text?: string }>;
				} | Array<{ content?: Array<{ type?: string; text?: string }> }>;
		output_text?: string;
	}, provider: 'qwen' | 'openai' = this.provider): Array<{ index: number; score: number }> {
		if (provider === 'openai') {
			return this.extractOpenAIRankedItems(json);
		}
		const outputResults = !Array.isArray(json.output)
			? json.output?.results
			: undefined;
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

	private buildQwenRerankRequest(
		query: string,
		documents: string[],
		topK: number,
	): {
		model: string;
		query: string;
		documents: string[];
		top_n: number;
		instruct: string;
	} {
		return {
			model: getEmbeddingProviderSpec('qwen').rerankModel,
			query,
			documents,
			top_n: Math.min(documents.length, topK),
			instruct: 'Retrieve semantically similar text.',
		};
	}

	private buildOpenAIRerankRequest(
		query: string,
		documents: string[],
		topK: number,
	): {
		model: string;
		input: string;
		text: { format: { type: 'json_object' } };
	} {
		const candidates = documents.map((text, index) => ({
			index,
			text,
		}));
		return {
			model: getEmbeddingProviderSpec('openai').rerankModel,
			input: [
				'Rank the candidate texts by relevance to the search query, balancing response speed with ranking accuracy.',
				'Return only JSON: {"results":[{"index":0,"score":1}]}',
				`Return at most ${Math.min(documents.length, topK)} results.`,
				'Score must be a normalized finite number from 0 to 1, where 1 is most relevant.',
				`Query: ${JSON.stringify(query)}`,
				`Candidates: ${JSON.stringify(candidates)}`,
			].join('\n'),
			text: { format: { type: 'json_object' } },
		};
	}

	private extractOpenAIRankedItems(json: {
		output_text?: string;
		output?: {
			content?: Array<{ type?: string; text?: string }>;
		} | Array<{ content?: Array<{ type?: string; text?: string }> }>;
	}): Array<{ index: number; score: number }> {
		const text =
			typeof json.output_text === 'string'
				? json.output_text
				: this.collectOpenAIResponseTexts(json.output).join('\n');
		if (!text.trim()) {
			return [];
		}
		try {
			const parsed = JSON.parse(text.trim()) as {
				results?: Array<{ index?: unknown; score?: unknown }>;
			};
			const results = Array.isArray(parsed.results) ? parsed.results : [];
			return results
				.map((item, fallbackRank) => ({
					index: typeof item.index === 'number' ? item.index : Number.NaN,
					score:
						typeof item.score === 'number' && Number.isFinite(item.score)
							? item.score
							: -fallbackRank,
				}))
				.filter((item) => Number.isInteger(item.index) && Number.isFinite(item.score))
				.sort((a, b) => b.score - a.score);
		} catch {
			return [];
		}
	}

	private collectOpenAIResponseTexts(
		output:
			| { content?: Array<{ type?: string; text?: string }> }
			| Array<{ content?: Array<{ type?: string; text?: string }> }>
			| undefined,
	): string[] {
		const items = Array.isArray(output) ? output : output ? [output] : [];
		return items.flatMap((item) =>
			(item.content ?? [])
				.map((content) => content.text)
				.filter((value): value is string => Boolean(value)),
		);
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
		provider: 'qwen' | 'openai',
		status: number,
		body: string,
		retryAfterHeader?: string | null,
		requestIdHeader?: string | null,
	): HybridRerankError {
		const details = buildHybridProviderErrorDetails({
			provider,
			status,
			body,
			retryAfterHeader,
			requestIdHeader,
		});
		const detail =
			details.providerMessage || body.trim() || `status ${status}`;
		const requestSuffix = details.requestId
			? ` (request_id: ${details.requestId})`
			: '';
		return new HybridRerankError(
			`${getEmbeddingProviderSpec(provider).label} rerank API error ${status}: ${detail}${requestSuffix}`,
			details,
		);
	}

	private buildTransportError(error: unknown): HybridRerankError {
		if (error instanceof HybridRerankError) {
			return error;
		}
		if (!(error instanceof Error)) {
			return new HybridRerankError('Hybrid rerank request failed', {
				kind: 'unknown',
			});
		}

		const message = `${error.name}: ${error.message}`.toLowerCase();
		const kind = this.classifyTransportFailureKind(message);
		return new HybridRerankError(`Hybrid rerank request failed: ${error.message}`, {
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

function getSearchRerankTokenKey(provider: 'qwen' | 'openai'): string {
	return provider === 'openai'
		? SEARCH_OPENAI_RERANK_TOKEN_KEY
		: SEARCH_QWEN_RERANK_TOKEN_KEY;
}
