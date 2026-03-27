export type CoverageFamilyMatchKind = "exact" | "prefix" | "fuzzy" | null;

export type CoverageLexicalFamilyStrength = "core" | "soft";

export type CoverageLexicalFamilyRole = "body" | "anchor" | "noise";

export type CoverageLexicalFamily = {
	index: number;
	rawTerm: string;
	normalizedTerm: string;
	strength: CoverageLexicalFamilyStrength;
	role: CoverageLexicalFamilyRole;
	isMetadataCapable: boolean;
	allowPrefix: boolean;
	allowFuzzy: boolean;
};

export type CoverageLexicalPhraseSignature = {
	index: number;
	familyIndices: number[];
	variants: string[];
	tailWeight: number;
};

export type CoverageLexicalPairSignature = {
	leftFamilyIndex: number;
	rightFamilyIndex: number;
	variants: string[];
	tailWeight: number;
	allowCandidateRecall: boolean;
};

export type CoverageLexicalCandidateState = {
	bodyMatches: Map<number, CoverageFamilyMatchKind>;
	metadataMatches: Map<number, CoverageFamilyMatchKind>;
	phraseMatches: Set<number>;
};

export type CoverageLexicalRoute =
	| "body-first"
	| "body-with-anchor"
	| "metadata-first";

export type CoverageLexicalFamilyProbe = {
	bodyExactDocCount: number;
	metadataExactDocCount: number;
};

export type CoverageLexicalPlan = {
	families: CoverageLexicalFamily[];
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	route: CoverageLexicalRoute;
	coreFamilyCount: number;
	anchorFamilyCount: number;
	bodyFamilyCount: number;
};

export type CoverageLexicalAreaSignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
};

export type CoverageLexicalLocalWindowSignal = {
	start: number;
	end: number;
	coreCoverageCount: number;
	exactCoreWeight: number;
	prefixCoreWeight: number;
	fuzzyCoreWeight: number;
	anchorCoverageCount: number;
	softCoverageCount: number;
	adjacentCorePairCount: number;
	adjacentCorePairWeight: number;
	orderedPairCount: number;
	orderRatio: number;
	compactnessRatio: number;
	score: number;
	matchedExactCoreFamilyIndices: number[];
	matchedPrefixCoreFamilyIndices: number[];
	matchedFuzzyCoreFamilyIndices: number[];
	matchedAnchorFamilyIndices: number[];
	matchedSoftFamilyIndices: number[];
};

export type CoverageLexicalWindowFusionSignal = {
	primary: CoverageLexicalLocalWindowSignal;
	support: CoverageLexicalLocalWindowSignal;
	supportWindowCount: number;
	corroboratedCoreCoverageCount: number;
	corroboratedExactCoreWeight: number;
	corroboratedPrefixCoreWeight: number;
	corroboratedFuzzyCoreWeight: number;
	corroboratedAnchorCoverageCount: number;
	corroboratedSoftCoverageCount: number;
};

export type CoverageLexicalPassageAdmissionSignal = {
	coreCoverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
	anchorCoverageCount: number;
	softCoverageCount: number;
	phraseMatchCount: number;
	phraseMatchWeight: number;
	compactnessScore: number;
};

export type CoverageLexicalFamilySignal = {
	coreBody: CoverageLexicalAreaSignal;
	softBody: CoverageLexicalAreaSignal;
	metadataAnchor: CoverageLexicalAreaSignal;
	tailCoreWeight: number;
	tailSoftWeight: number;
	phraseBridgeCount: number;
	phraseBridgeWeight: number;
	localEvidence: CoverageLexicalWindowFusionSignal;
	matchedTerms: string[];
};
