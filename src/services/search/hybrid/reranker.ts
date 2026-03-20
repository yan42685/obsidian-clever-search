import { OuterSetting } from 'src/globals/plugin-setting';
import {
	buildDashScopeApiUrl,
	ensureWeeklyTokenBudget,
	estimateTextsTokenUsage,
	recordTokenUsage,
} from './embedder';
import { logger } from 'src/utils/logger';
import { getInstance } from 'src/utils/my-lib';

const RERANK_MODEL = 'qwen3-rerank';
export const SEARCH_RERANK_TOKEN_KEY = '[search] qwen3-rerank';
export const SEARCH_EMBED_TOKEN_KEY = '[search] embedding';

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
	): Promise<RerankResult[]> {
		if (!this.apiKey || candidates.length === 0 || topK <= 0) {
			return candidates.slice(0, topK).map((candidate) => ({
				id: candidate.id,
				score: candidate.recallScore,
			}));
		}

		const estimatedTokens = estimateTextsTokenUsage([
			query,
			...candidates.map((candidate) => candidate.text),
		]);
		await ensureWeeklyTokenBudget(estimatedTokens);

		const resp = await fetch(this.apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: RERANK_MODEL,
				query,
				documents: candidates.map((candidate) => candidate.text),
				top_n: Math.min(candidates.length, topK),
				instruct: "Retrieve semantically similar text.",
			}),
		});

		if (!resp.ok) {
			const body = await resp.text();
			logger.error(
				`Qwen rerank request failed: status=${resp.status}, url=${this.apiUrl}, body=${body}`,
			);
			throw new Error(`Qwen rerank API error ${resp.status}: ${body}`);
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
			logger.warn('Qwen rerank returned no ranked items; falling back to recall ordering.');
			return candidates.slice(0, topK).map((candidate) => ({
				id: candidate.id,
				score: candidate.recallScore,
			}));
		}

		return ranked.slice(0, topK);
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
}
