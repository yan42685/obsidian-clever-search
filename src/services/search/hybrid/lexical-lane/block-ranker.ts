import {
	DEFAULT_HYBRID_LEXICAL_LANE_WEIGHTS,
	type HybridLexicalLaneRankerWeights,
} from "./config";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneRankedBlockCandidate,
	HybridLexicalLaneScoreBreakdown,
} from "./contracts";

export function rankHybridLexicalLaneBlockCandidates(
	candidates: readonly HybridLexicalLaneBlockCandidate[],
	options: {
		weights?: Partial<HybridLexicalLaneRankerWeights>;
	} = {},
): HybridLexicalLaneRankedBlockCandidate[] {
	const weights = {
		...DEFAULT_HYBRID_LEXICAL_LANE_WEIGHTS,
		...(options.weights ?? {}),
	};
	const baseRanked = candidates
		.map((candidate) => {
			const scoreBreakdown = buildBaseScoreBreakdown(candidate, weights);
			return {
				...candidate,
				scoreBreakdown,
			};
		})
		.sort((left, right) => {
			if (left.scoreBreakdown.totalScore !== right.scoreBreakdown.totalScore) {
				return right.scoreBreakdown.totalScore - left.scoreBreakdown.totalScore;
			}
			if (left.parentFileRank !== right.parentFileRank) {
				return left.parentFileRank - right.parentFileRank;
			}
			if (left.startOffset !== right.startOffset) {
				return left.startOffset - right.startOffset;
			}
			return left.filePath.localeCompare(right.filePath);
		});

	const selected: HybridLexicalLaneRankedBlockCandidate[] = [];
	for (const candidate of baseRanked) {
		const overlapPenalty = computeOverlapPenalty(candidate, selected);
		selected.push({
			...candidate,
			scoreBreakdown: {
				...candidate.scoreBreakdown,
				overlapPenalty,
				totalScore: candidate.scoreBreakdown.totalScore - overlapPenalty,
			},
		});
	}

	return selected.sort((left, right) => {
		if (left.scoreBreakdown.totalScore !== right.scoreBreakdown.totalScore) {
			return right.scoreBreakdown.totalScore - left.scoreBreakdown.totalScore;
		}
		if (left.parentFileRank !== right.parentFileRank) {
			return left.parentFileRank - right.parentFileRank;
		}
		return left.startOffset - right.startOffset;
	});
}

function buildBaseScoreBreakdown(
	candidate: HybridLexicalLaneBlockCandidate,
	weights: HybridLexicalLaneRankerWeights,
): HybridLexicalLaneScoreBreakdown {
	const queryTermCount = Math.max(1, candidate.localSignals.queryTermCount);
	const exactTermCount = candidate.termStats.filter(
		(termStat) => termStat.bestTier === "exact",
	).length;
	const prefixTermCount = candidate.termStats.filter(
		(termStat) => termStat.bestTier === "prefix",
	).length;
	const fuzzyTermCount = candidate.termStats.filter(
		(termStat) => termStat.bestTier === "fuzzy",
	).length;
	const missCount = candidate.termStats.filter(
		(termStat) => termStat.bestTier === "miss",
	).length;
	const coverageRatio = (queryTermCount - missCount) / queryTermCount;
	const filePriorScore =
		(buildFilePriorScore(candidate) +
			Math.max(0, 14 - candidate.parentFileRank) * 4.4) *
		weights.filePrior;
	const localCoverageScore =
		(candidate.localScore +
			coverageRatio * 280 +
			exactTermCount * 64 +
			prefixTermCount * 28 +
			fuzzyTermCount * 10 -
			missCount * 44 -
			candidate.localSignals.distancePenaltyTotal * 1.3 -
			candidate.localSignals.distancePenaltyMax * 2.4) *
		weights.localCoverage;
	const lexicalRefineScore =
		(buildCompactnessScore(candidate) +
			buildOccurrenceDensityScore(candidate) +
			buildTierQualityScore(exactTermCount, prefixTermCount, fuzzyTermCount)) *
		weights.lexicalRefine;
	const structureScore =
		buildStructureScore(candidate) * weights.structure;
	return {
		filePriorScore,
		localCoverageScore,
		lexicalRefineScore,
		structureScore,
		overlapPenalty: 0,
		totalScore:
			filePriorScore + localCoverageScore + lexicalRefineScore + structureScore,
	};
}

