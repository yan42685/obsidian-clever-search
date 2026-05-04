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

const RERANK_TIMEOUT_MS = 15_000;
const MIN_RERANK_SCORE_RELATIVE_TO_TOP = 0.35;
const LLM_RERANK_MAX_RESULTS = 3;
export const SEARCH_QWEN_RERANK_TOKEN_KEY = '[search] qwen-flash';
export const SEARCH_OPENAI_RERANK_TOKEN_KEY = '[search] gpt-5.4-nano';
export const SEARCH_GEMINI_RERANK_TOKEN_KEY = '[search] gemini-3.1-flash-lite-preview';
export const SEARCH_RERANK_TOKEN_KEY = SEARCH_QWEN_RERANK_TOKEN_KEY;
export const SEARCH_RERANK_TOKEN_KEYS = [
	SEARCH_QWEN_RERANK_TOKEN_KEY,
	SEARCH_OPENAI_RERANK_TOKEN_KEY,
	SEARCH_GEMINI_RERANK_TOKEN_KEY,
] as const;
export const SEARCH_EMBED_TOKEN_KEY = '[search] embedding';
type RerankProvider = 'qwen' | 'openai' | 'gemini';

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
	start?: number;
	end?: number;
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

	private get provider(): RerankProvider {
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
				usageMetadata?: { totalTokenCount?: number; promptTokenCount?: number };
				candidates?: Array<{
					content?: {
						parts?: Array<{ text?: string }>;
					};
				}>;
				choices?: Array<{
					message?: {
						content?: string;
					};
				}>;
			};
			const tokensUsed =
				json.usage?.total_tokens ??
				json.usage?.input_tokens ??
				json.usageMetadata?.totalTokenCount ??
				json.usageMetadata?.promptTokenCount ??
				0;
			if (tokensUsed > 0) {
				await recordTokenUsage(getSearchRerankTokenKey(provider), tokensUsed);
			}

			const ranked = this.filterRankedItemsByTopScore(
				this.extractRankedItems(json, provider),
			)
				.map((item) => {
					const candidate = candidates[item.index];
					if (!candidate) {
						return null;
					}
					return {
						id: candidate.id,
						score: item.score,
						start: item.start,
						end: item.end,
					} as RerankResult;
				})
				.filter((item): item is RerankResult => item !== null);

			if (ranked.length === 0) {
				throw new HybridRerankError(`${getEmbeddingProviderSpec(provider).label} rerank returned no ranked items`);
			}

			return ranked.slice(0, this.getResultLimit(provider, topK));
		} finally {
			reservation.release();
		}
	}

	private filterRankedItemsByTopScore(
		items: Array<{ index: number; score: number; start?: number; end?: number }>,
	): Array<{ index: number; score: number; start?: number; end?: number }> {
		const topScore = items[0]?.score;
		if (!Number.isFinite(topScore) || topScore <= 0) {
			return items;
		}
		const minScore = topScore * MIN_RERANK_SCORE_RELATIVE_TO_TOP;
		return items.filter((item) => item.score >= minScore);
	}

	private getResultLimit(_provider: RerankProvider, topK: number): number {
		return Math.min(topK, LLM_RERANK_MAX_RESULTS);
	}

	private async fetchRerankResponse(
		provider: RerankProvider,
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
						: provider === 'gemini'
							? this.buildGeminiRerankRequest(query, documents, topK)
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
		output?: {
			content?: Array<{ type?: string; text?: string }>;
		} | Array<{ content?: Array<{ type?: string; text?: string }> }>;
		output_text?: string;
		candidates?: Array<{
			content?: {
				parts?: Array<{ text?: string }>;
			};
		}>;
		choices?: Array<{
			message?: {
				content?: string;
			};
		}>;
	}, provider: RerankProvider = this.provider): Array<{ index: number; score: number; start?: number; end?: number }> {
		if (provider === 'openai') {
			return this.extractOpenAIRankedItems(json);
		}
		if (provider === 'gemini') {
			return this.extractGeminiRankedItems(json);
		}
		return this.extractQwenRankedItems(json);
	}

	private buildQwenRerankRequest(
		query: string,
		documents: string[],
		topK: number,
	): {
		model: string;
		messages: Array<{ role: 'user'; content: string }>;
		response_format: { type: 'json_object' };
		temperature: number;
	} {
		const candidates = documents.map((text, index) => ({
			index,
			text,
		}));
		return {
			model: getEmbeddingProviderSpec('qwen').rerankModel,
			messages: [
				{
					role: 'user',
					content: this.buildLlmRerankPrompt(query, candidates, topK),
				},
			],
			response_format: { type: 'json_object' },
			temperature: 0,
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
			input: this.buildLlmRerankPrompt(query, candidates, topK),
			text: { format: { type: 'json_object' } },
		};
	}

	private buildGeminiRerankRequest(
		query: string,
		documents: string[],
		topK: number,
	): {
		contents: Array<{
			parts: Array<{ text: string }>;
		}>;
		generationConfig: {
			responseMimeType: 'application/json';
		};
	} {
		const candidates = documents.map((text, index) => ({
			index,
			text,
		}));
		return {
			contents: [
				{
					parts: [
						{
							text: this.buildLlmRerankPrompt(query, candidates, topK),
						},
					],
				},
			],
			generationConfig: {
				responseMimeType: 'application/json',
			},
		};
	}

	private buildLlmRerankPrompt(
		query: string,
		candidates: Array<{ index: number; text: string }>,
		topK: number,
	): string {
		const resultCount = Math.min(candidates.length, topK, LLM_RERANK_MAX_RESULTS);
		return [
			'Rerank search chunks. Return within 10s if possible.',
			'Return JSON only: {"results":[{"index":0,"score":1,"start":0,"end":120}]}',
			`Return exactly ${resultCount} results. If fewer candidates exist, return all candidates.`,
			'Use normalized score 0-1. Drop clearly weak chunks.',
			'start/end are character offsets in the candidate text for a short original excerpt with useful context.',
			'Do not process useless chunks.',
			`Query: ${JSON.stringify(query)}`,
			`Candidates: ${JSON.stringify(candidates)}`,
		].join('\n');
	}

	private extractOpenAIRankedItems(json: {
		output_text?: string;
		output?: {
			content?: Array<{ type?: string; text?: string }>;
		} | Array<{ content?: Array<{ type?: string; text?: string }> }>;
	}): Array<{ index: number; score: number; start?: number; end?: number }> {
		const text =
			typeof json.output_text === 'string'
				? json.output_text
				: this.collectOpenAIResponseTexts(json.output).join('\n');
		return this.extractLlmRankedItemsFromText(text);
	}

	private extractQwenRankedItems(json: {
		choices?: Array<{
			message?: {
				content?: string;
			};
		}>;
	}): Array<{ index: number; score: number; start?: number; end?: number }> {
		const text = (json.choices ?? [])
			.map((choice) => choice.message?.content)
			.filter((value): value is string => Boolean(value))
			.join('\n');
		return this.extractLlmRankedItemsFromText(text);
	}

	private extractGeminiRankedItems(json: {
		candidates?: Array<{
			content?: {
				parts?: Array<{ text?: string }>;
			};
		}>;
	}): Array<{ index: number; score: number; start?: number; end?: number }> {
		const text = (json.candidates ?? [])
			.flatMap((candidate) => candidate.content?.parts ?? [])
			.map((part) => part.text)
			.filter((value): value is string => Boolean(value))
			.join('\n');
		return this.extractLlmRankedItemsFromText(text);
	}

	private extractLlmRankedItemsFromText(
		text: string,
	): Array<{ index: number; score: number; start?: number; end?: number }> {
		if (!text.trim()) {
			return [];
		}
		try {
			const parsed = JSON.parse(text.trim()) as {
				results?: Array<{
					index?: unknown;
					score?: unknown;
					start?: unknown;
					end?: unknown;
				}>;
			};
			const results = Array.isArray(parsed.results) ? parsed.results : [];
			return results
				.map((item, fallbackRank) => ({
					index: typeof item.index === 'number' ? item.index : Number.NaN,
					score:
						typeof item.score === 'number' && Number.isFinite(item.score)
							? item.score
							: -fallbackRank,
					start: typeof item.start === 'number' && Number.isFinite(item.start)
						? item.start
						: undefined,
					end: typeof item.end === 'number' && Number.isFinite(item.end)
						? item.end
						: undefined,
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
		provider: RerankProvider,
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

function getSearchRerankTokenKey(provider: RerankProvider): string {
	if (provider === 'openai') {
		return SEARCH_OPENAI_RERANK_TOKEN_KEY;
	}
	if (provider === 'gemini') {
		return SEARCH_GEMINI_RERANK_TOKEN_KEY;
	}
	return SEARCH_QWEN_RERANK_TOKEN_KEY;
}
