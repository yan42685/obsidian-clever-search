export type CoverageFamilyMatchKind = "exact" | "prefix" | "fuzzy" | null;

export type CoverageLexicalFamily = {
	index: number;
	rawTerm: string;
	normalizedTerm: string;
	isCore: boolean;
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
	isShortQuery: boolean;
	hasMetadataHint: boolean;
	route: CoverageLexicalRoute;
};

export type CoverageLexicalAreaSignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
};

export type CoverageLexicalFamilySignal = {
	body: CoverageLexicalAreaSignal;
	metadata: CoverageLexicalAreaSignal;
	tailWeight: number;
	metadataWeight: number;
	matchedTerms: string[];
};
