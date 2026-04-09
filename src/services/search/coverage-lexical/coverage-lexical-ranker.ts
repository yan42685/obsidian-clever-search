import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalCharSignal,
	CoverageLexicalCoverageProfile,
	CoverageLexicalFamilyCountSummary,
	CoverageLexicalFamilySignal,
	CoverageLexicalMetadataIdentitySignal,
	CoverageLexicalPrefixWitness,
	CoverageLexicalPlan,
	CoverageLexicalTagSignal,
} from "./coverage-lexical-types";
import { compareCoverageLexicalWindowFusionSignals } from "./coverage-lexical-fusion";
import {
	compareCoverageLexicalEvidenceMassSummaries,
	getCoverageLexicalEvidenceMassSummary,
} from "./coverage-lexical-evidence";

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
	const mode = resolveCoverageLexicalDecisionMode(plan);
	const coverageDecision = compareCoverageLexicalCoverageProfiles(
		left,
		right,
		plan,
	);
	if (coverageDecision !== 0) {
		return coverageDecision;
	}
	const earlyGuardrailDecision = compareEarlyBodyQualityGuardrails(
		left,
		right,
		plan,
	);
	if (earlyGuardrailDecision !== 0) {
		return earlyGuardrailDecision;
	}
	const detailDecision = compareCoverageLexicalSemanticDetailStages(
		left,
		right,
		plan,
		mode,
	);
	if (detailDecision !== 0) {
		return detailDecision;
	}
	const weightedDecision = compareCoverageLexicalEvidenceMassSummaries(
		getCoverageLexicalEvidenceMassSummary(left),
		getCoverageLexicalEvidenceMassSummary(right),
	);
	if (weightedDecision !== 0) {
		return weightedDecision;
	}
	return 0;
}

function compareCoverageLexicalCoverageProfiles(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	const leftProfile = left.coverageProfile;
	const rightProfile = right.coverageProfile;
	const mixedScriptDecision = compareCrossScriptCoverage(
		leftProfile,
		rightProfile,
		plan,
	);
	if (mixedScriptDecision !== 0) {
		return mixedScriptDecision;
	}
	const decisiveGapDecision = compareAscendingMetric(
		getEffectiveDecisiveGapCount(left, plan),
		getEffectiveDecisiveGapCount(right, plan),
	);
	if (decisiveGapDecision !== 0) {
		return decisiveGapDecision;
	}
	const adjustedRequiredRatioDecision = compareDescendingMetric(
		getAdjustedRequiredCoverageRatio(left, plan),
		getAdjustedRequiredCoverageRatio(right, plan),
	);
	if (adjustedRequiredRatioDecision !== 0) {
		return adjustedRequiredRatioDecision;
	}
	const supportGapDecision = compareAscendingMetric(
		getEffectiveSupportGapCount(left, plan),
		getEffectiveSupportGapCount(right, plan),
	);
	if (supportGapDecision !== 0) {
		return supportGapDecision;
	}
	if (plan.queryKind === "memory_relaxed") {
		return 0;
	}
	const requiredRatioDecision = compareDescendingMetric(
		getCoverageWeightRatio(
			leftProfile.requiredCoveredFamilyWeight,
			leftProfile.requiredFamilyWeight,
		),
		getCoverageWeightRatio(
			rightProfile.requiredCoveredFamilyWeight,
			rightProfile.requiredFamilyWeight,
		),
	);
	if (requiredRatioDecision !== 0) {
		return requiredRatioDecision;
	}
	const meaningfulRatioDecision = compareDescendingMetric(
		getCoverageWeightRatio(
			leftProfile.meaningfulCoveredFamilyWeight,
			leftProfile.meaningfulFamilyWeight,
		),
		getCoverageWeightRatio(
			rightProfile.meaningfulCoveredFamilyWeight,
			rightProfile.meaningfulFamilyWeight,
		),
	);
	if (meaningfulRatioDecision !== 0) {
		return meaningfulRatioDecision;
	}
	return (
		compareDescendingMetric(
			leftProfile.requiredCoveredFamilyWeight,
			rightProfile.requiredCoveredFamilyWeight,
		) ||
		compareDescendingMetric(
			leftProfile.meaningfulCoveredFamilyWeight,
			rightProfile.meaningfulCoveredFamilyWeight,
		)
	);
}

