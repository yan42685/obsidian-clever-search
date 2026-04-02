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
	const filePriorScore =
		candidate.parentFileScore * 100 * weights.filePrior +
		Math.max(0, 12 - candidate.parentFileRank) * 3;
	const localCoverageScore =
		(candidate.localScore * 100 +
			candidate.localSignals.coverageCount * 36 +
			candidate.localSignals.exactCount * 44 +
			candidate.localSignals.prefixCount * 18 +
			candidate.localSignals.fuzzyCount * 8 -
			candidate.localSignals.distancePenaltyTotal * 5) *
		weights.localCoverage;
	const lexicalRefineScore =
		(Math.max(0, 160 - candidate.localSignals.spanLength * 0.35) +
			Math.max(0, 60 - candidate.localSignals.distancePenaltyMax * 8)) *
		weights.lexicalRefine;
	const structureScore =
		(candidate.headingChain.length > 0 ? 40 : 0) * weights.structure;
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
		if (overlapRatio >= 0.85) {
			penalty += 90;
			continue;
		}
		if (overlapRatio >= 0.55) {
			penalty += 36;
			continue;
		}
		if (
			previous.headingChain.join("\u001f") ===
				candidate.headingChain.join("\u001f") &&
			Math.abs(previous.localSignals.anchorOffset - candidate.localSignals.anchorOffset) <
				160
		) {
			penalty += 18;
		}
	}
	return penalty;
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
