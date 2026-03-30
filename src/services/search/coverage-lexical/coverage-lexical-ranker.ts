import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalCharSignal,
	CoverageLexicalFamilyCountSummary,
	CoverageLexicalFamilySignal,
	CoverageLexicalMetadataIdentitySignal,
	CoverageLexicalPlan,
	CoverageLexicalTagSignal,
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
	const countDecision = compareCoverageLexicalFamilyCountSummaries(
		left.familyCountSummary,
		right.familyCountSummary,
		plan,
	);
	if (countDecision !== 0) {
		return countDecision;
	}
	if (plan.route === "metadata-first") {
		return compareMetadataFirstDetailStages(left, right);
	}
	if (plan.route === "body-with-anchor") {
		return compareBodyWithAnchorDetailStages(left, right, plan);
	}
	return compareBodyFirstDetailStages(left, right);
}

export function compareCoverageLexicalFamilyCountSummaries(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
	plan: CoverageLexicalPlan,
): number {
	return (
		compareDescendingMetric(
			left.totalMatchedFamilyCount,
			right.totalMatchedFamilyCount,
		) ||
		(plan.route === "body-first"
			? compareBodyFirstCountTieBreakers(left, right)
			: compareMetadataFirstCountTieBreakers(left, right))
	);
}

function compareMetadataFirstCountTieBreakers(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
): number {
	return (
		compareDescendingMetric(
			left.metadataMatchedFamilyCount,
			right.metadataMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.basenameMatchedFamilyCount,
			right.basenameMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.aliasesMatchedFamilyCount,
			right.aliasesMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.folderMatchedFamilyCount,
			right.folderMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.headingsMatchedFamilyCount,
			right.headingsMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.tagsMatchedFamilyCount,
			right.tagsMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.bodyMatchedFamilyCount,
			right.bodyMatchedFamilyCount,
		)
	);
}

function compareBodyFirstCountTieBreakers(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
): number {
	return (
		compareDescendingMetric(
			left.bodyMatchedFamilyCount,
			right.bodyMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.metadataMatchedFamilyCount,
			right.metadataMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.basenameMatchedFamilyCount,
			right.basenameMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.aliasesMatchedFamilyCount,
			right.aliasesMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.folderMatchedFamilyCount,
			right.folderMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.headingsMatchedFamilyCount,
			right.headingsMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.tagsMatchedFamilyCount,
			right.tagsMatchedFamilyCount,
		)
	);
}

function compareMetadataFirstDetailStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
		compareTagSignals(left.tagSignal, right.tagSignal) ||
		compareCharSignals(left.metadataChar, right.metadataChar) ||
		compareCharSignals(left.bodyChar, right.bodyChar) ||
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

function compareBodyWithAnchorDetailStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	if (plan.hasPathShapeHint || plan.hasTitleShapeHint || plan.hasMixedScriptHint) {
		return (
			compareAreaSignals(left.coreBody, right.coreBody) ||
			compareCharSignals(left.bodyChar, right.bodyChar) ||
			compareCharSignals(left.metadataChar, right.metadataChar) ||
			compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
			compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			compareTagSignals(left.tagSignal, right.tagSignal) ||
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
		compareCharSignals(left.bodyChar, right.bodyChar) ||
		compareCharSignals(left.metadataChar, right.metadataChar) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
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

function compareBodyFirstDetailStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareAreaSignals(left.coreBody, right.coreBody) ||
		compareCharSignals(left.bodyChar, right.bodyChar) ||
		compareCharSignals(left.metadataChar, right.metadataChar) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		compareAreaSignals(left.softBody, right.softBody) ||
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
		compareTagSignals(left.tagSignal, right.tagSignal) ||
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

function compareMetadataIdentitySignals(
	left: CoverageLexicalMetadataIdentitySignal,
	right: CoverageLexicalMetadataIdentitySignal,
): number {
	return (
		compareDescendingMetric(left.phraseCoverageCount, right.phraseCoverageCount) ||
		compareDescendingMetric(left.phraseWeight, right.phraseWeight) ||
		compareAreaSignals(left.overall, right.overall) ||
		compareAreaSignals(left.basename, right.basename) ||
		compareAreaSignals(left.alias, right.alias) ||
		compareAreaSignals(left.path, right.path) ||
		compareAreaSignals(left.heading, right.heading)
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

function compareCharSignals(
	left: CoverageLexicalCharSignal,
	right: CoverageLexicalCharSignal,
): number {
	return (
		compareDescendingMetric(left.fullSegmentCount, right.fullSegmentCount) ||
		compareDescendingMetric(
			left.bestSegmentCoverageRatio,
			right.bestSegmentCoverageRatio,
		) ||
		compareDescendingMetric(
			left.bestSegmentCoverageCount,
			right.bestSegmentCoverageCount,
		) ||
		compareDescendingMetric(left.matchRatio, right.matchRatio) ||
		compareDescendingMetric(left.matchCount, right.matchCount)
	);
}

function compareTagSignals(
	left: CoverageLexicalTagSignal,
	right: CoverageLexicalTagSignal,
): number {
	return (
		compareDescendingMetric(left.exactMatchCount, right.exactMatchCount) ||
		compareDescendingMetric(left.charMatchRatio, right.charMatchRatio) ||
		compareDescendingMetric(left.charMatchCount, right.charMatchCount)
	);
}

export type CoverageLexicalRankableResult = MatchedFile & {
	coverageLexicalSignal: CoverageLexicalFamilySignal;
};
