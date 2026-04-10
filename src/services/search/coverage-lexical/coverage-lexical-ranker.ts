import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageLexicalCharSignal,
	CoverageLexicalCoverageProfile,
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

export function compareCoverageLexicalResultSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	const coverageDecision = compareCoverageLexicalCoverageProfiles(
		left,
		right,
		plan,
	);
	if (coverageDecision !== 0) {
		return coverageDecision;
	}
	const metadataTieBandDecision = compareCloseCoverageMetadataPriority(
		left,
		right,
		plan,
	);
	if (metadataTieBandDecision !== 0) {
		return metadataTieBandDecision;
	}
	const earlyGuardrailDecision = compareEarlyBodyQualityGuardrails(
		left,
		right,
	);
	if (earlyGuardrailDecision !== 0) {
		return earlyGuardrailDecision;
	}
	const detailDecision = compareCoverageLexicalSemanticDetailStages(left, right);
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

function compareCloseCoverageMetadataPriority(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	if (!isWithinCoverageLexicalMetadataTieBand(left, right, plan)) {
		return 0;
	}
	if (
		hasDominantBodyWitnessAdvantage(left, right) ||
		hasDominantBodyWitnessAdvantage(right, left)
	) {
		return 0;
	}
	return (
		compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
		compareCoverageLexicalMetadataEvidenceStages(left, right) ||
		compareCloseCoverageMetadataIdentityMass(left, right)
	);
}

function compareCloseCoverageMetadataIdentityMass(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	const leftMass = getCoverageLexicalEvidenceMassSummary(left);
	const rightMass = getCoverageLexicalEvidenceMassSummary(right);
	return (
		compareDescendingMetric(
			leftMass.decisiveExactIdentityMass,
			rightMass.decisiveExactIdentityMass,
		) ||
		compareDescendingMetric(
			leftMass.supportExactIdentityMass,
			rightMass.supportExactIdentityMass,
		) ||
		compareDescendingMetric(
			leftMass.decisivePrefixIdentityMass,
			rightMass.decisivePrefixIdentityMass,
		) ||
		compareDescendingMetric(
			leftMass.supportPrefixIdentityMass,
			rightMass.supportPrefixIdentityMass,
		) ||
		compareDescendingMetric(
			computeCloseCoverageTotalIdentityMass(leftMass),
			computeCloseCoverageTotalIdentityMass(rightMass),
		)
	);
}

function computeCloseCoverageTotalIdentityMass(
	summary: ReturnType<typeof getCoverageLexicalEvidenceMassSummary>,
): number {
	return (
		summary.decisiveExactIdentityMass +
		summary.supportExactIdentityMass +
		summary.decisivePrefixIdentityMass +
		summary.supportPrefixIdentityMass +
		summary.decisiveFuzzyIdentityMass +
		summary.supportFuzzyIdentityMass
	);
}

function isWithinCoverageLexicalMetadataTieBand(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): boolean {
	const decisiveGapDelta = Math.abs(
		getEffectiveDecisiveGapCount(left, plan) -
			getEffectiveDecisiveGapCount(right, plan),
	);
	if (decisiveGapDelta > 0) {
		return false;
	}
	const supportGapDelta = Math.abs(
		getEffectiveSupportGapCount(left, plan) -
			getEffectiveSupportGapCount(right, plan),
	);
	if (supportGapDelta > 0) {
		return false;
	}
	const adjustedRequiredRatioDelta = Math.abs(
		getAdjustedRequiredCoverageRatio(left, plan) -
			getAdjustedRequiredCoverageRatio(right, plan),
	);
	if (adjustedRequiredRatioDelta > 0.25) {
		return false;
	}
	const meaningfulRatioDelta = Math.abs(
		getCoverageWeightRatio(
			left.coverageProfile.meaningfulCoveredFamilyWeight,
			left.coverageProfile.meaningfulFamilyWeight,
		) -
			getCoverageWeightRatio(
				right.coverageProfile.meaningfulCoveredFamilyWeight,
				right.coverageProfile.meaningfulFamilyWeight,
			),
	);
	return meaningfulRatioDelta <= 0.28;
}

function compareCoverageLexicalSemanticDetailStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareMetadataIdentitySignals(left.metadataIdentity, right.metadataIdentity) ||
		compareDescendingMetric(left.coreBody.exactWeight, right.coreBody.exactWeight) ||
		compareCoverageLexicalWindowFusionSignals(
			left.localEvidence,
			right.localEvidence,
		) ||
		comparePhraseBridgeSignals(left, right) ||
		compareCoverageLexicalMetadataEvidenceStages(left, right) ||
		compareCharSignals(left.bodyChar, right.bodyChar) ||
		compareDescendingMetric(left.tailCoreWeight, right.tailCoreWeight) ||
		comparePrefixTierPreference(left, right) ||
		compareAreaSignals(left.coreBody, right.coreBody) ||
		compareAreaSignals(left.softBody, right.softBody) ||
		compareDescendingMetric(left.tailSoftWeight, right.tailSoftWeight)
	);
}

function compareCoverageLexicalMetadataEvidenceStages(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	return (
		compareAreaSignals(left.metadataAnchor, right.metadataAnchor) ||
		compareMetadataPrefixAssistSignals(left, right) ||
		compareTagSignals(left.tagSignal, right.tagSignal) ||
		compareCharSignals(left.metadataChar, right.metadataChar)
	);
}

function compareEarlyBodyQualityGuardrails(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
): number {
	const bodyWitnessDecision = compareBodyWitnessSignals(left, right);
	if (bodyWitnessDecision === 0) {
		return 0;
	}
	if (bodyWitnessDecision < 0) {
		return hasPromotableBodyWitness(left, right) ? -1 : 0;
	}
	return hasPromotableBodyWitness(right, left) ? 1 : 0;
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
): boolean {
	if (!hasPromotableBodyWitness(candidate, opponent)) {
		return false;
	}
	if (hasStrongMetadataIdentity(opponent)) {
		return false;
	}
	if (
		compareMetadataIdentitySignals(
			candidate.metadataIdentity,
			opponent.metadataIdentity,
		) > 0
	) {
		return false;
	}
	return compareCoverageLexicalMetadataEvidenceStages(opponent, candidate) < 0;
}

function hasDominantBodyWitnessAdvantage(
	candidate: CoverageLexicalFamilySignal,
	opponent: CoverageLexicalFamilySignal,
): boolean {
	if (hasStrongMetadataIdentity(opponent)) {
		return false;
	}
	return hasPromotableBodyWitness(candidate, opponent);
}

function hasStrongMetadataIdentity(
	signal: CoverageLexicalFamilySignal,
): boolean {
	return (
		signal.metadataIdentity.phraseCoverageCount > 0 ||
		signal.metadataIdentity.overall.coverageCount > 0
	);
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
