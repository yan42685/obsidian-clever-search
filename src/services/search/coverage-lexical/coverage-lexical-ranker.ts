import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalFamilySignal,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";

export function rankCoverageLexicalResults(
	results: readonly CoverageLexicalRankableResult[],
	plan: CoverageLexicalPlan,
): CoverageLexicalRankableResult[] {
	if (results.length <= 1) {
		return [...results];
	}
	return [...results].sort((left, right) => {
		const signalDecision = compareCoverageLexicalSignals(
			left.coverageLexicalSignal,
			right.coverageLexicalSignal,
			plan,
		);
		if (signalDecision !== 0) {
			return signalDecision;
		}
		return (
			(right.score ?? 0) - (left.score ?? 0) ||
			left.path.localeCompare(right.path)
		);
	});
}

function compareCoverageLexicalSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	if (plan.route === "metadata-first") {
		return (
			compareAreaSignals(left.metadata, right.metadata) ||
			compareDescendingMetric(left.body.coverageCount, right.body.coverageCount) ||
			compareDescendingMetric(left.body.exactWeight, right.body.exactWeight) ||
			compareDescendingMetric(left.body.prefixWeight, right.body.prefixWeight) ||
			compareDescendingMetric(left.body.fuzzyWeight, right.body.fuzzyWeight) ||
			compareDescendingMetric(left.tailWeight, right.tailWeight)
		);
	}

	return (
		compareDescendingMetric(left.body.coverageCount, right.body.coverageCount) ||
		compareAreaSignals(left.body, right.body) ||
		(plan.route === "body-with-anchor"
			? compareDescendingMetric(left.metadata.coverageCount, right.metadata.coverageCount) ||
				compareAreaSignals(left.metadata, right.metadata)
			: 0) ||
		compareDescendingMetric(left.metadataWeight, right.metadataWeight) ||
		compareDescendingMetric(left.tailWeight, right.tailWeight)
	);
}

function compareAreaSignals(
	left: CoverageLexicalFamilySignal["body"],
	right: CoverageLexicalFamilySignal["body"],
): number {
	return (
		compareDescendingMetric(left.coverageCount, right.coverageCount) ||
		compareDescendingMetric(left.exactWeight, right.exactWeight) ||
		compareDescendingMetric(left.prefixWeight, right.prefixWeight) ||
		compareDescendingMetric(left.fuzzyWeight, right.fuzzyWeight)
	);
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

export type CoverageLexicalRankableResult = MatchedFile & {
	coverageLexicalSignal: CoverageLexicalFamilySignal;
};