function buildFilePriorScore(candidate: HybridLexicalLaneBlockCandidate): number {
	const metadata = candidate.parentMetadataSignals;
	return (
		Math.log1p(Math.max(0, candidate.parentFileScore)) * 42 +
		(metadata.basenameExact ? 240 : 0) +
		(metadata.basenamePrefix ? 110 : 0) +
		(metadata.pathExact ? 60 : 0) +
		(metadata.pathPrefix ? 24 : 0) +
		metadata.pathAnchorCoverageCount * 104 +
		metadata.pathRootAnchorCoverageCount * 92 +
		(metadata.pathRootAnchorExact ? 132 : 0) +
		metadata.folderHintCount * 26 +
		(metadata.templateFolderHit ? 230 : 0) -
		(metadata.archivePenaltyEligible ? 28 : 0) +
		(metadata.headingMetaHit ? 42 : 0) +
		metadata.headingExactCount * 132 +
		metadata.headingPrefixCount * 48 +
		(metadata.aliasHit ? 34 : 0) +
		metadata.aliasExactCount * 104 +
		metadata.aliasPrefixCount * 40
	);
}

function buildCompactnessScore(candidate: HybridLexicalLaneBlockCandidate): number {
	const spread = candidate.localSignals.occurrenceSpread;
	const spanLength = candidate.localSignals.spanLength;
	return (
		Math.max(0, 180 - Math.min(220, spanLength)) * 0.42 +
		Math.max(0, 160 - Math.min(200, spread)) * 0.36
	);
}

function buildOccurrenceDensityScore(
	candidate: HybridLexicalLaneBlockCandidate,
): number {
	const occurrenceCount = candidate.localSignals.occurrenceCount;
	if (occurrenceCount === 0) {
		return 0;
	}
	return Math.min(
		56,
		(candidate.localSignals.coverageCount / Math.max(1, occurrenceCount)) * 52 +
			occurrenceCount * 3,
	);
}

function buildTierQualityScore(
	exactTermCount: number,
	prefixTermCount: number,
	fuzzyTermCount: number,
): number {
	return exactTermCount * 18 + prefixTermCount * 8 + fuzzyTermCount * 2;
}

function buildStructureScore(candidate: HybridLexicalLaneBlockCandidate): number {
	const slashDepth = candidate.filePath.split("/").length - 1;
	return (
		(candidate.headingChain.length > 0 ? 28 : 0) +
		Math.max(0, 6 - candidate.headingChain.length) * 5 +
		Math.max(0, 7 - slashDepth) * 3
	);
}


function computeOverlapPenalty(
	candidate: HybridLexicalLaneBlockCandidate,
	selected: readonly HybridLexicalLaneRankedBlockCandidate[],
): number {
	let penalty = 0;
	for (const previous of selected) {
		if (previous.filePath !== candidate.filePath) {
			continue;
		}
		const overlapRatio = computeSpanOverlapRatio(previous, candidate);
		const noveltyRatio = computeOccurrenceNoveltyRatio(candidate, previous);
		if (overlapRatio >= 0.85) {
			penalty += noveltyRatio < 0.25 ? 120 : 54;
			continue;
		}
		if (overlapRatio >= 0.55) {
			penalty += noveltyRatio < 0.35 ? 52 : 18;
			continue;
		}
		if (
			previous.headingChain.join("\u001f") ===
				candidate.headingChain.join("\u001f") &&
			Math.abs(previous.localSignals.anchorOffset - candidate.localSignals.anchorOffset) <
				160
		) {
			penalty += noveltyRatio < 0.3 ? 24 : 8;
		}
	}
	return penalty;
}

function computeOccurrenceNoveltyRatio(
	candidate: Pick<HybridLexicalLaneBlockCandidate, "matchOccurrences">,
	previous: Pick<HybridLexicalLaneBlockCandidate, "matchOccurrences">,
): number {
	if (candidate.matchOccurrences.length === 0) {
		return 0;
	}
	let novelCount = 0;
	for (const occurrence of candidate.matchOccurrences) {
		const overlapsExisting = previous.matchOccurrences.some(
			(existing) =>
				existing.termId === occurrence.termId &&
				Math.min(existing.end, occurrence.end) >
					Math.max(existing.start, occurrence.start),
		);
		if (!overlapsExisting) {
			novelCount += 1;
		}
	}
	return novelCount / candidate.matchOccurrences.length;
}

function computeSpanOverlapRatio(
	left: Pick<HybridLexicalLaneBlockCandidate, "startOffset" | "endOffset">,
	right: Pick<HybridLexicalLaneBlockCandidate, "startOffset" | "endOffset">,
): number {
	const overlapStart = Math.max(left.startOffset, right.startOffset);
	const overlapEnd = Math.min(left.endOffset, right.endOffset);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const shorterLength = Math.max(
		1,
		Math.min(left.endOffset - left.startOffset, right.endOffset - right.startOffset),
	);
	return overlap / shorterLength;
}