function compareCrossScriptCoverage(
	left: CoverageLexicalCoverageProfile,
	right: CoverageLexicalCoverageProfile,
	plan: CoverageLexicalPlan,
): number {
	const requiresCrossScript =
		plan.hasMixedScriptHint ||
		left.crossScriptRequired ||
		right.crossScriptRequired;
	if (!requiresCrossScript) {
		return 0;
	}
	return compareDescendingMetric(
		left.crossScriptSatisfied ? 1 : 0,
		right.crossScriptSatisfied ? 1 : 0,
	);
}

function getEffectiveDecisiveGapCount(
	signal: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	const rawGapCount =
		signal.coverageProfile.decisiveFamilyCount -
		signal.coverageProfile.decisiveCoveredFamilyCount;
	const allowance = getCoverageGapRescueAllowance(signal, plan).decisive;
	return Math.max(0, rawGapCount - allowance);
}

function getEffectiveSupportGapCount(
	signal: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	const rawGapCount =
		signal.coverageProfile.supportFamilyCount -
		signal.coverageProfile.supportCoveredFamilyCount;
	const allowance = getCoverageGapRescueAllowance(signal, plan).support;
	return Math.max(0, rawGapCount - allowance);
}

function getCoverageGapRescueAllowance(
	signal: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): { decisive: number; support: number } {
	const strongWitness =
		signal.metadataIdentity.phraseCoverageCount > 0 ||
		signal.phraseBridgeCount > 0 ||
		signal.localEvidence.primary.exactCoreWeight > 0 ||
		signal.localEvidence.primary.orderedPairCount > 0 ||
		signal.localEvidence.corroboratedExactCoreWeight > 0;
	const bridgeCorroboration =
		signal.bodyChar.fullSegmentCount > 0 ||
		signal.metadataChar.fullSegmentCount > 0 ||
		signal.bodyChar.bestSegmentCoverageRatio >= 0.85 ||
		signal.metadataChar.bestSegmentCoverageRatio >= 0.85 ||
		signal.tagSignal.exactMatchCount > 0;
	let support = 0;
	if (strongWitness) {
		support += 1;
	}
	if (plan.queryKind === "memory_relaxed" && bridgeCorroboration) {
		support += 1;
	}
	return {
		decisive: plan.queryKind === "memory_relaxed" && strongWitness ? 1 : 0,
		support,
	};
}

function getCoverageWeightRatio(covered: number, total: number): number {
	if (total <= 0) {
		return 1;
	}
	return covered / total;
}

function getAdjustedRequiredCoverageRatio(
	signal: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	const total = signal.coverageProfile.requiredFamilyCount;
	if (total <= 0) {
		return 1;
	}
	const allowance = getCoverageGapRescueAllowance(signal, plan);
	const adjustedCovered = Math.min(
		total,
		signal.coverageProfile.requiredCoveredFamilyCount +
			allowance.decisive +
			allowance.support,
	);
	return adjustedCovered / total;
}

function compareMetadataAssistCountOverride(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	mode: CoverageLexicalRankerDecisionMode,
): number {
	if (mode !== "body-first") {
		return 0;
	}
	if (compareExactTierSignals(left, right) !== 0) {
		return 0;
	}
	if (comparePhraseBridgeSignals(left, right) !== 0) {
		return 0;
	}
	if (
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) !== 0
	) {
		return 0;
	}
	if (
		left.metadataPrefixAssist.prefixWeight <= 0 &&
		right.metadataPrefixAssist.prefixWeight <= 0
	) {
		return 0;
	}
	return compareMetadataPrefixAssistSignals(left, right);
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

function compareMetadataPrefixAssistSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	if (compareExactTierSignals(left, right) !== 0) {
		return 0;
	}
	const assistDecision = compareAreaSignals(
		left.metadataPrefixAssist,
		right.metadataPrefixAssist,
	);
	if (assistDecision !== 0) {
		return assistDecision;
	}
	return comparePrefixWitnessPreference(
		left.metadataPrefixWitness,
		right.metadataPrefixWitness,
	);
}

function compareCoverageLexicalSemanticDetailStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
	mode: CoverageLexicalRankerDecisionMode,
): number {
	if (mode === "metadata-first") {
		return compareMetadataFirstDetailStages(left, right);
	}
	if (mode === "body-with-anchor") {
		return compareBodyWithAnchorDetailStages(left, right, plan);
	}
	return compareBodyFirstDetailStages(left, right);
}

export function compareCoverageLexicalFamilyCountSummaries(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
	plan: CoverageLexicalPlan,
): number {
	const mode = resolveCoverageLexicalDecisionMode(plan);
	return (
		compareCoverageLexicalLegacyCountFallback(left, right, plan, mode) ||
		compareDescendingMetric(
			left.totalMatchedFamilyCount,
			right.totalMatchedFamilyCount,
		)
	);
}

function compareCoverageLexicalLegacyCountFallback(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
	plan: CoverageLexicalPlan,
	mode: CoverageLexicalRankerDecisionMode,
): number {
	return (
		compareCoverageLexicalCountTieBreakers(left, right, plan, mode) ||
		compareDescendingMetric(
			left.totalMatchedFamilyCount,
			right.totalMatchedFamilyCount,
		)
	);
}

