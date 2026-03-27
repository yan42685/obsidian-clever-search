import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalFamilySignal,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";
import { compareCoverageLexicalWindowFusionSignals } from "./coverage-lexical-fusion";

export function rankCoverageLexicalResults(
	results: readonly CoverageLexicalRankableResult[],
	plan: CoverageLexicalPlan,
): CoverageLexicalRankableResult[] {
	if (results.length <= 1) {
		return [...results];
	}
	return [...results].sort((left, right) => {
		const signalDecision = compareCoverageLexicalResultSignals(
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

export function compareCoverageLexicalResultSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	if (plan.route === "metadata-first") {
		return compareMetadataFirstStages(left, right);
	}
	if (plan.route === "body-with-anchor") {
		return compareBodyWithAnchorStages(left, right, plan);
	}
	return compareBodyFirstStages(left, right);
}

function compareMetadataFirstStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
		compareAreaSignals(left.coreBody, right.coreBody) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		compareAreaSignals(left.softBody, right.softBody) ||
		compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
	);
}

function compareBodyWithAnchorStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	if (plan.hasPathShapeHint || plan.hasTitleShapeHint || plan.hasMixedScriptHint) {
		return (
			compareAreaSignals(left.coreBody, right.coreBody) ||
			compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			comparePhraseBridgeSignals(left, right) ||
			compareCoverageLexicalWindowFusionSignals(
				left.localEvidence,
				right.localEvidence,
			) ||
			compareAreaSignals(left.softBody, right.softBody) ||
			compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
		);
	}
	return (
		compareAreaSignals(left.coreBody, right.coreBody) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
		compareAreaSignals(left.softBody, right.softBody) ||
		compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
	);
}

function compareBodyFirstStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareAreaSignals(left.coreBody, right.coreBody) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
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

function comparePhraseBridgeSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareDescendingMetric(left.phraseBridgeCount, right.phraseBridgeCount) ||
		compareDescendingMetric(left.phraseBridgeWeight, right.phraseBridgeWeight)
	);
}

export type CoverageLexicalRankableResult = MatchedFile & {
	coverageLexicalSignal: CoverageLexicalFamilySignal;
};
