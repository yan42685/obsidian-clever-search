import type {
	CoverageLexicalEvidenceMassSummary,
	CoverageLexicalFamilySignal,
	CoverageLexicalMetadataField,
} from "./coverage-lexical-types";

export const COVERAGE_LEXICAL_IDENTITY_FIELD_CONFIDENCE: Record<
	CoverageLexicalMetadataField,
	number
> = {
	basename: 1,
	aliases: 0.95,
	headings: 0.88,
	folder: 0.8,
	tags: 0.7,
};

export function createEmptyCoverageLexicalEvidenceMassSummary(): CoverageLexicalEvidenceMassSummary {
	return {
		decisiveCoveredMass: 0,
		decisiveExactIdentityMass: 0,
		decisiveExactBodyMass: 0,
		decisivePrefixIdentityMass: 0,
		decisivePrefixBodyMass: 0,
		decisiveFuzzyIdentityMass: 0,
		decisiveFuzzyBodyMass: 0,
		supportCoveredMass: 0,
		supportExactIdentityMass: 0,
		supportExactBodyMass: 0,
		supportPrefixIdentityMass: 0,
		supportPrefixBodyMass: 0,
		supportFuzzyIdentityMass: 0,
		supportFuzzyBodyMass: 0,
		witnessMass: 0,
		weakBridgeMass: 0,
		displayRawMass: 0,
	};
}

export function getCoverageLexicalEvidenceMassSummary(
	signal: CoverageLexicalFamilySignal,
): CoverageLexicalEvidenceMassSummary {
	return signal.evidenceMassSummary ?? createEmptyCoverageLexicalEvidenceMassSummary();
}

export function compareCoverageLexicalEvidenceMassSummaries(
	left: CoverageLexicalEvidenceMassSummary,
	right: CoverageLexicalEvidenceMassSummary,
): number {
	return (
		compareDescendingMetric(left.decisiveCoveredMass, right.decisiveCoveredMass) ||
		compareDescendingMetric(
			left.decisiveExactIdentityMass,
			right.decisiveExactIdentityMass,
		) ||
		compareDescendingMetric(left.decisiveExactBodyMass, right.decisiveExactBodyMass) ||
		compareDescendingMetric(
			left.decisivePrefixIdentityMass,
			right.decisivePrefixIdentityMass,
		) ||
		compareDescendingMetric(
			left.decisivePrefixBodyMass,
			right.decisivePrefixBodyMass,
		) ||
		compareDescendingMetric(
			left.decisiveFuzzyIdentityMass,
			right.decisiveFuzzyIdentityMass,
		) ||
		compareDescendingMetric(left.decisiveFuzzyBodyMass, right.decisiveFuzzyBodyMass) ||
		compareDescendingMetric(
			left.supportExactIdentityMass,
			right.supportExactIdentityMass,
		) ||
		compareDescendingMetric(left.supportExactBodyMass, right.supportExactBodyMass) ||
		compareDescendingMetric(
			left.supportPrefixIdentityMass,
			right.supportPrefixIdentityMass,
		) ||
		compareDescendingMetric(left.supportPrefixBodyMass, right.supportPrefixBodyMass) ||
		compareDescendingMetric(
			left.supportFuzzyIdentityMass,
			right.supportFuzzyIdentityMass,
		) ||
		compareDescendingMetric(left.supportFuzzyBodyMass, right.supportFuzzyBodyMass) ||
		compareDescendingMetric(left.supportCoveredMass, right.supportCoveredMass) ||
		compareDescendingMetric(left.witnessMass, right.witnessMass) ||
		compareDescendingMetric(left.weakBridgeMass, right.weakBridgeMass) ||
		compareDescendingMetric(left.displayRawMass, right.displayRawMass)
	);
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}