function compareCoverageLexicalCountTieBreakers(
	left: CoverageLexicalFamilyCountSummary,
	right: CoverageLexicalFamilyCountSummary,
	plan: CoverageLexicalPlan,
	mode: CoverageLexicalRankerDecisionMode,
): number {
	if (mode === "body-first") {
		return compareBodyFirstCountTieBreakers(left, right, plan);
	}
	if (mode === "body-with-anchor") {
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
	_plan: CoverageLexicalPlan,
): number {
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
	const mode = resolveCoverageLexicalDecisionMode(plan);
	if (mode === "body-first") {
		return 0;
	}
	if (plan.hasMixedScriptHint) {
		return 0;
	}
	if (
		mode === "body-with-anchor" &&
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
	if (
		getStrongMetadataFamilyCount(opponent.familyCountSummary) >
			getStrongMetadataFamilyCount(candidate.familyCountSummary) ||
		compareMetadataIdentitySignals(
			candidate.metadataIdentity,
			opponent.metadataIdentity,
		) > 0
	) {
		return false;
	}
	if (!hasMetadataSuppressionPressure(candidate, opponent)) {
		return false;
	}
	const strongMetadataLead =
		getStrongMetadataFamilyCount(opponent.familyCountSummary) -
		getStrongMetadataFamilyCount(candidate.familyCountSummary);
	if (resolveCoverageLexicalDecisionMode(plan) === "metadata-first") {
		return strongMetadataLead <= 0;
	}
	return strongMetadataLead <= 1;
}

type CoverageLexicalRankerDecisionMode =
	| "metadata-first"
	| "body-with-anchor"
	| "body-first";

function resolveCoverageLexicalDecisionMode(
	plan: CoverageLexicalPlan,
): CoverageLexicalRankerDecisionMode {
	const metadataFirst =
		plan.decisionPriors?.metadataFirst ??
		(plan.decisiveAnchorMass ?? 0) +
			(plan.supportAnchorMass ?? 0) * 0.35 +
			(plan.hasMetadataHint ? 0.25 : 0) +
			(plan.hasPathShapeHint ? 0.2 : 0) +
			(plan.hasTitleShapeHint ? 0.15 : 0);
	const bodyWithAnchor =
		plan.decisionPriors?.bodyWithAnchor ??
		(Math.min(plan.weightedAnchorMass ?? 0, plan.weightedBodyMass ?? 0) * 0.75 +
			(plan.anchorFamilyCount > 0 && plan.bodyFamilyCount > 0 ? 0.35 : 0));
	const bodyFirst =
		plan.decisionPriors?.bodyFirst ??
		(plan.decisiveBodyMass ?? 0) +
			(plan.supportBodyMass ?? 0) * 0.4 +
			(plan.bodyFamilyCount > 0 ? 0.25 : 0);
	const hasHybridShape =
		plan.anchorFamilyCount > 0 && plan.bodyFamilyCount > 0;
	const metadataLead = metadataFirst - Math.max(bodyWithAnchor, bodyFirst);
	if (!hasHybridShape && metadataFirst >= bodyFirst) {
		return "metadata-first";
	}
	if (hasHybridShape && metadataLead >= 0.18) {
		return "metadata-first";
	}
	if (hasHybridShape) {
		return "body-with-anchor";
	}
	return "body-first";
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
		compareMetadataPrefixAssistSignals(left, right) ||
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
	if (plan.hasMixedScriptHint) {
		return (
			compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
			compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
			compareCoverageLexicalWindowFusionSignals(
				left.localEvidence,
				right.localEvidence,
			) ||
			comparePhraseBridgeSignals(left, right) ||
			compareMetadataPrefixAssistSignals(left, right) ||
			compareCharSignals(left.bodyChar, right.bodyChar) ||
			compareCharSignals(left.metadataChar, right.metadataChar) ||
			compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
			comparePrefixTierPreference(left, right) ||
			compareAreaSignals(left.coreBody, right.coreBody) ||
			compareAreaSignals(left.softBody, right.softBody) ||
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			compareTagSignals(left.tagSignal, right.tagSignal) ||
			compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
		);
	}
	if (plan.hasPathShapeHint || plan.hasTitleShapeHint) {
		return (
			compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
			compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
			comparePhraseBridgeSignals(left, right) ||
			compareCoverageLexicalWindowFusionSignals(
				left.localEvidence,
				right.localEvidence,
			) ||
			compareMetadataPrefixAssistSignals(left, right) ||
			compareCharSignals(left.metadataChar, right.metadataChar) ||
			compareCharSignals(left.bodyChar, right.bodyChar) ||
			compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
			comparePrefixTierPreference(left, right) ||
			compareAreaSignals(left.coreBody, right.coreBody) ||
			compareAreaSignals(left.softBody, right.softBody) ||
			compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
			compareTagSignals(left.tagSignal, right.tagSignal) ||
			compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
		);
	}
	return (
		compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
		compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		compareMetadataPrefixAssistSignals(left, right) ||
		compareCharSignals(left.metadataChar, right.metadataChar) ||
		compareCharSignals(left.bodyChar, right.bodyChar) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePrefixTierPreference(left, right) ||
		compareAreaSignals(left.coreBody, right.coreBody) ||
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
		compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
		compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		compareMetadataPrefixAssistSignals(left, right) ||
		compareCharSignals(left.metadataChar, right.metadataChar) ||
		compareCharSignals(left.bodyChar, right.bodyChar) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePrefixTierPreference(left, right) ||
		compareAreaSignals(left.coreBody, right.coreBody) ||
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
	const surfaceGainDecision = compareAscendingMetric(
		left.surfaceCompletionGain,
		right.surfaceCompletionGain,
	);
	if (surfaceGainDecision !== 0) {
		return surfaceGainDecision;
	}
	const boundaryDecision = compareDescendingMetric(
		left.boundaryQuality,
		right.boundaryQuality,
	);
	if (boundaryDecision !== 0) {
		return boundaryDecision;
	}
	const compoundDecision = compareAscendingMetric(
		left.compoundPenalty,
		right.compoundPenalty,
	);
	if (compoundDecision !== 0) {
		return compoundDecision;
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
