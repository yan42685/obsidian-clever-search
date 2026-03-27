import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalFamilySignal,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";
import { compareLocalWindowSignals } from "./coverage-lexical-windowing";

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
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			compareAreaSignals(left.coreBody, right.coreBody) ||
			compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
			compareLocalWindowSignals(left.localWindow, right.localWindow) ||
			compareAreaSignals(left.softBody, right.softBody) ||
			compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
		);
	}

	if (plan.route === "body-with-anchor") {
		return (
			compareAreaSignals(left.coreBody, right.coreBody) ||
			compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
			compareLocalWindowSignals(left.localWindow, right.localWindow) ||
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			compareAreaSignals(left.softBody, right.softBody) ||
			compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
		);
	}

	return (
		compareAreaSignals(left.coreBody, right.coreBody) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		compareLocalWindowSignals(left.localWindow, right.localWindow) ||
		compareAreaSignals(left.softBody, right.softBody) ||
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
		compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
	);
}

function compareAreaSignals(
	left: CoverageLexicalFamilySignal["coreBody"],
	right: CoverageLexicalFamilySignal["coreBody"],
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
