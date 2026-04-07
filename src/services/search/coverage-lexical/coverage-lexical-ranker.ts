import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalCharSignal,
	CoverageLexicalFamilyCountSummary,
	CoverageLexicalFamilySignal,
	CoverageLexicalMetadataIdentitySignal,
	CoverageLexicalPrefixWitness,
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
	const totalDecision = compareDescendingMetric(
		left.familyCountSummary.totalMatchedFamilyCount,
		right.familyCountSummary.totalMatchedFamilyCount,
	);
	if (totalDecision !== 0) {
		return totalDecision;
	}
	const earlyGuardrailDecision = compareEarlyBodyQualityGuardrails(
		left,
		right,
		plan,
	);
	if (earlyGuardrailDecision !== 0) {
		return earlyGuardrailDecision;
	}
	const countDecision = compareCoverageLexicalCountTieBreakers(
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

function comparePrefixTierPreference(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	if (compareExactTierSignals(left, right) !== 0) {
		return 0;
	}
	return comparePrefixWitnessPreference(
		left.metadataPrefixWitness ?? left.bodyPrefixWitness,
		right.metadataPrefixWitness ?? right.bodyPrefixWitness,
	);
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
		compareCoverageLexicalCountTieBreakers(left, right, plan)
	);
}

function compareCoverageLexicalCountTieBreakers(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
	plan: CoverageLexicalPlan,
): number {
	if (plan.route === "body-first") {
		return compareBodyFirstCountTieBreakers(left, right);
	}
	if (plan.route === "body-with-anchor") {
		return compareBodyWithAnchorCountTieBreakers(left, right, plan);
	}
	return compareMetadataFirstCountTieBreakers(left, right);
}

function compareMetadataFirstCountTieBreakers(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
): number {
	return (
		compareStrongMetadataFamilyCounts(left, right) ||
		compareDescendingMetric(
			left.metadataMatchedFamilyCount,
			right.metadataMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.bodyMatchedFamilyCount,
			right.bodyMatchedFamilyCount,
		) ||
		compareBroadMetadataFamilyCounts(left, right)
	);
}

function compareBodyWithAnchorCountTieBreakers(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
	plan: CoverageLexicalPlan,
): number {
	if (plan.hasPathShapeHint || plan.hasTitleShapeHint) {
		return (
			compareStrongMetadataFamilyCounts(left, right) ||
			compareDescendingMetric(
				left.metadataMatchedFamilyCount,
				right.metadataMatchedFamilyCount,
			) ||
			compareBroadMetadataFamilyCounts(left, right) ||
			compareDescendingMetric(
				left.bodyMatchedFamilyCount,
				right.bodyMatchedFamilyCount,
			)
		);
	}
	return (
		compareStrongMetadataFamilyCounts(left, right) ||
		compareDescendingMetric(
			left.bodyMatchedFamilyCount,
			right.bodyMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.metadataMatchedFamilyCount,
			right.metadataMatchedFamilyCount,
		) ||
		compareBroadMetadataFamilyCounts(left, right)
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
		compareStrongMetadataFamilyCounts(left, right) ||
		compareDescendingMetric(
			left.metadataMatchedFamilyCount,
			right.metadataMatchedFamilyCount,
		) ||
		compareBroadMetadataFamilyCounts(left, right)
	);
}

function compareStrongMetadataFamilyCounts(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
): number {
	return (
		compareDescendingMetric(
			left.basenameMatchedFamilyCount,
			right.basenameMatchedFamilyCount,
		) ||
		compareDescendingMetric(
			left.aliasesMatchedFamilyCount,
			right.aliasesMatchedFamilyCount,
		)
	);
}

function compareBroadMetadataFamilyCounts(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
): number {
	return (
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

function compareEarlyBodyQualityGuardrails(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	if (plan.route === "body-first") {
		return 0;
	}
	if (
		plan.route === "body-with-anchor" &&
		(plan.hasPathShapeHint || plan.hasTitleShapeHint)
	) {
		return 0;
	}
	const bodyWitnessDecision = compareBodyWitnessSignals(left, right);
	if (bodyWitnessDecision === 0) {
		return 0;
	}
	if (bodyWitnessDecision < 0) {
		return shouldPromoteBodyWitness(left, right, plan) ? -1 : 0;
	}
	return shouldPromoteBodyWitness(right, left, plan) ? 1 : 0;
}

function compareBodyWitnessSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		comparePhraseBridgeSignals(left, right) ||
		compareDescendingMetric(left.coreBody.coverageCount, right.coreBody.coverageCount) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight)
	);
}

function shouldPromoteBodyWitness(
	candidate: CoverageLexicalFamilySignal,
	opponent: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): boolean {
	if (!hasPromotableBodyWitness(candidate, opponent)) {
		return false;
	}
	if (!hasMetadataSuppressionPressure(candidate, opponent)) {
		return false;
	}
	const strongMetadataLead =
		getStrongMetadataFamilyCount(opponent.familyCountSummary) -
		getStrongMetadataFamilyCount(candidate.familyCountSummary);
	if (plan.route === "metadata-first") {
		return strongMetadataLead <= 0;
	}
	return strongMetadataLead <= 1;
}

