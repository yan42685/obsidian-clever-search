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
	orderedPairCount: number;
	orderRatio: number;
	compactnessRatio: number;
	score: number;
};

export type CoverageLexicalFamilySignal = {
	coreBody: CoverageLexicalAreaSignal;
	softBody: CoverageLexicalAreaSignal;
	metadataAnchor: CoverageLexicalAreaSignal;
	tailCoreWeight: number;
	tailSoftWeight: number;
	localWindow: CoverageLexicalLocalWindowSignal;
	matchedTerms: string[];
};
