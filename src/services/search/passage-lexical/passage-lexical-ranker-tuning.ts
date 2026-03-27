export const PASSAGE_LEXICAL_SEGMENTATION_TUNING = {
	targetTokens: 120,
	minTokens: 48,
	overlapTokens: 48,
} as const;

export const PASSAGE_LEXICAL_RANKER_TUNING = {
	fileMetadataPrior: 0.28,
	fileCoverageBonus: 1.15,
	fileMetadataAnchorBlend: 0.82,
	fileMixedQueryBodyMetadataBonus: 0.74,
	passageLocalityCoverageWeight: 0.52,
	passageLocalityOrderWeight: 0.4,
	passageLocalityCompactnessWeight: 0.66,
	passageLocalityTightWindowBonus: 0.24,
	verifierCoverageWeight: 0.92,
	verifierOrderWeight: 0.78,
	verifierCompactnessWeight: 1.1,
	verifierExactPhraseBonus: 2.1,
	verifierTightWindowBonus: 0.55,
	verifierLocalWindowWeight: 0.78,
	passageLocalityLocalWindowWeight: 0.42,
	localWindowCoverageWeight: 1.24,
	localWindowAnchorWeight: 0.54,
	localWindowCompactnessWeight: 0.96,
	localWindowOrderWeight: 0.34,
	prefixFamilyVerifierCoverageBonus: 0.54,
	prefixFamilyLocalityCoverageBonus: 0.34,
	prefixFamilyOrderScale: 0.42,
} as const;

export type PassageLexicalSegmentationTuning =
	typeof PASSAGE_LEXICAL_SEGMENTATION_TUNING;
export type PassageLexicalRankerTuning = typeof PASSAGE_LEXICAL_RANKER_TUNING;