function hasPromotableBodyWitness(
	candidate: CoverageLexicalFamilySignal,
	opponent: CoverageLexicalFamilySignal,
): boolean {
	const candidateHasWitness =
		candidate.coreBody.exactWeight > 0 &&
		(
			candidate.localEvidence.primary.exactCoreWeight > 0 ||
			candidate.localEvidence.primary.orderedPairCount > 0 ||
			candidate.localEvidence.corroboratedExactCoreWeight > 0 ||
			candidate.phraseBridgeCount > 0
		);
	if (!candidateHasWitness) {
		return false;
	}
	const exactLead =
		candidate.coreBody.exactWeight > opponent.coreBody.exactWeight ||
		candidate.localEvidence.primary.exactCoreWeight >
			opponent.localEvidence.primary.exactCoreWeight ||
		candidate.localEvidence.corroboratedExactCoreWeight >
			opponent.localEvidence.corroboratedExactCoreWeight;
	const localityLead =
		candidate.localEvidence.primary.orderedPairCount >
			opponent.localEvidence.primary.orderedPairCount ||
		candidate.localEvidence.primary.orderRatio >
			opponent.localEvidence.primary.orderRatio ||
		candidate.localEvidence.primary.compactnessRatio >
			opponent.localEvidence.primary.compactnessRatio ||
		candidate.phraseBridgeCount > opponent.phraseBridgeCount ||
		candidate.phraseBridgeWeight > opponent.phraseBridgeWeight;
	return (
		exactLead &&
		(
			localityLead ||
			candidate.coreBody.coverageCount > opponent.coreBody.coverageCount
		)
	);
}

function hasMetadataSuppressionPressure(
	candidate: CoverageLexicalFamilySignal,
	opponent: CoverageLexicalFamilySignal,
): boolean {
	return (
		opponent.familyCountSummary.metadataMatchedFamilyCount >
			candidate.familyCountSummary.metadataMatchedFamilyCount ||
		getStrongMetadataFamilyCount(opponent.familyCountSummary) >
			getStrongMetadataFamilyCount(candidate.familyCountSummary) ||
		getBroadMetadataFamilyCount(opponent.familyCountSummary) >
			getBroadMetadataFamilyCount(candidate.familyCountSummary)
	);
}

function getStrongMetadataFamilyCount(
	summary: CoverageLexicalFamilyCountSummary,
): number {
	return (
		summary.basenameMatchedFamilyCount +
		summary.aliasesMatchedFamilyCount
	);
}

function getBroadMetadataFamilyCount(
	summary: CoverageLexicalFamilyCountSummary,
): number {
	return (
		summary.folderMatchedFamilyCount +
		summary.headingsMatchedFamilyCount +
		summary.tagsMatchedFamilyCount
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
			comparePhraseBridgeSignals(left, right) ||
			compareCoverageLexicalWindowFusionSignals(
				left.localEvidence,
				right.localEvidence,
			) ||
			comparePrefixTierPreference(left, right) ||
			compareAreaSignals(left.softBody, right.softBody) ||
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			compareTagSignals(left.tagSignal, right.tagSignal) ||
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
		comparePrefixTierPreference(left, right) ||
		compareAreaSignals(left.softBody, right.softBody) ||
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
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
		comparePrefixTierPreference(left, right) ||
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
		compareAreaSignals(left.heading, right.heading) ||
		compareAreaSignals(left.tag, right.tag)
	);
}

function compareExactTierSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
		compareDescendingMetric(left.softBody.exactWeight, right.softBody.exactWeight) ||
		compareDescendingMetric(
			left.metadataAnchor.exactWeight,
			right.metadataAnchor.exactWeight,
		) ||
		compareDescendingMetric(
			left.metadataIdentity.overall.exactWeight,
			right.metadataIdentity.overall.exactWeight,
		) ||
		compareDescendingMetric(
			left.tagSignal.exactMatchCount,
			right.tagSignal.exactMatchCount,
		)
	);
}

function comparePrefixWitnessPreference(
	left: CoverageLexicalPrefixWitness | null,
	right: CoverageLexicalPrefixWitness | null,
): number {
	if (!left || !right) {
		return 0;
	}
	return compareConcretePrefixWitnesses(
		left as CoverageLexicalPrefixWitness,
		right as CoverageLexicalPrefixWitness,
	);
}

function compareConcretePrefixWitnesses(
	left: CoverageLexicalPrefixWitness,
	right: CoverageLexicalPrefixWitness,
): number {
	const channelDecision = compareDescendingMetric(
		left.channel === "metadata" ? 1 : 0,
		right.channel === "metadata" ? 1 : 0,
	);
	if (channelDecision !== 0) {
		return channelDecision;
	}
	const fieldDecision = compareDescendingMetric(
		getMetadataPrefixFieldPriority(left.field),
		getMetadataPrefixFieldPriority(right.field),
	);
	if (fieldDecision !== 0) {
		return fieldDecision;
	}
	const completionDecision = compareAscendingMetric(
		left.completionGain,
		right.completionGain,
	);
	if (completionDecision !== 0) {
		return completionDecision;
	}
	const shapeDecision = compareAscendingMetric(
		left.shapePenalty,
		right.shapePenalty,
	);
	if (shapeDecision !== 0) {
		return shapeDecision;
	}
	const fanoutDecision = compareAscendingMetric(
		left.targetDocCount,
		right.targetDocCount,
	);
	if (fanoutDecision !== 0) {
		return fanoutDecision;
	}
	return compareAscendingMetric(left.totalDocCount, right.totalDocCount);
}

function getMetadataPrefixFieldPriority(
	field: CoverageLexicalPrefixWitness["field"],
): number {
	switch (field) {
		case "basename":
			return 5;
		case "aliases":
			return 4;
		case "headings":
			return 3;
		case "folder":
			return 2;
		case "tags":
			return 1;
		default:
			return 0;
	}
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function compareAscendingMetric(left: number, right: number): number {
	return left - right;
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
