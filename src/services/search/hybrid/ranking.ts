export type RankedResult = {
	id: number;
	score: number;
};

export type HybridQueryProfile = {
	lexicalWeight: number;
	vecSmallWeight: number;
	vecBigWeight: number;
	vecSmallMinScore: number;
	vecBigMinScore: number;
	semanticWindow: number;
	smallSearchMultiplier: number;
	bigSearchMultiplier: number;
	searchEf: number;
	queryVariantLimit: number;
};

export type HybridFileRankStrategy =
	| "bestChunk"
	| "bestPlusSupport"
	| "sumTopChunks";

export type SemanticQueryVariant = {
	text: string;
	weight: number;
};

const RRF_K = 60;
const MIN_SCORE_SPREAD = 0.05;

export function reciprocalRankFuse(
	lists: RankedResult[][],
	limit: number,
): RankedResult[] {
	if (limit <= 0) {
		return [];
	}

	const merged = new Map<number, number>();
	for (const list of lists) {
		const ranked = sortRankedResults(list);
		for (let index = 0; index < ranked.length; index++) {
			const item = ranked[index];
			merged.set(
				item.id,
				(merged.get(item.id) ?? 0) + reciprocalRankScore(index),
			);
		}
	}

	return Array.from(merged.entries())
		.map(([id, score]) => ({ id, score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

export function buildHybridQueryProfile(
	query: string,
	queryTokenCount: number,
	hasLexicalHits: boolean,
): HybridQueryProfile {
	const trimmed = query.trim();
	const looksPathLike = /[\\/._#:-]/.test(trimmed);
	const shortKeywordQuery =
		hasLexicalHits &&
		(looksPathLike || queryTokenCount <= 2 || trimmed.length <= 8);

	if (shortKeywordQuery) {
		return {
			lexicalWeight: 1.35,
			vecSmallWeight: 0.45,
			vecBigWeight: 0.16,
			vecSmallMinScore: 0.26,
			vecBigMinScore: 0.22,
			semanticWindow: 0.08,
			smallSearchMultiplier: 4,
			bigSearchMultiplier: 3,
			searchEf: 56,
			queryVariantLimit: 1,
		};
	}

	if (!hasLexicalHits && queryTokenCount >= 3) {
		return {
			lexicalWeight: 0.72,
			vecSmallWeight: 1.05,
			vecBigWeight: 0.4,
			vecSmallMinScore: 0.12,
			vecBigMinScore: 0.1,
			semanticWindow: 0.18,
			smallSearchMultiplier: 8,
			bigSearchMultiplier: 6,
			searchEf: 96,
			queryVariantLimit: 3,
		};
	}

	return {
		lexicalWeight: 1.0,
		vecSmallWeight: 0.9,
		vecBigWeight: 0.32,
		vecSmallMinScore: 0.18,
		vecBigMinScore: 0.14,
		semanticWindow: 0.12,
		smallSearchMultiplier: 6,
		bigSearchMultiplier: 4,
		searchEf: 72,
		queryVariantLimit: 2,
	};
}

export function buildSemanticQueryVariants(
	query: string,
	queryTokens: string[],
	limit: number,
): SemanticQueryVariant[] {
	const variants: SemanticQueryVariant[] = [];
	const seen = new Set<string>();

	const addVariant = (text: string, weight: number) => {
		const normalized = text.trim().replace(/\s+/g, " ");
		if (!normalized || seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		variants.push({ text: normalized, weight });
	};

	addVariant(query, 1);
	if (limit <= 1 || queryTokens.length <= 2) {
		return variants.slice(0, limit);
	}

	addVariant(queryTokens.slice(0, Math.min(queryTokens.length, 10)).join(" "), 0.9);
	if (limit <= 2 || queryTokens.length <= 5) {
		return variants.slice(0, limit);
	}

	addVariant(
		[...queryTokens.slice(0, 4), ...queryTokens.slice(-3)].join(" "),
		0.78,
	);
	return variants.slice(0, limit);
}

export function filterSemanticMatches(
	items: RankedResult[],
	minScore: number,
	window: number,
	limit: number,
): RankedResult[] {
	if (items.length === 0 || limit <= 0) {
		return [];
	}

	const ranked = sortRankedResults(items).slice(0, limit);
	const bestScore = ranked[0].score;
	const threshold = Math.max(minScore, bestScore - window);

	return ranked.filter((item) => item.score >= threshold);
}

export function mergeHybridRankings(
	bm25: RankedResult[],
	vecSmall: RankedResult[],
	vecBig: RankedResult[],
	profile: HybridQueryProfile,
	limit: number,
): RankedResult[] {
	if (limit <= 0) {
		return [];
	}

	const rankedBm25 = sortRankedResults(bm25);
	const rankedVecSmall = sortRankedResults(vecSmall);
	const rankedVecBig = sortRankedResults(vecBig);

	const bm25Map = normalizeBm25Scores(rankedBm25);
	const vecSmallMap = normalizeSemanticScores(
		rankedVecSmall,
		profile.vecSmallMinScore,
	);
	const vecBigMap = normalizeSemanticScores(
		rankedVecBig,
		profile.vecBigMinScore,
	);

	const allIds = new Set<number>([
		...rankedBm25.map((item) => item.id),
		...rankedVecSmall.map((item) => item.id),
		...rankedVecBig.map((item) => item.id),
	]);

	const merged: RankedResult[] = [];
	for (const id of allIds) {
		let score = 0;

		score += profile.lexicalWeight * (bm25Map.get(id) ?? 0);
		score += profile.vecSmallWeight * (vecSmallMap.get(id) ?? 0);
		score += profile.vecBigWeight * (vecBigMap.get(id) ?? 0);

		score +=
			profile.lexicalWeight *
			0.14 *
			reciprocalRankScore(findRank(rankedBm25, id));
		score +=
			profile.vecSmallWeight *
			0.08 *
			reciprocalRankScore(findRank(rankedVecSmall, id));
		score +=
			profile.vecBigWeight *
			0.05 *
			reciprocalRankScore(findRank(rankedVecBig, id));

		if (score > 0) {
			merged.push({ id, score });
		}
	}

	return merged.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function scoreFileChunkMatches(
	scores: number[],
	strategy: HybridFileRankStrategy,
): number {
	if (scores.length === 0) {
		return 0;
	}

	const ranked = [...scores].sort((a, b) => b - a);
	switch (strategy) {
		case "bestChunk":
			return ranked[0];
		case "sumTopChunks":
			return ranked.reduce((sum, score) => sum + score, 0);
		case "bestPlusSupport":
		default: {
			const [best = 0, second = 0, third = 0] = ranked;
			return best + second * 0.35 + third * 0.2;
		}
	}
}

function normalizeBm25Scores(items: RankedResult[]): Map<number, number> {
	const normalized = new Map<number, number>();
	if (items.length === 0) {
		return normalized;
	}

	const maxScore = Math.max(items[0].score, 1e-6);
	for (const item of items) {
		normalized.set(item.id, Math.sqrt(clamp01(item.score / maxScore)));
	}
	return normalized;
}

function normalizeSemanticScores(
	items: RankedResult[],
	minScore: number,
): Map<number, number> {
	const normalized = new Map<number, number>();
	if (items.length === 0) {
		return normalized;
	}

	const bestScore = items[0].score;
	const relativeDenominator = Math.max(
		bestScore - minScore,
		MIN_SCORE_SPREAD,
	);
	const absoluteDenominator = Math.max(1 - minScore, MIN_SCORE_SPREAD);

	for (const item of items) {
		const relative = clamp01((item.score - minScore) / relativeDenominator);
		const absolute = clamp01((item.score - minScore) / absoluteDenominator);
		normalized.set(item.id, relative * 0.7 + absolute * 0.3);
	}

	return normalized;
}

function reciprocalRankScore(rank: number): number {
	if (rank < 0) {
		return 0;
	}
	return 1 / (RRF_K + rank + 1);
}

function findRank(items: RankedResult[], id: number): number {
	return items.findIndex((item) => item.id === id);
}

function sortRankedResults(items: RankedResult[]): RankedResult[] {
	return [...items].sort((a, b) => b.score - a.score);
}

function clamp01(value: number): number {
	if (value <= 0) {
		return 0;
	}
	if (value >= 1) {
		return 1;
	}
	return value;
}
