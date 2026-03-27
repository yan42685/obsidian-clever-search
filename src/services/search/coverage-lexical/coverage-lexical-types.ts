export type CoverageFamilyMatchKind = "exact" | "prefix" | "fuzzy" | null;

export type CoverageLexicalFamily = {
	index: number;
	rawTerm: string;
	normalizedTerm: string;
	isCore: boolean;
	isMetadataCapable: boolean;
};

export type CoverageLexicalRoute =
	| "body-first"
	| "body-with-anchor"
	| "metadata-first";

export type CoverageLexicalPlan = {
	families: CoverageLexicalFamily[];
	isShortQuery: boolean;
	route: CoverageLexicalRoute;
};

export type CoverageLexicalFamilySignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
	tailWeight: number;
	metadataWeight: number;
};
